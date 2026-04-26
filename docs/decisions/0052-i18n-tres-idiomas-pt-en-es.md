# ADR 0052 — Internacionalização (i18n) em 3 idiomas: pt-BR, en-US, es-419

- **Status:** Accepted
- **Date:** 2026-04-23
- **Revisado:** 2026-04-25 — reforço de extensibilidade (cadeia de fallback genérica, threshold de catálogos, persistência TEXT sem enum, templates email/PDF multi-locale desde dia 1, `LOCALE_NAMES` registry, runbook de adição de locale). Sem mudança de decisão central — apenas explicitações para que adicionar locale futuro (de-DE, fr-FR, etc) seja `INSERT`/runbook, nunca refactor.

## Context

O planejamento inicial assumia implicitamente produto Brasil-only, com strings em pt-BR hardcoded. Nova decisão do usuário: o LogiFit precisa **atender em pt-BR, en-US e es-419 (espanhol LATAM neutro)** desde o primeiro release.

Motivação real: clínicas premium brasileiras atendem **turistas, expatriados e pacientes de múltiplos países**. Academia em região turística (Florianópolis, Rio, Fortaleza, Gramado, Foz, Cascavel-PR mesmo) tem aluno gringo. Clínica de fisio em cidade grande tem executivo americano na empresa multinacional. Nutri atende paciente mexicano ou argentino morando no Brasil.

Decisão precisa ser **só i18n** (tradução de interface), **não l10n completa** (multi-país com regulamentação diferente). Regulamentação continua Brasil-only (LGPD, CFM, CFN, COFFITO, ANVISA, ANS TISS, CNPJ).

## Decision

Adotar **next-intl** como biblioteca de i18n para Next.js 15 App Router, com 3 locales suportados desde Sprint 00:

- **`pt-BR`** — Português do Brasil (padrão, locale primário)
- **`en-US`** — Inglês dos Estados Unidos (padrão internacional)
- **`es-419`** — Espanhol LATAM neutro (ISO 15924 código genérico para espanhol latino-americano, cobre Argentina, México, Chile, Colômbia, Peru, etc)

### Estratégia

- **UI 100% via chaves i18n** — proibido hardcode de string em componente React (nova regra 27 em `docs/rules.md`)
- **Catálogos com tradução** seguem regra de threshold (extensibilidade por design — adicionar locale futuro deve ser `INSERT`, nunca `ALTER`):
  - **Catálogo > 500 linhas → tabela `translations(entity_type, entity_id, locale, field, value)`** (PK composta, FK por `entity_type`+`entity_id`, índice em `(entity_type, entity_id, locale)`). Adicionar locale = `INSERT` em massa, sem migration. Canônicos: CID-10/CID-11 (~15k), CIF (~1500), TUSS (~5k), TACO alimentos (~3000), exercícios, suplementos, analitos laboratoriais.
  - **Catálogo ≤ 500 linhas → colunas `name_pt`, `name_en`, `name_es`** (mais simples, custo de migration aceitável). Canônicos: tipos de plano comercial, tipos de pagamento, status enums com label visível, categorias de produto, motivos de cancelamento.
