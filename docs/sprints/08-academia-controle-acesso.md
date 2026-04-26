# Sprint 08 — Academia · Controle de acesso (QR + catraca)

- **Área:** academia
- **Início:** planejado (depois do Sprint 07)
- **Fim planejado:** +3 semanas
- **Status:** planejado
- **Item do roadmap:** #7

## Goal

Aluno da Academia entra na unidade via QR code dinâmico (HMAC rotativo 60s) lido pela catraca. Catraca publica check-in via Realtime; UI da recepção vê passagem ao vivo. Bloqueio automático quando contrato em atraso > grace period (consumido de `invoice.overdue` do Sprint 04). **Personal trainers contratados no tenant exigem CREF ativo (Lei 9.696/1998) — validado no onboarding via `professional_registrations` do Sprint 01b (ADR 0055).**

## Critério de aceite

- Cada `member` tem QR token que rotaciona a cada 60s (HMAC-SHA256 de `member_id + timestamp` com secret por tenant)
- Catraca lê QR e chama `POST /api/acesso/checkin`; resposta `{ allow: bool, reason? }`
- Check-in grava em `access_events` (append-only); emite evento Realtime no canal da unit
- Recepção em `/app/acesso/checkins` vê lista live + foto do member
- Bloqueio manual (ex: aluno suspenso) em `access_blocks` sobrepõe qualquer permissão
- Bloqueio automático: `invoice.overdue` por `N` dias (config do plano) cria `access_block` tipo `overdue`; `payment.received` remove
- Heartbeat da catraca (`POST /api/acesso/heartbeat`) cada 30s; alerta Sentry se silêncio >2min
- Dispositivo (`access_devices`) cadastrado por unit com token próprio HMAC distinto do QR
- Teste E2E: gerar QR, bater na catraca, verificar allow=true; esperar 90s, repetir → token antigo rejeitado
- **Responsividade (ADR 0063):** QR do aluno em `/app/members/[id]/qr` renderiza otimizado para mobile portrait (QR ocupa maior área disponível, bordas arredondadas, zoom automático se user pinch); UI da recepção `/app/acesso/checkins` suporta tablet landscape (dispositivo fixo no balcão); feed live usa `<ResponsiveTable>` — tabela em desktop, cards empilhados em mobile (gerente acompanhando visita filial pelo celular)
- Teste E2E: member com invoice vencida +15d não consegue passar; paga invoice → libera em <5s
- **Gate CREF para personal trainer (ADR 0055):** onboarding de user com role `personal` ou `instrutor` exige ao menos 1 `professional_registrations` ativo com `council_body='CREF'` (Lei 9.696/1998 art. 3º). Operador do tenant é orientado no fluxo a cadastrar o CREF antes de atribuir a role. Nota jurídica exibida na UI.
- Teste E2E: tentar criar user com role `personal` sem CREF ativo → fluxo bloqueia com mensagem "Personal trainer exige CREF ativo (Lei 9.696/1998); cadastre em /app/pessoas/[id]/registros"

## Dependências

- Sprint 02 (`members`)
- Sprint 03 (agenda — check-in pode referenciar `appointment_id` quando bate em horário de aula)
- Sprint 04 (`invoice.overdue` é a fonte do bloqueio automático)
- Sprint 07 (dashboard já consome Realtime — reaproveita canal)

## Decisões tomadas / ADRs esperados

