# Regras do Projeto LogiFit

**44 regras duras e inquebráveis.** Organizadas em 4 blocos + regras transversais. Violação = CI vermelho, revert, ou sprint não fecha.

> **Como usar:** toda discussão técnica começa perguntando "isso fere alguma regra?". Se sim, ou mudamos a regra (ADR) ou mudamos a solução. Regras não são sugestões.

**Índice:**
- **Arquiteturais base (1–8)**
- **Processo (9–15)**
- **Código (16–20)**
- **Multi-empresa (21–26)**
- **i18n (27)**
- **IA + LGPD (28–29)**
- **Pesquisa global + responsividade (30–31)**
- **Arquitetura IA + erros (32–33)**
- **Escalabilidade banco (34)**
- **Segurança em profundidade (35–40)**
- **Assistente IA universal (41)**
- **Passaporte cross-tenant (42)**
- **MFA obrigatório (43)**
- **Design system "Equilíbrio Vital" (44)**

---

## Arquiteturais base (quebrou = revert + ADR justificando)

**1.** Toda tabela de negócio tem `tenant_id uuid not null` + RLS policy usando `(auth.jwt() ->> 'tenant_id')::uuid`.
**2.** CI tem teste que *falha* se encontrar tabela nova sem RLS habilitada.
**3.** Drizzle é a única fonte do schema — tipos do Supabase CLI desligados.
**4.** Dados sensíveis (prontuário, mídia clínica, avaliação) criptografados at-rest.
**5.** `audit_log` é append-only, particionado por mês; nunca sofre `UPDATE`/`DELETE`.
**6.** Cross-module exige consentimento explícito em `consents` — testado no CI.
**7.** Todo boundary (Server Action, API Route, webhook) valida entrada com **Zod**.
**8.** Webhooks externos são idempotentes via coluna `external_id` unique em `webhook_events`.

---

## Multi-empresa

**21.** `companies` tem `type ∈ {matriz, filial}`; exatamente **1 matriz por tenant** (enforced por trigger/constraint).
**22.** `companies.cnpj` é unique **global** (no sistema inteiro), não por tenant — evita cadastro duplicado entre redes.
**23.** Dado fiscal (NF-e, recibo, contrato) **nunca** perde `company_id` — é o CNPJ emissor.
**24.** Transferência de member entre filiais = `UPDATE members SET company_id = X` + registro em `audit_log`; nunca deletar/recriar. (UI pode rotular como "aluno" na vertical academia, "paciente" em fisio/nutri — termo canônico do schema é `member`.)
**25.** Dados clínicos sensíveis (prontuário, mídia, avaliação) **nunca cruzam `company_id` quando `tenant.topology = 'franchise'`**. Nem com consent. Enforced por RLS + audit.
**26.** `groups` é camada apenas visual/agregada. Queries cross-tenant do mesmo group retornam **somente dados agregados** via views dedicadas. Nenhum `SELECT` direto em tabela operacional pode usar `group_id` como filtro cross-tenant. Teste de CI bloqueia.

---

## i18n

**27.** **Proibido hardcode de string de UI.** Toda string visível ao usuário (botão, título, mensagem, placeholder, tooltip) vai via `t('namespace.key')` do next-intl. Message catalog obrigatório nos 3 locales (`pt-BR`, `en-US`, `es-419`). CI roda `pnpm i18n:check` e falha se faltar chave em qualquer locale. Exceção: nomes de entidades de domínio (ex: "Pollock 7 dobras"), códigos técnicos (CID, TUSS), nomes de features flags, strings de debug/log não-visíveis. Ver [ADR 0052](decisions/0052-i18n-tres-idiomas-pt-en-es.md).

---

## IA + LGPD

