# ADR 0080 — Sistema de mensagens padronizadas (Toast / Banner / AlertDialog / PromptDialog / FormError)

- **Status:** Accepted
- **Date:** 2026-04-26

## Context

Toda feature do LogiFit precisa dar feedback ao usuário em algum momento — confirmação de ação, erro de validação, alerta de plataforma, pedido de confirmação destrutiva, input curto antes de uma ação. Sem padrão claro, cada desenvolvedor tende a improvisar com `window.alert()`, `window.confirm()` ou `window.prompt()` (UX feia, não acessível, não internacionalizada, bloqueante de thread, indizível visualmente, completamente fora do design system "Equilíbrio Vital").

[ADR 0071](0071-sistema-tratamento-erros-alertas-tempo-real.md) já estabelece a fundação **backend** (envelope `{ok, data | error}` com 16 códigos + `system_alerts` realtime + 4 canais de notificação) e cita `sonner.toast()` em 1 parágrafo, mas **não** define:

- Catálogo de **tipos de mensagem** disponíveis ao desenvolvedor (toast, banner, dialog, etc.)
- Contrato de **API cliente** (declarativo via componente vs imperativo via helper)
- Como `ApiError` vira mensagem visual de forma uniforme
- Como substituir `window.alert/confirm/prompt` (regra ainda não escrita)
- Integração com tokens "Equilíbrio Vital", CSP nonce (regra 35), responsividade 3 viewports (regra 31), a11y (ARIA live regions, focus trap), i18n (regra 27)
- Composição com `<ActionConfirmDialog>` da [ADR 0075](0075-assistente-ia-universal-tres-camadas-tool-registry.md) (IA Camada 3) — risco de implementações paralelas

Hoje (pré-Sprint 00) não há código React no repo, mas a especificação precisa nascer agora porque (a) o protótipo do design system precisa documentar os primitivos, (b) o Sprint 00 precisa listar tarefas concretas, (c) regra correspondente em `docs/rules.md` precisa proibir `window.alert/confirm/prompt` desde o primeiro commit.

## Decision

Adotar um **catálogo fechado de 6 tipos de mensagem** + **biblioteca Sonner** como engine de toast + **contrato API uniforme** (declarativo + imperativo), tudo plugado nos tokens "Equilíbrio Vital" e no envelope `ApiError` da ADR 0071.

### 1. Catálogo de mensagens — 6 tipos

| Tipo | Quando usar | Substitui (nativo) | Severidades | Posição (mobile · desktop) | Componente | Helper imperativo |
|---|---|---|---|---|---|---|
| **Toast** | Feedback efêmero pós-ação (5s) | `alert("salvo!")` em UI feliz | success / info / warning / error | bottom-center · bottom-right | `<Toaster>` (provider) | `toast.success/info/warning/error()` |
| **Toast crítico** | Alerta realtime severity≥critical (ADR 0071 Canal 2) ou erro de plataforma | — (não existia) | critical (∞ + requer ack) | bottom-center · bottom-right | mesmo do Toast | `toast.critical()` / `toast.fromApiError()` |
| **Banner** | Estado persistente da página/tenant (trial expira, conta suspensa, comitê IA pendente, MFA setup pendente) | — | info / warning / danger | top sticky em `<AppLayout>` | `<Banner>` | — (sempre declarativo) |
| **AlertDialog** | Confirmação destrutiva ou irreversível ("apagar membro?", "cancelar guia TISS?") | `confirm()` | warning / danger | bottom-sheet · centered | `<AlertDialog>` / `<ConfirmDialog>` | `confirm({ title, body, danger })` → `Promise<boolean>` |
| **PromptDialog** | Coleta input curto antes de ação ("digite o motivo da exclusão") | `prompt()` | neutral | bottom-sheet · centered | `<PromptDialog>` | `prompt({ title, label, validator })` → `Promise<string \| null>` |
| **FormError** | Erro inline sob input (Zod parse, server-side validation) | `:invalid` tooltip do browser | error | sob `<label>` · ao lado do input | `<FormError>` | — |

Os 6 cobrem 100% dos casos de uso de `window.alert/confirm/prompt` + os 2 canais de [ADR 0071 §7](0071-sistema-tratamento-erros-alertas-tempo-real.md) que dependem de UI no cliente (badge SideMenu é Componente próprio, fora deste catálogo).

**Regras de uso por tipo:**

