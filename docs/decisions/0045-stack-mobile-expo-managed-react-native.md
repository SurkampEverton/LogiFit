---
slug: stack-mobile-expo-managed-react-native
status: proposed
date: 2026-05-18
---

# ADR 0045 — Stack do app nativo: Expo managed + React Native + TypeScript

## Contexto

Sprint 35 entrega o **backbone do app nativo** (schema `mobile_app_versions` + `mobile_push_tokens` + `mobile_sessions`, Server Actions + API Routes) sem ainda materializar o projeto cliente. Sprint 35b/c será o scaffold real do app + integração com APNs/FCM + Apple Health / Health Connect.

Decisões fundamentais que precisam ficar congeladas antes do scaffold pra evitar retrabalho:

1. **Framework**: React Native ou Flutter?
2. **Modo do projeto RN**: **Expo managed** (workflow gerenciado com EAS Build) ou **Expo bare** (acesso direto aos projetos iOS/Android nativos)?
3. **Linguagem**: TypeScript ou JavaScript?
4. **Como acessar APIs nativas críticas** (HealthKit, Health Connect, push notifications, Bluetooth LE)?
5. **Roteamento**: Expo Router (file-based) ou React Navigation manual?

Contexto LogiFit que pesa nestas decisões:

- **Dev solo** — não há equipe iOS + Android separada; toolchain única é vital
- **Stack web já é TypeScript + Next.js App Router file-based** — preferência forte por uniformidade
- **MVP mobile é fino** — login + magic link + checkin QR + agenda + push notifications + visualizar treino do dia + sincronizar Apple Health / Health Connect ([ADR 0049 Device Hub](0049-device-hub-wearables-clinicos.md))
- **Foco regulatório clínico vive no backend** (Server Actions wrapped, regra 33) — app é cliente puro
- **Sprint 35a já desenhou API REST + mobile sessions com refresh longo (90d)** — qualquer cliente HTTP serve

## Decisão

### 1. **React Native** (não Flutter)

**React Native + Hermes engine + New Architecture (Fabric + TurboModules) ativada por default**.

| Critério | RN (escolhido) | Flutter (rejeitado) |
|---|---|---|
| Uniformidade com web | ✅ TypeScript + JSX igual ao Next.js | ❌ Dart + widget tree próprio |
| Reuso de libs LogiFit | ✅ Zod + Drizzle types + clientes HTTP idênticos | ❌ Recriar tipos em Dart |
| Maturidade ecosystem saúde | ✅ react-native-health (HealthKit) + react-native-health-connect maduros | ⚠ Pacotes Flutter pra Health Connect ainda em flux |
| Time-to-market dev solo | ✅ Reuso conhecimento web | ❌ Curva Dart + Material 3 |
| Apoio Apple/Google | Native bridges 1ª classe | Bridges via platform channels (1 nível extra) |
| Performance UI 60fps | ✅ New Architecture suficiente pro MVP | ✅ Skia rendering ligeiramente melhor |
| Risco lock-in | Meta + comunidade massiva | Google único patrocinador |

Performance não é diferenciador — UI do app LogiFit não tem animações pesadas; é lista + form + push. Flutter ganha só em jogos / animações premium.

### 2. **Expo managed workflow + EAS Build + EAS Submit** (não bare)

**Expo SDK 52+ (compat React 19/RN 0.76 New Architecture)** com workflow gerenciado.

**Por quê managed** (rejeitada alternativa "bare workflow"):

- **Sem manutenção dos projetos `ios/` e `android/`** — Apple/Google atualizam Xcode/Gradle 2x ao ano; em bare, dev solo paga esse custo
- **Build em nuvem via EAS Build** — não precisamos de Mac na máquina de build (CI free tier EAS suficiente pra 30 builds/mês inicialmente; ver ADR 0046)
- **Atualização SDK = comando único** — `npx expo install --fix` resolve compat de pacotes; em bare há merge manual de Podfile + build.gradle
- **OTA updates (EAS Update)** — release de hotfix JS sem passar por review (ver ADR 0046)
- **Config plugins** — APIs nativas como HealthKit/HealthConnect/Bluetooth declaradas em `app.config.ts` (TypeScript) + plugin do pacote injeta entitlements/permissions automaticamente
- **Não bloqueia evolução pra bare** — `npx expo prebuild` gera o `ios/`+`android/` quando precisarmos de native module que nenhum config plugin cobre (config plugin é o "out" controlado)

