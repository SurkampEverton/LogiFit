# Roadmap LogiFit

Status: `todo` | `doing` | `done` | `blocked`

Regra: só 1 item pode estar `doing` por vez (ver [rules.md](rules.md) — regra 9).

---

## Fase MVP — Academia + Motor Cross (3 meses)

| # | Funcionalidade | Módulo | Sprint | Status | Dependências |
|---|---|---|---|---|---|
| 1 | Setup de infra (monorepo, CI, observabilidade) | infra | 00 | todo | — |
| 2 | Identidade + Topology (groups/tenants/companies/units + RLS raiz) | auth/tenant | 01a | todo | #1 |
| 3 | RBAC com scope + Consent LGPD | auth/tenant | 01b | todo | #2 |
| 4 | CRM unificado (`members` + histórico) | crm | 02 | todo | #3 |
| 5 | Agenda universal + slots Academia | agenda | 03 | todo | #3, #4 |
| 6 | Financeiro Asaas (planos, boletos, Pix, recorrência, webhooks) | financeiro | 04 | todo | #3, #4 |
| 7 | Controle de acesso Academia (QR code + catraca via Realtime) | acesso | 05 | todo | #4, #5, #6 |
| 8 | Copilot simples (chat ancorado em contexto do aluno) | ia | 06 | todo | #4 |
| 9 | Dashboard "Equilíbrio Vital" (tokens + light/dark) | ui | 07 | todo | #4, #5, #6 |

## Fase 2 — Fisioterapia (3–6 meses pós-MVP)

| # | Funcionalidade | Módulo | Sprint | Status | Dependências |
|---|---|---|---|---|---|
| 10 | Prontuário eletrônico + assinatura ICP-Brasil | fisio | 08 | todo | MVP |
| 11 | Evolução com mídias (Storage criptografado) | fisio | 09 | todo | #10 |
| 12 | Cross-alert: lesão registrada → alerta no treino | cross | 10 | todo | #10, #4 |
| 13 | Generative UI (cards de relatório) | ui/ia | 11 | todo | #8 |

## Fase 3 — Nutrição + Mobile (6–9 meses pós-MVP)

| # | Funcionalidade | Módulo | Sprint | Status | Dependências |
|---|---|---|---|---|---|
| 14 | Antropometria + cardápios | nutri | 12 | todo | MVP |
| 15 | IA Nutri-Agent cruzando log da academia | nutri/ia | 13 | todo | #14, #12 |
| 16 | App nativo Expo (aluno/paciente) | mobile | 14 | todo | MVP estável |
| 17 | Módulo fiscal (Focus NFe) | fiscal | 15 | todo | #6 |

---

## Sprints ativos

| Sprint | Funcionalidade | Início | Fim planejado | Status |
|---|---|---|---|---|
| — | — | — | — | nenhum ativo |

Quando um sprint começa, mover a linha correspondente para esta tabela e atualizar status do item no roadmap acima para `doing`.

---

## Decisões pendentes (viram ADRs quando resolvidas)

- Hardware da catraca (Android box com Expo bare vs ESP32 + API) — decidir antes do Sprint 05
- Estratégia mobile inicial: PWA-only no MVP ou já começar Expo antes da Fase 3 (se iOS push ou Bluetooth virar requisito duro)
- `financial_mode=centralized` real: modelamos como "tenant com só 1 company matriz + N units" ou criamos schema separado? Decidir antes do Sprint 01a
