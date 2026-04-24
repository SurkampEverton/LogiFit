# ADR 0071 — Sistema de tratamento de erros + Alertas em tempo real

- **Status:** Accepted
- **Date:** 2026-04-24

## Context

Análise do modelo de controle de erros do projeto **Deep Control** (memo interno compartilhado 2026-04-24) trouxe padrões maduros:

- **Envelope unificado** `{code, message, details, request_id}` com 7 códigos fechados
- **Fingerprint** `SHA256(type|module|path|status)[:8]` para deduplicação (1000 erros = 1 alert com `occurrence_count`)
- **Middleware chain** (requestid → logging → recovery → error_alerting) correlacionada
- **Async detached context** — alert não atrasa resposta
- **Visibilidade por tier** + auto-resolve por TTL
- **Error translator fiscal** para 90+ códigos SEFAZ

Pontos cegos reconhecidos no Deep Control (explicitados pelo usuário):
1. **Sem push/email/sino ativo** — admin precisa entrar no dashboard
2. **Visibilidade só por tier, não por role**
3. **Sem integração com Sentry/APM externo** — tudo em Postgres

Estado atual LogiFit:
- Sentry + PostHog + Logtail planejados (ADR 0001) mas **sem integração estruturada com tratamento de erros**
- `audit_log` append-only (regra 5) para audit de ações, não erros
- `security_incidents` + plano resposta 72h (ADR 0067) — para incidentes P0/P1 graves
- **Gap:** sem sistema estruturado de erros HTTP/runtime, sem envelope unificado, sem notificações em tempo real

Decisões do usuário (2026-04-24):

1. Schema `system_alerts` com **tenant_id + role-based visibility** (em vez de tier — LogiFit é role-centric com RLS)
2. **4 canais de notificação no MVP**: badge SideMenu + toast real-time + email critical + WhatsApp urgent
3. **Regra 33** — Server Action/API Route sem `wrapAction` falha CI
4. **Auto-integração com `security_incidents`** quando `severity=critical` + `category IN (security, data_leak, compliance)`
5. **Sentry como complementar** (dev team LogiFit) — não substitui `system_alerts` (admin do tenant precisa ver erros do próprio tenant)
6. **Retenção variável** por severity: 30/90/365/1825 dias
7. **Translators por domínio** (Asaas, Focus NFe, Anthropic, Gemini, Groq, Twilio, TISS, Pluggy, Zod, Supabase) — 10 translators iniciais

## Decision

### 1. Envelope unificado

```ts
// packages/types/api-error.ts

export type ApiError = {
  error: {
    code: ErrorCode           // enum fechado (16 códigos)
    message: string           // i18n resolvido via context de idioma
    details?: Record<string, unknown>  // SANITIZADO LGPD
    request_id: string        // UUID — correlação frontend↔backend↔alert
    runbook?: string          // URL "como resolver este erro"
    retry_after_ms?: number   // quando transient
  }
}

export type ErrorCode =
  | 'VALIDATION_ERROR'        // 400 — Zod falhou
  | 'UNAUTHORIZED'            // 401 — JWT expirado/ausente
  | 'FORBIDDEN'               // 403 — sem permission
  | 'NOT_FOUND'               // 404
  | 'CONFLICT'                // 409 — duplicata, race condition
  | 'RATE_LIMITED'            // 429 — Upstash rate limit
  | 'INTERNAL_ERROR'          // 500 — panic/unhandled
  | 'SERVICE_UNAVAILABLE'     // 503 — provider down
  | 'AI_QUOTA_EXCEEDED'       // quota mensal do plano (ADR 0064)
  | 'AI_PROVIDER_ERROR'       // Gemini/OpenAI/Anthropic/Groq erro
  | 'PAYMENT_FAILED'          // Asaas rejeitou (cartão, PIX, boleto)
  | 'FISCAL_REJECTED'         // Focus NFe/SEFAZ rejeitou
  | 'CONSENT_REQUIRED'        // falta consent cross-module (regra 6)
  | 'COMMITTEE_REQUIRED'      // feature IA classe II+ sem Comitê (regra 28)
  | 'SLUG_TAKEN'              // subdomínio duplicado (ADR 0065)
  | 'TENANT_SUSPENDED'        // read-only por inadimplência (ADR 0066)
```

### 2. Schema `system_alerts` + `system_alert_occurrences`

