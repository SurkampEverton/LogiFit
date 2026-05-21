# Runbook — Setup GlitchTip (DSN + integração Next.js)

## Quando rodar

- Após Sprint 00 Faixa 3 (GlitchTip self-host já em `https://errors.logifit.com.br`)
- Antes de Sprint 01a Faixa A (primeiras Server Actions reais — capture só vale a pena com erros reais)
- Para ativar captura de exceções em dev/staging/prod

## Pré-requisitos

- Acesso ao painel `https://errors.logifit.com.br` (signup público desabilitado — fundador cria conta inicial via SSH no container ou painel admin)
- Variável `LOGIFIT_DATA_KEY` configurada (pra cifrar DSN no banco se for guardar — opcional, DSN público de qualquer forma)

## Passos

### 1. Criar organização + projeto no GlitchTip

1. Login em `https://errors.logifit.com.br`
2. Settings → Organizations → New → **`LogiFit`**
3. Projects → Create → escolher plataforma **`JavaScript / Next.js`** → name **`web`**
4. Copiar o **DSN** mostrado (formato: `https://<public-key>@errors.logifit.com.br/<project-id>`)

### 2. Setar env vars

**Dev local** (`.env.local` na raiz, gitignored):

```bash
NEXT_PUBLIC_SENTRY_DSN=https://abc123@errors.logifit.com.br/1
SENTRY_ENV=development
```

**Prod** (Coolify env vars do container `logifit-web`):

```bash
NEXT_PUBLIC_SENTRY_DSN=<DSN do projeto LogiFit/web>
SENTRY_ENV=production
SENTRY_RELEASE=<commit SHA do deploy>  # opcional, rotula evento
```

### 3. Validar captura

**Dev:** crie um endpoint temporário em `/api/test-sentry` que joga:

```ts
export async function GET() {
  throw new Error('GlitchTip smoke test — ' + new Date().toISOString())
}
```

Acesse uma vez → aparece em **Issues** do projeto no painel GlitchTip dentro de ~30s.

**Prod:** wrappers `wrapAction` / `wrapApiHandler` / `wrapJob` já chamam `captureFromBoundary` automaticamente para códigos `INTERNAL_ERROR` / `SERVICE_UNAVAILABLE` / `AI_PROVIDER_ERROR`. Qualquer Server Action que panic ou que lance `ApiException` com esses códigos vira evento Sentry com tags `tenant_id` / `request_id` / `module` / `code`.

### 4. Configurar alerta

No painel GlitchTip:
1. Projects → web → Alerts → New Alert Rule
2. **Condições:**
   - `An event is seen`
   - `level` = `error`
   - `code` = `INTERNAL_ERROR` (tag custom)
3. **Action:**
   - Email para `fundador@logifit.com.br` (ou webhook futuro para Slack/Discord)
4. Frequency: **immediately** (errors graves não esperam digest diário)

### 5. Quotas e rate limiting

GlitchTip free tier self-host não tem quota explícita — armazena tudo no Postgres dedicado do GlitchTip (`/data/coolify/services/<glitchtip-uuid>/postgres/`).

**Monitorar:**
- `docker volume ls | grep glitchtip` — tamanho dos volumes
- Painel: Stats → Events per project (gráfico 7d/30d)
- Loki query: `{service="glitchtip"} | json` (logs de ingestão)

**Quando virar problema** (volume > 5 GB):
- Retention policy: Settings → Project → Data Retention → 90 dias (default ilimitado)
- Considerar particionamento do Postgres do GlitchTip por mês (regra 34 LogiFit)

## Quando NÃO ativar

- **Dev sem DSN** — manter `NEXT_PUBLIC_SENTRY_DSN` vazia. `setCaptureHook` nunca é chamado e wrappers viram no-op (zero overhead).
- **CI/Playwright** — env separada `CI=true` + `NEXT_PUBLIC_SENTRY_DSN=` vazio. Errors em teste não devem ir pro projeto prod.

## Troubleshooting

**"Erro acontece mas não aparece no GlitchTip"**
- Verifica `NEXT_PUBLIC_SENTRY_DSN` setada e válida (`echo $NEXT_PUBLIC_SENTRY_DSN`)
- Logs do container Next.js: `docker logs logifit-web 2>&1 | grep -i sentry`
- Logs do GlitchTip Celery worker: `docker logs glitchtip-worker-<uuid> --tail 50`
- Network: o Next.js precisa alcançar `errors.logifit.com.br` (Coolify network compartilhada — geralmente OK)

**"GlitchTip cheio de eventos de validation_error"**
- Wrappers só capturam `INTERNAL_ERROR` / `SERVICE_UNAVAILABLE` / `AI_PROVIDER_ERROR` (ver `packages/errors/src/wrap-action.ts:CAPTURE_CODES`)
- Se algum erro errado tá vazando, verifique se alguém chama `Sentry.captureException` direto sem passar pelo wrapper

**"Cap de release inválido"**
- GlitchTip não suporta upload de sourcemaps (feature Sentry-only). `release` é só uma string-rótulo. Se aparecer warning de "missing release artifacts", ignorar — `withSentryConfig` no `next.config.ts` já tem `sourcemaps: { disable: true }`.

## Referências

- ADR 0091 — Self-host total Oracle SP (camada observabilidade)
- ADR 0071 — Sistema de tratamento de erros + alertas
- Regra 33 — Server Action sempre via `wrapAction()`
- `packages/errors/src/capture.ts` — hook injetável
- `apps/web/sentry.server.config.ts` — bootstrap real
