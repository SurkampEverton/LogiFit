# CLAUDE.md — Contexto permanente do projeto LogiFit

> Este arquivo é lido automaticamente em toda conversa com Claude Code neste repo. Mantém padrão sem precisar re-explicar.

## O que é

LogiFit é um ERP SaaS B2B multi-tenant para **Academia + Fisioterapia + Nutrição**, desenvolvido em modo **solo**. Lida com dados de saúde sensíveis (LGPD art. 11) e profissionais regulados (CFM, CRN, CREFITO). Arquitetura precisa ser robusta em isolamento de tenant, auditoria, criptografia e assinatura de prontuário desde o dia 1.

## Modelo comercial

**6 planos** ([ADR 0066](docs/decisions/0066-plano-comercial-pricing-trial.md) — versão vigente 2026-04-25; tabela abaixo é fonte canônica):

| Plano | R$/mês | Members | Verticais | Profs | NFS-e/mês | IA/mês | Storage |
|---|---|---|---|---|---|---|---|
| **Solo** | 49 | 30 | 1 à escolha | 1 | 20 | 200 | 1 GB |
| **Solo Combo** | 69 | 60 | até 3 simultâneas | 1 | 30 | 200 | 2 GB |
| **Starter** | 99 | 100 | Academia (MVP) — Fisio/Nutri liberam em Fases 2/3 | 5 | 50 | 500 | 5 GB |
| **Pro** | 199 | 500 | todas simultâneas + Focus NFe + Device Hub + Pipeline Exames | 10 | 200 | 3.000 | 50 GB |
| **Business** | 449 | 2.000 | todas + multi-company (até 3 CNPJs) + intercompany + adquirência | 30 | 1.000 | 10.000 | 200 GB |
| **Enterprise** | sob consulta (~1.199+) | ilimitado | todas + white-label + DPO add-on + SLA | ilimitado | 5.000 | 25.000 ou BYOK | 500 GB+ |

- **Solo / Solo Combo** (`tenants.mode='solo'`, [ADR 0069](docs/decisions/0069-perfil-paciente-hub-operacional.md)) — profissional autônomo (CREF/CREFITO/CRN/CRP/CRO/Pilates/esteticista) com UX simplificada e templates por profissão.
- **Overage member** R$ 0,50/member acima do incluído (Solo/Combo: R$ 0,40); cap por tier força upgrade sugerido após 2 ciclos consecutivos. **1 active member por (paciente, tenant)** — passaporte cross-tenant ([ADR 0077](docs/decisions/0077-passaporte-paciente-vinculo-cross-tenant.md)) **não duplica cobrança** (paciente em N tenants = 1 member por tenant cada).
- **Overage NFS-e** R$ 0,50 / 0,40 / 0,35 / 0,25 por **nota emitida** (NFS-e + NF-e + NFC-e + devolução + transferência + conserto), por tier respectivo. **Eventos não contam** (cancelamento, CC-e, inutilização). Repasse calibrado sobre custo Focus NFe + margem operacional.
- **Cota IA é hard-stop** — excedido = bloqueio até próximo ciclo + convite BYOK (não há overage IA pago). Default LogiFit: Gemini 2.5 Flash via Vertex AI ([ADR 0064](docs/decisions/0064-ia-arquitetura-gemini-default-byok-rag.md)); runbook emergencial em [`docs/runbooks/ia-byok-emergencial.md`](docs/runbooks/ia-byok-emergencial.md).
- **Trial 14 dias** sem cartão com features Pro; dados retidos 30 dias após expiração e então **anonimizados** (preserva agregados estatísticos, remove PII; ver ADR 0054 + Sprint 01a). Conversão antes do dia 30 reativa dados originais.
- **Multi-tenant por subdomínio** ([ADR 0065](docs/decisions/0065-multi-tenant-por-subdominio.md)): `{slug}.logifit.com.br`.
- **Cobrança**: Asaas próprio LogiFit + NFS-e automática via Focus NFe (Sprint 36).
- **DPO interno LogiFit** ([ADR 0067](docs/decisions/0067-dpo-governanca-compliance-lgpd.md) + [`docs/compliance/dpo.md`](docs/compliance/dpo.md)): canal `privacidade@logifit.com.br` + plano resposta incidente 72h + sub-processors públicos + auditoria interna trimestral. **DPO MVP é o fundador** (papel formal interino); **DPO-as-a-service** (firma externa revendida pela LogiFit) é **add-on opcional do Enterprise** — não confundir os dois.

