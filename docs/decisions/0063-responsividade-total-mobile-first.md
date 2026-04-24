# ADR 0063 — Responsividade total (mobile-first + 5 breakpoints + touch)

- **Status:** Accepted
- **Date:** 2026-04-23

## Context

Análise dos perfis de uso reais do LogiFit:

| Role | Dispositivo predominante |
|---|---|
| Recepção academia | Desktop + tablet atrás do balcão |
| Gerente | Desktop (escritório) + celular (visitas às filiais) |
| Personal/instrutor | **Celular** (anda pela academia) + tablet (aulas) |
| Fisioterapeuta | Desktop (consultório) + **tablet** (consulta cabeceira) + celular (deslocamento) |
| Nutricionista | Desktop + tablet |
| Diretor/Group owner | Desktop + celular (dashboard mobile) |
| Aluno/Paciente | **Celular primário**; desktop raro |
| Contador externo | Desktop |

Observações críticas:
1. **Profissional durante atendimento** usa tablet/celular para consultar prontuário — se não for responsivo, volta para papel/desktop separado; fricção inaceitável
2. **Aluno/paciente** (portal Sprint 26) é celular quase exclusivo — PWA precisa ser mobile-first
3. **Operador em campo** (visita de filial, reunião, deslocamento) acessa dashboard no celular
4. **Catraca/QR** (Sprint 08) — paciente abre QR no celular; recepção lê; ambas telas de interação contínua
5. **Atalhos de teclado** (Ctrl+K Command Palette — ADR 0062) não existem em celular; precisa equivalente touch

Hoje o planejamento **menciona** responsividade de forma difusa:
- Sprint 08 tem "UI mobile-first" para checklist de limpeza
- Sprint 26 é PWA mobile
- Nenhum outro sprint tem critério explícito

Sem decisão arquitetural, cada sprint adota um padrão diferente; refatoração massiva vira dívida técnica antes mesmo do MVP fechar.

## Decision

**Mobile-first, total, em todos os sprints.** Toda rota `/app/*` e `/meu/*` (exceto config técnica de admin como `/app/admin/audit` que é naturalmente desktop) **deve** ter layout fluido em 5 breakpoints com testes Playwright que falham se layout quebrar.

### Breakpoints canônicos

Convenção Tailwind v4 padrão + "ultrawide" adicionado:

| Nome | Largura mínima | Device típico |
|---|---|---|
| `default` (base) | 0px | smartphone portrait (iPhone SE/13, Pixel) |
| `sm` | 640px | smartphone landscape · tablet pequeno (iPad mini) |
| `md` | 768px | tablet (iPad, iPad Air) |
| `lg` | 1024px | desktop pequeno · laptop |
| `xl` | 1280px | desktop padrão |
| `2xl` | 1536px | widescreen · monitor grande |

**Target matrix** para testes visuais:
- `iphone-13` (390×844) — mobile portrait
- `pixel-5` (393×851) — mobile portrait (diversificar)
- `ipad-portrait` (768×1024) — tablet portrait
- `ipad-landscape` (1024×768) — tablet landscape
- `desktop-1280` — desktop padrão
- `desktop-1920` — widescreen

### Padrões de adaptação obrigatórios

#### Navegação (`/app/*`) — padrão hamburguer overlay único (atualizado 2026-04-23)

**Decisão:** menu lateral é **overlay em todos os viewports** (mobile + tablet + desktop), acionado por ícone hambúrguer `☰` sempre visível no header. Página de conteúdo ocupa **100% da largura** em todos os dispositivos — menu nunca empurra conteúdo, sempre se sobrepõe com backdrop.

| Viewport | Comportamento |
|---|---|
| `default` (mobile) | ☰ no header → menu overlay ocupa **85% da viewport** (max 320px) + backdrop escuro clicável para fechar; fecha automaticamente ao navegar |
| `sm`/`md` (tablet) | ☰ no header → menu overlay ocupa **320px** (largura fixa); fecha ao clicar fora; swipe para fechar |
| `lg+` (desktop) | ☰ no header → menu overlay **280px** + backdrop; **não fecha** automaticamente ao navegar (user pode mantê-lo aberto por sessão via toggle "fixar"); atalho `Ctrl+B` (ou `Cmd+B`) abre/fecha |

