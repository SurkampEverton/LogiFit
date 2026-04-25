# Realtime LogiFit — padrão LISTEN/NOTIFY + quando usar Supabase Realtime

> Cookbook para realtime no LogiFit. Default: **PG LISTEN/NOTIFY**. Exceção justificada: Supabase Realtime apenas para broadcast pra muitos clients simultâneos.
> Razão: portabilidade Sprint 19b ([ADR 0078](../decisions/0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md)) — LISTEN/NOTIFY é nativo Postgres, funciona em Oracle Cloud sem mudança.

## Quando usar cada um

| Cenário | Tecnologia | Por quê |
|---|---|---|
| Notificação pontual server→1 cliente (ex: "novo agendamento na sua agenda") | **LISTEN/NOTIFY** + ws server-side | 1 listener ↔ 1 cliente; baixo overhead |
| Atualização de UI cross-cliente em sessão única (ex: 1 admin + 1 recepção vendo dashboard live) | **LISTEN/NOTIFY** + ws | Até ~5 clients é eficiente |
| Atualização de UI cross-cliente em **broadcast massivo** (ex: 100 alunos vendo placar de aula coletiva live) | **Supabase Realtime** | Otimizado para fan-out massive (Phoenix Channels) |
| Eventos de domínio assíncronos entre serviços/jobs LogiFit | **Postgres triggers + LISTEN/NOTIFY** | Idempotência via `webhook_events.external_id` quando externo |
| Sync entre tabs do mesmo browser do user | **BroadcastChannel API** + localStorage | Não envolve servidor |

## Arquitetura LISTEN/NOTIFY no LogiFit

```
[Server Action emite evento]
        ↓
   [Postgres trigger ou pg_notify() direto]
        ↓
   [NOTIFY 'channel-name', 'json-payload']
        ↓
[ws server-side em apps/web/api/realtime/route.ts (long-running connection)]
        ↓
   [filtro por tenant_id + permission]
        ↓
   [WebSocket → cliente]
```

### Channels canônicos LogiFit

| Channel | Quem emite | Quem escuta | Payload |
|---|---|---|---|
| `tenant:{tenant_id}:alerts` | trigger em `system_alerts` INSERT | admin tenant | `{alert_id, severity, category, title}` |
| `tenant:{tenant_id}:assistant:{user_id}` | Server Action `proposeAction` | usuário ativo | `{proposal_id, tool_key, args, expires_at}` |
| `tenant:{tenant_id}:agenda:company:{company_id}` | trigger em `appointments` | recepção da company | `{appointment_id, type, member_id, slot_at}` |
| `tenant:{tenant_id}:checkin:unit:{unit_id}` | trigger em `access_events` | recepção da unit | `{event_id, member_id, kind, at}` |
| `tenant:{tenant_id}:financial:overdue` | trigger em `invoices` UPDATE status | financeiro | `{invoice_id, member_id, amount_cents, days_overdue}` |
| `tenant:{tenant_id}:teleconsulta:{room_id}` | server-side teleconsulta | profissional + paciente | `{event, payload}` (signaling — Sprint 31) |

### Payload format (JSON estável)

```json
{
  "event_id": "uuid",
  "tenant_id": "uuid",
  "emitted_at": "2026-04-25T12:34:56Z",
  "kind": "alert.new",
  "payload": { /* estrutura específica */ },
  "request_id": "uuid"
}
```

- `request_id` propaga rastreabilidade (regra 33 wrapAction → trigger → notify)
- `tenant_id` redundante mas usado para filtro server-side antes de WS push
- `emitted_at` ISO 8601 UTC

## Implementação Sprint 00

```typescript
// packages/realtime/listener.ts
import { Pool } from 'pg';

export async function startListener(channels: string[]) {
  const client = await pool.connect(); // dedicated connection (não-PgBouncer)
  for (const ch of channels) {
    await client.query(`LISTEN "${ch}"`);
  }
  client.on('notification', async (msg) => {
    const payload = JSON.parse(msg.payload!);
    // filtra + dispatcha para WebSockets conectados
    await dispatcher.fanout(msg.channel, payload);
  });
}

// packages/realtime/emit.ts
export async function emitEvent(channel: string, payload: object) {
  await db.execute(sql`SELECT pg_notify(${channel}, ${JSON.stringify(payload)})`);
}
```

**Importante (PgBouncer):**
- LISTEN/NOTIFY exige **session mode** (não transaction mode)
- Conexão do listener vive separada do pool app (uma única connection long-running)
- App geral continua usando PgBouncer transaction mode via `DATABASE_URL`
- Listener usa `DATABASE_URL_DIRECT` (bypass PgBouncer)

## Quando NÃO usar LISTEN/NOTIFY

- **Persistência de mensagem:** LISTEN/NOTIFY perde mensagens se cliente está desconectado quando notify dispara. Para persistência, use tabela `notification_queue` (ADR 0071) + polling ou outbox pattern.
- **Garantia at-least-once:** combine NOTIFY + INSERT em transação + cliente faz reconcile.
- **Multi-region:** NOTIFY é local ao Postgres único. Para multi-region (Fase 2 Enterprise), considerar Redis pub/sub via Upstash.

## Quando usar Supabase Realtime (exceção justificada)

Tickar TODAS as caixas abaixo:

- [ ] Broadcast simultâneo para **≥5 clients** mesma mensagem
- [ ] Latência <500ms importante (UX live, não só notificação)
- [ ] Permissão verificada por **RLS Postgres** (Realtime respeita RLS automaticamente)
- [ ] Aceitar custo de migração no Sprint 19b (~4-8h por canal — re-implementar com WebSocket próprio + LISTEN/NOTIFY)

Documentar uso em ADR específico com justificativa.

## Migração Sprint 19b

Quando Postgres migra para Oracle Cloud:

- Channels LISTEN/NOTIFY funcionam **sem mudança** (mesmo Postgres)
- Listener server-side reconecta no novo `DATABASE_URL_DIRECT`
- Usos de Supabase Realtime (se houver) precisam ser migrados para WS próprio (~4-8h cada)

## Referências

- [ADR 0078 — Hospedagem em duas fases](../decisions/0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md)
- [ADR 0071 — Sistema de erros + alertas em tempo real](../decisions/0071-sistema-tratamento-erros-alertas-tempo-real.md)
- [Postgres LISTEN/NOTIFY docs](https://www.postgresql.org/docs/current/sql-notify.html)
- [docs/dev/portability.md](portability.md)
