# ADR 0108 — Emissão fiscal própria nacional (NF-e, NFC-e, NFS-e) com motor tributário dirigido por dados

- **Status:** Accepted
- **Date:** 2026-07-30

## Context

O [ADR 0059](0059-ciclo-fiscal-emissao-focus-nfe.md) decidiu que **"LogiFit não toca em motor tributário"** e delegou 100% da emissão à Focus NFe. O [ADR 0076](0076-nfse-nacional-provider-complementar.md) reafirmou, listando "construir motor fiscal próprio" como alternativa **rejeitada** ("8-12 meses solo, manutenção eterna, risco regulatório alto").

Este ADR reverte as duas, com **cobertura nacional desde o desenho** — não restrita a municípios conveniados ao Sistema Nacional.

### Premissa 1 — o argumento de custo morreu no ADR 0105

O ADR 0076 foi construído sobre margem negativa em Business (R$ 600 de Focus contra mensalidade de R$ 449). O [ADR 0105](0105-conta-focus-por-tenant-byo.md) (BYO — conta Focus é do tenant) **eliminou esse custo da LogiFit**.

**Internalizar não economiza um centavo da LogiFit.** Plano vendido como redução de custo é mentira. A justificativa real:

- **Atrito de onboarding** — hoje o tenant contrata Focus, gera token, credencia-se e cola credencial antes da primeira nota
- **Soberania** ([ADR 0091](0091-self-host-total-oracle-sp.md), regra 46) — única dependência externa no caminho crítico de operação irreversível e regulada
- **Controle do ciclo** — o LogiFit não vê o XML antes de assinar nem controla retentativa no nível do protocolo

### Premissa 2 — para a base de tenants do LogiFit, a NFS-e passa a ter canal único

| Marco | Data | Base legal |
|---|---|---|
| APIs de Produção e Produção Restrita do Sistema Nacional liberadas | 01/10/2025 | — |
| **Todo município** obrigado a aderir ao padrão nacional, sob pena de perder transferências voluntárias | 01/01/2026 | **LC 214/2025** |
| **ME/EPP do Simples** prestadoras de serviço sujeito a ISS emitem **exclusivamente pelo Emissor Nacional** (web ou API) — sistemas municipais próprios **deixam de ser opção** | **01/09/2026** | **Resolução CGSN nº 189/2026** |
| MEI no padrão nacional | desde 2023 | — |

Isto é decisivo e corrige a redação anterior deste ADR, que tratava o padrão nacional como aplicável só a municípios conveniados e projetava um "long tail que nunca fecha".

**A base de tenants do LogiFit é ME/EPP do Simples** — academia, clínica e o autônomo do modo Solo ([ADR 0069](0069-perfil-paciente-hub-operacional.md)); `simples_nacional` é o regime default em todo o schema fiscal. Para essa base, a partir de 01/09/2026 existe **um único canal de emissão de NFS-e em todo o território nacional**: a API do Emissor Nacional.

Sistemas municipais próprios continuam existindo — o município pode manter o portal desde que integre ao ADN — mas **como canal só valem para Lucro Presumido/Real**. No perfil de cliente do LogiFit isso é minoria de uma minoria.

Consequência direta no plano: adapters de padrões municipais **saem do caminho crítico** e viram fase condicional.

### Premissa 3 — a reforma tributária é alvo em movimento

**NT 2025.002 (IBS/CBS/IS)**, Lei 214/2025: obrigatória em **03/08/2026** para regime Normal (CRT=3) e **04/01/2027** para Simples Nacional e MEI. Como os tenants LogiFit são majoritariamente Simples, a janela real é ~17 meses — mas o período de transição dual vai até 2033.

### Premissa 4 — existe implementação de referência em produção

O **Deep Control** (projeto do mesmo autor, fora deste repo — Go + PostgreSQL + Next.js) roda em produção um motor fiscal completo, documentado com arquitetura, pipeline e **10 armadilhas com incidente real datado**.

