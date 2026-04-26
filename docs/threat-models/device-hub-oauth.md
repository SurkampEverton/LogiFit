# Threat Model STRIDE — Device Hub (OAuth wearables clínicos)

> **Stub** — Threat model esperado para o Device Hub ([ADR 0049](../decisions/0049-device-hub-wearables-clinicos.md)), implementado em [Sprint 32](../sprints/32-geral-device-hub.md). Será expandido. Template-base em [`_template-stride.md`](_template-stride.md).

- **Feature:** Device Hub — integração OAuth com Garmin, Oura, Apple Health, Google Fit, balança IoT (bioimpedância)
- **Sprint:** 32
- **Data:** stub criado em 2026-04-25
- **ADR de referência:** ADR 0049

## Superfície de ataque (a expandir)

Cada provider tem seu próprio fluxo OAuth + tokens long-lived + webhooks. Threat model precisa enumerar provider por provider.

```
[Member em /meu/dispositivos]
        │
        │ 1. clica "Conectar Garmin"
        ▼
[Redirect OAuth Garmin]
        │
        │ 2. consent + autoriza
        ▼
[Callback Vercel com code]
        │
        │ 3. troca por access_token + refresh_token (cifrado AES-256-GCM at-rest, regra 4)
        ▼
[Cron job via safeFetch (regra 37) → Garmin API]
        │
        │ 4. ingere HR, VFC, sono, atividade
        ▼
[device_readings particionado mensal (regra 34)]
```

## Análise STRIDE (a expandir antes da Sprint 32 entrar em `doing`)

| Ameaça | Cenário-chave |
|---|---|
| **S**poofing | Atacante completa OAuth callback com code de outro user (CSRF no `state` param) — gerar `state` HMAC binding por session |
| **T**ampering | Webhook do provider externo enviado por atacante — valida via HMAC + IP allowlist do provider |
| **R**epudiation | Provider externo nega ter enviado dado — armazenar `external_event_id` + raw payload no `webhook_events` (regra 8) |
| **I**nformation disclosure | Token OAuth roubado lê dado de saúde do member em outro provider — tokens isolados por provider + escopo mínimo |
| **D**enial of service | Provider externo rate-limita LogiFit; ou atacante força reconnect loop para gastar quota OAuth |
| **E**levation of privilege | Token de read promovido a write em provider que suporta (Apple Health pode escrever) — escopos solicitados explícitos no consent |

## Riscos específicos por provider

- **Apple Health / Google Fit:** integração via app nativo (Sprint 35); token vive no device, não no server
- **Garmin Connect IQ:** webhooks oficiais limitados; muitas integrações usam scraping (proibido)
- **Oura:** API estável; rate limit baixo (300/dia free)
- **Balança IoT (Bluetooth/WiFi):** firmware do device pode ter CVE; LogiFit não controla — limitar superfície a "ler peso/composição", nunca escrever
- **Pluggy (Open Finance, Sprint 17):** caso similar; threat model próprio em `pagamento-asaas.md` cobre parcialmente, mas Open Finance merece TM separado se Sprint 17 entrar em `doing`

## Cross-cutting

- Cifrar tokens OAuth at-rest com KEK por tenant (ADR 0073 camada 4)
- Revogar token quando member desabilita integração via `/meu/dispositivos`
- Cross-tenant: dado de wearable nunca cruza tenant bruto — só agregado via passaporte (regra 42 + RIPD `v1.0-device-hub.md`)
- Logout do user invalida refresh tokens (não esperar expiração)

## Referências

- [ADR 0049 — Device Hub wearables clínicos](../decisions/0049-device-hub-wearables-clinicos.md)
- [RIPD v1.0-device-hub.md](../compliance/ripd/v1.0-device-hub.md)
- [Regra 37 — safeFetch SSRF](../rules.md)
- [Regra 38 — scanUpload](../rules.md) (caso provider devolva imagens)