Componente `<SideMenu>` em `packages/ui/layout/side-menu.tsx` gerencia tudo:
- Animação slide-in/out (framer-motion ou CSS transform)
- Focus trap quando aberto (acessibilidade)
- Restore focus no trigger (☰) ao fechar
- Swipe gesture em touch (mobile/tablet)
- Backdrop com `aria-hidden="true"` + tap/click fecha
- Submenus inline (acordeão) — sem drawer aninhado
- Footer com avatar user + settings + logout

**Por que overlay em desktop também** (decisão do usuário 2026-04-23):
- Página ocupa tela toda em qualquer viewport → tabelas densas e dashboards respiram
- Padrão consistente cross-device (user move-se entre celular e desktop e UX é igual)
- Moderno (Vercel dashboard, alguns produtos SaaS modernos)
- Trade-off aceito: mais clique por navegação em desktop é compensado pela **pesquisa global Ctrl+K** (ADR 0062) que vira caminho primário de navegação

Sprint 00b entrega `<SideMenu>` completo **+ registry de itens por módulo com filtro de permissão/vertical/consent**; sprints não implementam navegação própria — cada sprint registra seus itens via `registerMenuItem(meta)` e o componente filtra automaticamente na renderização conforme user logado.

#### Largura do conteúdo (`.main`) — padrão híbrido (atualizado 2026-04-23)

**Decisão:** `<AppLayout>` oferece **3 variantes de largura** para o slot de conteúdo; cada página escolhe a variante adequada.

| Variante | `max-width` | Quando usar |
|---|---|---|
| **Default** (padrão) | **nenhum** — ocupa 100% da viewport | Dashboards, listas, tabelas, gráficos, inboxes — aproveita monitor ultrawide |
| **`.main--constrained`** | 1200px centralizado | Prontuário SOAP, páginas com muito texto, telas de configuração longas (3+ seções), relatórios detalhados |
| **`.main--narrow`** | 720px centralizado | Formulários simples (novo fornecedor, novo member), login/signup, wizard steps, páginas de erro/empty state |

**Motivo:** 100% fixo em todo lugar prejudica legibilidade de texto em telas ultrawide (linhas 200+ caracteres). Max-width fixo em todo lugar desperdiça pixels em dashboards ultrawide (faixas pretas laterais). Híbrido deixa cada página escolher — dashboards espalham, formulários respiram.

**Regra prática:** se a página é majoritariamente **dado tabular, gráficos ou cards lado-a-lado**, use default (100%). Se é majoritariamente **texto corrido ou form longo**, use `constrained` ou `narrow`. Cada sprint define no commit checklist.

**Decisão do usuário 2026-04-23** após observar que o padrão original "`max-width: 1440px` fixo" deixava faixas pretas laterais enormes em monitor ultrawide — violava a própria diretriz "página ocupa 100%" do ADR.

#### Tabelas

Padrão: `<ResponsiveTable>` em `packages/ui` — renderiza `<table>` em `md+` e **`<CardList>`** (cards empilhados) em mobile:

```
Desktop:                         Mobile:
┌────┬────┬────┬────┐           ┌──────────────┐
│ A  │ B  │ C  │ D  │           │ A · B        │
├────┼────┼────┼────┤           │ C · D        │
│ ...│... │... │... │           ├──────────────┤
└────┴────┴────┴────┘           │ ...          │
```

Cada coluna marca `priority: 'always' | 'md' | 'lg'` — só colunas `always` aparecem em mobile; outras ficam atrás de botão "Ver mais".

#### Modais

- `default`/`sm`: **full-screen** (sheet deslizante bottom-up ou fullscreen)
- `md+`: modal centralizado com max-width

Componente `<ResponsiveModal>` decide automaticamente.

#### Formulários

- Grid 2-colunas em `lg+` → **1-coluna stack** em `md-`
- Labels acima do input em mobile (espaço vertical), à esquerda em desktop (opcional)
- Botões primários no **rodapé fixo** em mobile (sticky bottom) para evitar scroll

Componente `<ResponsiveForm>` + hook `useResponsiveForm` padroniza.

#### Dashboard cards

- `default`: **1 coluna** (prioridade definida por `order` no registry)
- `sm`: 2 colunas
- `md`: 3 colunas
- `lg+`: 4 colunas

#### Command Palette (ADR 0062)

