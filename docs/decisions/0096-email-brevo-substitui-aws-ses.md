# ADR 0096 — Brevo substitui AWS SES como provider de email transacional

- **Status:** Accepted
- **Date:** 2026-05-20
- **Supersedes (parcial):** [ADR 0091](0091-self-host-total-oracle-sp.md) — bloco "Email transacional: AWS SES" da decisão original

## Context

[ADR 0091](0091-self-host-total-oracle-sp.md) (self-host total Oracle) listou **AWS SES** como única dependência paga core pra email transacional, com argumento de que self-host SMTP tem deliverability ruim por meses até reputação subir. Decisão tomada 2026-04-27.

Reavaliação 2026-05-20 do fundador: **AWS introduz complexidade desproporcional pro MVP solo**:

1. **Sandbox SES** — só envia pra emails verificados até pedir "production access"; abrir ticket + esperar 24h+ por aprovação atrasa primeiro envio real
2. **Custo opaco** — $0.10 por 1.000 emails parece barato, mas AWS bill consolidada esconde gasto real até final do mês; dificulta budget control solo
3. **IAM + SES policies** — exige criar usuário IAM separado, anexar policy `AmazonSESSendingAccess`, gerar access key + secret, rodar `Sign V4` na chamada (ou usar `@aws-sdk/client-ses` ~2MB); fricção significativa
4. **Sub-processor + DPA AWS** — DPO LogiFit ([ADR 0067](0067-dpo-governanca-compliance-lgpd.md)) precisaria adicionar AWS como sub-processor, assinar DPA, listar publicamente; um sub-processor a menos = menos superfície LGPD
5. **Zero outros usos AWS no stack** — toda infra é Oracle + Cloudflare; adicionar AWS só pra email cria conta nova em provider que não compõe nada mais

Pro volume MVP (estimativa: ~50-200 emails/dia inicial — signup OTPs + magic links + confirmações), existem alternativas com tier gratuito que cobrem 100% do uso sem custo.

## Decision

Adotar **Brevo** (ex-Sendinblue) como provider de email transacional. Substitui AWS SES em todas as referências (CLAUDE.md, ADR 0091, ADR 0067, `.env.example`, Sprint docs).

### Por que Brevo

| Critério | Brevo | AWS SES | Resend | Mailjet | MailerSend |
|---|---|---|---|---|---|
| Tier free | **300/dia (~9k/mês) forever** | $0.10/1k pago | 3k/mês | 6k/mês (cap 200/dia) | 3k/mês |
| Setup | API key + DNS records | IAM + policies + V4 signing | API key | API key | API key |
| Presença BR | **forte** (HQ Paris mas suporte PT) | global | global EN | UE | global |
| DPA gratuito | sim | sim | sim (paid plan) | sim | sim |
| SDK Node | oficial `@getbrevo/brevo` | `@aws-sdk/client-ses` ~2MB | `resend` ~30KB | `node-mailjet` | `mailersend` |
| API REST direto | sim (sem SDK) | exige V4 signing | sim | sim | sim |

Decisivo: **300/dia free forever** cobre o volume MVP inteiro sem cartão de crédito; ramp-up pro tier pago (Brevo Lite $25/mês = 20k/mês = 666/dia) só quando crescer.

### Estratégia de implementação

Package novo `@repo/email` em `packages/email/` com **provider abstrato** (regra 32 reaproveitada do padrão IA + Adquirência + Teleconsulta):

```ts
interface EmailProvider {
  sendTransactional(opts: {
    to: string
    subject: string
    htmlBody: string
    textBody?: string
    templateId?: string  // futuro: Brevo templates
    variables?: Record<string, string>
  }): Promise<{ ok: true; messageId: string } | { ok: false; error: string }>
}

class BrevoEmailProvider implements EmailProvider { ... }
class MockEmailProvider implements EmailProvider { ... }  // dev sem BREVO_API_KEY
class SmtpEmailProvider implements EmailProvider { ... }  // dev local Mailhog SMTP

function resolveEmailProvider(): EmailProvider { ... }
```

Mesma pattern do `@repo/security/captcha.ts` + `sms-otp.ts`: sem `BREVO_API_KEY` → mock dev (loga); com → Brevo real; em prod sem key → throw.

### Endpoint Brevo

API REST `https://api.brevo.com/v3/smtp/email` com header `api-key: <BREVO_API_KEY>`. Body JSON:

```json
{
  "sender": { "name": "LogiFit", "email": "no-reply@logifit.com.br" },
  "to": [{ "email": "user@example.com", "name": "Nome" }],
  "subject": "Confirme seu cadastro",
  "htmlContent": "<html>...</html>",
  "textContent": "..."
}
```

