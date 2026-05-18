<!-- Stub. Quando virar `doing`, expandir para o formato completo de [`_template.md`](_template.md) — Goal, Critério de aceite, Dependências, Decisões/ADRs, Módulos entregues, Rotas, Server Actions/API, Schemas Drizzle, Eventos, Commit checklist, Stretch, Log, Definition of Done. -->

# Sprint 35 — App Nativo Expo (aluno/paciente)

- **Área:** mobile
- **Início:** planejado (Fase 3, depois do Sprint 34)
- **Fim planejado:** +6 semanas (sprint grande)
- **Status:** planejado (futuro)
- **Item do roadmap:** #37

> **Stub** — este sprint ainda não tem detalhamento profundo. Arquivo nasceu para preencher gap de numeração no roadmap; será expandido quando virar candidato a `doing` (próximo 1-2 da fila), conforme convenção em [`roadmap.md`](../roadmap.md).

## Goal (rascunho)

App nativo iOS + Android (Expo + React Native) para aluno/paciente, expandindo o portal PWA web (Sprint 26) com:

- **Bluetooth completo** — sensores BLE (bioimpedância, cardiofrequencímetro, encoder VBT) com suporte iOS Safari (que PWA não cobre)
- **Push notifications nativas** — APNs + FCM (PWA cobre Android Chrome só)
- **Apple HealthKit** + **Google Health Connect** — expande Device Hub (Sprint 32) para fontes nativas
- **QR scan câmera nativa** — entrada na catraca (Sprint 08), upload de exame (Sprint 33)
- **Modo offline real** — workout em andamento sem internet (treino em academia sem WiFi)
- **Geolocalização** — check-in automático ao chegar na unit (opt-in)
- Reusa **toda lógica server-side** já existente (Server Actions + API Routes); app é cliente puro

## Pré-requisitos

- MVP estável + Sprint 28 (Generative UI) opcional
- Sprint 32 (Device Hub) — base de provider abstrato
- Sprint 33 (Pipeline Exames) — upload via app
- App store accounts (Apple Developer R$ 600/ano + Google Play R$ 130 one-time)

## Decisões esperadas

- ADR 0089+ (a alocar quando Sprint 35b começar) — Política de versionamento + EOL de versões antigas (curadoria operacional sobre `mobile_app_versions.min_required`). Numeração ≥0089 (0080-0088 já consumidos pelas Sprints 23/24/26/27/28/29/30/31 — auditorias 12, 14 e 15).

## ADRs já fechados que se aplicam

- [ADR 0045](../decisions/0045-stack-mobile-expo-managed-react-native.md) — **Stack mobile: Expo managed + React Native + TypeScript + Expo Router file-based** (Proposed 2026-05-18)
- [ADR 0046](../decisions/0046-release-strategy-app-stores-ota.md) — **Release strategy: App Store + Play Store oficiais + OTA via EAS Update JS-only + force update via `mobile_app_versions.min_required` + access 1h+refresh 90d single-use rotation + push direto APNs/FCM** (Proposed 2026-05-18)
- [ADR 0049](../decisions/0049-device-hub-wearables-clinicos.md) — Device Hub
- [ADR 0063](../decisions/0063-responsividade-total-mobile-first.md) — design system mobile-first se aplica
- [ADR 0074](../decisions/0074-modo-coach-mobile-first-pwa.md) — modo coach PWA é predecessor; padrões reaproveitados
- [ADR 0073](../decisions/0073-postura-seguranca-defesa-em-profundidade.md) — segurança em profundidade (cert pinning, jailbreak detection, anti-reverse)
