# Catálogo de Módulos

Visão funcional do sistema, agrupada por **área**. Cada módulo tem "quais verticais usam" e "qual sprint entrega", para que trabalho cross-vertical fique visível de antemão.

> Complementar a [`roadmap.md`](roadmap.md) (temporal) e a [`sprints/`](sprints/) (executável). Este arquivo olha **para dentro** — o que o sistema é.

---

## Áreas

| Área | O que é |
|---|---|
| `fundação` | Infra, auth, multi-tenancy, RBAC, audit — base técnica não-funcional. Não é feature de negócio. |
| `geral` | Serve todas as verticais (cadastro de pessoa, agenda, financeiro, copilot, dashboard). Módulos cross-vertical moram aqui. |
| `academia` | Específico da vertical Academia (modalidades, QR, catraca, check-in). |
| `fisio` | Específico da vertical Fisioterapia (prontuário, assinatura ICP-Brasil, evolução com mídias). |
| `nutri` | Específico da vertical Nutrição (antropometria, cardápios, nutri-agent). |

**Legenda de status:** `todo` · `doing` · `done` · `blocked` · `futuro` (fora da janela atual de planejamento).

---

## Fundação

| Módulo | Descrição | Verticais | Sprint | Status |
|---|---|---|---|---|
| **Multi-tenant por subdomínio (ADR 0065)** | Middleware Next.js extrai `{slug}` de `{slug}.logifit.com.br`; cookies escopo `.logifit.com.br`; slug validation + reserved subdomains + rename com redirect 301 90d; dev local via `*.localhost` | todas | 00 (middleware) + 01a (slug em tenants) | todo |
| **Planos comerciais LogiFit ([ADR 0066](decisions/0066-plano-comercial-pricing-trial.md) — versão vigente 2026-04-25)** | **6 planos** com tabela canônica em ADR 0066 e em [CLAUDE.md §Modelo comercial](../CLAUDE.md): Solo R$ 49 / Solo Combo R$ 69 (autônomo, `mode='solo'`, ADR 0069) · Starter R$ 99 (Academia MVP — Fisio/Nutri Fases 2/3) · Pro R$ 199 (todas verticais + Focus NFe + Device Hub + Pipeline Exames) · Business R$ 449 (multi-company até 3 CNPJs + intercompany + adquirência) · Enterprise sob consulta (white-label + DPO add-on + SLA). Trial 14d sem cartão (features Pro; dados retidos 30 dias após expiração e então anonimizados). **Overage member** R$ 0,50 (Solo/Combo R$ 0,40) acima do incluído; cap força upgrade sugerido. **Overage NFS-e** R$ 0,50/0,40/0,35/0,25 por nota emitida; eventos não contam. **Cota IA é hard-stop sem overage** (ADR 0064). **Cobrança 1 active member por (paciente, tenant)** — passaporte cross-tenant não duplica ([ADR 0077](decisions/0077-passaporte-paciente-vinculo-cross-tenant.md)). Cobrança Asaas próprio + NFS-e via Focus NFe. Régua inadimplência D+0 → D+21 read-only → D+45 suspenso → D+135 anonimização. | todas | 01a + 04 + 36 | todo |
| **DPO + Governança Compliance (ADR 0067)** | DPO interino (fundador) → externo na escala; canal `privacidade@logifit.com.br`; RIPD por módulo sensível; `security_incidents` schema + plano resposta 72h ANPD; sub-processors públicos; auditoria interna trimestral + externa anual (fase 2) | todas | 00 (setup) + 01b (schemas) + 26 (portal titular) | todo |
| **Cadastro central de `persons`** | Tabela única PF/PJ com detecção automática do tipo pelo documento; todos os cadastros especializados (members/leads/suppliers/companies/users/profissionais) ganham FK `person_id`. Sem duplicação de dados de identidade. | todas | 01a | todo |
| **Registros profissionais em conselho (ADR 0055)** | `professional_registrations (person_id, council_body, council_number, council_state, cbo_code, situation, verified_at, verification_source)` — cadastro de CRM/CRN/CREFITO/CREF (e CRF/CRP/COREN/CRO futuros) com unicidade global. Uma pessoa pode ter N registros (profissional dual). Gates downstream: assinatura de prontuário (Sprint 20), geração TISS (Sprint 22), contrato de comissão (Sprint 23), onboarding de personal (Sprint 08) | todas | 01b | todo |
| **Validação periódica de situação no conselho** | Job Fase 2 consulta portais oficiais (CFM, CREFITO, CRN, CONFEF) e atualiza `situation` automaticamente; no MVP é `operator_attested` | todas | pós-19 | futuro |
| **`<PersonPicker>` reutilizável** | Componente de autocomplete que busca persons e mostra papéis ativos; usado em toda tela de cadastro especializado | todas | 01a | todo |
| **Busca automática de dados por CNPJ** | Ao digitar 14 dígitos preenche razão social, endereço, CNAE, porte, regime tributário, situação cadastral vindos da Receita. BrasilAPI (default) + ReceitaWS (fallback) + CNPJá! (pago, opcional). Admin configura via `/app/settings/pessoas/cnpj` | todas | 01a | todo |
| **Cache de CNPJ + validação periódica de situação** | Cache global 7 dias; botão manual de refresh; job semanal detecta empresa baixada/suspensa | todas | 01a | todo |
| **Device Hub (wearables + clínicos)** | Ingestão normalizada FHIR-like de Garmin, Oura, BLE bioimpedância, FIT/CSV; provider abstrato; expande com Apple Health + Google Health Connect no Sprint 35 App Nativo | todas | 32 | futuro |
| **Curadoria profissional de leituras para avaliação** | Profissional seleciona leituras de `device_readings` + valida/edita + importa para `assessment_measurements` com rastreabilidade (`source_device_reading_id`, `validated_by_user_id`) | todas | 32 | futuro |
| **Monitoramento contínuo por categoria** | Tracks de peso/HR/sono/recovery/passos entre avaliações formais com tendências visuais | todas | 32 | futuro |
| **Alertas inteligentes de saúde** | Regras declarativas (mesma DSL do Sprint 13) consomem `device_readings` e disparam via cross-alert dispatcher: HR em repouso subiu, % gordura aumenta, sedentarismo | todas | 32 | futuro |
| **Timeline enriquecida no member** | Widget de timeline ganha tracks paralelos: avaliações oficiais + dados de dispositivo (agregados) + alertas disparados | todas | 32 | futuro |
| **Consent granular por provider + retenção 90d raw** | Member autoriza cada integração separadamente; dado cru rotaciona 90 dias, agregados diários indefinidos | todas | 32 | futuro |
| **Reconhecimento facial (consent opt-in)** | Biometria facial para entrada na unidade (alternativa a QR/catraca); LGPD art. 11 (dado biométrico sensível) — consent explícito obrigatório, retenção raw D+90, embeddings cifrados, revogação D+0 com purge imediato. RIPD `v1.0-reconhecimento-facial.md` cobre risco residual e decisão DPO. | Academia (MVP) + opcional Fisio/Nutri | 32 (junto com Device Hub — provider biométrico abstrato) | futuro |
| **Pipeline inteligente de exames laboratoriais** | Upload PDF → OCR → IA extrai analitos estruturados → IA sugere padrões e hipóteses (conservador, nunca diagnostica) → profissional revisa lado-a-lado → publica em `lab_results` oficial | todas | 33 | futuro |
| **Self-upload de exame pelo paciente** | Portal `/meu/exames/upload` com consent específico; exame entra em fila de revisão antes de virar histórico oficial | todas | 33 | futuro |
| **Classificador de output clínico** | Guardrail IA que bloqueia termos proibidos ("tem [doença]", "diagnóstico de", etc); ADR 0015 será produzido no Sprint 06 (Copilot Safety) — ver convenção em `roadmap.md` sobre ADRs reservados a sprints | todas | 33 | futuro |
| **Categorização sensível de exames** | Permission `exam.sensitive.read` para HIV/psiquiátrico/genético/paternidade; audit reforçado | Fisio + Nutri | 33 | futuro |
| **Opt-out de IA em exames por tenant** | Admin pode desabilitar IA e manter só OCR + revisão humana (para tenants com LGPD mais restritivo) | todas | 33 | futuro |
| Identidade + MFA | Login (magic link + OAuth), TOTP obrigatório para profissionais | todas | 01a | todo |
| Hierarquia group→tenant→company→unit | Schema multi-tenant com RLS raiz, 5 cenários canônicos no seed (incl. modo solo) | todas | 01a | todo |
| Login contextual + troca de tenant | Usuário multi-tenant escolhe contexto; JWT é reassinado | todas | 01a | todo |
| RBAC com scope | Roles + permissions + scope (`group`/`tenant`/`company`/`unit`) | todas | 01b | todo |
| Role custom por tenant | Admin edita `role_permissions` ou cria role custom (ex: `contador_externo`) | todas | 01b | todo |
| Grants diretos (`user_permissions`) | Exceção pontual user → permission com `expires_at` e `reason` | todas | 01b | todo |
| Consent LGPD | Consentimentos cross-module/cross-company granulares | todas | 01b | todo |
| `franchise_agreements` | Pares bilaterais para cross-company em `topology=franchise` | todas | 01b | todo |
| Audit log | Append-only, particionado por mês, leitura sensível grava sempre | todas | 01b | todo |
| Observabilidade | Sentry + PostHog + Logtail/Axiom | todas | 00 | todo |
| **Sistema de tratamento de erros (ADR 0071)** | Envelope unificado `{code, message, request_id, runbook}` com 16 códigos fechados; middleware inject `request_id`; `wrapAction()` / `wrapApiHandler()` / `wrapJob()` em `packages/errors/` (regra 33); fingerprint SHA256 com `tenant_id` para dedup; schema `system_alerts` + `system_alert_occurrences` com RLS + role-based visibility; auto-resolução inteligente (TTL, recovery por webhook success); retenção 30/90/365/1825 dias por severity; trigger SQL liga `critical+security` a `security_incidents` (ADR 0067); lint custom `no-unwrapped-action` bloqueia Server Action sem wrapper | todas | 00 (base + wrappers) + 01a (schema) + 07 (UI) + 13 (canais) | todo |
| **Notificações em tempo real (ADR 0071)** | 4 canais MVP: badge SideMenu com subscribe Realtime, toast `sonner` na sessão ativa, email critical via Resend, WhatsApp urgent via provider; + 2 complementares: push PWA (Sprint 26) e Sentry (LogiFit dev team) | todas | 00b (badge) + 07 (toast + UI) + 13 (email + WhatsApp) + 26 (push) | todo |
| **Error translators por domínio (ADR 0071)** | 10 translators: Asaas, Focus NFe (90+ códigos SEFAZ), Supabase RLS, Anthropic, Gemini, Groq, OpenAI, Twilio WhatsApp, TISS (~40 códigos glosa/rejeição), Pluggy, Zod + fallback genérico. Cada sprint de integração popula o translator do provider | todas | 00 (stubs) + sprints específicos (04/06/17/20/22/36) | todo |
| **Sanitização LGPD de alerts (ADR 0071)** | `sanitizeForAlert()` mascara CPF/CNPJ (últimos 4), email (só domínio), telefone (DDD+4 últimos), redacted senha/token/dado clínico; garante que `payload` de `system_alerts` não vaza PII | todas | 00 | todo |
| Observabilidade de IA | Wrapper com tokens/latência/custo/cache hit-miss em `packages/ai/observability.ts` | todas | 00 | todo |
| CI + teste RLS | Pipeline GitHub Actions que falha se tabela nova sem RLS | todas | 00 | todo |
| **i18n (3 idiomas: pt-BR/en-US/es-419)** | next-intl com middleware, catalog JSON por namespace, CI check de chaves faltantes (regra 27, ADR 0052) | todas | 00 | todo |
| **LocaleSwitcher** | Componente reutilizável em `packages/ui` para troca de idioma; persiste em cookie + `persons.preferred_locale` | todas | 00 | todo |
| **Pesquisa global (Command Palette Ctrl+K) — ADR 0062** | Atalho `Ctrl+K`/`Cmd+K` em qualquer tela abre overlay de busca cross-module respeitando RLS + permission + consent; modificadores `>` ações / `/` rotas / `@` pessoas / `#` tags; full-text (tsvector) + trigram (pg_trgm); audit em clique em dado sensível; em mobile vira botão 🔍 no header | todas | 00 (scaffold) + 07 (MVP) + sprints posteriores indexam seus tipos | todo |
| **Componentes base responsivos (ADR 0063)** | `<AppLayout>` (header compacto + página 100% viewport) + `<ResponsiveTable>` (table ↔ cards) + `<ResponsiveModal>` (centered ↔ full-screen) + `<ResponsiveForm>` (grid ↔ stack) + `<PortalLayout>` (PWA com safe-area-inset) + tokens touch (`min-h-touch` 44px); 5 breakpoints Tailwind; testes Playwright em 3 viewports obrigatórios | todas | 00 (base) + todos os sprints consomem | todo |
| **SideMenu hamburger overlay (ADR 0063 + Sprint 00b)** | `<SideMenu>` overlay em todos os viewports (mobile 85% / tablet 320px / desktop 280px) com `<HamburgerTrigger>` (☰) sempre visível; backdrop clicável + swipe gesture + atalho `Ctrl+B`/`Cmd+B` + focus trap + `Esc` fecha; **organizado por módulos** (Início, Pessoas, Agenda, Acesso, Comercial, Financeiro, Fiscal, Clínico, Vigilância, Relacionamento, Estoque, Engajamento, RH, Compliance, Integrações, Configurações); **filtros automáticos** por permission (`has_permission()`), vertical ativa do tenant, consent e feature flag — módulo inteiro some se todos itens filtrados; registry `registerMenuItem()` alimentado por cada sprint | todas | 00b (implementação) + todos os sprints registram itens | todo |
| **Classificação SaMD por feature (ADR 0053)** | Tabela viva `docs/compliance/samd-classification.md` + `ai_feature_classifications (feature_key, class, requires_anvisa_notification, requires_committee)` alimentada pelos sprints de IA | todas (aplicável onde há IA) | 01b | todo |
| **Supervisão humana documentada (CFM 2.454/2026)** | `ai_audit_log` append-only (input, output, modelo, versão do prompt, decisão humana: aceitou/editou/rejeitou) | todas (aplicável onde há IA) | 01b | todo |
| **Comitê de IA interno por tenant (CFM 2.454/2026)** | `ai_committee_members (tenant_id, user_id, role, started_at)` + UI `/app/settings/compliance/comite-ia` + ata anexada + revisões periódicas; **gate em feature flag**: feature IA classe II+ não ativa sem comitê cadastrado | todas | 01b | todo |
| **Dashboard de conformidade IA** | `/app/compliance/ia` lista features IA ativas + classe SaMD + última revisão do comitê + log de decisões humanas (CFM 2.454/2026) | todas | 01b | todo |
| **RIPD versionado por módulo crítico (LGPD art. 11 — ADR 0054)** | `ripd_documents` + `ripd_versions` com SHA-256 hash, riscos identificados, mitigações, parecer DPO; revisão semestral obrigatória | todas | 01b | todo |
| **Consent granular por finalidade (LGPD art. 8º + art. 11)** | `consent_purposes (key, label, required, lawful_basis, data_categories[])` + `consents (member_id, purpose_key, given_at, revoked_at)` com trilha completa | todas | 01b | todo |
| **Direitos do titular (LGPD art. 18 — 8 direitos completos)** | Portal `/meu/privacidade` com 8 botões (confirmação/acesso/correção/anonimização/portabilidade/info-compartilhamento/info-consequências/revogação); apagamento **é solicitação**, não automático (obrigações de retenção: prontuário 20a CFM 2.299, fiscal 5a); SLA **15 dias úteis** (Resolução ANPD nº 2/2024); `data_subject_requests` + timeline visível ao titular; admin atende via `/app/compliance/titular-requests` | todas | 01b (scaffold) + 26 (portal completo) | todo |
| **Retenção e descarte automatizado** | `retention_policies (data_category, retention_period, legal_basis)` + job de expurgo + audit | todas | 01b | todo |
| **Particionamento + retenção (ADR 0072 + regra 34)** | Toda tabela com volume estimado >5M linhas/ano OU >50k linhas/dia nasce particionada (`PARTITION BY RANGE` temporal — mês/trimestre/ano — ou `PARTITION BY HASH (tenant_id)`). Migration declara `@volume_estimate_yearly: <N>` em comentário SQL; CI lint bloqueia se excede sem partição. Retenções aplicadas: 5 anos audit (LGPD), 20 anos prontuário (CFM 2.299/2021 + COFFITO 415/2012), 5 anos fiscal, 1 ano IA audit (CFM 2.454/2026) + 5 anos cold storage. Drop de partição = metadata-only (ms vs hours em DELETE row-by-row). | todas | 01a (audit_log + jobs base) + 02 (member_events) + 06 (ai_audit_log) + 07 (UI monitoring) + 11/17/20/21/30/31/32/33 (tabelas específicas) | todo |
| **Cold storage Parquet zstd (ADR 0072)** | Dados >2-5 anos exportados para Supabase Storage como Parquet zstd compactado; retenção legal preservada com custo ~80% menor que disco quente. Schema `archive_jobs` + `compliance_retention_log` rastreia migrações. Cold partitions criptografadas AES-256 + KMS (prontuário, exames, diário alimentar). Job `archive-cold-partitions` quadrimestral. | todas | 01b (schemas) + 07 (UI) + sprints específicos | todo |
| **Monitoring de banco `/app/super-admin/database` (ADR 0072)** | UI exclusiva super-admin LogiFit (fora do RBAC do tenant): tamanho total + por tenant top-10 + projeção 12 meses · inventário de partições (oldest/newest/retenção/próximo expurgo) · histórico de jobs (create-next/drop-old/archive-cold/aggregate-summaries/refresh-mat-views) com retry · cold storage usage · tenants candidatos a sharding (`shard_url IS NULL` + size > threshold). Permission `super_admin.database.read`. | todas | 07 | todo |
| **Sharding multi-cluster preparado (ADR 0072)** | `tenants.shard_url text NULL` (NULL = compartilhado; preenchido = dedicated cluster); evolução futura quando 1 tenant >100k members ou banco >500GB. Não ativado no MVP — apenas a coluna + view `v_sharding_candidates` ficam prontas. | todas | 01a | todo |
| **Security headers + CSP nonce (ADR 0073 + regra 35)** | `next.config.ts headers()` com CSP estrito (script-src 'self' + nonce dinâmico, sem unsafe-inline em script), HSTS preload, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy restritiva, COOP/CORP. Submissão à HSTS Preload List. CI valida cada header. | todas | 00 | todo |
| **Rate limit global Upstash (ADR 0073 + regra 36)** | Sliding window por `(tenant_id, user_id, ip, endpoint)` em `wrapAction()/wrapApiHandler()`. Limites canônicos: login 10/15min IP + 5/15min email · read 100/min · write 30/min · IA 20/min · search 30/min · webhook 60/min IP · signup 3/h IP. Excedido → `RATE_LIMITED` envelope. | todas | 00 | todo |
| **safeFetch + SSRF protection (ADR 0073 + regra 37)** | Wrapper único `packages/security/safe-fetch.ts` para fetch externo: protocolo http/https only, DNS resolve + bloqueio IP privado/loopback/link-local, `allowedHosts` obrigatória, timeout 30s, maxResponseBytes 50MB, `redirect: 'manual'`. Lint `no-raw-fetch` em CI. Allowlists por integração (Asaas/Focus/Pluggy/Twilio/Garmin/Oura/IA providers). | todas | 00 (base) + 04/06/13/17/32/33/36 (allowlists) | todo |
| **Scan obrigatório em uploads (ADR 0073 + regra 38)** | `packages/security/scan-upload.ts` provider abstrato. **MVP zero-custo** usa scan próprio: MIME real (file-type), magic bytes, extension allowlist por bucket, embed detection (PDF JS, Office macro, polyglot). **Fase 2** plug-in ClamAV self-hosted ou cloudmersive. Tabela `upload_scans` rastreia status; arquivo só vira `published` após `clean`. Buckets cobertos: `lab-documents`, `fisio-evolucoes`, `exam-attachments`, `exercises`, `certificados`, `whatsapp-media`. Lint `no-unscanned-upload`. | todas | 00 (base) + 13/17/21/32/33/36 (uso) | todo |
| **Login lockout + bot protection (ADR 0073)** | Tabela `auth_attempts` particionada mensal + `auth_lockouts`; 5 falhas em 15 min → lockout 30 min + alerta email titular; Cloudflare Turnstile no signup/login/forgot/trial; recovery codes TOTP one-time; página `/meu/sessoes` lista + revoga sessões; trocar senha invalida todos refresh tokens. | todas | 01a | todo |
| **Hash chain `audit_log` (ADR 0073 + regra 39)** | Cada linha tem `previous_hash` SHA256 da anterior do mesmo tenant; trigger BEFORE INSERT computa; job semanal verifica continuidade; quebra dispara `system_alerts critical`. Anchor periódico em S3 Object Lock WORM dificulta adulteração mesmo com acesso DB. | todas | 01a | todo |
| **PAM super_admin LogiFit (ADR 0073 camada 7)** | `privileged_sessions` (4h, MFA recente, justificativa ≥20 chars) + `privileged_audit_log` (snapshot before/after, hash chain) + JWT secundário com claim `privileged=true` exigido em `/app/super-admin/*` + alerta automático ao abrir sessão (email + Telegram fundador) + revogação automática se query >50k linhas (data exfiltration detection). | todas | 01b | todo |
| **Backup off-site + DR (ADR 0073 + regra 40)** | **MVP zero-custo:** Supabase backup nativo (incluído no plano) + `pg_dump` weekly cifrado GPG para Cloudflare R2 free 10GB ou Backblaze B2 free 10GB via Vercel Cron + retenção 12 meses. **Fase 2:** AWS S3 us-east-1 com Object Lock WORM (R$ 100-300/mês). RPO 24h / RTO 4h. Teste de restauração trimestral. DR Plan público para Enterprise. Chaves de criptografia em backup separado. | todas | 00 (setup) + 07 (UI status) | todo |
| **Criptografia at-rest com KEK por tenant (ADR 0073 camada 4)** | AES-256-GCM em campos sensíveis (`consultas.content`, `exam_extractions.raw_text`, mídia clínica). Master key LogiFit + `KEK` (Key Encryption Key) derivada por tenant via HKDF. Cert A1 com KEK por company + senha cifrada separadamente. Rotação anual de chave (`encryption_key_version`); versionamento permite re-cifrar em background. | todas | 01a (infra) + 17/20/21/32/33 (uso) | todo |
| **PII redaction antes do LLM (ADR 0073 camada 5)** | `redactBeforeLLM(text)` em `packages/ai/security/redact.ts` mascara CPF/CNPJ/RG/email/telefone/endereço/cartão/PIX antes de enviar `ragChunks` ao provider; aplicado em `buildSystemPrompt()`. `aggressive_redaction` (Enterprise) também mascara nome próprio. | todas | 06 | todo |
| **Anti-prompt-injection + abuse detection (ADR 0073 camada 5)** | Classificador detecta padrões de override ("ignore previous instructions", "system prompt:"); `ai_audit_log.injection_detected=true` + bloqueio tool calling. Output que vaza system prompt > 200 chars = bloqueado. Tenant com 10x consumo médio em 24h → soft-block + alerta admin. | todas | 06 | todo |
| **Secret scanning + Dependency security (ADR 0073 camada 6)** | Gitleaks pre-commit + GitHub Action; padrões custom LogiFit. Dependabot semanal (npm + actions). OSV-scanner em CI bloqueia merge se severity≥high em deps de produção. SBOM CycloneDX por release. CI permissions read-all default + actions de terceiros pinadas por SHA. | todas | 00 | todo |
| **`/.well-known/security.txt` + página `/seguranca` (ADR 0073)** | RFC 9116 com `security@logifit.com.br` + Encryption + Policy + Canonical. Página pública `/seguranca` com postura resumida + política de divulgação responsável (90d coordinated) + hall da fama de pesquisadores. SLA: ack 48h, triage 7d, fix por severity (critical 7d / high 30d / medium 90d). | todas | 00 | todo |
| **Threat model STRIDE em features críticas (ADR 0073)** | Aplicação obrigatória do STRIDE em 5 features críticas durante seu sprint, registrado em `docs/threat-models/`: login + sessão, pagamento Asaas, prontuário, pipeline exames, WhatsApp inbound. Outros features: STRIDE leve no commit checklist. | todas | 01a (login), 04 (pagamento), 13 (WhatsApp), 20 (prontuário), 33 (exames) | todo |
| **OWASP Top 10 checklist por release (ADR 0073)** | `scripts/owasp-check.ts` em CI antes de release confirma cada item enforced (A01 RLS+RBAC · A02 TLS+AES · A03 Drizzle+Zod · A04 STRIDE · A05 headers+secrets · A06 Dependabot+OSV · A07 MFA+lockout · A08 hash chain+ICP · A09 system_alerts+Sentry · A10 safeFetch). | todas | 00 (base) | todo |
| **Auditoria + scan automated (ADR 0073)** | **MVP zero-custo:** auditoria interna trimestral (fundador, 2h por trimestre) + OWASP ZAP automated scan weekly em GitHub Action + bug bounty informal SEM recompensa monetária (Hall da Fama em `/seguranca/agradecimentos`). **Fase 2:** pentest externo anual (Tempest/Conviso/OSCP R$ 8-15k) + bug bounty pago (R$ 200-2k regular, R$ 5-10k critical). **Fase 3:** SOC 2 Type 2 (R$ 80-150k anual). | todas | trimestral / weekly | todo (MVP) / futuro (pago) |