- **Seed inicial** em pt-BR completo; en-US e es-419 em paridade prioritária para strings de UI; catálogos traduzidos on demand via IA (Claude sugere tradução que admin revisa)
- **Regulamentação BR-only** — CPF/CNPJ continuam obrigatórios; validação de documento só BR; moeda BRL padrão; Asaas único gateway
- **Formatação regional** via Intl nativo: BRL com vírgula (pt-BR), USD com ponto (en-US), ARS/MXN/COP conforme tenant (es-419 aceita múltiplas moedas no texto mas padrão BRL)
- **Datas**: pt-BR `DD/MM/YYYY`, en-US `MM/DD/YYYY`, es-419 `DD/MM/YYYY`
- **Persistência do locale escolhido** — `persons.preferred_locale` é `TEXT NOT NULL DEFAULT 'pt-BR'` com `CHECK (preferred_locale = ANY(ARRAY['pt-BR','en-US','es-419']))` lido da constante `LOCALES` (`packages/i18n/config.ts`); validação principal na borda Zod usando `z.enum(LOCALES)`. **Proibido enum SQL** (`CREATE TYPE locale_enum AS ENUM …`) — `ALTER TYPE … ADD VALUE` em Postgres é operação que não pode rodar dentro de transação e tem casos degenerados. Adicionar locale futuro = atualizar `LOCALES` no app + atualizar `CHECK` constraint via migration trivial (rebuild de constraint, não de tipo). Tenant default em `tenants.default_locale` segue mesma regra.
- **Fallback em cadeia genérica** (extensibilidade): chave não traduzida em qualquer locale → cai em **en-US** (pivô internacional) → cai em **pt-BR** (default LogiFit) com aviso de string faltando (log para tradutor). Implementação deriva da constante `FALLBACK_CHAIN = ['en-US', 'pt-BR']` em `packages/i18n/config.ts` — adicionar `de-DE`, `fr-FR`, etc futuro herda a mesma cadeia automaticamente sem editar lógica de fallback.

### Organização dos message catalogs

```
apps/web/src/messages/
├── pt-BR/
│   ├── common.json
│   ├── members.json
│   ├── financeiro.json
│   ├── fisio.json
│   ├── nutri.json
│   └── ...
├── en-US/
│   └── (mesma estrutura)
└── es-419/
    └── (mesma estrutura)
```

Namespaces alinhados com domínios/sprints. Cada sprint entrega seu namespace em pt-BR obrigatório + traduções en/es no DoD (gerenciadas via Claude com revisão humana antes de commitar).

### Troca de locale

- **Paciente/member** escolhe idioma em `/meu/perfil` (persiste em `persons.preferred_locale`)
- **Profissional** escolhe em `/app/settings/profile`
- **Tenant default** configurado em `/app/settings/tenant` (novo tenant nasce em pt-BR)
- **Inferência automática** via `Accept-Language` do browser quando usuário não-logado

### Ferramentas de tradução

- **Tradução inicial pt→en e pt→es via Claude** (prompt especializado de tradução médica/fitness)
- **Revisão por falante nativo** antes de release (stretch: contratar revisor)
- **CI check** — script valida que todas as chaves existem nos 3 locales; falha se faltar (regra proposta)

### Fora de escopo (l10n / multi-país)

Explicitamente **não** endereçado por este ADR:

- Documentos de outros países (DNI, SSN, RFC, CURP, CUIT)
- Gateways de pagamento internacionais (Stripe, MercadoPago)
- GDPR, HIPAA, CCPA e outras regulamentações não-BR
- Fiscal internacional
- Moeda base ≠ BRL

Esses temas ficam para futuro ADR (0060+) quando houver demanda real de mercado.

## Consequences

### Positivas

- **Market fit melhor** — clínica premium pode dizer "atendemos em 3 idiomas" como diferencial
- **Sem retrabalho futuro** — i18n é MUITO caro de adicionar depois. Implementando desde o início, custo marginal por sprint é pequeno
- **Base pronta para expansão** — quando decidir ir LATAM, o trabalho de i18n já está feito; só falta l10n
- **Claude assiste** — traduções iniciais via IA reduzem custo humano drasticamente
- **SEO** — site público do tenant (quando existir) ganha indexação em 3 idiomas

### Negativas (mitigáveis)

- **Custo inicial** Sprint 00 — configurar next-intl + messages estrutura + ferramentas de extração (~+1 semana em Sprint 00)
- **Overhead por sprint** — cada string agora passa por chave i18n; testes em 3 locales
- **Revisão de tradução** — en-US e es-419 gerados por IA precisam validação humana; pode atrasar DoD até contratar revisor
- **Catálogos volumosos** — TACO tem ~3000 alimentos; CID-11 tem ~15000 códigos; CIF tem ~1500 domínios. Traduzir todos demora e custa tokens de IA significativos
- **Divergência pt-BR vs pt-PT** — não suportamos pt de Portugal; se vier demanda, adicionar

### Riscos e mitigações