## Marcos regulatórios que norteiam o produto

- **LGPD (Lei 13.709/2018) — art. 11** — dado de saúde é **sensível**; exige base legal explícita + RIPD versionado + consent granular + direitos do titular em 15 dias. Ver [ADR 0054](docs/decisions/0054-lgpd-art11-dados-saude-ripd-versionado.md) + regra 29.
- **CFM 2.454/2026** — IA em medicina: classificação SaMD por feature, supervisão humana documentada, **Comitê de IA interno obrigatório** por instituição-cliente; vigência **agosto/2026**. Ver [ADR 0053](docs/decisions/0053-conformidade-cfm-2454-2026-ia-saude.md) + regra 28.
- **Lei 13.787/2018** — **lei federal** de digitalização e uso do prontuário eletrônico em estabelecimentos de saúde; estabelece **20 anos de retenção mínima**. Norma **primária** (lei federal) sobre o tema; CFM 2.299 e COFFITO 415 são **resoluções de conselho** que reforçam.
- **CFM 2.299/2021** — prontuário eletrônico com assinatura ICP-Brasil **obrigatória para médicos** (CRM); reforça Lei 13.787/2018 retenção 20a.
- **COFFITO 414/2012 + 415/2012** — prontuário eletrônico de fisioterapeuta (CREFITO); ICP-Brasil **opcional** se houver sistema autenticado + trilha de auditoria + hash chain (regra 39). Ver Sprint 20.
- **CFN 599/2018** — registro eletrônico de nutricionista (CRN) com autenticação + trilha; ICP-Brasil **não obrigatório**.
- **Gate de assinatura por profissional** (Sprint 20): `if profissional.kind === 'medico' → require_icp_brasil_signature; else if kind in ['fisio','nutri','personal'] → require_authenticated_lock_with_audit_chain`. Política em tabela `signature_policies` (ADR 0032 — esperado, Sprint 20).
- **Leis dos conselhos profissionais** — **Lei 3.268/1957** (CFM/CRM, médicos), **Lei 6.316/1975** (COFFITO/CREFITO, fisioterapeutas), **Lei 6.583/1978** (CFN/CRN, nutricionistas), **Lei 9.696/1998** (CONFEF/CREF, educadores físicos/personal trainers). Cadastro de número de conselho + situação por profissional vive em `professional_registrations` (Sprint 01b, ADR 0055); gates de assinatura (Sprint 20), TISS (Sprint 22), contrato (Sprint 23) e onboarding PT (Sprint 08) consomem.
- **ANVISA RDC 657/2022 + RDC 751/2022** — Software as Medical Device (SaMD): classes I/II (baixo risco) → notificação; III/IV (alto risco) → registro pleno. LogiFit evita Classe III por design.
- **ANS TISS 4.01 (Ofício-Circular ANS nº 1/2026)** — padrão vigente para faturamento de convênios; LogiFit mantém pipeline de atualização semestral da terminologia TUSS + validador proativo XSD/regra de negócio + versionamento por guia. Ver [ADR 0079](docs/decisions/0079-tiss-401-ans-padrao-vigente.md) + Sprint 22.
- **NT 2012/002 SEFAZ / ENCAT** — Manifestação do Destinatário de NF-e: 4 eventos fiscais (Ciência, Confirmação, Desconhecimento, Não Realizada) obrigatórios para destinatário com CNPJ no prazo de 180 dias. Ciência automática ativa por padrão no LogiFit; demais eventos manuais. Ver [ADR 0057](docs/decisions/0057-manifestacao-destinatario-nfe.md) + Sprint 17.
- **Emissão fiscal unificada via Focus NFe** — LogiFit não toca em motor tributário. Todas as emissões (NFS-e, NF-e produto, NFC-e varejo, NF-e devolução, NF-e transferência, NF-e conserto, NF-e entrada própria, CC-e, cancelamento, inutilização) passam pelo provider Focus NFe. Ver [ADR 0059](docs/decisions/0059-ciclo-fiscal-emissao-focus-nfe.md) + Sprint 36. NT 2013/005 SEFAZ (NFC-e), NT 2011/004 SEFAZ (CC-e), RTC 1.400/2016 ABRASF (NFS-e) cobertas pelo provider. **Custo fiscal repassado ao tenant via overage** (ADR 0066 revisado 2026-04-25); rejeitado explicitamente o caminho de motor fiscal próprio (8-12 meses solo + manutenção eterna).
- **NFS-e Padrão Nacional como provider complementar futuro** ([ADR 0076](docs/decisions/0076-nfse-nacional-provider-complementar.md)) — não substitui Focus NFe; complementa para municípios aderidos (gratuito, infra federal). Não entra no MVP — gatilhos: Sprint 36 estável há 3 meses + 10k notas/mês LogiFit + 30% emissões em municípios aderidos. Reusa interface `FiscalProvider`.
- **Cobertura fiscal faseada (ADR 0061)** — Fase atual cobre Grupos A (emissão via Focus), B (retenções em AP) e G (retenções em comissão/RPA) + portal `contador_externo` read-only (LGPD). Fases futuras mapeadas no roadmap (Sprints 37-40): apuração mensal, guias oficiais DAS/DARF, obrigações acessórias SPED/ECD/ECF, folha CLT + eSocial. LogiFit vai assumir progressivamente; ambição de cobertura completa. Fontes: Lei 10.833/2003 (retenções), IN RFB 1.234/2012, Tabela IRRF RFB, Portaria INSS (teto anual), LC 116/2003 (ISS).

