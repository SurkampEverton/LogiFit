# ADR 0079 — TISS 4.01 (ANS) como padrão vigente para faturamento de convênios

- **Status:** Accepted
- **Date:** 2026-04-25

## Context

A **ANS (Agência Nacional de Saúde Suplementar)** publicou o **Ofício-Circular nº 1/2026** (janeiro/2026) confirmando o padrão **TISS versão 4.01** como vigente para a Troca de Informações em Saúde Suplementar entre operadoras e prestadores. A versão acrescenta:

- ~334 novos códigos de medicamentos no rol de cobertura obrigatória
- Atualização do sub-grupo OPME (Órteses, Próteses, Materiais Especiais — ~26k termos no novo padrão)
- Refinamento dos campos obrigatórios para o profissional executante (CBOS, sigla conselho, UF)
- Novos códigos de glosa (motivos de rejeição padronizados)

LogiFit precisa faturar convênios desde a Sprint 22 (Fisio · TISS/TUSS + Convênios) com guias XML que passem na validação XSD da ANS na **primeira tentativa**. Faturamento incorreto = glosa, retrabalho operacional, fluxo de caixa atrasado.

Até este ADR, TISS 4.01 era citado em CLAUDE.md e na Sprint 22 sem ADR formal documentando a estratégia.

## Decision

Adotar **TISS 4.01 como versão padrão de geração de guias XML** no LogiFit, com 4 componentes:

### 1. Versionamento da terminologia TUSS por guia

Cada guia gerada registra `tuss_catalog_version` (ex: `tuss_2026_01`) — futuras atualizações da ANS não alteram retroativamente o que foi faturado. Tabela `tuss_catalog_versions (version, released_at, source_url, sha256)` rastreia.

### 2. Pipeline de atualização semestral

Job agendado **semestral** (junho + dezembro):

- Baixa deltas oficiais da ANS (tabelas TUSS de procedimentos, OPME, medicamentos)
- Compara com versão atual (`tuss_catalog_versions`)
- Cria `system_alerts severity=warning category=compliance` listando códigos novos/alterados/removidos
- Gera migration de seed assistida (operador valida e aplica)
- Notifica via email + dashboard `/app/compliance/tiss`

Se ANS publicar atualização emergencial (Ofício-Circular extraordinário): job manual disparável.

### 3. Validador TISS proativo (Sprint 22)

Antes de envio de guia, valida:

- **XSD oficial da ANS** (versão 4.01 baixada e versionada em `packages/tiss/schemas/`)
- **Regras de negócio** que causam glosa frequente:
  - Procedimento × especialidade do executante (`cbo_code` × `tabela_53_terminologia_procedimentos`)
  - Autorização vigente (data + número de sessões aprovadas)
  - Carteirinha válida (`member_insurances.valid_until > today`)
  - Limite de sessões consumido vs autorizado
  - Co-participação correta (regra do convênio)
  - Profissional com `professional_registrations` ativo + `cbo_code` preenchido
  - Endereço executante completo (CEP + número)

Bloqueia envio com erro conhecido **antes** da glosa acontecer. Mensagens em pt-BR claras (não jargão XSD).

### 4. Submissão de guia — manual no MVP, automática Fase 2

**MVP (Sprint 22):**
- Operador exporta XML pronto + valida via portal da operadora (Unimed, Bradesco, etc) manualmente
- Sistema rastreia `billing_guides.submission_method='manual'` + `submitted_at` + `protocol_number`

**Fase 2 (Sprint pós-22):**
- Integração SOAP direta com operadoras que oferecem (UnimedNacional, ANS-PCNI, etc)
- ADR 0042 (esperado, Sprint 22) define provider e roteamento

### 5. RAG global LogiFit indexa TISS 4.01

Documento de referência (`docs/regulacao/tiss-4.01.md`) baixado da ANS é indexado em `ai_documents` global (ADR 0064) — Copilot pode responder perguntas como "qual o código TUSS para fisioterapia respiratória?" citando fonte.

## Consequences

### Positivas

- **Faturamento correto na primeira tentativa** — reduz glosa por XSD/regra básica
- **Auditoria operadora-friendly** — quando operadora questionar valor faturado, sistema mostra exatamente qual versão TUSS e qual regra foi aplicada
- **Atualização semestral previsível** — não há surpresa em janeiro/julho
- **RAG ajuda operação** — recepção tira dúvida sem precisar abrir portal ANS

### Negativas (mitigáveis)

- **Sprint 22 tem peso adicional** de validador proativo (~3 dias extra) e versionamento (~1 dia extra)
- **Falsos positivos no validador** podem bloquear guia legítima — feature flag `bypass_tiss_validator` por tenant para emergência (auditado)
- **Tabela TUSS é grande** (~26k OPME + ~10k procedimentos) — armazenamento OK, mas queries em JSON precisam índice GIN

### Riscos não endereçados

- **ANS publicar TISS 5.x antes de 2027** — improvável (4.01 acabou de sair); se ocorrer, ADR novo + sprint de migração
- **Operadora exigir versão diferente** (algumas usam 3.x antigo) — `insurance_plans.tiss_version` configurável por plano; gerador respeita

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Hardcode TISS 4.01 sem versionamento | ANS atualiza → quebra retroativo das guias antigas |
| Submissão automática SOAP no MVP | Cada operadora tem pequenas diferenças; complexidade alta sem cliente real ainda |
| Validador apenas XSD (sem regras de negócio) | XSD aceita guias que vão ser glosadas por motivos óbvios; UX ruim |
| Comprar biblioteca de terceiros para gerar TISS | Custo recorrente + lock-in; nossa stack TS gera XML bem |
| Não indexar TISS no RAG | Operação perde tempo navegando portal ANS |

## Escopo de impacto

- **Sprint 22 (Fisio · TISS/TUSS)** — implementação completa: gerador XML 4.01, validador proativo, versionamento, submissão manual, schema `tuss_catalog_versions` + `billing_guides` + `billing_guide_items` + `billing_glosas`, UI `/app/financeiro/tiss/*`
- **Sprint 06 (Copilot)** — indexar `tiss-4.01.md` no `ai_documents` global
- **Job semestral** — `update-tuss-catalog` rodando junho + dezembro
- **`docs/regulacao/tiss-4.01.md`** — documento de referência baixado da ANS, versionado

## Related

- Reforça **Sprint 22** (Fisio · TISS/TUSS + Convênios)
- Estende [ADR 0055 — Registros profissionais em conselho](0055-registros-profissionais-em-conselho.md) — `cbo_code` obrigatório por executante para gerar guia válida
- Reforça [ADR 0064 — IA arquitetura](0064-ia-arquitetura-gemini-default-byok-rag.md) — RAG indexa terminologia TISS para resposta de operação
- Antecipa **ADR 0042** (esperado, Sprint 22) — submissão automática SOAP por provider
- Fontes: ANS (Ofício-Circular nº 1/2026), padrão TISS 4.01 ([gov.br/ans/pt-br/assuntos/operadoras/tiss](https://www.gov.br/ans/pt-br/assuntos/operadoras/tiss)), terminologia TUSS oficial
