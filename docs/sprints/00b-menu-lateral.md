# Sprint 00b — Menu lateral (SideMenu hamburger overlay + registry por módulo)

- **Área:** fundação (UI)
- **Início:** planejado (parte do setup inicial; depois do Sprint 00)
- **Fim planejado:** +1 semana
- **Status:** planejado
- **Item do roadmap:** #2b (entre #2 Sprint 00 e #3 Sprint 01a)

## Goal

Menu lateral **hamburger overlay** sempre visível como ícone `☰` no header; menu abre por cima da página (página ocupa 100% da viewport em todos os dispositivos). Organizado por **módulos** (Início, Pessoas, Agenda, Financeiro, Fiscal, Saúde, Configurações, etc.) e **filtrado por permissões do user, vertical do tenant e consent** — itens aparecem só quando user tem acesso. Implementa ADR 0063 (padrão overlay único).

## Critério de aceite

- Ícone `☰` sempre visível no canto superior esquerdo do header `<AppLayout>` (substitui sidebar fixa do plano anterior)
- Clique no `☰` → menu desliza da esquerda com animação suave (transform translateX) + backdrop escuro cobrindo o resto da tela
- **Página ocupa 100% da largura** em todos os viewports — menu é sempre overlay, nunca empurra conteúdo
- Largura do menu adapta por viewport: **85% (max 320px) em mobile** · **320px em tablet** · **280px em desktop**
- Fecha por: (a) clique no backdrop, (b) tecla `Esc`, (c) tap/swipe em mobile, (d) clique em item de navegação **em mobile/tablet** (desktop mantém aberto por padrão com toggle "fixar")
- Atalho `Ctrl+B` / `Cmd+B` (padrão VSCode) abre/fecha em desktop
- **Focus trap** quando aberto: `Tab` circula pelos itens do menu; `Esc` fecha e restaura foco no trigger `☰` (acessibilidade WCAG)
- **Swipe gesture** em mobile/tablet: deslizar da borda esquerda abre; deslizar para esquerda no menu aberto fecha
- **Organização por módulo** (seções colapsáveis):
  - **Início** (Home/Dashboard)
  - **Pessoas** (Members, Leads, Profissionais, Fornecedores, Pessoas)
  - **Agenda** (Agendamentos, Recursos, Slots, Check-ins)
  - **Acesso** (QR, Catracas, Bloqueios, Feed live) — só vertical Academia
  - **Comercial** (Funil, Propostas, Ofertas, Planos, Contratos)
  - **Financeiro** (Dashboard, AP, AR, Plano de contas, Inbox NF-e, Devoluções, Bancos, Fluxo de caixa)
  - **Fiscal** (Emissões, Retenções, Configurações fiscais, Portal contador)
  - **Clínico** (Prontuário, Evoluções, Convênios, Exames) — vertical Fisio/Nutri
  - **Vigilância** (Equipamentos, Manutenção, Limpeza, CNES) — vertical Fisio
  - **Relacionamento** (Mensagens, Régua, WhatsApp, Copilot)
  - **Estoque** (Itens, Movimentações, POS, Inventário)
  - **Engajamento** (Conquistas, Metas, Brindes)
  - **RH** (Contratos profissionais, Comissões)
  - **Compliance** (Comitê IA, Conformidade IA, Titular requests)
  - **Integrações** (Device Hub, Wellness, CNES)
  - **Configurações** (Empresas, Units, Users, Roles, Naturezas, Fiscal, OCR, Certificados)
- **Filtros aplicados na renderização** (ADR 0063 + registry):
  - `requiredPermission` — item aparece só se user tem (`has_permission()`)
  - `requiredVertical` — item aparece só se tenant tem a vertical ativa (ex: "Clínico" some em tenant só-Academia)
  - `requiredConsent` — item aparece só se consent ativo (raro no menu; usado em cross-module)
  - `featureFlag` — item aparece só se feature flag está ON (dev/staging)
  - **Módulo inteiro some** se nenhum item dele passa nos filtros
- **Estrutura de item:** ícone + label + badge opcional (ex: "3 vencendo" em AP) + submenu inline (acordeão, sem drawer aninhado)
- **Footer do menu:**
  - Avatar + nome do user + tenant/company atual
  - Botão "Trocar tenant" (se multi-tenant)
  - Link "Configurações" (atalho)
  - Botão "Sair"