**Quando saímos de managed pra bare** (sinais futuros, não MVP):
- Native module sem config plugin oficial nem comunidade ativa → tentamos escrever o plugin antes de ejetar
- App store rejeitando build por entitlement não declarável via plugin → unlikely; Apple/Google docs cobrem todos os entitlements via Info.plist/manifest que plugin manipula
- Necessidade de fork de RN core → único cenário real de bare; nenhuma feature LogiFit demanda

### 3. **TypeScript estrito** (regra 16)

`tsconfig` com `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true` — mesmo perfil do `apps/web/tsconfig.json`. Reuso de schemas Zod do backend via package `@repo/types` em projeto separado `apps/mobile/`.

**`any` proibido sem justificativa** — mesma política da web (regra 16). Native module sem types vira `// why: <pacote> não tem types; tipado localmente em <path>` + `.d.ts` próprio.

### 4. **APIs nativas críticas via config plugin + Expo modules**

| Necessidade | Pacote | Notas |
|---|---|---|
| Push (APNs + FCM) | **`expo-notifications`** | Token APNs/FCM via `Notifications.getDevicePushTokenAsync()` — sem dependência de **Expo Push Service** (servidor LogiFit envia direto pra APNs/FCM, ADR 0046 §rejeitada) |
| HealthKit iOS | **`react-native-health`** (config plugin oficial Expo Modules) | Read-only no MVP (peso/passos/HR/sleep) |
| Health Connect Android | **`react-native-health-connect`** + config plugin | Android 14+ runtime permissions |
| Bluetooth LE | **`react-native-ble-plx`** (config plugin Expo Modules) | Bioimpedância doméstica Sprint 36+ |
| Câmera (foto perfil + futuras OCR) | **`expo-camera`** | Built-in |
| Secure storage | **`expo-secure-store`** | Refresh token mobile (90d, Sprint 35a) vive aqui (não AsyncStorage) — Keychain iOS + Keystore Android |
| Background fetch | **`expo-background-fetch`** + **`expo-task-manager`** | Sync diário Apple Health / Health Connect → POST `/api/mobile/health/sync` |
| QR scanner | **`expo-barcode-scanner`** (sucessor `expo-camera/scanner`) | Checkin academia |

Todos cobertos por config plugin oficial — `npx expo prebuild` nunca precisa rodar no MVP.

### 5. **Expo Router v3 (file-based)** (não React Navigation manual)

Por quê file-based:

- **Mesma mental model do Next.js App Router** — dev solo não pula entre paradigmas
- **Deep links + universal links automáticos** — `app/login.tsx` exporta rota `logifit://login` + `https://app.logifit.com.br/m/login` (Sprint 35b config)
- **TypeScript routes** — `Href<typeof Route>` autocomplete
- **Sem boilerplate de navigator** — `Stack` + `Tabs` por arquivo `_layout.tsx`

Estrutura proposta:

```
apps/mobile/
├── app.config.ts          # Expo config + plugins (config plugins listados acima)
├── app/
│   ├── _layout.tsx        # Root: providers + theme
│   ├── (auth)/
│   │   ├── _layout.tsx    # Stack auth
│   │   ├── login.tsx      # Magic link request
│   │   └── verify.tsx     # Verify code do email
│   ├── (member)/
│   │   ├── _layout.tsx    # Tab bar logado
│   │   ├── index.tsx      # Home (próxima sessão + last 7d)
│   │   ├── treino.tsx     # Workout do dia
│   │   ├── checkin.tsx    # QR scanner
│   │   ├── agenda.tsx
│   │   └── perfil.tsx
│   └── +not-found.tsx
├── components/
├── lib/
│   ├── api.ts             # Fetch wrapper: Authorization Bearer + refresh
│   ├── session.ts         # expo-secure-store hooks
│   ├── push.ts            # registerPushToken
│   └── health.ts          # Apple/Google Health sync
└── package.json
```

### 6. **Arquitetura cliente <-> servidor**

- App **não** acessa Postgres direto. Toda chamada via `/api/mobile/*` REST (já desenhado Sprint 35a)
- Cookie web (`lf_member_session`, path `/meu`) **não é compartilhado** — app usa header `Authorization: Bearer <access_token>` (access 1h, refresh 90d, ADR 0046)
- Schemas Zod do backend reusados via package `@repo/types` (sub-set serializável; sem importar Drizzle no client)
- TanStack Query como cache HTTP (mesmo padrão da web)
- Sem GraphQL — endpoints REST tipados em Zod são suficientes pro escopo mobile

