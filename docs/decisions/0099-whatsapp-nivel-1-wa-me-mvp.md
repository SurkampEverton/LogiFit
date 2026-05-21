# ADR 0099 — WhatsApp integração Nível 1 (wa.me link) único no MVP

- **Status:** Accepted
- **Date:** 2026-05-21

## Context

LogiFit precisa de canal complementar ao email pra invite de paciente (passport cross-tenant ADR 0077) + signup proativo (`/cadastro` Path B ADR 0093) + régua de cobrança (Sprint 13). WhatsApp é canal #1 no Brasil — **95% dos pacientes têm app**, 98% open rate, ~45-60% CTR (vs 30% / 3-5% do email).

Existem 3 níveis técnicos de integração com WhatsApp, cada um com trade-offs distintos:

### Nível 1 — `wa.me` link puro

URL `https://wa.me/<phone>?text=<mensagem-pré-formatada>` abre WhatsApp Web/app diretamente, com chat direcionado ao número + texto pronto. **Stateless** — LogiFit não vê a conversa, não armazena nada, é redirect puro.

**Custo:** R$ 0. **Setup:** zero (HTML `<a>`). **LGPD:** sem implicação (sem dado em servers externos LogiFit).

### Nível 2 — WhatsApp Cloud API (Meta direto, sem BSP)

Bot WhatsApp da LogiFit (número dedicado) responde mensagens automaticamente via webhook + state machine no backend. State persistido em DB; bot pode conduzir cadastro completo no chat.

**Custo:** trial grátis Meta + ~R$ 0,04–0,30 por mensagem **outbound** (utility/marketing cobradas desde 1ª em 2026, conforme mudança modelo Jan/2026). Service messages (resposta dentro de janela 24h iniciada pelo cliente) continuam **grátis ilimitadas** (Meta removeu cap 1k/mês em Nov/2024).

**Setup:** 3-5 dias — Meta Business Account verificado, número dedicado, display name approved, webhook receive `messages.upsert`, state machine, templates aprovados pela Meta pra notificações iniciadas pelo bot.

**LGPD:** ⚠️ problemático. Toda conversa fica em infra Meta (US) — transferência internacional de dado de saúde sensível (LGPD art. 11) sob DPA + Cláusulas Padrão. Meta vira **sub-processor LGPD** ([ADR 0067](0067-dpo-governanca-compliance-lgpd.md)).

### Nível 3 — IA conversacional natural

Cloud API + LLM (Gemini Flash via Vertex AI, [ADR 0064](0064-ia-arquitetura-gemini-default-byok-rag.md)) conduz conversa fluida com extração estruturada via tool calls. Modelo entende variações de input ("José da Silva" / "é o José aqui").

**Custo:** Nível 2 + ~R$ 0,10–0,50 por mensagem LLM.

**LGPD:** ⚠️⚠️ pior. LLM precisa **processar** dados de saúde sensíveis. CFM 2.454/2026 (vigência ago/2026) classifica esse uso como **SaMD II+ por feature** — exige Comitê de IA interno do tenant + ata anexada + classificação documentada por feature (regra 28).

## Decision

**Adotar APENAS Nível 1 (`wa.me` link) no MVP.** Níveis 2 e 3 ficam fora do escopo MVP — promoção condicional a thresholds claros documentados abaixo.

### Por que Nível 1

1. **Custo R$ 0** — alinha com filosofia self-host total ([ADR 0091](0091-self-host-total-oracle-sp.md)) + tier free Brevo ([ADR 0096](0096-email-brevo-substitui-aws-ses.md)) cobre canal email gratuito; WhatsApp via `wa.me` complementa sem custo
2. **Setup zero** — HTML `<a>` com `wa.me/<num>?text=<msg>`; nada de Meta verification, sem display name approval, sem webhook
3. **LGPD trivial** — redirect puro não cria sub-processor; lista do [ADR 0067](0067-dpo-governanca-compliance-lgpd.md) não muda; sem transferência internacional
4. **CFM 2.454/2026 N/A** — não há LLM processando dados clínicos no canal WhatsApp
5. **Híbrido com email funciona** — pesquisa Customer.io 2025 mostra que email com link direto + botão WhatsApp converte ~62% (vs ~45% só email; ~20% só WhatsApp). É o que LogiFit já implementou em `passport-invite.ts` + `email-verification.ts`

### Quando o cadastro acontece via WhatsApp (Nível 1 vs 2)

| | Nível 1 (atual) | Nível 2 (futuro) |
|---|---|---|
| Paciente clica botão WhatsApp do email | abre Zap com texto + **link pra /i/<token>** | abre Zap, **bot pergunta dados diretamente** |
| Onde paciente cadastra | **NA WEB** (formulário `/cadastro` ou `/i/<token>`) | **NO WHATSAPP** (state machine + webhook) |
| Validação CPF/email | `<input>` com pattern validation visual | bot pede + reverify por mensagem (UX pior) |
| LGPD | dado fica direto no LogiFit | dado passa por Meta US antes |
| Anexar comprovante / foto doc | `<input type="file">` direto | Zap envia → bot valida MIME → upload backend |

Nível 1 = **WhatsApp como canal de DISTRIBUIÇÃO de link** (paciente clica link → cadastra na web).
Nível 2 = **WhatsApp como canal de CADASTRO** (cadastra dentro do chat).

### Thresholds pra revisar (gatilhos de upgrade)

Re-avaliar promoção pra Nível 2 quando **AMBOS**:

