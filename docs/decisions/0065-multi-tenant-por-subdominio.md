# ADR 0065 — Multi-tenant por subdomínio

- **Status:** Accepted
- **Date:** 2026-04-24

## Context

LogiFit é multi-tenant por arquitetura. Middleware Next.js precisa identificar o tenant antes de qualquer outra coisa — RLS depende de `tenant_id` no JWT claim; todas as rotas `/app/*` e `/meu/*` são tenant-scoped.

Duas estratégias possíveis:

1. **Subdomínio:** `vital.logifit.com.br` — extrai `vital` do Host
2. **Path:** `logifit.com.br/t/vital/app/dashboard` — extrai `vital` do pathname

A auditoria pré-Sprint 00 (2026-04-23) recomendou subdomínio. Este ADR formaliza a estratégia + detalha middleware + DNS + deployment + dev local.

## Decision

**Subdomínio por tenant.** Pattern: `{tenant-slug}.logifit.com.br`. Vercel + Registro.br suportam nativamente com wildcard.

### Extração do tenant

Middleware Next.js (`apps/web/middleware.ts`) executa em toda request:

```ts
// pseudocódigo
const host = req.headers.get('host')!  // ex: 'vital.logifit.com.br:443'
const hostname = host.split(':')[0]     // 'vital.logifit.com.br'
const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN // 'logifit.com.br'

if (hostname === rootDomain || hostname === `www.${rootDomain}`) {
  // landing page institucional (marketing site) — sem tenant
  return NextResponse.next()
}

if (RESERVED_SUBDOMAINS.includes(subdomain)) {
  // 'app', 'api', 'admin', 'status', 'docs' etc. — não são tenants
  return handleReserved(subdomain, req)
}

const tenantSlug = hostname.replace(`.${rootDomain}`, '')
const tenant = await lookupTenantBySlug(tenantSlug)  // cache por 60s

if (!tenant) {
  return NextResponse.redirect(new URL('/tenant-not-found', `https://${rootDomain}`))
}

// Injeta tenant_id no header pra Server Components / Server Actions lerem
const response = NextResponse.next()
response.headers.set('x-tenant-id', tenant.id)
response.headers.set('x-tenant-slug', tenant.slug)
return response
```

### Slug — regras

- **Formato:** `[a-z0-9][a-z0-9-]{1,28}[a-z0-9]` (3-30 chars, lowercase, letras+números+hífens, não começa/termina com hífen)
- **Unicidade:** global (`tenants.slug` UNIQUE NOT NULL)
- **Reservados:** `www`, `app`, `api`, `admin`, `root`, `status`, `docs`, `blog`, `landing`, `marketing`, `help`, `support`, `cdn`, `static`, `assets`, `mail`, `smtp`, `ftp`, `ns`, `ns1`, `ns2`, `localhost`, `dev`, `staging`, `prod`, `production`, `test`, `testing`, `logifit`, `vercel`
- **Ofensivos / marcas registradas:** blacklist básica (não é escopo técnico; curadoria manual ao criar)
- **Validação:** Sprint 01a (`/signup`) bloqueia slug inválido com mensagem clara
- **Não case-sensitive:** `Vital` vira `vital` automaticamente

### Mudança de slug (rename)

- Tenant pode renomear slug em `/app/settings/tenant/rename` (role `super_admin_rede`)
- Slug antigo fica em `tenant_slug_history(tenant_id, old_slug, changed_at)`
- Middleware: se hostname bate com slug antigo → redirect 301 para novo slug por 90 dias; depois retorna 410 Gone
- Rate limit: 1 rename por 30 dias (evita churn acidental)

### Cookies + JWT

- **Cookie escopo:** `.logifit.com.br` (com ponto inicial — compartilha entre subdomínios para troca de tenant)
- **JWT claim `tenant_id`**: setado via Supabase Auth Hook (custom claims) após login + seleção de tenant
- **Cross-tenant request prevention:** middleware valida que `jwt.tenant_id === tenant.id` (bloqueia se user tem sessão de outro tenant e tentou acessar pelo subdomínio)
- **Session switch:** rota `/select-tenant` permite user com múltiplos tenants escolher → reassina JWT → redirect para `{new-slug}.logifit.com.br/app`

### DNS + SSL

```
# Registro.br (ou outro registrar) → apontar para Vercel

A      @         76.76.21.21
CNAME  *         cname.vercel-dns.com.
CNAME  www       cname.vercel-dns.com.
```

**Vercel:**
- Add domain `logifit.com.br`
- Add domain `*.logifit.com.br` (wildcard)
- Vercel emite SSL Let's Encrypt automático incluindo wildcard

### Desenvolvimento local

Dois padrões suportados:

**Opção A — `{slug}.localhost:3000` (recomendada):**
- Navegador moderno aceita `*.localhost` apontando para `127.0.0.1`
- `NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000` em `.env.local`
- Acessa `http://vital.localhost:3000/app`

**Opção B — Path fallback em dev:**
- Se hostname não tem subdomínio (ex: direto `localhost:3000`), cai em `/dev/{slug}/app/...`
- Útil quando navegador tem problema com `*.localhost`

