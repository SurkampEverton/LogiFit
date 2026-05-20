# ADR 0097 — Email sender por categoria (plataforma vs tenant) + branding configurável por tier

- **Status:** Accepted
- **Date:** 2026-05-20
- **Complementa:** [ADR 0096](0096-email-brevo-substitui-aws-ses.md) (provider Brevo) — este ADR define **quem é o sender** (from address) de cada email; ADR 0096 definiu apenas **qual provider envia**.

## Context

[ADR 0096](0096-email-brevo-substitui-aws-ses.md) adotou Brevo como provider de email transacional MVP, mas **não distinguiu o sender** (from address) entre emails enviados pela plataforma e emails enviados em nome do tenant. Implicitamente assumia que tudo viria de `no-reply@logifit.com.br`.

Reavaliação 2026-05-20 do fundador: **tem 2 categorias de email com naturezas distintas, e misturar quebra branding + confunde paciente + tem implicação LGPD diferente**.

### Categoria 1 — Plataforma LogiFit

Emails relacionados à **identidade global** do usuário ou à **relação SaaS** com a plataforma. LogiFit é o **controlador LGPD** (art. 5º VII):

| Caso | Sprint | Por quê é da plataforma |
|---|---|---|
| Confirmação de cadastro `/cadastro` | 02b | Identidade vive em `passport_global_identities` — **sem tenant** |
| Mudança de email da conta global | 02b5 | Identidade global |
| MFA ativado/desativado | 02b | Segurança da conta global |
| Magic link `/meu/login` | 26 | URL é `{slug}.logifit.com.br`; auth da plataforma |
| Trial expira em 3 dias | 02+ | Cobrança LogiFit pro fundador do tenant |
| LGPD request do passport global | 02b | LogiFit é controlador da identidade |
| System alerts pro DPO LogiFit | — | Operacional interno |
| Notificação de session revoked | 26 | Segurança da conta global |
| Welcome novo tenant criado | 01a | Onboarding SaaS |

### Categoria 2 — Comunicação do tenant

Emails relacionados à **relação tenant ↔ paciente** ou **operacional do tenant**. Tenant é o **controlador LGPD**, LogiFit é **operador** (processa em nome do tenant):

| Caso | Sprint | Por quê é do tenant |
|---|---|---|
| Convite de profissional pro paciente | 02 | "Dr. João te convida pra Clínica Vital" — quem convida é a clínica |
| Welcome ao se vincular ao tenant | 02 | Bem-vindo à academia, não ao LogiFit |
| Confirmação de agendamento | 03 | "Sua consulta na Clínica X foi confirmada" |
| Lembrete pré-consulta | 03+ | Mesmo motivo |
| Fatura emitida (boleto/Pix Asaas) | 04 | Quem cobra é a academia |
| Fatura vencendo / vencida / paga | 04+ | Mesmo motivo |
| Régua de cobrança escalonada | 13 | Comunicação comercial do tenant |
| Notificação de evolução/prontuário | 20+ | Comunicação clínica |
| Cross-alert lesão → adaptação treino | 27 | Notificação clínica do tenant |
| Avaliação física disponível | 12 | Operacional do tenant |
| Promoção / cashback | 05 | Comercial do tenant |

### Problema com mistura

Paciente recebe email **"no-reply@logifit.com.br — Sua consulta foi confirmada"** quando esperava **"contato@clinica-vital.com.br — Sua consulta foi confirmada"** quebra:
- **Branding** do tenant (paga LogiFit pra ter a clínica dele aparente, não LogiFit aparente)
- **Confiança** (paciente pode achar que é phishing pq não reconhece o domínio)
- **LGPD** (controlador de dado clínico é o tenant; sender deve refletir)
- **Deliverability** (recebedores associam `logifit.com.br` ao volume agregado de TODOS tenants; um tenant com bounce alto contamina reputação dos outros)

## Decision

**Modelo C híbrido por tier comercial** — alinha com tiers do [ADR 0066](0066-plano-comercial-pricing-trial.md) (revisado 2026-04-25):

