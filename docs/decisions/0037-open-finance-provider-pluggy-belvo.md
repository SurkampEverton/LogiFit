---
slug: open-finance-provider-pluggy-belvo
status: proposed
date: 2026-05-15
---

# ADR 0037 — Provider Open Finance: interface abstrata + Pluggy default + Belvo fallback

## Contexto

Sprint 17 entrega integração com bancos via Open Finance pra:
1. Sincronizar transações bancárias automaticamente (substitui upload OFX manual)
2. Identificar saldo atual em tempo quase-real
3. (Stretch) Iniciar TED/PIX programaticamente

Open Finance Brasil padroniza APIs, mas implementar **direto com cada banco** exigiria:
- Aprovação BACEN para Initiator/Receiver participant
- Certificados ICP-Brasil próprios pra cada banco
- 6-12 meses de homologação por instituição
- 1000+ horas de dev

Inviável pro MVP solo. Solução: **agregadores comerciais** que já têm aprovação BACEN + cobertura multi-banco.

3 candidatos analisados:

| Provider | Cobertura BR | Pricing | Latência | API quality |
|---|---|---|---|---|
| **Pluggy** | 80+ bancos | ~R$ 0,30/conexão/mês | ~3s sync | Excelente; SDK Node nativo; webhook robusto |
| **Belvo** | 40+ bancos | ~$0,50/conexão (USD) | ~5s sync | Boa; SDK Node ok; foco LatAm geral |
| **API direta** | 1 por integração | Grátis (mas dev cost altíssimo) | Variável | Complexo; cada banco tem swagger próprio |

Pluggy é **brasileiro**, mais barato em BRL, maior cobertura local, e melhor DX. Belvo é alternativa pan-LatAm caso LogiFit expanda pra Argentina/México (improvável MVP).

## Decisão

### Interface abstrata `OpenFinanceProvider` em `packages/ai/openfinance/provider.ts`

```typescript
export interface OpenFinanceProvider {
  /** OAuth init → URL para redirecionar user */
  startConnection(input: { tenantId; companyId; redirectUri }): Promise<{ authUrl: string }>
  /** Callback handler — troca code por token */
  exchangeCode(input: { code; state }): Promise<{ accessToken; refreshToken; expiresAt }>
  /** Lista contas vinculadas à conexão */
  listAccounts(connectionId: string): Promise<BankAccountInfo[]>
  /** Sync incremental: traz transações novas desde cursor */
  syncTransactions(input: { connectionId; accountId; cursor? }): Promise<{
    transactions: ParsedTransaction[]
    nextCursor: string
    completed: boolean
  }>
  /** Refresh token quando expira */
  refreshToken(refreshToken: string): Promise<{ accessToken; expiresAt }>
  /** Revoga conexão (user pediu disconnect) */
  revokeConnection(connectionId: string): Promise<void>
}
```

Adapters concretos em `packages/ai/openfinance/providers/`:
- `pluggy.ts` (default; `api.pluggy.ai`)
- `belvo.ts` (alternativa; `api.belvo.com`)
- `mock.ts` (testes — retorna data sintética)

**`resolveProvider(tenantId)` → provider** vem de `tenant_settings.openfinance_provider`. Default global: Pluggy.

### Schema já criado em `bancos.ts` (Sprint 17 Faixa A)

```sql
openfinance_connections (
  provider openfinance_provider NOT NULL,  -- enum pluggy|belvo|direct
  external_connection_id text,             -- item_id do provider
  access_token_encrypted text,             -- AES-256-GCM + KEK por company
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  status openfinance_connection_status,    -- pending|active|error|expired|revoked
  last_sync_error text,
  ...
)
```

`bank_accounts.openfinance_connection_id nullable` linka conta cadastrada com OAuth integration. NULL = conta manual (OFX upload).

### Segurança (regra 35, 37, 38 + ADR 0073)

- Tokens cifrados AES-256-GCM com KEK por company (envelope crypto)
- Toda chamada HTTP via `safeFetch()` (regra 37) com allowlist `api.pluggy.ai` / `api.belvo.com`
- Webhook `POST /api/financeiro/openfinance/callback` valida HMAC signature do provider + IP source
- Tokens NUNCA logados em `pino` (estruturado com `redact: ['access_token*', 'refresh_token*']`)
- Rate limit Redis por `(tenant, op)` em `connectBankAccount`/`refreshBankAccount` (regra 36)

### Roadmap de implementação

**Sprint 17 Faixa A-C (já entregue):**
- Schemas + RLS prontos
- Server Action `connectBankAccount` retorna `INTERNAL_ERROR` com mensagem "POC pendente"
- UI permite cadastrar conta **manual** + importar OFX como fallback

**Sprint 17b (POC quando houver credenciais):**
- Conta sandbox Pluggy (gratuita; ~15 min setup)
- Adapter `pluggy.ts` com OAuth + listAccounts + syncTransactions
- Webhook callback + HMAC validation
- Job cron diário `/api/jobs/openfinance/sync-daily` chama `syncTransactions` por conexão ativa
- Belvo `belvo.ts` fica como adapter alternativo (não-prioridade até cliente solicitar)

## Consequências

**Positivas:**
- Adapter pattern permite trocar provider sem mudar UI/Server Actions/Schema
- OFX upload **continua funcionando** como fallback pra bancos não cobertos pelo Pluggy
- Schema já preparado pra Sprint 17b sem nova migration
- Custo baixo (~R$ 0,30 × N contas/mês — repassável via overage no plano comercial)
- Default Pluggy mas tenant Enterprise pode trocar por Belvo via `tenant_settings`

**Negativas:**
- Dependência externa adicional (regra 46 — ADR justifica): mitigação = fallback OFX manual sempre disponível
- Pluggy ou Belvo podem deprecar APIs — interface abstrata reduz blast radius
- Sandbox Pluggy tem rate limits agressivos — testes E2E precisam usar mocks
- Refresh token expira em 7-30 dias dependendo do banco — job de refresh proativo necessário

**Neutras:**
- Pluggy oferece BACEN-regulated AISP/PISP (read + payment initiation); MVP usa só AISP (read).
- Belvo cobertura LatAm > Brasil pura, vantagem futura

## Alternativas consideradas

**API direta com cada banco (BACEN AISP via Sandbox)** — viável apenas Long-term com 1000+ horas de dev e aprovação regulatória; rejeitado pro MVP solo.

**Plaid (referência global)** — não tem cobertura BR significativa; rejeitado.

**Único provider sem abstrair (vendor lock-in)** — economiza 1-2 sprints; rejeitado por regra 46 + Belvo é alternativa real pra LatAm expansion.

**Mock-only no MVP (sem provider real)** — viável MAS perde valor crítico (operador continuaria precisando upload OFX manual). Aceito **temporariamente até POC**.

## Status

**Proposed** (2026-05-15). Promove pra **Accepted** quando POC Sprint 17b for executada e Pluggy sandbox validar fluxo completo.

## Referências

- [Sprint 17 — Bancos + Open Finance](../sprints/17-geral-bancos-open-finance.md)
- [ADR 0073](0073-postura-seguranca-defesa-em-profundidade.md) — envelope encryption AES-256-GCM
- Regra 35 (CSP/headers), 37 (safeFetch), 38 (scanUpload), 46 (dependência externa exige ADR)
- `packages/db/src/schema/bancos.ts` — schemas prontos
- Pluggy docs: https://docs.pluggy.ai/
- Belvo docs: https://developers.belvo.com/docs/
