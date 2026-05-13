---
slug: tokens-equilibrio-vital-light-dark-flat
status: accepted
date: 2026-05-13
---

# ADR 0016 — Tokens "Equilíbrio Vital": flat design + light/dark via CSS variables

## Contexto

LogiFit precisa de design system próprio. Opções consideradas:

### A. shadcn/ui defaults

Adotar tokens default shadcn (Tailwind + Radix). Problemas:

- ❌ **box-shadow espalhada por todo lugar** — cards têm `shadow-sm` por
  padrão; produz visual carregado, anti-flat
- ❌ **Sem identidade visual LogiFit** — clones de shadcn são reconhecíveis
- ❌ **Light/dark via `dark:` Tailwind** funciona, mas tokens duplicados
  (precisa configurar 2× cada componente)

### B. Tema próprio sobre Tailwind

Criar tokens próprios em CSS variables `--ev-*` (Equilíbrio Vital) +
mapeamento `tailwind.config.ts` com `theme.extend.colors.surface = 'var(--ev-surface)'`.

- ✅ Identidade visual própria
- ✅ Light/dark via swap de variáveis no `<html>` (1 lugar só)
- ✅ Flat design garantido — não declaramos `box-shadow` token em lugar nenhum
- ✅ Tokens semânticos (`--ev-success`, `--ev-danger`) ao invés de cores cruas

## Decisão

Adotar caminho B: tokens semânticos próprios em `--ev-*` definidos em
`packages/ui/tokens.css`. Tailwind utility classes consomem via
`bg-[color:var(--ev-primary)]` etc — formato Tailwind 3.0 arbitrary value.

### Catálogo canônico (MVP)

```css
:root {
  /* Surfaces */
  --ev-bg: #fafafa;
  --ev-surface: #ffffff;
  --ev-surface-muted: #f3f4f6;
  --ev-border: #e5e7eb;
  --ev-input-bg: #ffffff;

  /* Text */
  --ev-text: #111827;
  --ev-text-muted: #6b7280;
  --ev-text-subtle: #9ca3af;

  /* Brand */
  --ev-primary: #2563eb;            /* azul calmo "equilíbrio" */
  --ev-primary-foreground: #ffffff;

  /* Semantic */
  --ev-success: #10b981;
  --ev-warning: #f59e0b;
  --ev-warning-bg: #fef3c7;
  --ev-warning-text: #78350f;
  --ev-danger: #ef4444;

  /* Spacing */
  --ev-space-1: 4px;
  --ev-space-2: 8px;
  --ev-space-3: 12px;
  --ev-space-4: 16px;
  --ev-space-6: 24px;

  /* Sizing — touch targets regra 31 */
  --ev-touch-min: 44px;
  --ev-input-min: 48px;

  /* Typography */
  --ev-text-xs: 0.75rem;
  --ev-text-sm: 0.875rem;
  --ev-text-base: 1rem;
  --ev-text-lg: 1.125rem;
  --ev-text-xl: 1.5rem;

  /* Radius */
  --ev-radius-sm: 4px;
  --ev-radius-md: 6px;
  --ev-radius-lg: 12px;
}

[data-theme='dark'] {
  --ev-bg: #0a0a0a;
  --ev-surface: #1a1a1a;
  --ev-surface-muted: #262626;
  --ev-border: #2e2e2e;
  --ev-input-bg: #1a1a1a;

  --ev-text: #fafafa;
  --ev-text-muted: #a3a3a3;
  --ev-text-subtle: #737373;

  --ev-primary: #3b82f6;
  --ev-primary-foreground: #ffffff;

  --ev-success: #10b981;
  --ev-warning: #f59e0b;
  --ev-warning-bg: #422006;
  --ev-warning-text: #fef3c7;
  --ev-danger: #ef4444;
}
```

### Regras anti-shadow

**Proibido em todo o codebase:**
- `box-shadow:` em CSS/Tailwind
- `drop-shadow:` em SVG ou CSS
- `shadow-*` utility class do Tailwind

**Exceções**:
- Modal/dialog backdrop tem permissão `backdrop-filter: blur(2px)` (já usado em
  `<AppShell>` + `<CommandPalette>`) — não é shadow propriamente, é filter
- Focus ring: `outline` ou `box-shadow: 0 0 0 2px var(--ev-primary)` aceito
  como **focus indicator a11y** (não decoração)

**Bordas no lugar de shadows**:
- Cards: `border border-[color:var(--ev-border)]` em vez de `shadow-sm`
- Hover: `hover:bg-[color:var(--ev-surface)]` em vez de `hover:shadow-md`
- Active state: `border-[color:var(--ev-primary)]` em vez de glow

### Light/dark via `data-theme` no `<html>`

Toggle controlado por `next-themes` (lib leve, ~3KB):

```tsx
import { ThemeProvider } from 'next-themes'

<ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem>
```

Cookie `theme` persiste preferência. Sprint 07+ Faixa D adiciona toggle em
`/app/settings/tema` (não bloqueia esta sprint — `prefers-color-scheme` cobre default).

### Mapeamento Tailwind

`apps/web/tailwind.config.ts`:

```typescript
theme: {
  extend: {
    colors: {
      'ev-surface': 'var(--ev-surface)',
      'ev-text': 'var(--ev-text)',
      'ev-primary': 'var(--ev-primary)',
      // ... todos os tokens
    },
  },
},
```

Permite `<div className="bg-ev-surface text-ev-text">` além do formato
`bg-[color:var(--ev-surface)]`. Sprint 09+ migra usos arbitrary value pra
shortcut.

## Consequências

### Positivas

- **Flat design coerente em todas as 30+ rotas** — sem residuais shadcn
- **Light/dark switch em 1 lugar** (swap de `[data-theme]`) — não duplica componentes
- **Tokens semânticos resistem a refactor de cor** — trocar `--ev-primary` de
  azul pra roxo afeta 100% das usages sem find-and-replace
- **Touch targets garantidos** via `--ev-touch-min: 44px` (regra 31)
- **A11y mantida**: focus ring continua via `outline`; `data-theme` aparece em
  screen readers como contexto de tema

### Negativas

- **Arbitrary value verboso**: `bg-[color:var(--ev-surface)]` é verbose vs.
  `bg-ev-surface`. Mitigação: Sprint 09+ adiciona mapeamento tailwind config
  pra encurtar.
- **Dark mode requer testes visuais**: cada nova tela precisa snapshot em
  ambos os themes. Sprint 09+ Playwright snapshot 2 modes × 3 viewports.
- **Tokens não cobrem 100% do CSS shadcn original**: alguns componentes radix
  vão precisar override manual quando aterrissarem. Aceito.

## Migração futura

Sprint 09+:
- Toggle em `/app/settings/tema` + persistência por user em
  `user_preferences.theme_mode`
- Playwright snapshot em ambos `data-theme=light|dark` × 3 viewports
- Mapeamento Tailwind shortcut (`bg-ev-surface` em vez de arbitrary)
- Token de `font-family` (Inter como default agora — implícito; explicitar)

## Referências

- [Sprint 07 — Dashboard "Equilíbrio Vital"](../sprints/07-geral-dashboard.md)
- [Regra 31 — responsividade total mobile-first + touch targets 44px](../rules.md#31)
- [Regra 35 — security headers + CSP nonce dinâmico](../rules.md#35)
- `packages/ui/src/tokens.css` — declaração canônica
- [next-themes](https://github.com/pacocoursey/next-themes) — lib de toggle
