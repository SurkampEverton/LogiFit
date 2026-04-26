# ADR 0054 — LGPD art. 11 (dados sensíveis de saúde) + RIPD versionado + base legal explícita

- **Status:** Accepted
- **Date:** 2026-04-23

## Context

A **Lei Geral de Proteção de Dados** (LGPD, Lei 13.709/2018) classifica dados de saúde, biométricos e genéticos como **dados pessoais sensíveis** (art. 5º, II + art. 11). O tratamento desses dados exige **base legal específica** mais restrita que dados comuns.

A **Lei 13.787/2018** é a **lei federal primária** sobre digitalização e uso de prontuário eletrônico em estabelecimentos de saúde. Estabelece (art. 6º) **20 anos de retenção mínima** para prontuário eletrônico, regula assinatura digital ICP-Brasil para garantia de autenticidade, e exige sistema de informação certificado pela SBIS ou conforme padrões equivalentes. **Esta lei é hierarquicamente superior** às resoluções de conselho profissional (CFM 2.299/2021, COFFITO 415/2012, CFN 599/2018) — quando há conflito, Lei 13.787 prevalece. ADRs 0054, 0072, 0073 e Sprint 20 implementam controles que satisfazem ambas (lei federal + resoluções).

A **Resolução ANPD nº 23/2024** (09/12/2024) definiu a Agenda Regulatória 2025-2026 com foco em dados sensíveis de saúde e **mais de 10 ações fiscalizatórias previstas até 2026**. Acordo técnico ANS + ANPD publicado para fiscalização coordenada em saúde suplementar.

**Problema atual no mercado:** 100% dos ERPs de academia no Brasil tratam dados de peso, medidas, frequência de treino, composição corporal como **dados comuns**, sem consentimento explícito e sem RIPD (Relatório de Impacto à Proteção de Dados). LogiFit tem oportunidade de ser o primeiro ERP de wellness+saúde genuinamente compliant.

Sprints LogiFit afetados (trata dados sensíveis LGPD art. 11):

- **Sprint 02** — `members.family_history jsonb` (histórico familiar)
- **Sprint 08** — biometria (QR + facial com embedding vetor)
- **Sprint 12** — avaliações físicas (bioimpedância, dobras cutâneas, anamnese)
- **Sprint 16** — prontuário fisio com CID
- **Sprint 17** — mídia clínica (raio-X, fotos posturais)
- **Sprint 20** — prontuário polimórfico (fisio/nutri)
- **Sprint 22** — TISS/convênios (dados clínicos)
- **Sprint 26** — portal do paciente (self-management de consent)
- **Sprint 30** — exames laboratoriais (hemograma, lipídico, etc)
- **Sprint 32** — Device Hub (HR contínuo, VFC, sono — biométricos contínuos)
- **Sprint 33** — Pipeline exames IA
- **Sprint 34** — Nutri-Agent (cruza dado sensível com IA)

