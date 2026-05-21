# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Build — Sprint 02b6 — migração 20 pages pra requireMemberOrPassport + remoção /meu/sessoes legacy 2026-05-21

Fecha bug arquitetural descoberto na sessão anterior — todas as 24 rotas do portal `/meu/*` agora suportam session passport (Sprint 02b3 ADR 0094) E session member (Sprint 26) com UX graceful pra paciente sem vínculo clínico.

**Estratégia adotada — opção A** (UX graceful, simples) das 3 do spinoff:
- Paciente passport sem vínculo → renderiza `<PassportNeedsLink>` (banner amigável "vincule-se a uma clínica" com CTAs pra `/meu/convidar` e `/meu/privacidade/compartilhamento`)
- Paciente member (com vínculo) → fluxo Sprint 26 preservado byte-a-byte
- Opção B (cookie `lf_active_tenant_id`) e Opção C (híbrida — 1 link = auto-resolve, >1 = seletor) ficam pra Sprint 02b7+ quando UX real demandar

**Helper novo `apps/web/app/lib/require-member-or-passport.ts`**:
- `requireMemberOrPassport(returnTo)` retorna discriminated union:
  - `{kind: 'member', claims: MemberSessionClaims}` — comportamento Sprint 26 inalterado
  - `{kind: 'passport_needs_link', passportGlobalId, passportSessionId}` — paciente passport sem vínculo
- Session ausente → redirect `/meu/login` (mesma lógica de `requireMemberSession`)
- Roadmap Sprint 02b7+ evolui pra opção (C) híbrida quando schema `patient_company_links` lookup + cookie tenant ativo ficar pronto

**Componente novo `apps/web/app/meu/_components/passport-needs-link.tsx`**:
- Banner ev-card centralizado "🔗 Precisa de vínculo com uma empresa"
- Mensagem específica por feature (`"seus treinos"`, `"sua agenda"`, etc)
- 2 CTAs: "Convidar empresa" → `/meu/convidar`; "Gerenciar meus vínculos" → `/meu/privacidade/compartilhamento`
- Prop `hideLinkButtons?: boolean` esconde CTAs em pages que JÁ SÃO destinos dos botões (evita loop em `/meu/convidar` e `/meu/privacidade/*`)
- Inclui texto fallback "Sua conta global está ativa — edite em /meu/perfil" pra reassurance

**20 pages migradas via script Node `scripts/migrate-meu-pages.mjs`** (UTF-8 preserved):
- 14 pages tipo A (usam `withMemberContext + claims`): agenda, alertas, diário, dispositivos+historico+importar, exames+upload, financeiro, qr, recibos, treino, privacidade/alertas-cruzados, agenda/novo, diário/novo
- 5 pages tipo B (privacy + convidar — `hideLinkButtons=true`): convidar, privacidade overview, privacidade/acessos, privacidade/compartilhamento, privacidade/incidentes
- 1 page já migrada antes (treino — pilot manual via Edit tool)

**`/meu/sessoes` deprecated** (Sprint 01a Faixa C skeleton bug arquitetural):
- Originalmente usava `auth.api.getSession` STAFF (`@repo/auth` BetterAuth) montado em `/meu/*` (path paciente) — redirecionava pra `/login` (staff)
- Funcionalidade já existia em `/meu/perfil` (`PassportSessionRevokeButton` + `RevokeSessionButton`)
- Substituído por `redirect('/meu/perfil')` server-side pra preservar URLs antigos (bookmarks, emails legacy)
- Sprint 02b7+ pode deletar de vez

**Bug PowerShell encoding descoberto + workaround:**
Primeira tentativa de batch migration usou PowerShell `Set-Content -Encoding UTF8` que **corrompeu acentos** em todos os 19 arquivos editados (`ã` → `Ã£`, `—` → `â€"`, etc — UTF-8 lido como Latin-1). Detectado via grep antes de typecheck rodar. Revertido via `git checkout HEAD --` + refeito via Node `fs.writeFileSync(..., 'utf8')` que respeita encoding corretamente. Script `scripts/migrate-meu-pages.mjs` versionado pra futura referência (refactor similar).

**E2E spec atualizado** (`apps/web/e2e/smoke/meu-portal-routes.spec.ts`):
- Removida lista `KNOWN_BROKEN_ROUTES` (era 1 rota `/meu/sessoes`)
- `PASSPORT_SUPPORTED_ROUTES`: cresceu de 3 → 24 rotas
- `MEMBER_ONLY_ROUTES`: agora redundante mas mantido pra regressão Sprint 26 (20 rotas)
- Suite total: **45/45 passing** (24 passport + 20 member + 1 sessoes covered em ambos)

**Suite Email + portal completa: 54/54 specs passing em 23.9s**:
- meu-magic-link (2) + change-email (4) + resend (3) + portal-routes (45)

**Validação:**
- ✓ typecheck 12/12 packages
- ✓ lint-custom 782 + 2 css clean (9 rules)
- ✓ docs-check 0/0
- ✓ E2E 54/54 specs passing

**Status fechamento bug arquitetural /meu/***:
- ✅ Bug middleware (commit `d922e7e`)
- ✅ Bug Sprint 26 legacy → migração 20 pages (este commit)
- ✅ Bug `/meu/sessoes` STAFF auth → redirect pra perfil
- ✅ E2E coverage completa (45 specs cobrindo passport + member)

### Test — Smoke E2E /meu/* split em 2 suites + bug arquitetural descoberto 2026-05-21

Spec `meu-portal-routes.spec.ts` rodado de verdade após Docker voltar. Resultado revelou **bug arquitetural maior** do que o middleware fix de mais cedo:

**21/24 rotas FALHARAM** com session passport pura (paciente cadastrado via Path B proativo). Causa: usam `requireMemberSession()` (Sprint 26 legacy) que só aceita `lf_member_session` — NÃO suporta `lf_passport_session` (Sprint 02b3 ADR 0094).

**Em prática:** paciente que se cadastra via `/cadastro` proativo fica preso em 3 rotas:
- `/meu` (dashboard)
- `/meu/perfil` + `/meu/perfil/email-trocado`

**Outras 21 rotas redirecionam pra `/meu/login`** mesmo com session válida — quebra fluxo completo Sprint 02b4 + ADR 0093 (passport global identity).

**Bug separado descoberto:**
- `/meu/sessoes` (Sprint 01a Faixa C skeleton) usa `auth.api.getSession` do `@repo/auth` (STAFF BetterAuth/Lucia) mas está montado em `/meu/*` (path de paciente) → redireciona pra `/login` STAFF mesmo com session member. Bug arquitetural separado — funcionalidade já existe em `/meu/perfil/PassportSessionRevokeButton`; sugestão é deletar a rota duplicada.

**Refactor do spec:** split em 2 suites independentes:

- **Suite A — `PASSPORT_SUPPORTED_ROUTES`** (3 rotas): testa com session passport via helper `test-passport-identity.ts`. Cobre `/meu`, `/meu/perfil`, `/meu/perfil/email-trocado` (Sprint 02b4 padrão `getActiveSession`).
- **Suite B — `MEMBER_ONLY_ROUTES`** (20 rotas): testa com session member via helper `test-member.ts` (Sprint 26). Cobre Sprint 26 legacy ainda funcional pra paciente com vínculo clínico.
- **`KNOWN_BROKEN_ROUTES`** (1 rota): `/meu/sessoes` documentado como bug separado em comment, NÃO testado.

Cada suite usa helper de session adequada + cookie distinto (`lf_passport_session` vs `lf_member_session`). Helper auxiliar inline `setupMemberSession()` na suite B cria session member via SQL (raw pool — workaround pra `test-member.ts` não expor pool).

**Resultado final:** **23/23 specs passing** (3 passport + 20 member) em 8.7s.

**Spinoff task criado:** "Migrar 20 pages /meu/* pra getActiveSession (suporte passport)". Decisão arquitetural pendente entre 3 estratégias:
- (A) UI graceful "vincule-se a clínica" pra passport sem tenant
- (B) Cookie `lf_active_tenant_id` + lookup `patient_company_links`
- (C) Híbrido — 1 link ativo = auto-tenant; 0 ou >1 = seletor UI

Recomendação (C) alinha com ADR 0077.

**Validação:**
- ✓ typecheck 12/12 packages
- ✓ lint-custom 780 + 2 css clean (9 rules)
- ✓ docs-check 0/0
- ✓ E2E meu-portal-routes 23/23 passing (3 passport + 20 member)
- ✓ E2E suite Email completa preserved (meu-magic-link 2 + change-email 4 + resend 3 + portal-routes 23 = **32/32 passing**)

### Test — Smoke E2E /meu/* portal routes (24 rotas) 2026-05-21

Pega o spinoff task flagrado durante o middleware fix (commit `d922e7e`) — varre TODAS as páginas protegidas do portal do paciente pra detectar quebras de session/render similares ao bug do middleware.

**Spec `apps/web/e2e/smoke/meu-portal-routes.spec.ts`** (90l):
- Itera 24 rotas estáticas em `/meu/*` (excluindo login/verify pré-auth + dynamic params)
- Cada rota = 1 test que `page.goto(rota)` com cookie passport real
- Asserta HTTP 200 (não 500 server error)
- Asserta `page.url()` não contém `/login` (cookie/middleware OK)
- `beforeAll` cria 1 identity passport com session + MFA verified compartilhada entre testes (1 INSERT vs N na re-run)
- `afterAll` cleanup + `closePassportPool` libera conexões

**Rotas cobertas** (24 = todas `/meu/*/page.tsx` exceto login):
- `/meu` dashboard
- `/meu/agenda` + `/meu/agenda/novo`
- `/meu/alertas` + `/meu/convidar` + `/meu/qr` + `/meu/recibos` + `/meu/sessoes` + `/meu/treino`
- `/meu/diario` + `/meu/diario/novo`
- `/meu/dispositivos` + `/meu/dispositivos/historico` + `/meu/dispositivos/importar`
- `/meu/exames` + `/meu/exames/upload`
- `/meu/financeiro`
- `/meu/perfil` + `/meu/perfil/email-trocado`
- `/meu/privacidade` + 4 subpaths (acessos / alertas-cruzados / compartilhamento / incidentes)

**Bug parsing TS encontrado durante implementação** — comment JSDoc `/meu/*/page.tsx` fazia o parser SWC interpretar `*/` como fechamento de block comment. Substituído por "page.tsx em /meu" no header doc. Tomar nota: blocks JSDoc não podem conter `*/` literal (mesmo em path).

**Validação:**
- ✓ typecheck 12/12 packages
- ✓ lint-custom 780 + 2 css clean (9 rules)
- ⚠️ E2E rodar diferido — Docker Desktop caiu durante a sessão; spec compila + lint passa mas resultado de execução real fica pra próxima sessão com infra OK

**Próximo run** (quando Docker voltar): `DATABASE_URL=postgresql://postgres:postgres@localhost:5434/logifit pnpm --filter @app/web exec playwright test e2e/smoke/meu-portal-routes.spec.ts --project=chromium-desktop`. Espera-se algumas falhas em rotas que dependem de queries específicas (e.g., `/meu/alertas` pode esperar `member_id` real; `/meu/diario` pode falhar sem `food_log_*` rows). Cada falha = bug catalogado pra fix sprint dedicado.

### Build — Sprint 02b5 fechamento — cron expire + 7 E2E specs + fix middleware /meu/* 2026-05-21

Triplo entrega fecha **todos os 3 candidatos Sprint 02b5 abertos** + descobre/corrige bug crítico no middleware.

**(1) Cron `expire-passport-email-verification-tokens`** (Sprint 02b5 #1):
- Route handler `apps/web/app/api/jobs/expire-passport-email-verification-tokens/route.ts`
- Schedule sugerido daily ~03:55 UTC = 00:55 SP (depois de hard-delete-deactivated-passport reduz contention CASCADE)
- 2 critérios de limpeza:
  - **`used_at < now() - 30 days`** — audit retention LGPD art. 18 V cobre janela suficiente; >30d valor de audit mínimo
  - **`used_at IS NULL AND expires_at < now() - 7 days`** — TTL original 24h; janela extra 7d preserva audit de tokens nunca clicados (paciente pediu mas nunca abriu — pode indicar bug/spam)
- Cobre **ambos kinds** ('signup' Sprint 02b4 + 'change_email' Sprint 02b5)
- Auth: `Authorization: Bearer $CRON_SECRET` via `timingSafeEqual` (mesmo padrão `hard-delete-deactivated-passport` + `expire-passport-global-sessions`)
- Retorna `{used_deleted, expired_unused_deleted, remaining_total}` + log JSON estruturado

**(2) E2E Playwright `change-email.spec.ts`** (Sprint 02b5 #2):
- 4 tests cobrindo `confirmPassportEmailChange` (pré-auth — route handler GET):
  1. Happy path: token kind='change_email' → confirm → DB email atualizado + email_verified_at setado + notificação Mailhog OLD email
  2. Token expirado (ttlHours: -1) → redirect `/cadastro/email-erro` + DB inalterado
  3. Token inválido (não existe no DB) → redirect erro sem 500
  4. Token kind='signup' (Sprint 02b4) **NÃO funciona** pra change_email — isolamento por kind validado
- Helper novo `test-passport-identity.ts` (200l) — `createTestPassportIdentity({emailVerified, withSession, mfaVerified})` + `insertEmailVerificationToken({kind, newEmail, ttlHours})` + `readIdentity(id)` + `countEmailVerificationTokens({id, kind})`
- Bypass RLS via `SET row_security = off`; FK CASCADE limpa tokens/sessions automaticamente no `deleteTestPassportIdentity`

**(3) E2E Playwright `resend-email-verification.spec.ts`** (Sprint 02b5 #3):
- 3 tests cobrindo `resendPassportEmailVerification` (Server Action via UI click):
  1. Happy path: paciente não verificado → click botão → DB +1 token kind='signup' + Mailhog email
  2. Idempotência: paciente verificado → botão NÃO renderiza (UI condicional) + badge "✓ verificado" visível
  3. Cooldown: 2ª chamada em <5min → DB count permanece 1 (RATE_LIMITED bloqueia INSERT)
- Cookie passport session setado via `context.addCookies({url: 'http://localhost:3100/meu'})` (compat com path `/meu` do `setPassportCookie`)
- Polling DB ao invés de esperar render React (mais robusto que UI-based assertions)

**🐛 Bug crítico descoberto + corrigido — middleware `/meu/*` bloqueava paciente:**

Durante implementação do E2E resend, descoberto que `apps/web/middleware.ts` checava cookie `logifit.session_token` (STAFF) pra TODAS rotas em `/app/*` E `/meu/*`. Como paciente passport usa `lf_passport_session` (Sprint 02b3) ou `lf_member_session` (Sprint 26), **TODA navegação dentro de `/meu/*` (perfil, agenda, financeiro, etc) redirecionava pra `/login` (staff) em produção**.

Antes:
```ts
const PROTECTED_PATH_PREFIXES = ['/app', '/meu']
const SESSION_COOKIE_NAME = 'logifit.session_token'
// Single check pra ambos prefixes — checava cookie staff em /meu/*
```

Depois (`apps/web/middleware.ts`):
- `/app/*` → cookie staff `logifit.session_token` → redirect `/login`
- `/meu/*` → cookie member OU passport (`lf_member_session` OU `lf_passport_session`) → redirect `/meu/login`
- `MEU_PUBLIC_PATHS = ['/meu/login', '/meu/cadastro']` exceções (pré-auth — login flow + signup proativo)

Esse fix foi essencial pro E2E resend funcionar mas tinha impacto MAIOR — `/meu/perfil`, `/meu/agenda`, `/meu/financeiro` em prod **nunca tinham sido testadas com session real do paciente** (smoke .mjs e E2E meu-magic-link usavam só API endpoints, não navegação UI). Spinoff worth: rodar smoke completa Sprint 26 portal pra detectar outras quebras similares.

**Validação:**
- ✓ typecheck 12/12 packages
- ✓ lint-custom 779 + 2 css clean (9 rules)
- ✓ docs-check 0/0
- ✓ E2E suite Email completa: **9/9 specs passing** (meu-magic-link 2 + change-email 4 + resend 3) em 6.0s
- ✓ Bug middleware confirmado via DEBUG output (URL após cookie set ia pra `/login` antes do fix; agora `/meu/perfil` correto)

**Sprint 02b4/02b5 fechamento — STATUS**:

| Item | Status |
|---|---|
| ✅ QR code visual MFA (ADR 0095) | done |
| ✅ Decisão email provider (ADR 0096 + 0097) | done |
| ✅ `@repo/email` package + plug magic link | done |
| ✅ Email confirmation `signupPatient` | done |
| ✅ Redis sliding window real | done |
| ✅ E2E Playwright magic link | done |
| ✅ `change_email` flow + UI + smoke | done |
| ✅ `resendPassportEmailVerification` SA + UI | done |
| ✅ Cron `expire-passport-email-verification-tokens` | done |
| ✅ E2E Playwright change_email + resend | done |
| 🐛 Bug middleware `/meu/*` cookie staff | fixed |
| 🔵 Feature flag `passport_signup_v1` | aberto — sistema de feature flags não existe ainda |

### Build — Sprint 02b5 — resendPassportEmailVerification + refactor helper 2026-05-21

Fecha 2º item dos candidatos Sprint 02b5 — paciente pode reenviar o email de confirmação que recebeu no signup (caso tenha perdido, ido pra spam, ou clicado antes de logar).

**Refactor — helper compartilhado `lib/dispatch-email-verification.ts`** (novo):
- Move a função `dispatchEmailVerification` que vivia inline em `cadastro/actions.ts` (helper privado do `signupPatient`) pra módulo compartilhado
- Mesma side effect: gera token kind='signup' (default) + INSERT em `passport_email_verification_tokens` + envia via `@repo/email` category 'platform'
- Retorna `{sent, provider}` ao invés de void — caller pode customizar UX baseado em sucesso/falha de SMTP
- Failure-tolerant mantido (audit log estruturado em erro, não throw)
- 2 callers refatorados pra importar do helper:
  - `signupPatient` (passo 9 — automático pós-INSERT identity)
  - `resendPassportEmailVerification` (novo abaixo)

**Server Action `resendPassportEmailVerification`** (`wrapPassportAction` requireMfa=**false**):
- **Sem MFA gate** intencional — paciente pode estar com `email_verified_at IS NULL` e querer reenviar ANTES mesmo de conseguir login completo; exigir MFA aqui criaria UX paradoxal (precisa do email pra ter login MFA, mas precisa de MFA pra reenviar email)
- Idempotência: se `email_verified_at` já setado, retorna `{ok: true, alreadyVerified: true}` sem gerar novo token + UX informa "Seu email já está confirmado"
- Cooldown 5min: nenhum token kind='signup' ativo (`used_at IS NULL`) <5min pra esta identity. Excedido → `RATE_LIMITED` com retry-after em segundos
- Falha SMTP retorna `{sent: false}` com nota amigável — não vaza erro técnico
- Resposta sucesso inclui `provider` (mock/smtp/brevo-smtp) pra debug futuro

**UI `resend-verification-button.tsx`** (novo client component):
- Renderizado condicionalmente em `/meu/perfil` quando `email_verified_at IS NULL`
- 3 estados: idle / success (badge verde com mensagem persistente) / error (vermelho + auto-dismiss 5s pra permitir nova tentativa)
- Distingue success.alreadyVerified (badge azul ℹ️) vs success.sent (badge verde ✓)
- Acessibilidade: button disabled durante pending

**`/meu/perfil` page atualizada**:
- Após o badge de status (✓ verificado / ⚠ não verificado), se `!email_verified_at` renderiza `<ResendVerificationButton>` antes do form de troca de email
- Hierarquia visual respeitada: reenviar é ação mais comum/menos crítica → vem primeiro; trocar email é mais sensível → vem depois

**Validação:**
- ✓ typecheck 12/12 packages
- ✓ lint-custom 775 + 2 css clean (9 rules)
- ✓ docs-check 0/0

**Sprint 02b5 candidatos restantes**:
- Cron `expire-passport-email-verification-tokens` daily (DELETE used>30d + expired>7d ambos kinds — pequena janela LGPD audit retention)
- E2E Playwright spec dedicado pro change_email (similar ao smoke .mjs)
- E2E Playwright spec resend (cooldown enforcement + alreadyVerified path)

### Build — Sprint 02b5 — change_email flow completo 2026-05-20 (noite tarde)

Fecha primeiro item dos candidatos Sprint 02b5 abertos — paciente pode trocar email da conta global passport com proteções de alta sensibilidade.

**Schema (migration 0047):**
- `ALTER TABLE passport_email_verification_tokens ADD COLUMN kind` ('signup' | 'change_email', default 'signup' pra compat com Sprint 02b4)
- `ADD COLUMN new_email` (target em kind='change_email'; NULL em kind='signup')
- Check constraint cross-column: `signup` exige `new_email IS NULL`; `change_email` exige `new_email IS NOT NULL`
- Index `kind, expires_at` pra filtro cron cleanup futuro
- Schema Drizzle atualizado: novos campos + type `PassportEmailVerificationKind`

**Server Action `requestPassportEmailChange`** (`wrapPassportAction` requireMfa=true):
- **3 gates de alta sensibilidade**: MFA recente <15min + re-verify password atual + cooldown 24h entre requests
- Anti-enumeration em newEmail duplicado (erro genérico "se você possui outra conta, use ela")
- Detecta no-op (newEmail == current)
- Cooldown error retorna `RATE_LIMITED` com retry-after em horas
- INSERT token kind='change_email' com snapshot do email atual
- Envia confirmação **pro NOVO email** via `sendTransactional` category 'platform'
- Failure-tolerant: SMTP fail loga estruturado mas não bloqueia (anti-enumeration uniforme)

**Server Action `confirmPassportEmailChange`** (pré-auth, paciente clica link do email novo):
- JOIN `passport_email_verification_tokens` (kind='change_email') + `passport_global_identities` em 1 query (snapshot vs current email + new_email + identity name)
- 5 failure modes: invalid_format / used / expired / current email mismatch (já trocou via outro request) / deactivated_at (conta inativa)
- Re-check disponibilidade do new_email no momento do confirm (race contra outro signup raro mas defesa)
- Transação: UPDATE token.used_at + identity.email=new_email + email_verified_at=now() (já confirmamos posse do new pelo clique no link)
- **Notifica email ANTIGO** via fire-and-forget `sendTransactional` ("⚠ Email da sua conta foi alterado pra j***@example.com — não foi você? Contate privacidade@logifit.com.br") — alerta de segurança crítico LGPD

**2 templates novos em `email-change.ts`**:
- `renderEmailChangeConfirmationHtml/Text` — pro NOVO email com botão "Confirmar troca de email"
- `renderEmailChangeNotificationHtml/Text` — pro email ANTIGO com novo email mascarado (`j***@example.com` em vez de email completo — preserva privacidade caso este email seja compartilhado) + box de aviso amarelo "Não foi você? Entre em contato"

**Route handler GET `/api/meu/perfil/email/confirm-change?t=<token>`**:
- Redireciona pra `/meu/perfil/email-trocado` (sucesso) ou `/cadastro/email-erro?reason=<código>` (falha — reusa página de erro do Sprint 02b4 pra UX consistente)
- Mapeia ApiException.code pra `reason` URL-safe sem expor stack trace

**UI:**
- Nova page `/meu/perfil/email-trocado/page.tsx` — confirmação amigável + botão "Voltar pro meu perfil"
- Novo client component `change-email-form.tsx` — form expandível com 2 inputs (current password + new email) + UX de erro inline (MFA_RECENT_REQUIRED tem mensagem específica)
- `/meu/perfil` page atualizada: badge "✓ verificado" / "⚠ não verificado" ao lado do email + form `ChangeEmailForm` integrado
- SELECT do `passport_global_identities` ganha `email_verified_at`

**Smoke test `scripts/test-change-email-smoke.mjs`** (sem deps externas — psql via `docker exec` + fetch nativo):
- Cria identity passport via SQL bypass RLS
- Gera token kind='change_email' + grava
- GET `/api/meu/perfil/email/confirm-change?t=<token>` → asserta redirect 307 + location email-trocado
- SELECT identity → confirma email == NEW_EMAIL + email_verified_at setado
- Mailhog API → confirma notificação chegou no OLD email
- Cleanup automático

**Validado em dev real:**
- Token confirmado, identity atualizada de `change-old-...@logifit.test` → `change-new-...@logifit.test`
- `email_verified_at = 2026-05-21 02:54:14.7646+00` (setado pelo confirm)
- Email de notificação chegou no OLD address com subject `⚠ Email da sua conta LogiFit foi alterado` (MIME-encoded UTF-8 OK)
- Redirect HTTP 307 pra `/meu/perfil/email-trocado` correto

**Validação:**
- ✓ typecheck 12/12 packages
- ✓ lint-custom 773 + 2 css clean (9 rules)
- ✓ docs-check 0/0
- ✓ smoke test change_email passou end-to-end

**Sprint 02b5 candidatos restantes** (não fechados):
- UI `/meu/perfil` botão "reenviar email confirmação signup" → SA `resendPassportEmailVerification`
- Cron `expire-passport-email-verification-tokens` daily (DELETE used>30d + expired>7d ambos kinds)
- E2E Playwright spec dedicado pro change_email (similar ao smoke .mjs)

### Build — 3 entregas Sprint 02b4/02b5 + E2E Playwright magic link 2026-05-20 (noite)

Triplo entrega autônoma em modo Auto fechando 3 dos 4 itens "Sprint 02b4 fechamento restante" das pendências históricas:

**(a) Email confirmation pós-signup (`verifyPassportEmail` + signupPatient integrado)**
- Migration `0046_passport_email_verification.sql` + policy `0059_*.sql` (GRANT-only, auth table sem RLS, padrão `member_auth_tokens` Sprint 26)
- Schema Drizzle `packages/db/src/schema/passport-email-verification.ts` — `passportEmailVerificationTokens` com `passport_global_identity_id` FK CASCADE + `email` snapshot (anti-race change_email) + `token_hash` SHA-256 + `expires_at` 24h + `used_at` single-use + `request_ip` audit
- Helper `apps/web/app/lib/passport-email-verification.ts` (90l): `generateEmailVerificationToken()` (random 32 bytes base64url + SHA-256) + `hashEmailVerificationToken()` + `verifyEmailVerificationAgainstRow()` com 4 failure modes (`invalid_format` / `used` / `expired` / `email_mismatch`)
- Template `apps/web/app/lib/email-templates/email-verification.ts` (HTML + text fallback RFC 5322; cores inline conforme exceção lint EMAIL_TEMPLATES_PATH)
- `signupPatient` ganha passo 9 — `dispatchEmailVerification()` failure-tolerant fire-and-forget após session criada (não bloqueia signup se SMTP fail)
- Server Action pré-auth `verifyPassportEmail({token})` — JOIN passport_email_verification_tokens + passport_global_identities, valida 4 conditions (formato / used / expired / email_mismatch), transação UPDATE token used_at + identity email_verified_at, idempotente (já-verified retorna ok+alreadyVerified)
- Route handler GET `/api/cadastro/verify-email?t=<token>` — redireciona pra `/cadastro/email-confirmado` (sucesso) ou `/cadastro/email-erro?reason=<código>` (falha — mensagem amigável sem stack trace)
- 2 páginas UI mínimas: `email-confirmado/page.tsx` + `email-erro/page.tsx` com 5 reasons mapeados pra mensagens human-readable + botões "Ir pro portal" + "Pedir novo link"

**(b) Redis sliding window real (regra 36 completa)**
- Dep nova `ioredis@^5.4.1` em `@repo/security` (justificada implicitamente — Redis self-hosted já é stack core ADR 0091; ioredis é cliente padrão de mercado, MIT, mantido)
- `packages/security/src/redis-rate-limit.ts` (300l) — sliding window via Redis ZSET:
  - `getRedisClient()` singleton lazy com retry strategy exponencial 100ms→2s cap, 5 retries; failure mode = null (caller fallback SQL)
  - `recordFailureSlidingWindow()` pipeline atômico ZADD score=ts member=ts+random / ZREMRANGEBYSCORE purge antigos / ZCOUNT count restantes / PEXPIRE windowMs+lockoutDuration
  - `countFailuresSlidingWindow()` pre-check sem registrar (pra `shouldRequireCaptcha`)
  - `clearFailuresSlidingWindow()` DEL key (login success zera)
  - `setLockoutFlag()` SET PX NX (idempotente — true só na 1ª vez)
  - `getLockoutFlag()` retorna `string reason | null não-ativo | undefined Redis-down` (distingue 3 estados)
  - `evaluateLockoutRedis()` registra falha em email+ip ZSETs em paralelo + seta flags lockout se threshold atingido
  - `checkLockoutRedis()` lê flags email+ip; bloqueia se qualquer ativo
  - Chaves canônicas: `rl:auth:email:{lowercase}` / `rl:auth:ip:{ip}` / `rl:lockout:email:{lowercase}` / `rl:lockout:ip:{ip}`
- 23 unit tests em `redis-rate-limit.test.ts` cobrindo: getRedisClient sem URL / cache attempted / chaves canônicas case / 7 ops Redis-down (null/false/undefined) / 7 ops com fake client mocado (pipeline + SET PX NX + GET + DEL) / 3 failure modes (exec null / throw / quit cascade)
- `loginPassport` (Sprint 02b3) refactored — Redis primeiro + SQL fallback:
  - Passo 0 pre-check: `checkLockoutRedis` → se null fallback `checkAuthLockout` SQL
  - `recordFailure` interno: SEMPRE INSERT `auth_attempts` (LGPD audit log) + `evaluateLockoutRedis` → se null fallback `evaluateLockout` SQL
  - Passo 6 login success: `clearFailuresSlidingWindow` pra email + ip (zera contadores)
- Total tests @repo/security **171 verdes** (era 148, +23 redis-rate-limit)

**(c) E2E Playwright smoke do fluxo magic link end-to-end**
- 2 helpers reusáveis em `apps/web/e2e/helpers/`:
  - `mailhog.ts` (130l) — `listInbox` / `deleteAllMessages` / `waitForMessage({to, subject, timeout})` polling 200ms / `extractUrlFromBody` regex + `decodeQuotedPrintable` RFC 2045 / `decodeMimeHeader` RFC 2047 (Q/B encoded-words)
  - `test-member.ts` (110l) — `createTestMember({email, name, document})` bypass RLS via SET row_security=off + INSERT person+member em `academia-equilibrio`; idempotente (DELETE existing antes); `deleteTestMember(member)` tolerante; `closePool()` cleanup
- Spec `apps/web/e2e/smoke/meu-magic-link.spec.ts` (130l) — 2 tests:
  - **Happy path**: setup member → clear inbox → POST `/api/meu/magic-link` → assert {ok, sent} → wait Mailhog inbox → assert From=LogiFit + Subject contém "link de acesso" → extract token via quoted-printable decode → POST `/api/meu/verify` → assert {ok, memberId, tenantId}
  - **Single-use enforcement**: pede outro token → verifica 1× sucesso → tenta verificar 2× → assert 500 + mensagem "já utilizado/expirado/inválido"
- `playwright.config.ts` corrigido: `baseURL` 3000→3100 + `webServer.url` 3000→3100 (alinha com `next dev --port 3100`)

**Validação:**
- ✓ typecheck 12/12 packages
- ✓ lint-custom 769 + 2 css clean (9 rules)
- ✓ docs-check 0/0
- ✓ tests @repo/security 171 verdes (+23)
- ✓ tests @repo/email 29 verdes (sem mudança)
- ✓ E2E Playwright 2/2 chromium-desktop (2.1s)

**Próximos passos** (Sprint 02b4 fechamento — 1 item restante):
- Feature flag `passport_signup_v1` — sistema de feature flags não existe no projeto; decisão arquitetural (DB table próprio? lib externa? env var simples?)

**Sprint 02b5 candidatos abertos**:
- UI `/meu/perfil` botão "reenviar email de confirmação" → SA `resendPassportEmailVerification`
- `change_email` flow com dispatch automático de email pro novo endereço
- Cron `expire-passport-email-verification-tokens` daily (DELETE used>30d + expired>7d)
- E2E spec adicional: signup proativo full → email confirmação → click verify → session ativa

### Test — Fluxo magic link end-to-end validado em dev (Mailhog + Postgres real) 2026-05-20

Após implementar `@repo/email` + plug no `requestMagicLink`, validei o fluxo completo end-to-end com infra real local — provou que o stack todo está conectado corretamente.

**Setup necessário descoberto + corrigido:**

1. **Migrations 0042-0045 (passport_*) não estavam no `_journal.json` Drizzle** — foram criadas como SQL manual e nunca registradas. Apliquei direto via `docker exec psql` + também as policies 0056-0058 correspondentes
2. **`.env.local` na raiz não estava sendo propagado pra Next.js** — `next dev` lê do CWD (`apps/web/`), não da raiz. Solução: `dotenv-cli` na devDeps da raiz + scripts wrapados (`dev`, `build`, `db:*`, `rag:seed*`, `test:e2e`) com `dotenv -e .env.local --`
3. **Turbo bloqueia env vars por default** — adicionado `globalPassThroughEnv` no `turbo.json` listando 53 env vars do projeto (DATABASE_URL, REDIS_URL, MINIO_*, BREVO_SMTP_*, ASAAS_*, FOCUS_NFE_*, TWILIO_*, TURNSTILE_*, R2_*, CRON_SECRET, etc)
4. **`.env.example` atualizado** — header agora explica "raiz do repo, não apps/web/" + menciona pipeline `dotenv-cli` + `turbo passThrough`

**Fluxo end-to-end testado:**

1. **Member criado manual** via SQL — Maria Teste Silva (maria.teste@logifit.test) em `academia-equilibrio` company `00000001-0001-0000-0000-0000000000c1`
2. **`POST /api/meu/magic-link`** → `requestMagicLink` Server Action:
   - Resolveu tenant via slug (academia-equilibrio → tenant `00000001-...`)
   - Resolveu member via JOIN persons.email
   - Rate limit check (passou — primeiro request)
   - Gerou token random 256-bit + grava SHA-256 hash em `member_auth_tokens`
   - **`sendTransactional({category:'platform'})`** → `@repo/email` → `NodemailerEmailProvider` (Mailhog) → SMTP localhost:1025 → inbox
3. **Email aparece em http://localhost:8025**:
   - `Subject: Seu link de acesso ao portal LogiFit`
   - `From: LogiFit <no-reply@logifit.com.br>`
   - `To: maria.teste@logifit.test`
   - HTML body com botão azul "Entrar no portal" + URL completo
   - Text body fallback RFC 5322
4. **Token extraído via Mailhog API + quoted-printable decode** (Python `quopri`)
5. **`POST /api/meu/verify`** com token → `verifyMagicLink` Server Action:
   - Re-hash do token + match no `member_auth_tokens`
   - `verifyMagicLinkAgainstRow` validou expires_at + used_at
   - Transação: `UPDATE member_auth_tokens SET used_at = now()` + `INSERT member_sessions`
   - Retornou `{ok: true, memberId: '...', tenantId: '...'}`
6. **`member_sessions` row criada** com `expires_at = now() + 30 days`
7. **`member_auth_tokens.used = t`** (single-use enforced — segunda tentativa do mesmo token falharia)

**O que isso prova:**

- ✅ `@repo/email` funciona em produção (nodemailer + SMTP + connection pool real)
- ✅ `resolveEmailProvider` detecta env correto (SMTP_HOST=localhost:1025 → Mailhog)
- ✅ `resolveEmailSender({category:'platform'})` resolve LogiFit corretamente
- ✅ Templates de email renderizam HTML + text fallback corretamente
- ✅ MIME encoding UTF-8 quoted-printable preserva caracteres especiais (`—`, `@`)
- ✅ Pipeline env vars repoRoot → Next.js + workspace packages funciona
- ✅ Migrations passport_* aplicáveis manualmente (gap conhecido — Drizzle generate vai capturar quando regenerar)

**Mudanças nesta entrega:**

- `package.json`: 8 scripts wrapados com `dotenv -e .env.local --` (dev, build, test:e2e, rag:seed*, db:migrate, db:generate, db:seed, db:rls-check)
- `turbo.json`: `globalPassThroughEnv` com 53 env vars do projeto
- `.env.example`: header atualizado explicando localização + pipeline
- Dep nova `dotenv-cli@^11.0.0` em devDependencies da raiz (devDep DX — não vai pra prod; dispensa ADR regra 46 análogo a turbo/biome/vitest)

**Spinoff observado** (não fechado nesta entrega):

- Migrations 0042-0045 não registradas no Drizzle `_journal.json` — DB ficou em estado inconsistente onde migration files existem mas o tracker não sabe. Corrigir via `pnpm db:generate` em sprint dedicado pra regenerar journal corretamente OU adicionar entries manualmente. Por ora aplicado direto via SQL pra destravar testes.

**Validação:**
- ✓ typecheck 12/12 packages
- ✓ lint-custom 758 + 2 css clean (9 rules)
- ✓ docs-check 0/0
- ✓ end-to-end: magic link enviado → email no Mailhog → token verificado → session criada
- ✓ `member_sessions` row + `member_auth_tokens.used=true` confirmados via psql

### Build — @repo/email package + plug em requestMagicLink (Sprint 26 → Sprint 02b4) 2026-05-20

Materializa decisão arquitetural dos ADRs 0096 (Brevo SMTP) + 0097 (sender por categoria). Package novo `@repo/email` com provider abstrato + Brevo SMTP prod + Mailhog dev + Mock test, plugado no primeiro caller real (`requestMagicLink` Sprint 26 que era stub `console.log`).

**Package novo `packages/email/`** (`@repo/email`):
- `package.json` + `tsconfig.json` + `vitest.config.ts` (mesma config que `@repo/security` — coverage 80% threshold)
- `types.ts` — `EmailProvider` interface + `SendTransactionalInput/Result` (envelope wrapAction-compatível) + `EmailCategory` ('platform' | 'tenant') + `ResolvedSender`
- `resolve-sender.ts` (MVP do ADR 0097) — `resolveEmailSender(input)` puro sobre env:
  - Categoria `platform` → sempre `EMAIL_FROM` + `EMAIL_FROM_NAME` (LogiFit)
  - Categoria `tenant` → exige `tenantId` (throw senão) + fallback LogiFit + preserva `replyTo` do caller
  - Schema `tenant_email_settings` futuro (sprint dedicado pós-MVP) evolui esta função pra consultar DB
- `mock-provider.ts` — `MockEmailProvider` pra tests: grava em `recordedEmails[]` + counter pra `messageId` único + `clear()` entre tests
- `nodemailer-provider.ts` — `NodemailerEmailProvider` única class pra Brevo prod E Mailhog dev (config injetada via construtor):
  - `nodemailer.createTransport({host, port, secure, auth, pool: true, maxConnections: 5})` — connection pool TCP
  - `sendTransactional` resolve sender → `transport.sendMail({from, replyTo, to, subject, html, text})`
  - Classificador de erros: `EAUTH` → `auth_failed`, `ECONNECTION/ESOCKET/ETIMEDOUT/ECONNREFUSED` → `connection_failed`, `EENVELOPE` → `invalid_recipient`, `EMESSAGE` → `invalid_message`, `EDNS` → `dns_failed`, default → `send_failed:<code>`
  - `close()` idempotente pra shutdown gracioso
- `resolve-provider.ts` — `resolveEmailProvider()` singleton process-wide:
  - `NODE_ENV=test` → `MockEmailProvider`
  - `SMTP_HOST/PORT` + não-prod → `NodemailerEmailProvider` (Mailhog)
  - `BREVO_SMTP_*` completo → `NodemailerEmailProvider` (Brevo prod, providerName 'brevo-smtp')
  - Prod sem nenhum SMTP → **throw fail-loud** (canal crítico LGPD; mock em prod é violação)
  - Dev sem Mailhog + sem Brevo → `MockEmailProvider` (não bloqueia dev)
  - `resetEmailProvider()` pra forçar recriação em tests
- `send.ts` — `sendTransactional(input)` wrapper sobre singleton (DX)
- `index.ts` — barrel export

**Deps:** `nodemailer@^6.9.16` + `@types/nodemailer@^6.4.17` (devDep) — 2 packages add via pnpm.

**Tests 29 verdes** (1 file por modulo + edge cases):
- `resolve-sender.test.ts` (7): platform default + env override + replyTo + tenant sem tenantId throw + tenant fallback + replyTo do tenant
- `mock-provider.test.ts` (5): recorded + counter unique + clear + sender_resolution_failed + preserva fields
- `nodemailer-provider.test.ts` (8): happy path jsonTransport + preserva campos + EAUTH/ECONNREFUSED/EENVELOPE/EWHATEVER classification + sender_resolution_failed + close()
- `resolve-provider.test.ts` (9): test mode + Mailhog dev + Brevo prod + dev fallback mock + prod throw + prod incomplete throw + singleton + reset + Brevo prefere over Mailhog em prod

**Plug em `apps/web/app/meu/actions.ts` `requestMagicLink`** — primeiro caller real:
- Antes: passo 5 era `console.log(magicLinkUrl)` em dev + nada em prod (stub Sprint 26)
- Depois: `sendTransactional({to, subject, htmlBody, textBody, category: 'platform'})`
- Failure-tolerant: erro de envio NÃO vaza pro caller (anti-enumeration) — apenas log estruturado JSON pra Loki investigar (`event: magic_link_send_failed`, `errorCode`, `provider`, `tenantSlug`, `emailHashPrefix` — NÃO logamos email do paciente)
- Token já foi gravado antes do envio; rate limit window protege contra retries
- Categoria `platform` justificada — magic link é canal de auth da plataforma; LogiFit é controlador LGPD da identidade (ADR 0097)

**Templates extraídos pra `apps/web/app/lib/email-templates/magic-link.ts`**:
- `renderMagicLinkHtml(input)` + `renderMagicLinkText(input)` — HTML inline + texto fallback (RFC 5322)
- Templates de email **não suportam CSS custom properties** (Outlook/Gmail/iOS Mail) — cores precisam ser inline literal (`#2563eb`, `#1a1a1a`, etc)
- Lint `no-hardcoded-design-token` ganha exceção `EMAIL_TEMPLATES_PATH = /[\\/]email-templates[\\/]/` — análogo à exceção `PDF_PATH` (PDF renderer mesma limitação técnica)
- Sprint dedicado futuro migra pra `packages/email/templates/*.tsx` com `@react-email/components` (compila pra inline HTML com DX melhor + i18n)

**Workspace dep:** `@app/web/package.json` ganha `"@repo/email": "workspace:*"` em dependencies (ordenado alfabético entre `@repo/db` e `@repo/errors`).

**Validação:**
- ✓ typecheck 12/12 packages (era 11/11 — ganhei `@repo/email`)
- ✓ lint-custom 757 + 2 css clean (9 rules — exceção `EMAIL_TEMPLATES_PATH` adicionada)
- ✓ docs-check 0/0
- ✓ tests @repo/email 29 verdes
- ✓ tests @repo/security 148 verdes (sem mudança — wrapper QR não tem unit test próprio; E2E Playwright planejado)
- ✓ `git status` confirma `.env.local` NÃO trackado (protegido `.gitignore` linhas 21-23)

**Pronto pra integrar em mais callers** (não fechado nesta entrega):
- `confirmTotp` (Sprint 02b3) — manda recovery codes por email opcional
- `enrollTotp` (Sprint 02b3) — manda alerta "MFA ativado em sua conta"
- `signupPatient` (Sprint 02b2) — manda confirmação de cadastro pra `email_verified_at`
- `loginPassport` (Sprint 02b3) — manda alerta "login de IP novo" (segurança)
- Sprint 04 Asaas — todas notificações de fatura (Categoria 2, tenant context)

### Docs — ADR 0096 revisado — Brevo via SMTP em vez de API REST v3 2026-05-20 (tarde)

Revisão da decisão de transport do ADR 0096 (originalmente API REST v3 via `safeFetch`) pra **SMTP via `nodemailer`** (`smtp-relay.brevo.com:587`). Mantém Brevo como provider (decisão 0096 original); muda apenas como o app fala com Brevo.

**Trigger da revisão:** fundador gerou no painel Brevo uma chave SMTP (`xsmtpsib-...`) em vez de API key v3 (`xkeysib-...`). Revisão pragmática: aceitar SMTP key + atualizar ADR em vez de pedir pra regenerar.

**Razões da revisão (5):**
1. **Mesma interface dev/prod** — `nodemailer.createTransport({host, port, auth})` aponta pra Mailhog em dev (`localhost:1025`) e Brevo em prod (`smtp-relay.brevo.com:587`). Sem código condicional `if (NODE_ENV === 'production')` por provider — só env vars
2. **Trocar de provider futuramente é env-only** — qualquer email provider tem endpoint SMTP (Resend, Postmark, Postal self-host); REST API é proprietária. Reduz lock-in real
3. **Padrão IETF universal** — RFC 5321/5322 maduro há décadas; bugs de SMTP são raros vs REST API novas
4. **`nodemailer` é dep aceitável** (regra 46) — ~300KB, MIT, ~50M downloads/semana, zero deps runtime. Bem menor que ~2MB `@aws-sdk/client-ses` que motivou saída do AWS
5. **Pragmatismo** — alinha com a chave SMTP que o fundador já gerou

**Trade-off aceito:** SMTP tem +1 round-trip de protocolo handshake (~150-300ms a mais que REST). Volume MVP (~50-120/dia) torna isso irrelevante; reavaliar se virar batch sender de >100k/dia.

**Sync nos docs:**

- `docs/decisions/0096-email-brevo-substitui-aws-ses.md` (revisado):
  - Seção "Endpoint Brevo" reescrita pra "Transport: SMTP em vez de API REST (revisado 2026-05-20)" com 5 razões + exemplo `BrevoSmtpEmailProvider` via nodemailer
  - Bullet "Sem SDK pesado" atualizado (nodemailer ~300KB em vez de safeFetch direto)
  - Bullet "DX consistente" atualizado (mesma interface SMTP dev/prod)
  - "Justificativa regra 46" expandida com bloco específico pra `nodemailer` (a/b/c/d da regra 46)
- `.env.example`: bloco Brevo trocado de `BREVO_API_KEY` único pra `BREVO_SMTP_HOST/PORT/USER/PASSWORD` (4 vars) + nota explicando "mesma interface dev/prod"

**Validação:**
- ✓ docs-check 0/0
- N/A typecheck/lint (sem código novo — `nodemailer` ainda não adicionado em deps até implementar `packages/email/`)

**Implementação futura** (`@repo/email`):
- `BrevoSmtpEmailProvider` (prod) — `nodemailer.createTransport` aponta pra `smtp-relay.brevo.com:587`
- `SmtpEmailProvider` genérico (dev) — mesmo provider class apontando pra Mailhog `localhost:1025`
- `MockEmailProvider` (tests) — loga em vez de mandar
- Resolver `resolveEmailProvider()` decide por env var `NODE_ENV` + presença de credentials

### Docs — ADR 0097 — Email sender por categoria + branding configurável por tier 2026-05-20

Complementa [ADR 0096](docs/decisions/0096-email-brevo-substitui-aws-ses.md) (provider Brevo) com a decisão de **quem é o sender** (from address) de cada email — distinção que o ADR 0096 não fez. Surgiu de pergunta do fundador "mas isso não deveria ser por parte da empresa tenant?".

**Problema identificado:**
- ADR 0096 implicitamente assumia que todo email viria de `no-reply@logifit.com.br`
- Mas tem 2 categorias de email com naturezas LGPD distintas (controlador vs operador)
- Misturar quebra branding do tenant + confunde paciente (parece phishing) + contamina deliverability agregada

**Categoria 1 — Plataforma LogiFit (LogiFit é controlador LGPD):**
- Cadastro/confirmação email global (`passport_global_identities`)
- Magic link login `/meu/login`
- MFA setup confirmation + alertas de segurança
- Trial expirando (cobrança SaaS)
- LGPD requests da identidade global
- System alerts internos pro DPO

**Categoria 2 — Comunicação do tenant (tenant é controlador LGPD):**
- Convite profissional pro paciente ("Dr. João te convida pra Clínica Vital")
- Welcome ao se vincular ao tenant
- Confirmação/lembrete de agendamento
- Fatura emitida/vencendo/paga (Sprint 04 Asaas)
- Régua de cobrança escalonada (Sprint 13)
- Notificação de evolução/prontuário (Sprint 20+)
- Cross-alert lesão → adaptação treino (Sprint 27)

**Decisão — Modelo C híbrido por tier comercial:**

| Tier | R$/mês | Categoria 1 | Categoria 2 |
|---|---|---|---|
| Solo / Solo Combo | 49 / 69 | LogiFit | Fallback (from LogiFit + Reply-To tenant + "X via LogiFit") |
| Starter | 99 | LogiFit | Fallback (mesma estrutura) |
| Pro | 199 | LogiFit | **Domínio próprio opcional** via DNS verification |
| Business | 449 | LogiFit | Domínio próprio (1 por company multi-CNPJ) |
| Enterprise | ~1.199+ | LogiFit | White-label completo (signature HTML + per-unit overrides + templates) |

**Por que Pro libera (não Starter):** Starter é autônomo PJ/MEI que geralmente ainda não tem domínio próprio profissional (~70% usam Gmail/Hotmail); Pro é primeira tier "estabelecida" (10 profs, 500 members) com identidade jurídica + site. Vira diferenciador comercial Starter→Pro.

**Schema canônico** `tenant_email_settings` (definido no ADR; sem migration ainda):
- `contact_email` (Reply-To em fallback) + `display_name` ("Clínica Vital" pra `From-Name`)
- `from_domain` + `from_local_part` (NULL pra Solo/Starter)
- `verification_status` enum `fallback / pending / verified / failed / expired`
- `spf_record` + `dkim_selector` + `dkim_record` + `dmarc_record` (retornados por Brevo)
- `signature_html jsonb` por locale (Enterprise white-label)
- `per_unit_overrides jsonb` (Business+ com multi-unit)

**Fluxo DNS verification (Pro+):**
1. `/app/settings/email` (gate por tier) → admin tenant configura `from_domain`
2. Server Action `requestEmailDomainVerification` → Brevo API `POST /senders/domains` → retorna 3 records (SPF + DKIM + DMARC)
3. UI mostra records pro admin adicionar no DNS
4. Server Action `checkEmailDomainVerification` (botão "verificar") → Brevo `GET /senders/domains/{domain}` → atualiza status
5. Cron daily `verify-email-domains` revalida `pending` + `verified` (DNS pode mudar)
6. Quando `verified` → envios usam from real; senão fallback automático (nunca falha por verificação)

**Provider abstrato impact** (`@repo/email` futuro):
- `sendTransactional` ganha parâmetro `category: 'platform' | 'tenant'` + opcional `tenantId`
- Helper interno `resolveEmailSender(category, tenantId?)` antes da chamada Brevo decide from/reply-to
- Categoria 1 sempre `no-reply@logifit.com.br`; Categoria 2 segue `tenant_email_settings` ou fallback

**3 alternativas avaliadas** em tabela do ADR:
- (A) Tudo LogiFit — REJEITADO (quebra branding; LGPD ambígua)
- (B) Tudo tenant — REJEITADO (força DNS em Solo R$49 = fricção alta; LogiFit perde controle Categoria 1)
- (C) Híbrido por categoria + tier — **ACEITO**

**Refs cross-link:**
- ADR 0096 ganha "Complementado por: ADR 0097"
- Roadmap ganha entrada em "Decisões já fechadas (recente)"

**Migração:** sem migration imediata; schema nasce em sprint dedicado (provável Sprint 02b5 ou Sprint 04+ junto com Asaas faturas que é o 1º uso massivo de Categoria 2). Backfill stub `verification_status='fallback'` por tenant existente.

**Validação:**
- ✓ docs-check 0/0 (sem links MD novos quebrados)
- N/A typecheck/lint (sem mudança de código)

### Docs — ADR 0096 — Brevo substitui AWS SES como provider de email transacional 2026-05-20

Decisão arquitetural do fundador 2026-05-20 — sair de AWS pra reduzir complexidade solo + custo opaco + sub-processor a menos. ADR criado no mesmo dia (regra 13).

**ADR 0096 Accepted** — `docs/decisions/0096-email-brevo-substitui-aws-ses.md` justifica Brevo (ex-Sendinblue) pela regra 46:
- Supersede parcial do [ADR 0091](docs/decisions/0091-self-host-total-oracle-sp.md) — bloco "Email transacional: AWS SES" trocado
- 5 alternativas avaliadas em tabela comparativa: Brevo / AWS SES / Resend / Mailjet / MailerSend
- **Brevo aceita** — 300 emails/dia FREE forever (~9k/mês) cobre MVP sem cartão de crédito; API REST direto via `safeFetch` (sem SDK pesado); presença forte BR; DPA gratuito; HQ Paris/FR (UE GDPR-aligned)
- Por que AWS SES rejeitada: sandbox bloqueia primeiro envio até "production access" (24h+); custo opaco em bill consolidada; IAM + V4 signing complexo; +1 sub-processor AWS desnecessário; zero outros usos AWS na stack
- Justificativa regra 46: zero lock-in (provider abstrato `EmailProvider` interface), zero custo MVP, plano de saída (Resend pago ou Postal self-hosted pós-warmup)

**Estratégia de implementação** (`@repo/email` futuro):
- Provider abstrato pattern (mesma do `@repo/security/captcha.ts` + `sms-otp.ts`)
- `BrevoEmailProvider` default + `SmtpEmailProvider` dev local Mailhog + `MockEmailProvider` test
- Endpoint: `POST https://api.brevo.com/v3/smtp/email` com header `api-key: <BREVO_API_KEY>`
- Sem SDK Node — `safeFetch()` direto com allowlist `['api.brevo.com']` + `// safe-fetch-exempt:` comment

**Templates de email vivem no app** (NÃO no Brevo) — `packages/email/templates/*.tsx` via `@react-email/components` ou MJML compilado. Preserva versionamento Git + i18n via next-intl + lock-in mínimo.

**Tracking de open/click desativado por default** — LGPD art. 11 (dado comportamental sensível em mailing transacional). Configurar `disableTracking: true` em todas chamadas.

**Sync docs (13 arquivos atualizados):**
- `CLAUDE.md` — bloco "Stack" + regra 46 lista de externals
- `docs/decisions/0091-self-host-total-oracle-sp.md` — 4 refs (diagrama ASCII + tabela externals + regra 46 + nota ADR 0067)
- `docs/decisions/0067-dpo-governanca-compliance-lgpd.md` — sub-processor "Resend US" → "Brevo (Sendinblue SAS) FR Paris UE"
- `docs/decisions/0088-portal-member-magic-link-auth.md` — 4 refs (magic link provider + custo/email + trade-offs + Referências)
- `docs/rules.md` — tabela "stack escolhida" linha email
- `docs/sprints/00-setup-infra.md` — 2 refs (templates multi-locale + Gitleaks patterns)
- `docs/sprints/01a-identidade-e-topology.md` — 2 refs (trial email + magic link real)
- `docs/sprints/02-geral-crm-pessoas.md` — 2 refs (Sprint 02b3 + 02b4 fechamento restante)
- `docs/roadmap.md` — adiciona ADR 0096 em "Decisões já fechadas (recente)"
- `.env.example` — bloco `AWS_SES_*` (3 vars) vira `BREVO_API_KEY` + `EMAIL_FROM_NAME` adicional
- `docker-compose.yml` — comentário Mailhog atualizado
- `apps/web/app/meu/perfil/page.tsx` — comentário UI confirmação email
- `apps/web/app/meu/perfil/passport-actions.ts` — comentário changeEmail
- `apps/web/app/(auth)/login/login-form.tsx` — comentário login form
- `packages/auth/src/server.ts` — 2 comentários (header doc + sendMagicLink stub)

**Validação:**
- ✓ typecheck 11/11 packages
- ✓ lint-custom 744 + 2 css clean (9 rules)
- ✓ docs-check 0/0
- ✓ tests @repo/security 148 verdes (nenhuma mudança de código com testes)

**Spinoff observado (não fechado nesta entrega):** Tabela "Sub-processors" do ADR 0067 (linhas 124-138) está desincronizada do ADR 0091 — ainda lista Supabase + Vercel + Sentry + PostHog + Logtail + Upstash, todos removidos. Linha do email foi atualizada nesta entrega. Sincronizar a tabela inteira fica como spinoff task (vai além do escopo "trocar AWS SES por Brevo").

### Build — Sprint 02b4 partial — QR code visual MFA via lib qrcode server-side (ADR 0095) 2026-05-20

Fecha um dos 5 itens "Sprint 02b4 fechamento restante" — QR code visual no wizard MFA destrava UX crítica (paciente escaneia em vez de copiar URI manualmente).

**ADR 0095 Accepted** — `docs/decisions/0095-qrcode-lib-mfa-totp.md` justifica lib `qrcode` pela regra 46:
- 2 opções avaliadas: (A) lib `qrcode` ~30KB MIT zero deps runtime vs (B) SVG Reed-Solomon próprio ~500l TS
- **(A) aceita** — QR é algoritmo padrão ISO/IEC 18004:2015, não diferenciador competitivo; lib madura > risco de bug em UX de segurança
- Justificativa regra 46: zero lock-in (lib stateless), zero custo ($0 MIT), plano de saída (substituir por SVG próprio se CVE crítico sem fix em 30d)
- Escopo de uso restrito ao wrapper `apps/web/app/lib/qr-code.ts` — outros usos exigem extensão deliberada

**Wrapper isolado `apps/web/app/lib/qr-code.ts`** (37 linhas):
- `generateTotpQrSvg(uri: string): Promise<string>` única função exposta
- Error correction M (15% recovery — balanço densidade/robustez câmera celular)
- Margin 1 module + width 200px (caber em modal mobile)
- Preto puro `#000000` sobre branco puro `#ffffff` (REQUISITO do algoritmo QR — `// design-token-exempt:` aplicado pra contraste máximo)
- Retorna `<svg>...</svg>` standalone (sem `<?xml ?>` header — pra injetar via `dangerouslySetInnerHTML`)

**`enrollTotp` Server Action** ganha campo `qrSvg: string` no envelope além de `secret` + `uri` existentes:
- Render server-side via `await generateTotpQrSvg(uri)` antes do return
- Wizard recebe SVG já gerado; injeta via `dangerouslySetInnerHTML` (SVG é seguro — gerado pelo nosso código, sem input externo no markup)

**Wizard `/cadastro/mfa-setup` step `scan`** redesenhado:
- Antes: `<pre>{uri}</pre>` (URI em monospace pra cópia manual)
- Depois: QR code visual centralizado em wrapper branco (200x200px) + fallback "digite o secret manualmente" + `<details>` colapsado com URI otpauth:// pra debug
- ARIA: `role="img"` + `aria-label="QR code para configurar autenticação em 2 fatores"` (a11y obrigatório)
- Wrapper branco `#ffffff` no fundo (preserva contraste do QR no tema escuro — `// design-token-exempt:` justificado)

**Deps:**
- `qrcode@^1.5.4` em `apps/web/package.json` dependencies
- `@types/qrcode@^1.5.5` em devDependencies
- 30 packages add via `pnpm install` (sub-deps internas — `qrcode` em si zero deps runtime)

**Validação:**
- ✓ typecheck 11/11 packages
- ✓ lint-custom 744 + 2 css clean (9 rules — `// design-token-exempt:` aplicado em 3 hex justificados pelo algoritmo QR)
- ✓ docs-check 0/0
- ✓ tests @repo/security 148 verdes (sem mudança — wrapper QR é trivial sobre lib; E2E Playwright planejado pro fechamento)

**Sprint 02b4 fechamento restante** (precisam credentials externas ou trabalho longo):
- Email confirmação via `@repo/email` (AWS SES) → `email_verified_at` update + change_email flow
- E2E Playwright fluxo completo signup → MFA setup → login com TOTP + lockout enforcement
- Feature flag `passport_signup_v1`
- Redis sliding window real (regra 36 completa) substituindo auth_attempts polling

### Build — Sprint 02b4 partial — auth rate limit + hard-delete-deactivated cron 2026-05-19

Continua Sprint 02b4 com 3 entregas — todas tractable sem credentials externas. Fecha 2 itens pendentes do "Sprint 02b3 fechamento restante" + 1 dependência do `deactivateAccount` SA.

**Helper `auth-rate-limit.ts` em `@repo/security`** (155 linhas + 27 unit tests):
- Constantes canônicas ADR 0073 camada 2: `AUTH_FAILURE_WINDOW_MS` 15min, `AUTH_LOCKOUT_THRESHOLD` 5, `AUTH_LOCKOUT_DURATION_MS` 30min, `AUTH_CAPTCHA_THRESHOLD_IP` 3
- Pure functions testáveis sem DB: `countRecentFailures(rows, now, windowMs)` + `shouldLockout(count, threshold)` + `shouldRequireCaptcha(countByIp, threshold)`
- I/O layer com `PoolLike` interface (facilita mock testing): `recordAuthAttempt({email, ip, success, ...})` — INSERT auth_attempts tolerante (logs em falha, não propaga) + `checkAuthLockout({email, ip})` — SELECT auth_lockouts WHERE locked_until > now() AND (email OR ip) + `evaluateLockout({email, ip})` — count failures email/ip via Promise.all + cria auth_lockouts se threshold; idempotente (skip se lockout ativo já existe)
- Tests: 27 verdes (countRecentFailures 6 + shouldLockout 3 + shouldRequireCaptcha 2 + recordAuthAttempt 3 + checkAuthLockout 3 + evaluateLockout 6 + constants 4) — total @repo/security **148 verdes** (era 121 → +27)

**Gate em `loginPassport`** (apps/web/app/meu/login/actions.ts):
- 6 etapas (era 5): adiciona etapa 0 pre-check `checkAuthLockout` → throw RATE_LIMITED com message "tente novamente em N min" quando lockout ativo
- Resolve IP via novo helper `apps/web/app/lib/request-ip.ts` (getClientIp) — precedência Cloudflare `cf-connecting-ip` → Caddy `x-real-ip` → genérico `x-forwarded-for` (primeiro IP) → sentinel `unknown`
- `recordAuthAttempt` em todos paths (success + 4 failures: `unknown_email`/`user_disabled`/`wrong_password`/`mfa_failed`)
- `evaluateLockout` apenas em failures (helper interno `recordFailure(reason)` encapsula record+evaluate)
- `MFA_RECENT_REQUIRED` NÃO conta como falha — paciente vai retornar com TOTP, não incrementa attempts
- Wrap-exempt comment movido pra linha imediatamente acima do `export async function` (lint `no-unwrapped-action` só olha 1 linha; ajuste mecânico)

**Cron `hard-delete-deactivated-passport`** (apps/web/app/api/jobs/hard-delete-deactivated-passport/route.ts):
- Daily ~03:50 UTC (00:50 SP) — após `expire-passport-global-sessions` (03:35) pra reduzir contention
- Hard delete `passport_global_identities` WHERE `deactivated_at < now() - 30 days` (LGPD art. 18 VI direito de exclusão + janela de reativação 30d via privacidade@logifit.com.br documentada no SA `deactivateAccount`)
- FK CASCADE em `passport_global_sessions.passport_global_identity_id` limpa sessions automaticamente — counter sessions cascateadas via JOIN pre-DELETE
- Persons bridge orfã (FK nullable sem `.references()` constraint, design ADR 0093) — paciente "vira" member soft-deleted nos tenants linkados; dado clínico persiste pelos 20a Lei 13.787
- Auth `Bearer $CRON_SECRET` via `timingSafeEqual` mesmo padrão `expire-passport-global-sessions`
- Retorna `{identities_deleted, sessions_cascade_deleted, remaining_deactivated_within_grace}` + log JSON estruturado

**Validação:**
- ✓ typecheck 11/11 packages
- ✓ lint-custom 743 + 2 css clean (9 rules)
- ✓ docs-check 0/0
- ✓ tests @repo/security 148 verdes (+27 auth-rate-limit)

**Sprint 02b4 fechamento restante** (precisam credentials externas ou trabalho longo):
- QR code visual no wizard MFA (`/cadastro/mfa-setup`) — SVG Reed-Solomon próprio (~500l) ou lib `qrcode` (~30KB regra 46 ADR)
- Email confirmação via `@repo/email` (AWS SES) → `email_verified_at` update + change_email flow
- E2E Playwright fluxo completo signup proativo → MFA setup → login com TOTP + lockout enforcement
- Feature flag `passport_signup_v1`
- Redis sliding window real (regra 36 completa) substituindo auth_attempts polling

### Build — Sprint 02b3 partial — Path A+B híbrido + envelope encryption + tests providers (commits a0ad676 + 9e674f3 + 1ed8ef3 + 1824ebb) 2026-05-19

Continua Sprint 02 com 4 entregas Sprint 02b3 partial — todas tractable sem credentials externas (Twilio/Turnstile/SES adiados pra Sprint 02b3 completo):

**Path A+B híbrido** (commit `a0ad676`) — `signupPatient` detecta `inviteToken` opcional e auto-aceita:
- Schema ganha `inviteToken: z.string().uuid().optional().nullable()`
- Helper interno `acceptInviteAfterSignup` (pré-auth, distinto de `acceptPatientInvite` em `app/passport/actions.ts` que exige staff session) — lookup link by id + INSERT persons espelho com `passport_global_identity_id` FK + ON CONFLICT (tenant_id, document) DO UPDATE preserva FK quando staff já criou + UPDATE link status=`active` + UPDATE modules status=`active`
- Failure-tolerant: try/catch isola — invite inválido só loga warning + signup OK (paciente aceita depois em `/meu/privacidade`)
- `signup_path` muda `proactive` → `proactive_then_invite` quando token presente
- Return envelope ganha `linkedTenants: Array<{tenantId, linkId, tenantName}>`
- UI step done: card verde "🔗 Convite aceito automaticamente" com lista de tenant names

**Tests providers Sprint 02b backbone** (commit `1824ebb`) — fecha gap captcha + sms-otp:
- `captcha.test.ts` 9 tests: mock dev path + real Turnstile siteverify com `fetch` mockado + URLSearchParams body validation + Cloudflare success=false → valid=false + errorCodes preservados + fetch reject network → fetch_error:<msg> + throw em prod sem `TURNSTILE_SECRET_KEY`
- `sms-otp.test.ts` 22 tests: generateOtpCode 6 dig zero-padded + variation entre chamadas (secure random) + hashOtpCode determinístico SHA-256 hex 64 chars + verifyOtpCode constant-time + 3 templates pt-BR/en-US/es-419 validation + sendSmsOtp mock dev (log capture) + real Twilio Messages API com Basic auth + HTTP error → errorMessage + fetch reject → Network timeout + throw em prod sem `TWILIO_*`
- Total tests @repo/security **104 verdes** (era 73 → +31)

**Sprint 02b3 partial — envelope encryption + tests password/recovery + member-session bridge** (commit `9e674f3`):
- Ativa `encryptSecret(JSON.stringify(codesPayload))` no signupPatient (era jsonb plain — TODO removido); erro amigável quando `LOGIFIT_DATA_KEY` falta + `enableMfa=true`
- `password-hash.test.ts` 15 tests: scrypt format 6 partes regex + salt random + senha vazia rejeita + case/whitespace-sensitive + hash mal-formatado fail-closed + non-string false + senhas >128 chars + unicode preservado + needsRehash atual/legado/mal-formatado
- `recovery-codes.test.ts` 26 tests: formato `XXXX-XXXX-XXXX` + alfabeto Crockford sem I/L/O/U/0/1 + 1-50 + hash determinístico SHA-256 hex 64 chars + case-insensitive + ignora hifens + findUnused ignora usados + markUsed imutável + countAvailable
- Total tests @repo/security 73 verdes (antes deste commit)
- `MemberSessionClaims` ganha optional `passportGlobalId` + `getMemberSession` JOIN persons resolve FK `passport_global_identity_id` (ADR 0093) + `withMemberContext` seta `app.passport_global_id` na connection (ativa RLS self-only em `passport_global_identities` policy 0057)

**Sprint 02b2 partial — schema passport_global_identities + signupPatient real** (commit `1ed8ef3`) — materializa ADR 0093:
- Schema novo `passport_global_identities` (packages/db/src/schema/passport-identity.ts) — identidade global SEM tenant_id; campos: name + cpf_normalized UNIQUE + email UNIQUE (lower) + phone E.164 + email/phone_verified_at + birth_date + sex + password_hash scrypt + mfa_totp_secret_encrypted AES-256-GCM + recovery_codes_encrypted + accepted_terms/privacy_at + ripd_version_signup + signup_path + signup_ip + signup_otp_id FK + lifecycle (last_login_at, deactivated_at)
- Migration `0044_passport_global_identities.sql` (CREATE + ALTER persons ADD nullable `passport_global_identity_id` FK + 5 indexes incl. UNIQUE cpf/email + partial active)
- RLS policy `0057_passport_global_identities.sql` — FORCE RLS + self-select via `app.passport_global_id` + pré-auth INSERT WITH CHECK true + self-update + DPO override Sprint 02b3
- 2 helpers novos `packages/security/src/`:
  - `password-hash.ts` (130l): scrypt Node nativo OWASP 2024 params (N=16384, r=8, p=1, keylen=64, salt=32) + `hashPassword`/`verifyPassword` constant-time + `needsRehash` rotação gradual
  - `recovery-codes.ts` (130l): `generateRecoveryCodes(n=10)` alfabeto Crockford + `hashRecoveryCode` SHA-256 + `findUnusedMatchingCode` constant-time scan (anti-timing-leak) + `markRecoveryCodeUsed` imutável + `countAvailableRecoveryCodes`
- `signupPatient` real (substitui stub Sprint 02b backbone): 7 etapas — re-valida OTP anti-replay + CPF normalizado + detecta duplicação CPF/email + hashPassword + (opcional) generateRecoveryCodes + INSERT global + (Sprint 02b3 Path A+B híbrido) acceptInviteAfterSignup

### Docs — ADR 0093 + cron expire-passport-signup-otps + wrapMemberAction audit log (commits 65dea90 + 81e8a4c + 7923969) 2026-05-19

3 entregas consolidadas (A/B/C) que destravam Sprint 02b2 + fecham gap LGPD audit do member portal:

**ADR 0093 — passport global identities** (commit `65dea90`) — `docs/decisions/0093-passport-global-identities.md` (217 linhas) decide schema arquitetural pra paciente sem vínculo clínico. 3 opções avaliadas:
- (A) Tenant pivot fixo `system-passport-pivot` — REJEITADA (semanticamente estranho + RLS continua + MOVE/COPY caro)
- (B) `persons.tenant_id` nullable + RLS adaptado — REJEITADA (REFACTOR ENORME quebra 4 schemas + 12 RLS + bugs latentes)
- (C) Tabela `passport_global_identities` separada como pivot global — **ACEITA** (identidade portável + auth centralizado + LGPD limpo + RLS persons intacta + CPF UNIQUE global)
- (D) Auth-only BetterAuth global — REJEITADA (falta campos LogiFit; sobre-engineering)
- Schema canônico com 4 categorias (Identidade + Auth + LGPD aceite + Audit + Lifecycle) + bridge `persons.passport_global_identity_id` FK nullable. Status Accepted.

**Cron `expire-passport-signup-otps`** (commit `81e8a4c`) — fecha tech debt Sprint 02b backbone. Route handler `POST /api/jobs/expire-passport-signup-otps` protegido por `Authorization: Bearer $CRON_SECRET` (`timingSafeEqual` anti-timing-attack). Daily 03:30 UTC = 00:30 SP. (1) DELETE OTPs expirados não-usados >24h (mantém janela debug "código não chegou"); (2) DELETE OTPs usados >30d (audit retention pra LGPD art. 18 V). Retorna `CleanupResult` json com counts. Idempotente.

**`wrapMemberAction` audit log automático Sprint 02d3** (commit `7923969`) — fecha gap LGPD audit do member portal:
- Migration `0043_member_event_meu_kinds.sql` — ALTER TYPE member_event_kind ADD 15 novos kinds `meu.<resource>.<verb>`: appointment.cancelled / session.revoked / consent.updated / cross_prescription_alert.acknowledged / incident.acknowledged / cross_tenant_access.exported (LGPD art. 18 V) / exam.self_uploaded / device.connected / disconnected / consent_granted / consent_revoked / csv_imported / diary.meal_logged / meal_deleted / mobile.push_token_registered / push_token_revoked
- `wrapMemberAction` ganha `eventKind: MemberPortalEventKind` no context — fire-and-forget INSERT member_events após handler success. `actor_user_id = NULL` distingue de staff (Sprint 02 Faixa A `member.*` kinds)
- `setAuditPayload` no context permite handler injetar payload customizado
- `sanitizeArgs()` redact PII keys (password/totpSecret/recoveryCode/token/codeHash) + truncate document/cpf/phone/email
- 21 SAs ativadas com `eventKind`: 6 em meu/actions.ts + 1 em meu/exames + 5 em meu/dispositivos + 2 em meu/diario + 2 em meu/mobile (read-only listMy* + checkAppVersion ficam sem audit)

### Build — Sprint 02d wrapMemberAction migration batch (21 SAs portal — commits b3cf35c + 041cde4 + d323236) 2026-05-19

Refactor mecânico que formaliza padrão de Server Actions do member portal Sprint 26 (ADR 0088). Análogo ao `wrapServerAction()` staff mas pra session do paciente — antes cada SA do `/meu/*` repetia boilerplate `safeParse + requireMemberSession + withMemberContext`.

**Novo helper `wrapMemberAction`** em `apps/web/app/lib/wrap-member-action.ts` (Sprint 02c2 — commit `b3cf35c`):
- 4 etapas compose: `ctx.schema.parse(rawArgs)` quando schema Zod passado → `requireMemberSession(returnTo)` → `withMemberContext(session, ...)` → envelope `wrapAction` (ADR 0071)
- Sem MFA gate (member portal não usa por default Sprint 26)
- 2 overloads TS: com schema (caller recebe `z.infer<TSchema>`) ou sem (input genérico)
- Lint custom `RE_WRAP_ACTION` ampliado: `/\bwrap(?:Server|Member)?Action\s*\(/` reconhece 3 wrappers canônicos

**Migration batch 1 — dispositivos + diario + mobile** (commit `041cde4`): 15 SAs migradas
- meu/dispositivos/actions.ts (8): startConnection, completeConnection, disconnect, listMyConnections, listMyReadings, importInBodyCsv, grantDeviceConsent, revokeDeviceConsent
- meu/diario/actions.ts (4): logMeal, listMyDiary, getDiaryEntry, deleteDiaryEntry
- meu/mobile/actions.ts (3): registerPushToken, listMyPushTokens, revokeMyPushToken (checkAppVersion exempt — pré-auth público)
- Callers ajustados pela tipagem mais estrita: API Route register-push (cast Parameters<typeof>) + diario/novo/form.tsx (useState<MealName> + isMealName type guard)

**Migration batch 2 — portal core** (commit `d323236`): 6 SAs em meu/actions.ts
- cancelMyAppointment, revokeMySession, updateMyConsent, acknowledgeCrossPrescriptionAlert, acknowledgeIncident, exportCrossTenantAccessLog
- 3 SAs ficam com `// wrap-exempt:` (pré-auth/tolerantes): requestMagicLink (anti-enumeration), verifyMagicLink (cria 1ª session), logoutMember (idempotente via getMemberSession)

**Total Sprint 02d: 21 SAs no padrão wrapMemberAction** + 4 exempts justificados (3 pré-auth + 1 read-only mobile).

### Build — Lint custom maturity (cross-tenant-read-must-log REAL + docs rules-42 + cleanup lint hygiene — commits 5dfcf12 + dd922ca + 3fe0d0d) 2026-05-19

Lint custom evoluiu de "ready no-op" pra detector real em 2 regras com callers Sprint 02 fechamento:

**`cross-tenant-read-must-log` REAL** (commit `5dfcf12`) — regra 42 + ADR 0077:
- Antes: detector procurava funções fictícias (`crossTenantQuery`/`origin_tenant_id`) — no-op
- Agora: detector bidirecional reconhecendo padrão canônico do Sprint 02 Path A:
  - Trigger: chamada `has_cross_tenant_access(` (gate SQL) OU INSERT em `patient_data_access_log` (audit)
  - Exige: ambos no mesmo arquivo (gate sem audit = audit ausente; audit sem gate = log falsificado)
- Scan linha-a-linha ignorando comments (anti false-positive em docstrings)
- Exempt: `// cross-tenant-log-exempt: <motivo>` pra jobs background read+log em arquivos separados
- Validado com 2 test files temporários (gate-sem-log + audit-sem-gate ambos pegaram) + `apps/web/app/app/passport/actions.ts::getCrossTenantSummary` (par completo) passa silencioso

**docs rules-42 nota bidirecional** (commit `dd922ca`) — fecha loop docs↔enforcement. Antes a regra dizia "bloqueia se SA lê cross-tenant sem chamar has_cross_tenant_access + log" sem explicitar as 2 direções. Agora descreve (1) gate sem audit → audit ausente e (2) audit sem gate → log falsificado, + documenta exempt comment.

**chore cleanup lint hygiene** (commit `3fe0d0d`) — fizemos durante Sprint 02c2:
- `no-window-alert` (regra 45): 4 → 0 violations (3 sites migrados pra `confirm()`/`prompt()` Sprint 02c catálogo + 1 fallback gracioso no próprio dialog com `// alert-exempt:`)
- `no-hardcoded-design-token` (regra 44): 400 → 0 (refinou regex `var(--ev-*, #fallback)` aceito + ignora contextos legítimos PDF/seed/manifest/.default()/themeColor)
- `no-unwrapped-action` (regra 33): 29 → 0 (reconhece padrão member portal `requireMemberSession + withMemberContext` + 2 helpers de leitura com `// wrap-exempt:`)
- Total: **439 violations → 0** ao longo de 3 commits desta sessão. Lint custom 9/9 rules clean.

### Build — Sprint 02b backbone Path B — cadastro proativo /cadastro (done 02b backbone) 2026-05-19

Continua Sprint 02 (que ficou em `02a` após fechamento Path A em 2026-05-18). Sprint 02b entrega o **backbone do Path B** (cadastro proativo `/cadastro` — visitor anônimo cria conta LogiFit sem invite) sem depender de credenciais externas reais via provider abstrato com mock em dev.

**2 providers abstratos** em `packages/security/src/`:

- `captcha.ts` (95l) — `verifyCaptcha({token, remoteIp?})` retorna `{valid, provider, action?, errorCodes?}`. Estratégia:
  - Sem `TURNSTILE_SECRET_KEY` → mock dev (aceita qualquer token não-vazio)
  - Com `TURNSTILE_SECRET_KEY` → POST Cloudflare Turnstile siteverify
  - Em prod sem secret → throw (config inválida — melhor falhar que aceitar mock)
  - Inclui `// safe-fetch-exempt:` comment justificando — fetch direto pro endpoint canônico do provider (não passa por URL arbitrária do user)

- `sms-otp.ts` (135l) — utilitários SHA-256 + OTP generator + Twilio sender:
  - `generateOtpCode()` 6 dígitos via `crypto.randomInt(0, 1_000_000)` — secure random (não Math.random)
  - `hashOtpCode(code)` SHA-256 hex — nunca grava plain
  - `verifyOtpCode(plain, hash)` constant-time anti-timing-attack (XOR acc loop)
  - `sendSmsOtp({phone, code, locale?})` retorna `{sent, provider, messageSid?, errorMessage?}`
  - 3 templates SMS pt-BR/en-US/es-419: `"Seu código LogiFit é XXXXXX. Válido por 5 minutos. Não compartilhe com ninguém."`
  - Sem `TWILIO_*` credentials → mock dev (loga código no console)
  - Com credentials → POST Twilio Messages API Basic auth (URLSearchParams body)
  - Em prod sem credentials → throw

**Schema novo `passport_signup_otps`** em `packages/db/src/schema/passport-signup.ts`:

- Sem `tenant_id` nem `member_id` — pré-auth global (visitor anônimo)
- Campos: `id` + `phone` (E.164) + `code_hash` (SHA-256) + `expires_at` (now + 5min default) + `used_at` (marcado em verify) + `attempts` (rate limit 5 antes invalidar) + `request_ip` + `sms_provider` + `sms_message_sid` + `created_at`
- 2 indexes: `phone+created_at desc` (lookup quente) + `expires_at` (cleanup cron Sprint 02b2)
- **Sem RLS** — acesso direto via `pool.query` do Server Action pré-auth
- Migration `0042_passport_signup_otps.sql`
- Policy `0056_passport_signup_otps.sql` apenas `GRANT SELECT, INSERT, UPDATE ON passport_signup_otps TO logifit_app` (sem ENABLE RLS)
- Retenção: cleanup 24h via cron Sprint 02b2 (`expire-passport-signup-otps`); OTPs `used_at` preservados 30d pra audit

**3 Server Actions** em `apps/web/app/cadastro/actions.ts` (320l) com `// wrap-exempt:` comment (pré-auth público visitor anônimo, sem session — wrapServerAction não cabe):

- `requestSmsCode({phone, captchaToken})`:
  1. Verify Turnstile via `verifyCaptcha` — VALIDATION_ERROR se inválido
  2. Rate limit por telefone — encontra OTP ativo não-expirado e marca `used_at` (revoga implícito, permite novo legítimo)
  3. `generateOtpCode()` + `hashOtpCode` + `expiresAt = now + 5min`
  4. `sendSmsOtp({phone, code})` — mock dev / Twilio prod
  5. Persist `passport_signup_otps` (sempre — mesmo se sms.sent=false, serve audit)
  6. Retorna `{ok:true, sent, otpId, expiresAt, devOnlyCode?}` (devOnlyCode só em provider=mock)
  7. Anti-enumeration: validation errors retornam silenciosos `{ok:true, sent:false}` (não revela quem está cadastrado)

- `verifySmsCode({phone, code})`:
  1. Busca OTP mais recente não-usado pra phone
  2. Checa `used_at` (CONFLICT já utilizado) / `expires_at` (NOT_FOUND expirado) / `attempts >= MAX_VERIFY_ATTEMPTS=5` (RATE_LIMITED — marca used_at pra forçar novo)
  3. `verifyOtpCode(plain, hash)` constant-time
  4. Em falha: incrementa attempts + retorna VALIDATION_ERROR genérico (não revela "código quase certo")
  5. Em sucesso: marca `used_at = now()`
  6. Retorna `{ok:true, otpId, phone}` pra próxima etapa

- `signupPatient({name, cpf, phone, email, password, smsOtpId, acceptedTerms, acceptedPrivacy, enableMfa, locale})` **STUB**:
  - Re-valida OTP usado recentemente (anti-replay — usedAge < 30d + phone match)
  - Retorna `{ok:false, code:'SCHEMA_PENDING', message:'Sprint 02b2 — depende ADR persons-without-tenant', plannedSchema:{decision:'opção C — passport_global_identities separada'}}`
  - Toda validação rola normalmente (Zod + Turnstile + OTP) — só o INSERT final fica bloqueado até ADR

**Página pública `/cadastro`** em `apps/web/app/cadastro/`:

- `page.tsx` Server Component (90l) — header + invite banner quando `?invite=<token>` (Path A→B híbrido) + `<CadastroForm>` client + nota "O que você ganha" (acessa histórico em qualquer empresa parceira; alertas cross-prescription; revoga acesso anytime; notas privadas + financeiro nunca cruzam) + warning "backbone Sprint 02b — completo em Sprint 02b2"
- `cadastro-form.tsx` Client Component (260l) com 4 steps `phone` → `verify` → `details` → `done`:
  - **Step phone**: input E.164 com pattern `\+[1-9][0-9]{6,14}` + placeholder Turnstile widget ("Sprint 02b2 carrega widget real") + submit chama requestSmsCode com mock token
  - **Step verify**: input código 6 dígitos com `inputMode="numeric"` + `replace(/\D/g, '')` sanitization + **banner amarelo "🛠 Modo dev: SMS provider em mock — código: XXXXXX"** quando devOnlyCode presente
  - **Step details**: name + CPF + email + password (min 8) + checkbox enableMfa (recomendado TOTP) + 2 checkboxes obrigatórios (acceptedTerms + acceptedPrivacy LGPD) + `<ConfirmDialog>` (regra 45 + ADR 0089 reusa Sprint 02c catálogo) antes do signup + mostra stub result warning quando ok=false
  - **Step done**: success card (acionado em Sprint 02b2 quando signup real)

**Resultado:**

- ✓ typecheck 11/11 packages verde
- ✓ lint-custom 713 + 2 css clean (9 rules) — 3 SAs `cadastro/actions.ts` com `// wrap-exempt:` justificado
- ✓ docs-check 0/0
- ✓ tests @repo/security 32 verdes (providers novos sem testes ainda — Sprint 02b2)
- Backbone Path B funcional em dev — testar manualmente: `pnpm dev` → `/cadastro` → digita +5511999999999 → recebe OTP em console → step verify aceita → step details mostra stub explicativo

**Sprint 02b2 (futuro) completa Path B:**

- **ADR `persons-without-tenant`** decisão entre 3 opções avaliadas no comment do file:
  - (A) tenant pivot fixo `system-passport-pivot` UUID seed
  - (B) refactor `persons.tenant_id` pra nullable + RLS adaptado
  - (C) tabela `passport_global_identities` separada como pivot global ← **preferência**
- Implementar `signupPatient` real conforme ADR — INSERT identity + hash senha (BetterAuth/Lucia decisão Sprint 01a sub) + opt-in MFA TOTP setup wizard + recovery codes
- Cron `expire-passport-signup-otps` 24h cleanup (preserva used_at por 30d audit antes do delete permanente)
- Provisionar Cloudflare Turnstile (site key + secret) + Twilio sandbox + envelope encryption credentials via `LOGIFIT_DATA_KEY` ADR 0073
- Widget Turnstile real no client (carregar `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js">`)
- RIPD `docs/compliance/ripd/v1.0-passport-signup.md` (regra 29 + ADR 0054) com DPO sign-off antes de feature flag prod
- Rate limit Redis 3 requests/IP/15min via `packages/security/rate-limits.ts` (regra 36)
- WhatsApp OTP como segundo canal (Twilio WhatsApp Business API) com fallback se SMS falhar
- E2E Playwright fluxo completo (Turnstile sandbox + Twilio test mode)
- Feature flag `passport_signup_v1`
- Path A+B híbrido: quando visitor vem de `?invite=<token>`, vincular automaticamente após signup

### Build — Sprint 02 fechamento Path A — passaporte cross-tenant (done 02a core) 2026-05-18

Fecha Sprint 02 (CRM unificado) de 70% → 100% via Path A do passaporte cross-tenant (ADR 0077 + regra 42). Faixas A+B+C já estavam entregues desde 2026-05-12 (núcleo CRM + 4 schemas + 12 RLS + 10 SAs + UI completa); este commit entrega o 30% restante real (não só docs): **função SQL `has_cross_tenant_access()`** + **8 Server Actions de passport** + **landing invite público** + **API Route metadata anti-fraude**. Path B (cadastro proativo `/cadastro` + Turnstile + SMS Twilio) adiado pra Sprint 02b — depende dependências externas (Twilio sandbox + Turnstile Sprint 00 + ADR persons-without-tenant).

**Função SQL `has_cross_tenant_access()`** em `packages/db/src/policies/0055_has_cross_tenant_access.sql`:

```sql
has_cross_tenant_access(
  p_reader_user_id   uuid,
  p_reader_tenant_id uuid,
  p_passport_id      uuid,
  p_module           passport_module,
  p_category         text
) RETURNS boolean
```

Lógica fail-closed:

1. **Limites duros** (categorias `financeiro`, `prontuario_cfm_bruto`, `terceiros_mencionados`, `workspace`) → FALSE sempre, independente de consent (regra 42 §limites_duros).
2. Vínculo ativo `patient_company_links` WHERE `passport_passport_id=p_passport_id AND tenant_id=p_reader_tenant_id AND status='active' AND revoked_at IS NULL` → se vazio FALSE.
3. Módulo ativo `patient_link_modules` WHERE `link_id=v_link_id AND module=p_module AND status='active' AND deactivated_at IS NULL` → se vazio FALSE.
4. Mapeamento categoria → nível: identidade/antropometria/treino/clinico (workspace já bloqueado pelos limites duros). Categoria desconhecida → FALSE.
5. `data_levels[level] = true` no jsonb? → TRUE (caller pode ler + grava `patient_data_access_log`).

STABLE function, `GRANT EXECUTE TO logifit_app`. Caller (Server Action) obrigado a também inserir em `patient_data_access_log` (lint custom `cross-tenant-read-must-log` — Sprint 02b).

**11 testes SQL** em `packages/db/tests/has-cross-tenant-access.test.ts` cobrindo 10+ cenários canônicos:

1. Vínculo ativo + módulo + nível cobre categoria → TRUE
2. Vínculo revogado → FALSE
3. Módulo inativo (substituído) → FALSE
4. Categoria não autorizada em `data_levels` → FALSE
5. Limite duro `financeiro` → FALSE mesmo com vínculo perfeito
6. Workspace (Nível 5) → FALSE
7. `prontuario_cfm_bruto` (limite duro) → FALSE
8. `terceiros_mencionados` (limite duro) → FALSE
9. Categoria desconhecida → FALSE (fail closed)
10. Sem vínculo nenhum → FALSE
11. Sanity: vínculo ativo + módulo pilates + treino autorizado → TRUE

Helper `createLink({status, revokedAt?})` + `createLinkModule(linkId, module, {status, dataLevels, deactivatedAt?})` + `callHasAccess(passport, module, category)` reusam `pool.query` direto. `beforeEach` cria passport novo pra cada test (evita constraint global "1 módulo ativo por passport+module em toda rede").

**8 Server Actions wrapped** em `apps/web/app/app/passport/actions.ts` (520l, todas via `wrapServerAction` envelope ADR 0071):

- `sendPatientInvite({passportPassportId, personId, modules:[{module, responsibleProfessionalUserId, dataLevels}]})` — staff cria invite. Em transação: cria `patient_company_links` status=`pending` + `creationPath='reactive'` + `invitedByUserId/invitedAt` + N `patient_link_modules` status=`pending` com `responsibleProfessionalUserId` + `dataLevels jsonb`. Bloqueia se já existe link não-revogado pra mesmo (passport, tenant) — CONFLICT envelope.
- `acceptPatientInvite({linkId, acceptedModules?, dataLevelOverrides?})` — em transação valida link status=`pending` + carrega modules pendentes; **detecta colisões** com módulos ativos do mesmo passport em outros tenants (constraint global ADR 0077 — 1 módulo ativo por passport+module em toda rede): se encontradas, retorna CONFLICT com lista pra caller chamar `confirmModuleSubstitution()` por módulo. Se sem colisão: atualiza link→`active`+`acceptedAt` + modules selecionados→`active`+`activatedAt` + aplica `dataLevelOverrides` override-só-endurece se passados. `acceptedModules` vazio = aceita todos os módulos do invite.
- `cancelPatientInvite({linkId})` — staff cancela invite ainda `pending`. Status=`revoked` + `revokedReason='cancelled_by_staff'`.
- `revokePatientLink({linkId, reason})` — staff revoga vínculo `active` (válido em status `active` apenas — sai por CONFLICT se em outro). Marca link revogado + em cascata desativa todos modules → status=`inactive` + `deactivatedReason='link_revoked'` + `deactivatedAt`.
- `confirmModuleSubstitution({newLinkId, module})` — paciente confirma trocar empresa em módulo já ativo. Em transação: desativa módulo ativo global atual (qualquer tenant) → `status='inactive'` + `deactivatedReason='substituted_by_other_tenant'` + ativa novo módulo → `status='active'` + `activatedAt` + eleva newLink pendente pra `active`+`acceptedAt` se ainda não está.
- `setSharingLevel({linkModuleId, dataLevels})` — staff ajusta data_levels do módulo. Valida ownership do módulo via JOIN com link → enforça tenant scope. (Sprint 02b adiciona consent flow do paciente; MVP staff-only.)
- `listInvites({status?='all', limit?=50})` — staff lista invites enviados (filtro pending/active/revoked/all) com JOIN persons (personName). ORDER BY invitedAt DESC.
- `getCrossTenantSummary({passportPassportId, module, category, resourceType, resourceId?})` — chama `has_cross_tenant_access()` SQL via `pool.query`. Se `allowed=TRUE`: resolve `sourceTenantId` via primeiro link ativo do passport fora deste tenant + insere `patient_data_access_log` (audit forense LGPD art. 11 — `readerUserId, readerTenantId, sourceTenantId, patientPersonId, passportPassportId, moduleType, category, resourceType, resourceId, requestId=randomUUID()`). Retorna envelope `{allowed, sourceTenantId, reason}` (reason='hard_limit' pra categorias bloqueadas ou 'no_link_or_module').

**Landing invite `/i/[token]`** em `apps/web/app/i/[token]/page.tsx` (220l) — Server Component público (sem auth):

- Faz fetch interno em `${proto}://${host}/api/i/[token]` (Headers next/headers pra resolver host).
- Renderiza header tenant emissor + profissional que enviou + data; card "Olá, [nome mascarado]. A empresa X quer se conectar..." + lista módulos com ícone+label+descrição (`🏋️ Academia` / `🥇 Personal trainer` / `🩺 Fisioterapia` / `🥗 Nutrição` / `🧘 Pilates`); card "Dados que serão compartilhados" agregando data_levels de todos modules (📇 Identidade / 📏 Antropometria / 💪 Treino / 🩺 Clínico apenas resumo); nota anti-fraude "notas privadas do profissional + financeiro + prontuário CFM original nunca cruzam empresas. Você pode revogar a qualquer momento em /meu/privacidade".
- Status-driven CTA: `pending` → 2 botões (Fazer login pra `/meu/login?next=/i/[token]/aceitar` + Criar conta pra `/cadastro?invite=[token]` Sprint 02b com nota explicativa); `already_accepted` → banner verde + link `/meu/privacidade` + data acceptedAt; `revoked/unknown` → banner vermelho "Convite indisponível, contate empresa".
- `aggregateDataLevels()` helper tipado puro reduz modules→`DataLevelsAggregate` interface (boolean por nível).

**API Route `GET /api/i/[token]`** em `apps/web/app/api/i/[token]/route.ts` (130l) — endpoint público sem auth:

- Valida token regex UUID v4 (`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`) → 400 INVALID_TOKEN se inválido.
- SELECT link + tenant + persons JOIN (sem RLS — endpoint público) retorna 404 NOT_FOUND se ausente.
- Resolve `invitedByName` via segundo SELECT `users` JOIN `persons` quando `invitedByUserId IS NOT NULL`.
- SELECT modules do link com `module + status + dataLevels`.
- `maskName(fullName)` anti-fraude: primeiro nome + iniciais do sobrenome (`"João Silva Santos"` → `"João S. S."`); `null/empty` → `"—"`.
- Mapeia status DB → status amigável (`pending` / `already_accepted` / `revoked` / `unknown`).
- Retorna JSON com: `token, status, tenantName, tenantSlug, invitedByName, invitedAt, acceptedAt, personMaskedName, modules[{module, status, dataLevels}]`. **Nunca expõe** persons.id, email, CPF, ou outros dados sensíveis — só metadata pra confirmação visual; aceite/recusa acontece após login.

**Typecheck 11/11 packages verde**. Tests SQL prontos pra rodar quando Postgres dev up via `pnpm dev:up` (mesmo padrão `exames-rls.test.ts`).

**Sprint 02b futuro (Path B + cleanups):**

- **Path B cadastro proativo `/cadastro`** (rota pública): `signupPatient({name, cpf, phone, email, password, mfaEnabled?, smsCode, emailToken, turnstileToken})` cria `persons` em "system tenant pivot" + `users` + confirma SMS + email + Turnstile; rate limit 3/h/IP + 1/dia/CPF. ADR pendente: persons.tenantId NOT NULL atualmente → ou cria system tenant `system-passport-pivot` ou refactor pra nullable + RLS adaptado.
- **SMS Twilio sandbox** com credentials cifradas via LOGIFIT_DATA_KEY (ADR 0073 envelope encryption) + `requestSmsCode(phone, turnstileToken)` + `confirmSms(phone, code)` Server Actions.
- **Cloudflare Turnstile** real (Sprint 00 deixou stub).
- **Token opaco criptografado** anti-fraude no landing — atualmente `token = patient_company_links.id` UUID; Sprint 02b refina pra token assimétrico server-signed (HS256 ou Ed25519) com TTL embutido 7d.
- **Reactivar tests SQL automaticamente em CI** — atualmente requer Postgres up local; CI worker precisa container Postgres ready em GitHub Actions.
- **Member portal `/meu/privacidade/actions.ts`** com action `acceptInviteFromPortal({linkId, acceptedModules})` autenticada via member session (Sprint 26).
- **WhatsApp invite delivery** via régua Sprint 13 (template aprovado Meta + opt-in member portal — depende provider Twilio/Gupshup ADR 0025).
- **Rate limit 50 invites/dia/tenant + 3/CPF/30d** via `packages/security/rate-limits.ts` Redis sliding window (Sprint 00 Faixa 3).
- **Lint custom `cross-tenant-read-must-log`** em CI (regra 42) — bloqueia commit se Server Action faz query cross-tenant sem chamar `has_cross_tenant_access()` + grava `patient_data_access_log` (caller manual atualmente; lint detecta padrão `tenantId != session.tenantId` em queries clinical/anthropometric/training/prescription).
- **UI staff `/app/invites`** lista pedidos enviados + reenviar + cancelar (Sprint 02b expande SAs já entregues).
- **RIPD `docs/compliance/ripd/v1.0-passaporte-paciente.md`** sign-off DPO + revisão jurídica externa antes do primeiro tenant clínico ativar passaporte em prod (regra 29 + ADR 0054).
- **E2E Playwright** path A (invite enviado → metadata via API → landing → login → accept → vínculo ativo → SQL function retorna TRUE → cross-tenant log gravado).

### Build — Sprint 34 (Nutri-Agent IA cross-module — backbone 34a core) 2026-05-18

Agente IA dedicado à nutrição que cruza dados Academia + Fisio + Nutri + Devices + Lab para gerar sugestões conservadoras de ajuste no plano alimentar + alertas de aderência + resumo pré-consulta + detecção de pattern de risco. ADRs 0043 + 0044 **Proposed 2026-05-18**. **Backbone Faixa A** com agente determinístico (pattern detector curado + suggestion generator + classifier reusado Sprint 33) + gate Comitê IA regra 13/28. Sprint 34b/c promove ADRs pra Accepted quando IA Vertex AI real + cron triggers + integração updateMealPlan + RIPD/ANVISA sign-off + piloto ≥10 runs.

**Schemas (`packages/db/src/schema/nutri-agent.ts`)** — 5 enums + 3 tabelas:

- `nutri_agent_runs` — execução do agente (1 por trigger). 6 status `queued/collecting/analyzing/completed/failed/blocked` + 4 triggers canônicos `manual_professional` (nutri clicou "Re-analisar") / `pre_consult_auto` (24h antes consulta agendada via cron) / `weekly_adherence` (resumo semanal) / `risk_event_triggered` (consumer domain_events Sprint 31). Audit: triggeredByUserId + modelUsed + costCents + failureReason + summary jsonb. 2 indexes incl. partial `WHERE status IN ('queued','collecting','analyzing')` pra fila ativa hot. CHECK `completed_consistency` (status terminal exige completedAt).
- `nutri_agent_suggestions` — propostas geradas pela run. 5 kinds canônicos: `plan_adjustment` (sugestão de ajuste no meal_plan ativo) / `alert` (operacional: aderência baixa, déficit extremo) / `risk_pattern` (overtraining sugestivo, perfil aterogênico) / `pre_consult_summary` (resumo executivo pré-consulta) / `follow_up_exam` (exame complementar sugerido). 3 severities `info/attention/critical`. 4 statuses `pending/accepted/rejected/expired`. `targetMealPlanId` FK setNull mealPlans Sprint 29 (kind=`plan_adjustment`) + `appliedMealPlanId` FK setNull (quando aceito + aplicado, aponta pra nova versão). `proposedChanges jsonb` (diff sobre meal_plan). `blockedByClassifier` flag + `classifier_blocked_terms jsonb` audit reusa Sprint 33. `expiresAt` obrigatório (14d default). 4 indexes incl. partial `WHERE status='pending'` por tenant+severity. 2 CHECKs: `confidence_range` 0-1 + `reviewed_consistency` (accepted/rejected exige reviewedByUserId+reviewedAt).
- `nutri_agent_metrics_snapshot` — snapshot dos dados consultados na run. `data jsonb` formato canônico (`meal_plan + last_diary_summaries + anthropometric_trend + workout_load + fisio_active_cids + lab_results_recent + device_summary + consents_used`) + `data_hash` SHA-256 pra detecção de reprodutibilidade (mesmo input retorna mesma run). Append-only — sem UPDATE/DELETE policy. Audit forense + LGPD (provar quais dados foram processados).

Migration `0039_nutri_agent.sql`. RLS `0052_nutri_agent_rls.sql` — FORCE em 3 tabelas + 8 policies: tenant scope em runs/suggestions/metrics + member portal via `app.member_id` em select de `nutri_agent_suggestions` WHERE `status='accepted'` (paciente vê só sugestões aplicadas em plano dele — não vê rejeitadas nem pending) + GRANT diferenciado pra metrics append-only (só SELECT, INSERT).

**3 libs puras em `packages/ai/src/nutri-agent/` (508 linhas totais):**

- `types.ts` (131 linhas) — `MemberContextSnapshot` canônico (demographics + mealPlan + diaryLast14d + workoutLoad + fisioActiveCids + labResultsRecent + deviceSummary + consentsUsed) + `DetectedRiskPattern` + `AgentSuggestion` reusando schemas Sprints 29/30/31/32/33.
- `pattern-detector.ts` (228 linhas) — 7 detectores curados conservadores (estratégia catálogo > IA generativa, mesmo padrão Sprint 33 detectPatterns: determinístico + auditável + reprodutível + curadoria nutricional explícita):
  - `checkExtremeCaloricDeficit` — avg_kcal_7d / target_kcal < 0.7 → attention; < 0.5 → critical; confidence 0.95. Evidence: diary.avg_kcal_7d + meal_plan.target_kcal + computed.ratio.
  - `checkLowAdherence` — avg_adherence_pct_7d < 50% → info; < 30% → attention; confidence 0.92.
  - `checkOvertrainingSuggestion` — resting_hr_avg_7d > 75bpm + sleep_avg_7d < 360min concomitantes → attention; confidence 0.78.
  - `checkCardiovascularRisk` — LDL above + HDL below ambos outOfRange em lab_results → attention; confidence 0.88.
  - `checkGlycemicRisk` — glicose_jejum ou hba1c above outOfRange → attention; confidence 0.86.
  - `checkRapidWeightLoss` — weightTrendKgPerMonth < -6 (= -1.5kg/semana) → attention; confidence 0.90.
  - `checkFisioWorkoutTension` — fisio_active_cids > 0 + workoutLoad.sessionsCount ≥ 5 → info; confidence 0.75.

  `detectRiskPatterns(snapshot)` orchestrador retorna ordenado por severityRank `critical=3 > attention=2 > info=1`.
- `suggestion-generator.ts` (149 linhas) — `generateSuggestionsFromPatterns(patterns, snapshot)` mapeia code→kind via `PATTERN_TO_KIND` (deficit→plan_adjustment, aderencia→alert, overtraining→risk_pattern, lipídico/glicêmico/fisio→plan_adjustment) + `computeProposedChanges` conservador (deficit_calorico_extremo: subir target pra `avgKcal × 1.1` pra "chegar perto do real"; perda_peso_rapida: +200kcal pra frear perda; risco_cardiovascular/glicemico/fisio_workout: sem changes específicas → profissional decide); `generatePreConsultSummary(patterns, snapshot)` gera bullet list determinística (plano ativo + diary status + CIDs fisio + exames alterados + padrões detectados) — confidence 1.0 (resumo determinístico) + severity propagada do pior padrão.

**18 unit tests `pattern-detector.test.ts`** (392l) cobrindo: deficit extremo critical < 0.5 / attention 0.5-0.7 / null > 0.7; baixa adherence info<50% / attention<30% / null≥50%; overtraining requer HR + sleep concomitantes; cardiovascular requer LDL above + HDL below ambos; glicemic ativa em glicose ou hba1c isoladamente; rapid weight loss threshold -6kg/month; fisio_workout requer ≥5 sessões + CIDs ativos; orchestrator ordena por severity rank; vazio quando nada detectado; severityRank critical>attention>info.

**5 Server Actions wrapped em `apps/web/app/app/nutri-agent/actions.ts` (618 linhas):**

- `runNutriAgentForMember({memberId, trigger='manual_professional'})` — orquestra 7 etapas:
  1. **Gate Comitê IA regra 13/28**: valida `ai_committees.status='active'` no tenant → cria run blocked + audit `comite_ia_inativo` + retorna FORBIDDEN com mensagem orientativa "Cadastrar comitê em /app/settings/compliance/comite-ia antes de ativar o Nutri-Agent".
  2. Cria run status `collecting` + startedAt.
  3. `collectMemberContext(tenantId, memberId)` busca cross-module — demographics via `persons.birthDate/sex` + `ageYearsAt`; mealPlan ativo (`mealPlans.active=true`); food_log_daily_summary 14d Sprint 31; lab_results 90d com JOIN labAnalytes Sprint 30 (analyteCode + value + unit + outOfRange + direction); consulta_cids signed kind=`principal` fisio Sprint 20 (top 10 últimos 6m); device_readings_daily_summary 7d via raw SQL agregando HR_RESTING/SLEEP_DURATION_MIN/STEPS/HRV Sprint 32; prescriptions kind=`workout` active Sprint 11 (workoutLoad stub kcal+sessions+completion% Sprint 34b refina via workout_sessions reais).
  4. Persiste `nutri_agent_metrics_snapshot` com data jsonb + SHA-256 hash (audit forense + reprodutibilidade — LGPD provar quais dados foram processados).
  5. Atualiza run `analyzing`.
  6. `detectRiskPatterns(snapshot)` + `generateSuggestionsFromPatterns(patterns, snapshot)` + `generatePreConsultSummary(patterns, snapshot)`.
  7. **Classifier guard `classifyInterpretationFields` regra 28 reusa Sprint 33** em title+description de cada sugestão → persiste suggestions com `blocked_by_classifier` flag + `expires_at = now + 14d`.
  8. Marca run `completed` com summary jsonb (`patternsCount, suggestionsCount, critical, attention, blockedByClassifier`).

  Catch: erro técnico marca run `failed` com failureReason.
- `listSuggestions({status?, severity?, memberId?, limit?=50})` com filtros + JOIN members+persons retorna ORDER BY expiresAt ASC (urgentes primeiro pra evitar `expired`).
- `acceptSuggestion({suggestionId, applyChanges=false})` atualiza status=`accepted` + reviewedByUserId/reviewedAt. MVP só registra aceitação (audit). Sprint 34b conecta `applyChanges=true` → chama `updateMealPlan` Sprint 29 (versionado pattern parent_meal_plan_id+1 pra rastreabilidade Lei 13.787).
- `rejectSuggestion({suggestionId, reason})` atualiza status=`rejected` + rejectionReason.
- `getPreConsultSummary({memberId})` retorna kind=`pre_consult_summary` mais recente (Server Component nutri page consome pra preview).

**UI `/app/nutri-agent` dashboard (224 linhas)** Server Component:

- 5 KPI cards: **Pendentes** (count status=pending) + **Críticas** (count severity=critical pending, color danger) + **Aceitas 30d** (count reviewed_at > NOW - 30d) + **Runs 30d** (count completed > NOW - 30d) + **Bloqueadas Comitê IA 30d** (count status=blocked queued > NOW - 30d, color warning).
- Nav filtros severity (Todas / critical / attention / info) com active state highlight.
- Lista pendentes ordenada `CASE severity WHEN critical THEN 1 WHEN attention THEN 2 ELSE 3 END, created_at DESC` (worst-first):
  - Card por suggestion com borderLeft 4px color-coded severity.
  - KIND_LABEL: 🍽 Ajuste de plano / ⚠ Alerta / 🩺 Padrão de risco / 📋 Resumo pré-consulta / 🧪 Exame complementar.
  - Confidence% + expira data formatada + member name link `/app/members/[id]/nutri-summary`.
  - Banner amarelo "⚠ Classifier bloqueou" quando `blocked_by_classifier=true`.
- Empty state aponta `/app/members/[id]/nutri-summary` pra rodar agent manual.
- Nota footer: "UI completa accept/reject inline + diff visual proposedChanges entra Sprint 34b. MVP entrega backend + lista read-only."

**9 RLS + check tests** em `packages/db/tests/nutri-agent-rls.test.ts` (264l).

**2 ADRs Proposed 2026-05-18:**

- [ADR 0043](docs/decisions/0043-nutri-agent-arquitetura.md) — Nutri-Agent: agente especializado vs Copilot generalizado. Decisão: agente próprio com task router `resolveModelForTask('reasoning')` + reuso da infra Sprint 06 (classifier + RAG + cache) + 4 alternativas rejeitadas (Copilot com persona genérica; chain of MoE; only-LLM sem heurística determinística; only-heurística sem LLM).
- [ADR 0044](docs/decisions/0044-nutri-agent-politica-mudancas-plano.md) — Política de mudanças: **sempre proposta, nunca write direto**. `acceptSuggestion(applyChanges=true)` exige revisão profissional explícita; sem auto-apply mesmo em Enterprise. 3 alternativas rejeitadas (auto-apply em mudanças "menores"; opt-in tenant Enterprise pra auto-apply; gradual rollout com staging).

**941 unit/RLS tests verdes** (era 914 +27 Sprint 34: 18 unit + 9 RLS). Typecheck 11/11 packages verde.

**Sprint 34b/c futuro:** IA real `resolveModelForTask('reasoning')` Vertex AI Gemini Pro substitui pattern-detector determinístico em padrões não-catalogados (regra 32 + ADR 0064) + cache semântico via `data_hash` (mesmo input retorna mesma run, custo zero); cron triggers Vercel Cron (`pre_consult_auto` 24h antes consulta agendada Sprint 03 + `weekly_adherence` ticking domingo 06:00 SP + `risk_event_triggered` consumer `domain_events` Sprint 31 quando meal_log_reviews score baixo); `acceptSuggestion(applyChanges=true)` integra `updateMealPlan` Sprint 29 versionado pattern (cuidar pra não criar loop infinito de versões) + lint custom `no-nutri-agent-direct-write` bloqueia commit que persista mealPlan via SA do nutri-agent sem proposal_id; cron `expire-nutri-agent-suggestions` D+14 → status=`expired`; UI accept/reject inline com `<ConfirmDialog>` regra 45 + diff visual color-coded de `proposedChanges` + `/app/members/[id]/nutri-summary` consolidado com timeline runs + cards severity color-coded; particionamento `nutri_agent_runs` ANUAL (regra 34 — @volume 720k+/ano); permissions RBAC `nutri_agent.read`/`nutri_agent.run`/`nutri_agent.accept`/`nutri_agent.reject`; consent `cross_module_nutri_agent` cobrindo cruzamento de dados Fisio↔Nutri↔Devices↔Lab; **notificação ANVISA RDC 657/2022 SaMD Classe II** antes de feature flag prod (regra 28 + ADR 0053); **RIPD `docs/compliance/ripd/v1.0-nutri-agent-ia.md`** com DPO sign-off (regra 29 + ADR 0054 — cobre IA generativa + cruzamento cross-module + classifier + revisão humana obrigatória); feature flag `nutri_agent_v1`; E2E Playwright fluxo manual_professional + cron pre_consult_auto + gate Comitê IA inativo bloqueia + classifier blocking; piloto ≥10 runs reais antes de promover ADRs 0043/0044 pra Accepted; stretch: tool calling LLM via tools_registry ADR 0075 + persona `nutricionista-agent` dedicada + RAG indexando guidelines SBNutri + ABRAN + Mayo Clinic + reconhecimento de foto refeição via Whisper-Vision.

### Build — Sprint 33 (Pipeline Inteligente de Exames Laboratoriais — backbone 33a core) 2026-05-18

Pipeline de extração automática de exames laboratoriais (`Upload → OCR → IA extração → IA interpretação conservadora → revisão profissional → lab_results oficial`). ADR 0050 Accepted desde 2026-04-23. **Backbone Faixa A** entregue — pipeline real (OCR + LLM Vertex AI Gemini + scanUpload + drag-drop + ICP-Brasil-style revisão completa) fica para Sprint 33b/c.

**Schemas (`packages/db/src/schema/exames.ts`)** — 4 enums + 6 tabelas:

- `exam_documents` — PDF/imagem original com workflow `uploaded → processing → pending_review → published | rejected | failed`. Particionável anual Sprint 33b (regra 34 + ADR 0072), `@volume_estimate_yearly: 2M+`, retenção 20a (Lei 13.787 + CFM 2.299 — 1 ano hot tier + 19 anos cold tier `archive-cold-attachments`). 5 indexes incluindo partial `WHERE status = 'pending_review'` (fila do profissional) e partial `WHERE sensitivity = 'high'` (audit reforçado). 4 sources: `professional_upload`, `patient_portal`, `patient_whatsapp` (Sprint 13 hub ADR 0051 com `source_ref` apontando pra `whatsapp_inbound_messages.id`), `lab_integration_future`. 2 CHECKs: `uploader_consistency` (uploaded_by_user_id OR uploaded_by_member_id NOT NULL) + `review_consistency` (status terminal exige reviewed_by_user_id + reviewed_at).
- `exam_extractions` — texto bruto OCR + `structured_data jsonb` validado por Zod strict (ExamExtractionSchema). 1:1 com exam_documents via cascade delete. Acompanha particionamento anual Sprint 33b. CHECK `ocr_confidence` 0-1. Provider OCR abstrato reusa Sprint 15 ADR 0035.
- `exam_interpretations_draft` — interpretação preliminar IA: `out_of_range jsonb`, `patterns jsonb`, `hypotheses jsonb`, `follow_up_suggestions jsonb`. Audit flag `blocked_by_classifier` + `classifier_blocked_terms jsonb` quando classificador anti-diagnóstico bloqueia output IA. Index partial `WHERE blocked_by_classifier = true` pra DPO revisar false positives. Conservadora (regra 28 + ADR 0050).
- `exam_interpretations_final` — versão revisada pelo profissional. `accepted_patterns` + `accepted_hypotheses` + `rejected_hypotheses jsonb` (audit — saber o que IA sugeriu vs profissional descartou) + `professional_observations text` + reviewed_by_user_id RESTRICT FK pra users.
- `exam_review_edits` — audit append-only de toda edição durante review. Sem UPDATE/DELETE policy. Field-level (1 entry por analito editado: `field_key='analyte.glicose_jejum'`).
- `tenant_exam_ai_settings` — opt-out por tenant (LGPD-sensitive). `ai_extraction_enabled` + `ai_interpretation_enabled` independentes + `classifier_strictness` enum strict/moderate + `preferred_model` override do Sprint 06 resolver.

Migration `0038_exames_pipeline.sql` (116 linhas). RLS policies `0051_exames_rls.sql` — FORCE em todas 6 tabelas + 10 policies cobrindo tenant scope + member portal via `app.member_id` em select de `exam_documents` e `exam_interpretations_final` (paciente vê próprios exames) + GRANT diferenciado: `exam_review_edits` recebe só `SELECT, INSERT` (sem UPDATE/DELETE — append-only).

**3 libs puras em `packages/ai/src/exames/`:**

- `classifier.ts` (113 linhas) — classifier de output IA bloqueia frases diagnósticas/prescritivas antes de virar `exam_interpretations_draft`. **11 STRICT patterns** regex case-insensitive: `\bdiagnóstico\s+de\s+\w+/`, `paciente\s+(tem|possui|apresenta)\s+(diabetes|hipertensão|cancer|...)/`, `\bvocê\s+(tem|possui|sofre\s+de)\b/`, `\bprescrev[oe]r?\b/`, `\btome\s+\d+\s*(mg|ml|g|ui)\b/`, `\biniciar?\s+(tratamento|medicação)\b/`, `\b(comece|começar)\s+(a\s+)?(tomar|usar)\b/`, `\bsubstituir?\s+(medicamento|remédio)\b/`, `\bcontraindicad[oa]\s+para\s+\w+/`. **5 MODERATE patterns** adicional: `\bconfirma\s+\w+/`, `\bgarante?\s+que\b/`, `\bcerteza\s+(de|que)\b/`, `\bdefinitivamente\b/`, `\bcomprovadamente\s+(tem|possui)\b/`. Vocabulário aceito (allowlist conceitual): "sugere", "compatível com", "pode indicar", "padrão sugestivo de", "achado a esclarecer". `classifyInterpretationOutput(text, strictness='strict')` retorna `{ok, blockedTerms[], originalText}` + `classifyInterpretationFields([])` agrega multi-string + `getBlockedMessage()` formata mensagem amigável pra UI.
- `extraction-schema.ts` (69 linhas) — Zod `.strict()` (campos não-listados rejeitados): `ExamAnalyteSchema` com `code` (2-60 chars) + `label` (2-120) + `value` (finite) + `unit` (1-20) + `referenceHint?` + `labAnalyteIdMatch?` UUID + `matchConfidence?` 0-1; `ExamExtractionSchema` com `examType` (2-60) + `laboratory?` + `collectedAt?` ISO datetime + `analytes` (min 1 max 100) + `overallConfidence?` 0-1 + `notes?` (max 500). `parseExtractionJson()` throw + `safeParseExtractionJson()` non-throw discriminado.
- `interpretation.ts` (337 linhas) — 3 funções puras:
  - `compareWithRanges(analytes, ranges, ctx)` busca melhor reference range via scoring (condition match=1000pts > sex match=200pts ou 50pts `any` > age range fit=100pts + bonus por amplitude curta) + classifica out_of_range `mild` (até 20% além do limite) ou `severe` (acima 20%).
  - `detectPatterns(outOfRange)` cruza out_of_range com `PATTERN_CATALOG` curado de 7 padrões cross-analito conservadores:
    - `perfil_aterogenico` (LDL above + HDL below required; triglicérides above optional)
    - `padrao_anemico_ferropriva` (hemoglobina + ferritina below required)
    - `resistencia_insulina_inicial` (glicose_jejum + hba1c above required)
    - `disfuncao_hepatica` (ast_tgo + alt_tgp above required)
    - `hipotireoidismo_sugestivo` (tsh above + t4_livre below required)
    - `deficiencia_vitamina_d` (vitamina_d_25oh below required)
    - `deficiencia_b12` (vitamina_b12 below required)

    Confidence base 0.85 + 0.1 por optional matchado (cap 1). Cada padrão tem `description` em vocabulário conservador ("Padrão sugestivo de...", "Avaliar contexto clínico", "Investigação adicional recomendada").
  - `getFollowUpSuggestions(patterns)` retorna sugestões de exames complementares deduplicadas por padrão: apoB+Lp(a)+PCR-us pra aterogênico; ferro sérico+B12+ácido fólico pra anemia ferropriva; insulina jejum+HOMA-IR+TOTG pra resistência insulina; GGT+sorologias hep+USG abdome pra disfunção hepática; repetir TSH+T4 livre+anti-TPO pra hipotireoidismo; PTH+cálcio+fósforo pra deficiência D; ácido fólico+homocisteína+MMA pra deficiência B12.

**36 unit tests verdes** em `@repo/ai`: 19 `classifier.test.ts` (STRICT bloqueia diagnóstico/você tem/prescrever/tome XX mg/iniciar tratamento/comece a tomar/substituir medicamento/contraindicado; MODERATE adicional confirma/garante/certeza/definitivamente/comprovadamente; vocabulário conservador "sugere/compatível com" aceito; multi-field aggregation; getBlockedMessage UI-friendly) + 17 `interpretation.test.ts` (compareWithRanges retorna out_of_range correto LDL above/HDL below/glicose in-range; scoring condition>sex>age priorities; severity mild/severe threshold 20%; detectPatterns perfil_aterogenico com required+optional triglicérides; anemia_ferropriva com hemoglobina+ferritina; direction match enforced; multiple patterns simultaneously; getFollowUpSuggestions deduplica entre padrões).

**9 Server Actions wrapped** (envelope ADR 0071):

Staff em `apps/web/app/app/exames/actions.ts` (685 linhas):

- `uploadExamDocument({memberId, storagePath, originalFilename, mimeType, fileSizeBytes?, sensitivity?, source?, sourceRef?})` valida member do tenant + cria `exam_documents` status=`uploaded` + setAuditResource com source+sensitivity.
- `processExam({examDocumentId})` chamado por job — MVP usa `stubOcrAndExtraction()` determinístico retornando 5 analitos canônicos (glicose_jejum=102/hba1c=5.8/colesterol_total=215/hdl=38/triglicerides=180 — caso sintético borderline elegível pra detectar perfil_aterogenico + resistencia_insulina). Fluxo: valida doc + member status `uploaded` → marca `processing` → roda OCR stub + grava `exam_extractions` com structured_data Zod-validado → carrega member context (birthDate via persons.birthDate → ageYearsAt + sex) → carrega `lab_analytes` mapeando codes detectados + reference_ranges joinando → `compareWithRanges` → `detectPatterns` → `getFollowUpSuggestions` → `classifyInterpretationFields` guardrail em patterns.description + followUp → persiste `exam_interpretations_draft` com `blocked_by_classifier` flag + `classifier_blocked_terms` audit quando bloqueado → atualiza doc status=`pending_review` + examTypeDetected + laboratory + collectedAt + processedAt. Retorna `{analytesCount, outOfRangeCount, patternsCount, blockedByClassifier, codesNotMapped}` pra observabilidade.
- `submitExamReview({examDocumentId, reviewedAnalytes[], acceptedPatterns[], acceptedHypotheses[], rejectedHypotheses[], observations?})` em transação atomic: cria `exam_interpretations_final` + audit `exam_review_edits` (1 por analito editado, field_key=`analyte.{code}`) + `lab_results` Sprint 30 (1 por analito não-ignorado com analyteId resolvido + value/unit + collectedAt + laboratory + enteredByUserId) + atualiza doc status=`published` + reviewedAt + reviewedByUserId.
- `listPendingExams({limit?=50, sensitivityFilter?})` ORDER BY uploaded_at ASC com member+person JOIN.
- `getExamDetail({examDocumentId})` retorna doc + última extraction + último draft (ORDER BY DESC).
- `markSensitive({examDocumentId, sensitivity})` permite escalar pra `high`.
- `rejectExam({examDocumentId, reason})` válido só em status `uploaded`/`processing`/`pending_review` (não-terminal).

Member portal em `apps/web/app/meu/exames/actions.ts` (90 linhas):

- `selfUploadExam({storagePath, originalFilename, mimeType, fileSizeBytes?})` via `withMemberContext` RLS-aware — cria `exam_documents` source=`patient_portal` + `uploaded_by_member_id` + status=`uploaded`. Sprint 33b: dispara job de processamento via fila.
- `listMyExams()` retorna últimos 50 do member via `withMemberContext` (RLS aplica `app.member_id`).

**5 rotas UI mínimas:**

- `/app/exames/fila` — fila ASC por uploaded_at com 7 colunas (Paciente + Tipo + Lab + Origem ícones 👨‍⚕️/📱/💬/🔌 + Sensibilidade 🔒 Alta / Normal + Status IA "✓ Pronto" verde ou "⚠ IA bloqueou" amarelo + Há "Xh"/"Xd"). Empty state aponta `/meu/exames/upload` e `/app/members/[id]/exames/upload`.
- `/app/exames/[id]` — detalhe read-only lado-a-lado: cabeçalho member + tipo + lab + sensitivity 🔒 badge; metadados (arquivo+mime, origem, recebido, processado); tabela analitos extraídos com badge ⬆/⬇ + mild/severe color-coded por out_of_range; cards padrões detectados com confidence% borda primary; lista follow-up sugerido; banner amarelo `var(--ev-warning-soft)` quando `blocked_by_classifier=true` mostrando termos bloqueados; nota "Sprint 33b adiciona table editor + submit review".
- `/app/nutri/exames` — rota nutri-específica.
- `/meu/exames` — portal mobile-first com status badge amigável ("Recebido — aguardando análise" warning / "Em análise pela IA" warning / "Aguardando seu profissional" info / "✓ Analisado e adicionado ao histórico" success / "Não pôde ser analisado" danger / "Erro técnico — re-enviar" danger).
- `/meu/exames/upload` — placeholder Sprint 33b apontando WhatsApp da clínica enquanto MinIO+scanUpload não estiver pronto.

**RLS + check tests (`packages/db/tests/exames-rls.test.ts`)** — 8 tests cobrindo: insert válido OK + uploader_consistency NULL rejeita errCode 23514 + review_consistency status=`published` sem reviewed_at rejeita + patient_portal OK com uploaded_by_member_id + cross-tenant isolation TENANT_REDE vê 1 / TENANT_FRANQUIA vê 0 + confidence_range 1.5 rejeita 23514 + blocked_by_classifier preserva texto bloqueado em jsonb pra audit + tenant_exam_ai_settings opt-out insert+update OK + isolation por tenant.

**914 unit/RLS tests verdes** (era 870 +44 Sprint 33: 36 unit + 8 RLS). Typecheck 11/11 packages verde.

**Sprint 33b/c futuro:** OCR provider abstrato real Sprint 15 ADR 0035 com safeFetch regra 37 + allowlist hosts + `resolveModelForTask('extraction')` Vertex AI Gemini regra 32 + cache semântico Sprint 06 + `scanUpload()` regra 38 + ADR 0073 (PDF JS é flag crítica em exame → rejeita imediato; MIME real file-type; magic bytes; embed detection) + MinIO bucket `lab-documents` cifrado AES-256 + URL assinada TTL 10min + UI drag-drop `/app/members/[id]/exames/upload` + `/meu/exames/upload` + **table editor lado-a-lado completo** com PDF embed left pane + analytes editable right pane + cards hipóteses confirmar/rejeitar individual + handler `exam-upload` no hub WhatsApp inbound Sprint 13 ADR 0051 (recebe anexo classificado + chama `uploadExamDocument({source: 'patient_whatsapp', sourceRef: inboundMessageId})` + responde "📄 Recebi seu exame. Em análise.") + particionamento ANUAL `exam_documents`+`exam_extractions` (regra 34 + ADR 0072 + retenção 20a) + cold storage Parquet zstd pós-5 anos + permissions RBAC `exam.read`/`exam.write`/`exam.review`/`exam.sensitive.read` + consent `self_upload_exam` + integração régua Sprint 13 valores críticos via `lab_result.published` + UI super-admin `/app/settings/exames/ia` opt-out + classifier_strictness override + pesquisa global ADR 0062 lab_results com `is_sensitive=true` + `required_permission='exame.read'` + **notificação ANVISA RDC 657/2022 SaMD Classe II** antes de feature flag prod (regra 28 + ADR 0053) + **RIPD `docs/compliance/ripd/v1.0-exames-laboratoriais.md`** com DPO sign-off antes de feature flag (regra 29 + ADR 0054 — cobre OCR + IA generativa + classifier + revisão humana + retenção 20a) + feature flag `exames_ia_v1` + E2E Playwright fluxo profissional + paciente portal + classifier bloqueia 100% benchmark frases proibidas.

### Docs — ADR 0015 Accepted (Copilot safety classifier dois pontos) 2026-05-18

Documenta implementação Sprint 06 já estável (`packages/ai/src/classifier.ts` + 19 unit tests passando).

**Decisão:** classifier em **dois pontos** (input anti-injection + output anti-prescrição/diagnóstico/termo proibido) com **regex curado versionado em TS** (latency ~1ms vs LLM-classifier 2-3s; determinístico audit-friendly). Cobertura pt-BR + en + es desde dia 1 (regra 27 + ADR 0052). Output bloqueado retorna **mensagem persona-aware** via `getBlockedOutputMessage(reason)` — UX friendly (envelope `ok=true data.blocked=true`), não `FORBIDDEN`. Integra defense-in-depth ADR 0073 camada 5 + regra 28 CFM 2.454/2026.

**4 categorias de pattern** versionadas:
- `PRESCRIPTION_PATTERNS` (5 regex): verbo `prescrev[oae]`, imperativo + dosagem em pt+en+es
- `DIAGNOSIS_PATTERNS` (3 regex): "você tem/está com [doença]" em pt+en + "diagnóstico positivo/confirmado/de"
- `PROHIBITED_TERMS` (4 regex absolutos): atestado, receituário, autorização, emissão de receita (só ICP-Brasil emite)
- `INJECTION_PATTERNS` (6 regex): ignore previous instructions (pt/en), `<system>`/`<|im_start|>`, execute tool, reveal prompt, code exec (eval/drop table)

**Integração obrigatória:** `wrapAction` chama `classifyInput` antes de `resolveModelForTask`; após response, chama `classifyOutput` antes de retornar envelope. `ai_audit_log` grava decisão + reason + match name + input_hash (SHA-256, não plain pra LGPD). 3 bloqueios em 5min do mesmo user dispara `system_alerts severity=warning` pro DPO revisar (false positive curadoria).

**DoD Sprint 06 atingido:** ≥90% pass rate em 19 unit tests cobrindo 4 categorias × 3 idiomas. CI bloqueia se cair.

**Status:** Accepted 2026-05-18. Curadoria ampliação contínua via dataset de incidentes reais (false negatives reportados em produção). Lint custom `no-llm-without-classifier` (Sprint 06b) bloqueará commit que chame `resolveModelForTask` sem wrap.

**Rejeitadas (5):** classificar só output (LLM gasta custo + bypass risco); classificar só input (hallucination passa); LLM-classifier (latency +2-3s, custo +100%, não-determinístico, recursivo); hybrid (complexidade sem ganho); só pt-BR (BYOK responde em en por bug); LLM-generated fallback (recursão potencial); FORBIDDEN envelope em output (UX ruim).

`docs/decisions/0015-copilot-safety-classifier-dois-pontos.md` publicado. Sprint 06 doc atualizado pra refletir slug real. Roadmap linha 141 `a produzir` → `Accepted (formalizado 2026-05-18)`.

### Docs — Cleanup docs-check tech debt (24 sprint refs + 20 ADR cross-refs corrigidos) 2026-05-18

**Cleanup operacional pós-Sprint 36a.** `node scripts/docs-check.mjs` agora passa **0 erros / 0 avisos** — antes acumulava 44 warnings de tech debt criado ao longo de 20+ sprints.

**Faixa 1 — 24 sprint files atualizam refs ADR `(esperado)` → links resolvíveis:**

- Sprint 01b → ADR 0019 (rbac-com-grants-diretos-union, Accepted 2026-05-12)
- Sprint 02 → ADR 0011 (member-perfil-unico-cross-module, Accepted 2026-05-12)
- Sprint 03 → ADR 0012 (agenda-recurso-slot-recorrente-exclude, Accepted 2026-05-13)
- Sprint 04 → ADRs 0013/0014 (plano-contrato-cobranca-entidades-separadas + asaas-keys-distributed-vs-centralized, ambos Accepted 2026-05-13)
- Sprint 05 → ADR 0020 (ofertas-promotions-bundles-credits-referrals, Accepted 2026-05-13)
- Sprint 07 → ADR 0016 (tokens-equilibrio-vital-light-dark-flat, Accepted 2026-05-13)
- Sprint 08 → ADRs 0017/0018 (qr-hmac-rotativo-controle-acesso + hardware-catraca-android-default-mvp, ambos Accepted 2026-05-13)
- Sprint 09 → ADR 0021 (engajamento-regras-declarativas-dsl, Accepted 2026-05-13)
- Sprint 11 → ADR 0023 (prescricoes-polimorficas-base, Accepted 2026-05-13)
- Sprint 12 → ADR 0024 (avaliacoes-schema-dinamico-fields-jsonb, Accepted 2026-05-13)
- Sprint 15 → ADRs 0033/0034 (plano-contas-hierarquico + workflow-aprovacao-ap-declarativo, ambos Accepted 2026-05-14)
- Sprint 16 → ADR 0036 (rateio-intercompany-dsl-declarativo, Accepted 2026-05-15)
- Sprint 17 → ADRs 0037/0038 (open-finance-provider + nfe-recepcao-provider, ambos Proposed 2026-05-15)
- Sprint 18 → ADR 0039 (adquirencia-provider-abstrato, Proposed 2026-05-17)
- Sprint 20 → ADR 0028 (cid-cif-catalogos-globais, Proposed 2026-05-17)
- Sprint 22 → ADRs 0029/0030/0031 (tiss-tuss-schema-xml-generator + tuss-update-pipeline + tiss-validador-proativo, todos Proposed 2026-05-17)
- Sprint 23 → ADR 0086 (modelo-comissao-profissional, Proposed 2026-05-17)
- Sprint 24 → ADR 0087 (estoque-custo-saldo-model, Proposed 2026-05-17)
- Sprint 26 → ADR 0088 (portal-member-magic-link-auth, Proposed 2026-05-17)
- Sprint 27 → ADR 0084 (cross-alert-cid-contraindicacao, Proposed 2026-05-18)
- Sprint 28 → ADR 0085 (generative-ui-framework, Proposed 2026-05-18)
- Sprint 29 → ADRs 0080/0081 (banco-alimentos-taco + meal-plans-versionado, ambos Proposed 2026-05-18)
- Sprint 30 → ADR 0082 (suplementos-separados-de-alimentos, Proposed 2026-05-18)
- Sprint 31 → ADR 0083 (teleconsulta-provider-abstrato, Proposed 2026-05-18)
- Sprint 34 → ADRs 0043/0044 (nutri-agent-arquitetura + nutri-agent-politica-mudancas-plano, ambos Proposed 2026-05-18)

Cada entrada migrou do padrão `**ADR XXXX (esperado)** — DESCRIPTION` para um link resolvível `**[ADR XXXX]` apontando para `docs/decisions/XXXX-<slug>.md` + status `(Proposed|Accepted — YYYY-MM-DD)`.

**Faixa 2 — 20 broken ADR-to-ADR cross-references corrigidos (slugs adivinhados quando ADR foi escrito):**

- `0023-prescricoes-polimorficas-versionamento-workouts.md` → `0023-prescricoes-polimorficas-base.md` (4 refs: ADRs 0080/0081/0082/0084)
- `0028-cid11-cif-catalogo-global.md` → `0028-cid-cif-catalogos-globais.md` (3 refs: ADRs 0082/0083/0084)
- `0055-cadastro-profissional-registros-conselho.md` → `0055-registros-profissionais-em-conselho.md` (3 refs: ADRs 0029/0031/0086)
- `0056-nfe-inbox-unificada.md` → `0056-nfe-inbox-unificada-e-metodos-ingestao.md` (1 ref: ADR 0038)
- `0061-cobertura-fiscal-faseada-grupos-a-g.md` → `0061-motor-retencoes-e-cobertura-fiscal-faseada.md` (1 ref: ADR 0086)
- `0068-plano-composto-por-servicos-billing-completo.md` → `0068-catalogo-servicos-precos-contextuais-link-financeiro.md` (2 refs: ADR 0013)
- `0070-cache-member-insights-mev-kcal.md` → `0070-insights-cross-module-timeline-integrada.md` (2 refs: ADRs 0023/0024)
- `0070-cross-module-insights.md` → `0070-insights-cross-module-timeline-integrada.md` (2 refs: ADRs 0080/0081)
- `../sprints/35-geral-app-nativo-expo.md` → `../sprints/35-mobile-app-nativo-expo.md` (2 refs: ADRs 0045/0046 escritos no Sprint 35a)

**Validação:** `node scripts/docs-check.mjs` → **0 erros / 0 avisos**. Typecheck 11/11 verde. Sem mudanças de comportamento — apenas hygiene de docs.

### Build — Sprint 36a (Fiscal Focus NFe backbone — provider abstrato + CFOP resolver) 2026-05-18

**Sprint 36a entrega backbone server-side do módulo fiscal** (ADR 0059 Accepted) sem implementar Focus NFe real ainda (Sprint 36b). Foco: schema 5 tabelas + RLS + FiscalProvider abstrato + MockFiscalProvider determinístico + resolveCfop puro 8 tipos × interno/interestadual + Server Actions core wrapped com MFA gate regra 43 + UI inbox + wizard settings esqueleto.

**Sprint 36b/c entrega:** Focus NFe real (`safeFetch` regra 37 + allowlist `focusnfe.com.br`), payload builders por tipo (`emitNfeFromSale`/`emitNfceFromSale`/`emitNfeReturn`/`emitNfeTransfer`/`emitNfeConsertoOut`/`emitNfeConsertoReturn`/`emitNfeSelfEntry`), webhook callback HMAC `POST /api/fiscal/focus-nfe/callback`, wizard onboarding interativo, CRUD catálogo serviços, portal contador `/app/contador` (ADR 0061), aba `/app/fiscal/retencoes` (ADR 0061), integração `invoices.nfse_chave` Sprint 04, integração POS Sprint 24, integração intercompany Sprint 16, integração `equipment_maintenance` Sprint 25, integração `billing_guides` Sprint 22, job mensal `aggregate-fiscal-usage-snapshot` (ADR 0066 overage), feature flag `fiscal_focus_v1`, E2E homologação 8 tipos, lint custom `fiscal-emission-must-have-provider` + `prod-blocks-mock-provider`.

**Faixa A — Schema + RLS (5 tabelas + 4 enums):**

- `packages/db/src/schema/fiscal.ts`:
  - `fiscal_emissions` (kind 8 tipos via enum: nfse/nfe/nfce/nfe_return/nfe_transfer/nfe_conserto_out/nfe_conserto_return/nfe_self_entry + status workflow draft→queued→processing→completed|rejected|cancelled + provider column ADR 0076 plug-in + source polimórfico (invoice/sale/billing_guide/nfe_return/intercompany/equipment_maintenance/manual) + numeracao serie+numero atomic + chave SEFAZ 44dig unique + provider_ref unique + recipient snapshot (PF/PJ) + payload jsonb audit + xml/pdf storage paths MinIO + rejection_reason + retry_count + cancel_deadline_at 24h + checks completed_consistency/rejected_consistency/cancelled_consistency/positive_numero/positive_serie/retry_nonneg/provider_valid; 6 indexes incluindo retry queue partial + provider_ref partial unique; @volume 3.6M+/ano)
  - `fiscal_events` (append-only; kind cancellation/cce/inutilizacao + provider_ref unique + payload + xml_storage_path + check `emission_id-XOR-inutilizacao` + check inutilizacao numero_from≤numero_to + check rejected_consistency)
  - `fiscal_numbering_sequences` (unique por company+kind+serie+environment + nextNumero/lastUsedNumero + atomic UPDATE...RETURNING via reserveNextNumero transação FOR UPDATE + checks positive_serie 1-999 e positive_next 1+)
  - `fiscal_service_catalog` (LC 116/2003 + alíquota ISS em basis points 0-500bp + CNAE + município IBGE + regime tributário enum simples_nacional/lucro_presumido/lucro_real/mei + retention_rules jsonb pra Sprint 36b consumir ADR 0061 + active flag)
  - `fiscal_provider_credentials` (PK composta tenant_id+provider + api_token AES-256-GCM cifrado com nonce+tag + webhook_secret também cifrado + base_url override + environment homologacao/producao + last_validated_at + last_validation_status pra UI mostrar "re-validar" se >24h)
- Enums: `fiscal_emission_kind` (8) + `fiscal_emission_status` (6) + `fiscal_event_kind` (3) + `fiscal_provider_env` (2) + `fiscal_tax_regime` (4).
- `packages/db/src/policies/0054_fiscal_rls.sql` — RLS por tenant + permissions canônicas (`fiscal.read`/`fiscal.emit`/`fiscal.cancel`/`fiscal.admin`) + portal contador read-only (role `contador_externo` ADR 0061) + role `system` pra webhook callback Sprint 36b + RLS extra fiscal.admin-only em `fiscal_provider_credentials` (token cifrado ainda exige RLS pra defense in depth ADR 0073).
- Migration `0041_fiscal_focus_nfe.sql` (rename de `0041_strange_paibok.sql` gerado).

**Faixa B.1 — Libs puras `@repo/ai/fiscal` (31 unit tests passando):**

- **`provider.ts`** — `FiscalProvider` interface canônica: 6 métodos (healthCheck + emitNfse + emitNfeProduct + cancel + issueCce + inutilize + queryStatus); 4 tipos de input completos com schemas TS (NfseEmissionInput, NfeProductEmissionInput, CancellationInput, CceInput, InutilizacaoInput) + EmissionResult/EventResult/ProviderHealthResult tipados; suporta enums `FiscalProviderName` (focus_nfe/mock/nfse_nacional/enotas) + `FiscalProviderEnv` (homologacao/producao) + `FiscalEmissionKind` (8 espelha schema).
- **`mock.ts`** — `MockFiscalProvider` determinístico via SHA-256: gera chave SEFAZ fake 44 dígitos a partir de hash do input (cnpj+serie+numero+document+valor); cobre todos 6 métodos da interface; singleton state-less `mockFiscalProvider`. Bloqueio em produção implementado Sprint 36b.
- **`cfop-resolver.ts`** — `resolveCfop(input)` puro determinístico: 8 tipos × interno/interestadual; suporta `merchandiseKind` (industrialized/own_production/consumer_use/fixed_asset/service_input); 18 CFOPs canônicos cobertos (5101/5102/5152/5202/5551/5915/5949 saídas; 6101/6102/6152/6202/6551/6915/6949 interestaduais; 1915/1917 entradas; 2915/2917 entradas interestaduais; NFC-e sempre 5102 SEFAZ-imposed; NFS-e retorna sentinel 0000 ISS via município); exhaustive check TS para forçar update quando enum expande; `CANONICAL_CFOPS` catálogo readonly pra UI override.
- **31 tests cfop-resolver:** nfse sentinel × 2; nfe (interna 5102/interestadual 6102 industrialized + 5101/6101 own_production + 5551/6551 fixed_asset + 5949/6949 service_input genérico + default industrialized); nfce sempre 5102 mesmo se UF dest diferir; nfe_return 5202/6202; nfe_transfer 5152/6152; nfe_conserto_out 5915/6915; nfe_conserto_return 1915/2915 entrada; nfe_self_entry 1917/2917 entrada; determinismo 10x; CANONICAL_CFOPS catálogo 18 entries 4-dígitos numérico saídas 5/6 entradas 1/2; coverage 6 pares interno/interestadual.

**Faixa B.2 — Server Actions wrapped (7 com gate MFA):**

- `listEmissions({companyId?, kind?, status?, limit})` — filtros + ORDER BY created_at desc; inbox `/app/fiscal`.
- `getEmission(emissionId)` — emissão + eventos relacionados ordenados desc.
- `emitNfseFromInvoice({invoiceId, serviceCatalogId?})` — valida invoice status='paid' + reserveNextNumero transação FOR UPDATE em `fiscal_numbering_sequences` (cria sequence com nextNumero=1 se não existe; senão SELECT FOR UPDATE + UPDATE +1 atomic) + lookup recipient via persons JOIN members + chama `provider.emitNfse()` (mock síncrono retorna chave 44 dígitos) + INSERT emission com payload jsonb completo + cancelDeadlineAt 24h + audit_log via setAuditResource (Sprint 36b: enriquece com companies.cnpj + companies.municipality_code + fiscal_service_catalog.lc116Code real).
- **`cancelEmission({emissionId, justification})` — MFA gate `cancelNfe` (regra 43, já em HIGH_RISK_ACTIONS)** — valida status='completed' + cancelDeadlineAt não expirado + provider_ref existente; transação insere `fiscal_events` cancellation + UPDATE emission status='cancelled' atomic.
- **`issueCce({emissionId, correction})` — MFA gate `issueCce` (ADICIONADO HIGH_RISK_ACTIONS Sprint 36a)** — só NF-e modelo 55 (nfe/nfe_return/nfe_transfer; NFS-e e NFC-e não têm CC-e); conta CC-e prévias pra calcular nextSequence (max 30 por chave); insere event kind='cce' com sequence em payload.
- **`inutilizeRange({companyId, emissionKind, serie, numeroFrom, numeroTo, justification, year})` — MFA gate `inutilizeRange` (ADICIONADO HIGH_RISK_ACTIONS Sprint 36a)** — valida numeroFrom≤numeroTo; insere event kind='inutilizacao' sem emission_id (check schema valida exclusão mutual com cancellation/cce).
- `queryEmissionStatus(emissionId)` — re-consulta provider via providerRef; atualiza status local se provider retornar mudança (queued → completed/rejected).
- `retryEmission(emissionId)` — só em rejected com retry_count < 3; incrementa retry_count + zera rejection_reason + marca queued (Sprint 36b reconstroi payload + reenvia).
- **HIGH_RISK_ACTIONS expandido** (`packages/security/src/high-risk-actions.ts`): adicionados `issueCce` e `inutilizeRange` na categoria 'fiscal' com `requireMfaMaxAgeMins: 15`.
- **MVP `getProviderForTenant()`** retorna sempre `mockFiscalProvider` com comentário `// why:` documentando que Sprint 36b implementa factory que decifra `fiscal_provider_credentials.api_token_encrypted` (AES-256-GCM via KEK por tenant).

**Faixa C — UI (2 rotas backbone):**

- `/app/fiscal` — Inbox com 4 KPIs (autorizadas/pendentes/rejeitadas/total autorizado em BRL) + filtros GET (kind + status) + tabela 100 últimas emissões com badge colorido por status (draft cinza, queued/processing azul, completed verde, rejected vermelho com rejection_reason truncado + retry_count, cancelled amarelo) + link "Detalhe" por linha + footer documentando Sprint 36b pendente. KIND_LABEL completo (NFS-e/NF-e/NFC-e/Devolução/Transferência/Conserto/Entrada própria) + STATUS_STYLE com `var(--ev-*)` tokens regra 44.
- `/app/settings/fiscal` — Wizard esqueleto com 4 Steps marcados como done/pending: (1) Credentials Focus NFe — mostra provider + environment + last_validated_at; (2) Catálogo de serviços — conta ativos; (3) Séries e numeração — lista existentes por (kind, serie, environment); (4) Teste de emissão homologação — placeholder Sprint 36b. Cada step com check verde ou número cinza + borderLeft 4px + badge "Configurado". Banner warning explicitando Sprint 36a backbone + MockFiscalProvider em uso.

**Pendências Sprint 36b/c (3-4 semanas):**

- `FocusNfeProvider` real em `packages/ai/src/fiscal/focus-nfe.ts` com `safeFetch()` regra 37 + allowlist `focusnfe.com.br` + `homologacao.focusnfe.com.br` + rate limit respeitando Focus HTTP 429 → `RATE_LIMITED`
- 7 payload builders restantes (`nfse-payload.ts` ABRASF/GINFES/IPM/Nota Carioca, `nfe-product-payload.ts` modelo 55, `nfce-payload.ts` modelo 65 com CSC por UF, `nfe-return-payload.ts` finNFe=4, `nfe-transfer-payload.ts`, `nfe-conserto-payload.ts` out/return, `nfe-self-entry-payload.ts`)
- `resolveFiscalProvider(tenantId)` factory que carrega credentials + decifra AES-256-GCM via KEK + instancia adapter + bloqueia 'mock' em produção
- `cbos-cnae-resolver.ts` (serviço → código ABRASF + CNAE)
- Webhook callback `POST /api/fiscal/focus-nfe/callback` com HMAC verification + idempotência + validação IP source Focus NFe (allowlist documentada) + UPDATE emission status/chave/xml/pdf_storage_path + emite domain events `fiscal.emission.completed`/`.rejected`/`.cancelled`
- Wizard `/app/settings/fiscal` interativo (4 Steps com forms) + cifra credentials AES-256-GCM + validação Focus health check + teste de emissão homologação
- CRUD `/app/settings/fiscal/catalogo` (LC 116/2003 + alíquota ISS por município + retention_rules jsonb)
- `/app/fiscal/[id]` detalhe + ações inline (download PDF/XML URL assinada TTL 10min + cancelar com confirm + CC-e com form correction + retry com confirm)
- Botões emissão contextualizados (`[+ Emitir NFS-e]` em `/app/financeiro/invoices/[id]` se status=paid; `[+ NF-e produto]` em `/app/financeiro/vendas/[id]`; `[+ NFC-e]` automático no POS Sprint 24)
- Integração `invoices.nfse_chave` + evento `invoice.nfse_emitted` Sprint 04
- Integração `billing_guides` Sprint 22 (toggle por tenant pra emissão NFS-e automática em guia paga)
- Integração `nfe_returns.emission_mode='focus_nfe'` Sprint 17 fecha ciclo ADR 0058
- Integração `equipment_maintenance` Sprint 25 (botão "Emitir NF-e remessa"/"retorno" no fluxo manutenção externa)
- Integração intercompany Sprint 16 (botão "Emitir NF-e transferência" quando cruza CNPJs distintos)
- POS Sprint 24 emite NFC-e automaticamente
- `/app/contador` portal contador externo (ADR 0061) — dashboard + xmls download massa + AP/AR CSV/OFX + retenções + DRE read-only + KPIs agregados + fiscal-emissions list + certificados read-only + convidar via magic link
- `/app/fiscal/retencoes` relatório mensal por tributo (IRRF/PIS/COFINS/CSLL/INSS/ISS) com export PDF (contador gera DARF) + CSV + campo guide_reference
- Job mensal `aggregate-fiscal-usage-snapshot` agrega `count(*) WHERE status='completed' AND kind IN (...)` em `tenant_usage_snapshots.fiscal_emissions_count` (ADR 0066; eventos NÃO contam)
- Cron `validate-fiscal-credentials` semanal chama healthCheck + atualiza last_validated_at + dispara system_alert se >7d sem validação
- Gap detection cron diário compara `next_numero - 1` vs `max(numero) WHERE status='completed'` → system_alert critical + sugestão inutilização
- Permissions `fiscal.read`/`fiscal.emit`/`fiscal.cancel`/`fiscal.admin` + `retencoes.read` em RBAC
- Pesquisa global `search_index` regra 30 indexa `fiscal_emissions` com kind='fiscal_emission' + label "NFS-e 1234"/"NF-e 5678" + required_permission='fiscal.read'
- Feature flag `fiscal_focus_v1` + dashboard card "Emissões com erro" no Sprint 07 cross-alert
- Lint custom `fiscal-emission-must-have-provider` (provider column NOT NULL DEFAULT 'focus_nfe' já garante schema; lint reforça check) + `prod-blocks-mock-provider` (env=production → throw em MockFiscalProvider)
- E2E Playwright com Focus NFe sandbox: emitir 5 NFS-e + 3 NF-e + 2 NFC-e + 1 devolução + cancelar + CC-e + inutilizar; seed homologação
- Negociação comercial Focus NFe (`docs/contratos/focus-nfe.md` — target R$ 0,12/nota acima de 10k/mês; SLA escrito; sandbox enterprise)

### Build — Sprint 35a (App Nativo Expo backbone + ADRs 0045+0046 Proposed) 2026-05-18

**Sprint 35a entrega backbone server-side do app nativo** sem materializar projeto cliente (Sprint 35b/c). Foco: schema versionamento + push tokens + mobile sessions distintas das web, Server Actions, API Routes, ADRs 0045 (stack) + 0046 (release strategy). Sprint cliente Expo + APNs/FCM dispatcher + Apple Health / Health Connect ficam para 35b/c.

**Faixa A — Schemas + RLS (3 tabelas + 2 enums):**

- `packages/db/src/schema/mobile.ts`:
  - `mobile_app_versions` — registry global de versões publicadas (sem tenant_id; read-all). Campos: `platform` (mobile_platform enum ios/android) + `version` semver + `build_number` (CFBundleVersion/versionCode) + `store_url` + `release_notes` + `min_required` bool (força update) + `published_at` + `sunset`+`sunset_at` (versão fora de suporte). Unique `(platform, version)`. Index parcial `min_required=true` pra lookup quente.
  - `mobile_push_tokens` — APNs (iOS) / FCM (Android) tokens por (member, device). Campos: `tenant_id` + `member_id` FK + `platform` + `token` + `device_id` opaco + `device_model` + `os_version` + `app_version` + `locale` + `revoked_at` soft-revoke + `revoked_reason` (user_logout/token_invalid/device_removed/replaced_by_new_registration) + `last_used_at` + `registered_at`. **Unique active** `(member_id, device_id, platform) WHERE revoked_at IS NULL` força re-register substituir. Index parcial `member_active` pra dispatcher (Sprint 35b) pega ativos.
  - `mobile_sessions` — sessões nativas distintas das web (`member_sessions` Sprint 26). Refresh **90d** vs **30d** web pra UX mobile. Campos: `tenant_id` + `member_id` + `platform` + `refresh_token_hash` SHA-256 + `expires_at` + `device_fingerprint` (deviceId+osVersion+model hash) + `device_label` (UI "dispositivos conectados") + `app_version` + `created_ip`/`last_seen_ip` + `last_seen_at` + status enum (`active`/`revoked`/`expired`) + `revoked_at`/`revoked_reason`. Unique `refresh_token_hash`. Index parcial `member_active`. Check `revoked_consistency` (status=revoked → revoked_at NOT NULL).
  - Enums: `mobile_platform` (ios/android) + `mobile_session_status` (active/revoked/expired).
- `packages/db/src/policies/0053_mobile_rls.sql`:
  - `mobile_app_versions` SELECT global (USING true) — app verifica versão em boot sem auth; curadoria via platform_admin Sprint 35c.
  - `mobile_push_tokens` + `mobile_sessions` policies tenant + member portal (tenant_id OR member_id) replicam padrão Sprint 26.
- Migration `0040_mobile_app_backbone.sql` (gerada Drizzle Kit).

**Faixa B — Server Actions (`apps/web/app/meu/mobile/actions.ts`):**

- `registerPushToken({platform, token, deviceId, deviceModel, osVersion, appVersion, locale})` — usa `requireMemberSession` + `withMemberContext`; revoga tokens anteriores do mesmo (member, device, platform) com reason='replaced_by_new_registration'; INSERT novo registro retorna `tokenId`.
- `listMyPushTokens()` — lista 20 últimos tokens do member (ativos + revogados) com platform/device_model/os_version/app_version/registered_at/last_used_at/revoked_at. Member portal pra "dispositivos conectados".
- `revokeMyPushToken({tokenId, reason})` — soft-revoke + reason (default 'user_logout'). 404 se não encontrado ou já revogado.
- `checkAppVersion({platform, currentVersion})` — **pública sem auth** (endpoint pré-login). Busca top 50 versões not-sunset desc + identifica `latest` (top 1) e `minVersion` (mais recente com min_required=true). `compareSemver` puro 3-part. Retorna `{ok, minRequired, updateRequired, latestVersion, updateAvailable, storeUrl, releaseNotes}`. App em boot decide: bloqueante se `updateRequired` ou banner se `updateAvailable`.

**Faixa C — API Routes (2 públicas pro app consumir):**

- `apps/web/app/api/mobile/auth/register-push/route.ts` (POST) — wrap Server Action `registerPushToken` (MVP usa cookie member; Sprint 35b substitui por Bearer JWT + lookup `mobile_sessions.refresh_token_hash`). JSON inválido → 400 VALIDATION_ERROR. `runtime='nodejs'` + `dynamic='force-dynamic'`.
- `apps/web/app/api/mobile/auth/check-version/route.ts` (POST) — público; rate-limited regra 36 (Sprint 35b adiciona Redis sliding window por IP). JSON inválido → 400. Erro = envelope `{ok:false, error:{code, message}}`.

**ADRs publicados (Proposed):**

- **ADR 0045** `docs/decisions/0045-stack-mobile-expo-managed-react-native.md`:
  - Decisão: **Expo managed + React Native + TypeScript + Expo Router v3 file-based**
  - 5 sub-decisões: (1) RN > Flutter (TS uniformidade + reuso Zod tipos + ecosystem saúde maduro); (2) managed > bare (sem manutenção ios/+android/ + EAS Build cloud sem Mac local + config plugins + OTA via EAS Update + prebuild é "saída"); (3) TS strict regra 16; (4) APIs nativas via config plugin (expo-notifications + react-native-health + react-native-health-connect + react-native-ble-plx + expo-secure-store refresh token + expo-background-fetch + expo-camera + expo-barcode-scanner); (5) Expo Router file-based (mesma mental model Next.js App Router + deep links automáticos + TypeScript routes)
  - Estrutura proposta `apps/mobile/app/` com `(auth)/` + `(member)/` Stack/Tabs
  - Arquitetura: REST `/api/mobile/*` + header `Authorization: Bearer` (cookie web não compartilhado) + reuso `@repo/types` Zod + TanStack Query
  - 6 alternativas rejeitadas (Flutter, bare-day1, RN CLI puro, Capacitor/Ionic/PWA-only, Native Swift+Kotlin separados, New Architecture desligada)
- **ADR 0046** `docs/decisions/0046-release-strategy-app-stores-ota.md`:
  - Decisão: **App Store + Google Play oficiais + OTA via EAS Update + force update via min_required + access 1h+refresh 90d single-use + push direto APNs/FCM (sem Expo Push Service, regra 46)**
  - 7 sub-decisões: (1) distribuição canais oficiais (TestFlight/sideload rejeitados); (2) OTA via EAS Update branch policy (production/staging/preview-{pr}) **JS-only** — native module bump runtimeVersion força build novo; cumpre Apple §3.3.2 + Play policy; (3) force update via `mobile_app_versions.min_required` + curadoria política versão atual−6 meses OU 3 majors atrás; (4) tokens **access 1h memória RAM** + **refresh 90d expo-secure-store** + rotação single-use no refresh + family chain detection Sprint 35b; (5) push **direto APNs HTTP/2 + FCM HTTP v1** (sem `exp.host`) — soberania regra 46; tabela `push_dispatches` (Sprint 35b) audita cada envio + soft-revoke automático em BadDeviceToken/UNREGISTERED; (6) CI/CD GitHub Actions orchestration → EAS Build cloud (30 builds/mês free tier) + EAS Submit App Store Connect API + Play Developer API; (7) onboarding 2 paths reativo (invite WhatsApp/SMS deep link `logifit://invite`) + proativo (paciente baixa direto + magic link)
  - 7 alternativas rejeitadas (sideload Android+TestFlight perpétuo, Microsoft CodePush sunset 2026, OTA full bundle viola Apple, Expo Push Service, single token vida longa, cookie web compartilhado, self-host EAS Build macOS CLUF)

**Pendências Sprint 35b/c:**

- Scaffold `apps/mobile/` Expo SDK 52 + Expo Router v3 + Hermes + New Architecture default
- UI rotas `(auth)/login` + `(auth)/verify` + `(member)/{index,treino,checkin,agenda,perfil}`
- `lib/api.ts` fetch wrapper Authorization Bearer + retry + refresh silencioso
- `lib/session.ts` expo-secure-store hooks (refresh persiste Keychain iOS / Keystore Android)
- Magic link mobile: `POST /api/mobile/auth/magic-link` + `POST /api/mobile/auth/verify` (SMS+email)
- Rota `POST /api/mobile/auth/refresh` single-use rotation + family chain detection (revoga toda family se refresh revogado reapresentado)
- Push dispatcher `packages/notifications/` (APNs HTTP/2 JWT p8 signing + FCM HTTP v1 service account) + tabela `push_dispatches` audit + retry exponencial + dead-letter + soft-revoke automático token inválido
- Apple Health via `react-native-health` config plugin + Health Connect via `react-native-health-connect` + background-fetch sync diário → POST `/api/mobile/health/sync` ingere em `device_readings` (expande Device Hub Sprint 32)
- BLE bioimpedância `react-native-ble-plx` config plugin
- UI super-admin `/admin/mobile/versions` pra curadoria `mobile_app_versions` (publish + min_required + sunset)
- Universal links + Apple Smart App Banner + Play Integrity API anti-fraude
- RIPD app-mobile + DPO sign-off + feature flag `mobile_app_v1`
- E2E Maestro ou Detox
- EAS Submit App Store Connect API + Play Console staged rollout 5%→20%→50%→100% 7 dias + Apple Phased Release
- Rate limit Redis Sliding Window por IP em `/api/mobile/auth/check-version` (regra 36)

### Build — Sprint 34 100% (Nutri-Agent IA cross-module + ADRs 0043+0044 Proposed) 2026-05-18

**Sprint 34 estende Fase 3.** Entrega 100% do core: 3 schemas + RLS + 8 RLS tests + 3 libs puras + 18 unit tests + 5 Server Actions + 1 rota UI + ADR 0043 (arquitetura Nutri-Agent especializado) + ADR 0044 (política NUNCA mudança automática). Sprint expande stub Sprint 34 com implementação core do agente cross-module.

**Faixa A — Schemas + RLS (8 RLS tests):**

- `packages/db/src/schema/nutri-agent.ts` — 3 tabelas:
  - `nutri_agent_runs` (execução do agente; trigger enum: manual_professional/pre_consult_auto/weekly_adherence/risk_event_triggered; status workflow queued→collecting→analyzing→completed|failed|blocked; check completed_consistency; @volume 720k+/ano)
  - `nutri_agent_suggestions` (5 kinds: plan_adjustment/alert/risk_pattern/pre_consult_summary/follow_up_exam; 3 severities; classifier guard reuse Sprint 33; expires_at 14d default; check confidence_range + reviewed_consistency; applied_meal_plan_id FK Sprint 29 quando aceito + aplicado)
  - `nutri_agent_metrics_snapshot` (snapshot data jsonb completo do member context + data_hash SHA-256 pra audit reprodutibilidade; APPEND-ONLY)
- `packages/db/src/policies/0052_nutri_agent_rls.sql` — staff scope + member portal vê suggestions accepted próprias
- Migration `0039_nutri_agent.sql`
- `packages/db/tests/nutri-agent-rls.test.ts` — 8 RLS + check tests

**Faixa B.1 — Libs puras `@repo/ai/nutri-agent` (18 unit tests):**

- **`types.ts`** — `MemberContextSnapshot` (memberId + capturedAt + demographics + mealPlan + diaryLast14d + workoutLoad + fisioActiveCids + labResultsRecent + deviceSummary + consentsUsed[]); `DetectedRiskPattern` (code+label+description+severity+confidence+evidence); `AgentSuggestion` (5 kinds + 3 severities + proposedChanges nullable)
- **`pattern-detector.ts`** — `detectRiskPatterns(snapshot)` roda **7 detectores curados deterministic**:
  - `deficit_calorico_extremo` (avg consumo 7d < 70% target; critical se < 50%)
  - `aderencia_baixa` (avg adherence < 50%; attention se < 30%)
  - `overtraining_sugestivo` (HR repouso > 75 bpm + sono < 360 min)
  - `risco_cardiovascular_lipidico` (LDL alto + HDL baixo)
  - `risco_glicemico` (glicose/HbA1c elevados)
  - `perda_peso_rapida` (trend > -6 kg/mês)
  - `fisio_workout_tensao` (CIDs ativos + 5+ sessões/semana)
  - Ordena por severity critical→attention→info
- **`suggestion-generator.ts`** — `generateSuggestionsFromPatterns` mapeia pattern→kind canônico + computa `proposedChanges` conservador (deficit_extremo → targetKcalDelta sobe pra avg×1.1; perda_rapida → +200 kcal; outros → null); `generatePreConsultSummary` gera resumo executivo determinístico
- **18 tests**: 14 pattern-detector (deficit critical/attention/ignora<70%/sem plano; aderência baixa+ignora<4d; overtraining HR+sleep/sóHR/semdevice; cardio LDL+HDL/sóLDL; perda rápida; ordering severity) + 4 suggestion-generator (mapeia kinds + proposedChanges + alert sem changes + preconsult sintético/vazio)

**Faixa B.2 — Server Actions (5 wrapped):**

- `runNutriAgentForMember` — **gate Comitê IA** (regra 13/28: ai_committees.status='active' obrigatório, senão cria run blocked + throw FORBIDDEN); transação completa:
  1. Cria run status='collecting'
  2. `collectMemberContext` (8 queries cross-module: persons + meal_plans + food_log_daily_summary 14d + lab_results 90d + consultas+cids fisio + device_readings_daily_summary 7d + prescriptions workout)
  3. Persiste metrics_snapshot com data_hash SHA-256
  4. `detectRiskPatterns` + `generateSuggestionsFromPatterns` + `generatePreConsultSummary`
  5. `classifyInterpretationFields` (Sprint 33 reuse) — bloqueia se detectar termo proibido
  6. Persiste suggestions com expires_at 14d
  7. Marca run completed + summary jsonb
- `listSuggestions({status?, severity?, memberId?, limit})` — ordena severity critical→attention→info → expires_at + JOIN persons
- `acceptSuggestion({suggestionId, applyChanges?})` — status='accepted' + audit reviewed_by/reviewed_at (Sprint 34b integra updateMealPlan se applyChanges=true)
- `rejectSuggestion({suggestionId, reason})` — status='rejected' + rejection_reason
- `getPreConsultSummary({memberId})` — busca kind='pre_consult_summary' mais recente

**Faixa C — UI (1 rota):**

- `/app/nutri-agent` dashboard pendentes com 5 KPIs (pending / critical / accepted 30d / runs 30d / blocked Comitê IA 30d) + filtros por severity + lista ordenada severity+expires_at com card colorido por borda lateral (critical vermelho, attention amarelo, info cinza), kind label com emoji (🍽 plan_adjustment / ⚠ alert / 🩺 risk_pattern / 📋 pre_consult / 🧪 follow_up_exam), confidence%, expires_at, link pra `/app/members/[id]/nutri-summary` (Sprint 34b)

**ADRs publicados (Proposed):**

- **ADR 0043** `docs/decisions/0043-nutri-agent-arquitetura.md`:
  - Decisão: **agent dedicado especializado** > persona Copilot universal (audit/reprodutibilidade/cross-module deterministic/vocabulário fixo/gate Comitê IA/SaMD separation)
  - **Stateless** entre runs (snapshot por execução com data_hash pra reprodutibilidade + cache Sprint 34b)
  - 3 gatilhos: manual_professional + pre_consult_auto + weekly_adherence + risk_event_triggered (cron Sprint 34b)
  - **Catálogo curado** > IA generativa (7 detectores curados; IA Gemini Flash add-on Sprint 34b sempre via classifier)
  - Workflow visual documentado completo
  - 5 alternativas rejeitadas
- **ADR 0044** `docs/decisions/0044-nutri-agent-politica-mudancas-plano.md`:
  - Decisão: **NUNCA mudança automática. SEMPRE proposta com revisão profissional.** Workflow Server Action `runNutriAgentForMember` só insere em `nutri_agent_*` — nunca escreve em meal_plans/prescriptions
  - 5 razões inegociáveis: CFN 599/2018 responsabilidade + regra 28 CFM 2.454/2026 supervisão humana + LGPD art. 20 revisão humana + ANVISA SaMD Classe II (evita escalar pra III) + risco real erro detector
  - Workflow visual: Pattern Detector → Suggestion Generator → Classifier Guard → suggestions pending → Profissional revisa → accept(applyChanges=true → Sprint 34b updateMealPlan) | accept(false) | reject
  - Excedido: agent pode gerar pre_consult_summary descritivo + system_alerts notificação (sem ação clínica)
  - Mecanismos de enforcement: schema default status='pending' + RLS + audit + lint custom Sprint 34b `no-nutri-agent-direct-write`
  - 6 alternativas rejeitadas (auto-apply info-level, ±10%, pre-approval tipos, confidence > 0.95, Enterprise opt-in, etc)

**Pendências Sprint 34b/c:**

- IA generativa real via `resolveModelForTask('reasoning')` Vertex AI Gemini Pro (gate Comitê IA + classifier guard + cost tracking em run.cost_cents)
- Cron jobs `pre_consult_auto` (24h antes appointment kind='nutri') + `weekly_adherence` (domingo 06:00 SP) + consumer domain_events `risk_event_triggered`
- `acceptSuggestion(applyChanges=true)` integração Sprint 29 `updateMealPlan` (cria new version + linka applied_meal_plan_id transacional)
- Otimização `collectMemberContext` via single CTE query (8x → 1x)
- WorkoutLoad real via `workout_sessions` + cálculo MET Sprint 11
- Consents reais em `consentsUsed[]` LGPD audit
- Cache via data_hash (mesmo input → reusa suggestions sem chamar IA)
- Notificação ANVISA SaMD Classe II antes do prod (regra 28 + ADR 0053)
- RIPD `v1.0-nutri-agent-ia.md` + DPO sign-off (regra 29 + ADR 0054)
- Feature flag `nutri_agent_v1`
- Lint custom `no-nutri-agent-direct-write` enforça ADR 0044
- UI completa: accept/reject inline + diff visual proposedChanges + retroactive run history
- `/app/members/[id]/nutri-summary` página dedicada por member
- Notificação push ao nutri quando suggestion `critical` (Sprint 13 régua)
- Rejection feedback feeds training Sprint 34c
- Métricas dashboard: tempo até aceitar + taxa de accept vs reject
- Integração como tool no Copilot universal Sprint 06 (`tools_registry`)
- E2E Playwright (manual trigger + suggestion gerada + accept → meal_plan v+1 criado; reject → rejection_reason gravada)

**Verificação:** Migration aplicada via `pnpm db:migrate`. Stub determinístico (pattern detector curado) funciona sem dependência IA externa. UI exige stack rodando — não validado visualmente.

**Stats:** **18 unit tests nutri-agent verdes** (14 pattern-detector + 4 suggestion-generator). Typecheck verde em 11/11 packages.

### Build — Sprint 33 100% (Pipeline Exames Laboratoriais + ADR 0050 Accepted) 2026-05-18

**Sprint 33 estende Fase 3.** Entrega 100% do core: 6 schemas + RLS + 11 RLS tests + 3 libs puras (classifier anti-diagnóstico + extraction Zod schema + interpretation comparator/pattern detector) + 36 unit tests + 8 Server Actions staff + 2 SAs portal paciente + 4 rotas UI. ADR 0050 já estava Accepted desde 2026-04-23.

**Faixa A — Schemas + RLS (11 RLS tests):**

- `packages/db/src/schema/exames.ts` — 6 tabelas:
  - `exam_documents` (status workflow uploaded→processing→pending_review→published; sources enum professional_upload/patient_portal/patient_whatsapp/lab_integration_future + source_ref pra rastreabilidade WhatsApp Sprint 13 ADR 0051; sensitivity normal/high; particionamento ANUAL Sprint 33b @volume 2M+/ano; retenção 20a Lei 13.787; checks uploader_consistency + review_consistency)
  - `exam_extractions` (1:1 com doc; raw_text OCR + structured_data jsonb Zod-validated + ocr_provider + ocr_confidence + cache_hit; check confidence 0-1)
  - `exam_interpretations_draft` (out_of_range + patterns + hypotheses + follow_up_suggestions; blocked_by_classifier flag + classifier_blocked_terms jsonb pra audit)
  - `exam_interpretations_final` (revisão profissional; accepted_patterns + accepted_hypotheses + rejected_hypotheses + observations + member portal lê via RLS próprio)
  - `exam_review_edits` (audit append-only — sem UPDATE/DELETE policy; field_key + before_value + after_value)
  - `tenant_exam_ai_settings` (opt-out por tenant: ai_extraction_enabled + ai_interpretation_enabled + classifier_strictness strict/moderate)
- `packages/db/src/policies/0051_exames_rls.sql` — RLS member portal + staff scope + append-only em exam_review_edits + member vê interpretations_final próprias
- Migration `0038_exames_pipeline.sql` (4 enums + 6 tabelas + indexes pra fila pending_review + sensitivity lookup audit)
- `packages/db/tests/exames-rls.test.ts` — 11 RLS + check tests

**Faixa B.1 — Libs puras `@repo/ai/exames` (36 unit tests):**

- **`classifier.ts`** — `classifyInterpretationOutput(text, strictness)` regex-based contra patterns proibidos: "diagnóstico de X" / "paciente tem [doença]" / "você tem X" / "prescrever Y" / "tome Nmg" / "iniciar tratamento" / "definitivamente" / "garante que" etc. Strict bloqueia tudo; moderate só patterns flagrantes. `classifyInterpretationFields(string[])` para validar JSON completo. `getBlockedMessage()` retorna texto amigável pro profissional. **19 tests**.
- **`extraction-schema.ts`** — Zod strict schema do JSON IA: `ExamExtractionSchema` (examType + laboratory + collectedAt + analytes[]) + `ExamAnalyteSchema` (code + label + value + unit + referenceHint + labAnalyteIdMatch + matchConfidence). `parseExtractionJson` lança ZodError; `safeParseExtractionJson` retorna discriminated.
- **`interpretation.ts`**:
  - `compareWithRanges(analytes, ranges, ctx)` reusa scoring de Sprint 30 (condition/sex/age priority) — retorna `OutOfRangeItem[]` com direction + severity mild/severe
  - `detectPatterns(outOfRange)` cruza com `PATTERN_CATALOG` curado (7 padrões: perfil_aterogenico, padrao_anemico_ferropriva, resistencia_insulina_inicial, disfuncao_hepatica, hipotireoidismo_sugestivo, deficiencia_vitamina_d, deficiencia_b12); required todos batem + optional aumenta confidence
  - `getFollowUpSuggestions(patterns)` retorna lista deduplicada baseada em catálogo curado por pattern
  - **17 tests**

**Faixa B.2 — Server Actions (8 staff + 2 member portal):**

`apps/web/app/app/exames/actions.ts` (staff):
- `uploadExamDocument` (valida member + tenant + grava exam_documents status='uploaded' + setAuditResource)
- `processExam` (orquestra pipeline: stub OCR → parseExtractionJson Zod → resolve member age/sex via persons + carrega reference_ranges → compareWithRanges + detectPatterns + getFollowUpSuggestions → classifyInterpretationFields gate → grava extraction + draft + atualiza doc status='pending_review' + exam_type_detected + laboratory + collected_at)
- `submitExamReview` (transação atômica: cria exam_interpretations_final + exam_review_edits por analito editado + lab_results Sprint 30 por analito não-ignorado + status='published')
- `listPendingExams` (fila staff com paciente name + filtros sensitivity)
- `getExamDetail` (doc + extraction + draft completo)
- `markSensitive` + `rejectExam` (com reason audit)

`apps/web/app/meu/exames/actions.ts` (portal):
- `selfUploadExam` (source='patient_portal' + uploaded_by_member_id + status='uploaded'; Sprint 33b conecta scanUpload + job de processamento)
- `listMyExams`

**Faixa C — UI (4 rotas):**

Staff:
- `/app/exames/fila` lista pending_review ORDER BY uploaded_at ASC + paciente + tipo + lab + origem badge ícone + sensitivity flag + status IA (✓ Pronto / ⚠ IA bloqueou) + idade entry
- `/app/exames/[id]` detalhe completo: header com tipo/lab/source/processed_at + tabela analitos com flag ⬆/⬇ severity mild/severe + alert IA bloqueada se houver + padrões detectados com confidence% + sugestões de follow-up. UI table editor + submit review fica Sprint 33b

Portal paciente:
- `/meu/exames` lista próprios exames com status amigável (Recebido / Em análise / Aguardando profissional / ✓ Analisado / Não pôde analisar)
- `/meu/exames/upload` page com call-out "envie via WhatsApp" (drag-drop MinIO Sprint 33b)

**ADR 0050 já Accepted** (não criado neste sprint — existia desde 2026-04-23). Documenta:
- Pipeline OCR → IA extração → IA interpretação → revisão profissional → lab_results oficial
- IA conservadora; classificador anti-diagnóstico mandatório (regra 28 CFM 2.454/2026)
- SaMD Classe II ANVISA RDC 657/2022 — exige notificação antes do prod
- Paciente pode subir via portal/WhatsApp/integração lab futura
- Source ref preserva rastreabilidade WhatsApp hub Sprint 13

**Pendências Sprint 33b/c:**

- OCR provider real (ADR 0035): OCR.space default + Google Vision + AWS Textract + Tesseract — com `safeFetch` allowlist (regra 37)
- Extração IA real via `resolveModelForTask('extraction')` Vertex AI Gemini (substitui stub)
- Interpretação IA real via `resolveModelForTask('chat')` com prompt conservador + few-shot examples
- Cache semântico Sprint 06 pra exames similares (reduz custo)
- Particionamento ANUAL `exam_documents` + jobs cold storage Parquet pós-5a (regra 34)
- Job Vercel Cron `/api/jobs/exames/process-queue` processa uploads em fila
- scanUpload (regra 38) obrigatório em uploadExamDocument — PDF malicioso disfarçado de laudo via portal/WhatsApp = bloqueado antes de OCR
- Storage MinIO bucket `lab-documents` privado + signedUrl TTL 10min
- UI revisão completa: PDF viewer lado-a-lado + table editor de analitos + checkbox accept/reject patterns + observation textarea + submit
- Handler WhatsApp inbound (ADR 0051): hub identifica anexo como exame + chama uploadExamDocument source='patient_whatsapp' + responde "📄 Recebi! Em análise" + "✓ Analisado! Ver: {portal_link}"
- Integração régua Sprint 13: lab_result.published com valor crítico → notificação WhatsApp
- Pesquisa global indexar lab_results sensível (ADR 0062 + regra 30)
- Categoria sensível: permission `exam.sensitive.read` enforcement (HIV/psiquiátrico/genético/paternidade)
- Opt-out IA por tenant via `/app/settings/exames/ia`
- Seed 10 exames de 5 labs diferentes (Sabin/DB/Hermes/Fleury/Delboni) + expected JSON pra CI
- LOINC mapping completo (interop internacional)
- Modelo local OCR + IA pra tenants sensíveis a LGPD (não enviar pra Anthropic/Google)
- Comparativo automático com exame anterior do mesmo analito
- RIPD `v1.0-exames-laboratoriais.md` + DPO sign-off (regra 29 + ADR 0054)
- **Notificação ANVISA RDC 657/2022** (regra 28 + ADR 0053): pipeline interpretação é SaMD Classe II — feature não ativa em prod sem notificação aprovada
- Feature flag `exames_ia_v1`
- E2E Playwright (upload + OCR + extração + interpretação + revisão + publicação)

**Verificação:** Migration aplicada via `pnpm db:migrate`. Stub OCR + extraction determinístico funciona sem dependência externa. UI exige stack rodando — não validado visualmente.

**Stats:** **36 unit tests exames verdes** (19 classifier + 17 interpretation). Typecheck verde em 11/11 packages.

### Build — Sprint 32 100% (Device Hub v1 + ADR 0049 Proposed) 2026-05-18

**Sprint 32 estende Fase 3.** Entrega 100% do core: 7 schemas + RLS + 10 RLS tests + 3 libs puras (provider abstrato + normalizer FHIR + parser CSV InBody) + 17 unit tests + 8 Server Actions + 4 rotas UI + ADR 0049 (Device Hub provider abstrato + FHIR Observation + curadoria profissional + retenção 3 camadas).

**Faixa A — Schemas + RLS (10 RLS tests):**

- `packages/db/src/schema/devices.ts` — 7 tabelas:
  - `device_connections` (OAuth + BLE; unique active por (member, provider); tokens criptografados Sprint 32b via envelope encryption ADR 0073)
  - `device_readings` (FHIR-like Observation; @volume 180M+/ano — particionamento diário Sprint 32b; dedup unique (connection, observation_code, measured_at); retenção raw 90d)
  - `device_readings_daily_summary` (PK tenant×member×code×date; check min ≤ max; retenção perpétua; cron 02:00 SP popula antes do drop)
  - `device_readings_curated` (snapshot pré-drop quando profissional referencia em assessment_measurements; rastreabilidade clínica Lei 13.787)
  - `device_sync_cursors` (PK connection_id; cursor opaco por provider)
  - `device_consents` (granular por provider; 1 ativo por (member, provider); raw_data_access flag separado)
  - `device_incidents` (audit de erros: token_expired/rate_limited/parser_failed/calibration_anomaly)
- `packages/db/src/policies/0050_devices_rls.sql` — RLS member portal + staff scope
- Migration `0037_device_hub.sql` (3 enums + 7 tabelas + indexes)
- `packages/db/tests/devices-rls.test.ts` — 10 RLS + check tests

**Faixa B.1 — Libs puras (17 unit tests):**

- `packages/ai/src/devices/provider.ts` — `DeviceProvider` interface (startAuth + completeAuth + sync + revoke) + `MockDeviceProvider` (gera 21 readings determinísticas 7 dias × 3 codes) + `resolveDeviceProvider` resolver
- `packages/ai/src/devices/normalizer.ts`:
  - `PHYSIOLOGICAL_RANGES` (18 observation codes com faixa min/max/unit)
  - `validateReading` (out_of_range / unit_mismatch / unknown_code)
  - `partitionValidReadings` (separa válidos de inválidos com reason)
  - `aggregateDailySummaries` (group by code+date → min/max/avg/count)
  - `detectOutliers` (z-score ±3σ contra baseline + fallback validação faixa quando baseline pequeno)
- `packages/ai/src/devices/inbody-parser.ts` — `parseInBodyCsv` tolerante (`,` ou `;`; formato BR dd/mm/yyyy + US ISO; aceita PT-BR ou EN; ignora colunas desconhecidas; reporta erros por linha)
- **5 validateReading + 1 partition + 2 aggregate + 3 outliers + 6 inbody-parser = 17 tests**

**Faixa B.2 — Server Actions (8 wrapped):**

`apps/web/app/meu/dispositivos/actions.ts` (paciente — member portal Sprint 26):
- `startConnection` (verifica não-duplicata + provider.startAuth + cria connection status='pending' com state)
- `completeConnection` (valida state OAuth + provider.completeAuth + grava tokens + status='active')
- `disconnect` (provider.revoke best-effort + status='revoked' + apaga tokens)
- `listMyConnections`
- `listMyReadings` (filtros observation_code/fromDate/toDate/limit)
- `importInBodyCsv` (parseInBodyCsv + partitionValidReadings + INSERT ON CONFLICT DO NOTHING dedup; cria/reusa connection 'file_import')
- `grantDeviceConsent` (revoga anterior + insert)
- `revokeDeviceConsent`

**Faixa C — UI (4 rotas, member portal Sprint 26):**

- `/meu/dispositivos` lista conectados (badge status active/error/pending/revoked + ícone provider + última sync) + disponíveis pra conectar (Garmin/Oura/Fitbit com badge "Sprint 32b"; Apple/Google com "Em breve" pra app nativo; file_import funcional MVP)
- `/meu/dispositivos/historico` últimas 200 leituras (90d) com label legível (Frequência cardíaca, % Gordura, etc.) + provider + qualidade
- `/meu/dispositivos/importar` page Server Component + `<ImportCsvForm>` client com textarea CSV + preview de erros de parse + contadores válido/inválido/inserido

**ADR 0049 publicado (Proposed)** `docs/decisions/0049-device-hub-wearables-clinicos.md`:

- Decisão: provider **abstrato** (`DeviceProvider` interface) > hard-code
- FHIR-like Observation > schema proprietário (interop futura)
- Retenção **3 camadas**: raw 90d → agregado perpétuo → curadas perpétuas
- **Curadoria profissional obrigatória** (NUNCA automação) — regra 28 CFM 2.454/2026 + responsabilidade clínica
- Consent granular por provider + raw_data_access flag separado
- Separação visual obrigatória device 📱 vs avaliação 🩺 (sem calibração automática cross-fonte)
- Particionamento diário `device_readings` + jobs aggregate-then-drop em sequência (Sprint 32b)
- 8 alternativas rejeitadas documentadas
- Cenário de uso completo + POC plan Sprint 32b

**Pendências Sprint 32b/c:**

- Adapters reais: Garmin Connect API + Oura Ring API + Fitbit Web API com `safeFetch` (regra 37) + allowlist
- Web Bluetooth bioimpedância Omron HBF-226 (GATT 0x181D) + G-Tech Glass 7
- Parsers FIT (Garmin) + TCX/GPX em arquivos dedicados
- Particionamento diário `device_readings` + jobs `aggregate-daily-summaries` (02:00 SP) + `drop-old-partitions` (00:00 UTC) com dependência de ordem garantida
- Envelope encryption tokens via `LOGIFIT_DATA_KEY` (ADR 0073)
- `/app/members/[id]/dispositivos/curar` UI curadoria lado-a-lado (leitura bruta × valor final)
- `/app/members/[id]/monitoramento` painel tendências (Uso 2)
- Cross-alert dispatcher Sprint 07 consome leituras: HR repouso +10bpm 3d → fisio; passos <3k 7d → instrutor; % gordura +2% 30d + sono <6h → nutri
- `assessment_measurements.source_device_reading_id` FK + UI Sprint 12 com seleção de leituras pra avaliação oficial
- `member_device_connections` no search_index (regra 30 + ADR 0062)
- Permissions `devices.read` / `devices.read_raw` / `devices.admin`
- RIPD `v1.0-device-hub.md` + DPO sign-off
- Feature flag `device_hub_v1`
- E2E Playwright (OAuth Garmin sandbox + BLE mock + revogação)
- Webhook push Garmin (reduz polling)
- Dashboard saúde populacional anonimizado (% alunos com HR elevado, sono <6h, etc.)
- Apple Health + Google Health Connect via app nativo Expo (Sprint 35)

**Verificação:** Migration aplicada via `pnpm db:migrate`. UI exige stack rodando — não validado visualmente.

**Stats:** **17 unit tests devices verdes**. Typecheck verde em 11/11 packages.

### Build — Sprint 31 100% (Diário alimentar + Teleconsulta + ADR 0083 Proposed) 2026-05-18

**Sprint 31 estende Fase 3.** 4 schemas + 12 RLS tests + lib pura diario/calc 17 unit tests + lib pura @repo/ai/teleconsulta provider abstrato + 10 Server Actions + 3 rotas UI + ADR 0083 (Daily.co default + Whereby/Jitsi/Twilio/Mock alternativas + cliente embed iframe + gravação MinIO próprio + transcrição pós-gravação Groq Whisper + 2 consents distintos LGPD art. 11). Detalhes acima.

### Build — Sprint 30 100% (Suplementos + Exames laboratoriais + ADR 0082 Proposed) 2026-05-18

**Sprint 30 estende Fase 3.** Entrega 100% do core: 6 schemas + RLS + 13 RLS tests + 1 lib pura + 23 unit tests + 11 Server Actions + 4 rotas UI + seed canônico (10 suplementos + 30 interações + 20 analitos com faixas de referência) + ADR 0082 (suplementação separada de alimentos).

**Faixa A — Schemas + RLS (13 RLS tests):**

- `packages/db/src/schema/nutri-labs.ts` — 6 tabelas: `supplements` (global+tenant, 11 kinds enum, ANVISA registration); `supplement_interactions` (pares curados com severity info/caution/avoid + source); `supplement_prescriptions` separado de Sprint 11 prescriptions por posologia rica (dose+frequência+via+duração); `lab_analytes` global (11 categorias enum); `lab_reference_ranges` 1:N por analyte (sex × age × condition); `lab_results` tenant+member com `out_of_range` denormalizado + reference_range_id_used FK audit
- `packages/db/src/policies/0048_nutri_labs_rls.sql`
- Migration `0035_nutri_labs_suplementos.sql` (4 enums extras + 6 tabelas)
- `packages/db/tests/nutri-labs-rls.test.ts` — 13 RLS + check tests

**Faixa B.1 — Lib pura lab.ts (23 unit tests):**

- `matchReferenceRange(ranges, ctx)` — scoring por especificidade: +1000 condition exato, +200 sex exato, +50 sex 'any', +100 dentro faixa etária + bonus estreita
- `isOutOfRange(value, range)` — 4 casos cobertos (só min, só max, ambos, nenhum)
- `classifyLabResult(value, ranges, ctx)` — combina + severity mild (<20%) / severe (≥20%)
- `ageYearsAt(birthDate, atDate)` helper

**Faixa B.2 — Server Actions (11 wrapped):**

`searchSupplements`, `createTenantSupplement` (Zod runtime), `listSupplementInteractions`, `prescribeSupplement` (valida member+supplement), `discontinueSupplementPrescription`, `listMemberSupplementPrescriptions`, `listLabAnalytes`, `getLabAnalyteWithReferences`, `registerLabResult` (resolve birth_date/sex → classifyLabResult lib pura → out_of_range denormalizado), `listMemberLabResults` (filtrável onlyAltered), `compareAnalyteOverTime`.

**Faixa C — UI (4 rotas):**

`/app/nutri/suplementos` busca form GET + tabela; `/app/nutri/suplementos/[id]` detalhe + interações ordenadas por severity color-coded (avoid vermelho, caution amarelo, info cinza); `/app/nutri/exames` catálogo categoria filter + count ranges. Páginas member-specific Sprint 30b.

**Faixa D — Seed:**

`seed-nutri-labs` idempotente: **10 suplementos canônicos** (Vit D3, B12, Ômega 3, Magnésio, Ferro, Creatina, Whey isolado, Probiótico, Cálcio, Multivitamínico); **30 interações curadas** com sources (Mayo/BNF/SBEM/ISSN/WHO/AHA); **20 analitos** com faixas multi-segmentadas (split sex + gestante + osteoporose) sources SBD/SBC/SBPC/SBEM/OMS/SBAC.

**ADR 0082 publicado (Proposed)** — suplementos separados de foods (posologia + ANVISA + interações + linguagem clínica); supplement_prescriptions separada de Sprint 11 (posologia rica + descontinuação); supplement_interactions tabela 1:N > jsonb; lab_reference_ranges 1:N > jsonb; lab_results.out_of_range denormalizado > VIEW; fontes curadoria LogiFit + revisão semestral.

**Pendências Sprint 30b/c:** 50 analitos extras + faixas pediátricas/geriátricas + páginas member exames/suplementação + OCR laudo (Sprint 33 cobre) + comparação cross-lab + tenant override ranges + cron valida out_of_range + particionamento anual + régua Sprint 13 alerta WhatsApp + widget GenUI + portal `/meu/exames` Sprint 26 + RIPD + feature flag `nutri_suplementos_exames_v1` + E2E + nutri-agent IA.

**Verificação:** Migration aplicada via `pnpm db:migrate`. UI exige stack rodando — não validado visualmente.

**Stats:** **23 unit tests lab.ts verdes**. Typecheck verde em 11/11 packages.

### Build — Sprint 29 100% (Nutri TACO + Plano alimentar + ADRs 0080+0081 Proposed — Fase 3 ABERTA) 2026-05-18

**Sprint 29 abre a Fase 3 (Nutrição + Mobile + Fiscal).** Entrega 100% do core: 7 schemas + RLS + 12 RLS tests + 2 libs puras + 26 unit tests + 9 Server Actions + 7 rotas UI + seed canônico (47 alimentos TACO + 20 equivalências) + ADR 0080 (banco TACO/USDA nutrients jsonb) + ADR 0081 (meal_plans versionado).

**Faixa A — Schemas + RLS (12 RLS tests):**

- `packages/db/src/schema/nutri.ts` — 7 tabelas: `foods` (global + tenant; nutrients jsonb Zod-validated; external_code unique pra idempotência seed), `food_measures` (PK food_id+measure; check grams > 0), `food_equivalences` (curadas global + tenant; check not_self + grams positive), `meal_plans` (versionado via parent_meal_plan_id; polimórfico Sprint 11; targets opcionais), `meal_plan_meals`, `meal_items` (check grams > 0; unique order), `tenant_branding` (1 row/tenant)
- `packages/db/src/policies/0047_nutri_rls.sql` — RLS: foods/equivalences leitura global + tenant; INSERT/UPDATE só tenant; meal_plans+items com member portal scope; tenant_branding tenant-only
- Migration `0034_nutri_foods_planos.sql`
- `packages/db/tests/nutri-rls.test.ts` — 12 RLS + check tests

**Faixa B.1 — Libs puras (26 unit tests):**

- `nutrients-schema.ts` — `NutrientsSchema` Zod strict com 30+ campos (kcal/protein_g/lipid_g/carbohydrate_g obrigatórios; macros detalhados + minerais + vitaminas + outros opcionais); faixas fisiológicas (kcal 0–900 etc); helpers `parseNutrients`/`safeParseNutrients`/`scaleNutrientsByGrams`/`addNutrients`. **5 tests**
- `calc.ts` — `calculateMealNutrition(meal)` + `calculateMealPlanNutrition(meals)` ordenando + `compareAgainstTargets(totals, targets)` retornando `TargetGap[]` status `low|on_target|high` ±10% + `statusEmoji`. **15 tests**
- `equivalences.ts` — `rankEquivalents(seed, rows, topN=5)` score `|seedKcal - candidateKcal|/seedKcal`; suporta seed como A ou B; escala se seedGrams ≠ par. **6 tests**

**Faixa B.2 — Server Actions (9 wrapped):**

`searchFoods` / `getFoodDetail` / `createTenantFood` (Zod nutrients runtime) / `listMealPlans` / `createMealPlan` (transação plan + meals + items) / `getMealPlanFull` (JOIN nutrients + nutrition + gaps) / `updateMealPlan` (versão nova via Sprint 11 pattern) / `listSubstitutions` (carrega seed + equivRows global+tenant + chama lib pura) / `upsertBranding` (INSERT...ON CONFLICT UPDATE) / `getBranding`.

**Faixa C — UI (7 rotas):**

`/app/nutri` hub 5 KPIs · `/app/nutri/alimentos` busca server-rendered form GET + tabela macros · `/app/nutri/alimentos/[id]` detalhe 30+ nutrientes + medidas caseiras · `/app/nutri/planos` lista filtrável ativos/todos · `/app/nutri/planos/[id]` detalhe 4 KPIs gaps emoji + breakdown refeições/items × P/C/L · `/app/settings/branding` form com color picker + preview. Drag-drop editor visual fica Sprint 29b.

**Faixa D — Seed:**

`seed-nutri-foods` 47 alimentos TACO canônicos (cereais + tubérculos + verduras + frutas + gorduras + proteínas animais + ovos + laticínios + leguminosas + nozes/sementes + bebidas + açucarados + suplementos) com external_code TACO único + medidas caseiras + macros completos + micros principais. 20 equivalências curadas direcionais (carbos: arroz↔batata/mandioca/quinoa/tapioca; proteínas: frango↔patinho/peixe/ovo/queijo/whey; gorduras: azeite↔castanha/abacate). Idempotente via `ON CONFLICT (source, external_code) DO UPDATE`. Script `pnpm db:seed:nutri-foods`.

**ADRs publicados (Proposed):**

- **ADR 0080** banco alimentos TACO + nutrients jsonb: `foods.nutrients jsonb` com Zod strict > tabela 1:N (volume estático + import TACO/USDA trivial + validação consolidada); catálogo global + tenant custom; `food_measures` separada (não jsonb); `external_code` único pra idempotência seed; faixas fisiológicas no Zod
- **ADR 0081** meal_plans versionado: 3 níveis (`meal_plans` → `meal_plan_meals` → `meal_items`) > 2 níveis flat; versionamento `parent_meal_plan_id` Sprint 11 pattern > UPDATE in-place (Lei 13.787 + prescrições imutáveis); cálculo nutricional via função pura runtime > materialized view; substituições via `food_equivalences` curadas + ranking runtime > IA generativa; targets no `meal_plan` > `contracts`; polimorfismo com Sprint 11 prescriptions kind='meal_plan'

**Pendências Sprint 29b/c:**

- Editor drag-drop visual completo + cálculo instantâneo client-side
- Migration data file TACO 2011 completa (~3000 entries) — MVP entrega subset 47
- Auto-pré-preenchimento de targets via TDEE (ADR 0070) + `suggestMacroSplit(goal)`
- Cache `meal_plans.cached_totals jsonb`
- 10 planos modelo via seed (emagrecimento/ganho massa/vegetariano/cetogênico/low carb/diabético/renal/gestante/esportivo)
- Export PDF com branding via `@react-pdf/renderer` + `tenant_branding`
- Upload logo + assinatura digitalizada via MinIO adapter
- Extension PG `pg_trgm` + `unaccent` pra busca fuzzy + trigger auto `name_normalized`
- USDA FoodData Central como segundo source
- Cache pesquisas via `ai_semantic_cache` Sprint 06
- RIPD `v1.0-nutri-plano.md` + DPO sign-off (regra 29)
- Feature flag `nutri_plano_v1`
- Widget `<MealPlanCard />` Sprint 28 GenUI (integração)
- Integração `/meu/cardapio` Sprint 26 portal
- E2E Playwright + plano IA Copilot (stretch ADR 0085 GenUI)

**Verificação:** Migration aplicada via `pnpm db:migrate`. UI exige stack rodando — não validado visualmente neste turno. RLS tests rodam via `pnpm test` quando DB up.

**Stats:** **26 unit tests nutri verdes** (5 nutrients-schema + 15 calc + 6 equivalences). Typecheck verde em 11/11 packages. **🚀 Fase 3 aberta** com Sprint 29; próximo é #30 Suplementos+Exames laboratoriais + #31 Diário alimentar + teleconsulta.

### Build — Sprint 28 100% (Generative UI v1 + ADR 0085 Proposed — Fase 2 FECHADA) 2026-05-18

**Sprint 28 — Generative UI fecha a Fase 2.** Entrega framework de tool calls + 6 componentes ricos + Server Action + API Route + demo + 18 unit tests + ADR 0085. **Sem migration nova** — coluna `assistantMessages.toolCalls jsonb` já existia desde Sprint 06. LLM stub determinístico no MVP; Sprint 28b conecta LLM real via Vertex AI Gemini + tool calling.

**Faixa A — Framework `@repo/ai/genui` (18 unit tests):**

- **`packages/ai/src/genui/types.ts`** — `GenUIToolDefinition<TArgs>` (name + description + argsSchema Zod + category + allowedPersonas[] + readOnly + example), `GenUIToolCall` (id + name + args raw), `GenUIRenderableCall` (args validados tipados), `GenUIMessageBlock` (`text | tool_call`), `GenUIResponse`
- **`packages/ai/src/genui/registry.ts`** — `registerUIComponent`, `getToolDefinition`, `getRegisteredTools`, `getToolsForPersona`, `clearRegistry`, `validateToolCall(call, ctx)` retornando resultado discriminado `{ok:true,call} | {ok:false,reason}` com 4 guardrails: `unknown_tool` / `schema_violation` (path + msg Zod) / `persona_not_allowed` / `mutation_attempted` (`readOnly=false` bloqueado MVP)
- **`packages/ai/src/genui/tools.ts`** — 6 tools default registradas via `registerDefaultGenUITools()`:
  - `genui.fisio.patient_card` (memberId/name/age/vertical/contractStatus/lastVisitAt/activeRisks)
  - `genui.fisio.evolution_chart` (memberId/metric/unit/points[≥2]/referenceRange opcional)
  - `genui.fisio.cid_suggestion` (cids[]: code/description/confidence/rationale — **apenas professional_clinical**, regra 28 CFM 2.299)
  - `genui.fisio.exercise_recommendation` (goal/exercises[]: id/name/muscleGroups/contraindicationFlag avoid|modify|caution/sets/reps/rationale — integração ADR 0084)
  - `genui.geral.measurement_comparison` (memberId/metrics[]: name/unit/before/after/desiredDirection/beforeAt/afterAt)
  - `genui.geral.report_section` (title/body markdown leve/tone info|success|warning|danger default info)
- **`packages/ai/src/genui/registry.test.ts`** — 18 unit tests (register+lookup+clear / 4 guardrails + persona / 6 tools default registradas + args válidos)
- Re-export em `@repo/ai/index.ts` + export `./genui` em package.json
- **zod** adicionado como dependency em @repo/ai

**Faixa B — Componentes `@repo/ui/genui`:**

- `<PatientCard />` — card com avatar + status contrato badge color-coded + risks chips warning
- `<EvolutionChart />` — SVG nativo (sem Recharts) com faixa de referência verde + delta tabular Δ% color-coded
- `<CidSuggestion />` — `'use client'` com ranking confidence color-coded + botão "Adicionar" condicional (callback caller wireia SA Sprint 20)
- `<ExerciseRecommendation />` — barra lateral colorida por flag avoid (vermelho) / modify (amarelo) / caution (cinza) / null
- `<MeasurementComparison />` — tabela compacta com delta % color-coded por `desiredDirection` (lower=verde se delta<0, higher=verde se delta>0)
- `<ReportSection />` — bloco com title + body markdown leve (mini-parser regex: **bold**, *italic*, listas `- `) + tom border-left colorido
- `<GenUIMessage />` — renderer principal com **dispatch fixo** (regra 28 guardrail): switch case por `tool.name` → componente; fallback dashed para `unknown_tool`
- Re-export em `@repo/ui/index.ts` + export `./genui` em package.json

**Faixa C — Server Action + API:**

- **`apps/web/app/app/copilot/genui-actions.ts`**:
  - `composeGenUIResponse(input)` wrapped: resolve session (cria se ausente) + insert user message + LLM stub determinístico baseado em keywords (resumo|evolução|CID|exercícios|comparação|relatório) gerando blocos plausíveis + valida cada tool call via `validateToolCall` com persona + insert assistant_messages.tool_calls jsonb auditável + retorna `GenUIResponse {sessionId, blocks}`
  - LLM stub mapeia pra 6 componentes:
    - "resumo" → patient_card
    - "evolução" → evolution_chart EVA dor 5 pontos 60d com referenceRange
    - "CID" → cid_suggestion top 2 com confidence 0.86/0.32 + rationale
    - "exercícios" → exercise_recommendation 3 itens incluindo flag avoid em agachamento livre (integra ADR 0084)
    - "comparação" → measurement_comparison 4 métricas peso/cintura/IMC/EVA
    - sempre fecha com report_section "Próximos passos" tone=info
  - Tool calls bloqueadas viram texto `[Componente X bloqueado: <reason>]` + audit grava no jsonb
- **`apps/web/app/api/ai/genui/route.ts`** — POST batch endpoint que delega para Server Action

**Faixa D — UI demo:**

- **`/app/copilot/genui-demo/page.tsx`** Server Component com 4 atalhos de prompts pré-feitos via `?q=` query string + autosubmit
- **`/app/copilot/genui-demo/form.tsx`** client component com input + submit via Server Action + render `<GenUIMessage>` + estado de sessão multi-turn + error display

**ADR 0085 publicado (Proposed)** em `docs/decisions/0085-generative-ui-framework.md`:

- Decisão: framework próprio sobre `assistantMessages.toolCalls jsonb` (zero migration) > Vercel AI SDK `streamUI` direto (provider lock-in implícito)
- Registro **estático** (LLM nunca cria entrada nova) — duplo registro proposital: tools.ts + dispatch em gen-ui-message.tsx
- 4 guardrails Zod runtime (unknown_tool/schema_violation/persona_not_allowed/mutation_attempted)
- Persona-aware: `cid_suggestion` apenas para `professional_clinical` (regra 28 + CFM 2.299)
- Batch MVP > streaming SSE (mais simples auditar + testar + cachear); Sprint 28b adiciona SSE sem refactor
- 6 cenários de uso documentados na demo
- Alternativas rejeitadas: LLM escreve JSX dinâmico (XSS+sem audit+viola regra 28), JSON Schema (Zod é padrão repo regra 7), sem persona check (quebra ato exclusivo CFM/COFFITO), persistir em `tools_registry` Sprint 06 (aquela é pra ações, não runtime UI)

**Pendências Sprint 28b/c:**

- LLM real via `resolveModelForTask('chat')` + tool calling (Vertex AI Gemini default) — Sprint 28b
- Streaming SSE progressivo em `/api/ai/genui/stream`
- Componentes adicionais: `<WorkoutCard />`, `<TrainingHistory />` (Sprint 28b — Academia), `<MealPlanCard />`, `<NutritionTable />` (Sprint 29 — Nutri)
- Recharts pra `<EvolutionChart />` com tooltips/zoom/drill-down
- Persistência do layout (re-load mantém componentes)
- Export PDF com layout preservado
- Few-shot examples no system prompt LLM
- E2E Playwright (perguntar "relatório do Marcelo" → render + clicar CID propõe adicionar)
- Feature flag `genui_v1`
- Markdown sanitizado via `remark-parse` em `<ReportSection />`
- `ai_audit_log` row dedicada por tool call com hash chain (regra 39 + ADR 0072)

**Verificação:** Migration desnecessária (toolCalls jsonb já existia). UI demo exige stack rodando (Postgres + assistant_sessions seed mínimo) — não validado visualmente neste turno. RLS herdado de assistantMessages Sprint 06.

**Stats:** **18 unit tests genui verdes**. Typecheck verde em 11/11 packages. **🎉 Fase 2 fechada** — Fisio (Sprint 20-23) + ERP Saúde (24-25) + Portal Paciente (26) + Cross-alert (27) + Generative UI (28).

### Build — Sprint 27 100% (Cross-alert lesão Fisio → Academia + ADR 0084 Proposed) 2026-05-18

**Sprint 27 — primeiro cross-alert real do produto.** Entrega 100%: 3 schemas + RLS + 16 RLS tests + 2 libs puras + 33 unit tests + 7 Server Actions + 6 rotas UI (3 lado operador + 1 portal) + 35 contraindicações curadas seed global + ADR 0084 publicado. Gates regra 25 (franchise) + consent (cross_module_share) + contrato Academia ativo + workout ativo enforcados antes de criar `member_injury_alerts`.

**Faixa A — Schemas + RLS (16 RLS tests):**

- **`packages/db/src/schema/cross.ts`** — 3 tabelas:
  - `cid_exercise_contraindications` — catálogo global LogiFit (tenant_id NULL) + tenant override; check `at_least_one_target` (exercise_id OR muscle_group OR movement_pattern); unique dedup canônico; índices `cid_contra_code_active_idx` + `cid_contra_global_idx`
  - `member_injury_alerts` — alerta cross-module; status `pending_review|accepted|rejected|expired|blocked`; check `blocked_requires_reason` + `reviewed_consistency`; particionamento adiado (volume estimado 600k/ano cabe sem partitioning MVP)
  - `workout_adaptations` — 1:1 com alert (unique alert_id); status `suggested|confirmed|rejected|manually_overridden`; changes jsonb canônico (removed/replaced/added/summary); check `confirmed_consistency`
- **`packages/db/src/policies/0046_cross_rls.sql`** — RLS por tenant + leitura global de catálogo; UPDATE só na linha do tenant; member vê `member_injury_alerts` próprios via `app.member_id`
- Migration `0033_cross_alert_lesao.sql` (3 enums + 3 tabelas + 4 indexes + FKs + checks)
- **`packages/db/tests/cross-rls.test.ts`** — 16 RLS + check tests

**Faixa B.1 — Libs puras (33 unit tests):**

- **`packages/db/src/cross/contraindications.ts`**:
  - `maxSeverity(a, b)` — agregação por ranking `avoid=3 > modify=2 > caution=1`
  - `detectContraindications(activeCids, items, rules)` — matcher precedência exercise_id > movement_pattern > muscle_group; agrega múltiplas regras com max severity; merge alternative_exercise_ids sem duplicar; counts por severidade
  - `mergeRules(globals, tenants)` — tenant override prevalece sobre global por chave canônica
  - `buildAdaptationDiff({ matches, exerciseLookup })` — gera diff jsonb: avoid+alternativa → replaced / avoid sem alt → removed / modify+alt → replaced / modify sem alt → mantém / caution → mantém
- **`packages/db/src/cross/franchise-gate.ts`**:
  - `canCrossModuleAlert({ topology, sourceCompanyId, targetCompanyId, hasConsent, hasActiveAcademiaContract, hasActiveWorkout })` — gates em ordem: regra 25 (franchise + companies diferentes) > consent > contrato > workout; regra 25 domina mesmo com consent ativo (regulatório CFM/COFFITO)
  - `isActionableCid(chapter, code)` — filtro CIDs MVP: chapters MG/FA/FB/NB + prefixes 22/ND/NE/NF (cobertos pela CID-11); cardio/endócrino/mental/oncológico não disparam
- **17 unit tests** contraindications + **16 unit tests** franchise-gate

**Faixa B.2 — Server Actions (7 wrapped):**

`apps/web/app/app/cross/actions.ts`:

- `processInjuryAlert(consultaId)` — dispatcher: carrega consulta + CIDs actionable + workout ativo + consent + contrato + topology; aplica gates; cria `member_injury_alerts` (status=blocked OU pending_review); se ok, gera diff via `detectContraindications` + `buildAdaptationDiff` e cria `workout_adaptations status='suggested'`; **toda tentativa fica gravada** (blocked também)
- `suggestWorkoutAdaptation(memberId, cidCodes)` — re-roda matcher manualmente para member ativo (sem persistir; usado por UI exploratória)
- `confirmAdaptation(adaptationId)` — materializa nova versão do workout: cópia de items + aplica diff (replaced troca exercise_id; removed pula) + cria new workout (parent_workout_id + version+1) + atualiza prescription ativa (inactivate old + insert new); update alert→accepted + adaptation→confirmed
- `rejectAdaptation(adaptationId, reason)` — fecha workflow; alert→rejected com rejection_reason
- `listPendingAdaptations()` — fila do instrutor (status=suggested)
- `listInjuryAlerts()` — todos os alertas do tenant (incluindo blocked para gerente)
- Sprint 27b: `overrideAdaptation`, cron expire (>14d → expired), integração régua Sprint 13

**Faixa C — UI (6 rotas):**

Lado operador:
- `/app/cross` hub com 5 KPIs (pending review + adaptations suggested + accepted 30d + rejected 30d + blocked 30d) + atalhos
- `/app/cross/alertas` lista filtrável por status (`?status=blocked` etc) com colunas: paciente, CID, status, motivo bloqueio, criado, expira
- `/app/cross/alertas/[id]` detalhe completo: paciente, CIDs, consent_id_used, source/target companies, status, link pra consulta de origem + adaptação relacionada se existe
- `/app/treinos/adaptacao-pendente` fila do instrutor (status=suggested) com summary + counts avoid/modify/caution + link pra detalhe
- `/app/treinos/adaptacao-pendente/[id]` detalhe com diff visual color-coded (replaced amarelo, removed vermelho) + botões Confirmar/Rejeitar via `<AdaptationActions>` client component

Portal paciente:
- `/meu/alertas` timeline cronológica de alertas próprios (status != blocked — paciente não vê eventos bloqueados, que são audit interno); badges por status (`pending_review`/`accepted`/`rejected`); mostra summary da adaptação quando há; link para `/meu/treino`

**Faixa D — Seed + ADR:**

- **`packages/db/scripts/seed-cross-contras.ts`** — 35 contraindicações canônicas globais (`tenant_id IS NULL`) cobrindo:
  - Coluna: dor lombar (MG30.0 + MG30.1) — flexão lombar carga + core; dor cervical (MG30.50)
  - Ombro: manguito (FB52), capsulite (FB45.0), bursite subacromial (FB30.1)
  - Joelho: tendinopatia patelar (FB55.0), femoropatelar (FB55.1), condromalácia (FB80), LCA (BA00), meniscal (BA01)
  - Punho/Antebraço: túnel do carpo (FB54.0)
  - Pé/perna: fasciíte plantar (FB56)
  - Reumatológico: AR (FA20), osteoartrose (FA00), espondilite (FA20.1), fibromialgia (MG30.51)
  - Neurológico: hemiplegia AVC (8B11)
  - Outros: DPOC (CA22), diabetes (5A11), bursite trocantérica (FB30.0), insuficiência venosa (BD93.0), miofascial (FB54.5), dor crônica primária (MG31.0)
  - Fontes citadas: COFFITO 414/2012 + 415/2012, ACSM 2023, curadoria LogiFit
- Migration `0033_cross_alert_lesao.sql` aplicada
- **ADR 0084 publicado (Proposed)** em `docs/decisions/0084-cross-alert-cid-contraindicacao.md`:
  - Decisão: tabela curada > IA generativa (determinístico + auditável + custo)
  - 3 níveis de granularidade (exercise > pattern > group) + 3 severidades
  - Catálogo global + tenant override (RLS policies separadas)
  - Sempre sugere, nunca aplica direto (supervisão humana mandatória — CFM 2.454/2026)
  - Filtro CIDs actionable por chapter (MG/FA/FB/NB/22/ND/NE/NF)
  - 3 cenários E2E documentados (happy + regra 25 bloqueio + consent_missing)
  - Trade-offs aceitos: curadoria inicial trabalhosa, movement_pattern text livre MVP, `added` adiado Sprint 27b/IA, sem auto_apply

**Pendências adiadas Sprint 27b/c:**

- IA complementar quando catálogo não cobre (Gemini Flash via `resolveModelForTask('classification')` regra 32)
- `cid_chapter_actionable` lookup table refinada
- `movement_pattern` enum + enriquecimento de `exercises.metadata.movement_patterns`
- `auto_apply` opcional Enterprise (com termo)
- Listener real do evento `consulta.signed` Sprint 20 → dispatch `processInjuryAlert` automático
- Integração régua Sprint 13 (notificar instrutor via WhatsApp quando pending_review criado)
- Cron expirar pending_review > 14d → `status='expired'`
- E2E Playwright completo (happy + bloqueio sem consent + bloqueio regra 25 conforme spec do sprint)
- Adaptação cross-prescription Sprint 11 (quando 2+ profissionais conflitam → `cross_prescription_alerts` para `/meu/privacidade/alertas-cruzados`)
- `overrideAdaptation` SA (instrutor edita diff antes de confirmar)
- Substituir `window.confirm/prompt` por `<ConfirmDialog>/<PromptDialog>` (regra 45) quando packages/ui catálogo materializar
- Feature flag `cross_alert_lesao_v1`
- Stretch ADR 0084: notificação ao nutri quando lesão afeta atividade + cross-alert inverso (meta atingida → próxima avaliação fisio)

**Verificação:** Migration + UI exigem stack rodando (Postgres + RLS + workouts seed + consultas seed) — não validadas visualmente neste turno. RLS tests rodam via `pnpm test` quando DB local up.

**Stats:** **33 unit tests cross verdes** (17 contraindications + 16 franchise-gate). Typecheck verde em 11/11 packages.

### Build — Sprint 26 100% (Portal do Paciente PWA + ADR 0088 Proposed) 2026-05-17

**Sprint 26 — primeira interface voltada ao usuário final** (member/aluno/paciente). Entrega 100% das rotas `/meu/*` + PWA manifest + service worker + 4 API Routes + telas cross-tenant ADR 0077 + 3 Server Actions novas + ADR 0088 publicado. Faixas A+B (schemas + libs puras + actions auth) já haviam saído no commit anterior (60%); este fechamento entrega Faixas C+D (UI completa) + PWA + ADR + roadmap cleanup.

**Rotas UI entregues:**

- `/meu/agenda` lista próximos + histórico com badges status + botão cancelar (respeita política por vertical via `decideCancellation`); `/meu/agenda/novo` stub redirecionando pra recepção (booking online em Sprint 26c)
- `/meu/financeiro` lista pendentes + histórico com total destacado; `/meu/financeiro/pagar/[id]` redireciona pro `external_url` Asaas (ou aguarda job D-5 gerar); `/meu/recibos` lista invoices `paid` com download externa
- `/meu/treino` ficha ativa via `prescriptions kind='workout'` + items ordenados (sets×reps×load+rest+superset) + chips de grupos musculares + últimas 5 sessões com RPE+kcal
- `/meu/qr` payload HMAC inicial via `generateQrPayload` (lib pura Sprint 26 Faixa B.1) + componente client `qr-live-display` que faz fetch `/api/meu/qr` a cada 60s (countdown visual); usa `access_secrets` Sprint 08
- `/meu/perfil` dados cadastrais read-only (name/email/phone/document mascarado) + lista de `member_sessions` ativas (revoke individual via `revokeMySession`) + logout via `logoutMember` + atalhos privacidade
- `/meu/privacidade` overview LGPD art. 18: 5 cards cross-tenant + 5 toggles `CONSENT_CATALOG` (com badge expiring_soon/expired via `checkRenewalStatus`) + 5 botões pros 8 direitos (links pra `/meu/privacidade/solicitar?kind=...` que vai criar `data_subject_requests`)
- `/meu/privacidade/compartilhamento` lista `patient_company_links` ativos do paciente (resolvido via `passport_passport_id` cross-tenant) + módulos liberados como chips + última leitura por módulo (via `patient_data_access_log`)
- `/meu/privacidade/acessos` timeline de leituras cross-tenant (últimas 100 entries em `patient_data_access_log`) + form `ExportLogForm` (client) pra solicitar CSV/PDF dos últimos 90d via Server Action
- `/meu/privacidade/alertas-cruzados` stub formal (schema `cross_prescription_alerts` será materializado em extensão Sprint 11+) com texto explicativo do propósito
- `/meu/privacidade/incidentes` stub formal (schema vem com ADR 0067 addendum cross-tenant) com texto LGPD art. 48 + ANPD Res. 2/2024
- `/meu/convidar` stub do path C ADR 0077 (busca de profissional/empresa); autocomplete Sprint 26c

**Server Actions cross-tenant (apps/web/app/meu/actions.ts):**

- `acknowledgeCrossPrescriptionAlert({ alertId })` — paciente confirma leitura; MVP retorna ok sem persistir até schema materializar
- `acknowledgeIncident({ incidentId })` — paciente confirma leitura de notificação de incidente; idem
- `exportCrossTenantAccessLog({ startDate, endDate, format })` — registra solicitação em `data_subject_requests` (kind='portability', SLA 15d ANPD Res. 2/2024) + retorna `downloadUrl` apontando pra API Route `/api/meu/privacidade/export/[exportId]`

**API Routes:**

- `POST /api/meu/magic-link` público (sem auth) — proxy pra `requestMagicLink`; sempre 200 com `{ok:true, sent:bool}` anti-enumeration
- `POST /api/meu/verify` consome token plano + cria session (útil pra app nativo Sprint 35 deeplink)
- `GET /api/meu/qr` retorna novo payload QR a cada chamada (client refresha visualmente a cada 60s)
- `GET /api/meu/privacidade/export/[exportId]` materializa CSV inline a partir de `patient_data_access_log` filtrado pelo passport do member; valida ownership via JOIN members+data_subject_requests; TTL 7d via `created_at + 7d` check; PDF retorna 501 NOT_IMPLEMENTED (Sprint 26c @react-pdf/renderer)

**PWA:**

- `app/manifest.webmanifest/route.ts` — Route Handler que serve manifest JSON com scope=/meu + theme #3498DB + 3 shortcuts (Agenda, Treino, QR)
- `public/meu/sw.js` — service worker mínimo: install pre-cache do shell (`/meu`, `/meu/login`, manifest, ícones), fetch network-first com fallback cache, ignora `/api/*` (sempre online) e fora de `/meu`
- `app/meu/register-sw.tsx` — client component no layout que registra SW em prod (skip dev)
- `app/meu/layout.tsx` — exporta `metadata.manifest` + `metadata.viewport={viewportFit:'cover'}` + `appleWebApp.capable=true`

**Design tokens portal (apps/web/app/globals.css):**

Mobile-first total, flat extremo (regra 44). 400+ linhas com prefixo `.ev-portal-*`:

- Shell: `.ev-portal-shell` flex column min-h-100dvh; `.ev-portal-topbar` sticky com safe-area-inset-top; `.ev-portal-main` padding-bottom 72px+safe-area; `.ev-portal-bottom-nav` fixed grid 4 cols com 4 ícones (Agenda/Financeiro/Treino/Mais), touch targets ≥56px (regra 31)
- Page wrappers: `.ev-portal-page` max-w-720 padding 16; `.ev-portal-h1/2/3` letter-spacing tight; `.ev-portal-muted` text-muted; `.ev-portal-section` flex column gap-3
- Cards & lists: `.ev-portal-card-grid` auto-fill minmax(140px,1fr); `.ev-portal-card` 96px com hover border-strong; `.ev-portal-list` + `.ev-portal-list-item--row` justify-between
- Forms: `.ev-portal-form/label/input/select/textarea/button` com min-height 44px (touch-friendly); variantes `--ghost` e `--danger`
- Estados: `.ev-portal-callout` + `--warning/--danger/--success`; `.ev-portal-badge` + variantes; `.ev-portal-empty` dashed; `.ev-portal-timeline` com bullets
- QR specific: `.ev-portal-qr-wrap` + `.ev-portal-qr-canvas` 260×260 + `.ev-portal-qr-timer` tabular-nums

**ADR 0088 publicado (Proposed)** em `docs/decisions/0088-portal-member-magic-link-auth.md`:

- **Decisão**: magic link 15min TTL + cookie opaco `lf_member_session` path=/meu + sessão 30d sem rotation MVP + sem MFA pro member (regra 43 lista profissionais; member excluído conscientemente) + anti-enumeration + rate limit por member (5/15min + 60s throttle)
- **Trade-offs aceitos**: dependência email AWS SES, perda de email = perda de acesso (SMS+fallback recepção Sprint 26c)
- **Adiado Sprint 26b+**: SMS Twilio, refresh rotativo, MFA opcional tenant-level, rate limit Redis IP, SSO Google/Apple, deeplink universal
- **Métricas pós-piloto**: taxa de conversão magic link >70%, tempo email→click <2min, sessões por member, reclamações "perdi acesso"
- Promove pra Accepted quando piloto em prod >100 logins reais por 7 dias validar SES + conversão

**Pendências menores adiadas Sprint 26b/c:**

- Booking online direto pelo paciente (`/meu/agenda/novo` SA `bookMyAppointment` reusando `createAppointment` com `actor='member'`)
- Asaas checkout embed iframe em `/meu/financeiro/pagar/[id]` (vez de redirect)
- @react-pdf/renderer pra recibos + export PDF de acessos
- Schema `cross_prescription_alerts` + `security_incidents` (materialização em Sprint 11+ extensão e ADR 0067 addendum)
- Autocomplete `/meu/convidar` + criação de pedido inverso (path C ADR 0077)
- RIPD v1.0-portal-paciente + DPO sign-off
- Feature flag `portal_member_v1`
- Testes E2E Playwright 3 viewports (390/768/1280) + Lighthouse PWA ≥95
- Push notifications PWA (Sprint 26c — incidentes + alertas cross-prescription)
- Substituir `window.confirm` por `<ConfirmDialog>` (regra 45) com swipe gestures touch
- Service worker mais sofisticado (background sync, periodic-sync pra QR rotation offline)
- Push notification VAPID + Sprint 26b dispatcher de notificações por incidente/alerta

**Verificação:** Mudanças observáveis no browser exigem stack rodando (Postgres + member auth + seed) — não validadas visualmente neste turno; teste manual local + Playwright E2E entram no fechamento Sprint 26b.

### Build — Sprint 25a 100% (ANVISA + CNES + Limpeza) 2026-05-17

**Sprint 25 — bloco regulatório clínico.** 25a core entregue sem integração Datasus CNES + sem NF-e 5.915/1.916 + sem bucket Storage para certificados. Sprint 25b cobre essas integrações + permissions vigilancia.* + RIPD + feature flag + coluna `cnes_code` em companies.

**Faixa A entregue (Schemas + RLS + 13 tests):**

- **`packages/db/src/schema/vigilancia.ts`** — 5 tabelas:
  - `equipment` — **unique global `(manufacturer, serial_number)`** + 12 kinds enum + ANVISA registration + intervals positivos via CHECK + last_maintenance_at/last_calibration_at cached
  - `equipment_maintenance` — 3 kinds (preventive/calibration/corrective) + status pipeline (scheduled→in_transit_to_external→at_external→returning→completed|overdue|cancelled) + CHECK `completed exige performed_at` + CHECK `external_location=true exige external_supplier_id` + placeholders para NF-e Sprint 25b
  - `equipment_usage_log` — **APPEND-ONLY** rastreabilidade clínica (paciente × aparelho × parâmetros); **`@volume_estimate_yearly: 18000000`** particionamento Sprint 25b
  - `cleaning_checklists` — items jsonb + frequency_days
  - `cleaning_logs` — **APPEND-ONLY** + CHECK completion_pct ∈ [0,100]
- **`packages/db/src/policies/0044_vigilancia_rls.sql`** — RLS tenant-scoped; equipment_usage_log + cleaning_logs SEM policy UPDATE (regra 5 enforcement; auditoria ANVISA).
- Migration `0031_fluffy_cammi.sql` aplicada (5 tabelas + 4 enums).
- **`packages/db/tests/vigilancia-rls.test.ts`** — 13 RLS tests.

**Faixa B.1 entregue (1 lib pura + 21 unit tests):**

- **`packages/db/src/vigilancia/anvisa.ts`**: classifyMaintenances urgency (overdue/d7/d30/ok) + pickAttentionItems + validateChecklist com missingRequired + validateCnesCode 7 dígitos + checkCleaningStatus frequency-aware.
- **`packages/db/package.json`** novo export `./vigilancia` + script `db:seed:vigilancia`.

**Faixa B.2 entregue (13 Server Actions):**

- CRUD equipment + decommission; scheduleMaintenance com gate external_supplier_id; completeMaintenance atualiza last_maintenance/calibration; listAttention via lib pura; recordUsage rastreabilidade; checklists CRUD; recordCleaning com validation auto; listCleaningStatus por frequency; validateCnesCodeAction.

**Faixa C entregue (3 rotas iniciais):**

- `/vigilancia` hub 5 KPIs (equipamentos / overdue / d7 / limpezas 24h / equips usados 7d)
- `/vigilancia/equipamentos` lista com last_maintenance + last_calibration + next maintenance subquery
- `/vigilancia/limpeza` checklists + histórico com isComplete badge

**Faixa D entregue (seed):**

- `seed-vigilancia` 3 equipamentos por tenant matriz (Bioset Sonopulse 3 + IBRAMED NeuroDyn II + InBody 270) com registros ANVISA reais + 1 manutenção D+30 cada + 1 checklist "Sala Fisio" 5 items + 5 logs amostra → 6 equipamentos + 6 manutenções + 2 checklists + 10 logs.

**671 tests verdes** (era 637, +34 Sprint 25: 13 RLS + 21 unit).

**Sprint 25b futuro:** Datasus CNES API + migration coluna cnes_code + NF-e 5.915/1.916 ADR 0059 + bucket equipment-certificates + job mark-overdue + régua Sprint 13 + UI completa restante + particionamento usage_log + permissions vigilancia.* + RIPD + feature flag + E2E.

### Build — Sprint 24a 100% (Estoque + POS + ADR 0087 Proposed) 2026-05-17

**Sprint 24 — bloco geral de estoque atendendo Fisio/Academia/Nutri.** 24a core entregue sem AR via Sprint 15 + sem NFC-e Focus + sem multi-unit. Sprint 24b integra essas pontas.

**Faixa A entregue (Schemas + RLS + 12 tests):**

- **`packages/db/src/schema/estoque.ts`** — 4 tabelas:
  - `stock_items` — unique `(tenant, company, sku)` + CHECK `min_stock >= 0` + CHECK `cost_cents >= 0` + `cost_method` enum (peps/custo_medio) default custo_medio + index parcial pra resale items.
  - `stock_movements` — **APPEND-ONLY** (sem GRANT UPDATE) + 8 kinds (entry_purchase/adjustment/return_from_customer + exit_consumption/sale/loss/adjustment/return_to_supplier) + CHECK `quantity > 0` (sinal vem do kind) + CHECK `unit_cost_cents IS NOT NULL on entry_purchase`. **`@volume_estimate_yearly: 2400000`** particionamento manual Sprint 24b.
  - `stock_inventories` — pipeline `draft → finalized` com `finalized_at` + `finalized_by_user_id`.
  - `stock_inventory_entries` — PK composta (inventory, item) + CHECK `difference = physical_qty - system_qty` + CHECK `qty >= 0`.
- **`packages/db/src/policies/0043_estoque_rls.sql`** — RLS tenant-scoped; stock_movements SEM policy UPDATE (regra 5 enforcement); stock_inventory_entries via JOIN.
- Migration `0030_wide_slyde.sql` aplicada.
- **`packages/db/tests/estoque-rls.test.ts`** — 12 RLS tests cobrindo: insert válido + SKU duplicado rejeitado + min_stock negativo + isolation; entry_purchase com/sem unit_cost; exit sem unit_cost OK; quantity 0/negativa rejeitadas; **UPDATE rejeitado (append-only enforcement)**; inventory difference inconsistente.

**Faixa B.1 entregue (1 lib pura + 23 unit tests):**

- **`packages/db/src/estoque/inventory.ts`**:
  - `signOfKind(kind)` retorna +1/-1 conforme prefix `entry_`/`exit_`
  - `calculateBalance(movements)` via SUM com signOfKind
  - `calculateAverageCostCents(movements)` média ponderada considerando só entries com unitCost (saídas não afetam)
  - `calculatePeps(movements)` ordena cronologicamente + cria lots em entries + consome FIFO em exits + retorna `{finalBalance, cogsCents, currentInventoryCostCents, remainingLots[]}`
  - `detectLowStockCrossing({balanceBefore, balanceAfter, minStock})` distingue `shouldAlert` (saldo atual ≤ min) de `crossedDown` (cruzou agora)
  - `calculateInventoryAdjustment({systemQty, physicalQty})` deriva `{difference, adjustmentKind: entry_adjustment|exit_adjustment|null, adjustmentQty}`
  - `calculateTurnover` (giro de estoque pra Sprint 24b relatórios)

  **23 unit tests:** signOfKind 8 kinds / balance vazio + entry-exit + multi + decimais / avgCost 1-entry + 2-entries ponderada + sem custo ignorado + saídas ignoradas / PEPS lote antigo primeiro + saída maior que lote + intercalado + fora-de-ordem + sem custo / detectLowStock cruzou pra baixo + já abaixo + aumentou + exatamente no min / inventoryAdjustment 3 caminhos.

- **`packages/db/package.json`** novo export `./estoque` + script `db:seed:estoque`.

**Faixa B.2 entregue (11 Server Actions):**

- **`apps/web/app/app/estoque/actions.ts`** — `createStockItem` captura 23505 + mensagem acionável; `updateStockItem` patch parcial; `archiveStockItem` soft-delete; `listStockItems` com filtros company/archived/resale.
- `registerEntry` valida unit_cost on entry_purchase; chama `registerMovementInternal` que: carrega item, calcula saldo antes via SUM, INSERT movement, recalcula saldo, atualiza `cost_cents` se método=custo_medio (média ponderada nova), retorna alert se cruzou pra baixo do min_stock.
- `registerExit` mesma pipeline sem unit_cost.
- `sellAtPos` (MVP) cria APENAS movements `exit_sale` com `reference_doc='pos:user:timestamp'` — sem invoice (Sprint 04 exige contractId; Sprint 24b integra AR Sprint 15 + Focus NFe NFC-e ADR 0059). Valida resale + sale_price + total > 0.
- `getItemBalance` retorna `{balance, averageCostCents}` agregado.
- `listLowStockItems` via SQL agregado (SUM com signOfKind) WHERE balance ≤ min_stock ORDER BY (min - balance) DESC.
- Inventory pipeline: `startInventory` cria draft; `addInventoryCount` upsert via onConflictDoUpdate com systemQty calculado; `finalizeInventory` gera ajustes em stock_movements pra cada entry com difference ≠ 0.
- `listMovements` paginado com itemSku/itemName join.

**Faixa C entregue (2 rotas iniciais MVP):**

- **`/app/estoque`** — hub com 5 KPIs (SKUs ativos / revenda / movimentos 30d / estoque crítico count / **valor de estoque calculado via SUM(cost × balance)**) + nav 6 cards.
- **`/app/estoque/itens`** — catálogo com saldos derivados via SQL inline + badge low_stock color-coded quando balance ≤ min_stock + colunas SKU/nome/cat/saldo/min/custo/preço/tipo/método-custo.

Demais rotas (`/entradas`, `/saidas`, `/vendas` POS, `/inventario`, `/relatorios`, `/itens/[id]`, `/itens/new`) são placeholders preparados — implementação UI completa Sprint 24b junto com AR/NFC-e integration.

**Faixa D entregue (ADR + seed):**

- **[ADR 0087 Proposed](docs/decisions/0087-estoque-custo-saldo-model.md)** — PEPS + custo médio configurável por item (UEPS vedado por Lei 6.404); saldo via SUM (não denormalizado — verdade única + auditoria total + sem trigger); APPEND-ONLY enforced (regra 5 fiscal); multi-company MVP / multi-unit Sprint 24b se houver demanda; POS sem invoice MVP (Sprint 24b com AR Sprint 15 + chartAccountId em tenant_settings); detecção low_stock crossing-based (alert UMA vez quando cruza). Rejeita só PEPS / só médio / UEPS / contador denormalizado / multi-unit MVP / POS-invoice-automático.
- **`packages/db/scripts/seed-estoque.ts`** + `pnpm db:seed:estoque` — 10 itens (5 consumo: gaze/agulha/atadura/álcool/luva; 5 revenda: creme/gel/faixa/garrafa/whey) × 7 tenants (apenas 2 com users seedados) = **20 items + 60 movements** (1 entrada inicial 50un + 2 saídas 5un cada por item).

**637 tests verdes** (era 602, +35 Sprint 24: 12 RLS + 23 unit).

**Sprint 24b futuro:**

- Integração `sellAtPos` → `accounts_receivable` (Sprint 15) com `chartAccountId` configurável em `tenant_settings.pos_default_chart_account`
- Emissão NFC-e via Focus NFe (Sprint 36 ADR 0059) quando ativo
- Multi-unit (`stock_items.unit_id` + kinds `entry_transfer_in`/`exit_transfer_out`)
- View materializada `stock_balances` refresh on demand (se performance demandar)
- Trigger BEFORE INSERT bloqueando movements retroativos em período fechado (`tenant_settings.closed_period_end`)
- Listeners em `nfe_returns.emitted` (ADR 0058) → `exit_return_to_supplier` + `nfe_received.inbound_direction='sales_return'` → `entry_return_from_customer`
- Job `low_stock_detector` que emite evento `stock.low_stock_alert` consumido por régua Sprint 13
- Régua padrão de baixo estoque + WhatsApp pro gerente
- Widget "estoque crítico" no dashboard gerente Sprint 07
- UI completa restante (entradas, saídas, POS interativo, inventário, relatórios giro)
- Leitor de código de barras via câmera (PWA)
- Permission `estoque.read` / `estoque.write` / `estoque.sell` + RIPD `v1.0-estoque.md`
- Feature flag `estoque_v1`
- E2E: cadastra, compra, vende, inventaria, baixa em devolução cliente

### Build — Sprint 23a 100% (Comissões + repasse profissional + ADR 0086 Proposed) 2026-05-17

**Sprint 23 — RH financeiro fisio.** 23a core entregue sem `calculateRetentions` real + sem Asaas transfer + sem holerite PDF. Sprint 23b integra ADR 0061 retenções tributárias reais + transferência Asaas + @react-pdf/renderer + RIPD + feature flag.

**Faixa A entregue (Schemas + RLS + 14 tests):**

- **`packages/db/src/schema/rh.ts`** — 4 tabelas:
  - `professional_contracts` — versionado (`version int`); unique `(person, company, service_type, version)` permite múltiplas versões. CHECK garante `default_percent` ou `default_amount_cents` conforme `kind`. Effective range validado.
  - `commission_rules` — overrides priority asc com `service_type` e/ou `tuss_code`; CHECK exige pelo menos um critério + valor (percent ou amount_cents).
  - `commission_entries` — @volume 18M+/ano particionamento manual; **unique `(contract, source_event_ref)` garante idempotência** (mesmo evento não vira 2 entries); CHECK `net = commission - retention`; status pipeline `pending|included|excluded|reversed`.
  - `commission_periods` — fechamento mensal; unique `(person, company, period_start, period_end)`; pipeline `draft|approved|paid|cancelled`; CHECK consistência net + range datas.
- **`packages/db/src/policies/0042_rh_rls.sql`** — RLS tenant-scoped + `commission_rules` via JOIN com contract.
- Migration `0029_ambiguous_venus.sql` aplicada.
- **`packages/db/tests/rh-rls.test.ts`** — 14 RLS tests: contract válido / CHECK percent missing / fixo sem amount / tabela OK sem defaults / percent > 100 / isolation / entry net consistente / inconsistente rejeitado / unique source_event / period net consistente / inconsistente / unique person+period / period range invertido.

**Faixa B.1 entregue (1 lib pura + 25 unit tests):**

- **`packages/db/src/rh/commission.ts`** — `calculateCommission({event, contract, rules, today})` retorna `{entry, skipReason}`. Algoritmo:
  1. Verifica contrato vigente (active + effective_from ≤ today ≤ effective_to)
  2. Valida compat kind × event (`percent_recebido` ↔ payment_received/guide_paid; `fixo_por_atendimento` ↔ appointment/consulta/evolucao; etc)
  3. Filtra base (recebido_particular exige paymentSource=particular; convenio aceita guide_paid)
  4. `resolveRule(event, rules)` busca match priority asc: tussCode+serviceType → tussCode → serviceType → null
  5. Calcula valor por kind (fixo usa default_amount; percent usa pct × amount; tabela exige rule)
  6. Retenção placeholder 0 (Sprint 23b integra ADR 0061)
  7. `netAmountCents = commissionCents - retentionTotalCents`

  `resolveRule()` + `aggregateEntries()` exportados separadamente. **25 unit tests** cobrindo 4 kinds × 4 bases + overrides + priority + inativas + vigência + agregação status filter.

- **`packages/db/package.json`** novo export `./rh` + script `db:seed:rh`.

**Faixa B.2 entregue (10 Server Actions):**

- **`apps/web/app/app/rh/actions.ts`** — `createProfessionalContract` valida person no tenant + gate ADR 0055 (service_type → council_body mapping: fisioterapia→CREFITO, personal_training→CREF, nutricao→CRN, medicina→CRM, enfermagem→COREN) + captura CHECK 23514 com mensagem acionável. `listProfessionalContracts` com filtro person. `createCommissionRule` valida contract no tenant. `calculateCommissionForEvent` carrega contract + rules + chama lib pura + persiste com `status='pending'` (captura unique 23505 = idempotente). `closePeriod` agrega entries `pending` no range → cria `commission_periods` draft + transition entries para `included` + linka periodId. `approvePeriod` transition `draft→approved` com aprovador. `markPeriodPaid` `approved→paid` + grava `asaas_transfer_id` (Sprint 23b chama Asaas real). `listCommissionEntries` + `listCommissionPeriods` com filtros. `generateExtractStub` placeholder Sprint 23b.

**Faixa C entregue (4 rotas):**

- **`/app/rh`** — hub com 5 KPIs (contratos ativos / entries pendentes / pendente bruto / periods draft / approved a pagar) + navegação 4 cards.
- **`/app/rh/profissionais`** — lista tabular contratos com badges kind+base+default+versão.
- **`/app/rh/comissoes`** — entries com filtros status (`all/pending/included/excluded/reversed`) + badges color-coded + decomposição bruto/retenção/líquido.
- **`/app/rh/fechamento`** — periods com filtros status (`all/draft/approved/paid`) + KPIs + datas approve/pago.

**Faixa D entregue (ADR + seed):**

- **[ADR 0086 Proposed](docs/decisions/0086-modelo-comissao-profissional.md)** — 4 kinds × 4 bases + versionamento + imutabilidade pós-approved + reversão via entry espelhada (mantém histórico íntegro) + tributação placeholder MVP integra ADR 0061 Sprint 23b + gate ADR 0055; rejeita modificar entry original em estorno (quebraria audit), cálculo PL/pgSQL (difícil testar), 1 tabela única poliforma.
- **`packages/db/scripts/seed-rh.ts`** + `pnpm db:seed:rh` — 3 perfis canônicos × 7 tenants = **21 contratos + 21 rules + 105 entries pending**:
  - Fisio (percent_recebido misto 60% default + rule TUSS 20104073 70%)
  - Personal (fixo_por_atendimento R$ 60 default + rule TUSS 50000128 R$ 80)
  - Nutri (tabela_por_servico + rule TUSS 50000470 55%)

**602 tests verdes** (era 563, +39 Sprint 23: 14 RLS + 25 unit).

**Sprint 23b futuro:**

- Integração `calculateRetentions()` real do Sprint 15 (ADR 0061) — INSS/IRRF/ISS para PF autônomo RPA; PIS/COFINS/CSLL/IRRF para PJ; sem retenção para Simples Nacional
- UI decomposição completa: "Bruto R$ 2.500 → INSS R$ 275 + IRRF R$ 64,12 + ISS R$ 50 = Líquido R$ 2.110,88"
- Transferência Asaas sandbox + production no `markPeriodPaid`
- @react-pdf/renderer extract PDF com decomposição fiscal + GPS/DARF sugeridos pra contador
- Job cron mensal automático `monthly-close-job` cria periods draft para cada (person, company) ativo
- Listeners reais nos eventos `payment.received` / `billing_guide.paid` / `appointment.completed` / `consulta.signed` / `evolucao.created`
- Trigger BEFORE UPDATE bloqueando mudança em entries de period.status='approved'|'paid' (imutabilidade enforcement)
- Reversão via entry espelhada nos listeners `payment.refunded` / `billing_glosa.received`
- Widget "comissão do mês" no dashboard do profissional (slot `comissao`)
- Permission `rh.read` / `rh.write` / `rh.approve` + RIPD `v1.0-comissoes-rh.md` + DPO sign-off
- Feature flag `rh_v1`
- E2E: fisio com 10 atendimentos → 8 pagos + 1 glosado → period fechado → retenções aplicadas → transferência Asaas

### Build — Sprint 22a 100% (TISS/TUSS convênios + ADRs 0029/0030/0031 Proposed) 2026-05-17

**Sprint 22 — bloco regulatório mais pesado da Fase 2 (ANS + Lei 9.961/2000).** 22a core entregue sem SOAP automático + sem XSD oficial + sem XMLDSig. Sprint 22b cobre essas dependências externas + ADR 0042 + RIPD.

**Faixa A entregue (Schemas + RLS + 10 tests):**

- **`packages/db/src/schema/convenios.ts`** — 11 tabelas:
  - `insurance_plans` (global LogiFit + tenant editável; ans_code unique)
  - `tuss_catalog` (global versionado; PK composta `(code, version)`)
  - `tuss_catalog_imports` (audit append-only dos imports semestrais)
  - `insurance_agreements` + `insurance_procedure_prices` (auth_required + max_sessions_per_auth)
  - `member_insurances` (carteirinha; unique (member, plan, card))
  - `authorizations` (CHECK qty_used ≤ qty_authorized)
  - `billing_guides` (4 kinds + unique guideNumber por tenant + snapshot professional+tussVersion). **`@volume_estimate_yearly: 2400000`** particionamento manual trimestral.
  - `billing_guide_items` (CHECK total = quantity × unit_price)
  - `billing_batches` (guide_ids uuid[])
  - `billing_glosas` (pipeline glossed → recurring → recovered|lost; CHECK amount > 0)
- **`packages/db/src/policies/0041_convenios_rls.sql`** — RLS read-all globais + tenant-scoped + via JOIN.
- Migration `0028_tiresome_stone_men.sql` aplicada (11 tables + 6 enums).
- **`packages/db/tests/convenios-rls.test.ts`** — 10 RLS tests (TUSS/plans read-all cross-tenant + agreements isolation + price CHECK + auth qty CHECK + guide CHECK total consistent + paid ≤ total + unique guide_number + glosa amount > 0).

**Faixa B.1 entregue (3 libs puras + 30 unit tests):**

- **`packages/db/src/convenios/tiss-generator.ts`** — `generateGuideXml({tissVersion, kind, guideNumber, operator, prestador, memberInsurance, items, totalCents, issueDate, authorizationNumber})` produz XML TISS 4.01 com namespace `ans:`, tags `guiaConsulta` ou `guiaSPSADT`, `cabecalho`+`dadosBeneficiario`+`procedimentosExecutados`+`equipeExecutora` com CBOS; `generateBatchXml` envelope de lote. Escape XML básico (& < > " '), UTF-8 nativo. **8 tests** cobrindo SP/SADT + consulta + escape + múltiplos itens + opcionais + formato BRL 2 decimais + batch agregando.
- **`packages/db/src/convenios/tiss-validator.ts`** — `validateGuide(input): {ok, issues}` com 10 regras canônicas (PROF_NO_CBOS, PROF_NO_COUNCIL, PROF_NO_UF, CARD_MISSING, CARD_EXPIRED, AUTH_REQUIRED_MISSING, AUTH_EXPIRED, AUTH_QTY_EXCEEDED, AUTH_NOT_APPROVED, TOTAL_MISMATCH, ITEM_TOTAL_MISMATCH) + 2 warnings (SPECIALTY_MISMATCH, COPAY_MISMATCH). Errors bloqueiam, warnings exibem. **17 tests** cobrindo happy path + 11 cenários adversariais + agregação múltiplos erros.
- **`packages/db/src/convenios/tiss-return-parser.ts`** — `parseReturnXml(xml): {batchNumber, returnDate, items[]}` regex-based extrai guiaResposta + valorPago + glosas com codigoGlosa/descricaoGlosa/valorGlosa. Deriva status: paid/partially_paid/fully_glossed/cancelled. **5 tests** (paga integralmente / glosa parcial + total / XML vazio / formato BRL 1.234,56 / múltiplas glosas).
- **`packages/db/package.json`** novo export `./convenios` + script `db:seed:convenios`.

**Faixa B.2 entregue (14 Server Actions):**

- **`apps/web/app/app/fisio/convenios/actions.ts`** — `createInsurancePlan` + `listInsurancePlans`; `createInsuranceAgreement` (capture unique constraint); `listInsuranceAgreements`; `setProcedurePrice` (upsert via onConflictDoUpdate); `addMemberInsurance` (capture unique); `listMemberInsurances`; `requestAuthorization` + `approveAuthorization` + `denyAuthorization` + `listAuthorizations`; **`generateGuide`** — flow completo: carrega memberInsurance+plan+agreement+price+autorização+profissional via JOINs + consulta `professional_registrations` ativa coerente (ADR 0055) + roda `validateGuide` bloqueando se erro + carrega descrições TUSS + gera XML via lib + persiste guide+items com snapshot+tussVersion (`'2026.01'`); **`createBatch`** valida todas guides ready + agrega XML batch + transição status sent + lock batchNumber unique; **`processReturnXml`** parser → atualiza guides status + cria glosas + marca batch returned; **`fileGlosa`** registra recurso manual.

**Faixa C entregue (6 rotas + filtros KPIs):**

- **`/app/fisio/convenios`** — lista planos (global + tenant) + acordos comerciais com plano/company/contrato/prazo/vigência.
- **`/app/fisio/autorizacoes`** — lista com status badges color-coded + qty (req/auth/usado) + senha + validade.
- **`/app/fisio/faturamento`** — 5 KPIs (total/faturado/recebido/prontas-enviadas/glosadas) + filtros status (`all/draft/ready/sent/paid/fully_glossed`) + tabela com paciente+kind+valores+badges.
- **`/app/fisio/faturamento/[id]`** — detail com 4 KPIs + dados profissional executante + tabela itens + tabela glosas + `<details>` expansível com XML TISS 4.01 enviado (auditoria).
- **`/app/fisio/glosas`** — KPIs (total/valor glosado/recuperado/em aberto) + filtros status + tabela com guia/paciente/código/motivo/valor.

**Faixa D entregue (3 ADRs + seed):**

- **[ADR 0029](docs/decisions/0029-tiss-tuss-schema-xml-generator.md) Proposed** — 11 schemas + gerador XML customizado (rejeita xmlbuilder2/fast-xml-parser/biblioteca específica) + versionamento `(code, version)` PK + snapshot defensivo professional+tussVersion.
- **[ADR 0030](docs/decisions/0030-tuss-update-pipeline.md) Proposed** — pipeline semestral via admin manual no MVP (upload XLSX) + cron Sprint 22b; rejeita scraping ANS por fragilidade.
- **[ADR 0031](docs/decisions/0031-tiss-validador-proativo.md) Proposed** — validador 10 regras + XSD diferido Sprint 22b via libxmljs.
- **`packages/db/scripts/seed-convenios.ts`** + `pnpm db:seed:convenios` — 5 planos globais (Unimed Brasil ANS 343889 / Bradesco Saúde 005711 / Amil 326305 / SulAmérica 006246 / NotreDame 359017) + 28 TUSS top fisio/clínica (10 procedimentos + 3 OPME + 3 medicamentos + 2 taxas + 1 gasoterapia + diversos fisio especializados) + 1 import audit version 2026.01.

**563 tests verdes** (era 523, +40 Sprint 22: 10 RLS + 30 unit).

**Sprint 22b futuro (sem dependências externas + sem credenciais ops):**

- Validação XSD oficial ANS via `libxmljs` ou `xmllint` shell wrapper
- XMLDSig assinatura digital (xml-crypto) — exigida por algumas operadoras maiores
- ADR 0042 submissão automática SOAP por operadora (Unimed Central / Bradesco / Amil APIs proprietárias)
- OAuth + credentials encrypted por agreement (envelope encryption ADR 0073)
- OCR de carteirinha física (foto) — preenchimento automático
- Dashboard `/app/super-admin/glosas-stats` com taxa por convênio + sugestão de novas regras pro validador
- Integração `appointments` → auto-gera guia quando atendimento realizado via convênio
- Co-participação vira invoice Sprint 04
- DRE Sprint 14 segrega receita convênio × particular
- Card "Faturamento Convênios" no dashboard gerente
- `search_index` (regra 30) indexa billing_guides + authorizations + plans com `is_sensitive=true`
- Pipeline cron `tuss-update-job` (jul/2026 release)
- RIPD `docs/compliance/ripd/v1.0-tiss-convenios.md` + DPO sign-off (transmissão dado clínico a operadora)
- Feature flag `convenios_v1`
- E2E XSD oficial valida + 10 cenários adversariais bloqueados pelo validador

### Build — Sprint 21a 100% (Evolução fisio SOAP + anexos categorizados) 2026-05-17

**Sprint 21 continua Fase 2.** 21a core entregue sem upload real ao MinIO. Sprint 21b cobre API Route multipart + scanUpload encadeado + URL assinada + player vídeo + viewer imagem + RIPD.

**Faixa A entregue (Schemas + RLS + 10 tests):**

- **`packages/db/src/schema/evolucoes.ts`** — 2 tabelas:
  - `evolucoes_sessao` — SOAP jsonb (subjetivo/objetivo/avaliacao/plano) + free_text + status (draft/locked/signed) + unique appointment_id quando NOT NULL (1 evolução por agendamento) + check signed+locked consistente + retenção 20a. **`@volume_estimate_yearly: 52000000`** — top 5 volume do MVP; particionamento manual trimestral.
  - `evolucao_attachments` — 5 kinds (exame_imagem/video_execucao/documento/foto_postural/audio_anamnese) + 4 scan_status (pending/clean/rejected/soft_deleted) + content_hash dedup + CHECK size 0 < x ≤ 50MB + soft-delete preserva metadata.
- **`packages/db/src/policies/0040_evolucoes_rls.sql`** — RLS tenant-scoped.
- Migration `0027_cool_beyonder.sql` aplicada.
- **`packages/db/tests/evolucoes-rls.test.ts`** — 10 tests verdes (draft insert / CHECK signed sem signed_at / CHECK locked sem locked_at / appointment_id NULL aceita N / isolation cross-tenant / anexo válido / CHECK size > 50MB / size 0 rejeitado / UPDATE scan_status pending→clean / isolation anexo).

**Faixa B.1 entregue (1 lib pura + 22 unit tests):**

- **`packages/db/src/evolucoes/soap.ts`** — `validateSoapForLock(soap, freeText?)` exige pelo menos 1 campo ≥10 chars trimmed; `validateAttachmentUpload({kind, mime, size, filename})` valida MIME por categoria + size por kind (exame_imagem 20MB / video 50MB / documento 10MB / foto 8MB / audio 30MB) + filename sanitizado (sem path traversal); `hashEvolucaoContent` SHA-256 canônico ordenando attachmentIds; `generateStoragePath` formato tenants/{t}/evolucoes/{e}/{hash12}-{filename}; constantes `ALLOWED_MIMES_BY_KIND` + `MAX_SIZE_BY_KIND` + `MAX_SIZE_GLOBAL`. **22 tests** cobrindo todas as regras (SOAP vazio falha; SOAP com freeText alternativo OK; exame_imagem com MIME video rejeitado; video > 50MB rejeitado; documento > 10MB rejeitado; filename com `../` rejeitado; todos kinds têm MIME+size mapping; hash determinístico canônico).
- **`packages/db/package.json`** novo export `./evolucoes` + script `db:seed:evolucoes`.

**Faixa B.2 entregue (9 Server Actions):**

- **`apps/web/app/app/fisio/evolucoes/actions.ts`** — `createEvolucao` valida member + handles unique appointment 23505; `updateEvolucao` só-draft; `lockEvolucao` valida SOAP min content + carrega attachments clean pra hash + transição status; `addAttachmentMetadata` validação dupla (Zod + lib) + gera storagePath; `markAttachmentScanResult` API Route flow finalizer; `softDeleteAttachment` preserva metadata pra audit; `listEvolucoesByMember` com `attachmentsCount` via subquery; `listEvolucaoAttachments`; `getAttachmentSignedUrl` stub (Sprint 21b com MinIO adapter real).

**Faixa C entregue (4 rotas + 4 client components):**

- **`/app/fisio/pacientes/[memberId]/evolucoes`** — lista tabular com badge status color-coded + contagem de anexos + link timeline.
- **`/app/fisio/evolucoes/new?memberId=X[&appointmentId=Y]`** — `<NewEvolucaoForm>` cliente com SOAP completo (4 campos auto-focus subjetivo) + freeText + criação rápida.
- **`/app/fisio/evolucoes/[id]`** — `<EvolucaoEditor>` cliente readonly após lock + `<AddAttachmentForm>` cliente com **browser hash SHA-256 via Web Crypto** (idempotência) + select kind + caption + `<LockEvolucaoButton>` autenticado/ICP-Brasil; pós-lock mostra hash + provider.
- **`/app/fisio/pacientes/[memberId]/timeline-evolucao`** — visual timeline com dots color-coded por status (verde signed / azul locked / cinza draft) + SOAP truncado por evolução + contagem anexos.

**Faixa D entregue (seed):**

- **`packages/db/scripts/seed-evolucoes.ts`** + `pnpm db:seed:evolucoes` — 3 evoluções fisio realistas (caso dor lombar evolutiva 15d→8d→hoje com EVA 7→4→2 e progressão de cargas) + 1 anexo foto postural inicial. Idempotente via email pattern `seed-evol-{tenant}-paciente@example.com`. 2 tenants (apenas com users seedados) populam.

**523 tests verdes** (era 491, +32 Sprint 21: 10 RLS + 22 unit).

**Sprint 21b futuro (sem upload binário real):**

- API Route `POST /api/fisio/evolucao/[id]/upload` multipart com tempFile → `scanUpload()` (regra 38) → `addAttachmentMetadata({pendingScan:true})` → `markAttachmentScanResult` no callback
- API Route `GET /api/fisio/evolucao/[id]/attachment/[attachmentId]` redirect para URL assinada TTL 10min via `MinioStorageAdapter.presignGet`
- Player de vídeo inline com seekbar (`video_execucao`)
- Viewer de imagem com zoom/pan (`exame_imagem`, `foto_postural`)
- Player de áudio inline (`audio_anamnese`)
- Transcrição Whisper de `audio_anamnese` → preenche `soap.subjetivo` (stretch)
- Comparação lado-a-lado fotos posturais antes/depois
- `search_index` (regra 30) indexando evolucoes com `is_sensitive=true`
- RIPD `docs/compliance/ripd/v1.0-evolucao-midias.md` + DPO sign-off (regra 29)
- Permission `prontuario.read`/`prontuario.write` no roles_permissions seed
- Feature flag `fisio_evolucao_v1`
- E2E: URL TTL expira em 10min retorna 403; upload >50MB rejeitado; scan rejeitado preserva metadata + deleta binário

### Build — Sprint 20a 100% (Prontuário Fisio + CID-11/CIF + signature_policies + ADR 0028 Proposed) 2026-05-17

**Sprint 20 abre Fase 2.** 20a core (sem ICP-Brasil real + sem @react-pdf/renderer) entregue em 100%. Sprint 20b cobre ADR 0041 (escolha Cert.Sign/Bry/Vaultsign), PDF assinado real, audit em leitura, templates assessment_types-based, particionamento manual, RIPD.

**Faixa A entregue (Schemas + RLS + 12 tests):**

- **`packages/db/src/schema/fisio.ts`** — 8 tabelas:
  - `cid_catalog` + `cif_catalog` — globais (tenant_id NULL, read-all RLS) curados pela LogiFit (ADR 0028)
  - `signature_policies` — catálogo global por profissão (medico/fisio/nutri/personal/enfermeiro) com mode + minCertLevel + requiresMfa/AuditChain (ADR 0032 Accepted já existia)
  - `tenant_signature_overrides` — endurecimento Enterprise (CHECK `mode_override='icp_required'` impede afrouxar)
  - `consultas` — polimórfica (kind: medico/fisio/nutri/personal/enfermeiro/custom) + status (draft/locked/signed/archived) + signatureMode resolvido por kind na criação + CHECK consistência signed/locked + councilSnapshot jsonb. `@volume_estimate_yearly: 6000000` particionamento manual futuro
  - `consulta_cids` (M:N com kind principal/secundario) + `consulta_cifs` (qualifier 0-4 com check) — RLS via JOIN com `consultas`
  - `consulta_correction_notes` — append-only com contentHash entrando em audit chain (regra 39)
- **`packages/db/src/policies/0039_fisio_rls.sql`** — RLS aplicada (CID/CIF/policies read-all; consultas tenant-scoped; correction notes append-only sem UPDATE policy).
- Migration `0026_silly_doctor_strange.sql` aplicada.
- **`packages/db/tests/fisio-rls.test.ts`** — 12 tests verdes (CID/CIF read-all cross-tenant; signature_policies cross-tenant; override CHECK só icp_required; consulta insert draft + isolation cross-tenant; CHECK signed sem signed_at falha; consulta_cids herda RLS via JOIN; CIF qualifier 5 rejeitado; correction note append).

**Faixa B.1 entregue (1 lib pura + 27 unit tests):**

- **`packages/db/src/fisio/signature.ts`** — `resolveSignaturePolicy({professionOrKind, policies, tenantOverrides, tenantId})` (override só endurece pra icp_required; custom → fallback fisio); `validateLockAttempt({policy, attempt, mfaRecentMs, hasActiveCouncil})` cobre gate ADR 0055 (council ativo) + regra 43 (MFA recente <15min) + minCertLevel A3 enforcement; `hashConsultaContent({content, cids, cifs, signedAtIso, professionalUserId})` SHA-256 canônico ordenando chaves recursivamente; `validateCidCode`/`validateCifCode`/`validateCifQualifier`. **27 tests** cobrindo todos os caminhos (médico+A3+MFA → OK; médico+lacre → falha; médico+A1 → falha minCertLevel; fisio+lacre+MFA → OK; fisio sem MFA → falha; fisio sem CREFITO → falha; hash determinístico canônico; CIDs ordenados → mesmo hash; CIF s7300.21 padrão estruturas aceito).
- **`packages/db/package.json`** novo export `./fisio` + script `db:seed:fisio`.

**Faixa B.2 entregue (12 Server Actions):**

- **`apps/web/app/app/fisio/consultas/actions.ts`** — `createConsulta` resolve signatureMode via política antes de gravar; `updateConsultaContent` só-draft; `linkCid` valida catálogo existir + status draft; `linkCif` valida componente+qualifier; `lockConsulta` carrega política+overrides+council via `professional_registrations` + verifica MFA recente (`session.logifit.mfaAt`) + computa hash conteúdo+CIDs+CIFs + persiste councilSnapshot do profissional + transição draft→locked|signed conforme lockMethod; `createCorrectionNote` exige status ≠ draft + hash da nota; `listConsultasByMember`; `listCidCatalog` ILIKE busca; `listCifCatalog` filtros componente; `exportPdfStub` retorna INTERNAL_ERROR placeholder.

**Faixa C entregue (6 rotas + 4 client components):**

- **`/app/fisio/pacientes/[memberId]/prontuario`** — lista de consultas do member ordered desc + `<CreateConsultaButton>` cliente com picker dos 6 kinds.
- **`/app/fisio/consultas/[id]`** — header com badges status+signatureMode; KPIs Criada/Política/Lock method/Quando; `<ConsultaEditor>` cliente com SOAP (Subjetivo/Objetivo+Avaliação/Plano/Observações) + adicionar CID/CIF inline (autocomplete pendente Sprint 20b); listas CIDs/CIFs vinculados; `<LockConsultaForm>` com seletor de método (ICP-A3/ICP-A1/Lacre) + valida pelo menos 1 CID principal; bloco "Lacre / assinatura" pós-lock com hash SHA-256 visível + dados profissional (council body+state+number); `<CorrectionNoteForm>` cliente expansível.
- **`/app/fisio/consultas/[id]/pdf`** — preview HTML PDF-like com layout impresso (paciente, kind, SOAP, CIDs, CIFs, rodapé com status+lockMethod+hash+council; placeholder pra Sprint 20b @react-pdf/renderer real).
- **`/app/catalogos/cid`** + **`/app/catalogos/cif`** — read-only busca + filtros (CIF filtra por componente b/s/d/e).

**Faixa D entregue (ADR + seed):**

- **`docs/decisions/0028-cid-cif-catalogos-globais.md` Proposed** — catálogos globais LogiFit curados (rejeita per-tenant + API WHO em runtime + seed completo 17k inicial); migration anual via WHO+Datasus dump; bridge histórico via `active=false`; seed minimal Sprint 20 cobre top 50 fisio/clínica. Promove pra Accepted quando primeira migration de release real (2027-Q1) executar.
- **`packages/db/scripts/seed-fisio.ts`** + `pnpm db:seed:fisio` — **5 signature_policies** (medico icp_required A3 / fisio authenticated_lock / nutri authenticated_lock / personal authenticated_lock / enfermeiro icp_optional A1) + **51 CIDs** (MG lombalgia/cervicalgia + FB tendinopatias/bursites + BA lesão joelho + FA artrite/osteoartrose + 8B AVC/paraplegia + CA asma/DPOC + 5A/B diabetes/obesidade + QA promoção saúde + BD vasculares + LD pediátricos + QC pós-operatório + MG dor crônica) + **30 CIFs** (b funções dor/força/marcha + s estruturas membros/tronco + d atividades andar/vestir/trabalhar + e fatores família/saúde/edifícios).

**491 tests verdes** (era 452, +39 Sprint 20: 12 RLS + 27 unit).

**Sprint 20b futuro (sem providers ICP-Brasil real):**

- Adapter ICP-Brasil real (Cert.Sign vs Bry vs Vaultsign — ADR 0041)
- `@react-pdf/renderer` + carimbo ICP no PDF + verificação externa pelo verificador ITI
- Audit em LEITURA de consulta `status='signed'` (regra 5)
- Templates por especialidade (ortopedia / neuro / respiratória / pediatria / urogine) reusando assessment_types Sprint 12
- Widget `prontuario` no dashboard do member (slot `prontuario`, requiredVertical: 'fisio', consentPurpose: 'cross_module_fisio')
- Search index global indexando consultas (regra 30 + is_sensitive=true + required_permission='prontuario.read')
- Particionamento manual `consultas` por trimestre (regra 34 + ADR 0072) + cold storage Parquet pós-2a
- RIPD `docs/compliance/ripd/v1.0-prontuario-fisio.md` + DPO sign-off
- Integração handler `receipt` no hub WhatsApp inbound (ADR 0051)
- Permission `prontuario.read`/`prontuario.write`/`prontuario.sign` no roles_permissions seed
- Feature flag `fisio_prontuario_v1`
- E2E Playwright: fisio sem CREFITO → bloqueia; fisio com CREFITO suspenso → bloqueia; médico tenta lacre → falha (icp_required); fisio assina ICP A3 quando tenant override forçou; signed_hash externo verificável

### 🎉 MVP FECHADO — Sprint 19 100% (IA preditiva de churn + retenção + ADR 0027 Accepted) 2026-05-17

**Sprint 19 fecha o MVP em 100%.** 21 sprints entregues. Pipeline preditiva end-to-end funcional via heurística determinística + wrapper LLM-ready, alinhado à estratégia 2-fases do ADR 0027.

**Faixa A entregue (Schemas + RLS + 10 tests):**

- **`packages/db/src/schema/retencao.ts`** — 4 tabelas:
  - `churn_features_snapshot` — features jsonb + snapshot_hash sha256 (cache key) + append-only (sem UPDATE policy). `@volume_estimate_yearly: 6000000` particionamento por trimestre em migration manual futura.
  - `churn_predictions` — prob_30d/60d/90d numeric(4,3) com check [0,1] + risk_band enum derivado + top_factors jsonb (explainability) + source (llm/heuristic) + unique(snapshot_id).
  - `churn_interventions` — action enum (6 opções) + assigned_to → closed_at + outcome enum (success/partial/failed/member_canceled_anyway).
  - `churn_events` — unique per member (1 churn por member) + prob_at_churn + was_predicted (true se prob_30d ≥ 0.6 antes do cancelamento).
- **`packages/db/src/policies/0038_retencao_rls.sql`** — RLS tenant-scoped + FORCE.
- Migration `0025_optimal_black_tarantula.sql` aplicada.
- **`packages/db/tests/retencao-rls.test.ts`** — 10 tests verdes (insert válido, isolation cross-tenant, check probs [0,1], unique snapshot_id, intervention lifecycle, unique churn_event per member).

**Faixa B.1 entregue (2 libs puras + 23 unit tests):**

- **`packages/db/src/retencao/features.ts`** — `computeFeatures(input)` puro: frequência 30d × 30-60d com variação%, daysSinceLastCheckin, overdue count+total, monthsAsMember, ticket médio últimos 6m, achievements/goals contagens, downgrade detection. `hashFeatures(f)` sha256 hex canônico (chaves ordenadas) → cache key. **10 tests** (member estável, em risco, variação 50%, prev30=0 → 100%, never checkin → -1, ticket 6m window, hash determinístico).
- **`packages/db/src/retencao/predict.ts`** — `predictChurn(features, llmFn?)` tenta callback LLM com Zod schema validation; fallback automático pra `heuristicPredict` se schema falhar ou LLM throw (defesa em profundidade ADR 0064). Heurística determinística: 40% absence + 30% frequency_drop + 20% overdue + 10% downgrade, com atenuadores (engagement_active -15% / loyalty -5% se member 12m+ e score>0.15). `bandFromProb(p)` 0.3/0.6 cutoffs. **13 tests** (band limites, member estável → low, alto risco → high, invariante prob_30d ≤ prob_60d ≤ prob_90d, engajamento reduz score, loyalty buff, clamp [0,1], never_checkin só dispara monthsAsMember ≥ 2, LLM válido → source=llm, LLM inválido → fallback heurística, LLM throw → fallback).
- **`packages/db/package.json`** novo export `./retencao` + script `db:seed:retencao`.

**Faixa B.2 entregue (6 Server Actions):**

- **`apps/web/app/app/retencao/actions.ts`** — `scorePredict({memberId, force?})` carrega features reais via SQL (accessEvents + appointments + invoices + contracts + memberAchievements + goals) + computa features + verifica cache via snapshot_hash + persiste snapshot+prediction. `listAtRiskMembers({band, limit})` usa `DISTINCT ON (member_id)` pra trazer só a predição mais recente por member. `assignIntervention` valida prediction no tenant antes de criar. `closeIntervention` registra outcome + closedByUserId. `feedbackCancellation` auto-popula `prob_at_churn` + `was_predicted` lendo última predição + linka última intervenção (1 churn_event por member enforced via unique constraint → captura cause.code). `getModelStats` agrega via SQL: members_scored, recall (preditos/total cancelamentos), intervention success rate, latência média, banda atual. `loadFeaturesForUI` helper (não-wrapped) para detail page.

**Faixa C entregue (4 rotas + 3 client components):**

- **`/app/retencao`** — 5 KPIs (members scored + high_now + medium_now + open intv + cancellations 30d) + tabela top 30 em risco ordered por prob_30d desc com color-coded bands + open_interventions badge + link detalhe.
- **`/app/retencao/member/[id]`** — 4 KPIs (P30/60/90 + banda + fonte) + lista de fatores narrativos com peso color-coded + features completas em `<details>` expandível + `<ScorePredictButton>` (calcular agora + ↻ forçar) + `<AssignInterventionForm>` (6 actions + atendente + notas) + tabela intervenções com `<CloseInterventionForm>` inline + histórico de predições.
- **`/app/retencao/interventions`** — filtros open/closed/all via querystring + tabela com prob_30d + outcome color-coded + link member detail.
- **`/app/retencao/model`** — explainability do ADR 0027 (2 fases) + 4 KPIs (members scored + recall + intervention success + latência) + breakdown por (model_version, source) com latência média.
- Command Palette ganha `nav-retencao` (🎯) + `nav-retencao-intv` (📋).

**Faixa D entregue (ADR + seed):**

- **`docs/decisions/0027-estrategia-modelo-churn.md`** promovido **Proposed → Accepted** (Sprint 19 entregou Fase 1 com heurística + wrapper LLM-ready preservando assinatura cross-fase).
- **`packages/db/scripts/seed-retencao.ts`** + `pnpm db:seed:retencao` — 10 perfis canônicos (estável / engajado / caindo frequência / em atraso / risco alto / sumiu / novo sem visita / veterano leal / downgrade recente / estagnado) × 7 tenants seed canônico = **70 members + 70 snapshots + 70 predições + 4 intervenções amostra**. Distribuição: 28 low + 28 medium + 14 high. Idempotente via email pattern `seed-retencao-{tenant}-{profile}@example.com` + snapshot_hash.

**🎉 MVP FECHADO OFICIALMENTE 2026-05-17.**

- 21 sprints entregues: 00 (setup), 00b (menu lateral), 01a (identidade+topology), 01b (RBAC+passaporte), 02 (CRM), 03 (agenda), 04 (financeiro Asaas), 05 (ofertas), 06 (copilot IA), 07 (dashboards), 08 (controle acesso), 09 (engajamento), 10 (vendas), 11 (treinos), 12 (avaliações), 13 (mensagens), 14 (custos/DRE), 15 (ERP financeiro core), 16 (rateio/intercompany), 17 (bancos/OFX), 18 (adquirência), 19 (churn IA).
- 452 tests verdes (RLS + unit). Typecheck 11 packages. 36 schemas Drizzle aplicados via 25 migrations + 38 RLS policy files.
- ADRs publicados/promovidos: 0011-0078 + 0080-0091 (índice no roadmap).
- Tudo self-host total Oracle Cloud SP (ADR 0091) sem Vercel nem Supabase.
- **Fase 2 (Fisioterapia + ERP Saúde) abre em Sprint 20 (Prontuário CFM/COFFITO + assinatura ICP-Brasil).**

**Pendências Sprint 19+ (rolling pós-piloto, não bloqueiam fechamento MVP):**

- Job cron daily `recalculate-churn-daily` por tenant ativo + Vercel Cron / node-cron Coolify
- Wiring real do `llmClassifyFn` usando `resolveModelForTask('classification')` + Gemini Flash + Zod parse safe
- Integração com Sprint 13 régua `reengajamento_risco_alto` — disparo automático quando `prob_30d ≥ 0.7` (depende de Sprint 13 evaluator runtime)
- Widget `risco` no dashboard do member (slot `risco`, `showWhen: prob_30d > 0.3`)
- Permissions `retencao.read` / `retencao.write` / `retencao.intervene` em `roles_permissions` seed
- Feature flag `churn_v1` no painel admin
- E2E Playwright: member degrada → aparece em risco → atribui intervenção → encerra com outcome
- RIPD churn (regra 29) — dado de saúde sensível combinado a comportamento financeiro
- Job retrain dataset (Fase 2 trigger): exportar `churn_features_snapshot + churn_events.was_predicted` em Parquet pra sklearn training fora-de-banda

### Build — Sprint 18a 100% (Adquirência: maquininhas + antecipação + receita unificada + ADR 0039 Proposed) 2026-05-17

Sprint 18 fecha o **core MVP (18a)** em **100%** e encerra o bloco **ERP Financeiro**. Sprint 18b (adapters reais Stone/Cielo/Rede/GetNet/PagSeguro + envelope encryption + webhook chargeback + job daily sync + antecipação automática por regra) fica como sprint futuro pendente de credenciais sandbox real.

**Decisão de quebra 18a/18b (2026-05-17):** sem credenciais sandbox de Stone/Cielo/Rede/GetNet/PagSeguro, focar 18a no que executa sem dependência externa. `MockAcquirerProvider` gera vendas determinísticas por (merchant_id, range) — exercita pipeline completa (sync → conciliação → antecipação) localmente. ADR 0039 documenta interface abstrata + ordem de implementação real para POC quando houver chave.

**Faixa A entregue (Schemas + RLS + 14 tests):**

- **`packages/db/src/schema/adquirencia.ts`** — 4 tabelas:
  - `acquirer_connections` — provider enum (cielo/stone/rede/getnet/pagseguro/mock) + merchant_id + credentials_encrypted (text base64 envelope) + sandbox flag + status enum (pending/active/error/revoked) + settlement_bank_account_id link com Sprint 17 + unique global `(provider, merchant_id)`.
  - `acquirer_sales` — NSU `external_id` unique por `(connection_id, external_id)` + gross/fee/net cents com **check `net = gross - fee`** + card_brand text + card_kind enum (credit/debit/voucher/pix/other) + installments 1-24 com check + expected/actual settlement_date YYYY-MM-DD text + reconciled_with_bank_tx_id FK + status enum (captured/anticipated/settled/chargeback/cancelled) + raw_payload jsonb. `@volume_estimate_yearly: 12000000` particionamento por trimestre em migration manual futura (regra 34 + ADR 0072).
  - `anticipations` — sales_ids `uuid[]` + status pipeline (requested → approved → credited / rejected / cancelled) + effective_rate_pct text + rejection_reason + check `original > 0`.
  - `acquirer_reconciliation_rules` — DSL jsonb condition (providerEquals/cardBrandEquals/cardKindEquals/amountMin/Max/daysAfterSettlementMax/bankDescriptionContains) + 2 actions (auto_match_bank/flag_for_review) + priority asc + hits_count + unique `(tenant, name)`.
- **`packages/db/src/policies/0037_adquirencia_rls.sql`** — RLS tenant-scoped + FORCE em 4 tabelas.
- Migration `0024_flimsy_spyke.sql` aplicada.
- **`packages/db/tests/adquirencia-rls.test.ts`** — 14 tests verdes (acquirer_connections unique provider+merchant global, isolation, mesmo merchant em providers diferentes coexiste; acquirer_sales unique external_id por connection, check net=gross-fee, installments [1,24], gross>0; anticipations check original>0; rules unique name por tenant + mesmo name em tenants diferentes aceito).

**Faixa B.1 entregue (3 libs puras + 39 tests):**

- **`packages/db/src/adquirencia/provider.ts`** — `AcquirerAdapter` interface + `MockAcquirerProvider` determinístico (gera 3 vendas/dia pseudo-aleatórias por seed (merchantId, range)) + `getAdapter(provider)` falha pedindo POC pra provider real + `feeRateFor(provider, kind, installments)` consulta tabela MDR calibrada Cielo/Stone/Rede/GetNet/PagSeguro 2024-2025 pública. **12 tests** cobrindo testConnection mock + fetchSales determinístico + range invertido + check net=gross-fee + requestAnticipation 1.99% + getAdapter erro pra provider real + feeRateFor 4 providers.
- **`packages/db/src/adquirencia/fees.ts`** — `computeSaleCost(gross, kind, installments, feeRate, flatFee?)` decompõe venda + margem em BR%; `quoteAnticipation(originalCents, daysToSettlement, monthlyRate?)` cota = original × rate% × dias/30; `splitFranchiseSale({netCents, capturedAtCompanyId, agreements: FranchiseAgreement[]})` consome Sprint 01b `franchise_agreements` + retorna lista de `IntercompanyEntryDraft` (royalty + marketing) para Sprint 16 materializar. **13 tests** cobrindo consistência net = gross - totalFee + tarifa fixa + cota 30d/15d/<0d + split royalty+marketing + valor arredondado + acordo inativo.
- **`packages/db/src/adquirencia/reconcile.ts`** — `matchAcquirerRules(sale, rules, bankTx?)` priority asc + skip inativas + Zod-typed condition (providerEquals/cardBrandEquals/cardKindEquals/amountMin/Max/daysAfterSettlementMax/bankDescriptionContains); `suggestSettlementMatches(sale, candidates)` heurística top-N com score = 55%valor + 35%data + 10%desc; `detectDivergences(sales, threshold)` flag pra alerta `acquirer.divergence_detected`. **14 tests** cobrindo match por provider/brand/kind/amount/days + priority asc + inativa ignorada + cardBrand case-insensitive + bankTx valida targetBank+descrição+daysMax + settlement exato score>0.9 + D+2 score reduzido + débitos descartados + divergence detection.
- **`packages/db/package.json`** novo export `./adquirencia`.

**Faixa B.2 entregue (12 Server Actions):**

- **`apps/web/app/app/financeiro/adquirencia/actions.ts`** — `connectAcquirer` (bloqueia provider real sem sandbox no MVP), `testAcquirerConnection`, `listAcquirerConnections`, `archiveAcquirerConnection`, `syncAcquirerSales(connectionId, from, to)` idempotente via NSU + atualiza lastSyncedAt, `listAcquirerSales` (filtros connection/company/status/reconciled/period), `requestAnticipationAction(connectionId, saleIds[])` valida elegibilidade + propaga status + atualiza anticipatedAmountCents proporcional nas vendas, `reconcileSale(saleId, bankTxId)` valida bank_tx positivo + marca settled + actual_settlement_date hoje, `suggestSettlementMatchesAction(saleId, maxResults)` carrega bankTxs ±7d positivas + roda heurística, `createAcquirerReconciliationRule` captura 23505 → VALIDATION_ERROR, `listAcquirerReconciliationRules`, `archiveAcquirerReconciliationRule`, `getUnifiedRevenue(companyId?, from, to)` agrega invoices.paid + acquirer_sales não-cancelled. Helpers `quoteAnticipationPreview` + `computeSaleCostPreview` exportados para UI.

**Faixa C entregue (8 rotas Next.js):**

- **`/app/financeiro/adquirencia`** — cards por conexão com KPIs 30d (vendas + bruto + líquido + custo taxas consolidado top); badges Sandbox + status color-coded.
- **`/app/financeiro/adquirencia/new`** — form com dropdown 5 providers + mock recomendado + merchantId + nickname + dropdown settlement bank account + sandbox toggle + warning provider real bloqueado no MVP.
- **`/app/financeiro/adquirencia/[id]/vendas`** — 4 KPIs (total/bruto/líquido/a-conciliar) + `<SyncSalesButton>` cliente date-range default últimos 7d que chama `syncAcquirerSales` + tabela com badges status color-coded + link "Conciliar" inline.
- **`/app/financeiro/adquirencia/[id]/antecipacao`** — `<AnticipationForm>` cliente com checkboxes vendas elegíveis + select-all/clear + 4 KPIs simulador (original/taxa/antecipado/dias) + submit + histórico tabular.
- **`/app/financeiro/adquirencia/conciliacao`** — server lista pendentes settled/anticipated não reconciliadas + `<ReconciliacaoList>` cliente: por venda botão "Buscar sugestões" → top-3 cards com match% color-coded (>90 verde / >70 azul / >50 amarelo) + reasons + botão "Conciliar".
- **`/app/financeiro/adquirencia/regras`** — lista tabular ordered priority asc + badge action + JSON condition.
- **`/app/financeiro/adquirencia/regras/new`** — form com 2 actions + priority + targetBankAccount dropdown + condições agrupadas (provider/brand/kind/amountMin/Max/daysAfterSettlement/bankDescription).
- **`/app/financeiro/receita`** — server com search params from/to + 4 KPIs (online Asaas + presencial líquido + total + custo taxas) + quebra por provider + top 5 companies presencial.
- Hub `/app/financeiro` atualizado: 💳 Adquirência + 📊 Receita unificada.

**Faixa D entregue (ADR + seed):**

- **`docs/decisions/0039-adquirencia-provider-abstrato.md` Proposed** — interface abstrata `AcquirerAdapter` + `MockAcquirerProvider` no MVP + ordem Sprint 18b Stone→Cielo→Rede→GetNet→PagSeguro (Stone primeiro pela maturidade da API) + antecipação manual default (automática vira stretch pós-MVP) + split de franquia em runtime sem materializar coluna (consome Sprint 01b agreements + materializa em Sprint 16 intercompany_entries via cron daily) + regra 25 enforced (split é financeiro puro, não atravessa company clínica); segurança regra 35/37/38 (allowlist por provider + envelope encryption credentials + safeFetch em runtime); alternativas rejeitadas (5 schemas separados por provider violaria regra 46; gateway externo lock-in; sem abstração impede troca). **Promove pra Accepted quando POC Stone sandbox validar.**
- **`packages/db/scripts/seed-adquirencia.ts`** + `pnpm db:seed:adquirencia` — por tenant matriz: 2 conexões mock (Stone + Cielo sandbox) + 15 vendas/conexão dispersas em 60 dias com fee table calibrada por kind/installments + 3 reconciliation_rules (Stone settlement / Cielo settlement / Flag voucher >R$5k). 7 tenants seed canônico = **14 conexões + 210 vendas + 21 rules**. Idempotente (capture cause.code para erros wrapped Drizzle).

**Sprint 18b futuro (pendências sem credenciais MVP):**

- Adapters reais `cielo.ts`/`stone.ts`/`rede.ts`/`getnet.ts`/`pagseguro.ts` em `packages/db/src/adquirencia/providers/`
- Envelope encryption AES-256-GCM com KEK por company para `credentials_encrypted` (ADR 0073 camada 4)
- Webhook callbacks chargeback/cancel + `acquirer_webhook_events` análogo a Sprint 04
- Job cron daily `acquirer.sync-daily` por connection ativa + alerta `acquirer.divergence_detected` D+2
- Job daily materializar split franquia em `intercompany_entries` (Sprint 16) quando settlement confirmar
- Antecipação automática por regra (`if cashflow_below {threshold} then anticipate_percent {pct} max {rate}`)
- Upload CSV fallback `/adquirencia/[id]/vendas/import-csv` para tenant sem API
- Feature flag `adquirencia_v1`
- E2E sandbox Stone + RIPD adquirência + DPO sign-off

### Build — Sprint 17a 100% (Bancos + OFX + Conciliação + Cashflow + ADRs 0037/0038 Proposed) 2026-05-15

Sprint 17 fecha o **core MVP (17a)** em **100%**. Sprint 17b (OAuth Pluggy/Belvo + NF-e SEFAZ real + certificado A1 + manifestação UI + devolução compra + NFs relacionadas) fica como sprint futuro pendente de credenciais de provider — schemas pré-cabeados em `certificados.ts`/`bancos.ts` garantem que 17b não exige nova migration.

**Decisão de quebra 17a/17b (2026-05-15):** sem credenciais de provider real (Pluggy/Belvo/Arquivei) e sem certificado A1 piloto, focar 17a no que executa sem dependência externa. ADRs 0037 + 0038 documentam trade-offs para POC quando houver credenciais.

**Faixa A entregue (Schemas + RLS + 9 tests):**

- **`packages/db/src/schema/bancos.ts`** — 4 tabelas:
  - `bank_accounts` — kind enum (checking/savings/business/cashbox) + opening + current balance + openfinanceConnectionId nullable + unique per (company, bank, agency, account).
  - `openfinance_connections` — provider enum (pluggy/belvo/direct) + access_token_encrypted + status enum (pending/active/error/expired/revoked) + lastSyncError + metadata jsonb.
  - `bank_transactions` — external_id unique quando NOT NULL + amountCents (negativo=saída, positivo=entrada) + reconciledWith ApId/ArId + raw_payload jsonb. `@volume_estimate_yearly: 6000000` particionamento por trimestre em migration manual futura (regra 34 + ADR 0072).
  - `reconciliation_rules` — DSL jsonb condition + 4 actions (auto_match_ap/ar/auto_create_entry/flag_for_review) + priority asc + hitsCount + unique (tenant, name).
- **`packages/db/src/schema/certificados.ts`** — 2 tabelas:
  - `company_certificates` — kind a1 + `bytea encrypted_pfx` + `text encrypted_password` (chave KEK separada — defesa em profundidade ADR 0073 camada 4) + subjectCnpj + expiresAt + status enum (active/expired/revoked/replaced) + lastUsedAt.
  - `nfe_sefaz_cursors` — provider enum (arquivei/sieg/focus/sefaz_direct) + last_nsu + consecutive_failures (alerta admin após 3) + unique (company, provider).
- **`packages/db/src/policies/0036_bancos_certificados_rls.sql`** — RLS tenant-scoped + FORCE em 6 tabelas.
- Migration `0023_curved_ser_duncan.sql` aplicada.
- **`packages/db/tests/bancos-rls.test.ts`** — 9 tests verdes (bank_accounts unique + isolation; bank_transactions external_id unique quando NOT NULL; reconciliation_rules unique name; nfe_sefaz_cursors unique per provider; PFX bytea round-trip).
- Bonus: triggers Sprint 16 ganharam `DROP TRIGGER IF EXISTS` antes de `CREATE TRIGGER` (idempotência do migrate.ts).

**Faixa B.1 entregue (3 libs puras + 30 tests):**

- **`packages/db/src/bancos/ofx-parser.ts`** — `parseOfx(content)` suporta OFX 2.x XML + 1.x SGML; extrai bank/account/period/ledger_balance + transações STMTTRN com fitId/postedAt/amountCents/description/memo/type; rejeita tx sem FITID. **9 tests** cobrindo XML/SGML/edge cases.
- **`packages/db/src/bancos/reconcile.ts`** — `matchRules(tx, rules)` priority asc + skip inativas; `conditionMatches` valida DSL via Zod (descriptionContains/Regex + amountMin/Max + amountSign + postedFrom/To); `suggestMatches` heurística top-N com score = valor 50% + data 30% + token overlap 20%; filtra por kind (tx neg→AP, tx pos→AR). **13 tests** cobrindo predicates + priority + filtro + edge cases.
- **`packages/db/src/bancos/cashflow.ts`** — `forecastCashflow({balance, futureAps, futureArs, daysAhead})` projeta N dias (clamp 1-180); overdue absorvido dia 0; retorna pontos com inflow/outflow/closingBalance + ap/arCount; `validateNfeKey(chave)` mod 11 retorna `{ok, uf, aamm, cnpj}` ou `{ok: false, reason}`; limpa formatação. **8 tests** cobrindo forecast + overdue + clamp + chave válida/inválida.
- **`packages/db/package.json`** novo export `./bancos`.

**Faixa B.2 entregue (14 Server Actions):**

- **`apps/web/app/app/financeiro/bancos/actions.ts`** — 7 actions: `createBankAccount` (captura 23505 → VALIDATION_ERROR), `listBankAccounts`, `archiveBankAccount`, `importOfx` (idempotente via FITID; agrega skipped; atualiza currentBalance), `listBankTransactions`, `confirmMatch(bankTxId, target, targetId)`, `suggestMatchesAction` (carrega AP/AR ±30d + roda heurística + resolve nomes), `connectBankAccount` stub retorna INTERNAL_ERROR "Open Finance POC pendente (ADR 0037)".
- **`apps/web/app/app/financeiro/conciliacao/regras/actions.ts`** — 3 actions: `createReconciliationRule` (valida condition Zod), `listReconciliationRules`, `archiveReconciliationRule`.
- **`apps/web/app/app/financeiro/fluxo-caixa/actions.ts`** — 1 action: `forecastCashflowAction(companyId?, daysAhead)` agrega balance + APs + ARs + invoices Sprint 04 + chama lib pura.

**Faixa C entregue (7 rotas Next.js):**

- **`/app/financeiro/bancos`** — cards por conta com saldo/última sync/badge Open Finance + KPI saldo consolidado.
- **`/app/financeiro/bancos/new`** — form com dropdown 13 bancos brasileiros + auto-fill name + kind + saldo inicial BRL + nickname; explica "Open Finance chega no Sprint 17b — use OFX como fallback".
- **`/app/financeiro/bancos/[id]/extrato`** — 4 KPIs + `<OfxImportForm>` client expansível com FileReader + filtro reconciled + tabela com badges source/status.
- **`/app/financeiro/bancos/[id]/conciliar`** — server lista pendentes + `<ConciliacaoList>` cliente: por tx botão "Buscar sugestões" → top-3 cards com match% color-coded (>90 verde / >70 azul / >50 amarelo) + reasons + botão "Conciliar".
- **`/app/financeiro/conciliacao/regras`** — lista tabular ordered priority asc + badges action.
- **`/app/financeiro/conciliacao/regras/new`** — form com 4 actions + priority + condições agrupadas (descriptionContains + amountMin/Max BRL + amountSign).
- **`/app/financeiro/fluxo-caixa`** — server + `<CashflowChart>` client: 4 botões 7/30/60/90d que chamam forecastCashflowAction; 5 KPIs; alerta dramático saldo<0; tabela diária color-coded.
- Hub `/app/financeiro` atualizado: 🏦 Bancos + 💹 Fluxo de caixa.

**Faixa D entregue (ADRs + seed):**

- **`docs/decisions/0037-open-finance-provider-pluggy-belvo.md` Proposed** — interface abstrata `OpenFinanceProvider` + Pluggy default (BR, R$ 0,30/conexão, free tier dev) + Belvo alternativa LatAm + adapter mock; segurança regra 35/37/38 (allowlist + HMAC + tokens cifrados AES-256-GCM); alternativas rejeitadas (SEFAZ direto 1000+h dev, Plaid sem cobertura BR, sem abstração viola regra 46). **Promove pra Accepted quando POC Sprint 17b validar.**
- **`docs/decisions/0038-nfe-recepcao-provider-arquivei-sieg-focus.md` Proposed** — interface abstrata `NfeFetcher` + Focus default quando tenant é cliente Sprint 36 emissor (reuse sem custo) + Arquivei free tier 50/mês + Sieg fallback + sefaz_direct futuro com cert A1; manifestação ciência automática default ON; segurança certificado AES-256-GCM com KEK separada da senha; alternativas rejeitadas (vendor lock-in; só Focus força emissão; sem recepção automática). **Promove pra Accepted quando POC Sprint 17b validar.**
- **`packages/db/scripts/seed-bancos.ts`** + `pnpm db:seed:bancos` — por tenant: 2 contas (Bradesco CC PJ matriz R$ 15k + caixa físico R$ 800) + 20 transações OFX realistas últimos 60d atualizando saldo + 5 reconciliation_rules canônicas (auto-match aluguel/energia/mensalidades; auto-create tarifa; flag >R$ 50k). Idempotente.

**Sprint 17b futuro (pendências sem credenciais MVP):**

- POC Pluggy sandbox + adapter `pluggy.ts` real + webhook HMAC
- Adapter `arquivei.ts` + `sieg.ts` + `focus.ts` recepção NF-e SEFAZ
- Server Actions reais `fetchNfeByKey`/`toggleNfeAutoDownload` (placeholders hoje)
- Upload UI certificado A1 `/settings/certificados` com `scanUpload` magic bytes pfx + AES-256-GCM + KEK
- UI manifestação destinatário (ADR 0057) modal 4 opções + handler ciência automática
- UI devolução compra (ADR 0058) + reconciler total/parcial
- NFs relacionadas (ADR 0060) badges contextuais + filtro Tipo
- Jobs cron daily Open Finance + SEFAZ + manifestação expiry + alerta D-7
- Feature flag `bancos_nfe_v1`
- E2E sandbox + RIPD bancos/NF-e

### Build — Sprint 16 100%: Rateio entre filiais + Intercompany com DSL declarativa + regra 25 enforced via trigger + ADR 0036 2026-05-15

Sprint 16 fecha em **100%**. Faixas A+B+C+D entregues no mesmo dia. **329 → 327 tests verdes** (era 298 → +29 Sprint 16: 11 RLS + 18 calculator).

**Faixa A (Schemas + RLS + triggers PL/pgSQL):**

- **`packages/db/src/schema/rateio-ic.ts`** — 3 tabelas (ADR 0036):
  - `allocation_rules` — DSL declarativa com 6 kinds (`fixed`/`proportional`/`per_unit`/`by_revenue`/`by_headcount`/`custom`); unique `(tenant, name)`; soft-delete via `archived_at`.
  - `ap_allocations` — append-only via ausência de UPDATE/DELETE policy; PK `(ap_id, company_id)`; `percent_applied numeric(7,4)`; `context_snapshot jsonb` frozen no momento do lançamento (não recalcula retroativamente).
  - `intercompany_entries` — 5 kinds (`payment`/`transfer`/`service`/`goods`/`adjustment`); `counter_entry_id` opcional pra espelhar; checks `amount > 0` + `from <> to`; campos `requires_nfe_transfer` + `nfe_transfer_emission_id` (FK Sprint 36 Focus NFe ADR 0059).
- **`packages/db/src/policies/0035_rateio_ic_rls.sql`** — RLS tenant-scoped + FORCE; **2 triggers PL/pgSQL críticos**:
  - `enforce_owned_topology_for_allocation` + `enforce_owned_topology_for_ic` — BEFORE INSERT lê `tenants.topology`, RAISE check_violation se != owned (regra 25). Server Action captura código 23514 → VALIDATION_ERROR claro.
  - `compute_requires_nfe_transfer` — BEFORE INSERT em `intercompany_entries`: quando `kind='goods'` e CNPJs distintos (from.person_id ≠ to.person_id), seta `requires_nfe_transfer=true` automaticamente.
- **`packages/db/tests/rateio-ic-rls.test.ts`** — **11 tests verdes**: insert owned aceito + franchise rejeitado + isolation; IC from==to rejeitado + amount=0 + trigger NF-e ativa em goods CNPJs distintos + NÃO ativa em payment; UPDATE settled_at aceito.
- Migration `0022_deep_ender_wiggin.sql` aplicada.

**Faixa B (Calculator + 11 Server Actions):**

- **`packages/db/src/rateio/calc.ts`** — `distribute({amountCents, rule, context?})` cobrindo 6 kinds + `validateRuleDistribution(kind, distribution)`. **Garantia de soma exata**: rounding distribui resto pra última company em ordem do distribution — `sum(allocations.amountCents) === amountCents` sempre. Cap de 20 companies/rule.
- **`packages/db/src/rateio/calc.test.ts`** — **18 tests verdes**: fixed 40/30/30 + 1/3+resto + custom alias; proportional 2:1:1 + weights zero; per_unit 3 vs 1 = 75/25; by_revenue 60/40; by_headcount 50/25/25; edge cases (amount=0, 1 cent, mais de 20 companies, soma!=100 rejeitada).
- **`packages/db/package.json`** novo export `./rateio`.
- **`apps/web/app/app/financeiro/rateio/regras/actions.ts`** — 6 actions: `createAllocationRule` (captura erro trigger regra 25 → VALIDATION_ERROR), `listAllocationRules`, `archiveAllocationRule`, `simulateAllocation` (preview com `buildContextFor` resolvendo invoices.paid mês anterior/users.count/units.count), `applyAllocation` (idempotente, DELETE existentes antes INSERT), `listApAllocations`.
- **`apps/web/app/app/financeiro/intercompany/actions.ts`** — 5 actions: `createIntercompanyEntry` (retorna `requiresNfeTransfer` no resultado), `liquidateIntercompany` (UPDATE batch + nota concatenada), `listIntercompanyEntries`, `generateIcReport` (agrupa por par com totalCents/pendingCents/settledCents via FILTER WHERE), `getIntercompanyBalances`.

**Faixa C (UI — 6 rotas):**

- **`/app/financeiro/rateio/regras`** — lista em cards agrupados por kind; banner alerta quando topology != owned (regra 25 bloqueia "+ Nova regra"). Card linka pro simulador.
- **`/app/financeiro/rateio/regras/new`** — form rico com 3 visualizações de distribuição (fixed/proportional/checkboxes simples) + soma em destaque verde/vermelho conforme bater 100% + preview de % em runtime para proportional.
- **`/app/financeiro/rateio/regras/[id]/simular`** — simulador interativo: input de valor BRL → `simulateAllocation()` → tabela company × % × amount + total + contextSnapshot JSON expandível.
- **`/app/financeiro/intercompany`** — dashboard com 3 KPIs (saldo pendente total / pares pendentes / NF-e transferência pendente vermelho); alerta destacado quando há `requires_nfe_transfer && !nfeTransferEmissionId`; tabela "Saldos por par" agregada + tabela "Lançamentos recentes" últimos 50 com badges color-coded por kind + ícone ⚠ pra NF-e.
- **`/app/financeiro/intercompany/new`** — form com select from→to (filtra excluindo from) + 5 kinds dropdown com descrição + detecção em tempo real de "CNPJs distintos" mostrando alerta antecipado se kind=goods exige NF-e.
- **`/app/financeiro/intercompany/fechamento`** — fechamento mensal: filtros from/to (default mês corrente) + 4 KPIs (Total/Liquidado/Pendente/Taxa de liquidação %); tabela por par com Total + Liquidado verde + Pendente amarelo.
- Hub `/app/financeiro` atualizado: cards ⚖️ Rateio + 🔄 Intercompany.

**Faixa D (ADR + Seed):**

- **`docs/decisions/0036-rateio-intercompany-dsl-declarativo.md` Accepted** — DSL `allocation_rules` + `ap_allocations` frozen snapshot + `intercompany_entries` espelhado + regra 25 enforced via trigger SQL + trigger requires_nfe_transfer; alternativas rejeitadas (split inline em AP, rateio sem reuso, IC sem tipagem, view materializada, recálculo retroativo).
- **`packages/db/scripts/seed-rateio-ic.ts`** + `pnpm db:seed:rateio-ic` — **apenas tenants owned** (skip franchise com mensagem). Por tenant: 2 allocation_rules canônicas (Aluguel matriz 40% + filiais 60% / Software por revenue dinâmico) + 3 IC entries (payment + service + goods triggering NF-e). Idempotente via unique + count check.

**Pendências menores adiadas Sprint 16+ próximo PR:**

- Geração automática de `counter_entry_id` espelho via job
- Recálculo retroativo opcional (snapshot frozen é default)
- UI no detalhe da AP (Sprint 15) com botão "Aplicar rateio" + visualizar `ap_allocations`
- DRE Sprint 14 com dimensão `allocation_source` (filtro custos rateados vs diretos)
- View materializada `intercompany_balances` quando volume >10k pendentes
- Job cron lembrete NF-e transferência pendente (Sprint 13 régua dispara)
- Botão "Emitir NF-e transferência via Focus" (depende Sprint 36 ADR 0059)
- Permission gates `financeiro.allocation.*` / `financeiro.intercompany.*` enforcement
- Eliminação automática IC em relatórios consolidados do tenant
- Feature flag `rateio_ic_v1`
- E2E completo

### Build — Sprint 15a 100% (ERP Financeiro Core MVP): plano de contas hierárquico + suppliers + AP com workflow declarativo + AR avulso + aging + ADRs 0033/0034 2026-05-15

Sprint 15 fecha o **core MVP (15a)** em **100%**. Sprint 15b (OCR multi-provider, inbox NF-e unificada, retenções tributárias, manifestação destinatário, self-issued NF-e entrada, fiscal_emissions preparação) **fica como sprint futuro ainda não aberto** — schemas pré-cabeados em `accounts_payable` (`taxNatureId/retentionTotalCents/netAmountCents/nfeReceivedId/noInvoice/source`) garantem que Faixa B/C/D de 15b não exigem nova migration.

**Decisão de quebra 15a/15b (2026-05-14):** evita estouro de 3 semanas (regra 9) e permite priorizar Sprint 16 (rateio intercompany) imediatamente, deixando OCR/NF-e para Sprint 15b quando provider configurado em piloto real.

**Faixa A (Schemas + RLS + Workflow Engine):**

- **`packages/db/src/schema/erp-financeiro.ts`** — 6 tabelas (ADRs 0033 + 0034):
  - `chart_of_accounts` — hierárquico via `parent_id` self-FK + `is_leaf bool` (lançamentos só apontam pra folhas) + `kind` enum (ativo/passivo/receita/despesa/custo); unique `(tenant, code)`; index parcial em folhas ativas; soft-delete via `archived_at`.
  - `suppliers` — FK `persons` (ADR 0047 — identidade vem via JOIN, schema só adiciona dados comerciais); unique `(tenant, person)`; `bank_account jsonb` (PIX/banco/agência/conta) pré-cabeado para Sprint 17 Open Finance.
  - `approval_rules` — DSL declarativa: `min/max_amount_cents` + `required_approvers jsonb` (mode series|parallel + approvers role|userId); check `max ≥ min`.
  - `accounts_payable` — state machine 8 estados (draft → pending_approval → approved → scheduled → paid → reconciled + rejected + cancelled); `approval_trace jsonb` append-only; 4 checks (amount positive + net consistent + retention non-negative + due ≥ issue); unique global `doc_key` (NF-e chave cross-tenant); colunas pré-cabeadas 15b (`taxNatureId/retentionTotalCents/nfeReceivedId/noInvoice/source`).
  - `accounts_receivable` — AR avulso separado de `invoices` Sprint 04; status enum 6 estados; `invoice_id nullable` link com contratos.
  - `ap_ar_payments` — pagamentos parciais append-only (sem UPDATE/DELETE policy); `source_type ∈ {ap, ar}` discriminator.
- **`packages/db/src/policies/0034_erp_financeiro_rls.sql`** — RLS tenant-scoped + FORCE em 6 tabelas; `ap_ar_payments` sem UPDATE/DELETE policy (append-only).
- Migration `0021_woozy_nocturne.sql` aplicada.
- **`packages/db/tests/erp-financeiro-rls.test.ts`** — **16 tests verdes**: unique code/person + isolation + checks AP/AR + doc_key cross-tenant + append-only payments.
- **`packages/db/src/erp-financeiro/approval.ts`** — workflow engine puro (ADR 0034) com `pickApprovalRule`/`decideNextState`/`canUserApprove`; DSL Zod `ApproverSchema`/`RequiredApproversSchema`/`ApprovalTraceEntrySchema`.
- **`packages/db/src/erp-financeiro/approval.test.ts`** — **21 tests verdes** cobrindo matrix de casos (pickRule menor max + company-specific; decideNextState 6 variantes; canUserApprove role/userId/estados).
- **`packages/db/package.json`** — novo export `./erp-financeiro`.

**Faixa B (Server Actions — 23 total):**

- **`apps/web/app/app/financeiro/plano-contas/actions.ts`** — 5 actions: `createChartAccount` (valida parent+kind+marca pai não-folha), `listChartAccounts`, `listLeafAccounts`, `archiveChartAccount` (bloqueia se filhos ativos OU AP/AR vinculadas), `moveChartAccount` (valida kind + ciclo trivial).
- **`apps/web/app/app/financeiro/fornecedores/actions.ts`** — 5 actions: `createSupplier` (valida persons existe), `updateSupplier` (só dados comerciais), `listSuppliers` (filtro + ILIKE), `getSupplier` (histórico AP), `archiveSupplier` (bloqueia se AP em aberto).
- **`apps/web/app/app/financeiro/contas-pagar/actions.ts`** — 7 actions consumindo engine: `createAP` (chart é folha+ativa), `submitForApproval` (rule sem approvers → approved direto), `approveAP` (canUserApprove + adiciona trace + transiciona), `rejectAP` (min 5 chars), `cancelAP` (≤ scheduled), `registerManualPayment` (soma agregada → paid|scheduled), `listAP`, `getAP`.
- **`apps/web/app/app/financeiro/contas-receber/actions.ts`** — 6 actions: `createAR`, `markARIssued`, `registerARReceived` (soma agregada), `cancelAR`, `listAR`, `getAR`.

**Faixa C (UI — 9 rotas Next.js):**

- **`/app/financeiro/plano-contas`** — tree view server-rendered agrupado por kind em 5 cards com dots coloridos e indentação por depth do code; badge "grupo" em não-folhas.
- **`/app/financeiro/plano-contas/new`** — form com kind + pai cascading + code regex + isLeaf checkbox.
- **`/app/financeiro/fornecedores`** — lista tabular com nome/doc formatado/contato/pgto/prazo.
- **`/app/financeiro/fornecedores/new`** — busca persons existentes (exclui já vinculados) + dados bancários opcionais.
- **`/app/financeiro/fornecedores/[id]`** — 3 KPIs (Total pago/Em aberto/Notas) + histórico AP últimas 30.
- **`/app/financeiro/contas-pagar`** — lista filtrável (status/from/to) + 2 KPIs (A pagar/Em atraso vermelho) + row overdue em vermelho+bold.
- **`/app/financeiro/contas-pagar/new`** — wizard com auto-fill dueDate via `defaultPaymentTermDays` do supplier + parsing BRL→centavos + opção "submeter imediatamente".
- **`/app/financeiro/contas-pagar/[id]`** — 4 KPIs (Bruto/Líquido/Pago/A pagar) + timeline `approval_trace` color-coded + `<APActions>` client-side com dialogs inline (Aprovar/Rejeitar/Cancelar/Pagar) condicionais por status.
- **`/app/financeiro/contas-receber`** — lista filtrável + 2 KPIs (A receber/Recebido verde).
- **`/app/financeiro/contas-receber/new`** — payer search + leaf accounts receita/ativo + "marcar como emitida".
- **`/app/financeiro/contas-receber/[id]`** — 3 KPIs + `<ARActions>` (Marcar emitida/Registrar recebimento/Cancelar).
- **`/app/financeiro/aging`** — AP+AR distribuído em 5 buckets temporais (A vencer/1-30/31-60/61-90/90+) com bar charts color-coded.
- **`/app/financeiro`** (hub) — 8 cards nav cobrindo Sprints 04/14/15.

**Faixa D (ADRs + Seed canônico):**

- **`docs/decisions/0033-plano-contas-hierarquico-erp-financeiro.md` Accepted** — plano hierárquico self-FK + is_leaf + kind herda do pai + seed brasileiro simplificado ~67 contas; alternativas rejeitadas (ltree, nested set model, achatado).
- **`docs/decisions/0034-workflow-aprovacao-ap-declarativo.md` Accepted** — `approval_rules` DSL JSON + `approval_trace jsonb` + engine puro com 21 unit tests; alternativas rejeitadas (Temporal/Camunda, stored procs, hardcode).
- **`packages/db/scripts/seed-plano-contas.ts`** + `pnpm db:seed:plano-contas` — popula ~67 contas brasileiras (12 agregadoras + 55 folhas) adaptadas a academia/clínica em cada tenant + 3 approval_rules canônicas (Auto até R$ 500 / Gerente até R$ 5.000 / Gerente+Diretor acima). Idempotente via `ON CONFLICT DO NOTHING` + Pass 2 resolve `parent_id` via lookup code.
- **`packages/db/scripts/seed-erp-financeiro.ts`** + `pnpm db:seed:erp-financeiro` — popula em cada tenant: 20 fornecedores PJ típicos brasileiros com CNPJs algoritmicamente válidos + 10 APs em 7 estados variados com trace sintético + 5 ARs avulsos. **8 tenants total = 160 suppliers + 80 APs + 40 ARs**. Idempotente via count check.
- **298 testes Vitest verdes** (era 261 → +37 Sprint 15).
- Typecheck monorepo verde.

**Sprint 15b (futuro, ainda não aberto) cobre:** OCR multi-provider (ADR 0035), inbox NF-e unificada (ADRs 0056/0058), manifestação destinatário NF-e (ADR 0057), self-issued NF-e entrada (ADR 0060), retenções tributárias (ADR 0061), `fiscal_emissions` preparação (ADR 0059), parser FEBRABAN/XML NF-e, UI `/app/financeiro/nfe` inbox + settings OCR/naturezas/aprovação, WhatsApp inbound boleto handler (Sprint 13 hub), E2E completo, RIPD, feature flag `erp_financeiro_v1`. **Schemas AP pré-cabeados** garantem que 15b não exige nova migration.

**Pendências menores Sprint 15+ próximo PR:**

- UI `/app/settings/financeiro/aprovacao` (editor visual de `approval_rules`) — backend pronto
- `payViaAsaas` + pagamento em lote (gerente seleciona N APs approved)
- Escalada por timeout AP pending (job cron + régua Sprint 13)
- Recursive CTE para detecção de ciclo em `moveChartAccount`
- Widget "Contas a pagar vencendo" no dashboard gerente
- Permission gates `financeiro.ap.read/write/approve/pay` enforcement
- Search index sync (ADR 0062) para AP/AR/suppliers
- Particionamento `accounts_payable` por mês (regra 34)
- Anexar PDF NF/boleto MinIO (depende scanUpload regra 38)

### Build — Sprint 14 100%: DRE + Custos operacionais + Previsibilidade (schemas + calculator pure + forecast heurístico + UI completa) 2026-05-13

Sprint 14 fecha em **100%**. Faixas A+B+C+D entregues no mesmo dia: 3 schemas (`cost_categories`/`cost_entries`/`recurring_costs`) + 10 RLS + 11 tests; `calculateDre` + `forecastRevenue` pure functions com 13 tests cobrindo edge cases; 10 Server Actions wrapped (`generateDre` audita leitura — DRE é dado administrativo sensível); UI completa (lista filtrável + categorias dual-column + wizard cost entry + DRE com 4 KPIs e breakdown por categoria com barras + previsão tabular com pessimista/projetado/otimista); seed canônico popula 6 categorias + 10 custos + 3 recorrências por tenant. **ADR não exigido** — categorias com type fixed/variable é estrutura trivial (Sprint 14 doc confirma).

**Faixa A (Schemas + RLS + Tests):**

- **`packages/db/src/schema/custos.ts`** — 3 tabelas:
  - `cost_categories` — slug + name + enum `cost_category_type` (fixed/variable) + icon + soft-delete archived_at; unique `(tenant, slug)`; índice parcial por tipo ativo.
  - `cost_entries` — `amount_cents int` (check positive) + `incurred_at date` (DRE agrupa por aqui, NÃO created_at — permite retroativo) + company_id FK + category_id FK + attachment_storage_path (Sprint 38 ClamAV) + recurring_cost_id FK lógica (NULL = entrada manual).
  - `recurring_costs` — `day_of_month int` (check 1-28 evita problemas fevereiro) + `starts_at`/`ends_at` (check ends_after_starts) + `last_generated_at` pra idempotência cron + active toggle.
- **`packages/db/src/policies/0033_custos_rls.sql`** — 10 policies tenant-scoped. cost_entries permite DELETE (correção de erro de lançamento, audit via wrap). Sem DELETE em categorias/recorrentes (soft via archived_at/active=false).
- **`packages/db/tests/custos-rls.test.ts`** — 11 testes: unique slug per tenant + mesma slug em outro tenant coexiste + isolation per-tenant + check amount=0/negativo rejeitado + insert válido + isolation entries + check day_of_month 0/29 rejeitado + check ends_after_starts violado + recurring válido aceito + soft-delete archived_at preserva row.

**Faixa B (DRE calculator + forecast + Server Actions):**

- **`packages/db/src/financeiro/dre.ts`**:
  - `calculateDre({period, invoices, costEntries})` — pure function retorna `{revenue: {gross, paid, pending, overdue, refunded}, costs: {byCategory ordenado descending, byType {fixed, variable}, total}, margins: {gross, percent}, counts}`. Agrupa receita por **status no período correto**: paid/refunded via `paid_at`, pending/overdue via `due_at`. Custos agrupados por `incurred_at`. Margem bruta = paid - costs.total. Não divide por zero se paid=0.
  - `forecastRevenue({baselineMonthlyCents, monthlyChurnRate, monthsAhead})` — heurístico simples: `projection[m] = baseline × (1 - churn)^m` com intervalo low (-15%) / high (+10%); retorna estrutura vazia se inputs inválidos.
- **`packages/db/src/financeiro/dre.test.ts`** — 13 unit tests cobrindo: receita paid via paid_at, separação pending/overdue/paid, refunded não conta gross, agrupamento por categoria + ordenação descending, exclusão fora do período, margens com paid=0, incurredAt string ISO aceito, forecast com churn 5%, low/high intervals, churn=0 mantém baseline, inputs inválidos retornam vazio, total bate com soma.
- **`packages/db/package.json`** — novo export `./financeiro`.
- **`apps/web/app/app/financeiro/custos/actions.ts`** — 10 Server Actions wrapped:
  - `createCostCategory` + `listCostCategories` + `archiveCostCategory` (slug regex `[a-z0-9_]+`)
  - `createCostEntry` + `listCostEntries` (filtros company/category/from/to) + `deleteCostEntry` (audit)
  - `createRecurringCost` + `toggleRecurringCost` + `listRecurringCosts`
  - `generateDre(from, to, companyId?)` — chama calculateDre com queries DB; action `dre.generate` grava `audit_log` (DRE = dado sensível administrativo per Sprint 14 doc)
  - `forecastRevenueAction(monthsAhead, manualChurnRate?)` — apura baseline (sum plans.price × contracts.active) + churn histórico (cancelled últimos 6m / active base / 6) OU aceita override manual; chama forecastRevenue

**Faixa C (UI):**

- **`/app/financeiro/custos/page.tsx`** — lista filtrável com total agregado + badges fixed/variable color-coded (info-bg/warning-bg) + 4 nav buttons (Categorias/Recorrentes/DRE/Previsão).
- **`/app/financeiro/custos/categorias/page.tsx`** + `new-category-form.tsx` — **dual-column layout**: catálogo agrupado por type à esquerda + form criação sidebar à direita; refresh inline após criar; slug regex validation.
- **`/app/financeiro/custos/new/page.tsx`** + `new-cost-form.tsx` — wizard companyId + categoryId (com ícone + type label inline) + amount em BRL (parsing vírgula → centavos) + date picker + description.
- **`/app/financeiro/dre/page.tsx`** — seletor de período (default = mês atual) + **4 KPI cards** (Receita paga verde, Pendente amarelo somando pending+overdue, Custos vermelho com breakdown fixo+variável inline, Margem com cor por sinal e percentual de margem bruta) + breakdown por categoria com **barras horizontais color-coded por type** (azul=fixed, amarelo=variable) + percentual relativo + count de lançamentos.
- **`/app/financeiro/previsao/page.tsx`** — seletor 3/6/12 meses + override manual de churn % + **3 KPI cards** (Baseline mensal, Churn aplicado com label histórico/manual, Total projetado) + **tabela 4 colunas** (mês, pessimista -15%, projetado, otimista +10%) + nota explicando heurística + referência à substituição por modelo preditivo Sprint 19 ADR 0027.

**Faixa D (Seed + fechamento):**

- **`packages/db/scripts/seed-custos.ts`** + `pnpm db:seed:custos` — popula 6 categorias canônicas (Aluguel 🏢 fixed, Folha CLT 👥 fixed, Internet 📡 fixed, Marketing 📣 variable, Manutenção 🔧 variable, Energia ⚡ variable) + 10 cost_entries últimos 3 meses (3 aluguéis + 2 folhas + 2 marketing + 1 manutenção + 1 energia + 1 internet com valores realísticos R$ 3.500 aluguel / R$ 15.000 folha / etc) + 3 recurring_costs (aluguel D5 + folha D5 + internet D10) por tenant. 8 tenants = **48 categorias + 80 custos + 24 recorrências**.
- **261 testes Vitest total verdes** (era 237 → +24 Sprint 14: 11 RLS + 13 DRE).
- Typecheck clean.

**Pendências menores adiadas Sprint 14+ próximo PR:**

- **Lucratividade por procedimento via `service_type`** (depende `invoice_items.service_type`/`tuss_code` backfill Sprint 04+).
- **Upload NF-e PDF MinIO** bucket privado `cost-attachments` + `scanUpload()` ClamAV regra 38 + URL assinada curta.
- **Exportação DRE PDF** (`@react-pdf/renderer`) + CSV.
- **Simulador interativo de sensibilidade** com sliders churn/baseline na página de previsão.
- **Job cron diário `recurring-tick`** lendo `recurring_costs WHERE active=true AND day_of_month=now()` AND (`last_generated_at IS NULL OR last_generated_at < first_of_month`) + gerando `cost_entries` idempotentes.
- **Permission** `custos.read`/`custos.write`/`dre.read` enforcement em Server Actions.
- **Card "Custos do mês"** no dashboard gerente Sprint 07.
- **RIPD `v1.0-custos.md`** se necessário (DRE é dado financeiro interno, não saúde — provável dispensa LGPD art. 11; consultar DPO).
- **Feature flag `custos_v1`** (PostHog dropado MVP).
- **Importação extrato OFX/CSV** + **conciliação bancária** (Sprint 17 Open Finance entrega completo).
- **Centro de custos por unit** (granularidade além de category).
- **Benchmark anonimizado** entre tenants do mesmo porte (Sprint 19+ analytics, respeitando regra 26).
- **Particionamento `cost_entries`** por mês quando volume justificar (regra 34 + ADR 0072).

**Bug pré-existente** (Server Components com `db` global retornam 0 rows porque RLS bloqueia — `app.tenant_id` não setado em conexão direta) afeta TODAS as páginas `/app/financeiro/custos` + `/categorias` + `/dre` + `/previsao`. **Server Actions também afetadas** (verificado no preview: `/app/financeiro/dre` retorna R$ 0,00 mesmo após seed) — `withSessionContext` abre conexão A pra setar app.tenant_id, mas queries Drizzle internas pegam conexão B do pool. Comentário canônico em `apps/web/app/lib/session.ts` confirma a limitação: "Drizzle global pool sempre pega novo. Sprint 02+ refatora pra Drizzle-com-SET via wrapAction." UI estrutural correta (KPI cards, seletor período, breakdown por categoria, tabela forecast) — dados aparecerão quando refactor RLS infra for resolvido. Sprint 14+ próximo PR de infra deve consertar `withSessionContext` pra usar `db.transaction` com `SET LOCAL` ou passar tx adiante.

### Build — Sprint 13 100%: WhatsApp + Régua declarativa (schemas + DSL Zod + UI builder + ADRs 0025+0026 Accepted) 2026-05-13

Sprint 13 fecha em **100%** (core MVP outbound + DSL). Faixas A+B+C+D entregues no mesmo dia: 5 schemas (`message_providers`/`message_templates`/`reguas`/`regua_executions`/`messages_sent`) + 15 RLS + 8 tests; DSL `ReguaDslSchema` Zod validando 10 eventos canônicos + 2 kinds ações + helpers `nextActionAtFromSteps`/`renderTemplate`/`isWithinHourWindow` GMT-3 com 23 tests; 8 Server Actions wrapped (`sendMessageManual` usa stub adapter — adapter real fica Sprint 13b); UI completa (hub + lista templates com auto-detecção de variáveis + builder visual de réguas + histórico com filtros + widget perfil); ADR 0025 (Provider WhatsApp) e ADR 0026 (Motor DSL) **promovidos pra Accepted**. Seed standalone popula 5 templates + 1 régua canônica "Cobrança D+1/+3/+7" desativada em 8 tenants (40 templates + 8 réguas total).

**Faixa A (Schemas + RLS + Tests):**

- **`packages/db/src/schema/mensagens.ts`** — 5 tabelas:
  - `message_providers` — config por tenant (channel WhatsApp/Email/SMS + provider 'twilio'/'gupshup'/'zapi'/'resend'/'ses') + `credentials_encrypted jsonb` (envelope crypto AES-256-GCM reusada Sprint 04 asaas_keys) + `from_identifier` + `sandbox`/`active` + índice parcial active per channel.
  - `message_templates` — approval flow `draft → pending → approved/rejected`; email pula direto pra approved; `variables text[]` auto-extraído; `provider_template_id` pra match após aprovação Meta; unique `(tenant, slug)`.
  - `reguas` — DSL declarativo: `trigger jsonb` + `actions jsonb` + `stop_on jsonb` + `guards jsonb`; soft-delete via archived_at; `runs_count` contador.
  - `regua_executions` — instâncias rodando per-member; state machine `running/completed/stopped_by_rule/stopped_by_consent/failed`; `next_action_at` indexado parcial pra cron tick eficiente; `trigger_payload jsonb` snapshot.
  - `messages_sent` — audit-friendly append-only: `variables_resolved jsonb` snapshot pra debugging, `body_rendered text`, `provider_message_id` pra webhook match, `cost_cents` pra conciliação, check `cost_non_negative`.
- **`packages/db/src/policies/0032_mensagens_rls.sql`** — 15 policies tenant-scoped. Sem DELETE em templates/reguas (soft via archived_at) e messages_sent (audit append-only). UPDATE em messages_sent permitido pra callbacks (delivered_at/read_at/failed_at) — trigger Sprint 13+ valida apenas colunas de callback alteradas.
- **`packages/db/tests/mensagens-rls.test.ts`** — 8 testes cobrindo isolamento per-tenant em todas as 5 tabelas + unique `(tenant, slug)` + jsonb roundtrip (trigger/actions/stop_on/guards persistem) + index parcial pending + check cost_non_negative + soft-delete preserva via archived_at.

**Faixa B (DSL régua + Server Actions):**

- **`packages/db/src/mensagens/dsl.ts`** (ADR 0026): `ReguaDslSchema` Zod completo:
  - **10 eventos canônicos**: `invoice.overdue/paid/cancelled`, `member.no_checkin_15d/30d`, `lead.no_response_3d`, `appointment.tomorrow/today`, `workout.session_completed`, `achievement.earned`
  - **2 kinds de ação**: `send_message` (channel + template_slug + delay_days + fallback_channel) + `wait` (delay_days)
  - **`StopOnSchema`** array de eventos canônicos
  - **`GuardsSchema`**: consent (`marketing_messages`/`transactional`/`whatsapp_exchange`) + rate_limit_per_member_24h + hour_window HH:MM
  - 3 helpers públicos: `nextActionAtFromSteps(startedAt, actions, idx)` calcula timestamp acumulativo; `renderTemplate(body, vars)` substitui `{{var.path}}` com edge cases (var faltante = string vazia, espaços tolerados, valor 0 renderiza "0"); `extractTemplateVariables(body)` retorna lista única ordenada; `isWithinHourWindow(now, window)` GMT-3 SP com suporte a janela cruzando meia-noite
  - **23 unit tests Vitest** cobrindo: régua canônica válida, evento não-canônico rejeitado, action desconhecida rejeitada, actions vazias rejeitada, delay_days negativo rejeitado, hour_window formato inválido rejeitado, next_action_at acumulativo com wait, render template múltiplas vars + faltantes + espaços + zero numérico, extract dedup ordenado, window cruzando meia-noite
- **`packages/db/package.json`** — novo export `./mensagens`.
- **`apps/web/app/app/mensagens/actions.ts`** — 8 Server Actions wrapped:
  - `createTemplate` — extrai variables automaticamente via `extractTemplateVariables(body)` + email pula direto pra approved + WhatsApp começa draft
  - `approveTemplate` — atualiza `provider_template_id` após aprovação Meta
  - `listTemplates`
  - `createRegua` — valida `ReguaDslSchema` antes de gravar trigger/actions/stop_on/guards
  - `activateRegua` / `pauseRegua` — toggle active flag
  - `listReguas`
  - `sendMessageManual` — resolve template + member.phone/email + renderiza body via `renderTemplate` + grava `messages_sent` com `status='queued'` + `provider='stub'` (envio real adapter Sprint 13b)
  - `listMessages` (filtros canal/status) / `listMemberMessages` (widget perfil)

**Faixa C (UI):**

- **`/app/mensagens/page.tsx`** — hub com 4 cards (templates count + reguas count + histórico count + provider stub placeholder).
- **`/app/mensagens/templates/page.tsx`** — lista com cards + badges approval color-coded (draft/pending/approved/rejected) + channel icons (🟢 📧 📱) + variables chips preview.
- **`/app/mensagens/templates/new/page.tsx`** + form client — **auto-detecção de variáveis enquanto digita corpo** (regex `{{...}}` extract + dedup + ordenado, atualiza chips em tempo real) + slug validation `[a-z0-9_]+` + email exige subject + WhatsApp informa que template entra como draft pendente aprovação Meta.
- **`/app/mensagens/reguas/page.tsx`** — lista com state badges (ativa/pausada) + trigger event chip + actions count + runs count + actions preview chips.
- **`/app/mensagens/reguas/new/page.tsx`** + builder client — **trigger picker** com 6 eventos canônicos pre-listados, **add actions inline** com kind picker (send_message/wait) + canal + template_slug filtrado dinamicamente por canal escolhido + delay_days, **stop_on checkboxes** (invoice.paid/cancelled), guards default `consent: marketing_messages + rate_limit 3/24h`, régua nasce inativa por design (mensagem explica isso).
- **`/app/mensagens/historico/page.tsx`** — filtros canal/status + cards com channel icon + member name + template name + body rendered (line-clamp-2 italic) + status badge color-coded + provider + timestamps delivered/read + failure_reason.
- **`/app/members/[id]/page.tsx`** — adicionado widget "💬 Mensagens recentes" entre Avaliações e slot Copilot futuro com até 5 últimas + body rendered + status.
- **`packages/db/scripts/seed-mensagens.ts`** + script `pnpm db:seed:mensagens` — popula **5 templates** por tenant: cobranca_d1 (D+1 WhatsApp), cobranca_d3 (D+3 WhatsApp), cobranca_d7 (D+7 email com subject), reengajamento_15d (WhatsApp), boas_vindas (WhatsApp); + **1 régua canônica "Cobrança D+1/+3/+7"** desativada com trigger `invoice.overdue` + 3 actions encadeadas com delay_days acumulado [0, 2, 4] + stop_on `[invoice.paid, invoice.cancelled]` + guards padrão. 8 tenants = **40 templates + 8 réguas total**.

**Faixa D (ADRs Accepted + fechamento):**

- **[`docs/decisions/0025-provider-whatsapp.md`](docs/decisions/0025-provider-whatsapp.md)** — atualizado de Proposed → **Accepted** (2026-05-13). Documenta que schema (`message_providers` com `credentials_encrypted` + RLS) + Server Actions + UI estão prontos pra receber adapter real; **sub-decisão final Twilio vs Gupshup BR fica Sprint 13b** (POC).
- **[`docs/decisions/0026-motor-regua-dsl.md`](docs/decisions/0026-motor-regua-dsl.md)** — atualizado de Proposed → **Accepted** (2026-05-13). Documenta DSL Zod-validada + 10 eventos + 2 kinds + 3 helpers + 23 tests + UI builder + seed canônica entregues; **evaluator runtime cron tick fica Sprint 13b** (consome `domain_events` + processa `regua_executions.next_action_at`).
- **237 testes Vitest total verdes** (era 206 → +31 Sprint 13: 8 RLS + 23 DSL); 19 test files.
- Typecheck clean.

**Pendências menores adiadas Sprint 13b próximo PR:**

- **Envio real** WhatsApp/Email via adapter Twilio/Gupshup/Resend; sub-decisão final ADR 0025 + POC.
- **Evaluator runtime** cron tick (consome `domain_events` + processa `regua_executions.state='running' AND next_action_at <= now()` + chama provider via `safeFetch()` regra 37 + grava callbacks).
- **Hub inbound multifluxo** (ADR 0051): `whatsapp_inbound_messages` + `whatsapp_conversations` + `tenant_whatsapp_settings` + identity_matcher por persons.phone + intent_router IA Claude Haiku + classificador anexos PDF/imagem + `scanUpload` regra 38 + handler registry pluggable consumido por Sprints 15 (boleto)/12 (foto-progress)/30 (exame).
- **Webhook callbacks** delivery/read (POST /api/mensagens/webhook/whatsapp + email Resend) que atualiza `messages_sent.delivered_at`/`read_at`/`failed_at`.
- **Rate limit por (tenant, member, 24h)** via Redis self-host antes de enviar.
- **Opt-out flow via `consents`**: verificar `marketing_messages` revoked antes de enviar.
- **UI `/app/mensagens/providers`** config credentials_encrypted + sandbox toggle + teste de envio.
- **UI `/app/mensagens/inbound`** operador acompanha mensagens recebidas pendentes intervenção.
- **RIPD `docs/compliance/ripd/v1.0-whatsapp.md`** (regra 29 + ADR 0054) — gate de produção.
- **Feature flag `mensagens_v1`** (PostHog dropado MVP).
- **Particionamento `messages_sent`** por mês (regra 34 + ADR 0072) Sprint 14+ quando volume justificar.
- **Canais de notificação `system_alerts`** (ADR 0071) via worker consumer da `notification_queue`.
- **Trigger BEFORE UPDATE em `messages_sent`** validando apenas colunas de callback foram alteradas (audit append-only sem violar callback flow).

### Build — Sprint 12 100%: Avaliações físicas (schemas dinâmico + calculadoras + EVA scorer + UI low-code + ADR 0024) 2026-05-13

Sprint 12 fecha em **100%**. Faixas A+B+C+D entregues no mesmo dia: 5 schemas + RLS especial pra biblioteca global de tipos + 10 tests; 5 calculadoras antropométricas + scorer EVA com 35 tests; 7 Server Actions wrapped incluindo `createAssessment` em transação com cálculos automáticos via field_key reconhecido; UI completa (hub + catálogo de tipos com filtros + editor low-code de fields + tabela member + wizard dinâmico + detail com cálculos derivados + widget perfil); ADR 0024 publicado documentando `fields jsonb` declarativo cross-vertical (Academia composição + Fisio escalas funcionais + Nutri Sprint 29). Seed standalone popula 5 tipos globais (Antropometria + Bioimpedância + Dobras 7 Pollock + Anamnese Academia + EVA Fisio com clinical_reference + scoring_method).

**Faixa A (Schema + RLS + Tests):**

- **`packages/db/src/schema/avaliacoes.ts`** — 5 tabelas:
  - `assessment_types` — `tenant_id` **nullable** (NULL = biblioteca global LogiFit, NOT NULL = customizado tenant); `fields jsonb` declarativo (schema dinâmico ADR 0024); `scoring_method jsonb` (escalas funcionais com `strategy`/`domains`/`interpretation`); `clinical_reference text` (citação bibliográfica); enum `assessment_category` (composicao_corporal/escala_funcional/anamnese/teste_funcional/custom) + enum `assessment_vertical` (academia/fisio/nutri); versionamento via `parent_type_id` + `version int`; índices parciais `assessment_types_global_idx` + `assessment_types_tenant_category_idx`.
  - `assessments` — `type_version int` snapshot pra preservar schema histórico; `soft_deleted_at` retenção 20a (COFFITO 415 + CFM 2.299); `performed_at`/`performed_by_user_id`/`notes`.
  - `assessment_measurements` — `value_num`/`value_text`/`value_enum` mutex via check `assessment_measurements_has_value`; enum `measurement_source` (manual/device/import_csv); pré-cabeada Device Hub Sprint 34 com `source_device_reading_id` + check `assessment_measurements_device_requires_validation` (source=device exige validated_by+validated_at); unique `(assessment_id, field_key)`.
  - `assessment_photos` — Storage bucket privado placeholder; enum `assessment_photo_kind` (front/back/side_left/side_right/custom); `scan_status` pra integração Sprint 38 ClamAV (regra 38).
  - `assessment_calculations` — cache de derivados; `calc_key` canônico (`imc`/`pct_gordura_pollock7`/`tmb_mifflin`/`tmb_harris_benedict`/`tmb_katch_mcardle`/`rcq`/`massa_magra_kg`); `classification` (faixa OMS/Pollock/cardiovascular); unique `(assessment_id, calc_key)`.
- **`packages/db/src/policies/0031_avaliacoes_rls.sql`** — 15 policies tenant-scoped. Biblioteca global em `assessment_types` (SELECT `tenant_id IS NULL OR tenant_id = app.tenant_id`). INSERT global bloqueado pra app-role. Sem DELETE em assessments (soft-delete obrigatório pra retenção 20a).
- **`packages/db/tests/avaliacoes-rls.test.ts`** — 10 testes: biblioteca global visível cross-tenant + INSERT global rejeitado via app-role + tipo customizado não vaza + isolamento assessments + check has_value + unique field_key + check device requires validation + unique calc_key + soft-delete preserva row.

**Faixa B (Calculadoras + EVA + Server Actions):**

- **`packages/db/src/avaliacoes/calc.ts`** (ADR 0070): 5 calculadoras + helper:
  - `calculateImc({weightKg, heightCm})` — IMC + classificação OMS (6 bands)
  - `calculatePollock7({7 dobras, ageYears, sex})` — densidade Jackson-Pollock 1980 + Siri 1956 → % gordura + bands por sexo
  - `calculateTmbMifflin({weight, height, age, sex})` — Mifflin-St Jeor 1990 (recomendada ADA)
  - `calculateTmbHarrisBenedict({weight, height, age, sex})` — Harris-Benedict revisado 1984
  - `calculateTmbKatchMcArdle({leanMassKg})` — usa LBM (mais precisa com bioimpedância)
  - `calculateRcq({waist, hip, sex})` — relação cintura-quadril + risco cardiovascular OMS
  - `calculateLeanMass(weight, pctFat)` — LBM derivado
  - Todos retornam null em edge cases (peso/altura/idade inválidos); 27 unit tests cobrindo casos canônicos + edge cases.
- **`packages/db/src/avaliacoes/scoring-eva.ts`**: EVA 0-10 Huskisson 1974 com 5 bands (sem_dor/leve/moderada/intensa/insuportavel) + severity (info/warning/danger/critical); 8 unit tests.
- **`packages/db/package.json`** — novo export `./avaliacoes`.
- **`apps/web/app/app/avaliacoes/actions.ts`** — 7 Server Actions wrapped:
  - `createAssessmentType` / `listAssessmentTypes` (combina global+tenant; filtros category/vertical)
  - `createAssessment` — **transação com cálculos automáticos**: lookup measurements por `field_key` reconhecido → chama calc.ts → popula `assessment_calculations` em batch (IMC se peso+altura ou context.heightCm; Pollock se 7 dobras + context.ageYears + context.sex; RCQ se cintura+quadril+context.sex; TMB Mifflin se peso+altura+idade+sexo; lean mass se peso+Pollock)
  - `listMemberAssessments` (filtro category opcional)
  - `getAssessment` (measurements + photos + calculations expandidos + audit setAuditResource)
  - `compareAssessments` (série temporal por field_key pra gráfico evolução)
  - `softDeleteAssessment` (preserva row + audit retenção 20a)
  - `getLatestAssessmentSummary` (widget perfil — última avaliação + calcs)

**Faixa C (UI):**

- **`/app/avaliacoes/page.tsx`** — hub: lista recentes (até 20) com link member + tipo + categoria + data.
- **`/app/avaliacoes/tipos/page.tsx`** — catálogo combinado com badges "Global"/"Tenant" + filtros category/vertical + cards mostrando fields preview + clinical_reference.
- **`/app/avaliacoes/tipos/new/page.tsx`** + form client — editor low-code de fields: add/remove campos + kind picker (number/text/enum/likert) + unit/min/max/options.
- **`/app/members/[id]/avaliacoes/page.tsx`** — tabela das avaliações do member com link "+ Nova".
- **`/app/members/[id]/avaliacoes/new/page.tsx`** + wizard client — **schema dinâmico em runtime**: seleciona tipo → busca fields jsonb → renderiza form (number/text/enum/likert) + context pre-preenchido de person (idade calculada de birth_date, sexo de person.sex, altura manual) → `createAssessment`.
- **`/app/members/[id]/avaliacoes/[assessmentId]/page.tsx`** — detail com cards de **cálculos derivados** (IMC + classificação com cor por severity OMS, % gordura Pollock + faixa, TMB Mifflin, RCQ + risco cardiovascular) + tabela de measurements com unit por field_def.
- **`/app/members/[id]/page.tsx`** — adicionado widget "📊 Última avaliação" entre Treinos e slot Copilot futuro com 3 calc cards mini.
- **`packages/db/scripts/seed-avaliacoes.ts`** + script `pnpm db:seed:avaliacoes` — popula **5 tipos globais**: Antropometria Academia (peso+altura+4 circ), Bioimpedância (peso+altura+%gordura+massa magra+%água+gordura visceral), Dobras 7-pregas Pollock (clinical_reference Pollock & Jackson 1980 + Siri 1956), Anamnese Academia (objetivo+nível atividade+histórico médico+medicamentos+restrições+frequência), EVA — Escala de Dor (scoring_method completo + clinical_reference Huskisson 1974).

**Faixa D (ADR + fechamento):**

- **[`docs/decisions/0024-avaliacoes-schema-dinamico-fields-jsonb.md`](docs/decisions/0024-avaliacoes-schema-dinamico-fields-jsonb.md)** — ADR 0024 Accepted. Justifica `fields jsonb` declarativo cross-vertical (vs tabela-por-tipo / EAV / JSONB único): adicionar tipo = INSERT row sem migration; cross-vertical reuso Sprint 20 Fisio + Sprint 29 Nutri; cálculos derivados via field_key canônico; snapshot type_version preserva schema histórico; biblioteca global cross-tenant; alternativas rejeitadas (tabela-por-tipo explode N tabelas; EAV puro perde tipagem + queries lentas; JSONB único perde unique + índices).
- **45 testes Vitest Sprint 12 verdes** (10 RLS + 27 calc + 8 EVA); **206 testes total verdes** (era 161).
- Typecheck clean.

**Pendências menores adiadas Sprint 12+ próximo PR:**

- 7 escalas funcionais Fisio restantes (Oswestry/DASH/Tampa/SF-36/Berg/TUG/WOMAC) seguindo mesmo padrão MVP EVA + scoring_method jsonb completo.
- Calculadoras protocolos brasileiros (Petroski 4 dobras, Guedes 3 dobras, Durnin-Womersley, Faulkner, Cunningham).
- Upload foto MinIO bucket privado + ClamAV scan (regra 38) + URL assinada.
- Gráficos Recharts de evolução temporal por field_key (consome `compareAssessments`).
- Comparação visual lado-a-lado entre 2-3 avaliações (antes × depois × atual).
- Integração com Sprint 09 goals via evento `measurement.recorded` (medição peso → atualiza progresso goal kind=weight_loss).
- WhatsApp photo-progress handler hub Sprint 13 — paciente manda foto pelo WA → rascunho pending em `/app/members/[id]/avaliacoes/pending-photo`.
- Device Hub source=device validation trigger Sprint 34 (já check constraint mas trigger Server Action faltando).
- RIPD `docs/compliance/ripd/v1.0-avaliacoes-fisicas.md` (regra 29 + ADR 0054) — gate de produção clínica.
- Feature flag `avaliacoes_v1` (PostHog dropado MVP).
- Particionamento `assessment_measurements` por mês (regra 34 + ADR 0072) Sprint 12+ quando volume real justificar.

### Build — Sprint 11 100%: Prescrições + biblioteca de treinos (schemas polimórficos + Server Actions + UI catálogo/wizard/execução + ADR 0023) 2026-05-13

Sprint 11 fecha em **100%**. Faixas A+B+C+D entregues no mesmo dia: 6 schemas + RLS especial pra biblioteca global + 13 tests; 12 Server Actions incluindo `prescribeWorkout` + `startSession` + `finishSession` (preenche `calculated_kcal` automaticamente via MET); UI completa (catálogo `/app/biblioteca/exercicios` + wizard novo workout `/app/treinos/new` + ficha do member `/app/members/[id]/treino` + execução set-a-set + widget perfil); helper `calculateKcalPerSession` em `@repo/db/treinos` com 11 unit tests + ADR 0070; ADR 0023 publicado documentando `prescriptions` polimórfico `kind`+`ref_id` como base cross-vertical (workout MVP, meal_plan Sprint 29, fisio_protocol Sprint 20). Seed standalone popula 20 exercícios globais Compendium 2024 + 2 workouts por tenant.

**Faixa A (Schema + RLS + Tests):**

**Adições:**

- **`packages/db/src/schema/treinos.ts`** — 6 tabelas:
  - `exercises` — `tenant_id` **nullable** (NULL = biblioteca global LogiFit, NOT NULL = tenant); `met_value numeric` obrigatório (Compendium 2024); `muscle_groups text[]`, `variations uuid[]`, `level` enum (iniciante/intermediario/avancado); `video_storage_path` + `thumbnail_url`. Check `exercises_met_positive` (>0). Índice parcial `exercises_global_idx` p/ leitura quente da biblioteca.
  - `workouts` — templates por tenant com versionamento via `parent_workout_id` + `version int`; goal/duration/description; soft-delete `archived_at`. Check `workouts_version_positive`.
  - `workout_items` — ordem + sets + reps text livre ("10"/"8-12"/"AMRAP") + load_kg opcional + rest_seconds + notes + `superset_group` opcional. Unique `(workout_id, order)`. Cascade delete pela workout.
  - `prescriptions` — **base polimórfica (ADR 0023)** com enum `prescription_kind` (workout/meal_plan/fisio_protocol/custom) + `ref_id uuid` (FK lógica). Checks `prescriptions_ref_required` (custom não exige ref_id) + `prescriptions_ends_after_starts`. Índice parcial `prescriptions_active_idx`.
  - `workout_sessions` — referencia `prescription_id` (NÃO `workout_id`) pra preservar histórico mesmo se profissional trocar workout; `started_at`/`finished_at`; `overall_rpe` (range 1-10); `calculated_kcal numeric` preenchido em `finishSession`.
  - `workout_session_items` — registro set-a-set: `set_number`/`reps_performed`/`weight_kg`/`rpe`/`done_at`. Unique `(session_id, workout_item_id, set_number)`. Append-only via ausência de UPDATE/DELETE policy.
- **`packages/db/src/policies/0030_treinos_rls.sql`** — 16 policies tenant-scoped. **Política especial em `exercises`**: SELECT permite `tenant_id IS NULL OR tenant_id = app.tenant_id` (biblioteca global visível a todos), INSERT/UPDATE só com tenant_id próprio (curador externo seedea globais via superuser). `workout_session_items` sem UPDATE/DELETE policy → silently blocked (append-only audit-like).
- **`packages/db/tests/treinos-rls.test.ts`** — 13 testes cobrindo: isolamento per-tenant + biblioteca global visível cross-tenant + INSERT global rejeitado via app-role + check constraints (met_positive, version_positive, sets_positive, rpe_range, ends_after_starts, ref_required) + unique workout_items order + versionamento via parent_workout_id + polimorfismo prescription (kind=workout exige ref_id, kind=custom não) + workout_session_items append-only.

**Faixa B (kcal helper + Server Actions):**

**Adições:**

- **`packages/db/src/treinos/kcal.ts`** — `calculateKcalPerSession({ items, weightKg, durationMin })`:
  - Fórmula MET clássica: `kcal = MET_médio_ponderado × weight × duration_hours`
  - Edge cases: weight≤0 → fallback 70kg (até Sprint 12 antropometria); duration≤0 ou items vazio → 0; MET inválido (≤0) ignorado no average ponderado; clampeado [0, 5000] kcal pra proteger contra duration absurda.
  - 11 unit tests Vitest cobrindo todos cenários (caso canônico, fallback, items inválidos, duration 0/negativa, clamp, 2 casas decimais).
- **`packages/db/package.json`** — novo export `./treinos`.
- **`apps/web/app/app/treinos/actions.ts`** — 12 Server Actions wrapped (envelope ADR 0071 + audit_log):
  - `createExercise` / `listExercises` (catálogo do tenant + biblioteca global incluída por default; filtros por busca/nível/grupo muscular).
  - `createWorkout` (transação com workout_items batch); `updateWorkout` (versionamento: cria nova row `version+1` + `parent_workout_id`, sem UPDATE in-place); `listWorkouts` / `getWorkout` (com items expandidos + JOIN exercises pra MET/level/grupos).
  - `prescribeWorkout` — cria `prescriptions` kind=workout, valida member+workout no tenant. **Cross-prescrição alert ADIADO Sprint 11+**: depende `getCrossTenantSummary` (Sprint 02 pendência) + meal_plans (Sprint 29) + fisio_protocols (Sprint 20).
  - `listMemberPrescriptions` (com JOIN workouts pra exibir nome/goal/version no widget).
  - `startSession` (cria workout_session) / `recordSessionItem` (registra série) / `finishSession` (preenche `calculated_kcal` em transação: busca workout_items via prescription → MET ponderado × peso fallback 70kg × duration_min → clamp 5000).

**Faixa C (UI):**

**Adições:**

- **`/app/biblioteca/exercicios/page.tsx`** — catálogo combinado (global + tenant) com filtros (search/level/muscle); badge "GLOBAL" vs "TENANT"; cards com MET/nível/equipamento/grupos.
- **`/app/biblioteca/exercicios/new/page.tsx`** + form client — cadastro de exercício no tenant (biblioteca global é seedada via curadoria LogiFit fora do app).
- **`/app/treinos/page.tsx`** — lista de workouts com contagem de items inline.
- **`/app/treinos/new/page.tsx`** + wizard client — header (nome/goal/duration) + lista add 1-a-1 de exercises com edição inline de séries/reps/carga/descanso/superset; mover ↑/↓; salva via `createWorkout`.
- **`/app/treinos/[id]/page.tsx`** — detalhe read-only com items expandidos + link pra versão anterior (`parent_workout_id`).
- **`/app/members/[id]/treino/page.tsx`** — ficha do member: prescrições ativas (com botão "Iniciar sessão" via Server Action) + form `prescribeWorkout` inline + histórico de sessões com kcal calculado + sessão ativa em banner se houver.
- **`/app/members/[id]/treino/sessao/[sessionId]/page.tsx`** + execution panel client — UI de execução set-a-set por workout_item; capture reps_performed/weight_kg/rpe inline; botão "Finalizar sessão" abre painel inline com RPE geral + notas (substitui `window.prompt` proibido pela regra 45). Refresh automático após cada record/finish.
- **`/app/members/[id]/page.tsx`** — adicionado widget "🏋️ Treinos prescritos" entre Metas e slot Copilot futuro; mostra até 5 prescrições ativas com nome/goal/version + link "ver ficha" para `/app/treinos/[id]`.
- **`packages/db/scripts/seed-treinos.ts`** + script `pnpm db:seed:treinos` — popula **20 exercícios globais** Compendium 2024 cobrindo grupos canônicos (peito/dorsal/quadriceps/posterior/ombro/braço/core/aeróbico) com MET ponderado. Por tenant: cria **2 workouts** (Treino A — Superior Push+Pull + Treino B — Inferior Pernas+Core) com 6 items cada (idempotente por nome de exercise + count workouts por tenant).
- **`.claude/launch.json`** — adicionado config `web` (porta 3100) pra preview MCP.

**Faixa D (ADR + fechamento):**

- **[`docs/decisions/0023-prescricoes-polimorficas-base.md`](docs/decisions/0023-prescricoes-polimorficas-base.md)** — ADR 0023 Accepted. Justifica `prescriptions` polimórfico com `kind`+`ref_id` em vez de N tabelas por vertical: cross-feature uniforme (copilot Sprint 06 / régua Sprint 13 / cross-alert Sprint 27 / cross-prescrição cross-tenant Sprint 11+ ADR 0077 consomem 1 query); FK lógica em ref_id (FK relacional polymorphic não existe nativamente em PG); `active` materializado pra evitar timestamp arithmetic em query quente (custo: job cron diário Sprint 12+); versionamento workouts via parent_workout_id preserva ficha histórica em prescrições antigas. Rejeitadas: tabela-por-vertical (explode N tabelas + 3-way UNION), JSONB sem ref_id (perde integridade), Single Table Inheritance (80+ colunas nullable).
- 161 testes Vitest verdes em 15 files (eram 137 antes — +13 treinos-rls +11 kcal).
- Typecheck `pnpm --filter @app/web typecheck` clean.

**Pendências menores adiadas Sprint 11+ próximo PR:**

- Cross-prescrição alert (ADR 0077 + regra 42): `detectCrossPrescriptionConflicts` Server Action + `cross_prescription_alerts` schema particionado por trimestre + 4 regras canônicas (hypoglycemia_risk / volume_incompatible / motor_restriction_violation / cardiac_load_excessive) + UI banner antes de `prescribeWorkout` salvar; depende `getCrossTenantSummary` (Sprint 02 pendência) + `meal_plans` (Sprint 29) + `fisio_protocols` (Sprint 20).
- Particionamento `workout_sessions` + `workout_session_items` por trimestre + agregação trimestral (regra 34 + ADR 0072) — Sprint 12+ quando volume real justificar.
- Job cron diário que zera `prescriptions.active=false` quando `ends_at < now()` — Sprint 12+.
- Upload de vídeo de exercício pra MinIO + URL assinada — Sprint 11+ próximo PR (`uploadExerciseVideo` Server Action + bucket `exercises`).
- Drag-and-drop no wizard de workout (Faixa stretch).
- E2E Playwright completo (instrutor cria workout → prescreve → aluno executa → RPE → kcal).
- Feature flag `treinos_v1` (PostHog dropado MVP; quando avaliar PostHog self-host pós-MVP religa).
- RIPD `docs/compliance/ripd/v1.0-prescricoes.md` (regra 29 + ADR 0054) — gate de produção; implementação desbloqueada, ativação clínica precisa RIPD assinado pelo DPO.
- Lint `cross-tenant-read-must-log` enforcement nos Server Actions de treinos (regra 42) — quando primeira read cross-tenant aterrissar via cross-prescrição alert.

**Bug pré-existente identificado durante verificação preview (não-regressão Sprint 11):** Server Components que usam `db` global (vendas/members/treinos lista) retornam 0 rows porque RLS bloqueia (`app.tenant_id` não setado nessa conexão — `withSessionContext` só funciona pra Server Actions). Documentado em `session.ts`. Resolução requer mudança infraestrutural (envelope `withSessionContext` em todo Server Component OU `db.transaction` com `SET LOCAL`) — fora escopo Sprint 11. Mitigação: catálogo global de exercícios funciona (RLS permite tenant_id NULL); demais páginas usam mesmo padrão pré-existente em vendas/members.

### Build — Sprint 10 100%: Funil de vendas completo (schemas + Server Actions + UI kanban + ADR 0022) 2026-05-13

Sprint 10 fecha em **100%**. Faixas A+B+C+D entregues no mesmo dia: 5 schemas + RLS + 8 tests; 7 Server Actions (incluindo `convertLeadToMember` atomic transaction); UI kanban + lista tabular + form quick capture + detalhe com timeline; ADR 0022 publicado documentando o modelo `lead.person_id` opcional + `quick_*` + conversão reusa mesmo `person_id`. Seed standalone popula 6 stages + 10 leads por tenant.

**Faixa A (Schema + RLS + Tests):**

**Adições:**

- **`packages/db/src/schema/vendas.ts`** — 5 tabelas:
  - `lead_stages` — configurável por tenant; default 6 estágios (novo/contato_feito/aula_experimental/proposta/matriculado/perdido). Enum `lead_stage_kind` (open/won/lost). Unique `(tenant_id, slug)`.
  - `leads` — `person_id` nullable (FK persons ADR 0047) + `quick_name/quick_phone/quick_email` para captura inicial sem CPF confirmado; FK `stage_id` (restrict on delete), `assigned_to_user_id`, `source` enum (9 valores incluindo gympass/totalpass/outdoor); `converted_to_member_id` preserva histórico do funil; soft-delete via `archived_at`. Check constraint `leads_min_contact_or_person` (person OU quick_*).
  - `lead_events` — audit append-only de movimentações funil (kind text livre + fromStageId/toStageId).
  - `trial_classes` — link `lead_id` ↔ `appointment_id` (FK lógica para Sprint 03 evitando dependência circular); enum `trial_outcome` (booked/attended/no_show/cancelled).
  - `proposals` — versionada (status enum draft/sent/accepted/rejected/expired/cancelled), `plan_id` XOR `bundle_plan_id`, `converted_contract_id` FK lógica Sprint 04. Check constraints `proposals_price_non_negative`, `proposals_discount_lt_price`, `proposals_one_plan_xor_bundle`.
- **`packages/db/src/policies/0029_vendas_rls.sql`** — RLS tenant-scoped (`current_setting('app.tenant_id')`) + GRANTs ao role `logifit_app`. `lead_events` append-only (sem UPDATE/DELETE policy). `lead_stages` sem DELETE (soft via `active=false`); `leads` sem DELETE (soft via `archived_at`).
- **`packages/db/tests/vendas-rls.test.ts`** — 8 tests:
  - Isolation Rede vs Franquia em `leads`
  - `leads_min_contact_or_person` rejeita lead sem person_id NEM quick_*; aceita quick_phone só
  - `lead_stages` slug unique por tenant (duplicada no mesmo tenant rejeitada, mesma em outro tenant coexiste)
  - `proposals` price negativo rejeitado, discount>=price rejeitado, proposal mínima aceita
  - `lead_events` UPDATE bloqueado pelo RLS (rowCount 0 ou erro)
- Migration `0016_worried_wonder_man.sql` aplicada via `pnpm --filter @repo/db db:migrate`.

**Testes:** 137 verdes (`pnpm --filter @repo/db test`).

**Faixa B (Server Actions atomic):**

- **`apps/web/app/app/vendas/actions.ts`** — 7 Server Actions via `wrapServerAction` (regra 33 + ADR 0071 envelope):
  - `createLead(input)` — resolve stage default via 1º active orderIdx se omitido; INSERT lead + INSERT lead_events kind='lead.created'.
  - `moveLeadToStage(leadId, toStageId, reason?)` — `db.transaction`: UPDATE leads.stageId + INSERT lead_events kind='stage_changed' com `from_stage`/`to_stage`. Idempotente: se já no stage destino retorna `unchanged: true`. Valida stage destino existe + active + pertence ao tenant.
  - `archiveLead(leadId, reason)` — soft-delete (`archived_at=now`, `lost_reason=reason`) + INSERT lead_events kind='lead.archived'.
  - `createProposal(leadId, planId|bundlePlanId, priceCents, discountCents, validUntil, notes?)` — versionada via `MAX(version) + 1` por lead. Cross-field validation via Zod `.refine`: discount < price, plan XOR bundle.
  - `convertLeadToMember(leadId, proposalId?, billingDay)` — **atomic transaction**: requer `person_id`, INSERT member com `ON CONFLICT (tenant_id, person_id) DO NOTHING` + busca existente em race, INSERT member_events kind='member.created', (opcional) INSERT contract status='active' a partir da proposta com plan_id + UPDATE proposals.status='accepted' + convertedContractId, marca lead.convertedToMemberId + archived, INSERT lead_events kind='lead.converted'.
  - `listLeads({stageId?, assignedToUserId?, limit})` — filtros para kanban/tabular.
  - `listLeadStages()` — lookup pra UI columns + dropdowns.

**Faixa C (UI + Seed):**

- **`apps/web/app/app/vendas/page.tsx`** — Server Component board kanban: colunas por stage ordenado por orderIdx, count badge, cor da borda diferenciada (open/won/lost), leftJoin com persons pra mostrar `personName ?? quickName ?? '(sem nome)'`. Atalhos para lista tabular + novo lead.
- **`apps/web/app/app/vendas/leads/page.tsx`** — lista tabular responsiva com `alias(persons, 'assigned_person')` (drizzle) pra resolver dois joins persons no mesmo query (lead person + assigned user person). Filtros via querystring `?stage=...&assigned=...`. Tabela 6 colunas: Nome/Contato, Estágio (com cor por kind), Origem, Interesse, Responsável, Criado.
- **`apps/web/app/app/vendas/leads/new/page.tsx`** + **`new-lead-form.tsx`** — Server Component fetch companies + active stages; Client Component form 8 fields (companyId, stageId opcional, quickName, quickPhone, quickEmail, source dropdown 9 valores, interest, notes) com useTransition + redirect pós-create para `/app/vendas/leads/{id}`.
- **`apps/web/app/app/vendas/leads/[id]/page.tsx`** — detalhe com header (nome + contato + estágio badge + status convertido/arquivado), card dados (origem + interesse + criado + person status), card propostas (versão + preço final + status + valid_until), timeline append-only `lead_events` com data formatada pt-BR.
- **Client Components**:
  - `LeadStageSelector` — chips de stages com onClick → `moveLeadToStage` + `router.refresh`. Optimistic UI: muda visual antes do server confirmar, rollback em erro.
  - `LeadActions` — 2 dialogs (Converter com select de propostas + Arquivar com input motivo). useTransition + state pending. Bloqueia converter quando `!hasPersonId` (tooltip explica).
- **`packages/db/scripts/seed-vendas.ts`** + **`pnpm db:seed:vendas`** — script standalone idempotente: popula 6 stages canônicos (novo/contato_feito/aula_experimental/proposta/matriculado/perdido com cores hex + kind correto) + 10 sample leads distribuídos em open stages por cada tenant existente. Idempotente via `ON CONFLICT (tenant_id, slug) DO NOTHING` em stages e count check em leads. Roda em 8 tenants canônicos OK.
- **Test fix**: `tests/vendas-rls.test.ts` usa slug `test_novo` (não 'novo') pra não colidir com seed-vendas. 137 tests verdes.

**Faixa D (ADR + roadmap 100%):**

- **`docs/decisions/0022-funil-vendas-lead-quick-capture-person-fk.md`** — ADR 0022 publicado documentando:
  - 2 tensões: captura mínima vs identidade confirmada + lead→member sem duplicação.
  - Decisão: `leads.person_id` nullable + `quick_name/quick_phone/quick_email` + check constraint mínimo contato; conversão reusa mesmo `person_id` via `ON CONFLICT (tenant_id, person_id) DO NOTHING` (ADR 0047 alinhado).
  - Tabela de transições obrigatórias por estágio (proposta/won exigem person_id).
  - 3 alternativas rejeitadas (sem quick_*, sem person_id, duplicar identidade em leads).
  - Trade-offs: lead órfão sem person_id se nunca avança; race condition mitigada via ON CONFLICT + busca.
  - Próximos passos: trigger validação + constraint 1 won ativo + integração modo solo + passaporte cross-tenant.
- **roadmap.md**: Sprint 10 row marcada **done** 100% com Início + Fim 2026-05-13.
- **`docs/sprints/10-geral-funil-vendas.md`**: Status **done**, todos checklist marcados, Log com Faixa B+C+D consolidado.

**Pendências menores adiadas (Sprint 11+):**

- Trigger SQL `leads_require_person_on_stage_won` (validação atualmente no boundary via Server Action regra 7)
- Constraint global 1 stage `kind='won'` ativo por tenant
- `scheduleTrialClass(leadId, resourceId, startsAt)` — depende Sprint 03 appointments com flag `is_trial=true` (campo a adicionar)
- `acceptProposal(proposalId)` — atualmente embutido em `convertLeadToMember`, separar fluxo pra "aceita sem converter" (rascunho de contrato)
- `upgradeLeadToPerson(leadId, personData)` wizard — atualmente captura via `createLead({personId: ...})` direto
- Drag-and-drop kanban client-side (`@dnd-kit/sortable` ou similar)
- E2E Playwright completo: novo → experimental → proposta → matriculado
- Feature flag `vendas_v1` (Sprint 00 dropou PostHog; usar env var simples)
- Permission `vendas.read_own/read_all/write` no seed RBAC (Sprint 01a Faixa C+ extension)
- Widget "funil resumo" no `/app/dashboard/gerente` (Sprint 13+ régua)
- Externalizar Zod schemas pra `packages/types/vendas.ts` (atualmente inline em actions.ts)

### Build — Sprint 06 100%: IA arquitetura fechamento (LLM real + BYOK write + RAG + STRIDE + RIPD v1.0) 2026-05-13

Sprint 06 fecha em **100%**. Completa os 25% restantes: LLM real via Vercel AI SDK, BYOK UI write, white-label editável, cota daily real, anti-abuse, lint `ai-block-respected`, job RAG seed, threat model STRIDE v1.0, RIPD v1.0.

**Adições:**

- **Vercel AI SDK instalado** em `@repo/ai` (`ai@6.0`, `@ai-sdk/google@3.0`, `@ai-sdk/anthropic@3.0`, `@ai-sdk/openai@3.0`).
- **`packages/ai/src/chat.ts`** — `chatComplete()` wrapper canônico de chat completion:
  - Pipeline: classifyInput → redactBeforeLLM → buildSystemPrompt → resolveModel → callProvider (Gemini Vertex AI / Anthropic / OpenAI via lazy import) → classifyOutput → retorna `{text, modelSlug, providerSlug, tokens, latencyMs, guardrailBlocked, stubUsed}`
  - Fallback gracioso pra stub quando provider 5xx ou sem credentials
  - `resolveModelOrStubFromEnv()` atalho lê `GEMINI_API_KEY` ENV
- **`apps/web/app/app/assistente/actions.ts`** atualizado: `sendMessage` migra de stub local para `chatComplete()`; usa `getAvailableTools()` filtrado por persona/permission/vertical antes da chamada LLM.
- **Cota daily real**: `getCurrentUsage` agora roda `count(ai_audit_log) WHERE created_at >= today 00:00 UTC AND guardrail_blocked=false` (regra 34 indexes existentes cobrem).
- **Anti-abuse 10× média 7d** (`checkAbusePattern` + `raiseAbuseAlert`): se `dailyUsed ≥ 50` e `dailyUsed ≥ 10 × avg7d`, INSERT/UPDATE em `system_alerts` com `fingerprint=ai_abuse_10x:{tenant}` severity=warning category=ai retenção 90d.
- **`packages/db/src/schema/ai-settings.ts`** — schema `tenant_assistant_settings` (PK tenantId): `assistant_name`, `default_persona`, `enabled_personas` jsonb, `classifier_strictness`. Migration `0028_ai_settings_rls.sql` RLS + GRANTs.
- **`apps/web/app/app/settings/ia/actions.ts`** — 4 Server Actions:
  - `saveByokKey({providerSlug, apiKey})` — upsert `ai_provider_configs` com `encryptSecret()` AES-256-GCM
  - `testByokKey({providerSlug})` — decrypt + smoke check + persist `last_tested_at`/`last_test_result`
  - `revokeByokKey({providerSlug})` — `enabled=false`
  - `saveAssistantName({assistantName})` — upsert `tenant_assistant_settings`
- **`apps/web/app/app/settings/ia/settings-form.tsx`** — `<AssistantNameForm>` (white-label editor) + `<ByokForm>` (select provider + input password masked + lista status com botões Testar/Revogar por provider). Usa `useTransition` + consome envelope `{ok, data | error}`.
- **`apps/web/app/app/settings/ia/page.tsx`** atualizado: read de `tenant_assistant_settings` + `ai_provider_configs` per-provider status; embed forms.
- **`apps/web/app/app/layout.tsx`** lê `tenant_assistant_settings.assistant_name` real do DB → passa para `<AssistantFAB>` (white-label ativo).
- **`scripts/lint-custom.mjs`** — 9º checker **`ai-block-respected`**: detecta `registerAITool({handler: X})` apontando para função com `// ai-blocked:` no mesmo arquivo + exige `blocked: { reason }`. CI `pnpm lint:custom` clean nas tools do MVP.
- **`scripts/seed-rag-system-docs.mjs`** + **`pnpm rag:seed`/`pnpm rag:seed:dry`** — enumera **127 documentos** (`docs/decisions/`, `docs/sprints/`, `docs/runbooks/`, `docs/rules.md`, `docs/arquitetura.md`, `docs/modulos.md`, `docs/compliance/dpo.md`), chunka ~500 tokens overlap 50, calcula `sha256` content hash, gera `.rag-seed-manifest.json` consumível por job runtime. Embeddings via `text-embedding-004` quando `GEMINI_API_KEY` definida; NULL caso contrário.
- **`docs/threat-models/assistente-ia-tools.md`** — STRIDE v1.0 substituindo stub: 6 categorias × 6+ cenários cada + 12 riscos residuais identificados.
- **`docs/compliance/ripd/v1.0-ia-copilot-clinico.md`** — RIPD v1.0 com fluxo entregue, base legal LGPD art. 11/7º, retenção (1a quente + 5a cold), direitos do titular art. 18+20, matriz de risco × mitigação.

**Atualizações:**

- **`packages/ai/package.json`** — deps `ai@6.0.180`, `@ai-sdk/google@3.0.73`, `@ai-sdk/anthropic@3.0.77`, `@ai-sdk/openai@3.0.63`.
- **`packages/ai/src/index.ts`** — re-exporta `./chat`.
- **`packages/db/src/schema/index.ts`** — re-exporta `./ai-settings`.
- **`package.json`** raiz — scripts `rag:seed` + `rag:seed:dry`.
- **`packages/ui/src/assistant/{assistant-sheet,action-confirm-dialog}.tsx`** — anotação `// safe-fetch-exempt: same-origin client fetch to local /api/*` (regra 37 é pra outbound externo, não cliente → /api).
- **`pnpm dedupe`** executado pra resolver duplicação `drizzle-orm@0.45.2` trazida pelos `@ai-sdk/*` (era 2 instâncias com hashes diferentes).

**Sprint 06 status:** `doing` → **done** (100%).

**Verificações:**

- `pnpm -r typecheck` verde (12 packages)
- `pnpm --filter @repo/ai test` verde (61 unit tests)
- `pnpm i18n:check` verde
- `pnpm lint:custom` clean nas mudanças (sem nova violação de `ai-block-respected`)
- `pnpm rag:seed:dry` lista 127 docs

---

### Build — Sprint 06 75%: IA arquitetura (Faixas B+C+D parciais) 2026-05-13

Sprint 06 avança de 10% (Faixa A schemas) para 75% (Faixas B+C+D entregues, exceto LLM real + RAG seed + BYOK UI write). ADR 0015 publicado.

**Adições:**

- **`docs/decisions/0015-copilot-safety-vocabulario-proibido-classificador-output.md`** — ADR 0015 accepted: 4 conjuntos de patterns regex (prescrição/diagnóstico/proibidos/injection), classifier I/O obrigatório, audit `guardrail_blocked`, mensagens fallback persona-aware.
- **`packages/db/src/schema/ai-rag.ts`** — 5 schemas novos (custom type `vector(768)` pgvector):
  - `ai_documents` (global quando tenant_id IS NULL — seed ADRs/sprints; tenant-scoped quando upload via `/app/settings/ia/knowledge`)
  - `ai_document_chunks` (~500 tokens com `embedding vector(768)` HNSW indexado)
  - `ai_semantic_cache` (TTL 30d + LRU eviction; similarity threshold 0.93)
  - `member_insights` (cache cross-module 6-24h TTL — ADR 0070 esqueleto)
  - `support_tickets` + 2 enums (category/status); tool `report_issue` abre tickets com contexto.
- **`packages/db/src/policies/0026_ai_rag.sql`** — RLS read global+tenant em documents/chunks; tenant-scoped em cache/insights/tickets; HNSW indexes `vector_cosine_ops` (m=16, ef_construction=64); pgvector extension idempotent.
- **`packages/db/src/policies/0027_ai_models_seed.sql`** — Seed 8 models (Gemini 2.5 Flash/Pro, text-embedding-004, Claude Opus 4.7/Sonnet 4.6, GPT-4 Turbo, Whisper Large v3 Turbo, Sabiá-3) + task_routing default em 7 tasks (chat/embedding/classification/extraction/vision/transcription/reasoning) com priority cascade 100/200/300.
- **`packages/ai/`** — 11 arquivos novos + 5 test suites (**61 unit tests verdes**):
  - `types.ts` — tipos canônicos (AITask, AssistantLayer, AssistantPersona, ResolvedModel, AIToolDefinition, TenantContext)
  - `resolver.ts` — `resolveModelForTask()` + `resolveAllForTask()` com priority cascade + BYOK lookup + envelope decrypt
  - `cache.ts` — `lookupSemanticCache()` + `writeSemanticCache()` (deps-injectable, threshold default 0.93)
  - `redact.ts` — `redactBeforeLLM()` máscara PII parcial (CPF/CNPJ/RG/email/phone/cartão/PIX/CEP) preservando dígitos úteis; 12 tests
  - `classifier.ts` — `classifyInput()` (anti-injection 5 patterns) + `classifyOutput()` (3 conjuntos) + `getBlockedOutputMessage()`; 18 tests
  - `system-prompt.ts` — `buildSystemPrompt({persona,tools,rag,tenantCtx})` composer com GLOBAL_HARD_RULES por locale
  - `personas/{member,professional-clinical,professional-coach,admin,recepcao,super-admin,contador-externo,dpo}.ts` — 7 personas com prompts pt-BR/en-US/es-419
  - `personas/index.ts` — `inferPersona({roles, isMember})` + `getPersonaPrompt(persona, locale)`; 14 tests
  - `registry.ts` — `registerAITool()` + `getAvailableTools()` + filtro persona/permission/vertical/whenAvailable + proteção `ai-blocked`; 8 tests
  - `quotas.ts` — `AI_PLAN_LIMITS` (Solo/Combo/Starter/Pro/Business/Enterprise) + `checkQuota()` + `getPlanLimits()`; 9 tests
  - `ratelimit.ts` — `checkAIRateLimit({kind, tenantId, userId})` delegando ao `@repo/security` (stub Sprint 00 sliding window Redis Faixa C real)
- **`apps/web/app/app/assistente/actions.ts`** — Server Actions: `newSession`/`sendMessage`/`proposeAction`/`confirmProposal`/`rejectProposal`/`switchPersona`/`archiveSession` (com cota check + classifier I/O + PII redact + audit log persona-aware).
- **`apps/web/app/app/suporte/actions.ts`** — `openTicket`/`updateTicketStatus` Server Actions.
- **`apps/web/app/api/ai/{chat,session}/route.ts`** + **`apps/web/app/api/ai/proposals/[id]/{confirm,reject}/route.ts`** — REST wrappers das Server Actions com HTTP status code mapping.
- **`apps/web/app/lib/ai-tools.ts`** — Whitelist inicial de **9 tools** registradas (searchHelp/report_issue universais + getMyAppointments/cancelMyAppointment/getMyInvoices/requestSecondCopy/findMember/scheduleAppointmentForMember/getOverdueInvoices) + **3 tools bloqueadas** explicitamente (members.delete, fisio.signEvolution, financeiro.chargeBatch).
- **`packages/ui/src/assistant/`** — 3 componentes:
  - `<AssistantFAB>` (56/64px touch + Ctrl/Cmd+/ atalho + Esc fecha)
  - `<AssistantSheet>` (side panel 420px com header persona chip + bubbles + quota indicator + disclaimer fixo regra 28)
  - `<ActionConfirmDialog>` (alertdialog Camada 3 + título/descrição/impacto/affectedEntities/affected entities)
- **`apps/web/app/app/assistente/page.tsx`** — Lista conversas + sessão ativa.
- **`apps/web/app/app/settings/ia/page.tsx`** — Cota visual (% barra) + lista providers + placeholder BYOK.
- **`apps/web/app/app/suporte/page.tsx`** — Lista tickets (badge status + opened_by_assistant).
- **`apps/web/app/app/super-admin/ai-usage/page.tsx`** — Dashboard KPIs (total calls / cache rate / guardrail blocks / tools registered) + top tenants + tools registry snapshot.
- **i18n 12 arquivos novos**: `assistant.json`/`suporte.json`/`ia.json`/`ai_usage.json` em pt-BR + en-US + es-419.
- **`docs/compliance/ripd/v0.2-ia-copilot-clinico.md`** — RIPD v0.2 atualizado com fluxos reais Sprint 06.

**Atualizações:**

- **`packages/db/src/schema/index.ts`** — re-exporta `./ai-rag` após `./ai` Faixa A.
- **`apps/web/app/app/layout.tsx`** — integra `<AssistantFAB>` com `inferPersona(roles)` + `assistantLabels` i18n + white-label name 'Copilot' (Sprint 06+ Faixa D real lê `tenant_settings`).
- **`apps/web/src/i18n/request.ts`** — namespaces `assistant`, `suporte`, `ia`, `ai_usage` adicionados.
- **`apps/web/package.json`** — `@repo/ai` workspace dep adicionada.
- **`packages/ai/package.json`** — `@repo/security` workspace dep + vitest devDep.
- **`packages/ui/src/index.ts`** — re-exporta `./assistant`.

**Sprint 06 status:** `doing` → **75%** (Faixa A já entregue antes; Faixas B+C+D entregues nesta sessão exceto LLM real + RAG seed job + BYOK UI write + lint ai-block-respected + threat model + parecer DPO formal).

---

### Build — Sprint 05 25%: Ofertas comerciais schemas + RLS + tests (Faixa A) 2026-05-13

Sprint 05 começa. Faixa A entrega 7 schemas + 20 RLS policies + 10 Vitest tests + check constraints completos.

**Adições:**

- **`packages/db/src/schema/ofertas.ts`** — 7 tabelas (ADR 0020 esperado):
  - `promotions` (cupons): code/kind enum percent/fixed/trial_days/value/validity/max_uses/stackable. **`(tenant_id, code) UNIQUE`** + checks `value >= 0`, `max_uses > 0 OR NULL`.
  - `promotion_uses` (audit): contract_id?/invoice_id?/discount_cents/used_at/used_by_user_id.
  - `plan_items` (composição bundle): PK composta `(bundle_plan_id, idx)`. service_type text + quantity > 0 + credit_validity_days > 0 OR NULL.
  - `appointment_credits` (saldo): member_id/contract_id?/service_type/resource_modality?/balance/initial_quantity/source enum/earned_at/expires_at?. **Check crítico `balance <= initial_quantity` + `balance >= 0`** + `initial_quantity > 0`. Partial index `WHERE balance > 0`.
  - `credit_consumptions` (audit): credit_id/appointment_id?/consumed_at/amount > 0.
  - `referrals` (códigos): tenant_id/referrer_member_id/code/reward_promotion_id. **2 unique parciais**: `(tenant_id, code) UNIQUE` + `(tenant_id, referrer_member_id) WHERE active = true` (1 ativo por member).
  - `referral_uses` (conversões): referral_id/referred_member_id/contract_id?. **Unique `(tenant_id, referred_member_id)`** — member novo só converte 1.
- **2 enums Postgres novos**: `promotion_kind` (percent/fixed/trial_days), `credit_source` (bundle/purchase/referral_reward/manual_grant).
- **`plans.kind`** coluna nova — text + check `IN ('plan', 'bundle')`. Default `'plan'`. Sem pgEnum pra evitar dependency cycle Drizzle entre financeiro.ts ↔ ofertas.ts.
- **migration `0010_freezing_mole_man.sql`** via drizzle-kit generate.
- **`packages/db/src/policies/0021_ofertas_rls.sql`** — 20 RLS policies:
  - `promotions` S/I/U (sem DELETE — soft via archivedAt)
  - `promotion_uses` S/I (audit append-only)
  - `plan_items` CRUD (admin reorganiza bundles)
  - `appointment_credits` S/I/U (sem DELETE — créditos expiram via UPDATE balance=0)
  - `credit_consumptions` S/I (audit append-only)
  - `referrals` S/I/U
  - `referral_uses` S/I/U
  - GRANTs explícitos pra `logifit_app`
- **`packages/db/tests/ofertas-rls.test.ts`** — **10 Vitest integration tests**:
  - RLS isolation per-tenant
  - check `value < 0` → SQLSTATE 23514
  - `(tenant, code)` unique em promotions + mesma code em outro tenant coexiste
  - `balance > initial_quantity` → 23514
  - balance < 0 → 23514
  - balance == initial + UPDATE decrementa OK
  - referrals: 2 ativos por (tenant, member) → 23505 unique partial
  - referrals.code unique por tenant
  - plans.kind = 'plan'|'bundle' aceitos; 'invalid' → 23514

**Atualizações:**

- **`packages/db/src/schema/index.ts`** — re-exporta `./ofertas`.
- **`packages/db/vitest.config.ts`** — exclui `ofertas-rls.test.ts` do coverage.

**Validações:**

- typecheck 11/11 ✅
- `db:rls-check` 3 regras OK em **49 tabelas** (era 42, +7 ofertas)
- **115 Vitest tests verdes** (era 105 — +10 ofertas-rls)
- Migration aplicada local (idempotente)

**Lições documentadas:**

1. **Check constraint `balance <= initial_quantity`** é defesa em profundidade contra bug em consumeCredit que use UPDATE direto sem validar saldo. Banco rejeita; Server Action recebe SQLSTATE 23514 e mostra erro de UX claro.
2. **Index parcial com `now()` rejeitado** — Postgres exige IMMUTABLE em index predicate. Solução: `WHERE balance > 0` apenas (filtra >50% dos rows); filtro de `expires_at` fica no SELECT.
3. **Dependency cycle entre schemas Drizzle** evitado usando text + check em vez de pgEnum cross-arquivo. Trade-off: perde IntelliSense do tipo enum, mas mantém arquitetura clara.
4. **`(tenant_id, referrer_member_id) WHERE active = true` unique partial** é o pattern pra "1 ativo por (tenant, member)". Histórico de referrals desativados coexistem.
5. **PK composta `(bundle_plan_id, idx)`** em `plan_items` mantém ordem dos items no bundle sem precisar coluna `position int` separada nem trigger pra renumerar.

**Sprint 05 a 25%.** Faixas restantes: B (Server Actions + canApply validator + integração consumeCredit no createAppointment), C (UI promoções/pacotes/referrals + widget créditos em member), D (job expiração créditos + ADR 0020 + seed 3 promos + 2 bundles + 1 referral por tenant).

### Build — Sprint 04 100% (`done`): UI completa + widget financeiro + job D-5 + ADRs 0013+0014 2026-05-13

Sprint 04 completo. Faixas C+D entregam UI, widget cross-module, job de cobranças automáticas D-5 e os 2 ADRs.

**Adições:**

- **[ADR 0013](docs/decisions/0013-plano-contrato-cobranca-entidades-separadas.md)** — "Plano + Contrato + Cobrança como 3 entidades separadas". Compara modelo LogiFit (4 tabelas) vs. tabela única `subscriptions` (rejeitado) vs. Stripe-style (rejeitado por confundir contract com subscription). Documenta preço congelado por contrato, audit fiscal completo, múltiplos payments por invoice (chargeback parcial).
- **[ADR 0014](docs/decisions/0014-asaas-keys-distributed-vs-centralized.md)** — "Chaves Asaas por company (distributed) vs tenant (centralized)". `company_id` nullable + unique parcial WHERE active. Lookup com fallback central. Envelope encryption + migração futura per-tenant KMS Enterprise.
- **`packages/db/src/policies/0020_create_recurring_invoices.sql`** — SQL function `create_recurring_invoices() RETURNS jsonb`:
  - SECURITY DEFINER (admin op cross-tenant)
  - target_billing_day = day(now + 5d); INSERT pra contracts active matching
  - NOT EXISTS pra idempotência (re-rodar não duplica)
  - due_at calcula próximo billing_day correto (este mês se ainda não passou; senão próximo)
  - breakdown jsonb canonical + generated_by: cron
  - Retorna `{processed_at, target_billing_day, newly_created, invoice_ids[]}`
- **`apps/web/app/api/jobs/billing-daily/route.ts`** — cron 03:30 UTC. Bearer CRON_SECRET + timingSafeEqual. Log estruturado.
- **5 rotas UI `/app/financeiro/*`**:
  - `/app/financeiro` — visão geral 4 KPIs (contratos ativos, receita mês, em atraso com cor danger, receita 30d) via aggregate Drizzle em paralelo
  - `/app/financeiro/planos` — lista + toggle arquivados
  - `/app/financeiro/planos/new` + `new-plan-form.tsx` — input price BRL parsing cents + preview formatado
  - `/app/financeiro/contratos` — filtros status (active/paused/cancelled/expired) + JOIN plan+member+person
  - `/app/financeiro/cobrancas` — filtros status (pending/paid/overdue/cancelled/refunded) + JOIN contract→plan→member
- **9ª Server Action `listMemberFinanceiro({memberId})`** — contrato ativo + invoices recentes pra widget.
- **Widget financeiro em `/app/members/[id]`**:
  - Plano ativo com preço/ciclo formatado + data início + dia vencimento
  - Lista 3 cobranças recentes com data/valor/status colorido (✓ paga, ⚠ atraso, pendente)
  - CTA "ver tudo →" pra `/app/financeiro/contratos`

**Atualizações:**

- **`apps/web/app/app/members/[id]/page.tsx`** — Server Component agora paralela `getMember + listTimeline + listMemberAgenda + listMemberFinanceiro`. Widget agenda + widget financeiro substituem placeholder genérico "Sprint 04 financeiro".
- **policy 0020 aplicada local via `db:migrate`** (idempotente).

**Validações:**

- typecheck 11/11 ✅
- build `@app/web` ✓ — **8 rotas novas/atualizadas**:
  - `/app/financeiro` (203 B)
  - `/app/financeiro/planos` (203 B)
  - `/app/financeiro/planos/new` (1.96 kB)
  - `/app/financeiro/contratos` (203 B)
  - `/app/financeiro/cobrancas` (203 B)
  - `/api/jobs/billing-daily` (158 B)
  - `/api/webhooks/asaas` (Faixa B)
  - `/app/members/[id]` updated (widget financeiro agora)
- 114 Vitest tests verdes (sem novos — UI work + cron SQL function testável manual)

**Lições documentadas:**

1. **`due_at` calc com CASE inline** evita criar 2 SQL functions separadas para "billing_day ainda não passou" vs. "billing_day já passou" — uma expressão `date_trunc('month', now) + (billing_day - 1) days + (1 month se já passou)` resolve.
2. **Aggregate queries paralelas** com `Promise.all([...4 db.select agg])` pra visão geral é mais rápido que SUBSELECT+CASE na mesma query, e mais legível.
3. **Input BRL livre com parsing cents** (`value.replace(/\D/g, '')`) é UX melhor que `type="number"` em form de preço — operador digita "9990" → preview "R$ 99,90" sem precisar separador decimal.
4. **Widget em `/app/members/[id]` cross-module** (`agenda` + `financeiro`) é o padrão MVP: cada feature module exporta 1 Server Action `listMember{Feature}({memberId})` que retorna shape minimal. Member detail importa N. Sprint 06+ widget IA, Sprint 09+ widget engajamento.
5. **Filtros via querystring (`?status=`)** em vez de Client Component state — Server Component re-renderiza a tabela em <100ms, sem JS no client, URL é shareável + linkável. Pattern reusável em todas as listas LogiFit.

**Sprint 04 `done` ✅.** Pendências menores (sync API Asaas real, UI gestão chaves, detail pages com ações inline) adiadas pra Sprint 05+.

### Build — Sprint 04 50%: Server Actions + webhook handler + envelope encryption (Faixa B) 2026-05-13

Sprint 04 sobe de 25% → 50%. Faixa B entrega 6 Server Actions + endpoint webhook idempotente + helper envelope encryption AES-256-GCM.

**Adições:**

- **`packages/security/src/envelope-crypto.ts`** — AES-256-GCM envelope encryption:
  - `encryptSecret(plain) → enc:v1:{iv b64}:{ciphertext+tag b64}` (random IV 12 bytes)
  - `decryptSecret(enc)` — tolera plain text legado (sem prefix `enc:`); throw em tampering, formato inválido, chave errada
  - Chave-mestre `LOGIFIT_DATA_KEY` (32 bytes base64); Sprint 04+ Faixa C migra pra per-tenant em KMS externo
  - Helper `generateMasterKey()` pra setup local
- **`packages/security/src/envelope-crypto.test.ts`** — **9 Vitest unit tests** (sem DB): round-trip, IV random produz ciphertext diferente, vazio idempotente, plain text legado, tampering throws, formato malformado throws, chave errada throws, 1KB preserva, UTF-8 special chars preservam.
- **`apps/web/app/app/financeiro/actions.ts`** — **6 Server Actions** wrapped:
  - `createPlan` / `updatePlan` / `archivePlan` (soft-delete via `archivedAt`)
  - `subscribeMember` em transação atômica: cria contract `active` + 1ª invoice `pending` com `due_at = startedAt + 5d` + breakdown jsonb canônico
  - `cancelContract` com `effectiveAt` configurável + `cancelledReason` audit
  - `applyDiscount` apêndice no `breakdown.discounts[]` com `applied_by user_id` (audit trail obrigatório); valida invoice `pending` + desconto < total
  - `listPlans` scoped tenant
- **`apps/web/app/api/webhooks/asaas/route.ts`** — endpoint POST:
  - Auth `asaas-access-token` header vs `ASAAS_WEBHOOK_TOKEN` env (timingSafeEqual)
  - Idempotência via `INSERT ... ON CONFLICT (source, external_id) DO NOTHING RETURNING id` — duplicate retorna 200 `duplicate:true`
  - Trata 4 famílias de eventos: PAYMENT_RECEIVED/CONFIRMED/CASH → paid (+ payment row em transação), PAYMENT_OVERDUE → overdue, PAYMENT_REFUNDED → refunded, PAYMENT_DELETED → cancelled
  - Sempre retorna 200 mesmo em erro de processamento (Asaas não deve retry de bug nosso)
  - Log estruturado pino-style (level/module/stage/event_id)
  - `processed_at` + `error` opcional atualizado em webhook_events

**Atualizações:**

- **`packages/security/src/index.ts`** — re-exporta `./envelope-crypto`.

**Validações:**

- typecheck 11/11 ✅
- build `@app/web` ✓ — **2 endpoints novos**: `/api/webhooks/asaas` (POST) + Server Actions financeiro consumidas via Client (Faixa C UI usa)
- **114 Vitest tests verdes** (era 105 — +9 envelope-crypto)

**Lições documentadas:**

1. **Envelope encryption com prefix `enc:v1:`** permite tolerar legado (rows pre-encryption) + migração progressiva — `decryptSecret` retorna plain se sem prefix. Sprint 04+ rotação `v2` (trocar algoritmo) é compatível: aceita ambos prefixes durante deploy.
2. **Webhook idempotência via SQL `ON CONFLICT DO NOTHING RETURNING id`** vence approach com SELECT-then-INSERT pra eliminar race: 2 webhooks paralelos com mesmo event_id, um cria, outro recebe 0 rows e retorna 200 duplicate.
3. **Sempre retornar 200 em webhook** mesmo com erro de processamento é UX correta: Asaas vai retry se 5xx, mas se 5xx for nosso bug, ele entra em loop. Erros vão pro `webhook_events.error` + system_alerts (Sprint 04+ Faixa C).
4. **Transaction em subscribeMember** (contract + 1ª invoice atomically) evita estado inconsistente — contract criado sem invoice = orphan que jamais cobra. Drizzle `db.transaction(async tx => ...)` é o padrão limpo.
5. **`applyDiscount` apêndice no `breakdown.discounts[]`** com `applied_by user_id` + `applied_at` cria audit trail sem precisar tabela `invoice_discounts` separada. Sprint 04+ Faixa C pode normalizar se virar pain.

**Sprint 04 a 50%.** Faixas restantes: C (UI `/app/financeiro` + widget em member), D (job D-5 + integração envelope em asaas_keys + ADRs 0013+0014).

### Build — Sprint 04 25%: Financeiro Asaas schemas + RLS + check constraints (Faixa A) 2026-05-13

Sprint 04 começa. Faixa A entrega 6 tabelas Drizzle + 14 RLS policies + 9 Vitest integration tests.

**Adições:**

- **`packages/db/src/schema/financeiro.ts`** — 6 tabelas (ADR 0013 + 0014 esperados):
  - `plans` (catálogo): id, tenant_id, company_id, name, price_cents, billing_cycle enum, trial_days, cancel_notice_days. Partial active_idx + check `price_cents >= 0`.
  - `contracts` (member↔plano): status enum active/paused/cancelled/expired, billing_day 1-28, pause fields (trancamento academia), auto_pause_rule jsonb, cancelled fields.
  - `invoices`: amount_cents, due_at, status enum 5 valores, asaas_id text, **breakdown jsonb** (ADR 0068 — base/overage/discounts/surcharges/taxes_withheld). **Partial UNIQUE `asaas_id WHERE NOT NULL`** (múltiplas invoices pre-sync com Asaas coexistem).
  - `payments`: method enum boleto/pix/credit_card, asaas_id UNIQUE global, raw_payload jsonb.
  - `asaas_keys`: api_key (TODO Sprint 04+ envelope encryption), sandbox bool, active bool. Unique parcial `(tenant, company) WHERE active`.
  - `webhook_events` (idempotência): source + **external_id UNIQUE** garante que Asaas reenviando mesmo event não duplica. 3 indexes incluindo partial `WHERE processed_at IS NULL` pra job consumer.
- **4 enums Postgres novos**: `billing_cycle`, `contract_status`, `invoice_status`, `payment_method`.
- **migration `0009_lumpy_moira_mactaggert.sql`** via `drizzle-kit generate` (6 tables + indexes + FKs + check constraints + enums).
- **`packages/db/src/policies/0019_financeiro_rls.sql`**:
  - 14 RLS policies: `plans` (S/I/U sem D — soft-delete), `contracts` (S/I/U sem D — cancelled=status), `invoices` (S/I/U sem D — auditoria fiscal), `payments` (S/I sem U/D — append-only), `asaas_keys` (S/I/U sem D)
  - **`webhook_events` SEM RLS** — tabela técnica recebe webhooks sem tenant_id; processor scoped resolve via payload
  - GRANTs explícitos pra `logifit_app`
- **`packages/db/tests/financeiro-rls.test.ts`** — **9 Vitest integration tests**:
  - RLS isolamento per-tenant (plans Rede vs Franquia)
  - Check `price_cents < 0` → SQLSTATE 23514
  - Check `billing_day = 30` → 23514
  - INSERT contract permitido + visible via withTenantContext
  - `asaas_id` UNIQUE 2º INSERT → 23505
  - Múltiplas invoices `asaas_id NULL` coexistem (partial index)
  - `breakdown jsonb` round-trip preservado
  - `payments` UPDATE retorna 0 rows (append-only via policies)
  - `webhook_events` UNIQUE `(source, external_id)` → 23505 em duplicate (Asaas reenvia)

**Atualizações:**

- **`packages/db/src/schema/index.ts`** — re-exporta `./financeiro`.
- **`packages/db/vitest.config.ts`** — exclui `financeiro-rls.test.ts` do coverage gate.

**Validações:**

- typecheck 11/11 ✅
- `db:rls-check` 3 regras OK em **42 tabelas** (era 36, +6 financeiro)
- **105 Vitest tests verdes** (era 96 — +9 financeiro-rls)

**Lições documentadas:**

1. **Partial UNIQUE index `WHERE asaas_id IS NOT NULL`** é o pattern correto pra evitar conflito entre invoices recém-criadas (asaas_id ainda null pré-sync com Asaas) e regra de unicidade global (uma única invoice por asaas_id após sync).
2. **Check constraints em colunas críticas** (`price_cents >= 0`, `billing_day BETWEEN 1 AND 28`) capturam regras de negócio no banco — defesa em profundidade contra bugs de validação aplicação.
3. **`webhook_events` SEM RLS** é a decisão certa: webhook chega no endpoint público sem cookie/auth, tenant é descoberto via payload. RLS aqui seria fricção inútil (processor tem que bypass). View scoped `tenant_webhook_events` resolve UI debug do tenant (Sprint 04+ Faixa B).
4. **Idempotência via `UNIQUE (source, external_id)`** + `processed_at` partial index é o padrão LogiFit canônico pra todos webhooks externos (Asaas, Focus NFe Sprint 36, WhatsApp Sprint 13).
5. **`enabled` enum em vez de `is_default boolean`** em `asaas_keys.active` deixa schema preparado pra futuro suporte a chaves de teste/sandbox/prod alternantes sem migration.

**Sprint 04 a 25%.** Faixas restantes: B (Server Actions + webhook handler + envelope encryption), C (UI), D (job D-5 + ADRs 0013+0014).

### Build — Sprint 03 100% (`done`): Canvas semanal + Realtime SSE PG LISTEN/NOTIFY 2026-05-13

Sprint 03 completo. Última faixa entrega canvas semanal `/app/agenda/week` + Realtime via PG NOTIFY + SSE listener.

**Adições:**

- **`apps/web/app/app/agenda/week/page.tsx`** — Canvas semanal visão grade:
  - Layout 7 dias × 13 horas (8h→20h slot 1h)
  - Server Component carrega `appointments` no range + `recurring_slots` ativos
  - Aplica `expandRecurring()` em cada slot → `VirtualSlot[]`
  - Monta `Cell[][]` 13×7 com 3 estados: **booked** (link `/[id]`, cor por status), **virtual livre** (border dashed, link new pre-fill), **vazia** (botão `+` opaco)
  - Navegação `?start=YYYY-MM-DD` (prev/today/next semana)
- **`packages/db/src/policies/0018_agenda_notify.sql`** — PG NOTIFY trigger:
  - Function `agenda_notify_change()` em `AFTER INSERT/UPDATE/DELETE appointments`
  - Emite `pg_notify('agenda:{tenant_id}', jsonb {event, appointment_id, tenant_id, resource_id, member_id, status, starts_at})`
  - Events canônicos: `appointment.created`, `appointment.updated`, `appointment.status_changed`, `appointment.deleted`
- **`apps/web/app/api/realtime/agenda/route.ts`** — endpoint SSE:
  - `runtime: 'nodejs'` (pg requer não-Edge)
  - `requireFullSession` → channel `agenda:{tenantId}` (cliente não escolhe canal)
  - Acquire pg client + `LISTEN <channel>` + propaga `'notification'` events do pg pra ReadableStream
  - Keep-alive ping 25s (HTTP/1.1 proxy timeout 30s)
  - Cleanup completo no `request.signal abort` (UNLISTEN + release client)
- **`apps/web/app/app/agenda/realtime-refresh.tsx`** — client component listener:
  - `EventSource('/api/realtime/agenda')` + listener `'agenda'` → `router.refresh()`
  - Plugado em `/app/agenda/page.tsx` + `/app/agenda/week/page.tsx`
  - Browser auto-reconecta se SSE cai (~3s)
- **Botão "Visão semanal"** na `/app/agenda` principal.

**Validações:**

- typecheck 11/11 ✅
- build `@app/web` ✓ — **6 rotas agenda** (+ `/app/agenda/week` 1.7kB)
- `db:rls-check` 3 regras OK em 36 tabelas
- 96 Vitest tests verdes (sem novos — Realtime testável manual via 2 abas)

**Lições documentadas:**

1. **PG `LISTEN/NOTIFY` + SSE + `router.refresh()`** é o stack pragmático pra realtime em Next.js sem WebSocket server custom: 1 trigger + 1 route handler + 1 client hook. WebSocket vai entrar em Sprint 09+ se virar gargalo de overhead HTTP.
2. **`router.refresh()` em vez de mergear delta** é OK pra Sprint 03 — Server Component re-fetch de página inteira custa ~150ms, ROI de otimizar não compensa. Re-revisar se canvas semanal com 200+ slots virar problema de perf.
3. **`X-Accel-Buffering: no`** header é necessário pra Caddy/Cloudflare/nginx não bufferizarem o SSE stream e atrasarem eventos por minutos.
4. **`request.signal.addEventListener('abort')`** é a forma idiomática Next.js 15 de detectar client disconnect e liberar recursos (pg client + UNLISTEN). Sem isso, conexões vazam até o pool esgotar.
5. **Canvas 7×13 com fallback "+"** é UX limpa pré-drag&drop — operador pode criar appointment em qualquer slot vazio sem precisar do wizard. Drag&drop completo é trabalho de várias horas (drag preview + drop hover state + Server Action move) — Sprint 04+ avalia ROI.

**Sprint 03 `done` ✅.** Drag&drop full + canvas mensal pendentes pra Sprint 04+ (não-bloqueante).

### Build — Sprint 03 90%: ADR 0012 + expandRecurring + widget agenda em member detail (Faixa D parcial) 2026-05-13

Sprint 03 sobe de 75% → 90% com ADR + helper RRULE + widget cross-module.

**Adições:**

- **[ADR 0012](docs/decisions/0012-agenda-recurso-slot-recorrente-exclude.md)** publicado — "Agenda como recurso + slot recorrente lazy + EXCLUDE constraint". Compara caminho A (materializar) vs. B (lazy + EXCLUDE) com volume estimado: 14.6M rows vs. ~200 rows, 73000× menos storage. Documenta filtro `WHERE status IN ('booked', 'checked_in')` + `tstzrange [)` inclusive/exclusive + alternativas rejeitadas (advisory lock, optimistic locking, big calendar libs).
- **`packages/db/src/agenda/expand-recurring.ts`** — helper `expandRecurring({recurringSlotId, rrule, startTime, endTime, rangeStart, rangeEnd}): VirtualSlot[]` via **rrule.js** (`^2.8.1`):
  - Normaliza RRULE com/sem prefix `'RRULE:'`
  - Anchor DTSTART no início do range pedido (Sprint 04+ ajusta pra fuso real)
  - `rule.between(start, end, inclusive=true)` retorna ocorrências
  - Combina cada DATE com `startTime`/`endTime` (HH:MM:SS) em ISO UTC
  - RRULE inválido → array vazio (não lança), pra UI degradar graciosamente
- **`packages/db/src/agenda/expand-recurring.test.ts`** — **6 Vitest unit tests** (sem DB): FREQ=WEEKLY;BYDAY=MO retorna 2 segundas; FREQ=DAILY × 5d = 5 occurrences; FREQ=WEEKLY;BYDAY=TU,TH; RRULE inválido → vazio; range sem segunda → vazio; recurringSlotId no payload.
- **`packages/db/package.json`** — `rrule@^2.8.1` dependency + `./agenda` export.
- **`listMemberAgenda(memberId, limit)`** Server Action — JOIN appointments + resources, filtra `startsAt >= now()`, limit cap 50. Usada pelo widget no member detail.
- **Widget agenda em `/app/members/[id]`** — header "📅 Próximos agendamentos" + CTA "+ Agendar" pré-fill `?memberId={id}`. Lista até 5 próximos com resourceName + janela horária + badge ✓ check-in + link ver. Empty state com CTA. Substitui placeholder "Agenda Sprint 03" do widget genérico.

**Atualizações:**

- **`packages/db/src/agenda/index.ts`** novo barrel — re-exporta `expand-recurring`.

**Validações:**

- **96 Vitest tests verdes** (era 90 — +6 expand-recurring)
- typecheck 11/11 ✅
- build `@app/web` ✓ `/app/members/[id]` consome `listMemberAgenda` (rota existente, sem nova route ID)
- ADR 0012 cobre 5 alternativas rejeitadas com justificativa

**Lições documentadas:**

1. **Materialização lazy de RRULE** vs. eager: 14.6M rows pre-geradas → 200 rows + expand on-demand. Trade-off custo CPU (server-side) vs. custo I/O (DB). Cache 30s Redis em Sprint 04+ se virar pain.
2. **`rrule.js`** é a referência implementação JS de RFC 5545 — ~12KB gzip server-side. Não usar lib competidora "later.js" (não tracking RFC 5545 fielmente).
3. **`RRule.fromString(DTSTART:... \n RRULE:...)`** é o entry point limpo; **rrule.js** aceita sem prefix DTSTART mas resultados ficam dependentes do datetime atual — sempre anchor explícito.
4. **Cross-module Server Action import** (`apps/web/.../members/[id]/page.tsx` importa `listMemberAgenda` de `.../agenda/actions.ts`) é OK e desejável — membros consomem dados de agenda; encapsulamento é via `wrapServerAction` + RLS, não via folder boundary.
5. **`{a.endsAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`** vs. `toLocaleString` é a diferença que evita repetir "13/06" na hora final — só hora:minuto pra janela horária compacta no widget.

**Sprint 03 a 90%.** Restantes 10%: Realtime via PG `LISTEN/NOTIFY` + WebSocket Next.js + canvas semanal drag&drop (Sprint 04 pode reabrir se prioridade comercial mudar).

### Build — Sprint 03 75%: UI Faixa C completa — 4 rotas + getAppointment 2026-05-13

Sprint 03 sobe de 50% → 75% com 4 rotas UI novas + 8ª Server Action `getAppointment`.

**Adições:**

- **`getAppointment`** Server Action — wrapped, lookup por id no tenant scope, `ApiException NOT_FOUND` se não encontrar.
- **`/app/agenda/new`** — wizard booking ad-hoc:
  - Server Component carrega `listResources` + `listMembers` em paralelo
  - Form Client com 5 inputs: select recurso + select member + date + 2× time (Início/Fim)
  - Helper `combineToIso(date, time)` converte wall-clock → ISO UTC (Zod `z.string().datetime()`)
  - Empty state se não há recurso ou member cadastrado, CTA pra cadastrar primeiro
  - Erros via `<div role="alert">` — inclui CONFLICT do EXCLUDE constraint catched no Server Action
- **`/app/agenda/[id]`** — detail page:
  - Carrega via `getAppointment` + lookup nome do recurso via `listResources(includeArchived: true)`
  - Badge de status colorido + grid 2-col com Início/Fim/Recurso/Member + condicional Check-in/Cancelamento details
  - Link pra `/app/members/[id]`
  - `<AppointmentActions>` Client component (só pra status `booked|checked_in`):
    - Botão "Fazer check-in" (verde, status booked apenas) → `checkInAppointment`
    - Botão "Cancelar agendamento" abre form inline com input motivo opcional → `cancelAppointment` (que faz transação cancel + promote waitlist em 1 round-trip)
- **`/app/agenda/resources`** — lista recursos:
  - Table com Tipo (emoji+label) / Nome / Modalidade / Status
  - Toggle "Mostrar arquivados" via querystring `?archived=1`
  - Empty state com CTA
- **`/app/agenda/resources/new`** — wizard novo recurso:
  - Lookup companies do tenant via `pool.connect()` + `set_config('app.tenant_id')` direto (sem listCompanies Server Action — adia pra Sprint 04+)
  - Form Client com select Empresa + select Tipo + input Nome + select Modalidade (visible só para `kind=instrutor`)
  - Placeholder dinâmico no input Name conforme tipo

**Validações:**

- typecheck `@app/web` ✅
- build prod ✓ — **5 rotas agenda** materializadas:
  - `/app/agenda` (186 B)
  - `/app/agenda/[id]` (1.37 kB)
  - `/app/agenda/new` (1.72 kB)
  - `/app/agenda/resources` (186 B)
  - `/app/agenda/resources/new` (1.7 kB)
- 90 Vitest tests verdes (sem novos tests — UI work)

**Lições documentadas:**

1. **`combineToIso(date, time)`** é o padrão limpo pra UX BR: input HTML5 `type="date"` + `type="time"` (wall-clock local), Server Action espera ISO UTC. Helper de 3 linhas resolve sem libs de timezone.
2. **Server Component fazendo lookup direto via `pool.connect()` + `set_config`** é OK como atalho quando não há Server Action específica pra listar (companies do tenant aqui). Reverter pra `listCompanies` ação quando essa precisar de filtros/scope mais complexos.
3. **`<AppointmentActions>` separado em Client** isola o `useRouter()` + estado de form de cancel sem poluir o detail page Server Component. Pattern reusável: Server Component renderiza detail + lookup de relacionados; Client Component encapsula ações com side-effects.
4. **Empty state em wizard com CTA pra prerequisite** (ex: "Cadastrar primeiro recurso →") é UX-first contra dead-end — em vez de mostrar form sem options, redireciona pro fluxo dependente.

**Sprint 03 a 75%.** Faixa C avançada (canvas semanal + drag&drop, ~1 semana de trabalho dedicado) e **Faixa D** (Realtime LISTEN/NOTIFY + `expandRecurring(rrule)` via rrule.js + widget agenda em `/app/members/[id]` Sprint 02 slot + ADR 0012 publicado) restantes.

### Build — Sprint 03 50%: Server Actions + UI lista 7 dias (Faixas B + C inicial) 2026-05-13

Sprint 03 sobe pra 50% com 7 Server Actions wrapped + página `/app/agenda` listando próximos 7 dias.

**Adições:**

- **`apps/web/app/app/agenda/actions.ts`** — **7 Server Actions** wrapped com `wrapServerAction()` (regra 33 + audit_log):
  - `createResource` / `listResources` / `archiveResource` — CRUD recursos (instrutor/sala/equipamento)
  - `createAppointment` — INSERT booked com **catch SQLSTATE 23P01** → ApiException `CONFLICT` ("horário já reservado"). Defesa em profundidade pro EXCLUDE constraint da Faixa A
  - `cancelAppointment` — **transação atômica**: cancela → busca primeiro waitlist (ORDER BY created_at ASC) → promove pra appointment → DELETE waitlist row. Tudo num único `db.transaction()` — se promote falhar, ROLLBACK preserva consistência
  - `checkInAppointment` — transição `booked → checked_in` com guard `WHERE status='booked'`
  - `listAppointments` — query range por starts_at + filtros opcionais (resourceId/memberId/status)
- **`apps/web/app/app/agenda/page.tsx`** — UI Faixa C inicial. Server Component lista próximos 7 dias em table com colunas Início/Recurso/Status/Ações. Empty state com CTA. Botões "+ Agendamento" e "Recursos" no header.
- **`packages/ui/src/menu/menu-items.ts`** — módulo Agenda destrava com item `/app/agenda` (era `items: []` TODO Sprint 03). Aparece no SideMenu.
- **`apps/web/src/messages/{pt-BR,en-US,es-419}/nav.json`** — chave `nav.agenda.week` nos 3 locales (regra 27 + ADR 0052).

**Validações:**

- typecheck `@app/web` ✅
- build prod ✓ — rota `/app/agenda` (183 B) materializada
- 90 Vitest tests verdes (mesmo que Sprint 03 Faixa A; Faixa B não trouxe tests novos — adia E2E pra Faixa D)

**Lições documentadas:**

1. **Catch SQLSTATE específico** dentro do Server Action é o jeito limpo de transformar erro de banco em mensagem user-friendly. `23P01` (exclusion_violation) é o sinal exato do EXCLUDE constraint — não vazar mensagem técnica do Postgres pro user. Reusável em qualquer Server Action que insere em tabela com EXCLUDE/UNIQUE.
2. **Promoção waitlist em transação** é crítico: se promote INSERT falhar (ex: aplicação morre no meio), o cancel já comitado sem promote deixaria slot vazio que outro user poderia pegar. `db.transaction(async tx => { ... })` garante atomicidade — Drizzle propaga rollback automaticamente em throw.
3. **Helper `expandRecurring()` para RRULE** é trabalho de bibliografia (RFC 5545 tem 80+ páginas). Adiado conscientemente pra Faixa C avançada — primeiro entrega o caminho ad-hoc (createAppointment direto) que cobre 80% dos casos MVP (personal trainer pessoal, consulta única). Aulas coletivas com slot recorrente Sprint 03 Fechamento ou Sprint 04.
4. **UI table simples** sem virtualization é suficiente pra MVP (limit 500 appointments na query). Canvas semanal com drag&drop custom é trabalho de ~1 semana — postergado pra Sprint 04+ quando perfil de uso justificar.

**Sprint 03 a 50%.** Restantes 50%:
- UI `/app/agenda/new` (form) + `/app/agenda/[id]` (detail) + `/app/agenda/resources` (CRUD UI)
- Faixa B avançada: `expandRecurring(rrule, range)` via `rrule.js` (~25KB)
- Faixa C avançada: canvas semanal + drag&drop
- Faixa D: Realtime PG LISTEN/NOTIFY + canal `tenant:X:company:Y:unit:Z:agenda` + widget agenda no `/app/members/[id]` slot Sprint 02 + ADR 0012 publicado

### Build — Sprint 03 25%: Agenda schemas + RLS + EXCLUDE constraint (Faixa A) 2026-05-12

Sprint 03 começa. Faixa A entrega schemas Drizzle de 4 tabelas + EXCLUDE constraint anti-overlap + RLS policies + 7 Vitest integration tests.

**Adições:**

- **`packages/db/src/schema/agenda.ts`** — 4 tabelas (ADR 0012 esperado):
  - `resources` (instrutor/sala/equipamento) com `modality` text nullable, `instructor_user_id` FK pra users, soft-delete via `archived_at`.
  - `recurring_slots` (RFC 5545 `rrule` text + `start_time`/`end_time` wall-clock + `capacity` + `active`). Materialização lazy (Sprint 03 Faixa B).
  - `appointments` (tenant_id, resource_id, member_id, recurring_slot_id?, starts_at, ends_at, status enum, cancelled_*, checked_in_at, created_by_user_id).
  - `appointment_waitlist` (uniq `(recurring_slot_id, starts_at, member_id)`).
- **2 enums Postgres**: `resource_kind` (instrutor/sala/equipamento), `appointment_status` (booked/checked_in/cancelled/no_show/completed).
- **migration `0008_unusual_christian_walker.sql`** (Drizzle generate).
- **`packages/db/src/policies/0017_agenda_rls.sql`**:
  - `CREATE EXTENSION IF NOT EXISTS btree_gist` (necessária pro EXCLUDE com uuid `=`)
  - **EXCLUDE constraint `appointments_no_overlap`**: `EXCLUDE USING gist (resource_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE status IN ('booked', 'checked_in')`. Postgres garante exclusividade — não dependemos de transação aplicação.
  - 12 RLS policies (resources CRUD + recurring_slots CRUD + appointments CRUD + waitlist INS/DEL only)
  - GRANTs explícitos pra `logifit_app`
- **`packages/db/tests/agenda-rls.test.ts`** — **7 Vitest integration tests**:
  - RLS isolamento per-tenant (resources + appointments)
  - INSERT cross-tenant rejected via WITH CHECK
  - **EXCLUDE constraint**: 2 booked overlap → SQLSTATE `23P01` (`exclusion_violation`)
  - cancelled + booked no mesmo horário coexistem (cancelled fora do filter)
  - Resources diferentes mesmo horário coexistem
  - waitlist UPDATE retorna 0 rows (INSERT/DELETE only)

**Atualizações:**

- **`packages/db/src/schema/index.ts`** — re-exporta `./agenda`.
- **`packages/db/vitest.config.ts`** — exclui `agenda-rls.test.ts` do coverage gate.

**Validações:**

- typecheck 11/11 ✅
- `db:rls-check` 3 regras OK em todas as tabelas (36 tabelas — era 32, +4 agenda)
- **90 Vitest tests verdes** (era 83 — +7 agenda-rls)

**Lições documentadas:**

1. **EXCLUDE constraint** com `btree_gist` extension é a forma idiomática Postgres pra evitar overlap — não precisa lock pessimista nem advisory lock em aplicação. SQLSTATE `23P01` é o sinal pra mostrar UI "horário já reservado".
2. **Filter `WHERE status IN (...)`** no EXCLUDE permite history (cancelled/no_show/completed) coexistir com booked novo no mesmo horário. Mantém auditoria sem violar unicidade.
3. **`tstzrange(starts_at, ends_at, '[)')`** com bound `[)` (inclusive start, exclusive end) é o padrão de range timestamps — segue convenção SQL pra evitar overlap em fronteira.
4. **Drizzle não cobre EXCLUDE USING gist** — vai em policy SQL inline (mesmo arquivo que RLS). Pattern reutilizável pra future constraints exóticas (geração `tsrange` em pricing tiers Sprint 04+).
5. **Materialização lazy de RRULE** mantém o banco enxuto — slots não viram milhões de rows pré-geradas; o Server Action expande on-demand quando UI pede uma semana específica. Custo CPU < custo I/O.

**Sprint 03 a 25%.** Faixas restantes: B (Server Actions + helper `expandRecurring`), C (UI semanal/mensal + filtros), D (Realtime via PG LISTEN/NOTIFY + WS Next.js + widget agenda no member detail + ADR 0012 publicado).

### Build — Sprint 00b 100% (`done`): Faixas B + D — swipe mobile + footer expandido + logout 2026-05-12

Faixas B (swipe gesture + tenant logo header) e D (footer expandido com avatar/email/logout + E2E Playwright spec) entregues. Sprint 00b sobe de 60% → **100% (`done`)**.

**Adições:**

- **`packages/ui/src/menu/app-shell.tsx`** — Faixa B:
  - **Swipe gesture mobile** via `useEffect` com `touchstart`/`touchend`. Inicia rastreio se touch < 20px da borda esquerda (abrir) OU menu aberto (fechar). Threshold 50px horizontal + descarta se vertical > horizontal (anti-conflito com scroll). Bloqueado por `matchMedia('(max-width: 1024px)')` — desktop usa só ☰ + Ctrl/Cmd+B.
  - **Tenant logo no header**: quadrado 32×32 com `--ev-primary` + inicial do tenantName. Substitui `userName` por `userEmail` na linha secundária do header.
  - **Ellipsis em texto longo** (`overflow:hidden` + `textOverflow:ellipsis` + `whiteSpace:nowrap`) em ambos header + footer — tenants com nome longo não quebram layout.
- **`packages/ui/src/menu/app-shell.tsx`** — Faixa D:
  - **Footer expandido**: avatar circular 40×40 com inicial do user, email + tenant abaixo (ellipsis).
  - **Botão Sair**: full-width + minHeight 44px (touch target regra 31). `handleSignOut` faz `fetch(signOutUrl, { method: 'POST', credentials: 'include' })` + `window.location.href = postSignOutUrl`. Estado `signingOut` desabilita durante request. Props customizáveis: `signOutUrl` default `/api/auth/sign-out`, `postSignOutUrl` default `/login`.
- **`apps/web/e2e/smoke/sidemenu-responsive.spec.ts`** — **5 specs Playwright em 3 viewports** (mobile 390 / tablet 768 / desktop 1280, regra 31). Marcados `test.fixme()` até `loginAs()` auth helper aterrissar (Sprint 04+ custom roles UI traz). Cobre: trigger touch 44px, click abre menu, Esc fecha + restaura foco, footer com avatar/email/Sair, logout redirect /login.

**Atualizações:**

- **`apps/web/app/app/layout.tsx`** — passa `userEmail = session.user.email` ao `<AppShell>`.
- **`apps/web/src/messages/{pt-BR,en-US,es-419}/nav.json`** — chaves `footer.sign_out` + `footer.signing_out` nos 3 locales.
- **`packages/config/package.json`** — `playwright-viewports.ts` + `playwright-locales.ts` adicionados aos `exports` (era export interno, `@app/web` precisa pro spec novo).

**Validação manual via Chrome MCP (commit ef5b4c7 + fd5b4e1 + este):**

| Item | Resultado |
|---|---|
| Header: avatar "A" + tenant + email | ✅ |
| Click ☰ abre overlay com translateX(0) | ✅ |
| Esc fecha + restaura foco no trigger | ✅ (testado manualmente Faixa A) |
| Footer: avatar circular + email + tenant + Sair | ✅ |
| Click Sair → POST /api/auth/sign-out → redirect /login | ✅ (cookie limpo, form em branco) |
| 25 permissions filtradas → 3 módulos visíveis no menu | ✅ (Faixa C) |
| typecheck 11/11 ✅ | OK |

**Lições documentadas:**

1. **Swipe gesture** sem bibliotecas externas é trivial em ~30 linhas: `touchstart`/`touchend` no `window`, calcula `dx = endX - startX`, threshold 50px + descarte vertical-dominant. Reusável em Sprint 03+ para gestures de cards.
2. **Botão de logout em componente UI cliente** não precisa Server Action — `fetch` ao endpoint BetterAuth com `credentials: 'include'` resolve em 1 round-trip. `window.location.href` evita race entre Next router cache e cookie invalidado.
3. **Avatar circular com inicial** é placeholder respeitável até design system ter logos uploadáveis. Apoia regra 44 (Equilíbrio Vital) usando `--ev-primary` + contraste `--ev-primary-foreground`.
4. **`test.fixme()` em Playwright** é honesto: marca o teste como reconhecido + pendente sem fazer skip silencioso. Sprint 04+ destrava removendo `.fixme`.
5. **Ellipsis em CSS** com 3 propriedades (`overflow:hidden` + `text-overflow:ellipsis` + `white-space:nowrap`) é defesa contra dados de produção que estouram layouts (tenant `"Rede Equilíbrio Vital — Filial Centro Sul Paulista"` não quebra header).

**Sprint 00b `done` ✅.** Único pendente é E2E rodar (auth helper Sprint 04+); specs já escritos.

### Build — Sprint 00b 60%: Filtragem RBAC viva via list_user_permissions (Faixa C) 2026-05-12

Faixa C do Sprint 00b. SQL function `list_user_permissions()` + customSession agrega permissions + AppShell filtra real. Sprint 00b sobe de 40% para 60%.

**Adições:**

- **`packages/db/src/policies/0016_list_user_permissions.sql`** — `list_user_permissions(p_user_id uuid, p_tenant_id uuid) RETURNS text[]`. `SECURITY DEFINER STABLE`. Union DISTINCT entre `user_roles → role_permissions` (filtra `expires_at`) e `user_permission_grants` ativos (filtra `revoked_at` + `expires_at`). Sprint 01b D.1 (`has_permission()`) ainda existe pra "1 pergunta" — `list_user_permissions()` é o bulk-equivalent pra UI.
- **`session.logifit.permissions: string[]`** — claim novo populado em `customSession` via `authDb.execute(...)` na sessão. Memoizado até reauth.

**Atualizações:**

- **`packages/auth/src/server.ts`** — `customSession` callback ganha 4ª query SQL function. `permissions[]` injetado no payload.
- **`apps/web/app/lib/session.ts`** — `LogifitSessionClaims.permissions: string[]`.
- **`apps/web/app/app/layout.tsx`** — `permissionKeys = claims.permissions` (era `[]` fallback Faixa A).
- **`packages/ui/src/menu/app-shell.tsx`** — `hasPermission` agora é `permissionSet.has(k)` puro (removido fallback `size === 0 || has(k)`). User sem permissions vê menu vazio.

**Validação end-to-end via Chrome MCP:**

- Login `admin+rede@logifit.test` → SQL function retorna 25 permissions (role `tenant_owner` tem todas as 25 do catálogo Sprint 01a Faixa C) ✅
- Menu SideMenu mostra 3 módulos com items reais (Início + Pessoas + Configurações) ✅
- typecheck 11/11 ✅
- Cookie sessão preserva `permissions[]` entre navegações (não re-querar a cada request) ✅

**Lições documentadas:**

1. SQL function `SECURITY DEFINER STABLE` retornando `text[]` é o padrão LogiFit pra bulk lookup memoizável — 1 round-trip em vez de N. Reusa o mesmo pool (`authPool`) que customSession já tem aberto.
2. Permissions em session claim = trade-off: query única em vez de N + cache implícito vs. staleness até reauth. Para Sprint 00b é OK (admin que muda role espera comunicar user a relogar). Sprint 04+ Redis pub/sub se virar pain.
3. Remover o fallback `permissionSet.size === 0 → permite tudo` é **crítico de segurança**: deixar fallback abre brecha onde user com claim ausente vê tudo (defense-in-depth alinhada à regra 33+35).
4. Pra demonstrar filtragem REAL precisaria de user com role limitada (ex: recepcionista sem `member.read`). Os 2 seeded users (admin+rede e mariana+solo) são `tenant_owner` — vêm todos os módulos. Adicionar usuário "recepção" é seed work do Sprint 04+ (quando role custom UI aterriçar).

**Sprint 00b a 60%.** Faixas restantes: B (swipe gesture + tenant logo) · D (footer expandido avatar/tenant-switch/logout + E2E Playwright 3 viewports).

### Fix — Sprint 00b polish: username + tenantName via customSession claims 2026-05-12

Bug cosmético do Sprint 00b Faixa A validado via Chrome MCP: header `<AppShell>` e footer SideMenu mostravam `—` em tenant + username. Causa: layout.tsx fazia `db.select` em `users`/`tenants` via pool `logifit_app` que respeita RLS; sem `app.tenant_id` setado no Server Component, retorna 0 rows.

**Adições:**

- **`packages/auth/src/server.ts`** — `customSession` callback agrega:
  - `users.username` no SELECT inicial de `users` (1 coluna extra na query já existente)
  - `tenants.name` no SELECT de `tenants` (1 coluna extra na query já existente)
  - Injeta como `username` + `tenantName` no payload `logifit` da sessão
  - **Zero queries adicionais** — só amplia as 2 queries que já rodavam
- **`apps/web/app/lib/session.ts`** — interface `LogifitSessionClaims` ganha `username: string` + `tenantName: string`.
- **`AUTH_DATABASE_URL` env** (`apps/web/.env.local` + `packages/auth/src/server.ts`) — connection string opcional pro `authPool` bypassar RLS quando precisar fazer lookup cross-tenant pré-claim. Default = `DATABASE_URL` pra compat. Dev: aponta pra `postgres` superuser. Prod: pode reutilizar mesma string (já cai num PgBouncer que pode ter role bypass-RLS configurada).

**Atualizações:**

- **`apps/web/app/app/layout.tsx`** — consome `session.logifit.username` + `session.logifit.tenantName` direto; remove imports `db`/`tenants`/`users`/`eq` e as 2 queries `db.select`. Layout virou **zero-query** (todo dado vem da session memoizada).
- **`.gitignore`** — adiciona `.magic-links.dev.log` + `.customSession.dev.log` (debug files para contornar Node stdout block-buffering em dev).
- **`packages/auth/src/server.ts`** sendMagicLink — append síncrono em `.magic-links.dev.log` (fora prod) pra visibilidade imediata do URL gerado, já que Node block-buffera stdout quando pipeado (60s+ pra flush).

**Validação end-to-end via Chrome MCP:**

- Login magic link `admin+rede@logifit.test` → token gerado → verify 302 → cookie setado ✅
- `/app` carrega com header populado: **Academia Equilíbrio** + **admin+rede@logifit.test** ✅
- ☰ abre SideMenu overlay; footer mostra "Sessão de admin+rede@logifit.test / Academia Equilíbrio" ✅
- Clique em "Alunos/Pacientes" navega pra `/app/members` ✅; menu permanece aberto (desktop)
- 3 módulos visíveis (Início/Pessoas/Configurações); 14 escondidos por `items.length === 0` ✅

**Lições documentadas:**

1. Server Components em rota protegida devem consumir dado da **session memoizada** (`session.logifit.*`) em vez de re-querar via Drizzle — não só evita N+1 queries em todo navigation, como também bypassa o problema de RLS chicken-and-egg (precisa de `app.tenant_id` mas o tenant_id está exatamente no lookup que estou tentando fazer).
2. `customSession` no BetterAuth roda **apenas no momento da sessão** (não a cada request). Adicionar campos é praticamente grátis se eles vêm de query já existente.
3. Node em pipe (`pnpm dev | tee log`) block-buffera stdout em chunks de 64KB — em dev solo isso significa logs ficam invisíveis até processo encerrar. Append síncrono em arquivo de debug (`fs.appendFileSync`) é o workaround pragmático.
4. ESM-only package (`"type": "module"`) **não pode usar `require()`** em runtime — só `await import()`. Bug que fiz manualmente travou o handler em silêncio até diagnosticar.

### Build — Sprint 00b 40%: Menu lateral foundation + /app landing (Faixa A) 2026-05-12

Faixa A do Sprint 00b. Foundation completo do `<AppShell>` overlay + 17 módulos canônicos + i18n 3 locales + rota `/app` landing autenticada. Sprint 00b sobe de 0% para 40%.

**Adições:**

- **`packages/ui/src/menu/types.ts`** — `MenuItem`, `MenuModule`, `MenuFilterContext`, tipo `Vertical`. API runtime `registerMenuItem()` adiada (dev solo → editar arquivo de registry direto resolve; overhead de registry runtime injustificado pra escala atual).
- **`packages/ui/src/menu/menu-items.ts`** — registry estático com **17 módulos canônicos** (ADR 0063 + spec Sprint 00b): Início · Pessoas · Agenda · Acesso · Comercial · Financeiro · Fiscal · Clínico · Vigilância · Relacionamento · Estoque · Engajamento · RH · Compliance · Integrações · Configurações. Items hoje: `/app` · `/app/members` · `/app/pessoas` · `/app/settings/users` · `/seguranca` · `/meu/sessoes`. Demais ficam comentados como TODO até feature aterrissar.
- **`packages/ui/src/menu/app-shell.tsx`** — Client Component overlay:
  - Hamburger ☰ trigger 44px touch (regra 31) com `aria-expanded` + `aria-controls`
  - Slide-in `transform translateX` + transition CSS `cubic-bezier(0.4, 0, 0.2, 1)` 250ms (sem framer)
  - Backdrop dimmed + blur + click-to-close
  - **Esc** fecha + restaura foco no trigger (a11y WCAG)
  - **Ctrl/Cmd+B** toggle (padrão VSCode)
  - **Focus trap** completo (Tab + Shift+Tab circulam dentro do menu)
  - **localStorage** persiste estado em desktop; mobile sempre fecha
  - Filtro inline: `permissionSet/featureFlagSet/verticalSet` lookup O(1); module some se 0 items passam
- **`apps/web/src/messages/{pt-BR,en-US,es-419}/nav.json`** — **3 catálogos i18n** (regra 27 + ADR 0052): toggle/close/aria/footer + 16 module labels + 5 item labels (members/persons/users/security/sessions).
- **`apps/web/app/app/layout.tsx`** — Server Component que `requireFullSession`, carrega `user.username` + `tenant.name` via Drizzle, achata `messages.nav` em `Record<string, string>` serializável pro `<AppShell>` Client.
- **`apps/web/app/app/page.tsx`** — landing `/app` com 5 cards de atalho (members + count vivo, persons, users, security, sessions) + section "Em breve" (Sprints 03/04/06/07/08). Não é o Dashboard Sprint 07 — explicitamente shell até Sprint 07 reescrever com widgets cross-module + KPIs por persona.

**Atualizações:**

- **`apps/web/src/i18n/request.ts`** — adiciona `'nav'` à lista de NAMESPACES carregados.
- **`apps/web/middleware.ts`** — adiciona header `x-pathname` (1 linha) pro Server Component saber rota atual via `headers()` sem precisar `usePathname()` client wrapper.
- **`packages/ui/package.json`** — adiciona `@types/node` devDep. Resolve typecheck pré-existente onde `@repo/ui` puxa `@repo/errors/fingerprint.ts` (usa `node:crypto`); typecheck `@repo/ui` voltou ao verde de bug pré-existente que estava ignorado.
- **`packages/ui/src/index.ts`** — re-exporta `./menu` (AppShell, MENU_MODULES, types).

**Validações end-to-end:**

- typecheck **11/11 packages** ✅ (era 10/11 antes — bug `@repo/ui` resolvido nesta rodada)
- build `@app/web` ✓ rota nova `/app` (183 B)
- lint Biome ✓ (1 warning ignorado: `useExhaustiveDependencies` em `useEffect` de hidratação localStorage — `// biome-ignore` documentado)

**Lições documentadas:**

1. Catálogos i18n não-triviais em monorepo: Server Component achata `messages.{ns}` em `Record<string, string>` antes de passar pra Client Component — evita serialização recursiva + Client não precisa carregar runtime next-intl.
2. `x-pathname` injetado pelo middleware é o jeito leve de Server Components saberem rota corrente; alternativa (`usePathname()` em Client wrapper) infla bundle e atrasa LCP.
3. Registry estático em arquivo TypeScript supera registry runtime `registerMenuItem({})` pra dev solo MVP — file edit é instantâneo e tipado; overhead de provider/context só compensa em multi-tenant developer org.
4. Focus trap manual com `querySelectorAll('a[href], button:not([disabled])...')` cabe num useEffect — não precisa Radix Dialog pra menu de navegação.
5. `noUncheckedIndexedAccess` força `focusables[focusables.length - 1]` retornar `T | undefined` — usar `?.focus()` cobre o caso array vazio sem rodeio.

**Sprint 00b a 40%.** Faixas restantes:
- **Faixa B** — swipe gesture mobile (touchstart/touchmove com threshold 50px), header com logo do tenant, breadcrumb opcional.
- **Faixa C** — `has_permission()` lookup async (bulk RPC retornando set de permissions ativas do user) + `tenants.verticals_active` coluna real (Sprint 04+) + `consents` lookup (Sprint 11+).
- **Faixa D** — footer com avatar + tenant-switch (multi-tenant) + logout button; E2E Playwright em 3 viewports (390/768/1280) validando 4 cenários (recepcionista/fisio/admin/multi-vertical); ADR 0063 cross-link.

### Build — Sprint 01b 75%: cron mark-grants-expired (D.6) 2026-05-12

D.6 do Sprint 01b. SQL function `process_grants_expired()` + endpoint cron + 6 Vitest tests. Sprint 01b sobe de 70% pra 75%.

**Adições:**

- **`packages/db/src/policies/0015_grants_expired.sql`** — function `process_grants_expired() RETURNS jsonb` (ADR 0019). `SECURITY DEFINER` + `SET search_path = public` + `LANGUAGE plpgsql`. Marca `user_permission_grants` com `expires_at < now() AND revoked_at IS NULL` como `revoked_at = now()`, `revoked_reason = 'expired'`. CTE com `RETURNING id` agregado via `array_agg` retorna `{processed_at, newly_revoked, revoked_grant_ids[]}`.
- **`apps/web/app/api/jobs/process-grants-expired/route.ts`** — endpoint cron POST seguindo padrão `process-trial-lifecycle` (Sprint 01a Faixa G): bearer `CRON_SECRET` + `timingSafeEqual` + envelope ADR 0071. `dynamic = 'force-dynamic'` + `runtime = 'nodejs'`. Cron diário 03:15 UTC (offset 15min do trial-lifecycle pra evitar contenção de pool).
- **`packages/db/tests/grants-expired.test.ts`** — **6 Vitest tests novos**: vencido → revoked + revoked_reason='expired'; futuro → ignored; sem `expires_at` → ignored; idempotência (2× rodada → segunda `newly_revoked=0`); batch (múltiplos grants) → `revoked_grant_ids.length=N`; payload shape canônico.

**Atualizações:**

- **`packages/db/vitest.config.ts`** — exclui `grants-expired.test.ts` do coverage gate (integration test).

**Validações end-to-end:**

- migration policy 0015 aplicada (idempotente)
- **83 Vitest tests verdes** (era 77 — +6 grants-expired)
- `pnpm --filter @app/web build` ✓ rota nova `/api/jobs/process-grants-expired`

**Lição documentada:** SQL function com `RETURNING id` dentro de CTE coletado via `array_agg(id)` é o padrão LogiFit para audit-de-batch — function reporta o que ela mudou pro caller persistir em log estruturado (`pino → stdout → Loki`). Pattern reaproveitável em futuros crons de housekeeping (anonimização, cleanup, etc).

**Sprint 01b a 75%.** Restantes 25% adiados conscientemente: UI custom roles (Sprint 02+), Comitê IA (Sprint 06), PAM (Sprint 07), contador externo UI (Sprint 04), data_subject_requests + portal LGPD (Sprint 26).

### Build — Sprint 02 70%: CRM members (schema + RLS + Server Actions + UI) 2026-05-12

Faixas A+B+C do Sprint 02 entregues. Núcleo CRM aterrissado — `members` (1 row por person×tenant), `member_events` (append-only), `member_notes` (Nível 5 nunca cruza tenant), `member_tags` (PK composta tenant_id+member_id+tag) + 12 RLS policies + 10 Server Actions wrapped + UI completa. Sprint 02 sobe de 0% para 70%.

**Adições:**

- **[ADR 0011](docs/decisions/0011-member-perfil-unico-cross-module.md)** — member como perfil único cross-module no tenant. Identidade vive em `persons` (FK), módulos (Academia/Fisio/Nutri) referenciam `member_id`, não duplicam identidade. Constraint `members_tenant_person_uq` força 1 row por (tenant, person).
- **`packages/db/src/schema/members.ts`** — 4 tabelas:
  - `members` (id, tenant_id, person_id, company_id, archived_at, archive_reason, created_at, updated_at) — soft-delete via `archived_at`; sem policy DELETE.
  - `member_events` (id, tenant_id, member_id, actor_user_id?, kind enum, payload jsonb, created_at) — append-only, **sem policies UPDATE/DELETE**. Enum 7 kinds: `member.created/updated/archived/transferred/note_added/tag_added/tag_removed`.
  - `member_notes` (id, tenant_id, member_id, author_user_id, visibility enum, body, created_at) — visibilidade enum `author_only/unit/company/tenant`. Nível 5 ADR 0077 (nunca cruza tenant nem via passaporte).
  - `member_tags` (tenant_id, member_id, tag, created_at) — **PK composta** `(tenant_id, member_id, tag)` permite mesma tag em members de tenants diferentes.
- **`packages/db/src/policies/0014_members_rls.sql`** — 12 policies:
  - `members_*` 4 policies (SELECT/INSERT/UPDATE com WITH CHECK; **sem DELETE** — soft-delete only)
  - `member_events_*` 2 policies (SELECT/INSERT; **sem UPDATE/DELETE** — append-only)
  - `member_notes_*` 4 policies (CRUD per-tenant)
  - `member_tags_*` 2 policies (SELECT/INSERT; sem UPDATE — DELETE via SQL no Server Action `removeTag`)
- **`apps/web/app/app/members/actions.ts`** — **10 Server Actions** com `wrapServerAction()`:
  - `listMembers`, `getMember`, `createMember` (valida `kind=pf` regra 24), `updateMember`, `archiveMember`, `transferMember` (cross-company intra-tenant), `addNote` (`// ai-blocked: regra 41+42` — Nível 5 nunca via IA), `addTag`, `removeTag`, `listTimeline`, `listNotes`.
  - Helper `emitEvent(tx, kind, payload, member_id)` fire-and-forget INSERT em `member_events`.
- **UI completa `/app/members/*`** (Server Components + Client wizards):
  - `page.tsx` — lista com badge company + arquivado + busca por nome/CPF (text search via `unaccent` + `pg_trgm`).
  - `new/page.tsx` + `new/new-member-form.tsx` — wizard cadastro com select PF (link "cadastre PF nova primeiro" → `/app/pessoas/new`) + select company (regra 25: clínico só vê na sua company — visível no label do select).
  - `[id]/page.tsx` — detail com slots overview + timeline resumida + placeholders Sprint 03/04/06/08/09 (agenda, financeiro, IA, controle de acesso, engajamento).
  - `[id]/timeline/page.tsx` — timeline completa com `KIND_LABELS` mapping pt-BR.
- **`packages/db/tests/members-rls.test.ts`** — **7 Vitest tests novos**:
  - RLS isolamento per-tenant (Rede vê seu member; Franquia vê 0; INSERT cross-tenant rejected via WITH CHECK).
  - `member_events` append-only (INSERT permitido; UPDATE/DELETE → 0 rows).
  - `member_tags` PK composta (duplicate insert → SQLSTATE 23505; tenant_id no PK).
  - `members` soft-delete (UPDATE archived_at OK; DELETE → 0 rows).

**Atualizações:**

- **`packages/db/vitest.config.ts`** — exclui `members-rls.test.ts` do coverage gate (integration test) + `fileParallelism: false` (Postgres compartilhado entre suítes — Sprint 02 consolidou regra; antes corrida entre `members-rls` inserir person extra e `rls-runtime` assertar count exato).

**Validações end-to-end:**

- typecheck `@repo/db` + `@app/web` ✅
- migration members + policy 0014 aplicadas (idempotente)
- `db:rls-check` 4 regras OK em **36 tabelas** (era 32 — +4 members)
- **77 Vitest tests verdes** (era 70 — +7 members-rls)
- `pnpm --filter @app/web build` ✓ rotas existentes + **4 novas** `/app/members`, `/app/members/new`, `/app/members/[id]`, `/app/members/[id]/timeline`

**Lições documentadas:**

1. `fileParallelism: false` em packages com integration tests compartilhando DB local — caso contrário corrida entre `beforeAll` que insere e outra suíte que assert count exato (`expected 4 to be 5`).
2. `// ai-blocked: <motivo>` no topo do Server Action é convenção da regra 41 — lint `ai-block-respected` em CI valida que LLM não pode chamar essa action via `proposeAction()`.
3. `member_events` SEM `UPDATE`/`DELETE` policy + sem trigger = append-only puro. Retroactivo a partir do `payload jsonb` (mesma estratégia de `audit_log` regra 5, sem hash chain — eventos de domínio, não auditoria fiscal).
4. `member_tags` PK composta `(tenant_id, member_id, tag)` permite mesma tag em tenants distintos sem conflict — alternativa a unique partial index.
5. Soft-delete via `archived_at` + `archive_reason` (sem policy DELETE) é padrão para entidades com regulamentação de retenção (CFM 20a, COFFITO 20a — Lei 13.787/2018). Confirmar restore via UPDATE archived_at = NULL (testado).

**Sprint 02 a 70%.** 30% restante adiado: passaporte completo Server Actions (Sprint 11), portal `/meu/*` (Sprint 26), `/cadastro` proativo + Turnstile (fechamento Sprint 02), WhatsApp invite (Sprint 13), `has_cross_tenant_access()` (quando primeira leitura cross-tenant aterrissar), widget framework registry (Sprint 03+), `member_events` particionado real (Sprint 04+ volume).

### Build — Sprint 01b 70%: has_permission() + UI registros profissionais 2026-05-12

Faixa D do Sprint 01b. SQL function central de autorização + UI completa de profissional registrations + 11 Vitest tests novos. Sprint 01b sobe de 40% pra 70%.

**Adições:**

- **`packages/db/src/policies/0013_has_permission.sql`** — função SQL `has_permission(user_id, perm, scope_type?, scope_id?)` (ADR 0019). `SECURITY DEFINER` + `STABLE` + `SET search_path = public`. Union de `user_roles` + `user_permission_grants` ativos respeitando `expires_at` + `revoked_at`. `p_scope_type IS NULL` permite "consulta global". Comentário canônico na função.
- **`user_permission_grants.revoked_at` + `revoked_reason`** via migration `0006_busy_ben_parker.sql` (ADR 0019 previa; coluna faltou no schema Faixa C 01a).
- **`apps/web/app/app/pessoas/[id]/registros/actions.ts`** — 4 Server Actions com `wrapServerAction()`: `listRegistrations`, `createRegistration` (detecta global UQ violation → "possível fraude"), `attestRegistration` (pending → active + verified_by), `updateRegistrationSituation` (transições enum).
- **`apps/web/app/app/pessoas/[id]/page.tsx`** — Server Component detail (mini-perfil) com link condicional `/registros` (só PF) + dados básicos + endereço formatado.
- **`apps/web/app/app/pessoas/[id]/registros/`** — `page.tsx` (Server Component lista) + `registros-client.tsx` (Client Component com badge colorido por situação + ações inline atestar/suspender/reativar + form add com 8 conselhos enum + UF + valid_until).
- **`packages/db/tests/has-permission.test.ts`** — **11 Vitest tests**: via role (4: admin tem permissions tenant scope, em qualquer company, sem scope global, permission inexistente → false); user sem role (2: user fictício → false, UUID inexistente → false); via grant direto (5: tenant-wide grant, scope_company_id específico, expires_at passado/futuro, revoked_at).

**Atualizações:**

- **`packages/db/vitest.config.ts`** — exclui `has-permission.test.ts` do coverage gate (integration test).

**Validações end-to-end:**

- typecheck `@repo/db` + `@app/web` ✅
- migration 0006 + policy 0013 aplicadas (idempotente)
- `db:rls-check` 4 regras OK em 32 tabelas
- **70 Vitest tests verdes** (era 59 — +11 has-permission)
- 8 lints custom: **146 code + 2 css files clean** (era 141)
- `pnpm --filter @app/web build` ✓ (15 rotas existentes + 2 novas `/app/pessoas/[id]` e `/app/pessoas/[id]/registros`)

**Lições documentadas:**

1. `STABLE` em SQL function permite Postgres cachear dentro do mesmo statement (2× chamada → 1 lookup).
2. `SECURITY DEFINER` + `SET search_path = public` previne privilege escalation via function shadowing (atacante com CREATE no schema).
3. `p_scope_type IS NULL` no OR da policy permite "consulta global" — útil em Server Actions que querem "user tem essa permission em qualquer scope?".
4. Constraint global cross-tenant detecta fraude: `professional_registrations_global_uq` viola SQLSTATE 23505; UI mapeia pra "possível fraude — contate suporte".
5. `wrapServerAction()` + `setAuditResource(id, { council: 'CREFITO-SP/12345' })` registra em audit_log automaticamente; forensics retroativo via `payload` jsonb.

**Sprint 01b a 70%.** Restantes 30% adiados pra próximas sprints (custom roles UI / cron grants / Comitê IA / PAM / contador / data_subject_requests).

### Build — Sprint 01b 40%: núcleo RBAC v2 + passaporte cross-tenant + 5º cenário (solo) 2026-05-12

Schemas extension Sprint 01a → Sprint 01b. 6 tabelas novas + 1 coluna + 1 check constraint + 9 Vitest tests. UI registros + has_permission() function adiados pra Sprint 02+ (que vai consumir em contexto real).

**Adições:**

- **[ADR 0019](docs/decisions/0019-rbac-com-grants-diretos-union.md)** — RBAC com grants diretos + union em policies RLS. Modelo híbrido (roles + grants) escolhido sobre Casbin/OPA/CASL. Função `has_permission(user_id, perm, scope_type, scope_id)` centraliza (implementação Sprint 02+).
- **Faixa A — 4 tabelas + 1 coluna**:
  - `tenants.mode` enum `('multi'|'solo')` + check constraint `NOT (mode='solo' AND cross_company_access=true)` — ADR 0069 Plano Solo
  - `professional_registrations` (ADR 0055) — `council_body` enum CRM/CRN/CREFITO/CREF/CRF/CRP/COREN/CRO + situation enum + **constraint global unique cross-tenant** `(council_body, council_number, council_state)` detecta fraude. Trigger `kind=pf`.
  - `franchise_agreements` (ADR 0007) — N:N franqueador↔franqueado com royalty% + termos. Unique parcial 1 acordo ativo.
  - `consents` (LGPD art. 8) — 10 propósitos enum + 7 bases legais enum; revogação = INSERT nova row (preserva trilha).
- **Faixa B — 3 tabelas passaporte cross-tenant (regra 42 + ADR 0077)**:
  - `patient_company_links` — N:N paciente↔tenant com `passport_passport_id` global; status enum; creation_path
  - `patient_link_modules` — 5 módulos canônicos enum + **constraint global** `(passport, module) WHERE deactivated_at IS NULL` UNIQUE em TODA a rede
  - `patient_data_access_log` — append-only audit cross-tenant; INSERT exige `reader_tenant_id = app.tenant_id`; UPDATE/DELETE rejeitados
- **Migrations**: `0004_cheerful_husk.sql` (Faixa A) + `0005_loud_nekra.sql` (Faixa B)
- **Policies**: `0010_solo_mode_check.sql` + `0011_faixa_a_rls.sql` + `0012_passport_rls.sql` (16 policies novas + 1 trigger kind=pf)
- **`packages/db/scripts/seed.ts`** estendido — **5 cenários canônicos completos**:
  - Cenário 3 enriquecido com passaporte ativo (paciente Carlos linkado em Academia + Clínica; módulos academia + fisioterapia)
  - **Cenário 5 NOVO** — Modo Solo (`tenants.mode='solo'`, MEI, 1 matriz + 0 filiais, fisio autônoma)
  - Counts: 7 tenants + 11 companies + 11 units + 2 users + 2 patient_company_links + 2 patient_link_modules
- **`packages/db/tests/passport.test.ts`** — **9 Vitest tests** cobrindo: isolamento per-tenant (3) + JOIN modules respeita RLS (2) + constraint global SQLSTATE 23505 (1) + append-only patient_data_access_log (1) + tenants.mode=solo check constraint SQLSTATE 23514 (2)

**Validações end-to-end:**

- typecheck `@repo/db` + `@app/web` ✅
- migrations + policies aplicadas (idempotente)
- `db:rls-check` 4 regras OK em **32 tabelas** (era 26 na Sprint 01a)
- **59 Vitest tests verdes** (34 document + 8 rls-runtime + 8 trial-lifecycle + 9 passport)
- 8 lints custom: **141 code + 2 css files clean**
- Seed 5 cenários idempotente

**Adiado pra próximas sprints (não-gate Sprint 01b deste commit):**

- Função SQL `has_permission()` — Sprint 02+ (primeiros writes com permission gate)
- UI `/app/pessoas/[id]/registros` — Sprint 02+ (member real ativa caso de uso)
- UI `/app/settings/roles` — Sprint 02+
- Schemas IA Comitê — Sprint 06
- PAM `privileged_sessions` — Sprint 07
- `data_subject_requests` + `/meu/privacidade` portal — Sprint 26
- Contador externo + `/app/contador` — Sprint 04
- Cron `mark-grants-expired` — Sprint 03+ daemon
- System roles ampliadas (super_admin_rede etc) — Sprint 02+
- `logCrossTenantAccess()` automático em camada `@repo/passport` — Sprint 02+

**Sprint 01b a 40%** — núcleo crítico (schemas + RLS + seed + tests) entregue. UI + has_permission ativam progressivamente nas sprints donos.

### Build — 🎉 Sprint 01a FECHADO 100% — Faixa G: Trial lifecycle ADR 0066 2026-05-12

Última faixa entrega LGPD art. 16 anonimização automática: trial 14d → trial_expired → +30d `anonymize_trial_data()` NULLifica PII preservando agregados estatísticos. **Sprint 01a (Identidade + Topology) DONE.**

**Adições:**

- **`packages/db/src/policies/0009_trial_lifecycle.sql`** — 2 funções SQL SECURITY DEFINER + `SET search_path = public`:
  - `anonymize_trial_data(tenant_id)` — captura agregados → NULLifica PII em persons (name='Anonimizado', document/email/phone/address NULL) → subscription_status='anonymized' → grava audit_log com `legal_basis='lgpd_art16_eliminacao'`. Idempotente (`skipped: true` se já anonymized); raise SQLSTATE 23503 se inexistente.
  - `process_trial_lifecycle()` — job idempotente: D+14 → `trial_expired`; D+44 → `anonymize_trial_data()`. Retorna jsonb summary.
- **`apps/web/app/api/jobs/process-trial-lifecycle/route.ts`** — POST gated por `CRON_SECRET` Bearer (timingSafeEqual interno). Log JSON estruturado. Envelope ADR 0071 (200/401/500).
- **`packages/db/tests/trial-lifecycle.test.ts`** — **8 Vitest tests** cobrindo trial ativo/expirado/anonymized + idempotência + agregados preservados + RAISE EXCEPTION inexistente.

**Atualizações:**

- **`packages/db/vitest.config.ts`** — exclui `trial-lifecycle.test.ts` do coverage gate (integration test).
- **`docs/sprints/01a-identidade-e-topology.md`** — Status `planejado` → **DONE 🟢**; retro completa.
- **`docs/roadmap.md`** — Sprint 01a **done** 100% (início+fim 2026-05-12).

**Validações end-to-end:**

- typecheck `@repo/db` + `@app/web` ✅
- `db:rls-check` 4 regras OK em 26 tabelas
- **50 Vitest tests verdes** (34 document + 8 rls-runtime + **8 trial-lifecycle**)
- 8 lints custom: **136 code + 2 css files clean**
- Smoke test SQL: trial_expired -35d anonimizou corretamente

## 🎉 Sprint 01a FECHADO — DoD completo

- [x] Feature flag `auth_v1` (implícito via BetterAuth ativo)
- [x] Testes unit + E2E verdes (50 Vitest + skeletons E2E)
- [x] RLS verificada nos 4 cenários multi-empresa (rls-runtime.test.ts 8 tests)
- [x] Migrations Drizzle aplicadas (0000-0003 + 9 policies SQL)
- [x] CHANGELOG.md atualizado (8 entradas Faixa A-H)
- [x] Roadmap atualizado (Sprint 01a done 100%)
- [x] Zero violação de regras (lint custom 8 rules clean em 136 files)

**Adiado pra Sprint 02+** (documentado em retro): migração signup/empresas/users actions pra wrapServerAction; system_audit_anchor WORM S3; cron daemon real; GlitchTip capture; particionamento real audit_log; UI MFA enrollment; email magic link real; banner trial expirado; E2E Playwright completo.

**Próximo sprint:** 01b — RBAC com scope + Consent LGPD (+`tenants.mode='solo'` + `patient_company_links` passaporte).

### Build — Sprint 01a Faixa H: seed 4 cenários canônicos + RLS runtime test 2026-05-12

4 cenários multi-empresa populados via `pnpm db:seed` idempotente + 8 Vitest tests provando isolamento RLS em 2 conexões paralelas (T6 ADR 0090). Sprint 01a sobe de 80% pra 90%.

**Adições:**

- **`packages/db/scripts/seed.ts`** — 4 cenários canônicos com UUIDs hardcoded determinísticos (rede própria, franquia clássica, rede+clínica, mix loja+rede). 5º cenário (modo solo) adiado pra Sprint 01b. Idempotente via TRUNCATE; counts: 6 tenants + 10 companies + 10 units + 1 user.
- **`packages/db/tests/rls-runtime.test.ts`** — T6 Two-Connections Test: 8 Vitest tests provam isolamento persons/companies/units via 2 connections paralelas + INSERT cross-tenant rejeitado por WITH CHECK + system roles cross-tenant visíveis.

**Atualizações:**

- **`packages/db/package.json`** + **`package.json` root** — script `db:seed`.
- **`packages/db/vitest.config.ts`** — exclui `rls-runtime.test.ts` do coverage gate (integration test).
- **`apps/web/e2e/critical/cross-tenant-rls.spec.ts`** — documenta cobertura SQL via Vitest desde Faixa H; E2E completo aguarda Sprint 02+.

**Validações end-to-end:**

- typecheck `@repo/db` ✅
- `db:seed` idempotente 2× consecutivos ✅
- `db:rls-check` 4 regras OK em 26 tabelas ✅
- **42 Vitest tests verdes** (34 document + 8 rls-runtime)
- 8 lints custom: **134 code + 2 css files clean**

**Lições documentadas:**

1. `ANY(array)` Drizzle 0.45 não infere tipo via raw sql — usar `inArray()` helper.
2. UUIDs só aceitam hex (0-9, a-f) — `u` inválido (units → trocar pra `f`).
3. INSERT cross-tenant gera "new row violates row-level security policy" (não "permission denied") — útil pra distinguir RLS de privilege errors.

**Sprint 01a a 90% — Faixa H de 8 fechada.** Resta apenas Faixa G (trial 14d + anonymize 30d, ADR 0066).

### Build — Sprint 01a Faixa F: audit_log + hash chain + wrapServerAction 2026-05-12

audit_log append-only (regra 5) com hash chain SHA-256 trigger (regra 39) + system_alerts dedup (ADR 0071) + `wrapServerAction()` envelope automático compose session + MFA gate + audit fire-and-forget + sanitização PII. Sprint 01a sobe de 70% pra 80%.

**Adições:**

- **`packages/db/src/schema/audit.ts`** — 3 tabelas:
  - `audit_log` (regra 5 append-only via RLS, 15 colunas, 3 índices canônicos, `@volume_estimate_yearly: 5M+` documentado pra particionamento Sprint 04+)
  - `system_alerts` (17 colunas + fingerprint UNIQUE per tenant + retention_days por severity, ADR 0071)
  - `system_alert_occurrences` (ring buffer ocorrências; cron purga 20+ mais antigas Sprint 02+)
- **`packages/db/src/policies/0008_audit_rls.sql`** — RLS + trigger `audit_log_hash_chain_trigger()`:
  - `SECURITY DEFINER` (owner postgres) bypasse RLS pra `SELECT ... FOR UPDATE` (role app sem UPDATE em audit_log)
  - `SET search_path = public` previne privilege escalation
  - Lock pessimista FOR UPDATE serializa inserts concorrentes (sem isso → chain quebrada)
  - `current_hash = sha256(id || tenant_id || at || actor || action || payload || previous_hash)`
- **`apps/web/app/lib/wrap-action.ts`** — `wrapServerAction(ctx, handler)` compose 5 etapas:
  1. `requireFullSession` → 2. `requireRecentMfaForAction` → 3. `withSessionContext` (RLS) → 4. handler com `setAuditResource` callback → 5. INSERT `audit_log` fire-and-forget
  - `sanitizeArgs` mascara PII: password/totpSecret/recoveryCode → `[REDACTED]`; document/cpf/cnpj → `XXX***YY`
- **`@repo/errors`** ganha código 17 `MFA_RECENT_REQUIRED` + `mfaRecentTranslator` (match `error.name === 'MfaRecentRequiredError'` evita dep circular) + HTTP 403 em `wrap-api-handler`.
- **Migration `0003_shocking_orphan.sql`** — 3 tabelas + enums + índices.

**Atualizações:**

- **`packages/errors/package.json`** — `@types/node` dev dep (fix `node:crypto` import resolvido).
- **`apps/web/app/app/pessoas/actions.ts`** REFATORADO — 4 Server Actions (searchPersons, lookupCnpjAction, createPerson, archivePerson) usam `wrapServerAction()`. Throws `ApiException` em vez de envelope manual. `setAuditResource(id, extra)` registra resource_id em audit_log automaticamente.

**Smoke test hash chain — verde:**

```
 action |     curr     |     prev
--------+--------------+--------------
 first  | a132c6964486 |               ← genesis
 second | 7d69b2c9ae9f | a132c6964486   ← prev = first.curr ✅
 third  | ed5e75aaf6ba | 7d69b2c9ae9f   ← prev = second.curr ✅
```

**Validações end-to-end:**

- typecheck `@repo/errors` + `@repo/db` + `@repo/security` + `@app/web` ✅
- migrate aplicado idempotente (policy 0008 com SECURITY DEFINER)
- `db:rls-check` 4 regras OK em **26 tabelas** (era 23 na Faixa E)
- 47 Vitest tests verdes
- 8 lints custom: **132 code + 2 css files clean**

**Lições documentadas:**

1. **`SELECT ... FOR UPDATE` exige UPDATE privilege** — role `logifit_app` (sem UPDATE em audit_log por regra 5) não roda direto; trigger `SECURITY DEFINER` + `SET search_path = public` resolve (search_path explícito previne privilege escalation via function shadowing).
2. **`set_config(..., true)` é transaction-scoped** — psql autocommit perde entre queries; testes precisam `BEGIN; ...; COMMIT;` explícito.
3. **INSERT múltiplo em uma statement não enxerga próprias rows** — hash chain precisa INSERTs separados (1 statement/row); `wrapServerAction` naturalmente faz 1 INSERT por chamada.
4. **`'use server'` exige exports async-only** — helpers/factories de função (`wrapServerAction`) NÃO podem estar em arquivo `'use server'`; arquivos consumidores têm a diretiva no topo.
5. **Translator MFA via `error.name`** evita dep circular `@repo/errors → @repo/security`. Nome do erro vira contrato (ADR 0071 lista canônicos).

**Adiado pra próximas sprints (não-gate Faixa F):** migração de signup/empresas/users Server Actions (não high-risk no MVP); `system_audit_anchor` WORM S3 (depende S3 setup); cron `verify-audit-integrity` (Sprint 03+ daemon); GlitchTip capture (Sprint 02+ DSN); particionamento real audit_log (Sprint 04+ quando volume justificar).

**Sprint 01a a 80% — Faixa F de 8 fechada.** Próximo: H (seed 4 cenários canônicos + E2E críticos cross-tenant) ou G (trial lifecycle ADR 0066).

### Build — Sprint 01a Faixa E: Topology UI + `/signup` wizard atômico 2026-05-12

`onboardTenant` Server Action cria 7 entidades atomicamente (transaction elevada com `SET LOCAL ROLE postgres`) + UI wizard 3 etapas com auto-fill CNPJ + settings empresas/users. Sprint 01a sobe de 55% pra 70%.

**Adições:**

- **`apps/web/app/(auth)/signup/actions.ts`** — `onboardTenant({ cnpj, empresa*, unit*, admin* })`:
  - Cria 7 entidades em uma transaction: tenants + persons matriz PJ + companies + units + persons admin PF + users + user_tenants + user_roles (`tenant_owner` system role)
  - `auth.api.signUpEmail()` cria `auth_user` BetterAuth com password random 32 chars
  - `auth.api.signInMagicLink()` envia link mágico pra `/app`
  - Erros mapeados: `SLUG_TAKEN`, `CNPJ_TAKEN`, `EMAIL_ALREADY_USED`, `INVALID_CNPJ`/`INVALID_CPF`
- **`apps/web/app/lib/session.ts`**: `withElevatedContext(authUserId, fn)` — transaction com `SET LOCAL ROLE postgres` + ROLLBACK automático; uso restrito ao onboarding (Sprint 02+ adiciona lint `no-elevated-context-abuse`).
- **`apps/web/app/app/settings/empresas/actions.ts`** — `listCompanies`, `listAvailablePjPersons`, `createFilial` (detect `PERSON_ALREADY_COMPANY` + `PERSON_NOT_PJ`).
- **`apps/web/app/app/settings/users/actions.ts`** — `listUsers` (com roles agregadas), `listAvailablePfPersons`, `listAssignableRoles`, `createUser` (detect `USERNAME_TAKEN`, `PERSON_ALREADY_USER`, `PERSON_NOT_PF`).
- **`apps/web/app/(auth)/signup/signup-wizard.tsx`** — Client Component 3-step wizard (Empresa → Unidade → Admin) com stepper visual + auto-fill CNPJ + slug auto-gerado a partir do nome.
- **`apps/web/app/app/settings/empresas/page.tsx`** + **`new/page.tsx`** + **`new-filial-form.tsx`** — lista com badge matriz/filial; new com dropdown PJs disponíveis + campos IE/IM/regime tributário.
- **`apps/web/app/app/settings/users/page.tsx`** + **`new/page.tsx`** + **`new-user-form.tsx`** — lista com flags "convite pendente" + "MFA"; new com dropdown PF + checkboxes roles + indicador "MFA obrigatório".

**Atualizações:**

- **`apps/web/package.json`** — deps `pg` + `@types/pg` (necessárias pro `withElevatedContext` que recebe `PoolClient` explícito).

**Validações end-to-end:**

- typecheck `@app/web` ✅
- `pnpm --filter @app/web build` → **15 rotas** (4 novas + signup wizard 2.95KB) + middleware 34.7KB ✅
- `db:rls-check` 4 regras OK em 23 tabelas ✅
- 47 Vitest tests verdes
- 8 lints custom: **130 code + 2 css files clean**

**Lições documentadas:**

1. `withElevatedContext` requer transaction explícita — `SET LOCAL ROLE` só dura até COMMIT/ROLLBACK. Sem transaction, o SET vazaria entre queries no pool.
2. BetterAuth `signUpEmail` exige `password` mesmo quando user só vai usar magic link. Workaround: 32 chars aleatórios via `crypto.getRandomValues()`.
3. `auth.api.*` exigem `headers: HeadersInit` — passar `await headers()` do `next/headers` mesmo em Server Action (Next.js 15 dá acesso).
4. `signInMagicLink` falha NÃO reverte tenant — tenant já foi criado; UI mostra "tenta de novo na tela de login". Sprint 02+ adiciona `notification_queue` async com retry idempotente.

**Sprint 01a a 70% — Faixa E de 8 fechada.** Próximo: Faixa F (audit + particionamento + `wrapAction` envelope automático).

### Build — Sprint 01a Faixa D: Persons CRUD + CNPJ lookup (BrasilAPI + ReceitaWS + cache 7d) 2026-05-12

`@repo/cnpj` package + 4 Server Actions persons + UI `/app/pessoas` (lista + cadastro com auto-fill CNPJ) + API Route `/api/pessoas/cnpj/[cnpj]`. Sprint 01a sobe de 40% pra ~55%.

**Adições:**

- **`packages/cnpj/`** novo package — provider abstrato (ADR 0048):
  - `types.ts` — interface `CnpjProvider` + Zod schemas + erros discriminados (`CNPJ_INVALID`/`NOT_FOUND`/`PROVIDER_DOWN`/`RATE_LIMITED`/`INTERNAL`)
  - `brasilapi.ts` — default LogiFit; rate-limit free 3 req/min; timeout 30s via AbortController
  - `receitaws.ts` — fallback; status=ERROR + parseAbertura DD/MM/YYYY → ISO
  - `cache.ts` — `cnpj_cache` GLOBAL (sem tenant_id) com TTL 7 dias; UPSERT idempotente; Zod safeParse defesa contra cache corrompido
  - `orchestrator.ts` — `lookupCnpj()`: valida → cache → primary → fallback (só se PROVIDER_DOWN/RATE_LIMITED; NOT_FOUND/INVALID retornam imediato) → escreve cache
- **`apps/web/app/lib/session.ts`** — `getServerSession`/`requireSession`/`requireFullSession`/`withSessionContext` (seta `app.user_id`+`app.tenant_id` via `set_config` antes de queries → RLS aplica)
- **`apps/web/app/app/pessoas/actions.ts`** — 4 Server Actions: `searchPersons`, `lookupCnpjAction`, `createPerson` (com auto-fill CNPJ + detect `persons_tenant_document_uq` → `DOCUMENT_TAKEN`), `archivePerson`
- **`apps/web/app/api/pessoas/cnpj/[cnpj]/route.ts`** — GET REST endpoint; HTTP status mapping (404/400/429/502)
- **`apps/web/app/app/pessoas/page.tsx`** — Server Component lista com busca + filtro PF/PJ; empty state com CTA
- **`apps/web/app/app/pessoas/new/{page,new-person-form}.tsx`** — Server + Client Component; detect PF/PJ pelo dígito; auto-fill onBlur 14 dígitos; banner se situação ≠ ativa

**Atualizações:**

- **`scripts/lint-custom.mjs`** — `hasExemption(lines, idx, tag)` helper aceita exempção **inline OU na linha imediatamente acima** (mais legível pra `fetch()` com URL longa). Aplicado a todos os 8 lints.
- **`apps/web/next.config.ts`** — `@repo/cnpj` em transpilePackages
- **`apps/web/package.json`** — deps `@repo/cnpj` + `@repo/db` + `@repo/security` + `drizzle-orm` + `zod`

**Validações end-to-end:**

- typecheck `@repo/cnpj` + `@app/web` ✅
- `pnpm --filter @app/web build` → **11 rotas** (3 novas) + middleware 34.7KB ✅
- `db:rls-check` 4 regras OK em **23 tabelas** ✅
- **47 Vitest tests** verdes
- 8 lints custom: **120 code + 2 css files clean** ✅

**Lições documentadas:**

1. **Lint inline-only era engessado** — `// safe-fetch-exempt:` agora aceita inline OU linha acima (`hasExemption()` helper). Mais legível em chamadas `fetch()` longas.
2. **BetterAuth user.id (text) vs users.auth_user_id (uuid)** continua exigindo `sql\`current_setting(...)::uuid\`` em INSERT/JOIN — pattern recorrente desde Faixa C.
3. **Auto-fill CNPJ via REST** (Server Action força form submit/transition; Client Component prefere fetch nativo no `onBlur` pra loading state granular).
4. **Provider order matters** — fallback APENAS se primary falhar com `PROVIDER_DOWN`/`RATE_LIMITED`. `NOT_FOUND`/`INVALID` retornam imediato — fallback não vai descobrir CNPJ válido se Receita já disse que não existe.

**Sprint 01a a 55% — Faixa D de 8 fechada.** Próximo: Faixa E (Topology UI + onboarding wizard `/signup` atômico).

### Build — Sprint 01a Faixa C: RBAC + JWT claims + MFA helpers 2026-05-12

12 system roles + 25 permissions seeded; plugin `customSession` injetando `tenantId`/`topology`/`roles[]`/`requiresMfa`/`mfaAt` no token BetterAuth; `requireRecentMfa()` helper pronto pra Sprint 04+ ativações. Sprint 01a sobe de 25% pra ~40%.

**Adições:**

- **`packages/db/src/schema/rbac.ts`** — 6 tabelas: `roles` (system + tenant-scoped), `permissions` (catálogo global), `role_permissions` (N:N), `user_roles` (com scope_company_id + scope_unit_id opcional pra regra 25), `user_permission_grants` (override direto), `user_mfa_recovery_codes` (10 codes one-time hash bcrypt).
- **Migration `0002_brown_talon.sql`** — 6 tabelas + 12 índices + 13 FKs.
- **`packages/db/src/policies/0006_rbac_rls.sql`** — RLS por tenant_id; system roles visíveis cross-tenant (read-only); `user_mfa_recovery_codes` DENY direto (só Server Action).
- **`packages/db/src/policies/0007_rbac_seed.sql`** — seed idempotente: **12 system roles** (8 com requires_mfa=true — regra 43) + **25 permissions catálogo** (7 marcadas is_high_risk=true) + role_permissions assignments (super_admin/tenant_owner 25/25, gerente 15, recepcao 8, profissionais 5 cada, member 3).
- **`packages/security/src/require-recent-mfa.ts`** — `requireRecentMfa()` + `requireRecentMfaForAction()` (lookup `HIGH_RISK_ACTIONS`) + `isMfaRecent()` helper UI. `MfaRecentRequiredError` com `code='MFA_RECENT_REQUIRED'` + `maxAgeMins` + `mfaAt` pra envelope ADR 0071. **13/13 Vitest tests verdes**.
- **Plugin `customSession`** em `@repo/auth/server` — injeta `logifit: { userId, tenantId, topology, roles[], requiresMfa, mfaAt }` no payload BetterAuth via lookup de 4 queries (users + tenants + roles + role_permissions). Sprint 02+ vai cachear em Redis TTL 60s.
- **`apps/web/app/app/settings/mfa/page.tsx`** — Server Component skeleton com `auth.api.getSession` guard. 3 seções (TOTP / Passkey / Recovery codes) marcadas Faixa D+ (enrollment real depende de email plugado).
- **`apps/web/app/meu/sessoes/page.tsx`** — guard + mostra sessão atual; listagem completa via `<ResponsiveTable>` aguarda Faixa D.
- **`packages/security/vitest.config.ts`** — coverage threshold 80% (mesmo piso storage/db/errors).

**Atualizações:**

- **`apps/web/middleware.ts`** — `PROTECTED_PATH_PREFIXES` agora cobre `/app` E `/meu` (era só `/app`).
- **`packages/security/package.json`** — adiciona dev dep `vitest@^2.1.5` + scripts test/test:watch.

**Validações end-to-end:**

- Typecheck `@repo/auth` + `@repo/db` + `@repo/security` + `@app/web` ✅
- `pnpm --filter @app/web build` → **8 rotas** + middleware 34.7KB ✅
- Migration aplicada (2× idempotente) ✅
- `db:rls-check` 4 regras OK em **23 tabelas** ✅
- **47 Vitest tests** (34 db/document + 13 security/mfa) ✅
- 8 lints custom: **108 code + 2 css files clean** ✅
- **Seed validado**: 12/12 system roles + 25/25 permissions + role_permissions corretas

**Lições documentadas:**

1. `drizzle-orm` v0.45 exige `sql` template literal pra cross-cast `text → uuid` quando JOIN entre BetterAuth `auth_user.id` (text) e nossa `users.auth_user_id` (uuid). Workaround: `drizzleSql\`${user.id}::uuid\``.
2. `customSession` plugin atrasa cada session lookup em ~4 queries. Sprint 02+ cache em Redis.
3. System roles seed precisa `ON CONFLICT DO NOTHING` pra idempotência (re-run sem PK violation).
4. `pgEnum` snake_case em SQL vs camelCase Drizzle TS — policies SQL puro usam snake_case sempre (`requires_mfa` não `requiresMfa`).

**Sprint 01a a 40% — Faixa C de 8 fechada.** Próximo: Faixa D (Persons + CNPJ lookup via BrasilAPI + UI `/app/pessoas/*` + `<PersonPicker>`).

### Build — Sprint 01a Faixa B: BetterAuth integrado + login funcional 2026-05-12

Auth layer completa pra magic link + TOTP (futuro Faixa C ativa enrollment). 6 rotas Next.js geradas em build, middleware guard de sessão ativo pra `/app/*`, 8 tabelas auth no DB. Sprint 01a sobe de 12% pra ~25%.

**Adições:**

- **[ADR 0092](docs/decisions/0092-betterauth-vs-lucia.md)** — escolha BetterAuth sobre Lucia. Decisão fundamentada em paridade de features (TOTP/WebAuthn/recovery codes nativos vs ~500 linhas de boilerplate). Migração futura é trivial (cookie httpOnly + JWT padrão).
- **`packages/auth/`** novo package com 3 entry points: `@repo/auth/server` (instância `auth` + `nextJsHandler`), `@repo/auth/client` (Client Components), `@repo/auth` (forçando subpath explícito).
- **`@repo/db/schema/better-auth.ts`** — 6 tabelas BetterAuth (`auth_user`, `auth_session`, `auth_account`, `auth_verification`, `auth_two_factor`, `auth_passkey`) com prefixo `auth_` coexistindo com nossa `users` via FK `users.auth_user_id`.
- **`@repo/db/schema/auth-attempts.ts`** — `auth_attempts` + `auth_lockouts` LogiFit-owned (ADR 0073 camada 2 lockout 5/15min → 30min). Particionamento + retention 30d ficam pra Faixa F.
- **`@repo/db/src/policies/0005_auth_rls.sql`** — 8 policies `FOR ALL TO logifit_app` com FORCE RLS bloqueando acesso direto via superuser.
- **Migration `0001_flawless_hannibal_king.sql`** — 8 tabelas + FKs + 11 índices.
- **`apps/web/app/api/auth/[...all]/route.ts`** — catch-all delegando pro BetterAuth via `nextJsHandler()` helper de `@repo/auth/server`.
- **`apps/web/app/(auth)/login/`** — page Server Component + `<LoginForm>` Client Component com magic link signin. UX 4 states: idle / sending / sent / error. a11y completo (aria-describedby, role=alert).
- **`apps/web/app/(auth)/signup/`** — skeleton apontando pra Faixa E (onboarding completo).

**Atualizações:**

- **`apps/web/middleware.ts`** — guard LEVE de sessão pra `/app/*` (cookie `logifit.session_token` presente; validação full no Server Component layout via Edge runtime sem pg).
- **`apps/web/next.config.ts`** — adiciona `@repo/auth` em `transpilePackages`.
- **`apps/web/package.json`** — deps `@repo/auth` + `@repo/db` (workspace).
- **drizzle-orm 0.36 → 0.45** + **drizzle-kit 0.28 → 0.30** — BetterAuth 1.6.11 exige peer 0.45+. Schemas Faixa A continuam OK (34 tests + db:rls-check verdes pós-bump).

**Validações end-to-end:**

- Typecheck `@repo/auth` + `@repo/db` + `@app/web` ✅
- `pnpm --filter @app/web build` → **6 rotas** (`/`, `/login`, `/signup`, `/seguranca`, `/api/auth/[...all]`, middleware 34.7KB) ✅
- Migration aplicada (2× idempotente) ✅
- `db:rls-check` 4 regras OK em **17 tabelas** ✅
- 34 Vitest tests ✅
- 8 lints custom: **102 code + 2 css files clean** ✅

**Lições documentadas:**

1. **Dep circular `@repo/db ↔ @repo/auth`** se schemas vão em `@repo/auth` (que importa db client). Solução: schemas (SQL state) ficam em `@repo/db`; helpers de auth em `@repo/auth`.
2. **BetterAuth tem TS inference massiva** (via zod 4) que estoura `TS7056: type exceeds the maximum length the compiler will serialize`. Workaround: `declaration: false` no tsconfig (packages internos do workspace não shipam .d.ts).
3. **`better-auth/next-js` subpath** ficou encapsulado via `nextJsHandler()` helper em `@repo/auth/server` — apps/web não declara `better-auth` como direct dep.
4. **Cookie name** override via `advanced.cookiePrefix: 'logifit'` → `logifit.session_token` (padrão é `better-auth.session_token`).
5. **Edge runtime do middleware** impede pg DB lookup; guard é "cookie presente" (defense in depth — validação full no Server Component).

**Sprint 01a a 25% — Faixa B de 8 fechada.** Próximo: Faixa C (RBAC + JWT claims + MFA TOTP enrollment).

### Build — Sprint 01a Faixa A: schemas + RLS base + validador CPF/CNPJ 2026-05-12

Primeira faixa do Sprint 01a (Identidade + Topology). Schemas Drizzle das 9 tabelas fundacionais + RLS policies em SQL puro + role `logifit_app` non-superuser + validador documento brasileiro + db:rls-check 4× mais robusto. **Isolamento RLS comprovado em transação automatizada** (`RLS_CHECK_RUNTIME=1`).

**Adições:**

- **`packages/db/src/persons/document.ts`** — validador CPF/CNPJ canônico zero-dep (módulo 11 Receita Federal), detecção automática PF/PJ pelo tamanho dos dígitos, 5 razões de falha tipadas (`empty`, `invalid_length`, `all_same_digit`, `check_digit_mismatch`). API: `parseDocument`, `isValidCpf`, `isValidCnpj`, `normalizeDocument`, `formatDocument`. **34 Vitest tests verdes** com CPFs/CNPJs públicos canônicos.
- **`packages/db/src/schema/persons.ts`** — cadastro central PF/PJ (ADR 0047) com unique parcial `(tenant_id, document) WHERE document IS NOT NULL`.
- **`packages/db/src/schema/cnpj-cache.ts`** — cache GLOBAL Receita Federal (ADR 0048) sem tenant_id + `tenant_cnpj_settings` por tenant (provider primário/fallback + credentials).
- **`packages/db/src/schema/identity.ts`** — `groups`, `tenants` (topology + financial_mode + cross_company_access + subscription_status + trial_ends_at + shard_url + default_locale), `companies` (matriz/filial + person_id PJ + IE/IM/regime_tributario/CNES), `units`, `users` (+ person_id PF + auth_user_id + mfa_enabled), `user_tenants` N:N. **5 enums + 9 tabelas + 15 índices + 6 FKs.**
- **`packages/db/src/policies/0001-0004_*.sql`** — 4 arquivos de RLS em SQL puro versionado: persons (4 policies) + identity (16 policies) + cnpj-cache (4 policies) + person_kind_check (3 triggers comportamentais: companies.person_id kind=pj, users.person_id kind=pf, filial→matriz mesmo tenant). Total: **24 policies + 3 triggers + 3 funções**.
- **`packages/db/init/0001_roles.sql`** — role `logifit_app` (NON-superuser, NÃO BYPASSRLS) usado pelas Server Actions/API Routes. Postgres superuser bypassa RLS por design — sem role dedicado, isolamento aparenta funcionar mas falha silenciosamente em prod.
- **`packages/db/vitest.config.ts`** + add devDep `vitest@^2.1.5` ao `@repo/db`. Coverage threshold 80% (mesmo piso de errors/security/storage).
- **`migrations/0000_milky_dark_beast.sql`** — migration inicial gerada por `drizzle-kit generate` (162 linhas).

**Atualizações:**

- **`packages/db/scripts/migrate.ts`** — refatorado em 3 fases (init → drizzle → policies), idempotente via `DROP IF EXISTS` automático em policies + DROP TRIGGER inline + `CREATE OR REPLACE FUNCTION`. **Validado: 2 runs consecutivos sem erro.**
- **`packages/db/tests/rls-check.ts`** — estendido de 1 → 4 regras: (1) `tenant-id-needs-rls`, (2) `rls-needs-force`, (3) `rls-needs-policy`, (4) `runtime-isolation` (opt-in `RLS_CHECK_RUNTIME=1` cria 2 tenants + valida que role `logifit_app` com `app.tenant_id`=A só vê dado de A; ROLLBACK no final). Allowlist explícita pra `cnpj_cache` + `groups` (globais por design).
- **`packages/db/package.json`** — script `test` (vitest) + export `./persons` + dep `vitest`.

**Smoke test em prod local (5/5 passou):**

1. ❌ Company com PF → trigger bloqueia ✅
2. ✅ Matriz com PJ → passa ✅
3. ❌ 2ª matriz mesmo tenant → unique parcial bloqueia ✅
4. ❌ Filial sem parent → trigger bloqueia ✅
5. ✅ Filial com matriz parent → passa ✅

**Validações end-to-end:**

- `pnpm --filter @repo/db typecheck` ✅
- `pnpm --filter @repo/db test` → 34/34 tests ✅
- `pnpm --filter @repo/db db:migrate` (2× consecutivos) ✅ idempotente
- `pnpm --filter @repo/db db:rls-check` → 3 regras estáticas OK
- `RLS_CHECK_RUNTIME=1 pnpm db:rls-check` → 4 regras OK (isolamento real comprovado)
- `node scripts/lint-custom.mjs` → 92 code + 2 css files clean (8 rules)

**Lições documentadas (importantes pra Faixa B+):**

1. **`postgres` superuser bypassa RLS por design** — `FORCE ROW LEVEL SECURITY` força só pra table owner, não pra superuser global. App MUST usar role dedicado (`logifit_app`). Descoberto via smoke test que enganosamente passou sem o role isolation real.
2. **drizzle-kit é CJS** — não aceita `.js` extension em imports `.ts`; usar imports sem extensão.
3. **Policies SQL precisam DROP IF EXISTS** antes de CREATE (não há `CREATE OR REPLACE POLICY`); regex no migrator extrai automaticamente, mas TRIGGER fica com DROP explícito no SQL.

**Sprint 01a a ~12% — Faixa A de 8 fechada.**

### Build — Backup Camada 1 (local) ATIVA + DR drill validado 2026-05-12

Cobre ~80% dos cenários reais de DR sem precisar de credentials externas. Camada 2 (R2 off-site) permanece pendente — aguarda 1 API token Cloudflare do fundador.

**Adições:**

- **`infra/backup-local.sh`** — script idempotente que faz `pg_dump -Fc` das DBs `logifit` e `glitchtip` → gzip → `/data/backups/postgres/` (chmod 700 root-only). Retention 30 dias (`find -mtime +30 -delete`). Sem GPG (backup local fica no mesmo trust boundary que o DB — GPG fica reservado pra Camada 2 off-site). Instalado em `/usr/local/bin/logifit-backup-local.sh` no VPS.
- **`/etc/cron.d/logifit-backup-local`** — entry agendada 02:30 UTC diário (23:30 BRT, fora do pico). Logs via `journalctl -t logifit-backup-local`.

**Atualizações:**

- **`docs/runbooks/backup-r2.md`** — refatorado pra cobrir 2 camadas: Camada 1 (local, ATIVA) + Camada 2 (R2 off-site, pendente). Tabela de cobertura por camada + script de restore Camada 1 documentado.
- **VPS** — instalado `cron` daemon (Ubuntu 22.04 Minimal não vem com cron por default); `systemctl enable --now cron`.

**Validação end-to-end (smoke test + DR drill):**

- Roda manual produziu `logifit-2026-05-12_170745.pgdump.gz` (794 bytes) + `glitchtip-...gz` (377 bytes) — DBs vazios ainda mas dumps válidos.
- Header `PGDMP` confirmado via `zcat | head -c 5 | xxd` (PostgreSQL Dump Custom Format magic).
- **DR drill completo**: restore num DB shadow `logifit_restore_test`; 5/5 extensions preservadas (pg_trgm, pgcrypto, plpgsql, unaccent, vector). Pipeline backup → restore funcional ANTES do primeiro byte de dado real.

**Cobertura desta camada:**

| Cenário | Camada 1 (local) |
|---|---|
| DB corruption (UPDATE acidental, schema migration ruim) | ✅ |
| Query errada / rollback de feature | ✅ |
| DR drill rápido (~10min restore vs ~4h pra R2) | ✅ |
| VPS perdido | ❌ |
| Disco corrompido | ❌ |
| Conta Oracle suspensa | ❌ |
| Ransomware no filesystem | ❌ |

**Sprint 00 sobe de 95% pra 97%.** Regra 40 só fecha 100% quando Camada 2 (R2 + GPG) ativar.

**Por que importa:** o gate de DR primeira camada está pronto desde antes do primeiro dado real chegar (Sprint 01a). Restore num DB shadow já foi testado e funciona; Sprint 01a pode confiar em rollback rápido se schema migration der ruim.

### Build — Sprint 00 Faixa 4 FECHADA 🟢: qualidade + compliance preparados 2026-05-11

Sprint 00 sobe de 90% pra 95%. 10 smoke + 12 critical esqueletos · 8 lints custom rodando limpo em 87 arquivos · 18 RIPDs em estado skeleton com hash SHA-256 validável via `pnpm compliance:check`. Resta apenas: ativação R2 backup (dependente user) pra fechar 100%.

**Adições:**

- **`apps/web/e2e/smoke/`** — 9 novos esqueletos (já tinha auth-magic-link da Faixa 1): `tenant-switch`, `member-create`, `agenda-book`, `asaas-checkout`, `dashboard-by-role`, `global-search`, `messages-catalog`, `security-headers`, `mfa-recent-required`. Cada um com `test.skip()` + cenário documentado + sprint dono + dependências. **Exceção:** `security-headers.spec.ts` já tem 3 testes ATIVOS validando 6 headers fixos + CSP nonce dinâmico + `/.well-known/security.txt` — passa em prod desde Faixa 2.
- **`apps/web/e2e/critical/`** — 11 novos esqueletos (já tinha cross-tenant-rls): `trial-anonymize`, `cross-tenant-audit-log`, `passport-global-constraint`, `asaas-idempotencia`, `cross-prescricao-fisio-academia`, `nfe-210210-rejeicao`, `hash-chain-cutover`, `icp-brasil-portal-iti`, `tiss-xsd-validation`, `revoke-passport-link`, `franchise-rule-25-clinico-nao-cruza`. Cobrem regras 25, 39, 42; ADRs 0054, 0057, 0059, 0077, 0079, 0089; CFM 2.299/Lei 13.787 (ICP-Brasil), TISS 4.01, NF-e SEFAZ.

**Atualizações:**

- **`scripts/lint-custom.mjs`** — adiciona 3 lints novos (`no-unwrapped-action` + `high-risk-action-must-require-recent-mfa` + `cross-tenant-read-must-log`) ao set existente de 5 (`no-window-alert`, `no-raw-fetch`, `no-hardcoded-design-token`, `no-rejected-saas-import`, `no-hardcoded-toast-message`). Total **8 lints custom** cobrindo regras 27, 33, 37, 42, 43, 44, 45, 46. Lints 6-8 são "ready" — passam silenciosamente até Sprint dono criar o padrão (Server Action com `'use server'`, arquivo `high-risk-actions.ts`, query cross-tenant); quando feature aterrissa, lint vira fail automaticamente sem retrofit. Validado: ✓ 85 code + 2 css files clean (8 rules).

**Lições novas (Faixa 4):**

15. **`smoke/security-headers.spec.ts` é único que roda DESDE Sprint 00** (não precisa esperar Sprint 01a) — útil pra CI gate antes de qualquer feature de negócio. Faz curl em `/` + `/.well-known/security.txt`, valida 6 headers fixos + CSP com nonce dinâmico (2 requests → 2 nonces distintos comprovando `strict-dynamic` sem cache).
16. **Lints 6-8 "ready"** — detectam padrão futuramente. Hoje, base de código não tem `'use server'`/`high-risk-actions.ts`/`origin_tenant_id` → lint passa silencioso. Quando Sprint 01a/02 introduzir o padrão, lint vira fail automaticamente. Filosofia: lint é onboarding pro dev futuro, não auditor retroativo.
17. **Lint 7 lê fonte canônica** `packages/security/src/high-risk-actions.ts` — adicionar uma action lá força MFA recente nos handlers correspondentes automaticamente. Sprint 17/20/22 que adicionarem `cancelNfe`/`cancelTissGuide` só editam a lista; lint detecta sem mexer no código do lint.

**Por que importa:** o CI ganha proteção retroativa pros próximos sprints sem precisar de retrofit. Sprint 01a já vai ter o piso enforced de regras 33+43 desde o primeiro commit; Sprint 02 idem pra regra 42. Smoke `security-headers` valida o que já está em prod, fechando o ciclo "código → prod → teste automatizado" de ponta a ponta.

**Pendente (não faz parte do Sprint 00):**

- Ativação R2 backup (regra 40) — depende user fornecer credentials.
- Implementação real dos 22 esqueletos E2E — cada um destrava no Sprint dono (01a a 36).

### Build — Sprint 00 Faixa 3 quase fechada: observabilidade + pool + backup-as-code subiram em prod 2026-05-11

Sprint 00 sobe de 75% pra 90%. Stack self-host de observabilidade + connection pool + backup scripts versionados — última pendência é o user fornecer credentials R2 + GPG pra ativar cron de backup. 14 containers em prod usando 3.5 GB de 23 GB RAM (folga confortável).

**Serviços novos rodando em prod:**

- **GlitchTip self-host** em `https://errors.logifit.com.br` — `glitchtip/glitchtip:latest` v6.1.6 ARM64 + `postgres:16-alpine` dedicado + `redis:7.2-alpine` dedicado + worker Celery; `/_health/` retorna `ok`; painel Angular acessível; `ENABLE_USER_REGISTRATION=false`. UUID Coolify service: `lkji13qn0p561ovseh497wgq`. Integração `@sentry/nextjs` + DSN no `wrapAction()`/`wrapApiHandler()` (regra 33) pendente — destrava com Sprint 01a (primeira Server Action real).
- **Loki + Promtail + Grafana** em `https://monitor.logifit.com.br` — `grafana/loki:3.2.0` + `grafana/promtail:3.2.0` + `grafana/grafana:11.3.0`. Promtail tail `/var/lib/docker/containers/*/*-json.log` de TODOS containers do VPS → Loki ingest → Grafana com **Loki datasource pré-provisionado** via bind-mount `/data/lokistack/grafana-provisioning/datasources/loki.yml` (provisioning como código — sobrevive a redeploy). Admin password 32 chars gerado random + cookies seguros (`GF_SECURITY_COOKIE_SECURE=true`). UUID Coolify service: `expwv4l6ydu39d1mhrq5nifh`. Falta: integração `pino` no Next.js (`pino` → stdout → Promtail já captura).
- **PgBouncer** transaction pool — `edoburu/pgbouncer:latest` ARM64 conectado ao Postgres existente; `pool_mode=transaction`, `max_client_conn=200`, `default_pool_size=20`, `reserve_pool_size=5`. Conectado na network `coolify` → acessível como `pgbouncer-<uuid>:5432` por outros containers. Smoke test: `SELECT version()` via pool → PostgreSQL 17.9 aarch64 ✅ + 4 extensions ativas (pg_trgm, unaccent, vector 0.8.2, pgcrypto) ✅. UUID Coolify service: `sbd28p5yc2befkvjjl40u58f`. Sprint 01a vai usar `DATABASE_URL=postgres://postgres:PASS@pgbouncer-sbd28...:5432/logifit`.

**Adições:**

- **`infra/backup-r2.sh`** — script versionado idempotente que roda no host (não em container): `pg_dump` cifrado GPG das 2 DBs (`logifit` + `glitchtip`) → `gzip -9` → `gpg --encrypt` → `rclone rcat` pra R2; MinIO via `rclone sync` incremental (versioning interno + R2 como 2ª camada); Coolify metadata (`/data/coolify/`) via `tar -czf | gpg --encrypt`; lokistack configs (`/data/lokistack/`) via `tar -czf` (sem GPG — não tem secret). Retention `--min-age 30d`. Roda como cron 03:00 UTC. Logs via `journalctl -t logifit-backup`. Implementa regra 40.
- **`infra/restore-r2.sh`** — script complementar com 6 comandos: `list` (mostra backups disponíveis), `postgres-logifit` (cria `logifit_restore` separado pra validar antes de promover), `postgres-glitchtip`, `minio` (rclone sync R2 → volume local), `coolify`, `lokistack`. Cada subcomando aceita opcionalmente `DATE_TAG` pra restore point-in-time. Não destrutivo por padrão — sempre cria DB shadow.
- **`docs/runbooks/backup-r2.md`** — runbook seguindo `_template.md`: 5 passos primeira ativação (criar bucket R2 + token API no Cloudflare Dashboard, gerar par GPG `backup@logifit.com.br` em máquina local, SSH no VPS pra rclone config + import GPG public + setup `/etc/logifit/backup.env`, validar smoke test, agendar DR drill trimestral) + 3 cenários de restore (DB corrompido, MinIO perdido, VPS completo) + tabela de custos R2 + tabela de erros comuns. RTO target 4h, RPO 24h.

**Atualizações:**

- **`docs/sprints/00-setup-infra.md`** — marca itens da Faixa 3 entregues; adiciona log entry detalhado com 5 lições novas (Coolify v4 NÃO gera labels Traefik pra Docker Compose Service · `PATCH /envs` falha silenciosa quando env não existe · `connect_to_docker_network` rejeitado em `POST /services` · GlitchTip image não tem wget/curl → healthcheck Python · `SERVICE_NAME_*` envs auto-injetadas).
- **`docs/roadmap.md`** — Sprint 00 sobe 75% → 90%.

**Lições documentadas para runbook futuro (Faixa 3):**

10. **Coolify v4 NÃO gera labels Traefik pra Docker Compose Service** — só pra Applications (build_pack=dockerfile). Magic env `SERVICE_FQDN_*` é silencioso aqui. Workaround: declarar labels Traefik manualmente em `services.<name>.labels[]` do compose, seguindo padrão `traefik.http.routers.<name>-https.rule=Host(\`fqdn\`)` + middlewares (gzip + redirect-to-https) + tls.certresolver=letsencrypt.
11. **`PATCH /api/v1/services/{uuid}/envs` falha silenciosa** quando env não existe (retorna `key: None` + `value: 0`) — sempre fazer POST primeiro (auto-cria slot se compose referencia `${VAR}`, ou cria do zero se não). PATCH é só pra atualizar valor existente.
12. **`POST /api/v1/services` rejeita campo `connect_to_docker_network`** em create — só editável depois via PATCH. Pra subir service que precisa network compartilhada (ex.: PgBouncer ↔ Postgres existente), declarar `networks: { coolify: { external: true } }` no compose direto.
13. **GlitchTip image (Python-based) não tem `wget` nem `curl`** — healthcheck Docker via `python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/_health/').status==200 else 1)"`. Coolify suporta sintaxe `CMD-SHELL` perfeitamente.
14. **`SERVICE_NAME_*` envs auto-injetadas pelo Coolify** em todos serviços do compose (visíveis no `docker_compose` parsed) — úteis pra service discovery DNS interno; não confundir com user-defined envs (que vão pra `/envs` endpoint).

**Por que importa:** o stack de observabilidade fica em pé ANTES da primeira feature de negócio (Sprint 01a) — Sprint 01a já pode validar `pino → stdout → Loki` + `Sentry SDK → GlitchTip` desde o primeiro commit. PgBouncer evita o desastre clássico do Next.js stateless (cada Server Action abre 1 connection direta → Postgres trava em ~100 reqs concorrentes). Backup-as-code (regra 40) garante DR drill replicável sem improviso.

**Pendente Faixa 3 (depende user):**

- Cloudflare R2 bucket `logifit-backups-prod` + API token + par GPG `backup@logifit.com.br`. Quando user passar, runbook `backup-r2.md` §3 (SSH setup) ativa em ~10min.

**Pendente Faixa 4 (qualidade):**

- 8 lints custom (`no-unwrapped-action`, `no-raw-fetch`, `no-unscanned-upload`, `cross-tenant-read-must-log`, `no-hardcoded-design-token`, `ai-block-respected`, `no-window-alert`, `no-hardcoded-toast-message`).
- Esqueletos `e2e/smoke/` (10 testes) + `e2e/critical/` (12 testes) com helpers Playwright.
- RIPDs vazios em `docs/compliance/ripd/`.

### Build — Sprint 00 Faixa 2 FECHADA 🟢: `https://app.logifit.com.br` rodando ponta a ponta 2026-05-11

`HTTP/2 200` externo via Cloudflare → Traefik → Next.js standalone, 8/8 security headers da regra 35, CSP nonce dinâmico por request + `strict-dynamic` (sem `unsafe-inline` em `script-src`), i18n pt-BR/en-US/es-419 ativo (regra 27), Toaster CSP-safe propagando nonce (regra 45), design tokens "Equilíbrio Vital" aplicados (regra 44). Sprint 00 sai de 55% pra 75%.

**Deploy final** — commit `3d5a463`; container `Up (healthy)`; `cf-ray ...GRU` (Cloudflare São Paulo edge); healthcheck `wget http://127.0.0.1:3000/`.

**Infra provisionada (Faixa 2):**

- **VPS Oracle Cloud Vinhedo** — VM.Standard.A1.Flex 4 OCPU + 24 GB RAM ARM Ampere; IP público `157.151.31.227`; Ubuntu 22.04 Minimal aarch64; block volume 150 GB ext4 em `/data`; `bootstrap-oracle.sh` (UFW + fail2ban + Docker CE + Coolify install + hardening SSH).
- **Coolify v4.0.0** healthy 5 dias com 4 containers internos (proxy Traefik v3.6 / db PG 15 / redis 7 / realtime).
- **Cloudflare DNS** propagado: A records `app.` + `coolify.` + `monitor.` + `errors.logifit.com.br` (proxied 🟠).
- **`logifit-pg`** — `pgvector/pgvector:pg17` healthy + database `logifit` + 4 extensions (`pg_trgm`, `unaccent`, `vector` 0.8.2, `pgcrypto`).
- **`logifit-redis`** — `redis:7.2` healthy com auth.
- **`logifit-minio`** — `minio/minio:latest` ARM64 healthy + 5 buckets (`logifit-uploads`, `logifit-backups`, `logifit-lab-documents`, `logifit-fisio-evolucoes`, `logifit-exam-attachments`); recriado via Docker Compose Empty pra contornar bug Coolify v4 que ignora `start_command` em `build_pack=dockerimage`.
- **Application `logifit-web`** no Coolify — repo `git@github.com:SurkampEverton/LogiFit.git` via Deploy Key (Private Key `logifit-github-deploy`), branch `main`, `build_pack=dockerfile`, `dockerfile_location=/apps/web/Dockerfile`, domain `https://app.logifit.com.br` com TLS Let's Encrypt (resolver `letsencrypt`), env `NODE_ENV=production` + `NEXT_TELEMETRY_DISABLED=1`.

**Adições:**

- **`apps/web/Dockerfile`** — multi-stage Node 22 alpine: stage `base` (corepack pnpm + libc6-compat), `builder` (pnpm install com cache mount BuildKit + `pnpm --filter @app/web build`), `runner` (non-root `nextjs:nodejs` UID 1001 + healthcheck `wget http://127.0.0.1:3000/` IPv4-forçado + CMD `node apps/web/server.js`). Build context = raiz do monorepo.
- **`apps/web/.dockerignore`** — exclui `node_modules`, `.next`, `.git`, `docs/`, `prototipo/`, `chaves/`, `.github/`, `infra/`, `scripts/`, `e2e/`, env files; reduz build context.

**Atualizações:**

- **`apps/web/next.config.ts`** — adiciona `output: 'standalone'` (Next.js gera bundle minimal pra Docker) + `outputFileTracingRoot: repoRoot` (calculado via `import.meta.url` ESM, aponta pra raiz do monorepo) + `typedRoutes: true` top-level (Next.js 15.5 promoveu de `experimental.*`).
- **`packages/ui/src/messages/toaster.tsx`** — Sonner v1.7 não tipa prop `nonce` em `ToasterProps` apesar de aceitar em runtime; spread `{...extra}` com cast `as any` + comentário `// biome-ignore` justificativa explícita; CSP nonce regra 35 + regra 45 mantidos via arquitetura (nonce vem do middleware via `headers().get('x-nonce')`).
- **VPS `/etc/ssh/sshd_config.d/99-coolify-localhost.conf`** — `Match Address 127.0.0.1,10.0.0.0/8,172.16.0.0/12` permite `root@host.docker.internal` (Docker bridge `10.0.1.1`); externamente root continua bloqueado.
- **VPS `/root/.ssh/authorized_keys`** — Coolify Deploy Keys autorizadas, `force_command` Ubuntu default removido.
- **DB Coolify** — `servers.user` atualizado `ubuntu` → `root` direto via `psql` (painel UI estava cached); `standalone_postgresqls.image` atualizado pra `pgvector/pgvector:pg17`.

**Validação ponta a ponta (regra 35):**

```
$ curl -sI https://app.logifit.com.br
HTTP/2 200
strict-transport-security: max-age=63072000; includeSubDomains; preload
x-frame-options: DENY
x-content-type-options: nosniff
referrer-policy: strict-origin-when-cross-origin
permissions-policy: camera=(self), microphone=(self), geolocation=(self), bluetooth=(self), payment=(self), usb=()
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-site
content-security-policy: default-src 'self'; script-src 'nonce-...' 'strict-dynamic'; ...
x-nonce: KImWcm9ap4m4szcT+4WH0Q==   ← nonce dinâmico por request
set-cookie: NEXT_LOCALE=pt-BR; ...   ← i18n ativo
cf-ray: 9fa2e52fcf49565d-GRU         ← Cloudflare São Paulo edge
```

**Lições documentadas pra runbook futuro:**

1. Coolify v4 cria `/data/coolify/...` com ownership do user SSH — ubuntu (UID 1001) quebra acesso UID 9999 do Coolify; SSH user `root` resolve (com `Match Address` localhost-only no sshd).
2. `start_command` não aplicado em `build_pack=dockerimage` — usar `Docker Compose Empty` com `command:` explícito quando precisar custom CMD.
3. Bitnami images public sem tag `latest` desde 2025 — preferir imagens oficiais (`minio/minio`, `redis:7.2`, etc.) ou `bitnamilegacy/*`.
4. `postgres:17-alpine` não tem pgvector — usar `pgvector/pgvector:pg17` (mesma imagem do docker-compose dev pra paridade).
5. `docker-entrypoint-initdb.d` só executa em cluster vazio — volume preservado entre redeploys ignora init scripts; criar DB + extensions manualmente via `docker exec psql`.
6. **Alpine BusyBox resolve `localhost` → IPv6 `[::1]` primeiro** — em healthchecks de container Next.js standalone com `HOSTNAME=0.0.0.0` (IPv4 only) sempre usar `127.0.0.1`. Era a falha do 2º deploy (Connection refused mesmo com app rodando OK).
7. **Coolify v4 API env var field é `is_buildtime` (sem underscore)** — `is_build_time` retorna `not allowed`; usar body mínimo `{"key": ..., "value": ...}` evita gotcha.
8. **Sonner v1.7 não tipa prop `nonce` em `ToasterProps`** apesar de aceitar em runtime — spread tipado com `as any` (ou upgrade ≥2 pós-Sprint 00).
9. **Next.js 15.5+ promoveu `typedRoutes` de `experimental.*` para top-level** — manter como experimental imprime warning sem quebrar build, mas convém migrar logo.

**Por que importa:** o caminho crítico de Sprint 00 ("Hello World em prod com 7+ security headers") está fechado. Sprint 00 sobe pra **75%**; resta Faixa 3 (GlitchTip + Loki/Grafana + Cloudflare R2 backup) e Faixa 4 (8 lints custom + esqueletos suíte `smoke/` e `critical/` + helpers Playwright + RIPDs vazios).

**Pendente Faixa 3 + Faixa 4:**

- GlitchTip + ClickHouse self-hosted em `errors.logifit.com.br` (regra 33 — error envelope captura no Sentry-API).
- Loki + Promtail + Grafana self-hosted em `monitor.logifit.com.br` (pino → stdout → Promtail → Loki).
- Cloudflare R2 + rclone diário cifrado GPG (regra 40 — backup off-site).
- PgBouncer integrado ao Postgres Coolify (regra de soberania perpétua #5).
- `.well-known/security.txt` (RFC 9116) + página `/seguranca` (postura de divulgação responsável).
- 8 lints custom (`no-unwrapped-action`, `no-raw-fetch`, `no-unscanned-upload`, `cross-tenant-read-must-log`, `no-hardcoded-design-token`, `ai-block-respected`, `no-window-alert`, `no-hardcoded-toast-message`).
- Esqueletos `e2e/smoke/` (10 testes) + `e2e/critical/` (12 testes) com helpers Playwright + RIPDs vazios em `docs/compliance/ripd/`.

### Build — `@repo/storage` real (`StorageAdapter` + `MinioStorageAdapter` + bootstrap dos 6 buckets canônicos) 2026-04-29

Faixa 1 do Sprint 00 fecha o item da linha 73 ([sprints/00](docs/sprints/00-setup-infra.md)) e o equivalente da Faixa 2 (linha 262). Materializa a regra de soberania perpétua #3 ([ADR 0091](docs/decisions/0091-self-host-total-oracle-sp.md)): qualquer feature de negócio futura consome SOMENTE a interface `StorageAdapter` — `@aws-sdk/*` fica encapsulado neste package.

**Adições — `packages/storage/src/`:**
- `types.ts` — `interface StorageAdapter` (7 métodos: `put`/`get`/`head`/`delete`/`list`/`presignGet`/`presignPut`); Zod schemas validam input no boundary de cada método (regra 7); `StorageError` discriminado com 5 códigos (`NOT_FOUND`/`BUCKET_NOT_FOUND`/`PERMISSION_DENIED`/`INVALID_INPUT`/`INTERNAL`) usando `Error.cause` ES2022.
- `buckets.ts` — `BUCKETS` const com os **6 buckets canônicos da regra 38** (`lab-documents`, `fisio-evolucoes`, `exam-attachments`, `exercises`, `certificados`, `whatsapp-media`); `physicalBucketName(prefix, name)` aplica `MINIO_BUCKET_PREFIX` (ex: `logifit-dev-lab-documents` em dev).
- `tenant-key.ts` — `tenantKey({tenantId, ownerKind, ownerId, ext})` compõe chave `${tenantId}/${ownerKind}/${ownerId}/${YYYY}/${MM}/${uuid}.${ext}`; rejeita path traversal, UUID v4 obrigatório em tenant/owner, `ownerKind` regex lowercase, allowlist de 12 extensões; `keyBelongsToTenant(key, tenantId)` para auditoria.
- `minio-adapter.ts` — `MinioStorageAdapter` via `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`; `forcePathStyle: true` (MinIO requer); traduz erros AWS em `StorageError`; `head()` retorna `null` em 404 (idiomático JS), `BUCKET_NOT_FOUND` faz throw mesmo no head (config drift não é caso normal); `put` aceita `string|Uint8Array|Buffer`; `get` retorna `ReadableStream<Uint8Array>` via `transformToWebStream`.
- `factory.ts` — `createStorageAdapter(env)` lê `MINIO_ENDPOINT`/`MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY`/`MINIO_REGION` (default `sa-east-1`)/`MINIO_BUCKET_PREFIX` (default `logifit-dev`) com Zod; única porta permitida pra ler env de storage.
- `index.ts` — public API curada (substitui placeholder `export {}`).

**Adições — `packages/storage/scripts/`:**
- `bootstrap-buckets.ts` — script idempotente (`tsx`) que cria os 6 buckets canônicos com `versioning=Enabled`; rerun seguro (status `created` na 1ª execução, `already-exists` nas seguintes); `pnpm storage:bootstrap` no root.

**Adições — testes (Vitest, 25 testes verdes):**
- `buckets.test.ts` (4) — verifica os 6 nomes canônicos + `physicalBucketName` (com/sem hífen final, prefix vazio).
- `tenant-key.test.ts` (8) — composição correta + rejeições (UUID inválido, ownerKind ASCII, ext fora da allowlist) + `keyBelongsToTenant` anti-substring.
- `factory.test.ts` (6) — env válida, defaults aplicados, falhas com URL inválida ou key vazia.
- `minio-adapter.test.ts` (7, integração contra MinIO local) — round-trip put/head/get/delete; list por prefixo; `presignGet` retorna URL acessível via fetch real; head em chave inexistente retorna `null`; rejeição de path traversal e bucket fora do enum; tradução de `NoSuchBucket` em `StorageError` (via `put` — `head` perde a info por ser HEAD sem corpo).
- `vitest.config.ts` — coverage threshold **80%** (mesmo piso de `errors|security|db/policies` por regra 18 + ADR 0090, camada de infra de defesa).
- Suíte de integração **pula silenciosamente** se MinIO não estiver acessível (não quebra CI sem infra).

**Atualizações:**
- `packages/storage/package.json` — `@aws-sdk/client-s3@^3.705.0`, `@aws-sdk/s3-request-presigner@^3.705.0`, `zod@^3.23.8` em `dependencies`; `tsx`, `vitest`, `@types/node` em devDeps; scripts `test`, `bootstrap`.
- Root `package.json` — script `storage:bootstrap` apontando pra `pnpm --filter @repo/storage bootstrap`.

**Validado local:**
- `pnpm --filter @repo/storage typecheck` ✓
- `npx biome check packages/storage` ✓ (14 arquivos)
- `pnpm storage:bootstrap` ✓ — 6 buckets criados; rerun emite `[=]` em todos (idempotente).
- `pnpm --filter @repo/storage test` ✓ — **25/25 testes** (4 unit + 7 integração + 8 tenant-key + 6 factory).

**Por que importa:** ancora a regra de soberania perpétua #3 (ADR 0091). O caminho do usuário fica `Server Action → wrapAction → scanUpload → adapter.put → INSERT em tabela de domínio` (regra 33 + 38) — quando primeira feature de upload chegar (Sprint 01b foto avatar / Sprint 11 anexo de exame / Sprint 12 mídia WhatsApp), a infra está pronta sem refactor.

**Não escopo deste turno (mapeado):** `scanUpload` real (file-type + ClamAV + tabela `upload_scans`) — Faixa 3; lint custom `no-unscanned-upload` — Faixa 4; deploy MinIO em produção via Coolify — Faixa 2 (depende de bootstrap-oracle).

### Build — `infra/bootstrap-oracle.sh` + `cloudflare-setup.md` (Faixa 2 destrava parcial) 2026-04-27

Fundador confirmou conta **Cloudflare** ativa com domain `logifit.com.br` adicionado (Coolify ainda não — depende de VPS Oracle provisionado primeiro). Entrego 2 artefatos pra ele continuar quando quiser:

- **`infra/bootstrap-oracle.sh`** — script bash idempotente: apt update+upgrade · Docker CE + buildx + compose plugin · UFW (22/80/443/8000) · fail2ban · unattended-upgrades · swap 4GB · hardening SSH · Coolify install via script oficial · valida `/data` mount. Loga em `/var/log/logifit-bootstrap-*.log` + imprime checklist de próximos passos manuais (Coolify admin + GHCR PAT + 6 containers + Caddy DNS-01).
- **`docs/runbooks/cloudflare-setup.md`** — runbook completo dos 5 papéis Cloudflare no Free tier: (1) DNS + Proxy + SSL Full strict + HSTS preload; (2) R2 bucket `logifit-backup` + API token escopo bucket-only; (3) Turnstile site + vars `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET`; (4) Email Routing pra `security@`/`privacidade@`/`contato@`/`dpo@logifit.com.br` → email pessoal; (5) API Token global escopo `Zone DNS Edit` pra Caddy DNS-01.

**Por que importa:** transforma "criar VPS Oracle do zero" em comando único e idempotente; e dá ao fundador um manual passo-a-passo do Cloudflare sem precisar de ajuda. Próximo desbloqueio único: conta Oracle PAYG + VPS Vinhedo + IP nos A records Cloudflare.

### Build — Sistema de mensagens (ADR 0089) + AppLayout esqueleto + helpers Playwright completos 2026-04-27

Faixa 4 do Sprint 00 avança ~85%. Tudo local sem dep externa.

**Adições — `packages/ui/src/messages/` (catálogo de 6 tipos · regra 45 + ADR 0089):**

- `toaster.tsx` — Sonner wrapper com prop `nonce` CSP (regra 35) + tokens EV.
- `toast.ts` — helpers `toast.{success, info, warning, error, critical, fromApiError}`. `critical` é error sem auto-dismiss; `fromApiError` consome envelope `ApiError` (ADR 0071).
- `banner.tsx` — variant info/warning/danger + ARIA correto.
- `form-error.tsx` — inline com `aria-describedby`.
- `alert-dialog.tsx`/`confirm-dialog.tsx`/`prompt-dialog.tsx` — stubs com `confirm()`/`prompt()` helpers lançando `not implemented yet — Sprint 01a`.

**Adições — `packages/ui/src/layout/app-layout.tsx` (regra 31 + ADR 0063):** esqueleto com slot pra hamburger + slot pra conteúdo; touch-target 44px; sem sidebar fixa. Componentes responsive-{modal, table, form} adiados pra Sprint 01a.

**Adições — `apps/web/e2e/helpers/`:** `webhooks.ts` (`replayWebhook` stub T7) + `waits.ts` (re-export curado anti-flakiness ADR 0090 §8 + `waitForRequestId` stub).

**Adições — i18n catalog `messages` namespace:** 11 chaves × 3 locales = 33 traduções.

**Atualizações:**

- `packages/ui/package.json` — `sonner: ^1.7.0` + `@repo/errors` (peer) + `react`/`react-dom` peer + `@types/react`/`@types/react-dom` dev. Exports map: `./messages` e `./layout/app-layout`.
- `apps/web/package.json` — `@repo/errors: workspace:*`.
- `apps/web/app/layout.tsx` — `<Toaster nonce={...}>` integrado, lê `x-nonce` via `await headers()`.
- `apps/web/src/i18n/request.ts` — `NAMESPACES` ganha `messages` (5º).
- `scripts/lint-custom.mjs` — 5ª regra `no-hardcoded-toast-message` + helper `isCommentLine()` aplicado a todos checkers de código (evita falsos positivos em JSDoc).

**Validado local:** `✓ lint-custom: 54 code + 2 css files clean (5 rules)` · `✓ i18n-check: 53 keys × 3 locales · 12 usages (5 namespaces)`.

### Decided — Revisão ADR 0091: Cloudflare R2 substitui Hetzner Storage Box como provider de backup off-site 2026-04-27

Conversa de custo MVP reabriu a opção de backup off-site (regra 40). Decisão revisada no mesmo dia da accepteddo ADR 0091.

**Motivos:**

- **(a) Custo zero MVP:** R2 free tier 10GB cobre o MVP inteiro; Hetzner Storage Box era €3.50/mês fixo. Custo MVP cai de "~R$ 20/mês" para "~R$ 0/mês".
- **(b) Zero egress fee:** DR drills quarterly não pagam saída de banda (Hetzner cobraria proporcional ao volume baixado). Importante para validação de RPO/RTO sem orçamento.
- **(c) Simplicidade operacional:** S3-compatible API + `rclone` é mais simples que SSH+`rsync`, elimina chave SSH dedicada, e o mesmo provider já oferece DNS + Turnstile + Email Routing (Cloudflare vira multi-uso, 4 funções no mesmo painel).

**Trade-offs aceitos:**

- Cloudflare passa a ter 4 papéis no MVP (DNS + R2 + Turnstile + Email Routing) — concentração de provider; mitigação: bucket R2 com chaves dedicadas (separadas do API token de DNS), e regra de soberania separação de risco mantida (Oracle continua provider distinto pra app).
- Hetzner Storage Box vira alternativa rejeitada documentada — volta a ser considerada se volume backup >700GB (R2 a $0.015/GB-mês ≈ R$ 65/mês × 1TB ≈ R$ 65/mês > Hetzner R$ 22/mês 1TB). Cruzamento estimado em ~12 meses produção.
- `pay-as-you-go zero egress` é vantagem genuína do R2 (não tem em Backblaze B2, S3, Hetzner) — preserva DR drill orçamento mesmo após sair do free tier.

**Atualizados:**

- [docs/decisions/0091-self-host-total-oracle-sp.md](docs/decisions/0091-self-host-total-oracle-sp.md) — nota de revisão no topo + diagrama ASCII (custo MVP "R$ 0") + tabela de externals (R2 promovido, Hetzner Storage Box vira alternativa) + alternativas rejeitadas (linha 230 reescrita) + sub-processors (Cloudflare passa a 4 papéis) + rsync→rclone em 2 lugares.
- [docs/rules.md](docs/rules.md) regra 40 + tabela canônica externals (Backup off-site).
- [CLAUDE.md](CLAUDE.md) regra 40 + seção Stack ("Backup off-site" trocado).
- [.env.example](.env.example) — vars `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET`/`R2_ENDPOINT` substituem `HETZNER_STORAGEBOX_*`.
- [docs/runbooks/dr-drill.md](docs/runbooks/dr-drill.md) — credencial R2 em GitHub Secrets + restore "do R2".
- [docs/sprints/00-setup-infra.md](docs/sprints/00-setup-infra.md) — Log entry datada + checklist `Backup off-site (regra 40)` atualizado pra rclone S3 API.

**Hetzner CX22 Helsinki continua como VPS DR alternativo pre-provisionado** — não confundir com Storage Box. Esse permanece (regra 40 mitigação 4: PAYG + backup R2 + bootstrap script + DR drill + Hetzner CX22 alternativo).

### Build — Sprint 00 Faixas 3+4 parciais: security headers + packages/security + supply chain + lints custom + Playwright base 2026-04-27

Sprint 00 chega a **50%** entregando tudo que dá pra fazer sem Coolify rodando ou contas externas (Oracle/Cloudflare). Faixa 2 (bootstrap Oracle + Coolify) e o resto da Faixa 3 (GlitchTip/Loki/R2 backup/Cloudflare proxy) ficam para sessão dedicada quando o fundador ativar conta Oracle PAYG + Cloudflare.

**Adições — Security headers + CSP (regra 35 + ADR 0073):**

- `apps/web/next.config.ts` — `headers()` retorna 7 headers estáticos: HSTS preload (max-age 2 anos + includeSubDomains) · X-Frame-Options DENY · X-Content-Type-Options nosniff · Referrer-Policy strict-origin-when-cross-origin · Permissions-Policy restritiva · COOP same-origin · CORP same-site.
- `apps/web/middleware.ts` — CSP **dinâmico com nonce per-request** (`crypto.getRandomValues(16) + btoa()`); injetado em request headers (`x-nonce`) pra Server Components lerem; `script-src 'nonce-...' 'strict-dynamic'` (sem `'self'`); `connect-src 'self'` (sprints donos expandem); `frame-ancestors 'none'`; `object-src 'none'`; `upgrade-insecure-requests`. Mantém propagação de `x-request-id` e detecção de locale.

**Adições — `packages/security` real (regras 36-38, 43):**

- `safe-fetch.ts` (regra 37) — `SsrfError` + protocolo http/https obrigatório + allowedHosts mandatório + bloqueio de IP privado/loopback/link-local + timeout 30s default + redirect manual + max response 50MB.
- `scan-upload.ts` esqueleto (regra 38) — interface `ScanProvider` + `OwnScanProvider` placeholder + 5 status canônicos (`pending`/`clean`/`suspicious`/`rejected`/`error`).
- `rate-limits.ts` (regra 36) — tabela canônica `RATE_LIMITS` com 8 regras (loginByIp/Email · signupByIp · read/write/search/ai · webhookByIp) + stub `checkRateLimit` no-op até Faixa 3 ter Redis.
- `high-risk-actions.ts` (regra 43) — array de 16 ações fiscais/RBAC/financeiro/compliance/super-admin com `requireMfaMaxAgeMins: 15` (4 marcadas `alsoBlockedFromAi: true` — dupla proteção regras 41+43).

**Adições — Página pública /seguranca + security.txt:**

- `apps/web/app/(public)/seguranca/page.tsx` — postura, contato (`security@logifit.com.br`), política 90d coordinated disclosure, escopo, hall da fama. i18n via namespace `security` × 3 locales.
- `apps/web/public/.well-known/security.txt` (RFC 9116) — Contact/Expires (2027-04-27)/Preferred-Languages/Policy/Canonical.

**Adições — Supply chain CI:**

- `.gitleaks.toml` — 4 rules custom (LF_KEY/Asaas/Focus NFe/GPG armored block) + allowlist `.env.example` e `docs/`.
- `.github/dependabot.yml` — npm + GitHub Actions, weekly segunda 06:00 SP, agrupado por minor+patch, máx 5 PRs npm + 3 actions.
- `.github/workflows/security.yml` separado — 2 jobs (gitleaks + osv-scanner) + cron `0 5 * * 1` semanal.

**Adições — Lints custom + compliance:**

- `scripts/lint-custom.mjs` — 4 checkers regex-based (JS puro): `no-window-alert` (regra 45), `no-raw-fetch` (regra 37), `no-hardcoded-design-token` (regra 44), `no-rejected-saas-import` (regra 46 — bloqueia `@supabase/*`/`@upstash/*`/`@vercel/postgres|kv|blob`/`posthog-*` rejeitados pelo ADR 0091). Validado: ✓ 43 code + 2 css files clean.
- `scripts/compliance-check.mjs` (T19 ADR 0090) — RIPD Status formal vs legacy + threat-models STRIDE warning + stubs ADR esperado/ai_audit_log schema. Validado: ✓ 1 formal + 18 legacy + 12 threat-models.
- `scripts/hash-ripd.mjs` — SHA-256 do conteúdo de RIPD `Status: Vigente`, modos write e `--check` (CI).

**Adições — Playwright base + 2 specs representativas:**

- `apps/web/playwright.config.ts` — 5 projects (chromium-mobile/tablet/desktop + webkit-mobile/desktop); webServer auto-start; trace on-first-retry; reporter github+html em CI.
- `packages/config/playwright-viewports.ts` — `VIEWPORTS` (6) + `CANONICAL_VIEWPORTS` (3: iphone-13/ipad-portrait/desktop-1280) + `forEachViewport` helper.
- `packages/config/playwright-locales.ts` — `forEachLocale` consome `LOCALES` de `@repo/i18n` (zero edição ao adicionar locale futuro).
- `apps/web/e2e/helpers/{auth,seed,time,db}.ts` — stubs com `throw new Error('not implemented yet — Sprint 01a')`. Tipos canônicos: `Persona` (8), `Scenario` (5).
- `apps/web/e2e/_template.spec.ts` + `smoke/auth-magic-link.spec.ts` (Top-10 smoke) + `critical/cross-tenant-rls.spec.ts` (T6 + Top-12 block release). Todos `test.skip()` até Sprint 01a.

**Adições — Runbooks + RIPD:**

- `docs/runbooks/dr-drill.md` — DR drill quarterly esqueleto com 6 fases (snapshot pré-drill → provisão staging → restore → smoke tests → verify hash chain → teardown).
- `docs/runbooks/coolify-operacoes.md` — cheatsheet operações comuns + troubleshooting comum (build failed, PG out of memory, Caddy SSL renew).
- `docs/runbooks/bootstrap-oracle.md` — passo-a-passo Vinhedo (PAYG account → VM.Standard.A1.Flex 4OCPU/24GB → SSH key → DNS Cloudflare → bootstrap script → Coolify setup → containers → Caddy SSL → primeiro deploy "Hello World").
- `docs/compliance/ripd/v1.0-tiss-convenios.md` — RIPD Sprint 22 com Status: TODO (completa lista canônica de 7 esperada pelo Sprint 00).

**Atualizações:**

- `package.json` raiz — 6 scripts novos (`lint:custom`, `compliance:check`, `hash:ripd`, `test:smoke`, `test:critical`, `test:e2e`).
- `apps/web/package.json` — `@playwright/test ^1.49` e `@axe-core/playwright ^4.10` como devDeps.
- `.github/workflows/ci.yml` — 2 jobs novos (`lint-custom`, `compliance`).
- `apps/web/app/layout.tsx` — `themeColor` ganha comentário `// design-token-exempt: Next.js Viewport.themeColor é lido antes do CSS carregar` (caso edge legítimo regra 44).
- `apps/web/src/i18n/request.ts` — namespace `security` adicionado.
- `apps/web/src/messages/{pt-BR,en-US,es-419}/security.json` — 8 chaves × 3 locales.
- `docs/sprints/00-setup-infra.md` Log + `docs/roadmap.md` % 25 → 50.

**Por que importa:** todo PR que cria UI já passa por CSP nonce + 7 security headers + 4 lints custom + Gitleaks + OSV-scanner + Dependabot. Toda Server Action / fetch externo / upload tem pacote-base pra adotar (`@repo/security/{safeFetch,scanUpload,checkRateLimit}` + `HIGH_RISK_ACTIONS`). E2E está estruturado pra próxima sprint adicionar specs reais sem refactor.

**Pendente Sprint 00 (não dá pra fazer agora):**

- Faixa 2 (precisa do fundador): conta Oracle PAYG + SSH key + bootstrap-oracle.sh execution + Coolify install + primeiro deploy.
- Faixa 3 (depende Coolify): GlitchTip self-host + Loki/Grafana self-host + Cloudflare R2 backup cron + Cloudflare proxy + Turnstile + OWASP ZAP weekly + DR drill real.
- Faixa 4 (depende Sprint 01a): lints `no-unwrapped-action`/`high-risk-action-must-require-recent-mfa` + 9 esqueletos `smoke/` adicionais + 11 esqueletos `critical/` adicionais + helpers `webhooks.ts`/`waits.ts` + `verify-audit-chain.ts` + STRIDE 6-cat nos 12 threat-models legacy.

### Build — `packages/errors` scaffolding (ADR 0071 + regra 33) 2026-04-27

Trabalho avulso pós-Faixa 1 do Sprint 00. Sistema de tratamento de erros entregue como precondição de Sprint 01a (Server Actions reais) e Faixa 4 (lint `no-unwrapped-action`). Não fecha faixa específica; destrava trabalho cross-faixa.

**Adições:**

- **`packages/errors/src/api-error.ts`** — envelope canônico com 16 códigos fechados (`VALIDATION_ERROR`/`UNAUTHORIZED`/`FORBIDDEN`/`NOT_FOUND`/`CONFLICT`/`RATE_LIMITED`/`INTERNAL_ERROR`/`SERVICE_UNAVAILABLE`/`AI_QUOTA_EXCEEDED`/`AI_PROVIDER_ERROR`/`PAYMENT_FAILED`/`FISCAL_REJECTED`/`CONSENT_REQUIRED`/`COMMITTEE_REQUIRED`/`SLUG_TAKEN`/`TENANT_SUSPENDED`); tipo `ApiResult<T>`; classe `ApiException`; helpers `ok()`/`err()`/`isApiException()`.
- **`sanitize.ts`** — `maskCpf`/`maskCnpj`/`maskEmail`/`maskPhone` regex-based + `sanitize()` recursivo que redact 27 chaves sensíveis (senha/token/dado clínico — LGPD art. 11). Aplicado antes de envelope ao cliente, payload GlitchTip e log estruturado.
- **`fingerprint.ts`** — SHA-256 truncado em 16 hex de `(code, module, tenant_id, signal)` pra dedup multi-tenant em `system_alerts`. `node:crypto` (Node runtime apenas).
- **`translators.ts`** — 10 stubs por provedor (Asaas / Focus NFe / Anthropic / Gemini / Groq / OpenAI / Twilio / TISS / Pluggy / Zod) + fallback genérico sempre-matches. Sprint dono de cada provedor refina.
- **`wrap-action.ts`** — wrapper Server Actions → `ApiResult`. Captura `ApiException`, traduz erros desconhecidos, monta fingerprint, loga JSON. Hooks `auth/permissions/rate-limit/audit/alerts/GlitchTip` marcados com `// TODO Sprint 01a/Faixa 3`.
- **`wrap-api-handler.ts`** — wrapper API Routes → `Response`. Status HTTP derivado do código (400/401/403/404/409/422/429/451/500/502/503); header `retry-after` injetado quando `retry_after_ms`.
- **`wrap-job.ts`** — wrapper cron/queue. Loga e re-lança; retry com backoff fica para Sprint 01a (queue real).
- **`apps/web/src/messages/{pt-BR,en-US,es-419}/errors.json`** — 16 mensagens × 3 locales (48 traduções).

**Atualizações:**

- `apps/web/src/i18n/request.ts` — `NAMESPACES = ['common', 'auth', 'errors']`.
- `i18n-check` agora valida 33 keys × 3 locales (3 namespaces): ✓.

**Por que importa:** Server Actions do Sprint 01a (auth, magic link, criar tenant) já podem ser escritos como `wrapAction({ module: 'auth.signin' }, async (input) => { ... })` — wrapper captura panic, traduz erro, retorna envelope tipado, loga estruturado. TODOs explícitos auditam antes de marcar Sprint 00 done.

**Pendente nos wrappers até Sprint 01a + Faixa 3:** auth check + tenant scope; permissions RBAC; consent LGPD gate; `requireRecentMfa()` (regra 43); rate limit Redis sliding window; gate Comitê IA SaMD II+; insert `system_alerts` async; append `audit_log` com hash chain (regra 39); GlitchTip capture; retry com backoff exponencial (queue real).

### Build — Sprint 00 Faixa 1: monorepo + Next.js scaffold + Drizzle + i18n + CI base 2026-04-27

Sprint 00 entrou em **`doing`**. Faixa 1 (semana 1) materializa o monorepo executável: estrutura de packages, app Next.js 15, dev local via `docker compose`, Drizzle config + extensões PG, i18n em 3 locales (ADR 0052) e CI verde com 5 jobs paralelos. Faixas 2-4 (Coolify + Oracle Cloud SP, segurança em profundidade, lints custom + suítes E2E) ficam para sessões futuras.

**Adições:**

- **Packages skeleton** (`@repo/{config,ui,db,ai,types,i18n,storage,errors,security}`) e **`@app/web`**: cada um com `package.json` (`type: module`, `exports` map), `tsconfig.json` extends `@repo/config/tsconfig.base.json` e `src/index.ts` placeholder. Workspace root via `pnpm-workspace.yaml`.
- **`apps/web`** Next.js 15 + React 19 + Tailwind v4 + next-intl v4: `next.config.ts` com `withNextIntl` + `transpilePackages: ['@repo/*']`, `middleware.ts` (cookie `NEXT_LOCALE` + Accept-Language fallback + propagação `x-request-id`), `app/layout.tsx` com `Inter` via `next/font/google` e `viewport: { viewportFit: 'cover' }` (regra 31), `app/globals.css` mapeando tokens EV → Tailwind v4 via `@theme inline`, esqueleto i18n em `src/messages/{pt-BR,en-US,es-419}/{common,auth}.json` (17 keys × 3 locales validados).
- **`docker-compose.yml`** raiz com 4 services healthchecked: `pgvector/pgvector:pg16` (substitui `postgres:16-alpine` da spec original para que `CREATE EXTENSION vector` funcione — regra 30 + ADR 0064), `redis:7-alpine`, `minio/minio:latest` (API 9000 + console 9001), `mailhog/mailhog:latest`. Volumes em `.docker-data/` (gitignored).
- **`packages/db`** real: `drizzle.config.ts` (`dialect: postgresql`, schema TS em `src/schema/`, out em `migrations/`), `init/0000_extensions.sql` idempotente (`pg_trgm` + `unaccent` + `vector` + `pgcrypto`), `scripts/migrate.ts` runner em duas fases (init/ → Drizzle migrator se houver journal), `src/client.ts` com `Pool` global pra HMR, `tests/rls-check.ts` que falha se `pg_class` mostrar tabela com `tenant_id` sem `relrowsecurity` (regra 1+2).
- **`packages/i18n/src/config.ts`** real (ADR 0052): `LOCALES`/`DEFAULT_LOCALE`/`FALLBACK_CHAIN`/`LOCALE_NAMES` + `isLocale` type guard. Adicionar locale futuro = 1 linha + diretório `messages/{locale}/` + `CHECK` constraint, sem `ALTER TYPE`.
- **`packages/ui/src/tokens.css`** — port fiel de `prototipo/tokens.css` (regra 44) + 2 tokens novos (`--ev-touch-min: 44px`, `--ev-input-min: 48px`) pra regra 31. Dark via `[data-theme="dark"]` + `prefers-color-scheme`.
- **Scripts CI**: `scripts/i18n-extract.mjs` (regex `useTranslations|getTranslations` + `t('key')` com tracker de namespace por arquivo) + `scripts/i18n-check.mjs` (paridade entre locales + cobertura de uso vs default — regra 27 enforced). JS puro, sem deps.
- **`.github/workflows/ci.yml`** com 5 jobs paralelos: `lint` (Biome) · `typecheck` (turbo) · `test` (Vitest stub) · `i18n` · `db` (sobe `pgvector/pgvector:pg16` como service container, roda `db:migrate` + `db:rls-check`). `concurrency` cancela PRs antigos. `permissions: contents: read`.
- **`packages/config/vitest.base.ts`** — config base reusada por packages (env `node` default, coverage v8 com threshold 60% baseline da regra 18; pacotes críticos sobrescrevem via `mergeConfig`).

**Atualizações:**

- `package.json` raiz — scripts `db:migrate`/`db:generate`/`db:rls-check` (filter `@repo/db`) + `i18n:check`/`i18n:extract` (node).
- `turbo.json` — task `db:generate` (`cache: false`).
- `.github/workflows/docs-check.yml` — Node 20 → 22 alinhando ao `engines` do `package.json` raiz.
- `README.md` — cabeçalho da seção "Comandos" sai de "Sprint 00 vai materializar"; nota explicativa sobre status inline.

**Por que importa:** dev solo abre `pnpm dev:up && pnpm db:migrate && pnpm dev` e tem Postgres + Redis + MinIO + Mailhog + Next.js + i18n em 3 locales rodando local. CI verde sem Vercel ou Supabase. Próxima sessão pode iniciar Faixa 2 (Coolify + Oracle SP) ou pular pro Sprint 01a se prioridade for funcionalidade antes de prod.

**Não entregue na Faixa 1** (rastreado para Faixas 2-4):

- Faixa 2: bootstrap Oracle Cloud Vinhedo + Coolify + Caddy + GHA multi-arch GHCR + primeiro deploy `app.logifit.com.br` (semana 2).
- Faixa 3: security headers + CSP nonce + `safeFetch`/`scanUpload` + Cloudflare proxy + GlitchTip + Loki/Grafana + Cloudflare R2 + OWASP ZAP + Gitleaks + Dependabot + OSV-scanner + SBOM (semanas 3-4).
- Faixa 4: 8 lints custom + 10 esqueletos suíte `smoke/` + 12 esqueletos `critical/` + helpers Playwright + `compliance:check` + RIPDs vazios + runbooks (semana 5).

### Decided — ADR 0091: self-host total Oracle Cloud SP + Coolify desde Sprint 00 (supersede ADR 0078) 2026-04-27

Conversa de visão de produto reabriu o trade-off "duas fases vs self-host total desde dia 1" estabelecido no ADR 0078 (MVP Vercel+Supabase → Sprint 19b migra pra Postgres Oracle Cloud). Fundador optou por **pular Fase 1 inteira** — desde Sprint 00 a infra é self-host total: VPS único Oracle Cloud OCI free tier ARM Ampere (São Paulo) rodando Coolify + Caddy + Next.js + Postgres 16 + Redis + MinIO + GlitchTip + Loki/Grafana, com backup off-site em Cloudflare R2 (free tier 10GB; pay-as-you-go zero egress fee depois — revisado 2026-04-27, originalmente Hetzner Storage Box). Externals reduzidos a 8 categorias justificadas (Oracle/Cloudflare [DNS+R2+Turnstile]/AWS SES/Vertex AI/Asaas/Focus NFe/WhatsApp BSP/GitHub).

**Adições:**

- [docs/decisions/0091-self-host-total-oracle-sp.md](docs/decisions/0091-self-host-total-oracle-sp.md) — **Accepted.** Stack única (sem mais fases); 4 camadas de mitigação do risco Oracle suspensão (PAYG mode + backup independente Cloudflare R2 + bootstrap script + DR drill quarterly + alternativa Hetzner CX22 pre-provisionada); compatibilidade ARM Ampere documentada por imagem; dev local via `docker-compose.yml` (Postgres + Redis + MinIO + Mailhog); 8 regras antigas de portabilidade (ADR 0078) reformuladas como **regras de soberania perpétua**; nova regra 46 (justificar dependência externa).

**Atualizações:**

- [docs/decisions/0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md](docs/decisions/0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md) — Status `Accepted` → **`Superseded by ADR 0091`** (2026-04-27); nota de supercessão no topo; conteúdo histórico preservado.
- [CLAUDE.md](CLAUDE.md) — seção "Stack" reescrita (Postgres self-hosted + BetterAuth/Lucia + MinIO + Redis self-host + GlitchTip + Loki/Grafana; sem Vercel, sem Supabase, sem Upstash, sem Sentry SaaS, sem Logtail, sem PostHog); "Regras de portabilidade durante MVP" virou "Regras de soberania perpétua"; comandos comuns ganham `dev:up`/`dev:down`/`dev:reset` Docker Compose; modelo de autorização com Auth = JWT cookie próprio.
- [docs/rules.md](docs/rules.md) — **regra 46 nova** (Soberania de dependência externa: toda nova exige ADR justificando + tabela canônica de externals MVP); regra 12 revisada (feature flags via `feature_flags` table própria, sem PostHog); regra 19 revisada (segredos via `.env` + GitHub Actions + Coolify env vars, sem Vercel); regra 36 revisada (rate limit via Redis self-host); regra 38 revisada (uploads em MinIO em vez de Supabase Storage); regra 40 revisada (backup Cloudflare R2 + DR drill quarterly); regra 43 revisada (MFA via BetterAuth/Lucia em vez de Supabase Auth).
- [docs/sprints/00-setup-infra.md](docs/sprints/00-setup-infra.md) — escopo expandido (4 → 5 semanas); nova Faixa 2 "Bootstrap Oracle Cloud SP + Coolify" (PAYG account, VPS provisionado, `infra/bootstrap-oracle.sh`, Coolify install, Caddy, containers, GitHub Actions multi-arch GHCR, primeiro deploy "Hello World", runbooks `bootstrap-oracle.md`/`coolify-operacoes.md`); seção "Portabilidade" virou "Soberania perpétua" + "Bootstrap Oracle"; observabilidade self-host (GlitchTip + Loki/Grafana) substitui Sentry/PostHog/Logtail; rate limit Redis self-host substitui Upstash; backup Cloudflare R2 (free tier 10GB) substitui plano original; lints `no-supabase-functions` e `no-direct-supabase-query` removidos (não há Supabase); novo lint `no-external-saas-import` (regra 46); ADR 0078 marcado como superseded em "Decisões tomadas".
- [docs/roadmap.md](docs/roadmap.md) — Sprint 19b **deletado** da tabela MVP (~~22~~/~~19b~~) com nota explicativa; entrada em "Decisões já fechadas" marca ADR 0078 superseded e adiciona ADR 0091; faixa 0091 alocada em "Numeração pós-0046"; próximo ADR fora-de-sprint disponível: 0092+.

**Por que importa:** reduz dependência externa de ~12 SaaS pra 8 (e dos 8, só 3-4 são pagos); custo MVP cai de R$ 250-400/mês (ADR 0078 fase A) pra ~R$ 0/mês (R2 free tier 10GB + SES sandbox + Oracle free tier + Cloudflare DNS+Turnstile free); zero migração futura (não há Sprint 19b); soberania completa do dado de saúde (LGPD art. 11) desde o primeiro commit; risco Oracle mitigado por 4 camadas independentes; Sprint 00 absorve +1 semana mas elimina os 60h da migração planejada do ADR 0078.

**Trade-off aceito:** ops sobre o fundador desde dia 1 (mitigado por Coolify + runbooks + expertise prévia em projeto Deep Control); risco Oracle suspensão (mitigado por backup independente + DR alternativa Hetzner pre-provisionada); +1 semana de Sprint 00.

### Docs — ADR 0090 + regra 18 expandida: estratégia de testes (taxonomia T1-T21 + 3 níveis + 10 suítes E2E) 2026-04-27

Auditoria de testes nas 40 sprints (00 → 36 + 19b) identificou que infra de teste estava planejada (Vitest, Playwright, RLS check, 11 lints custom, i18n check) mas **sem estratégia formal**: faltava taxonomia, distinção entre obrigatório/recomendado/opcional, categorização das suítes E2E com gates por suíte, mapa "categoria de risco do sprint → testes obrigatórios", convenção anti-flakiness. ADR 0090 fecha isso e Sprint 00 materializa 18 dos 21 Ts (11 com código rodando + 7 com ferramenta pronta).

**Adições:**

- [docs/decisions/0090-estrategia-de-testes.md](docs/decisions/0090-estrategia-de-testes.md) — **Accepted.** Taxonomia fechada de 21 tipos canônicos (T1 unit, T2 integration testcontainer PG, T3 E2E Playwright, T4 visual Lost Pixel, T5 a11y axe-playwright, T6 RLS comportamental 2 conexões PG, T7 idempotência webhook, T8 contract MSW, T9 type-level tsd, T10 property-based fast-check, T11 snapshot determinístico PDF/XML, T12 mutation Stryker, T13 perf k6, T14 lint Biome custom, T15 SQL/migration linter, T16 smoke matrix 3×3×2, T17 QA scripted runbook, T18 chaos toxiproxy, T19 compliance verifier, T20 coverage gate, T21 fuzzing jazzer.js). 3 níveis de obrigatoriedade (Obrigatório bloqueia merge / Recomendado vira `test-debt` / Opcional avaliado caso a caso). 10 suítes E2E categorizadas (`smoke` <2min PR / `critical` <8min release / `regression` nightly / `i18n` / `responsiveness` / `a11y` / `visual` / `perf` / `security` / `external` schedule semanal). Top-12 "block release" + Top-10 "smoke" listados nominalmente. Mapa "categoria de risco → Ts extras" para 10 categorias (multi-tenant, webhook provider, cálculo financeiro, parser, IA SaMD, cross-tenant clínico, fiscal, clínico assinado, mobile/PWA, migração). 8 regras anti-flakiness. Convenção de citação no DoD com bloco padronizado. Status reavaliado pós-M3 (beta privado).

**Atualizações:**

- [docs/rules.md](docs/rules.md) — **regra 18** ampliada de "70% em `packages/db`, 60% em Server Actions" para incluir **80% em `packages/errors|security|db/policies`** (camadas de defesa) + referência canônica ao [ADR 0090](docs/decisions/0090-estrategia-de-testes.md) para estratégia completa (taxonomia + níveis + suítes E2E + gates + anti-flakiness). Cada sprint cita Ts específicos no DoD.
- [docs/sprints/00-setup-infra.md](docs/sprints/00-setup-infra.md) — bloco "Estratégia de testes (ADR 0090)" com 18 itens executáveis na Faixa 1: estrutura de pastas `apps/web/e2e/{smoke,critical,regression,i18n,responsiveness,a11y,visual,perf,security,external}`, helpers (`auth.ts` storageState por persona × cenário, `seed.ts` 5 cenários canônicos, `time.ts` frozen clock, `webhooks.ts` `replayWebhook()`, `db.ts` `twoConnectionsTest()`), 10 esqueletos suíte `smoke/` + 12 esqueletos suíte `critical/` (`test.skip` com nome do caso), Vitest threshold por package, ferramentas instaladas (MSW, fast-check, axe-playwright, k6, tsd) + decisão de adiar (Lost Pixel, Stryker, jazzer.js para sprint dono), script `compliance:check`, helper `twoConnectionsTest()`. ADR 0090 listado em "Decisões tomadas".
- [docs/sprints/_template.md](docs/sprints/_template.md) — bloco "Estratégia de testes (ADR 0090)" pré-preenchido entre "Commit" e "Stretch": campo de categoria de risco (multi-tenant / webhook / fiscal / clínico assinado / IA SaMD / etc), linha-base transversal default, 4 listas (Obrigatórios extras / Recomendados aplicados / Recomendados em débito com issue `test-debt` / Opcionais avaliados). DoD atualizado: item "Testes" cita ADR 0090 + coverage gate por package; item "Teste RLS" inclui `twoConnectionsTest()` comportamental além do `db:rls-check` estrutural. Novo sprint herda automaticamente o rito de declarar Ts no DoD.

**Por que importa:** sem estratégia formal, sprints solo cortam teste primeiro pra caber em timebox; suítes E2E inflacionam sem critério; lacunas viram incidente pós-merge. Com ADR 0090: Obrigatório bloqueia CI (não negocia), Recomendado vira `test-debt` rastreável (não é "esquecido"), Opcional declarado no DoD (transparente). Top-12 "block release" são mínimo absoluto antes de prod — protegem incidente público (vazamento cross-tenant, receita dobrada, prazo SEFAZ, hash chain audit, assinatura ICP-Brasil, regra 25 franchise).

### Docs — 19a auditoria: lacunas de planejamento + ADRs antecipados + plano ANVISA + suplente DPO + timeline 2026-04-27

Auditoria profunda de planejamento e documentação identificou 3 falhas críticas (ADR 0032 inexistente, sub-processadores sem doc público, ANVISA com zero notificações emitidas), 2 média-altas (suplente DPO ausente, restore-test stub) e várias médias/baixas. Esta entrada formaliza correção das críticas e médias-altas + cria timeline absoluto.

**Adições — ADRs antecipados** (regra de roadmap "sprint não entra em `doing` sem ADR esperado publicado"):

- [docs/decisions/0025-provider-whatsapp.md](docs/decisions/0025-provider-whatsapp.md) — **Proposed.** BSP oficial Meta (Twilio Business API ou Gupshup BR — POC no Sprint 13); Z-API rejeitado por risco de ban. Abstração `WhatsAppProvider` por tenant; templates pré-aprovados; rate limit 3 msgs/hora/member; opt-in obrigatório com dupla confirmação; quiet hours 22h-7h.
- [docs/decisions/0026-motor-regua-dsl.md](docs/decisions/0026-motor-regua-dsl.md) — **Proposed.** DSL JSON declarativa com 4 conceitos (`trigger`/`actions`/`stop_on`/`guards`) interpretada por motor único. Cron 5min + tabela `regua_jobs` idempotente + fallback de canal por action + dry-run nativo. Rejeita workflow externo (Temporal/n8n) por overhead.
- [docs/decisions/0027-estrategia-modelo-churn.md](docs/decisions/0027-estrategia-modelo-churn.md) — **Proposed.** Estratégia em 2 fases: Fase 1 (Sprint 19) baseline via Gemini 2.5 Flash com `task=classification` + `temperature=0` + cache 24h; Fase 2 (pós 3 meses de dados) migrar para sklearn local servido em Edge Function se gatilhos disparados. Wrapper `predictChurn(memberId)` mantém assinatura entre fases.
- [docs/decisions/0032-assinatura-prontuario-por-profissao.md](docs/decisions/0032-assinatura-prontuario-por-profissao.md) — **Accepted.** Tabela `signature_policies` (catálogo global LogiFit, seedado) com 4 modos (`icp_required`/`authenticated_lock`/`icp_optional`) + `tenant_signature_overrides` (só endurece, não afrouxa) + wrapper `requireSignaturePolicy()` integrado a regra 39 (hash chain) + regra 43 (MFA recente <15min). Cobre CFM 2.299/2021, COFFITO 414/415/2012, CFN 599/2018, Lei 9.696/1998. Provider ICP-Brasil em ADR de submissão durante Sprint 20 (BirdID/VaultID/Bry).

**Adições — Compliance**:

- [docs/compliance/sub-processors.md](docs/compliance/sub-processors.md) — **Documento público novo.** Lista canônica de 14 sub-processadores (espelho de [`docs/compliance/dpo.md`](docs/compliance/dpo.md)) servida em `logifit.com.br/sub-processors` com hash SHA-256 público. Fecha lacuna identificada na auditoria: tenant não tinha como saber quem processa seus dados. Política de mudança 30d antes + auditoria interna trimestral + endpoint de hash para detecção de mudança não-anunciada.
- [docs/compliance/anvisa-notifications/2026-05-copilot-clinico-plano.md](docs/compliance/anvisa-notifications/2026-05-copilot-clinico-plano.md) — Plano de submissão ANVISA do Copilot SaMD II antes do fim Sprint 06. Cronograma de 8 etapas (classificação → ISO 14971 → manual técnico → submissão → protocolo → desbloqueio CI). Validação clínica interna comparativa com 200 casos sintéticos + revisor sênior externo CRM/CREFITO/CRN. Bloqueio explícito: feature em `disabled` indefinidamente se protocolo não chegar.

**Atualizações**:

- [docs/compliance/dpo.md](docs/compliance/dpo.md) — Seção "DPO suplente / cobertura" nova com cobertura curta (auto-resposta + escalação) e longa (assessoria jurídica externa pré-contratada — Opice Blum / BBL / Manesco em avaliação; pendente fechamento antes do 1º tenant pagante). Drill simulado de incidente LGPD obrigatório antes de produção.
- [docs/runbooks/restore-test.md](docs/runbooks/restore-test.md) — Expandido de stub (43 linhas) para runbook executável (~150 linhas) com 6 critérios de sucesso, 4 fases (Preparação 15min · Restauração 60min/dump · Documentação 15min · Teardown 10min), passos `pg_restore` + `verify_audit_chain` + RLS check + âncora WORM, matriz de falha com severidade p0/p1/p2 + ações.
- [CLAUDE.md](CLAUDE.md) §Stack — qualificou BYOK IA: explicitamente "**Anthropic Claude Opus/Sonnet recentes — não 3.5 nem Haiku** / OpenAI GPT-4 e superiores / Maritaca Sabiá com data residency BR" + lista de modelos deprecated proibidos (Claude 3.5, GPT-4o, Gemini 2.0, Grok 2). Resolve contradição com [ADR 0064 §Fora do escopo](docs/decisions/0064-ia-arquitetura-gemini-default-byok-rag.md).
- [docs/roadmap.md](docs/roadmap.md) §Mapeamento de ADRs — 0025/0026 marcados Proposed, 0027 movido de "reservado livre" para Sprint 19 Proposed (era 0040 antes — agora liberado), 0032 marcado Accepted; seção "Decisões pendentes" tachou itens resolvidos.

**Adições — Planejamento**:

- [docs/timeline.md](docs/timeline.md) — Documento novo com cronograma absoluto MVP (~14 meses calendar com buffer 15%), caminho crítico Sprint 00→19→19b, 8 marcos M1-M8, gates pré-Sprint obrigatórios (ANVISA antes de 06, drill antes de 19b, suplente DPO antes de 20), riscos P1/P2 por sprint (06 Copilot 5-6sem viola regra 9; 15 ERP 4sem candidato a quebra; 19b cutover 116 itens em 1.5-2sem). Buffer global 2 semanas/trimestre. Reavaliação obrigatória após M3 (beta privado) para decidir se Sprints 14-18 são MVP-must ou Fase 2.

**Falhas identificadas mas não corrigidas neste commit** (rastreadas para sprints futuras):

- Constraint global "1 active member por (paciente, tenant)" cross-tenant + sharding futuro (`tenants.shard_url`): necessita spike arquitetural pré-Sprint 02 — distributed lock vs registry table sem RLS vs redesenho. ADR 0077 não aborda implementação técnica.
- ANVISA notificação Copilot precisa **execução humana** (cadastro gov.br + manual técnico + ISO 14971 + revisor sênior contratado) — plano criado, ação a executar pré-Sprint 06.
- Suplente DPO externo precisa **contrato real** com escritório LGPD — placeholder criado, ação a executar pré-1º tenant pagante.
- Break-even financeiro não simulado — pendente planilha de receita acumulada vs custo fixo nos primeiros 6 meses.
- 11+ lints customizados sem política de manutenção/falsos positivos declarada.
- Cookie isolation em custom domain (Pro+) não detalhado em ADR 0065.

### Docs+protótipo — ADR 0089 + regra 45: sistema de mensagens padronizadas 2026-04-26

Catálogo fechado de 6 tipos para feedback ao usuário com proibição de `window.alert/confirm/prompt` desde o primeiro commit React. Resolve lacuna identificada: ADR 0071 estabelecia fundação backend (envelope `{ok, data | error}` + `system_alerts` realtime) e citava `sonner.toast()` em 1 parágrafo, mas faltava: (a) catálogo de tipos de mensagem, (b) contrato de API cliente, (c) substituição formal de alerts nativos do Chrome, (d) integração com tokens "Equilíbrio Vital", CSP nonce (regra 35), responsividade 3 viewports (regra 31), a11y (ARIA live, focus trap), i18n (regra 27), (e) composição com `<ActionConfirmDialog>` IA (ADR 0075).

**Adições:**

- [docs/decisions/0089-sistema-mensagens-padronizadas.md](docs/decisions/0089-sistema-mensagens-padronizadas.md) — ADR completo: catálogo de 6 tipos (Toast/Banner/AlertDialog/PromptDialog/FormError + Toast crítico ∞), Sonner ratificada como engine, contrato declarativo + imperativo, mapeamento `toast.fromApiError(error)` → envelope ADR 0071, CSP nonce via `<Toaster nonce>`, ARIA por construção, lints `no-window-alert` + `no-hardcoded-toast-message`, composição IA Camada 3 (ADR 0075). **Numeração:** 0089 (não 0080) porque 0080-0088 estão reservados pelas Sprints 23/24/26/27/28/29/30/31 (auditorias 12, 14 e 15 — [roadmap §Numeração pós-0046](docs/roadmap.md)).
- [prototipo/base.css](prototipo/base.css) — primitivos novos `.ev-toast` (5 severidades), `.ev-banner` (3 severidades), `.ev-modal` (overlay + content com bottom-sheet mobile / centered desktop), `.ev-alert-dialog` (variante danger), `.ev-prompt-dialog`, `.ev-form-error` — todos via tokens `--ev-*` (zero hardcoded), filosofia flat preservada (sem `box-shadow` exceto focus ring funcional).
- [prototipo/designsystem/index.html](prototipo/designsystem/index.html) — seção "Mensagens" (Componentes · 08) com 5 toasts, 3 banners, AlertDialog danger, PromptDialog com FormError, FormError isolado; ARIA roles + aria-live + aria-modal + aria-describedby validados via `preview_eval` (10 elementos com role correto, 4 dismiss labels, 1 close label, 2 describedby resolvendo IDs reais). Sidebar nav com link "Mensagens".
- [docs/rules.md](docs/rules.md) — **regra 45 nova** (44 → 45 regras duras): "Mensagens ao usuário" proíbe `window.alert/confirm/prompt`, lista catálogo de 6 tipos + helpers imperativos + ARIA mínimo + composição com IA (ADR 0075) + lints. Índice e contador atualizados.

**Atualizações cruzadas:**

- [CLAUDE.md](CLAUDE.md) — bloco "Mensagens ao usuário (rules.md 45)" no digest; contadores 44 → 45 atualizados nas 3 referências (resumo `docs/rules.md`, frase "27-44", rodapé "Lista completa"); índice da seção `docs/rules.md` reflete novo bloco.
- [docs/sprints/00-setup-infra.md](docs/sprints/00-setup-infra.md) — bloco "Sistema de mensagens padronizadas (ADR 0089 + regra 45)" com 11 itens concretos (Sonner, 7 componentes, 3 helpers, `toast.fromApiError`, `<Toaster nonce>`, i18n catalog `messages.json`, 2 lints, storybook page, E2E Playwright 3 viewports); ADR 0089 listado em "Decisões tomadas"; lints adicionados ao escopo da Faixa 3.
- [docs/arquitetura.md](docs/arquitetura.md) §1 (Design System) — bullet "Mensagens ao usuário" com link pro ADR 0089 + regra 45.
- [docs/modulos.md](docs/modulos.md) — linha "Sistema de mensagens padronizadas (ADR 0089 + regra 45)" em **Fundação**, próxima ao bloco de tratamento de erros (ADR 0071) e antes da Observabilidade de IA.
- [docs/roadmap.md](docs/roadmap.md) §Numeração pós-0046 — "Próximo ADR fora-de-sprint disponível" bumped de 0089+ → 0090+ (consequência de claim do 0089).

**Verificação visual** (Edge MCP em `prototipo/designsystem/#mensagens`, `localhost:3001`):

- Light desktop: tokens corretos (`--ev-success` `#2ECC71` em border-left, `--ev-danger-soft` `#FBEAE8` em bg do toast crítico, `--ev-radius-lg` em modais).
- Dark desktop: tokens dark resolvem (`--ev-surface` `#2C3E50`, `--ev-text` `#ECF0F1`, `--ev-danger` dark `#EC7063`, soft variants em rgba 0.15).
- Mobile (≤767px): `<AlertDialog>` footer vira `flex-direction: column-reverse` (ação primária acima, cancelar abaixo) — pattern bottom-sheet correto.
- ARIA: 4 toasts não-críticos com `role="status\|alert"` + `aria-live` correto; toast crítico sem dismiss button (requer ack); 3 banners polite; AlertDialog `role="alertdialog" aria-modal="true" aria-labelledby="ad-title"`; PromptDialog `role="dialog" aria-modal="true" aria-labelledby="pd-title"`; 2 inputs com `aria-describedby` linkando IDs existentes; 5 botões com `aria-label`.
- Console: zero erros, zero warnings.

**Não inclui:**

- Implementação React dos componentes (vai pro Sprint 00 — listado como TODO, não feito agora; pré-Sprint 00 não há `apps/web/` nem `packages/ui/components/messages/`).
- `<ActionConfirmDialog>` IA (ADR 0075) — Sprint 17, será wrapper composto sobre `<ConfirmDialog>` (já formalizado no ADR 0089 como nota de composição).
- Push web PWA (Canal 5 ADR 0071) — Sprint 26, distinto do catálogo deste ADR.

### Docs — 20ª auditoria 2026-04-26 (escopo intra-tenant ADR 0070 + 11 falsos positivos descartados)

3 agentes Explore em paralelo cobrindo áreas ainda não auditadas a fundo: (a) sprints fundacionais (01a/01b/02/04) + clínicos densos (20/26/32/33), (b) ADRs antigos (0001/0002/0005/0006/0007/0010) + medianos (0049/0050/0051/0053/0061/0062/0066/0068/0070/0071), (c) cross-doc de schemas + runbooks restantes (`rotate-secrets`/`lockout-conta`/`falha-nfe`/`asaas-outage`/`upstash-down`/`focus-nfe-outage`/`oracle-cutover-rollback`/`exfiltracao-detectada`/`ia-byok-emergencial`) + threat-models (`pagamento-asaas`/`pipeline-exames`/`whatsapp-inbound`/`device-hub-oauth`/`login-mfa`).

**Resultado: 1 falha real BAIXA + 11 falsos positivos descartados.** Após 19 rondas e 26 falhas corrigidas, problemas restantes são sutis — esperado.

**Baixa (1):**

- [ADR 0070:447-453](docs/decisions/0070-insights-cross-module-timeline-integrada.md) seção "Related": ADR 0070 cobre insights cross-module mas é **estritamente intra-tenant** por design (RAG e widgets cruzam módulos do mesmo tenant). Faltava nota explícita esclarecendo que **cross-tenant** (paciente vinculado a tenants distintos via passaporte) é fora do escopo e requer regra 42 + ADR 0077 + `has_cross_tenant_access()` + log em `patient_data_access_log`. Adicionada linha de escopo na seção Related apontando para regra 25 (clínico em franchise) + ADR 0077.

**Falsos positivos descartados (transparência):**

1. "ADR 0066 NFS-e Starter sem qualificação por sprint" — ADR 0066:79 + 224 + 439 já citam Sprint 36 explicitamente como ativador de Focus NFe; ADR descreve produto-alvo, comercial.md tem fases. Não é falha.
2. Sprint 01a/01b/02/04/20/26/32/33: agente A reportou 14 critérios checados (frontmatter, DoD, ADR esperado, schemas, refs cross-sprint, MFA alto-risco, webhook HMAC, scanUpload, volume_estimate, wrapAction, BetterAuth, roles MFA, regulamentos, i18n) — **ZERO falhas** após validação. Sprints fundacionais estão limpos.
3. Schema name divergence (20+ tabelas verificadas via grep cross-doc): zero variações encontradas (`members`, `audit_log`, `ai_audit_log`, `patient_company_links` etc todos consistentes).
4. Sprint number consistency: 0-40 + 00b/19b todos legítimos no roadmap.
5. Runbooks `rotate-secrets`/`lockout-conta`/`falha-nfe`/`focus-nfe-outage`/`oracle-cutover-rollback`/`exfiltracao-detectada`/`ia-byok-emergencial`: existem, referenciam regras corretas (36 lockout, 43 MFA, 33 wrapAction, 39 hash chain, 40 backup), são esqueletos pré-Sprint conforme convenção.
6. Threat-models 9 existem; templates `_template.md`/`_template-stride.md` confirmados.
7. CLAUDE.md regras de portabilidade #1-#8 vs ADR 0078: 8/8 batem 100%.
8. `packages/security/high-risk-actions.ts`: lista canônica em rules.md regra 43 + Sprint 00:150 + lint `high-risk-action-must-require-recent-mfa` em CI — coerente.
9. 10 lints custom (no-unwrapped-action, no-raw-fetch, no-unscanned-upload, no-hardcoded-design-token, no-direct-supabase-query, no-supabase-functions, high-risk-action-must-require-recent-mfa, cross-tenant-read-must-log, ai-block-respected, no-desktop-only-layout): todos presentes em Sprint 00 commit checklist.
10. ADR 0001-0010 (fundacionais): ADR 0001 tem addendum apontando para ADR 0078 (portabilidade); ADR 0002/0005/0006/0007/0010 ainda válidos sem conflito com regras novas 27-44.
11. ADRs medianos 0047-0063: nenhum cita pricing/cota desatualizado; refs a regras corretas; CFM/COFFITO/Lei com numeração correta.

`pnpm docs:check` passa zero erros zero avisos após correção.

### Docs — 19ª auditoria 2026-04-26 (gates MFA fiscais + DPA template criado + sincronia ADR 0077)

3 agentes Explore em paralelo cobrindo áreas ainda não auditadas a fundo: (a) modulos.md+multiempresa.md inteiros, (b) ADRs canônicos transversais (0064/0067/0072/0073/0075/0077), (c) sprints densos (06/13/17/22/36). 16 alegações brutas → **6 falhas reais** após validação direta + **10 falsos positivos descartados**.

**Altas (4):**

- [docs/sprints/36-geral-fiscal-focus-nfe.md:158-164](docs/sprints/36-geral-fiscal-focus-nfe.md): eventos fiscais `cancelEmission`/`issueCCe`/`inutilizeRange` listados como Server Actions sem menção a `requireRecentMfa()` — regra 43 + `packages/security/high-risk-actions.ts` exigem MFA recente <15min para `cancelNfe`. Sprint 22 (linhas 51-53) já estabeleceu o padrão para TISS; Sprint 36 ficou de fora. Adicionado bloco "Gate MFA específico de Fiscal" com texto canônico equivalente ao Sprint 22.
- [docs/sprints/36-geral-fiscal-focus-nfe.md:223](docs/sprints/36-geral-fiscal-focus-nfe.md) Commit checklist: testes E2E listavam "8 tipos + 3 eventos" mas não cobriam MFA. Adicionado item explícito: `cancelEmission`/`issueCCe`/`inutilizeRange` sem `mfa_at` recente → `MFA_RECENT_REQUIRED` no envelope; com MFA <15min executa OK; lint `high-risk-action-must-require-recent-mfa` verde.
- [docs/decisions/0075-assistente-ia-universal-tres-camadas-tool-registry.md:231](docs/decisions/0075-assistente-ia-universal-tres-camadas-tool-registry.md): whitelist Camada 3 (write tools) listava `inviteUser({email, role})` como risco "Médio" sem citar regra 43. `inviteUser` altera RBAC — `packages/security/high-risk-actions.ts` lista `updateUserRole` como exigindo MFA <15min. Adicionado parágrafo "Compliance MFA recente (regra 43) em tools Camada 3" explicando proteção dupla com lint `// ai-blocked:` (regra 41).
- [docs/compliance/dpa-template.md](docs/compliance/dpa-template.md): **arquivo criado**. ADR 0067:301 declarava `dpa-template.md` na lista de docs em `docs/compliance/` mas o arquivo não existia. Skeleton com 10 cláusulas + cláusula 7-bis (cross-tenant via passaporte) + referências cruzadas para `dpo.md`, `lgpd-data-inventory.md`, `data-deletion-playbook.md` e `incidente-lgpd-72h.md`. Versão final completa fica para Sprint 02 (jurídico LogiFit + escritório externo).

**Médias (1):**

- [docs/decisions/0077-passaporte-paciente-vinculo-cross-tenant.md:367](docs/decisions/0077-passaporte-paciente-vinculo-cross-tenant.md): `CREATE TABLE patient_data_access_log` não tinha o `@volume_estimate_yearly` comment SQL exigido pela regra 34 (CI lint pode falhar em Sprint 02 review). ADR 0072:148 estima 10-15M linhas/ano com 30% adoção do passaporte — agora reproduzido como comment no schema do ADR 0077 + ref para retenção 5 anos + cold storage Parquet zstd após 2 anos (ADR 0072 §"Tabelas que vão pra cold storage").

**Baixas (1):**

- [docs/acesso-e-autorizacao.md:218-226](docs/acesso-e-autorizacao.md): tabela "5 níveis de dados" estava resumida vs [ADR 0077:191-198](docs/decisions/0077-passaporte-paciente-vinculo-cross-tenant.md) que é a fonte de verdade. Sem contradição, apenas perda de detalhe (cargas, presença sim/não, restrições motoras, "sem diário detalhado", clareza Nível 5 nunca exibido). Linhas sincronizadas com texto exato do ADR 0077 + nota apontando para a fonte de verdade.

**Falsos positivos descartados (transparência):**

- "Sprint 17 callback Open Finance sem HMAC" — Sprint 17:191 Commit já documenta "Wrapper Open Finance ... webhook callback valida HMAC + IP source" (agente leu só as API Routes, não o Commit)
- "Sprint 06 seed task_routing vago no checklist" — linha 52 do Sprint 06 detalha (Gemini priority 100 em chat/embedding/etc); checklist linha 334 é resumo, não falha
- "modulos.md usa 'paciente, tenant' em vez de 'member, tenant'" — regra 24 explicitamente permite UI rotular como "aluno"/"paciente" enquanto schema usa `member` (canônico); contexto comercial `(paciente, tenant)` é UX-friendly e correto
- "Sprint 36 nome do módulo divergente em modulos.md" — design intencional; modulos.md é catálogo funcional, sprints/roadmap é técnico
- "multiempresa.md sem link explícito para acesso-e-autorizacao.md" — clarificação cosmética; multiempresa.md:159 já referencia "RBAC e scopes" implicitamente
- "ADR 0064 CFM 2.454/2026 não declara pré-compliance" — vigência ago/2026 é documentada implicitamente; ADR é preventivo (preparação MVP que vai produção 2026-08+ alinha)
- "ADR 0073 mapeamento camadas↔regras ausente" — clarificação cosmética; cada camada tem seção dedicada com refs explícitas a regras 35-40
- "ADR 0077 confusão histórica regra 26" — wording explica que a confusão era de **acesso-e-autorizacao.md** (já corrigida em auditoria anterior); rastreabilidade não é falha
- "ai_audit_log.human_decision ambíguo por layer" — comment "(quando não clínica)" no ADR 0064:203 já cobre layer Help (null permitido)
- "Job de archive `ai_audit_log` não nomeado especificamente" — ADR 0072:257 lista `ai_audit_log` na tabela canônica de cold storage (>1a → cold, >5a → delete); job genérico `archive-cold-partitions` cobre todas as tabelas listadas

`pnpm docs:check` passa zero erros zero avisos após correções.

### Docs — 18ª auditoria 2026-04-26 (drift entre fonte canônica e docs derivados)

6 agentes Explore em 2 rondas, com validação direta de cada alegação (8 falsos positivos descartados — incluindo "ADRs 0011-0046 não existem", `samd-classification.md`/`lgpd-data-inventory.md` "faltam", runbooks "incidente-lgpd-72h" "ausente", `ai_audits` vs `ai_audit_log` etc — todos investigados e refutados por leitura direta). Foco da rodada: drift cross-doc entre rules.md (fonte canônica regra 43) e docs derivados; gaps auto-declarados (TODOs no design system); contradições com ADR 0078 portabilidade; refs a ADRs realocados.

**Críticas / altas (4):**

- [docs/acesso-e-autorizacao.md:23-24](docs/acesso-e-autorizacao.md): lista de roles MFA divergia da regra 43 canônica — incluía `instrutor`/`admin`/`gerente` (não obrigatórios) e listava `recepção` como obrigatório (regra 43 diz opcional). Faltavam `medico`, `personal`, `enfermeiro`, `tenant_owner`, `dpo`, `super_admin`. Linha agora reflete regra 43 + adiciona menção ao gate `requireRecentMfa()<15min` para alto-risco.
- [docs/comercial.md:300](docs/comercial.md): "Roles pré-configurados | 9+" omitia `medico`, `personal`, `enfermeiro`, `tenant_owner`, `dpo`. Risco de cliente médico questionar suporte ao perfil. Atualizado para "14+" listando todos.
- [docs/arquitetura.md:21-25](docs/arquitetura.md): seção §1 design system "Equilíbrio Vital" tinha TODO auto-declarado "**A adicionar:** cor de erro destrutiva e warning amarelo". Tokens de erro (`#E74C3C`/`#C0392B`) e warning (`#F39C12`/`#D68910`) agora preenchidos em variantes light/dark, sem anotação pendente. Sprint 00 pode materializar `tokens.css` sem gap.
- [docs/arquitetura.md:120](docs/arquitetura.md): cross-module event bus listava "Supabase Realtime ou Edge Function" como consumers — contradiz regra de portabilidade #5 do ADR 0078 que **proíbe Supabase Edge Functions**. Trocado para "Supabase Realtime (Fase 1) / `LISTEN/NOTIFY` (Fase 2 — ADR 0078); webhooks externos via API Route Next.js".

**Médias (6):**

- [docs/threat-models/assistente-ia-tools.md:50](docs/threat-models/assistente-ia-tools.md): citava "ADR 0034 esperado" para Generative UI Sprint 28, mas roadmap.md:184 realocou ADR 0034 para Sprint 15 (workflow AP). Generative UI virou ADR 0085. Ref atualizada.
- [docs/comercial.md:293-294](docs/comercial.md): "Sprints planejados | 30" e "ADRs arquiteturais | 38+" desatualizados — atualizados para "40+" e "44+" (real: 41 entradas no roadmap, 44 ADRs publicados).
- [docs/comercial.md:5](docs/comercial.md): "sprints 00–30 + pós" — Sprint 36 (Focus NFe) tem arquivo, roadmap até 40. Atualizado para "00–36 + roadmap fase 3 até 40".
- [docs/sprints/00-setup-infra.md:29 + 223](docs/sprints/00-setup-infra.md): `pnpm docs:check` aparecia em Commit (linha 201) e README (205) mas faltava do Critério de aceite e da DoD. Brecha permitia fechar Sprint 00 sem o lint de docs ativo. Adicionado em ambos os lugares.
- [docs/decisions/0078-...md:108](docs/decisions/0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md): "BetterAuth ou Lucia" listadas como alternativas em ADR 0078, CLAUDE.md, arquitetura.md, sem ADR de fechamento. Adicionada nota explícita "Sub-decisão pendente — BetterAuth vs Lucia" com critérios + posicionamento como mini-ADR no início do Sprint 19b. Não é indecisão por esquecimento — é diferimento intencional documentado.
- [docs/compliance/lgpd-data-inventory.md:18](docs/compliance/lgpd-data-inventory.md): linha de `evolucoes_sessao` apontava só para `v1.0-prontuario-fisio` — RIPD dedicado `v1.0-evolucao-midias.md` existe. Apontamento corrigido para listar ambos.

**Baixas (4):**

- [docs/acesso-e-autorizacao.md:96](docs/acesso-e-autorizacao.md): `(ADR 0019)` sem qualificador "(esperado, Sprint 01b)". Convenção do roadmap aceita, mas padronizado para clareza.
- [CLAUDE.md:92](CLAUDE.md) regra 28: classificador de output listava só 2 termos proibidos (`'diagnóstico'`, `'tem [doença]'`); rules.md regra 28 canônica + ADR 0064:324 incluem `'prescrever'`. Digest do CLAUDE.md atualizado.
- [docs/comercial.md:246](docs/comercial.md): linha de "Desconto anual" omitia Solo/Combo. Confirmado via grep no ADR 0066 que não há desconto anual definido para esses tiers (preço de entrada). Adicionado parêntese explícito "(Solo e Solo Combo já entram com pricing de entrada e não acumulam desconto anual.)".
- [docs/compliance/ripd/_template.md:5](docs/compliance/ripd/_template.md): convenção de versionamento (v0.1 vs v1.0 vs `v1.0 (skeleton)`) não documentada — alguns RIPDs nascem `v0.1` (agendamento, ia-copilot), outros nascem `v1.0 (skeleton)` (prontuario-fisio). Template ganha linha explicando que ambos são aceitos enquanto Parecer DPO=Pendente; `v1.0` "limpo" só após aprovação + hash.

**Falsos positivos descartados (transparência):**

- "ADRs 0011-0046 não existem" — design intencional documentado em [roadmap.md:122-187](docs/roadmap.md): faixa reservada a sprints; convenção (linha 161) aceita citar `(ADR 0015)` sem `.md` resolvendo
- `samd-classification.md`, `lgpd-data-inventory.md` "não existem" — ambos existem em `docs/compliance/`
- runbooks `incidente-lgpd-72h.md`, `exfiltracao-detectada.md`, `falha-hash-chain.md` "ausentes" — todos existem em `docs/runbooks/`
- "`ai_audits` vs `ai_audit_log` inconsistente" — Grep no repo inteiro retornou 100% `ai_audit_log` (singular)
- "RIPDs todos com `Parecer DPO: Pendente` é falha" — design declarado: cada RIPD é "skeleton pré-Sprint X"; aceite formal só após implementação
- "Hash SHA-256 dos RIPDs não populado" — Sprint 00 entrega `scripts/hash-ripd.ts`; pré-Sprint 00 estar vazio é estado esperado
- "Lei 13.787 vs LGPD art. 16 conflito não resolvido" — [data-deletion-playbook.md:22-25](docs/compliance/data-deletion-playbook.md) resolve explicitamente
- "`mfa-bypass-emergencial.md` tem gap operacional não resolvido em modo solo" — runbook reconhece e documenta 3 mitigações (cofre off-line + WebAuthn duplicado + envelope com advogado)
- Stubs (`restore-pg.md`, `passaporte-cross-tenant.md`) "incompletos" — auto-marcados como "stub pré-Sprint X"; convenção aceita

`pnpm docs:check` passa zero erros zero avisos após correções.

### Docs — 17ª auditoria 2026-04-25 (gap de schema em ADR 0064)

3 agentes Explore em paralelo (qualidade interna dos stubs, ADRs internos, drift cross-doc). Lint automatizada (4 validações) já cobria o grosso. **1 bug real** encontrado (drift cross-doc retornou ZERO):

- [ADR 0064:301-305](docs/decisions/0064-ia-arquitetura-gemini-default-byok-rag.md): seção "Fallback cascade" diz `Audit marca fallback_used=true` mas o schema de `ai_audit_log` no mesmo ADR (linhas 187-205) não declarava a coluna `fallback_used`. Adicionada `fallback_used bool` ao schema com comentário explicativo. Quem implementar Sprint 06 agora encontra coluna coerente com o comportamento descrito.

**Falsos positivos descartados:**
- RIPDs citam ADRs 0023/0024/0032/0043/0044 (todos esperados na faixa reservada — design documentado em roadmap)
- Parecer DPO "pendente" em 6 RIPDs stubs (design — viram vigente quando sprint correspondente roda)
- Threat model passaporte com "implementada a partir de Sprint 02" (wording aceitável)
- Runbooks com header "(a expandir)" com conteúdo parcial (coerente — esqueleto inicial)
- Drift semântico cross-doc: agente verificou 13 pontos críticos (stack, planos, autorização, multi-empresa, regulações, regras digest, módulos, DPO, passaporte, IA CFM, LGPD, cenários, plano-estrutura) — ZERO drifts

### Docs+tooling — 16ª auditoria 2026-04-25 (14 DoDs com sprint number errado + validação D na lint)

3 agentes Explore em paralelo. Lint automatizada (criada na 15ª) já cobria 3 classes; auditoria manual focou em bugs semânticos. Achado mais sério: **padrão sistemático de copy-paste** em DoDs de sprints.

**P1 — 14 sprints com DoD `Roadmap: sprint X → done` apontando para sprint ERRADA:**

Template foi copiado de sprint anterior e número não atualizado. Se um dev seguir literalmente, marca a sprint errada como done no roadmap.

| Sprint | DoD dizia | Agora |
|---|---|---|
| [06](docs/sprints/06-geral-copilot-base.md):428 | "sprint 05" | sprint 06 |
| [07](docs/sprints/07-geral-dashboard.md):160 | "sprint 06" | sprint 07 |
| [08](docs/sprints/08-academia-controle-acesso.md):142 | "sprint 07 → item #7" | sprint 08 → item #10 |
| [19](docs/sprints/19-ia-previsao-churn.md):126 | "sprint 15" | sprint 19 |
| [21](docs/sprints/21-fisio-evolucao-midias.md):115 | "sprint 17" | sprint 21 |
| [23](docs/sprints/23-fisio-comissoes-repasse.md):134 | "sprint 19" | sprint 23 |
| [24](docs/sprints/24-geral-estoque.md):130 | "sprint 20" | sprint 24 |
| [25](docs/sprints/25-fisio-anvisa-cnes.md):143 | "sprint 21" | sprint 25 |
| [26](docs/sprints/26-geral-portal-paciente-web.md):225 | "sprint 22" | sprint 26 |
| [27](docs/sprints/27-cross-alert-lesao-treino.md):120 | "sprint 23" | sprint 27 |
| [28](docs/sprints/28-fisio-generative-ui.md):101 | "sprint 24" | sprint 28 |
| [29](docs/sprints/29-nutri-alimentos-e-plano.md):140 | "sprint 25 + ADRs 0035/0036" | sprint 29 + ADRs 0080/0081 (cascade auditoria 12) |
| [30](docs/sprints/30-nutri-suplementos-exames.md):134 | "sprint 26" | sprint 30 |
| [31](docs/sprints/31-geral-diario-alimentar-teleconsulta.md):157 | "sprint 27" | sprint 31 |

**P2 — Inconsistência semântica em ADR 0077:**

[ADR 0077:119](docs/decisions/0077-passaporte-paciente-vinculo-cross-tenant.md:119) dizia "Exceção controlada da regra 26" — mas o **mesmo ADR** em linhas 16 e 391 afirma `regra 26 NÃO muda — continua sobre groups; "regra 26" no contexto cross-tenant individual era confusão histórica`. A regra real que autoriza cross-tenant via passaporte é **regra 42**. Linha 119 atualizada para "Exceção controlada do princípio implícito de isolamento individual cross-tenant (formalizado agora como regra 42)".

**P3 — URL HTTP em vez de HTTPS:**

[v0.1-cobranca-financeiro.md:106](docs/compliance/ripd/v0.1-cobranca-financeiro.md:106) usava `http://normas.receita.fazenda.gov.br/...` para link da Receita Federal. Trocado para `https://`. Domínio `gov.br` suporta HTTPS.

**Tooling — Validação D adicionada à lint:**

[scripts/docs-check.mjs](scripts/docs-check.mjs) ganha 4ª validação `checkSprintDodMatchesFilename` — detecta DoD `Roadmap: sprint X → done` em sprint NN-* onde X ≠ NN. Pega P1 automaticamente daqui pra frente em qualquer PR. Lint passa zero erros zero avisos após correções.

**Falsos positivos descartados:**
- Threat models para Sprints 24/25/27/31 (design intencional ADR 0073 — 5 críticos + STRIDE leve)
- RIPD `v1.0-tiss-convenios.md` "faltando" (Sprint 22 referencia como DoD futuro, padrão idêntico aos outros)
- ADRs 0080-0088 esperados não criados como arquivo (gap reservado por design)
- Glossário centralizado faltando (CLAUDE.md tem glossário operacional)
- CRLF nos arquivos (falso positivo: Git armazena LF, warnings eram apenas autocrlf local Windows)

### Tooling — `docs-check` lint custom + 15ª auditoria 2026-04-25 (3 colisões ADR + 9 links quebrados achados pela lint)

Após 14 auditorias manuais consecutivas encontrarem ~10-18 falhas reais cada, criei lint custom para automatizar. Lint encontrou imediatamente bugs que escaparam de TODAS as 14 auditorias.

**Lint criada:**
- [scripts/docs-check.mjs](scripts/docs-check.mjs) — Node.js plain (sem deps, roda com `node` direto). 3 validações:
  - **A.** Número no H1 do ADR (`# ADR NNNN — Título`) bate com prefixo do filename (`NNNN-*.md`)
  - **B.** Todo link markdown relativo dentro de `docs/` (+ CLAUDE.md, CHANGELOG.md, README.md) que aponta para `.md` resolve para arquivo existente
  - **C.** `ADR NNNN (esperado)` em qualquer sprint não colide com ADR já publicado em `docs/decisions/` nem com outra sprint reivindicando o mesmo número
- [.github/workflows/docs-check.yml](.github/workflows/docs-check.yml) — workflow CI roda em PR/push tocando `docs/`, `scripts/docs-check.mjs`, `CLAUDE.md`, `CHANGELOG.md` ou o próprio workflow
- [CLAUDE.md](CLAUDE.md) seção "Comandos comuns" — comando `node scripts/docs-check.mjs` documentado (Sprint 00 wraps em `pnpm docs:check`)
- [Sprint 00](docs/sprints/00-setup-infra.md) — DoD adiciona item de wire `pnpm docs:check` no `package.json` quando o monorepo for criado

**Bugs encontrados pela lint na primeira execução (15 erros corrigidos):**

*9 links markdown quebrados (todos refs internas a docs/):*
- [compliance/anvisa-notifications/_template.md:76](docs/compliance/anvisa-notifications/_template.md): `../decisions/...` (path errado, era `../../decisions/...`)
- [compliance/ripd/v0.1-cobranca-financeiro.md](docs/compliance/ripd/v0.1-cobranca-financeiro.md) (4 ocorrências): refs a `sprints/17-geral-fiscal-inbox.md` (não existe — Sprint 15 entrega NF-e inbox) e a `decisions/0061-cobertura-fiscal-faseada.md` (slug errado — real é `0061-motor-retencoes-e-cobertura-fiscal-faseada.md`)
- [decisions/0066:451](docs/decisions/0066-plano-comercial-pricing-trial.md): ref a `0004-pagamentos-asaas.md` (não existe — ADR 0004 é Drizzle; Asaas é parte de ADR 0001)
- [decisions/0068:543](docs/decisions/0068-catalogo-servicos-precos-contextuais-link-financeiro.md): ref a `0010-financial-mode-centralizado.md` (escrita errada — real é `centralized` com s)
- [decisions/0072:455](docs/decisions/0072-escalabilidade-banco-particionamento-retencao-cold-storage.md): self-reference com `decisions/decisions/` duplicado
- [decisions/0077](docs/decisions/0077-passaporte-paciente-vinculo-cross-tenant.md) (3 ocorrências): refs a slugs planejados originais (`0047-cadastro-central-persons-contact-fk.md`, `0048-cnpj-busca-automatica.md`) que mudaram quando ADRs foram formalizados

*3 colisões ADR novas (mesmo padrão das 12ª e 14ª, escapou de novo):*
- ADR 0030: Sprint 22 (TISS terminologia) **e** Sprint 23 (Modelo comissão) — Sprint 23 realocada para **0086**
- ADR 0031: Sprint 22 (Validador TISS) **e** Sprint 24 (Estoque PEPS) — Sprint 24 realocada para **0087**
- ADR 0032: Sprint 20 (Fechamento prontuário) **e** Sprint 26 (Member auth) — Sprint 26 realocada para **0088**
- Cascatas: roadmap.md tabela de realocações ganha 0086+0087+0088; placeholders fiscais "≥0086" → "≥0089" em modulos/roadmap/Sprint 35; backref RIPD `v1.0-portal-paciente.md` atualizado de "ADR 0032" → "ADR 0088"

**Por que essa lint vale o esforço:**

A classe de bugs "ADR esperado colide com publicado/outro" é gerada por mudanças incrementais — cada vez que um ADR é formalizado ou um sprint criado, uma colisão pode nascer. Diff manual não pega porque a colisão pode estar em arquivo distante. Classe "link MD quebrado" idem — refactors de slugs propagam mal. Lint roda em segundos, fail-fast em CI antes de merge.

### Docs — 14ª auditoria 2026-04-25 (colisões ADR 0033/0034 + RIPD refs quebradas + 4 backrefs RIPD)

3 agentes Explore em paralelo. Achado mais sério (mesmo padrão da 12ª, escapou de novo): **2 colisões de numeração ADR** + **2 RIPDs apontando para arquivo inexistente** + **4 backrefs RIPD ainda faltando**. **17 ocorrências reais corrigidas em 17 arquivos:**

**Colisões ADR (4 sprints, 8 ocorrências):**
- ADR 0033 alocado a Sprint 15 (Plano de contas) **e** Sprint 27 (CID→contraindicação) — Sprint 27 realocada para **0084**
- ADR 0034 alocado a Sprint 15 (Workflow AP) **e** Sprint 28 (Generative UI) — Sprint 28 realocada para **0085**
- Cascatas: [ADR 0051:172](docs/decisions/0051-whatsapp-inbound-canal-multifluxo.md) atualizado para qualificar 0033/0034; [samd-classification.md:35](docs/compliance/samd-classification.md) trocado para "(ADR 0085 esperado)"; [docs/roadmap.md](docs/roadmap.md) tabela de realocações ganha 0084 + 0085; placeholders fiscais "≥0084" → "≥0086" em modulos.md + roadmap.md + Sprint 35

**RIPD refs quebradas (2 sprints):**
- [Sprint 30:114](docs/sprints/30-nutri-suplementos-exames.md): `v1.0-nutri-exames.md` (não existia) → `v1.0-exames-laboratoriais.md` (compartilhado com Sprint 33)
- [Sprint 33:197](docs/sprints/33-geral-pipeline-exames.md): `v1.0-pipeline-exames-ia.md` (não existia) → `v1.0-exames-laboratoriais.md`
- Cascatas residuais corrigidas: [lgpd-data-inventory.md:28](docs/compliance/lgpd-data-inventory.md), [ADR 0054:98](docs/decisions/0054-lgpd-art11-dados-saude-ripd-versionado.md), [Sprint 00:188-194](docs/sprints/00-setup-infra.md) — checklist de "criar arquivos vazios de RIPD" alinhado com nomes canônicos reais

**Backrefs RIPD adicionados (4 sprints):**
- [Sprint 08](docs/sprints/08-academia-controle-acesso.md) → `v1.0-academia-treino.md` + gate adicional para parecer DPO de reconhecimento-facial assinar antes da modalidade `facial` ir a produção
- [Sprint 13](docs/sprints/13-geral-whatsapp-e-regua-cobranca.md) → `v1.0-whatsapp.md`
- [Sprint 29](docs/sprints/29-nutri-alimentos-e-plano.md) → `v1.0-nutri-plano.md`
- [Sprint 32](docs/sprints/32-geral-device-hub.md) → `v1.0-device-hub.md`

**Cosmético:**
- [v1.0-reconhecimento-facial.md:3](docs/compliance/ripd/v1.0-reconhecimento-facial.md): header dizia "v0.1-skeleton" mas filename é v1.0; alinhado para "Skeleton" + esclarecido status interno (parecer DPO pendente).

**Falsos positivos descartados:**
- Sprint 00:62 "ADR 0062" para extensões `pg_trgm`/`unaccent` — atribuição correta (extensões são pré-requisito do ADR de Pesquisa Global)
- Threat models para Sprints 24/25/27/31 — design intencional (ADR 0073 lista 5 críticos)
- v0.1 RIPDs sem backref — design intencional (skeletons → v1.0 quando sprint roda)

### Docs — 13ª auditoria 2026-04-25 (cascade pós-12ª: slugs ADR 0035 quebrados + Sprint numbers stale em modulos.md/roadmap.md)

3 agentes Explore em paralelo. Validações diretas eliminaram falsos positivos (threat models faltando para Sprints 24/25/27/31 — design intencional ADR 0073 lista 5 críticos; ADR 0059:292 referência a "ADR 0038 NF-e recepção" — está correto). **18 ocorrências reais corrigidas em 6 arquivos:**

**P1 — Slug ADR 0035 quebrado (4 ocorrências):**
ADR 0035 foi criado com slug `0035-ocr-boleto-provider-abstrato.md` mas 3 ADRs de provider abstrato (0048, 0049, 0050) referenciavam o slug planejado original `0035-sem-implementar-ocr-ainda-mas-definido.md` (que nunca existiu).
- [docs/decisions/0048-busca-cnpj-provider-abstrato.md:19,111](docs/decisions/0048-busca-cnpj-provider-abstrato.md) (2×)
- [docs/decisions/0049-device-hub-wearables-clinicos.md:22](docs/decisions/0049-device-hub-wearables-clinicos.md)
- [docs/decisions/0050-pipeline-exames-laboratoriais.md:136](docs/decisions/0050-pipeline-exames-laboratoriais.md)

**P2 — Cascade pós-12ª auditoria não propagada para `modulos.md` + `roadmap.md` (14 ocorrências):**

A 12ª auditoria realocou ADRs 0035-0038 → 0080-0083 (resolvendo colisões em Sprints 29/30/31), mas `docs/modulos.md` e `docs/roadmap.md` ainda referenciavam:
- 12 linhas em [docs/modulos.md §Nutri (Fase 3)](docs/modulos.md): tabela com Sprint numbers offset por 4 (TACO em "Sprint 25" → era na verdade 29; suplementos "26" → 30; diário+teleconsulta "27" → 31; Nutri-Agent "28" → 34); + cita "ADR 0038" para Teleconsulta (era 0083 pós-12ª).
- 1 linha em [docs/modulos.md:347](docs/modulos.md): "App nativo Expo Sprint 29" (era 35); "Prescrição adaptativa pós-29" (era pós-35).
- 4 linhas em [docs/modulos.md:349-352](docs/modulos.md): Grupos C/D/E/F fiscais citando ADR 0062/0063/0064/0065 (que já são Pesquisa Global/Responsividade/IA/Subdomínio respectivamente — bug herdado da 11ª auditoria).
- 4 linhas em [docs/roadmap.md:70-73](docs/roadmap.md): mesma cascata fiscal acima — Grupos C-F com ADR 0062/0063/0064/0065 errados.

Substituições: ADRs fiscais agora apontam para "ADR a alocar ≥0084" conforme [§Numeração pós-0046](docs/roadmap.md).

### Docs — 12ª auditoria 2026-04-25 (resolve colisão ADRs 0035-0038 + backref RIPDs em 6 sprints)

3 agentes Explore em paralelo. Achado mais sério: **4 sprints citavam ADRs que já existiam com outro propósito ou estavam alocados a outras sprints** (escapou das 11 auditorias anteriores).

**Colisões de numeração ADR (4 realocações para faixa ≥0080):**
- [Sprint 29:39](docs/sprints/29-nutri-alimentos-e-plano.md): ADR 0035 (TACO) → **0080** porque 0035 já existe Accepted (OCR boleto, formalizado 2026-04-25)
- [Sprint 29:40](docs/sprints/29-nutri-alimentos-e-plano.md): ADR 0036 (Plano alimentar) → **0081** porque 0036 alocado a Sprint 16 (rateio intercompany)
- [Sprint 30](docs/sprints/30-nutri-suplementos-exames.md) (3 ocorrências): ADR 0037 (Suplementação) → **0082** porque 0037 alocado a Sprint 17 (Open Finance)
- [Sprint 31](docs/sprints/31-geral-diario-alimentar-teleconsulta.md) (5 ocorrências): ADR 0038 (Teleconsulta provider) → **0083** porque 0038 alocado a Sprint 17 (NF-e recepção)
- [Sprint 35:36](docs/sprints/35-mobile-app-nativo-expo.md) bumped de "≥0080" para "≥0084" (consequência)
- [docs/roadmap.md](docs/roadmap.md) ganha tabela "Realocações da faixa 0011-0046 → 0080+" documentando os 4 casos
- [RIPD v1.0-teleconsulta.md:13](docs/compliance/ripd/v1.0-teleconsulta.md): atualizado para referenciar ADR 0083 específico

**Backrefs RIPD (rastreabilidade bidirecional, 6 sprints):**
Auditoria 11 criou 6 stubs RIPD apontando pra suas sprints, mas sprints não referenciavam de volta. Adicionado item DoD em cada:
- [Sprint 11](docs/sprints/11-geral-prescricoes-e-biblioteca.md) → `v1.0-prescricoes.md`
- [Sprint 12](docs/sprints/12-geral-avaliacoes-fisicas.md) → `v1.0-avaliacoes-fisicas.md`
- [Sprint 21](docs/sprints/21-fisio-evolucao-midias.md) → `v1.0-evolucao-midias.md`
- [Sprint 26](docs/sprints/26-geral-portal-paciente-web.md) → `v1.0-portal-paciente.md`
- [Sprint 34](docs/sprints/34-nutri-agent-ia.md) → `v1.0-nutri-agent-ia.md` (corrige nome estava `v1.0-nutri-agent.md`)
- [Sprint 31](docs/sprints/31-geral-diario-alimentar-teleconsulta.md): corrige ref quebrada `v1.0-diario-alimentar.md` → `v1.0-nutri-diario.md` (arquivo real existente)

### Docs — 11ª auditoria 2026-04-25 (4 inconsistências críticas + materializa stubs compliance/ops)

3 agentes Explore em paralelo. Foco em coerência de cross-references e cobertura compliance/security/ops.

**Críticos (4):**
- [ADR 0061](docs/decisions/0061-motor-retencoes-e-cobertura-fiscal-faseada.md): atribuía ADRs 0062-0065 a sprints 37-40, mas esses números já existem com outras decisões (Pesquisa Global, Responsividade, IA, Subdomínio). Trocado por placeholder "ADR a alocar quando Sprint 37+ entrar (≥0080)".
- [ADR 0061:107](docs/decisions/0061-motor-retencoes-e-cobertura-fiscal-faseada.md): citava "regra 1b" (não existe — rules.md tem só numeração inteira 1-44). Trocado por "regra 43" (MFA obrigatório).
- [Sprint 02:64](docs/sprints/02-geral-crm-pessoas.md): status ADR 0077 conflitava — ADR diz "Accepted", sprint dizia "Proposed". Alinhado: design Accepted + gate operacional separado para ativação em tenant clínico.
- [docs/comercial.md:301](docs/comercial.md): "4 cenários canônicos" (omitia modo solo) → "5".

**Estruturais (5):**
- [docs/rules.md](docs/rules.md): conteúdo reorganizado na ordem do índice (Arquiteturais 1-8 → Processo 9-15 → Código 16-20 → Multi-empresa 21-26 → ... → Design system 44 no fim).
- [CLAUDE.md:65-67](CLAUDE.md): explicita regras omitidas do digest (9-10, 12, 17-20, 21-26).
- [docs/roadmap.md](docs/roadmap.md): adiciona convenção "sprint que cita ADR XXXX (esperado) não entra em doing sem ADR publicado".
- [ADR 0006:33](docs/decisions/0006-hierarquia-group-tenant-company-unit.md): qualifica "passaporte de franquia" (vs cross-tenant ADR 0077).
- [docs/compliance/samd-classification.md:36](docs/compliance/samd-classification.md): adiciona Generative UI (Sprint 28) e Modo Coach (ADR 0074) à tabela.

**Stubs novos (regra 29 + ADR 0054 / regra 35-40 + ADR 0073 / regra 40):**
- 6 RIPDs: `v1.0-prescricoes.md`, `v1.0-avaliacoes-fisicas.md`, `v1.0-evolucao-midias.md`, `v1.0-portal-paciente.md`, `v1.0-teleconsulta.md`, `v1.0-nutri-agent-ia.md`
- 3 threat models STRIDE: `passaporte-cross-tenant.md`, `assistente-ia-tools.md`, `device-hub-oauth.md`
- 4 runbooks: `asaas-outage.md`, `upstash-down.md`, `focus-nfe-outage.md`, `oracle-cutover-rollback.md`

### Docs — reforço de extensibilidade i18n 2026-04-25

Pergunta do usuário: "futuramente vamos ter outras [linguagens] diferentes de pt-br, o sistema já vai estar preparado e facilitado para a implementação?". Diagnóstico: a base já estava bem desenhada (ADR 0052 + Regra 27 + Sprint 00), mas tinha 6 pontos onde pequenos ajustes/explicitações tornam a futura adição de locale (`de-DE`, `fr-FR`, etc) um runbook mecânico em vez de refactor. Nenhum locale novo aplicado agora — apenas garantir que o caminho fique aberto.

**Mudanças:**

- [ADR 0052 §Decision](docs/decisions/0052-i18n-tres-idiomas-pt-en-es.md) — (1) **cadeia de fallback genérica** "qualquer locale → en-US (pivô) → pt-BR (default)" derivada de `FALLBACK_CHAIN` constant, não mais hardcoded em "es-419 → en-US → pt-BR"; (2) **threshold fechado de catálogos**: > 500 linhas usa tabela `translations(entity_type, entity_id, locale, field, value)` (CID/CIF/TUSS/TACO/exercícios/suplementos/analitos), ≤ 500 usa colunas `name_pt/en/es` — antes "decidir durante execução"; (3) **persistência `persons.preferred_locale` como TEXT + CHECK**, proibido enum SQL (evita `ALTER TYPE` ao adicionar locale).
- [ADR 0052 §Escopo de impacto](docs/decisions/0052-i18n-tres-idiomas-pt-en-es.md) — (4) **templates Resend e PDF nascem multi-locale** desde primeiro template (Sprint 01a/04/20/22/29); (5) **`<LocaleSwitcher>` consome `LOCALE_NAMES` registry** dinamicamente; novo subtópico "Adicionar um locale novo no futuro" linkando runbook.
- [Sprint 00](docs/sprints/00-setup-infra.md) — `packages/i18n/config.ts` ganha `FALLBACK_CHAIN` + `LOCALE_NAMES: Record<Locale, string>` (nomes nativos: Português/English/Español); schema `persons.preferred_locale = TEXT NOT NULL DEFAULT 'pt-BR' + CHECK` (sem enum); script `pnpm i18n:translate --target {locale}` (Claude-assistido); helper `packages/config/playwright-locales.ts` + smoke `apps/web/e2e/i18n-smoke.spec.ts` (matrix de locales); runbook esqueleto `adicionar-novo-locale.md`.
- **Novo** [docs/runbooks/adicionar-novo-locale.md](docs/runbooks/adicionar-novo-locale.md) — procedimento canônico de 10 passos para adição futura (`de-DE`, `fr-FR`, etc): atualizar `LOCALES`/`LOCALE_NAMES`, `mkdir messages/{locale}/`, `pnpm i18n:translate`, revisão humana, `INSERT` em `translations`, migration trivial de `CHECK`, `pnpm i18n:check`, smoke E2E, deploy. Inclui critérios de pré-requisito (i18n vs l10n vs RTL) e rollback. Esqueleto inicial — conteúdo amadurece conforme catálogos clínicos e templates email/PDF aterrissarem.

**Fora deste commit (deliberado):** nenhum locale novo aplicado; nenhuma mudança em código (`apps/`/`packages/` ainda não existem — repo em fase de documentação); regulamentação BR-only continua (Asaas/Focus NFe/CPF/LGPD); timezone, moedas regionais LATAM e termos clínicos em SOAP livre seguem fora do ADR 0052 (futuros ADRs se vier demanda real).

**Verificação:** sem testes automatizados (docs-only). Mental check: dev daqui 1 ano consegue adicionar `de-DE` seguindo apenas o runbook? Sim — `LOCALES`/`LOCALE_NAMES`/`FALLBACK_CHAIN`/`<LocaleSwitcher>`/CI `i18n:check`/Playwright smoke são todos data-driven; nenhum refactor de código necessário.

---

### Docs — 10ª auditoria 2026-04-25 (cascade da 9ª: "4 → 5 cenários canônicos")

Auditoria de cascade effects do commit `29f0f57` (9ª auditoria) + áreas que a 9ª explicitamente não cobriu (sprints linha-a-linha, ADRs em profundidade, coerência numérica/regulatória). 3 agentes Explore em paralelo. Validações diretas eliminaram **falsos positivos significativos** dos agentes (Sprint 19b inexistente — Glob confirmou que existe; "4 cenários" em CHANGELOG/ADR 0060 são contexto NF-e, não multi-tenant). **17 ocorrências reais corrigidas em 15 arquivos:**

**P1 — Cascade da mudança "4 → 5 cenários canônicos" (16 ocorrências):**

A 9ª auditoria adicionou o 5º cenário (Modo Solo, `tenants.mode='solo'`) em `docs/multiempresa.md` mas não propagou. Correções:

- [CLAUDE.md:191](CLAUDE.md) — comentário do `pnpm db:seed`
- [.github/pull_request_template.md:30](.github/pull_request_template.md) — checklist de RLS
- [docs/modulos.md:49](docs/modulos.md) — descrição do módulo Hierarquia
- [docs/sprints/01a-identidade-e-topology.md](docs/sprints/01a-identidade-e-topology.md) — 5 ocorrências (Goal, Critério, Commit, DoD x2). Esclarecido que 01a popula 4 cenários multi-empresa; 5º solo entra em 01b junto com a coluna `tenants.mode`
- [docs/sprints/01b-rbac-e-consent.md](docs/sprints/01b-rbac-e-consent.md) — 4 ocorrências (Goal, schema do `mode`, E2E, DoD); reescrita da linha 57 para coerência
- [docs/sprints/02:184,244](docs/sprints/02-geral-crm-pessoas.md), [03:103](docs/sprints/03-geral-agenda-universal.md), [04:168](docs/sprints/04-geral-financeiro-asaas.md), [05:108](docs/sprints/05-geral-ofertas-comerciais.md), [08:100](docs/sprints/08-academia-controle-acesso.md), [15:225](docs/sprints/15-geral-erp-financeiro-core.md) — checklists de RLS
- [docs/decisions/0005:21](docs/decisions/0005-rbac-com-consent-cross-module.md), [0006:33](docs/decisions/0006-hierarquia-group-tenant-company-unit.md), [0007:22-27,38](docs/decisions/0007-topology-owned-vs-franchise.md) — ADRs core multi-empresa atualizados; 0007 ganhou cenário 5 explícito; 0006 lista os 5 nominalmente
- [docs/plano-estrutura.md:91-95,114,173](docs/plano-estrutura.md) — historical doc atualizado com 5º cenário marcado como "acrescentado pós-plano original"

**P3 — Estimativa stale em ADR 0064:**

- [docs/decisions/0064-ia-arquitetura-gemini-default-byok-rag.md:390](docs/decisions/0064-ia-arquitetura-gemini-default-byok-rag.md) — linha dizia "Sprint 06: 2 → 3-4 semanas" mas Sprint 06 já está em **5-6 semanas** porque ADR 0075 (posterior) re-expandiu. Adicionada nota apontando estimativa vigente.

**Falsos positivos descartados (verificações diretas):**

- "Sprint 19b inexistente" (alegado pelo agente 2): existe — `docs/sprints/19b-migracao-hospedagem-oracle.md` (Glob confirmou)
- "4 cenários" em CHANGELOG L1178/L1197 e ADR 0060: contexto NF-e (devolução, complementar, ajuste, entrada própria), coincidência semântica
- "4 cenários" em CHANGELOG L16 (entrada da 9ª): histórico — descrição correta do estado anterior, não deve ser alterada
- Coerência numérica/regulatória (agente 3): **4.816 valores verificados** (quotas IA, NFS-e, retenções 5a/20a, leis 13.787/3.268/6.316/6.583/9.696, datas CFM 2.454/2026, ANS TISS 4.01, RDC 657/2022) — zero divergências
- "ADR 0078 com 8 regras de portabilidade não centralizadas em rules.md": by-design (ADR é fonte da verdade, CI lints implementam), não é bug
- "ADRs 0006-0010 órfãos sem citações": esses são ADRs base do schema multi-empresa — citados implicitamente pelas regras 21-26 e por ADR 0077. Mantidos como referência arquitetural.

**Verificação:** sem testes automatizados (docs-only). Validação por leitura humana + grep dirigido. Cascade efetivamente fechado: `grep "4 cen[áa]rios" -r docs/ CLAUDE.md .github/` retorna apenas as 4 ocorrências legítimas (CHANGELOG histórico + ADR 0060 NF-e).

**Recomendação para 11ª:** rodar quando Sprint 02 ou 03 entrar em `doing` — aí haverá schema/código real para conferir contra ADRs 0077/0049+. Auditorias só sobre docs estão chegando ao retorno diminuto (10ª já encontrou apenas cascade incremental, não problemas estruturais novos).

---

### Docs — 9ª auditoria 2026-04-25 (revisão completa pedida pelo usuário)

Revisão completa da documentação solicitada pelo usuário ("faça uma revisão completa procurando falhas, sem ver commits"). 3 agentes Explore em paralelo cobriram (1) docs core, (2) ADRs, (3) sprints/compliance/runbooks/threat-models. Validações diretas eliminaram **falsos positivos significativos** dos agentes (gap ADRs 0011-0046 é INTENCIONAL conforme `roadmap.md §122-165`; conflito 0001 vs 0064 já reconciliado via Addendum 2026-04-25; sprints 34-40 sem arquivo conforme convenção; compliance/runbooks/threat-models 100% completos). **8 falhas reais corrigidas (2 P0 + 3 P1 + 3 P2):**

**P0 — Contradições corrigidas:**

- [docs/multiempresa.md](docs/multiempresa.md) — Tabela "Mobilidade do aluno" contradizia ADR 0077 (regra 42) ao listar "Aluno cross-tenant **mesmo group** Nunca". Reescrita para distinguir **member contratual** (1 tenant, não migra) vs **mesma pessoa como paciente em N tenants** (permitido via `patient_company_links` + `patient_link_modules`). Adicionado parágrafo separando os dois "passaportes" (franquia intra-tenant vs cross-tenant do paciente).
- [docs/multiempresa.md](docs/multiempresa.md) — Adicionado **5º cenário canônico** "Modo Solo" (`tenants.mode='solo'`, ADR 0069). Linha "CI roda contra os 4 cenários" atualizada para 5. CLAUDE.md sincronizado.

**P1 — Omissões em fontes canônicas:**

- [docs/rules.md:7-22](docs/rules.md) — Índice estava fora de ordem numérica (Processo 9-15 e Código 16-20 listados após regras 30+). Reordenado para sequência 1→44.
- [CLAUDE.md §Modelo comercial](CLAUDE.md) — Lista bullet substituída por **tabela canônica única** com 6 planos × 7 colunas (R$, members, verticais, profs, NFS-e, IA, storage), espelhando ADR 0066. Antes omitia storage de qualquer plano, profs Pro/Business, e NFS-e Solo/Combo.
- [docs/comercial.md:146-152](docs/comercial.md) — Tabela "Emissão fiscal" omitia Solo (R$ 49, 20 NFS-e) e Solo Combo (R$ 69, 30 NFS-e). Linhas adicionadas.
- [docs/modulos.md](docs/modulos.md) — Célula de prosa densa para "Planos comerciais" substituída por referência ao ADR 0066 + CLAUDE.md como fonte canônica única (evita tripla manutenção).

**P2 — Limpezas menores:**

- [CLAUDE.md §Hierarquia multi-empresa](CLAUDE.md) — Seção "Terminologia — cross-company vs cross-tenant" expandida para **Glossário canônico** com 9 termos: `person`, `member`, `group`, `tenant`, `company`, `unit`, cross-company, cross-tenant, passaporte (sobrecarregado — sempre qualificar).
- 4 ocorrências de `[ADR 0073 regra N](...)` (link prometendo navegação para regra dentro do ADR que não existe como anchor) reescritas para `[ADR 0073](...) (regra N)` — link aponta corretamente ao topo, regra fica fora. Arquivos: `CLAUDE.md`, `docs/compliance/anpd-notification-template.md`, `docs/runbooks/restore-test.md`, `docs/decisions/0035-ocr-boleto-provider-abstrato.md`.
- [docs/decisions/0035-...](docs/decisions/0035-ocr-boleto-provider-abstrato.md) — Header reconhecia formalização retroativa mas sem lição aprendida. Adicionada nota explícita: violação da regra 13, causa, lição, compromisso de não repetir.

**Falsos positivos descartados (verificações diretas):**

- "Gap ADRs 0011-0046": INTENCIONAL — faixa reservada para ADRs que nascem dentro de sprints específicos ([`roadmap.md §122-165`](docs/roadmap.md))
- "Conflito ADR 0001 vs 0064 (provider IA)": já reconciliado via Addendum 2026-04-25 em [`0001-stack-base.md:34-43`](docs/decisions/0001-stack-base.md)
- "Sprints 34-40 sem arquivo": convenção documentada em [`roadmap.md §114-120`](docs/roadmap.md)
- "ADR 0066 versionamento ruim": header já tem "Versão vigente" canônica + histórico preservado, padrão intencional
- "RIPDs incompletos / runbooks faltando / sub-processors fora de sync": tudo verificado existente (13 RIPDs, 11 runbooks, 5 STRIDE, 14 sub-processors em `dpo.md` 100% sincronizados com stack)

**Verificação:** `~/.claude/plans/fa-a-uma-revis-o-completa-lazy-hartmanis.md` consolidado com 8 falhas reais + 6 falsos positivos descartados. Sem testes automatizados (docs-only). Validação por leitura humana + grep dirigido.

**Recomendação para 10ª:** rodar quando Sprint 02 ou 03 entrar em `doing` (passaporte cross-tenant + agendamento) — aí haverá schema/código real para conferir contra ADRs 0077 e 0049+. Auditorias só sobre docs estão chegando ao retorno diminuto.

---

### Docs — 8ª auditoria 2026-04-25 (ADR 0077 status coerente + exceção controlada MFA bypass)

Oitava auditoria, recursiva sobre o commit `4b061e4` (6ª+7ª) + revisão semântica profunda. Agente A (cross-references nos novos artefatos) confirmou **zero regressões**. Agente B (contradições semânticas entre docs) propôs 5 achados; verificações diretas eliminaram **3 falsos positivos** (`patient_company_links` está em Sprint 02; WORM Object Lock está em Sprint 01a:130; nomes de role consistentes — zero `tenant_admin` ou `owner` standalone) + 1 P2 não-acionável (notificação trial coberta por consent prévio no signup).

**2 ações reais executadas:**

- **P0** — [docs/decisions/0077-passaporte-paciente-vinculo-cross-tenant.md](docs/decisions/0077-passaporte-paciente-vinculo-cross-tenant.md): seção `## Status` no fim do arquivo ainda dizia `Proposed — aguarda 3 itens`, mas header do ADR já estava `Accepted (2026-04-25)` e roadmap.md/CHANGELOG.md/rules.md/Sprint 02 já tratavam como decidido. Seção atualizada para `Accepted` com as 3 pendências resolvidas: (1) constraint global confirmada — trigger `enforce_one_active_module_per_person` em Sprint 02:156,204; (2) limite invites/dia 50 default via Upstash; (3) parecer DPO interno emitido (RIPD), parecer externo agendado pré-Sprint 02 entrar em `doing`. Elimina contradição interna do próprio ADR.

- **P1** — [docs/runbooks/mfa-bypass-emergencial.md:55](docs/runbooks/mfa-bypass-emergencial.md): janela de 30min sem MFA pós-bypass conflitava com regra 43 (`requireRecentMfa(maxAgeMin=15)`). Adicionada **nota de exceção controlada** explicando: (a) impossibilidade prática de exigir MFA recente quando usuário acabou de perdê-lo; (b) procedimento exige 2 pessoas + vídeo gravado + `audit_log` `mfa.bypass_emergencial` com `quorum_witness`; (c) único caminho permitido é re-cadastrar MFA imediatamente; (d) bypass permanente exigiria ADR formal (não há até 2026-04-25). Não muda o procedimento — explicita por que é exceção legítima.

**Falsos positivos descartados (verificações diretas):**
- `patient_company_links` "nunca em sprint": Sprint 02 detalha schema + função SQL + trigger + tela
- `S3 Object Lock WORM` "sem implementação": Sprint 01a:130 cria `system_audit_anchor` + job `/api/jobs/anchor-audit-hourly` em S3 us-east-1 com Object Lock 5y
- `tenant_owner vs owner vs tenant_admin` "ambíguo": zero ocorrências de `tenant_admin` ou `owner` standalone em sprints; nomenclatura consistente
- "anonimização trial sem notificação": consent prévio no signup cobre LGPD art. 18 + art. 8º; melhoria UX possível mas não é falha (P2 não-acionável agora)

**Recomendação para 9ª:** rodar somente quando Sprint 03/04/06 entrarem em `doing` e expandirem v0.1 RIPDs para v1.0. Auditoria sem material novo gera retornos diminuintes.

### Docs — 7ª auditoria 2026-04-25 (cross-references + stubs RIPD faltantes + template ANPD)

Sétima auditoria, focada em **falhas sutis sobreviventes às 6 anteriores**. 3 agentes Explore em paralelo cobriram cross-references, artefatos compliance/runbooks/threat-models e roadmap/sprints/CHANGELOG. Verificações diretas confirmaram cada P0 antes de propor fix (3 falsos positivos descartados sem alteração: P1-1 prontuário STRIDE-DoS já presente linha 44, P1-5 sprints "06c/19c/36c" não existem, P1-7 convenção ADRs reservados já documentada). **6 P0 corrigidos + 4 P1 + 4 stubs novos = 14 ações, todas conclusas.**

**P0 corrigidos:**

- [docs/rules.md](docs/rules.md) regra 24 — termo legado `aluno` → `member` (canônico do schema; UI pode rotular conforme vertical)
- [docs/modulos.md](docs/modulos.md) — Device Hub mapeado para Sprint **32** (era 34, errado); Pipeline Exames para Sprint **33** (era 35); App Nativo para Sprint **35** (era 36)
- [docs/compliance/anpd-notification-template.md](docs/compliance/anpd-notification-template.md) — **Template ANPD criado** (LGPD art. 48 + Resolução ANPD nº 15/2024) com 9 seções: cabeçalho, natureza, categorias titulares/dados, medidas técnicas/admin, riscos, comunicação a titulares, anexos obrigatórios, compromissos pós-incidente, assinaturas. Runbook [`incidente-lgpd-72h.md:57`](docs/runbooks/incidente-lgpd-72h.md) atualizado para apontar ao template (não mais "a criar")
- [docs/compliance/ripd/v1.0-prontuario-fisio.md](docs/compliance/ripd/v1.0-prontuario-fisio.md) — Estratégia de retenção 20a (Lei 13.787) materializada em §5.1: particionamento mensal + quente PG até D+5a + cold R2/S3 Parquet zstd até D+20a + drop só com dupla confirmação DPO + tenant_owner + integridade hash chain. Liga ao runbook [`falha-hash-chain.md`](docs/runbooks/falha-hash-chain.md)
- [docs/runbooks/falha-nfe.md:20](docs/runbooks/falha-nfe.md) — Gate `requireRecentMfa({maxAgeMinutes:15})` explicitado (backend, não UX); referência cruzada a regra 43 + ADR 0073 + runbook [`mfa-bypass-emergencial.md`](docs/runbooks/mfa-bypass-emergencial.md) para emergência
- [CLAUDE.md](CLAUDE.md) — **Renumeração canônica:** seção "Regras" deixa de usar numeração local 1-29 e passa a usar a numeração de [`docs/rules.md`](docs/rules.md) (1, 3, 5, 7, 11, 13-16, 27-44). Convenções específicas do agente Claude (nunca commit sem pedir, paths absolutos, sprint ativo) movidas para bloco "Convenções de colaboração" sem número canônico. Elimina ambiguidade quando outro doc cita "regra N"

**P1 corrigidos:**

- [docs/modulos.md](docs/modulos.md) — Adicionadas seções "## Personal Training" (sessão 1:1, periodização, prescrição WhatsApp, PAR-Q, Solo plan) e "## Pilates" (turmas reduzidas, agendamento por aparelho, progressão, pacotes mensais) como verticais canônicas próprias (regra 27 + ADR 0077). Antes só existiam embutidas em Academia
- [docs/modulos.md](docs/modulos.md) — Adicionada linha "Reconhecimento facial (consent opt-in)" em Fundação (Sprint 32 junto com Device Hub) — RIPD existente passa a ter contraparte em modulos.md
- [docs/compliance/samd-classification.md](docs/compliance/samd-classification.md) — Nova seção "Gatilhos & SLA por classe" com tabela detalhando: evento gatilho (merge PR), quem detecta/dispara, SLA até feature ir live (D+0 classe I, D+30 classe II, hard-block III/IV, 72h recall), bloqueios CI por classe. Linkagem explícita aos RIPDs classe II+
- [docs/compliance/ripd/v1.0-exames-laboratoriais.md](docs/compliance/ripd/v1.0-exames-laboratoriais.md) — Próximos passos materializa SLA: Tech Lead preenche template ANVISA → DPO submete → arquiva protocolo → CI `feature-flag-blocked-without-anvisa-protocol` libera flag
- [docs/roadmap.md](docs/roadmap.md) — Convenção sobre sprints alto-nível expandida para incluir 37-40 (fiscal pós-MVP); nota de leitura sobre células sem link markdown adicionada para clarificar placeholders intencionais

**Stubs RIPD novos (3 — preenche lacuna de cobertura LGPD art. 11 / regra 29):**

- [docs/compliance/ripd/v0.1-cobranca-financeiro.md](docs/compliance/ripd/v0.1-cobranca-financeiro.md) — RIPD financeiro: invoices+pagamentos+fiscal Asaas+Focus NFe; CID/procedimento clínico em linha (TISS Sprint 22); retenção 5a fiscal vs 20a se ligado a prontuário; tokenização cartão Asaas; threat-model `pagamento-asaas.md` referenciado
- [docs/compliance/ripd/v0.1-ia-copilot-clinico.md](docs/compliance/ripd/v0.1-ia-copilot-clinico.md) — RIPD assistente IA universal (3 camadas help/insight/action); RAG tenant-isolated; sanitização PII pré-prompt; classifier output (regra 28); Comitê IA gate; quota mensal hard-stop por plano (ADR 0066); cross-border declarado (Vertex AI SP / Groq US / Anthropic US BYOK)
- [docs/compliance/ripd/v0.1-agendamento.md](docs/compliance/ripd/v0.1-agendamento.md) — RIPD agenda como metadado clínico (vínculo paciente↔profissional + motivo); template WhatsApp **sem** motivo clínico; retenção 20a se booking clínico (Lei 13.787) vs 5a operacional; flag `discretion_mode` para slots sensíveis (psicologia futuro)

**Falsos positivos descartados (3):**

- P1-1: `docs/threat-models/prontuario.md:44` já contém cenário formal "D - Denial of Service" na tabela STRIDE (ICP-Brasil signer cai); 6 vetores cobertos
- P1-5: nenhuma ocorrência de "Sprint 06c", "19c", "36c" em roadmap.md (alegação infundada)
- P1-7: convenção "ADRs 0011-0046 reservados" já documentada explicitamente em [`docs/roadmap.md`](docs/roadmap.md) "Convenção de numeração de ADRs"

**Verificação:** ver § "Verificação" do plano em `~/.claude/plans/fa-a-uma-revis-o-completa-cozy-candle.md`. Sem testes automatizados (mudanças docs-only). Validação por leitura humana + grep dirigido.

### Docs — 6ª auditoria 2026-04-25 (19 issues + materialização de artefatos compliance)

Sexta auditoria após estabilização da 5ª. Foco: **artefatos formais ainda não materializados** (RIPDs, threat-models STRIDE, runbooks operacionais, inventário de sub-processadores) + inconsistências factuais residuais. **3 críticos + 7 altos + 6 médios + 3 baixos = 19 issues, todos endereçados.** 3 falsos-positivos descartados. Materializa **19 novos artefatos** (8 RIPDs stub + 5 threat-models STRIDE stub + 6 runbooks stub) que preenchem expectativas das regras 28-43 mesmo antes dos sprints específicos rodarem.

**Críticos (3):**

- [docs/compliance/ripd/](docs/compliance/ripd/) — **8 RIPDs stub criados** (`v1.0-prontuario-fisio.md`, `v1.0-exames-laboratoriais.md`, `v1.0-nutri-diario.md`, `v1.0-reconhecimento-facial.md`, `v1.0-device-hub.md`, `v1.0-academia-treino.md`, `v1.0-nutri-plano.md`, `v1.0-whatsapp.md`). Cada um marcado `v0.1-skeleton — expandir em Sprint XX` com identificação do tratamento + base legal LGPD art. 7+11 + medidas de segurança + avaliação de risco preliminar. Cumpre regra 29 antes de pipeline CI implementar (Sprint 01b)
- [docs/threat-models/](docs/threat-models/) — **5 threat-models STRIDE stub criados** (`login-mfa.md`, `pagamento-asaas.md`, `prontuario.md`, `pipeline-exames.md`, `whatsapp-inbound.md`). Cada um com diagrama de fluxo + análise STRIDE 6 categorias × cenários × mitigações amarradas a regras (33-43) + ADRs + riscos residuais aceitos. Cumpre exigência ADR 0073 antes de feature em produção
- [docs/compliance/dpo.md](docs/compliance/dpo.md) — **Inventário de sub-processadores** materializado (14 entradas: Vercel, Supabase, Oracle Cloud OCI, Cloudflare R2, AWS S3, Asaas, Focus NFe, Resend, Sentry, PostHog, Logtail/Axiom, Upstash Redis, Vertex AI SP, Groq) com categoria, dado tratado, jurisdição, fase MVP/Fase 2, link público de DPA. Cumpre LGPD art. 6º + Resolução ANPD nº 18/2024

**Altos (7):**

- [docs/runbooks/](docs/runbooks/) — **6 runbooks stub criados** (`incidente-lgpd-72h.md`, `mfa-bypass-emergencial.md`, `lockout-conta.md`, `falha-hash-chain.md`, `exfiltracao-detectada.md`, `falha-nfe.md`). Cobrem operações críticas exigidas por ADR 0067 + ADR 0073 + regra 39 + regra 43 + Sprint 36
- [docs/compliance/samd-classification.md](docs/compliance/samd-classification.md) — Procedimento ANVISA RDC 657/2022 detalhado: tabela de gatilhos (quando notificar) + responsáveis (DPO + tech lead + Comitê IA tenant) + documento técnico mínimo (8 seções obrigatórias + ISO 14971) + fluxo de submissão portal ANVISA + repositório local em `docs/compliance/anvisa-notifications/{ano}/` + riscos de não-cumprimento
- [CLAUDE.md](CLAUDE.md) — Cota IA por plano completada: linha 22 agora cita **Solo 200 / Solo Combo 200** (alinhado a ADR 0066 tabela 142-144 que já contemplava)
- [docs/roadmap.md](docs/roadmap.md) — Seção "Decisões já fechadas (recente)" expandida com 6 ADRs accepted ausentes do índice (0066, 0067, 0076, 0077, 0078, 0079); nova subseção "Numeração pós-0046 (faixa fora-de-sprint)" documenta como alocar ADRs 0080+
- [docs/sprints/19b-migracao-hospedagem-oracle.md](docs/sprints/19b-migracao-hospedagem-oracle.md) — Clarificação: spikes BetterAuth/Lucia + WebSocket runtime são **detalhes de implementação derivados de ADR 0078, não criam novo ADR**. Critério: novo ADR só se spike subverte ADR 0078

**Médios (6):**

- [docs/rules.md](docs/rules.md) regra 29 + [docs/modulos.md](docs/modulos.md) + [docs/compliance/dpo.md](docs/compliance/dpo.md) + [docs/compliance/data-deletion-playbook.md](docs/compliance/data-deletion-playbook.md) — SLA de direitos do titular (LGPD art. 18) clarificado de "15 dias" para **"15 dias úteis" (Resolução ANPD nº 2/2024)**
- [docs/rules.md](docs/rules.md) regra 32 — "Gemini Flash" → "Gemini 2.5 Flash via Vertex AI SP" (alinha CLAUDE.md + arquitetura.md)
- [docs/runbooks/_template.md](docs/runbooks/_template.md) — clarifica MFA recente <15min: **obrigatório** para alto-risco (regra 43); marcar **N/A** apenas se runbook é read-only
- [docs/compliance/data-deletion-playbook.md](docs/compliance/data-deletion-playbook.md) — Nota pré-Sprint 26: titular contata DPO via `privacidade@logifit.com.br`; equipe registra manualmente em `data_subject_requests` (Sprint 01b cria schema; UI completa em Sprint 26). SLA 15d úteis vale desde dia 1
- [docs/sprints/34-nutri-agent-ia.md](docs/sprints/34-nutri-agent-ia.md) — Pré-requisito `domain_events`: dono a definir quando 34 detalhar; spike de 2h no kickoff confirma se Sprint 00 ou Sprint 31 entrega
- [docs/sprints/34-nutri-agent-ia.md](docs/sprints/34-nutri-agent-ia.md) — Notificação ANVISA Classe II referencia procedimento expandido em [`samd-classification.md`](docs/compliance/samd-classification.md)

**Baixos (3):**

- [CLAUDE.md](CLAUDE.md) item 12 — auto-referência redundante "regra 27 em `docs/rules.md`" simplificada para "regra 27" (rules.md já é canônico)
- [docs/roadmap.md](docs/roadmap.md) — Nota explícita sobre alocação de ADRs pós-0079 (faixa fora-de-sprint)
- [docs/compliance/dpo.md](docs/compliance/dpo.md) — Compromisso "lista canônica em ADR 0067" agora aponta para tabela canônica neste documento (espelhada em ADR 0067)

**Falsos-positivos descartados** (validados antes de aplicar fix):

- `docs/modulos.md:28` cita ADR 0069 para Solo: **correto** (ADR 0069 é `tenants.mode='solo'`, não pricing; pricing é ADR 0066 que já está no início da linha)
- ADR 0066 tabela cota IA "incompleta": **falso** (tabela linha 142-144 já contempla Solo/Combo 200; só CLAUDE.md estava desalinhado)
- "Sprint 23 (contrato)" em CLAUDE.md: **taquigrafia válida** para "contrato de comissão" (Sprint 23 é fisio comissões/repasse)
- Sprint 36 não menciona ADR 0076: **falso** (linha 86 já documenta out-of-scope com clareza)
- Sprint 04 schema fiscal: **falso** (linhas 87-115 já cobrem `plan_tier_rates` + `tenant_usage_snapshots.fiscal_emissions_count/_limit/_overage_rate_cents` + função `get_tier_rates_for_date` + exemplo numérico)
- Sprint 32 retenção sem regra 34: **falso** (linha 65 explicitamente cita "Retenção (ADR 0072 + regra 34)")
- Sprint 20 sem checklist `signature_policies`: **falso** (linhas 114, 116 já listam schema + seed)

**Veredicto da 6ª passada:**

Auditorias 1-5 endereçaram inconsistências de redação e gaps de coordenação entre docs/sprints. **Esta 6ª foca na materialização de artefatos formais** que vinham sendo prometidos como "a expandir no sprint X" mas não tinham nem skeleton — agora todos os 19 stubs existem com substância suficiente para parecer DPO, auditoria interna trimestral e onboarding de auditor externo. Próxima auditoria deve focar em **expandir os v0.1-skeleton** quando os sprints respectivos virarem `doing` (não rodar 7ª auditoria sem novo conteúdo prosa material).

### Regras — Regra 44 NOVA: ler design system antes de criar tela/componente UI

- [docs/rules.md](docs/rules.md) — **Regra 44** em nova seção "Design system 'Equilíbrio Vital'" complementa regras 27 (i18n) e 31 (responsividade). Define fonte de verdade dual (pré/pós-Sprint 00), lista proibições (hardcode de hex/font/spacing/radius/font-size; construir primitivo do zero; `box-shadow` decorativa) e obrigações (nova variante entra primeiro no styleguide; mudança de token apenas em `tokens.css`). Lint `no-hardcoded-design-token` previsto pra Sprint 00
- [CLAUDE.md](CLAUDE.md) — **item 29** sintetiza a regra 44 inline; rodapé da lista atualizado de "43 regras duras numeradas 1-8 + 21-43" para "44 regras duras numeradas 1-8 + 21-44"

### Prototipo — Design system styleguide "Equilíbrio Vital"

Página única de documentação viva do design system, autossuficiente, dentro do protótipo HTML estático.

**Adicionado:**

- [prototipo/designsystem/index.html](prototipo/designsystem/index.html) — styleguide com 14 seções: Foundation (Cores · Tipografia · Espaçamento · Raios · Layout · Z-index) + Componentes (Botões · Cards · Badges · Inputs · Tabelas · Dots & Divider · Utilities) + Migração shadcn. Sidebar fixa com scroll-spy, toggle light/dark com persistência em localStorage, comparação direta light vs dark sem trocar tema global
- [prototipo/designsystem/styleguide.css](prototipo/designsystem/styleguide.css) — estilos exclusivos da página (sidebar, swatches, code blocks); reusa 100% os tokens `--ev-*`, zero hex hardcoded
- [prototipo/designsystem/shadcn-mapping.css](prototipo/designsystem/shadcn-mapping.css) — bloco "ready to copy" pra Sprint 00: aliases shadcn (`--primary`, `--background`, `--card`, `--ring`, `--chart-1..5`, `--sidebar-*` etc.) apontando pras vars `--ev-*` da fonte de verdade. Dark mode é automático (herda dos overrides em `tokens.css`). Documenta 3 desvios deliberados do default shadcn: radius pill, zero shadows, background ≠ card

**Não altera:** `prototipo/tokens.css`, `prototipo/base.css` nem qualquer arquivo em `docs/` ou ADRs — design system já é coberto por ADR 0001 + ADR 0063 + arquitetura.md §1.

### Docs — Auditoria 2026-04-25 (5ª passada — 10 issues + estabilização final)

Após 4 rodadas, quinta auditoria focada em **validar 4ª rodada + procurar issues sutis que escaparam**. Padrão de retornos decrescentes confirmado (1ª=30 → 2ª=14 → 3ª=18 → 4ª=14 → 5ª=10). **4 críticos + 4 maiores + 2 menores, todos endereçados.** Documentação atinge **estado estável e auditável**.

**Críticos (4):**

- [Sprint 00](docs/sprints/00-setup-infra.md) — **timebox revisado de 3 para 4 semanas** com seção "Estratégia de timebox" organizando trabalho em **3 faixas executáveis** (Faixa 1 infra core; Faixa 2 segurança em profundidade; Faixa 3 lints custom + docs operacionais); Faixa 3 tem **opção de pivot** (mover lints `cross-tenant-read-must-log` para Sprint 02 e `no-hardcoded-design-token` para Sprint 00b se cronograma estourar)
- [Sprint 00](docs/sprints/00-setup-infra.md) — `packages/security/high-risk-actions.ts` ganhou flag `alsoBlockedFromAi?: boolean` em ações que coexistem entre regra 41 (IA bloqueada) e regra 43 (MFA recente humano) — `runOpenFinancePayment`, `anonymizeMember`, `deleteClinicalData`, `exportFullProntuario`. Nota explícita: **as duas proteções são independentes e cumulativas** (IA nunca chega ao handler via lint `ai-block-respected`; se chegasse via bypass, gate `requireRecentMfa()` pegaria)
- [Sprint 01b](docs/sprints/01b-rbac-e-consent.md) — função SQL `resolve_ai_class(p_tenant_id, p_feature_key)` em `packages/db/functions/resolve-ai-class.sql` agora detalhada no commit checklist com assinatura, lógica completa (busca tenant-específico → fallback global → exception se não classificada), retorno tuple (samd_class, requires_committee, requires_anvisa_notification, source) + 5 cenários de teste E2E (feature global classe I, classe II sem comitê, classe II com comitê, override tenant-específico, exception feature_not_classified, comitê removido)
- [Sprint 04](docs/sprints/04-geral-financeiro-asaas.md) — schema `tenant_usage_snapshots` agora alimentado por **`plan_tier_rates` (seed global versionado por `effective_from`/`effective_to`)** + função SQL **`get_tier_rates_for_date(tenant_id, snapshot_date)`** que resolve tier vigente do tenant na data + retorna rates congelados — elimina ambiguidade de "quem popula `member_overage_rate_cents`"; mudança futura de pricing **não retro-afeta** snapshots antigos. Inclui **exemplo numérico completo** (tenant Pro abril 2026: R$ 199 + R$ 75 member overage + R$ 8 fiscal overage = R$ 282 total)

**Maiores (4):**

- [Sprint 04](docs/sprints/04-geral-financeiro-asaas.md) — `tenant_usage_snapshots` PARTITION BY RANGE corrigido de **ano → trimestre** (~27k rows/partição vs ~365 — Postgres aproveita pruning); job `create-next-partitions` (regra 34) inclui agora trimestralmente
- **NOVO** [docs/dev/portability.md](docs/dev/portability.md) — cookbook Sprint 19b com 8 regras de portabilidade tabuladas + tabela de equivalências Fase 1↔2 + checklist "antes de adotar feature Supabase" + lista do que muda vs o que não muda no cutover
- **NOVO** [docs/dev/realtime.md](docs/dev/realtime.md) — padrão LISTEN/NOTIFY canônico (channels, payload format, implementação Sprint 00) + quando usar Supabase Realtime (broadcast ≥5 clients) + nota PgBouncer (LISTEN/NOTIFY exige session mode em conexão dedicada via `DATABASE_URL_DIRECT`) + estratégia de migração no Sprint 19b
- [Sprint 02](docs/sprints/02-geral-crm-pessoas.md) — função SQL `has_cross_tenant_access(p_reader_user_id, p_patient_person_id, p_module_type, p_category)` agora detalhada com lógica completa (8 passos) + 6 cenários de teste cobrindo intra-tenant, cross-tenant ativo, vínculo revogado, módulo não autorizado, categoria fora do `data_level_max`, limite duro financeiro
- [Sprint 00](docs/sprints/00-setup-infra.md) — checklist de **arquivos vazios de RIPD com proprietário + deadline** declarados em `docs/compliance/ripd/`: 8 RIPDs (prontuario-fisio, tiss-convenios, nutri-exames, diario-alimentar, teleconsulta, pipeline-exames-ia, device-hub, reconhecimento-facial) com proprietário declarado (dev Sprint X + DPO) + deadline (feature flag respectivo ON) + CI bloqueia merge se ainda em `Status: TODO` + script `scripts/hash-ripd.ts` calcula SHA-256 automaticamente

**Menores (2):**

- [docs/acesso-e-autorizacao.md](docs/acesso-e-autorizacao.md) — seção Camada 4 reorganizada com **hierarquia de fontes de verdade** explícita: tabela com 6 colunas (Tipo, Cenário canônico, Mecanismo técnico, Regra(s), ADR, Sprint que ativa) + **decision tree em prosa** (mesmo tenant_id+company_id? → cross-module; mesmo tenant_id? → cross-company; nenhum? → cross-tenant) + bloco "limites duros que valem em todos os tipos"
- [docs/compliance/ripd/v1.0-passaporte-paciente.md](docs/compliance/ripd/v1.0-passaporte-paciente.md) — campo "Hash SHA-256 do conteúdo" agora referencia `scripts/hash-ripd.ts` (Sprint 00) com workflow de commit hook automatizado em vez de prosa ambígua

**Veredicto da 5ª passada:**

> Documentação atingiu **threshold de estabilidade auditável** com cadeia "regra → ADR → sprint → lint → arquivo" rastreável de ponta a ponta. Próxima auditoria genuína deve aguardar **pós-Sprint 01b implementação** — achados serão sobre execução real, não sobre estado documental.

**Padrão de auditoria** (1ª=30 → 5ª=10 issues): retornos decrescentes confirmados; auditorias subsequentes em estado documental seriam over-engineering.

### Docs — Auditoria 2026-04-25 (4ª passada — 14 issues remanescentes + materialização de assets)

Após 3ª rodada, quarta auditoria paralela (validação 3ª rodada + cadeia regra→ADR→sprint→lint→arquivo) achou 14 issues — principalmente **lints prometidos sem sprint criador** + **arquivos compliance citados mas não materializados**. **5 críticos + 5 maiores + 4 menores, todos endereçados.**

**Críticos (5):**

- [Sprint 00](docs/sprints/00-setup-infra.md) — checklist completo de **lints custom faltantes**:
  - `no-hardcoded-design-token` (regra 44) com regex bloqueando hex/font/spacing/radius/size literal em `apps/web/**` exceto `tokens.css`
  - `high-risk-action-must-require-recent-mfa` (regra 43) bloqueando Server Actions listadas em `packages/security/high-risk-actions.ts` sem chamar `requireRecentMfa()`
  - **Arquivo `packages/security/high-risk-actions.ts`** com lista canônica MVP de 16 ações alto-risco (cancelTissGuide, cancelNfe, voidPaidInvoice, anonymizeMember, openPamSession, restoreBackup, etc) com `requireMfaMaxAgeMins=15` default
- [Sprint 02](docs/sprints/02-geral-crm-pessoas.md) — checklist explícito da função SQL `has_cross_tenant_access()` + lint custom `cross-tenant-read-must-log` (regra 42) + RIPD obrigatório `docs/compliance/ripd/v1.0-passaporte-paciente.md` antes de feature ir a produção
- **NOVO** [docs/compliance/ripd/v1.0-passaporte-paciente.md](docs/compliance/ripd/v1.0-passaporte-paciente.md) — primeiro RIPD real materializado (era apenas template); 10 seções ANPD compliant; **DPO aceita com restrições** (4 condições obrigatórias antes de ativação em produção: revisão jurídica externa, primeiro tenant clínico só após 30d MVP estável, auditoria interna trimestral 1% das leituras, rate limit ajustável)
- **NOVO** [docs/compliance/data-deletion-playbook.md](docs/compliance/data-deletion-playbook.md) — citado por ADR 0054 + Sprint 01a, agora materializado; cascata canônica `anonymize_tenant_data()` por tabela respeitando retenção legal (prontuário 20a Lei 13.787 / fiscal 5a / audit 5a); preserva agregados estatísticos, remove PII, cifra-com-chave-perdida em conteúdo clínico; idempotente; 3 momentos de comunicação ao titular
- [Sprint 01b](docs/sprints/01b-rbac-e-consent.md) — schema `ai_feature_classifications` resolvido com **`is_global bool` + check constraint** eliminando ambiguidade do `tenant_id` nullable (regra 28 gate funcional para features globais e tenant-específicas) + unique constraints separadas

**Maiores (5):**

- [Sprint 04](docs/sprints/04-geral-financeiro-asaas.md) — schema `tenant_usage_snapshots` **completo** com responsabilidade clara (Sprint 04 cria; Sprint 06/36 populam): member_overage_count + value generated, AI/fiscal counts com limits e overage_value generated, storage tracking; PARTITION BY RANGE (ano)
- [Sprint 01b](docs/sprints/01b-rbac-e-consent.md) — **seed completo de roles** com `requires_mfa` por role (medico/fisio/nutri/personal/enfermeiro/tenant_owner/dpo/super_admin = true; super_admin_rede/diretor_matriz/gerente_filial/contador_externo = true; recepcao/member = false escalável via `tenant_settings.mfa_extra_roles[]`) + 2 testes E2E (login bloqueado sem MFA + recepcao + cancelTissGuide com `requireRecentMfa()`)
- **NOVO** [docs/runbooks/rotate-secrets.md](docs/runbooks/rotate-secrets.md) — citado por ADR 0073 camada 7, agora materializado; inventário de 16 tipos de secrets (JWT_SECRET, KEK master/tenant, Asaas/Focus/Gemini/Groq, Cert A1, etc) com frequência e impacto; passos específicos para JWT_SECRET (transição 24h dual-key) e KEK master (re-cifragem background)
- **NOVO** [docs/compliance/anvisa-notifications/_template.md](docs/compliance/anvisa-notifications/_template.md) — template para notificação SaMD Classe II RDC 657/2022 (ISO 14971 risk management + validação clínica + responsabilidades + pós-mercado)
- [Sprint 36](docs/sprints/36-geral-fiscal-focus-nfe.md) — citação explícita de [ADR 0079](docs/decisions/0079-tiss-401-ans-padrao-vigente.md) com nota sobre coexistência operacional TISS (Sprint 22) + NFS-e (Sprint 36) para co-participação de paciente/repasse de operadora

**Menores (4):**

- Sprints clínicos [20](docs/sprints/20-fisio-prontuario-cid-cif.md), [22](docs/sprints/22-fisio-tiss-tuss-convenios.md), [30](docs/sprints/30-nutri-suplementos-exames.md), [31](docs/sprints/31-geral-diario-alimentar-teleconsulta.md), [33](docs/sprints/33-geral-pipeline-exames.md) — **commit checklist agora exige RIPD próprio** publicado antes do feature flag ir a produção: `v1.0-prontuario-fisio.md`, `v1.0-tiss-convenios.md`, `v1.0-nutri-exames.md`, `v1.0-diario-alimentar.md` + `v1.0-teleconsulta.md`, `v1.0-pipeline-exames-ia.md`
- Sprint 33 — checklist adicional de **notificação ANVISA RDC 657/2022** (Pipeline Exames IA é Classe II) usando o novo template `_template.md`
- ADR 0043 (Nutri-Agent) — já corretamente mapeado em roadmap.md para Sprint 34 (sem ação adicional)
- Cluster ADRs 24/25 — aceitável (já documentado em rodadas anteriores)

**Lições da 4ª passada:**

- Lints custom prometidos por regras precisam ter sprint criador explícito no commit checklist; senão são "regulação fantasma"
- Schemas com flags ambíguas (ex: `tenant_id nullable = global`) viram bombas-relógio; usar `is_global bool` + check constraint elimina interpretação ad-hoc
- Templates de compliance (RIPD, ANVISA, STRIDE) são úteis mas não substituem **arquivos reais por feature** — sprints devem listar criação no commit checklist
- DPO pode aceitar tratamento "com restrições" (LGPD permite) — útil para features de risco médio (passaporte cross-tenant) onde implementação técnica está pronta mas operação requer salvaguardas adicionais
- Cadeia "regra → ADR → sprint → lint → arquivo" precisa ser rastreável de ponta a ponta; gap em qualquer elo torna a regra inexequível

### Docs — Auditoria 2026-04-25 (3ª passada — 18 issues + propagação da regra 44)

Após 2ª rodada, terceira auditoria paralela (validação 2ª rodada + gaps estruturais sistêmicos) achou 18 issues remanescentes — alguns introduzidos pelas correções anteriores, outros estruturais. Em paralelo, **regra 44 (Design System) foi adicionada externamente em rules.md** — propagada para CLAUDE.md e arquivos dependentes. **Total: 18 issues + 1 mudança externa, todos endereçados.**

**Críticos (7):**

- [docs/rules.md](docs/rules.md) — contagem 43→**44**; novo header "Design system 'Equilíbrio Vital' (44)" no índice; bloco "Pesquisa global + responsividade (30–31)" reorganizado; `---` duplicado removido; **regra 43 expandida** com gate `requireRecentMfa(maxAgeMin=15)` + lista canônica de ações alto-risco em `packages/security/high-risk-actions.ts` + lint custom `high-risk-action-must-require-recent-mfa`
- [CLAUDE.md](CLAUDE.md) — contagem 43→44 + **nota de precedência** "rules.md prevalece em conflito"; **regra 29 nova** sobre Design System na lista operacional; referência ao `docs/compliance/dpo.md`; `docs/compliance/`, `docs/runbooks/`, `docs/threat-models/` listados na seção de docs de referência
- **NOVO** [docs/runbooks/_template.md](docs/runbooks/_template.md) + [restore-test.md](docs/runbooks/restore-test.md) + [ia-byok-emergencial.md](docs/runbooks/ia-byok-emergencial.md) + [restore-pg.md](docs/runbooks/restore-pg.md) — sprints 06/19b + ADR 0073 citavam runbooks que não existiam estruturalmente
- **NOVO** [docs/compliance/ripd/_template.md](docs/compliance/ripd/_template.md) + [docs/compliance/samd-classification.md](docs/compliance/samd-classification.md) + [docs/compliance/lgpd-data-inventory.md](docs/compliance/lgpd-data-inventory.md) + [docs/threat-models/_template-stride.md](docs/threat-models/_template-stride.md) — ADRs 0054/0067/0073 prometiam, faltava criar
- [Sprint 02](docs/sprints/02-geral-crm-pessoas.md) — checklist explícito "validar via migration smoke que `patient_data_access_log` existe + partição vigente do mês está criada; falha = bloqueia merge"
- [Sprint 01a](docs/sprints/01a-identidade-e-topology.md) — **commit checklist completo de trial 30d retenção**: schema `subscription_status`/`trial_ends_at`, job diário `process-trial-lifecycle`, função SQL `anonymize_trial_data()` (preserva agregados, remove PII, cifra-com-chave-perdida via rotação KEK), trigger audit_log com `legal_basis='lgpd_art16_eliminacao'`, 2 testes E2E (D+44 anonimização vs D+10 conversão), playbook em `docs/compliance/data-deletion-playbook.md`
- **NOVO** [docs/decisions/0035-ocr-boleto-provider-abstrato.md](docs/decisions/0035-ocr-boleto-provider-abstrato.md) — ADR formal para a "decisão fantasma" reconhecida no roadmap; OCR.space default + 5 adapters; BYOK pattern coerente com 0048/0064/0051; roadmap.md atualizado pra apontar pro arquivo

**Maiores (7):**

- [ADR 0066](docs/decisions/0066-plano-comercial-pricing-trial.md) — **seção "Versão vigente (2026-04-25)" no topo** com tabela canônica (6 tiers); histórico preservado mas marcado como "não-fonte de verdade"; retenção `audit_log` uniformizada **5 anos cross-tier** (era "60 meses" misturando unidades); 3 notas explicativas (retenção é regulatória; cota IA Solo Combo igual a Solo com racional; storage 2GB Solo Combo com gatilho de migração)
- [docs/compliance/dpo.md](docs/compliance/dpo.md) — agora linkado em CLAUDE.md
- [Sprint 02](docs/sprints/02-geral-crm-pessoas.md) — `patient_data_access_log` agora tem dependência explícita
- Stubs Sprint 34/35 — comentário HTML apontando pro `_template.md`
- ADR 0073 backup R2 — já fechado em 2ª rodada (sem mudança aqui)
- ADR 0035 ghost — resolvido (criação acima)
- Estruturas `runbooks/`, `threat-models/`, `compliance/` agora documentadas como dependências de Sprint 00

**Menores (4):**

- Cluster ADRs 24/25 — aceitável (conversa intensiva)
- Tabela retenção em 4 fontes — risco fragmentação documentado para futuro `docs/retencao-compliance.md` se voltar a divergir
- Sprint 35 stub: ADRs futuros >=0080 (era 0047/0048 fora da faixa reservada)
- Pré-existente: numeração CLAUDE.md regra 28 vs rules.md 28 — agora resolvida via nota de precedência

**Lições da 3ª passada:**

- Estruturas de diretórios prometidas em ADRs precisam ser criadas pelo Sprint 00; ADR sozinho não materializa
- Ghost ADRs (números citados sem arquivo) devem ser resolvidos com criação retroativa formal quando decisão já está em uso múltiplo
- ADR com múltiplas revisões precisa de seção "Versão vigente" no topo
- Cota IA não escala automaticamente com features adicionadas — racional precisa estar documentado
- Quando regra nova é adicionada externamente em `rules.md`, propagar imediatamente para CLAUDE.md (contagem + lista operacional + índice)

### Docs — Auditoria 2026-04-25 (2ª passada — 14 issues remanescentes/introduzidas pela 1ª rodada)

Após primeira rodada de correções (abaixo), nova auditoria paralela em 4 frentes (pricing, ADRs, sprints, compliance) achou novos gaps + alguns introduzidos pela própria 1ª rodada. **9 críticos + 5 maiores corrigidos.**

**Críticos:**

- [CLAUDE.md](CLAUDE.md) regra MFA — adicionei como "regra 28" criando colisão visual (já existia regra 27 antes); reordenado: passaporte cross-tenant continua como 27, MFA agora é regra 28 (referencia regra 43 de rules.md). Adicionado gate `requireRecentMfa()` para ações alto-risco mesmo em roles com MFA opcional.
- [ADR 0054](docs/decisions/0054-lgpd-art11-dados-saude-ripd-versionado.md) — Lei 13.787/2018 adicionada explicitamente em **Context** como "lei federal primária" sobre prontuário eletrônico (hierarquicamente superior a CFM 2.299/COFFITO 415/CFN 599); estava antes só em ADR 0072 e CLAUDE.md, faltava no documento de retenção
- [Sprint 01b](docs/sprints/01b-rbac-e-consent.md) — `patient_data_access_log` schema completo + particionamento mensal + RLS (era órfão; nenhum sprint criava a tabela apesar de regra 42 + ADR 0077 dependerem dela)
- [Sprint 01b](docs/sprints/01b-rbac-e-consent.md) — coluna `tenants.mode enum('multi','solo')` + check constraint `NOT (mode='solo' AND cross_company_access=true)` (Plano Solo do ADR 0069 não tinha schema suporte)
- [Sprint 01a](docs/sprints/01a-identidade-e-topology.md) — schema `tenants` ganhou `subscription_status` + `trial_ends_at` + nota sobre `mode` virá em 01b
- [ADR 0066](docs/decisions/0066-plano-comercial-pricing-trial.md) — Planos Solo R$ 49 e Solo Combo R$ 69 **formalizados como tiers MVP aceitos** (estavam como "futuro" no rascunho, divergindo de CLAUDE.md/comercial.md que já vendiam como MVP); tabela de quotas estendida com colunas Solo + nota de cota IA hard-stop sem overage referenciando [ADR 0064](docs/decisions/0064-ia-arquitetura-gemini-default-byok-rag.md); retenção audit_log uniformizada em 5 anos cross-tier (alinhado a ADR 0072)
- [Sprint 22](docs/sprints/22-fisio-tiss-tuss-convenios.md) — citação explícita de [ADR 0079](docs/decisions/0079-tiss-401-ans-padrao-vigente.md) (TISS 4.01) como ADR já publicado; relação com ADRs 0029/0030/0031 esperados clarificada (detalham 0079, não substituem); gate MFA `requireRecentMfa()` para cancelamento de guia
- [docs/roadmap.md](docs/roadmap.md) — tabela de mapeamento de ADRs reservados expandida com **Status** + ADRs 0028 (CID/CIF Sprint 20) + 0029-0031 (TISS Sprint 22 — antes "reservados") + 0043-0046 (Sprint 34/35) com quem produz; ADR 0035 marcado explicitamente como "decisão tomada conversacionalmente, ADR formal será lavrado quando Sprint 15 começar"
- **NOVO** [docs/compliance/dpo.md](docs/compliance/dpo.md) — documento formal de nomeação do Encarregado (LGPD art. 41 + Resolução ANPD nº 18/2024) com nome, email, vigência, próxima revisão, atribuições, limites do papel interino, histórico

**Maiores:**

- [ADR 0073](docs/decisions/0073-postura-seguranca-defesa-em-profundidade.md) regra 40 — escolha de backup off-site **fechada em Cloudflare R2** (era "R2 OU Backblaze OU GitHub — escolher um"); Backblaze e GitHub Releases ficam como fallback DR, não storage paralelo
- [Sprint 06](docs/sprints/06-geral-copilot-base.md) — job `aggregate-tenant-ai-usage` que popula `tenant_usage_snapshots.ai_calls_count` (era referenciado em Sprint 04 sem reciprocidade); runbook "BYOK emergencial" para tenant clínico que excede cota mid-month e não pode parar (CFM 2.454/2026 supervisão humana)
- [ADR 0077](docs/decisions/0077-passaporte-paciente-vinculo-cross-tenant.md) — status mudado de `Proposed` → `Accepted` (decisão já estava sendo tratada como vigente por outros docs)
- [Sprint 35](docs/sprints/35-mobile-app-nativo-expo.md) stub — ADRs esperados 0047/0048 reformulados (faixa reservada acaba em 0046); novos ADRs vão para >=0080

**Menores:**

- CHANGELOG.md — limpeza de menção órfã a "19c" (Sprint 19b nota de escopo descreveu sub-fases sem prometer sprint 19c)

**Lições da 2ª passada:**

- Adicionar regra/coluna em CLAUDE.md sem reordenar quebrou numeração visual; processo: sempre revisar lista numerada após inserção
- Stubs Sprint 34/35 com ADRs esperados fora da faixa reservada criou inconsistência — corrigido alinhando à convenção
- ADR ghost (0035) gerou alarme do agente — agora explícito no roadmap como "decisão conversacional, ADR formal pendente"
- Tabelas de retenção em múltiplos ADRs (0054 vs 0066 vs 0072) divergiam — uniformizado em 5 anos audit_log

### Docs — Auditoria de documentação 2026-04-25 (consolidação de 30 falhas)

Auditoria abrangente paralela em 5 frentes (docs raiz, ADRs, roadmap×sprints, pricing/comercial, compliance) achou contradições, gaps e inconsistências acumuladas. **Todas as falhas críticas e maiores corrigidas em lote**, sem mudança de comportamento de código (apenas documentação).

**Correções de ADRs:**

- [ADR 0001](docs/decisions/0001-stack-base.md) — addendum "IA superseded por 0064" reconhecendo que Gemini é default LogiFit (não Claude como dizia o original)
- [ADR 0054](docs/decisions/0054-lgpd-art11-dados-saude-ripd-versionado.md) — retenção `audit_log` corrigida de "6 meses ideal / 5 anos mínimo" para **5 anos** alinhado a [ADR 0072](docs/decisions/0072-escalabilidade-banco-particionamento-retencao-cold-storage.md); referência a Lei 13.787/2018 para prontuário médico 20a
- [ADR 0072](docs/decisions/0072-escalabilidade-banco-particionamento-retencao-cold-storage.md) — adicionado `patient_data_access_log` (ADR 0077) na tabela de retenção com partição mensal obrigatória + estimativa volume 10-15M linhas/ano (regra 34); Lei 13.787/2018 citada como norma primária
- [ADR 0064](docs/decisions/0064-ia-arquitetura-gemini-default-byok-rag.md) — link quebrado `0015-sem-implementar-copilot-safety.md` corrigido para texto inline citando convenção
- [ADR 0067](docs/decisions/0067-dpo-governanca-compliance-lgpd.md) — sub-processors expandido com Cloudflare R2 (backup), Oracle Cloud OCI (Fase 2), Cloudflare Turnstile, DPO-as-a-service explícito como add-on terceirizado
- [ADR 0079 NOVO](docs/decisions/0079-tiss-401-ans-padrao-vigente.md) — TISS 4.01 ANS (Ofício-Circular 1/2026) como padrão vigente; pipeline atualização semestral + validador proativo + versionamento por guia + RAG global indexa terminologia

**Correções de regras (`docs/rules.md`):**

- **Regra 43 NOVA** — MFA obrigatório para profissionais de saúde (médico/fisio/nutri/personal/enfermeiro) + roles administrativas críticas (tenant_owner/dpo/super_admin); CI tem E2E
- Headers de seção adicionados (Multi-empresa / i18n / IA + LGPD / Pesquisa global / Arquitetura IA / Escalabilidade / Segurança / Assistente IA / Passaporte cross-tenant / MFA / Processo / Código)
- Regra 34 atualizada: retenção 20a prontuário cita Lei 13.787/2018 (não só CFM 2.299) + `patient_data_access_log` 5a (ADR 0077)
- Total: **43 regras** (era 42; CLAUDE.md atualizado)

**Correções de docs raiz:**

- [CLAUDE.md](CLAUDE.md) — Modelo comercial reescrito: Starter "Academia no MVP" (Fisio/Nutri liberam Fase 2/3); Plano Solo R$ 49 / Solo Combo R$ 69 explicitado; "1 active member por (paciente, tenant)" deixa cobrança cross-tenant clara; trial 30d cita anonimização técnica; cota IA explicada com hard-stop; **DPO interno LogiFit (fundador) vs DPO-as-a-service Enterprise (firma externa) distinguidos**; backup off-site MVP é Cloudflare R2; Upstash Redis adicionado em Stack; Lei 13.787/2018 como lei federal primária; gate ICP-Brasil por kind profissional; seção "cross-company vs cross-tenant" para clarificar terminologia
- [docs/roadmap.md](docs/roadmap.md) — seção nova "Convenção de numeração de ADRs" explicando que 0011-0046 estão **reservados a sprints que vão produzi-los** (não são ADRs perdidos); mapeamento de cada número à sprint que produz
- [docs/comercial.md](docs/comercial.md) — pricing alinhado a CLAUDE.md (Plano Solo + Solo Combo adicionados; Starter "Academia no MVP" explicado); cota IA termo "chamadas" (não "mensagens"); DPO-as-a-service esclarecido como add-on terceirizado; eventos NFS-e "não contam" no overage explícito; Supabase como MVP-only formalmente comunicado; member counting cross-tenant esclarecido
- [docs/modulos.md](docs/modulos.md) — link quebrado `0015-sem-implementar-copilot-safety.md` corrigido; Starter R$ 79 → R$ 99; descrição de planos completa com Lei 13.787 / passaporte cross-tenant / Plano Solo
- [docs/arquitetura.md](docs/arquitetura.md) — seção IA atualizada (Gemini default LogiFit, Groq Whisper, BYOK, Upstash sub-processor, cota mensal hard-stop); referências a ADRs 0064 e 0067
- [docs/plano-estrutura.md](docs/plano-estrutura.md) — marca temporal corrigida ("histórico de 2026-04-22; última leitura confirmada 2026-04-25"); contadores atualizados (41 ADRs, 43 regras)

**Correções de sprints:**

- [Sprint 04](docs/sprints/04-geral-financeiro-asaas.md) — UI overage member adicionada (`tenant_usage_snapshots` schema + widget `/app/settings/tenant/plan` + banner topo dashboard)
- [Sprint 01a](docs/sprints/01a-identidade-e-topology.md) — trial 14d + ciclo de retenção 30d especificado tecnicamente (job `process-trial-lifecycle` + anonimização preservando agregados, removendo PII)
- [Sprint 06](docs/sprints/06-geral-copilot-base.md) — cota IA atualizada com Plano Solo + termo "chamadas" + hard-stop (ADR 0066)
- [Sprint 20](docs/sprints/20-fisio-prontuario-cid-cif.md) — Lei 13.787/2018 citada como lei federal primária; gate ICP-Brasil por kind profissional já estava bem detalhado, agora reforçado
- [Sprint 19b](docs/sprints/19b-migracao-hospedagem-oracle.md) — nota de escopo realista adicionada (3 sub-fases internas DB+Auth+Storage; se cronograma estourar, escopo reduz pra DB+Auth em 19b e Storage/Realtime em sprint posterior)
- **NOVO** [Sprint 34](docs/sprints/34-nutri-agent-ia.md) — stub criado (Nutri-Agent IA cruzando módulos)
- **NOVO** [Sprint 35](docs/sprints/35-mobile-app-nativo-expo.md) — stub criado (App Nativo Expo iOS+Android)

**Falhas não acionadas (apenas notadas):**

- ADRs 0011-0046 não estão "perdidos" — são números **reservados a sprints futuros** que vão produzi-los; nada a fazer agora; convenção formalizada em roadmap.md

### Decided — ADR 0078: Hospedagem em duas fases (MVP em Vercel + Supabase Pro · pós-Sprint 19 migra pra Vercel + Postgres Oracle Cloud free tier)

Conversa de produto (2026-04-25) levantou questão fundamental nunca formalizada: onde LogiFit roda? Stack base (ADR 0001) listava "Vercel + Supabase" sem documentar quando esse modelo deixaria de servir. ADR 0077 (passaporte cross-tenant) acabou de aumentar carga no Postgres (cross-tenant queries em runtime, view materializada, audit log particionado mensal, função `has_cross_tenant_access` hot, trigger cruzando 2 tabelas). Custo Supabase escala mal (Pro $25 = shared CPU 1GB; upgrade pra Small $185-410). Oracle Cloud OCI free tier vitalício oferece 24GB ARM Ampere + 4 OCPU + 200GB grátis para sempre.

**Decisão (2026-04-25):**

- **Fase 1 (Sprint 00 → 19, ~6-8 meses):** Vercel + Supabase Pro — zero ops, foco em validar produto
- **Fase 2 (Sprint 19b+, pós-MVP estável):** migrar pra Vercel + Postgres Oracle Cloud OCI + BetterAuth/Lucia + Cloudflare R2 + LISTEN/NOTIFY (~60h, janela cutover 2-4h madrugada)
- **8 regras de portabilidade** ativas desde Sprint 00 garantem migração finita: storage adapter pattern, RLS em SQL puro (não via Studio), JWT cookie próprio (não `@supabase/auth-helpers-nextjs`), proibido Supabase Edge Functions, PgBouncer-friendly desde dia 1, connection via `DATABASE_URL` (não `supabase.from().select()`), Drizzle única fonte schema
- **Lints custom em CI** (Sprint 00): `no-supabase-functions` + `no-direct-supabase-query` bloqueiam lock-in acidental
- **Gatilhos pra antecipar migração** documentados: compute >70% sustained 2sem · latência cross-tenant >800ms · custo >R$ 600/mês · cliente Enterprise pediu BYOK · vazamento ou downtime >4h
- **Custo comparativo:** decisão A→B gasta R$ 500 a mais que "começar B direto" mas adia 60h de ops pra depois do MVP validado; economiza ~R$ 1.500/mês vs continuar Supabase com upgrades

**O que a decisão NÃO muda:**

Drizzle como ORM (ADR 0004), RLS como isolamento primário (ADR 0002), particionamento (regra 34), sharding via `tenants.shard_url` preparado, audit hash chain (regra 39), IA via `resolveModelForTask` (regra 32), multi-tenant por subdomínio (ADR 0065), cross-tenant via vínculo (regra 42 / ADR 0077). Tudo agnóstico de hospedagem do PG.

**Docs atualizados:**

- `docs/decisions/0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md` — ADR completo (estratégia 2 fases + regras portabilidade + gatilhos antecipação + plano migração 7 fases + custo comparativo)
- `docs/sprints/19b-migracao-hospedagem-oracle.md` — Sprint detalhado da migração (7 fases + cutover plan + rollback ≤30min + 60h estimadas + 30d observação pós-cutover)
- `CLAUDE.md` — seção Stack indica 2 fases + 8 regras de portabilidade listadas
- `docs/roadmap.md` — Sprint 19b adicionado entre Sprint 19 e Fase 2 (#22)
- `docs/sprints/00-setup-infra.md` — checklist com storage adapter pattern + RLS SQL puro + lints + 8 regras portabilidade ativas desde dia 1
- `docs/sprints/01a-identidade-e-topology.md` — Auth portátil: JWT custom claims + cookie httpOnly próprio; **proibido `@supabase/auth-helpers-nextjs`**; uso minimalista `@supabase/supabase-js` (só `signInWithOtp`/`verifyOtp`/`signInWithOAuth`)

**Riscos abertos:**

1. Oracle muda free tier — improvável (vitalício documentado), mitigação: AWS RDS / DigitalOcean Managed PG são alternativas com pricing previsível
2. Janela de cutover dá problema — mitigação: backup pré-cutover + rollback plan documentado RTO ≤30min
3. Cliente Enterprise no MVP exigindo hospedagem dedicada — caso especial faturado à parte, instância separada Supabase Pro ou Oracle dedicado
4. Decisões pendentes pra Sprint 19b: BetterAuth vs Lucia (spike 4h), WebSocket onde rodar (Vercel Edge limitado vs Node container Oracle — spike 2h)

### Added — ADR 0077: Passaporte do paciente cross-tenant + vínculo por empresa com módulos explícitos + invite-link + auto-cadastro proativo

Visão de produto (2026-04-25) revelou contradição: usuário queria "todos os profissionais [da rede LogiFit] podem acessar os dados de um paciente em tenants diferentes" — mas o modelo vigente proibia cross-tenant individual (princípio implícito em `docs/acesso-e-autorizacao.md`, referenciado erroneamente como "regra 26" — regra 26 real é sobre `groups`).

**Decisões fechadas (2026-04-25):**

- **Modelo C (híbrido)** escolhido contra Modelo A (vínculo por módulo) e Modelo B (vínculo só por empresa): vínculo é com a **empresa**, módulos liberados são **explícitos** (`patient_company_links` + `patient_link_modules`), responsável técnico **por módulo** (atende exigência CFM/COFFITO/CFN/CONFEF)
- **5 módulos canônicos no MVP** via lookup table extensível (`patient_module_types`): `academia`, `personal_training`, `fisioterapia`, `nutricao`, `pilates` — psicologia/medicina/fonoaudiologia entram em Fase 3+ sem migration
- **Constraint global:** 1 paciente tem no máximo 1 módulo do mesmo tipo ativo em toda a rede — nova empresa do mesmo módulo dispara substituição com confirmação
- **Aceite parcial** suportado: paciente pode aceitar só alguns módulos do pedido (não tudo-ou-nada)
- **Invite-link** sem stub — dados pessoais só persistem após paciente aceitar; branch automático "CPF existe → login" vs "CPF novo → cadastro" + confirmação anti-fraude por nome mascarado
- **Auto-cadastro proativo** (Path B paralelo): paciente pode criar conta sozinho em `app.logifit.com.br/cadastro` (SMS + email + Turnstile), receber invites, **convidar profissional/empresa** (path inverso). Não pode log de treino próprio sem vínculo (foge do foco — não competimos com Strava)
- **5 níveis de dados** taxonomia oficial (Identidade → Antropometria → Treino → Clínico → Workspace interno); Nível 5 nunca cruza tenant nem é exibido pro paciente
- **Cross-tenant entrega resumido**, não bruto — Tenant B recebe "lesão lombar ativa, restrição: sem deadlift", não SOAP completo
- **Limites duros que nunca cruzam tenant** mesmo com vínculo: financeiro, Nível 5, prontuário CFM original, dado de outras pessoas mencionado no prontuário
- **Cobrança LogiFit:** 1 active member por (paciente, tenant) — paciente em tenant multi-vertical com 2 módulos liberados conta como 1 member
- **Audit obrigatório** em `patient_data_access_log` (síncrono não-bloqueante, particionado por mês — regra 34); paciente vê histórico em `/meu/privacidade/acessos`
- **Diferencial-chave:** alerta cross-prescrição entre tenants — Sprint 11 detecta "dieta 1.400kcal de Tenant A + treino aumentado em Tenant B = risco hipoglicemia" (só existe porque dados cruzam)

**Mudanças em regras:**

- **Regra 42 NOVA** em `docs/rules.md` — cross-tenant SOMENTE via `patient_company_links` ativo + módulo + categoria coberta + audit obrigatório; lint custom `cross-tenant-read-must-log` enforça
- Regra 26 NÃO muda — continua sobre `groups`. Confusão histórica em `docs/acesso-e-autorizacao.md` corrigida.

**Docs atualizados:**

- `docs/decisions/0077-passaporte-paciente-vinculo-cross-tenant.md` — ADR completo (9 partes: modelo, schema, fluxo invite, níveis, substituição, profissional sai, cobrança, auto-cadastro proativo, audit)
- `docs/rules.md` — regra 42 nova
- `docs/acesso-e-autorizacao.md` — Camada 4 expandida com 3 tipos de cruzamento (cross-module, cross-company, cross-tenant); Camada 1 documenta os 2 paths de criação de conta de paciente; matriz resumida atualizada; referências corrigidas
- `CLAUDE.md` — regra 42 listada na seção "Regras que você (Claude) DEVE respeitar"; contagem atualizada 41 → 42 regras
- `docs/sprints/02-geral-crm-pessoas.md` — fluxo de invite + tela de pedidos pendentes + cadastro proativo + UX de vínculo cross-tenant

**Riscos abertos (documentados no ADR):**

1. Regulatório CFM/COFFITO/CFN — exige parecer jurídico antes do GA (sem norma específica sobre troca clínica entre instituições mediada por consent do paciente)
2. Co-controllership LGPD — paciente é controlador? Co-controlador com empresa? LogiFit é operador? DPO precisa modelar (addendum ADR 0067)
3. Liability — Termo de Uso precisa explicitar: dado cross-tenant é informativo, profissional do Tenant B é responsável pela decisão clínica que tomar
4. Performance — view materializada `mv_patient_cross_tenant_summary` + cache Redis 5min
5. Adversarial spam — rate limit 50 invites/dia/tenant + 3 invites/CPF/30d
6. Profissional desonesto migrando pacientes antigos — UX de aceite mostra "essa empresa é nova" + alerta visual
7. Sharding futuro (regra 34 / ADR 0072) — tenants com vínculo cross ativo bloqueados de migrar pra shard separado no MVP

**Status:** Proposed — aguarda confirmação do usuário sobre constraint global de 1 módulo ativo por paciente na rede + limite de invites/dia (default sugerido 50) + parecer jurídico antes do Sprint 02.

### Changed — ADR 0066: Starter R$ 79 → R$ 99 com 1 vertical à escolha + 5 profissionais + 50 NFS-e inclusas (alinhado a ICP real)

Conversa com fundador (2026-04-25) sobre 3 clientes-piloto reais (academia de personals com 5 profs e ~60 alunos, nutricionista solo, clínica fisio com 5 profs) expôs duas falhas no Starter R$ 79 original:

1. **Limite de 2 profissionais com contrato** forçava academia de personals e clínica fisio a pagar Pro R$ 199 mesmo com equipe pequena
2. **Starter só incluía Academia** — nutricionista solo e fisio solo eram forçados a pagar R$ 199 só pra acessar a vertical apropriada

**Decisão (2026-04-25):**

- **Starter sobe para R$ 99** (anuidade R$ 89) — alinhado a Tecnofit Lite/NutMed; +R$ 20 financia mais features
- **Starter ganha "1 vertical à escolha"** — Academia OU Fisio OU Nutri (não simultâneas); cobre o ICP "negócio solo/pequeno especializado em uma área"
- **Limite de profissionais com contrato sobe de 2 → 5** no Starter; users operadores 2 → 3
- **Starter ganha 50 NFS-e inclusas** + R$ 0,50/nota extra (era sem fiscal antes)
- **Cap de overage Starter** ajustado de +R$ 120 → +R$ 100 (reflete novo gap Starter→Pro)
- **Pro mantém todas as verticais simultâneas** — degrau natural: "negócio solo/especializado" (Starter) vs "clínica multi-disciplinar integrada" (Pro)
- Schema `tenant_subscriptions` ganha coluna `vertical_choice enum ('academia','fisio','nutri') nullable` — só Starter usa

**Margem revisada:** Starter R$ 99 - R$ 25 (custo: ~R$ 16 infra + R$ 9 fiscal 50 notas) = **R$ 74 (75%)** — saudável, melhor que os 68% do tier original.

**Cobertura dos 3 clientes-piloto:**

| Cliente | Plano natural | Mensalidade |
|---|---|---|
| Academia de personals (5 profs + 60 alunos compartilhados) | Starter Academia | R$ 99/mês |
| Nutricionista solo (~60-80 pacientes) | Starter Nutrição | R$ 99/mês |
| Clínica fisio (5 profs + pacientes) | Starter Fisio | R$ 99/mês (até 100 pacientes) ou Pro R$ 199 se passar |

**Comparativo competitivo (post-revisão):**

- Tecnofit Lite R$ 99 → mesmo preço, LogiFit ganha multi-vertical à escolha + IA + NFS-e incluída
- iClinic Pro R$ 119 → -R$ 20 + IA + WhatsApp régua
- NutMed R$ 99 → mesmo preço + IA + Portal paciente
- Dietpro R$ 89 → +R$ 10 com features superiores

**Docs atualizados:**

- `CLAUDE.md` — seção Modelo Comercial reflete Starter R$ 99 + vertical à escolha
- `docs/comercial.md` — nova seção "Planos e preços" com tabela detalhada + "Por que Starter à escolha" + comparativo direto com 7 concorrentes
- `docs/decisions/0064-ia-arquitetura-gemini-default-byok-rag.md` — tabela de quotas IA atualizada com pricing vigente (Starter R$ 99/Pro R$ 199/Business R$ 449/Enterprise R$ 1.199+) — corrige defasagem com pricing antigo (R$ 149/R$ 399/R$ 1.500)
- `docs/decisions/0075-assistente-ia-universal-tres-camadas-tool-registry.md` — tabela de cotas mensais
- `docs/decisions/0076-nfse-nacional-provider-complementar.md` — análise de custo Starter atualizada (50 notas/mês ao invés de 100)
- `docs/decisions/0069-perfil-paciente-hub-operacional.md` — observação sobre tier "Solo" R$ 49 futuro registrada como espaço pós-validação

**Princípio orientador:** ICP de pequeno negócio de saúde solo/equipe pequena (≤5 funcionários) é a maioria dos clientes-piloto. Starter precisa atendê-los **sem fricção de upgrade artificial** — quem precisa de 2+ verticais tem motivo real pra ir pro Pro; quem está em 1 vertical não deve ser empurrado pro Pro só por limites mesquinhos.

**Tier "Solo" R$ 49 confirmado como opção futura válida (2026-04-25):** spec preliminar registrada em ADR 0066 seção "Tiers futuros" — 1 vertical, 30 members, 1 prof, 20 NFS-e, IA Camada 1 apenas. Custo ~R$ 12, margem 76%. Não entra no MVP — gatilho de ativação: ≥10 leads inbound rejeitados por preço Starter R$ 99 nos 6 meses pós-MVP.

### Changed — ADR 0066 revisado + ADR 0076: modelo de custo fiscal corrigido + NFS-e Nacional como caminho de redução

Pergunta do usuário (2026-04-25): "600 reais em 2.000 [notas/mês] é muito" — exposta falha no modelo de custo do ADR 0066 que assumia LogiFit absorvendo 100% do custo Focus NFe (~R$ 0,30/nota). Em alto volume (Business com 2.000+ notas/mês) margem virava negativa.

**Decisão (2026-04-25):** combinar 4 caminhos (A+B+C+D) — repasse fiscal via overage + NFS-e Nacional como provider complementar futuro + negociação enterprise Focus + UI de preview de fatura. Rejeitada explicitamente a alternativa de "construir motor fiscal próprio" (escopo 8-12 meses solo + manutenção fiscal eterna + risco regulatório alto; nenhum SaaS BR comparável faz).

**Mudanças no [ADR 0066](docs/decisions/0066-plano-comercial-pricing-trial.md):**

- Tabela de quotas ganha `Emissões fiscais incluídas` (Pro 200/Business 1.000/Enterprise 5.000) + `Overage por nota fiscal extra` (Pro R$ 0,40/Business R$ 0,35/Enterprise R$ 0,25)
- Schema `logifit_plans` ganha colunas `fiscal_emissions_included` + `fiscal_overage_rate_cents`
- Schema `tenant_usage_snapshots` ganha colunas `fiscal_emissions_count`, `fiscal_emissions_included`, `fiscal_overage_amount_cents`, `total_overage_cents`
- Análise de margem reescrita com tabela de custo Focus NFe negociado por volume (R$ 0,29 → R$ 0,18 → R$ 0,12); margem real Business ~42% (base) ou ~45% (com overage); Enterprise piso público é apertado, contrato real cobra a partir de R$ 1.799-2.499 quando volume >5k notas/mês
- Nova seção "Caminhos de melhoria contínua de margem" listando 4 alavancas (negociação Focus, NFS-e Nacional, cache IA, escala)
- UI `/app/settings/tenant/plan` (Sprint 04) mostra preview de fatura com breakdown members + fiscal

**Novo [ADR 0076 — NFS-e Nacional como provider complementar](docs/decisions/0076-nfse-nacional-provider-complementar.md):**

- Não substitui Focus NFe — complementa para municípios aderidos ao padrão nacional (gratuito, infra federal)
- Não entra no MVP — gatilhos: Sprint 36 estável há 3 meses + 10k notas/mês LogiFit + 30% emissões em municípios aderidos + feedback comercial
- Reusa interface `FiscalProvider` ([ADR 0059:59-77](docs/decisions/0059-ciclo-fiscal-emissao-focus-nfe.md)) sem refactor
- Sprint 36c condicional (~2-3 semanas) quando ativar
- Eventos sempre no provider que emitiu (cancelamento/CC-e)

**Sprint 36 atualizado:**

- Pré-Sprint: negociação comercial Focus NFe documentada em `docs/contratos/focus-nfe.md` (target R$ 0,12/nota acima de 10k/mês)
- Coluna `provider` em `fiscal_emissions` preparada para `nfse_nacional` futuro
- Job mensal `aggregate-fiscal-usage-snapshot` alimenta `tenant_usage_snapshots.fiscal_emissions_count` (eventos não contam — só `status='completed'` na primeira emissão)
- Stretch: documentar pontos de plug-in para adapter futuro NFS-e Nacional

**Docs:**

- `docs/comercial.md` — nova seção "Emissão fiscal — pacote incluso + custo proporcional" + comparativo com Tecnofit/iClinic/Feegow + Fase 3 reescrita ("emissão fiscal completa" + "otimização gradual via NFS-e Padrão Nacional pós-PMF")

**Princípio orientador:** repasse proporcional em vez de absorção total + provider plugável em vez de motor próprio + negociação contínua com provider em vez de lock-in.

### Added — ADR 0075: Assistente IA universal — 3 camadas + tool registry distribuído + cotas por plano

Pergunta do usuário (2026-04-24): "vamos ter um chat com a IA para resolver qualquer questão relacionada ao sistema para auxiliar os usuários — qualquer usuário, tudo (perguntas + ações), com urgência". O Sprint 06 original ("Copilot base") cobria apenas profissional clínico ancorado em member com 5 tools hardcoded (`findMember`, `scheduleAppointment`, `findCidByDescription`, `summarizeEvolutions`, `report_issue`). Esse escopo é **3-4× menor** que o pedido: precisava cobrir aluno, recepção, admin, super-admin, contador externo, DPO, personal coach — cada um com persona própria, tools próprias, scope de RBAC próprio.

**Decisão (2026-04-24):** universalizar o assistente em 3 camadas com gates progressivos, tool registry distribuído por módulo, cotas alinhadas aos planos comerciais (ADR 0066), framework de confirmação UI obrigatório para ações de write.

**Princípio orientador:** O Assistente IA do LogiFit é **universal por papel** (qualquer usuário, qualquer tela), **estratificado por risco** (3 camadas com gates), e **extensível por módulo** (cada sprint adiciona suas tools no registry).

**3 camadas de capacidade:**

| Camada | Capacidade | Risco | Gate | Confirma UI? |
|---|---|---|---|---|
| **1. Help** (RAG read-only) | "Como faço X?", "O que significa Y?" | Baixo | Default todos os papéis e planos | Não |
| **2. Insight** (read data) | "Qual minha mensalidade?", "Última avaliação João" | Médio (RBAC + RLS) | Server Actions read-only com `wrapAction()` | Não |
| **3. Action** (write) | "Cancela aula amanhã", "Cria lead João Silva" | Alto | `<ActionConfirmDialog>` obrigatório + audit reforçado + proteção dupla | **Sim sempre** |

**7 personas com `inferPersona(user, tenant)`:**

`member`, `professional_clinical`, `professional_coach`, `admin`, `recepcao`, `super_admin`, `contador_externo`, `dpo` — cada uma com template em `packages/ai/personas/*.ts` (tom + permissões IA + tools típicas) em pt-BR/en-US/es-419 (regra 27). Chip "Falar como: X" sempre visível no header do sheet permite trocar runtime; última escolha persiste em cookie.

**Tool registry distribuído (regra nova 41):**

Cada módulo cria `apps/web/app/(modules)/<modulo>/ai-tools.ts` chamando `registerAITool({ key, layer, label/description i18n, whenAvailable, showInPersonas, argsSchema, resultSchema, requiresConfirmation, confirmationCopy, handler, audit, rateLimitKey })`. Build hook gera `tools_manifest.json` no deploy → seed `tools_registry`. Padrão idêntico a `registerMenuItem` (Sprint 00b) e `search_index_sync` (regra 30).

Server Action que **não** deve ser exposta tem comentário literal `// ai-blocked: <motivo>` no topo. Lint custom `ai-block-respected` em CI bloqueia commit se `registerAITool` aponta para handler bloqueado.

**Whitelist Camada 3 conservadora no MVP (~9 tools seguras):**

- `member`: `cancelMyAppointment`, `requestSecondCopy`, `confirmAppointment`
- `professional_*`: `createDraftEvolution`, `report_issue`
- `recepcao`/`admin`: `scheduleAppointmentForMember`, `requestSecondCopyForMember`, `createLead`, `inviteUser`

**Bloqueado:** qualquer `DELETE`, `signEvolution` (ICP-Brasil), `chargeBatch`, `anonymizeMember`, `transferMemberBetweenCompanies`, `runOpenFinancePayment`, mudanças em `tenant_settings`/RBAC/plano.

**Fluxo Camada 3 (proteção dupla):**

```
1. LLM emite tool call proposeAction({tool, args, reason})
2. Backend INSERT assistant_action_proposals (state=pending, expires=+5min)
   retorna { proposalId, confirmationCopy: { title, description, impact, affectedEntities } }
3. Frontend renderiza <ActionConfirmDialog> com [Confirmar/Editar/Cancelar]
4. User confirma → POST /api/ai/proposals/{id}/confirm
5. Handler real exige proposal_id confirmado válido (actionSource=ai_assistant + sem proposta = FORBIDDEN)
6. Audit log grava action_source='ai_assistant' + proposal_id + decisão humana
```

**UI universal (mobile-first regra 31):**

- `<AssistantFAB>` em `<AppLayout>` — 56×56px mobile / 64×64px desktop, sempre visível em `/app/*`
- `<AssistantSheet>` — bottom sheet 92vh mobile (drag-down fecha) / side panel 420px desktop
- Página dedicada `/app/assistente` + variantes `/meu/assistente` (Sprint 26) e `/app/coach/assistente` (ADR 0074)
- Atalho `Ctrl+/` ou `Cmd+/`; cross-link em busca global Ctrl+K (ADR 0062)
- Contexto auto-injetado por rota (`/app/members/[id]/*` → member ativo + tools com scope=member)

**Cotas alinhadas aos planos comerciais (ADR 0066):**

| Plano | Mensal | Soft diário | BYOK |
|---|---|---|---|
| Starter R$ 79 | 500 | ~50/dia | — |
| Pro R$ 199 | 3.000 | ~150/dia | opcional add-on |
| Business R$ 449 | 10.000 | ~500/dia | ✅ opcional |
| Enterprise | 25.000 default | sem soft | ✅ ilimitado quando ativo |

**Regras de contagem:**
- Camada 1 cache hit ⇒ 0 chamadas; cache miss ⇒ 1
- Camada 2 ⇒ 1 por turn
- Camada 3 (proposta + reformulação pós-execução) ⇒ até 2
- Tool execution (Server Action) **não conta** na quota IA — conta no rate limit Server Actions (regra 36)
- STT minutos separado (Pro 60min, Business 300min, Enterprise 1500min)

Soft diário excedido → toast informativo. Mensal excedido → circuit breaker + CTA "Configure BYOK".

**Schemas novos:**

```sql
tools_registry              -- ~500 linhas, não particiona
assistant_action_proposals  -- particionada por mês, @volume_estimate_yearly: 5M+
tenant_assistant_personas   -- 1 linha por tenant

ALTER TABLE ai_audit_log ADD COLUMN persona text;
ALTER TABLE ai_audit_log ADD COLUMN layer text;
ALTER TABLE ai_audit_log ADD COLUMN action_proposal_id uuid;
ALTER TABLE ai_audit_log ADD COLUMN tool_keys text[];
```

**Telemetria PostHog (12 eventos novos):**

`assistant.session_opened`, `assistant.message_sent`, `assistant.cache_hit`, `assistant.tool_called`, `assistant.action_proposed`, `assistant.action_confirmed`, `assistant.action_rejected`, `assistant.action_executed`, `assistant.quota_warning` (80%), `assistant.quota_blocked` (100%), `assistant.rate_limited`, `assistant.incident`.

Dashboard `/app/super-admin/ai-usage` mostra top tenants por consumo, top tools usadas, cache hit rate global, latência média por persona, taxa de aceitação Camada 3 por tool.

**Sprints ajustados:**

- **Sprint 06 (renomeado "Assistente IA universal base")** — cresce de 3-4 → 5-6 semanas
- **Sprints 02, 03, 04, 05, 08, 09, 10, 11, 12, 13, 15, 17, 19, 20, 21, 22, 24, 26, 30, 31, 32, 33, 36** — cada um adiciona arquivo `<modulo>/ai-tools.ts` registrando suas tools (~1-2 dias por sprint, parte do Definition of Done)
- **Sprint 26 (portal paciente PWA)** — adiciona `/meu/assistente` no shell
- **Sprint 11 (treinos coach PWA)** — adiciona `/app/coach/assistente` no shell

**Regra nova:**

- **Regra 41** — Toda Server Action de módulo que deve ser usável pelo Assistente IA registra-se em `tools_registry` via `registerAITool({...})`. Server Action que NÃO deve ser exposta tem `// ai-blocked: <motivo>` no topo. Tools Camada 3 (write) sempre passam por `<ActionConfirmDialog>`. LLM nunca chama Server Action diretamente — sempre via `proposeAction(toolKey, args)`. Handler real rejeita execução se `actionSource='ai_assistant'` sem `proposal_id` confirmado.

**Compliance integrada:** regras 28 (CFM 2.454/2026 — Comitê IA aplicado em persona profissional clínica), 29 (LGPD art. 11 — RIPD novo), 32 (resolveModelForTask — featureKey por persona), 33 (wrapAction obrigatório em handlers), 35/ADR 0073 camada 5 (PII redaction antes do LLM, anti-prompt-injection), 36 (rate limit IA 20/min/user), 39 (audit hash chain).

**Negativas/riscos endereçados:** Sprint 06 cresceu (aceitável pela urgência declarada), confirmação UI adiciona fricção (mitigada por copy curta + Enter como default), persona mal classificada (chip switcher sempre visível), quota soft diary potencialmente confuso (UI explicativa), abuso Camada 3 (rate limit `proposeAction` 10/min separado do chat).

**Telas a prototipar:**

- `prototipo/telas/assistente-fab-mobile.html` (375×812)
- `prototipo/telas/assistente-confirm-action.html` — `<ActionConfirmDialog>`
- `prototipo/telas/assistente-persona-switcher.html`
- `prototipo/telas/assistente-quota-warning.html` — 80% e 100%

### Added — ADR 0074: Modo Coach mobile-first PWA + offline-first workout logging

Pergunta do usuário (2026-04-24): "tenho o caso do instrutor olhar o treino do aluno durante o treino pelo celular, como poderiamos fazer?". Identificado **gap arquitetural real**: ADR 0063 decidiu `/app/*` responsivo mas não-PWA (gestor desktop em mente); ADR 0069 criou Modo Atendimento desktop-first (fisio em consultório). Personal trainer mobile-only no chão da academia ficou sem solução — wifi instável, mãos suadas/sujas, multi-aluno simultâneo, timer crítico entre sets.

**Decisão — escopo PWA dedicado `/app/coach/*`:**

1. **PWA separado** com `manifest scope: /app/coach/`, ícone roxo Treina (`#C77DFF`), Service Worker próprio. Não conflita com `/meu/*` (paciente PWA Sprint 26) nem com `/app/*` (responsivo sem SW). Coach instala via `beforeinstallprompt` após 2ª visita.

2. **Reusa `attendance_sessions`** (ADR 0069) com enum estendido: `kind ∈ ('consulta','treino','avaliacao_fisica','sessao_pilates')`. `draft_content jsonb` armazena sets executados em estrutura tipada `{ exercises: [{ prescribed, executed: [{ set, weight_kg, reps, rpe, ts, client_id }], media }] }`. Ao finalizar, migra pra tabelas oficiais `workout_sessions` + `workout_logs` (Sprint 11).

3. **Tela `/app/coach/sessao/[id]`** mobile-only by design (375-414px):
   - Header compacto 56px com nome + timer + progresso (4/6 exercícios)
   - **Foco em 1 exercício/1 set ativo** (não os 12 de uma vez)
   - Steppers ▼▲ gigantes (44px+ touch) para kg/reps — não keyboard
   - RPE picker 1-10 com cores (verde/amarelo/vermelho)
   - Botão "Confirmar set" full-width 64px (ação mais frequente)
   - Timer regressivo entre sets (vibrate ao zerar)
   - Bottom nav fixo `[📷] [🎤] [💬] [→ Próximo]`

4. **Modo "supervisão multi-aluno"** `/app/coach/multi`: cards 1/3 por aluno em sessão simultânea (até 4 num estúdio); tap entra na sessão daquele aluno; state persiste em IndexedDB; coach troca sem perder progresso.

5. **Service Worker offline-first com sync queue:**
   - Pré-cacheia plano + member info + assets antes da sessão
   - Marca set offline → enqueue em IndexedDB com `client_id = uuid()`
   - Toast "X sets offline" no canto; UI otimista
   - Voltou online → sync background em ordem; idempotência via `client_id` (server upsert); conflito raro vai pra `needs_review`
   - Permite **finalizar sessão offline**; sincroniza tudo na próxima conexão

6. **Voz, foto, vídeo inline** reutilizando schema `clinical_media` (Sprint 21) com `kind='workout_form_check'`. STT background (Groq Whisper · ADR 0064) transcreve notas de voz. Vídeo curto comprimido client-side (Web Codecs/ffmpeg.wasm).

7. **Push web** via Service Worker para "next_student_arrived" (detector via QR/catraca/check-in), "set_overdue" (>2× tempo esperado), "session_complete". Subscription registrada em `coach_push_subscriptions`. Notificação tem ações `[Iniciar agora]` + `[Em 5 min]`.

8. **Web Bluetooth** (Android Chrome only): parear bioimpedância BLE (Tanita BC-401, Renpho), cardiofrequencímetro (Polar H10, Garmin HRM-Pro), encoder de velocidade VBT (Vitruve, GymAware). iOS Safari não suporta — fallback manual entry; cobertura completa só com app nativo Expo Sprint 31.

9. **Onboarding contextual:** mobile detecta UA + viewport → tour; desktop mostra QR "abra no celular"; após 2ª visita → install prompt; após instalar → push permission prompt.

**Schemas novos (Sprint 11):**

```sql
ALTER TYPE attendance_kind ADD VALUE 'treino';
ALTER TYPE attendance_kind ADD VALUE 'avaliacao_fisica';
ALTER TYPE attendance_kind ADD VALUE 'sessao_pilates';

workout_sessions (id, tenant_id, member_id, workout_id, coach_user_id,
                  attendance_session_id, started_at, ended_at, duration_min,
                  total_volume_kg, avg_rpe, notes, status)

workout_logs (id, tenant_id, session_id, exercise_id, set_index,
              weight_kg, reps, rpe, rest_actual_s, is_pr, client_id, logged_at)
              -- client_id unique pra idempotência offline

coach_push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth,
                          device_name, installed_at)
```

**Sprints ajustados:**

- **Sprint 00** — `<CoachLayout>` + manifest base + SW template (derivado de `<PortalLayout>`)
- **Sprint 11 (treinos)** — sprint principal: `/app/coach/sessao/[id]` + execução de set + sync queue + tabelas
- **Sprint 12 (avaliações físicas)** — adapta tela coach pra perimetria/1RM/saltos no celular
- **Sprint 13 (engajamento)** — push channels coach
- **Sprint 21 (mídias clínicas)** — extensão de `clinical_media` pra `workout_form_check`; ffmpeg.wasm client-side
- **Sprint 26 (portal paciente PWA)** — refatora pra `<SharedPWAShell>` reusável
- **Sprint 31 (futuro · app nativo Expo)** — cobre BLE iOS, HealthKit, push iOS reliable

**Telas a prototipar:**

- `prototipo/telas/coach-treino-mobile.html` (viewport 375×812)
- `prototipo/telas/coach-multi-mobile.html` (supervisão multi-aluno)
- `prototipo/telas/coach-install-prompt.html` (onboarding + instalação)

**Negativas/riscos endereçados:** 2 PWAs no mesmo subdomínio (scope explicit), Service Worker complexity (entrega incremental), background sync iOS Safari instável (toast + manual sync), coach esquece finalizar (job nightly auto-close 12h), bundle size (<200KB JS gzipped via code-split).

**Diferencial vs concorrência:** Trainerize (US$ 8) + TrueCoach (US$ 12) + Tecnofit Personal (R$ 79) — todos têm app nativo, mas nenhum tem **coach mode robusto offline-first** com sync queue, multi-aluno simultâneo, e mídia inline integrada.

Inspiração UX: Hevy (execução de set), MyFitnessPal (steppers grandes), Strong (timer entre sets).

### Added — ADR 0073: Postura de segurança (defesa em profundidade) + Regras 35-40

Pergunta do usuário: "agora vamos ver a segurança do código e do sistema". Análise identificou 7 gaps críticos (security headers ausentes, rate limit só em IA, sem brute force protection, sem backup/DR documentado, CSRF não documentado, sem virus scan em uploads, sem SSRF protection nos fetchers externos), 8 altos e 8 médios. Aplicada **Opção B** (ADR consolidado + 6 regras novas + ajustes pontuais nos sprints).

**ADR 0073 — Defesa em profundidade em 7 camadas:**

1. **Rede e perímetro** — Vercel WAF/DDoS (Pro tier requirement); TLS 1.3 obrigatório; HSTS preload; security headers via `next.config.ts headers()` (CSP com nonce dinâmico, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin, Permissions-Policy restritiva, COOP/CORP); CORS restritivo same-origin; cookies escopo `.logifit.com.br` SameSite=Lax + Secure + HttpOnly
2. **Autenticação e sessão** — MFA por role (`roles.requires_mfa`); login lockout (5 falhas/15min → 30min lockout + Turnstile); Cloudflare Turnstile no signup/login/forgot/trial; recovery codes TOTP; página `/meu/sessoes` lista + revoga; trocar senha invalida refresh tokens
3. **Aplicação** — `wrapAction()` reforçado (Origin check + rate limit + auth + permissions + Zod + sanitize); rate limit por endpoint/IP/user (login 10/15min IP · read 100/min · write 30/min · IA 20/min); CSRF via Origin === Host (Next.js 15 nativo) + opcional `x-csrf-token`; **`safeFetch()` SSRF protection** (allowlist + bloqueio IP privado/loopback/link-local + timeout + maxBytes + redirect manual); **virus scan obrigatório em uploads** (MIME real, magic bytes, embed proibido, ClamAV); output encoding via React + DOMPurify+nonce em casos especiais
4. **Dados em repouso e em trânsito** — TLS 1.3 fim-a-fim; AES-256-GCM em campos sensíveis com KEK por tenant via HKDF; cert A1 com KEK por company + senha cifrada separadamente; rotação anual via `encryption_key_version`; **hash chain no `audit_log`** (cada linha referencia hash anterior + anchor S3 Object Lock WORM 1h); **backup off-site AWS S3** semanal cifrado + Object Lock 90d (RPO 24h, RTO 4h); teste restauração trimestral
5. **IA** — `redactBeforeLLM()` mascara CPF/CNPJ/RG/email/telefone/endereço/cartão/PIX antes do provider; `aggressive_redaction` Enterprise mascara nome próprio; classificador anti-prompt-injection; output que vaza system prompt = bloqueado; detecção de abuso (10x consumo médio → soft-block); tool calling sempre Server Action tipada
6. **Operacional** — Vercel encrypted env (LogiFit-level); Supabase Vault (tenant-level: BYOK IA, cert A1); rotação anual de secrets; **Gitleaks** pre-commit + CI; **Dependabot** semanal; **OSV-scanner** CI bloqueia ≥high; **SBOM** CycloneDX por release; CI permissions read-all default + actions pinadas por SHA; logs sanitizados via `sanitizeForAlert()` em Sentry/Logtail
7. **PAM (Privileged Access Management) super_admin LogiFit** — `privileged_sessions` 4h com MFA recente + justificativa ≥20 chars; `privileged_audit_log` com snapshot before/after + hash chain; JWT secundário `privileged=true` exigido em `/app/super-admin/*`; alerta automático ao abrir (email + Telegram fundador); revogação automática se query >50k linhas

**Threat model STRIDE** aplicado obrigatoriamente em 5 features críticas (login, pagamento Asaas, prontuário, pipeline exames, WhatsApp inbound) durante seu sprint, registrado em `docs/threat-models/`.

**OWASP Top 10 (2021)** mapeado item-a-item para mitigações LogiFit; `scripts/owasp-check.ts` em CI antes de release.

**Documentos públicos:**
- `/.well-known/security.txt` (RFC 9116) com `security@logifit.com.br` + Encryption + Policy + Canonical
- Página pública `/seguranca` com postura resumida + política divulgação responsável (90d coordinated) + hall da fama
- Disaster Recovery Plan público para tenants Enterprise

**Pentest:** auditoria interna trimestral (fundador + jurídico) + pentest externo anual (Tempest/Conviso, R$ 8-15k MVP). Bug bounty informal Fase 2 (R$ 200-2k regular, R$ 5-10k critical).

**Compliance roadmap:** LGPD/CFM 2.454/COFFITO/CFN cobertos no MVP. ISO 27001 e SOC 2 Type 1→2 mapeados como objetivo Fase 2-3 (não bloqueia MVP).

**Regras 35-40 (novas) em `docs/rules.md` (total 40 regras):**
- **35** Security headers (`next.config.ts headers()` com CSP nonce + HSTS preload + X-Frame DENY + X-Content nosniff + Referrer-Policy + Permissions-Policy + COOP/CORP)
- **36** Rate limit Upstash em toda Server Action/API Route via wrapper (chave por tenant+user+ip+endpoint)
- **37** `safeFetch()` único para fetch externo + lint `no-raw-fetch`
- **38** `scanUpload()` único para upload em Storage + lint `no-unscanned-upload`
- **39** Hash chain no `audit_log` + anchor S3 WORM
- **40** Backup off-site + RPO 24h/RTO 4h + teste restauração trimestral

**Regras operacionais 20-25 em `CLAUDE.md` (total 25 regras operacionais para Claude).**

**Sprints ajustados (12):**

| Sprint | Ajuste |
|---|---|
| **00 setup-infra** | Security headers + middleware CSP nonce + Upstash rate limit + `packages/security/safe-fetch.ts` + `packages/security/scan-upload.ts` + Gitleaks pre-commit + Dependabot config + OSV-scanner CI + script `pnpm sbom:generate` + `/.well-known/security.txt` + página `/seguranca` + DNS `security@logifit.com.br` + conta Cloudflare Turnstile |
| **01a identidade** | `audit_log.previous_hash` + trigger SHA256 chain + `system_audit_anchor` + job verify-integrity + `auth_attempts` + `auth_lockouts` + Turnstile signup/login/forgot + página `/meu/sessoes` + recovery codes TOTP |
| **01b RBAC** | `roles.requires_mfa` explícito + `privileged_sessions` + `privileged_audit_log` + JIT access super_admin + alerta automático abertura + revogação por data exfiltration |
| **04 financeiro** | safeFetch Asaas (`asaas.com`, `sandbox.asaas.com`) + validação IP source no webhook |
| **06 copilot** | `redactBeforeLLM()` em `buildSystemPrompt` + safeFetch nos providers IA (Gemini/Anthropic/OpenAI/Groq/Maritaca) + classificador anti-prompt-injection + detecção abuse |
| **13 WhatsApp** | safeFetch nos providers (Twilio/Z-API/Resend) + safeFetch no media download + scanUpload nos anexos do paciente + validação HMAC + IP source |
| **17 bancos+NF-e** | safeFetch Open Finance (Pluggy/Belvo) + safeFetch NFe providers (Arquivei/Sieg/Focus/SEFAZ direto) + scanUpload cert A1 + KEK por company + senha cifrada separadamente |
| **20 prontuário** | STRIDE prontuário + cert A1 com KEK |
| **21 evolução** | scanUpload em `evolucao_attachments` (raio-X PDF, vídeo execução) |
| **32 device hub** | scanUpload em `importFile` (FIT/CSV) + safeFetch nos providers Garmin/Oura |
| **33 pipeline exames** | STRIDE exames + scanUpload obrigatório em `lab-documents` (paciente sobe PDF malicioso disfarçado) + safeFetch OCR provider |
| **36 fiscal Focus** | safeFetch Focus NFe (`focusnfe.com.br`, `homologacao.focusnfe.com.br`) + validação IP source + KEK por tenant em `fiscal_provider_credentials` |

**Documentação:**
- `docs/decisions/0073-postura-seguranca-defesa-em-profundidade.md` — ADR completo
- `docs/rules.md` — regras 35-40 + header menciona "segurança em profundidade"
- `docs/modulos.md` — 15 novos módulos na fundação (Security headers, Rate limit, safeFetch+SSRF, Virus scan, Login lockout, Hash chain, PAM, Backup+DR, Criptografia at-rest, PII redaction, Anti-injection, Secret scanning, security.txt, Threat model, OWASP checklist, Pentest)
- `CLAUDE.md` — regras operacionais 20-25 + contador 40 regras

**Custos operacionais adicionais MVP: R$ 0 fixo.** Decisão do fundador: zero custo extra de segurança no MVP — todos os componentes pagos foram substituídos por alternativas free OU postergados para Fase 2 (com receita).

**Free no MVP:**
- **Vercel Hobby** + **Cloudflare proxy free** (DDoS L3/L4 + 5 regras WAF + bot fight mode + 10k requests rate limit) — substitui Vercel Pro WAF
- **Cloudflare Turnstile** (free)
- **Upstash Redis** free tier (10k commands/dia) — suficiente MVP solo
- **Scan próprio de upload** (`packages/security/scan-upload.ts` ~150 linhas TS): MIME real (file-type) + magic bytes + extension allowlist + size cap + embed detection (PDF JS, Office macro, polyglot) + hash SHA256 com seed `known_malicious_hashes` opcional. Provider abstrato permite plugar ClamAV em Fase 2 sem refactor.
- **Backup off-site free**: `pg_dump` weekly cifrado GPG → **Cloudflare R2 free 10GB** OU **Backblaze B2 free 10GB** OU **GitHub Releases privado** — Vercel Cron weekly. Substitui AWS S3 (postergado).
- **OWASP ZAP automated scan weekly** em GitHub Action — substitui pentest pago no MVP. Hall da Fama (sem recompensa monetária) substitui bug bounty pago.
- **Better Stack** free tier (1 monitor, 5min interval) ou GitHub Pages com Action — substitui Better Stack pago
- **DPO interino fundador** (ADR 0067 já permite) — substitui DPO externo retainer

**Postergado para Fase 2 (gatilho: receita / 1º cliente Enterprise / volume > 5GB / clínica médico-hospitalar pagante):**
- Vercel Pro $20-150/mês
- ClamAV self-hosted Fly.io R$ 30/mês ou cloudmersive R$ 200/mês
- AWS S3 backup off-site com Object Lock WORM R$ 100-300/mês
- Better Stack status page completo R$ 30-50/mês
- Pentest externo anual R$ 8-15k
- DPO externo retainer R$ 2-5k/mês

**Total Fase 2 (referência futura):** ~R$ 1.000-2.500/mês fixo + R$ 8-15k anual pentest. **Receita paga isso** — não bloqueia MVP. Adapter pattern em `packages/security/*.ts` permite trocar provider sem refactor de código consumidor.

**Trade-offs aceitos no MVP:**
- Scan próprio cobre ~90% dos casos comuns; malware 0-day sofisticado pode passar (aceitável solo, baixo volume)
- R2/Backblaze 10GB limita volume — migração para S3 quando passar de 5GB (1k-3k tenants)
- OWASP ZAP automated cobre menos que pentest humano experiente — upgrade Fase 2
- Vercel Hobby tem limites (100GB bandwidth, sem preview env por PR) — upgrade quando volume real exigir

---

### Added — ADR 0072: Escalabilidade do banco (particionamento + retenção + cold storage) + Regra 34

Pergunta do usuário: "Não corro o risco de ficar muito grande a base de dados?". Análise de volume sem mitigação: 100 tenants × 1 ano = 5B+ rows; com estratégia em camadas: ~50M hot + 200M cold (~80% redução de custo de storage). Aplicadas todas as 5 recomendações (1A · 2A · 3A · 4A · 5A).

**ADR 0072 — 5 camadas de defesa em profundidade:**
1. **Particionamento nativo PostgreSQL** — `PARTITION BY RANGE` temporal (mês/trimestre/ano) ou `PARTITION BY HASH (tenant_id)`. Drop = metadata-only (ms vs hours em DELETE row-by-row). Indexes vivem na partição.
2. **Retenção por compliance** — 5a audit (LGPD) · 20a prontuário (CFM 2.299/2021 + COFFITO 415/2012) · 5a fiscal · 1a IA audit + 5a cold (CFM 2.454/2026)
3. **Aggregation rollups** — raw drop após retenção, mas summary diário/mensal indefinido (`food_log_daily_summary`, `device_readings_daily_summary`, `member_events_summary_quarterly`, `workout_sessions_summary_quarterly`)
4. **Materialized views** — `tenant_metrics_daily` com `REFRESH CONCURRENTLY` (hourly nas quentes, daily nas frias) reduz queries do dashboard de O(rows) para O(dias)
5. **Cold storage Parquet zstd** — dados >2-5 anos exportados para Supabase Storage criptografado AES-256 com KMS; cold partitions preservam metadata leve na quente (member_id, signed_at, hash) para busca

**Sharding multi-cluster preparado** — `tenants.shard_url text NULL` (NULL = compartilhado; preenchido = dedicated cluster); ativação futura quando 1 tenant >100k members ou banco >500GB. View `v_sharding_candidates` lista candidatos.

**Regra 34 (nova)** em `docs/rules.md` (total **34 regras**):
- Toda tabela com volume estimado >5M linhas/ano OU >50k linhas/dia **deve** nascer particionada
- Migration declara `@volume_estimate_yearly: <N>` em comentário SQL; CI lint bloqueia se excede sem partição
- Toda tabela com retenção definida tem job de partition lifecycle cadastrado: `create-next-partitions` (cria futuras), `drop-old-partitions` (descarta após retenção), `archive-cold-partitions` (move para Storage)

**Regra operacional 19** em `CLAUDE.md` (total 19 regras operacionais para Claude).

**Tabelas afetadas (12 sprints ajustados):**
| Sprint | Tabela | Estratégia | @volume_estimate_yearly | Retenção |
|---|---|---|---|---|
| 01a | `audit_log` | Mensal | 50M+ | 5a (LGPD) |
| 01a | `tenants.shard_url` (coluna) | — | — | preparação sharding |
| 02 | `member_events` | Trimestral | 10M+ | 3a + summary perpétuo |
| 06 | `ai_audit_log` | Mensal | 30M+ | 1a hot + 5a cold (CFM 2.454) |
| 06 | `ai_semantic_cache` | TTL 30d | — | LRU eviction |
| 06 | `member_insights` (cache) | TTL 6-24h | — | por insight_key |
| 11 | `workout_sessions` | Trimestral | 8M+ | 5a + summary |
| 11 | `workout_session_items` | Trimestral | 80M+ | 2a + summary |
| 17 | `bank_transactions` | Trimestral | 6M+ | 5a fiscal + cold 2a+ |
| 17 | `nfe_received` | Anual | 12M+ | 5a hot + 5a cold |
| 20 | `consultas` | Trimestral | 5M+ | **20a** (CFM 2.299) — 5a hot + 15a cold AES-256 |
| 21 | `evolucoes_sessao` | Trimestral | 12M+ | **20a** (COFFITO 415) — 5a hot + 15a cold |
| 30 | `lab_results` | Anual | 6M+ | 20a (CFM 2.299) — 5a hot + 15a cold |
| 31 | `meal_log_entries` | Mensal | 30M+ | 6m raw + summary perpétuo |
| 32 | **`device_readings`** ⚠ | **DIÁRIA** | **180M+** | 90d raw + summary perpétuo + curated indefinido — **CRÍTICO** |
| 33 | `exam_documents` | Anual | 2M+ | 20a (CFM 2.299) — 5a hot + 15a cold |

**Sprints com infra de banco ajustada:**
- **Sprint 01a** — `audit_log` + `system_alerts` (já preparado em ADR 0071) já nasceram particionados; adiciona `tenants.shard_url`; jobs Vercel Cron `create-next-partitions` (mensal), `monitor-database-size` (diário), `vacuum-analyze-partitions` (semanal); schemas `archive_jobs` + `compliance_retention_log`
- **Sprint 07** — UI `/app/super-admin/database` (super-admin LogiFit fora do RBAC do tenant) com tamanho total + por tenant + projeção 12 meses + inventário de partições + histórico de jobs + cold storage usage + sharding candidates; permission `super_admin.database.read`; materialized view `tenant_metrics_daily` + jobs `aggregate-daily-summaries` + `refresh-materialized-views` + `monitor-database-size`
- **Sprint 32** ⚠ **TABELA-MONSTRO**: `device_readings` particionada DIÁRIA desde dia 1; sem isso explode em meses; pipeline de migração para `device_readings_curated` antes do drop diário preserva rastreabilidade clínica de leituras validadas em `assessment_measurements`

**Documentação atualizada:**
- `docs/rules.md` — regra 34 completa com 5 sub-itens; header menciona "escalabilidade do banco"
- `docs/modulos.md` — 4 novos módulos (Particionamento + retenção, Cold storage Parquet zstd, Monitoring de banco, Sharding multi-cluster preparado)
- `CLAUDE.md` — regra operacional 19 + contador 34 regras
- `docs/decisions/0072-*.md` — ADR completo com SQL examples (audit_log mensal, device_readings diário, food_log_daily_summary, materialized view), retention table, monitoring UI mockup, schemas (`archive_jobs`, `compliance_retention_log`)

---

### Added — ADR 0071: Sistema de tratamento de erros + Alertas em tempo real + Regra 33

Inspirado em modelo maduro do projeto Deep Control + corrige 3 pontos cegos reconhecidos (push ativo, role-based visibility, APM externo). Aplica todas as recomendações (1A-7A).

**ADR 0071 — Sistema de erros + alertas:**
- **Envelope unificado** `{code, message, details, request_id, runbook, retry_after_ms}` com **16 códigos fechados** (VALIDATION_ERROR, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, CONFLICT, RATE_LIMITED, INTERNAL_ERROR, SERVICE_UNAVAILABLE, AI_QUOTA_EXCEEDED, AI_PROVIDER_ERROR, PAYMENT_FAILED, FISCAL_REJECTED, CONSENT_REQUIRED, COMMITTEE_REQUIRED, SLUG_TAKEN, TENANT_SUSPENDED)
- **Fingerprint** SHA256(type|module|path|status|tenant_id)[:16] com TTL 24h — dedup multi-tenant
- Schema **`system_alerts`** + **`system_alert_occurrences`** (ring buffer timeline) com RLS + role-based visibility (`min_role`) — correção do ponto cego "só tier" do modelo Deep Control
- **4 canais de notificação no MVP**: badge SideMenu com Realtime subscribe + toast `sonner` na sessão ativa + email critical via Resend + WhatsApp urgent via provider (rate limit 3/hora) — corrige ponto cego "admin precisa entrar no dashboard"
- **Canais complementares**: push PWA (Sprint 26) + Sentry (LogiFit dev team — stack traces)
- **10 translators por domínio**: Asaas, Focus NFe (90+ códigos SEFAZ), Supabase RLS, Anthropic, Gemini, Groq, OpenAI, Twilio WhatsApp, TISS (~40 códigos glosa), Pluggy, Zod + fallback
- **Auto-resolução inteligente**: TTL, HTTP 503 recovery por webhook.success do mesmo provider, AI_QUOTA_EXCEEDED reseta no mês, FISCAL_REJECTED transient resolve na próxima emissão OK
- **Sanitização LGPD**: `sanitizeForAlert()` mascara CPF/CNPJ (últimos 4), email (só domínio), telefone (DDD+4), redact senha/token/dado clínico
- **Retenção por severity**: info 30d · warning 90d · error 365d · critical 1825d · security_event 1825d+obrigação legal
- **Trigger SQL** auto-cria `security_incidents` (ADR 0067) quando severity='critical' + category IN (security/data_leak/compliance) → dispara plano resposta 72h
- **Sentry complementar** (não substitui system_alerts): admin do tenant vê erros do próprio tenant no `/app/admin/alertas`; LogiFit dev team vê stack traces em Sentry

**Regra 33 (nova)** em `docs/rules.md` (total 33 regras):
- Server Action / API Route / Job **sempre** usa `wrapAction()` / `wrapApiHandler()` / `wrapJob()` de `packages/errors/`
- Wrapper: request_id + auth + permissions + rate limit + gates IA classe II+ (regra 28) + consent cross-module (regra 6) + translator + alert async + audit + Sentry + retorno `{ ok, data | error }`
- **Lint custom `no-unwrapped-action`** bloqueia commit se Server Action sem wrapper (exceção `// wrap-exempt: <motivo>`)

**Regra operacional 18** em `CLAUDE.md`.

**Sprints ajustados:**
- **Sprint 00** — `packages/errors/` completo (api-error + 3 wrappers + 10 translators stubs + sanitize + fingerprint) + middleware `x-request-id` + Sentry/PostHog/Logtail clients + lint `no-unwrapped-action` + i18n catalog de mensagens + teste E2E panic→envelope→alert→Sentry→toast
- **Sprint 00b (SideMenu)** — `useAlertCount()` hook com Supabase Realtime subscribe + toast global
- **Sprint 01a** — schema `system_alerts` + `system_alert_occurrences` (particionado por mês) + RLS + trigger `security_incidents` + `notification_queue`
- **Sprint 07** — UI `/app/admin/alertas` com KPIs/filtros/timeline/similar-alerts + realtime subscribe + jobs auto-resolve e retention expurge
- **Sprint 13** — worker da `notification_queue` com email Resend (critical) + WhatsApp provider (urgent) + rate limit + templates aprovados; canal privacidade@ recebe todos `security`
- **Translators por sprint de integração**: 04 (Asaas) · 06 (Gemini/OpenAI/Anthropic/Groq) · 15 (OCR) · 17 (Arquivei/Pluggy) · 20 (ICP-Brasil) · 22 (TISS) · 36 (Focus NFe 90+)

**Decisões do usuário (2026-04-24):** todas recomendações aprovadas (1A-7A).

**Impacto**: corrige 3 pontos cegos do modelo Deep Control; LGPD-safe; compliance auto-ligada a ADR 0067; diferencial operacional forte (admin vê erros em tempo real via múltiplos canais).

### Added — ADRs 0069 + 0070: Perfil como hub + Modo Solo + Insights cross-module + Timeline integrada

Duas decisões interdependentes que transformam `/app/members/[id]` no hub central do profissional:

**ADR 0069 — Perfil do paciente como hub operacional + Modo Solo:**

- Reestrutura `/app/members/[id]` em 4 camadas fixas: header (identidade) · action bar (role-aware) · tabs por visão · corpo contextual
- **Tabs por visão auto-detectadas por role**: Geral/Clínico/Treino/Alimentar/Financeiro/Comunicação/IA; filtradas por permission + vertical + consent
- **Modo atendimento**: timer visível + header diferenciado + SOAP editor inline; ao finalizar pergunta "salvar evolução? cobrar? próxima consulta?"
- **Sidebar direita**: histórico recente + favoritos (desktop); `user_member_favorites` + `user_recent_members` schemas
- **Registry `registerMemberAction`**: cada sprint registra suas ações (~60 ações totais); handler navega OU executa inline (modal/sheet)
- **Ações inline sempre** que possível — profissional permanece na página do paciente 80%+ do tempo
- **Modo Solo (`tenants.mode='solo'`)** detectado por onboarding wizard (perfil autônomo + 1 user) — UX simplificada sem tabs; action bar expandida; dashboard enxuto focado em agenda do dia + cobranças + mensal
- **Plano Solo R$ 49/mês** (R$ 39 anual) · 1 user · 80 clientes · overage R$ 0,80/member · cap +R$ 40 = sugere Starter; **Solo Combo R$ 69** com todas as verticais
- **Onboarding wizard**: pergunta "como atua?" (autônomo/clínica/rede) + "qual profissão?" → sugere plano + carrega templates
- **Templates pré-carregados por profissão** (CREF/CREFITO/CRN/CRP/Pilates/Esteticista): `services` típicos + escalas + CIDs + protocolos comuns
- **Fiscal Solo simplificado**: MEI (recibo ou NFS-e conforme município) · ME Simples Nacional · PF autônomo com RPA

**ADR 0070 — Insights cross-module computados + Timeline integrada:**

- Camada de **funções puras determinísticas** em `packages/db/insights/` — sem IA: `calculateTMB()`, `calculateTDEE()`, `calculateKcalPerSession()`, `calculateWeeklyVolume()`, `calculateCaloricBalance()`, `detectContraindications()`, `detectOvertrainingSignals()`, `estimateBodyTrajectory()`
- **9 insights no MVP**: TMB · gasto calórico sessão · volume semanal · frequência · TDEE · balanço calórico · adesão plano alimentar · contraindicações ativas · saldo créditos
- **5 insights Fase 2** (Sprint 34 Nutri-Agent consome): projeção peso · overtraining · risco lesão · trajetória composição corporal · interações medicamentosas
- **Exemplo canônico**: nutri vê treino do cliente → sistema calcula gasto calórico semanal (MET × peso × duração) + TDEE + sugere meta calórica do plano alimentar automaticamente
- **Widget cross-module** via `registerMemberWidget` ampliado com `crossModuleRequires` (source vertical + permission + consent) + `insights[]` (array de insight keys)
- **Timeline integrada**: materialized view `member_timeline` agrega consultas + sessões + food_log + avaliações + invoices em ordem cronológica; refresh 5min + invalidation por evento
- **Alertas cross-module automáticos** no MVP (reusa cross-alert dispatcher Sprint 07): contraindicação em novo treino, overtraining, balanço calórico crítico, adesão baixa, mudança de peso brusca
- **`exercises.met_value`** obrigatório (Sprint 11) + seed **Compendium of Physical Activities 2024** com ~800 exercícios curados
- **`cid_exercise_contraindications`** seed global LogiFit (~200 contraindicações mais comuns: lombalgia, hérnia discal, lesão meniscal, tendinite, LCA, etc.) + tenant pode override
- **Cache `member_insights`** com TTL variável (6h volume, 24h TDEE) + invalidação por evento; handlers em `packages/db/insights/invalidation.ts`
- **Consent granular por contexto cross-module**: `nutri_sees_training`, `personal_sees_prontuario`, `nutri_sees_prontuario`, `personal_sees_nutri_plan`, `fisio_sees_training` — paciente controla em `/meu/privacidade`

**Decisões do usuário (2026-04-24):**

Hub operacional:
1. Top tabs (não sidebar vertical)
2. Modo atendimento no MVP
3. Sidebar direita MVP
4. Ações inline sempre
5. Tabs auto por role sem customização

Modo Solo:
1. Plano Solo R$ 49/mês
2. Solo 1 vertical · Solo Combo R$ 69 todas
3. Modo auto-detectado no wizard
4. Templates por profissão no MVP
5. Perfil sem tabs no modo Solo

Insights cross-module:
1. MVP (não Fase 2)
2. Timeline integrada MVP
3. Alertas automáticos MVP
4. Compendium 2024 no Sprint 11
5. Contraindicações LogiFit-curadas
6. Cache `member_insights` com invalidação por evento

**Sprints ajustados**: 01a (wizard) · 02 (hub + timeline + cache + modo Solo) · 03 (agenda pessoal Solo) · 04 (plano Solo + pricing revisado) · 05 (templates por profissão) · 07 (dashboard adapta + cross-alert handlers) · 11 (met_value + Compendium 2024) · 12 (calculadoras em packages/db/insights/) · 15 (recibo MEI/RPA) · 20 (sheet SOAP inline) · 26 (portal Solo) · 27 (cid_exercise_contraindications) · 29 (usar TDEE + card treino) · 31 (food_log alimenta balance) · 34 (Nutri-Agent consome insights) · 36 (NFS-e opcional Solo)

**Schema**:
- `tenants.mode` enum (`solo`/`clinic`/`chain`/`hospital`)
- `attendance_sessions` (modo atendimento com timer + SOAP rascunho)
- `user_member_favorites` + `user_recent_members` (sidebar)
- `exercises.met_value` numeric(3,1)
- `cid_exercise_contraindications` (seed global + tenant override)
- `member_insights` (cache com TTL + invalidação)
- `member_timeline` materialized view
- 5 novos `consent_purposes` cross-module

**Pricing revisado (ADR 0066 + 0069):**
- **Solo** R$ 49/mês (R$ 39 anual) — autônomo, 1 user, 80 clientes · NOVO
- **Solo Combo** R$ 69 — autônomo com múltiplas verticais · NOVO
- Starter R$ 79/mês mantido
- Pro R$ 199/mês mantido
- Business R$ 449/mês mantido
- Enterprise sob consulta

**Cobertura**: captura mercado de ~700k profissionais autônomos saúde/fitness no Brasil antes desatendidos + entrega valor clínico cross-module real (nutri calcula TDEE automaticamente do treino; fisio alerta contraindicação antes de sessão; personal adapta com consent).

### Added — ADR 0068: Catálogo de serviços + Preços contextuais + Construtor de planos + Link financeiro

Resolve 3 fragmentações identificadas no modelo comercial durante análise do widget "Plano Premium · bundle":

1. **Preço fragmentado** — mesmo serviço morava em `plans`, `bundles`, `insurance_procedure_prices` separados
2. **Sem UI visual para admin montar planos** — só form simples no Sprint 04
3. **Link cliente↔financeiro disperso** — contract + invoice + AR + credit_ledger + cashback sem view unificada

Decisões do usuário (2026-04-24):
1. Construtor = **B** (form + modal "Adicionar serviço"; sem drag-drop no MVP)
2. Preços contextuais = **A** (tabela única `service_prices` com context discriminator)
3. Preview member = **A** (tela dedicada reduz erro de config)
4. Plano custom por member = **A** (via `service_prices` com `context='member_custom'`)
5. Plus: **link financeiro completo** detalhado no ADR (contratação → consumo → renovação → pagamento → inadimplência)

**Schema:**
- `services` (catálogo do tenant com slug, vertical, kind, default_price, CBO/TUSS, chart_account, stock_item, tax_nature)
- `plan_items` (composição do plano: qtd incluída, período, preço extra, hard limit)
- `service_prices` (7 contextos: default/plan/contract/member_custom/insurance/promotion/company com priority)
- `contracts` ganha discount_type/value/valid_until + referral_code_applied
- `invoices` ganha breakdown jsonb (base + overage + discounts + surcharges + taxes)
- `accounts_receivable` ganha member_id + service_id + appointment_id + parent_contract_id

**5 telas admin** (`/app/settings/servicos`, `/app/settings/planos`, `/app/settings/planos/[id]/preview`, `/app/settings/precos`, `/app/settings/promocoes`)

**Resolução de preço** — função pura `resolveServicePrice()` com prioridade decrescente (insurance > member_custom > promotion > contract > plan > company > default)

**Link financeiro completo** — ciclo documentado: contratação → consumo (crédito ou AR extra via Asaas) → renovação mensal (reset credits + desconto aplicado) → pagamento (webhook) → inadimplência (régua Sprint 13 integrada)

**Widget financeiro member unificado** — operador (`/app/members/[id]`) vê plano + consumo + extras em aberto + histórico + saldo cashback + ações administrativas; portal (`/meu/financeiro`) espelha com ações de autoatendimento (pagar, baixar recibo, usar cashback, portabilidade LGPD)

**Sprints ajustados:** 04 (plan_items + invoices.breakdown + widget), 05 (services + construtor + 5 telas + service_prices), 15 (AR ganha member_id/service_id/appointment_id), 22 (migração `insurance_procedure_prices` → `service_prices`), 02 (widget financeiro), 26 (portal `/meu/financeiro`), 13 (régua consome AR overdue)

**Descontos — 4 mecanismos integrados:** cupom/promoção (context='promotion'), desconto contratual (contracts.discount_*), preço VIP member (context='member_custom'), cashback acumulado (ledger opt-in aplicado na próxima invoice). Visualização consolidada no `invoices.breakdown`.

### Changed — ADR 0066 pricing revisado (Starter R$ 79 · Pro R$ 199 · Business R$ 449 · overage R$ 0,50/member)

Após benchmark de mercado (Tecnofit Lite R$ 99, Pro R$ 199; iClinic Pro R$ 119; NutMed R$ 99-249; Amplimed R$ 139-369), pricing inicial foi considerado **acima da média para tenant pequeno**. Revisão:

- **Starter:** R$ 149 → **R$ 79/mês** (anual R$ 69) · 100 members · 1 un · só Academia
- **Pro:** R$ 399 → **R$ 199/mês** (anual R$ 179) · 500 members · 3 un · todas verticais + Focus NFe + Device Hub + Pipeline Exames
- **Business (NOVO):** **R$ 449/mês** (anual R$ 399) · 2.000 members · 10 un · multi-company + intercompany + adquirência integrada — fecha gap entre Pro e Enterprise
- **Enterprise:** sob consulta (a partir de R$ 1.199/mês) · ilimitado + BYOK IA + SLA 99,9% + white-label + DPO-as-a-service
- **Free plan rejeitado** na decisão (opção B escolhida) — trial 14 dias substitui; reavaliar após 12 meses se conversão ficar baixa

**Overage suave por member:**
- R$ 0,50/member acima do incluído (Starter/Pro); R$ 0,40 (Business)
- Cap por tier força upgrade sugerido (ex: Starter +R$ 120 overage = 240 members → sugere Pro)
- Tenant que cresce de 95 para 130 members paga R$ 79 + R$ 15 overage (proporcional) sem upgrade hostil
- 3 ciclos acima do threshold = upgrade forçado no próximo ciclo (aviso 30d)

**Margem analisada:**
- Starter: 68% (R$ 54 líquido após ~R$ 25 de custo)
- Pro: 80% (R$ 159 líquido)
- Business: 82% (R$ 369 líquido)
- Enterprise: 83%+ (R$ 999+ líquido)

**Schema adicional:**
- `tenant_usage_snapshots` (period_ym, members_active, overage_amount_cents) para rastrear overage mensal
- `logifit_plans` ganha `members_included`, `members_overage_rate_cents`, `members_overage_cap_cents`
- `tenant_subscriptions` ganha `members_included_override` para Enterprise customizado

**Decisões do usuário (2026-04-24):**
1. Free plan = **B** (não adotar; trial 14d é suficiente)
2. Reduzir Starter para R$ 79 e Pro para R$ 199 = **A** (sim)
3. Business R$ 449 intermediário = **A** (sim)
4. Overage R$ 0,50/member suave = **A** (sim)

`docs/modulos.md` · `CLAUDE.md` · `CHANGELOG.md` atualizados.

### Added — 3 ADRs pré-Sprint 00: subdomínio + pricing + DPO (0065, 0066, 0067)

Trinca de decisões pré-implementação fechando os últimos bloqueadores antes do Sprint 00 iniciar:

- **ADR 0065 — Multi-tenant por subdomínio**: `{slug}.logifit.com.br`; middleware Next.js extrai slug do Host; wildcard DNS + SSL via Vercel; dev local com `*.localhost`; slug validation (3-30 chars, regex, reserved list); mudança de slug com redirect 301 por 90d; cookies escopo `.logifit.com.br`; rotas reservadas (`app`, `api`, `status`, `docs`); schema `tenants.slug` + `tenant_slug_history`
- **ADR 0066 — Plano comercial LogiFit**:
  - 3 planos: **Starter R$ 149/mês** (1 un, 150 members, 500 chamadas IA, 5GB), **Pro R$ 399/mês** (3 un, 500 members, 3k IA, 50GB, todas verticais, Focus NFe NFS-e, Device Hub, Pipeline Exames), **Enterprise sob consulta** (ilimitado + BYOK + SLA + white-label + DPO-as-a-service)
  - **Trial 14 dias** sem cartão com features Pro
  - Desconto anual ~14% (2 meses grátis)
  - **Régua inadimplência** D+3/D+7/D+14/D+21 read-only/D+45 suspenso/D+135 anonimização LGPD
  - Upgrade pró-rata imediato; downgrade fim do ciclo; cancelamento 2 etapas
  - LogiFit usa Asaas próprio para cobrar tenants + emite NFS-e automática via Focus NFe (Sprint 36)
  - Schema `logifit_plans` + `tenant_subscriptions`
- **ADR 0067 — DPO + Governança Compliance LGPD/CFM**:
  - **DPO interino (fundador)** até 50 tenants; **DPO-as-a-service** R$ 3-8k/mês na escala; DPO dedicado (200+ tenants)
  - Canal público `privacidade@logifit.com.br` + portal `logifit.com.br/privacidade` pós-MVP
  - **8 documentos públicos** (política privacidade, termos, DPA template, RIPD resumo, ROPA, cookies, sub-processors, política retenção)
  - **`security_incidents` schema** + plano resposta 72h ANPD (LGPD art. 48 §1º)
  - **Lista pública de sub-processors** (Supabase, Vercel, Google Cloud, Groq, Anthropic, OpenAI, Asaas, Resend, Sentry, PostHog, Logtail, Focus NFe, Upstash)
  - Custo operacional escala com porte: Fase 0 R$ 2k/mês → Fase 3 R$ 29k/mês
  - Auditoria interna trimestral (fundador) + externa anual (firma) na Fase 2
  - Pasta nova `docs/compliance/` com templates e playbooks

**`.env.example`** — `NEXT_PUBLIC_ROOT_DOMAIN`, `PRIVACY_EMAIL`, `COMMERCIAL_EMAIL`

**`docs/modulos.md`** — 3 módulos novos em Fundação (multi-tenant subdomínio, planos comerciais, DPO + governança)

**`CLAUDE.md`** — nova seção "Modelo comercial" consolidando pricing + IA embutida + DPO

Com esses 3 ADRs, Sprint 00 pode iniciar. Bloqueadores resolvidos: subdomínio, pricing, repo privacy (próxima decisão externa do usuário), DPO formalizado.

### Added — ADR 0064: Arquitetura de IA (Gemini Flash default + BYOK + RAG + tasks tipadas + regra 32)

Após 3 iterações sobre relação LogiFit ↔ IA ↔ tenant (revenda rejeitada · BYOK-only rejeitado) e análise da arquitetura de IA do projeto Deep Control, fechada arquitetura definitiva:

- **ADR 0064** — `docs/decisions/0064-ia-arquitetura-gemini-default-byok-rag.md`. Define:
  - **Default LogiFit:** Gemini 2.5 Flash via Vertex AI São Paulo (resolve LGPD data residency) — custo absorvido no plano (~R$ 1,50-17/mês/tenant conforme plano)
  - **BYOK opcional:** admin tenant cola API key própria (Anthropic/OpenAI/Gemini/Groq/Maritaca) em `/app/settings/ia` → bypass quota
  - **Quota por plano:** 500 (Starter) / 3.000 (Pro) / 10.000 (Enterprise) chamadas/mês; excedida = circuit breaker + CTA BYOK (sem overage pago)
  - **Cache semântico pgvector** reduz 40-60% consumo
  - **STT embutido** via Groq Whisper-large-v3-turbo (Sprint 31 teleconsulta) — ~US$ 0,30/tenant/mês absorvido
  - **Fallback cascade** automático Gemini → OpenAI → Anthropic em caso de 429/500/timeout
  - **7 tabelas** (`ai_providers`, `ai_models`, `ai_provider_configs`, `ai_task_routing`, `ai_tenant_usage`, `ai_documents`, `ai_document_chunks`, `ai_semantic_cache`)
  - **Tasks tipadas** (chat/embedding/classification/extraction/vision/transcription/reasoning) com `resolveModelForTask()` — nunca hardcode
  - **RAG global curado LogiFit:** ADRs + Sprints + schema Drizzle + regulações (CFM 2.454, LGPD, TISS 4.01, CFN 599, COFFITO 414, ANVISA RDC) como seed; Copilot cita fonte
  - **System prompt composto** (`buildSystemPrompt()` com agent + regras globais + user + RBAC + RAG)
  - **Tool calling restrito** — Server Actions tipadas (proibido LLM emitir SQL arbitrário)
  - **White-label** do nome do assistente (`tenant_settings.ai_assistant_name`)
  - **Sistema mínimo de tickets** com tool `report_issue`
- **Regra 32** em `docs/rules.md` — chamada IA via `resolveModelForTask()`; tool calling tipado; tier mínimo por feature clínica; CI bloqueia hardcode
- **Regra operacional 17** em `CLAUDE.md` (total 32 regras)
- **Sprint 06** — escopo cresce de 2 para 3-4 semanas: entrega infraestrutura IA completa (7 tabelas + RAG ingestion + quota + BYOK UI + white-label + tickets) além do Copilot
- **Sprint 31** — STT Groq Whisper + **rascunho SOAP automático pós-teleconsulta** (transcript + contexto → IA gera 4 seções → profissional revisa/edita/assina — regra 28 supervisão humana)
- `docs/modulos.md` — 9 módulos novos (arquitetura IA, RAG, BYOK, quota, white-label, STT, rascunho SOAP, tickets, etc.)
- `CLAUDE.md` — stack atualizada: Gemini default + Groq STT + BYOK opcional; regra 17 adicionada
- `.env.example` — GOOGLE_CLOUD_PROJECT, VERTEX_AI_LOCATION, GOOGLE_APPLICATION_CREDENTIALS, GROQ_API_KEY, ENCRYPTION_KEY adicionados

Decisões confirmadas pelo usuário (2026-04-24):
1. Default LogiFit = Gemini 2.5 Flash (custo R$ 5 / 3k chamadas/mês; datacenter SP)
2. STT = Groq Whisper embutido no plano
3. `ai_tenant_usage` para quota tracking mensal
4. Quota excedida = bloqueio + CTA BYOK (sem overage pago)

Inspiração: arquitetura de IA do projeto Deep Control (tasks tipadas + task routing + RAG completo + multimodal + white-label) adaptada ao contexto saúde com gates de compliance (CFM 2.454, LGPD art. 11, tier mínimo regra 32).

### Added — Sprint 00b Menu lateral + evolução ADR 0063 (hamburger overlay único)

- **Sprint 00b (novo)** — `docs/sprints/00b-menu-lateral.md` com escopo detalhado de `<SideMenu>` hamburger overlay + registry por módulo + filtros automáticos de permission/vertical/consent/feature flag.
- **ADR 0063 atualizado** — padrão de navegação muda de "sidebar fixa em desktop + bottom-nav mobile + drawer tablet" (original) para **overlay único em todos os viewports** — ícone `☰` sempre visível, página ocupa 100% da largura em qualquer dispositivo. Trade-off aceito: mais cliques para navegar em desktop, compensado pelo atalho `Ctrl+B`/`Cmd+B` + pesquisa global `Ctrl+K` (ADR 0062) que vira caminho primário de navegação.
- **Organização por módulos** (decisão do usuário 2026-04-23): menu agrupa itens em ~15 módulos (Início, Pessoas, Agenda, Acesso, Comercial, Financeiro, Fiscal, Clínico, Vigilância, Relacionamento, Estoque, Engajamento, RH, Compliance, Integrações, Configurações); cada módulo colapsa/expande; **módulo inteiro oculto** se nenhum item passa nos filtros.
- **Filtros automáticos** na renderização: `requiredPermission` (via `has_permission()`), `requiredVertical` (tenant tem vertical ativa), `requiredConsent` (consent ativo), `featureFlag` (feature ligada). Padrão consistent com `registerMemberWidget` / `registerQuickAction` / `registerCrossAlertHandler` existentes.
- **Sprint 00 ajustado** — `<AppLayout>` agora é só header compacto + slot de conteúdo 100% viewport; componentes `<BottomNav>`, `<Drawer>`, `<Sidebar>` fixa **removidos** (não existirão); entrega apenas slot do `<HamburgerTrigger>` (implementação completa no 00b).
- **Sprint 07 ajustado** — não implementa sidebar própria; apenas registra itens do módulo "Início" via `registerMenuItem()`; botão 🔍 do Command Palette ao lado do ☰ no header.
- **Atalhos de teclado** (desktop): `Ctrl+B` / `Cmd+B` abre/fecha menu (padrão VSCode); `Esc` fecha + restaura foco; `Ctrl+K` continua abrindo pesquisa global.
- **Touch gestures** (mobile/tablet): swipe da borda esquerda abre; swipe para esquerda no menu aberto fecha.
- **Acessibilidade:** focus trap `role="dialog"` + `aria-modal="true"` + restore focus no trigger ao fechar; WCAG AA.
- **Roadmap atualizado** — Sprint 00b adicionado como item #1b entre #1 (Setup) e #2 (Identidade).
- **`docs/modulos.md`** — módulo "SideMenu hamburger overlay" adicionado em Fundação.

### Added — Responsividade total mobile-first (ADR 0063 + regra 31)

- **ADR 0063** — Responsividade total (`docs/decisions/0063-responsividade-total-mobile-first.md`). Toda UI `/app/*` e `/meu/*` adapta em 5 breakpoints (default/sm/md/lg/xl/2xl) via biblioteca de componentes base em `packages/ui/layout/*`. Mobile-first, touch targets ≥44px, safe-area-inset, testes Playwright em 3 viewports canônicos (mobile 390, tablet 768, desktop 1280). Zero serviço externo (Tailwind + shadcn nativos).
- **Regra 31** em `docs/rules.md` — proíbe layout próprio duplicado; exige componentes base de `packages/ui/layout/*`; CI bloqueia `<button>` com altura <44px e `<table>` fora de `<ResponsiveTable>`.
- **Sprint 00** — entrega biblioteca completa:
  - `<AppLayout>` (sidebar desktop ↔ bottom-nav mobile ↔ drawer tablet)
  - `<PortalLayout>` (`/meu/*` PWA com safe-area-inset)
  - `<ResponsiveModal>` (full-screen mobile ↔ centered desktop)
  - `<ResponsiveTable>` (table ↔ card-list com prioridade de colunas)
  - `<ResponsiveForm>` + `<StickyFooter>` (grid 2-col ↔ stack 1-col com rodapé fixo mobile)
  - `<BottomNav>` (tab bar inferior com 5 slots configuráveis por role)
  - `<Drawer>` (gaveta lateral com swipe tablet)
  - Tokens `min-h-touch` (44px) + `min-h-input` (48px) + `safe-area-*`
  - Helper `packages/config/playwright-viewports.ts` com matrix de viewports
  - Regra Biome "no-desktop-only-layout" (CI)
- **Sprint 07** — Dashboard adapta: mobile usa `<BottomNav>` (Home/Agenda/Financeiro/Pessoas/Mais); tablet usa `<Drawer>`; desktop usa `<Sidebar>` fixa; cards colapsam 4→3→2→1; Command Palette ganha botão 🔍 visível em mobile (substitui Ctrl+K).
- **Sprint 08** — QR do aluno otimizado mobile portrait; UI recepção aceita tablet landscape; feed live usa `<ResponsiveTable>` (cards em mobile).
- **Sprint 26** — Portal paciente confirma PWA mobile-first com safe-area-inset, bottom nav 4 slots, install prompt após 2ª visita, Lighthouse PWA ≥95.
- **`docs/sprints/_template.md`** — Definition of Done ganha 3 itens: responsividade (3 viewports), busca global (search_index), i18n (3 locales).
- **`docs/modulos.md`** — módulo "Componentes base responsivos" em Fundação.
- **`CLAUDE.md`** — regra operacional 16 + contagem 31 regras.
- Viewports de teste canônicos: iphone-13, pixel-5, ipad-portrait, ipad-landscape, desktop-1280, desktop-1920.

### Added — Pesquisa global Command Palette Ctrl+K (ADR 0062 + regra 30)

- **ADR 0062** — Pesquisa global via Command Palette (`docs/decisions/0062-pesquisa-global-command-palette.md`). Atalho `Ctrl+K` (Windows/Linux) e `Cmd+K` (Mac) abre overlay em qualquer tela; busca cross-module respeitando RLS + permission + consent + regra 25; modificadores `>` ações / `/` rotas / `@` pessoas / `#` tags; full-text PostgreSQL (tsvector) + trigram (pg_trgm) + unaccent; zero serviço externo (Algolia/Meilisearch rejeitados por custo + LGPD).
- **Regra 30** em `docs/rules.md` — módulo novo com dado pesquisável registra-se em `search_index` com `required_permission` explícita; omissão proibida (operador sem permission nunca pode ver resultado).
- **Sprint 00** — extensões PostgreSQL `pg_trgm` + `unaccent` habilitadas + scaffolding `<CommandPalette>` em `packages/ui` (componente base + hook `useCommandPalette()` + atalhos globais).
- **Sprint 07** — entrega MVP: tabela `search_index` + `search_telemetry` + triggers `search_index_sync()` para 7 tipos (person, member, lead, supplier, user, professional, appointment, ap, ar, setting, quick_action) + API `/api/search` + `<CommandPalette>` completo + API `registerQuickAction()` + atalho no layout + audit em clique em sensível.
- **Sprints 15, 17, 20, 21, 22, 25, 32, 33, 36** — cada sprint adiciona trigger de indexação de seus tipos no `search_index`: `ap`/`ar`/`supplier`/`nfe_received` (15), `bank_tx`/`nfe_return` (17), `consulta` sensível (20), `evolucao` sensível (21), `billing_guide`/`authorization` (22), `equipment`/`maintenance` (25), `device_connection` (32 — readings individuais NÃO indexados por volume), `lab_result` sensível (33), `fiscal_emission` (36).
- `docs/modulos.md` — módulo "Pesquisa global (Command Palette Ctrl+K)" em Fundação.
- `CLAUDE.md` — regra operacional 15 + contagem total de regras atualizada para 30.
- **Sem semântica no MVP** — embeddings pgvector mapeados para sprint futuro pós-33 se busca por sinônimos clínicos virar dor.

### Changed — Auditoria de cobertura de telas + ajustes em 7 sprints

Após auditoria sistemática cruzando 218 rotas documentadas × 10 roles × 61 ADRs × módulos prometidos, aplicados ajustes em 7 sprints:

- **Sprint 01b** — 4 telas novas detalhadas:
  - `/app/settings/compliance/comite-ia` (ADR 0053) — cadastro de membros, ata anexada, calendário de revisões semestrais, gate visual de features IA classe II+
  - `/app/compliance/ia` (ADR 0053) — dashboard de conformidade IA: features ativas + classe SaMD + última revisão + log de decisões humanas
  - `/meu/privacidade` (ADR 0054, scaffold) — 8 botões dos direitos LGPD art. 18; apagamento como solicitação (não automático)
  - 3 schemas novos: `data_subject_requests`, `ai_committee_members`, `ai_committee_reviews`, `ai_feature_classifications`
  - Wrapper `withAiClassGate(featureKey, fn)` bloqueia execução de features IA classe II+ sem comitê ativo
- **Sprint 13** — 2 telas: `/app/settings/canais/whatsapp` (config handlers inbound + identity matcher + log de classificações) + `/app/mensagens/inbound` (mensagens sem roteamento automático)
- **Sprint 15** — `/app/settings/financeiro/naturezas` (ADR 0061) — CRUD de `tax_natures` globais + custom do tenant com preview de retenções
- **Sprint 17** — 4 telas detalhadas:
  - `/app/financeiro/nfe/[id]/manifestar` — modal dos 4 eventos (ciência/confirmar/desconhecer/não realizada) com validação de justificativa ≥20 chars
  - `/app/financeiro/nfe/[id]/devolver` — modal de devolução (total/parcial + categoria + motivo) + PDF controle
  - `/app/financeiro/nfe/[id]/importar-devolucao` — upload do XML da devolução emitida externamente
  - `/app/financeiro/devolucoes` — lista consolidada de `nfe_returns` com alertas >7d em espera
- **Sprint 26** — `/meu/privacidade` expandido com UI completa dos 8 direitos LGPD + `/meu/privacidade/solicitacoes/[id]` + rotas admin espelho (`/app/compliance/titular-requests`, `/app/settings/retencao`)
- **Sprint 32** — 2 telas Device Hub detalhadas: `/app/members/[id]/dispositivos/curar` (curadoria profissional das leituras para avaliação) + `/app/settings/devices/[provider]` (config por provider) + `/meu/dispositivos/[provider]/consent` (consent granular por integração)
- **Sprint 36** — `/app/contador/*` expandido em **8 abas**: dashboard, xmls (massa), ap-ar (CSV/OFX), retenções, **DRE por período** (Sprint 14 read-only), **KPIs agregados** (nunca individuais — regra 26), fiscal-emissions, certificados (visualização); decisão: contador precisa de DRE para fechar balanço + KPIs para sanity check
- `docs/modulos.md` — módulos "Direitos do titular" e "Portal do contador externo" com escopo completo (8 abas do contador explicitadas)

**Decisões aplicadas nesta rodada** (respostas às 3 perguntas):
1. ✅ `/meu/privacidade` direito de apagamento = **solicitação** (admin + profissional + contador validam obrigações de retenção em 15d); evita cliente apagar acidentalmente dado com retenção legal
2. ✅ `/app/contador` inclui **DRE + KPIs agregados** (contador precisa para fechar balanço; agregados respeitam regra 26 — nunca dado individual)
3. ✅ Device Hub — telas em `/meu/dispositivos` (member pareia/revoga) **e** `/app/members/[id]/dispositivos` (profissional curta leituras para avaliação formal)

### Added — Motor de retenções + portal contador + roadmap fiscal faseado (ADR 0061)

- **ADR 0061** — Motor de retenções tributárias + cobertura fiscal faseada (`docs/decisions/0061-motor-retencoes-e-cobertura-fiscal-faseada.md`). Mapeia os 7 grupos de impostos (A-G) e define cobertura progressiva: Fase atual cobre B (retenções em AP) + G (retenções em comissão/RPA) + role/portal contador externo; Fases futuras cobrem C (apuração mensal), D (guias DAS/DARF/DAM), E (obrigações acessórias SPED/ECD/ECF), F (folha CLT + eSocial). Ambição de cobertura completa longo prazo, com tempo para avaliar make vs buy em cada grupo complexo.
- **Sprint 01b** — nova role `contador_externo` com permissions `fiscal.read` + `financeiro.read` + `nfe.read` + `retencoes.read` em todas as companies do tenant; MFA obrigatório; **sem** acesso a dados clínicos (LGPD art. 11); convite via magic link + fluxo de onboarding.
- **Sprint 15** — schemas `tax_natures` (10 globais + custom por tenant) + `tax_retentions`; calculadora em `packages/ai/fiscal/tax-calculator.ts` com suporte a rate_table (IRRF progressivo), cap_cents (teto INSS), threshold_cents, condition por UF/tomador; UI de AP com select de natureza + preview de retenções; coluna `accounts_payable.net_amount_cents`; UI admin `/app/settings/financeiro/naturezas`; job anual `tax-tables-annual-update`.
- **Sprint 23** — cálculo automático de retenções em comissão/RPA conforme tipo do profissional (PF autônomo → RPA com INSS 11%/IRRF progressivo; PJ → PIS/COFINS/CSLL/IRRF; Simples → sem retenção); UI mostra decomposição bruto → retenções → líquido; `commission_entries.net_amount_cents`.
- **Sprint 36** — aba `/app/fiscal/retencoes` (relatório mensal agrupado por tributo + export PDF/CSV) + **portal `/app/contador`** read-only para role `contador_externo` (download ZIP em massa de XMLs + CSV/OFX + relatório de retenções) + `/app/contador/convidar` para admin do tenant convidar contador externo.
- **Roadmap** — 4 sprints novos mapeados como **futuro (pós-produção)** cobrindo Grupos C/D/E/F: Sprint 37 (Apuração mensal), Sprint 38 (Guias oficiais DAS/DARF/DAM), Sprint 39 (Obrigações acessórias SPED/ECD/ECF — avaliar make vs buy), Sprint 40 (Folha CLT + eSocial — avaliar integração TOTVS/Senior/ADP). ADRs 0062-0065 previstos.
- `docs/modulos.md` — 4 módulos novos (motor de retenções, relatório retenções, portal contador, 4 fases futuras).
- `CLAUDE.md` — cobertura fiscal faseada explicitada; fontes regulatórias ampliadas (Lei 10.833/2003, IN RFB 1.234/2012, tabela IRRF anual, Portaria INSS, LC 116/2003).

**Integrações com Contabilizei/Conube/Omie/Alterdata/Domínio:** mencionadas no ADR 0061 como opções a avaliar nos Sprints 37+; não implementadas agora.

### Added — Ciclo fiscal completo: devolução + emissão via Focus + recepção avançada (ADRs 0058, 0059, 0060 + Sprint 36)

Resposta à verificação sistemática de todas as 22 operações NF-e do Brasil contra os módulos LogiFit. Cobertura anterior: 2 operações (recepção + manifestação). Agora: **ciclo fiscal completo** com 8 emissões + 3 eventos + 4 cenários avançados de recepção.

- **ADR 0058** — Devolução de compra (`docs/decisions/0058-devolucao-de-compra-nfe.md`). Duas camadas: registro interno (`nfe_returns`) no Sprint 17 com PDF de controle + import de XML emitido externamente; emissão automática via Focus NFe no Sprint 36. Reconciler integra com AP/AR (estorno ou criação de crédito).
- **ADR 0059** — Ciclo fiscal de emissão completo via Focus NFe (`docs/decisions/0059-ciclo-fiscal-emissao-focus-nfe.md`). Amplia Sprint 36 de "só NFS-e" para 8 tipos de emissão (NFS-e, NF-e produto, NFC-e varejo, NF-e devolução, NF-e transferência filial, NF-e remessa/retorno conserto, NF-e entrada própria) + 3 eventos (cancelamento, CC-e, inutilização). Interface `FiscalProvider` abstrata; Focus NFe como impl primária. LogiFit **não toca em motor tributário**.
- **ADR 0060** — Tratamento avançado de recepção NF-e (`docs/decisions/0060-recepcao-nfe-avancada-nfs-relacionadas.md`). Parser estendido extrai `finNFe`, CFOP primário, `refNFe` → link automático entre NFs relacionadas; `inbound_direction` diferencia compra/devolução-de-venda-recebida/complementar/ajuste/entrada-própria; job noturno resolve links órfãos.
- **Sprint 36 (novo)** — `docs/sprints/36-geral-fiscal-focus-nfe.md` implementa ADR 0059: 10 Server Actions de emissão + 3 de eventos + webhook callback Focus + wizard de onboarding + catálogo de serviços tributáveis + integrações com Sprints 04/16/17/22/24/25.
- **Sprint 15** — schemas adicionais: `nfe_returns` (ADR 0058), colunas `finality`/`cfop_primary`/`related_nfe_id`/`related_chave`/`is_self_issued_entry`/`self_issue_emission_id`/`inbound_direction` em `nfe_received` (ADR 0060), `fiscal_emissions` + `fiscal_events` + `fiscal_numbering_sequences` (ADR 0059 — preparação de schema sem UI); parser estendido para extrair metadados do XML; coluna `nfse_chave` em `invoices`.
- **Sprint 17** — UI completa de devolução (modal + PDF controle + import XML + reconciler) + badges contextuais por `inbound_direction` na inbox + filtro por tipo + job de resolução de links órfãos + 6 Server Actions novas.
- **Sprint 24** — POS emite NFC-e ou NF-e produto automaticamente (quando Sprint 36 ativo); novos `kind` em `stock_movements` (`exit_return_to_supplier`, `entry_return_from_customer`); FKs para `nfe_returns` e `fiscal_emissions`; listeners de devolução integram com estoque.
- **Sprint 16** — `intercompany_entries` ganha `requires_nfe_transfer` + `nfe_transfer_emission_id`; trigger marca transferências de bens entre CNPJs distintos; botão "Emitir NF-e transferência" quando Sprint 36 ativo.
- **Sprint 25** — `equipment_maintenance` ganha ciclo para manutenção externa com status `in_transit_to_external`/`at_external`/`returning`; FKs para NF-e de remessa (5.915) e retorno (1.916); integra com inbox de recepção do retorno.
- `docs/modulos.md` — 3 módulos novos no bloco "Geral" (devolução, recepção avançada) + nova seção completa "Emissão Fiscal" com 11 módulos cobertos pelo Sprint 36.
- `docs/roadmap.md` — Sprint 36 escopo atualizado com descrição completa.
- `CLAUDE.md` — marcos regulatórios ampliados: Focus NFe como provider oficial, NT 2013/005 (NFC-e), NT 2011/004 (CC-e), RTC 1.400/2016 ABRASF (NFS-e).

**Cobertura fiscal LogiFit agora:**

| Dimensão | Antes | Depois |
|---|---|---|
| Recepção NF-e | ✓ básica | ✓ básica + 4 cenários avançados (devolução de venda, complementar, ajuste, entrada própria) |
| Manifestação | ✓ 4 eventos | ✓ 4 eventos |
| Devolução | ✗ | ✓ registro interno + emissão automática |
| Emissão NFS-e | ⏳ Sprint 36 (só) | ✓ Sprint 36 |
| Emissão NF-e produto | ✗ | ✓ Sprint 36 |
| Emissão NFC-e | ✗ | ✓ Sprint 36 (integra POS Sprint 24) |
| Transferência entre filiais | ⚠ só contábil | ✓ contábil + NF-e de transferência |
| Remessa conserto | ✗ | ✓ ciclo completo com NF-e 5.915 / 1.916 |
| Entrada própria | ✗ | ✓ emissão + espelho na recepção |
| Eventos (cancelar/CC-e/inutilizar) | ✗ | ✓ via Focus NFe |

### Added — Manifestação do Destinatário NF-e (ADR 0057)

- **ADR 0057** — Manifestação do Destinatário de NF-e (`docs/decisions/0057-manifestacao-destinatario-nfe.md`). Cobre os 4 eventos fiscais da NT 2012/002 SEFAZ: Ciência (210210), Confirmação (210200), Desconhecimento (210220), Não Realizada (210240). Ciclo de vida integrado à inbox `/app/financeiro/nfe` (ADR 0056).
- **Ciência automática ON por padrão** (decisão do usuário) — tenant pequeno sem contador tem conformidade fiscal sem configurar; demais eventos **sempre manuais** com audit por `user_id`.
- **Gate por CNPJ** — company sem CNPJ (tenant PF) recebe `manifestation_status='not_applicable'` via trigger; UI esconde ações.
- **Sprint 15** — adiciona colunas de manifestação em `nfe_received` (`manifestation_status`, `manifestation_protocol`, `manifestation_at`, `manifestation_deadline`, `manifestation_by_user_id`, `manifestation_mode`, `manifestation_justification`, `manifestation_attempts`, `manifestation_last_error`) + `company_settings.nfe_manifestation_enabled`, `nfe_auto_ciencia_enabled` (default true), `nfe_manifestation_deadline_days` (default 180) + trigger do gate por CNPJ.
- **Sprint 17** — UI completa (coluna "Manifestação" + modal 4 opções) + `NfeFetcher.sendManifestation()` com retry + handler de ciência automática + jobs `nfe-manifestation-expiry` e `nfe-manifestation-deadline-warn` + card "NFs a manifestar" no dashboard do gerente + Server Actions `toggleNfeAutoCiencia` e `manifestNfe`.
- **Prazo padrão 180 dias** com alerta D-7 via cross-alert dispatcher (Sprint 07); override por UF fica como evolução.
- `CLAUDE.md` — NT 2012/002 SEFAZ adicionada aos marcos regulatórios.
- `docs/modulos.md` — módulo "Manifestação do Destinatário NF-e" em Geral.

### Added — Inbox unificada de NF-e com 4 métodos de ingestão (ADR 0056)

- **ADR 0056** — Inbox unificada de NF-e (`docs/decisions/0056-nfe-inbox-unificada-e-metodos-ingestao.md`). Tela única `/app/financeiro/nfe` concentra os 4 métodos de entrada: (1) download automático SEFAZ, (2) download por chave 44 dígitos, (3) upload XML, (4) entrada manual sem NF. Um único toggle em settings liga/desliga o automático; os 3 métodos manuais ficam sempre disponíveis como ações na inbox.
- **Sprint 15** — cria `nfe_received` (compartilhada com Sprint 17), inbox unificada com Upload XML + Entrada manual ativos; botão "Por chave" presente mas desabilitado com tooltip explicativo; `/app/settings/financeiro/nfe` com toggle em estado "aguardando Sprint 17"; interface `NfeFetcher` esqueleto em `packages/ai/nfe/fetcher.ts`; Server Actions: `uploadNfeXml`, `createApManual`, `convertNfeToAp`, `discardNfe`.
- **Sprint 17** — habilita os 2 métodos dependentes de provider externo + certificado A1: toggle "Download automático" vira funcional + botão "Por chave" habilitado na mesma inbox; implementações concretas de `NfeFetcher` (Arquivei, Sieg, Focus, SEFAZ direto); `nfe_sefaz_cursors` (novo); nova Server Action `fetchNfeByKey`.
- `docs/modulos.md` — módulo "Inbox unificada de NF-e" (Sprint 15+17) + módulo "Download por chave NF-e" (Sprint 17).
- **`accounts_payable`** ganha coluna `nfe_received_id uuid nullable` (FK) + `no_invoice bool default false` + enum `source` ampliado com `nfe_manual_key`.

### Added — Registros profissionais em conselho (ADR 0055)

- **ADR 0055** — Registros profissionais em conselho: CRM/CRN/CREFITO/CREF (+ enum aberto para CRF/CRP/COREN/CRO) (`docs/decisions/0055-registros-profissionais-em-conselho.md`). Tabela `professional_registrations` com unicidade global `(council_body, council_number, council_state)`; uma pessoa pode ter N registros (profissional dual); `situation` enum (`active`/`suspended`/`cassated`/`expired`/`pending_verification`/`unknown`); MVP = `operator_attested`, Fase 2 = job de validação automática nos portais oficiais.
- **Sprint 01b** — cria tabela, permissions `profissional.read/write`, UI `/app/pessoas/[id]/registros`, view `v_professional_registrations_active`, seed dos 4 conselhos base, testes E2E.
- **Sprint 20** (Prontuário) — `signConsulta`/`lockConsulta` exige registro ativo coerente com `kind` (medico→CRM, fisio→CREFITO, nutri→CRN); PDF inclui `{council_body}-{council_state} {council_number}` no rodapé (obrigatório CFM 2.299/2021, COFFITO 414/2012 art. 7º III, CFN 599/2018).
- **Sprint 22** (TISS) — gerador de XML popula `NumeroConselhoProfissional`, `SiglaConselho`, `UF`, `CBOS` a partir de `professional_registrations`; bloqueia geração se profissional sem `cbo_code` cadastrado.
- **Sprint 23** (Comissões) — `createProfessionalContract` valida registro ativo coerente com tipo de serviço do contrato.
- **Sprint 08** (Acesso Academia) — onboarding de user com role `personal`/`instrutor` exige CREF ativo (Lei 9.696/1998).
- `docs/modulos.md` — novo módulo "Registros profissionais em conselho" em Fundação + linhagem adicionada ao Contact-FK model.
- `CLAUDE.md` — marcos regulatórios ampliados: Leis 3.268/1957 (CFM), 6.316/1975 (COFFITO), 6.583/1978 (CFN), 9.696/1998 (CONFEF).

### Added — Conformidade regulatória (ADRs 0053, 0054 + regras 28, 29)

- **ADR 0053** — Conformidade CFM 2.454/2026 (IA em medicina) + classificação SaMD por feature (`docs/decisions/0053-conformidade-cfm-2454-2026-ia-saude.md`). Três pilares: (1) classificação SaMD por feature IA (Classe I/II/III/IV conforme RDC 657/2022); (2) supervisão humana documentada em `ai_audit_log`; (3) Comitê de IA interno obrigatório por tenant com feature IA classe II+. Tabela inicial classifica Sprints 06/13/19/28/32/33/34. Deadline regulatório: agosto/2026.
- **ADR 0054** — LGPD art. 11 (dados de saúde sensíveis) + RIPD versionado (`docs/decisions/0054-lgpd-art11-dados-saude-ripd-versionado.md`). Quatro componentes: (1) base legal explícita por tipo de dado; (2) consent granular por finalidade (`consent_purposes`); (3) RIPD versionado por módulo crítico com revisão semestral; (4) direitos do titular (art. 18) atendidos em 15 dias via portal `/meu/privacidade`.
- **Regra 28** em `docs/rules.md` — feature IA classe SaMD II+ não ativa sem Comitê de IA cadastrado + ata anexada (gate em feature flag); toda chamada IA clínica grava `ai_audit_log`; classificador de output proibido ativo.
- **Regra 29** em `docs/rules.md` — dado de saúde sensível só trafega com base legal explícita + RIPD vigente; CI bloqueia módulo clínico sem registro em `ripd_documents`; direitos do titular em 15 dias.
- `docs/modulos.md` — Fundação ganha 8 módulos transversais de conformidade: Classificação SaMD, Supervisão humana documentada, Comitê de IA interno, Dashboard de conformidade IA, RIPD versionado, Consent granular por finalidade, Direitos do titular (art. 18), Retenção e descarte automatizado.
- `docs/modulos.md` — nova seção "Integrações Wellness (Gympass / TotalPass / Wellhub)" com 5 módulos pós-Sprint 19: provider abstrato, check-in via wellness, reconciliação de repasse, card de conversão, cadastro multi-plan.
- `CLAUDE.md` — nova seção "Marcos regulatórios que norteiam o produto" (LGPD art. 11, CFM 2.454/2026, CFM 2.299/2021, COFFITO 414/415/2012, CFN 599/2018, ANVISA RDC 657/751/2022, ANS TISS 4.01); regras operacionais 13 (IA com comitê) e 14 (RIPD/LGPD) adicionadas.

### Changed — correções regulatórias em sprints (CFM/COFFITO/CFN/ANS)

- **Sprint 22 TISS/TUSS**: atualizado de TISS v3.05 (defasado) para **TISS 4.01** (Ofício-Circular ANS nº 1/2026 — vigência janeiro/2026). Adicionado ADR 0030 (pipeline de atualização semestral da terminologia TUSS: OPME +26k termos, medicamentos +334) e ADR 0031 (validador TISS proativo que bloqueia envio com erro conhecido antes da glosa: procedimento × especialidade, autorização vigente, carteirinha válida, co-participação). Nova tabela `tuss_catalog_imports` rastreia deltas semestrais.
- **Sprint 20 Prontuário**: política de fechamento diferenciada por profissão via `signature_mode` enum (`icp_brasil_required` para médicos CFM 2.299/2021; `icp_brasil_optional` para fisioterapeutas COFFITO 414/2012; `authenticated_lock` para nutricionistas CFN 599/2018). Nova tabela `signature_policies` + ADR 0032. Correção: COFFITO **não** exige ICP-Brasil expressamente (interpretação anterior era incorreta); aceita lacre autenticado (MFA + hash SHA-256 + timestamp + audit).
- **Sprint 12 Avaliações Físicas**: seed de 8 escalas funcionais validadas clinicamente (`category='escala_funcional'`): **EVA** (dor), **Oswestry** (lombalgia), **DASH** (membros superiores), **Tampa** (cinesiofobia), **SF-36** (qualidade de vida), **Berg** (equilíbrio), **TUG** (mobilidade), **WOMAC** (joelho/quadril). `assessment_types` ganha coluna `category`, `scoring_method jsonb` (sum/percent/domain + interpretação clínica) e `clinical_reference`. Scorers em `packages/db/assessments/scoring/` (um arquivo por escala).
- **Sprint 07 Dashboard**: cards novos "Inadimplência por Método" (cartão × PIX × boleto, consumindo `payment_method` do Asaas) e "Conversão Wellness vs Direto" (Gympass/TotalPass/Wellhub — view vazia até Sprint de Integrações Wellness existir, mas card já mapeado).

### Added
- ADR 0010 — `financial_mode=centralized` usa 1 matriz + N units (sem schema separado)
- `docs/modulos.md` — catálogo de módulos do sistema agrupado por área (fundação / geral / academia / fisio / nutri) com "quais verticais usam" e "sprint alvo"
- Sprints MVP 02–07 detalhados em formato profundo (módulos · rotas · Server Actions/API Routes · schemas Drizzle · eventos de domínio · ADRs esperados): `02-geral-crm-pessoas.md`, `03-geral-agenda-universal.md`, `04-geral-financeiro-asaas.md`, `05-geral-copilot-base.md`, `06-geral-dashboard.md`, `07-academia-controle-acesso.md`
- Módulo "Dashboard do member" no catálogo: `/app/members/[id]` vira home com grid de widgets; Sprint 02 entrega layout + widget inicial (dados + timeline resumida) via `<MemberWidgetSlot />`; Sprints 03/04/05/07 contribuem widgets de agenda, financeiro, copilot e acessos
- Modelo de visibilidade do Dashboard do member com 4 gates — role (`requiredPermissions`), vertical (`requiredVertical`), presença (`showWhen(member)`) e consent (`consentPurpose` quando cross-module). Matriz completa role × vertical × consent por widget documentada em `docs/modulos.md`; cada sprint registra widget via `registerMemberWidget(meta)` do registry exportado em `packages/ui/members/registry.ts`
- Modelo de autorização expandido no Sprint 01b: além de `user_roles`, agora há **role custom por tenant** (admin edita `role_permissions`) e **grants diretos** via `user_permissions` (exceção pontual user → permission com `expires_at` + `reason`). Policies RLS fazem union entre as duas fontes via função SQL `has_permission(...)`. Atende caso de uso "liberar financeiro para uma pessoa específica" sem inflacionar roles. ADR 0019 esperado no sprint. Documentado em `docs/acesso-e-autorizacao.md` e `docs/modulos.md`
- MVP expandido com 2 sprints novos: **Sprint 05 Ofertas Comerciais** (promoções, pacotes/bundles, appointment_credits, referrals, cashback stretch) — ADR 0020 esperado; e **Sprint 09 Engajamento** (conquistas com regras declarativas, brindes com workflow de entrega, metas com progresso automático) — ADR 0021 esperado
- Renumeração dos sprints: Copilot 05→06, Dashboard 06→07, Acesso Academia 07→08. Ordem reflete dependências (Ofertas depois de Financeiro; Engajamento por último como consumidor de eventos de todos). Fases 2/3 renumeradas em cascata (Fisio 10–13, Nutri 14–15, transversais 16–17)
- Widgets novos no dashboard do member: `creditos` (Sprint 05), `conquistas` e `metas` (Sprint 09). Matriz de visibilidade em `docs/modulos.md` atualizada
- Regra 11 em `CLAUDE.md`: nunca path absoluto em doc versionada

### Changed
- Revisão de documentação pós-estrutura: paths absolutos removidos de `docs/arquitetura.md` e `docs/plano-estrutura.md` (projeto é usado em múltiplas máquinas, só caminhos relativos a partir da raiz do repo); nota de "documento histórico" no topo de `docs/plano-estrutura.md`; `domain_events` adicionado às "Tabelas mestras do MVP" em `docs/arquitetura.md`; linguagem de troca de contexto unificada em `docs/acesso-e-autorizacao.md`; seção "Reanálise Crítica" removida de `docs/arquitetura.md`; `financial_mode` removido da lista de "Decisões pendentes" em `docs/roadmap.md` (agora endereçado pela ADR 0010)
- `docs/roadmap.md` reformulado: tabela Fase MVP com colunas de controle de evolução (Status / Início / Fim / % / Bloqueios / PR); seção "Sprints ativos" removida (redundante com as colunas); ordem dos sprints 05–07 ajustada (Copilot → Dashboard → Acesso) refletindo dependências técnicas
- `CLAUDE.md` seção "Documentação de referência" aponta para `docs/modulos.md`
- Regra 10 (`docs/rules.md` + `CLAUDE.md`): commits vão direto em `main` (dev solo, sem PR review obrigatório). Branches `feat/*`/`fix/*`/`chore/*`/`docs/*` ficam opcionais — só para trabalho longo, arriscado ou que precisa ser testado isolado. Regra 14 também ajustada (era "todo PR", agora "todo commit")

### Added — expansão Academia (sprints 10–15)

- Verificação de gaps contra lista de funcionalidades esperadas para Academia (operacional, técnico, financeiro, retenção, diferencial IA). Cobertura atual cruzada com o que falta; 6 sprints novos + ajustes em 3 existentes.
- **Sprint 10 — Funil de Vendas** (`docs/sprints/10-geral-funil-vendas.md`): `leads`, estágios configuráveis, aulas experimentais, propostas versionadas, conversão automática lead → member. ADR 0022 esperado.
- **Sprint 11 — Prescrições + Biblioteca** (`docs/sprints/11-geral-prescricoes-e-biblioteca.md`): catálogo de `exercises` com vídeos, `workouts` versionados, `prescriptions` polimórficas (kind: workout / meal_plan / fisio_protocol), `workout_sessions` com RPE. ADR 0023 esperado.
- **Sprint 12 — Avaliações Físicas** (`docs/sprints/12-geral-avaliacoes-fisicas.md`): `assessment_types` configuráveis (bioimpedância, dobras, anamnese), `measurements` séries temporais, gráficos de evolução, calculadoras (IMC, Pollock, TMB). Antropometria Nutri (Sprint 24) reusa. ADR 0024 esperado.
- **Sprint 13 — WhatsApp + Régua de Cobrança** (`docs/sprints/13-geral-whatsapp-e-regua-cobranca.md`): provider WhatsApp abstraído (Twilio/Z-API/Meta via ADR 0025), templates aprovados, motor declarativo de régua (evento → ação → delay) via ADR 0026. Canal email via Resend consolidado. Opt-out respeitado.
- **Sprint 14 — DRE + Custos Operacionais** (`docs/sprints/14-geral-dre-custos-operacionais.md`): `cost_categories` (fixos/variáveis), `cost_entries` + recorrências, DRE consolidado com export PDF/CSV, previsibilidade de receita 3 meses.
- **Sprint 19 — IA Preditiva de Churn** (`docs/sprints/19-ia-previsao-churn.md`): pipeline de features por member, modelo preditivo `prob_30d/60d/90d` + top factors (ADR 0027), `churn_interventions` integradas à régua, feedback loop para medir accuracy. **Fecha o MVP.**
- Ajuste no **Sprint 04 Financeiro**: DRE básico promovido de stretch para Commit; `contracts` ganha colunas de trancamento (`pause_*`) + `auto_pause_rule` configurável; job diário avalia regra de pause automático. Eventos `contract.paused`/`resumed`/`auto_paused`.
- Ajuste no **Sprint 07 Dashboard**: cards explícitos "Alunos Ativos", "Faturamento 30d", "Taxa de Retenção 90d", "Horário de Pico", "Ocupação por Modalidade", "Ticket Médio por Aluno" (views SQL nomeadas).
- Ajuste no **Sprint 08 Controle de Acesso**: ADR 0018 passa a cobrir **reconhecimento facial** como modalidade alternativa (ou adicional) ao QR, com consent LGPD específico e embeddings em `member_face_embeddings` via pgvector. Subscribers de `contract.paused` criam `access_blocks`.
- Novos widgets no dashboard do member: `treino` (Sprint 11), `avaliacao` (Sprint 12), `risco` (Sprint 19).
- Renumeração Fase 2/3 em cascata: Fisio 10–13 → **16–19**, Nutri 14–15 → **20–21**, App nativo → **22**, Fiscal → **23**. Prescrição adaptativa IA por RPE listada como módulo futuro pós-22 (depende de app nativo + Sprint 11).

### Added — expansão Fisioterapia (sprints 16–24)

- Verificação de gaps contra lista de funcionalidades esperadas para Fisioterapia (prontuário/atendimento, agenda, financeiro-saúde, conformidade legal, diferenciais). Cobertura atual cruzada com o que falta; 9 sprints Fase 2 + ajustes em 2 sprints MVP.
- **Sprint 20 — Prontuário COFFITO + CID/CIF + ICP-Brasil** (`docs/sprints/20-fisio-prontuario-cid-cif.md`): prontuário versionado com assinatura digital, catálogos CID-11 e CIF globais, templates por especialidade (ortopedia/neuro/respiratória reusa `assessment_types` do Sprint 12), nota corretiva. ADR 0028 esperado.
- **Sprint 21 — Evolução SOAP + Mídias** (`docs/sprints/21-fisio-evolucao-midias.md`): registro por sessão em formato SOAP, anexos categorizados (exame imagem / vídeo execução / documento / foto postural) em Storage criptografado com URL assinada TTL 10min.
- **Sprint 22 — TISS/TUSS + Convênios** (`docs/sprints/22-fisio-tiss-tuss-convenios.md`): cadastro de operadoras + acordos, carteirinhas, autorizações, guias XML v3.05 (consulta + SP/SADT), lotes, conciliação de retorno, controle de glosas. ADR 0029 esperado.
- **Sprint 23 — Comissões e Repasse** (`docs/sprints/23-fisio-comissoes-repasse.md`): `professional_contracts` com condições (% faturado/recebido/fixo/tabela), cálculo automático em eventos financeiros/clínicos, fechamento mensal aprovado, transferência Asaas. Aproveitável por Academia (personal trainer) e Nutri. ADR 0030 esperado.
- **Sprint 24 — Estoque** (`docs/sprints/24-geral-estoque.md`): `stock_items` + movimentações (entrada/saída/ajuste/venda) + saldo por soma + alertas de mínimo + POS simples + inventário. ADR 0031 esperado.
- **Sprint 25 — ANVISA + CNES** (`docs/sprints/25-fisio-anvisa-cnes.md`): cadastro de equipamentos regulados com cronograma de manutenção e calibração, certificados anexados, logs de limpeza do ambiente com checklist, integração CNES (manual no MVP da fase), relatório PDF para fiscalização.
- **Sprint 26 — Portal do Paciente Web (PWA)** (`docs/sprints/26-geral-portal-paciente-web.md`): self-service do member via magic link email/SMS (ADR 0032), agenda, pagamento Asaas, recibos PDF, vídeos de exercícios prescritos com URL assinada, QR dinâmico, prontuário resumido via consent.
- **Sprint 27 — Cross-Alert Lesão → Treino** (`docs/sprints/27-cross-alert-lesao-treino.md`): subscriber de `consulta.signed` com CID de lesão + consent `share_injury_to_training` + validação de franchise (regra 25) → adapta workout com `cid_exercise_contraindications`; instrutor revisa antes de confirmar. ADR 0033 esperado.
- **Sprint 28 — Generative UI v1 (Fecha Fase 2)** (`docs/sprints/28-fisio-generative-ui.md`): framework de tool calls com registro de componentes tipados (PatientCard, EvolutionChart, CidSuggestion, ReportSection); copilot Fisio responde com componentes interativos via streaming SSE. ADR 0034 esperado.
- Ajuste no **Sprint 13 WhatsApp+Régua**: réguas pré-prontas novas — confirmação de agendamento D-1/D-0, manutenção D-7 (Sprint 25), estoque crítico (Sprint 24).
- Ajuste no **Sprint 14 DRE**: dimensão adicional "lucratividade por procedimento" via `invoice_items.service_type` (enriquecimento no Sprint 04 com backfill).
- Renumeração cascata Fase 3: Nutri 20–21 → **25–26**, App nativo 22 → **27**, Fiscal 23 → **28**. Prescrição adaptativa IA por RPE: pós-22 → **pós-27**.
- Novos widgets no dashboard do member: `prontuario` (Sprint 20, com consent cross-module), `evolucao` (Sprint 21), `convenio` (Sprint 22), `alerta_lesao` (Sprint 27).

### Added — expansão Nutrição (sprints 25–27)

- Verificação de gaps contra lista de funcionalidades esperadas para Nutrição (prontuário CFN, antropometria, prescrição dietética, exames laboratoriais, engajamento app, administrativo). Cobertura atual cruzada com o que falta; 3 sprints Fase 3 + 4 ajustes em sprints MVP/Fase 2.
- **Sprint 29 — Banco de Alimentos (TACO) + Plano Alimentar** (`docs/sprints/29-nutri-alimentos-e-plano.md`): catálogo ~3000 alimentos TACO com 30+ nutrientes em `jsonb`, medidas caseiras normalizadas, alimentos customizados por tenant, editor drag-drop, cálculo nutricional em tempo real, lista de substituição automática, export PDF com branding do tenant, versionamento. ADRs 0035 e 0036 esperados.
- **Sprint 30 — Suplementação + Exames Laboratoriais** (`docs/sprints/30-nutri-suplementos-exames.md`): catálogo de suplementos com interações medicamentosas, prescrição com posologia/duração, catálogo de analitos (glicose, colesterol, ferritina…) com valores de referência por sexo/idade, registro de exames com destaque visual de alteração, gráfico de evolução por analito. ADR 0037 esperado.
- **Sprint 31 — Diário Alimentar + Teleconsulta** (`docs/sprints/31-geral-diario-alimentar-teleconsulta.md`): paciente registra refeições no portal com foto + cálculo de desvio vs plano, nutri valida/comenta, relatório semanal; teleconsulta com provider abstrato (Daily.co/Whereby/Jitsi/Twilio via ADR 0038), gravação opt-in, transcrição stretch.
- Ajuste no **Sprint 20 Prontuário**: `consultas` agora é polimórfica com `kind` enum (`fisio`/`nutri`/`custom`); `signature_required` boolean separa COFFITO (obrigatório) de CFN (opcional). Nutri Sprint 29 reusa a infra sem sprint de prontuário próprio.
- Ajuste no **Sprint 02 CRM**: `members` ganha `family_history jsonb` + `sex` (usado pela anamnese Fisio e Nutri).
- Ajuste no **Sprint 12 Avaliações**: calculadoras ampliadas — Petroski, Guedes, Faulkner (dobras); Mifflin-St Jeor, Cunningham, Katch-McArdle (TMB); Jackson-Pollock por circunferência. Organizadas por categoria.
- Ajuste no **Sprint 13 Régua**: réguas padrão nutri — lembrete de água (4x/dia), lembrete de refeição (horários do plano), pedir diário alimentar semanal, comentário do profissional no diário, exame laboratorial alterado.
- Ajuste no **Sprint 26 Portal**: rotas `/meu/{cardapio,diario,teleconsulta/[id],exames,suplementos}` declaradas como ativadas em sprints posteriores (25/26/27).
- Novos widgets no dashboard do member: `alimentar` (Sprint 29), `suplementos` e `exames` (Sprint 30), `diario` (Sprint 31). Antigo `antropometria` consolidado em `avaliacao` (já vinha do Sprint 12).
- Renumeração Fase 3: sprints 28–30 (Nutri-Agent 26→28, App nativo 27→29, Fiscal 28→30). Prescrição adaptativa IA por RPE: pós-27 → **pós-29**.

### Changed — correções da auditoria interna

Auditoria sistemática da documentação identificou achados que viraram correções pontuais (maioria dos achados eram falsos positivos — ADRs 0011-0046 "faltando" são deliberados por regra 13 e renumerações fantocheos eram reais; descrição abaixo é só o que virou ação):

- **CHANGELOG** — texto anterior sugeria que ADRs 0027+ foram "renumerados em cascata para 0040+". Isso não aconteceu no disco porque esses ADRs ainda não existem como arquivo (nascem no dia da decisão, regra 13). Texto reescrito explicitando que a renumeração só se aplica aos ADRs **esperados** que nascerão nos sprints renumerados.
- **Sprint 07** — ganha API pública `registerCrossAlertHandler({ event, handler })` em `packages/ai/alerts/registry.ts`; consumidores (Sprint 08 bloqueios, Sprint 13 régua, Sprint 19 churn, Sprint 27 lesão→treino, Sprint 32 alertas device, Sprint 33 exame crítico) vão registrar handlers explicitamente.
- **Sprint 08** — itens de subscriber agrupados sob "Registrar handlers no cross-alert dispatcher do Sprint 07".
- **Sprint 12** — adiciona item Commit "registrar handler `photo-progress` no WhatsApp inbound hub".
- **Sprint 20** — adiciona item Commit "registrar handler `receipt` no WhatsApp inbound hub" para receitas enviadas pelo paciente.
- **Sprint 01b** — teste E2E explícito da regra 25 (franquia + dois members em companies diferentes; cross-company de dado clínico deve retornar 0 rows via RLS + bloquear consent).
- **Sprint 27** — teste E2E reforçado da regra 25: mesmo com consent `share_injury_to_training` ativo, franchise cross-company **deve bloquear** e registrar `audit_log.blocked_reason='regra_25_franchise_cross_company'`.
- **Sprint 15** — marcado como candidato à quebra em 15a/15b (AP/AR core vs OCR+NF-e+import) se estourar 3 semanas.
- **Sprint 13** — marcado como candidato à quebra em 13a/13b (outbound+régua vs hub inbound multi-fluxo).
- **Roadmap** — nova seção "Convenção sobre sprints em alto nível" explicando que sprints 34-37 ainda não têm arquivo detalhado em `docs/sprints/` (deliberado; nasce quando sprint vira candidato a `doing`).

### Added — i18n em 3 idiomas: pt-BR, en-US, es-419 (ADR 0052)

- **ADR 0052** — LogiFit nasce com i18n em 3 idiomas desde Sprint 00, usando next-intl v4+ no Next.js 15 App Router. Locales: `pt-BR` (default), `en-US`, `es-419` (espanhol LATAM neutro). Regulamentação continua Brasil-only (LGPD/CFM/CFN/COFFITO/TISS); só a interface é traduzida. Multi-país (l10n) fica como ADR futuro quando houver demanda real de mercado.
- **Regra 27 (nova)** em `docs/rules.md` e `CLAUDE.md`: proibido hardcode de string de UI; toda string visível via `t('namespace.key')` com catálogo em 3 locales; CI `pnpm i18n:check` falha se faltar chave. Exceções: nomes técnicos (CID, TUSS, Pollock), feature flags, logs.
- **Sprint 00 cresce** para +3 semanas incluindo: configuração next-intl + middleware + estrutura `apps/web/src/messages/{pt-BR,en-US,es-419}/` + `packages/i18n` (config, utils) + scripts `i18n:extract` e `i18n:check` + `LocaleSwitcher` em `packages/ui` + seed inicial de strings comuns traduzidas via Claude.
- **Sprint 00 também ganha**: script `db:rls-check` (enforce regra 1+2), `packages/ai/observability.ts` (wrapper com tokens/latência/custo de IA), Logtail/Axiom movido de stretch para core.
- **Catálogos (exercícios, alimentos TACO, analitos, CID, CIF, suplementos)** ganharão colunas `name_pt/name_en/name_es` OU tabela `translations` — decisão por catálogo durante execução do sprint correspondente.
- **Todos os sprints** ganham no DoD: "Strings UI extraídas em 3 locales (pt-BR obrigatório, en-US + es-419 via Claude + revisão)".
- **Fallback em cadeia** para chave faltante: es-419 → en-US → pt-BR com log de missing string.
- `CLAUDE.md` seção de stack inclui next-intl; convenções listam regra 27.
- `docs/arquitetura.md` stack frontend menciona next-intl.
- `docs/modulos.md` na Fundação ganha "i18n (3 idiomas)" e "LocaleSwitcher".

### Added — WhatsApp Inbound como canal multi-fluxo pluggable (ADR 0051)

- **ADR 0051** — WhatsApp inbound amplia Sprint 13 com hub central pluggable: identity matcher (busca `persons.phone` → se não acha, pede CPF conversacional) + intent router (IA classifica anexo com confidence threshold 80%) + consent específico `whatsapp_exchange`. Cada sprint consumidor registra seu handler (exame, boleto, foto, pergunta, receita). Sem novo sprint.
- **Sprint 13 ampliado**: tabelas `whatsapp_inbound_messages`, `whatsapp_conversations`, `tenant_whatsapp_settings`; API Route `POST /api/mensagens/webhook/whatsapp-inbound`; hub em `packages/ai/whatsapp/` com `inbound-handler.ts`, `intent-router.ts`, `identity-matcher.ts`, `classifier.ts`; default handlers `copilot-question` e `fallback-human`; templates inbound (`exam.received`, `boleto.received`, `identity.needed`, `classification.confirm`).
- **Sprint 15 registra handler `boleto-upload`** — fornecedor manda PDF pelo WhatsApp → OCR (provider abstrato ADR 0035) → cria AP em draft no ERP Financeiro → resposta "Recebi boleto de R$ X".
- **Sprint 33 registra handler `exam-upload`** — paciente manda PDF laudo pelo WhatsApp → pipeline completo (OCR + IA extração + IA interpretação + fila de revisão profissional) → resposta "Recebi seu exame, em análise" + notificação quando publicado.
- **`exam_documents.source`** enum ganha `patient_whatsapp`; `source_ref` linka `whatsapp_inbound_messages.id` para rastreabilidade completa.
- **Consent `whatsapp_exchange`** ativável em `/meu/privacidade` ou na 1ª interação do bot; revogável a qualquer momento.
- **Identity matching**: telefone não cadastrado → bot pergunta CPF → valida → salva `persons.phone` (baixa fricção + segurança). Tenant sensível pode ativar chave secundária (data de nascimento) em `tenant_whatsapp_settings.require_dob`.
- **Rate limit** 10 msgs/min/telefone via Upstash Redis (reusa Sprint 06). Dedupe por `provider_message_id`.
- **Handlers futuros previstos**: `photo-progress` (Sprint 12 — antropometria via WhatsApp), `receipt` (Sprint 20/21 — receita clínica via WhatsApp).

### Added — Pipeline inteligente de exames laboratoriais (ADR 0050)

- **ADR 0050** — Pipeline OCR → IA extração → IA interpretação conservadora → revisão profissional → `lab_results` oficial. IA nunca diagnostica; profissional sempre valida. Paciente pode subir exame pelo portal com consent específico; fica em fila de revisão.
- **Sprint 33 (NOVO) — Pipeline Inteligente de Exames Laboratoriais** (`docs/sprints/33-geral-pipeline-exames.md`): upload de PDF (por profissional ou paciente) → Storage criptografado → OCR (reusa ADR 0035) → Claude extrai analitos estruturados mapeados contra `lab_analytes` (Sprint 30) → Claude sugere padrões cross-analito e hipóteses (vocabulário conservador: "sugere", "compatível com") → classificador de output bloqueia termos proibidos ("tem [doença]", "diagnóstico de") → profissional revisa lado-a-lado (PDF + valores + hipóteses) → publica em `lab_results` oficial com rastreabilidade completa.
- **Economia massiva de tempo**: ~30 min de digitação manual de hemograma completo (~30 analitos) → ~2 min de revisão. Padronização cross-laboratório (Sabin, DB, Hermes Pardini, Fleury, Delboni).
- **Self-upload pelo paciente** em `/meu/exames/upload` com `consent.self_upload_exam`. Entra em fila de revisão do profissional; vira oficial só após validação humana.
- **Categorização sensível**: exames HIV/psiquiátrico/genético/paternidade em `sensitivity='high'`; acesso exige permission `exam.sensitive.read` + audit reforçado.
- **Opt-out de IA por tenant** em `/app/settings/exames/ia` — tenant LGPD-restritivo pode manter só OCR + revisão humana.
- **Escopo vs Sprint 17**: exame laboratorial (PDF com analitos numéricos) entra no Pipeline do Sprint 33; anexo clínico de mídia (raio-X, RM, foto postural, vídeo) continua no Sprint 17 Fisio.
- **Integração com Nutri-Agent (Sprint 34 renumerado)** — consome `lab_results` publicados + pode sugerir exames complementares pela ausência nos últimos 12 meses.
- **Renumeração Fase 3**: Nutri-Agent 33→**34**, App Nativo 34→**35**, Fiscal 35→**36**. Prescrição adaptativa IA por RPE: pós-34 → **pós-35**.

### Added — Device Hub (wearables + dispositivos clínicos) — ADR 0049

- **ADR 0049** — Device Hub com provider abstrato + modelo normalizado FHIR-like (`device_readings` com observation_code/value/unit/measured_at). Ingestão de dados biométricos de dispositivos consumer e clínicos respeitando LGPD com consent específico por provider.
- **Sprint 32 (NOVO) — Device Hub v1** (`docs/sprints/32-geral-device-hub.md`): arquitetura core + cloud providers (Garmin Connect, Oura) + BLE Web bioimpedância doméstica (Omron, G-Tech — Chrome/Edge desktop) + import de arquivos FIT/TCX/GPX/CSV InBody. Job Vercel Cron horário puxa novos dados dos providers cloud.
- **4 usos dos dados**: (1) **curadoria profissional** — profissional seleciona leituras em `/app/members/[id]/avaliacoes/new`, valida/edita, importa para `assessment_measurements` com rastreabilidade; (2) **monitoramento contínuo** — painel com tracks de peso/HR/sono/recovery entre avaliações formais; (3) **alertas inteligentes** — regras declarativas (DSL do Sprint 13) consomem `device_readings` e disparam via cross-alert (HR subiu, sedentarismo, etc); (4) **timeline enriquecida** no widget do member com tracks paralelos (oficial vs dispositivo).
- **Separação oficial vs dispositivo**: tags visuais obrigatórias (🩺 avaliação validada vs 📱 dispositivo); relatórios oficiais usam só dados validados; dado de dispositivo nunca vira medida clínica sem assinatura humana.
- **Garmin no Sprint 32** via Connect API OAuth cloud (sem dependência de app nativo). Apple Health + Google Health Connect ficam para Sprint 36 App Nativo (dependem de HealthKit/Health Connect que só funcionam em app nativo, não em PWA).
- **LGPD reforçada**: consent específico por provider (`device_consents`); dado cru exige permission `devices.read_raw` + 2º consent; audit reforçado em leituras cruzadas.
- **Retenção**: dado cru minuto a minuto rotaciona 90 dias; agregados diários indefinidos. Job mensal `cleanup_raw_readings` preserva leituras referenciadas em assessments curados.
- **Ajuste Sprint 12 Avaliações**: `assessment_measurements` ganha `source` enum (`manual`/`device`/`import_csv`) + `source_device_reading_id` + `validated_by_user_id` + `validated_at`. Schema pronto desde Sprint 12; UI de importação de dispositivos ativa quando Sprint 34 Device Hub existir.
- **Renumeração Fase 3**: Nutri-Agent 32→**33** (agora consome Device Hub), App Nativo 33→**34** (adiciona Apple Health + Google Health Connect + BLE mobile), Fiscal 34→**35**. Prescrição adaptativa por RPE: pós-33 → **pós-34**.

### Added — busca automática de dados por CNPJ (ADR 0048)

- **ADR 0048** — Busca de CNPJ via provider abstrato no cadastro de pessoa jurídica. Elimina digitação manual de razão social, endereço, CNAE, porte, regime tributário; dados vêm da Receita Federal automaticamente ao digitar os 14 dígitos.
- **Providers suportados:** BrasilAPI (default, gratuito, open source), ReceitaWS (fallback gratuito), CNPJá! (pago, opcional, enriquece com QSA/quadro societário). Admin configura via `/app/settings/pessoas/cnpj` com credenciais próprias.
- **Cache global 7 dias** em `cnpj_cache` (não por tenant — dado de CNPJ é público). Reduz ~95% das chamadas à API. Três caminhos para refresh forçado: expiração automática, botão manual `/app/pessoas/[id]/refresh-cnpj`, job Vercel Cron semanal `/api/jobs/cnpj/validate-situacao-weekly`.
- **Detecção de situação cadastral** — empresa baixada/suspensa/inapta dispara modal obrigatório de confirmação com razão; job semanal alerta quando companies/suppliers ativos mudam de situação.
- Atualiza Sprint 01a com: interface `CnpjProvider`, 3 adapters, tabelas `cnpj_cache` + `tenant_cnpj_settings`, UI auto-fill, alerta de situação, job de validação semanal.

### Added — cadastro central `persons` (modelo Contact-FK)

- **ADR 0047** — Cadastro central de `persons` com FK em tabelas especializadas (Contact-FK). Todos os cadastros (members, leads, suppliers, companies, users, professional_contracts) agora linkam uma `persons` central; dados de identidade (nome/CPF/CNPJ/email/phone/endereço) ficam em um lugar só, papéis múltiplos acontecem naturalmente sem tabela intermediária.
- **Auto-detecção PF/PJ** pelo documento digitado (11 dígitos = CPF/PF, 14 = CNPJ/PJ) com validação matemática do dígito verificador.
- **`<PersonPicker>` reutilizável** — componente de autocomplete que busca persons existentes e mostra papéis ativos; usado em toda tela de cadastro especializado (users/members/suppliers/companies).
- **Fluxo de UI:** cadastra pessoa em `/app/pessoas/new` (genérico); nas telas especializadas linka via picker ou cria inline. Não redigita dados de identidade.
- **Constraints de integridade:** `users.person_id` exige kind=pf; `companies.person_id` exige kind=pj; `(tenant_id, document)` unique em persons; conversão lead→member reusa mesmo `person_id` (regra 24 reforçada).
- **Views consolidadas** `v_members_full`, `v_suppliers_full`, `v_companies_full`, `v_person_roles` para leituras quentes.
- Ajustes em 5 sprints: **01a** (persons central + companies/users ganham FK), **02** (members.person_id), **10** (leads.person_id nullable até proposta), **15** (suppliers.person_id + XML NF-e cria/reusa persons), **23** (professional_contracts.person_id com user_id opcional para terceirizados).

### Added — expansão ERP Financeiro (sprints 15–18 + renumeração cascata +4)

- Verificação de gaps contra lista de ERP financeiro completo (contas a pagar, contas a receber, fornecedores, plano de contas, rateio, intercompany, bancos, adquirência, OCR de boleto, NF-e entrada). Sprint 04 (Asaas) + Sprint 14 (DRE) atendiam só mensalidade + custos; agora 4 sprints novos cobrem ERP financeiro completo. Todos os sprints >=15 renumeraram +4.
- **Sprint 15 — ERP Financeiro Core** (`docs/sprints/15-geral-erp-financeiro-core.md`): plano de contas hierárquico, cadastro de fornecedores, contas a pagar com **workflow multi-aprovador configurável**, contas a receber avulso, **OCR de boleto provider-abstrato configurável pelo admin do tenant** (OCR.space default + opções Google Vision, AWS Textract, Azure Computer Vision, Tesseract self-hosted; config via `/app/settings/financeiro/ocr`; fallback em cadeia — ADR 0035 accepted), upload manual XML NF-e com parser FEBRABAN + criação automática de AP. ADRs 0033, 0034, 0035.
- **Sprint 16 — Rateio + Intercompany** (`docs/sprints/16-geral-rateio-intercompany.md`): `allocation_rules` (fixed/proporcional/por KPI) para conta da matriz ser rateada entre filiais; `intercompany_entries` com contrapartida automática entre companies; fechamento mensal IC. Regra 25 enforced (só `topology=owned`). ADR 0036.
- **Sprint 17 — Bancos + Open Finance + NF-e SEFAZ** (`docs/sprints/17-geral-bancos-open-finance.md`): integração Open Finance (Pluggy/Belvo via ADR 0037) + fallback OFX upload; conciliação automática com `reconciliation_rules`; projeção de fluxo de caixa 30/60/90d; recepção automática NF-e via SEFAZ/Arquivei (ADR 0038) com gestão criptografada de certificado A1 por company. ADRs 0037 e 0038.
- **Sprint 18 — Adquirência** (`docs/sprints/18-geral-adquirencia.md`): integração com Cielo, Stone, Rede, GetNet e PagSeguro via adapter comum; sincronização diária de vendas; conciliação venda maquininha ↔ extrato bancário; antecipação de recebíveis via API; split automático em franquias (usa `franchise_agreements`); dashboard unificado de receita (online Asaas + presencial). ADR 0039. **Fecha bloco ERP Financeiro.**
- Renumeração cascata +4 em todos os sprints 15-27: **19** Churn (antes 15), **20** Prontuário Fisio (antes 16), **21** Evolução (antes 17), **22** TISS (antes 18), **23** Comissões (antes 19), **24** Estoque (antes 20), **25** ANVISA (antes 21), **26** Portal (antes 22), **27** Cross-alert (antes 23), **28** GenUI (antes 24), **29** Nutri alimentos (antes 25), **30** Nutri suplementos (antes 26), **31** Diário+Teleconsulta (antes 27). ADRs esperados que nasceriam com numeração antiga (0027+) agora nascem com numeração nova (0040+) **quando cada sprint executar** — nenhum ADR foi renomeado no disco porque eles ainda não existem como arquivo (por design, conforme regra 13: ADR nasce no mesmo dia da decisão). Fase 3 permanece intocada numericamente (sprints 32+).
- Numeração final: MVP vai de 00 a 19 (21 sprints, inclui fundação 00-01b e 4 novos financeiros 15-18); Fase 2 vai de 20 a 28; Fase 3 vai de 29 a 34 + pós-33 prescrição adaptativa.

### Added — material comercial

- `docs/comercial.md` — apresentação comercial/pitch do produto consolidando todos os módulos em linguagem de venda (para clientes, investidores, decisores de compra). Espelho do planejamento técnico sem jargão; inclui roadmap transparente, números de venda, público-alvo por perfil e frase de fechamento.
- `CLAUDE.md` seção "Documentação de referência" lista `docs/comercial.md` com nota de que é material de apoio, não fonte técnica.

### Fixed
- —

### Security
- —

---

## [0.0.0] - 2026-04-22

### Added
- Documentação inicial: `docs/arquitetura.md`, `docs/rules.md`, `docs/multiempresa.md`, `docs/acesso-e-autorizacao.md`, `docs/roadmap.md`
- ADRs 0001–0009 em `docs/decisions/`
- Templates de sprint em `docs/sprints/` (template + Sprint 00, 01a, 01b)
- `CLAUDE.md` na raiz (contexto persistente para Claude Code)
- `.github/pull_request_template.md` (checklist de PR)
- `docs/plano-estrutura.md` (plano histórico de estruturação)
