---
slug: release-strategy-app-stores-ota
status: proposed
date: 2026-05-18
---

# ADR 0046 — Release strategy do app nativo: App Store + Play Store + OTA via EAS Update

## Contexto

Sprint 35a entrega o backbone `mobile_app_versions` (versionamento global por plataforma com `min_required` + `sunset`) e `mobile_sessions` (refresh 90d + access 1h). ADR 0045 fixou Expo managed + React Native + TypeScript.

Falta decidir **como o binário chega no celular do usuário** e **como atualizamos código já instalado**.

Decisões fundamentais:

1. **Distribuição inicial**: App Store (iOS) + Play Store (Android) ou alternativas (TestFlight perpétuo / sideload Android)?
2. **Hotfix de JS sem passar por review**: OTA sim ou não? Provider?
3. **Forced update**: como bloquear app com versão obsoleta?
4. **Refresh token + access token**: vida útil e rotação?
5. **Push notification dispatcher**: rota servidor → APNs/FCM direto ou via Expo Push Service?
6. **CI/CD de builds**: EAS Build cloud, GitHub Actions self-hosted ou mix?

## Decisão

### 1. **Distribuição via App Store + Google Play (canais oficiais)**

**iOS:** App Store. **Android:** Google Play. Não há plano alternativo no MVP.

**Por quê** (rejeitadas TestFlight perpétuo / sideload):

- **Confiança institucional** — academia/clínica recomenda "baixa na App Store" pro paciente; canal oficial é vital pra B2B saúde
- **TestFlight é beta** — limite 90 dias por build + 10k testers + Apple proíbe uso em produção long-term
- **Sideload Android (.apk direto)** — Play Protect bloqueia install + UX ruim ("permitir fontes desconhecidas") + perde Play Integrity API (anti-fraude)
- **App Store Connect + Play Console** rastreiam crashes + analytics + reviews — observabilidade gratuita

**EAS Submit** automatiza upload:
- iOS: `eas submit -p ios` → TestFlight → review → produção (App Store Connect API)
- Android: `eas submit -p android` → Internal track → Closed beta → Open beta → Production (Play Developer API)

**Canais Play Store usados (rollout gradual):**
1. **Internal testing** — equipe LogiFit (fundador + DPO + early adopters convidados)
2. **Closed beta** — 50 tenants Early Access (Sprint 35c quando houver)
3. **Open beta** — pulado no MVP; vai direto pra produção via staged rollout
4. **Production staged rollout** — 5% → 20% → 50% → 100% em 7 dias

**Apple não tem staged rollout granular** como Play; usamos **Phased Release** (1% dia 1 → 100% dia 7) — automático.

### 2. **OTA via EAS Update** (não CodePush, não custom)

**EAS Update + branch policy:**

| Canal release | Branch EAS Update | App store version aceita |
|---|---|---|
| `production` | `production` | latest published |
| `staging` | `staging` | next pending build |
| `preview-{pr}` | `preview-{pr}` | dev internal builds |

Cada build (`expo-updates` lib embarcada) checa em boot:
1. GET `update.expo.app/<projectId>/<channel>/<platform>/<runtimeVersion>`
2. Se houver update compat → download bundle JS → swap on next launch

**Regras de quando OTA é seguro** (limitação técnica do `runtime_version`):

- ✅ **Bug fix de JS / TS / styling** — mudou um componente, um catch, uma string i18n → OTA
- ✅ **Lógica de cliente** — fluxo de tela, parsing, validação Zod
- ❌ **Native module novo / atualizado** — `react-native-health` bump → exige build nativo + review store
- ❌ **`app.config.ts` permission/entitlement mudou** → exige build nativo
- ❌ **Dependência com código nativo** — qualquer pacote com diretório `ios/`+`android/` próprio

Toda PR mexer em pacote nativo bump `runtimeVersion` (semver maior) → forçando build novo. Mudanças puramente JS preservam `runtimeVersion` → OTA elegível.

**Apple App Store §3.3.2 + Google Play §"Deceptive Behavior"** permitem OTA explicitamente desde que (a) não mude funcionalidade fundamental anunciada na store e (b) cumpra mesmas guidelines. EAS Update é mecanismo padrão da indústria — sem risco regulatório de banimento.