| Risco | Sem referência | Com referência |
|---|---|---|
| **Design** — errar arquitetura e descobrir em 6 meses | Alto | **Praticamente zero** |
| **Armadilhas de SEFAZ** — rejeições 377/378/379/660/685/805/908, cStat 733/1021 | Descobertas em produção, com nota rejeitada | **Conhecidas antes da primeira linha** |
| **Execução** — portar Go → TypeScript | — | Real, mecânico |
| **Manutenção** — NT nova quebra layout | Alto | Alto (não muda) |

Não torna o projeto barato. Torna **previsível**.

## Decision

Internalizar a emissão fiscal com **cobertura nacional**, adotando a arquitetura de 4 camadas dirigida por dados do Deep Control, em **8 fases sequenciais com gate de go/no-go**.

### Princípio 1 — o produto não carrega alíquota

> O produto carrega *classificadores* (NCM, CEST, origem, perfil fiscal). A tributação vive em **regras fiscais** e é resolvida **no momento da emissão**, combinando produto × unidade emissora × destinatário × natureza da operação.

Uma redação anterior deste ADR propunha um `SUPPORTED_ENVELOPE` recusando categorias inteiras (ST, industrialização, importação). Estava errado: o que garante segurança não é "não sei fazer ST", é **falhar alto quando nenhuma regra casa** (`ErrNoMatchingRule`), caso a caso, com contexto. Mesma proteção, granularidade certa, e caso novo não exige deploy.

O motor é **genérico**; a **configuração** é que começa estreita.

### Princípio 2 — cobertura cresce por configuração, não por código

Este é o princípio que torna "atender o Brasil inteiro" viável solo — e a Premissa 2 o torna barato.

5.570 municípios **não** são 5.570 integrações. São **um canal nacional** para a base do LogiFit, mais ~8-10 **padrões** municipais que só valem para regime Normal:

| Padrão | Quando é canal | Prioridade |
|---|---|---|
| **Nacional / Emissor Nacional (SEFIN)** | **Todo ME/EPP do Simples e MEI, em qualquer município do país**, a partir de 01/09/2026 | **Caminho crítico** |
| **ABRASF** v1.0 → v2.04 (GINFES, ISSNet, WebISS, Tiplan, DSF, Simpliss…) | Só Lucro Presumido/Real em município que manteve portal próprio | Condicional |
| **IPM**, **Betha**, **SIGISS**, **Nota Carioca**, **São Paulo**, Governa, Fiorilli… | Idem | Condicional |

A arquitetura continua sendo:

```
adapter por PADRÃO (código)  ×  configuração por MUNICÍPIO (dado, N linhas)
```

Município novo em padrão já suportado = **linha de configuração, sem deploy**. Padrão novo = adapter novo. Manutenção é **O(padrões)**, não O(municípios).

O que muda com a Premissa 2 é o **tamanho de N no caminho crítico**: o registry nasce com **um** adapter (nacional) atendendo o país inteiro para o perfil de cliente do LogiFit. Os demais entram por demanda comprovada de tenant em regime Normal — nunca preventivamente.

A abstração permanece porque o custo dela é baixo (um registry e uma tabela) e porque sem ela o primeiro tenant Lucro Presumido em município com portal próprio vira reescrita. Mas ela deixa de ser o que sustenta o cronograma.

Isso substitui o [`municipios-nfse.ts`](../../packages/ai/src/fiscal/municipios-nfse.ts) atual — que já nasceu com a estrutura certa (perfil por município com `auth`, `defaultRpsSerie`, `supportsWebserviceCancel`, `sendsCnae`, `hasHomologacao`), mas como **constante hardcoded**. Vira tabela, e o perfil de Cascavel vira a primeira linha.

**Decisão explícita:** o convênio municipal não é gate. Para ME/EPP do Simples o convênio é irrelevante — o canal é nacional por norma, independente da adesão do município.

### As 4 camadas

