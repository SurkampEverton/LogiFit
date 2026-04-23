# Roadmap LogiFit

Linha do tempo + controle de evolução. Para visão funcional (módulos por área), ver [`modulos.md`](modulos.md).

**Status possíveis:** `todo` · `doing` · `done` · `blocked` (regra 9: 1 `doing` por vez — ver [rules.md](rules.md)).

---

## Fase MVP — Academia + Motor Cross + Comercial + Engajamento + Retenção

Tabela enriquecida com controle de evolução. **Início / Fim** são datas reais (YYYY-MM-DD), preenchidas quando o sprint vira `doing`/`done`. **%** é aproximação grosseira do checklist Commit do sprint (0/25/50/75/100). **PR** é link para o PR principal quando existir.

| # | Sprint | Funcionalidade | Status | Início | Fim | % | Bloqueios | PR |
|---|---|---|---|---|---|---|---|---|
| 1 | [00](sprints/00-setup-infra.md) | Setup de infra (monorepo, CI, observabilidade) | todo | — | — | 0 | — | — |
| 2 | [01a](sprints/01a-identidade-e-topology.md) | Identidade + Topology (groups/tenants/companies/units + RLS raiz) | todo | — | — | 0 | depende #1 | — |
| 3 | [01b](sprints/01b-rbac-e-consent.md) | RBAC com scope + grants diretos + Consent LGPD | todo | — | — | 0 | depende #2 | — |
| 4 | [02](sprints/02-geral-crm-pessoas.md) | CRM unificado (`members` + timeline + dashboard do member) | todo | — | — | 0 | depende #3 | — |
| 5 | [03](sprints/03-geral-agenda-universal.md) | Agenda universal + modalidades Academia | todo | — | — | 0 | depende #3, #4 | — |
| 6 | [04](sprints/04-geral-financeiro-asaas.md) | Financeiro Asaas (planos, contratos, cobranças, trancamento, DRE básico) | todo | — | — | 0 | depende #3, #4 | — |
| 10 | [05](sprints/05-geral-ofertas-comerciais.md) | Ofertas comerciais (promoções, pacotes, referrals, cashback) | todo | — | — | 0 | depende #6 | — |
| 8 | [06](sprints/06-geral-copilot-base.md) | Copilot base (chat IA ancorado em member + cache + rate-limit) | todo | — | — | 0 | depende #4 | — |
| 9 | [07](sprints/07-geral-dashboard.md) | Dashboard "Equilíbrio Vital" + cross-alert dispatcher | todo | — | — | 0 | depende #4, #5, #6 | — |
| 7 | [08](sprints/08-academia-controle-acesso.md) | Controle de acesso Academia (QR HMAC + facial opcional + catraca + bloqueio) | todo | — | — | 0 | depende #4, #5, #6 | — |
| 11 | [09](sprints/09-geral-engajamento.md) | Engajamento v1 (conquistas + brindes + metas) | todo | — | — | 0 | depende #8 | — |
| 12 | [10](sprints/10-geral-funil-vendas.md) | Funil de vendas (leads, aula experimental, propostas, conversão) | todo | — | — | 0 | depende #02, #03, #04, #05 | — |
| 13 | [11](sprints/11-geral-prescricoes-e-biblioteca.md) | Prescrições + biblioteca de exercícios com vídeos (workouts, RPE) | todo | — | — | 0 | depende #02 | — |
| 14 | [12](sprints/12-geral-avaliacoes-fisicas.md) | Avaliações físicas (bioimpedância, dobras, anamnese, gráficos evolução) | todo | — | — | 0 | depende #02 | — |
| 15 | [13](sprints/13-geral-whatsapp-e-regua-cobranca.md) | WhatsApp + régua de cobrança declarativa | todo | — | — | 0 | depende #04, #10 | — |
| 16 | [14](sprints/14-geral-dre-custos-operacionais.md) | DRE completo + custos operacionais + previsibilidade de receita | todo | — | — | 0 | depende #04 | — |
| 17 | [15](sprints/15-ia-previsao-churn.md) | IA preditiva de churn + intervenções de retenção | todo | — | — | 0 | depende #02–#14 | — |

> **Ordem dos sprints:**
> - Fundação (00, 01a, 01b) primeiro
> - Motor cross base (02 CRM → 03 Agenda → 04 Financeiro) é espinha
> - Ofertas (05) estende Financeiro; Copilot (06) e Dashboard (07) pluggam em cima dos dados
> - Acesso Academia (08) consome Realtime do Dashboard + overdue do Financeiro
> - Engajamento (09) consome eventos de tudo acima
> - Funil (10) abre antes do aluno chegar; Prescrições (11) e Avaliações (12) atendem o aluno ativo
> - WhatsApp+Régua (13) opera cobrança e follow-up de lead
> - DRE completo (14) fecha a visão do gestor
> - Churn (15) é o último; usa dados acumulados dos outros 14

---

## Fase 2 — Fisioterapia (alto-nível)

| # | Funcionalidade | Módulo | Sprint | Status | Dependências |
|---|---|---|---|---|---|
| 18 | Prontuário eletrônico + assinatura ICP-Brasil | fisio | 16 | futuro | MVP |
| 19 | Evolução com mídias (Storage criptografado) | fisio | 17 | futuro | #18 |
| 20 | Cross-alert: lesão registrada → alerta no treino | cross | 18 | futuro | #18, #11 |
| 21 | Generative UI (cards de relatório) | ui/ia | 19 | futuro | #8 |

---

## Fase 3 — Nutrição + Mobile (alto-nível)

| # | Funcionalidade | Módulo | Sprint | Status | Dependências |
|---|---|---|---|---|---|
| 22 | Cardápios (reusa prescrições polimórficas do #11) + antropometria (reusa avaliações do #12) | nutri | 20 | futuro | MVP |
| 23 | IA Nutri-Agent cruzando log da academia | nutri/ia | 21 | futuro | #22, #18 |
| 24 | App nativo Expo (aluno/paciente) | mobile | 22 | futuro | MVP estável |
| 25 | Módulo fiscal (Focus NFe) | fiscal | 23 | futuro | #6 |
| 26 | **Prescrição adaptativa IA por RPE** (ajuste de carga automático) | academia/ia | pós-22 | futuro | #11, #24 (app nativo com input RPE em tempo real) |

---

## Decisões pendentes (viram ADRs quando resolvidas)

- Hardware da catraca + modalidade de auth (QR / facial / ambos) — decidir no Sprint 08 (ADR 0018)
- DSL de regras de conquista — decidir no Sprint 09 (parte do ADR 0021)
- Provider WhatsApp (Twilio / Z-API / Meta direto) — decidir no Sprint 13 (ADR 0025)
- Modelo de churn (API externa / local / serviço dedicado) — decidir no Sprint 15 (ADR 0027)

---

## Operação

- Quando um sprint começa: mudar `status → doing`, preencher `Início`; regra 9 (1 `doing` por vez)
- Durante: atualizar `%` (0/25/50/75/100) quando bater cada 25% do checklist Commit
- Se bloquear: `status → blocked`, preencher `Bloqueios` com 1 linha + data do bloqueio
- Ao fechar: `status → done`, preencher `Fim`, `PR`, validar DoD