**28.** **Feature IA classe SaMD II+ não ativa sem Comitê de IA cadastrado no tenant.** Feature flag é bloqueada por gate que consulta `ai_committee_members` — sem ao menos 1 membro ativo + ata de criação anexada, a feature não liga em produção, mesmo com flag ON. Toda chamada a feature IA clínica grava em `ai_audit_log` (input, output, modelo, versão do prompt, decisão humana: aceitou/editou/rejeitou). Classificador de output proibido ("diagnóstico", "tem [doença]", "prescrever") ativo em toda chamada. Violação = feature desligada automaticamente + alerta ao admin do tenant. Ver [ADR 0053](decisions/0053-conformidade-cfm-2454-2026-ia-saude.md) (CFM 2.454/2026 + classificação SaMD RDC 657/2022).

**29.** **Dado de saúde sensível (LGPD art. 11) só trafega com base legal explícita + RIPD vigente.** Todo módulo que processa `health_data` (prontuário, avaliação, exame, mídia clínica, device reading, plano alimentar, prescrição) tem entrada em `ripd_documents` com versão vigente (`ripd_versions`) assinada pelo DPO, revisada no máximo a cada 6 meses. Consent por finalidade (`consent_purposes.lawful_basis`) não pode ser genérico — cada finalidade lista `data_categories[]` e `retention_period` explícitos. CI tem teste que falha se um módulo clínico novo for criado sem registro em `ripd_documents`. Direitos do titular (art. 18) atendidos em até **15 dias úteis** (Resolução ANPD nº 2/2024) via portal `/meu/privacidade`. Ver [ADR 0054](decisions/0054-lgpd-art11-dados-saude-ripd-versionado.md).

---

## Pesquisa global + responsividade

**30.** **Módulo novo com dado pesquisável deve registrar-se em `search_index`** via trigger `search_index_sync()` declarando explicitamente: `kind` (identificador do tipo), `label`/`subtitle`/`url` (o que mostrar), `searchable_text` (campos buscáveis), **`required_permission`** (permission mínima para aparecer no resultado), `required_vertical` (quando aplicável), `required_consent_purpose` (quando cross-module), `is_sensitive` (true → clique grava audit). Omissão de `required_permission` é proibido — operador sem permission nunca pode ver o resultado, nem "provocar" clique para descobrir existência. Ver [ADR 0062](decisions/0062-pesquisa-global-command-palette.md).

**31.** **Toda UI de `/app/*` e `/meu/*` é responsiva mobile-first** nos 3 viewports canônicos (mobile 390px, tablet 768px, desktop 1280px). Componente **deve** usar os componentes base de `packages/ui/layout/*` (`<ResponsiveTable>`, `<ResponsiveModal>`, `<ResponsiveForm>`, `<AppLayout>`, `<BottomNav>`); proibido construir layout próprio duplicado. Touch targets ≥44px (botões) e ≥48px (inputs). Teste Playwright visual em 3 viewports obrigatório em sprints com UI nova — falha CI. Exceção (ex: tela admin técnica desktop-only) exige ADR de sprint justificando. Ver [ADR 0063](decisions/0063-responsividade-total-mobile-first.md).

---

## Design system "Equilíbrio Vital"

**44.** **Antes de criar/modificar qualquer tela ou componente UI, ler o design system "Equilíbrio Vital".** Fonte de verdade dual conforme fase:

- **Hoje (pré-Sprint 00):** [`prototipo/tokens.css`](../prototipo/tokens.css) (todos os tokens `--ev-*` light + dark) + [`prototipo/base.css`](../prototipo/base.css) (primitivos `.ev-btn`, `.ev-card`, `.ev-badge`, `.ev-input`, `.ev-table`, `.ev-dot`, `.ev-divider`, utilities `.ev-stack`/`.ev-row`/`.ev-grid`). Visualização ao vivo em [`prototipo/designsystem/index.html`](../prototipo/designsystem/index.html) (14 seções: Foundation + Componentes + Migração shadcn).
- **Após Sprint 00:** `packages/ui/tokens.css` + `packages/ui/shadcn-mapping.css` (aliases shadcn → vars EV — preview pronto em [`prototipo/designsystem/shadcn-mapping.css`](../prototipo/designsystem/shadcn-mapping.css)) + componentes shadcn customizados em `packages/ui/components/*` que consomem os tokens. Styleguide portado pra `apps/web/app/styleguide/`.