---

## Geral

Módulos que servem todas as verticais. Extensões específicas (ex: "modalidades de Academia" em cima da agenda universal) moram na área da vertical.

| Módulo | Descrição | Verticais | Sprint | Status |
|---|---|---|---|---|
| Cadastro de pessoa (`members`) | Perfil único cross-module do aluno/paciente, com `home_unit_id` | Academia, Fisio, Nutri | 02 | todo |
| Timeline do member (`member_events`) | Histórico append-only cross-module | Academia, Fisio, Nutri | 02 | todo |
| **Perfil do paciente como hub operacional (ADR 0069)** | Header fixo + action bar role-aware + tabs por visão (Geral/Clínico/Treino/Alimentar/Financeiro/Comunicação/IA) + modo atendimento com timer + sidebar de histórico recente + registry `registerMemberAction` + ações inline (modal/sheet); adapta para `mode='solo'` sem tabs | Academia, Fisio, Nutri | 02 (base) + todos sprints registram ações | todo |
| **Modo Solo — profissional autônomo (ADR 0069)** | `tenants.mode='solo'` ativado por onboarding wizard; UX simplificada (sem tabs perfil); plano Solo R$ 49/Solo Combo R$ 69; templates pré-carregados por profissão (CREF/CREFITO/CRN/CRP/CRO/Pilates/Esteticista); fiscal MEI/RPA simplificado | todas | 01a (wizard) + 02 (perfil adapta) + 04 (plano Solo) + 15 (fiscal) + 26 (portal) | todo |
| **Insights cross-module computados (ADR 0070)** | Funções puras em `packages/db/insights/`: TMB · TDEE · gasto calórico sessão · volume semanal · balanço calórico · adesão plano · contraindicações CID×exercício · overtraining · trajetória peso. Cache `member_insights` com invalidação por evento | Academia, Fisio, Nutri | 02 (cache) + 11 (met_value) + 12 (calculadoras) + 27 (contraindicações) + 29 + 31 | todo |
| **Timeline integrada do paciente (ADR 0070)** | Materialized view `member_timeline` unifica consultas + sessões de treino + food_log + avaliações + invoices + eventos WhatsApp em ordem cronológica; filtros por módulo; refresh 5min + invalidação por evento | Academia, Fisio, Nutri | 02 | todo |
| **Contraindicações CID×exercício (ADR 0070)** | `cid_exercise_contraindications` seed global curado LogiFit (~200 mais comuns) + tenant override; severidade (avoid/adapt/caution) + alternativas sugeridas; alerta automático quando novo treino contém exercício contraindicado por CID ativo | Fisio, Academia | 27 | todo |
| **Compendium of Physical Activities 2024 (ADR 0070)** | `exercises.met_value` obrigatório; seed de ~800 exercícios com valores MET; base para cálculo automático de gasto calórico | Academia, Fisio | 11 | todo |
| Tags e anotações livres | Classificação + notas rápidas por operador | Academia, Fisio, Nutri | 02 | todo |
| Recursos agendáveis | Instrutor, sala, equipamento (`resources`) | Academia, Fisio, Nutri | 03 | todo |
| Slots recorrentes | Geração lazy de slots semanais/diários | Academia, Fisio, Nutri | 03 | todo |
| Agendamentos + waitlist | Booking, cancelamento, lista de espera, check-in manual | Academia, Fisio, Nutri | 03 | todo |
| Planos (ofertas comerciais) | Catálogo de planos do tenant | Academia, Fisio, Nutri | 04 | todo |
| **Catálogo de serviços (ADR 0068)** | Tenant cadastra serviços (sessão fisio, consulta nutri, mensalidade academia, avaliação, personal, produto) com preço avulso + duração + CBO/TUSS + chart_account + stock_item; fonte única de preço | Academia, Fisio, Nutri | 05 | todo |
| **Construtor visual de planos (ADR 0068)** | UI `/app/settings/planos` com form + modal "Adicionar serviço"; define qtd incluída, período (per_cycle/total/lifetime), preço do extra, hard limit opcional; preview member antes de publicar | Academia, Fisio, Nutri | 05 | todo |
| **Preços contextuais unificados (ADR 0068)** | Tabela `service_prices` com 7 contextos (default/plan/contract/member_custom/insurance/promotion/company); função `resolveServicePrice()` com prioridade decrescente; Sprint 22 migra `insurance_procedure_prices` | Academia, Fisio, Nutri | 05 | todo |
| **Widget financeiro do member consolidado** | Visão unificada: plano + consumo + ARs em aberto + histórico + saldo cashback + ações (operador) ou pagamento (member); breakdown transparente na invoice | Academia, Fisio, Nutri | 02 (layout) + 04 (dados) + 26 (portal) | todo |
| Contratos (member ↔ plano) | Matrícula com vigência e ciclo de renovação | Academia, Fisio, Nutri | 04 | todo |
| Cobranças Asaas | Boleto, Pix, cartão recorrente; chave por company ou por tenant (ADR 0010) | Academia, Fisio, Nutri | 04 | todo |
| Webhooks idempotentes | Recepção HMAC de eventos externos (`webhook_events.external_id`) | Academia, Fisio, Nutri | 04 | todo |
| Promoções (cupons) | Códigos com tipo/validade/teto/planos aplicáveis | Academia, Fisio, Nutri | 05 | todo |
| Pacotes (bundles) + créditos | Plan composto + `appointment_credits` consumidos na agenda | Academia, Fisio, Nutri | 05 | todo |
| Referrals (indicação premiada) | Código de indicação → desconto no referred + recompensa no referrer | Academia, Fisio, Nutri | 05 | todo |
| Cashback (stretch) | Ledger de pontos/créditos ganhos por pagamento | Academia, Fisio, Nutri | 05 (stretch) | todo |
| **Assistente IA universal (ADR 0075)** | Chat acessível a qualquer usuário em qualquer tela via `<AssistantFAB>` flutuante (mobile bottom sheet 92vh / desktop side panel 420px) + página dedicada `/app/assistente` + variantes `/meu/assistente` (Sprint 26) e `/app/coach/assistente` (ADR 0074); atalho `Ctrl+/`; consulta/sugestão sempre, nunca prescrição (regra 28) | todas | 06 | todo |
| **3 camadas Help/Insight/Action (ADR 0075)** | Camada 1 (RAG read-only) liberada por padrão; Camada 2 (read data via Server Actions read-only com RBAC propagado); Camada 3 (write actions com `<ActionConfirmDialog>` obrigatório + `assistant_action_proposals` + audit reforçado + proteção dupla via `proposal_id`) | todas | 06 | todo |
| **7 personas por papel (ADR 0075)** | Templates `member`, `professional_clinical`, `professional_coach`, `admin`, `recepcao`, `super_admin`, `contador_externo`, `dpo` em `packages/ai/personas/*.ts`; `inferPersona(user, tenant)` automático + chip "Falar como: X" no header do sheet; user com permissions múltiplas troca runtime; persistência em cookie no MVP | todas | 06 | todo |
| **Tool registry distribuído (ADR 0075 + regra 41)** | Cada módulo cria `<modulo>/ai-tools.ts` chamando `registerAITool({key, layer, whenAvailable, showInPersonas, argsSchema, requiresConfirmation, handler, audit, rateLimitKey})`; build hook gera manifest + popula `tools_registry`; lint `ai-block-respected` impede expor handler com `// ai-blocked` comentário | todas | 06 (base) + cada sprint posterior registra suas tools | todo |
| **Whitelist inicial Camada 3 (ADR 0075)** | ~9 tools Write seguras no MVP: `cancelMyAppointment`, `requestSecondCopy`, `confirmAppointment` (member); `createDraftEvolution` (profissional clínico); `scheduleAppointmentForMember`, `requestSecondCopyForMember`, `createLead`, `inviteUser` (recepção/admin); `report_issue` (todos). Bloqueado: DELETE, `signEvolution`, `chargeBatch`, `anonymizeMember`, `transferMemberBetweenCompanies`, `runOpenFinancePayment`, mudanças em config | todas | 06 | todo |
| **Cotas IA alinhadas a planos comerciais (ADR 0066 + 0075)** | Starter 500/mês (~50/dia soft) · Pro 3.000/mês (~150/dia soft) · Business 10.000/mês (~500/dia soft) · Enterprise 25.000/mês default ou BYOK ilimitado. Cache hit Camada 1 = 0 chamadas; Camada 2 = 1; Camada 3 proposta + reformulação = até 2. Tool execution conta no rate limit Server Actions (regra 36), não na quota IA. Soft diário excedido = toast informativo; mensal excedido = circuit breaker + CTA BYOK | todas | 06 | todo |
| **`<AssistantFAB>` global mobile-first (ADR 0075 + regra 31)** | Botão flutuante 56×56px mobile / 64×64px desktop em `<AppLayout>`; tap abre `<AssistantSheet>` (drag-down fecha mobile); badge "novo" para sugestões proativas; `Ctrl+/` desktop abre; cross-link em `Ctrl+K` busca global (ADR 0062): "Não achou? Pergunte ao assistente →" | todas | 06 | todo |
| **`<ActionConfirmDialog>` (ADR 0075)** | Dialog renderizado pra todo `proposeAction` Camada 3: título, descrição, impacto (low/medium/high), affectedEntities, [Confirmar/Editar/Cancelar]; expira em 5min; user editar args → recria proposta | todas | 06 | todo |
| **Dashboard `/app/super-admin/ai-usage` (ADR 0075)** | Super-admin LogiFit vê: top 10 tenants por consumo, top 10 tools usadas, cache hit rate global, latência média por persona, taxa de aceitação Camada 3 por tool (sinal de qualidade IA), tenants em quota cap | todas | 06 | todo |
| **Arquitetura IA — Gemini Flash default + BYOK + RAG (ADR 0064)** | 7 tabelas (`ai_providers`, `ai_models`, `ai_provider_configs`, `ai_task_routing`, `ai_tenant_usage`, `ai_documents`, `ai_document_chunks`, `ai_semantic_cache`) + tasks tipadas (chat/embedding/classification/extraction/vision/transcription/reasoning) + cache semântico + quota por plano + fallback cascade | Academia, Fisio, Nutri | 06 | todo |
| **RAG global curado LogiFit** | Seed de ADRs + Sprints + schema Drizzle + regulações (CFM 2.454, LGPD, TISS 4.01, CFN 599, COFFITO 414, ANVISA RDC) como `ai_documents` global; Copilot cita fonte | Academia, Fisio, Nutri | 06 | todo |
| **BYOK — bring your own key** | Admin tenant cola API key própria em `/app/settings/ia`; criptografada AES-256-GCM; bypass quota LogiFit; tenant paga direto | Academia, Fisio, Nutri | 06 | todo |
| **Quota IA por plano + circuit breaker (ADR 0064 + 0066)** | Starter 500 · Pro 3k · Business 10k · Enterprise 25k chamadas/mês; cache semântico reduz ~50%; quota excedida = bloqueio + CTA "configure BYOK" (sem overage pago); detalhamento por camada (Help/Insight/Action) em ADR 0075 | todas | 06 | todo |
| **White-label do assistente** | `tenant_settings.ai_assistant_name` configurável ("Copilot" default; tenant pode mudar para "Vital AI", "Dr. Clinica X"); hook `useAIAssistantName()` propaga para toda UI | Academia, Fisio, Nutri | 06 | todo |
| **Transcription (STT) — Groq Whisper** | Áudio da teleconsulta (Sprint 31) → transcript estruturado em turnos; custo ~US$ 0,30/tenant/mês absorvido; base para SOAP automático | Academia, Fisio, Nutri | 06 (infra) + 31 (uso) | todo |
| **Rascunho SOAP automático pós-teleconsulta** | Transcript + contexto do paciente + template de especialidade → IA gera rascunho em 4 seções (SOAP); profissional revisa/edita/assina; regra 28 supervisão humana | Fisio, Nutri | 31 | todo |
| **Sistema mínimo de tickets** | `support_tickets` + tool `report_issue` (LLM pode abrir ticket com contexto rico); UI `/app/suporte` | Academia, Fisio, Nutri | 06 | todo |
| Cache semântico + rate-limit | `ai_semantic_cache` (pgvector) + Upstash Redis por tenant | Academia, Fisio, Nutri | 06 | todo |
| Dashboard "Equilíbrio Vital" | Home por role (recepção/gerente/diretor) + KPIs do negócio + tokens light/dark sem sombra | Academia, Fisio, Nutri | 07 | todo |
| Dashboard do member | Home `/app/members/[id]` com widgets contribuídos por cada módulo (timeline, agenda, financeiro, copilot, acessos, créditos, conquistas, metas) | Academia, Fisio, Nutri | 02 (layout) + 03/04/05/06/08/09 (widgets) | todo |
| Cross-alert dispatcher | Publisher/subscriber em cima de `domain_events` (consumidores reais nascem na Fase 2 e no Sprint 09) | todas | 07 | todo |
| Conquistas (gamification leve) | Catálogo configurável + regras declarativas que consomem `domain_events` | Academia, Fisio, Nutri | 09 | todo |
| Brindes (reward catalog + grants) | Físico (camiseta), digital_credit (crédito na próxima) ou service_credit (1 PT de cortesia) com workflow de entrega | Academia, Fisio, Nutri | 09 | todo |
| Metas + progresso automático | Objetivos do member (perder 5kg, 3×/sem); progresso vindo de antropometria, check-ins, medição manual | Academia, Fisio, Nutri | 09 | todo |
| Top performers (stretch) | Card de ranking no dashboard geral com opt-in do member | Academia, Fisio, Nutri | 09 (stretch) | todo |
| Funil de vendas (`leads`) | Estágios configuráveis, aula experimental, propostas versionadas, conversão → member | Academia, Fisio, Nutri | 10 | todo |
| Propostas comerciais | Documento versionado com plano/bundle + desconto + validade | Academia, Fisio, Nutri | 10 | todo |
| Biblioteca de exercícios | Catálogo global + tenant com vídeos curtos em Storage | Academia, Fisio (reabilitação) | 11 | todo |
| Workouts (treinos) | Conjunto ordenado de exercícios com séries/reps/carga/descanso; versionado | Academia, Fisio | 11 | todo |
| Prescrições polimórficas | `prescriptions` com `kind` (workout / meal_plan / fisio_protocol); genérico | Academia, Fisio, Nutri | 11 | todo |
| Execução de sessão + RPE | Registro de performance real + percepção de esforço 1–10 | Academia, Fisio | 11 | todo |
| **Modo Coach mobile-first PWA (ADR 0074)** | `/app/coach/*` PWA dedicado com manifest scope próprio + Service Worker offline-first; tela `/sessao/[id]` mobile-only (steppers gigantes, RPE picker, timer entre sets, foto/áudio/vídeo inline); modo multi-aluno (cards lado a lado); sync queue IndexedDB com idempotência via `client_id`; push "next_student_arrived"; reusa `attendance_sessions kind='treino'` (ADR 0069) | Academia, Fisio | 11 | todo |
| **Web Bluetooth (Android Chrome) — sensores BLE** | Pareamento direto de bioimpedância, cardiofrequencímetro, encoder de velocidade VBT durante sessão coach; iOS Safari não suporta → fallback manual; cobertura completa só com app nativo Sprint 31 | Academia, Fisio | 11 (basics) + 32 (full) | futuro |
| Avaliações físicas (catálogo) | Tipos configuráveis (bioimpedância, dobras, anamnese, ROM) com campos declarativos | Academia, Fisio, Nutri | 12 | todo |
| Registro seriado de medições | `measurements` séries temporais + gráficos de evolução | Academia, Fisio, Nutri | 12 | todo |
| Anamnese estruturada | Template de formulário com perguntas abertas/múltipla escolha | Academia, Fisio, Nutri | 12 | todo |
| Calculadoras (IMC, Pollock, TMB) | Funções derivadas das medições | Academia, Nutri | 12 | todo |
| Integração WhatsApp | Provider abstrato (Twilio / Z-API / Meta via ADR 0025) + templates + **inbound bidirecional** | Academia, Fisio, Nutri | 13 | todo |
| **Hub de WhatsApp inbound (multi-fluxo)** | Paciente manda anexo/mensagem no WhatsApp; identity matcher (busca por telefone ou pede CPF) + intent router + classificador IA de anexo; handlers pluggable registrados por sprints consumidores (ADR 0051) | Academia, Fisio, Nutri | 13 | todo |
| **Handler WhatsApp: boleto** | Fornecedor manda PDF do boleto pelo WhatsApp; sistema OCR'a e cria AP automaticamente | Academia, Fisio, Nutri | 15 | todo |
| **Handler WhatsApp: exame laboratorial** | Paciente manda PDF do exame; pipeline completo OCR → IA → revisão → histórico com notificação de status | Academia, Fisio, Nutri | 35 | futuro |
| Integração email (Resend) | Canal alternativo/redundante consolidado | Academia, Fisio, Nutri | 13 | todo |
| Régua de cobrança (DSL) | Motor declarativo: evento → ação → delay (cobrança, reengajamento, follow-up lead) | Academia, Fisio, Nutri | 13 | todo |
| Opt-out e rate-limit | Consent de marketing + limite por tenant | Academia, Fisio, Nutri | 13 | todo |
| Custos operacionais | `cost_categories` (fixos/variáveis) + `cost_entries` + recorrências | Academia, Fisio, Nutri | 14 | todo |
| DRE consolidado | Receita - custos por período/company/tenant + export PDF/CSV | Academia, Fisio, Nutri | 14 | todo |
| Previsibilidade de receita | Projeção 3 meses + simulador de sensibilidade | Academia, Fisio, Nutri | 14 | todo |
| **Plano de contas contábil** | Hierárquico (ativo/passivo/receita/despesa) + seed brasileiro | Academia, Fisio, Nutri | 15 | todo |
| **Cadastro de fornecedores** | PF/PJ com histórico de compras/pagamentos | Academia, Fisio, Nutri | 15 | todo |
| **Contas a pagar (AP)** | Workflow multi-aprovador configurável + status draft→paid→reconciled | Academia, Fisio, Nutri | 15 | todo |
| **Contas a receber avulso (AR)** | Separado dos contratos do Sprint 04; gera boleto/PIX via Asaas | Academia, Fisio, Nutri | 15 | todo |
| **OCR de boleto (provider abstrato)** | Upload PDF/imagem → OCR → parser linha digitável FEBRABAN → preenche AP. Default OCR.space; admin escolhe entre OCR.space / Google Vision / AWS Textract / Azure / Tesseract via `/app/settings/financeiro/ocr` | Academia, Fisio, Nutri | 15 | todo |
| **Config de provider OCR por tenant** | UI onde admin cola API key, escolhe fallback, testa com boleto exemplo | Academia, Fisio, Nutri | 15 | todo |
| **Upload XML NF-e (entrada)** | Parser de nota recebida → cria fornecedor + AP automaticamente | Academia, Fisio, Nutri | 15 | todo |
| **Inbox unificada de NF-e (ADR 0056)** | Tela central `/app/financeiro/nfe` com 4 métodos de ingestão: download automático SEFAZ (Sprint 17), download por chave 44 dígitos (Sprint 17), upload XML (Sprint 15), entrada manual sem NF (Sprint 15). `nfe_received` com badge de origem por linha. Toggle único em settings para ligar/desligar o automático | Academia, Fisio, Nutri | 15 (inbox + manual + upload) + 17 (pluga automático + por chave) | todo |
| **Download por chave NF-e** | Operador cola 44 dígitos → provider (Arquivei/Sieg/Focus/SEFAZ direto com cert A1) busca XML; registrado em `nfe_received` com `source='manual_key'` | Academia, Fisio, Nutri | 17 | futuro |
| **Manifestação do Destinatário NF-e (ADR 0057)** | 4 eventos SEFAZ (Ciência 210210, Confirmação 210200, Desconhecimento 210220, Não Realizada 210240) integrados à inbox. **Ciência automática ON por padrão** (tenant pequeno tem conformidade sem configurar); demais eventos sempre manuais com audit. Gate por CNPJ (tenant PF sem company.cnpj não vê). Prazo 180d + alertas D-30/D-7; job de expiração | Academia, Fisio, Nutri (só company com CNPJ) | 15 (schema) + 17 (UI + envio + jobs) | todo |
| **Devolução de compra NF-e (ADR 0058)** | Registro interno `nfe_returns` linkado à NF original + PDF de controle para levar ao contador + import do XML da NF-e de devolução emitida externamente. Camada 2 (emissão direta via Focus NFe) vem no Sprint 36. Integra com estoque (baixa) e financeiro (estorna AP ou cria AR) | Academia, Fisio, Nutri | 15 (schema) + 17 (UI + reconciler) + 36 (emissão automática) | todo |
| **Recepção NF-e avançada — NFs relacionadas (ADR 0060)** | Parser extrai `finNFe` + CFOP + `refNFe` → link automático entre NFs relacionadas (devolução de venda recebida, complementar recebida, ajuste, NF-e de entrada própria). Badges contextuais na inbox + filtro por tipo + job de resolução retroativa de links órfãos | Academia, Fisio, Nutri (company com CNPJ) | 15 (schema + parser) + 17 (UI + jobs) | todo |
| **Workflow de aprovação AP** | Regras configuráveis por faixa de valor + multi-aprovadores + audit | Academia, Fisio, Nutri | 15 | todo |
| **Rateio entre filiais** | `allocation_rules` (fixed/proporcional/por KPI) + recálculo de DRE | Academia, Fisio, Nutri (só `owned`) | 16 | todo |
| **Intercompany** | Lançamentos espelhados entre companies + fechamento mensal de saldos | Academia, Fisio, Nutri (só `owned`) | 16 | todo |
| **Contas bancárias + Open Finance** | Pluggy/Belvo + fallback OFX; sync diária de extratos | Academia, Fisio, Nutri | 17 | todo |
| **Conciliação bancária** | `reconciliation_rules` + match automático AP/AR ↔ extrato | Academia, Fisio, Nutri | 17 | todo |
| **Projeção de fluxo de caixa** | Saldo atual + AP/AR futuras → saldo projetado 30/60/90 dias | Academia, Fisio, Nutri | 17 | todo |
| **Recepção NF-e automática (SEFAZ)** | Via provider (Arquivei/Sieg) com certificado A1 por company | Academia, Fisio, Nutri | 17 | todo |
| **Gestão de certificado digital A1** | Upload/rotação por company criptografado + alerta expiração | Academia, Fisio, Nutri | 17 | todo |
| **Adquirência (maquininha)** | Cielo, Stone, Rede, GetNet, PagSeguro — API de vendas e conciliação | Academia, Fisio, Nutri | 18 | todo |
| **Antecipação de recebíveis** | Solicita antecipação de vendas maquininha via API do adquirente | Academia, Fisio, Nutri | 18 | todo |
| **Split de franquia adquirência** | Consome `franchise_agreements` para split automático de venda presencial | Academia, Fisio, Nutri (franchise) | 18 | todo |
| **Receita unificada (online + presencial)** | Dashboard com Asaas (online) + Maquininhas (presencial) + taxas reais | Academia, Fisio, Nutri | 18 | todo |
| Pipeline de features de churn | Extração por member de `domain_events` (frequência, pagamento, engajamento) | Academia, Fisio, Nutri | 19 | todo |
| Modelo preditivo de churn | `prob_30d/60d/90d` + top factors + modelo via ADR 0040 | Academia, Fisio, Nutri | 19 | todo |
| Intervenções de retenção | `churn_interventions` + integração com régua de cobrança para ação automática | Academia, Fisio, Nutri | 19 | todo |
| Feedback loop de cancelamento | `churn_events` alimenta retreino + mede accuracy | Academia, Fisio, Nutri | 19 | todo |

