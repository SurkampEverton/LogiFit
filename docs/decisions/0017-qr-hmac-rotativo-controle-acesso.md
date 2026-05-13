---
slug: qr-hmac-rotativo-controle-acesso
status: accepted
date: 2026-05-13
---

# ADR 0017 — QR HMAC rotativo (60s + tolerância 1 ciclo) para controle de acesso

## Contexto

Sprint 08 entrega o controle de acesso da Academia: aluno mostra QR no celular
na catraca, que lê e valida. Modelos considerados:

### A. QR estático (UUID do member)

Catraca lê UUID, valida via lookup `members.id`. Simples mas:

- ❌ **Screenshot funciona pra sempre** → aluno empresta QR pra amigo
- ❌ **Print de tela viraliza WhatsApp** → fraude difusa
- ❌ **Não tem expiração natural** → token vazado é eternamente válido
- ❌ **Sem assinatura** → fácil forjar QR (UUID é pública em URLs etc)

### B. JWT JOSE com expiry curto (5 min)

JWT assinado com chave RSA, exp 5min, refresh client-side.

- ✅ Standard
- ❌ Payload grande pra QR (limite prático: 2953 bytes; JWT chega 800+)
- ❌ Refresh complexo no PWA do member (lifecycle visibility change)
- ❌ JOSE em browser tem polyfill grande no bundle

### C. HMAC rotativo 60s + tolerância 1 ciclo (escolhido)

Token compacto `{memberId}.{windowStart}.{hmac16}`, ~80 chars total, regenera
a cada 60s. Catraca aceita janela atual + 1 anterior (tolerância clock drift).

- ✅ **QR muda a cada 60s** → screenshot vence em 2 minutos máximo
- ✅ **Compacto** (~80 chars; QR nível L cabe folgado)
- ✅ **HMAC SHA-256** com secret por tenant → impossível forjar sem chave
- ✅ **Tolerância 1 ciclo** → member levanta QR @ 14:23:55, catraca lê @ 14:24:15 (próxima janela) — ainda OK
- ✅ **Stateless validation** — catraca não precisa lookup ao banco pra cada read; basta validar HMAC localmente com secrets cacheados

## Decisão

Implementar HMAC rotativo 60s com tolerância 1 ciclo.

### Formato do token

```
{memberId}.{windowStart}.{hmac}
```

- `memberId`: UUID v4 do member (36 chars)
- `windowStart`: `floor(Date.now() / 1000 / 60)` (timestamp em janelas de 60s)
- `hmac`: `HMAC-SHA256(memberId + '|' + windowStart, secret).digest('hex').slice(0, 16)`

Total: ~36 + 1 + 8 + 1 + 16 = **~62 chars**. QR nível L cabe em 7×7 módulos.

### Secret per-tenant rotacionável

Tabela `access_secrets` (Sprint 08 Faixa A):

```sql
CREATE TABLE access_secrets (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  secret text NOT NULL,         -- base64 de 32 bytes random
  active boolean NOT NULL DEFAULT true,
  rotated_at timestamptz,
  created_at timestamptz DEFAULT now()
);
```

**Rotação**: admin clica "Rotacionar chave" → cria nova row `active=true` +
marca antiga `active=true` com `rotated_at=now()` (dual-active por 60s).
Cron `expire-old-secrets` Sprint 09+ marca `active=false` após 60s de rotação.

### Validation pipeline

```typescript
function validateAccessToken(token, secrets[]) {
  const [memberId, windowStr, providedHmac] = token.split('.')
  const window = Number(windowStr)
  const currentWindow = floor(Date.now() / 1000 / 60)

  // Tolerância: aceita janela atual + 1 anterior
  if (window < currentWindow - 1 || window > currentWindow) return { invalid: 'expired' }

  // Tenta cada secret ativo (suporta rotação overlap)
  for (const secret of secrets) {
    const expected = computeHmac(memberId, window, secret)
    if (timingSafeEqual(expected, providedHmac)) return { valid: true, memberId }
  }
  return { invalid: 'hmac_mismatch' }
}
```

`timingSafeEqual` é crítico — evita timing attacks que extrairiam HMAC byte-a-byte.

### Player UX

PWA do member em `/app/members/[id]/qr`:

1. `useEffect` busca QR atual via API `/api/acesso/qr/[memberId]`
2. `setInterval(60_000)` regenera (Sprint 09+: SSE push pra evitar drift)
3. Tela mostra QR + contador regressivo + "atualizando…" durante swap
4. Drag down → refresh manual
5. Bordas arredondadas, contraste alto, fullscreen no mobile (ADR 0063)

## Consequências

### Positivas

- **Anti-screenshot**: token vence em 2 minutos máximo
- **Anti-share difuso**: print em WhatsApp deixa de funcionar rapidamente
- **Hardware barato**: catraca só precisa ler QR (sem leitor crypto especial)
- **Stateless server-side validation**: catraca cacheia secrets ativos do tenant; valida localmente sem hit no banco a cada read (escalável >100 catracas/tenant)
- **Rotação simples**: admin troca chave em 1 clique; ambas ativas overlap 60s evita downtime
- **Defesa em profundidade**: bloqueio manual (`access_blocks`) ou overdue ainda funciona mesmo com QR válido — Sprint 04 dispatcher escreve em `access_blocks` que tem prioridade

### Negativas

- **Clock drift catraca**: tolerância 1 ciclo cobre ~60s; se relógio da catraca difere >120s, falsos negativos. Mitigação: NTP obrigatório na config inicial da catraca + alerta `device.clock_drift` (Sprint 09+).
- **PWA precisa background regeneration**: se member abrir QR fora da rede da academia (offline), token gera mas a catraca não tem secret pra validar. Mitigação: PWA detecta offline + mostra fallback "Mostre seu RG na recepção". Sprint 09+ pode adicionar token offline (HMAC com chave compartilhada PWA↔catraca).
- **Vazamento da chave do tenant compromete todos os tokens**: rotação rápida (1 clique admin) mitiga; envelope encryption do secret em Sprint 09+ adiciona camada.
- **No facial fallback no MVP**: se PWA do member quebrar (bateria 0%), recepção registra manual via `kind='manual'` Server Action `manualCheckIn(memberId, reason)`.

## Migração futura

Sprint 10+ pode adicionar **passkey/WebAuthn** como modalidade alternativa ao QR — member usa biometria do celular pra desbloquear PWA que gera o token. Adiciona camada de "algo que você é" sobre "algo que você tem". Compatível com schema atual (`access_devices.auth_modes` + `access_events.auth_mode='facial'` extensível).

## Referências

- [Sprint 08 — Controle de acesso Academia](../sprints/08-academia-controle-acesso.md)
- [ADR 0018 — Hardware da catraca (esperado Sprint 08)](.) — hardware decision separada (Android box / iPad / ESP32 / câmera IP)
- [HMAC-SHA256 RFC 2104](https://datatracker.ietf.org/doc/html/rfc2104)
- [QR Code Capacity (Wikipedia)](https://en.wikipedia.org/wiki/QR_code#Storage)
- `packages/security/src/access-qr.ts` — implementação MVP
