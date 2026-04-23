# Roadmap LogiFit

Linha do tempo + controle de evolução. Para visão funcional (módulos por área), ver [`modulos.md`](modulos.md).

**Status possíveis:** `todo` · `doing` · `done` · `blocked` · `futuro` (regra 9: 1 `doing` por vez — ver [rules.md](rules.md)).

---

## Fase MVP — Academia + Motor Cross + Comercial + Engajamento + ERP Financeiro + Retenção

| # | Sprint | Funcionalidade | Status | Início | Fim | % | Bloqueios | PR |
|---|---|---|---|---|---|---|---|---|
| 1 | [00](sprints/00-setup-infra.md) | Setup de infra (monorepo, CI, observabilidade) | todo | — | — | 0 | — | — |
| 2 | [01a](sprints/01a-identidade-e-topology.md) | Identidade + Topology (groups/tenants/companies/units + RLS raiz) | todo | — | — | 0 | depende #1 | — |
| 3 | [01b](sprints/01b-rbac-e-consent.md) | RBAC com scope + grants diretos + Consent LGPD | todo | — | — | 0 | depende #2 | — |
| 4 | [02](sprints/02-geral-crm-pessoas.md) | CRM unificado (members + timeline + dashboard do member) | todo | — | — | 0 | depende #3 | — |
| 5 | [03](sprints/03-geral-agenda-universal.md) | Agenda universal + modalidades Academia | todo | — | — | 0 | depende #3, #4 | — |
| 6 | [04](sprints/04-geral-financeiro-asaas.md) | Financeiro Asaas (planos, contratos, cobranças, trancamento, DRE básico) | todo | — | — | 0 | depende #3, #4 | — |
| 7 | [05](sprints/05-geral-ofertas-comerciais.md) | Ofertas comerciais (promoções, pacotes, referrals, cashback) | todo | — | — | 0 | depende #6 | — |
| 8 | [06](sprints/06-geral-copilot-base.md) | Copilot base (chat IA ancorado em member + cache + rate-limit) | todo | — | — | 0 | depende #4 | — |
| 9 | [07](sprints/07-geral-dashboard.md) | Dashboard "Equilíbrio Vital" + cross-alert dispatcher | todo | — | — | 0 | depende #4, #5, #6 | — |
| 10 | [08](sprints/08-academia-controle-acesso.md) | Controle de acesso Academia (QR HMAC + facial opcional + catraca + bloqueio) | todo | — | — | 0 | depende #4, #5, #6 | — |
| 11 | [09](sprints/09-geral-engajamento.md) | Engajamento v1 (conquistas + brindes + metas) | todo | — | — | 0 | depende #10 | — |
| 12 | [10](sprints/10-geral-funil-vendas.md) | Funil de vendas (leads, aula experimental, propostas, conversão) | todo | — | — | 0 | depende #4, #5, #6, #7 | — |
| 13 | [11](sprints/11-geral-prescricoes-e-biblioteca.md) | Prescrições + biblioteca de exercícios com vídeos (workouts, RPE) | todo | — | — | 0 | depende #4 | — |
| 14 | [12](sprints/12-geral-avaliacoes-fisicas.md) | Avaliações físicas (bioimpedância, dobras, anamnese, gráficos evolução) | todo | — | — | 0 | depende #4 | — |
| 15 | [13](sprints/13-geral-whatsapp-e-regua-cobranca.md) | WhatsApp + régua declarativa (cobrança, confirmação agendamento, estoque) | todo | — | — | 0 | depende #6, #12 | — |
| 16 | [14](sprints/14-geral-dre-custos-operacionais.md) | DRE + custos operacionais + previsibilidade + lucratividade por procedimento | todo | — | — | 0 | depende #6 | — |
| 17 | [15](sprints/15-geral-erp-financeiro-core.md) | **ERP Financeiro Core (AP + AR + plano de contas + OCR.space boleto + NF-e XML upload)** | todo | — | — | 0 | depende #6, #16 | — |
| 18 | [16](sprints/16-geral-rateio-intercompany.md) | **Rateio entre filiais + lançamentos intercompany** | todo | — | — | 0 | depende #17 | — |
| 19 | [17](sprints/17-geral-bancos-open-finance.md) | **Bancos + Open Finance + conciliação + automação NF-e SEFAZ** | todo | — | — | 0 | depende #17 | — |
| 20 | [18](sprints/18-geral-adquirencia.md) | **Adquirência (maquininhas Cielo/Stone/Rede/GetNet/PagSeguro + split + antecipação)** | todo | — | — | 0 | depende #17 | — |
| 21 | [19](sprints/19-ia-previsao-churn.md) | IA preditiva de churn + intervenções de retenção | todo | — | — | 0 | depende #4-#18 | — |

**MVP fecha no Sprint 19.** 21 sprints, ~6-8 meses de dev solo.

---

## Fase 2 — Fisioterapia + ERP Saúde

