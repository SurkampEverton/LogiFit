# CLAUDE.md — Contexto permanente do projeto LogiFit

> Este arquivo é lido automaticamente em toda conversa com Claude Code neste repo. Mantém padrão sem precisar re-explicar.

## O que é

LogiFit é um ERP SaaS B2B multi-tenant para **Academia + Fisioterapia + Nutrição**, desenvolvido em modo **solo**. Lida com dados de saúde sensíveis (LGPD art. 11) e profissionais regulados (CFM, CRN, CREFITO). Arquitetura precisa ser robusta em isolamento de tenant, auditoria, criptografia e assinatura de prontuário desde o dia 1.

## Modelo comercial

- **4 planos** (ADR 0066 revisado 2026-04-25): **Starter R$ 99** (100 members, **1 vertical à escolha** — Academia OU Fisio OU Nutri, 5 profissionais, 50 NFS-e inclusas) · **Pro R$ 199** (500 members, **todas verticais simultâneas**, Focus NFe completo, Device Hub, Pipeline Exames) · **Business R$ 449** (2.000 members, multi-company, intercompany, adquirência) · **Enterprise sob consulta** (BYOK IA + SLA + white-label + DPO-as-a-service)
- **Overage suave R$ 0,50/member** acima do incluído; cap por tier força upgrade sugerido
- **Notas fiscais inclusas + overage proporcional** (ADR 0066 revisado 2026-04-25): Starter 50 NFS-e/Pro 200/Business 1.000/Enterprise 5.000 inclusas; excedente cobrado a R$ 0,50/0,40/0,35/0,25 por nota emitida (NFS-e + NF-e + NFC-e + devolução + transferência + conserto; eventos não contam). Repasse calibrado sobre custo Focus NFe + margem operacional
- **Trial 14 dias** sem cartão com features Pro; dados retidos 30 dias se não converter
- **Multi-tenant por subdomínio** (ADR 0065): `{slug}.logifit.com.br`
- **Cobrança**: Asaas próprio LogiFit + NFS-e automática via Focus NFe (Sprint 36)
- **IA embutida** no plano (Gemini Flash default LogiFit) + BYOK opcional — ADR 0064
- **DPO + governança LGPD** (ADR 0067): `privacidade@logifit.com.br` + plano resposta incidente 72h + sub-processors públicos + auditoria interna trimestral

## Marcos regulatórios que norteiam o produto

