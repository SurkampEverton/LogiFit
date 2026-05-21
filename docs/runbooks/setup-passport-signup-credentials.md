# Runbook — Setup credentials passport_signup_v1 (Brevo + Twilio + Turnstile)

> Provisionamento de **3 providers externos** necessários pra ativar o fluxo de cadastro **proativo** do paciente (`/cadastro` Path B — Sprint 02b3 + ADR 0093). Após este runbook, basta habilitar `feature_flags.passport_signup_v1` pra liberar a feature em prod.

> **⚠️ MVP early-stage não precisa deste runbook agora.** O **Path A invite-link** (profissional cadastra paciente → invite via email → paciente clica → cadastro com OTP **por email**, não SMS) já funciona 100% **só com Brevo** (passo 1). Twilio (passo 2) e Turnstile (passo 3) só são necessários pra **growth feature** de signup proativo direto-ao-paciente em `/cadastro`, sem clínica intermediária. Adiar até validar demanda real.

> **Custo Twilio:** R$ 5-7/mês (número BR) + R$ 0,30-0,40 por SMS enviado. **Não é gratuito** em prod — apenas trial inicial $15 de créditos.

- **Quando usar:** ativar pela primeira vez OU substituir provider (ex: Brevo → Resend)
- **Severidade típica:** p2 (planejado; não emergência)
- **Tempo estimado:** ~60 min (Brevo 15min + Twilio 25min + Turnstile 10min + validação 10min)
- **Quem executa:** fundador / dev
- **Última revisão:** 2026-05-21

## Pré-requisitos

- [ ] N/A — MFA recente não aplicável (provisioning de provider externo é read-only no sistema LogiFit; só altera `.env.local` local)
- [ ] DNS de `logifit.com.br` no Cloudflare (provisionado em [`cloudflare-setup.md`](cloudflare-setup.md))
- [ ] Acesso ao Cloudflare Dashboard (admin)
- [ ] Cartão de crédito ativo (Twilio cobra ~R$5/mês por número BR; Brevo free tier 300/dia; Turnstile gratuito)
- [ ] `pnpm dev` rodando localmente pra validar smoke depois

---

## Passo 1 — Brevo (email transacional)

**Status atual** (verificar via `awk '/^BREVO_SMTP/ ...' .env.local`):

Se `BREVO_SMTP_HOST`, `BREVO_SMTP_USER` e `BREVO_SMTP_PASSWORD` já SET → **pular pra 1.4 (verificar domínio)**. Senão começar do 1.1.

### 1.1 Criar conta Brevo

1. https://app.brevo.com/ → Sign up
2. Confirmar email + completar onboarding (setor "Saúde", tipo "Transacionais", volume "<10k/mês")

### 1.2 Gerar SMTP key

1. Painel Brevo → ícone ⚙️ (canto superior direito) → **SMTP & API**
2. Aba **SMTP Settings** — anotar:
   - SMTP Server: `smtp-relay.brevo.com`
   - Port: `587`
   - Login: `<seu-login>@smtp-brevo.com` (formato técnico — NÃO é o email do cadastro)
3. Aba **SMTP Keys** → **Generate a new SMTP key**
   - Name: `logifit-prod`
   - Variant: **Padrão (64 chars)**
   - Expiração: 1 ano
4. **Copiar a key** `xsmtpsib-...` (mostrada apenas uma vez)

### 1.3 Adicionar no `.env.local`

```bash
BREVO_SMTP_HOST=smtp-relay.brevo.com
BREVO_SMTP_PORT=587
BREVO_SMTP_USER=ac0675001@smtp-brevo.com  # ← seu login técnico real
BREVO_SMTP_PASSWORD=xsmtpsib-cf16...     # ← key gerada
EMAIL_FROM=no-reply@logifit.com.br
EMAIL_FROM_NAME=LogiFit
```

### 1.4 Verificar domínio `logifit.com.br`

1. Brevo → **Senders, Domains & Dedicated IPs** → **Domains** → **Add a domain**
2. Domínio: `logifit.com.br`
3. Brevo gera 3 records DNS (DKIM + SPF + DMARC) — copiar
4. Cloudflare Dashboard → DNS → Adicionar os 3 records (TTL Auto, Proxy desligado)
5. Voltar ao Brevo → **Authenticate** (botão verde)
6. Aguardar ~5min pra propagar DNS + Brevo validar

**Sem domínio verificado:** emails enviam mas tomam spam fácil. Verificar é obrigatório pra prod.

### 1.5 Smoke test

```bash
node D:/LogiFit/LogiFit/scripts/test-email-smoke.mjs
```

Esperado: email aparece em `http://localhost:8025` (Mailhog) OU em prod no email destino real.

---

## Passo 2 — Twilio (SMS OTP)

### 2.1 Criar conta + obter credentials

1. https://www.twilio.com/try-twilio → Sign up (trial $15 free credit)
2. Confirmar email + número de celular pessoal (verificação)
3. Console Twilio → **Account** (canto superior direito) → **API keys & tokens**
4. Anotar:
   - **Account SID** (formato `AC...`)
   - **Auth Token** (botão "View" — copiar)

### 2.2 Comprar número BR (SMS)