| # | Sprint | Funcionalidade | Status | Dependências |
|---|---|---|---|---|
| 22 | [20](sprints/20-fisio-prontuario-cid-cif.md) | Prontuário eletrônico COFFITO + CID-11/CIF + assinatura ICP-Brasil + templates | futuro | MVP |
| 23 | [21](sprints/21-fisio-evolucao-midias.md) | Evolução por sessão SOAP + anexos categorizados em Storage criptografado | futuro | #22 |
| 24 | [22](sprints/22-fisio-tiss-tuss-convenios.md) | TISS/TUSS + convênios (ANS) + guias XML + glosas | futuro | #22, #23, #17 |
| 25 | [23](sprints/23-fisio-comissoes-repasse.md) | Comissões e repasse de profissional (fechamento mensal + transferência) | futuro | #17, #22, #24 |
| 26 | [24](sprints/24-geral-estoque.md) | Estoque (descartáveis + revenda) + POS + inventário | futuro | #17, #23 |
| 27 | [25](sprints/25-fisio-anvisa-cnes.md) | ANVISA (equipamentos + manutenção + limpeza) + integração CNES | futuro | #5, #23 |
| 28 | [26](sprints/26-geral-portal-paciente-web.md) | Portal do paciente web (PWA) — auth, agenda, recibos, vídeos, QR | futuro | #6, #7, #10, #13, #22, #23 |
| 29 | [27](sprints/27-cross-alert-lesao-treino.md) | Cross-alert: lesão Fisio → adaptação automática de workout Academia | futuro | #9, #13, #15, #22, #28 |
| 30 | [28](sprints/28-fisio-generative-ui.md) | Generative UI v1 (cards de relatório clínico via tool calls) | futuro | #8, #22, #23 |

---

## Fase 3 — Nutrição + Mobile + Fiscal

| # | Sprint | Funcionalidade | Módulo | Status | Dependências |
|---|---|---|---|---|---|
| 31 | [29](sprints/29-nutri-alimentos-e-plano.md) | Banco de alimentos TACO + plano alimentar interativo + substituições + PDF branding | nutri | futuro | MVP + Fase 2 |
| 32 | [30](sprints/30-nutri-suplementos-exames.md) | Suplementação (catálogo + prescrição + interações) + exames laboratoriais + referências + alertas | nutri | futuro | #31, #23 |
| 33 | [31](sprints/31-geral-diario-alimentar-teleconsulta.md) | Diário alimentar (paciente + validação nutri) + teleconsulta (vídeo com provider abstrato) | geral/nutri | futuro | #28, #31, #22 |
| 34 | 32 | IA Nutri-Agent cruzando log Academia + prontuário Fisio + diário alimentar + antropometria | nutri/ia | futuro | #31, #32, #33, #24, #29 |
| 35 | 33 | App nativo Expo (aluno/paciente) — Bluetooth + push | mobile | futuro | MVP estável + #28 |
| 36 | 34 | Módulo fiscal Focus NFe (NFS-e por company) | fiscal | futuro | #6 |
| 37 | pós-33 | **Prescrição adaptativa IA por RPE** (ajuste de carga automático) | academia/ia | futuro | #13, #35 (app nativo com input RPE em tempo real) |

---

## Decisões pendentes (viram ADRs quando resolvidas)

- Hardware da catraca + modalidade de auth (QR / facial / ambos) — Sprint 08 (ADR 0018)
- DSL de regras de conquista — Sprint 09 (parte do ADR 0021)
- Provider WhatsApp (Twilio / Z-API / Meta direto) — Sprint 13 (ADR 0025)
- **Motor de rateio + modelo de intercompany** — Sprint 16 (ADR 0036)
- **Provider Open Finance (Pluggy / Belvo / API direta) + provider NF-e recepção (Arquivei / Sieg / SEFAZ direto)** — Sprint 17 (ADRs 0037 e 0038)
- **Adquirência: ordem de integração (Cielo/Stone/Rede/GetNet/PagSeguro) + antecipação** — Sprint 18 (ADR 0039)
- Modelo de churn (API externa / local / serviço dedicado) — Sprint 19 (ADR 0040)
- Provider assinatura digital ICP-Brasil (Cert.Sign / Bry / Vaultsign) — Sprint 20 (parte do ADR 0041)
- Submissão de guia TISS (manual vs automática SOAP) — Sprint 22 (parte do ADR 0042)
- Tributação em comissões (INSS/IR retidos ou só bruto) — Sprint 23 (parte do ADR 0043)
- Método de custo de estoque (PEPS vs custo médio) — Sprint 24 (ADR 0044)
- Integração Datasus CNES automática vs manual — Sprint 25
- Teleconsulta provider (Daily.co / Whereby / Jitsi / Twilio Video) — Sprint 33 (ADR 0045)
- Fonte de valores de referência laboratorial (SBAC / curado LogiFit) — Sprint 32 (parte do ADR 0046)

## Decisões já fechadas

- **OCR de boleto: arquitetura provider-abstrato configurável pelo admin do tenant** — ADR 0035 accepted no Sprint 15. Default global: OCR.space (tier gratuito 25k/mês); alternativas suportadas: Google Vision, AWS Textract, Azure Computer Vision, Tesseract self-hosted. Admin configura via `/app/settings/financeiro/ocr` com credentials próprias; fallback em cadeia opcional.

---

## Operação

- Quando um sprint começa: mudar `status → doing`, preencher `Início`; regra 9 (1 `doing` por vez)
- Durante: atualizar `%` (0/25/50/75/100) quando bater cada 25% do checklist Commit
- Se bloquear: `status → blocked`, preencher `Bloqueios` com 1 linha + data do bloqueio
- Ao fechar: `status → done`, preencher `Fim`, `PR`, validar DoD