| Tier | R$/mês | Email Categoria 1 | Email Categoria 2 |
|---|---|---|---|
| **Solo / Solo Combo** | 49 / 69 | LogiFit `no-reply@logifit.com.br` | **Fallback LogiFit** (from LogiFit + `Reply-To: tenant.contact_email` + `From-Name: "{tenant.name} via LogiFit"`) |
| **Starter** | 99 | LogiFit | **Fallback LogiFit** (mesma estrutura Solo) |
| **Pro** | 199 | LogiFit | **Domínio próprio opcional** (tenant configura DNS verification em `/app/settings/email`; verificado → from real; senão fallback) |
| **Business** | 449 | LogiFit | **Domínio próprio opcional** (mesma estrutura Pro; multi-company pode ter 1 domínio por company) |
| **Enterprise** | ~1.199+ | LogiFit | **White-label completo** (domínio próprio + signature HTML por locale + reply-to por unit + template customizado) |

### Categoria 1 — sempre LogiFit

Sem exceção. Razões:

1. **LogiFit é controlador LGPD** da identidade global (art. 5º VI)
2. **URL do magic link é `{slug}.logifit.com.br`** — coerência: mesma origem do envio
3. **Cobrança SaaS é entre LogiFit e fundador do tenant** — não cabe vir do tenant
4. **Trial é benefício LogiFit** — não há tenant pra enviar
5. **System alerts são internos da plataforma**

### Categoria 2 — fallback ou domínio próprio por tier

**Fallback LogiFit** (Solo/Starter):
```
From: "Clínica Vital via LogiFit" <no-reply@logifit.com.br>
Reply-To: contato@clinica-vital.com.br
Subject: [Clínica Vital] Sua consulta foi confirmada
```

**Domínio próprio** (Pro+ verificado):
```
From: "Clínica Vital" <no-reply@clinica-vital.com.br>
Reply-To: contato@clinica-vital.com.br
Subject: Sua consulta foi confirmada
```

**White-label Enterprise**:
- Mesma estrutura Pro+ domínio próprio
- + `signature_html` por locale aplicado em todos templates
- + `email_from_per_unit` (Clínica Vital - Unidade Centro pode ter `unidade-centro@clinica-vital.com.br`)
- + templates customizáveis no admin (UI Sprint 36+)

### Schema canônico

Tabela nova `tenant_email_settings` (1:1 com `tenants`):

```sql
CREATE TABLE tenant_email_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,

  -- Fallback (sempre populado em todos tiers — usado quando from_domain NULL ou unverified)
  -- Solo/Starter usam só estes campos
  contact_email text NOT NULL,         -- vai pra Reply-To em fallback mode (admin tenant lê respostas)
  display_name text NOT NULL,          -- "Clínica Vital" — usado em "X via LogiFit"

  -- Domínio próprio (Pro+ opcional)
  from_domain text,                    -- "clinica-vital.com.br" — NULL pra Solo/Starter
  from_local_part text DEFAULT 'no-reply',  -- "no-reply" → from = "no-reply@clinica-vital.com.br"
  verification_status text NOT NULL DEFAULT 'fallback'
    CHECK (verification_status IN ('fallback', 'pending', 'verified', 'failed', 'expired')),
  spf_record text,                     -- "v=spf1 include:spf.brevo.com ~all"
  dkim_selector text,                  -- "mail._domainkey"
  dkim_record text,                    -- TXT body pro DNS
  dmarc_record text,                   -- "v=DMARC1; p=quarantine; rua=mailto:..."
  verification_requested_at timestamptz,
  verified_at timestamptz,
  last_check_at timestamptz,           -- cron daily atualiza
  failure_reason text,

  -- Enterprise white-label
  signature_html jsonb,                -- {"pt-BR": "<p>...</p>", "en-US": "..."}
  per_unit_overrides jsonb,            -- {unit_id: {from_local_part: "unidade-centro", ...}}

  -- Audit
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

RLS tenant-scoped + super_admin override pra suporte. Particionamento N/A (1 row por tenant; volume baixo).

### Fluxo de verificação DNS (Pro+)

1. **Admin tenant** vai em `/app/settings/email` (UI gate `tier in ['pro','business','enterprise']`)
2. **Form** com 2 campos: `from_domain` + `from_local_part` (default `no-reply`)
3. **Server Action** `requestEmailDomainVerification`:
   - POST `https://api.brevo.com/v3/senders/domains` com payload `{name: "clinica-vital.com.br"}`
   - Brevo retorna `{dkim_record, spf_record, dmarc_record}` pendentes verificação
   - Persist em `tenant_email_settings` com `verification_status='pending'`
   - Audit `audit_log` entry
