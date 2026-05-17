---
slug: adquirencia-provider-abstrato
status: proposed
date: 2026-05-17
---

# ADR 0039 — Adquirência: interface abstrata multi-provider + ordem de integração + antecipação manual default

## Contexto

Sprint 18 fecha o bloco **ERP Financeiro** do MVP integrando o LogiFit com as 5 principais adquirências do mercado brasileiro: Cielo, Stone, Rede (Itaú), GetNet (Santander) e PagSeguro (PicPay). Sem isso, vendas presenciais em maquininha ficam invisíveis ao DRE/aging — o operador precisa lançar AR avulso manualmente todo mês, perdendo a granularidade de bandeira/parcelas/taxa real cobrada.

**Decisões em jogo:**

1. **Arquitetura provider** — adapter por provider (5+) vs API direta vs gateway abstrato externo
2. **Ordem de implementação** — Stone-first / Cielo-first / API-mais-pronta-first
3. **Antecipação automática** — regra "se saldo previsto < X em D+N, antecipe Y% do recebíveis" vs sempre manual

### Cenário de negócio

Cliente típico LogiFit (academia/clínica/franquia) opera com 1-3 maquininhas simultâneas (em geral Stone + Cielo, eventualmente Rede). A operação financeira hoje (sem LogiFit):

- Vendas presenciais ficam isoladas no portal da adquirente
- Conciliação manual: gerente exporta CSV → planilha → cruza com extrato bancário → contabilidade insere AR
- Antecipação pedida ad-hoc quando saldo aperta (com taxa cega — gerente não compara providers)
- Chargeback descoberto só no extrato (atraso 10-15d antes de virar PR pra adquirente)

Com LogiFit:

- Sync diário automático puxa vendas via API por connection
- `acquirer_sales` + `bank_transactions` (Sprint 17) reconciliam automaticamente via regras DSL (auto-match) + similarity fallback (top-3 candidatos)
- Antecipação simulada no UI antes de confirmar (rate% × valor × dias salvos)
- Alerta de divergência D+2 se settlement esperado não bateu no banco

## Decisão

### 1. Interface abstrata `AcquirerAdapter` em `packages/db/src/adquirencia/provider.ts`

```typescript
export type AcquirerProvider = 'cielo' | 'stone' | 'rede' | 'getnet' | 'pagseguro' | 'mock'

export interface AcquirerAdapter {
  readonly provider: AcquirerProvider

  /** Testa credentials + retorna display name do merchant */
  testConnection(credentials, sandbox): Promise<ConnectionTestResult>

  /** Lista vendas em janela [from, to]. Idempotente — duplicadas filtradas por (connection_id, external_id) NSU */
  fetchSales(credentials, sandbox, range): Promise<AcquirerSaleRaw[]>

  /** Solicita antecipação de N vendas; retorna estado + valor líquido aprovado */
  requestAnticipation(credentials, sandbox, request): Promise<AnticipationResult>
}
```

**Sprint 18a entrega apenas `MockAcquirerProvider`** — adapter determinístico gerando 3 vendas/dia pseudo-aleatórias por (merchant_id, range). Permite exercitar toda pipeline (sync → conciliação → antecipação) sem credenciais reais.

**Sprint 18b** adiciona adapters reais conforme tenant piloto fornecer credentials sandbox:
- `packages/db/src/adquirencia/providers/cielo.ts` — Cielo e-Commerce API + Consulta Vendas
- `packages/db/src/adquirencia/providers/stone.ts` — Stone Connect API (REST)
- `packages/db/src/adquirencia/providers/rede.ts` — Rede API + antecipação
- `packages/db/src/adquirencia/providers/getnet.ts` — GetNet API v2
- `packages/db/src/adquirencia/providers/pagseguro.ts` — PagSeguro Consulta Vendas

**Dispatcher `getAdapter(provider)`** falha pedindo POC quando provider != mock:

```typescript
export function getAdapter(provider: AcquirerProvider): AcquirerAdapter {
  if (provider === 'mock') return new MockAcquirerProvider()
  throw new Error(
    `Provider "${provider}" requer credenciais sandbox + adapter real (POC Sprint 18b). ADR 0039 §Próximos passos.`
  )
}
```

Server Action `connectAcquirer` ainda **bloqueia conexão real em produção** no MVP:

```typescript
if (parsed.provider !== 'mock' && !parsed.sandbox) {
  throw new ApiException({
    code: 'INTERNAL_ERROR',
    message: 'Provider real exige credentials cifradas via envelope encryption (ADR 0073 — Sprint 18b POC). Use sandbox=true ou provider=mock.',
  })
}
```

### 2. Ordem de integração Sprint 18b

| Ordem | Provider | Por quê |
|---|---|---|
| 1º | **Stone** | API mais madura (Stone Connect REST, swagger público, sandbox aberto). Cliente médio LogiFit usa Stone. |
| 2º | **Cielo** | Maior volume nacional. API e-Commerce + Consulta Vendas conhecidas; documentação completa. |
| 3º | **Rede** | Antecipação API explícita (útil pra demo do feature). Lock-in Itaú menor que outros. |
| 4º | **GetNet** | API v2 razoável; cobertura Santander. |
| 5º | **PagSeguro** | Última prioridade (maior número de competidores; cobertura B2C). |