- **Header do menu (opcional):** nome do tenant + logo do tenant
- Persistência: estado aberto/fechado + seções colapsadas em `localStorage` por user (desktop); mobile sempre fecha ao navegar
- Teste E2E: recepcionista vê módulos Início + Pessoas + Agenda + Acesso (limitados por permission) — **não** vê Financeiro, Fiscal, Clínico
- Teste E2E: fisio com vertical Fisio ativa vê módulo "Clínico"; mesmo fisio em tenant só-Academia (caso raro) **não** vê
- Teste E2E: gerente em tenant só-Academia **não** vê módulo "Clínico" nem "Vigilância"
- Teste E2E: swipe da borda esquerda em mobile abre menu; swipe no menu fecha
- Teste E2E: `Ctrl+B` em desktop abre/fecha; `Esc` fecha e restaura foco
- Teste visual Playwright em 3 viewports (mobile/tablet/desktop) — menu fechado mostra só `☰`; menu aberto sobrepõe com backdrop; página atrás continua visível mas dimmed

## Dependências

- Sprint 00 (componentes base responsivos + tokens `min-h-touch` + `<AppLayout>` esqueleto + i18n)
- Sprint 01b (`has_permission()` SQL function + permissions seed — o registry consome para filtrar)
- Sprint 01a (identificação do user + tenant + vertical ativa via JWT claims)

## Decisões tomadas / ADRs esperados

- [ADR 0063 — Responsividade total](../decisions/0063-responsividade-total-mobile-first.md) — accepted; este sprint implementa
- **Sem ADR novo neste sprint** — decisão arquitetural já tomada pela 0063
- **Pergunta aberta:** animação — CSS `transform` + `transition` (zero dependência) ou framer-motion (mais rico, +15kb)? **Começar CSS puro** (transform translateX + cubic-bezier); framer-motion fica para sprint futuro se animação precisar mais sofisticação

## Módulos entregues