```sql
system_alerts
  id uuid pk
  tenant_id uuid nullable           -- null = LogiFit platform; set = tenant-specific
  fingerprint text not null          -- SHA256(type|module|path|status|tenant_id)[:16]
  alert_type enum (
    'http_error','panic','domain_error','compliance',
    'integration_failure','job_failure','user_report',
    'fiscal_rejection','ai_failure','payment_failure',
    'security_event','manual'
  )
  source_module text                 -- 'financeiro','fiscal','ia','agenda','fisio','nutri','academia'
  source_function text               -- path exato (Server Action ou API Route)
  severity enum ('info','warning','error','critical')
  priority enum ('low','medium','high','urgent')
  category text                      -- 'integration','validation','runtime','compliance','billing','security','performance'
  tags text[]                        -- ex: ['asaas','webhook','retry-exhausted']
  title text                         -- título curto
  message text                       -- i18n resolvido
  stacktrace text nullable
  suggested_action text nullable
  runbook_url text nullable
  http_method text nullable
  http_path text nullable
  http_status int nullable
  request_id uuid nullable
  user_id uuid nullable              -- quem disparou (null = sistema/job)
  member_id uuid nullable            -- paciente envolvido (LGPD link — busca no portal do titular)
  payload jsonb nullable             -- SANITIZADO (sem PII)
  status enum ('unread','acknowledged','resolved','dismissed','expired') default 'unread'
  occurrence_count int default 1
  first_occurrence_at timestamptz default now()
  last_occurrence_at timestamptz default now()
  acknowledged_by uuid nullable
  acknowledged_at timestamptz nullable
  resolved_by uuid nullable
  resolved_at timestamptz nullable
  resolved_note text nullable
  auto_resolve_after timestamptz nullable
  min_role text default 'gerente_filial'  -- RBAC: mínimo para ver
  notified_at timestamptz nullable
  notification_channels text[]       -- ['in_app','email','push','whatsapp','sentry']
  related_security_incident_id uuid nullable fk security_incidents  -- ADR 0067 link
  retention_days int default 90      -- override default via severity
  created_at timestamptz default now()
  
  -- Indexes
  index (tenant_id, status, severity) where status != 'resolved'
  index (fingerprint) where status != 'resolved'
  index (request_id)
  index (member_id) where member_id is not null  -- LGPD queries

system_alert_occurrences
  -- Ring buffer das últimas N=20 ocorrências (timeline no UI)
  id uuid pk
  alert_id uuid fk
  occurred_at timestamptz default now()
  request_id uuid nullable
  user_id uuid nullable
  payload_sanitized jsonb nullable
  -- Particionar por mês; retenção 90 dias
  index (alert_id, occurred_at DESC)
```

**RLS:**
- `tenant_id` = JWT claim (padrão)
- `min_role` respeitado via `has_permission(user, 'admin.alerts.read')`
- LogiFit super_admin (`tenant_id IS NULL` em `user_roles`) vê cross-tenant (debug de plataforma)

### 3. Fingerprint com tenant_id

```ts
function calculateFingerprint(input: {
  alertType: string
  sourceModule: string
  httpPath?: string
  httpStatus?: number
  tenantId?: string   // MULTI-TENANT: erros em tenants diferentes não agregam
}): string {
  return sha256(
    [
      input.alertType,
      input.sourceModule,
      input.httpPath,
      input.httpStatus,
      input.tenantId ?? 'platform',
    ].filter(Boolean).join('|')
  ).slice(0, 16)
}
```

TTL de fingerprint: **24h**. Após 24h sem nova ocorrência, próxima cria alert novo (sinal de "voltou a acontecer").

### 4. Middleware chain + wrappers

