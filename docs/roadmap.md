# Roadmap LogiFit

Linha do tempo + controle de evolução. Para visão funcional (módulos por área), ver [`modulos.md`](modulos.md).

**Status possíveis:** `todo` · `doing` · `done` · `blocked` (regra 9: 1 `doing` por vez — ver [rules.md](rules.md)).

---

## Fase MVP — Academia + Motor Cross + Comercial + Engajamento

Tabela enriquecida com controle de evolução. **Início / Fim** são datas reais (YYYY-MM-DD), preenchidas quando o sprint vira `doing`/`done`. **%** é aproximação grosseira do checklist Commit do sprint (0/25/50/75/100). **PR** é link para o PR principal quando existir.

| # | Sprint | Funcionalidade | Status | Início | Fim | % | Bloqueios | PR |
|---|---|---|---|---|---|---|---|---|
| 1 | [00](sprints/00-setup-infra.md) | Setup de infra (monorepo, CI, observabilidade) | todo | — | — | 0 | — | — |
| 2 | [01a](sprints/01a-identidade-e-topology.md) | Identidade + Topology (groups/tenants/companies/units + RLS raiz) | todo | — | — | 0 | depende #1 | — |
| 3 | [01b](sprints/01b-rbac-e-consent.md) | RBAC com scope + grants diretos + Consent LGPD | todo | — | — | 0 | depende #2 | — |
| 4 | [02](sprints/02-geral-crm-pessoas.md) | CRM unificado (`members` + timeline + dashboard do member) | todo | — | — | 0 | depende #3 | — |
| 5 | [03](sprints/03-geral-agenda-universal.md) | Agenda universal + modalidades Academia | todo | — | — | 0 | depende #3, #4 | — |
| 6 | [04](sprints/04-geral-financeiro-asaas.md) | Financeiro Asaas core (planos, contratos, cobranças, webhooks) | todo | — | — | 0 | depende #3, #4 | — |
| 10 | [05](sprints/05-geral-ofertas-comerciais.md) | Ofertas comerciais (promoções, pacotes, referrals, cashback) | todo | — | — | 0 | depende #6 | — |
| 8 | [06](sprints/06-geral-copilot-base.md) | Copilot base (chat IA ancorado em member + cache + rate-limit) | todo | — | — | 0 | depende #4 | — |
| 9 | [07](sprints/07-geral-dashboard.md) | Dashboard "Equilíbrio Vital" + esqueleto cross-alert dispatcher | todo | — | — | 0 | depende #4, #5, #6 | — |
| 7 | [08](sprints/08-academia-controle-acesso.md) | Controle de acesso Academia (QR HMAC + catraca + bloqueio inadimplência) | todo | — | — | 0 | depende #4, #5, #6 | — |
| 11 | [09](sprints/09-geral-engajamento.md) | Engajamento v1 (conquistas + brindes + metas com progresso automático) | todo | — | — | 0 | depende #8 (eventos de check-in) | — |

> **Ordem dos sprints:**
> - 05 Ofertas depois de 04 (precisa de `plans`/`contracts`/`invoices`)
> - 06 Copilot depois de 04 (só precisa de member e contexto financeiro básico)
> - 07 Dashboard depois de 06 (consumidor natural de KPIs + tokens aplicados)
> - 08 Acesso Academia depois de 07 (consome Realtime do dashboard + overdue do 04)
> - 09 Engajamento por último (consumidor de eventos de todos os outros — check-in, pagamento, agendamento)

---

## Fase 2 — Fisioterapia (3–6 meses pós-MVP, alto-nível)

| # | Funcionalidade | Módulo | Sprint | Status | Dependências |
|---|---|---|---|---|---|
| 12 | Prontuário eletrônico + assinatura ICP-Brasil | fisio | 10 | futuro | MVP |
| 13 | Evolução com mídias (Storage criptografado) | fisio | 11 | futuro | #12 |
| 14 | Cross-alert: lesão registrada → alerta no treino | cross | 12 | futuro | #12, #4 |
| 15 | Generative UI (cards de relatório) | ui/ia | 13 | futuro | #8 |

---

## Fase 3 — Nutrição + Mobile (6–9 meses pós-MVP, alto-nível)

| # | Funcionalidade | Módulo | Sprint | Status | Dependências |
|---|---|---|---|---|---|
| 16 | Antropometria + cardápios | nutri | 14 | futuro | MVP |
| 17 | IA Nutri-Agent cruzando log da academia | nutri/ia | 15 | futuro | #16, #14 |
| 18 | App nativo Expo (aluno/paciente) | mobile | 16 | futuro | MVP estável |
| 19 | Módulo fiscal (Focus NFe) | fiscal | 17 | futuro | #6 |

---

## Decisões pendentes (viram ADRs quando resolvidas)

- Hardware da catraca (Android+Expo bare vs ESP32+câmera vs iPad+relé) — decidir no Sprint 08 (ADR 0018)
- Estratégia mobile inicial: PWA-only no MVP ou já começar Expo antes da Fase 3 (se iOS push ou Bluetooth virar requisito duro)
- DSL de regras de conquista (JSON schema vs JS sandbox) — decidir no Sprint 09 (parte do ADR 0021)

---

## Operação

- Quando um sprint começa: mudar `status → doing`, preencher `Início`; regra 9 (1 `doing` por vez)
- Durante: atualizar `%` (0/25/50/75/100) quando bater cada 25% do checklist Commit
- Se bloquear: `status → blocked`, preencher `Bloqueios` com 1 linha + data do bloqueio
- Ao fechar: `status → done`, preencher `Fim`, `PR`, validar DoD