```
Produto (NCM/CEST/origem/perfil) ─┐
Unidade emissora (UF/CRT/regime) ─┼─► Resolve() ─► ResolvedTax ─► CalculateTax() ─► TaxBreakdown ─► XML
Destinatário (UF/indIEDest)      ─┤    (qual regra)   (o quê)        (motor)          (quanto)
Natureza da operação             ─┘
```

| # | Camada | Responsabilidade |
|---|---|---|
| 1 | **Configuração** | `fiscal_profiles`, `tax_rules`, tabelas de referência `tax_ref_*` |
| 2 | **Resolução** | Escolher **A** regra por score de especificidade + desempate determinístico |
| 3 | **Cálculo** | Aplicar bases e produzir valores — **dirigido por flags**, sem `switch` de CST |
| 4 | **Emissão** | Montar grupos do XML, assinar, transmitir |

A peça que faz funcionar é `tax_ref_icms_cst`: guarda **flags de comportamento por CST** (`calcula_icms_proprio`, `calcula_st`, `calcula_reducao_bc`, `calcula_diferimento`, `calcula_st_retido`…). O cálculo lê flag, não `switch`. CST novo = linha na tabela.

### Arquitetura de arquivos

Sai de `packages/ai/src/fiscal/` (fiscal nunca foi IA — dívida do Sprint 36a) para package próprio:

```
packages/fiscal/
  taxengine/
    models.ts resolve.ts calculate.ts ref/
  core/
    xml/            # C14N exclusive + XMLDSig SHA-256 + validação XSD local
    transport/      # mTLS (reusa certificado A1 do Sprint 17)
  nfse/
    padroes/
      nacional/     # DPS + REST SEFIN
      abrasf/       # v1.0 v2.01 v2.02 v2.03 v2.04 (SOAP)
      ipm/ betha/ sigiss/ carioca/ saopaulo/
    registry.ts     # padrão → adapter
    config.ts       # município → padrão + endpoint + quirks (tabela)
    danfse.ts
  nfe/
    layout/         # XSDs versionados NO REPO + builder + chave 44dig + QRCode NFC-e
    transport/      # endpoints UF × ambiente + autorização + contingência SVC/EPEC
    eventos/        # cancelamento cce inutilizacao manifestacao
  reforma/
    ibs-cbs.ts      # NT 2025.002
  providers/
    focus-nfe.ts    # rebaixado a FALLBACK de padrão sem adapter
    mock.ts
```

`FiscalProvider` ([provider.ts](../../packages/ai/src/fiscal/provider.ts)) permanece como interface. **A camada de aplicação não muda** — Server Actions, `fiscal_emissions`, inbox `/app/fiscal`, portal do contador e apuração ([ADR 0100](0100-apuracao-fiscal-mensal-grupo-c.md)) continuam iguais. É o que torna o plano incremental em vez de big-bang.

### O que porta da referência e o que não

**Porta integralmente** — núcleo agnóstico de ramo:

- As 4 camadas e a separação Resolve/Calculate
- `tax_ref_*` com flags dirigindo o cálculo
- Score de especificidade (NCM +4, CEST +3, UF +2/+1/0, `unit_id` +2, `client_type` +1, `regime` +1)
- **Desempate determinístico** `priority DESC → updated_at DESC → id DESC` — existe porque, sem ele, regras empatadas deixavam a escolha na ordem física do Postgres e **o mesmo produto tributava diferente entre vendas**
- Falha alta com contexto em vez de nota sem CST/CFOP
- Resolução de destinatário e `indIEDest`, incluindo UFs que rejeitam isento (rejeição 805)
- Pipeline na ordem exata: resolve → reforma → **cálculo** → mensagens fiscais → numeração/chave → IBPT → XML → persiste → transmite

**Não porta** — LogiFit não vende combustível nem importa:

- Cadeia ANP/combustível inteira (`cProdANP`, `<comb>`, `<encerrante>`, PMPF, CIDE, `pBio`, monofásico) — e com ela ~4 das 10 armadilhas
- Cadeia de importação (II, AFRMM, Siscomex, gross-up de ICMS)
- Naturezas de TRR/transporte