## Alternativas rejeitadas

### "Flutter"
- ❌ Quebra uniformidade TypeScript LogiFit
- ❌ Dart sem reuso de Zod / tipos backend
- ❌ Dev solo + 1 stack a mais = burnout
- ❌ Ecosystem saúde menos maduro

### "Expo bare workflow desde o dia 1"
- ❌ Antecipa custo de manutenção (Xcode/Gradle bumps) sem ganho real no MVP
- ❌ Build local exige Mac — CI mais caro
- ❌ Atualizações de SDK viram merge manual
- 🟢 Mantemos opção via `npx expo prebuild` quando necessário (bare é "saída", não "entrada")

### "React Native CLI puro (sem Expo)"
- ❌ Mesmas dores do bare + perde EAS Build + EAS Update (ADR 0046)
- ❌ Não há vantagem real — Meta empurra apps oficiais (Facebook, Instagram) com toolchain comparável ao Expo

### "Capacitor / Ionic / PWA-only"
- ❌ PWA já existe (Sprint 26b portal `/meu`) e cobre 70% do MVP — mas Apple Health + Health Connect + push iOS **exigem app nativo**
- ❌ Capacitor é WebView-first; performance UX em smartphone budget Android é ruim
- 🟢 PWA continua coexistindo como fallback (member sem app instalado segue usando `/meu` no Safari/Chrome)

### "Native iOS Swift + Native Android Kotlin separados"
- ❌ Dev solo com 2 codebases distintos: prazo de entrega dobra
- ❌ Lock-in regulatório: cada mudança CFM/COFFITO/LGPD vira 2 PRs
- ❌ Time-to-market inviável

### "React Native New Architecture desligada"
- ❌ RN 0.76 já faz New Architecture default; desligar é nadar contra a corrente
- ❌ Performance Fabric (renderer) + TurboModules é estritamente melhor pro nosso escopo
- 🟢 Mantemos ligada; pacotes que não suportam ficam de fora (e nenhum dos listados acima tem essa limitação)

## Consequências

**Positivas:**
- Toolchain única TypeScript + React + file-based routing (web + mobile)
- Reuso de tipos Zod via `@repo/types` sem refactor
- EAS Build remove necessidade de Mac local pra builds iOS
- Config plugins resolvem 100% das integrações nativas do MVP
- OTA Updates (ADR 0046) destrava hotfix de bug JS em horas, não dias

**Negativas / mitigadas:**
- **Lock-in EAS Build / Expo Updates** — mitigado: managed permite eject (`prebuild`) a qualquer momento; EAS Update é OTA padrão da indústria, não há vendor exclusivo no formato
- **Custo EAS Build acima do free tier** — mitigado: free tier cobre 30 builds/mês, suficiente pra MVP solo; Production tier $99/mês quando volume justificar
- **New Architecture pode quebrar pacotes legados** — mitigado: pacotes listados acima já compatíveis Expo SDK 52+
- **Atualização Expo SDK 2x/ano** — aceitável; uma manhã de sprint a cada 6 meses

**Bloqueios** (não aceitáveis sem revisar ADR):
- Pacote crítico não suporta New Architecture → revisar pacote ou desligar NA
- Apple/Google muda termos do EAS Submit → não há, EAS Submit é wrapper do `xcrun altool` / Play Console API

## Status

**Proposed** — Sprint 35a fecha o backbone server-side; Sprint 35b/c materializa o projeto seguindo este ADR. Promove para **Accepted** quando o scaffold inicial do `apps/mobile/` rodar com `expo start` + login funcional.

## Refs

- [ADR 0046 — Estratégia de release mobile + OTA Expo Updates](0046-release-strategy-app-stores-ota.md)
- [ADR 0049 — Device Hub](0049-device-hub-wearables-clinicos.md) §config plugin Apple Health / Health Connect
- [Sprint 35 — App Nativo Expo backbone](../sprints/35-mobile-app-nativo-expo.md)
- [Expo SDK 52 release notes](https://expo.dev/changelog) (New Architecture default)
- [Expo Router v3 docs](https://docs.expo.dev/router/introduction/)
