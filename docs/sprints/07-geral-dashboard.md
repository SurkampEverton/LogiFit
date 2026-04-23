# Sprint 07 — Geral · Dashboard "Equilíbrio Vital"

- **Área:** geral
- **Início:** planejado (depois do Sprint 06)
- **Fim planejado:** +2 semanas
- **Status:** planejado
- **Item do roadmap:** #9

## Goal

Home do operador contextual por role (recepção / gerente / diretor / group_owner) com KPIs do scope correspondente. Tokens de design "Equilíbrio Vital" aplicados em light/dark, sem sombras residuais do shadcn. Esqueleto do cross-alert dispatcher publicado em cima do `domain_events` (consumidor real nasce na Fase 2).

## Critério de aceite

- `/app` redireciona para dashboard contextual baseado em role + scope ativo do JWT
- Gerente de filial vê KPIs da sua company/unit; diretor de rede vê tenant; group_owner vê agregados do group (views `group_*`, nunca dado individual)
- Cards padrão: **Alunos Ativos** · **Faturamento 30d** · **MRR** · **Taxa de Retenção 90d** · **Overdue %** · **Inadimplência por Método** (cartão × PIX × boleto) · **Ocupação Agenda 7d** · **Horário de Pico (semanal)** · **Ocupação por Modalidade** · **Ticket Médio por Aluno** · **Conversão Gympass/TotalPass/Wellhub vs Direto** (quando integração wellness ativa) · **Últimas 10 atividades** (timeline cross-member)
- Toggle light/dark persistente; zero shadow/`box-shadow` residual
- Tokens aplicados: `surface`, `text`, `action-primary`, `success`, `warning`, `danger`
- Cross-alert dispatcher: função genérica `dispatchAlert(event)` com tabela `alert_subscribers` vazia (sem subscribers no MVP — preparado para Fase 2)
- Dashboard atualiza em tempo quase real via Realtime para contadores de agenda/check-ins
- Teste E2E: group_owner com 2 tenants vê agregados; ao "entrar" em 1 tenant, passa a ver detalhes operacionais daquele
- Teste visual (Playwright snapshot) confirma sem sombras no dark mode

## Dependências

- Sprint 02 (members)
- Sprint 03 (agenda — ocupação)
- Sprint 04 (financeiro — receita/MRR/overdue)

## Decisões tomadas / ADRs esperados

- **ADR 0016 (esperado)** — Tokens "Equilíbrio Vital": lista canônica + estratégia light/dark + override dos tokens padrão do shadcn (remover sombras). Fica em `packages/ui/tokens.ts` + `tailwind.config.ts`.
- **Pergunta aberta:** views materializadas vs live queries para KPIs. Começar live; medir latência; se >500ms em p95, materializar. Deferir decisão para o sprint (evitar over-engineering).

## Módulos entregues

Ver [`modulos.md` — Geral](../modulos.md#geral):

- Dashboard "Equilíbrio Vital"
- Cross-alert dispatcher (esqueleto)

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
- [ ] Páginas `/app/dashboard/*` por role
- [ ] Componentes de card reusáveis em `packages/ui/cards/`
- [ ] Realtime counters nos cards de check-in e agenda
- [ ] Redirect `/app` → home contextual
- [ ] Testes unit das queries
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
