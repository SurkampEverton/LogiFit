# ADR 0035 — OCR de boleto: provider abstrato configurável pelo admin do tenant

- **Status:** Accepted (formalizado retroativamente 2026-04-25 — decisão original tomada conversacionalmente em 2026-03 e tratada como aceita por modulos.md, roadmap.md, Sprint 15, ADRs 0048/0049/0050/0051; este arquivo apenas materializa o ADR formal)
- **Date original da decisão:** 2026-03 (aproximada; ver histórico em CHANGELOG.md)
- **Date formalização:** 2026-04-25
- **Sprint que implementa:** [Sprint 15 — ERP Financeiro Core](../sprints/15-geral-erp-financeiro-core.md)

> **⚠️ Violação reconhecida da [regra 13](../rules.md) (CLAUDE.md):** "ADR criado no mesmo dia da decisão; nunca retroativo". Esta ADR foi formalizada ~7 semanas após a decisão original ter sido tomada em conversa e tratada como aceita por documentos downstream. **Causa:** decisão se materializou implicitamente em vários docs antes de ganhar arquivo próprio em `docs/decisions/`. **Lição aprendida:** quando uma decisão arquitetural for citada em ≥2 docs (sprint, modulos, roadmap, outro ADR), criar o ADR no mesmo turno — não deixar para depois. **Compromisso:** nenhum ADR retroativo adicional será criado; auditoria documental futura sinaliza imediatamente decisões implícitas para virarem ADR no dia.

## Context

Sprint 15 (ERP Financeiro Core) entrega Contas a Pagar (AP) com workflow de aprovação. **Lançar AP a partir de PDF/foto de boleto** é um dos fluxos mais frequentes do dia-a-dia financeiro — recepção/financeiro recebe boleto por email, WhatsApp ou impresso e precisa cadastrá-lo sem retrabalho de digitação.

OCR de boleto envolve:
1. Extrair texto do PDF/imagem (OCR)
2. Identificar a linha digitável padrão FEBRABAN (47 dígitos)
3. Decodificar a linha em campos estruturados (banco, valor, vencimento, beneficiário)
4. Pré-popular formulário de AP

**Múltiplos providers oferecem OCR como serviço com tiers gratuitos**:
- **OCR.space** — 25k requests/mês free tier
- **Google Vision API** — 1k/mês free tier; pago depois
- **AWS Textract** — pago desde início, mas alta acurácia
- **Azure Computer Vision** — 5k/mês free tier
- **Tesseract** — open-source self-hosted, sem custo, pior acurácia

Tenant pequeno (Solo/Starter) pode usar OCR.space free tier confortavelmente. Tenant maior (Pro/Business) ou com volume alto de boletos quer escolher provider de melhor acurácia (Textract/Vision). Tenant Enterprise quer Tesseract self-hosted por compliance/dados sensíveis.

**Escolher um provider único para todos os tenants engessa o produto.**

## Decision

Adotar **arquitetura de provider abstrato configurável pelo admin do tenant**, com OCR.space como **default LogiFit** (free tier zero-custo).

### Interface

```typescript
// packages/ocr/provider.ts
export interface OcrProvider {
  extractText(file: File | Buffer): Promise<{
    text: string;
    confidence: number; // 0-1
    metadata?: Record<string, unknown>;
  }>;
}
```

### Adapters

```typescript
// packages/ocr/adapters/
├── ocrspace.ts       // default LogiFit (25k/mês free)
├── google-vision.ts  // pago após 1k/mês free
├── aws-textract.ts   // pago, alta acurácia
├── azure-cv.ts       // pago após 5k/mês free
└── tesseract.ts      // self-hosted, sem custo
```

### Configuração por tenant

UI em `/app/settings/financeiro/ocr` — admin escolhe:

- **Provider primário** (dropdown — default `ocrspace`)
- **Provider fallback** (opcional — usado se primário falhar)
- **Credenciais** (API key criptografada AES-256-GCM com KEK do tenant)
- **Botão "Testar com boleto exemplo"** — sobe boleto teste, roda OCR, mostra resultado lado-a-lado para validar

Schema:

```sql
CREATE TABLE tenant_ocr_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  provider_primary text NOT NULL DEFAULT 'ocrspace',
  provider_fallback text NULL,
  credentials_encrypted jsonb NULL,  -- API keys cifradas
  active boolean DEFAULT true,
  configured_at timestamptz NOT NULL DEFAULT now()
);
```