1. Console → **Phone Numbers** → **Buy a number**
2. Filtro: Country = Brazil, Capabilities = SMS
3. Comprar (~R$5/mês; cobrado mensal no cartão cadastrado)
4. Anotar o número no formato E.164: `+5511...`

**Alternativa pra MVP:** usar Twilio sandbox WhatsApp (gratuito enquanto trial; bom pra dev/staging).

### 2.3 Adicionar no `.env.local`

```bash
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxx
TWILIO_FROM_NUMBER=+5511xxxxxxxxx
# OU sandbox WhatsApp:
# TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
```

### 2.4 Smoke test

```bash
node -e "
process.env.TWILIO_ACCOUNT_SID = '<SID>';
process.env.TWILIO_AUTH_TOKEN = '<TOKEN>';
process.env.TWILIO_FROM_NUMBER = '+5511xxxxxxxxx';
import('./packages/security/src/sms-otp.ts').then(({sendSmsOtp}) =>
  sendSmsOtp({phone: '+5511seunumero', code: '123456', locale: 'pt-BR'})
    .then(r => console.log(r))
);
"
```

Esperado: SMS chega no celular informado em ~5s + `{sent: true, provider: 'twilio'}`.

---

## Passo 3 — Cloudflare Turnstile (captcha)

### 3.1 Criar site Turnstile

1. Cloudflare Dashboard → **Turnstile** (sidebar esquerda)
2. **Add Site**:
   - Site name: `LogiFit Signup`
   - Domains: `logifit.com.br`, `app.logifit.com.br`, `localhost`
   - Widget mode: **Managed** (recomendado — auto-difficulty)
3. Após criar:
   - **Site Key** (público — vai pro client HTML; formato `0x4AAAAA...`)
   - **Secret Key** (privado — server-side validation)

### 3.2 Adicionar no `.env.local`

```bash
NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4AAAAA...   # ← Site Key (público)
TURNSTILE_SECRET=0x4AAAAA...                 # ← Secret Key (privado)
```

### 3.3 Smoke test

Acessar `http://localhost:3100/cadastro` → widget Turnstile renderiza no form → submit funciona (sem captcha → bloqueia 403).

---

## Passo 4 — Ativar feature flag

```sql
UPDATE feature_flags
SET enabled = true, enabled_at = now(), updated_at = now()
WHERE key = 'passport_signup_v1';
```

Helper cache TTL é 60s — pode levar até 1 minuto pra propagar entre requests.

## Passo 5 — Validar fluxo completo

1. **Acessar** `http://logifit.com.br/cadastro` (prod) OU `http://localhost:3100/cadastro` (dev)
2. **Etapa 1**: preencher nome + telefone + completar Turnstile → "Receber código"
3. **Verificar SMS** chegou no celular
4. **Etapa 2**: digitar código OTP → completar cadastro com email + CPF + senha
5. **Verificar email confirmação** chega no inbox (verificar via Mailhog em dev, ou inbox real em prod)
6. **Clicar link** do email → cai em `/cadastro/email-confirmado`
7. **Verificar DB**: `SELECT email_verified_at FROM passport_global_identities WHERE email = '<seu-email>'` → NOT NULL

## Rollback

Se algo der errado durante setup:

1. **Brevo erro**: revogar SMTP key em Brevo console; restaurar Mailhog dev (`SMTP_HOST=localhost:1025`)
2. **Twilio cobrança inesperada**: cancelar número em Phone Numbers → Active numbers; trial credit é finite
3. **Turnstile widget quebrado**: setar `NEXT_PUBLIC_TURNSTILE_SITE_KEY=` vazio (provider abstrato `captcha.ts` cai pra mock dev)
4. **Flag ligada por engano**: `UPDATE feature_flags SET enabled = false WHERE key = 'passport_signup_v1';` — bloqueia novos signups imediatamente (cache propaga em 60s)

## Monitoramento pós-execução

- [ ] Verificar `audit_log` pra signups novos nas próximas 24h
- [ ] Verificar Mailhog/Brevo Dashboard pra delivery rate ≥ 95%
- [ ] Verificar Twilio Console → Messaging → Logs pra SMS delivery
- [ ] Conferir `passport_global_identities` count cresce conforme uso
- [ ] Conferir `system_alerts` críticos nas próximas 2h
- [ ] Conferir Brevo: usage do tier free 300/dia (alerta proativo aos 240/dia = 80%)

## Em caso de falha

Contato emergência:
- **Fundador / DPO:** privacidade@logifit.com.br
- **Brevo support:** https://help.brevo.com
- **Twilio support:** https://support.twilio.com
- **Cloudflare support:** https://dash.cloudflare.com (chat enterprise)

Abrir incidente em `security_incidents` se:
- Email de signup chegando em SPAM em massa (deliverability comprometido)
- SMS OTP falhando >10% (provider down ou número bloqueado)
- Turnstile aceitando bots (config errada — verificar widget mode)

## Histórico

| Data | Quem | O quê | Resultado |
|---|---|---|---|
| 2026-05-20 | Surkamp | Setup Brevo SMTP (primeiro provider) | ok — credentials em `.env.local` |
| 2026-05-21 | Surkamp | Domínio `logifit.com.br`, Twilio, Turnstile | pendente |
