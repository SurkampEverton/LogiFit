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

### Added — expansão Academia (sprints 10–15)

- Verificação de gaps contra lista de funcionalidades esperadas para Academia (operacional, técnico, financeiro, retenção, diferencial IA). Cobertura atual cruzada com o que falta; 6 sprints novos + ajustes em 3 existentes.
- **Sprint 10 — Funil de Vendas** (`docs/sprints/10-geral-funil-vendas.md`): `leads`, estágios configuráveis, aulas experimentais, propostas versionadas, conversão automática lead → member. ADR 0022 esperado.
- **Sprint 11 — Prescrições + Biblioteca** (`docs/sprints/11-geral-prescricoes-e-biblioteca.md`): catálogo de `exercises` com vídeos, `workouts` versionados, `prescriptions` polimórficas (kind: workout / meal_plan / fisio_protocol), `workout_sessions` com RPE. ADR 0023 esperado.
- **Sprint 12 — Avaliações Físicas** (`docs/sprints/12-geral-avaliacoes-fisicas.md`): `assessment_types` configuráveis (bioimpedância, dobras, anamnese), `measurements` séries temporais, gráficos de evolução, calculadoras (IMC, Pollock, TMB). Antropometria Nutri (Sprint 20) reusa. ADR 0024 esperado.
- **Sprint 13 — WhatsApp + Régua de Cobrança** (`docs/sprints/13-geral-whatsapp-e-regua-cobranca.md`): provider WhatsApp abstraído (Twilio/Z-API/Meta via ADR 0025), templates aprovados, motor declarativo de régua (evento → ação → delay) via ADR 0026. Canal email via Resend consolidado. Opt-out respeitado.
- **Sprint 14 — DRE + Custos Operacionais** (`docs/sprints/14-geral-dre-custos-operacionais.md`): `cost_categories` (fixos/variáveis), `cost_entries` + recorrências, DRE consolidado com export PDF/CSV, previsibilidade de receita 3 meses.
- **Sprint 15 — IA Preditiva de Churn** (`docs/sprints/15-ia-previsao-churn.md`): pipeline de features por member, modelo preditivo `prob_30d/60d/90d` + top factors (ADR 0027), `churn_interventions` integradas à régua, feedback loop para medir accuracy. **Fecha o MVP.**
- Ajuste no **Sprint 04 Financeiro**: DRE básico promovido de stretch para Commit; `contracts` ganha colunas de trancamento (`pause_*`) + `auto_pause_rule` configurável; job diário avalia regra de pause automático. Eventos `contract.paused`/`resumed`/`auto_paused`.
- Ajuste no **Sprint 07 Dashboard**: cards explícitos "Alunos Ativos", "Faturamento 30d", "Taxa de Retenção 90d", "Horário de Pico", "Ocupação por Modalidade", "Ticket Médio por Aluno" (views SQL nomeadas).
- Ajuste no **Sprint 08 Controle de Acesso**: ADR 0018 passa a cobrir **reconhecimento facial** como modalidade alternativa (ou adicional) ao QR, com consent LGPD específico e embeddings em `member_face_embeddings` via pgvector. Subscribers de `contract.paused` criam `access_blocks`.
- Novos widgets no dashboard do member: `treino` (Sprint 11), `avaliacao` (Sprint 12), `risco` (Sprint 15).
- Renumeração Fase 2/3 em cascata: Fisio 10–13 → **16–19**, Nutri 14–15 → **20–21**, App nativo → **22**, Fiscal → **23**. Prescrição adaptativa IA por RPE listada como módulo futuro pós-22 (depende de app nativo + Sprint 11).

### Added — expansão Fisioterapia (sprints 16–24)

