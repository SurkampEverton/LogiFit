# ADR 0073 — Postura de segurança LogiFit (defesa em profundidade)

- **Status:** Accepted
- **Date:** 2026-04-24

## Context

LogiFit processa dado clínico sensível (LGPD art. 11), dado fiscal (5 anos), prontuário eletrônico (CFM 2.299/2021 — 20 anos), credenciais de pagamento (Asaas), certificados digitais A1 (NF-e) e tokens OAuth de banco (Open Finance). Se um tenant é violado, a empresa-cliente perde licença CRM/COFFITO e LogiFit responde solidariamente. Se LogiFit é violado, todos os tenants caem juntos.

ADRs anteriores cobriram **conformidade** (LGPD art. 11 — 0054, CFM 2.454/2026 — 0053, DPO + governança — 0067) e **isolamento de dados** (RLS regras 1/2, regra 25 franchise). O que **não foi formalizado** é a postura técnica de defesa: como o sistema se protege de ataque ativo (XSS, CSRF, SSRF, brute force, supply chain, file upload malicioso, exfiltração) e o que falha graciosamente quando uma camada é comprometida.

Sem este ADR:
- Site novo nasce sem CSP/HSTS — convite a XSS
- Login sem lockout/captcha — brute force livre
- Upload de exame sem virus scan — paciente sobe PDF malicioso, admin abre, comprometido
- Provider externo sem allowlist — LLM ou usuário força SSRF para metadados de cloud (169.254.169.254)
- Backup nunca testado — sinistro = empresa fechada
- super_admin LogiFit sem auditoria reforçada — risco interno

Defesa em profundidade significa: **assumir que cada camada vai falhar uma vez** e desenhar para que a próxima absorva. RLS pode ter bug → audit captura. Auth pode vazar → MFA bloqueia. CSP pode ter brecha → SameSite cookie bloqueia CSRF. E assim por diante.

## Decision

Adotar **postura de defesa em profundidade** em 7 camadas + 6 regras novas (35-40) + ajustes em sprints + documentos públicos de segurança. **Threat model STRIDE** aplicado em features críticas. **OWASP Top 10 (2021)** como checklist por release.

### Camada 1 — Rede e perímetro

**WAF + DDoS — MVP zero-custo:**
- **Vercel Hobby tier (free)** + **Cloudflare proxy free tier** na frente do domínio: DDoS L3/L4 protection automática (incluído no free), regras WAF customizadas (5 regras free), rate limiting (10k requests free/mês), bot fight mode
- DNS `logifit.com.br` aponta para Cloudflare → Cloudflare → Vercel (proxy laranja)
- Configuração: SSL Full (strict) + Always HTTPS + HSTS via Cloudflare + bot fight mode ativo

**Fase 2:** Vercel Pro ($20-150/mês) quando precisar de preview environments por PR / mais que 100GB bandwidth / SLA / WAF gerenciado. Ou Cloudflare Pro ($20/mês) se WAF avançado virar prioridade antes do Vercel.

