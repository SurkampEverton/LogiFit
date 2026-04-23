# Roadmap LogiFit

Linha do tempo + controle de evolução. Para visão funcional (módulos por área), ver [`modulos.md`](modulos.md).

**Status possíveis:** `todo` · `doing` · `done` · `blocked` · `futuro` (regra 9: 1 `doing` por vez — ver [rules.md](rules.md)).

---

## Fase MVP — Academia + Motor Cross + Comercial + Engajamento + Retenção

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
| 15 | [13](sprints/13-geral-whatsapp-e-regua-cobranca.md) | WhatsApp + régua declarativa (cobrança, confirmação agendamento, estoque) | todo | — | — | 0 | depende #04, #10 | — |
| 16 | [14](sprints/14-geral-dre-custos-operacionais.md) | DRE + custos operacionais + previsibilidade + lucratividade por procedimento | todo | — | — | 0 | depende #04 | — |
| 17 | [15](sprints/15-ia-previsao-churn.md) | IA preditiva de churn + intervenções de retenção | todo | — | — | 0 | depende #02–#14 | — |

---

## Fase 2 — Fisioterapia + ERP Saúde

| # | Sprint | Funcionalidade | Status | Dependências |
|---|---|---|---|---|
| 18 | [16](sprints/16-fisio-prontuario-cid-cif.md) | Prontuário eletrônico COFFITO + CID-11/CIF + assinatura ICP-Brasil + templates | futuro | MVP |
| 19 | [17](sprints/17-fisio-evolucao-midias.md) | Evolução por sessão SOAP + anexos categorizados em Storage criptografado | futuro | #16 |
| 20 | [18](sprints/18-fisio-tiss-tuss-convenios.md) | TISS/TUSS + convênios (ANS) + guias XML + glosas | futuro | #16, #17, #04 |
| 21 | [19](sprints/19-fisio-comissoes-repasse.md) | Comissões e repasse de profissional (fechamento mensal + transferência) | futuro | #04, #16, #18 |
| 22 | [20](sprints/20-geral-estoque.md) | Estoque (descartáveis + revenda) + POS + inventário | futuro | #04, #17 |
| 23 | [21](sprints/21-fisio-anvisa-cnes.md) | ANVISA (equipamentos + manutenção + limpeza) + integração CNES | futuro | #03, #17 |
| 24 | [22](sprints/22-geral-portal-paciente-web.md) | Portal do paciente web (PWA) — auth, agenda, recibos, vídeos, QR | futuro | #04, #05, #08, #11, #16, #17 |
| 25 | [23](sprints/23-cross-alert-lesao-treino.md) | Cross-alert: lesão Fisio → adaptação automática de workout Academia | futuro | #07, #11, #13, #16, #22 |
| 26 | [24](sprints/24-fisio-generative-ui.md) | Generative UI v1 (cards de relatório clínico via tool calls) | futuro | #06, #16, #17 |

---

## Fase 3 — Nutrição + Mobile + Fiscal

| # | Sprint | Funcionalidade | Módulo | Status | Dependências |
|---|---|---|---|---|---|
| 27 | 25 | Antropometria (reusa avaliações do #12) + cardápios (reusa prescrições do #11) | nutri | futuro | MVP + Fase 2 |
| 28 | 26 | IA Nutri-Agent cruzando log Academia + prontuário Fisio | nutri/ia | futuro | #25, #18, #23 |
| 29 | 27 | App nativo Expo (aluno/paciente) — Bluetooth + push | mobile | futuro | MVP estável + #22 |
| 30 | 28 | Módulo fiscal Focus NFe (NFS-e por company) | fiscal | futuro | #6 |
| 31 | pós-27 | **Prescrição adaptativa IA por RPE** (ajuste de carga automático) | academia/ia | futuro | #11, #27 (app nativo com input RPE em tempo real) |

---

## Decisões pendentes (viram ADRs quando resolvidas)

- Hardware da catraca + modalidade de auth (QR / facial / ambos) — decidir no Sprint 08 (ADR 0018)
- DSL de regras de conquista — Sprint 09 (parte do ADR 0021)
- Provider WhatsApp (Twilio / Z-API / Meta direto) — Sprint 13 (ADR 0025)
- Modelo de churn (API externa / local / serviço dedicado) — Sprint 15 (ADR 0027)
- Provider de assinatura digital ICP-Brasil (Cert.Sign / Bry / Vaultsign) — Sprint 16 (parte do ADR 0028)
- Submissão de guia TISS (manual vs automática via SOAP) — Sprint 18 (parte do ADR 0029)
- Tributação em comissões (calcular INSS/IR retidos ou só bruto?) — Sprint 19 (parte do ADR 0030)
- Método de custo de estoque (PEPS vs custo médio) — Sprint 20 (ADR 0031)
- Integração Datasus CNES automática vs manual — Sprint 21

---

## Operação

- Quando um sprint começa: mudar `status → doing`, preencher `Início`; regra 9 (1 `doing` por vez)
- Durante: atualizar `%` (0/25/50/75/100) quando bater cada 25% do checklist Commit
- Se bloquear: `status → blocked`, preencher `Bloqueios` com 1 linha + data do bloqueio
- Ao fechar: `status → done`, preencher `Fim`, `PR`, validar DoD