- Atalho `Ctrl+K`/`Cmd+K` continua em desktop
- **Mobile**: botão 🔍 sempre visível no header (substituto do atalho)
- Input full-screen em mobile; overlay centralizado em desktop
- Resultados em lista única em mobile; categorizados em desktop

### Touch targets (Apple HIG + Material Guidelines)

- **Botões**: altura mínima **44px** (Apple) / 48dp (Material)
- **Inputs**: altura mínima **48px**
- **Links clicáveis em lista**: área clicável inteira (não só texto)
- **Espaçamento entre targets**: mínimo **8px**
- Utility class Tailwind: `min-h-touch` definida em `tokens.ts` = 44px

### Componentes base mobile-first em `packages/ui`

Sprint 00 entrega esqueleto desses componentes; sprints posteriores consomem **sem exceção** (proibido construir layout próprio duplicado):

```
packages/ui/
  layout/
    app-layout.tsx           # Sidebar desktop ↔ bottom-nav mobile
    portal-layout.tsx        # Layout /meu/* (PWA otimizado)
    responsive-modal.tsx     # Full-screen ↔ centered
    responsive-table.tsx     # Table ↔ card list
    responsive-form.tsx      # Grid ↔ stack
    sticky-footer.tsx        # Rodapé fixo com botões (mobile)
  nav/
    bottom-nav.tsx           # Tab bar inferior
    drawer.tsx               # Gaveta lateral com gesto de swipe
    breadcrumbs.tsx          # Colapsa em mobile
  tokens.ts                  # min-h-touch, safe-area-inset, etc.
```

### Acessibilidade (piso)

Não é escopo total do ADR mas sai junto porque é barato:
- Contraste **WCAG AA** mínimo em tokens "Equilíbrio Vital" (Sprint 07)
- `aria-label` em todos botões sem texto (ícones)
- Ordem de foco coerente (tabulação natural)
- `prefers-reduced-motion` respeitado
- Viewport meta tag correta (`width=device-width, initial-scale=1`)
- Safe-area-inset para iPhone notch/home indicator

### Testes

**Playwright viewport testing** obrigatório em sprints com UI:

```ts
const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },   // iPhone 13
  { name: 'tablet', width: 768, height: 1024 },  // iPad
  { name: 'desktop', width: 1280, height: 800 }, // padrão
];

for (const vp of VIEWPORTS) {
  test(`${vp.name}: agenda renderiza`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('/app/agenda');
    await expect(page).toHaveScreenshot(`agenda-${vp.name}.png`);
    // + assertivas funcionais
  });
}
```

Helper `packages/config/playwright-viewports.ts` exporta matrix para reuso.

**Testes específicos por sprint:**
- Sprint 07: Dashboard renderiza em 3 viewports; bottom nav aparece em mobile; sidebar em desktop
- Sprint 08: QR do aluno legível em mobile portrait
- Sprint 15: Inbox NF-e colapsa em cards em mobile
- Sprint 20/21/22: prontuário + TISS formulários funcionam em tablet (fisio atende com iPad)
- Sprint 26: portal paciente em 5 viewports + instalável como PWA

**Teste de toque:** lint regra custom verifica classes Tailwind `h-` em botões clicáveis: proíbe altura <44px (ex: `h-8` em `<button>` — fail).

## Consequences

### Positivas

- **Profissional atende com iPad/celular** sem fricção — diferencial de mercado
- **Aluno/paciente** tem UX nativa mobile — aumenta engajamento do portal Sprint 26
- **Dev solo** escreve componente uma vez; `<ResponsiveTable>`/`<ResponsiveModal>` decidem layout — zero duplicação
- **Catraca em tablet** (Sprint 08 ADR 0018) é natural — dispositivo fixo já cabe
- **Acessibilidade gratuita** — touch targets grandes ajudam idosos (público fisio) e paciente com dor
- **Reduz dívida técnica** — mobile-first é mais barato de cima para baixo que retrofit

### Negativas (mitigáveis)

