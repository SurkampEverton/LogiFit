# ADR 0025 — Provider WhatsApp Business API (escolha + abstração)

- **Status:** Proposed
- **Date:** 2026-04-27

## Context

[Sprint 13 — WhatsApp + Régua de cobrança](../sprints/13-geral-whatsapp-e-regua-cobranca.md) introduz canal WhatsApp como peça central de:

1. **Régua de cobrança** declarativa (ADR 0026) — mensagens automáticas D+1, D+3, D+7 de boleto vencido
2. **Notificações de `system_alerts`** críticos para tenant_owners (ADR 0071)
3. **Confirmação de agendamento** (Sprint 03)
4. **Inbound multifluxo** — recepção de mensagens (ADR 0051)
5. **Engajamento** (Sprint 09) — campanhas opt-in

Três providers no mercado brasileiro:

| Provider | Custo conversa (24h) | Risco ban | Templates | Latência aprovação |
|---|---|---|---|---|
| **Twilio Business API** | ~R$ 0,30-0,40 | Baixo (oficial Meta) | Aprovação Meta direta | 1-3 dias |
| **Z-API** | ~R$ 0,20 + R$ 99/mês | **Alto** (não-oficial — usa Web/Multi-device) | Sem templates oficiais | Imediato (mas ban risk) |
| **Meta Business API direto** | ~R$ 0,20-0,30 | Zero (oficial Meta) | Aprovação Meta direta | 1-3 dias |
| **Gupshup / Take Blip / Infobip** | ~R$ 0,30-0,50 | Baixo (BSPs oficiais) | Aprovação Meta + UI auxiliar | 1-3 dias |

Risco crítico: **Z-API + similares (não-BSP oficiais)** podem ser banidos pela Meta a qualquer momento — número do tenant pode ser bloqueado permanentemente. Em ambiente clínico, **número banido = paciente sem agendamento confirmado** = incidente operacional.

## Decision

Adotar **Meta Business API direto via BSP oficial**, com abstração de provider:

### 1. Escolha do BSP — POC com 2 finalistas

POC obrigatório no início do Sprint 13 (3-5 dias) avaliando:
- **Twilio Business API** — maturidade global, documentação excelente, custo médio
- **Gupshup BR** — preço competitivo BR, suporte em português

Critérios de decisão:
- Custo por conversa em volume realista (1k mensagens/mês)
- Tempo de aprovação de templates (medido com 3 templates seed)
- Qualidade do SDK Node/TypeScript
- Suporte para mídia (PDF de boleto + imagem de exame)
- Webhooks para inbound (ADR 0051)

Resultado do POC vira **ADR de submissão** durante Sprint 13 (fixa o BSP). **Z-API e similares estão fora** do escopo — risco operacional inaceitável.

### 2. Abstração `WhatsAppProvider` (interface única)

Mesmo padrão dos providers fiscais (ADR 0059) e OCR (ADR 0035):

```ts
// packages/messaging/whatsapp/provider.ts
interface WhatsAppProvider {
  sendTemplate(args: SendTemplateArgs): Promise<MessageResult>;
  sendFreeForm(args: SendFreeFormArgs): Promise<MessageResult>;  // só dentro janela 24h
  registerWebhook(events: WebhookEvent[]): Promise<void>;
  approveTemplate(template: TemplateDef): Promise<TemplateApprovalResult>;
  fetchMessageStatus(externalId: string): Promise<MessageStatus>;
}

class TwilioWhatsAppProvider implements WhatsAppProvider { /* ... */ }
class GupshupWhatsAppProvider implements WhatsAppProvider { /* ... */ }
```

Tabela `whatsapp_providers (tenant_id, provider, credentials_encrypted, phone_number_id, business_account_id, status)` permite **trocar de BSP por tenant** sem mudança de código (defensivo contra mudança de preço ou SLA).

### 3. Templates aprovados pré-cadastrados

LogiFit mantém **catálogo global** de ~10 templates seed (`whatsapp_templates_global`) cobrindo:
- Cobrança D+1, D+3, D+7 (régua — ADR 0026)
- Confirmação agendamento + lembrete 24h antes
- Resultado de exame disponível
- Alerta crítico tenant_owner
- Boas-vindas member
- Reativação cliente inativo