**Porta com correção** — a referência declara `CalcDIFAL` implementado, testado e **nunca chamado em produção**. Venda interestadual de suplemento a consumidor final exige DIFAL (EC 87/2015). **A lacuna não é herdada — é fechada na Fase 4.**

### As armadilhas viram suíte de teste

Cada armadilha com incidente real é caso de teste de graça. Obrigatórios antes de qualquer emissão real:

| # | Armadilha | Teste |
|---|---|---|
| 1 | `client_type` preenchido descarta a regra no fluxo de venda | Regra com `client_type` não é escolhida em venda; `NULL` é |
| 2 | CSOSN gravado na coluna `icms_cst` | Tenant Simples nunca emite `<CSOSN>` vazio |
| 3 | `vTotTrib` do total ≠ soma dos itens → **rejeição 685** | Mutação de item e total sincronizada |
| 4 | Redução de BC do ICMS **não** se propaga a PIS/COFINS/IPI | Base cheia nos demais |
| 5 | Regras empatadas → tributação instável entre vendas | 100 execuções idênticas |
| 6 | Emissão sem perfil fiscal / sem regra | Aborta com erro nominal (produto + código) |
| 7 | CFOP interno com `idDest ≠ 1` → **cStat 733** | Venda presencial a consumidor de outra UF |
| 8 | Grupo `IBSCBS` em CST 6xx/7xx → **cStat 1021** | Grupo omitido nesses CSTs |

### Fases e gates

| Fase | Escopo | Esforço solo | Gate de saída |
|---|---|---|---|
| **0 — Fundação de assinatura** | XMLDSig enveloped C14N SHA-256, validação XSD local, mTLS. **Certificado A1 já existe** (Sprint 17, [certificados.ts](../../packages/db/src/schema/certificados.ts)) | **1-2 sem** | XML de referência valida em validador oficial; golden-file em CI contra regressão de dependência cripto |
| **1 — Motor tributário** | `tax_ref_*` + `fiscal_profiles` + `tax_rules` + `Resolve` + `CalculateTax` + CRUD admin | **4-6 sem** | As 8 armadilhas verdes; `resolve`/`calculate` testáveis **sem emitir** |
| **2 — NFS-e Emissor Nacional** | `registry` de padrões + tabela de config por município + adapter nacional (DPS/REST mTLS) + DANFSE | **4-5 sem** | **Cobertura nacional de NFS-e para ME/EPP do Simples** — qualquer município, sem adapter adicional |
| **3 — NF-e 55** | Autorização, cancelamento, CC-e, inutilização, contingência SVC, **DIFAL fechado** | **5-7 sem** | 30 notas + 1 de cada evento + contingência + venda interestadual com DIFAL conferido |
| **4 — NFC-e 65** | CSC por UF, QR Code, **contingência offline** | **3-4 sem** | Caixa não para com SEFAZ fora do ar; backlog transmite sozinho |
| **5 — Impressão** | DANFE / DANFCE / DANFSE — ver **[ADR 0109](0109-impressao-documentos-fiscais.md)** | **5-6 sem** | Ver ADR 0109 |
| **6 — Reforma IBS/CBS/IS** | NT 2025.002 nos três documentos | **4-6 sem** | Válido em ambiente de teste antes de **04/01/2027** |
| **C — Condicional: padrões municipais** | ABRASF, IPM, Betha, SIGISS, Carioca, SP — **fora do caminho crítico** | 2-3 sem por padrão | **Só com tenant real em regime Normal** naquele município. Nunca preventivo |

**Total do caminho crítico: 6-8 meses de trabalho concentrado**, mais manutenção perpétua de **20-30% da capacidade de um dev**.

Registro da correção: a redação anterior deste ADR estimava **8-12 meses** — exatamente o número que o [ADR 0076](0076-nfse-nacional-provider-complementar.md) usou para rejeitar esta alternativa. O corte de ~2-4 meses não veio de otimismo: veio da Resolução CGSN 189/2026 (Premissa 2), que transforma 8-10 adapters municipais de caminho crítico em fase condicional. A arquitetura não mudou; o que mudou foi descobrir que o país inteiro cabe em um adapter para o perfil de cliente do LogiFit.

