---
slug: tiss-validador-proativo
status: proposed
date: 2026-05-17
---

# ADR 0031 — Validador TISS proativo (10 regras de negócio + XSD futuro)

## Contexto

Glosas TISS são caras: operadora rejeita pagamento por motivo administrativo (carteirinha expirada, autorização vencida, código TUSS sem cobertura) e prestador precisa abrir recurso manual (60-90 dias até resolução, taxa de sucesso ~50%).

**Causa raiz:** prestador envia guia com erro evitável que o validador da operadora pega. LogiFit pode prever esses erros **antes** do envio.

## Decisão

### 1. Validador `validateGuide()` em `packages/db/src/convenios/tiss-validator.ts`

Função pura. Caller carrega rows + chama. Retorna `{ ok, issues: ValidationIssue[] }`. Server Action `generateGuide` aborta quando `ok=false`.

### 2. 10 regras canônicas (MVP)

| # | Code | Severidade | Bloqueia? |
|---|---|---|---|
| 1 | `PROF_NO_CBOS` | error | sim — TISS 4.01 obrigatório |
| 2 | `PROF_NO_COUNCIL` | error | sim — sem council number não há executante válido |
| 3 | `PROF_NO_UF` | error | sim — TISS 4.01 obrigatório |
| 4 | `CARD_MISSING` | error | sim — sem carteirinha não há faturamento |
| 5 | `CARD_EXPIRED` | error | sim — operadora rejeita certo |
| 6 | `AUTH_REQUIRED_MISSING` | error | sim — procedimento exige auth + guia sem número |
| 7 | `AUTH_EXPIRED` | error | sim — auth vencida vs data execução |
| 8 | `AUTH_QTY_EXCEEDED` | error | sim — qty total > autorizada |
| 9 | `AUTH_NOT_APPROVED` | error | sim — status != approved |
| 10 | `TOTAL_MISMATCH` / `ITEM_TOTAL_MISMATCH` | error | sim — aritmética inconsistente |
| 11 | `SPECIALTY_MISMATCH` / `TUSS_SPECIALTY_MISMATCH` | warning | não — alerta operador |
| 12 | `COPAY_MISMATCH` | warning | não — alerta divergência |

Erros bloqueiam; warnings exibem mas permitem prosseguir (operador decide).

### 3. Validação XSD diferida pra Sprint 22b

**MVP:** regras de negócio cobrem ~90% das glosas comuns (carteirinha expirada + auth vencida + CBOS = 70%+ dos casos relatados em estudos ANS). Sem XSD parsing.

**Sprint 22b:** adiciona `libxmljs` Node binding ou `xmllint` shell wrapper que valida output contra schema XSD oficial publicado pela ANS. Vira `validateXmlAgainstAnsXsd(xml): ValidationResult`. Roda em paralelo ao validador de negócio.

### 4. Integração com Server Action

```typescript
export const generateGuide = wrapServerAction({...},
  async (input, { session }) => {
    // ... carrega rows
    const validation = validateGuide({...})
    if (!validation.ok) {
      const errors = validation.issues.filter((i) => i.severity === 'error')
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `Validador TISS bloqueou: ${errors.map(e => e.message).join(' | ')}`
      })
    }
    // ... persiste + gera XML
    return { ..., validationIssues: validation.issues } // warnings retornados
  }
)
```

### 5. Telemetria pós-glosa

Quando glosa real chega (parsed via `processReturnXml`), criar `billing_glosas.reason_code` indexado. Análise mensal: top 10 códigos de glosa → adicionar regra ao validador para prevenir futuras.

Sprint 22b: dashboard `/app/super-admin/glosas-stats` mostra distribuição por motivo + sugere novas regras pro validador.

## Consequências

### Boas
- Bloqueia erros comuns antes do envio — reduz drasticamente trabalho de recurso
- Mensagens acionáveis (`/app/pessoas/[id]/registros` para CBOS, `/app/fisio/autorizacoes/new` para auth)
- Warnings permitem flexibilidade quando regra é ambígua (especialidade)
- Função pura testável — 17 unit tests cobrem caminhos

### Ruins
- Sem XSD oficial = pode passar XML sintaticamente inválido em casos extremos
- Validador é só checagem; não corrige automaticamente (operador edita guia)
- Lista hardcoded de 10 regras — sem DSL configurável (Sprint 22b avalia)

### Riscos
- Operadora tem regra própria não-padrão (ex: Unimed Central exige nome do beneficiário em MAIÚSCULAS) → glosa apesar do validador OK. Mitigação: telemetria pós-glosa alimenta regras específicas por operadora.

## Status

**Proposed.** Promove para **Accepted** após primeiros 100 envios reais com taxa de glosa medida pra validar impact.

## Referências

- [ADR 0079](0079-tiss-401-ans-padrao-vigente.md) — estratégia geral
- [ADR 0029](0029-tiss-tuss-schema-xml-generator.md) — schema (CHECK aritmético já cobre #10 no DB)
- [ADR 0055](0055-registros-profissionais-em-conselho.md) — fonte de CBOS + council
- Sprint 22 [`docs/sprints/22-fisio-tiss-tuss-convenios.md`](../sprints/22-fisio-tiss-tuss-convenios.md)
