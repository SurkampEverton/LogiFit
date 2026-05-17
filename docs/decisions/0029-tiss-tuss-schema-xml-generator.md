---
slug: tiss-tuss-schema-xml-generator
status: proposed
date: 2026-05-17
---

# ADR 0029 — Estrutura TISS/TUSS + gerador XML 4.01 customizado

## Contexto

Sprint 22 entrega faturamento por convênios de saúde no padrão **ANS TISS 4.01** (Ofício-Circular nº 1/2026). 3 perguntas estruturais:

1. **Modelagem das entidades** — quantas tabelas, como ligar entre si, onde encaixar `tuss_catalog`, agreement, autorização, guia, lote, glosa
2. **Gerador XML** — biblioteca pré-built vs implementação própria
3. **Versionamento da terminologia** — como rastrear qual versão TUSS estava vigente quando uma guia foi gerada (interpretação histórica de 5+ anos)

## Decisão

### 1. 11 tabelas em `packages/db/src/schema/convenios.ts`

```
insurance_plans          (global LogiFit + tenant editável; ans_code unique global)
tuss_catalog             (global versionado por release; PK (code, version))
tuss_catalog_imports     (audit dos imports semestrais)
insurance_agreements     (tenant ↔ plano + condições financeiras + payment_term_days)
insurance_procedure_prices (PK (agreement_id, tuss_code) + auth_required + max_sessions_per_auth)
member_insurances        (carteirinha do paciente; unique (member, plan, card_number))
authorizations           (pedido → approve/deny; quantity_used ≤ quantity_authorized via CHECK)
billing_guides           (guia consulta|sp_sadt|honorario|internacao; unique (tenant, guide_number))
billing_guide_items      (PK (guide, sequence); CHECK total = quantity × unit_price; cbos_code snapshot)
billing_batches          (lote enviado; guide_ids uuid[])
billing_glosas           (motivo + valor + status pipeline glossed→recurring→recovered|lost)
```

**Por que 11 e não menos:**
- `insurance_procedure_prices` separa de `insurance_agreements` porque mesmo acordo tem dezenas de procedimentos com preços diferentes; aninhar em jsonb perde queryability
- `tuss_catalog` separado de `tuss_catalog_imports` porque imports são audit append-only; catalog é dado vivo
- `billing_guide_items` separado de `billing_guides` porque guia tem 1..N itens com profissional + preço próprios (snapshot CBOS por item)

**Decisões de schema marcantes:**
- `billing_guides.tussVersion` snapshot **obrigatório** (text not null) — rastreabilidade quando lê guia 5 anos depois e precisa saber qual release ANS estava vigente
- `billing_guides.professionalSnapshot` jsonb — snapshot do profissional executante (council_body/state/number/cbo_code) no momento da geração; protege contra alterações em `professional_registrations` invalidarem guias antigas
- CHECK `bgi_total_consistent` (`total_cents = quantity * unit_price_cents`) garante aritmética
- CHECK `bg_paid_le_total` garante operadora nunca paga acima do faturado (sanidade)
- `billing_glosas.amount_glossed_cents > 0` CHECK — glosa zero é inválida semanticamente
- Particionamento futuro: `billing_guides` @volume 2.4M+/ano por trimestre

### 2. Gerador XML customizado (string templates) — não biblioteca