---

## Academia

| Módulo | Descrição | Verticais | Sprint | Status |
|---|---|---|---|---|
| Modalidades de Academia | Musculação, aula coletiva, personal — extensão de `resources`/`slots` | Academia | 03 (embutido) | todo |
| QR code do aluno + HMAC rotativo | Token rotativo 60s para check-in; antifraude contra screenshot | Academia | 08 | todo |
| Catraca + Realtime | Hardware + canal `tenant:X:unit:Y:access` para UI recepção ao vivo | Academia | 08 | todo |
| Check-in/out (`access_events`) | Append-only de passagens na catraca | Academia | 08 | todo |
| Bloqueio por inadimplência (`access_blocks`) | Bloqueia QR quando contrato está em atraso X dias | Academia | 08 | todo |

**Fora do MVP (mapeado):** offline-first da catraca — check-in local grava e sincroniza depois. Vira sprint na Fase 2 se requisito duro aparecer.

---

## Personal Training

> Vertical canônica (regra 27, ADR 0077). Atende profissional autônomo (CONFEF/CREF) ou personal contratado por academia. Sobreposição grande com Academia — diferencia na granularidade de prescrição (1:1, periodização) e modelo comercial (sessão avulsa vs mensalidade).

| Módulo | Descrição | Verticais | Sprint | Status |
|---|---|---|---|---|
| Sessão personal 1:1 | Reserva exclusiva profissional↔aluno em `slots` com tipo `personal_session`; cobrança por sessão ou pacote | Personal | 03 + 04 | todo |
| Periodização de treino | Mesociclo/microciclo em `workout_plans` com progressão de carga e volume; templates por objetivo (hipertrofia/emagrecimento/funcional) | Personal + Academia | 09 | todo |
| Prescrição via WhatsApp | Envio de plano + vídeos via webhook outbound (regra 25 + Sprint 13); paciente confirma execução | Personal + Academia + Fisio | 13 | todo |
| Onboarding com PAR-Q + anamnese | Questionário de prontidão obrigatório antes de prescrição; gate em feature flag para liberar treinos | Personal | 08 | todo |
| Plano Solo / Solo Combo (ADR 0069) | UX simplificada `tenants.mode='solo'` para personal autônomo (templates por profissão, sem multi-empresa) | Personal | 01a | todo |

