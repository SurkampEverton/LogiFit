---
slug: portal-member-magic-link-auth
status: proposed
date: 2026-05-17
---

# ADR 0088 — Autenticação do paciente (portal `/meu/*`) via magic link

## Contexto

Sprint 26 entrega o portal do paciente (`/meu/*` + PWA) como o primeiro canal voltado ao usuário final (member/aluno/paciente), em paralelo ao backoffice `/app/*` usado por staff. Decisões fundamentais que esta ADR fecha:

1. **Mecanismo de auth** — magic link / OTP SMS / senha / SSO Google · Apple — qual usar pra MVP?
2. **Separação do operador** — como evitar que cookie de staff (`/app/*`) seja aceito em `/meu/*` e vice-versa?
3. **Sessão (TTL + rotação)** — quanto tempo o paciente fica logado? Refresh rotativo?
4. **MFA** — paciente precisa de MFA igual o staff (regra 43)?
5. **Rate limit + anti-enumeration** — proteções básicas contra brute-force e enumeração de emails.
6. **JWT vs cookie** — guardar token de sessão como?

## Decisão

### 1. Magic link por email (MVP); SMS adiado pra Sprint 26b

`requestMagicLink({ email, tenantSlug })` gera token random 256-bit, persiste **apenas** o `SHA-256(token)` em `member_auth_tokens` com `expires_at = now() + interval '15 minutes'` e envia o token plano via email (AWS SES, dependência aprovada [ADR 0091](0091-self-host-total-oracle-sp.md)). Link é `https://{tenantSlug}.logifit.com.br/meu/login/verify?t=<token>`.

**Por quê magic link:**
- Sem senha = sem hash de senha = sem ataque de credenciais reusadas (paciente quase sempre reusa senha)
- UX: usuário esquece senha → forgot password é um magic link forçado → vamos direto pra esse fluxo
- Tem auditoria nativa (cada login é um token novo)

**Por quê não SMS no MVP:** custo (~R$0,08/SMS via Twilio BR vs ~R$0,0001/email AWS SES) + dependência adicional. SMS volta em Sprint 26b como segundo canal opcional (paciente sem email ou com email errado).

**Por quê não senha:** mais código + risco de hash desatualizado + UX de troca de senha pesa. LogiFit prefere magic link como única identidade do member; senha eventualmente vira opcional como conveniência (Sprint 27+).

**Por quê não SSO Google/Apple no MVP:** dependência de OAuth providers externos + termos legais variáveis + UX de "criar conta com Google" pré-condiciona email do Google (Microsoft Outlook, Yahoo, etc. ficam fora). Magic link é universal. SSO entra em backlog Sprint 28+ baseado em demanda real.

### 2. Cookie próprio `lf_member_session` com **path=/meu**

Cookie httpOnly + Secure + SameSite=Lax + Path=/meu. **Não há overlap com cookie de staff** (`lf_session` em path=/app via BetterAuth/Lucia decidido em Sprint 01a) porque o `Path` do cookie é diferente — o browser nunca envia cookie do member em request pra `/app/*` e vice-versa.

`getMemberSession()` em `apps/web/app/lib/member-session.ts` valida:
- Cookie presente
- `SHA-256(cookie)` existe em `member_sessions.refresh_token_hash`
- `revoked_at IS NULL`
- `expires_at > now()`

Faz UPDATE fire-and-forget de `last_seen_at` pra UI de "dispositivos conectados" (`/meu/perfil`).

**Separação operador vs member dura na camada Server Action**: `requireMemberSession()` em rotas `/meu/*` e `apps/web/app/api/meu/*` *apenas*; rotas `/app/*` chamam `requireStaffSession()` (BetterAuth/Lucia, Sprint 01a). Cross-talk é arquiteturalmente impossível porque os helpers não conhecem o outro.

### 3. TTL 30d + refresh estático (rotação adiada pra Sprint 26b)

Sessão expira em 30 dias. Sem rotação de refresh token MVP — paciente continua usando o mesmo refresh até logout / revoke / 30d. Stretch Sprint 26b: refresh rotativo single-use (compromise: cobertura UX vs complexidade de race condition em multi-tab).