**TLS 1.3 obrigatório** — HSTS com `max-age=63072000; includeSubDomains; preload`. Certificado wildcard `*.logifit.com.br` (Let's Encrypt via Vercel auto). Submeter ao [HSTS Preload List](https://hstspreload.org).

**Security headers** (regra 35) — `next.config.ts` define em `headers()`:

```ts
{
  // CSP estrito; conforme cresce o app, hashs/nonces para inline
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'nonce-{nonce}' https://va.vercel-scripts.com",
    "style-src 'self' 'unsafe-inline'", // tailwind exige
    "img-src 'self' data: https://*.supabase.co https://logifit.com.br",
    "connect-src 'self' https://*.supabase.co https://api.openai.com https://generativelanguage.googleapis.com https://api.groq.com https://*.posthog.com https://o*.ingest.sentry.io",
    "frame-ancestors 'none'", // bloqueia clickjacking
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests"
  ].join('; '),
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(self), bluetooth=(self), payment=(self)',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-site'
}
```

**CSP nonce dinâmico via middleware** — Next.js 15 server component injeta nonce no script de hidratação; permite CSP `script-src 'self' 'nonce-X'` sem `unsafe-inline`.

**CORS restritivo** — Server Actions são `same-origin` por design (Next.js 15 valida `Origin`); API Routes públicas explicitamente listam origens. Nenhum `Access-Control-Allow-Origin: *` permitido em endpoint que retorna dado de tenant.

**Subdomain-isolation** — cookies de sessão escopo `.logifit.com.br` com `Domain` explícito + `SameSite=Lax` (Strict quebra OAuth callback) + `Secure` + `HttpOnly`. Cookie de sessão **nunca** acessível via JS.

### Camada 2 — Autenticação e sessão

**MFA obrigatório por role** — `roles.requires_mfa bool` (Sprint 01b já tem). Profissional (médico/fisio/nutri/personal) e admin: obrigatório. Recepcionista: opcional. Member do portal: opcional (TOTP) com nudge.

**Login lockout** (regra 36 cobre rate limit; aqui é específico) — `auth_attempts (email, ip, attempted_at, success bool)` particionada mensal, retenção 30 dias. Após **5 falhas em 15 min** por (email OR ip) → lockout 30 min + alerta `system_alerts` severity=`warning` + email ao titular ("tentaram logar na sua conta"). Captcha (Turnstile/hCaptcha) ativa após 3 falhas.

**Bot protection** — Cloudflare Turnstile (free, sem privacy issues vs reCAPTCHA) em:
- Signup `/signup`
- Login `/login` (após 3 falhas no IP)
- Forgot password `/forgot`
- Trial start (combate farm de contas)

**Session management** — Supabase Auth gera JWT 1h + refresh token 30d. Custom claims (`tenant_id`, `scopes[]`, `mfa`) injetadas via Supabase Edge Function ao login. Página `/meu/sessoes` lista todas as sessões ativas (device, IP, last_seen) com botão **"Encerrar todas as outras"** que invalida refresh tokens (Supabase `auth.signOut({ scope: 'others' })`). Trocar senha invalida todos refresh tokens.

**Account recovery** — magic link Resend + email verificado obrigatório. Senha esquecida com TOTP-recovery-code (gerado no setup, baixado pelo user) ou suporte humano com identidade comprovada.

**Privileged Access Management para super_admin LogiFit** (Camada 7).

### Camada 3 — Aplicação (Server Actions / API Routes)

**`wrapAction()` reforçado** — ADR 0071 já criou. Aqui adiciona steps de segurança:

```ts
// packages/errors/wrap-action.ts (estendido pelo ADR 0073)
export function wrapAction(handler, options) {
  return async (input) => {
    // 1. request_id (ADR 0071)
    // 2. Origin check — bloqueia se não vem do mesmo domínio (CSRF)
    // 3. Rate limit Upstash POR IP + POR user_id (regra 36)
    // 4. Auth + permissions (ADR 0071)
    // 5. Gate IA classe II+ (regra 28)
    // 6. Consent cross-module (regra 6)
    // 7. Zod validate (regra 7)
    // 8. Execute handler
    // 9. Translate error + alert + audit (ADR 0071)
    // 10. Sanitize response (mascara PII se feature flag X)
  }
}
```

**Rate limit por endpoint, IP e user_id** (regra 36) — Upstash Redis com sliding window:

| Endpoint | Limit |
|---|---|
| `/login` | 10 tentativas / 15 min por IP + 5 / 15 min por email |
| Server Actions de leitura | 100 / min por user |
| Server Actions de escrita | 30 / min por user |
| Server Actions de IA | 20 / min por user (sobreposto ao quota IA do ADR 0064) |
| `/api/search` | 30 / min por user (já no Sprint 07) |
| API públicas (webhooks externos) | 60 / min por IP |
| `/signup` | 3 / hora por IP |

Limit excedido → `RATE_LIMITED` (envelope ADR 0071) com `retry_after_ms`.

**CSRF protection** — Next.js 15 valida `Origin === Host` em Server Actions automaticamente. Documentado como **regra dura** para nunca desabilitar. API Routes que aceitam POST/PUT/DELETE e mutam dado exigem header `x-csrf-token` (gerado por session) **ou** `Origin === self` validado via wrapper.

**SSRF protection — `safeFetch()`** (regra 37) — wrapper único em `packages/security/safe-fetch.ts`:

```ts
export async function safeFetch(url: string, opts: SafeFetchOptions): Promise<Response> {
  const parsed = new URL(url);
  // 1. Protocolo: só http/https
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new SsrfError('protocol');
  // 2. Resolver DNS — bloqueia se IP é privado/loopback/link-local
  const ip = await resolveIPv4(parsed.hostname);
  if (isPrivateIp(ip) || isLinkLocal(ip) || isLoopback(ip)) throw new SsrfError('private_ip');
  // 3. Allowlist por domínio (passada pelo caller)
  if (opts.allowedHosts && !opts.allowedHosts.some(h => parsed.hostname.endsWith(h))) {
    throw new SsrfError('host_not_allowed');
  }
  // 4. Tamanho máximo de resposta + timeout
  const timeout = opts.timeoutMs ?? 30000;
  const maxBytes = opts.maxResponseBytes ?? 50 * 1024 * 1024;
  // 5. Não segue redirects sem revalidar (atacante pode redirecionar 302 → 169.254.169.254)
  return fetchWithLimits(url, { ...opts, timeout, maxBytes, redirect: 'manual' });
}
```

**Allowlists por uso:**
- Asaas → `['asaas.com', 'sandbox.asaas.com']`
- Focus NFe → `['focusnfe.com.br']`
- Gemini → `['generativelanguage.googleapis.com']`
- WhatsApp media → `['mmg.whatsapp.net', 'media-*.cdn.whatsapp.net']`
- OCR provider → fechado por adapter
- Open Finance → fechado por adapter (Pluggy/Belvo)
- LLM tool calling **nunca** chama URL arbitrária — proibido por design (regra 32 já reforça via Server Actions tipadas)

**File upload — scan obrigatório** (regra 38):
- Buckets: `lab-documents`, `fisio-evolucoes`, `exam-attachments`, `exercises` (vídeo), `certificados` (cert A1), `whatsapp-media`

**MVP zero-custo (`packages/security/scan-upload.ts` self-contained, ~150 linhas TS):**
- **MIME real validado server-side** com `file-type` (npm, free) — não confia em extensão nem `Content-Type` cliente
- **Magic bytes** correspondem ao MIME declarado (header bytes match table)
- **Extension allowlist por bucket** — `.pdf|.jpg|.png|.heic` em laudo; `.fit|.tcx|.gpx|.csv` em device; `.pfx|.p12` em certificado; `.mp4|.webm` em vídeo
- **Size cap por bucket** (≤20MB exame · ≤50MB padrão · ≤200MB vídeo)
- **Embed detection** (próprio, free):
  - PDF: parser `pdf-parse` ou regex em raw — bloqueia `/JavaScript`, `/JS`, `/AA`, `/OpenAction`, `/Launch`, `/EmbeddedFile`
  - Office: regex em raw — bloqueia `vbaProject.bin`, `macros/` em zipped Office
  - Imagens: bloqueia EXIF com payload anômalo (>10KB EXIF é flag); bloqueia polyglot (PDF dentro de JPG via magic bytes mismatch)
- **Hash SHA256** do arquivo + lookup em `known_malicious_hashes` (lista pequena seedada de samples conhecidos via VirusShare API free, atualizada manualmente quando relevante; opcional)
- Resultado em `upload_scans (id, tenant_id, storage_path, status enum 'pending'|'clean'|'suspicious'|'rejected'|'error', detection_reason text nullable, scanned_at)`; arquivo só vira `published` após `status='clean'`
- Falha no scan → arquivo deletado + `system_alerts` severity=`error`

**Fase 2 (1º cliente Enterprise / clínica médico-hospitalar pagando):**
- ClamAV self-hosted Fly.io (R$ 30/mês) ou api.cloudmersive.com (~R$ 200/mês) substituem o scan próprio
- Adapter pattern em `packages/security/scan-upload.ts` permite trocar sem refactor de quem usa
- Decisão de upgrade gatilhada por: tenant Enterprise contratado OU 1º incidente real OU regulação adicional

**Output encoding** — React escapa por padrão; nunca `dangerouslySetInnerHTML` exceto com sanitizer (`DOMPurify`) e nonce CSP. Lint custom proíbe sem comentário `// why: sanitized via X`.

**SQL injection** — mitigado por design via Drizzle (parameterized). Lint proíbe `sql.raw()` sem comentário. Caso clínico: `LIKE` em busca → sempre via `sql\`%${term}%\`` parameterizado, nunca string concat.

### Camada 4 — Dados em repouso e em trânsito

**TLS 1.3** em todo fluxo — Supabase, Vercel, Asaas, Focus NFe, providers IA. Sem fallback para 1.2 nas conexões internas LogiFit (cliente externo legado pode ainda usar 1.2 em webhook entrada).

**Criptografia at-rest dado clínico** — regra 4 já existe; este ADR define **padrão técnico**:
- **AES-256-GCM** para campos sensíveis (prontuário `consultas.content`, exame `exam_extractions.raw_text`, mídias)
- **Chave por tenant** derivada via HKDF de `master_key` LogiFit (em Vercel encrypted env) + `tenant_id` salt
- **Cert A1** (NF-e) cifrado com `master_key_certificates` (separada) + senha do cert cifrada com `KEK` (Key Encryption Key) por company
- **Rotação de chave** anual (`master_key_v1`, `master_key_v2`); registros indicam versão (`encryption_key_version int`); rotação re-cifra em background job
- **Cold storage Parquet** (ADR 0072) — cifrado AES-256 com chave separada, rotação anual

**Hash chain no `audit_log`** (regra 39) — cada linha tem `previous_hash text` referenciando hash da linha anterior do mesmo tenant; trigger ao INSERT computa `current_hash = sha256(id || tenant_id || at || actor_user_id || action || sanitized_payload || previous_hash)`. Detecção de adulteração: job semanal verifica continuidade da cadeia; quebra dispara `system_alerts severity=critical category=security`. Cola `previous_hash` em `system_audit_anchor` (timestamp confiável + assinatura LogiFit) a cada 1h — dificulta admin DB adulterar histórico sem deixar rastro.

**Backup + DR** (regra 40):

**MVP zero-custo:**
- **Supabase backup automático** — incluído no plano Supabase (já contratado): daily backup 7 dias (Free) ou 30 dias (Pro quando upgrade)
- **Backup off-site grátis** — `pg_dump` semanal cifrado com **GPG** (chave LogiFit em Vercel encrypted env) enviado para **Cloudflare R2** (free tier 10GB storage + 1M class A ops/mês + outbound free para Cloudflare) **OU** **Backblaze B2** (10GB free + outbound free para Cloudflare) **OU** **GitHub Releases** privado (até 2GB/file, ilimitado em total) — escolher um. Ativar via Vercel Cron weekly. Retenção 12 meses (rotação automática)
- **Storage de mídia** (`lab-documents`, `fisio-evolucoes`) — confiar em Supabase Storage replicação multi-region (já incluído); off-site somente Fase 2
- **RPO** 24h / **RTO** 4h documentados
- **Teste de restauração trimestral** em ambiente isolado (Supabase free instance temporária) — runbook em `runbooks/restore-test.md`; falha = `system_alerts critical` + ADR retroativo
- **Disaster Recovery Plan** público para tenant Enterprise: documento explicando RPO/RTO + sequência de recuperação + comunicação durante incidente

**Fase 2 (com receita):**
- AWS S3 us-east-1 com Object Lock 90 dias (WORM) substitui Cloudflare R2 / Backblaze quando volume > 5GB ou exigência de imutabilidade legal mais forte (R$ 100-300/mês)
- Snapshot extra de `lab-documents` + `fisio-evolucoes` para off-site (se tenant Enterprise exigir contratualmente)
- Supabase Pro tier (backup 30d + PITR 7d) quando produção crítica

### Camada 5 — IA (entrada e saída)

**PII redaction antes do LLM** — `redactBeforeLLM(text)` em `packages/ai/security/redact.ts`:
- Mascara CPF (`***.***.***-XX`), CNPJ, RG, email (mantém domínio), telefone, endereço completo, número de cartão, chave PIX
- Aplicado em `buildSystemPrompt()` antes de enviar `ragChunks` ao provider
- Member name/birth_date/diagnóstico **podem** ir (necessários para resposta clínica) **somente se** a feature passou por gate consent + DPA com provider IA assinado (ADR 0064)
- Tenant pode optar por redação total via `tenant_ai_settings.aggressive_redaction=true` (Enterprise)

**Output sanitizer (regra 28 já existe)** — classificador clínico bloqueia "diagnóstico", "tem [doença]", "prescrever". Aqui adiciona:
- Classificador anti-prompt-injection — detecta tentativa de override ("ignore previous instructions") e marca `ai_audit_log.injection_detected=true`
- Output que repete grandes trechos do system prompt (vazamento) é bloqueado + alerta

**Tool calling = Server Action tipada** (regra 32 já existe) — proibido LLM emitir SQL, fetch arbitrário, comando shell. Cada tool é função TS com Zod schema declarado.

**Quota e abuse detection** — ADR 0064 já define quota mensal. Adiciona detecção de abuso: tenant com 10x consumo médio em 24h dispara investigação manual + soft-block até admin aprovar.

### Camada 6 — Operacional (deploy, segredos, dependências)

**Secret management:**
- **Vercel encrypted env** para LogiFit-level (`MASTER_KEY`, `RESEND_API_KEY`, `ASAAS_API_KEY`, `OPENAI_API_KEY` etc)
- **Supabase Vault** (extensão `vault`) para tenant-level secrets (BYOK IA, Asaas próprio do tenant em multi-merchant Fase 2, certificado A1 do tenant)
- **Rotação anual** documentada em `runbooks/rotate-secrets.md`; chave comprometida → rotação imediata + audit
- **Pre-commit hook + CI** — Gitleaks roda em todo commit/PR; CI **fail** se detecta padrão de secret. Configuração custom para padrões LogiFit (LF_KEY_*, padrão de chave Supabase)
- **Variável vazada** = revogação imediata + ADR retroativo + notificação ANPD se PII envolvida

**Dependency security:**
- **Dependabot** (já vem com GitHub free) atualiza `package.json` automaticamente; PR auto criado; merge manual após CI verde
- **OSV-scanner** (Google) em CI a cada PR — bloqueia merge se vulnerabilidade `severity >= high` em deps de produção; `severity = moderate` cria issue mas não bloqueia
- **Snyk** ou **Trivy** opcional Fase 2 (custo R$ 100-300/mês)
- **SBOM** (Software Bill of Materials) gerado por release em CycloneDX format — `pnpm sbom:generate` script + commit em `sboms/v{version}.json`
- **Lockfile audit** — `pnpm audit --audit-level=high` em CI; reproducible build com `pnpm install --frozen-lockfile`
- **Pacotes pinados por hash** — Fase 2 quando ataques de supply chain forem mais comuns

**CI/CD security:**
- GitHub Actions com `permissions: read-all` por default + escrita explícita por job
- Ações de terceiros pinadas por SHA, não por tag (`uses: actions/checkout@a1b2c3...` em vez de `@v4`)
- Branch `main` protegida (regra 10) — sem force push
- Deploy production exige aprovação manual no Vercel (Fase 2 quando time crescer)

**Logging seguro:**
- `sanitizeForAlert()` (ADR 0071) **estende para todos os logs** — Logtail/Axiom/Sentry recebem só payload sanitizado
- Logs de Server Actions com PII só em `audit_log` (cifrado at-rest, RLS)
- Stack traces em Sentry filtram source maps para não vazar caminho server-side
- **Retenção de logs** por compliance: 5 anos audit, 1 ano observability (Logtail/Sentry)

### Camada 7 — Privileged Access Management (super_admin LogiFit)

**Problema:** super_admin LogiFit (Sprint 07 `/app/super-admin/database`) tem acesso cross-tenant. Risco insider muito alto.

**Decisão MVP:**
- **JIT (Just-In-Time) access** — super_admin precisa **abrir sessão privilegiada** para acessar `/app/super-admin/*`; sessão dura 4h e exige **MFA recente** (<5 min); registro em `privileged_sessions (admin_user_id, started_at, ended_at, justification text, target_scope)`
- **Justificativa obrigatória** ao abrir — texto livre ≥20 chars (para que/qual incidente)
- **Audit reforçado** — toda query/mutação durante sessão privilegiada grava em `privileged_audit_log` com snapshot do antes/depois
- **Alerta automático** ao abrir sessão privilegiada — email para `security@logifit.com.br` + Telegram (canal só fundador) — se você abre sem se lembrar = comprometido
- **Monitoramento de comportamento** — query massiva (>10k linhas) em sessão privilegiada → alerta extra
- **Sem acesso direto ao Postgres em produção** — só via interface LogiFit; conexão direta pgAdmin/psql exige BREAK-GLASS procedure (chave em cofre físico, audit imutável)

**Fase 2 (10+ tenants pagantes):**
- 4-eyes principle — operação destrutiva (drop tenant, restore backup) exige aprovação de 2º admin
- VPN dedicada para acesso DB direto
- Câmera de segurança gravando estação de trabalho (clientes Enterprise exigem)

### Threat model STRIDE — features críticas

Aplicação obrigatória do STRIDE em **5 features críticas** durante seu sprint, registrado em `docs/threat-models/`:

| Feature | Sprint | Spoofing | Tampering | Repudiation | Information Disclosure | DoS | Elevation of Privilege |
|---|---|---|---|---|---|---|---|
| Login + sessão | 01a | Bot/credential stuffing → captcha+lockout | JWT replay → short TTL+refresh rotation | Login sem MFA → MFA gate | Brute force enumera users → resposta time-constant | Login flood → rate limit | Privilege creep → role review trimestral |
| Pagamento Asaas | 04 | Webhook spoof → assinatura HMAC | Valor adulterado → reconciliação Asaas-side | Cliente nega cobrança → audit + recibo | Token Asaas vazado → Vault | Webhook flood → idempotency + rate | Member edita próprio invoice → RLS |
| Prontuário | 20 | Outro user assina → ICP-Brasil + cert | Edição pós-assinatura → trigger DENY + nota corretiva | Profissional nega autoria → ICP timestamp | Vazamento via search → required_permission | Bulk read → rate limit + alert | Recepção lê prontuário → RBAC scope |
| Pipeline exames | 33 | Upload paciente errado → consent | Valor analito alterado → audit + dual-review futuro | Profissional nega assinatura → ICP | Exame sensível visto sem permission → audit + cor diferente UI | Upload massa → rate + size cap | Member acessa exame de outro → RLS |
| WhatsApp inbound | 13 | Spoof número → 2FA opt-in member | Mensagem editada → store-once+hash | Paciente nega envio → store original Twilio | Mensagem com PII em log → sanitize | Flood → rate por número | Anexo malicioso → virus scan |

**Outros features**: STRIDE leve (lista de mitigações no commit checklist) suficiente.

### OWASP Top 10 (2021) — checklist por release

| OWASP | Mitigação LogiFit | Onde |
|---|---|---|
| A01 Broken Access Control | RLS + RBAC scope + consent + permission + audit | regras 1-2, 6, 25, 28-30 |
| A02 Cryptographic Failures | TLS 1.3 + AES-256-GCM at-rest + KEK por tenant + rotação anual | regra 4, ADR 0073 camada 4 |
| A03 Injection | Drizzle parameterized + Zod boundary + sql.raw lint | regra 7 |
| A04 Insecure Design | Threat model STRIDE em features críticas + ADR obrigatório | regra 13 |
| A05 Security Misconfiguration | Security headers (regra 35) + secret scanning + Dependabot | regra 35, ADR 0073 camada 6 |
| A06 Vulnerable Components | OSV-scanner CI + SBOM + audit lockfile | ADR 0073 camada 6 |
| A07 Identification & Auth Failures | MFA + lockout + bot protection + session mgmt | ADR 0073 camada 2 |
| A08 Software & Data Integrity | Hash chain audit_log + cert A1 + ICP-Brasil prontuário | regras 5, 39 |
| A09 Logging & Monitoring | system_alerts + Sentry + sanitização + retenção | ADR 0071 + 0073 |
| A10 SSRF | safeFetch + allowlist + IP privado bloqueado | regra 37 |

Checklist passa em CI antes de release: `scripts/owasp-check.ts` confirma cada item está enforced.

### Documentos públicos de segurança

**`/.well-known/security.txt`** — RFC 9116:
```
Contact: mailto:security@logifit.com.br
Contact: https://logifit.com.br/seguranca
Expires: 2027-04-24T00:00:00Z
Encryption: https://logifit.com.br/.well-known/security-pgp.asc
Acknowledgments: https://logifit.com.br/seguranca/agradecimentos
Preferred-Languages: pt-BR, en
Canonical: https://logifit.com.br/.well-known/security.txt
Policy: https://logifit.com.br/seguranca/politica-divulgacao
```

**Página `/seguranca`** (público, sem login):
- Postura de segurança (resumo deste ADR para humanos)
- Política de divulgação responsável (90 dias coordinated disclosure, recompensa simbólica para reports válidos)
- Hall da fama de pesquisadores
- Status page (uptime, incidentes recentes) — Better Stack ou Cronitor (R$ 30-50/mês)

**Email `security@logifit.com.br`** — separado de `privacidade@` (LGPD); recebe relatórios de vuln; SLA: ack em 48h, triage em 7 dias, fix conforme severity (critical 7d, high 30d, medium 90d).

**`/security` para tenant** (autenticado):
- Lista de sub-processors atualizada (ADR 0067 já tem)
- Última auditoria de segurança (link para sumário; relatório completo sob NDA)
- DPA (Data Processing Agreement) versão vigente

### Pentest e auditoria

**Cadência:**

**MVP zero-custo:**
- **Auditoria interna trimestral** — fundador (+ jurídico se necessário em consulta pontual) revisa ADR 0067/0073, checa regras CI, simula incidente (tabletop em papel — 2h por trimestre)
- **OWASP ZAP automated scan weekly** em GitHub Action — `zaproxy/action-baseline@v0.10.0` rodando contra ambiente de staging; resultado em SARIF anexado ao Security tab do GitHub; alerts ≥medium criam issue automaticamente. Free, open source.
- **Bug bounty informal SEM recompensa monetária** — Hall da Fama (página `/seguranca/agradecimentos`) com nome do pesquisador + descrição genérica do bug. Política de divulgação responsável 90 dias.
- **Pentest "amigo"** opcional — peer review com outro dev (troca de favor, sem custo)

**Fase 2 (com receita / 1º cliente clínico médico-hospitalar):**
- Pentest externo anual (Tempest, Conviso, ou freelancer OSCP) — R$ 8-15k
- Bug bounty com recompensa simbólica (R$ 200-2k regular, R$ 5-10k critical)
- Pentest após mudança arquitetural grande

**Fase 3 (Enterprise/hospital):**
- + auditoria SOC 2 Type 2 (R$ 80-150k anual)
- Pentest semestral (R$ 20-40k anual)

### Compliance roadmap

| Norma | Status | Quando |
|---|---|---|
| **LGPD** | ADR 0054 + 0067 + RIPD por módulo | MVP |
| **CFM 2.454/2026 + 2.299/2021** | ADR 0053 + Sprint 20 | MVP / Fase 2 |
| **COFFITO 415/2012, CFN 599/2018** | ADR 0055 + Sprint 20 | Fase 2 |
| **ANVISA RDC 657/751** | LogiFit evita SaMD III por design | MVP |
| **TISS 4.01** | Sprint 22 | Fase 2 |
| **ISO 27001** | Avaliar Fase 2 (10+ tenants) | Fase 2-3 |
| **SOC 2 Type 1 → Type 2** | Fase 3 (hospital/Enterprise) | Fase 3 |
| **HIPAA** (mercado US) | Não MVP — fora de escopo | Fase 4 (se internacionalizar) |

ISO 27001 + SOC 2 não são exigidos legalmente no Brasil para SaaS clínico, mas hospital privado grande começa a exigir em 2027-2028. Mapear como **objetivo Fase 2** (não bloqueia MVP).

## Consequences

### Positivas

- **Postura de segurança defensável** — em auditoria de tenant, há resposta documentada para "como vocês previnem X"
- **Reduz superfície de ataque** drasticamente — CSP bloqueia 90% de XSS, HSTS impede downgrade, lockout impede brute force, virus scan impede malware via upload
- **Compliance LGPD-ANPD** mais robusta — "técnicas de anonimização e pseudonimização adequadas" (art. 6 IX) ficam evidentes
- **Regras 35-40** automatizam checks em CI — não esquece
- **PAM para super_admin** mitiga risco interno
- **DR documentado** (RPO/RTO) — diferencial em venda Enterprise

### Negativas

- **Custo operacional MVP: R$ 0 fixo adicional** — todos os componentes pagos foram substituídos por alternativas free OU postergados para Fase 2. Detalhe:
  - **Free no MVP:** Cloudflare Turnstile · Cloudflare proxy (DDoS + WAF básico) · Vercel Hobby · Upstash Redis (10k commands/dia) · Gitleaks · Dependabot · OSV-scanner · Cloudflare R2 OU Backblaze B2 (10GB backup) · OWASP ZAP (auto scan CI) · Supabase backup nativo · scan próprio de upload
  - **Postergado para Fase 2** (gatilho: receita / 1º cliente Enterprise / volume): Vercel Pro · ClamAV pago · AWS S3 backup off-site · pentest externo anual · DPO externo retainer · Better Stack status page
- **Atrito no desenvolvimento** — toda Server Action passa por wrapper expandido; toda integração externa exige allowlist; toda upload exige scan. Desenvolvedor (você) tem 7 camadas para lembrar — daí as **regras CI**
- **Scan próprio cobre menos que ClamAV** — magic bytes + embed detection + extension allowlist pegam ~90% dos casos comuns; malware inédito (0-day) sofisticado pode passar. Aceitável MVP solo (volume baixo, perfil clínico legítimo); upgrade para ClamAV no 1º cliente Enterprise
- **Backup grátis (R2/Backblaze 10GB) limita volume** — quando ultrapassar 5GB de dump, migrar para AWS S3 pago. Janela: 1.000-3.000 tenants ativos
- **Falsos positivos** — scan próprio ocasionalmente bloqueia PDF legítimo (PDF com macro/JS válido de relatório financeiro); Dependabot abre 5+ PRs/semana; auth lockout irrita user legítimo (Turnstile mitiga)
- **CSP exige refactor** se lib quer inline script — tailwind exige `unsafe-inline` em CSS (aceitável). JS sempre via nonce
- **Hash chain no audit_log** — INSERT vira ligeiramente mais caro (compute hash); aceitável dado volume
- **OWASP ZAP automated** cobre menos que pentest humano — pentest manual experiente acha problemas de lógica de negócio que scanner não detecta. Aceitável MVP; upgrade Fase 2

**Custos esperados quando ativar Fase 2 paga (referência futura):**
- ClamAV Fly.io ~R$ 30/mês ou api.cloudmersive.com ~R$ 200/mês
- AWS S3 backup off-site R$ 100-300/mês (volume > 5GB)
- Vercel Pro $20-150/mês (preview envs / SLA)
- Better Stack status page R$ 30-50/mês
- Pentest anual R$ 8-15k
- DPO externo retainer R$ 2-5k/mês

**Total Fase 2:** ~R$ 1.000-2.500/mês fixo + R$ 8-15k anual pentest. **Esperar receita pagar isso** — não bloqueia MVP.

### Riscos não mitigados (assumidos)

- **Vercel/Supabase comprometidos** — fora de controle; mitigação parcial via off-site backup AWS + cifragem própria. Probabilidade baixa, impacto catastrófico → Disaster Recovery Plan documenta resposta.
- **Insider malicioso (você)** — fundador solo; PAM ajuda mas não impede. Mitigação real só com 4-eyes (Fase 2 quando crescer).
- **0-day em deps** — CVE divulgado depois; OSV-scanner cobre conhecidos. Postura: monitor + patch janela 7 dias para critical.
- **Engenharia social** — phishing alvo no fundador → MFA hardware key (Yubikey) recomendado.
- **Quantum computing** — TLS 1.3 atual quebra com computador quântico em ~10-15 anos. Migração para post-quantum crypto é Fase 4+ (acompanhar NIST).

## Sprints afetados

| Sprint | Ajuste |
|---|---|
| **00 setup-infra** | `next.config.ts` com headers + middleware CSP nonce + Upstash rate limit global + `packages/security/safe-fetch.ts` + `packages/security/scan-upload.ts` + Gitleaks pre-commit + Dependabot config + OSV-scanner em CI + script `pnpm sbom:generate` + `/.well-known/security.txt` + página `/seguranca` |
| **01a identidade** | `auth_attempts` table + lockout policy + Turnstile no signup/login + `audit_log.previous_hash` + trigger SHA256 chain + job verifica continuidade + `system_audit_anchor` |
| **01b RBAC** | `privileged_sessions` table + JIT access para super_admin + alerta abertura + `privileged_audit_log` + role `requires_mfa` |
| **04 financeiro** | safeFetch nas chamadas Asaas + STRIDE pagamento + virus scan se vier upload de comprovante |
| **06 copilot** | `redactBeforeLLM()` em `buildSystemPrompt` + safeFetch nos providers IA + classificador anti-injection |
| **13 WhatsApp** | safeFetch no media download + virus scan no anexo (regra 38) + STRIDE inbound |
| **17 bancos** | safeFetch Open Finance providers + safeFetch Focus NFe + virus scan upload comprovante |
| **20 prontuário** | STRIDE prontuário + virus scan em laudos anexados + cert A1 com KEK |
| **21 evolução** | virus scan em `evolucao_attachments` (raio-X PDF, vídeo execução) |
| **22 TISS** | safeFetch nos webservices das operadoras |
| **32 device hub** | safeFetch nos providers Garmin/Oura + scan no upload FIT/CSV |
| **33 pipeline exames** | STRIDE exames + virus scan upload (`lab-documents`) + safeFetch OCR provider |
| **36 fiscal** | safeFetch Focus NFe (já no 17, reforça) + cert A1 KEK |

## Status

**Accepted** em 2026-04-24. Implementação distribuída pelos sprints listados. Regras 35-40 ficam ativas após Sprint 00 (CI).

## References

- ADR 0001 — Stack base
- ADR 0005 — RBAC com consent cross-module
- ADR 0053 — CFM 2.454/2026 IA em saúde
- ADR 0054 — LGPD art. 11 dado de saúde
- ADR 0064 — Arquitetura IA (BYOK + Gemini default)
- ADR 0065 — Multi-tenant por subdomínio
- ADR 0067 — DPO + governança LGPD
- ADR 0071 — Sistema de erros + alertas tempo real
- ADR 0072 — Escalabilidade banco
- OWASP Top 10 (2021): https://owasp.org/Top10/
- OWASP ASVS 4.0 (Application Security Verification Standard)
- NIST SP 800-53 Rev. 5 (referência de controles)
- RFC 9116 (security.txt)
- LGPD Lei 13.709/2018 art. 46-49 (segurança técnica e administrativa)
- ANPD — Guia de Segurança da Informação (jul/2024)