- Volume sustentado **>200 signups/dia** por **>30 dias consecutivos** (validação de demanda)
- Taxa de conversão atual do híbrido email+wa.me cair abaixo de **35%** por 14 dias (degradação UX que justifica investir em fricção menor)

Re-avaliar promoção pra Nível 3 quando **AMBOS**:

- Nível 2 implementado e funcionando há **>3 meses**
- Comitê de IA interno do LogiFit (regra 28 + ADR 0053) **estabelecido** + ata aprovada pra usar LLM em canal clínico

Ou seja: Nível 3 nunca acontece sem passar por Nível 2 antes.

### Implementação atual (Nível 1)

3 lugares onde `wa.me` já é usado:

1. **Email `email-verification.ts`** (commit `8110a00`): botão verde "Falar com LogiFit no WhatsApp" pós-confirmação, configurável via `NEXT_PUBLIC_LOGIFIT_WHATSAPP_NUMBER`
2. **Email `passport-invite.ts`** (commit `0c930eb`): botão verde "Falar com `<tenant>` no WhatsApp" pra paciente tirar dúvida com a clínica antes de aceitar
3. **`sendPatientInvite` Server Action** (commit `c321d3d`): retorna `whatsappShareUrl` (wa.me/<paciente>?text=msg) pra staff usar quando paciente não tem email — staff abre Zap com chat pronto pra enviar manualmente

Helper canônico: [`apps/web/app/lib/passport-invite-share.ts`](../../apps/web/app/lib/passport-invite-share.ts) — `buildPatientWhatsappShareUrl` + `buildInviteUrl`.

## Consequences

### Positivas

- **Custo recorrente zero** no canal WhatsApp; preserva margem MVP
- **Sem novo sub-processor LGPD** — DPO mantém lista enxuta (ADR 0067)
- **Sem dependência Meta verification** (3-5 dias eliminados do bootstrap)
- **Sem risco CFM 2.454/2026** — fora do escopo SaMD pro canal WhatsApp
- **Flexibilidade**: cada clínica pode usar próprio número WhatsApp (humano dela responde) sem LogiFit precisar provisionar nada
- **Cross-platform**: `wa.me` funciona em iOS, Android, WhatsApp Web; sem app específico

### Negativas

- **Sem automação de conversa** — humano da clínica precisa responder mensagens recebidas via `wa.me`; pode atrasar resposta fora de horário comercial
- **Conversion sub-ótima** — perde os ~2× lift que Nível 2 traz quando volume justificar
- **Sem rastreamento** — LogiFit não vê se paciente abriu o WhatsApp, se respondeu, se foi bem atendido (só rastreia clique no link de invite quando chega na web)
- **Sem broadcast de marketing** — wa.me não suporta envio em massa; pra régua de cobrança escala (Sprint 13) precisa email ou SMS (não WhatsApp gratuito)

### Não-objetivos

- Não vamos implementar bot Cloud API no MVP
- Não vamos usar LLM em canal WhatsApp no MVP
- Não vamos comprar número Twilio/Gupshup BSP no MVP (decidido também em [ADR 0096](0096-email-brevo-substitui-aws-ses.md) §"Email transacional gratuito")
- Não vamos integrar com WhatsApp Business App stand-alone (não API) — esse acessa lista de contatos do telefone (problemático LGPD, conforme research Customer.io 2025 sobre escala de Click to Chat)

## Roadmap migração futura (se um dia for promovido)

Sequência exata pra subir de Nível 1 → Nível 2 (ordem importa por dependências):

1. **ADR atualizar** este (0099) pra "Superseded by ADR 0XXX" + criar ADR novo "WhatsApp Cloud API bot pro cadastro automatizado"
2. **ADR 0067** (DPO) + lista pública sub-processors — adicionar Meta WABA com 30d antecedência aos tenants
3. **Conta Meta Business verificada** + número dedicado (~3-5 dias)
4. **Templates aprovados pela Meta** pra welcome / OTP / régua (~24-48h cada)
5. **Schema novo** `whatsapp_conversations` (state machine) + `whatsapp_messages` (audit log; particionado mensal regra 34)
6. **Webhook** `/api/whatsapp/webhook` Meta → state machine → bot response
7. **Migração callers** — `wa.me/<num>?text=msg` → bot CTWA (mas mantém `wa.me` como fallback se Meta down)
8. **RIPD novo** — DPO sign-off pra canal WhatsApp processing
9. **Feature flag** `whatsapp_bot_v1` (sistema do [ADR 0098](0098-feature-flags-mvp-self-host.md))
10. **Smoke + E2E** + monitoring (Meta delivery webhooks)

Esforço estimado: **2-3 semanas dev + 1-2 semanas Meta approval** quando voltar pra essa decisão.

## Referências

- [ADR 0091 — Self-host total Oracle SP](0091-self-host-total-oracle-sp.md) — filosofia stack
- [ADR 0096 — Brevo substitui AWS SES](0096-email-brevo-substitui-aws-ses.md) — canal email gratuito
- [ADR 0067 — DPO Governança LGPD](0067-dpo-governanca-compliance-lgpd.md) — sub-processors
- [ADR 0077 — Passaporte paciente cross-tenant](0077-passaporte-paciente-vinculo-cross-tenant.md) — fluxo invite
- [ADR 0098 — Feature flags self-host](0098-feature-flags-mvp-self-host.md) — flag `whatsapp_bot_v1` futura
- Pesquisa: SocialHub "Preço WhatsApp Business API Brasil 2026"; Meta WhatsApp Pricing 2026; Customer.io Email Conversion Study 2025; eesel AI "WhatsApp Business API July 2025 changes"