4. **UI mostra** os 3 records (SPF + DKIM + DMARC) pro admin tenant copiar no DNS dele
5. **Server Action** `checkEmailDomainVerification` (botão "verificar agora"):
   - GET `https://api.brevo.com/v3/senders/domains/{domain}`
   - Brevo retorna `{authenticated: true|false, dns_records_valid: bool}`
   - Atualiza `verification_status='verified'` ou `failed` ou continua `pending`
6. **Cron daily** `verify-email-domains` itera `verification_status='pending'` + revalida `verified` (DNS pode mudar — admin alterou inadvertidamente)
7. **Quando `verified`**, envios usam `from_domain` real; senão **fallback LogiFit**

Fallback mode é **default sempre** — nunca falha de envio por falta de verificação.

### Provider abstrato impact

[ADR 0096](0096-email-brevo-substitui-aws-ses.md) definiu interface `EmailProvider.sendTransactional(opts)`. Este ADR adiciona parâmetro `category`:

```ts
interface SendTransactionalInput {
  to: string
  subject: string
  htmlBody: string
  textBody?: string
  category: 'platform' | 'tenant'  // ← novo
  tenantId?: string  // obrigatório quando category='tenant'
}

interface EmailProvider {
  sendTransactional(opts: SendTransactionalInput): Promise<...>
}
```

Helper interno `resolveEmailSender(category, tenantId?)` antes da chamada Brevo:

```ts
function resolveEmailSender(input: SendTransactionalInput): BrevoSender {
  if (input.category === 'platform') {
    return {
      from_email: 'no-reply@logifit.com.br',
      from_name: 'LogiFit',
    }
  }
  // category === 'tenant'
  const settings = await getTenantEmailSettings(input.tenantId)
  if (settings.verification_status === 'verified' && settings.from_domain) {
    return {
      from_email: `${settings.from_local_part}@${settings.from_domain}`,
      from_name: settings.display_name,
      reply_to: settings.contact_email,
    }
  }
  // fallback
  return {
    from_email: 'no-reply@logifit.com.br',
    from_name: `${settings.display_name} via LogiFit`,
    reply_to: settings.contact_email,
  }
}
```

### Por que modelo C híbrido (e não A "tudo LogiFit" ou B "tudo tenant")

| Modelo | Pro | Contra | Decisão |
|---|---|---|---|
| **A — Tudo LogiFit** | Simples | Quebra branding tenant; LGPD ambígua | REJEITADO |
| **B — Tudo tenant** | Branding correto sempre | Forces DNS verification em Solo R$49 (fricção alta pra autônomo); LogiFit perde controle de comunicação SaaS (trial/cobrança) | REJEITADO |
| **C — Híbrido por categoria + tier** | Branding correto onde importa; LGPD clara; setup proporcional ao tier | +1 schema + cron + UI; complexidade de fallback | **ACEITO** |

### Tier libera domínio próprio em Pro (R$199), não Starter (R$99)

Motivos:

1. **Starter é autônomo PJ/MEI** que ainda não tem domínio próprio profissional (~70% usam Gmail/Hotmail) — forçar domínio aumenta atrito de onboarding
2. **Pro é primeira tier "estabelecida"** (10 profs, 500 members) — já tem identidade jurídica + site + domínio próprio quase sempre
3. **Diferenciador comercial claro** — branding profissional vira motivo de upgrade Starter→Pro
4. **Custo Brevo:** tier free 300/dia tem limite de 1 domínio principal verificado; multi-domínio exige Brevo Lite ($25/mês) ou Multi-Account. Forçar isso só em Pro+ alinha custo com receita

## Consequences

### Positivas