- **ADR 0017 (esperado)** — QR dinâmico HMAC com rotação 60s. Justifica: tela do celular screenshotada não funciona após 60s; antifraude sem exigir hardware leitor com crypto forte. Secret por tenant rotacionável.
- **ADR 0018 (esperado)** — Hardware da catraca + modalidade de autenticação. Opções de hardware: (a) Android box com Expo bare rodando leitor QR + heartbeat; (b) ESP32 com câmera OV2640 + firmware custom; (c) iPad fixo + cabo para catraca tradicional via relé; (d) câmera IP com **reconhecimento facial** (MediaPipe Face Recognition, AWS Rekognition ou modelo local via Python edge function). Modalidades de auth: **QR HMAC** (padrão, barato, rápido) e **facial** (opcional, depende do hardware escolhido; biometria exige consent específico por LGPD — `consent.facial_recognition`). Cliente do tenant escolhe uma ou ambas no cadastro da catraca. **Decisão é deste sprint**; já listada como pendente no [roadmap.md](../roadmap.md#decisões-pendentes).

## Módulos entregues

Ver [`modulos.md` — Academia](../modulos.md#academia):

- QR code do aluno + HMAC rotativo
- Catraca + Realtime
- Check-in/out (`access_events`)
- Bloqueio por inadimplência (`access_blocks`)

## Rotas Next.js

- `/app/acesso/checkins` — feed ao vivo da unit ativa
- `/app/acesso/catracas` — cadastro + saúde das catracas (last_heartbeat, status)
- `/app/acesso/bloqueios` — lista de `access_blocks` com razão + datas
- `/app/members/[id]/qr` — QR dinâmico do aluno (tela do app); também mostra bloqueios ativos
- `/app/members/[id]/acessos` — histórico de passagens

## Server Actions + API Routes

API Routes:

- `POST /api/acesso/checkin` — body `{ device_token, qr_token }`; valida HMAC do device, decodifica QR, checa `access_blocks`, grava `access_events`, emite Realtime; resposta `{ allow, member: {name, photo_url} | null, reason }`
- `POST /api/acesso/heartbeat` — body `{ device_token }`; atualiza `access_devices.last_heartbeat`
- `GET /api/acesso/qr/[memberId]` — retorna QR atual (SSE para push de rotação ou polling 60s); protegido por JWT do member

Server Actions:

- `registerDevice(companyId, unitId, label)` → retorna `device_token` (mostrado 1x)
- `revokeDevice(deviceId)` — rotaciona secret
- `blockMember(memberId, reason, expiresAt?)` → cria `access_blocks` tipo `manual`
- `unblockMember(blockId)`
- `manualCheckIn(memberId)` — recepção registra manualmente (foto + motivo)

## Schemas Drizzle (esperado)

Em `packages/db/schema/acesso.ts`:

- `access_devices` — `id`, `tenant_id`, `company_id`, `unit_id`, `label`, `token_hash text` (bcrypt do token completo), `auth_modes text[]` (ex: `['qr', 'facial']`), `hardware_type text` (escolhido no ADR 0018), `last_heartbeat timestamptz`, `created_at`, `revoked_at`
- `access_secrets` — `id`, `tenant_id`, `secret bytea`, `active bool`, `rotated_at`. Rotação periódica; tokens QR validam contra chaves ativas das últimas 2 rotações (tolerância).
- `member_face_embeddings` — `id`, `tenant_id`, `member_id`, `embedding vector(512)` (via pgvector), `created_at`, `consent_id` (exige consent LGPD específico para biometria). Presente só se modalidade `facial` ativa no tenant.
- `access_events` — `id`, `tenant_id`, `device_id`, `member_id`, `at timestamptz`, `kind` enum (`checkin`, `checkout`, `denied_overdue`, `denied_block`, `denied_invalid_token`, `denied_no_face_match`, `manual`), `auth_mode` enum (`qr`, `facial`, `manual`), `appointment_id nullable`, `raw jsonb`. Append-only via trigger; particionar por mês.
- `access_blocks` — `id`, `tenant_id`, `member_id`, `kind` enum (`manual`, `overdue`, `suspended`), `reason`, `started_at`, `expires_at nullable`, `resolved_at nullable`

**RLS:** tenant + scope por company/unit. `POST /api/acesso/checkin` usa service role do Supabase (não JWT do member) — catraca autentica via `device_token`.

## Eventos de domínio emitidos

- `member.checked_in` — `{ member_id, device_id, unit_id, appointment_id?, at }`
- `member.access_denied` — `{ member_id, reason, at }`
- `device.offline` — `{ device_id, last_heartbeat, at }` (job detecta silêncio)
- `member.blocked` / `member.unblocked`

Consumidores no MVP:
- Dashboard recepção (Sprint 07) → lista live de check-ins
- `invoice.overdue` (Sprint 04) dispara criador de `access_blocks` aqui

## Commit (checklist)

- [ ] Schema Drizzle: `access_devices`, `access_secrets`, `access_events` (append-only + partition), `access_blocks`, `member_face_embeddings` (se facial ativo)
- [ ] RLS + testes nos 5 cenários
- [ ] HMAC QR em `packages/ai/qr.ts` (gerador + validador com tolerância de 1 rotação)
- [ ] **Pipeline facial (opcional por tenant):** embedding generator (MediaPipe ou serviço externo conforme ADR 0018) + matching via pgvector similarity (threshold configurável); requer consent LGPD explícito antes de capturar embedding
- [ ] API Route `/api/acesso/checkin` idempotente suportando **ambos os modos** (`qr_token` OU `face_image_b64`); mesmo qr_token pode vir 2x se reintentar
- [ ] API Route `/api/acesso/heartbeat` + job que marca offline
- [ ] Canal Realtime `tenant:X:unit:Y:access` usado pelo dashboard recepção
- [ ] **Registrar handlers no cross-alert dispatcher** (API `registerCrossAlertHandler` do Sprint 07):
  - Subscriber de `invoice.overdue` → cria `access_blocks` automaticamente
  - Subscriber de `contract.paused` / `contract.auto_paused` → cria `access_blocks` com `kind='suspended'`
  - Subscriber de `payment.received` → resolve `access_blocks` do member
  - Subscriber de `contract.resumed` → resolve `access_blocks` relacionados
- [ ] UI `/app/acesso/*` com estados (live, bloqueios, catracas)
- [ ] UI `/app/members/[id]/qr` com rotação visível
- [ ] Gate de onboarding: `/app/settings/users/new` com role `personal`/`instrutor` consulta `professional_registrations` da `person_id` e bloqueia se CREF inativo; link para tela de cadastro (ADR 0055)
- [ ] Widget "acessos do paciente" em `/app/members/[id]` (slot `acessos`): frequência últimos 30d + último check-in + unit preferida + bloqueios ativos. Registrar com `{ slot: 'acessos', requiredPermissions: ['acesso.read'], requiredVertical: 'academia', consentPurpose: null, showWhen: (m) => m.has_access_events }`. Tenant só-Fisio/só-Nutri não vê. Ver [modulos.md — matriz](../modulos.md#matriz-de-visibilidade-mvp--previsão-fase-23)
- [ ] Hardware protótipo (ADR 0018 escolhido + POC funcional)
- [ ] Testes unit: HMAC gen/validate + tolerância
- [ ] Testes E2E: allow, deny por bloqueio, deny por token expirado, deny por overdue
- [ ] Feature flag `acesso_v1`
- [ ] ADRs 0017 e 0018 publicados

## Stretch

- [ ] Offline-first da catraca — cache local + sync quando volta internet (decisão arquitetural ~ADR 0019). Mapeado como Fase 2 mas pode antecipar se ADR 0018 escolher Android+Expo.
- [ ] Foto da câmera da catraca anexada ao `access_events`
- [ ] Webhook outbound para catraca terceira (Control-ID, HikVision) com adapter
- [ ] Relatório de ocupação horária da unit

## Log

- —

## Definition of Done

- [ ] Feature flag `acesso_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] Hardware POC reproduzível (ADR 0018 documenta BOM + firmware)
- [ ] RLS verificada
- [ ] Partição do `access_events` aplicada
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 07 → `done`, item #7 → `done`
- [ ] **MVP encerrado** — celebrar
- [ ] Zero violação de regras

## Retro

- —
