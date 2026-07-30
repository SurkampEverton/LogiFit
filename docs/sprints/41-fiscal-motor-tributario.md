# Sprint 41 — Fiscal · Fundação de assinatura + motor tributário

- **Área:** fiscal
- **Início:** 2026-07-30
- **Fim planejado:** 3 faixas de ≤3 semanas cada (regra 9) — 41a → 41b → 41c
- **Status:** planejado
- **Item do roadmap:** #44

## Goal

Construir a base sobre a qual os três documentos fiscais serão emitidos: **assinatura digital** que o órgão aceita, e um **motor tributário dirigido por dados** que decide CST/CFOP/alíquota a partir de regra cadastrada, nunca de default chutado.

**Nada emite neste sprint.** É deliberado: as camadas de resolução e cálculo são pré-requisito de NFS-e, NF-e e NFC-e, e são testáveis sem transmitir nada a lugar nenhum. Emitir cedo transformaria bug de cálculo em nota autorizada errada — passivo fiscal do cliente, irreversível.

Ao fim do sprint, o motor roda em **modo sombra** sobre toda emissão que a Focus fizer: calcula em paralelo, grava, e um job compara com o documento autorizado. É assim que se acumula evidência antes do primeiro cut-over (Sprint 42).

## Faixas (regra 9 — teto de 3 semanas por faixa)

| Faixa | Escopo | Duração |
|---|---|---|
| **41a** | Package `packages/fiscal/` + certificado + XMLDSig + mTLS | 1-2 sem |
| **41b** | Schema do motor (`tax_ref_*`, `fiscal_profiles`, `tax_rules`) + `Resolve()` | 2-3 sem |
| **41c** | `CalculateTax()` + CRUD admin + defaults por ramo + modo sombra | 2-3 sem |

## Critério de aceite

### 41a — Fundação de assinatura