---

## Pilates

> Vertical canônica (regra 27, ADR 0077). Modelo de turma reduzida (3-6 alunos), agendamento por aparelho (reformer/cadillac/chair), progressão por exercício e nível. Pode rodar standalone ou anexo a Academia/Fisio.

| Módulo | Descrição | Verticais | Sprint | Status |
|---|---|---|---|---|
| Turmas reduzidas + agendamento por aparelho | `slots` com capacidade 3-6 + `resources` por aparelho; conflito de aparelho bloqueia booking | Pilates | 03 | todo |
| Progressão por exercício e nível | Catálogo `pilates_exercises` (Mat, Reformer, Cadillac, Chair, Barrel) com nível básico/intermediário/avançado; tracking de evolução por aluno | Pilates | 09 | futuro |
| Avaliação postural inicial | Template específico em `assessment_types` com fotos pré/pós + observações de desbalanço | Pilates + Fisio | 12 | futuro |
| Pacotes mensais com aulas/semana | Plano comercial limita N aulas/semana via `member_quota`; consumo cai a cada check-in | Pilates | 04 | todo |

---

## Fisio (Fase 2 — alto-nível)

| Módulo | Descrição | Verticais | Sprint | Status |
|---|---|---|---|---|
| Prontuário eletrônico COFFITO | Consultas versionadas; draft/signed/archived | Fisio | 16 | futuro |
| Catálogo CID-11 + CIF | Global + vinculação com consulta (M:N) | Fisio | 16 | futuro |
| Assinatura digital ICP-Brasil | Provider A1/A3; hash rastreável | Fisio | 16 | futuro |
| Templates de avaliação por especialidade | Ortopedia/neuro/respiratória via `assessment_types` | Fisio | 16 | futuro |
| Nota corretiva | Correção de prontuário assinado sem deletar | Fisio | 16 | futuro |
| Evolução por sessão SOAP | Registro rápido + free text | Fisio | 17 | futuro |
| Anexos categorizados de evolução | Exame imagem / vídeo execução / documento / foto postural | Fisio | 17 | futuro |
| URL assinada curta | Mídia clínica com TTL 10min | Fisio | 17 | futuro |
| Convênios e planos de saúde | Cadastro de operadoras + acordos + tabela TUSS | Fisio | 18 | futuro |
| Carteirinha do paciente | `member_insurances` com validade | Fisio | 18 | futuro |
| Autorização de procedimento | Solicitação + acompanhamento de aprovação | Fisio | 18 | futuro |
| Guias TISS (consulta + SP/SADT) | XML ANS v3.05+ individual e em lote | Fisio | 18 | futuro |
| Conciliação de retorno TISS | Parser XML + pagamento + glosa | Fisio | 18 | futuro |
| Controle de glosas | Motivo + recurso manual + resolução | Fisio | 18 | futuro |
| Contratos profissionais | Condições de comissão por tipo + overrides | Geral (Fisio/Academia/Nutri) | 19 | futuro |
| Cálculo automático de comissão | Consome eventos financeiros + clínicos | Geral | 19 | futuro |
| Fechamento mensal de comissões | Period aprovado + transferência Asaas | Geral | 19 | futuro |
| Estoque (descartáveis + revenda) | `stock_items` + movimentações + saldo | Geral (Fisio inicial) | 20 | futuro |
| POS simples | Venda no balcão gera invoice | Geral | 20 | futuro |
| Inventário | Contagem física com ajustes | Geral | 20 | futuro |
| Equipamentos regulados ANVISA | Cadastro + cronograma manutenção/calibração + certificados | Fisio (Academia futuro) | 21 | futuro |
| Logs de limpeza de ambiente | Checklist por sala + timestamp | Fisio | 21 | futuro |
| Integração CNES | Cadastro do estabelecimento + validação | Fisio | 21 | futuro |
| Relatório fiscalização vigilância | Export PDF equipamentos + limpeza | Fisio | 21 | futuro |
| Portal do paciente web (PWA) | Self-service: agenda, pagamento, vídeos, QR, prontuário resumido | Academia, Fisio, Nutri | 22 | futuro |
| Auth magic link do member | Separado do operador; TTL 15min | Academia, Fisio, Nutri | 22 | futuro |
| Cross-alert lesão → treino | Consumidor `consulta.signed` com CID; adapta workout | Fisio + Academia | 23 | futuro |
| Mapeamento CID → contraindicações | Catálogo `cid_exercise_contraindications` curado | Fisio + Academia | 23 | futuro |
| Adaptação sugerida de workout | Diff de exercícios com review do instrutor | Fisio + Academia | 23 | futuro |
| Generative UI (framework) | Registro de componentes; tool calls streamadas | Geral (começa Fisio) | 24 | futuro |
| Componentes clínicos Fisio | PatientCard, EvolutionChart, CidSuggestion, ReportSection | Fisio | 24 | futuro |

