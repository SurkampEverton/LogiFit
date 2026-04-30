# Runbook — Cloudflare setup (DNS + R2 + Turnstile + Email Routing + API token)

- **Status:** Esqueleto (Sprint 00 Faixa 3)
- **Quando consultar:** primeira vez (criação inicial) ou re-setup após perda de credencial
- **Pré-requisitos:** Conta Cloudflare ativa, domain `logifit.com.br` adicionado, nameservers do registro.br apontando para os do Cloudflare

## Por que Cloudflare faz 4 papéis

ADR 0091 + revisão 2026-04-27 promovem Cloudflare a multi-uso para reduzir externals MVP de 9 → 8 categorias. Os 4 papéis (todos no plano Free):

| Papel | Substitui | Uso no MVP |
|---|---|---|
| **DNS + Proxy** | DNS do registro.br | A records `app/coolify/monitor/errors.logifit.com.br` proxied (laranja) — esconde IP do VPS Oracle |
| **R2** | Hetzner Storage Box | Backup off-site cifrado GPG via rclone S3 API (regra 40) |
| **Turnstile** | reCAPTCHA / hCaptcha | Captcha login + signup (Sprint 01a, regra 36 — lockout 5 falhas) |
| **Email Routing** | Cadastro SMTP próprio | `security@`/`privacidade@`/`contato@logifit.com.br` → email pessoal do fundador |

## 1. DNS + Proxy (15min — destrava primeiro deploy)

### Apontar nameservers (uma vez só)

1. No registro.br, edita NS de `logifit.com.br` para os 2 que o Cloudflare mostrou ao adicionar o domain (ex: `bart.ns.cloudflare.com` + `nina.ns.cloudflare.com`).
2. Aguardar propagação (5min-24h). Validar: `dig NS logifit.com.br +short` mostra os Cloudflare.

### A records (após VPS Oracle existir)

No painel Cloudflare → DNS:

| Type | Name | Content | Proxy |
|---|---|---|---|
| A | `app` | `<IP do VPS Oracle Vinhedo>` | ✅ Proxied |
| A | `coolify` | `<IP>` | ✅ Proxied |
| A | `monitor` | `<IP>` | ✅ Proxied |
| A | `errors` | `<IP>` | ✅ Proxied |
| TXT | `_acme-challenge.logifit.com.br` | (autogerado pelo Caddy DNS-01) | DNS only |

**TTL** = `Auto` (300s real). Preserva DR rápido se IP mudar.

### SSL/TLS