**Aceito:** implementação própria em `packages/db/src/convenios/tiss-generator.ts` com:
- `generateGuideXml(input: GuideInput): string` — guia única consulta ou SP/SADT
- `generateBatchXml(input: BatchInput): string` — envelope de lote
- Escape XML básico (& < > " ') — UTF-8 preserva acentos nativos
- Formato 2 decimais em valores BRL

**Rejeitadas:**

| Alternativa | Motivo |
|---|---|
| `xmlbuilder2` | Dep externa pra resolver problema simples; bundle bloat |
| `fast-xml-parser` build mode | Mais para parsing; build é só string templates |
| Biblioteca TISS específica npm | Nenhuma confiável + atualizada para TISS 4.01 |
| Gerador via Java/Maven (oficial ANS) | Stack incompatível; latência por chamada externa |

**Trade-off aceito:** sem validação XSD ANS oficial no MVP. Sprint 22b adiciona `libxmljs` ou `xmllint` Node binding pra validar contra schema oficial. **Mitigação MVP:** validador proativo (`tiss-validator.ts`, ADR 0031) cobre regras de negócio que causam ~90% das glosas — sem precisar de XSD.

**Trade-off aceito:** XML assinado digitalmente (XMLDSig) **não** está no MVP. Algumas operadoras exigem; Sprint 22b adiciona via `xml-crypto` ou similar quando primeiro tenant cliente real precisar.

### 3. Versionamento da terminologia TUSS

`tuss_catalog` tem PK `(code, version)` — mesmo código pode existir em múltiplas versões. Ex:
```
('20104073', '2026.01', 'Sessão de fisioterapia individual', ...)
('20104073', '2026.07', 'Sessão de fisioterapia individual', 'Texto atualizado pela ANS', ...)
```

`billing_guides.tussVersion` snapshot da versão ativa no momento da geração. Garante que ler uma guia de 2030 mostre a descrição vigente em 2026, não a vigente em 2030.

**Releases canônicas:**
- `'2026.01'` — Ofício-Circular ANS nº 1/2026 (vigente atual; +334 medicamentos, +26k OPME)
- `'2026.07'` — release prevista jul/2026 (Sprint 22+ implementa pipeline; ADR 0030)

### 4. Mapping CBOS via professional_registrations (ADR 0055)

`generateGuide` Server Action consulta `professional_registrations.cbo_code` do executante e bloqueia geração se ausente:

```typescript
if (!activeReg?.cboCode) throw new ApiException({
  code: 'VALIDATION_ERROR',
  message: 'Profissional sem CBOS cadastrado — obrigatório TISS 4.01'
})
```

CBOS persiste em `billing_guide_items.cbos_code` (snapshot) + `billing_guides.professional_snapshot` (jsonb). Mudança futura no registro não invalida guia já enviada.

## Consequências

### Boas
- Schema simples e queryable; sem jsonb aninhado pesado
- Snapshot defensivo (tuss_version + professional) garante rastreabilidade histórica
- Gerador XML sem deps externas; ~250 linhas de código auditável
- CHECK constraints capturam erros aritméticos no DB antes de chegar em runtime

### Ruins
- Sem validação XSD ANS oficial — risco de gerar XML semanticamente inválido em casos extremos
- Sem XML signing — operadoras maiores (Unimed Central) podem rejeitar
- 11 tabelas é um lote grande de schema novo; ramp up mental no time futuro

### Não decididas neste ADR
- Submissão automática SOAP por operadora — vira ADR 0042 quando primeiro cliente real precisar (Sprint 22b)
- OAuth com APIs proprietárias (Unimed/Bradesco) — Sprint 22b
- OCR de carteirinha física (foto) — stretch Sprint 22b

## Status

**Proposed.** Promove para **Accepted** quando primeiro lote real for aceito por operadora sandbox (Unimed CFB ou similar).

## Referências

- [ADR 0079](0079-tiss-401-ans-padrao-vigente.md) — estratégia geral TISS 4.01 (este ADR detalha implementação)
- [ADR 0030](0030-tuss-update-pipeline.md) — pipeline atualização semestral
- [ADR 0031](0031-tiss-validador-proativo.md) — validador proativo XSD + regras negócio
- [ADR 0055](0055-cadastro-profissional-registros-conselho.md) — gate de CBOS via professional_registrations
- Sprint 22 [`docs/sprints/22-fisio-tiss-tuss-convenios.md`](../sprints/22-fisio-tiss-tuss-convenios.md)
