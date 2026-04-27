# ADR 0026 — Motor de régua de cobrança via DSL declarativa

- **Status:** Proposed
- **Date:** 2026-04-27

## Context

[Sprint 13 — WhatsApp + Régua de cobrança](../sprints/13-geral-whatsapp-e-regua-cobranca.md) precisa permitir que cada tenant configure **automação de cobrança e engajamento** sem código custom. Casos típicos:

- Boleto vencido D+1: WhatsApp + email lembrando
- Boleto vencido D+3: WhatsApp escalado + ligar para call center (sinal externo)
- Boleto vencido D+7: gerar 2ª via no Asaas + email
- Pagamento recebido: parar régua + agradecer
- Member sem check-in 14 dias: WhatsApp engajamento
- Aniversário: cupom desconto

Anti-padrão clássico: **código custom por tenant** (cada cliente vira branch ou configuração imperativa) — vira impossível de manter para solo dev.

Solução: **DSL declarativa** — tenant configura régua em estrutura de dados (JSON validado por Zod) que motor genérico interpreta.

## Decision

Adotar **DSL JSON com 4 conceitos**: `trigger`, `actions`, `stop_on`, `guards`. Motor único (`packages/messaging/regua/`) interpreta para todos os tenants.

### 1. Estrutura da régua

```ts
// packages/messaging/regua/schema.ts
const ReguaSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  trigger: z.object({
    event: z.enum([
      'invoice.overdue',
      'invoice.paid',
      'member.no_checkin',
      'member.birthday',
      'appointment.confirmed',
      'appointment.no_show',
      'consulta.closed',
      'tenant.alert_critical',
    ]),
    filter: z.record(z.unknown()).optional(),  // ex: { plan: 'gold', amount_gte: 100 }
  }),
  actions: z.array(z.object({
    delay: z.string(),                                    // '0m' | '1d' | '3d' | '14d' (Duration)
    channel: z.enum(['whatsapp', 'email', 'sms', 'in_app', 'push']),
    template: z.string(),                                  // referência para whatsapp_templates / email_templates
    fallback: z.array(z.enum(['email', 'sms', 'in_app'])).optional(),  // se canal primário falhar
    cap: z.number().optional(),                            // máximo de envios desta action (default 1)
  })),
  stop_on: z.array(z.enum([
    'invoice.paid',
    'member.opted_out',
    'consulta.cancelled',
    'tenant.disabled',
  ])),
  guards: z.object({
    quiet_hours: z.tuple([z.string(), z.string()]).default(['22:00', '07:00']),
    max_per_day: z.number().default(3),
    require_consent: z.boolean().default(true),  // opt-in WhatsApp/SMS
  }).optional(),
});
```

Exemplo concreto — régua "Cobrança boleto vencido":

```json
{
  "id": "cobranca-boleto",
  "name": "Cobrança boleto vencido",
  "enabled": true,
  "trigger": { "event": "invoice.overdue" },
  "actions": [
    { "delay": "1d", "channel": "whatsapp", "template": "cobranca_d1", "fallback": ["email"] },
    { "delay": "3d", "channel": "whatsapp", "template": "cobranca_d3", "fallback": ["email"] },
    { "delay": "7d", "channel": "email",    "template": "cobranca_d7" }
  ],
  "stop_on": ["invoice.paid", "member.opted_out"]
}
```

### 2. Motor (Vercel Cron + tabela `regua_jobs`)

Cron `POST /api/jobs/reguas/tick` a cada 5 minutos:

1. Lê eventos novos em `event_log` (ADR 0071) desde último tick
2. Para cada evento, encontra réguas com `trigger.event` correspondente + `filter` aplicado
3. Para cada `action`, calcula `scheduled_for = trigger_at + delay` e enfileira em `regua_jobs (id, tenant_id, regua_id, action_index, member_id, scheduled_for, status, fallback_used)`
4. Em paralelo, processa `regua_jobs WHERE scheduled_for <= now() AND status='pending'`:
   - Aplica `guards` (quiet_hours → reagendar; max_per_day → drop; require_consent → drop se opt-out)
   - Verifica `stop_on` — algum evento de parada chegou? → `status='cancelled'`
   - Envia via canal usando provider abstrato (WhatsApp via ADR 0025, email via Resend)
   - Falhou → tenta `fallback[0]`, depois `fallback[1]`
   - Sucesso → `status='sent'` + `audit_log`

Tudo dentro de `wrapJob()` (regra 33, ADR 0071) — auditoria + retry exponencial + dead letter queue.

### 3. UI editor + validação