## Documentação de referência (leia antes de planejar)

- [`docs/arquitetura.md`](docs/arquitetura.md) — visão geral da arquitetura e stack
- [`docs/rules.md`](docs/rules.md) — **44 regras duras** (arquiteturais, multi-empresa, i18n, IA + LGPD, pesquisa global, responsividade, arquitetura IA + erros, escalabilidade banco, segurança em profundidade, assistente IA universal, passaporte cross-tenant, MFA obrigatório, design system "Equilíbrio Vital", processo, código). **Em conflito com regras operacionais abaixo, [`docs/rules.md`](docs/rules.md) prevalece como fonte única de verdade** — regras 1-29 abaixo são subset operacional para uso direto pela Claude.
- [`docs/modulos.md`](docs/modulos.md) — catálogo de módulos por área (fundação, geral, academia, fisio, nutri) + quais verticais usam
- [`docs/multiempresa.md`](docs/multiempresa.md) — hierarquia group → tenant → company → unit + flags de topology
- [`docs/acesso-e-autorizacao.md`](docs/acesso-e-autorizacao.md) — 4 camadas (identidade, tenant, RBAC, consent)
- [`docs/roadmap.md`](docs/roadmap.md) — linha do tempo + controle de evolução por sprint
- [`docs/sprints/`](docs/sprints/) — plano executável de cada sprint
- [`docs/decisions/`](docs/decisions/) — ADRs (por que decidimos assim)
- [`docs/comercial.md`](docs/comercial.md) — apresentação comercial (pitch para clientes/investidores; não é fonte técnica, só espelho em linguagem de venda)
- [`docs/compliance/`](docs/compliance/) — documentos formais de conformidade (DPO, RIPDs por módulo, classificação SaMD, inventário LGPD)
- [`docs/runbooks/`](docs/runbooks/) — procedimentos operacionais executáveis (restore de backup, BYOK emergencial, rollback PG, etc) — template em [`_template.md`](docs/runbooks/_template.md)
- [`docs/threat-models/`](docs/threat-models/) — análises STRIDE de features críticas (login, pagamento, prontuário, exames, WhatsApp inbound) — template em [`_template-stride.md`](docs/threat-models/_template-stride.md)

