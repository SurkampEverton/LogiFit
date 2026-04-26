# Roadmap LogiFit

Linha do tempo + controle de evolução. Para visão funcional (módulos por área), ver [`modulos.md`](modulos.md).

**Status possíveis:** `todo` · `doing` · `done` · `blocked` · `futuro` (regra 9: 1 `doing` por vez — ver [rules.md](rules.md)).

---

## Fase MVP — Academia + Motor Cross + Comercial + Engajamento + ERP Financeiro + Retenção

| # | Sprint | Funcionalidade | Status | Início | Fim | % | Bloqueios | PR |
|---|---|---|---|---|---|---|---|---|
| 1 | [00](sprints/00-setup-infra.md) | Setup de infra (monorepo, CI, observabilidade, componentes base responsivos) | todo | — | — | 0 | — | — |
| 1b | [00b](sprints/00b-menu-lateral.md) | **Menu lateral (SideMenu hamburger overlay + registry por módulo + filtro permission/vertical/consent)** | todo | — | — | 0 | depende #1 + parcialmente #3 (permissions) | — |
| 2 | [01a](sprints/01a-identidade-e-topology.md) | Identidade + Topology (groups/tenants/companies/units + RLS raiz) | todo | — | — | 0 | depende #1 | — |
| 3 | [01b](sprints/01b-rbac-e-consent.md) | RBAC com scope + grants diretos + Consent LGPD | todo | — | — | 0 | depende #2 | — |
| 4 | [02](sprints/02-geral-crm-pessoas.md) | CRM unificado (members + timeline + dashboard do member) | todo | — | — | 0 | depende #3 | — |
| 5 | [03](sprints/03-geral-agenda-universal.md) | Agenda universal + modalidades Academia | todo | — | — | 0 | depende #3, #4 | — |
| 6 | [04](sprints/04-geral-financeiro-asaas.md) | Financeiro Asaas (planos, contratos, cobranças, trancamento, DRE básico) | todo | — | — | 0 | depende #3, #4 | — |
| 7 | [05](sprints/05-geral-ofertas-comerciais.md) | Ofertas comerciais (promoções, pacotes, referrals, cashback) | todo | — | — | 0 | depende #6 | — |
| 8 | [06](sprints/06-geral-copilot-base.md) | **Assistente IA universal base (3 camadas Help/Insight/Action + tool registry distribuído + 7 personas + FAB global + cotas alinhadas a planos — ADR 0064 + 0075)** | todo | — | — | 0 | depende #3, #4 | — |
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
| 22 | [19b](sprints/19b-migracao-hospedagem-oracle.md) | **Migração de hospedagem: Vercel+Supabase → Vercel+Postgres Oracle Cloud (ADR 0078)** | todo | — | — | 0 | depende #21 (MVP fechado + estável 30d) | — |

**MVP fecha no Sprint 19.** 21 sprints + Sprint 19b (migração de hospedagem pós-MVP estável). ~6-8 meses de dev solo + 1.5-2 semanas de migração.

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
| 34 | [32](sprints/32-geral-device-hub.md) | **Device Hub v1 — wearables (Garmin, Oura) + BLE bioimpedância + import FIT/CSV + curadoria profissional + monitoramento + alertas + timeline enriquecida** | geral | futuro | #26 portal + #13 régua + #07 cross-alert |
| 35 | [33](sprints/33-geral-pipeline-exames.md) | **Pipeline Inteligente de Exames Laboratoriais — upload PDF → OCR → IA extração + IA interpretação conservadora → revisão profissional → lab_results oficial; paciente pode subir via portal** | geral | futuro | #06 copilot + #15 OCR + #30 exames + #26 portal |
| 36 | 34 | IA Nutri-Agent cruzando log Academia + prontuário Fisio + diário alimentar + antropometria + **device_readings (Device Hub)** + **lab_results (Pipeline Exames)** | nutri/ia | futuro | #31, #32, #33, #34, #35, #24, #29 |
| 37 | 35 | App nativo Expo (aluno/paciente) — Bluetooth + push + **Apple Health + Google Health Connect (expande Device Hub)** | mobile | futuro | MVP estável + #28 + #34 |
| 38 | [36](sprints/36-geral-fiscal-focus-nfe.md) | **Módulo fiscal — emissão completa via Focus NFe** (NFS-e + NF-e produto + NFC-e + devolução + transferência + remessa conserto + entrada própria + eventos) — ADR 0059 | fiscal | futuro | #6, #18 (15 schemas), #20 (17 inbox), #24 (POS), #25 (equipamento) |
| 39 | pós-35 | **Prescrição adaptativa IA por RPE** (ajuste de carga automático) | academia/ia | futuro | #13, #37 (app nativo com input RPE em tempo real) |
| 40 | 37 | **Apuração mensal de receita (Grupo C — ADR 0061 + ADR a alocar ≥0089)** — consolida receita por regime Simples/Presumido/Real + gera memorial "pré-DAS"/"pré-DARF"; sem emissão oficial | fiscal | **futuro (pós-produção)** | #38, piloto com tenant real |
| 41 | 38 | **Guias oficiais DAS/DARF/DAM (Grupo D — ADR a alocar ≥0089)** — integração PGDAS-D + geração DARF com código de receita; opcional integração Contabilizei/Conube/Omie | fiscal | **futuro (pós-produção)** | #40 |
| 42 | 39 | **Obrigações acessórias SPED/ECD/ECF/DCTF-Web/DEFIS/DIRF (Grupo E — ADR a alocar ≥0089)** — motor ou delegação a provider tributário (SCI/Alterdata/Domínio); **alta complexidade** | fiscal | **futuro (avaliar make vs buy)** | #40, #41 |
| 43 | 40 | **Folha CLT + eSocial (Grupo F — ADR a alocar ≥0089)** — folha completa (salário, horas, DSR, férias, 13º, rescisão) + INSS patronal + FGTS + IRRF + eventos eSocial S-1000 a S-5013; **muito complexa** — provável integração TOTVS/Senior/ADP vs motor próprio | rh | **futuro (avaliar make vs buy)** | — |

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
- ~~Tributação em comissões (INSS/IR retidos ou só bruto) — Sprint 23~~ — **resolvido** pelo ADR 0061 (motor de retenções em AP e comissão/RPA)
- Método de custo de estoque (PEPS vs custo médio) — Sprint 24 (ADR 0044)
- Integração Datasus CNES automática vs manual — Sprint 25
- Teleconsulta provider (Daily.co / Whereby / Jitsi / Twilio Video) — Sprint 31 (ADR 0045)
- Fonte de valores de referência laboratorial (SBAC / curado LogiFit) — Sprint 30 (parte do ADR 0046)

