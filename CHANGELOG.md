# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Added
- ADR 0010 — `financial_mode=centralized` usa 1 matriz + N units (sem schema separado)
- `docs/modulos.md` — catálogo de módulos do sistema agrupado por área (fundação / geral / academia / fisio / nutri) com "quais verticais usam" e "sprint alvo"
- Sprints MVP 02–07 detalhados em formato profundo (módulos · rotas · Server Actions/API Routes · schemas Drizzle · eventos de domínio · ADRs esperados): `02-geral-crm-pessoas.md`, `03-geral-agenda-universal.md`, `04-geral-financeiro-asaas.md`, `05-geral-copilot-base.md`, `06-geral-dashboard.md`, `07-academia-controle-acesso.md`
- Módulo "Dashboard do member" no catálogo: `/app/members/[id]` vira home com grid de widgets; Sprint 02 entrega layout + widget inicial (dados + timeline resumida) via `<MemberWidgetSlot />`; Sprints 03/04/05/07 contribuem widgets de agenda, financeiro, copilot e acessos
- Modelo de visibilidade do Dashboard do member com 4 gates — role (`requiredPermissions`), vertical (`requiredVertical`), presença (`showWhen(member)`) e consent (`consentPurpose` quando cross-module). Matriz completa role × vertical × consent por widget documentada em `docs/modulos.md`; cada sprint registra widget via `registerMemberWidget(meta)` do registry exportado em `packages/ui/members/registry.ts`
- Modelo de autorização expandido no Sprint 01b: além de `user_roles`, agora há **role custom por tenant** (admin edita `role_permissions`) e **grants diretos** via `user_permissions` (exceção pontual user → permission com `expires_at` + `reason`). Policies RLS fazem union entre as duas fontes via função SQL `has_permission(...)`. Atende caso de uso "liberar financeiro para uma pessoa específica" sem inflacionar roles. ADR 0019 esperado no sprint. Documentado em `docs/acesso-e-autorizacao.md` e `docs/modulos.md`
- MVP expandido com 2 sprints novos: **Sprint 05 Ofertas Comerciais** (promoções, pacotes/bundles, appointment_credits, referrals, cashback stretch) — ADR 0020 esperado; e **Sprint 09 Engajamento** (conquistas com regras declarativas, brindes com workflow de entrega, metas com progresso automático) — ADR 0021 esperado
- Renumeração dos sprints: Copilot 05→06, Dashboard 06→07, Acesso Academia 07→08. Ordem reflete dependências (Ofertas depois de Financeiro; Engajamento por último como consumidor de eventos de todos). Fases 2/3 renumeradas em cascata (Fisio 10–13, Nutri 14–15, transversais 16–17)
- Widgets novos no dashboard do member: `creditos` (Sprint 05), `conquistas` e `metas` (Sprint 09). Matriz de visibilidade em `docs/modulos.md` atualizada
- Regra 11 em `CLAUDE.md`: nunca path absoluto em doc versionada

### Changed
- Revisão de documentação pós-estrutura: paths absolutos removidos de `docs/arquitetura.md` e `docs/plano-estrutura.md` (projeto é usado em múltiplas máquinas, só caminhos relativos a partir da raiz do repo); nota de "documento histórico" no topo de `docs/plano-estrutura.md`; `domain_events` adicionado às "Tabelas mestras do MVP" em `docs/arquitetura.md`; linguagem de troca de contexto unificada em `docs/acesso-e-autorizacao.md`; seção "Reanálise Crítica" removida de `docs/arquitetura.md`; `financial_mode` removido da lista de "Decisões pendentes" em `docs/roadmap.md` (agora endereçado pela ADR 0010)
- `docs/roadmap.md` reformulado: tabela Fase MVP com colunas de controle de evolução (Status / Início / Fim / % / Bloqueios / PR); seção "Sprints ativos" removida (redundante com as colunas); ordem dos sprints 05–07 ajustada (Copilot → Dashboard → Acesso) refletindo dependências técnicas
- `CLAUDE.md` seção "Documentação de referência" aponta para `docs/modulos.md`
- Regra 10 (`docs/rules.md` + `CLAUDE.md`): commits vão direto em `main` (dev solo, sem PR review obrigatório). Branches `feat/*`/`fix/*`/`chore/*`/`docs/*` ficam opcionais — só para trabalho longo, arriscado ou que precisa ser testado isolado. Regra 14 também ajustada (era "todo PR", agora "todo commit")

### Fixed
- —

### Security
- —

---

## [0.0.0] - 2026-04-22

### Added
- Documentação inicial: `docs/arquitetura.md`, `docs/rules.md`, `docs/multiempresa.md`, `docs/acesso-e-autorizacao.md`, `docs/roadmap.md`
- ADRs 0001–0009 em `docs/decisions/`
- Templates de sprint em `docs/sprints/` (template + Sprint 00, 01a, 01b)
- `CLAUDE.md` na raiz (contexto persistente para Claude Code)
- `.github/pull_request_template.md` (checklist de PR)
- `docs/plano-estrutura.md` (plano histórico de estruturação)
