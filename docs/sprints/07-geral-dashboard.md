# Sprint 07 — Geral · Dashboard "Equilíbrio Vital"

- **Área:** geral
- **Início:** planejado (depois do Sprint 06)
- **Fim planejado:** +2 semanas
- **Status:** planejado
- **Item do roadmap:** #9

## Goal

Home do operador contextual por role (recepção / gerente / diretor / group_owner) com KPIs do scope correspondente. Tokens de design "Equilíbrio Vital" aplicados em light/dark, sem sombras residuais do shadcn. **Pesquisa global via Command Palette (Ctrl+K / Cmd+K)** cobrindo 7 tipos de entidade (pessoas, members, leads, suppliers, users, profissionais, agendamentos, AP/AR, settings, quick actions) — ADR 0062. **Modo Solo (ADR 0069)** detecta `tenants.mode='solo'` e renderiza visão simplificada (agenda do dia + cobranças + resumo mensal). Cross-alert dispatcher + handlers pro **MVP (ADR 0070)**: contraindicações CID×exercício, overtraining detectado, balanço calórico crítico, adesão baixa, mudança de peso brusca.

## Critério de aceite

- `/app` redireciona para dashboard contextual baseado em role + scope ativo do JWT
- Gerente de filial vê KPIs da sua company/unit; diretor de rede vê tenant; group_owner vê agregados do group (views `group_*`, nunca dado individual)
- Cards padrão: **Alunos Ativos** · **Faturamento 30d** · **MRR** · **Taxa de Retenção 90d** · **Overdue %** · **Inadimplência por Método** (cartão × PIX × boleto) · **Ocupação Agenda 7d** · **Horário de Pico (semanal)** · **Ocupação por Modalidade** · **Ticket Médio por Aluno** · **Conversão Gympass/TotalPass/Wellhub vs Direto** (quando integração wellness ativa) · **Últimas 10 atividades** (timeline cross-member)
- Toggle light/dark persistente; zero shadow/`box-shadow` residual
- **Layout responsivo (ADR 0063 atualizado):** padrão **hamburger overlay único** em todos os viewports — ícone `☰` sempre visível no header abre `<SideMenu>` (Sprint 00b) como overlay; **página ocupa 100% da largura** em mobile/tablet/desktop; cards do dashboard colapsam 4→3→2→1 conforme breakpoint
- **Navegação principal via `<SideMenu>` do Sprint 00b** — Sprint 07 não implementa sidebar própria; apenas registra itens do módulo "Início" (Home/Dashboard por role) via `registerMenuItem()`
- **Command Palette em touch:** botão 🔍 sempre visível no header (ao lado do ☰) em mobile substitui atalho Ctrl+K que não existe em celular; input da palette fica full-screen em mobile
- Tokens aplicados: `surface`, `text`, `action-primary`, `success`, `warning`, `danger`
- Cross-alert dispatcher: função genérica `dispatchAlert(event)` com tabela `alert_subscribers` vazia (sem subscribers no MVP — preparado para Fase 2)
- Dashboard atualiza em tempo quase real via Realtime para contadores de agenda/check-ins
- Teste E2E: group_owner com 2 tenants vê agregados; ao "entrar" em 1 tenant, passa a ver detalhes operacionais daquele
- Teste visual (Playwright snapshot) confirma sem sombras no dark mode
- Teste visual em 3 viewports canônicos (mobile 390, tablet 768, desktop 1280) — layout adapta; zero overflow horizontal em mobile; touch targets ≥44px (regra 31)
- **Pesquisa global (ADR 0062):** atalho `Ctrl+K` (Windows/Linux) e `Cmd+K` (Mac) abre `<CommandPalette>` em qualquer página; busca retorna resultados categorizados por tipo (Pessoas · Agendamentos · Financeiro · Configurações · Ações rápidas); navegação por setas + Enter; modificadores `>` ações / `/` rotas / `@` pessoas / `#` tags; debounce 200ms; histórico local
- Teste E2E: recepção busca "maria" → vê member "Maria Silva" mas **não** vê prontuários (sem `prontuario.read`); audit não grava (não clicou em sensível)
- Teste E2E: fisio busca "dor lombar" → acha consultas com essa descrição; clicar grava `audit_log` com termo + resultado
- Teste E2E: `Cmd+K` + `> novo` → mostra ações rápidas "Novo member", "Novo agendamento", "Nova AP" filtradas por permission do user

## Dependências

- Sprint 02 (members)
- Sprint 03 (agenda — ocupação)
- Sprint 04 (financeiro — receita/MRR/overdue)

## Decisões tomadas / ADRs esperados