Sem SDK — `safeFetch()` direto pro endpoint canônico (mesma estratégia do Turnstile + Twilio em `@repo/security`). Hosts allowlist `['api.brevo.com']`. Lint `no-raw-fetch` exempted com `// safe-fetch-exempt:`.

### Justificativa regra 46

- **(a) Por que self-host não atende:** Postal/MailCow self-hosted exigem 3-6 meses de warmup de IP pra construir reputação SPF/DKIM/DMARC; sem isso emails caem em spam. Custo de aprender + manter SMTP server (DMARC reports + bounce handling + suppression list) desproporcional ao volume MVP.
- **(b) Lock-in concreto:** baixo — interface `EmailProvider` permite trocar Brevo→Resend→Postal em 1 arquivo (`brevo-provider.ts`). Templates podem viver no app (HTML/MJML compilado) em vez de Brevo Templates pra evitar lock-in maior.
- **(c) Custo mensal estimado:** **$0 enquanto < 300/dia** (~9k/mês). Ramp-up pro Brevo Lite $25/mês (20k/mês) só quando crescer pra >300 active members fazendo signup+login frequente.
- **(d) Plano de saída:** se Brevo virar problema (deliverability cai / preço sobe / TOS muda), trocar por (1) Resend pago ou (2) Postal self-host pós-warmup. Esforço: 1 dia (novo provider class) + DNS records (SPF/DKIM novo provider).

### O que NÃO é decisão Brevo

- **Templates de email** — vivem no app (`packages/email/templates/*.tsx` via @react-email/components ou MJML compilado) NÃO no Brevo. Preserva versionamento Git + i18n via next-intl + lock-in mínimo
- **Tracking de open/click** — desativado por default (LGPD art. 11 — dado comportamental sensível em mailing transacional). Configurar `disableTracking: true` em todas chamadas
- **Marketing emails** — fora do escopo MVP. Quando precisar (newsletter, campanhas), avaliar Brevo Marketing tier ou ferramenta separada

## Consequences

### Positivas

- **Custo $0 no MVP** — libera credit card pra Asaas + Focus NFe + Vertex AI sem AWS na mistura
- **Setup em 1 hora** — criar conta + verificar domínio + DNS records + API key; sem IAM
- **Um sub-processor a menos** — DPO LogiFit lista Brevo no lugar de AWS; Cloudflare continua multi-uso (DNS + R2 + Turnstile + Email Routing inbound se precisar receber emails depois)
- **Sem SDK pesado** — `safeFetch()` direto economiza ~2MB do bundle Node
- **DX consistente** — mesmo padrão provider-abstrato + safeFetch que Turnstile/Twilio/IA

### Negativas

- **300/dia hard limit** no tier free — exceder bloqueia envio até próximo dia (tem que monitorar; alerta proativo via `system_alerts` quando atingir 80%)
- **Brevo é europeia (HQ Paris)** — não muda nada técnico mas adiciona um cross-border data transfer no inventário LGPD (servers FR/DE; menos issue que US porque UE tem GDPR alinhado)
- **Brand "Sendinblue → Brevo" rebrand recente** — algumas docs antigas ainda usam nome antigo; URLs `app.sendinblue.com` redirecionam pra `app.brevo.com`

### Não-objetivos

- Não vamos usar Brevo Templates (mantém templates no Git)
- Não vamos usar Brevo Marketing (escopo separado)
- Não vamos usar Brevo Inbox Parsing (não temos caso de uso)
- Não vamos usar Brevo Webhooks pra delivery tracking (privacy by design; LGPD)

## Migração

Sem migração de dados — não há email histórico em AWS SES (provider nunca foi ativado em produção; sempre estava em "Sprint 26b futuro").

**Refs documentais pra atualizar:**

1. **CLAUDE.md** — bloco "Email transacional: AWS SES" → "Brevo"
2. **ADR 0091** §"Externals do MVP" — substituir "AWS SES" por "Brevo" na lista de 10 externals
3. **ADR 0067** sub-processors — remove AWS, adiciona Brevo Communications SAS (Paris/FR)
4. **`.env.example`** — bloco `AWS_SES_*` vira `BREVO_*` (API_KEY apenas + `EMAIL_FROM` mantém)
5. **Sprint 02 doc** — "Email confirmação via AWS SES" → "Email confirmação via Brevo"
6. **Roadmap** — adicionar ADR 0096 em "Decisões já fechadas (recente)"

**Refs de código pra atualizar (futuro — quando implementar `@repo/email`):**

- Criar `packages/email/` com provider abstrato
- Sprint 02b4 fechamento: integrar `enrollTotp` + `change_email` flow + recovery_codes_email
- Sprint 26b portal: `requestMagicLink` SA chama `sendTransactional` real (hoje só registra)
- Sprint 04 financeiro: notificações de fatura (vencimento + paga)
- Sprint 13 WhatsApp: paralelo via email pra clientes que não usam WhatsApp