---

## Nutri (Fase 3 — alto-nível)

| Módulo | Descrição | Verticais | Sprint | Status |
|---|---|---|---|---|
| Banco de alimentos nacional (TACO) | ~3000 alimentos com 30+ nutrientes + medidas caseiras + equivalências calóricas | Nutri | 29 | futuro |
| Alimentos customizados por tenant | Preparações/receitas locais com nutrientes calculados | Nutri | 29 | futuro |
| Plano alimentar interativo | Editor drag-drop com cálculo tempo real (kcal/macros/micros) + lista de substituição automática | Nutri | 29 | futuro |
| Export PDF com branding do tenant | Logo, cores, assinatura do profissional no plano | Nutri (aproveita todas) | 29 | futuro |
| Catálogo de suplementos | Vitaminas/minerais/fitoterápicos com posologia e interações | Nutri | 30 | futuro |
| Prescrição de suplementação | Dose + frequência + duração + interações medicamentosas | Nutri | 30 | futuro |
| Catálogo de analitos laboratoriais | Valores de referência por sexo/idade/condição | Nutri | 30 | futuro |
| Registro e análise de exames | Laudo PDF + cálculo de fora-da-faixa + gráficos de evolução | Nutri | 30 | futuro |
| Diário alimentar do paciente | Registro por refeição com foto + cálculo de desvio vs plano | Nutri | 31 | futuro |
| Validação do diário pela nutri | Aprovar/comentar/sinalizar + relatório semanal | Nutri | 31 | futuro |
| Teleconsulta | Vídeo integrado com provider abstrato (ADR 0083 — esperado) + gravação opt-in + transcrição stretch | Academia, Fisio, Nutri | 31 | futuro |
| Nutri-Agent (IA) | Agente IA cruzando log de Academia + prontuário Fisio + diário alimentar + antropometria (sempre com consent ativo) | Nutri | 34 | futuro |