```ts
// apps/web/middleware.ts
export function middleware(req: NextRequest) {
  const requestId = crypto.randomUUID()
  const response = NextResponse.next()
  response.headers.set('x-request-id', requestId)
  // Logger estruturado (Logtail) inicia span
  return response
}

// packages/errors/wrap-action.ts
export function wrapAction<Input, Output>(
  handler: (input: Input, ctx: Ctx) => Promise<Output>,
  opts: {
    module: string                    // 'financeiro','fiscal','ia',...
    action: string                    // 'createInvoice','emitNfse',...
    permissionsRequired?: string[]
    rateLimitKey?: (input: Input, ctx: Ctx) => string
    requireAiCommittee?: boolean      // ADR 0053
    auditAction?: 'read' | 'write' | 'sensitive'
  }
) {
  return async (input: Input): Promise<{ ok: true; data: Output } | { ok: false; error: ApiError }> => {
    const ctx = await getContext()  // request_id, user, tenant, locale
    const startTime = Date.now()

    try {
      await validateContext(ctx, opts)  // auth + permissions + rate limit + AI committee gate

      const data = await handler(input, ctx)

      if (opts.auditAction) {
        await auditLog(ctx, opts, { input, result: 'success' }).catch(noop)
      }

      observabilityMetric('action.success', { ...opts, duration_ms: Date.now() - startTime })
      return { ok: true, data }
    } catch (err) {
      const apiError = translateError(err, ctx, opts)

      // Fire-and-forget (não atrasa response)
      reportAlert(apiError, ctx, opts, err).catch(noop)

      if (apiError.error.code === 'INTERNAL_ERROR') {
        // Sentry captura stack para LogiFit dev team (complementar)
        Sentry.captureException(err, {
          tags: { ...opts, request_id: ctx.requestId, tenant_id: ctx.tenantId },
          contexts: { apiError },
        })
      }

      if (opts.auditAction) {
        await auditLog(ctx, opts, { input, result: 'error', code: apiError.error.code }).catch(noop)
      }

      return { ok: false, error: apiError }
    }
  }
}

// API Routes similar
export function wrapApiHandler(handler, opts) { /* ... */ }
```

### 5. Translators por domínio

```
packages/errors/translators/
├── asaas.ts           // 'INVALID_CUSTOMER' → { code:'PAYMENT_FAILED', action:'Verificar CPF/email do pagador' }
├── focus-nfe.ts       // 90+ códigos SEFAZ (238 = cert vencido; 108 = SEFAZ down transient)
├── supabase.ts        // RLS violation, unique constraint, foreign key
├── anthropic.ts       // rate_limit_error, invalid_api_key, overloaded
├── gemini.ts          // Vertex AI: PERMISSION_DENIED, RESOURCE_EXHAUSTED
├── groq.ts            // Whisper timeouts, invalid audio format
├── openai.ts          // context length, moderation flag, invalid model
├── twilio.ts          // WhatsApp delivery errors (templates, opt-out)
├── tiss.ts            // ~40 códigos de glosa + rejeição XML
├── pluggy.ts          // Open Finance errors
├── zod.ts             // ValidationError → details estruturados i18n
└── index.ts           // resolveTranslator(source) + fallback genérico
```

Cada translator retorna:
```ts
{
  code: ErrorCode,
  message_i18n_key: string,    // 'errors.asaas.invalid_customer'
  action?: string,             // ação sugerida
  transient: boolean,          // permite retry automático
  retry_after_ms?: number,
  runbook?: string,            // URL
}
```

Exemplo Focus NFe:
```ts
// packages/errors/translators/focus-nfe.ts
const SEFAZ_CODES: Record<string, TranslatorOutput> = {
  '108': { code: 'SERVICE_UNAVAILABLE', message_i18n_key: 'errors.sefaz.down', transient: true, retry_after_ms: 60000 },
  '238': { code: 'FISCAL_REJECTED', message_i18n_key: 'errors.sefaz.cert_expired', action: 'Renove certificado A1 em /app/settings/certificados', transient: false },
  '539': { code: 'FISCAL_REJECTED', message_i18n_key: 'errors.sefaz.duplicate_nfe', transient: false },
  // ... 90+ códigos
}
```

### 6. Sanitização LGPD

Helper `sanitizeForAlert(obj)` aplica antes de gravar em `payload` ou `details`:

**Nunca grava:**
- CPF/CNPJ (só últimos 4 dígitos: `***.***.***-12`)
- Email completo (só domínio: `***@gmail.com`)
- Telefone (só DDD + últimos 4: `(11) ****-1234`)
- Endereço completo
- Senha, token, API key, secrets
- Dado clínico (prontuário, CID, evolução, laudo) — **sempre** redacted
- Dado bancário (números de conta, cartão)

**Pode gravar:**
- IDs (uuid) — auditável sem expor PII
- Timestamps
- Códigos de erro
- Nome do módulo/função
- Status HTTP
- Duração