- **LGPD (Lei 13.709/2018) — art. 11** — dado de saúde é **sensível**; exige base legal explícita + RIPD versionado + consent granular + direitos do titular em 15 dias. Ver [ADR 0054](docs/decisions/0054-lgpd-art11-dados-saude-ripd-versionado.md) + regra 29.
- **CFM 2.454/2026** — IA em medicina: classificação SaMD por feature, supervisão humana documentada, **Comitê de IA interno obrigatório** por instituição-cliente; vigência **agosto/2026**. Ver [ADR 0053](docs/decisions/0053-conformidade-cfm-2454-2026-ia-saude.md) + regra 28.
- **CFM 2.299/2021** — prontuário eletrônico com assinatura ICP-Brasil obrigatória para médicos.
- **COFFITO 414/2012 + 415/2012** — prontuário eletrônico de fisioterapeuta; ICP-Brasil **opcional** se houver sistema autenticado + trilha de auditoria. Ver Sprint 20.
- **CFN 599/2018** — registro eletrônico de nutricionista com autenticação + trilha; ICP-Brasil não obrigatório.
- **Leis dos conselhos profissionais** — **Lei 3.268/1957** (CFM/CRM, médicos), **Lei 6.316/1975** (COFFITO/CREFITO, fisioterapeutas), **Lei 6.583/1978** (CFN/CRN, nutricionistas), **Lei 9.696/1998** (CONFEF/CREF, educadores físicos/personal trainers). Cadastro de número de conselho + situação por profissional vive em `professional_registrations` (Sprint 01b, ADR 0055); gates de assinatura (Sprint 20), TISS (Sprint 22), contrato (Sprint 23) e onboarding PT (Sprint 08) consomem.
- **ANVISA RDC 657/2022 + RDC 751/2022** — Software as Medical Device (SaMD): classes I/II (baixo risco) → notificação; III/IV (alto risco) → registro pleno. LogiFit evita Classe III por design.
- **ANS TISS 4.01 (Ofício-Circular ANS nº 1/2026)** — padrão vigente para faturamento de convênios; LogiFit mantém pipeline de atualização semestral da terminologia TUSS. Ver Sprint 22.
- **NT 2012/002 SEFAZ / ENCAT** — Manifestação do Destinatário de NF-e: 4 eventos fiscais (Ciência, Confirmação, Desconhecimento, Não Realizada) obrigatórios para destinatário com CNPJ no prazo de 180 dias. Ciência automática ativa por padrão no LogiFit; demais eventos manuais. Ver [ADR 0057](docs/decisions/0057-manifestacao-destinatario-nfe.md) + Sprint 17.
- **Emissão fiscal unificada via Focus NFe** — LogiFit não toca em motor tributário. Todas as emissões (NFS-e, NF-e produto, NFC-e varejo, NF-e devolução, NF-e transferência, NF-e conserto, NF-e entrada própria, CC-e, cancelamento, inutilização) passam pelo provider Focus NFe. Ver [ADR 0059](docs/decisions/0059-ciclo-fiscal-emissao-focus-nfe.md) + Sprint 36. NT 2013/005 SEFAZ (NFC-e), NT 2011/004 SEFAZ (CC-e), RTC 1.400/2016 ABRASF (NFS-e) cobertas pelo provider. **Custo fiscal repassado ao tenant via overage** (ADR 0066 revisado 2026-04-25); rejeitado explicitamente o caminho de motor fiscal próprio (8-12 meses solo + manutenção eterna).
- **NFS-e Padrão Nacional como provider complementar futuro** ([ADR 0076](docs/decisions/0076-nfse-nacional-provider-complementar.md)) — não substitui Focus NFe; complementa para municípios aderidos (gratuito, infra federal). Não entra no MVP — gatilhos: Sprint 36 estável há 3 meses + 10k notas/mês LogiFit + 30% emissões em municípios aderidos. Reusa interface `FiscalProvider`.
- **Cobertura fiscal faseada (ADR 0061)** — Fase atual cobre Grupos A (emissão via Focus), B (retenções em AP) e G (retenções em comissão/RPA) + portal `contador_externo` read-only (LGPD). Fases futuras mapeadas no roadmap (Sprints 37-40): apuração mensal, guias oficiais DAS/DARF, obrigações acessórias SPED/ECD/ECF, folha CLT + eSocial. LogiFit vai assumir progressivamente; ambição de cobertura completa. Fontes: Lei 10.833/2003 (retenções), IN RFB 1.234/2012, Tabela IRRF RFB, Portaria INSS (teto anual), LC 116/2003 (ISS).

## Documentação de referência (leia antes de planejar)

- [`docs/arquitetura.md`](docs/arquitetura.md) — visão geral da arquitetura e stack
- [`docs/rules.md`](docs/rules.md) — **42 regras duras** (arquiteturais, processo, código, i18n, IA, LGPD, pesquisa global, responsividade, arquitetura IA, tratamento de erros, escalabilidade do banco, segurança em profundidade, assistente IA universal, passaporte cross-tenant)
- [`docs/modulos.md`](docs/modulos.md) — catálogo de módulos por área (fundação, geral, academia, fisio, nutri) + quais verticais usam
- [`docs/multiempresa.md`](docs/multiempresa.md) — hierarquia group → tenant → company → unit + flags de topology
- [`docs/acesso-e-autorizacao.md`](docs/acesso-e-autorizacao.md) — 4 camadas (identidade, tenant, RBAC, consent)
- [`docs/roadmap.md`](docs/roadmap.md) — linha do tempo + controle de evolução por sprint
- [`docs/sprints/`](docs/sprints/) — plano executável de cada sprint
- [`docs/decisions/`](docs/decisions/) — ADRs (por que decidimos assim)
- [`docs/comercial.md`](docs/comercial.md) — apresentação comercial (pitch para clientes/investidores; não é fonte técnica, só espelho em linguagem de venda)

## Regras que você (Claude) DEVE respeitar