- **Toast** é efêmero por design. Auto-dismiss em 5s. Não use para erro que precisa ação obrigatória — use Toast crítico ou Banner.
- **Toast crítico** não pode ser dispensado sem `acknowledge` clicado. Aparece quando `severity='critical'` chega via Realtime ou `code='INTERNAL_ERROR'` em Server Action.
- **Banner** é declarativo (não imperativo) — controlado pelo estado da página. Dismiss persiste por sessão (`localStorage`) com chave determinística.
- **AlertDialog** sempre tem botão **Cancelar** (autofocus) + botão de ação destacado. `danger=true` muda o botão de ação para `--ev-danger`.
- **PromptDialog** tem `validator?: (value: string) => string | null` que retorna mensagem de erro ou `null` (válido). Bloqueia confirm enquanto inválido.
- **FormError** é linkado via `aria-describedby` ao input correspondente; nunca isolado.

### 2. Biblioteca: Sonner

Ratifica a menção tácita em [ADR 0071 §7 Canal 2](0071-sistema-tratamento-erros-alertas-tempo-real.md). **Sonner** é o engine de Toast (success/info/warning/error/critical). `<Banner>`, `<AlertDialog>`, `<PromptDialog>`, `<FormError>` são **componentes próprios** sobre Radix UI primitives (já dependência do shadcn/ui).

Razões da escolha:
- Headless-friendly: estilo 100% via CSS (tokens EV aplicáveis sem fork)
- ARIA live region nativo (`role="status"` para info/success, `role="alert"` para warning/error/critical)
- Suporte a actions (botão dentro do toast — usado para "Tentar novamente"/"Ver runbook")
- Bundle pequeno (~5kb gzip), tree-shakeable
- API simples: `toast.success(...)` / `toast.error(...)` / `toast(...)` — encaixa direto no contrato proposto
- Compatível com CSP nonce via prop (sem `unsafe-inline` de styles inline)

### 3. Contrato de API

**Declarativo (componentes em `packages/ui/components/messages/*`):**

```tsx
// apps/web/app/layout.tsx (Server Component)
<Toaster nonce={cspNonce} />          // único provider, lê nonce CSP do header

// Em qualquer página
<Banner severity="warning" dismissible storageKey="trial-expira-3d">
  {t('billing.trial.expires_soon', { days: 3 })}
</Banner>

// Em formulário
<input id="email" aria-describedby="email-error" />
{form.errors.email && (
  <FormError id="email-error">{form.errors.email}</FormError>
)}

// Em página com confirmação
<AlertDialog
  open={isOpen}
  onOpenChange={setOpen}
  danger
  title={t('members.delete.title')}
  body={t('members.delete.body', { name: member.name })}
  confirmLabel={t('common.delete')}
  cancelLabel={t('common.cancel')}
  onConfirm={() => deleteMember(member.id)}
/>
```

**Imperativo (helpers em `packages/ui/messages/api.ts`):**

```ts
import { toast, confirm, prompt, useActionResult } from '@repo/ui/messages'

// Toast simples
toast.success(t('members.created'))
toast.error(t('members.create_failed'))
toast.warning(t('billing.invoice_overdue'))
toast.info(t('common.saved'))

// Toast com action
toast.warning(t('integrations.asaas_slow'), {
  description: t('integrations.asaas_slow.desc'),
  action: { label: t('common.retry'), onClick: () => retry() },
})

// Toast crítico (∞ + requer ack)
toast.critical(t('integrations.asaas_down'), {
  description: t('errors.request_id', { id: requestId }),
  action: { label: t('common.view_runbook'), onClick: () => open(runbookUrl) },
})

// Direto de ApiError (atalho mais comum)
const result = await myAction(input)
if (!result.ok) toast.fromApiError(result.error)

// Confirmação imperativa (substitui window.confirm)
const confirmed = await confirm({
  title: t('members.delete.title'),
  body: t('members.delete.body', { name: member.name }),
  danger: true,
})
if (confirmed) await deleteMember(member.id)

// Prompt imperativo (substitui window.prompt)
const reason = await prompt({
  title: t('members.delete.reason.title'),
  label: t('members.delete.reason.label'),
  validator: (v) => v.length < 10 ? t('errors.min_length', { n: 10 }) : null,
})
if (reason !== null) await deleteMember(member.id, reason)

// Hook unificado para Server Actions
const result = await myAction(input)
useActionResult(result, {
  onSuccess: (data) => toast.success(t('saved')),
  // onError default: delega para toast.fromApiError; só override se quiser inline
})
```