- **Tradução IA errada em termo clínico** ("ferritin" ≠ "ferritina" ≠ "hierro") → prompts especializados + dicionário terminológico médico/fitness + revisão humana antes de release
- **String hardcoded escapando** → regra 27 + lint rule customizada + CI check
- **Performance** — next-intl adiciona ~5kb bundle por locale, negligenciável
- **Spanish regional terms** — es-419 é neutro mas "jugo" (MX/CO) vs "zumo" (ES) etc.; optar por termo mais geral ou adicionar variantes por tenant como stretch futuro

## Escopo de impacto

- **Sprint 00** cresce com: instalar next-intl + middleware + estrutura de messages/ + script de extração + CI check de chaves faltantes + `LOCALE_NAMES` registry + runbook esqueleto de adição de locale + matrix Playwright em locales
- **Regra 27 (nova)** em `docs/rules.md`: "Proibido hardcode de string de UI. Toda string visível vai via `t('namespace.key')` com catálogo nos 3 locales."
- **CLAUDE.md** adiciona i18n na seção de stack + convenção de trabalho
- **docs/arquitetura.md** — stack inclui next-intl v4+
- **docs/modulos.md** — novo módulo transversal "i18n (3 idiomas)" na Fundação
- **Todos os sprints** — DoD ganha item: "[ ] Strings UI extraídas em 3 locales (pt-BR obrigatório, en-US + es-419 via Claude + revisão)"
- **Templates de email (Resend) e PDF (recibo, prontuário, plano alimentar, NF-e visualização) nascem multi-locale desde o primeiro template** — cada template tem 1 catálogo i18n próprio (`apps/web/src/messages/{locale}/email-{template}.json` ou `pdf-{template}.json`); render no locale do destinatário via `persons.preferred_locale`; fallback `tenants.default_locale` quando destinatário sem locale (paciente novo). Sprints 01a (primeiro Resend de auth), 04 (primeira fatura Asaas), 20 (primeiro PDF de prontuário), 22 (XML/PDF TISS), 29 (PDF plano alimentar nutri) ganham bullet "templates por locale" no DoD.
- **`<LocaleSwitcher>` consome `LOCALE_NAMES` registry** (`packages/i18n/config.ts`) — proibido hardcode de label em componente; adicionar locale futuro = adicionar 1 linha em `LOCALE_NAMES` e o componente herda.
- **CHANGELOG.md** — entrada

### Adicionar um locale novo no futuro (extensibilidade)

Procedimento canônico em [`docs/runbooks/adicionar-novo-locale.md`](../runbooks/adicionar-novo-locale.md). Resumo: (1) adicionar string em `LOCALES` array; (2) adicionar entrada em `LOCALE_NAMES` (nome nativo); (3) criar diretório `apps/web/src/messages/{novo-locale}/`; (4) rodar `pnpm i18n:translate --target {locale}` (Claude-assistido); (5) revisão humana; (6) `INSERT` em `translations` para catálogos clínicos via script seed; (7) atualizar `CHECK` constraint de `persons.preferred_locale`; (8) `pnpm i18n:check` deve passar; (9) smoke E2E Playwright na matrix de locales; (10) deploy. **Nenhum refactor de código** — design preserva extensibilidade por construção.

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Só pt-BR + en-US (sem espanhol) | Perde mercado LATAM; custo marginal de +1 locale é pequeno |
| next-i18next | Menos adotado no App Router do Next 15 |
| Lingui | Type-safe mas menos maturo; next-intl é padrão hoje |
| Paraglide (inlang) | Compile-time interessante mas ecossistema menor |
| i18n como sprint dedicado pós-MVP | Refactor gigantesco; melhor incremental desde o início |
| Pular espanhol LATAM, só espanhol Espanha | Mercado LATAM é maior e mais próximo culturalmente do Brasil |
| l10n completa desde já | Custo altíssimo; regulamentação BR-only simplifica drasticamente |

## Related

- Reforça [ADR 0001 — Stack base] (next-intl entra na stack)
- Introduz regra 27 em [docs/rules.md]
- Impacta todos os sprints 02-36 (cada um traduz seu namespace)
- Ciente de futura evolução multi-país (l10n) — fora deste ADR