Templates passam por aprovação Meta uma única vez por BSP/número. Tenant pode customizar **textos** (não-estruturais) via UI — variáveis `{{1}}, {{2}}` mantidas.

### 4. Rate limit + opt-in obrigatório

- **Rate limit Upstash:** 3 mensagens/hora/member (regra 36); 100 mensagens/dia/tenant (anti-burst)
- **Opt-in obrigatório:** member registra consent explícito via dupla opt-in (formulário web + confirmação WhatsApp). Tabela `whatsapp_consent (member_id, opted_in_at, opted_in_source, opted_out_at)` — base legal LGPD: legítimo interesse + consent explícito (regra 29).
- **Quiet hours:** 22h-7h bloqueia envio (override apenas para `severity=critical` em `system_alerts`)

## Consequences

### Positivas

- **Risco ban zero** — BSP oficial Meta; número do tenant protegido
- **Custo previsível** — ~R$ 0,20-0,30/conversa, repassado via overage do plano (ADR 0066)
- **Trocar BSP é configuração** — não refactor; mitigação a aumento de preço de Twilio/Gupshup
- **Templates aprovados centralizados** — Tenant não precisa entender Meta Business; LogiFit gerencia
- **Compliance LGPD** — opt-in explícito + opt-out fácil + consent log

### Negativas (mitigáveis)

- **Tempo de aprovação Meta** (~1-3 dias por template) — bloqueia tenant que quer customização imediata. Mitigação: catálogo seed cobre ~90% dos casos; customização avançada exige espera assumida no contrato
- **BSP cobra setup fee** — Twilio ~R$ 100; Gupshup ~R$ 50. Repasse via plano Pro+ (que inclui WhatsApp). Solo/Starter usa email-only
- **Janela 24h** — só pode mandar `sendFreeForm` se member respondeu nas últimas 24h. Fora: `sendTemplate`. Lógica embutida no wrapper

### Riscos não endereçados

- **BSP escolhido falir / mudar preço drasticamente** — abstração permite migrar tenant; processo manual de re-cadastro de número Meta (~3 dias)
- **Meta endurecer regras de templates** (já aconteceu em 2023) — reaprovação de catálogo seed; buffer de 1 semana sem envio durante migração
- **Tenant usar WhatsApp para spam** — rate limit + monitoring + opt-out fácil mitigam; reincidência → suspensão do canal por LogiFit

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| **Z-API (não-oficial)** | Risco de ban inaceitável em ambiente clínico; número do tenant pode ser bloqueado permanentemente |
| **WhatsApp Web automation (Puppeteer/whatsapp-web.js)** | Idem Z-API — ban iminente; viola TOS Meta |
| **Hardcode Twilio sem abstração** | Lock-in; preço sobe → refactor extenso |
| **Multi-canal email-only no MVP** | WhatsApp é canal #1 BR; ausência derruba retenção; concorrentes oferecem |
| **Meta Business direto sem BSP** | Possível mas exige Tier 1 verification, gestão de templates direta — trabalho operacional alto para solo dev |

## Escopo de impacto

- **Sprint 13** — POC + decisão BSP + abstração + templates seed + régua + webhook inbound
- **Sprint 09** — engajamento campanha opt-in usa abstração
- **Sprint 03** — confirmação agendamento usa template seed
- **Sprint 06** — Copilot pode propor envio (Camada 3 com confirmação — ADR 0075)
- **Sprint 26** — portal paciente exibe histórico de conversas (cross-link)

## Related

- Habilita [Sprint 13 — WhatsApp + Régua de cobrança](../sprints/13-geral-whatsapp-e-regua-cobranca.md)
- Pré-requisito de [ADR 0026 — Motor de régua DSL](0026-motor-regua-dsl.md)
- Integra [ADR 0051 — WhatsApp inbound canal multifluxo](0051-whatsapp-inbound-canal-multifluxo.md)
- Reforça [ADR 0071 — Sistema de tratamento de erros e alertas em tempo real](0071-sistema-tratamento-erros-alertas-tempo-real.md) — canal WhatsApp para `severity=critical`
- Sub-processor LGPD declarado em [`docs/compliance/sub-processors.md`](../compliance/sub-processors.md) — atualização ao escolher BSP final