## Regras que você (Claude) DEVE respeitar

> **Numeração canônica:** os números abaixo (1-8, 11, 13-16, 27-44) **são os mesmos** de [`docs/rules.md`](docs/rules.md) — fonte única de verdade. Esta seção é um **digest** das regras mais relevantes ao trabalho diário; lista completa (44 regras + bloco "Convenções de colaboração com Claude" abaixo) está em `rules.md`.
>
> Quando outro doc cita "regra N", o número refere-se SEMPRE à numeração canônica abaixo / `rules.md`. Em conflito, `rules.md` prevalece.

### Arquiteturais base (rules.md 1-8)

**1.** **Nunca** crie tabela sem `tenant_id` + RLS.
**3.** Drizzle é a única fonte do schema — tipos do Supabase CLI desligados.
**5.** `audit_log` é append-only, particionado por mês; nunca sofre `UPDATE`/`DELETE`.
**7.** **Sempre** valide boundary com Zod (Server Action, API Route, webhook).

### Processo (rules.md 11, 13, 14, 15)

**11.** **Conventional Commits** obrigatórios (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`). Commits vão direto em `main` (dev solo); branches só para trabalho longo/arriscado.
**13.** ADR criado no **mesmo dia** da decisão; nunca retroativo. Se a decisão é arquitetural, propor criar ADR em `docs/decisions/` no mesmo turno.
**14.** `CHANGELOG.md` atualizado em todo commit que muda comportamento observável.
**15.** Nenhum `--no-verify`, `--force` em `main`, nem skip de CI.

### Código (rules.md 16)

**16.** TypeScript `strict: true`. `any` só com comentário `// why:` justificando.

### i18n + IA + LGPD (rules.md 27-29)

**27.** **Nunca** hardcode string de UI em componente. Sempre via `t('namespace.key')` do next-intl com catálogo nos 3 locales (pt-BR/en-US/es-419). CI `pnpm i18n:check` falha se faltar chave. Ver [ADR 0052](docs/decisions/0052-i18n-tres-idiomas-pt-en-es.md).
**28.** **Nunca** ativar feature IA classe SaMD II+ em tenant sem Comitê de IA cadastrado + ata anexada (gate de feature flag). Toda chamada IA clínica grava `ai_audit_log` (input, output, modelo, decisão humana). Classificador de output ("diagnóstico", "tem [doença]") ativo sempre. Ver [ADR 0053](docs/decisions/0053-conformidade-cfm-2454-2026-ia-saude.md).
**29.** **Nunca** criar módulo que processa dado de saúde sem registro em `ripd_documents` com versão vigente + consent por finalidade explícita. CI bloqueia. Ver [ADR 0054](docs/decisions/0054-lgpd-art11-dados-saude-ripd-versionado.md).

### Pesquisa global + responsividade (rules.md 30-31)

**30.** **Módulo novo com dado pesquisável** registra-se em `search_index` com `required_permission` explícita (trigger `search_index_sync()` + kind/label/url/searchable_text). Ver [ADR 0062](docs/decisions/0062-pesquisa-global-command-palette.md).
**31.** **Toda UI mobile-first** — usar `<AppLayout>`/`<ResponsiveTable>`/`<ResponsiveModal>`/`<ResponsiveForm>` de `packages/ui/layout/*`; testes Playwright em 3 viewports (390/768/1280); touch targets ≥44px. Proibido construir layout próprio duplicado. Ver [ADR 0063](docs/decisions/0063-responsividade-total-mobile-first.md).

### Arquitetura IA + erros (rules.md 32-33)

**32.** **Chamada de IA via `resolveModelForTask(task, featureKey?, tenantCtx)`** — nunca hardcode provider/modelo. Tasks canônicas: chat/embedding/classification/extraction/vision/transcription/reasoning. Tool calling sempre via Server Actions tipadas (proibido SQL arbitrário do LLM). System prompt via `buildSystemPrompt()` composto. Ver [ADR 0064](docs/decisions/0064-ia-arquitetura-gemini-default-byok-rag.md).
**33.** **Server Action / API Route / Job SEMPRE usa `wrapAction()` / `wrapApiHandler()` / `wrapJob()`** de `packages/errors/`. O wrapper valida context (auth + permissions + rate limit + gates IA/consent), traduz erros via translator do domínio, cria `system_alerts` async com fingerprint (dedup), grava `audit_log` quando aplicável, captura em Sentry `INTERNAL_ERROR`, e retorna envelope `{ ok, data | error }` tipado. Enforced em CI via lint `no-unwrapped-action`. Ver [ADR 0071](docs/decisions/0071-sistema-tratamento-erros-alertas-tempo-real.md).

### Escalabilidade banco (rules.md 34)

**34.** **Toda tabela com volume estimado >5M linhas/ano OU >50k linhas/dia nasce particionada.** Migration declara `@volume_estimate_yearly: <N>` em comentário SQL; CI lint bloqueia se excede sem partição. Estratégia padrão `PARTITION BY RANGE` em coluna temporal (mês/trimestre/ano) ou `HASH (tenant_id)`. Indexes vivem na partição. Retenção alinhada a compliance: 5a audit · 20a prontuário (Lei 13.787 + COFFITO 415) · 5a fiscal · 1a IA audit + 5a cold (CFM 2.454/2026). Cold storage Parquet zstd para >2-5 anos. Drop de partição = metadata-only. Sharding via `tenants.shard_url` preparado mas não ativado no MVP. Ver [ADR 0072](docs/decisions/0072-escalabilidade-banco-particionamento-retencao-cold-storage.md).

### Segurança em profundidade (rules.md 35-40)

**35.** **Security headers obrigatórios no `next.config.ts`** com CSP nonce dinâmico (sem `unsafe-inline` em script-src), HSTS preload, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin, Permissions-Policy restritiva, COOP/CORP. CI valida cada header. Ver [ADR 0073](docs/decisions/0073-postura-seguranca-defesa-em-profundidade.md).
**36.** **Toda Server Action / API Route / endpoint público tem rate limit Upstash Redis** dentro do `wrapAction()/wrapApiHandler()` (regra 33) com chave `(tenant_id, user_id, ip, endpoint)`. Limites canônicos em `packages/security/rate-limits.ts`. Excedido → `RATE_LIMITED` envelope. Login com 5 falhas/15min → lockout 30min + Turnstile.
**37.** **Toda chamada `fetch` para URL externa via `safeFetch()`** de `packages/security/safe-fetch.ts` com `allowedHosts` obrigatória, bloqueio de IP privado/loopback/link-local, timeout 30s, redirect manual. Lint custom `no-raw-fetch` bloqueia commit. LLM tool calling **nunca** chama URL arbitrária.
**38.** **Todo upload em Supabase Storage passa por `scanUpload()`** de `packages/security/scan-upload.ts` — MIME real (file-type), magic bytes, embed proibido (PDF JS / Office macro), ClamAV scan. Tabela `upload_scans` rastreia status. Arquivo só vira `published` após `clean`. Lint `no-unscanned-upload`.
**39.** **`audit_log` mantém hash chain** — trigger BEFORE INSERT computa `current_hash = sha256(... || previous_hash)` ligando linhas do mesmo tenant; job semanal verifica continuidade; quebra dispara `system_alerts critical`. Anchor S3 Object Lock WORM 1h.
**40.** **Backup off-site cifrado + teste de restauração trimestral + DR plan documentado.** RPO 24h / RTO 4h. Chaves de criptografia em backup separado do dado (defesa em profundidade). MVP: Cloudflare R2; Fase 2: AWS S3 us-east-1.

### Assistente IA universal (rules.md 41)

**41.** **Server Action exposta ao Assistente IA registra-se em `tools_registry` via `registerAITool({...})`** em arquivo `<modulo>/ai-tools.ts` declarando `key`, `layer` (`help`/`insight`/`action`), `whenAvailable`, `showInPersonas[]`, `argsSchema/resultSchema` Zod, `requiresConfirmation`, `handler`, `audit`, `rateLimitKey`. Server Action **não-exposta** tem `// ai-blocked: <motivo>` no topo (lint `ai-block-respected` em CI). Tools Camada 3 (write) sempre passam por `<ActionConfirmDialog>`: LLM nunca chama Server Action diretamente — sempre via `proposeAction(toolKey, args)` que cria registro em `assistant_action_proposals` aguardando confirmação UI; handler real exige `proposal_id` confirmado válido (proteção dupla — `actionSource='ai_assistant'` sem proposta = `FORBIDDEN`). Bloqueado MVP: DELETE, `signEvolution`, `chargeBatch`, `anonymizeMember`, `transferMemberBetweenCompanies`, `runOpenFinancePayment`, mudanças em config. Ver [ADR 0075](docs/decisions/0075-assistente-ia-universal-tres-camadas-tool-registry.md).

### Passaporte cross-tenant (rules.md 42)

**42.** **Dado de paciente cruza `tenant_id` SOMENTE via vínculo cross-tenant ativo.** Modelo C híbrido: vínculo paciente↔empresa (`patient_company_links`) com **módulos liberados explícitos** (`patient_link_modules`) e **responsável técnico por módulo** (atende CFM/COFFITO/CFN/CONFEF). 5 módulos canônicos no MVP via lookup table extensível: `academia`, `personal_training`, `fisioterapia`, `nutricao`, `pilates`. **Constraint global:** 1 módulo ativo por paciente em toda a rede — nova empresa do mesmo módulo dispara substituição com confirmação do paciente. **2 paths de criação de conta:** reativo (profissional manda invite, paciente cria conta junto com aceite) e proativo (paciente vai em `app.logifit.com.br/cadastro`, cria conta sozinho com SMS+email+Turnstile, recebe invites ou convida profissional/empresa). Aceite parcial suportado. **5 níveis de dados** (Identidade → Antropometria → Treino → Clínico → Workspace) — Nível 5 nunca cruza tenant nem é exibido ao paciente. **Limites duros:** financeiro nunca cruza, prontuário CFM original nunca cruza (só resumo gerado pelo paciente), dado de outras pessoas mencionado nunca cruza. **Cross-tenant entrega resumido**, não bruto. Toda leitura cross-tenant grava `patient_data_access_log` (síncrono não-bloqueante, particionado mensal — regra 34). Lint `cross-tenant-read-must-log` enforça. Cobrança LogiFit: 1 active member por (paciente, tenant), independente de quantos módulos. Ver [ADR 0077](docs/decisions/0077-passaporte-paciente-vinculo-cross-tenant.md).

### MFA obrigatório (rules.md 43)

**43.** **MFA obrigatório para profissionais de saúde + roles administrativas críticas.** Roles `medico`, `fisio`, `nutri`, `personal`, `enfermeiro`, `tenant_owner`, `dpo`, `super_admin` têm `roles.requires_mfa=true` enforced — login sem TOTP/WebAuthn bloqueado em todos fluxos (magic link inclusive). Roles operacionais (`recepcao`, `member`) MFA opcional **mas** ações de alto-risco (cancelar guia TISS, anular invoice, alterar role de outro user, re-emissão fiscal) sempre exigem **MFA recente <15min** independente do `requires_mfa` — gate `requireRecentMfa()` no wrapper. Tenant pode escalar via `tenant_settings.mfa_extra_roles[]`. Setup wizard obrigatório no primeiro login profissional. Recovery codes one-time. CI tem E2E. Ver [ADR 0073](docs/decisions/0073-postura-seguranca-defesa-em-profundidade.md) camada 2.

### Design system "Equilíbrio Vital" (rules.md 44)

**44.** **Antes de criar/modificar tela ou componente UI, ler o design system "Equilíbrio Vital".** Hoje (pré-Sprint 00): [`prototipo/tokens.css`](prototipo/tokens.css) (tokens `--ev-*`) + [`prototipo/base.css`](prototipo/base.css) (primitivos `.ev-btn`/`.ev-card`/`.ev-badge`/`.ev-input`/`.ev-table`/`.ev-dot`), visualizados em [`prototipo/designsystem/index.html`](prototipo/designsystem/index.html). Pós-Sprint 00: `packages/ui/tokens.css` + `packages/ui/shadcn-mapping.css` + styleguide em `apps/web/app/styleguide/`. **Proibido:** hardcode de hex/font/spacing/radius/font-size — sempre via `var(--ev-*)` ou alias shadcn (`var(--primary)`/`var(--background)`/`var(--radius)`); construir botão/card/input do zero quando primitivo existe; `box-shadow` decorativa (flat extremo — focus ring é exceção funcional via `--ev-focus-ring`). **Obrigatório:** nova variante visual entra primeiro no styleguide (`designsystem/index.html`) e depois nas telas; mudança de token muda SOMENTE em `tokens.css` (aliases shadcn herdam). Lint `no-hardcoded-design-token` (pós-Sprint 00) bloqueia commit. Ver [arquitetura.md §1](docs/arquitetura.md).

### Convenções de colaboração com Claude (sem número canônico)

Estas são convenções específicas do agente Claude trabalhando neste repo — não estão em `rules.md` porque não geram CI vermelho, mas violar quebra a confiança do usuário:

- **Nunca** `git commit` sem o usuário pedir explicitamente.
- **Sempre** verifique se há sprint ativo antes de sugerir trabalho fora de escopo (consultar [`docs/sprints/`](docs/sprints/) e [`docs/roadmap.md`](docs/roadmap.md)).
- **Antes** de sugerir nova feature, confirmar com o usuário se cabe no sprint corrente ou vai para backlog.
- **Nunca** escrever path absoluto (drive letter, `D:\...`, `/Users/...`, `~/...`) em doc versionada — repo é clonado em máquinas diferentes; usar sempre caminhos relativos a partir da raiz do repo.

Lista completa de regras em [`docs/rules.md`](docs/rules.md) (44 regras duras; índice por bloco no topo do arquivo).

## Stack (fixa — mudanças exigem ADR)

- **Frontend:** Next.js 15 (App Router), React 19, Tailwind CSS v4, shadcn/ui, Zustand, TanStack Query, React Hook Form, Zod, **next-intl (i18n — pt-BR default + en-US + es-419)**
- **Backend:** Next.js server-side (Server Components + Server Actions + API Routes) — sem serviço separado
- **Banco/Auth/Realtime/Storage:** Supabase **(MVP)** → migra pra **Postgres no Oracle Cloud OCI free tier + BetterAuth/Lucia + Cloudflare R2 + LISTEN/NOTIFY** no Sprint 19b. Ver [ADR 0078](docs/decisions/0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md).
- **ORM:** Drizzle (fonte única de schema)
- **IA:** Vercel AI SDK com **Gemini 2.5 Flash (Vertex AI SP) como default LogiFit** + **Groq Whisper para STT** + BYOK opcional (Claude/GPT/Maritaca/Anthropic) + fallback cascade; tasks tipadas (chat/embedding/classification/extraction/vision/transcription/reasoning); `resolveModelForTask()` nunca hardcode; cache semântico pgvector + quota mensal + rate limit Upstash Redis. Ver [ADR 0064](docs/decisions/0064-ia-arquitetura-gemini-default-byok-rag.md).
- **Rate limit:** **Upstash Redis** (sliding window por `(tenant_id, user_id, ip, endpoint)`) — regras 36 + 33; sub-processor declarado em [ADR 0067](docs/decisions/0067-dpo-governanca-compliance-lgpd.md)
- **Pagamentos:** Asaas
- **Email:** Resend
- **Observabilidade:** Sentry + PostHog + Logtail/Axiom
- **Qualidade:** Vitest + Playwright + GitHub Actions + Biome
- **Infra:** **Fase 1 (MVP):** Vercel + Supabase Pro · **Fase 2 (pós-Sprint 19b):** Vercel + Oracle Cloud OCI (PG self-hosted) + Cloudflare R2. Estratégia em 2 fases — [ADR 0078](docs/decisions/0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md)
- **Backup off-site MVP:** **Cloudflare R2 free tier 10GB** (`pg_dump` weekly cifrado GPG via Vercel Cron + retenção 12 meses; chaves de criptografia em backup separado). **Fase 2:** AWS S3 us-east-1 com Object Lock WORM (R$ 100-300/mês). Ver [ADR 0073](docs/decisions/0073-postura-seguranca-defesa-em-profundidade.md) (regra 40 — backup off-site).

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
pnpm db:seed          # Seed dos 5 cenários canônicos
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

**Flags do tenant:** `topology` (`owned`/`franchise`), `financial_mode` (`centralized`/`distributed`), `cross_company_access` (bool), `mode` (`multi`/`solo` — ADR 0069).

**5 cenários canônicos obrigatórios no seed:** rede própria, franquia clássica, franquia com passaporte, mix loja avulsa + rede no mesmo group, modo solo (autônomo).

### Glossário canônico

Termos com significado fixo no projeto — usar consistentemente em código, schemas, ADRs, sprints e UI.

- **`person`** — schema central ([ADR 0047](docs/decisions/0047-cadastro-central-persons.md)) PF/PJ; toda entidade especializada (member, supplier, user, profissional) tem FK `person_id`. Sem duplicação de identidade.
- **`member`** — termo **canônico do schema** para quem consome serviço/contrato no tenant (academia/clínica). Pertence a **1 tenant**. UI rotula como **"aluno"** (academia) ou **"paciente"** (fisio/nutri) — são apelidos de UI, não tipos distintos no schema (regra 24).
- **`group`** — camada agregada organizacional (sem CNPJ, sem RLS); só dashboard consolidado via views. Nunca filtro de query operacional.
- **`tenant`** — contrato SaaS, **RLS raiz**. Pode ter `mode='multi'` (rede/franquia/loja) ou `mode='solo'` (autônomo).
- **`company`** — pessoa jurídica (CNPJ); 1 matriz obrigatória + 0..N filiais. Emite NF-e.
- **`unit`** — local físico (endereço), filho de company.
- **Cross-company (mesmo tenant):** Filial A ↔ Filial B sob o mesmo contrato SaaS. Governado por `tenant.cross_company_access` + `franchise_agreements` (quando `topology='franchise'`) + regra 25 (clínico nunca cruza company em franquia).
- **Cross-tenant (contratos distintos):** Academia X ↔ Clínica Y como tenants diferentes do LogiFit. Governado por `patient_company_links` + `patient_link_modules` (passaporte do paciente, ADR 0077) + regra 42 + `patient_data_access_log`. Nunca cruza dado financeiro nem prontuário CFM bruto.
- **Passaporte** — termo sobrecarregado; sempre qualificar: **passaporte de franquia** (`franchise_agreements`, intra-tenant) vs **passaporte cross-tenant do paciente** (`patient_company_links`, inter-tenant).

Cross-company e cross-tenant **não são sinônimos**. Documentação que usa um pelo outro está errada.

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