**Por quê EAS Update** (rejeitada Microsoft CodePush):
- ✅ Mesma origem Expo — config único
- ✅ CodePush está em **modo de manutenção** desde Mar/2025 (Microsoft anunciou sunset planejado pra 2026)
- ✅ EAS Update integra com EAS Build + EAS Submit (canal único)

### 3. **Force update via `mobile_app_versions.min_required`** (já desenhado Sprint 35a)

Fluxo em boot do app:

```
1. App boot → GET /api/mobile/auth/check-version (público, rate-limited regra 36)
   Body: { platform, currentVersion }
2. Resposta:
   {
     ok, minRequired, updateRequired,    // < min_required → bloqueia
     latestVersion, updateAvailable,     // < latest → banner sugestivo
     storeUrl, releaseNotes
   }
3. updateRequired=true:
   → Tela bloqueante "Atualize para continuar" + botão deep link app store
   → Toast `<Banner type="danger">` (regra 45)
   → App não progride pro login até update
4. updateAvailable=true (não required):
   → `<Banner type="info">` com "Atualizar agora" / "Mais tarde"
   → Dispensável; lembra de novo daqui 7 dias
```

**Curadoria de `min_required`** vive em `mobile_app_versions` (RLS global read-all, grant `platform_admin` write — Sprint 35c terá UI super-admin). Política inicial:

- Suporte mínimo: **versão atual − 6 meses** OU **3 versões major atrás** (o que for menor)
- Bumping `min_required` em emergência (CVE crítico, breaking API server) — apertar via SQL direto + alertar usuários via push antes
- Sunset (`sunset=true`) marca versão fora de suporte; aparece em audit mas não bloqueia se ainda > `min_required`

### 4. **Tokens: access 1h, refresh 90d, rotação no refresh**

| Token | Local | Validade | Renovação |
|---|---|---|---|
| **Access JWT** | memória (RAM) | 1h | Refresh endpoint silencioso |
| **Refresh token** | `expo-secure-store` | 90d | Single-use rotation (cada refresh emite novo + revoga anterior) |

**Refresh endpoint (Sprint 35b):** `POST /api/mobile/auth/refresh` com `{ refreshToken }` no body:
1. Hash SHA-256 do refresh recebido → lookup em `mobile_sessions.refresh_token_hash`
2. Se `status='active'` AND `expires_at > now()`:
   - Emite **novo** refresh + access
   - Revoga anterior (`status='revoked'`, `revoked_reason='rotated'`)
   - INSERT nova row `mobile_sessions` linkada à antiga via `replaced_by_session_id` (Sprint 35b adiciona coluna)
3. Senão → 401 → app força re-login (magic link)

**Refresh longo (90d) > web (30d) por quê:**
- App é "always-on" do usuário — atrito de re-login mata UX mobile
- Device fingerprint + Bluetooth pairing + IP histórico permitem detecção de roubo melhor que web
- Single sign-out por device (revogar refresh = derrubar device, sem afetar web)

**Family chain detection** (Sprint 35b): se refresh já revogado for reapresentado → todos os refresh da family revogam (ataque session hijacking).

### 5. **Push dispatcher direto APNs + FCM** (não Expo Push Service)

**Servidor LogiFit envia push direto via APNs HTTP/2 + FCM HTTP v1** — não roteia via `exp.host` (Expo Push API).

**Por quê direto** (rejeitado Expo Push):

- ✅ **Soberania** (regra 46): Expo Push roteia tudo por servidores Expo (`exp.host`) — dependência externa não justificada quando APNs/FCM são chamadas HTTPS diretas
- ✅ **Performance previsível** — sem hop intermediário; nosso SLA depende só de Apple/Google
- ✅ **Credentials separadas por tenant não tem ganho** — push usa device token (FCM/APNs identifica device, não tenant)
- ✅ **Custo** — Expo Push é grátis hoje, mas free tier pode mudar; APNs/FCM são grátis perpétuos (custo Apple Developer $99/ano + Google Play $25 vitalício são os únicos custos)

**Implementação (Sprint 35b):**

