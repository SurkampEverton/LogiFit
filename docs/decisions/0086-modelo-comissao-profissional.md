---
slug: modelo-comissao-profissional
status: proposed
date: 2026-05-17
---

# ADR 0086 — Modelo de comissão e repasse profissional

## Contexto

Sprint 23 entrega o módulo de comissões + repasse profissional (fisio autônomo, personal trainer, nutri contratado, médico parceiro). Decisões estruturais:

1. **Modelo de contrato** — quantos kinds, como ligar pessoa/company/serviço
2. **Base de cálculo** — sobre faturado, recebido particular, recebido convênio, ou misto?
3. **Override por procedimento** — tabela própria por serviço/TUSS code
4. **Fechamento mensal** — imutável após approve? Reversão pós-glosa?
5. **Tributação** — calcular INSS/IR retidos no MVP ou só bruto?

## Decisão

### 1. Schema com 4 tabelas em `packages/db/src/schema/rh.ts`

```
professional_contracts  (1..N por person+company+service_type — versionado)
commission_rules        (overrides priority asc sobre default do contrato)
commission_entries      (1 linha por evento gerador — @volume 18M+/ano)
commission_periods      (fechamento mensal agregado — pipeline draft→approved→paid)
```

**Versionamento via `version` column** — UPDATE de contrato cria nova row com `version+1`; old row vira `active=false`. Entries antigas continuam linkadas à version original (imutabilidade histórica).

### 2. 4 kinds × 4 bases

```ts
type CommissionKind =
  | 'percent_faturamento'    // % sobre invoice/billing_guide emitido
  | 'percent_recebido'        // % sobre pagamento efetivado
  | 'fixo_por_atendimento'    // R$ X por evento (independe de valor)
  | 'tabela_por_servico'      // rule define valor por serviço (sem default)

type CommissionBase =
  | 'faturado'                // total emitido
  | 'recebido_particular'     // só pagamentos particulares
  | 'recebido_convenio'       // só pagamentos de convênio
  | 'misto'                   // qualquer recebimento
```

**Compatibilidade kind × event** validada na calculadora pura:
- `percent_faturamento` ← `invoice_issued`
- `percent_recebido` ← `payment_received | guide_paid` (filtrado por base)
- `fixo_por_atendimento` ← `appointment_completed | consulta_signed | evolucao_created`
- `tabela_por_servico` ← qualquer evento (rule decide)

Mismatch retorna `skipReason` ao invés de crash — caller (Server Action) loga e segue.

### 3. Override por priority asc

```
1. Rule com tussCode + serviceType match (mais específico)
2. Rule com tussCode match
3. Rule com serviceType match
4. Fallback default_percent / default_amount_cents do contrato
```

`commission_rules.priority` quebra empate quando múltiplas rules matcham — número menor prevalece.

### 4. Fechamento mensal com imutabilidade pós-approved

`commission_periods.status` pipeline:
- `draft` — entries `pending` viram `included` ao fechar period; ainda mutável
- `approved` — gerente aprovou; entries não podem mudar (Sprint 23b trigger BEFORE UPDATE)
- `paid` — Asaas Sprint 23b confirma transferência; grava `asaas_transfer_id`
- `cancelled` — anulado (entries voltam pra `pending` em outro period)

### 5. Reversão pós-glosa

Quando `billing_glosa.received` ou `payment.refunded`, listener Server Action cria nova entry com `status='reversed'` e `commissionCents=-original` linkada via `reversal_of`. Saldo do period seguinte abate.

**Decisão controversa:** NÃO modifica entry original (imutabilidade). Cria entry de estorno espelhada. Custos:
- Period antigo (já approved/paid) NÃO muda — relatório histórico permanece estável
- Period vigente recebe abatimento — saldo líquido correto sem mexer no passado

### 6. Tributação retenções (ADR 0061)

**MVP Sprint 23a:** `retention_total_cents = 0` placeholder; `net_amount_cents = commission_cents`.

**Sprint 23b:** integra `calculateRetentions()` do Sprint 15 (ADR 0061) consumindo `tax_natures`:
- PF autônomo → `autonomo_rpa_pf`: INSS 11% (cap teto) + IRRF progressivo + ISS retido municipal
- PJ Lucro Real/Presumido → `servico_prestado_pj_geral`: PIS/COFINS/CSLL/IRRF 4,8%
- Simples Nacional → `simples_nacional_anexo_iii`: sem retenção federal (DAS unificada)

Resolução `tax_nature_id` automática: `persons.kind='pf'` → autônomo RPA; `persons.kind='pj'` + lookup regime tributário.

UI mostra decomposição: "Bruto R$ 2.500 → INSS R$ 275 + IRRF R$ 64,12 + ISS R$ 50 = Líquido R$ 2.110,88".

### 7. Gate ADR 0055

`createProfessionalContract` valida `professional_registrations` ativo + council_body coerente:

```ts
const SERVICE_TO_COUNCIL = {
  fisioterapia: 'CREFITO',
  personal_training: 'CREF',
  nutricao: 'CRN',
  medicina: 'CRM',
  enfermagem: 'COREN',
  custom: null, // sem council obrigatório
}
```

Falta = erro 403 com link acionável `/app/pessoas/[id]/registros`.

## Consequências

### Boas
- Schema simples (4 tabelas, sem jsonb pesado)
- Calculadora pura é 100% testável (25 unit tests cobrem todos os caminhos)
- Versionamento + imutabilidade pós-approved protegem auditoria
- Reversão via entry espelhada mantém histórico íntegro
- Gate ADR 0055 garante compliance regulatório

### Ruins
- 4 kinds × 4 bases × overrides = matriz mental complexa pra gerente novo
- Sem cálculo de tributação no MVP — gerente precisa rodar planilha externa
- Sem holerite/PDF estruturado — Sprint 23b implementa @react-pdf/renderer
- Sem job cron mensal automático — gerente fecha manualmente cada profissional
- Asaas transfer real fica Sprint 23b — MVP `markPeriodPaid` só registra ID externo

### Riscos
- Profissional muda de regime tributário no meio do mês → entries antigas ficam com tax_nature_id stale. Mitigação Sprint 23b: snapshot `tax_nature_id` na criação da entry; mudança vira parametrização do próximo period.
- Glosa chega 60+ dias depois → estorno vai pra period futuro (não retroage). Aceitável por imutabilidade. UI Sprint 23b mostra "saldo de estornos R$ X a abater do próximo fechamento".

### Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| 1 tabela única `commissions` com `kind` enum + jsonb config | Schema poliforma vira spaghetti; queryability sofre |
| Cálculo trigger PL/pgSQL | Lógica em SQL é difícil de testar; lib pura TS escala melhor |
| Modificar entry original em estorno | Quebra imutabilidade audit; relatórios históricos mudam retroativamente |
| Calcular tributação inline no MVP | ADR 0061 ainda não tem `tax_natures` materializado; melhor diferir |

## Status

**Proposed.** Promove para **Accepted** quando primeira commission_periods.paid for executada com sucesso (provavelmente Sprint 23b com Asaas sandbox + ADR 0061 integration).

## Referências

- Sprint 23 [`docs/sprints/23-fisio-comissoes-repasse.md`](../sprints/23-fisio-comissoes-repasse.md)
- [ADR 0055](0055-registros-profissionais-em-conselho.md) — gate de council ativo
- [ADR 0061](0061-motor-retencoes-e-cobertura-fiscal-faseada.md) — calculateRetentions Sprint 23b
- [ADR 0086 numbering](../roadmap.md#realocações-da-faixa-0011-0046-→-0080) — alocado fora da faixa 0011-0046 (ver convenção)