```ts
export function sanitizeForAlert(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj
  const sanitized: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as object)) {
    if (SENSITIVE_KEYS.includes(k)) {
      sanitized[k] = '[REDACTED]'
    } else if (isCpfCnpj(v)) {
      sanitized[k] = maskCpfCnpj(v as string)
    } else if (isEmail(v)) {
      sanitized[k] = maskEmail(v as string)
    } // ... outras regras
    else if (typeof v === 'object') {
      sanitized[k] = sanitizeForAlert(v)
    } else {
      sanitized[k] = v
    }
  }
  return sanitized
}
```

### 7. Notificações em tempo real (4 canais)

**Canal 1 — Badge SideMenu (sempre ativo):**
- Subscribe em Supabase Realtime: `tenant:{id}:role:{min_role}` channel
- Hook `useAlertCount()` no SideMenu (Sprint 00b) + refetch query invalidation em insert/update
- Badge mostra `unread` count com cores (warning/error/critical)
- Click abre `/app/admin/alertas`

**Canal 2 — Toast em tempo real (sessão ativa):**
- Mesma subscription Realtime
- Quando alert novo chega com `severity>=warning`, dispara `sonner.toast()`
- Duração: 5s (warning), infinita (critical — precisa click para dismiss)
- Action button: "Ver detalhes" → navega para alert
- Severity crítica: toast **não pode ser dismissado sem acknowledge**

**Canal 3 — Email (via Resend — Sprint 13):**
- Trigger SQL em insert/update: se `severity='critical'` OR `priority='urgent'` → enfileira em `notification_queue(channel='email')`
- Worker processa fila (job a cada 1min) → envia email
- Template: assunto `[LogiFit] 🔴 Alerta crítico: {title}` + corpo com link, runbook, acknowledge quick-action
- Destinatários: roles com `has_permission('admin.alerts.read')` + `min_role <= alert.min_role`
- Canal `privacidade@logifit.com.br` (ADR 0067) **também** recebe alerts de `security_event`

**Canal 4 — WhatsApp (via Twilio/Z-API — Sprint 13):**
- Trigger igual ao email, mas **só** `priority='urgent'`
- Template pré-aprovado Meta: "⚠ Alerta urgente LogiFit: {title}. Verifique em {short_url}"
- Rate-limit: máximo 3 mensagens/hora/user (evita flood)
- Opt-in obrigatório do admin

**Canal 5 — Push web (Sprint 26 PWA adapta):**
- Service Worker registrado quando admin instala PWA
- Push Notification API dispara quando `severity='critical'` + user offline >5min
- Click abre app direto no alert

**Canal 6 — Sentry (LogiFit dev team):**
- `Sentry.captureException()` em `wrapAction` quando code=`INTERNAL_ERROR`
- Tags: tenant_id, request_id, module, action
- Alerta direto para time LogiFit (não para tenant) — debug de plataforma

### 8. Auto-resolução inteligente

Jobs em `apps/web/app/api/jobs/alert-auto-resolve/route.ts`:

| Regra | Intervalo | Ação |
|---|---|---|
| `auto_resolve_after < now()` | 1h (cron) | `status='resolved'`, `resolved_note='auto_ttl'` |
| HTTP 503 provider externo | trigger em `webhook.success` do mesmo provider | Resolve todos alerts `integration_failure` do provider anteriores a X min |
| `AI_QUOTA_EXCEEDED` | 1º dia do mês (cron) | Resolve quando `ai_tenant_usage` reseta |
| `RATE_LIMITED` | Na próxima chamada bem-sucedida do endpoint | Resolve + tag `retry_recovered` |
| `COMPLIANCE` (ata comitê vencendo) | diário | Resolve quando tenant atualiza em `/app/settings/compliance/comite-ia` |
| `FISCAL_REJECTED` transient | Na próxima emissão bem-sucedida para mesma company | Resolve + tag `sefaz_recovered` |
| `TENANT_SUSPENDED` | Quando invoice paga | Resolve + tag `payment_received` |

### 9. UI admin — `/app/admin/alertas`

Acesso: `has_permission('admin.alerts.read')` + `min_role` respeitado.