Mesmo corrigido, o custo é alto e a manutenção é perpétua. A decisão continua sendo cara — só deixou de ser cara pelo motivo errado.

### Ordem deliberada

Motor tributário antes de qualquer emissão — camadas 2 e 3 são pré-requisito dos três documentos e testáveis **sem emitir nada**. NFS-e antes de NF-e: maior volume do LogiFit, menor complexidade tributária, prazo correndo. NFC-e por último entre os documentos, porque contingência offline é o único ponto onde falha **para o caixa do cliente** em tempo real.

### Schema

Camada 1 já existe pela metade: [`estoque.products`](../../packages/db/src/schema/estoque.ts) tem `barcode`/`ncm`/`cest_code`, e [`pos.sale_items`](../../packages/db/src/schema/pos.ts) congela snapshot fiscal por item ([ADR 0101](0101-pos-vendas-schema.md)).

```sql
ALTER TABLE products
  ADD COLUMN fiscal_profile_id uuid REFERENCES fiscal_profiles(id),  -- obrigatório pra emitir
  ADD COLUMN origem char(1),
  ADD COLUMN sped_item_type text,
  ADD COLUMN fator_conversao_tributavel numeric,
  ADD COLUMN sem_gtin bool NOT NULL DEFAULT false;

fiscal_profiles  (id, tenant_id, name, description, active)          -- DELETE cascateia regras
tax_rules        (id, tenant_id, fiscal_profile_id, operation_nature,
                  uf_origem text[], uf_destino text[], client_type, regime,
                  unit_id, ncm, cest, municipio_incidencia, priority,
                  valid_from, valid_until,
                  icms_cst, csosn, icms_aliq, icms_reducao_bc, orig, mod_bc,
                  pis_cst, pis_aliq, cofins_cst, cofins_aliq, ipi_cst, ipi_aliq,
                  iss_aliq, iss_cst, iss_retido, codigo_servico, iss_local_prestacao,
                  class_t_trib, aliq_cbs, aliq_ibs_uf, aliq_ibs_municipio,
                  cfop, cfop_externo, ...)
tax_ref_*        -- SEM tenant_id: catálogo canônico global, populado por migration
operation_natures + operation_nature_defaults

-- Cobertura nacional de NFS-e: o coração do princípio 2
nfse_municipality_configs
  ibge_code text pk
  name text  uf char(2)
  padrao text not null            -- 'nacional'|'abrasf_v203'|'ipm'|'betha'|...
  endpoint_homologacao text  endpoint_producao text
  auth_kind text                  -- 'certificado'|'login_senha'|'login_senha_e_certificado'
  rps_serie_default int
  supports_webservice_cancel bool
  cancel_window_hours int         -- NULL = desconhecido (não exibe, não bloqueia)
  sends_cnae bool
  requires_credenciamento bool
  quirks jsonb                    -- flags específicas sem migration
  source_url text  verified_at date

fiscal_credentials_sefaz (tenant_id, company_id, scope, environment,
                          csc_id, csc_token_encrypted, credenciado_at)
```

`tax_ref_*` são as únicas tabelas **sem `tenant_id`** — exceção deliberada à regra 1, do mesmo tipo já aceito para CID/CIF ([ADR 0028](0028-cid-cif-catalogos-globais.md)). Exige exceção explícita no lint de RLS.

`nfse_municipality_configs` mantém `cancel_window_hours` **nullable** deliberadamente: NFS-e não tem prazo nacional e chutar 24h inventava prazo, exibia como fato e bloqueava cancelamento legítimo. `NULL` não exibe e não bloqueia.

### Segurança

**Custódia de certificado A1 não é risco novo** — o Sprint 17 já implementou [`certificados.ts`](../../packages/db/src/schema/certificados.ts) com `.pfx` cifrado AES-256-GCM, senha em chave separada, KEK por company, `scanUpload()` (regra 38) e alerta de expiração.