- **ADR 0016 (esperado)** — Tokens "Equilíbrio Vital": lista canônica + estratégia light/dark + override dos tokens padrão do shadcn (remover sombras). Fica em `packages/ui/tokens.ts` + `tailwind.config.ts`.
- [ADR 0062 — Pesquisa global (Command Palette Ctrl+K)](../decisions/0062-pesquisa-global-command-palette.md) — accepted
- **Pergunta aberta:** views materializadas vs live queries para KPIs. Começar live; medir latência; se >500ms em p95, materializar. Deferir decisão para o sprint (evitar over-engineering).

## Módulos entregues

Ver [`modulos.md` — Geral](../modulos.md#geral):

- Dashboard "Equilíbrio Vital"
- Cross-alert dispatcher (esqueleto)
- **Pesquisa global (Command Palette Ctrl+K)** com 7 tipos indexados no MVP + API de registro para sprints posteriores adicionarem seus tipos

## Rotas Next.js

- `/app` — home redirecionando por role
- `/app/dashboard/recepcao` — check-ins ao vivo + agenda do dia + ausências
- `/app/dashboard/gerente` — KPIs da company + alertas operacionais
- `/app/dashboard/diretor` — visão tenant (todas companies)
- `/app/dashboard/grupo` — group_owner com agregados cross-tenant
- `/app/settings/tema` — toggle e preview dos tokens

## Server Actions + API Routes

Server Actions minimalistas (`apps/web/app/dashboard/actions.ts`):

- `getDashboardData(scope)` — `scope ∈ {unit, company, tenant, group}`; determina queries e retorna KPIs serializáveis

Sem nova API Route. Realtime via Supabase client direto (para live counters).

## Schemas Drizzle (esperado)

Nenhuma tabela de domínio nova. Criar apenas:

- Views: `dashboard_kpis_company`, `dashboard_kpis_tenant`, `dashboard_revenue_30d`, `dashboard_ocupacao_7d` — em `packages/db/views/` como SQL raw
- Views agregadas do group: `group_metrics`, `group_revenue_30d` (antecipa uso do group_owner — preview do que Fase 2 detalha)
- Tabela `alert_subscribers` — `id`, `tenant_id`, `event_kind text`, `target_role text`, `active bool`. Vazia no MVP — preparação para Fase 2.
- **Tabela `search_index`** (ADR 0062) — `id uuid pk`, `tenant_id`, `source_table text`, `source_id uuid`, `kind text`, `label text`, `subtitle text`, `url text`, `searchable_text text`, `search_vector tsvector`, `required_permission text`, `required_vertical text`, `required_consent_purpose text`, `company_id nullable`, `is_sensitive bool default false`, `updated_at`. Índices: GIN em `search_vector`, GIN em `searchable_text` (trigram), `(tenant_id, kind)`. Pode virar **materialized view** se latência de write ficar >50ms p95.
- **Tabela `search_telemetry`** (ADR 0062) — `id`, `tenant_id`, `user_id`, `query text`, `result_kind_clicked text nullable`, `result_id_clicked uuid nullable`, `results_count int`, `at timestamptz`. Usado para evolução de ranking + detectar gaps (termo buscado sem resultado).

**RLS das views:** herda do tenant_id + scope; views do group só liberam para role `group_owner`.

## Eventos de domínio emitidos

Dashboard **consome** mas também publica 1 evento específico do dispatcher:

- `alert.dispatched` — `{ alert_id, source_event_kind, target_role, at }` — log quando algum subscriber é acionado (ainda 0 no MVP)

Não publica eventos de negócio; só renderiza os dos outros sprints.

## Commit (checklist)

- [ ] Tokens "Equilíbrio Vital" em `packages/ui/tokens.ts` + `tailwind.config.ts`
- [ ] Override do shadcn para remover `box-shadow` e `drop-shadow` padrão
- [ ] Toggle light/dark com `next-themes` + preferência por tenant
- [ ] Views SQL em `packages/db/views/` aplicadas via migration:
   - `dashboard_alunos_ativos` (members ativos por company/unit)
   - `dashboard_faturamento_30d` (soma de invoices paid)
   - `dashboard_mrr` (valor de contratos ativos normalizado por ciclo)
   - `dashboard_retencao_90d` (cohort: members ativos hoje / members ativos há 90d)
   - `dashboard_ocupacao_agenda_7d` (% de slots ocupados)
   - `dashboard_horario_pico` (heatmap de check-ins por hora × dia semana)
   - `dashboard_ocupacao_modalidade` (check-ins ou appointments por modalidade)
   - `dashboard_ticket_medio` (valor médio por member ativo)
   - `dashboard_overdue_pct`
   - `dashboard_overdue_by_method` (overdue segmentado: cartão, PIX, boleto — Sprint 04 Asaas fornece o `payment_method`)
   - `dashboard_wellness_conversion` (conversão de leads Gympass/TotalPass/Wellhub vs leads diretos — preview; view vazia até Sprint de Integrações Wellness existir, mas card já está mapeado)
- [ ] Tabela `alert_subscribers` (esqueleto)
- [ ] Função `dispatchAlert` em `packages/ai/alerts.ts` — itera subscribers registrados, publica
- [ ] **API pública `registerCrossAlertHandler({ event, handler, requiredPermission? })`** em `packages/ai/alerts/registry.ts` — sprints consumidores (Sprint 08 acesso bloqueios, Sprint 13 régua, Sprint 19 churn, Sprint 27 lesão→treino, Sprint 32 device alerts, Sprint 33 exame crítico) registram handlers declarativamente; dispatcher invoca em ordem + audit
- [ ] Server Action `getDashboardData`
- [ ] Páginas `/app/dashboard/*` por role — usando `<AppLayout>` do Sprint 00 (página 100% viewport; navegação via overlay `<SideMenu>` do Sprint 00b)
- [ ] **Registrar itens do módulo "Início" no `<SideMenu>`** via `registerMenuItem()`: Home (redirect por role), Dashboard Recepção (permission `dashboard.recepcao`), Dashboard Gerente (permission `dashboard.gerente`), Dashboard Diretor, Dashboard Grupo (só role `group_owner`)
- [ ] Botão 🔍 do Command Palette visível no header (ao lado do ☰); atalho Ctrl+K continua funcional em desktop (ADR 0062 + 0063)
- [ ] Componentes de card reusáveis em `packages/ui/cards/`
- [ ] Realtime counters nos cards de check-in e agenda
- [ ] Redirect `/app` → home contextual
- [ ] Testes unit das queries
- [ ] **Pesquisa global (ADR 0062):** tabela `search_index` + triggers `search_index_sync()` em `persons`, `members`, `leads`, `suppliers`, `users`, `appointments`, `accounts_payable`, `accounts_receivable` (7 tipos MVP) + tabela `search_telemetry`
- [ ] Extensões PostgreSQL `pg_trgm` + `unaccent` (Sprint 00 prepara; aqui usa)
- [ ] Server Action `globalSearch(query, { kinds?, limit })` — query em `search_index` com filtros RLS + `has_permission()` + vertical + consent + regra 25
- [ ] API Route `GET /api/search?q=&kinds=&limit=` — wrapper do Server Action; rate limit 30req/min por user
- [ ] Componente `<CommandPalette>` em `packages/ui` — overlay, input com auto-foco, resultados categorizados, navegação por setas, modificadores `>`/`/`/`@`/`#`, debounce 200ms, TanStack Query, histórico local 10 últimos
- [ ] Atalho global `Ctrl+K` (Windows/Linux) + `Cmd+K` (Mac) no layout root + hint clicável `[⌘K]` no header (adapta texto conforme OS detectado)
- [ ] **API `registerQuickAction({ label, icon, url, shortcut?, requiredPermission?, requiredVertical? })`** em `packages/ui/command-palette/registry.ts` — sprints registram ações: "Novo member", "Novo agendamento", "Nova AP", "Emitir NFS-e", "Registrar OCR boleto", etc. (~20 no MVP)
- [ ] Registro estático de rotas `/app/settings/*` como `kind='setting'`
- [ ] Audit em `audit_log`: clique em resultado `is_sensitive=true` grava `{ user_id, action: 'search_access', term, result_kind, result_id }`
- [ ] Regra 30 nova em `docs/rules.md`: módulo novo com dado pesquisável **deve** registrar-se em `search_index` com `required_permission` explícita
- [ ] Testes E2E: 4 roles vendo scopes diferentes; group_owner só agregados
- [ ] Teste visual Playwright: sem sombras no dark
- [ ] Feature flag `dashboard_v1`
- [ ] ADR 0016 publicado

## Stretch

- [ ] Card customizável (usuário escolhe quais KPIs ver)
- [ ] Export dashboard como PDF (Resend envia semanal)
- [ ] Benchmark latência + decisão materializar (vira ADR se for o caso)

## Log

- —

## Definition of Done

- [ ] Feature flag `dashboard_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] RLS verificada (gerente não vê tenant; group_owner não vê individual)
- [ ] Teste visual passa (zero sombra residual)
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 06 → `done`, item #9 → `done`
- [ ] Faltam Sprint 08 (Acesso Academia) e Sprint 09 (Engajamento) para fechar MVP
- [ ] Zero violação de regras

## Retro

- —