### Reserved routes (não-tenant)

Subdomínios reservados ou apex domain → rotas específicas:

| Host | Propósito | Implementação |
|---|---|---|
| `logifit.com.br` | Landing marketing | rota `/` com conteúdo de vendas |
| `www.logifit.com.br` | Landing (redirect 301 para apex) | middleware |
| `app.logifit.com.br` | Portal de onboarding / seleção de tenant | rota `/select-tenant` |
| `api.logifit.com.br` | API pública (Fase 2 — integração externa) | futuro |
| `status.logifit.com.br` | Status page (uptime + incidentes) | futuro |
| `docs.logifit.com.br` | Docs públicas (help, guias) | futuro |

### Landing vs app no MVP

- **MVP Sprint 00:** `logifit.com.br` e `www.logifit.com.br` servem landing estática simples com "entrar" → redireciona para `app.logifit.com.br/select-tenant`
- **Pós-MVP:** landing ganha conteúdo de marketing, preços, docs; vira site separado (Next.js) em repo diferente ou branch

### Schema

`tenants` (Sprint 01a) ganha:

```sql
tenants
  id uuid pk
  slug text unique not null     -- ADR 0065
  name text not null             -- display name
  created_at
  ...

tenant_slug_history
  id uuid pk
  tenant_id uuid fk
  old_slug text
  changed_at timestamptz default now()
  -- index: (old_slug) para middleware redirect
```

## Consequences

### Positivas

- **Isolamento visual forte** — tenant sente que está em app próprio (`vital.logifit.com.br`)
- **Cookies isolados** — sessão de um tenant não interfere no outro
- **SEO futuro** — se algum tenant quiser página pública (marketing interno), subdomínio ranqueia separado
- **White-label extensível** — tenant enterprise futuro pode apontar `vital.clubevital.com.br` via CNAME → infraestrutura já pronta
- **Lookup rápido** — cache em Redis/memory por 60s; overhead <5ms
- **Padrão de mercado** — Slack, Linear, Notion, Vercel usam subdomínio

### Negativas (mitigáveis)

- **DNS wildcard exige provider compatível** — Registro.br e Vercel suportam, OK
- **Desenvolvimento local precisa `*.localhost`** — 99% dos navegadores modernos aceitam; Firefox antigo não (pouco relevante)
- **Share de link com slug antigo** (após rename) — redirect 301 por 90 dias mitiga
- **Latência de DNS lookup em 1º acesso** — ~50ms mundial, irrelevante
- **SSL wildcard emissão inicial** — Let's Encrypt via Vercel: 1-5 min provisioning; cache longo (60 dias renewal automático)

### Riscos não endereçados

- **Phishing com slug similar** (ex: `vita1.logifit.com.br` vs `vital.logifit.com.br`) — mitigado por blacklist de slugs ofensivos + review manual nos primeiros cadastros; futuro: validador de Levenshtein distance contra slugs existentes
- **Tenant abandonado com slug bom** — política de churn: slug volta a ser disponível 90 dias após tenant cancelado + dados anonimizados (LGPD ADR 0054)

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Path (`logifit.com.br/t/vital/...`) | Isolamento visual fraco; cookies compartilhados entre tenants; SEO ruim; parece SaaS genérico; padrão antigo |
| Domínio customizado por tenant (`vital.com.br`) no MVP | Onboarding complexo (tenant precisa configurar DNS); SSL por domínio; fora do escopo MVP. Vira Fase 2 white-label. |
| Header `X-Tenant-ID` sem subdomínio | Dependia de cliente sempre enviar; não funciona em navegação humana |
| Detecção por IP (pools por tenant) | Absurdo pra multi-tenant SaaS |

## Escopo de impacto

**Novo ADR:** este (0065).

**Sprints ajustados:**

- **Sprint 00** — middleware com extração de slug; variável `NEXT_PUBLIC_ROOT_DOMAIN`; dev local com `*.localhost` documentado no README
- **Sprint 01a** — `tenants.slug` + validator Zod + reserved slugs + `/signup` escolhe slug; `tenant_slug_history` + `/app/settings/tenant/rename`; rota `/select-tenant` no apex `app.logifit.com.br`; lookup cache Redis/memory

**Docs:**

- `docs/modulos.md` — módulo "Multi-tenant por subdomínio" em Fundação
- `docs/arquitetura.md` — seção de multi-tenant atualizada
- `CLAUDE.md` — nota sobre padrão de hostname
- `.env.example` — `NEXT_PUBLIC_ROOT_DOMAIN`

## Related

- Reforça [ADR 0006 — Hierarquia group→tenant→company→unit](0006-hierarquia-group-tenant-company-unit.md)
- Reforça [ADR 0002 — RLS como isolamento primário](0002-rls-como-isolamento-primario.md) — middleware garante `tenant_id` no JWT antes da query
- Integra com [ADR 0064 — Arquitetura IA](0064-ia-arquitetura-gemini-default-byok-rag.md) — `resolveModelForTask` consulta tenant do middleware header
- Fontes: docs Vercel multi-tenant, Next.js middleware, padrões Slack/Linear/Notion