```
packages/notifications/
├── provider.ts                # interface PushProvider
├── apns.ts                    # JWT signing via p8 key + HTTP/2 → api.push.apple.com
├── fcm.ts                     # Service account JSON + HTTP v1 → fcm.googleapis.com
├── dispatcher.ts              # queue rate-limited (regra 36) + retry exponencial + dead-letter
└── topics.ts                  # mapeamento canônico (appointment_reminder_24h, etc)
```

Tabela `push_dispatches` (Sprint 35b) audita cada envio: `member_id`, `token_id`, `topic`, `payload`, `sent_at`, `apns_id` ou `fcm_message_id`, `status` (queued/sent/delivered/failed/invalid_token), `failure_reason`. Token retornando `BadDeviceToken` (APNs) ou `UNREGISTERED` (FCM) → soft-revoke automático em `mobile_push_tokens.revoked_reason='token_invalid'`.

**Expo notification client lib** (`expo-notifications`) continua sendo o caminho **do lado app** pra registrar device token + handle de notif recebida — não obriga uso do `exp.host`.

### 6. **CI/CD: EAS Build cloud + GitHub Actions orchestration**

| Trigger | Worker | Output |
|---|---|---|
| PR commit | GitHub Actions: lint + typecheck + test | Status check |
| Merge `main` (mudou só JS) | GitHub Actions → `eas update --branch production` | OTA bundle publicado |
| Merge `main` (mudou nativo) | GitHub Actions → `eas build -p all --profile production` | Build iOS + Android (EAS Build cloud) |
| Tag `mobile-v*` | GitHub Actions → `eas submit -p all` | Submit App Store + Play |

**EAS Build profiles** (`eas.json`):

```json
{
  "build": {
    "development": { "developmentClient": true, "distribution": "internal" },
    "preview": { "distribution": "internal", "channel": "preview" },
    "production": { "channel": "production", "autoIncrement": true }
  }
}
```

**Free tier EAS Build** = 30 builds/mês. MVP solo cabe; bumpamos pra `Production` ($99/mês) quando volume justificar.

**Por quê não self-host EAS Build em Oracle ARM Ampere:**
- Build iOS exige macOS (Xcode) — Oracle ARM Ampere é Linux ARM, não roda Xcode
- Manter Mac Mini físico ou VM macOS na cloud → custo alto + Apple licensing CLUF (não pode rodar macOS virtualizado fora de hardware Apple)
- EAS Build cloud já é a melhor opção custo-benefício

**Android self-host possível** mas perde paridade com iOS — mantemos ambos em EAS pra simplicidade dev solo (regra 46 aceita EAS como dependência justificada).

### 7. **Onboarding novo app: 2 paths suportados**

**Path A (reativo)** — Profissional manda **convite via WhatsApp/SMS** contendo deep link `logifit://invite?token=<token>`:
1. Universal link abre app se instalado
2. Senão, abre `https://app.logifit.com.br/m/invite?token=...` que detecta plataforma + mostra botão "Baixar na App Store / Play Store" + lembra token via URL fragment pós-install (Apple Smart App Banner + Android App Links)
3. Pós-instalação, app abre e consome token → cria account + login + push register

**Path B (proativo)** — Paciente baixa app sem invite:
1. Tela `/login` pede email + telefone
2. Magic link via SMS+email (Sprint 35b: rota `/api/mobile/auth/magic-link`)
3. Se já tem `members.identity` linkado → loga + push register
4. Senão → wizard cadastro (mesma UX do Path B web Sprint 26b, regra 42)

## Alternativas rejeitadas

### "Sideload Android via APK direto + alternativa iOS via TestFlight perpétuo"
- ❌ Apple proíbe TestFlight long-term (limite 90 dias/build + 10k testers)
- ❌ Play Protect bloqueia install + perde Play Integrity (anti-fraude)
- ❌ Compliance LGPD complica auditoria de canal de distribuição

### "Microsoft CodePush"
- ❌ Em modo de manutenção (Mar/2025) com sunset planejado
- ❌ Adiciona dependência fora do ecosystem Expo
- ❌ Worker setup + CLI diferente do `eas update`