- **Branding correto onde importa** — comunicação clínica/comercial sai do domínio do tenant (Pro+)
- **LGPD clara** — Categoria 1 LogiFit é controlador; Categoria 2 tenant é controlador (sender reflete)
- **Sem fricção pra Solo/Starter** — fallback automático com `Reply-To` correto preserva canal de resposta
- **Diferenciador comercial Pro+** — motivo concreto pra upgrade ("seu domínio profissional nos emails")
- **Deliverability isolada** — bounce de um tenant Pro+ afeta só o domínio dele, não contamina `logifit.com.br`
- **White-label Enterprise** vira feature real (signature + per-unit + templates customizados)

### Negativas

- **+1 schema** (`tenant_email_settings`) + RLS + 6 indexes/checks
- **+1 cron daily** (`verify-email-domains`)
- **+1 UI** (`/app/settings/email` — gate por tier)
- **+3 Server Actions** (`requestEmailDomainVerification` / `checkEmailDomainVerification` / `updateTenantEmailSettings`)
- **Brevo Multi-Account ou Lite tier** ($25/mês) provavelmente necessário antes do 1º tenant Pro com domínio próprio — sai do "$0 MVP" do ADR 0096 nesse momento
- **Onboarding tenant Pro+ tem step DNS** — fundador precisa documentar ("como adicionar SPF/DKIM no Registro.br / Cloudflare / GoDaddy")
- **Risco de DNS revertido** — admin tenant remove records sem querer; cron pega + cai pra fallback (mitigado)

### Não-objetivos

- **Marketing emails** — fora do escopo (avaliar Brevo Marketing tier ou ferramenta separada quando MVP fechar)
- **Templates customizados por tenant** (Solo/Starter usam templates LogiFit padrão; Enterprise tem template editor — fica pra Sprint 36+ post-MVP white-label)
- **SMS sender personalizado** — Twilio BR não permite alpha sender; mantém número Twilio (Sprint 13)
- **WhatsApp sender personalizado** — Meta BSP já força número do tenant (Sprint 13)
- **Multi-tenant Brevo sub-accounts** — começar com 1 conta Brevo + multi-domain (Lite tier suporta); avaliar sub-accounts só se >50 tenants com domínio próprio

## Migração / cronograma

- **Sprint dedicado** ainda não alocado — provável `Sprint 02b5` ou `Sprint 04+` (entra junto com Asaas faturas que é o 1º uso massivo de Categoria 2)
- **Sem migração de dados** — schema novo nasce empty; `getTenantEmailSettings` retorna stub com `verification_status='fallback'` quando row não existe
- **Backfill stub** — quando schema for criado, INSERT para cada tenant existente com `contact_email = tenants.owner_email` + `display_name = tenants.name` + `verification_status='fallback'`

## Refs documentais

**Atualizar quando este ADR for implementado:**

1. **ADR 0096** — adicionar cross-link: "sender por categoria definido em ADR 0097"
2. **ADR 0066** (plano comercial) — adicionar linha "Email domínio próprio" na tabela de tiers (Pro+ sim, Solo/Starter fallback)
3. **ADR 0067** (DPO) — sub-processors: Brevo continua único provider; sender muda mas processador é o mesmo
4. **Sprint que implementar** — schema + UI + Server Actions + cron
5. **CLAUDE.md** — adicionar nota no bloco Stack mencionando ADR 0097 quando schema existir
6. **docs/comercial.md** — adicionar "Emails do seu domínio" como benefício Pro+

## Referências

- [ADR 0066 — Plano comercial / pricing / trial](0066-plano-comercial-pricing-trial.md) — tiers de referência
- [ADR 0067 — DPO + Governança Compliance LGPD](0067-dpo-governanca-compliance-lgpd.md) — controlador vs operador
- [ADR 0091 — Self-host total Oracle SP](0091-self-host-total-oracle-sp.md) — externals MVP
- [ADR 0096 — Brevo substitui AWS SES](0096-email-brevo-substitui-aws-ses.md) — provider escolhido
- Brevo API senders/domains: <https://developers.brevo.com/reference/post_senders-domains>
- LGPD art. 5º VI (controlador) + VII (operador)