### 4. Integração com `ApiError` (ADR 0071)

`toast.fromApiError(error: ApiError)` traduz o envelope para toast:

| Campo `ApiError` | Comportamento no toast |
|---|---|
| `code` | Define severidade: `INTERNAL_ERROR`/`SERVICE_UNAVAILABLE` → critical; `RATE_LIMITED`/`AI_QUOTA_EXCEEDED` → warning; demais → error |
| `message` | Texto principal (já vem traduzido pelo backend conforme locale do usuário — regra 27) |
| `request_id` | Description: `Código: {code} · ID: {request_id.slice(0,8)}` + ícone copiar |
| `runbook` | Action button "Ver runbook" → `window.open(runbook, '_blank')` |
| `retry_after_ms` | Action button "Tentar novamente" + countdown visual |
| `details` | Não exibido por padrão (já sanitizado LGPD pelo backend); link "Ver detalhes" abre `<details>` se presente |

### 5. CSP nonce (regra 35 / ADR 0073)

`<Toaster nonce={nonce}>` recebe nonce dinâmico via prop. Sonner aplica nonce em `<style>` injetado. Zero `unsafe-inline` necessário.

### 6. Responsividade (regra 31 / ADR 0063)

- **Toast**: mobile (390-767) full-width centro inferior com margem 16px; desktop (≥768) bottom-right card de 380px max.
- **Banner**: mobile full-width sticky abaixo do `<AppHeader>`; desktop idem mas dentro do container 1440px.
- **AlertDialog / PromptDialog**: mobile vira `<bottom-sheet>` cobrindo 100% width + `max-height: 85vh` com handle de drag; desktop centered com `max-width: 480px`. Reusa `<ResponsiveModal>` previsto em [Sprint 00 linha 67](../sprints/00-setup-infra.md).
- Touch targets: dismiss `≥44px`; ações primárias do dialog `≥48px`.
- Testes Playwright em 3 viewports (390/768/1280) confirmam layout + ARIA + i18n.

### 7. Acessibilidade

- **Toast**: `role="status"` (info/success — anúncio polido) ou `role="alert"` (warning/error/critical — anúncio assertivo). `aria-live` correspondente.
- **AlertDialog / PromptDialog**: Radix Dialog → focus trap nativo, `aria-modal="true"`, ESC fecha, click no overlay fecha (exceto quando `danger=true` — aí só botão).
- **PromptDialog**: input recebe `aria-describedby` ao label; `aria-invalid="true"` quando validator falha.
- **FormError**: id linkado via `aria-describedby` no input pai; cor não é único sinal (ícone + texto).
- **Banner**: `role="status"` com `aria-live="polite"`; botão dismiss `aria-label="Dispensar"`.

### 8. i18n (regra 27 / ADR 0052)

Helpers **nunca** aceitam string literal. TypeScript enforça via tipo:

```ts
type ToastMessage = string  // resultado de t() — runtime check via lint
toast.success(t('members.created'))           // ✓
toast.success('Membro criado!')               // ✗ lint no-hardcoded-toast-message bloqueia
toast.success(`Olá ${name}`)                  // ✗ template literal sem t() bloqueia
```

Catálogo `messages.json` (criado em Sprint 00) tem chaves comuns em pt-BR/en-US/es-419:
- `messages.action.succeeded`, `messages.action.failed`
- `messages.action.retry`, `messages.action.dismiss`, `messages.action.copy_request_id`
- `messages.action.ok`, `messages.action.cancel`, `messages.action.confirm`
- `messages.action.view_runbook`, `messages.action.view_details`

`ApiError.message` já chega traduzido do backend (resolvido no contexto de locale do usuário em `wrapAction`).

### 9. Composição com `<ActionConfirmDialog>` (ADR 0075)

`<ActionConfirmDialog>` da [ADR 0075](0075-assistente-ia-universal-tres-camadas-tool-registry.md) (IA Camada 3 write tools) é **wrapper composto** sobre `<ConfirmDialog>` genérico — adiciona seções específicas de IA: tool key, args, impacto (low/medium/high), affected entities. **Nunca** é uma implementação paralela.