- Mode: **Full (strict)** — Cloudflare ↔ VPS é HTTPS validado (Caddy autorrenova com Let's Encrypt)
- Always Use HTTPS: **ON**
- HSTS: ativar com `max-age 6mo` + `includeSubDomains` + `preload`
- Min TLS Version: 1.2

## 2. R2 bucket (15min — destrava backup off-site)

### Criar bucket

1. Cloudflare Dashboard → **R2** → **Create bucket**
2. Nome: `logifit-backup`
3. Location: `Eastern North America` (ENAM) ou `Western Europe` (WEUR) — não muda muito (zero egress global). MVP recomendado: ENAM (mais barato fora do free tier).
4. Default storage class: **Standard**

### Criar API token (escopo bucket-only)

1. R2 → **Manage R2 API Tokens** → **Create API Token**
2. Permissions: **Object Read & Write**
3. Specify bucket: **`logifit-backup` only** (não a conta inteira)
4. TTL: deixar em branco (sem expiração) ou definir 1 ano com renovação no calendário
5. Copia:
   - `Access Key ID` → env `R2_ACCESS_KEY_ID`
   - `Secret Access Key` → env `R2_SECRET_ACCESS_KEY` (mostrado **uma única vez**, salvar em GitHub Secret + cópia offline)
   - `Account ID` (visível no canto direito do dashboard) → env `R2_ACCOUNT_ID`

### Variáveis de ambiente

Em `.env.local` (dev) e Coolify env vars (prod):

```env
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=logifit-backup
R2_ENDPOINT=https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com
```

### Rotação trimestral

Manter calendário lembrando rotação a cada 90d (criar novo token, atualizar GitHub Secret + Coolify env, validar `pnpm restore-test`, deletar token antigo).

## 3. Turnstile (10min — destrava Sprint 01a login captcha)

### Criar site

1. Cloudflare → **Turnstile** → **Add Site**
2. Site name: `LogiFit MVP`
3. Domain: `logifit.com.br` (cobre subdomínios `app.`, `coolify.`, etc.)
4. Widget Mode: **Managed** (default — Cloudflare decide quando mostrar challenge)
5. Pre-clearance: **No** (MVP)

### Variáveis

```env
NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x...
TURNSTILE_SECRET=0x...  # GitHub Secret + Coolify env
```

`NEXT_PUBLIC_*` é exposto ao browser por design (regra do Next.js); secret server-only.

## 4. Email Routing (10min)

### Habilitar para o domain

1. Cloudflare → **Email** → **Email Routing** → **Get Started**
2. Adicionar destination address: seu email pessoal (Gmail, etc.) — clique no link de verificação que chegar.

### Custom rules

| Custom address | Action | Destination |
|---|---|---|
| `security@logifit.com.br` | Send to address | seu-email@gmail.com |
| `privacidade@logifit.com.br` | Send to address | seu-email@gmail.com |
| `contato@logifit.com.br` | Send to address | seu-email@gmail.com |
| `dpo@logifit.com.br` | Send to address | seu-email@gmail.com |

### Catch-all

Recommended: **Drop** (rejeita emails para endereços não listados — reduz spam). Se quiser receber tudo: **Send to address** → email pessoal.

## 5. API Token global (Caddy DNS-01) (5min)

Necessário pro Caddy renovar SSL Let's Encrypt via DNS-01 challenge (alternativa ao HTTP-01 quando subdomínio é proxied pelo Cloudflare).

1. Cloudflare → **My Profile** → **API Tokens** → **Create Token**
2. Use template: **Edit zone DNS**
3. Permissions: `Zone — DNS — Edit` (only)
4. Zone Resources: `Include — Specific zone — logifit.com.br`
5. TTL: 1 ano (calendário rotação)
6. Copia o token → env `CLOUDFLARE_API_TOKEN` (Coolify env, **não** committar; **não** expor `NEXT_PUBLIC_`).

Coolify Caddy lê via env var quando configurado pra DNS-01.

## Validação final

Após VPS Oracle bootstrap + Caddy SSL configurado:

- [ ] `dig +short app.logifit.com.br` retorna IP do Cloudflare (proxied; não o IP direto do Oracle)
- [ ] `curl -I https://app.logifit.com.br` retorna 200 + headers `cf-ray:` + `Strict-Transport-Security:` + outros 6 security headers (regra 35)
- [ ] [SSL Labs](https://www.ssllabs.com/ssltest/) report A+ pra `app.logifit.com.br`
- [ ] [security.txt](https://logifit.com.br/.well-known/security.txt) acessível
- [ ] Página `/seguranca` renderiza
- [ ] Email para `security@logifit.com.br` chega no email pessoal
- [ ] `aws s3 ls --endpoint-url $R2_ENDPOINT s3://logifit-backup/` (com creds R2) lista bucket vazio
- [ ] Turnstile widget aparece no `/login` (após Sprint 01a)

## Em caso de incidente

- Token vazado: Cloudflare → **API Tokens** → revogar imediato + criar novo + atualizar todos os consumidores.
- DNS comprometido: Cloudflare força 2FA na conta + audit log mostra mudanças. Recuperação imediata via dashboard.
- R2 bucket comprometido: token tem escopo bucket-only — outros buckets seguros. Rotação + restore via último backup local (se houver) ou pen drive físico.