- **Custo inicial Sprint 00** — biblioteca de componentes base cresce ~3-5 dias; amortizado por toda aplicação
- **Testes Playwright mais pesados** — cada teste roda em 3 viewports = 3x mais tempo CI; mitigado por **testes visuais só em viewports distintos quando layout muda** (não precisa 3x em testes funcionais)
- **Prontuário complexo em mobile** — SOAP + CID + anexos mal cabe em celular portrait; mitigado por tablet como alvo mínimo em prontuário; celular mostra resumo + link "ver completo no iPad/desktop"
- **Tabelas densas ficam card-list em mobile** — perde comparação visual; compensado por filtros ricos + busca (Command Palette Ctrl+K / 🔍 em mobile)
- **Admin técnico** (audit log, DRE detalhado) pode justificar "desktop-only" — aceita se ADR de sprint justificar; não vira padrão

### Riscos não endereçados

- **Offline-first em catraca/PWA** — responsividade é sobre layout; offline é outro problema (stretch Sprint 08/26)
- **Print** — relatórios fiscais, prontuário em PDF seguem layout de impressão próprio; não é escopo responsivo
- **Telas muito pequenas** (Apple Watch, smartwatch) — fora do escopo LogiFit

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Desktop-only no MVP, mobile em Fase 2 | Profissional atende com iPad/celular; PT anda pela academia; aluno é mobile primário; MVP sem responsividade não vende |
| App nativo separado para mobile (React Native já no MVP) | Sprint 35 (app nativo Expo) já planejado; duplicar SPA + nativa é overkill; PWA cobre 90% |
| Responsive como "melhor esforço" sem regra dura | Cada sprint adota padrão próprio; dívida técnica garantida; retrofit caro |
| Bootstrap/Mantine em vez de Tailwind + shadcn | Stack já definido (ADR 0001); shadcn + Tailwind fazem responsive nativo; zero razão para trocar |

## Escopo de impacto

**Novo ADR:** este (0063).

**Regra nova:** [regra 31](../rules.md) — todo componente de UI em sprints `/app/*` e `/meu/*` passa nos 3 viewports canônicos (mobile 390, tablet 768, desktop 1280) no teste visual Playwright; exceção requer ADR de sprint justificando (ex: `/app/admin/audit`).

**Sprints ajustados:**
- **00** — biblioteca de componentes base mobile-first em `packages/ui/layout/*`, `packages/ui/nav/*`; tokens `min-h-touch`, `safe-area-inset`; viewport helper em `packages/config/playwright-viewports.ts`; regra ESLint/Biome "no-desktop-only-layout"
- **07** — dashboard com bottom nav em mobile + sidebar em desktop; cards colapsam 4→3→2→1 conforme breakpoint; Command Palette ganha botão 🔍 visível em mobile (substituto do Ctrl+K); testes visuais em 3 viewports
- **08** — QR do aluno otimizado para celular portrait; UI recepção da catraca suporta tablet landscape (dispositivo fixo)
- **15, 17, 20, 22, 36** — inboxes/listas complexas usam `<ResponsiveTable>`; formulários usam `<ResponsiveForm>`; modais usam `<ResponsiveModal>`
- **26** — portal paciente já é mobile-first por natureza; **confirma** padrões PWA (instalação, offline shell, safe-area); viewport testing explícito
- **Todos os sprints futuros** — critério de aceite "UI renderiza em mobile/tablet/desktop" adicionado ao checklist Commit (template atualizado)

**Template atualizado:** `docs/sprints/_template.md` ganha linha "Responsividade: mobile (390) + tablet (768) + desktop (1280) testados" no Definition of Done.

**Docs:**
- `docs/modulos.md` — módulo "Componentes base responsivos" em Fundação
- `CHANGELOG.md` — entrada
- `CLAUDE.md` — regra operacional 16 sobre responsividade

## Related

- Reforça [ADR 0001 — Stack base](0001-stack-base.md) (Tailwind v4 + shadcn já são mobile-first)
- Reforça [ADR 0016 esperado — Tokens "Equilíbrio Vital"](../sprints/07-geral-dashboard.md) — tokens contemplam breakpoints
- Reforça [ADR 0062 — Pesquisa global](0062-pesquisa-global-command-palette.md) — Ctrl+K tem fallback visual em mobile
- Integra com Sprint 35 futuro (app nativo Expo) — PWA já cobre; nativo traz Bluetooth + push
- Fonte: Apple Human Interface Guidelines (touch targets), Material Design 3 (breakpoints), WCAG 2.1 AA (acessibilidade), Tailwind v4 docs, shadcn/ui responsiveness patterns