Muda a **frequência e superfície de uso**: hoje o certificado é lido na recepção NF-e; passa a ser lido em toda emissão. Exigências adicionais:

- Chave privada nunca deixa o processo servidor — nunca em log, GlitchTip ou retorno de Server Action
- Uso gated por `fiscal.emit`/`fiscal.admin` + MFA recente <15min em configuração (regra 43)
- Todo uso grava `audit_log` com hash chain (regra 39)
- Threat model STRIDE de emissão antes da Fase 4

## Consequences

### Positivas

- **Cobertura nacional real** — município novo em padrão suportado entra sem deploy
- **Onboarding sem terceiro** — tenant sobe o A1 que já possui e emite
- **Soberania** (regra 46)
- **Caso novo sem deploy** — regra é dado; tenant com ST não exige release
- **Risco de design praticamente eliminado** pela implementação de referência
- **Camada de aplicação intacta**
- **DIFAL fechado**, corrigindo lacuna conhecida da referência

### Negativas — assumidas, não mitigadas

- **6-8 meses de roadmap.** Fase 2 (Fisioterapia) e Fase 3 (Nutrição) atrasam em bloco
- **Manutenção perpétua de 20-30% de um dev.** NT nova quebra layout; hoje a Focus absorve, internalizado **a emissão de todos os tenants para**
- **Reforma 2026-2033** — sistema dual em movimento durante a construção e por 7 anos depois
- **Complexidade de configuração transferida ao tenant** — perfil fiscal e regra por natureza × UF × regime é vocabulário de contador, não de dono de academia. Sem wizard e defaults por ramo, troca-se um atrito de onboarding por outro
- **Dependência de canal único para NFS-e.** O ganho da Premissa 2 tem contrapartida: indisponibilidade do Emissor Nacional para **toda** a base de uma vez. Exige fila com retentativa e comunicação de incidente — não há rota alternativa por norma
- **Tenant em regime Normal com município de portal próprio fica na Focus** até existir adapter do padrão

### Riscos não endereçados

- **Bug no motor emite nota errada em massa antes de alguém notar.** Mitigação parcial: conciliação diária. Não elimina a janela
- **Nota autorizada e errada é passivo fiscal do cliente**, irreversível pelo LogiFit. Exige revisão do contrato SaaS antes da Fase 4
- **Port Go → TypeScript introduz bugs que a referência não tem** — aritmética decimal é o ponto mais provável (`roundCents` em toda a cadeia; proibido float binário)
- **Prorrogação da Resolução CGSN 189/2026.** O plano passa a depender de uma norma com vigência a 5 semanas da data deste ADR. Adiamento não invalida a arquitetura, mas devolve os adapters municipais ao caminho crítico e o cronograma aos 8-12 meses. Monitorar até 01/09/2026

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| **Manter Focus para tudo** (status quo, ADR 0059) | Não resolve atrito de onboarding, e a NFS-e nacional gratuita torna o intermediário injustificável no documento de maior volume |
| **Envelope fechado** (redação anterior deste ADR) | Recusa por categoria é grosseira; `if` hardcoded envelhece mal |
| **Restringir o produto a municípios conveniados** | Rejeitado pelo autor em 2026-07-30 — e tornado irrelevante pela Premissa 2: para ME/EPP do Simples o canal é nacional por norma, independente de convênio |
| **Construir os 8-10 adapters municipais no caminho crítico** | Redação anterior deste ADR. Custava 2-4 meses para atender um perfil de cliente que o LogiFit quase não tem (regime Normal em município com portal próprio) |
| **Um adapter por município** | O(municípios) — impossível solo. Adapter por padrão + config por município |
| **Big bang** | Sem gate entre fases, erro de assinatura em NFC-e derruba NFS-e junto |
| **Começar por NF-e** | Maior risco tributário, menor volume, sem prazo correndo |
| **Portar o motor inteiro do Deep Control, inclusive combustível** | ~40% do código e das armadilhas é ANP/encerrante/PMPF/monofásico |
| **Esperar a reforma estabilizar (2033)** | Congela o produto por 7 anos |