## Decisões já fechadas (recente)

- **OCR de boleto: provider abstrato configurável** — ADR 0035 accepted (OCR.space default + Google Vision + AWS Textract + Azure + Tesseract)
- **Cadastro central `persons` (Contact-FK)** — ADR 0047 accepted (substitui duplicação entre members/leads/suppliers/companies/users)
- **Busca automática de CNPJ** — ADR 0048 accepted (BrasilAPI default + ReceitaWS fallback + CNPJá! opcional; cache 7d)
- **Device Hub (wearables + clínicos)** — ADR 0049 accepted (padrão FHIR-like Observation + provider abstrato; Garmin/Oura + BLE bioimpedância + import FIT/CSV no Sprint 32; Apple Health + Google Health Connect no Sprint 37 App Nativo)
- **Pipeline inteligente de exames laboratoriais** — ADR 0050 accepted (OCR → IA extração → IA interpretação conservadora → revisão profissional → `lab_results` oficial; paciente sobe via portal com fila de revisão; nunca diagnostica; classificador de output bloqueia termos proibidos)
- **DPO + Governança Compliance LGPD** — [ADR 0067](decisions/0067-dpo-governanca-compliance-lgpd.md) accepted (DPO interno fundador no MVP; `privacidade@logifit.com.br`; plano resposta 72h; sub-processors públicos; auditoria trimestral)
- **Plano comercial / pricing / trial** — [ADR 0066](decisions/0066-plano-comercial-pricing-trial.md) accepted (revisado 2026-04-25 — 4 tiers principais + Solo/Combo + cota IA hard-stop + NFS-e inclusas + overage)
- **NFS-e Padrão Nacional como provider complementar futuro** — [ADR 0076](decisions/0076-nfse-nacional-provider-complementar.md) accepted 2026-04-25 (não substitui Focus NFe; pós-Sprint 36 estável 3 meses + 10k notas/mês + 30% emissões em municípios aderidos)
- **Passaporte do paciente (vínculo cross-tenant)** — [ADR 0077](decisions/0077-passaporte-paciente-vinculo-cross-tenant.md) accepted 2026-04-25 (Modelo C híbrido + 5 módulos canônicos + 5 níveis de dados + audit log particionado)
- **Hospedagem em duas fases (MVP Supabase → Pós-MVP Oracle Cloud OCI)** — [ADR 0078](decisions/0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md) accepted 2026-04-25 (cutover Sprint 19b + 8 regras de portabilidade vigentes desde Sprint 00)
- **TISS 4.01 ANS padrão vigente** — [ADR 0079](decisions/0079-tiss-401-ans-padrao-vigente.md) accepted 2026-04-25 (Ofício-Circular ANS nº 1/2026; pipeline atualização semestral; ADRs 0029/0030/0031/0042 detalham implementação)

## Decisões já fechadas