```tsx
// packages/ui/components/messages/action-confirm-dialog.tsx (ADR 0075 — Sprint 17)
export function ActionConfirmDialog({ proposal, ...props }: ActionConfirmDialogProps) {
  return (
    <ConfirmDialog
      title={proposal.tool.confirmTitle}
      body={<AIProposalSummary proposal={proposal} />}
      danger={proposal.impact === 'high'}
      confirmLabel={proposal.tool.confirmLabel}
      {...props}
    />
  )
}
```

### 10. Lints (CI obrigatório)

- **`no-window-alert`** — bloqueia `window.alert(...)`, `window.confirm(...)`, `window.prompt(...)`, e variantes (`alert(...)` no escopo global). Exceção via comentário `// alert-exempt: <motivo>` apenas para integração com `<iframe>` 3rd-party (e.g., gateway de pagamento que abre alerta nativo).
- **`no-hardcoded-toast-message`** — bloqueia string literal e template literal sem `t()` em: `toast.*()`, `confirm({title|body})`, `prompt({title|label})`, `<Banner>`. Detecta padrões: `toast.success("foo")`, `toast.error(\`Erro ${x}\`)`, `<Banner>texto</Banner>`. Permite expressões resultando de `t(...)`.

Ambas as lint rules nascem no **Sprint 00 Faixa 3** (lint pack custom).

### 11. Substituição dos canais ADR 0071

| Canal ADR 0071 | Implementação no novo sistema |
|---|---|
| Canal 1 — Badge SideMenu | `useAlertCount()` + componente badge (já no Sprint 00b — fora deste catálogo, mas linkado) |
| **Canal 2 — Toast realtime** | `<Toaster>` + `useAlertsRealtime()` que dispara `toast.warning/error/critical` em insert |
| Canal 3 — Email | Não toca UI; permanece como Sprint 13 |
| Canal 4 — WhatsApp | Não toca UI; permanece como Sprint 13 |
| Canal 5 — Push web (PWA) | Sprint 26 — distinto de Toast (notificação OS-level quando offline) |
| Canal 6 — Sentry | LogiFit dev team apenas; não toca UI do tenant |

## Consequences

### Positivas

- **UX consistente** em todo o sistema — toda mensagem segue tokens "Equilíbrio Vital", responsividade garantida, a11y por construção
- **Substituição completa de `window.alert/confirm/prompt`** desde o primeiro commit React (lint enforça)
- **Integração natural com ADR 0071** — `toast.fromApiError(error)` é one-liner para todo error envelope
- **i18n garantido** (regra 27) — lint bloqueia string literal; chaves comuns reusáveis
- **Composição limpa com IA Camada 3** — `<ActionConfirmDialog>` (ADR 0075) reusa `<ConfirmDialog>`, sem duplicação
- **Bundle pequeno** — Sonner (~5kb) + componentes próprios via Radix (já dependência do shadcn)
- **Acessibilidade firme** — ARIA live regions, focus trap, `aria-describedby`, sem cor como único sinal

### Negativas (mitigáveis)

- **Sprint 00 ganha ~3-4 dias** de trabalho (componentes, helpers, lints, styleguide page, testes) — absorvido pela Faixa 3 (lints custom + docs operacionais)
- **Curva de aprendizado** mínima para devs acostumados com `window.alert` — mitigada por exemplos no styleguide e ADR (já parte do MVP)
- **Sonner é dependência externa** — risco baixo (mantida pela emilkowalski, ~30k stars, último release recente); fallback é fork em `packages/ui/messages/sonner-fork/` se virar abandoned

### Riscos não endereçados