- Verificação de gaps contra lista de funcionalidades esperadas para Fisioterapia (prontuário/atendimento, agenda, financeiro-saúde, conformidade legal, diferenciais). Cobertura atual cruzada com o que falta; 9 sprints Fase 2 + ajustes em 2 sprints MVP.
- **Sprint 16 — Prontuário COFFITO + CID/CIF + ICP-Brasil** (`docs/sprints/16-fisio-prontuario-cid-cif.md`): prontuário versionado com assinatura digital, catálogos CID-11 e CIF globais, templates por especialidade (ortopedia/neuro/respiratória reusa `assessment_types` do Sprint 12), nota corretiva. ADR 0028 esperado.
- **Sprint 17 — Evolução SOAP + Mídias** (`docs/sprints/17-fisio-evolucao-midias.md`): registro por sessão em formato SOAP, anexos categorizados (exame imagem / vídeo execução / documento / foto postural) em Storage criptografado com URL assinada TTL 10min.
- **Sprint 18 — TISS/TUSS + Convênios** (`docs/sprints/18-fisio-tiss-tuss-convenios.md`): cadastro de operadoras + acordos, carteirinhas, autorizações, guias XML v3.05 (consulta + SP/SADT), lotes, conciliação de retorno, controle de glosas. ADR 0029 esperado.
- **Sprint 19 — Comissões e Repasse** (`docs/sprints/19-fisio-comissoes-repasse.md`): `professional_contracts` com condições (% faturado/recebido/fixo/tabela), cálculo automático em eventos financeiros/clínicos, fechamento mensal aprovado, transferência Asaas. Aproveitável por Academia (personal trainer) e Nutri. ADR 0030 esperado.
- **Sprint 20 — Estoque** (`docs/sprints/20-geral-estoque.md`): `stock_items` + movimentações (entrada/saída/ajuste/venda) + saldo por soma + alertas de mínimo + POS simples + inventário. ADR 0031 esperado.
- **Sprint 21 — ANVISA + CNES** (`docs/sprints/21-fisio-anvisa-cnes.md`): cadastro de equipamentos regulados com cronograma de manutenção e calibração, certificados anexados, logs de limpeza do ambiente com checklist, integração CNES (manual no MVP da fase), relatório PDF para fiscalização.
- **Sprint 22 — Portal do Paciente Web (PWA)** (`docs/sprints/22-geral-portal-paciente-web.md`): self-service do member via magic link email/SMS (ADR 0032), agenda, pagamento Asaas, recibos PDF, vídeos de exercícios prescritos com URL assinada, QR dinâmico, prontuário resumido via consent.
- **Sprint 23 — Cross-Alert Lesão → Treino** (`docs/sprints/23-cross-alert-lesao-treino.md`): subscriber de `consulta.signed` com CID de lesão + consent `share_injury_to_training` + validação de franchise (regra 25) → adapta workout com `cid_exercise_contraindications`; instrutor revisa antes de confirmar. ADR 0033 esperado.
- **Sprint 24 — Generative UI v1 (Fecha Fase 2)** (`docs/sprints/24-fisio-generative-ui.md`): framework de tool calls com registro de componentes tipados (PatientCard, EvolutionChart, CidSuggestion, ReportSection); copilot Fisio responde com componentes interativos via streaming SSE. ADR 0034 esperado.
- Ajuste no **Sprint 13 WhatsApp+Régua**: réguas pré-prontas novas — confirmação de agendamento D-1/D-0, manutenção D-7 (Sprint 21), estoque crítico (Sprint 20).
- Ajuste no **Sprint 14 DRE**: dimensão adicional "lucratividade por procedimento" via `invoice_items.service_type` (enriquecimento no Sprint 04 com backfill).
- Renumeração cascata Fase 3: Nutri 20–21 → **25–26**, App nativo 22 → **27**, Fiscal 23 → **28**. Prescrição adaptativa IA por RPE: pós-22 → **pós-27**.
- Novos widgets no dashboard do member: `prontuario` (Sprint 16, com consent cross-module), `evolucao` (Sprint 17), `convenio` (Sprint 18), `alerta_lesao` (Sprint 23).

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
