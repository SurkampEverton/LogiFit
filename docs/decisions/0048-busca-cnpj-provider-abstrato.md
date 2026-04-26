# ADR 0048 — Busca automática de dados por CNPJ via provider abstrato

- **Status:** Accepted
- **Date:** 2026-04-23

## Context

O cadastro de pessoa jurídica (`persons` com kind=pj — ADR 0047) em `/app/pessoas/new` e no fluxo de criação de company/supplier exige digitar razão social, nome fantasia, endereço completo, telefone, email, CNAE, porte, regime tributário. Digitação manual é:

1. Propensa a erros (endereço copiado errado, razão social com typo)
2. Lenta (cada filial nova custa 5+ minutos de cadastro)
3. Desatualizada (dados digitados em 2026 podem estar errados hoje)
4. Cega para **situação cadastral** — operador cadastra como fornecedor uma empresa baixada sem perceber

A Receita Federal disponibiliza consulta pública de CNPJ; há 3 providers maduros no mercado brasileiro com trade-offs distintos.

## Decision

Adotar **provider abstrato** (mesmo padrão do [ADR 0035 — OCR](0035-ocr-boleto-provider-abstrato.md)) permitindo o admin do tenant escolher o provider:

- **BrasilAPI** (default) — gratuito, open source, estável, sem autenticação, cobre razão social, endereço, CNAE, porte, **regime tributário**, situação cadastral. Uso principal.
- **ReceitaWS** — gratuito 3 req/min (ou plano pago), dados similares, mais antigo no mercado. Usado como fallback se BrasilAPI estiver indisponível.
- **CNPJá!** — pago, oferece **QSA (quadro societário)**, capital social detalhado, histórico. Admin escolhe quando precisa de enriquecimento (clínica grande, compliance).

A interface comum `CnpjProvider` em `packages/ai/cnpj/provider.ts` abstrai. Admin configura em `/app/settings/pessoas/cnpj` — seleciona provider + cola API key (quando exige) + define fallback.

**Cache:** tabela `cnpj_cache` com TTL 7 dias. Implementação simples, balanceada. Três caminhos para refresh forçado:

1. Expira automaticamente (7 dias)
2. Botão "atualizar dados da Receita" em `/app/pessoas/[id]/refresh-cnpj`
3. Job semanal em background (Vercel Cron) valida situação cadastral de todas as companies + suppliers ativos do tenant e alerta se algum virou `inativa`/`baixada`/`suspensa`/`inapta`

**Fluxo de UI:**

```
Operador digita 14 dígitos no campo documento
  ├─ Validação local do dígito verificador
  ├─ Loading "buscando na Receita..."
  ├─ GET /api/pessoas/cnpj/{cnpj}
  │    ├─ Consulta cache primeiro
  │    └─ Se expirado/ausente, chama provider (com fallback)
  ├─ Preenche campos automaticamente:
  │    · razão social → persons.name
  │    · nome fantasia → persons.display_name
  │    · endereço → persons.address
  │    · phone/email (quando disponíveis)
  ├─ Mostra situação cadastral:
  │    · Ativa → segue
  │    · Baixada/Suspensa/Inapta → alerta "ATENÇÃO: empresa {status}. Confirmar?"
  └─ Em paralelo verifica duplicata no tenant → sugere usar cadastro existente
```

**Dados armazenados em `cnpj_cache`:**

```
cnpj_cache (
  cnpj text primary key,         -- 14 dígitos normalizados
  data jsonb not null,           -- payload completo do provider
  provider_used text,            -- qual provider respondeu (auditoria)
  situacao text,                 -- ativa/suspensa/baixada/inapta (destaque)
  fetched_at timestamptz,
  expires_at timestamptz         -- fetched_at + 7 dias
)
```

Cache é **global** (não por tenant) — mesmo CNPJ consultado por tenant A serve tenant B. Economiza chamadas drasticamente. Não viola LGPD porque dados de CNPJ são públicos por natureza (Lei de Acesso à Informação).

## Consequences

### Positivas

- **Redução massiva de digitação** — cadastro de filial nova vai de ~5min para ~30s
- **Dados corretos** vindos da Receita, não digitados à mão
- **Detecção precoce de empresa inativa** — evita problema fiscal de emitir para CNPJ baixado
- **CNAE automático** — alimenta o regime tributário que é usado depois em Sprint 18 (TISS) e emissão fiscal
- **Validação cruzada** — dígito verificador matemático + existência real na Receita
- **Admin troca provider** sem refactor — ex: clínica que vira grande e quer CNPJá! com QSA
- **Cache global** + TTL 7d economiza 95%+ das chamadas

### Negativas

- **Dependência externa** — se BrasilAPI e ReceitaWS caírem simultaneamente, cadastro manual vira único caminho (fallback UI "preencher manualmente" sempre disponível)
- **Cache pode mascarar mudança recente** — 7 dias de atraso em pior caso; job semanal + botão manual mitigam
- **QSA não está no default** — se cliente pedir, precisa upgrade para CNPJá! com API key própria
- **1 tabela a mais no schema** — trivial

### Riscos e mitigações

- **Rate limit da BrasilAPI** → cache reduz requests; fallback para ReceitaWS absorve pico
- **Dados incorretos na Receita** → botão de override manual em cada campo preenchido
- **CNPJ baixado cadastrado como fornecedor** → UI bloqueia salvar com situação ≠ ativa, exige confirmação explícita + razão

## Escopo de impacto

- **Sprint 01a** — adiciona busca CNPJ ao fluxo de cadastro de persons, tabela `cnpj_cache`, provider abstrato, UI config em `/app/settings/pessoas/cnpj`, job semanal de validação
- **`docs/modulos.md`** — módulo "Busca de dados por CNPJ (Receita Federal)" em Fundação
- **`docs/arquitetura.md`** — integração adicional listada em "Integrações Externas"

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Apenas BrasilAPI fechado (sem abstrato) | Se BrasilAPI virar instável ou mudar modelo de negócio, refactor custoso |
| CNPJá! como default pago | Força custo recorrente pra todo tenant; maioria não precisa QSA |
| Sem cache | Sobrecarrega API; UX mais lenta |
| Cache sem TTL (eterno) | Empresa baixada cadastrada como ativa por anos |

## Related

- Complementa [ADR 0047 — Cadastro central persons](0047-cadastro-central-persons.md)
- Mesmo padrão arquitetural de [ADR 0035 — OCR provider abstrato](0035-ocr-boleto-provider-abstrato.md) (quando existir formalmente no Sprint 15)
- Informa Sprint 18 TISS/TUSS (regime tributário preenchido automaticamente)