---

## Emissão Fiscal (Sprint 36 — via Focus NFe, ADR 0059)

Ciclo fiscal completo de emissão de documentos via **Focus NFe** como provider único. LogiFit não toca em motor tributário — Focus cuida de ICMS/IPI/PIS/COFINS/CST/CFOP/ISS por UF/município.

| Módulo | Descrição | Verticais | Sprint | Status |
|---|---|---|---|---|
| **Inbox de emissões `/app/fiscal`** | Tela central de emissões + 3 ações de evento (cancelar, CC-e, inutilizar) + reconciliação com webhook callbacks | Academia, Fisio, Nutri | 36 | futuro |
| **NFS-e (serviço municipal)** | Emissão automática a partir de `invoices` (Sprint 04) e `billing_guides` pagos (Sprint 22). Base do negócio saúde | Academia, Fisio, Nutri | 36 | futuro |
| **NF-e produto (modelo 55)** | Emissão de venda de mercadoria (suplemento, órtese) identificando cliente PJ | Academia, Fisio (com revenda) | 36 | futuro |
| **NFC-e (modelo 65, varejo)** | Emissão automática em POS balcão sem identificação | Academia (revenda), Fisio (revenda) | 36 | futuro |
| **NF-e devolução (`finNFe=4`)** | Camada 2 da ADR 0058 — a partir de `nfe_returns`, emissão direta via Focus | Academia, Fisio, Nutri | 36 | futuro |
| **NF-e transferência entre filiais** | Emissão obrigatória quando movimentação de bens cruza CNPJs distintos (Sprint 16 intercompany detecta) | Academia, Fisio, Nutri (redes owned) | 36 | futuro |
| **NF-e remessa/retorno conserto** | Equipamento sai para calibração/conserto externo (Sprint 25); NF 5.915 na saída, 1.916 no retorno | Fisio, Academia (equipamento regulado) | 36 | futuro |
| **NF-e de entrada própria** | Tenant emite NF-e contra si mesmo quando compra de PF/produtor rural sem inscrição; popula `nfe_received` via ADR 0060 | Academia, Fisio, Nutri | 36 | futuro |
| **Cancelamento / CC-e / Inutilização** | 3 eventos pós-emissão (cancelar dentro da janela, corrigir campos não-fiscais, inutilizar numeração pulada) | Academia, Fisio, Nutri | 36 | futuro |
| **Catálogo de serviços tributáveis** | `fiscal_service_catalog` configurado por company: código LC 116/2003, alíquota ISS do município, retenções, regime tributário | Academia, Fisio, Nutri | 36 | futuro |
| **Wizard de onboarding fiscal** | `/app/settings/fiscal` — credenciais Focus + regime + catálogo + série/numeração + teste em homologação | Academia, Fisio, Nutri | 36 | futuro |
| **Motor de retenções tributárias (ADR 0061)** | `tax_natures` (10 globais + custom tenant) + `tax_retentions` (PIS/COFINS/CSLL/IRRF/INSS/ISS); calculadora aplicada em AP (Sprint 15) e comissão/RPA (Sprint 23); atualização anual das tabelas IRRF/INSS | Academia, Fisio, Nutri | 15 (schema + AP) + 23 (comissão) | todo |
| **Relatório mensal de retenções** | `/app/fiscal/retencoes` agrupado por tributo + período + company; export PDF/CSV para contador gerar DARF; campo `guide_reference` colável após pagamento | Academia, Fisio, Nutri | 36 | futuro |
| **Portal do contador externo** | Role `contador_externo` (Sprint 01b) + `/app/contador/*` read-only com 8 abas: dashboard, xmls (download massa), ap-ar (CSV/OFX), retenções, **DRE por período/company** (Sprint 14 read-only), **KPIs agregados** (nunca individuais — regra 26), emissões fiscais, certificados A1 (visualização); MFA obrigatório; **nunca vê dado clínico** (LGPD art. 11) | Academia, Fisio, Nutri | 01b (role) + 36 (portal completo) | todo |