Tenant configura via formulário visual (`/app/financeiro/reguas`) que **gera o JSON** — não digitação manual. Validação:
- Frontend: form types do Zod schema; preview de "linha do tempo" da régua
- Backend: Server Action chama `ReguaSchema.parse()` antes de salvar; rejeita JSON inválido com `FormError` (regra 45)

Catálogo seed por tenant (criado no onboarding):
- Cobrança boleto (D+1, D+3, D+7)
- Confirmação agendamento (24h antes + 2h antes)
- Reativação member inativo (14d, 30d, 60d)

Tenant pode duplicar/customizar/desabilitar — não pode deletar régua seed (manter rastreabilidade).

### 4. Idempotência + observabilidade

- `regua_jobs` tem `unique (tenant_id, regua_id, action_index, member_id, trigger_event_id)` — evento duplicado não cria envio duplicado
- Cada envio gera `audit_log` + métrica PostHog `regua.message_sent { tenant_id, regua_id, channel, fallback_used }`
- Falhas geram `system_alerts` (ADR 0071) por canal

## Consequences

### Positivas

- **Solo dev mantém 1 motor** — N tenants × M réguas, mesmo código
- **Sem deploy para mudar régua** — tenant edita JSON via UI; revisão LogiFit quando estrutura muda
- **DSL versionável** — `regua_versions (regua_id, version, json, created_at)`; rollback fácil
- **Dry-run nativo** — UI mostra "se eu rodar agora, X members receberiam Y mensagens" antes de habilitar
- **Auditoria completa** — `audit_log` registra cada send + falha + cancelamento

### Negativas (mitigáveis)

- **DSL não é Turing-complete** — casos exóticos (`if member.plano==='gold' AND last_order > 30d AND nps < 7`) podem não caber. Mitigação: campo `filter` aceita expressão jsonpath simples; casos muito custom viram feature do produto, não config tenant
- **Cron 5min tem latência** — D+1 pode disparar até 5min após a hora exata. Aceitável para cobrança/engajamento; não aceitável para alerta clínico (que usa fila direta, não régua)
- **Motor cresce com novos `trigger.event`** — cada novo evento exige código + teste. Mitigação: catálogo de eventos canônicos pequeno (~10) cobre 90% dos casos

### Riscos não endereçados

- **Tenant configurar régua agressiva (3 mensagens/hora)** — `guards.max_per_day` limita; rate limit de canal (regra 36) é última linha
- **Member opta-out por canal mas régua continua em outro** — `member.opted_out` é evento global; `whatsapp_consent.opted_out_at` derruba só WhatsApp. Mitigação: tabela `member_channel_consent (member_id, channel, opted_in, opted_out_at)`
- **Régua com loop infinito** — pré-validação rejeita ciclo (action → action). `stop_on` obrigatório

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| **Código custom por tenant** | Inviável solo dev; cada cliente vira branch |
| **Workflow engine externo (Temporal, n8n, Camunda)** | Adiciona infra pesada; sub-processor extra LGPD; overkill para 90% dos casos |
| **CRON cron-job.org direto** | Sem auditoria; sem retry estruturado; sem fallback de canal |
| **DSL imperativa (script JS sandbox)** | Risco de injeção; debugar é inferno; tenant pode loop |
| **Apenas régua de cobrança hardcoded** | Engajamento (Sprint 09) e confirmação (Sprint 03) precisam mesma infra → duplicação |

## Escopo de impacto

- **Sprint 13** — implementação completa: schema Zod, motor `wrapJob()`, UI editor, catálogo seed, integração WhatsApp (ADR 0025) + email (Resend)
- **Sprint 09 (Engajamento)** — adiciona triggers `member.no_checkin`, `member.birthday`, `member.churn_high` (com ADR 0027)
- **Sprint 03 (Agenda)** — adiciona triggers `appointment.confirmed`, `appointment.no_show`
- **Sprint 26 (Portal paciente)** — exibe histórico de mensagens recebidas pelo member
- **Sprint 06 (Copilot)** — IA pode sugerir nova régua (Camada 2) ou modificar existente (Camada 3 com confirmação — ADR 0075)

## Related

- Implementa parte de [Sprint 13 — WhatsApp + Régua de cobrança](../sprints/13-geral-whatsapp-e-regua-cobranca.md)
- Depende de [ADR 0025 — Provider WhatsApp](0025-provider-whatsapp.md)
- Integra [ADR 0071 — Tratamento de erros + alertas](0071-sistema-tratamento-erros-alertas-tempo-real.md) — `wrapJob()` + `event_log` + `system_alerts`
- Reforça regra 33 (CLAUDE.md) — Server Actions + jobs sempre via wrapper
- Reforça regra 45 (CLAUDE.md) — `<FormError>` em validação de régua inválida