Ver [`modulos.md` — Fundação](../modulos.md#fundação):

- `<SideMenu>` componente principal
- `<HamburgerTrigger>` ícone ☰ com estado aberto/fechado
- `<MenuBackdrop>` overlay com blur + click-to-close
- `registerMenuItem({ id, module, label, icon, url, requiredPermission, requiredVertical, requiredConsent, featureFlag, order, children? })` — API pública para sprints registrarem seus itens
- Hook `useMenuState()` — `{ isOpen, open(), close(), toggle() }`
- Context `MenuProvider` no layout root
- Persistência localStorage por user (desktop)

## Rotas Next.js

Nenhuma rota nova — é componente de layout. Afeta todas as rotas `/app/*` (não afeta `/meu/*` do portal paciente que tem navegação própria).

## Server Actions + API Routes

Nenhum — componente client-side puro. Consulta `has_permission()` do Sprint 01b em tempo de renderização (hook `usePermissions()`).

## Schemas Drizzle (esperado)

Nenhum. Preferências do menu ficam em `localStorage` client (sem persistir em banco). Se futuramente precisar sync entre dispositivos, adicionar `user_preferences` table — decisão adiada.

## Eventos de domínio emitidos

Nenhum evento de domínio (puramente UI).

Telemetria PostHog:
- `menu.opened` / `menu.closed`
- `menu.item_clicked` — `{ item_id, module, from_device }`
- `menu.module_collapsed` — detecta módulos sem engajamento

## Commit (checklist)

- [ ] Schema do registry em `packages/ui/side-menu/registry.ts` — tipo `MenuItem = { id, module, label, icon, url, requiredPermission?, requiredVertical?, requiredConsent?, featureFlag?, order?, badge?: () => string | null, children?: MenuItem[] }`
- [ ] Função `registerMenuItem(meta: MenuItem)` + `registerMenuModule({ id, label, icon, order })` — sprints chamam no boot
- [ ] Componente `<SideMenu>` em `packages/ui/layout/side-menu.tsx`:
  - Slide-in/out animado (CSS transform `translateX(-100%)` ↔ `translateX(0)` + `transition-transform duration-300 ease-out`)
  - Backdrop com `bg-black/50` + `backdrop-blur-sm` + click handler
  - Focus trap com `@radix-ui/react-focus-scope` ou implementação custom
  - `role="dialog"` + `aria-modal="true"` + `aria-labelledby`
- [ ] Componente `<HamburgerTrigger>` com transição ícone ☰ ↔ × (X)
- [ ] Hook `useMenuState()` + Context `MenuProvider`
- [ ] Atalho global `Ctrl+B` / `Cmd+B` no layout root (só desktop)
- [ ] Swipe gesture em mobile/tablet (touch events — `touchstart`/`touchmove`/`touchend` com threshold 50px)
- [ ] Tecla `Esc` fecha + restaura foco no trigger
- [ ] Persistência `localStorage` em chave `logifit:side-menu:{userId}`
- [ ] Filtros na renderização:
  - `has_permission(user, item.requiredPermission)` via hook do Sprint 01b
  - `tenant.verticals_active.includes(item.requiredVertical)`
  - `consents.active_purposes.includes(item.requiredConsent)` (quando aplicável)
  - `features[item.featureFlag] === true` (se flag)
  - Módulo inteiro oculto se todos itens filtrados
- [ ] Footer com `<UserAvatar>` + trocar tenant + logout (reusa auth do Sprint 01a)
- [ ] Badge dinâmica por item (função `badge()` executada no render — ex: contagem de "3 APs vencendo" em Contas a Pagar)
- [ ] **Badge "Alertas do sistema" no header** (ADR 0071): hook `useAlertCount()` subscribe em Supabase Realtime channel `tenant:{id}:role:{min_role}`; mostra count de `system_alerts` com `status='unread'`; cores por severity (amarelo warning / vermelho critical); click navega para `/app/admin/alertas`; refetch em insert/update via realtime (fallback polling 60s se WebSocket falhar)
- [ ] **Toast real-time global** (ADR 0071): mesma subscription Realtime dispara `sonner.toast()` quando alert novo chega com severity≥warning na sessão ativa do user; critical = toast infinito (exige click para dismiss)
- [ ] Todos os ícones via biblioteca escolhida (lucide-react — já no stack)
- [ ] Responsividade: larguras adaptadas por viewport (85%/320px/320px/280px)
- [ ] Scroll interno do menu quando conteúdo excede altura da viewport
- [ ] Testes unit do filtro de itens (permission + vertical + consent combinados)
- [ ] Testes E2E nos 3 viewports canônicos (mobile/tablet/desktop) com 3 roles distintos (recepção/fisio/gerente) — cada um vê módulos distintos
- [ ] Teste de focus trap (`Tab` circula dentro do menu aberto)
- [ ] Teste de `Esc` fecha + restaura foco
- [ ] Teste visual Playwright baseline em 3 viewports
- [ ] Telemetria PostHog `menu.*` integrada
- [ ] i18n: labels dos módulos e itens em `t('menu.module.financeiro')`, `t('menu.item.financeiro.ap')`, etc. nos 3 locales (regra 27)
- [ ] Storybook: story do `<SideMenu>` com mock de permissions variadas
- [ ] Seed no boot: LogiFit registra **módulos padrão** (Início, Pessoas, Agenda, Financeiro, Fiscal, Clínico, Vigilância, Comercial, Relacionamento, Estoque, Engajamento, RH, Compliance, Integrações, Configurações) com `order` determinístico; **itens são registrados pelos respectivos sprints** (Sprint 02 registra "Members" em Pessoas; Sprint 15 registra "AP" em Financeiro; etc.)

## Stretch

- [ ] Arrastar para reordenar itens dentro de um módulo (preferência do user)
- [ ] Favoritos — user marca itens frequentes; aparecem em seção "Favoritos" no topo
- [ ] Busca dentro do menu (input no topo filtra itens) — complementa Command Palette Ctrl+K
- [ ] Modo "compacto" (só ícones) em desktop para user power que não quer label — toggle no footer
- [ ] Animação framer-motion com spring physics (se CSS ficar travado em low-end devices)
- [ ] Sync de preferências entre dispositivos via `user_preferences` table (requer schema novo)

## Log

- —

## Definition of Done

- [ ] Feature flag `side_menu_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] Focus trap + `Esc` + `Ctrl+B` funcionais
- [ ] Swipe gesture funcional em touch
- [ ] Filtros de permission/vertical/consent funcionais com 3 roles testadas
- [ ] **Responsividade:** 3 viewports testados (mobile 390 / tablet 768 / desktop 1280); zero overflow; `☰` ≥44px touch (ADR 0063, regra 31)
- [ ] **i18n:** labels nos 3 locales (regra 27)
- [ ] Acessibilidade: WCAG AA (contraste, focus trap, aria-labels, keyboard nav)
- [ ] Storybook com variações documentadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: item #2b → `done`
- [ ] Zero violação de regras em docs/rules.md

## Retro

- —