**Proibido:**

- Hardcode de hex (`#3498DB`), font-family (`'Inter'`), spacing literal (`padding: 16px`), radius (`border-radius: 8px`), font-size (`font-size: 14px`), line-height, weight, z-index. Sempre via `var(--ev-*)` ou alias shadcn (`var(--primary)`, `var(--background)`, `var(--radius)`).
- Construir botão/card/input/badge/tabela/dot do zero quando primitivo equivalente existe — usar `.ev-btn` (HTML protótipo) ou `<Button>` shadcn (React, pós-Sprint 00) que já consomem tokens.
- Adicionar `box-shadow` decorativa — design system é **flat extremo** (filosofia central documentada em [arquitetura.md](arquitetura.md) §1). Única exceção: focus ring funcional via `var(--ev-focus-ring)` (já previsto nos tokens).
- Importar fonte sem registrar em tokens.css. Ibrand é **fonte de marca**, restrita a logo/headings de identidade — nunca corpo.

**Obrigatório:**

- **Nova variante visual** (ex: novo tipo de badge, novo size de botão) entra **primeiro** no styleguide (atualizar `prototipo/designsystem/index.html` ou `apps/web/app/styleguide/` no pós-Sprint 00) com a variante documentada e renderizada — depois consumir nas telas. Sem doc no styleguide = lint reprova.
- **Mudança em token** (ex: ajustar contraste de `--ev-primary` por A11y) muda SOMENTE em `tokens.css`; aliases shadcn herdam automaticamente. Migrar todas as referências hardcoded encontradas no caminho.
- Mudança em token ou primitivo dispara revisão visual via `pnpm test:e2e --grep="@design-system"` (suite Playwright pós-Sprint 00 que compara snapshot do styleguide light + dark).

**Lint pós-Sprint 00:** `no-hardcoded-design-token` bloqueia commit que introduz hex/spacing/radius/font-size literal em `apps/web/**/*.{ts,tsx,css}` (exceto o próprio `tokens.css`). Complementa regra 31 (responsividade) e regra 27 (i18n) — ambas governam a superfície UI.

Ver [arquitetura.md §1](arquitetura.md), [ADR 0063](decisions/0063-responsividade-total-mobile-first.md), e CHANGELOG `[Unreleased] Prototipo — Design system styleguide "Equilíbrio Vital"`.

---

## Arquitetura IA + tratamento de erros

**32.** **Chamada de IA nunca hardcode provider/modelo.** Toda invocação passa por `resolveModelForTask(task, featureKey?, tenantCtx)` que consulta `ai_task_routing`. Tasks canônicas: `chat`, `embedding`, `classification`, `extraction`, `vision`, `transcription`, `reasoning`. Feature clínica tem **tier mínimo imposto** por LogiFit (ex: Pipeline Exames interpretação não roda em modelo abaixo de Gemini 2.5 Flash via Vertex AI SP; CI bloqueia seed de `ai_task_routing` com modelo abaixo do mínimo). Tool calling sempre via Server Actions tipadas — **proibido LLM emitir SQL arbitrário**. System prompt composto por `buildSystemPrompt({ agent, tenant, user, permissions, ragChunks, globalRules })`, nunca string ad-hoc. Ver [ADR 0064](decisions/0064-ia-arquitetura-gemini-default-byok-rag.md).

**33.** **Toda Server Action, API Route e job assíncrono usa `wrapAction()` / `wrapApiHandler()` / `wrapJob()` de `packages/errors/`.** O wrapper: (a) gera/propaga `request_id` (UUID no header `x-request-id`); (b) valida context (auth, permissions, rate limit Upstash, gate IA classe II+ — regra 28, consent cross-module — regra 6); (c) captura erro e traduz via translator do domínio (Asaas/Focus NFe/Gemini/TISS/...); (d) cria `system_alerts` async com fingerprint SHA256(type|module|path|status|tenant_id)[:16] — deduplicação automática; (e) grava `audit_log` quando `auditAction` informado; (f) `Sentry.captureException()` em `INTERNAL_ERROR`; (g) retorna envelope `{ ok: true, data } | { ok: false, error: ApiError }` tipado com 16 códigos fechados. CI tem lint custom `no-unwrapped-action` que bloqueia commit quando Server Action/API Route não usa wrapper. Exceção em jobs de migration/seed exige comentário `// wrap-exempt: <motivo>`. Ver [ADR 0071](decisions/0071-sistema-tratamento-erros-alertas-tempo-real.md).