- **OCR de boleto: arquitetura provider-abstrato configurável pelo admin do tenant** — ADR 0035 accepted no Sprint 15. Default global: OCR.space (tier gratuito 25k/mês); alternativas suportadas: Google Vision, AWS Textract, Azure Computer Vision, Tesseract self-hosted. Admin configura via `/app/settings/financeiro/ocr` com credentials próprias; fallback em cadeia opcional.

---

## Convenção sobre sprints em alto nível

Sprints **34** (Nutri-Agent IA), **35** (App Nativo Expo), **pós-35** (Prescrição Adaptativa IA por RPE), **37** (Apuração Receita), **38** (Guias DAS/DARF), **39** (Obrigações Acessórias SPED) e **40** (Folha CLT + eSocial) aparecem na tabela da Fase 3 **apenas como entrada de roadmap** — não têm arquivo detalhado em `docs/sprints/NN-*.md` ainda. Isso é **deliberado**: arquivo de sprint profundo nasce quando o sprint vira candidato a `doing` (próximos 1-2 na fila). Evita doc especulativa que fica obsoleta antes de executar. Quando chegar a hora, o arquivo é criado via mesmo template + extensão (formato profundo: Goal, Aceite, Dependências, Schemas, Rotas, Server Actions, Eventos, Commit checklist, DoD).

Sprints **36** (Fiscal Focus NFe) **possui** arquivo detalhado já — foi escrito com profundidade pra orientar planejamento da decisão fiscal (ADR 0059). O fato dele existir antes dos 34/35 não viola a convenção — apenas reflete a sequência cronológica de quando precisaram ser planejados.

> **Nota de leitura:** quando uma célula da coluna "Sprint" mostra apenas o número (ex: `34`, `35`, `37`) sem link markdown, isso significa que ainda não há arquivo `docs/sprints/NN-*.md` correspondente. Não é link quebrado — é placeholder intencional conforme convenção acima.

## Convenção de numeração de ADRs

ADRs no LogiFit seguem **numeração sequencial densa** com uma exceção legítima: **a faixa 0011-0046 está reservada para ADRs que serão produzidos durante a execução de sprints específicos**. Cada sprint planejado lista os ADRs que vai produzir (campo "ADRs esperados" no header do sprint), e o número é alocado naquele momento.

**Por quê?** Sprints capturam decisões arquiteturais que só fazem sentido **depois** que se entende o domínio do sprint (ex: "qual provider WhatsApp escolher" só decide quando Sprint 13 começa). Pré-criar ADRs vazios polui `docs/decisions/` e força decisões prematuras.

**Mapeamento atual** (faixa reservada):
| ADR | Sprint que produz | Tema | Status |
|---|---|---|---|
| 0011-0012 | reservados | (não-alocados; gap legítimo histórico) | livre |
| 0013 | Sprint 04 | Plano/Contrato/Cobrança como entidades separadas | a produzir |
| 0014 | Sprint 04 | Chave Asaas + conta bancária por company vs tenant | a produzir |
| 0015 | Sprint 06 | Copilot safety: vocabulário proibido + classificador de output | a produzir |
| 0016-0017 | reservados | (futuros, allotment livre) | livre |
| 0018 | Sprint 08 | Hardware da catraca + modalidade de auth | a produzir |
| 0019 | Sprint 01b | RBAC: union user_roles + user_permissions com expires_at | a produzir |
| 0020-0024 | reservados | (futuros, allotment livre) | livre |
| 0025 | Sprint 13 | Provider WhatsApp (Twilio / Z-API / Meta direto) | a produzir |
| 0026 | Sprint 13 | Motor declarativo de régua DSL JSON | a produzir |
| 0027 | reservado | (livre — provavelmente Sprint 13/14) | livre |
| 0028 | Sprint 20 | CID-11 + CIF como catálogos globais versionados | a produzir |
| 0029 | Sprint 22 | Estrutura TISS/TUSS: schema + gerador XML | a produzir (detalha ADR 0079) |
| 0030 | Sprint 22 | Pipeline atualização semestral terminologia ANS | a produzir (detalha ADR 0079) |
| 0031 | Sprint 22 | Validador TISS proativo XSD + regras de negócio | a produzir (detalha ADR 0079) |
| 0032 | Sprint 20 / 26 | Política de fechamento de prontuário + magic link member auth | a produzir |
| 0033-0034 | reservados | (futuros) | livre |
| [0035](decisions/0035-ocr-boleto-provider-abstrato.md) | Sprint 15 | OCR de boleto: provider abstrato (OCR.space default + Google Vision + AWS Textract + Azure + Tesseract) | **Accepted (formalizado 2026-04-25)** |
| 0036 | Sprint 16 | Motor de rateio + intercompany | a produzir |
| 0037 | Sprint 17 | Provider Open Finance | a produzir |
| 0038 | Sprint 17 | Provider NF-e recepção | a produzir |
| 0039 | Sprint 18 | Adquirência: ordem de integração | a produzir |
| 0040 | Sprint 19 | Modelo de churn | a produzir |
| 0041 | Sprint 20 | Provider assinatura digital ICP-Brasil | a produzir |
| 0042 | Sprint 22 (ou posterior) | Submissão de guia TISS automática SOAP | a produzir (Fase 2 do ADR 0079) |
| 0043 | Sprint 34 | Arquitetura Nutri-Agent (especializado vs generalizado) | a produzir |
| 0044 | Sprint 34 | Política mudança automática plano alimentar (sempre proposta) | a produzir |
| 0045 | Sprint 35 | Stack mobile: Expo bare vs managed; React Native vs Flutter | a produzir |
| 0046 | Sprint 35 | Estratégia de release (app stores vs OTA Expo Updates) | a produzir |