```
┌─ Alertas do Sistema ─────────────────────────────────────────┐
│                                                               │
│  KPIs (últimas 24h):                                          │
│    Unread 12 · Critical 2 · Warning 38 · Info 7              │
│                                                               │
│  Filtros: [Severity ▾] [Módulo ▾] [Status ▾] [Período ▾]     │
│           [Busca por request_id ou fingerprint]               │
│                                                               │
│  ─── Filtros rápidos ───────────────────────────────────      │
│  [Não lidos] [Críticos] [Fiscal] [Pagamento] [IA] [Compliance]│
│                                                               │
│  ┌─ Alert #1 · 🔴 CRITICAL · há 3 min · 17 ocorrências ──┐   │
│  │                                                         │   │
│  │  Asaas webhook retornando 500                           │   │
│  │                                                         │   │
│  │  módulo: financeiro · POST /api/webhooks/asaas          │   │
│  │  request_id (último): a3f8-2b61-... [📋 copiar]          │   │
│  │  first_seen: 15min atrás · tag: [asaas, webhook, critical]│   │
│  │                                                         │   │
│  │  Stack trace:                                           │   │
│  │  ReferenceError: customer is not defined                │   │
│  │    at webhook.ts:47:23                                  │   │
│  │    [▸ ver completo]                                     │   │
│  │                                                         │   │
│  │  [📖 Runbook: resolver Asaas 500]                        │   │
│  │  [✓ Acknowledge] [✅ Resolver] [💬 Discutir] [⋯ mais]     │   │
│  │                                                         │   │
│  │  ▸ Timeline de ocorrências (17):                        │   │
│  │    14:32 · user João · request a3f8-2b61                │   │
│  │    14:31 · user Maria · request f9c2-1a88               │   │
│  │    14:29 · webhook · request 7b44-3e51                  │   │
│  │    ... [ver todas]                                      │   │
│  │                                                         │   │
│  │  ▸ Similar alerts (mesmo módulo, 7d):                   │   │
│  │    Alert #23 (7d atrás) — Asaas webhook timeout         │   │
│  │    Alert #45 (3d atrás) — Asaas 502                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─ Alert #2 · 🟡 WARNING · 1h atrás · 3 ocorrências ────┐   │
│  │  Focus NFe rejeição código 108 (SEFAZ indisponível)    │   │
│  │  módulo: fiscal · auto-resolve quando SEFAZ voltar      │   │
│  │  [📖 Runbook] · sem ação necessária                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─ Alert #3 · 🔵 INFO · 2h atrás ───────────────────────┐   │
│  │  Quota IA em 85% do limite mensal (Pro: 2.550/3.000)   │   │
│  │  [🔑 Configurar BYOK] [✓ Acknowledge]                   │   │
│  └─────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────┘
```

**Ações admin:**
- `[Acknowledge]` — reconhece visualização
- `[Resolver]` — modal pede nota de resolução
- `[Discutir]` — cria ticket interno com contexto (ADR 0064 integra)
- `[Dismiss]` — descarta (falso positivo)
- `[Escalar]` — dispara notificação urgent

### 10. Frontend — cliente vê erro

```ts
// packages/api-client/index.ts
export class ApiClient {
  async call<T>(url: string, opts: RequestInit = {}): Promise<T> {
    const requestId = crypto.randomUUID()
    const res = await fetch(url, {
      ...opts,
      headers: {
        ...opts.headers,
        'x-request-id': requestId,
        'accept-language': getLocale(),
      },
    })

    if (!res.ok) {
      const apiError = await res.json() as ApiError
      this.showToast(apiError, requestId)
      throw new ApiClientError(res.status, apiError)
    }

    return res.json()
  }

  private showToast(err: ApiError, requestId: string) {
    const { code, message, runbook, retry_after_ms } = err.error

    const severity = code === 'INTERNAL_ERROR' || code === 'FISCAL_REJECTED' ? 'error' : 'warning'

    toast[severity](message, {
      description: `Código: ${code} · ID: ${requestId.slice(0, 8)}`,
      duration: severity === 'error' ? Infinity : 5000,
      action: retry_after_ms ? {
        label: 'Tentar novamente',
        onClick: () => this.retry(url, opts),
      } : runbook ? {
        label: 'Como resolver',
        onClick: () => window.open(runbook, '_blank'),
      } : undefined,
    })
  }
}
```

### 11. Retenção por severity

Job noturno expurga conforme `retention_days`:

| Severity | Retention |
|---|---|
| info | 30 dias |
| warning | 90 dias |
| error | 365 dias |
| critical | 1.825 dias (5 anos) |
| security_event | 1.825 dias + obrigação legal |

`retention_days` pode ser override manual por admin (nunca reduzir para security_event).