**Fallback manual:** upload CSV de vendas no `/adquirencia/[id]/vendas/import-csv` para clientes que ainda não querem dar API key — viabiliza onboarding sem bloqueio.

### 3. Antecipação manual default; automática vira stretch pós-MVP

**MVP:** antecipação só por iniciativa do gerente no UI `/adquirencia/[id]/antecipacao`. Simulador mostra:
- valor original somado
- taxa estimada (rate% × dias até settlement / 30)
- líquido projetado
- dias economizados

Tomada de decisão consciente — antecipar custa dinheiro, regra automática pode "viciar" o operador.

**Pós-MVP (avaliar Sprint 22+ se houver demanda real):**

```typescript
interface AnticipationRule {
  trigger: 'cashflow_below'
  threshold: 'R$ 5.000 em D+7'
  action: 'anticipate_percent'
  percent: 50 // % das vendas pendentes
  maxRatePct: 2.5 // não antecipa se taxa estimada > 2.5%
}
```

Bloqueado no MVP por:
- Tomada de decisão financeira de alto impacto — exige UI cuidadosa
- Sem dado histórico real do tenant para calibrar threshold
- Cliente piloto deve operar manual 3 meses antes de automatizar

### 4. Split de franquia em runtime (não materializado no schema)

`acquirer_sales` **não tem coluna `split_*`**. O split royalty/marketing acontece em runtime na lib pura `packages/db/src/adquirencia/fees.ts#splitFranchiseSale`:

```typescript
splitFranchiseSale({
  netAmountCents,
  capturedAtCompanyId,
  agreements: franchiseAgreements, // Sprint 01b
  saleDescription,
}): IntercompanyEntryDraft[]
```

Retorna lista de `IntercompanyEntryDraft` (`fromCompanyId`/`toCompanyId`/`amountCents`/`kind`) que o cron `acquirer.settle-daily` (Sprint 18b) materializa em `intercompany_entries` (Sprint 16) quando settlement confirmar.

**Regra 25 enforced:** split é financeiro puro. **NÃO** altera member.company nem clínica. Trigger PL/pgSQL do Sprint 16 (`tg_intercompany_franchise_only`) bloqueia inserção fora do agreement vigente.

### 5. Cobertura de chargeback no MVP

Schema suporta `status='chargeback'` em `acquirer_sales`. **Detecção** fica a cargo do provider real (Sprint 18b webhook callbacks) ou diferença descoberta na conciliação. **Alerta** dispara via `system_alerts` (ADR 0071) na próxima sync que retornar status=chargeback. Sem ação automática no MVP — operador investiga pelo `/vendas` filtrado por status.

## Consequências

### Boas

- Abstração permite trocar provider sem refazer UI nem schema
- Provider mock acelera dev solo: pipeline completa testável sem chave real
- Conciliação reusa mesma DSL/heurística de bancos (Sprint 17) — operador aprende 1 mental model
- Adquirência alimenta DRE Sprint 14 + Receita Unificada Sprint 18 dashboard (online + presencial)
- Antecipação manual no MVP evita dívida técnica de motor de regra; cron daily entra com tenant piloto operando

### Ruins

- 5 adapters × N endpoints × diferenças regionais = ~80-120h por adapter real (Sprint 18b dilui)
- Custo de cada API call no provider real (poucos cents/venda, mas escala com volume)
- Idempotência depende do provider retornar `external_id` estável — Cielo costuma reusar NSU em algumas situações; adapter pode precisar de heurística adicional
- Schema não cobre antecipação de **recebíveis específicos** (apenas de venda completa) — caso adquirente ofereça antecipar % de uma parcela específica de 12x, modelar `anticipation_items` em sub-tabela é Sprint 18b
- Webhook reverso (provider notifica chargeback/cancelamento) não está modelado — Sprint 18b adiciona `acquirer_webhook_events` análogo a `webhook_events` Sprint 04

### Não-decididas

- **PIX presencial via Tap-to-Pay (Apple/Google):** Sprint 35 mobile pode integrar com SDKs nativos; não cobre maquininha tradicional.
- **PEC (Programa de Estímulo ao Crédito) / antecipação por adquirente vs banco:** alguns clientes preferem antecipar via banco (linha de crédito) ao invés de provider — outra integração futura.

## Status

**Proposed.** Promove para **Accepted** quando o primeiro POC de adapter real (provavelmente Stone — credenciais sandbox são abertas + grátis) confirmar:
- `testConnection()` funcional contra Stone sandbox
- `fetchSales()` retornando ≥10 vendas reais (mesmo mock)
- `requestAnticipation()` cota+aprovação sem erro 500

Se POC mostrar API divergente do design abstrato, **revisar interface** antes de promover.

## Referências

- [ADR 0034](0034-workflow-aprovacao-ap-declarativo.md) — workflow declarativo (similaridade arquitetural)
- [ADR 0036](0036-rateio-intercompany-dsl-declarativo.md) — DSL declarativa rateio
- [ADR 0037](0037-open-finance-provider-pluggy-belvo.md) — provider abstrato Open Finance (mesma família)
- [ADR 0073](0073-postura-seguranca-defesa-em-profundidade.md) — envelope encryption credentials
- Sprint 18 [`docs/sprints/18-geral-adquirencia.md`](../sprints/18-geral-adquirencia.md)