1. **Nunca** crie tabela sem `tenant_id` + RLS.
2. **Nunca** use `any` sem comentário `// why:`.
3. **Sempre** valide boundary com Zod (Server Action, API Route, webhook).
4. **Sempre** verifique se há sprint ativo antes de sugerir trabalho fora de escopo (consultar `docs/sprints/` e `docs/roadmap.md`).
5. **Antes** de sugerir nova feature, confirmar com o usuário se cabe no sprint corrente ou vai para backlog.
6. **Se a decisão é arquitetural**, propor criar ADR em `docs/decisions/` no mesmo turno.
7. **Sempre** atualizar `CHANGELOG.md` quando mudar comportamento observável.
8. **Nunca** `git commit` sem o usuário pedir explicitamente.
9. **Nunca** `--force`, `--no-verify`, nem skip de CI.
10. **Respeitar Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`). Commits vão direto em `main` (dev solo); branches só para trabalho longo/arriscado.
11. **Nunca** escrever path absoluto (drive letter, `D:\...`, `/Users/...`, `~/...`) em doc versionada — repo é clonado em máquinas diferentes; usar sempre caminhos relativos a partir da raiz do repo.
12. **Nunca** hardcode string de UI em componente. Sempre via `t('namespace.key')` do next-intl com catálogo nos 3 locales (pt-BR/en-US/es-419). CI `pnpm i18n:check` falha se faltar chave. Ver [ADR 0052](docs/decisions/0052-i18n-tres-idiomas-pt-en-es.md) e regra 27 em `docs/rules.md`.
13. **Nunca** ativar feature IA classe SaMD II+ em tenant sem Comitê de IA cadastrado + ata anexada (gate de feature flag). Toda chamada IA clínica grava `ai_audit_log` (input, output, modelo, decisão humana). Classificador de output ("diagnóstico", "tem [doença]") ativo sempre. Ver [ADR 0053](docs/decisions/0053-conformidade-cfm-2454-2026-ia-saude.md) e regra 28.
14. **Nunca** criar módulo que processa dado de saúde sem registro em `ripd_documents` com versão vigente + consent por finalidade explícita. CI bloqueia. Ver [ADR 0054](docs/decisions/0054-lgpd-art11-dados-saude-ripd-versionado.md) e regra 29.
15. **Módulo novo com dado pesquisável** registra-se em `search_index` com `required_permission` explícita (trigger `search_index_sync()` + kind/label/url/searchable_text). Omissão viola regra 30. Ver [ADR 0062](docs/decisions/0062-pesquisa-global-command-palette.md).
16. **Toda UI mobile-first** — usar `<AppLayout>`/`<ResponsiveTable>`/`<ResponsiveModal>`/`<ResponsiveForm>` de `packages/ui/layout/*`; testes Playwright em 3 viewports (390/768/1280); touch targets ≥44px. Proibido construir layout próprio duplicado. Ver [ADR 0063](docs/decisions/0063-responsividade-total-mobile-first.md) e regra 31.
17. **Chamada de IA via `resolveModelForTask(task, featureKey?, tenantCtx)`** — nunca hardcode provider/modelo. Tasks canônicas: chat/embedding/classification/extraction/vision/transcription/reasoning. Tool calling sempre via Server Actions tipadas (proibido SQL arbitrário do LLM). System prompt via `buildSystemPrompt()` composto. Ver [ADR 0064](docs/decisions/0064-ia-arquitetura-gemini-default-byok-rag.md) e regra 32.
18. **Server Action / API Route / Job SEMPRE usa `wrapAction()` / `wrapApiHandler()` / `wrapJob()`** de `packages/errors/`. O wrapper valida context (auth + permissions + rate limit + gates IA/consent), traduz erros via translator do domínio, cria `system_alerts` async com fingerprint (dedup), grava `audit_log` quando aplicável, captura em Sentry `INTERNAL_ERROR`, e retorna envelope `{ ok, data | error }` tipado. Regra 33 enforced em CI via lint `no-unwrapped-action`. Ver [ADR 0071](docs/decisions/0071-sistema-tratamento-erros-alertas-tempo-real.md).
19. **Toda tabela com volume estimado >5M linhas/ano OU >50k linhas/dia nasce particionada.** Migration declara `@volume_estimate_yearly: <N>` em comentário SQL; CI lint bloqueia se excede sem partição. Estratégia padrão `PARTITION BY RANGE` em coluna temporal (mês/trimestre/ano) ou `HASH (tenant_id)`. Indexes vivem na partição. Retenção alinhada a compliance: 5a audit · 20a prontuário (CFM 2.299/COFFITO 415) · 5a fiscal · 1a IA audit + 5a cold (CFM 2.454/2026). Cold storage Parquet zstd no Supabase Storage para >2-5 anos. Drop de partição = metadata-only. Sharding via `tenants.shard_url` preparado mas não ativado no MVP. Ver [ADR 0072](docs/decisions/0072-escalabilidade-banco-particionamento-retencao-cold-storage.md) e regra 34.
20. **Security headers obrigatórios no `next.config.ts`** com CSP nonce dinâmico (sem `unsafe-inline` em script-src), HSTS preload, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin, Permissions-Policy restritiva, COOP/CORP. CI valida cada header. Ver [ADR 0073](docs/decisions/0073-postura-seguranca-defesa-em-profundidade.md) e regra 35.
21. **Toda Server Action / API Route / endpoint público tem rate limit Upstash Redis** dentro do `wrapAction()/wrapApiHandler()` (regra 33 + 36) com chave `(tenant_id, user_id, ip, endpoint)`. Limites canônicos em `packages/security/rate-limits.ts`. Excedido → `RATE_LIMITED` envelope. Login com 5 falhas/15min → lockout 30min + Turnstile. Ver [ADR 0073](docs/decisions/0073-postura-seguranca-defesa-em-profundidade.md) e regra 36.
22. **Toda chamada `fetch` para URL externa via `safeFetch()`** de `packages/security/safe-fetch.ts` com `allowedHosts` obrigatória, bloqueio de IP privado/loopback/link-local, timeout 30s, redirect manual. Lint custom `no-raw-fetch` bloqueia commit. LLM tool calling **nunca** chama URL arbitrária. Ver [ADR 0073](docs/decisions/0073-postura-seguranca-defesa-em-profundidade.md) e regra 37.
23. **Todo upload em Supabase Storage passa por `scanUpload()`** de `packages/security/scan-upload.ts` — MIME real (file-type), magic bytes, embed proibido (PDF JS / Office macro), ClamAV scan. Tabela `upload_scans` rastreia status. Arquivo só vira `published` após `clean`. Lint `no-unscanned-upload`. Ver [ADR 0073](docs/decisions/0073-postura-seguranca-defesa-em-profundidade.md) e regra 38.
24. **`audit_log` mantém hash chain** — trigger BEFORE INSERT computa `current_hash = sha256(... || previous_hash)` ligando linhas do mesmo tenant; job semanal verifica continuidade; quebra dispara `system_alerts critical`. Anchor S3 Object Lock WORM 1h. Ver [ADR 0073](docs/decisions/0073-postura-seguranca-defesa-em-profundidade.md) e regra 39.
25. **Backup off-site AWS S3 cifrado + teste de restauração trimestral + DR plan documentado.** RPO 24h / RTO 4h. Chaves de criptografia em backup separado do dado (defesa em profundidade). Ver [ADR 0073](docs/decisions/0073-postura-seguranca-defesa-em-profundidade.md) e regra 40.
26. **Server Action exposta ao Assistente IA registra-se em `tools_registry` via `registerAITool({...})`** em arquivo `<modulo>/ai-tools.ts` declarando `key`, `layer` (`help`/`insight`/`action`), `whenAvailable`, `showInPersonas[]`, `argsSchema/resultSchema` Zod, `requiresConfirmation`, `handler`, `audit`, `rateLimitKey`. Server Action **não-exposta** tem `// ai-blocked: <motivo>` no topo (lint `ai-block-respected` em CI). Tools Camada 3 (write) sempre passam por `<ActionConfirmDialog>`: LLM nunca chama Server Action diretamente — sempre via `proposeAction(toolKey, args)` que cria registro em `assistant_action_proposals` aguardando confirmação UI; handler real exige `proposal_id` confirmado válido (proteção dupla — `actionSource='ai_assistant'` sem proposta = `FORBIDDEN`). Bloqueado MVP: DELETE, `signEvolution`, `chargeBatch`, `anonymizeMember`, `transferMemberBetweenCompanies`, `runOpenFinancePayment`, mudanças em config. Ver [ADR 0075](docs/decisions/0075-assistente-ia-universal-tres-camadas-tool-registry.md) e regra 41.

27. **Dado de paciente cruza `tenant_id` SOMENTE via vínculo cross-tenant ativo.** Modelo C híbrido: vínculo paciente↔empresa (`patient_company_links`) com **módulos liberados explícitos** (`patient_link_modules`) e **responsável técnico por módulo** (atende CFM/COFFITO/CFN/CONFEF). 5 módulos canônicos no MVP via lookup table extensível: `academia`, `personal_training`, `fisioterapia`, `nutricao`, `pilates`. **Constraint global:** 1 módulo ativo por paciente em toda a rede — nova empresa do mesmo módulo dispara substituição com confirmação do paciente. **2 paths de criação de conta:** reativo (profissional manda invite, paciente cria conta junto com aceite) e proativo (paciente vai em `app.logifit.com.br/cadastro`, cria conta sozinho com SMS+email+Turnstile, recebe invites ou convida profissional/empresa). Aceite parcial suportado. **5 níveis de dados** (Identidade → Antropometria → Treino → Clínico → Workspace) — Nível 5 nunca cruza tenant nem é exibido ao paciente. **Limites duros:** financeiro nunca cruza, prontuário CFM original nunca cruza (só resumo gerado pelo paciente), dado de outras pessoas mencionado nunca cruza. **Cross-tenant entrega resumido**, não bruto. Toda leitura cross-tenant grava `patient_data_access_log` (síncrono não-bloqueante, particionado mensal — regra 34). Lint `cross-tenant-read-must-log` enforça. Cobrança LogiFit: 1 active member por (paciente, tenant), independente de quantos módulos. Ver [ADR 0077](docs/decisions/0077-passaporte-paciente-vinculo-cross-tenant.md) e regra 42.

Lista completa em [`docs/rules.md`](docs/rules.md) (42 regras duras).

## Stack (fixa — mudanças exigem ADR)

- **Frontend:** Next.js 15 (App Router), React 19, Tailwind CSS v4, shadcn/ui, Zustand, TanStack Query, React Hook Form, Zod, **next-intl (i18n — pt-BR default + en-US + es-419)**
- **Backend:** Next.js server-side (Server Components + Server Actions + API Routes) — sem serviço separado
- **Banco/Auth/Realtime/Storage:** Supabase **(MVP)** → migra pra **Postgres no Oracle Cloud OCI free tier + BetterAuth/Lucia + Cloudflare R2 + LISTEN/NOTIFY** no Sprint 19b. Ver [ADR 0078](docs/decisions/0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md).
- **ORM:** Drizzle (fonte única de schema)
- **IA:** Vercel AI SDK com **Gemini 2.5 Flash (Vertex AI SP) como default LogiFit** + **Groq Whisper para STT** + BYOK opcional (Claude/GPT/Maritaca/Anthropic) + fallback cascade; tasks tipadas (chat/embedding/classification/extraction/vision/transcription/reasoning); `resolveModelForTask()` nunca hardcode; cache semântico pgvector + quota mensal + rate limit Upstash Redis. Ver [ADR 0064](docs/decisions/0064-ia-arquitetura-gemini-default-byok-rag.md).
- **Pagamentos:** Asaas
- **Email:** Resend
- **Observabilidade:** Sentry + PostHog + Logtail/Axiom
- **Qualidade:** Vitest + Playwright + GitHub Actions + Biome
- **Infra:** **Fase 1 (MVP):** Vercel + Supabase Pro · **Fase 2 (pós-Sprint 19b):** Vercel + Oracle Cloud OCI (PG self-hosted) + Cloudflare R2. Estratégia em 2 fases — [ADR 0078](docs/decisions/0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md).

### Regras de portabilidade durante MVP (ADR 0078)

Pra migração no Sprint 19b ser tranquila, **8 regras de portabilidade** valem desde o Sprint 00:

1. RLS policies em SQL puro em `packages/db/policies/*.sql` (NUNCA via Supabase Studio)
2. Auth via JWT + cookie httpOnly próprio (NUNCA `@supabase/auth-helpers-nextjs`)
3. Storage com adapter pattern em `packages/storage/` (interface + `SupabaseStorageAdapter` default)
4. Realtime usa PG `LISTEN/NOTIFY` quando possível; Supabase Realtime apenas pra broadcast pra muitos clients
5. **PROIBIDO Supabase Edge Functions** — toda lógica server-side via Server Actions/API Routes; lint `no-supabase-functions` em CI
6. PgBouncer-friendly desde dia 1 (sem prepared statements long-lived)
7. Connection string via `DATABASE_URL` env; Drizzle direto, NUNCA `supabase.from(...).select()` pra queries; lint `no-direct-supabase-query` em CI
8. Drizzle como única fonte de schema (regra 3 já existente)

## Estrutura do monorepo

```
apps/
  web/              # Next.js 15 (único app no MVP)
packages/
  db/               # Drizzle schemas, migrations, RLS policies
  ui/               # shadcn custom + tokens "Equilíbrio Vital"
  ai/               # Vercel AI SDK wrappers + cache semântico
  types/            # Zod schemas compartilhados + tipos de eventos
  config/           # tsconfig base, biome.json
```

## Comandos comuns (Sprint 00 vai materializar)

```bash
pnpm dev              # Next.js em localhost:3000
pnpm test             # Vitest
pnpm test:e2e         # Playwright
pnpm db:migrate       # Drizzle migrate
pnpm db:seed          # Seed dos 4 cenários canônicos
pnpm db:rls-check     # Teste que falha se tabela sem RLS
pnpm lint             # Biome lint + format
pnpm typecheck        # tsc --noEmit
```

## Convenções

### Branches
- **Commits vão direto em `main`** (dev solo, sem PR review obrigatório)
- Branches `feat/sprint-XX-slug`, `fix/slug`, `chore/slug`, `docs/slug` são **opcionais** — usar só para trabalho longo, arriscado, ou que precisa ser testado isolado antes de merge

### Commits
- Conventional Commits obrigatório

### Arquivos
- TypeScript `strict: true`
- Imports absolutos: `@repo/db`, `@repo/ui`, `@repo/types`, `@repo/ai`
- Componentes em PascalCase, arquivos em kebab-case
- Server Actions retornam `{ ok: true, data } | { ok: false, error }`

### Testes
- Unit: Vitest, co-localizados (`.test.ts` ao lado do arquivo)
- E2E: Playwright em `apps/web/e2e/`
- RLS: script dedicado em `packages/db/tests/rls.test.ts`

## Hierarquia multi-empresa (essencial — leia `docs/multiempresa.md`)

```
group (opcional, sem CNPJ, só agregados)
 └── tenant (contrato SaaS, RLS raiz)
      └── company (matriz/filial, CNPJ, 1 matriz obrigatória)
           └── unit (local físico)
```

**Flags do tenant:** `topology` (`owned`/`franchise`), `financial_mode` (`centralized`/`distributed`), `cross_company_access` (bool).

**4 cenários canônicos obrigatórios no seed:** rede própria, franquia clássica, franquia com passaporte, mix loja avulsa + rede no mesmo group.

## Modelo de autorização (essencial — leia `docs/acesso-e-autorizacao.md`)

4 camadas: Identidade (Supabase Auth + MFA) → Tenant (RLS raiz) → RBAC com scope → Consent (cross-module / cross-company).

JWT claims custom: `tenant_id`, `scopes[]`, `group_ids[]`, `topology`, `mfa`.

## Sprint ativo

Consultar [`docs/roadmap.md`](docs/roadmap.md) — seção "Sprints ativos".

## Fora de escopo do MVP

- App nativo Expo (Fase 3)
- Generative UI (Fase 2)
- Módulo fiscal/NF-e (Fase 3 via Focus NFe)
- Fisioterapia e Nutrição (Fases 2 e 3)

## Como propor mudanças arquiteturais

1. Escrever ADR em `docs/decisions/NNNN-slug.md` com Context / Decision / Consequences / Status / Date
2. Linkar ADR no PR que introduz a mudança
3. Atualizar `docs/rules.md` se alterar uma regra
4. Atualizar `CHANGELOG.md`
5. Discutir com usuário antes de implementar

## Estilo de trabalho preferido

- Respostas concisas e diretas; sem narrar processo de pensamento
- Propor antes de executar quando a decisão é reversível com custo
- Executar direto quando o pedido é claro e a ação é reversível sem custo
- Usar TodoWrite para tarefas multi-passos
- Não criar arquivos `.md` fora do necessário; não adicionar comentários explicando o óbvio
- Mostrar caminhos relativos nos links markdown para facilitar navegação