Fontes:
- [Agenda Regulatória ANPD 2025-2026 — Machado Meyer](https://www.machadomeyer.com.br/pt/inteligencia-juridica/publicacoes-ij/direito-digital/agenda-regulatoria-2025-2026-da-anpd-destaca-16-temas)
- [Destaques Agenda ANPD — Migalhas](https://www.migalhas.com.br/coluna/migalhas-de-protecao-de-dados/423103/destaques-da-agenda-regulatoria-2025-2026-da-anpd)
- [LGPD art. 11 — Planalto](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)

## Decision

Estabelecer **framework de conformidade LGPD art. 11** com 4 componentes obrigatórios:

### 1. Base legal explícita por tipo de dado

Cada tabela/campo que trata dado sensível registra em `docs/compliance/lgpd-data-inventory.md` (a criar no Sprint 00):

| Categoria de dado | Base legal LGPD art. 11 | Exemplo no LogiFit |
|---|---|---|
| Saúde (prontuário, exame, diagnóstico) | Art. 11, II, "a" — **tutela da saúde** pelo profissional | `consultas`, `lab_results`, `evolucoes_sessao` |
| Biometria (QR facial, embedding) | Art. 11, II, "d" — **execução de políticas públicas** (segurança/acesso) + **consentimento explícito** | `member_face_embeddings`, `access_events` |
| Genética (não aplicável hoje) | Art. 11, II, "a" — tutela da saúde + **consentimento explícito** | Futuro (genômica nutricional) |
| Composição corporal, peso, medidas | Art. 11, II, "a" — tutela da saúde | `assessments`, `assessment_measurements` |
| Frequência de treino, dieta | **Consentimento específico** do titular (art. 11, I) | `workout_sessions`, `meal_log_entries` |
| Dados wearable (HR, VFC, sono) | **Consentimento específico granular por provider** (já em ADR 0049) | `device_readings`, `device_consents` |

**Regra dura**: se base legal = "consentimento específico", sistema **bloqueia** operação sem `consents` ativo do member.

### 2. Consentimentos granulares (`consents`)

Já previsto em Sprint 01b + Sprint 26, agora formalizado com taxonomia fixa:

```sql
-- Tipos de consent (seed global)
consent_purposes (
  id, name, scope, legal_basis, required_for_role, active
)
```

**Purposes iniciais (seed):**

| Purpose | Scope | Legal basis | Descrição |
|---|---|---|---|
| `health_data_tratamento` | health | tutela da saúde | Base para profissional tratar o paciente |
| `biometria_acesso_facial` | biometric | consent explícito | Cadastro de face para catraca |
| `share_injury_to_training` | cross-module | consent explícito | Fisio → Academia |
| `share_training_to_nutri` | cross-module | consent explícito | Academia → Nutri |
| `share_prontuario_to_nutri` | cross-module | consent explícito | Fisio → Nutri |
| `marketing_messages` | marketing | consent explícito | Régua de marketing (WhatsApp, email) |
| `wearable_data_garmin` | biometric contínuo | consent explícito por provider | Sincronização Garmin |
| `wearable_data_oura` | biometric contínuo | consent explícito por provider | Sincronização Oura |
| `self_upload_exam` | health | consent explícito | Self-upload via portal ou WhatsApp |
| `teleconsulta_recording` | health + voz/imagem | consent explícito | Gravação de teleconsulta |
| `research_anonimizada` | pesquisa agregada | consent explícito | Uso em estatísticas anonimizadas |

**UI em `/meu/privacidade`** (Portal paciente, Sprint 26):
- Lista todos os purposes ativos
- Toggle para cada (ligar/desligar)
- Histórico de mudanças
- "Direito de apagamento" botão destrutivo com confirmação

### 3. RIPD versionado (Relatório de Impacto à Proteção de Dados)

Documento formal exigido pela LGPD + ANPD para tratamento de larga escala de dados sensíveis. LogiFit mantém RIPD **por módulo crítico**:

```
docs/compliance/ripd/
├── _template.md              # Template ANPD compliant
├── v1.0-prontuario-fisio.md
├── v1.0-exames-laboratoriais.md
├── v1.0-device-hub.md
├── v1.0-nutri-agent-ia.md
├── v1.0-teleconsulta.md
└── v1.0-reconhecimento-facial.md
```

Cada RIPD contém (template ANPD):

1. **Identificação do tratamento** (qual dado, finalidade)
2. **Base legal** (art. 7º, 11º ou equivalente)
3. **Princípios aplicados** (necessidade, adequação, finalidade, minimização)
4. **Fluxo de dados** (entrada, processamento, saída, retenção)
5. **Medidas de segurança** (criptografia, RLS, audit)
6. **Avaliação de risco** (probabilidade + impacto)
7. **Medidas de mitigação** (controles de acesso, consent, pseudonimização)
8. **Data de revisão** (próxima revisão mandatória a cada 12 meses ou em mudança substancial)

RIPDs são versionados em git; mudanças geram nova versão (`v1.1-`, `v2.0-`). CI tem script `pnpm compliance:ripd-check` que falha se módulo em produção não tem RIPD vigente.

### 4. Direitos do titular (art. 18)

LogiFit implementa os 8 direitos do titular via portal e APIs:

| Direito | Implementação |
|---|---|
| Confirmação de tratamento | `/meu/privacidade` lista todos os dados tratados + finalidade |
| Acesso | `/meu/dados/export` gera JSON/CSV completo em <5 dias |
| Correção | Edição no portal de dados pessoais |
| Anonimização/bloqueio/eliminação | "Apagar minha conta" com cascata documentada em `docs/compliance/data-deletion-playbook.md` |
| Portabilidade | Export em formato estruturado (JSON + PDF legível) |
| Revogação de consent | Toggle em `/meu/privacidade` (Sprint 26) |
| Informação sobre compartilhamento | Lista de quem tem acesso (profissional X, seguradora Y) |
| Revisão de decisão automatizada | Ver ADR 0053 (IA) + `/meu/alertas-ia` com explicabilidade |

### 5. Prazo de retenção explícito

Cada tipo de dado tem prazo configurado em `tenant_data_retention_policies`:

- **Prontuário fisio**: **mínimo 5 anos** (COFFITO 415/2012)
- **Prontuário nutri**: conforme CFN (guarda indeterminada recomendada)
- **Prontuário médico**: **mínimo 20 anos** (CFM 1.821/2007 + Lei 13.787/2018 prontuário eletrônico) — relevante se tenant tiver médico
- **Dados fiscais**: 5 anos após encerramento do contrato (legislação tributária)
- **Dados wearable cru**: 90 dias (ADR 0049)
- **Audit log**: **5 anos** (alinhado a [ADR 0072](0072-escalabilidade-banco-particionamento-retencao-cold-storage.md) que prevalece sobre versão anterior — particionamento mensal + cold storage após 2 anos + drop após 5)

Job mensal `/api/jobs/compliance/retention-cleanup` executa políticas automaticamente.

## Consequences

### Positivas

- **LogiFit entra no mercado com posicionamento "compliance by design"** — pai de concorrentes que fingem LGPD
- **Base sólida para fiscalização ANPD** — quando 1 dos 10 tenants for auditado em 2026, responde sem susto
- **Portal de privacidade é feature de venda** — paciente moderno quer controle
- **Evita multa** — ANPD pode multar até 2% do faturamento (limite R$ 50M por infração)
- **RIPDs viram entrada de venda corporativa** — cliente grande pede antes de assinar contrato

### Negativas (mitigáveis)

- **Sprint 01b cresce** — tabelas `consent_purposes`, `tenant_data_retention_policies`, `ripd_versions` + UI admin
- **Sprint 26 cresce** — `/meu/privacidade` completo com 8 direitos + toggle de purposes
- **Overhead por sprint** — cada sprint que trata dado sensível precisa atualizar RIPD correspondente
- **Tradução multi-idioma** dos consents (ADR 0052) — mais strings
- **Taxa de abandono de consent** — alguns pacientes vão recusar; design dos purposes deve ser claro mas sem friction excessivo

### Riscos não endereçados

- **ANPD publicar novas resoluções em 2026** — monitorar via gov.br/anpd e atualizar este ADR
- **Transferência internacional** — quando Claude processa dado em servidor Anthropic EUA, é cross-border. ANPD aceita desde que provider tenha DPA adequado. Documentar em cada RIPD de IA.
- **DPO formal obrigatório** — tenants maiores (>500 titulares) podem exigir; LogiFit sugere papel no tenant, não assume responsabilidade

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Um consent genérico "aceito tratamento de dados" | Proibido pela LGPD; precisa ser específico por finalidade |
| RIPD único para todo o sistema | Confuso; melhor por módulo crítico |
| Delegar compliance ao tenant ("vocês se viram") | Responsabilidade **compartilhada**; controlador (tenant) e operador (LogiFit) respondem juntos |
| Retenção de 90 dias para tudo | Viola COFFITO (5 anos) e CFM (20 anos) |

## Escopo de impacto

- **Sprint 00** — cria `docs/compliance/` com template RIPD + data inventory
- **Sprint 01b** — tabelas `consent_purposes`, `tenant_data_retention_policies`, expansão de `consents`, `ripd_versions`
- **Sprint 26 Portal paciente** — `/meu/privacidade` com toggle de purposes + 8 direitos
- **Sprint 30 Exames Nutri + 33 Pipeline Exames** — RIPD específico para tratamento de laudo com IA
- **Sprint 32 Device Hub** — RIPD de dados biométricos contínuos
- **Sprint 08 Acesso facial** — RIPD de biometria
- **Todos os sprints que tratam dado sensível** — RIPD correspondente + gate CI
- **modulos.md** — módulo transversal "Compliance LGPD (RIPD + Consent purposes + Retention)"
- **rules.md** — regra 29 nova: "Tabela que trata dado LGPD art. 11 exige base legal documentada em `docs/compliance/lgpd-data-inventory.md` + RIPD vigente; CI `pnpm compliance:ripd-check` falha se faltar"

## Related

- Complementa [ADR 0053 — Conformidade CFM 2.454/2026] (dado de IA + compliance LGPD convergem)
- Reforça [ADR 0019 — RBAC e consent cross-module] (Sprint 01b)
- Reforça [ADR 0049 — Device Hub] (consent por provider = LGPD específica)
- Alinha com regras 4 (criptografia at-rest), 5 (audit), 6 (consent cross-module), 25 (dado clínico cross-company franchise)