- **Notificação push web** (Service Worker / Web Push API — Canal 5 ADR 0071) é distinta deste catálogo — Sprint 26 PWA pode precisar de ADR próprio se houver decisões não cobertas aqui
- **Toast queue overflow** em tela com muito ruído (e.g., 50 alertas chegando via Realtime) — Sonner faz queue + dedup por id; se virar problema real, adicionar throttle no `useAlertsRealtime()`
- **Bottom-sheet em mobile com teclado virtual aberto** (PromptDialog) — testado em Sprint 00 com Playwright + viewport mobile; ajuste fino pode ser necessário em Sprint 19 (cobrança/CRUD pesado)

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| `window.alert/confirm/prompt` nativos | UX feia, bloqueante, sem i18n, sem tokens, sem a11y custom, sem mobile-friendly. Mata a percepção de produto profissional. |
| `react-hot-toast` | Ótimo, mas Sonner tem ARIA live region superior + actions nativas + queue inteligente; ambos similares em peso |
| `react-toastify` | Bundle maior, API mais verbosa, menos customização CSS-first |
| Componente próprio de toast (sem lib) | Reinventar queue, ARIA, animações, focus trap = ~2 sprints. Sonner faz tudo bem |
| `<ActionConfirmDialog>` (ADR 0075) como componente único também para confirmações genéricas | Acopla IA-specific (proposal_id, tool registry) a casos que não são IA. Composição é mais limpa. |
| Não criar lint `no-hardcoded-toast-message` | Devs vão hardcodar strings, regra 27 fica letra-morta nos toasts. Lint é barato e enforça. |
| Não criar lint `no-window-alert` (confiar em code review) | Dev solo, sem PR review obrigatório (regra 10) — sem lint, vaza |

## Escopo de impacto

- **Sprint 00 — Faixa 3** entrega:
  - `packages/ui/components/messages/` — `toaster.tsx`, `toast.tsx`, `banner.tsx`, `alert-dialog.tsx`, `confirm-dialog.tsx`, `prompt-dialog.tsx`, `form-error.tsx`
  - `packages/ui/messages/api.ts` — `toast`, `confirm`, `prompt`, `useActionResult`
  - `packages/ui/messages/api-error-translator.ts` — `toast.fromApiError(error: ApiError)`
  - `<Toaster nonce={cspNonce}>` plugado em `apps/web/app/layout.tsx`
  - i18n catalog `messages.json` em pt-BR/en-US/es-419 com chaves comuns
  - Lint custom Biome `no-window-alert` + `no-hardcoded-toast-message`
  - Storybook page `apps/web/app/styleguide/messages/`
  - E2E Playwright em 3 viewports (390/768/1280) cobrindo cada tipo
- **Sprint 00b** — `useAlertsRealtime()` hook usa `toast.fromApiError`/`toast.critical` (não chama Sonner direto)
- **Sprint 07** — UI `/app/admin/alertas` reusa `<AlertDialog>` para "Acknowledge" / "Resolver com nota" / "Dismiss"
- **Sprint 17** (Assistente IA) — `<ActionConfirmDialog>` é wrapper sobre `<ConfirmDialog>` (ADR 0075)
- **Sprint 26** (PWA) — Push web pode integrar com `toast.critical` quando user volta online

Adições simultâneas:
- **`docs/rules.md`** — regra 45 nova (proíbe `window.alert/confirm/prompt`, obriga catálogo)
- **`prototipo/base.css`** — primitivos `.ev-toast`, `.ev-banner`, `.ev-modal`, `.ev-alert-dialog`, `.ev-form-error`
- **`prototipo/designsystem/index.html`** — seção "Mensagens" com demo dos 6 tipos
- **`CLAUDE.md`** — digest da regra 45
- **`docs/arquitetura.md`** — referência ao catálogo
- **`docs/modulos.md`** — Mensagens listado em "Fundação"

## Related

- Estende [ADR 0071 — Sistema de tratamento de erros + alertas em tempo real](0071-sistema-tratamento-erros-alertas-tempo-real.md) — fornece a UI cliente que ADR 0071 cita em §7 Canal 2
- Reusa [ADR 0052 — i18n 3 idiomas](0052-i18n-tres-idiomas-pt-en-es.md) — todas as mensagens via `t()`
- Reusa [ADR 0063 — Responsividade total](0063-responsividade-total-mobile-first.md) — `<ResponsiveModal>` é base de `<AlertDialog>`/`<PromptDialog>`
- Reusa [ADR 0073 — Postura de segurança](0073-postura-seguranca-defesa-em-profundidade.md) — `<Toaster nonce={...}>` respeita CSP regra 35
- Composto por [ADR 0075 — Assistente IA universal](0075-assistente-ia-universal-tres-camadas-tool-registry.md) — `<ActionConfirmDialog>` é wrapper sobre `<ConfirmDialog>` deste ADR
- Cria **regra 45** em [`docs/rules.md`](../rules.md)
- Fontes: [Sonner](https://sonner.emilkowal.ski/) (lib de toast), [Radix UI Dialog](https://www.radix-ui.com/primitives/docs/components/dialog) (base de modal), WAI-ARIA Authoring Practices (live regions, dialog patterns)