**Multi-dispositivo nativo**: cada login gera nova row em `member_sessions`. Paciente vê em `/meu/perfil` cards "Chrome Windows · IP X.Y.Z" + botão "Encerrar". Trocar email NÃO força logout de outros devices (decisão consciente: paciente pode estar usando 3 devices).

### 4. **MFA não exigido** para paciente

Regra 43 (MFA obrigatório) lista `medico/fisio/nutri/personal/enfermeiro/tenant_owner/dpo/super_admin`. Member/paciente **não está na lista**. Isso é proposital:

- MFA TOTP exige app autenticador que paciente médio (>60 anos, baixa familiaridade tech) não usa
- MFA SMS reintroduz custo + dependência rejeitada acima
- Magic link já é "MFA fraco" (precisa do email)

**Exceção**: tenant pode escalar via `tenant_settings.member_mfa_required=true` (Sprint 26c add) — clínica de saúde mental, por exemplo, que quer reforçar.

### 5. Rate limit + anti-enumeration

Anti-enumeration: `requestMagicLink` **sempre** retorna `{ ok: true, sent: bool }` — mesmo se email não cadastrado, mesmo se rate limit excedido. Browser não consegue distinguir.

Rate limit (lib pura `shouldRateLimit`, regra 36):
- Max **5 requests / 15 minutos** por `member_id`
- Throttle mínimo **60s** entre requests consecutivos do mesmo member
- Sprint 26c: adiciona segundo limit Redis por `(IP, tenant_id)` via `packages/security/rate-limits.ts`

Lockout após 5 falhas de verify em 15min vira `system_alerts` (regra 33 wrapAction) e bloqueia novos magic links por 30min (Sprint 26c — MVP só registra).

### 6. JWT NÃO usado pra session — cookie opaco é suficiente

Sessão usa **cookie opaco** (256-bit random com SHA-256 server-side), não JWT. Razões:

- JWT precisaria validação criptográfica em **cada** request, vs lookup em índice único (`mat_token_hash_uq`) que é O(log n) e cache-amigável
- Revogação de JWT é uma dor (precisa blacklist) — cookie opaco é trivial (UPDATE revoked_at)
- JWT vaza claims em texto → cookie opaco vaza nada

Server lê `app.member_id` + `app.tenant_id` via `withMemberContext()` antes de cada query (RLS regra 1).

## Esquema persistido

3 tabelas, todas em `packages/db/src/schema/portal-member.ts`:

```ts
member_auth_tokens (
  id, tenant_id, member_id,
  token_hash, channel ('email' | 'sms'),
  expires_at, used_at, request_ip, request_user_agent, consumed_ip,
  created_at
)
// uniqueIndex(token_hash); index(member_id desc); index(member_active where used IS NULL)

member_sessions (
  id, tenant_id, member_id,
  refresh_token_hash, expires_at,
  device_label, user_agent, created_ip,
  last_seen_at, last_seen_ip,
  revoked_at, revoked_reason,
  created_at
)
// uniqueIndex(refresh_token_hash); index(member_id desc last_seen_at)

member_consents (
  id, tenant_id, member_id,
  purpose ('marketing' | 'cross_module_share' | ...),
  granted bool, ripd_version, consent_text,
  granted_at, revoked_at, source_ip
)
// uniqueIndex(member_id, purpose where revoked_at IS NULL) — 1 ativo por purpose
```

RLS em `0045_portal_member_rls.sql`: SELECT por `(tenant_id, member_id)` via `current_setting('app.member_id')`; UPDATE só em campos não-imutáveis (`used_at`, `revoked_at`, `last_seen_at`).

## Consequências

✅ **Positivas:**
- UX simples (1 input email + 1 clique)
- Zero infra de senha (sem hash, sem reset, sem leak)
- Anti-enumeration nativo
- Audit nativo via member_auth_tokens append-friendly + member_sessions soft-revoke
- Compatível com PWA (cookie httpOnly funciona standalone)