### 12. Integração com security_incidents (ADR 0067)

Trigger SQL ao inserir/update em `system_alerts`:

```sql
IF NEW.severity = 'critical' AND NEW.category IN ('security','data_leak','compliance') THEN
  INSERT INTO security_incidents (...)
  VALUES (...)
  ON CONFLICT DO NOTHING;
  
  -- atualiza o alert com o link
  NEW.related_security_incident_id = (novo incident id);
END IF;
```

Quando security_incident é criado, dispara plano de resposta 72h (ADR 0067): notifica DPO + fundador + orienta ações conforme severidade.

### 13. Regra 33 (nova) em rules.md

> Toda Server Action, API Route e job assíncrono deve ser envolvido em `wrapAction()` / `wrapApiHandler()` / `wrapJob()` de `packages/errors/`. O wrapper:
> (a) gera/propaga `request_id`;
> (b) valida context (auth, permissions, rate limit, AI committee gate, consent cross-module);
> (c) captura erros e traduz via translator apropriado;
> (d) cria `system_alerts` async (fire-and-forget);
> (e) grava `audit_log` quando aplicável;
> (f) Sentry captura stack em `INTERNAL_ERROR`;
> (g) retorna envelope `{ ok, data | error }` tipado.
> CI tem lint `no-unwrapped-action` que bloqueia commit quando Server Action/API Route não usa wrapper. Exceção em job de migration/seed justificada via comentário `// wrap-exempt: reason`.

## Consequences

### Positivas

- **Erros organizados sem dispersão** — dashboard único para admin do tenant + Sentry complementar para dev team LogiFit
- **Deduplicação inteligente** — 1000 erros do mesmo endpoint = 1 alert com timeline de ocorrências
- **Notificação em tempo real via 4 canais** — corrige ponto cego crítico do modelo Deep Control (admin não precisa entrar no dashboard)
- **Envelope unificado** — frontend `sonner` + retry + runbook sem boilerplate
- **Translators por domínio** — erros SEFAZ, Asaas, IA viram friendly automático
- **Auto-resolução inteligente** — alerts transient (SEFAZ down, rate limit) resolvem sozinhos
- **Correlação request_id end-to-end** — debug instantâneo
- **LGPD-safe** — sanitização de PII automática no payload
- **Compliance auto-ligada** — alerts critical+security disparam plano 72h ANPD (ADR 0067)
- **Sentry** captura stack trace para LogiFit dev (bugs de plataforma)
- **PostHog** captura UX degradation (onde erros acontecem mais)
- **Retenção variável** — critical guarda 5 anos (fiscal/auditoria); info só 30 dias (espaço)
- **Regra 33 + lint** — impossível commitar Server Action sem error handling

### Negativas (mitigáveis)

- **Complexidade adicional no Sprint 00** — ~3-4 dias a mais para `packages/errors/` + middleware + wrapAction + 10 translators + lint. Aceito — fundação crítica.
- **system_alerts pode crescer rápido** em tenant com muito tráfego — particionamento por mês + retention jobs
- **4 canais de notificação** podem virar spam — mitigação: rate limit por canal + severity filters + opt-out do WhatsApp
- **Translators precisam manutenção** — novos códigos de erro do provider (SEFAZ atualiza NT anualmente) exigem update; tarefa documentada no runbook de cada sprint
- **Service Worker do push PWA** adiciona complexidade — mitigado por entrega no Sprint 26 (já planejado)
- **Sentry tem custo** (Hobby R$ 0, Team US$ 26/mês — ~R$ 130) — aceitável; cancelável se replicação com Logtail melhor

### Riscos não endereçados

- **Tempest storm** — 100k erros em 1 min do mesmo fingerprint. Dedup ajuda; alerta de "storm detected" dispara email urgent.
- **Alert fatigue** — admin recebe 100 warnings/dia. Mitigar com resumo diário agregado + priorização por impact (tenants afetados, revenue impact).
- **Translator errado** (mapeia para código genérico) — fallback `INTERNAL_ERROR` + tag `translator_missing` + dashboard LogiFit monitora

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Só Sentry, sem `system_alerts` | Admin do tenant não tem Sentry access (paywall LogiFit); precisa UI própria no `/app/admin/alertas` |
| Tier-based visibility (como Deep Control) | LogiFit é role-centric por RBAC + RLS; role é mais granular e já integrado |
| 4 canais no Fase 2 | Corrige o ponto cego reconhecido do Deep Control; vale esforço no MVP |
| Sem regra 33 (CI não bloqueia) | Server Action sem error handling é bug garantido; lint é o que impede |
| Tudo em audit_log (regra 5) | audit_log é para ações de domínio; sistema diferente precisa schema próprio com fingerprint + occurrence_count |
| Push sem service worker (só in-app) | Admin fecha navegador e perde alerts críticos; PWA Service Worker resolve |
| Translators externos (biblioteca) | Nenhuma biblioteca cobre Asaas + Focus NFe + TISS BR; curadoria própria é necessária |
| Apenas sonner toast (sem persistência) | Perde histórico; admin precisa rever erros da semana |