### "OTA full bundle nativo (não só JS)"
- ❌ Tecnicamente possível via mecanismos como Capacitor Live Updates, mas viola Apple §3.3.2 (mudança de funcionalidade nativa fora de review)
- ❌ Risco de banimento App Store
- 🟢 JS-only OTA é o limite seguro universalmente aceito

### "Expo Push Service"
- ❌ Roteamento extra `exp.host` adiciona ponto de falha
- ❌ Quotas e SLA dependem de Expo (free tier hoje, política amanhã)
- ❌ Regra 46: dependência externa não justificada quando alternativa direta (APNs/FCM) é viável

### "Single token (sem refresh) com vida longa"
- ❌ Token comprometido = device controlado até expirar
- ❌ Sem rotation = sem detecção de uso paralelo
- 🟢 Access curto (1h) + refresh longo com rotation single-use = padrão indústria

### "Acesso compartilhado com cookie web `lf_member_session`"
- ❌ App em iOS WKWebView não compartilha cookie com Safari por default
- ❌ Path `/meu` do cookie web é incompatível com domínio de API mobile
- ❌ Header `Authorization: Bearer` é padrão REST mais limpo

### "Self-host EAS Build em VPS"
- ❌ macOS virtualização fora de hardware Apple viola CLUF
- ❌ Custo + manutenção Mac Mini físico > EAS Production tier

## Consequências

**Positivas:**
- Distribuição via canais oficiais protege confiança institucional B2B
- OTA via EAS Update destrava hotfix de bug JS em horas (em vez de 24-72h review Apple)
- Force update via `mobile_app_versions.min_required` permite resposta rápida a CVE/breaking
- Refresh 90d + rotation single-use balanceia UX + segurança
- Push direto APNs/FCM mantém soberania (regra 46)
- EAS Build cloud remove necessidade de Mac local

**Negativas / mitigadas:**
- **Dependência EAS Build/Submit/Update** — Expo Inc. pode mudar pricing — mitigado: `prebuild` permite saída pra build local; EAS Update é OTA padrão facilmente substituível
- **Apple/Google review** — bug crítico nativo pode levar 24-72h em produção — mitigado: OTA cobre 80% dos bug fixes; staged rollout 5% reduz blast radius
- **Custo Apple Developer $99/ano + Google Play $25 vitalício** — aceitável e justificado
- **Refresh chain hijack** — mitigado: family chain detection + single-use rotation (Sprint 35b)

**Bloqueios** (revisar ADR se ocorrerem):
- Apple/Google publicar policy proibindo OTA → reverter pra ciclo store-only
- EAS Build/Update sair do mercado → migrar pra Vercel-style builder ou self-host Android-only
- APNs/FCM regulatório no Brasil mudar → unlikely; ambos usados massivamente

## Status

**Proposed** — Sprint 35a fecha o backbone server-side (versionamento + check-version + register-push). Sprint 35b/c materializa scaffold do app + dispatcher direto APNs/FCM + rotação refresh + UI super-admin pra `mobile_app_versions`. Promove para **Accepted** quando primeiro build for submetido com sucesso (TestFlight + Play Internal).

## Refs

- [ADR 0045 — Stack mobile Expo managed](0045-stack-mobile-expo-managed-react-native.md)
- [ADR 0049 — Device Hub](0049-device-hub-wearables-clinicos.md)
- [ADR 0088 — Portal member magic link auth](0088-portal-member-magic-link-auth.md) (auth pattern compatível)
- [Sprint 35 — App Nativo Expo backbone](../sprints/35-mobile-app-nativo-expo.md)
- [EAS Build docs](https://docs.expo.dev/build/introduction/)
- [EAS Update docs](https://docs.expo.dev/eas-update/introduction/)
- [APNs HTTP/2 spec](https://developer.apple.com/documentation/usernotifications/setting_up_a_remote_notification_server/sending_notification_requests_to_apns)
- [FCM HTTP v1 API](https://firebase.google.com/docs/cloud-messaging/migrate-v1)
- [Apple App Store Review §3.3.2](https://developer.apple.com/app-store/review/guidelines/#3.3.2) (OTA permitido)
- [Play Developer Policy §"Device and Network Abuse"](https://support.google.com/googleplay/android-developer/answer/9888379)