---

## Escalabilidade banco

**34.** **Toda tabela com volume estimado >5M linhas/ano OU >50k linhas/dia deve nascer particionada.** Estratégia padrão:
- **`PARTITION BY RANGE` em coluna temporal** (`at`, `created_at`, `recorded_at`) por mês/trimestre/ano conforme volume — tabelas pesadas preferem mês; tabelas medianas, trimestre; fiscais, ano
- **`PARTITION BY HASH (tenant_id)`** quando volume é tenant-driven independente de tempo
- Migration que cria tabela **deve declarar** `@volume_estimate_yearly: <N>` em comentário SQL; CI lint bloqueia se >5M sem partição
- **Toda tabela com retenção definida** tem job de partition lifecycle cadastrado: `create-next-partitions` (cria futuras), `drop-old-partitions` (descarta após retenção legal), `archive-cold-partitions` (move para Storage). Conformidade: **5 anos audit (LGPD + ADR 0072)**, **20 anos prontuário (Lei 13.787/2018 + CFM 2.299)**, 5 anos fiscal, 5 anos COFFITO 415, 1 ano IA audit (CFM 2.454), **5 anos `patient_data_access_log` (ADR 0077)**, 30/90/365/1825 dias por severity em `system_alerts` (ADR 0071)
- **Indexes vivem na partição**, não na parent table
- **Drop de partição é metadata-only** (milissegundos) vs DELETE row-by-row (horas)
- **Cold storage**: dados >2-5 anos exportados para Supabase Storage como Parquet zstd compactado; retenção legal preservada com custo ~80% menor que disco quente
- **Sharding multi-cluster** preparado via `tenants.shard_url` (NULL = compartilhado; preenchido = dedicated cluster); evolução futura quando 1 tenant >100k members ou banco >500GB. Ver [ADR 0072](decisions/0072-escalabilidade-banco-particionamento-retencao-cold-storage.md).

---

## Segurança em profundidade