## Escopo de impacto

**Novo ADR:** este (0071).

**Nova regra 33** em `docs/rules.md`.

**Sprints ajustados:**

- **Sprint 00 (setup)** — `packages/errors/` base:
  - `api-error.ts` (envelope + 16 códigos)
  - `wrap-action.ts` + `wrap-api-handler.ts` + `wrap-job.ts`
  - `translators/` iniciais (10 — stubs; cada sprint de integração popula real)
  - `sanitize.ts` (LGPD)
  - Middleware `request_id`
  - Lint custom `no-unwrapped-action` (Biome rule)
  - Observabilidade base (Sentry + PostHog + Logtail clients)

- **Sprint 01a** — Schema `system_alerts` + `system_alert_occurrences` + RLS + trigger `security_incidents` link + retention job
- **Sprint 01b** — Integração com `audit_log` + permissions `admin.alerts.read/acknowledge/resolve`
- **Sprint 00b (SideMenu)** — badge de alertas com subscribe Realtime + `useAlertCount()` hook
- **Sprint 07** — UI `/app/admin/alertas` (KPIs + lista + detalhe + timeline + similar alerts) + realtime subscribe + toast global
- **Sprint 13** — Canais de notificação email (Resend) + WhatsApp (Twilio/Z-API); template email critical; WhatsApp urgent opt-in
- **Sprint 26** — Push web PWA para critical quando user offline

**Translators específicos por sprint de integração:**

| Sprint | Translator |
|---|---|
| 04 | Asaas (cartão, boleto, PIX, webhooks) |
| 06 | Gemini (Vertex AI), OpenAI, Anthropic, Groq |
| 15 | OCR.space, Tesseract |
| 17 | Arquivei/Sieg (NFe recepção), Pluggy/Belvo (Open Finance) |
| 20 | ICP-Brasil providers |
| 22 | TISS glosa + rejeição XML (~40 códigos) |
| 36 | Focus NFe completo (90+ códigos SEFAZ) |

**Docs:**
- `docs/modulos.md` — módulos "Sistema de tratamento de erros" + "Notificações em tempo real" + "Error translators" em Fundação
- `docs/rules.md` — regra 33 + contagem atualizada
- `CLAUDE.md` — regra operacional 18 + contagem 33 regras
- `CHANGELOG.md` — entrada
- `docs/arquitetura.md` — stack já menciona Sentry/PostHog/Logtail; esta ADR detalha integração

## Related

- Reforça [ADR 0001 — Stack base](0001-stack-base.md) — Sentry/PostHog/Logtail agora com integração estruturada
- Reforça [ADR 0067 — DPO + governança](0067-dpo-governanca-compliance-lgpd.md) — auto-liga critical+security a `security_incidents` + plano 72h
- Estende [Sprint 07 — cross-alert dispatcher](../sprints/07-geral-dashboard.md) — dispatcher atual é para alertas de negócio; `system_alerts` é para erros/integrações/compliance
- Complementa [ADR 0064 — Arquitetura IA](0064-ia-arquitetura-gemini-default-byok-rag.md) — `AI_QUOTA_EXCEEDED` + `AI_PROVIDER_ERROR` são códigos tipados
- Complementa [ADR 0066 — Plano comercial](0066-plano-comercial-pricing-trial.md) — `TENANT_SUSPENDED` em inadimplência
- Inspirado no sistema do projeto **Deep Control** (memo 2026-04-24); corrige 3 pontos cegos reconhecidos: push ativo, role-based visibility, APM externo integrado
- Fontes: Sentry best practices, Google SRE handbook (error budgets), RFC 7807 Problem Details for HTTP APIs