## Escopo de impacto

**ADRs:** [0059](0059-ciclo-fiscal-emissao-focus-nfe.md) e [0076](0076-nfse-nacional-provider-complementar.md) → **Superseded** quando aceito. [0105](0105-conta-focus-por-tenant-byo.md) mantido, escopo reduzido a padrão sem adapter. [0066](0066-plano-comercial-pricing-trial.md) → overage de documento fiscal precisa nova justificativa. [0101](0101-pos-vendas-schema.md) → `sale_items` ganha `fiscal_profile_id` resolvido.

**ADR irmão:** [0109](0109-impressao-documentos-fiscais.md) — impressão de DANFE/DANFCE/DANFSE.

**Sprints:** 36 encerra no escopo Focus. Novos **41** (Fase 0+1), **42** (Fase 2), **43** (Fase 3), **44** (Fase 4), **45** (Fase 5, ADR 0109), **46** (Fase 6). Fase C não recebe número — nasce sob demanda de tenant. Arquivo profundo nasce quando o sprint vira candidato a `doing`, conforme o [roadmap](../roadmap.md).

**Regras:** regra nova proposta em [`rules.md`](../rules.md) — *"nenhum default tributário é inferido: sem perfil fiscal ou sem regra casada, a emissão aborta com contexto"*, lint `no-inferred-tax-default`. Mais exceção explícita de RLS para `tax_ref_*`.

**Docs:** `CHANGELOG.md`, `docs/roadmap.md`, `docs/modulos.md`, `CLAUDE.md`, threat model STRIDE, RIPD.

## Gate de aceitação deste ADR

1. Decidir de onde saem os 6-8 meses: Fase 2 (Fisioterapia) ou Fase 3 (Nutrição)
2. Definir a estratégia de **defaults por ramo** para perfis e regras — sem ela a configuração vira o novo atrito de onboarding
3. Confirmar que **nenhum tenant atual está em Lucro Presumido/Real** — se estiver, a Fase C entra no caminho crítico para o padrão daquele município
4. Revisão do contrato SaaS quanto a responsabilidade fiscal

## Related

- Supersedes [ADR 0059](0059-ciclo-fiscal-emissao-focus-nfe.md) e [ADR 0076](0076-nfse-nacional-provider-complementar.md)
- Irmão: [ADR 0109 — Impressão de documentos fiscais](0109-impressao-documentos-fiscais.md)
- Depende de [ADR 0073](0073-postura-seguranca-defesa-em-profundidade.md) e do certificado A1 do Sprint 17
- Impacta [ADR 0066](0066-plano-comercial-pricing-trial.md), [ADR 0100](0100-apuracao-fiscal-mensal-grupo-c.md), [ADR 0101](0101-pos-vendas-schema.md), [ADR 0105](0105-conta-focus-por-tenant-byo.md)
- Precedente de catálogo global sem `tenant_id`: [ADR 0028](0028-cid-cif-catalogos-globais.md)
- **Implementação de referência:** motor fiscal do Deep Control (Go + PostgreSQL + Next.js, fora deste repo)
- Fontes externas (verificadas 2026-07-30):
  - **Resolução CGSN nº 189, de 23/04/2026** — altera a Resolução CGSN nº 140/2018; obriga ME/EPP do Simples a emitir NFS-e padrão nacional **exclusivamente pelo Emissor Nacional** (web ou API) a partir de 01/09/2026
  - **LC 214/2025** — adesão de todo município ao padrão nacional até 01/01/2026, sob pena de perda de transferências voluntárias; município pode manter portal próprio desde que integre ao ADN
  - **NT 2025.002-RTC** — IBS/CBS/IS na NF-e/NFC-e; obrigatória 03/08/2026 (Normal) e 04/01/2027 (Simples/MEI)
  - Manual de Contribuintes Emissor Público API — Sistema Nacional NFS-e v1.2 (out/2025)