### Pipeline de processamento

1. Upload PDF/imagem → bucket `boletos-pending` (Storage com `scanUpload()` regra 38)
2. Server Action `extractBoleto(fileId)` → `OcrProvider.extractText(file)`
3. Parser linha digitável FEBRABAN em `packages/ocr/febraban-parser.ts` — extrai banco, valor, vencimento, beneficiário, código de barras
4. Pré-popula formulário AP (`/app/financeiro/ap/new?from=boleto`)
5. Operador revisa e confirma → cria AP

### Custos esperados

| Tenant médio | Boletos/mês | Provider | Custo/mês |
|---|---|---|---|
| Solo | 5-10 | OCR.space free | R$ 0 |
| Starter | 30-50 | OCR.space free | R$ 0 |
| Pro | 100-300 | OCR.space free | R$ 0 |
| Business | 500-2000 | Google Vision pago | R$ 30-100 |
| Enterprise | 5000+ | AWS Textract ou Tesseract self-hosted | R$ 500+ ou $0 |

LogiFit não absorve custo — tenant que escolher provider pago paga direto ao provider (BYOK pattern, igual IA — ADR 0064).

## Consequences

### Positivas

- **Zero custo OCR no MVP** — OCR.space free tier cobre 95% dos tenants
- **Escolha do tenant respeitada** — quem quer Tesseract self-hosted (Enterprise) pluga sem refactor
- **Fácil adicionar provider novo** — implementar `OcrProvider` interface + registrar no enum
- **Testabilidade** — adapter mock para testes sem chamadas externas
- **Coerente com pattern de outros providers** — IA (ADR 0064), CNPJ (ADR 0048), pagamento (Asaas), fiscal (Focus NFe)

### Negativas (mitigáveis)

- **OCR.space free tier rate-limit** — 25k/mês cobre tudo no MVP, mas Sprint 18 (adquirência) pode aumentar volume; monitorar via `system_alerts`
- **Acurácia varia por provider** — boleto borrado funciona melhor em Textract/Vision; OCR.space falha mais. UI permite "tentar novamente com fallback"
- **Configuração complexa para admin não-técnico** — UI bem desenhada com defaults sensatos + tooltip explicando trade-offs

### Riscos não endereçados

- **Provider OCR descontinua serviço** — LogiFit detecta via `system_alerts critical` + email tenant + sugestão de migrar pra outro adapter
- **PDF malformado/protegido** — parser FEBRABAN tem fallback para entrada manual (operador digita linha digitável)

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Hardcode OCR.space para todos | Engessa Enterprise que precisa Tesseract self-hosted; sem caminho de upgrade quando 25k/mês excede |
| Implementar OCR próprio (open-source models) | Complexidade alta, manutenção eterna, qualidade pior que serviços comerciais |
| Não fazer OCR — só entrada manual | Operação manual de centenas de boletos é UX terrível; perde competitividade |
| Provider único pago (Textract) | Adiciona R$ 30-100 ao custo Pro sem o tenant ter escolhido — quebra pricing transparente |

## Escopo de impacto

- **Sprint 15 (ERP Financeiro Core)** — implementação completa: interface + 5 adapters + UI configuração + parser FEBRABAN + pipeline upload→OCR→form AP
- **Sprint 13 (WhatsApp inbound)** — handler `boleto-via-whatsapp` consome `OcrProvider` quando fornecedor manda PDF (ADR 0051)
- **modulos.md** — módulo "OCR de boleto (provider abstrato)" + "Config de provider OCR por tenant"

## Related

- Pattern coerente com [ADR 0048 — Busca CNPJ provider abstrato](0048-busca-cnpj-provider-abstrato.md), [ADR 0064 — IA Gemini default + BYOK](0064-ia-arquitetura-gemini-default-byok-rag.md), [ADR 0051 — WhatsApp inbound canal multi-fluxo](0051-whatsapp-inbound-canal-multifluxo.md)
- Reforça [ADR 0073](0073-postura-seguranca-defesa-em-profundidade.md) (regra 38 — scan de upload) — todo PDF de boleto passa por `scanUpload()` antes de OCR
- Citado em modulos.md (módulo "OCR de boleto"), roadmap.md (decisões fechadas), Sprint 15
