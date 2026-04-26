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

- ADR 0045 (esperado) — Stack mobile: Expo bare workflow vs managed; React Native vs Flutter
- ADR 0046 (esperado) — Estratégia de release (app stores vs OTA Expo Updates)
- ADR 0084+ (a alocar quando sprint começar) — Auth no app: BetterAuth same JWT vs OAuth nativo (Apple Sign-in mandatório); Política de versionamento + EOL de versões antigas. Numeração ≥0084 (0080-0083 já consumidos pelas Sprints 29/30/31 — auditoria 12).

## ADRs já fechados que se aplicam

- [ADR 0049](../decisions/0049-device-hub-wearables-clinicos.md) — Device Hub
- [ADR 0063](../decisions/0063-responsividade-total-mobile-first.md) — design system mobile-first se aplica
- [ADR 0074](../decisions/0074-modo-coach-mobile-first-pwa.md) — modo coach PWA é predecessor; padrões reaproveitados
- [ADR 0073](../decisions/0073-postura-seguranca-defesa-em-profundidade.md) — segurança em profundidade (cert pinning, jailbreak detection, anti-reverse)