**35.** **Security headers obrigatórios em todo response HTTP do app.** `next.config.ts` define em `headers()`: `Content-Security-Policy` (com nonce dinâmico via middleware), `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restritiva, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-site`. CSP **proíbe `unsafe-inline` em script-src** (tailwind exige em style-src — aceito); JS dinâmico usa nonce. Domínio submetido ao [HSTS Preload List](https://hstspreload.org). CI tem teste E2E que faz request e valida cada header presente; falha = vermelho. Ver [ADR 0073](decisions/0073-postura-seguranca-defesa-em-profundidade.md) camada 1.

**36.** **Toda Server Action / API Route / endpoint público tem rate limit Upstash Redis com sliding window.** Aplicado dentro de `wrapAction()` / `wrapApiHandler()` (regra 33) — chave composta `(tenant_id, user_id, ip, endpoint)`. Limites canônicos: `/login` 10/15min por IP + 5/15min por email · Server Actions read 100/min/user · Server Actions write 30/min/user · IA 20/min/user · search 30/min/user · webhooks externos 60/min/IP · `/signup` 3/h/IP. Excedido → `RATE_LIMITED` (envelope ADR 0071) com `retry_after_ms`. **Lockout** após 5 falhas em 15min de login dispara captcha (Turnstile) e bloqueio 30min. CI tem teste que verifica que cada nova rota está coberta pela tabela de limites. Ver [ADR 0073](decisions/0073-postura-seguranca-defesa-em-profundidade.md) camada 3.

**37.** **Toda chamada `fetch` para URL externa passa por `safeFetch()` de `packages/security/safe-fetch.ts`.** O wrapper: (a) só aceita `http://` ou `https://`; (b) resolve DNS e bloqueia se IP é privado/loopback/link-local (mitiga SSRF para metadata cloud `169.254.169.254`, banco `10.x`, etc); (c) exige `allowedHosts: string[]` declarada pelo caller (allowlist por integração — Asaas, Focus NFe, Gemini, WhatsApp media, Pluggy, Garmin, Oura — fora dali, lança); (d) timeout 30s default; (e) `maxResponseBytes` 50MB default; (f) `redirect: 'manual'` (atacante 302 → IP privado). **Proibido** `fetch()` direto em código que toca URL externa — lint custom `no-raw-fetch` bloqueia commit. Tool calling de LLM **nunca** chama URL arbitrária — só Server Actions tipadas (regra 32). Ver [ADR 0073](decisions/0073-postura-seguranca-defesa-em-profundidade.md) camada 3.

**38.** **Todo upload em Supabase Storage passa por `scanUpload()` antes de aceitar.** `packages/security/scan-upload.ts` (provider abstrato) valida: (a) MIME real server-side via `file-type` (não confia em extensão nem `Content-Type` cliente); (b) magic bytes correspondem ao MIME declarado; (c) tamanho ≤ limite por bucket; (d) extension allowlist por bucket; (e) embed proibido (PDF com `/JavaScript`/`/JS`/`/OpenAction`/`/Launch`/`/EmbeddedFile`, Office com `vbaProject.bin`/`macros/` em zipped, polyglot detectado por magic bytes mismatch); (f) hash SHA256 lookup em `known_malicious_hashes` (opcional). **MVP usa scan próprio** (sem ClamAV — todos os checks acima são suficientes para ~90% dos casos comuns); **Fase 2** plugar adapter ClamAV self-hosted ou api.cloudmersive.com sem refactor de quem usa. Resultado em `upload_scans (id, tenant_id, storage_path, status enum 'pending'|'clean'|'suspicious'|'rejected'|'error', detection_reason text nullable, scanned_at)`; arquivo só vira `published` após `status='clean'`. Falha = arquivo deletado + `system_alerts severity=error`. Buckets cobertos: `lab-documents`, `fisio-evolucoes`, `exam-attachments`, `exercises` (vídeo), `certificados` (cert A1), `whatsapp-media`. Lint custom `no-unscanned-upload` em rotas de upload. Ver [ADR 0073](decisions/0073-postura-seguranca-defesa-em-profundidade.md) camada 3.

**39.** **`audit_log` mantém hash chain — cada linha referencia hash da anterior.** Trigger SQL ao INSERT computa `current_hash = sha256(id || tenant_id || at || actor_user_id || action || sanitized_payload || previous_hash)` onde `previous_hash` é o `current_hash` da última linha do mesmo `tenant_id`. Job semanal `verify-audit-integrity` percorre cadeia e dispara `system_alerts severity=critical category=security` se quebra detectada. Anchor periódico em `system_audit_anchor` (timestamp confiável + assinatura LogiFit) a cada 1h cola `previous_hash` em referência externa imutável (S3 Object Lock WORM) — dificulta admin DB adulterar histórico sem deixar rastro detectável. Append-only (regra 5) continua valendo; hash chain é **camada extra de tamper detection**. Ver [ADR 0073](decisions/0073-postura-seguranca-defesa-em-profundidade.md) camada 4.

**40.** **Backup automático + teste de restauração trimestral + DR plan documentado com RPO 24h e RTO 4h.** **MVP zero-custo:** Supabase backup nativo (incluído no plano Supabase) **mais** off-site `pg_dump` semanal cifrado com GPG para **Cloudflare R2** (free tier 10GB) ou **Backblaze B2** (10GB free) ou **GitHub Releases privado** (até 2GB/file, ilimitado total) — escolher um. Vercel Cron weekly. Retenção 12 meses (rotação automática). **Fase 2** (volume > 5GB ou tenant Enterprise): AWS S3 us-east-1 com Object Lock 90d WORM substitui (R$ 100-300/mês). Storage de mídia (`lab-documents`, `fisio-evolucoes`, `exam-attachments`) confia em Supabase replicação multi-region no MVP; off-site só Fase 2. Teste de restauração trimestral em Supabase free instance temporária — runbook em `runbooks/restore-test.md`; falha = `system_alerts critical` + ADR retroativo. Disaster Recovery Plan público para tenants Enterprise. **Chaves de criptografia (master + KEK por tenant + cert A1) nunca no mesmo backup do dado — separação obrigatória.** Ver [ADR 0073](decisions/0073-postura-seguranca-defesa-em-profundidade.md) camada 4.

---

## Assistente IA universal

**41.** **Toda Server Action de módulo que deve ser usável pelo Assistente IA registra-se em `tools_registry` via `registerAITool({...})`** em arquivo `apps/web/app/(modules)/<modulo>/ai-tools.ts`. A definição declara: `key` único (`<modulo>.<acao>`), `layer` (`help`/`insight`/`action`), `label/description` em pt-BR/en-US/es-419, `whenAvailable({user, tenant})`, `showInPersonas[]`, `argsSchema/resultSchema` Zod, `requiresConfirmation` (true para `action`), `confirmationCopy({args, ctx})`, `handler` (Server Action `wrapAction()` regra 33), `audit` e `rateLimitKey`. **Server Action que NÃO deve ser exposta** ao LLM tem comentário literal `// ai-blocked: <motivo>` no topo do handler — lint custom `ai-block-respected` em CI bloqueia commit se `registerAITool` aponta para handler com esse comentário. **Tools Camada 3 (write) sempre passam por `<ActionConfirmDialog>`**: LLM nunca chama Server Action diretamente — sempre via `proposeAction(toolKey, args)` que cria registro em `assistant_action_proposals` (state=`pending`, expira 5min); handler real exige `proposal_id` confirmado válido (proteção dupla — `actionSource='ai_assistant'` sem proposta = `FORBIDDEN`). Bloqueado no MVP: qualquer `DELETE`, `signEvolution` (ICP-Brasil), `chargeBatch`, `anonymizeMember`, `transferMemberBetweenCompanies`, `runOpenFinancePayment`, mudanças em `tenant_settings`/RBAC/plano. Ver [ADR 0075](decisions/0075-assistente-ia-universal-tres-camadas-tool-registry.md).

---

## Passaporte cross-tenant

**42.** **Dado individual de paciente cruza `tenant_id` SOMENTE via vínculo `patient_company_links` ativo + módulo `patient_link_modules` autorizado + categoria coberta pelo `data_level_max` do paciente.** Toda Server Action / API Route / job que lê dado clínico, antropométrico, prescritivo ou de plano de outro tenant **deve** (a) verificar via função SQL `has_cross_tenant_access(reader_user_id, person_id, module_type, category)` que combina os 3 fatores acima; (b) gravar `patient_data_access_log` no mesmo turno (síncrono não-bloqueante via trigger ou chamada explícita no wrapper) com `reader_user_id`, `reader_tenant_id`, `source_tenant_id`, `module_type`, `category`, `resource_type`, `resource_id`, `request_id`; (c) entregar dado **resumido**, não bruto — ex: "lesão lombar ativa, restrição: sem deadlift", não SOAP completo. **Limites duros que nunca cruzam tenant mesmo com vínculo:** dado financeiro (cobranças, valores, inadimplência), Nível 5 (notas privadas do profissional, hipóteses diagnósticas, anotações comportamentais), prontuário CFM original (CFM 2.299 — só resumo gerado pelo paciente pode), dado de outras pessoas mencionado no prontuário. **Substituição:** novo vínculo do mesmo módulo desativa o anterior automaticamente (`patient_link_modules.revoked_at`) — paciente confirma na UX. Lint custom `cross-tenant-read-must-log` em CI bloqueia commit se Server Action lê tabela cross-tenant sem chamar `has_cross_tenant_access` + log. Ver [ADR 0077](decisions/0077-passaporte-paciente-vinculo-cross-tenant.md).

---

## MFA obrigatório

**43.** **Profissionais de saúde têm MFA obrigatório + ações de alto-risco exigem MFA recente <15min indistintamente do role.**

**MFA por role (sempre exigido no login):**
- Roles `medico`, `fisio`, `nutri`, `personal`, `enfermeiro` (e qualquer role que herde de `professional_clinical`) têm `roles.requires_mfa=true` enforced no Supabase Auth — login sem TOTP/WebAuthn é bloqueado em todos os fluxos (magic link inclusive)
- Roles administrativas (`tenant_owner`, `dpo`, `super_admin`) também têm MFA obrigatório por dever de cuidado
- Roles operacionais (`recepcao`, `member`) têm MFA **opcional** mas com badge incentivando ativação
- Tenant pode escalar exigência (ex: forçar MFA também na recepção) em `tenant_settings.mfa_extra_roles[]`
- Setup obrigatório no primeiro login do profissional (wizard `/setup-mfa`) — pula = bloqueia acesso a `/app/clinico/*`
- Recovery codes one-time gerados na ativação

**MFA recente para alto-risco (gate `requireRecentMfa(maxAgeMin=15)` no wrapper):**

Independente do `requires_mfa` do role, ações listadas exigem **MFA recente em até 15 minutos**. Wrapper valida claim JWT `mfa_at`; expirado → forçar reauth com TOTP/WebAuthn antes de prosseguir. Audit grava `mfa_required=true` + `mfa_at_action`.

Ações cobertas (lista canônica em `packages/security/high-risk-actions.ts`):
- **Fiscal:** cancelar guia TISS, cancelar NF-e, anular invoice, alterar valor de invoice paga
- **RBAC:** alterar role de outro user, criar role custom, conceder grant direto
- **Financeiro:** alterar chave Asaas, configurar BYOK pagamento, executar `runOpenFinancePayment`
- **Compliance:** anonimizar member, deletar dado clínico, exportar prontuário, encerrar tenant
- **Super-admin:** abrir sessão privilegiada PAM (já enforced via ADR 0073 camada 7), restore de backup

CI tem teste E2E que tenta cada ação sem MFA recente e verifica falha. Lint custom `high-risk-action-must-require-recent-mfa` bloqueia commit se Server Action listada não chama `requireRecentMfa()`. Ver [ADR 0073](decisions/0073-postura-seguranca-defesa-em-profundidade.md) camada 2 + Sprint 01a + CLAUDE.md regra 28.

---

## Processo (quebrou = não fecha sprint)

**9.** 1 sprint ativo por vez. Teto de 3 semanas por sprint. Estourou? Quebra em duas funcionalidades menores.
**10.** Commits vão direto para `main` (desenvolvimento solo, sem PR review obrigatório). Branches `feat/*`, `fix/*`, `chore/*`, `docs/*` são **opcionais** — usar só quando a feature é longa, arriscada, ou o trabalho precisa ser testado isolado antes de merge.
**11.** Conventional Commits obrigatórios (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
**12.** Toda feature nova entra atrás de **feature flag** (PostHog) até ser validada.
**13.** ADR criado no **mesmo dia** da decisão; nunca retroativo.
**14.** `CHANGELOG.md` atualizado em todo commit que muda comportamento observável.
**15.** Nenhum `--no-verify`, `--force` em `main`, nem skip de CI.

---

## Código (quebrou = CI vermelho)

**16.** TypeScript `strict: true`. `any` só com comentário `// why:` justificando.
**17.** Biome formata e linta; sem override pessoal.
**18.** Cobertura mínima: 70% em `packages/db`, 60% em Server Actions.
**19.** Nenhum segredo em código — `.env` + Vercel/Supabase secrets.
**20.** Import ordenado por Biome; caminhos absolutos `@repo/*`.

---

## Exceções

Qualquer exceção a uma regra exige:

1. ADR novo justificando (com data + contexto + consequência)
2. Link do ADR no PR que quebra a regra
3. Atualização desta página mencionando a exceção (ou a revisão da regra)

Sem ADR, sem merge.