- Package novo `packages/fiscal/` (`@repo/fiscal`) — fiscal **sai de `@repo/ai`**; nunca foi IA, é dívida do Sprint 36a. `packages/ai/src/fiscal/*` migra em 41a, com re-export temporário para não quebrar as Server Actions existentes
- `core/cert/pkcs12.ts` lê `.pfx` → chave privada PEM + cadeia, consumindo `company_certificates` do Sprint 17 (`encrypted_pfx` + `encrypted_password` **já cifrados AES-256-GCM**, KEK por company). **Nenhum campo novo de certificado** — o schema existente atende
- `core/xml/sign.ts` produz XMLDSig **enveloped**, C14N **exclusive**, SHA-256/RSA
- `core/xml/validate.ts` valida contra XSD **antes** de qualquer transmissão
- `core/transport/mtls.ts` monta agente `https` com `pfx` + `passphrase` diretos (Node aceita PKCS#12 nativo — não desmontar à toa)
- Chave privada **nunca** sai do processo servidor: proibida em log, GlitchTip, retorno de Server Action ou mensagem de erro. Teste que falha se vazar
- **Dependências novas, todas puras em JS** (VPS é Oracle ARM Ampere; binário nativo em runtime é risco de build): `xml-crypto`, `@xmldom/xmldom`, `node-forge`. `libxmljs2` entra **só como devDependency** para validar XSD em teste

### 41b — Schema + resolução

- `tax_ref_*` seedadas por migration, **sem `tenant_id`** (exceção da regra 47; allowlist em `db:rls-check`). A peça central é `tax_ref_icms_cst`, que guarda **flags de comportamento por CST** (`calcula_icms_proprio`, `calcula_st`, `calcula_reducao_bc`, `calcula_diferimento`, `calcula_st_retido`) — o cálculo lê flag, **não `switch`**
- `fiscal_profiles` + `tax_rules` + `operation_natures` + `operation_nature_defaults` com RLS tenant-scope
- `ALTER TABLE products` (já tem `barcode`/`ncm`/`cest_code` do Sprint 24): `+ fiscal_profile_id`, `origem`, `sped_item_type`, `fator_conversao_tributavel`, `sem_gtin`
- `resolve(ResolveRequest)` implementa **filtro de compatibilidade → score de especificidade → desempate determinístico**:

  | Critério | Pontos |
  |---|---|
  | `ncm` casado | +4 |
  | `cest` / `municipio_incidencia` casado | +3 |
  | `uf_origem` / `uf_destino` com 1 UF / 2 / 3+ | +2 / +1 / 0 |
  | `unit_id` casado | +2 |
  | `client_type` / `regime` preenchido | +1 |

- Desempate `priority DESC → updated_at DESC → id DESC`. **Sem isso a escolha cai na ordem física do Postgres e o mesmo produto tributa diferente entre duas vendas** — é incidente conhecido da implementação de referência, não hipótese
- Sem candidata → `ErrNoMatchingRule` **com contexto** (`profile_id / operation_nature / uf_origem / uf_destino / regime`), nunca erro genérico
- Normalização de NCM/CEST: `2710.12.59` ≡ `27101259`

### 41c — Cálculo + admin + sombra

- `calculateTax(ResolvedTax, quantity, baseValue, …)` → `TaxBreakdown`, **inteiramente dirigido pelas flags** de `tax_ref_icms_cst`; CST ausente da referência trata como CST 00 com aviso
- Cobertura de cálculo do sprint: ICMS próprio, redução de BC, diferimento, ICMS-ST por MVA, ST retido (CST 60), PIS/COFINS percentual e por quantidade, IPI, ISS, retenções (IRRF com piso R$ 10,00 do RIR; PCC com mínimo de R$ 5.000,00 da Lei 10.833/2003)
- **Fora do sprint, e recusado explicitamente:** monofásico de combustível, ANP, PMPF, CIDE, cadeia de importação. LogiFit não vende combustível nem importa
- Aritmética em **centavos inteiros** com `roundCents` em toda a cadeia. **Float binário proibido** — é o ponto mais provável de bug no port Go → TypeScript
- 3 Server Actions de configuração (`fiscal.admin`) + 2 de teste sem emitir (`resolveTaxPreview`, `calculateTaxPreview`)
- 2 rotas UI: `/app/settings/fiscal/perfis` e `/app/settings/fiscal/regras`
- **Defaults por ramo** — perfis e regras pré-cadastrados para academia (revenda de suplemento, Simples), clínica (serviço, ISS) e Solo. Sem isso, "perfil fiscal × natureza × UF × regime" é vocabulário de contador e o onboarding morre no mesmo lugar de sempre, só com outra roupa. **É requisito, não polimento**
- `fiscal_tax_shadow_runs` + job diário de comparação; divergência dispara `system_alerts` (regra 33)

### As 8 armadilhas — o sprint não fecha sem elas verdes

Cada uma vem de incidente real datado na implementação de referência. São teste permanente, não checklist manual.

| # | Armadilha | Teste |
|---|---|---|
| 1 | O resolver de item **não preenche `client_type`**; como o filtro descarta regra com `client_type` não-nulo, toda regra com esse campo preenchido some no fluxo de venda | Regra com `client_type` não é escolhida em venda; `NULL` é |
| 2 | CSOSN gravado na coluna `icms_cst` (convenção histórica) | Tenant Simples nunca emite `<CSOSN>` vazio |
| 3 | `vTotTrib` do total ≠ soma dos itens → **rejeição 685** | Mutação de item e total sempre sincronizada |
| 4 | Redução de BC do ICMS **não** se propaga a PIS/COFINS/IPI | Base cheia nos demais tributos |
| 5 | Regras empatadas → tributação instável entre vendas | 100 execuções → resultado idêntico |
| 6 | Emissão sem perfil fiscal / sem regra passava silenciosa | Aborta com **nome e código** do produto |
| 7 | CFOP interno com `idDest ≠ 1` → **cStat 733** | Venda presencial a consumidor de outra UF |
| 8 | Grupo `IBSCBS` em CST 6xx/7xx → **cStat 1021** | Grupo omitido nesses CSTs |

## Dependências

- **Sprint 36** (done 2026-07-30) — `fiscal_emissions` é a fonte do modo sombra; `resolveCfop` (`packages/ai/src/fiscal/cfop-resolver.ts`, 31 testes verdes) é reusado sem alteração
- **Sprint 17** — `company_certificates` já cifrado; 41a consome, não recria
- **Sprint 24 / [ADR 0101](../decisions/0101-pos-vendas-schema.md)** — `products` e `sale_items` com NCM/CEST; 41b só acrescenta colunas
- **[ADR 0108](../decisions/0108-emissao-fiscal-propria-nfe-nfce-nfse.md)** — publicado e aceito (gate operacional do roadmap satisfeito)
- **Regra 47** — publicada em `docs/rules.md`

## Decisões tomadas / ADRs

- **[ADR 0108](../decisions/0108-emissao-fiscal-propria-nfe-nfce-nfse.md)** (Accepted 2026-07-30) — motor dirigido por dados, 4 camadas, cobertura por configuração
- **[ADR 0109](../decisions/0109-impressao-documentos-fiscais.md)** (Accepted 2026-07-30) — impressão; consumido no Sprint 45
- Decisão do sprint: **`packages/fiscal/` como package próprio**, não sub-módulo de `@repo/ai`. Coverage gate 80% (fiscal é crítico; `@repo/ai` está em 60% por causa de integração com LLM)
- Decisão do sprint: **dependências puras em JS**, sem binário nativo em runtime, por causa do ARM do VPS

## Schemas

### `tax_ref_*` (catálogo global, sem `tenant_id`)

Exceção explícita da regra 47, precedente [ADR 0028](../decisions/0028-cid-cif-catalogos-globais.md) (CID/CIF). `GRANT SELECT` para `logifit_app`, sem RLS, na allowlist do `db:rls-check`.

`tax_ref_icms_cst` é a mais importante do sprint: é ela que dirige o cálculo. As demais — `tax_ref_icms_origem`, `tax_ref_mod_bc`, `tax_ref_mod_bc_st`, `tax_ref_pis_cofins_cst` (separa alíquota % de R$/unidade), `tax_ref_ipi_cst`, `tax_ref_csosn`, `tax_ref_cfop`, `tax_ref_ncm`, `tax_ref_cest`, `tax_ref_iss_servico` (LC 116), `tax_ref_cbs_ibs_class_trib` — são lookup puro.

### `fiscal_profiles`

Agrupador de produtos com comportamento fiscal idêntico. `DELETE` cascateia nas regras (proposital: perfil órfão de regra não serve pra nada).

### `tax_rules`

"Para este perfil, nesta operação, neste contexto → estes CST/CFOP/alíquotas". `uf_origem`/`uf_destino` são `text[]` (multivaloradas); `NULL` ou vazio é curinga. Colunas de reforma (`class_t_trib`, `aliq_cbs`, `aliq_ibs_uf`, `aliq_ibs_municipio`) **já nascem aqui** para o Sprint 46 não precisar de migration estrutural.

### `fiscal_tax_shadow_runs`

`computed jsonb` (nosso `TaxBreakdown`) × `authorized jsonb` (valores extraídos do documento que a Focus autorizou) + `diverged` + `diff`. É o que sustenta a decisão de cut-over do Sprint 42.

## Rotas Next.js

| Rota | Conteúdo |
|---|---|
| `/app/settings/fiscal/perfis` | CRUD de perfis fiscais |
| `/app/settings/fiscal/regras` | CRUD de regras + **simulador** (resolve + calculate sem emitir) |

Padrão visual de `settings/fiscal/catalogo/catalog-client.tsx`. Primitivos `.ev-*` (regra 44), mensagens pelo catálogo da regra 45, i18n nos 3 locales (regra 27), responsivo em 390/768/1280 (regra 31).

## Server Actions

Todas via `wrapServerAction` (`apps/web/app/lib/wrap-action.ts`) + `requirePermission`.

```ts
upsertFiscalProfile(input)              // fiscal.admin
upsertTaxRule(input)                    // fiscal.admin
deactivateTaxRule(id)                   // fiscal.admin — sem DELETE físico
resolveTaxPreview(ResolveRequest)       // fiscal.read — simulador, não emite
calculateTaxPreview(ResolveRequest, qty, base)  // fiscal.read — simulador, não emite
```

`seedFiscalDefaultsForBranch(companyId, branch)` roda no onboarding, não é ação de usuário.

## Eventos / integrações

- `fiscal.tax_rule.changed` — invalida cache de resolução
- `fiscal.shadow.diverged` → `system_alerts` (regra 33), fingerprint por `(profile_id, operation_nature)` para dedup
- Cron diário `compare-fiscal-shadow` — compara `fiscal_tax_shadow_runs` do dia anterior

## Estratégia de testes ([ADR 0090](../decisions/0090-estrategia-de-testes.md))

**Categoria de risco:** **fiscal** + **cálculo financeiro** + **multi-tenant base**

**Linha-base transversal:** T1 T2 T3 T5 T6 T14 T16 T17 T19 T20

**Obrigatórios extras** (CI bloqueia merge se faltar):

- **T11** — snapshot determinístico do XML assinado (golden-file). Falha se update de `xml-crypto`/`node-forge` mudar o output. É a única defesa contra regressão silenciosa de assinatura
- **T15** — validação XSD do XML gerado + lint da migration (`tax_ref_*` sem `tenant_id` precisa estar na allowlist, não escapar do check)
- **T21** — fuzzing de parser: `.pfx` malformado, XSD malformado, XML com entidade externa (XXE)
- **T10** — property-based (`fast-check`) nos invariantes de cálculo: `vTotTrib` total ≡ soma dos itens; ICMS nunca negativo; redução de BC não altera base de PIS/COFINS; `roundCents` idempotente
- **T6** — isolamento entre tenants em `fiscal_profiles`/`tax_rules` via `twoConnectionsTest()`; e prova de que `tax_ref_*` é legível por **todos** os tenants (o oposto do teste usual)
- **T7** — não se aplica nesta faixa (sem webhook novo); reavaliado no Sprint 42

**Recomendados aplicados:**

- **T12** (Stryker, mutation) em `resolve.ts` e `calculate.ts`. É o gatilho previsto no ADR 0090 (§"instalar quando primeira função fiscal/clínica crítica existir") — o motor tributário é exatamente isso
- **T9** (type-level) no envelope `ResolvedTax`/`TaxBreakdown`

**Recomendados em débito** (viram issue `test-debt`):

- **T13** (perf) na resolução com 10k regras — só faz sentido com volume real; reavaliar no Sprint 43

**Opcionais avaliados:**

- **T4** (visual regression) — **descartado**: as telas de perfil/regra são formulário CRUD sem layout crítico
- **T18** (chaos) — **descartado nesta faixa**: não há provider externo no caminho; entra no Sprint 42 com o Emissor Nacional

## Definition of Done

- [ ] Feature flag `fiscal_motor_v1` criada, **desabilitada por default** (fail-closed, regra 12)
- [ ] 8 armadilhas com teste verde e nomeado — o teste cita a rejeição/cStat que previne
- [ ] Golden-file de assinatura em CI
- [ ] `db:rls-check` verde **com** a exceção de `tax_ref_*` declarada explicitamente, não silenciada
- [ ] `twoConnectionsTest()` em `fiscal_profiles` e `tax_rules`
- [ ] Coverage ≥80% em `@repo/fiscal`
- [ ] Responsividade 390/768/1280 nas 2 rotas novas (regra 31)
- [ ] i18n 3 locales; `pnpm i18n:check` verde (regra 27)
- [ ] Defaults por ramo cadastrados e testados no onboarding de um tenant novo
- [ ] Modo sombra ligado, gravando em toda emissão Focus, com painel de divergência
- [ ] Chave privada não aparece em log, Sentry/GlitchTip nem retorno de ação — teste que prova
- [ ] `packages/ai/src/fiscal/*` migrado com re-export temporário; nenhuma Server Action existente quebrada
- [ ] Migrations `0067`+ aplicadas e revisadas
- [ ] `CHANGELOG.md` + `docs/roadmap.md` atualizados
- [ ] Zero violação de `docs/rules.md` — atenção especial à regra 47

## Fora de escopo (explicitamente)

- Qualquer emissão ou transmissão. Sprint 42 em diante
- Monofásico, ANP, combustível, importação, ST por PMPF
- DIFAL — entra no Sprint 43, junto com a NF-e que o exige
- IBS/CBS/IS — as colunas nascem no 41b, a lógica é do Sprint 46

## Retro (preencher no fim)

- **Entregue:** …
- **Escorregou:** …
- **Aprendi:** …