⚠️ **Trade-offs aceitos:**
- Email deliverability é dependência crítica (AWS SES já aprovado [ADR 0091](0091-self-host-total-oracle-sp.md))
- Se paciente perde acesso ao email, perdeu acesso ao portal — Sprint 26c adiciona SMS como segundo canal + "fale com a recepção" como path manual fallback (recepção valida CPF + força create_session via admin)
- Magic link via QR em link no WhatsApp tem UX boa, mas pré-condiciona WhatsApp Sprint 13 (que está done) — Sprint 26b conecta os dois (régua "novo magic link via WhatsApp")
- Sem MFA: se atacante captura email pessoal do paciente, atacante entra. Decisão tomada conscientemente pela classe de risco (paciente vê dados próprios — dados clínicos sensíveis sim, mas não pode causar dano financeiro nem clínico — comparado a staff que pode causar ambos)

⚠️ **Decisões adiadas (Sprint 26b+):**
- SMS como segundo canal (Twilio BSP, depende sub-decisão ADR 0025 conclusão Sprint 13b)
- Rotação de refresh token (single-use rotation)
- MFA opcional via `tenant_settings.member_mfa_required`
- Rate limit Redis por IP (regra 36 dura)
- SSO Google/Apple opcional
- Deeplink universal (`logifit://meu/...`) pra app nativo Sprint 35

## Alternativas consideradas

| Opção | Rejeitada por |
|---|---|
| Senha + 2FA TOTP | UX hostil ao perfil paciente médio; suporte a reset = magic link de fato |
| OAuth Google/Apple SSO | Dependência externa + UX exclui Outlook/Yahoo/proton/email corporativo |
| SMS OTP MVP | Custo ~800× email + dependência adicional sem ROI claro pré-piloto |
| JWT como session | Revogação dolorida + claims em texto + sem benefício real (precisa lookup do mesmo jeito pra MFA recente/rate limit) |
| WebAuthn (passkey) | UX inconsistente em iOS antigo + Brazil paciente médio não tem device suportado |
| Lucia/BetterAuth direto | Acoplaria identidade member ao mesmo store que staff (ADR 0086 add a complicar) — separation of concerns prefere store distinto |

## Métricas a observar (pós-Sprint 26 piloto)

- **Taxa de conversão de magic link**: `(verify_success / request)` esperado >70% (mais baixo = problema deliverability ou UX do clique)
- **Tempo médio email → click**: esperado <2 minutos (>5min é red flag SES delay ou spam folder)
- **Sessões ativas por member**: distribuição (median 1.5? 2? maior = mais dispositivos) — direciona necessidade de rotation
- **Reclamações "perdi acesso"**: sinaliza necessidade de SMS / path manual
- **Tentativas de verify pós-expiração**: alta = TTL 15min pouco vs UX, considerar 30min

## Status

Proposed — promove pra **Accepted** quando Sprint 26 piloto em produção com >100 logins reais por 7 dias validar SES deliverability + UX conversão (alvo >70%).

## Referências

- [ADR 0091 — Self-host total Oracle SP](0091-self-host-total-oracle-sp.md) — AWS SES como única dep externa aprovada pra email
- [ADR 0073 — Postura segurança defesa em profundidade](0073-postura-seguranca-defesa-em-profundidade.md) — regra 43 MFA (excluir paciente conscientemente)
- [ADR 0077 — Passaporte cross-tenant paciente](0077-passaporte-paciente-vinculo-cross-tenant.md) — Sprint 26 portal estende o que Sprint 02 entregou
- [ADR 0054 — LGPD art. 11 dados saúde](0054-lgpd-art11-dados-saude-ripd-versionado.md) — `member_consents` purposes derivam daqui
- [Sprint 26 — Portal do paciente](../sprints/26-geral-portal-paciente-web.md)
- [regra 43 — MFA obrigatório](../rules.md#43-mfa-obrigatório)
- [regra 36 — rate limit Redis](../rules.md#36-rate-limit-redis)