---

## Integrações Wellness (Gympass / TotalPass / Wellhub)

Canal de aquisição de alunos via benefícios corporativos. Gympass foi rebrandeado para **Wellhub** em 2024; TotalPass é concorrente direto. Ambos exigem integração via API proprietária para check-in e repasse financeiro.

| Módulo | Descrição | Verticais | Sprint | Status |
|---|---|---|---|---|
| **Provider abstrato de wellness** | Interface `WellnessProvider` com implementações `wellhub` (ex-Gympass), `totalpass`, `classpass` (futuro) | Academia, Fisio | pós-19 | futuro |
| **Check-in via wellness** | Member apresenta QR do app wellness → sistema valida com provider → cria `access_event` marcado com `source='wellhub'` | Academia | pós-19 | futuro |
| **Reconciliação de repasse** | Job mensal puxa relatório do provider e cria lançamento financeiro (com split de taxa) | Academia, Fisio | pós-19 | futuro |
| **Card "Conversão Wellness vs Direto"** | Dashboard compara CAC e ticket médio de lead wellness vs lead direto (preview do card em Sprint 07) | Academia, Fisio | pós-19 | futuro |
| **Cadastro multi-plan por tenant** | Um tenant pode aceitar vários providers simultaneamente; configuração de credenciais por company | Academia, Fisio | pós-19 | futuro |

---

## Módulos transversais além do MVP

| Módulo | Descrição | Verticais | Sprint | Status |
|---|---|---|---|---|
| App nativo Expo | Aluno/paciente mobile; PWA (Sprint 26) cobre 90% antes | todas | 35 | futuro |
| Módulo fiscal (Focus NFe) | **Ciclo fiscal completo de emissão** via Focus NFe: NFS-e + NF-e produto + NFC-e varejo + NF-e devolução + NF-e transferência + NF-e remessa/retorno conserto + NF-e entrada própria + eventos (cancelamento, CC-e, inutilização). Ver [ADR 0059](decisions/0059-ciclo-fiscal-emissao-focus-nfe.md) | todas | 36 | futuro |
| **Apuração mensal de receita (Grupo C — ADR 0061 + ADR a alocar ≥0084)** | Consolida receita por regime Simples/Presumido/Real + gera memorial "pré-DAS"/"pré-DARF" | todas | 37 | **futuro (pós-produção)** |
| **Guias oficiais DAS/DARF/DAM (Grupo D — ADR a alocar ≥0084)** | Integração PGDAS-D + geração DARF com código de receita + opcional integração Contabilizei/Conube/Omie/Alterdata | todas | 38 | **futuro (pós-produção)** |
| **Obrigações acessórias SPED/ECD/ECF (Grupo E — ADR a alocar ≥0084)** | SPED Fiscal + Contribuições + ECD + ECF + DCTF-Web + PGDAS-D + DEFIS + DIRF; avaliar make vs buy | todas | 39 | **futuro (avaliar)** |
| **Folha CLT + eSocial (Grupo F — ADR a alocar ≥0084)** | Folha completa (salário, horas, DSR, férias, 13º, rescisão) + INSS patronal + FGTS + IRRF folha + eventos eSocial S-1000 a S-5013; avaliar integração TOTVS/Senior/ADP vs motor próprio | todas | 40 | **futuro (avaliar)** |
| Prescrição adaptativa IA por RPE | Consome `workout_sessions.rpe` do Sprint 11 + ajusta carga automaticamente | Academia | pós-35 | futuro (depende de app nativo) |

