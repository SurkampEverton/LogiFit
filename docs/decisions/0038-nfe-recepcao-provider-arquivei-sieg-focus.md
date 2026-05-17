---
slug: nfe-recepcao-provider-arquivei-sieg-focus
status: proposed
date: 2026-05-15
---

# ADR 0038 — Provider NF-e recepção: interface abstrata + Focus NFe default (recepção integrada com emissão)

## Contexto

Sprint 17 ativa recepção automática de NF-e direto do SEFAZ + download por chave (44 dígitos). Sprint 15 já entregou inbox unificada `nfe_received` (ADR 0056) com 3 métodos manuais funcionais:
- Upload XML
- Entrada manual sem NF
- Botão "Por chave" (desabilitado até este sprint)

Falta o **provider externo** que faz a busca real no SEFAZ. 4 candidatos analisados:

| Provider | Recepção | Custo por NF | Cobertura | API quality |
|---|---|---|---|---|
| **Arquivei** | ✓ | Free tier 50/mês, depois R$ 0,15/NF | Federal | Boa; API REST simples |
| **Sieg** | ✓ | R$ 0,12/NF | Federal | Razoável; menos polida |
| **Focus NFe** | ✓ + Emissão | Recepção R$ 0,15/NF (incluso pra clientes emissor) | Federal | Excelente; **já será nosso provider de emissão Sprint 36 ADR 0059** |
| **SEFAZ direto** | ✓ | Grátis (mas cert A1 obrigatório por tenant + dev complexo) | UF-específico | Endpoints separados por UF; SOAP XML; alta complexidade |

## Decisão

### Interface abstrata `NfeFetcher` em `packages/ai/nfe/fetcher.ts`

```typescript
export interface NfeFetcher {
  /** Download XML por chave 44 dígitos (operador colou no UI) */
  fetchByKey(input: { chave; companyCnpj; certificateId? }): Promise<{
    xml: string
    parsedSummary: { emitterCnpj; amount; issueDate; ... }
  }>
  /** Sync incremental: busca NFs novas desde cursor NSU */
  fetchByCnpjCursor(input: { companyCnpj; lastNsu; certificateId? }): Promise<{
    newNfes: Array<{ chave; xml; nsu }>
    nextNsu: string
    completed: boolean
  }>
  /** Envia evento de manifestação do destinatário (ADR 0057):
   *  210210 Ciência / 210200 Confirmar / 210220 Desconhecer / 210240 Não realizada */
  sendManifestation(input: {
    chave; eventCode; justification?; certificateId?
  }): Promise<{ protocol: string; status: string }>
}
```

Adapters em `packages/ai/nfe/providers/`:
- `focus.ts` — **default** quando tenant já é cliente Sprint 36 emissor (sem custo adicional via reuse)
- `arquivei.ts` — alternativa pra tenants sem emissão (free tier 50/mês útil pra solo)
- `sieg.ts` — fallback alternativo pra escala
- `sefaz-direct.ts` — futuro/avançado; cert A1 obrigatório per company

**`resolveProvider(companyId)`:**
1. Se `company` tem `fiscal_provider='focus'` ativo (Sprint 36) → `focus.ts`
2. Senão, `tenant_settings.nfe_recepcao_provider` → arquivei (default) / sieg / sefaz_direct

### Certificado A1 obrigatório quando `provider='sefaz_direct'`

```sql
company_certificates (
  encrypted_pfx bytea NOT NULL,        -- AES-256-GCM
  encrypted_password text NOT NULL,    -- chave KEK separada
  subject_cnpj text,                   -- match com company.person.document
  expires_at timestamptz NOT NULL,
  ...
)
```

Cifrado AES-256-GCM com KEK por company. Senha cifrada com chave separada da pfx (defesa em profundidade ADR 0073 camada 4). `scanUpload()` (regra 38) valida magic bytes do `.pfx` (sequência ASN.1 `30 82`) antes de cifrar — bloqueia upload de arquivo errado disfarçado.

Provider Arquivei/Sieg/Focus **não exige cert por tenant** — provider tem aprovação BACEN e usa seu próprio cert. Tenant apenas autoriza via CNPJ.

### Schema já criado em `certificados.ts` (Sprint 17 Faixa A)

```sql
nfe_sefaz_cursors (
  company_id uuid,
  provider nfe_recepcao_provider,  -- arquivei|sieg|focus|sefaz_direct
  last_nsu text,
  consecutive_failures int,        -- alerta admin após 3
  ...,
  UNIQUE (company_id, provider)
)
```

### Manifestação destinatário (ADR 0057) implementação no Sprint 17b

**Ciência automática default ON** (decisão usuário ADR 0057):
- Handler `onNfeReceived` em `packages/ai/nfe/ciencia-handler.ts` escuta `nfe.received.*`
- Respeita toggle `company_settings.nfe_auto_ciencia_enabled` (default true)
- Dispara evento 210210 via `NfeFetcher.sendManifestation()` em background
- Retry exponential backoff até 3x; falha definitiva → alerta admin