**Referências a esses ADRs em outros documentos** (ex: regra que cita "ADR 0015") são **válidas como compromisso de produção** — quando o Sprint 06 rodar, ADR 0015 nasce e o link passa a resolve. Até lá, links como `(ADR 0015)` em corpo de texto são aceitos sem `.md` resolvendo.

**Gate operacional (regra de processo aplicada a TODA sprint):** sprint que cita "ADR XXXX (esperado)" no header **não pode entrar em `status=doing`** sem antes publicar o ADR esperado. Na prática, isso vira o primeiro item do checklist de DoD da sprint:

```markdown
- [ ] ADR XXXX publicado em `docs/decisions/` antes de iniciar
```

Sprints existentes que ainda não declaram esse item explicitamente herdam a regra deste roadmap — auditar quando sprint for transicionar para `doing`.

### Numeração pós-0046 (faixa fora-de-sprint)

A faixa **0011-0046 está reservada** (acima); a faixa **0047+ é alocada sequencialmente** para ADRs **fora-de-sprint** (decisões transversais que não nascem dentro de uma sprint específica — DPO, hospedagem, passaporte, fiscal arquitetural). Atualmente: 0047-0050 (decisões recentes), 0051 livre, 0052-0079 publicados sequencialmente, **0089 publicado** (sistema de mensagens padronizadas — fora da faixa 0080-0088 reservada para sprints 23-31, ver tabela abaixo). **Próximo ADR fora-de-sprint disponível: 0090+**. Caso um sprint reservado precise produzir ADR mas a faixa 0011-0046 já alocou outro tema correlato, alocar próximo número livre acima de 0080 e referenciar back na tabela acima.

**Realocações da faixa 0011-0046 → 0080+** (auditorias 12, 14 e 15 — 2026-04-25, resolveram colisões herdadas):

| ADR | Sprint que produz | Tema | Por que migrou |
|---|---|---|---|
| **0080** | Sprint 29 | Banco de alimentos TACO + estrutura `foods`/jsonb | 0035 já alocado a OCR boleto (Accepted) |
| **0081** | Sprint 29 | Plano alimentar (`meal_plans` → `meal_plan_meals` → `meal_items`) | 0036 alocado a Sprint 16 rateio intercompany |
| **0082** | Sprint 30 | Suplementação separada de alimentos (`supplements`) | 0037 alocado a Sprint 17 Open Finance |
| **0083** | Sprint 31 | Teleconsulta provider (Daily/Whereby/Jitsi/Twilio) | 0038 alocado a Sprint 17 NF-e recepção |
| **0084** | Sprint 27 | CID → contraindicação de exercício (`cid_exercise_contraindications`) | 0033 alocado a Sprint 15 plano de contas hierárquico |
| **0085** | Sprint 28 | Generative UI fisio (Vercel AI SDK `ui.streamUI` + registro componentes) | 0034 alocado a Sprint 15 workflow AP configurável |
| **0086** | Sprint 23 | Modelo de comissão fisio (`professional_contracts` + `commission_rules`) | 0030 alocado a Sprint 22 pipeline atualização TISS |
| **0087** | Sprint 24 | Método de custo estoque (PEPS vs custo médio) + modelo de saldo | 0031 alocado a Sprint 22 validador TISS proativo |
| **0088** | Sprint 26 | Autenticação do member (magic link + JWT `role=member` + sessão 30d) | 0032 alocado a Sprint 20 política de fechamento de prontuário |

## Operação

- Quando um sprint começa: mudar `status → doing`, preencher `Início`; regra 9 (1 `doing` por vez)
- Durante: atualizar `%` (0/25/50/75/100) quando bater cada 25% do checklist Commit
- Se bloquear: `status → blocked`, preencher `Bloqueios` com 1 linha + data do bloqueio
- Ao fechar: `status → done`, preencher `Fim`, `PR`, validar DoD