---

## Dashboard do member — modelo de visibilidade de widgets

A home `/app/members/[id]` é um **grid de widgets** contribuídos por cada sprint. Cada widget é registrado com metadados e o componente `<MemberWidgetSlot />` filtra por 3 gates antes de renderizar:

```ts
registerMemberWidget({
  slot: 'financeiro',
  component: FinanceiroWidget,
  requiredPermissions: ['financeiro.read'],  // role gate via RBAC (camada 3)
  requiredVertical: null,                    // vertical gate; null = qualquer
  consentPurpose: null,                      // consent gate (camada 4); null = não precisa
  showWhen: (member) => boolean,             // presença: só renderiza se condição é true (ex: tem dado)
})
```

### As 3 gates

1. **Role gate** — `requiredPermissions` bate contra os `scopes[]` do JWT. Se o user não tem a permission, widget some.
2. **Vertical gate** — `requiredVertical` checa se o tenant tem a vertical ativa (ex: `fisio`). Widget de Fisio não aparece em tenant só-Academia.
3. **Presença** — `showWhen(member)` roda query/flag: widget só aparece se faz sentido para este member (ex: widget "prontuário" só se existe ao menos 1 consulta fisio).
4. **Consent gate** — `consentPurpose` exige `consents` ativo do `member` quando o widget é **cross-module** (ex: instrutor Academia vendo lesão Fisio).

### Matriz de visibilidade (MVP + previsão Fase 2/3)

| Widget | Slot | Permission | Vertical | Presença | Consent? | Roles que veem |
|---|---|---|---|---|---|---|
| Dados + timeline resumida | `overview` | `member.read` | — | sempre | não | todos com acesso ao member |
| Agenda do paciente | `agenda` | `agenda.read` | — | member tem `appointments` | não | recepção, gerente, instrutor, fisio, nutri |
| Financeiro do paciente | `financeiro` | `financeiro.read` | — | member tem `contracts` ativo ou histórico | não | recepção, gerente, diretor |
| Copilot (CTA contextual) | `copilot` | `copilot.use` | — | sempre | não | recepção, gerente, fisio, nutri, instrutor |
| Créditos ativos | `creditos` | `member.read` | — | member tem `appointment_credits.balance > 0` | não | recepção, gerente, fisio, nutri, instrutor |
| Acessos (Academia) | `acessos` | `acesso.read` | `academia` | member tem `access_events` | não | recepção, gerente, instrutor |
| Treino atual | `treino` | `prescricao.read` | — | member tem `workout_prescriptions` ativo | não | instrutor, fisio, gerente |
| Última avaliação | `avaliacao` | `avaliacao.read` | — | member tem `assessments` | não para profissional direto; **sim** cross-module | profissional do tipo relevante (Academia/Fisio/Nutri) |
| Conquistas | `conquistas` | `engajamento.read` | — | sempre (mostra progresso mesmo sem earned) | não | recepção, gerente, fisio, nutri, instrutor |
| Metas | `metas` | `engajamento.read` | — | member tem `goals` ativos | não | recepção, gerente, fisio, nutri, instrutor |
| Risco de churn | `risco` | `retencao.read` | — | `last_prediction_prob_30d > 0.3` | não | gerente, diretor (não aluno nem instrutor) |
| Prontuário (Fisio, Sprint 20) | `prontuario` | `prontuario.read` | `fisio` | member tem `consultas` fisio | não para fisio; **sim** para cross-module | fisio (direto), instrutor (se consent `injury_to_training`) |
| Evolução por sessão (Fisio, Sprint 21) | `evolucao` | `prontuario.read` | `fisio` | member tem `evolucoes_sessao` | não | fisio |
| Convênio do paciente (Sprint 22) | `convenio` | `convenios.read` | `fisio` | member tem `member_insurances` | não | recepção fisio, gerente |
| Comissão do profissional (Sprint 23) | `comissao` (tela /app, não em /members/[id]) | `rh.read_own` | — | profissional logado tem `commission_entries` | não | próprio profissional |
| Alerta de lesão (Sprint 27) | `alerta_lesao` | `cross.read` | — | member tem `member_injury_alerts` ativos | sim (consent `share_injury_to_training`) | instrutor, gerente |
| Antropometria (via Sprint 12) | `avaliacao` | `avaliacao.read` | — | member tem `assessments` | não | nutri (direto), fisio/academia (se consent) |
| Plano alimentar (Sprint 29) | `alimentar` | `nutri.read` | `nutri` | member tem `meal_plans` ativo | não para nutri; sim cross-module | nutri |
| Suplementação (Sprint 30) | `suplementos` | `nutri.read` | `nutri` | member tem `supplement_prescriptions` ativas | não | nutri |
| Exames alterados (Sprint 30) | `exames` | `nutri.read` | `nutri` | member tem `lab_results` recentes com `out_of_range` | não | nutri, fisio (se consent) |
| Diário alimentar (Sprint 31) | `diario` | `nutri.read` | `nutri` | member tem `meal_plans` ativo | não | nutri |

### Exceções de role

- **Group_owner** nunca vê widgets individuais do member — permanece em views agregadas do grupo (regra 26). Se entrar em um tenant específico com role explícito, vê conforme role.
- **Aluno/paciente (futuro app)** vê os próprios widgets: `overview`, `agenda` (seus agendamentos), `financeiro` (suas cobranças), `acessos` (seus check-ins).
- **Dado clínico nunca cruza `company_id`** em `topology=franchise` (regra 25) — widget some mesmo com consent quando a regra 25 se aplica.

### Registro dos widgets

- Registro acontece no boot da app (Sprint 02 cria `packages/ui/members/registry.ts`).
- Cada sprint adiciona 1 call `registerMemberWidget(...)` durante seu próprio setup.
- Testes e2e garantem que widget fantasma (sem permission/vertical) não aparece.

---

## Cadastro central de pessoas (`persons`) — modelo Contact-FK

Introduzido pelo [ADR 0047](decisions/0047-cadastro-central-persons.md). Em vez de duplicar campos de identidade (nome, CPF/CNPJ, email, phone, endereço) em `members`, `leads`, `suppliers`, `companies`, `users`, há **uma tabela central `persons`** por tenant e as especializadas ganham FK `person_id`.

**Fluxo padrão de cadastro:**

1. Operador cria a pessoa em `/app/pessoas/new` — sistema detecta PF ou PJ pelo tamanho do documento (11 vs 14 dígitos) e valida dígito verificador.
2. Nas telas especializadas (`/app/settings/users/new`, `/app/members/new`, `/app/financeiro/fornecedores/new`, `/app/settings/empresas/new`, etc.), operador usa `<PersonPicker>` para buscar a pessoa já cadastrada (ou cria uma nova in-line) e preenche apenas os campos específicos daquele papel.
3. Mesma `person_id` pode aparecer em múltiplos papéis (aluna + fornecedora + colaboradora) — cada um como linha própria na tabela especializada, sem duplicar identidade.

**Regras de linkagem:**

| Tabela especializada | `person.kind` aceito | Observação |
|---|---|---|
| `users` | `pf` apenas | Login é sempre pessoa física |
| `companies` | `pj` apenas | Empresa/filial é sempre pessoa jurídica |
| `members` | `pf` ou `pj` | Suporte a cliente corporativo |
| `suppliers` | `pf` ou `pj` | Autônomo ou empresa |
| `leads` | nullable inicialmente | `quick_name`+`quick_phone` cobrem captura rápida; `person_id` obrigatório a partir do estágio `proposta` |
| `professional_contracts` | `pf` apenas | Profissional é pessoa física |
| `professional_registrations` | `pf` apenas | Registro em conselho (CRM/CRN/CREFITO/CREF/...) sempre vinculado a PF (ADR 0055) |
| `units` | — | Local físico, não é pessoa; tem `company_id` FK e endereço próprio |

**Views consolidadas:** `v_members_full`, `v_suppliers_full`, `v_companies_full` fazem JOIN com persons para leituras quentes. `v_person_roles(person_id, roles text[])` lista papéis ativos por pessoa (para UI "esta pessoa é: aluna, fornecedora, usuária").

**Regra 24 preservada e reforçada:** transferência de member entre companies é UPDATE de `members.company_id`; conversão lead→member é INSERT em `members` com mesmo `person_id`. Nunca deleta/recria pessoa.

---

## Convenções

- **Um módulo pertence a uma área dominante**, mesmo que seja usado por outras. Ex: "modalidades de Academia" é área `academia` apesar de ser extensão de módulos `geral`.
- **Módulos cross-vertical ficam em `geral`** (ver [ADR 0003](decisions/0003-escopo-mvp-uma-vertical.md) sobre a decisão de vertical única no MVP + motor cross).
- **Status espelha o sprint alvo** — se o sprint alvo está `todo`, todos os módulos dele estão `todo`. Quando sprint vira `doing`/`done`, os módulos seguem junto.
- **Módulos `futuro`** são speculative — podem ser divididos, renomeados ou absorvidos quando chegar a hora. Este catálogo não é promessa, é mapa.

---

## Referências

- [`roadmap.md`](roadmap.md) — linha do tempo e controle de evolução por sprint
- [`sprints/`](sprints/) — plano executável de cada sprint
- [`arquitetura.md`](arquitetura.md) — stack e camadas
- [`rules.md`](rules.md) — regras que todo módulo respeita
- [`multiempresa.md`](multiempresa.md) — scopes onde cada módulo opera
- [`decisions/`](decisions/) — ADRs citadas aqui