**Confirmar/Desconhecer/Não realizada SEMPRE manuais** — exigem `user_id` no audit. Sem automação possível.

### Segurança (regras 35, 37, 38 + ADR 0073)

- Toda chamada HTTP via `safeFetch()` com allowlist por adapter:
  - `arquivei.ts`: `api.arquivei.com.br`
  - `sieg.ts`: `api.sieg.com`
  - `focus.ts`: `api.focusnfe.com.br`
  - `sefaz-direct.ts`: allowlist por UF (`nfe.fazenda.sp.gov.br`, `nfe.svrs.rs.gov.br`, etc)
- Certificado lido em memória, NUNCA gravado em disco; helper `withDecryptedCertificate(companyId, fn)` controla lifecycle
- XML recebido passa por `scanUpload()` validando MIME (`application/xml`) + sem JS embed
- Rate limit Redis por `(company, provider)` em `fetchByKey`

### Roadmap de implementação

**Sprint 17 Faixa A-C (já entregue):**
- `nfe_sefaz_cursors` schema + RLS prontos
- `company_certificates` schema com bytea/text cifrados prontos
- Inbox UI Sprint 15 já lista linhas — botão "Por chave" continua desabilitado até POC

**Sprint 17b (POC quando houver credenciais):**
- Adapter `arquivei.ts` com `fetchByKey` + `fetchByCnpjCursor` + `sendManifestation`
- Server Action `fetchNfeByKey(chave, companyId)` habilita botão "Por chave"
- Server Action `toggleNfeAutoDownload(companyId, enabled)` real (placeholder hoje)
- Job cron diário `/api/jobs/nfe/sefaz-sync` por company com toggle ativo
- Handler `onNfeReceived` ciência automática
- UI manifestação `/app/financeiro/nfe/[id]/manifestar` modal 4 opções
- Job `nfe-manifestation-expiry` diário marca `expired` em `pending` > 180d
- Job `nfe-manifestation-deadline-warn` emite alerta D-7 (cross-alert Sprint 07)

**Sprint 36 (fiscal emissão — ADR 0059):**
- Adapter `focus.ts` adiciona recepção como tier integrado quando company já é cliente Focus emissor
- `resolveProvider` prioriza Focus se já configurado

## Consequências

**Positivas:**
- Adapter pattern permite trocar provider sem mudar UI/Schema
- Free tier Arquivei (50 NFs/mês) cobre tenant solo
- Focus integrado evita duplo billing pra tenants que já emitem (Sprint 36)
- Manifestação automática reduz risco fiscal (operador esquecendo prazo 180d)
- Certificado cifrado AES-256-GCM atende defesa em profundidade (camada 4)
- Schemas já preparados pra Sprint 17b sem nova migration

**Negativas:**
- Dependência externa adicional (regra 46): mitigação = 3 providers alternativos + entrada manual sempre disponível
- Sandbox Arquivei tem rate limits agressivos
- Manifestação automática requer monitoramento de falhas (consecutive_failures alerta)
- SEFAZ direto não é viável solo (~1000h dev por UF + manutenção eterna)

**Neutras:**
- Cert A1 expira 1 ano — alerta `certificate.expiring_soon` 30 dias antes (cross-alert Sprint 07)
- Provider escolhido por tenant via `tenant_settings`; default global = arquivei (mais barato + free tier)

## Alternativas consideradas

**SEFAZ direto via cert A1 sem agregador** — viável Long-term com investimento heavy; rejeitado MVP por complexidade e cobertura UF-específica.

**Único provider sem abstração** — vendor lock-in violaria regra 46; rejeitado.

**Sem recepção automática (apenas upload manual XML/chave)** — operacionalmente péssimo (operador esquece NFs); rejeitado.

**Recepção integrada apenas com Focus (mesmo provider do emissor)** — força clientes recepção a também emitir; rejeitado MVP — clientes pequenos só recebem NFs sem emitir.

## Status

**Proposed** (2026-05-15). Promove pra **Accepted** quando POC Sprint 17b for executada e Arquivei sandbox + Focus integrado validarem fluxo completo (fetchByKey + ciência automática + cursor sync).

## Referências

- [Sprint 17 — Bancos + Open Finance + NF-e SEFAZ](../sprints/17-geral-bancos-open-finance.md)
- [ADR 0056](0056-nfe-inbox-unificada.md) — inbox `nfe_received` já criada Sprint 15
- [ADR 0057](0057-manifestacao-destinatario-nfe.md) — manifestação destinatário (4 eventos)
- [ADR 0059](0059-ciclo-fiscal-emissao-focus-nfe.md) — Focus NFe emissão Sprint 36
- [ADR 0073](0073-postura-seguranca-defesa-em-profundidade.md) — envelope encryption
- Regra 37 (safeFetch + allowlist), 38 (scanUpload pfx magic bytes), 46 (ADR exige)
- `packages/db/src/schema/certificados.ts` — schemas prontos
- Arquivei docs: https://www.arquivei.com.br/api
- Sieg docs: https://sieg.com/api
- Focus NFe docs: https://focusnfe.com.br/doc/
