# Sprint 32 — Geral · Device Hub v1 (wearables + bioimpedância)

- **Área:** geral
- **Início:** planejado (após Sprint 31 Diário+Teleconsulta)
- **Fim planejado:** +3 semanas
- **Status:** planejado (futuro)
- **Item do roadmap:** #34

## Goal

Ingerir dados biométricos reais de dispositivos (smartwatches cloud, bioimpedância BLE, arquivos FIT/CSV) em uma base normalizada tipo FHIR Observation, com provider abstrato para crescer sem refactor. Cobre os providers "essenciais de mercado" que não dependem de app nativo; integrações iOS/BLE-mobile completas vêm no Sprint 34 (App Nativo).

## Critério de aceite

**Arquitetura core:**

- Interface `DeviceProvider` em `packages/ai/devices/provider.ts` com contrato comum (authenticate, sync, ingestReading)
- Tabela normalizada `device_readings` (padrão Observation FHIR-like)
- Tabela `device_connections` por member com tokens OAuth criptografados
- Tabela `device_sync_cursors` por (member, provider) com último timestamp sincronizado
- Hub orquestrador `packages/ai/devices/hub.ts` que roteia chamadas

**Providers na v1:**

- **Garmin Connect API** (cloud OAuth) — HR, VO2 max, passos, sono, treinos, GPS tracks
- **Oura Ring API** (cloud OAuth) — recovery score, VFC, sono, prontidão
- **Web Bluetooth bioimpedância doméstica** (Omron HBF-226, G-Tech Glass 7) — peso, IMC, % gordura, massa muscular via PWA em Chrome/Edge desktop
- **Import de arquivo** — CSV InBody profissional, FIT (Garmin), TCX (Polar), GPX (GPS genérico)

**Fluxo do member:**

- `/meu/dispositivos` lista providers disponíveis (paciente autenticado)
- Clicar "Conectar Garmin" abre OAuth do provider em popup → callback grava tokens
- Para BLE: "Conectar balança" usa Web Bluetooth API — emparelhamento in-browser; próximas leituras salvam automaticamente ao reconectar
- Desconectar revoga tokens + pausa sync (histórico permanece)

**Sincronização cloud:**

- Job Vercel Cron horário roda `POST /api/jobs/devices/sync-hourly` — para cada `device_connections` ativa, puxa novos dados desde `sync_cursor` e gravita em `device_readings`
- Retry exponencial em falhas transitórias
- Marca connection como `error` após 3 falhas consecutivas + notifica member

**4 usos dos dados do dispositivo:**

**Uso 1 — Curadoria para avaliação oficial:** profissional em `/app/members/[id]/avaliacoes/new` vê lista de leituras recentes compatíveis (peso, % gordura, HR, VFC), seleciona, valida/edita, e vira `assessment_measurements` com rastreabilidade (`source_device_reading_id` + `validated_by_user_id` + `validated_at`). **Dado de dispositivo nunca vira medida oficial sem validação humana.**

**Uso 2 — Painel de monitoramento contínuo:** `/app/members/[id]/monitoramento` mostra tendências visuais por categoria (peso diário, HR em repouso, recovery score, passos, sono) entre avaliações formais. Tracks separados das avaliações — claramente tag "📱 dispositivo" vs "🩺 avaliação validada". Profissional vê o entre-tempo sem importar ponto a ponto.

**Uso 3 — Alertas inteligentes:** regras declarativas (DSL do Sprint 13) consomem `device_readings`:
- HR repouso subiu >10 bpm em 3 dias → alerta fisio (possível overtraining/infecção)
- % gordura aumenta 2% em 30 dias + sono <6h → alerta nutri para revisar plano
- Passos <3000/dia por 7 dias → alerta instrutor para reengajar
Regras configuráveis por tenant; disparam via cross-alert dispatcher (Sprint 07) e régua (Sprint 13).

**Uso 4 — Timeline enriquecida no member:** widget de timeline (já existe desde Sprint 02) ganha **tracks paralelos**: coluna de avaliações oficiais + coluna de dados de dispositivo (agregados diários) + coluna de alertas disparados. Visual: evolução real entre avaliações formais.

**Limites explícitos:**

- Nunca misturar média device com média avaliação oficial em um mesmo gráfico sem separação visual clara
- Tags obrigatórias: 📱 cinza para device, 🩺 colorido para avaliação validada
- Relatórios oficiais (convênio, prontuário assinado) usam **somente** dados validados. Dado cru fica em "anexo de monitoramento" separado
- Dado cru (minuto a minuto HR) exige permission `devices.read_raw` + 2º consent do member; audit reforçado
- Copilot (Sprint 06) via RAG acessa agregados normalizados + mostra transparência de fonte em respostas ("Última oficial: X; dispositivo hoje: Y")

**Retenção:**

- **Dado cru** (minuto a minuto, batimento a batimento): rotação **90 dias** — cobre análise detalhada de overtraining/sono; limpado por job mensal
- **Agregados diários** (média HR do dia, peso do dia, recovery score do dia): retenção **indefinida** — alimenta histórico de evolução, tendências longas, IA futura
- Job `cleanup_raw_readings` roda mensalmente e remove `device_readings` com `measured_at < now() - 90 days` onde a leitura não está referenciada em nenhuma `assessment_measurement` (curada) — curadas ficam para sempre

**LGPD e consent:**

- Consent específico por provider (`device_consents`): member autoriza Garmin separado de Oura
- Revogar autorização apaga tokens imediatamente; leituras históricas permanecem até pedido explícito de apagamento
- Audit log em toda leitura cruzada (profissional vê dado biométrico de outro member)
- Regra 25 continua valendo (dado clínico em franchise não atravessa company)

**Testes:**

- Teste E2E: member conecta Garmin sandbox → sync puxa 10 atividades → widget mostra corretamente
- Teste E2E: BLE bioimpedância via mock device → leitura vira `device_readings` com observation_code=WEIGHT e BODY_FAT_PCT
- Teste E2E: revogar autorização para sync em seguida → ingestão zerada
- Seed: 1 member com Garmin simulado + 30 dias de dados históricos

## Dependências

- Sprint 02 (members)
- Sprint 01b (consent framework)
- Sprint 26 (portal do paciente web — precisa tela `/meu/dispositivos`)
- [ADR 0049 — Device Hub](../decisions/0049-device-hub-wearables-clinicos.md)
- [ADR 0047 — Cadastro central persons](../decisions/0047-cadastro-central-persons.md) (member_id é a chave)

## Decisões tomadas / ADRs esperados

- **ADR 0049 (accepted)** — Device Hub com provider abstrato + FHIR-like Observation + consent por provider
- **Pergunta aberta:** calibração cruzada entre fontes (peso Omron ≠ peso InBody). Decisão: reports deixam clara a fonte de cada medida; médias cross-fonte explicitamente evitadas; UI mostra "peso Garmin" vs "peso InBody" separados. Decidir formato de destaque durante o sprint.
- **Pergunta aberta:** quanto tempo guardar dado cru (HR minuto a minuto, stream contínuo)? Agregados por dia são eternos; dado cru pode rotacionar (30 dias?). Custo de storage é relevante. Decidir durante o sprint; LGPD diz o mínimo necessário.

## Módulos entregues

Ver [`modulos.md` — Geral](../modulos.md#geral):

- Device Hub (arquitetura provider abstrato)
- Normalizer Observation FHIR-like
- Adapter Garmin Connect API (cloud)
- Adapter Oura Ring API (cloud)
- Adapter Web Bluetooth bioimpedância doméstica
- Import CSV/FIT/TCX/GPX
- Config de dispositivos por member
- Widget "saúde 24h" no dashboard
- Consent específico por provider + revogação

## Rotas Next.js

- `/meu/dispositivos` — lista providers + status + conectar/desconectar
- `/meu/dispositivos/garmin/connect` — inicia OAuth Garmin
- `/meu/dispositivos/garmin/callback` — callback OAuth
- `/meu/dispositivos/oura/connect` · `/callback`
- `/meu/dispositivos/balanca-ble` — UI Web Bluetooth para emparelhamento
- `/meu/dispositivos/importar` — upload FIT/CSV/TCX
- `/meu/dispositivos/historico` — leituras ingeridas
- `/app/members/[id]/dispositivos` — profissional vê dispositivos conectados + agregados (se tem permission + consent)
- `/app/members/[id]/dispositivos/curar` (ADR 0049) — **curadoria profissional**: profissional seleciona leituras de `device_readings` + valida/edita + importa para `assessment_measurements` com rastreabilidade (`source_device_reading_id`, `validated_by_user_id`); UI lado-a-lado (leituras brutas × valor final da avaliação formal)
- `/app/settings/devices` — admin define quais providers ficam disponíveis no tenant (toggle por provider + credentials do app OAuth)
- `/app/settings/devices/[provider]` — config específica do provider (credentials OAuth app, rate limits, janela de sync, retention de dado cru 90d)
- `/meu/dispositivos/[provider]/consent` — member concede consent granular por provider (ADR 0049 — consent por integração separado); dá opt-in explícito a "compartilhar dados do Garmin com LogiFit + meu profissional"

## Server Actions + API Routes

Server Actions em `apps/web/app/meu/dispositivos/actions.ts`:

- `startConnection(provider)` — gera state OAuth e URL de auth
- `completeConnection(provider, code, state)` — troca code por tokens; grava em `device_connections`
- `disconnect(connectionId)` — revoga tokens + marca connection inactive
- `importFile(file, format)` — parser FIT/TCX/CSV + grava em `device_readings`
- `pairBleDevice(deviceName, deviceId, serviceUuid)` — registra pairing BLE (Web Bluetooth)

API Routes:

- `POST /api/jobs/devices/sync-hourly` — Vercel Cron
- `GET /meu/dispositivos/[provider]/callback` — OAuth callback
- `POST /api/devices/webhook/[provider]` — webhooks que providers suportam (Garmin, Fitbit; Oura usa pull)

## Schemas Drizzle (esperado)

Em `packages/db/schema/devices.ts`:

- `device_connections` — `id`, `tenant_id`, `member_id`, `provider` enum (`garmin`, `oura`, `fitbit`, `apple_health`, `google_health`, `ble_scale_omron`, `ble_scale_gtech`, `file_import`), `access_token_encrypted`, `refresh_token_encrypted`, `expires_at`, `external_user_id text`, `device_serial text nullable` (BLE), `status` enum (`active`, `error`, `revoked`), `last_synced_at`, `last_error text nullable`
- `device_readings` — `id`, `tenant_id`, `member_id`, `connection_id`, `observation_code text` (enum virtualmente: HR, HR_RESTING, HR_MAX, VO2_MAX, HRV, WEIGHT, BODY_FAT_PCT, MUSCLE_MASS_KG, SLEEP_DURATION_MIN, SLEEP_EFFICIENCY, STEPS, DISTANCE_KM, CALORIES_KCAL, READINESS_SCORE, RECOVERY_SCORE, GLUCOSE_MG_DL, VELOCITY_M_S, ROM_DEGREES, etc), `value numeric`, `unit text`, `measured_at timestamptz`, `source_provider text`, `source_device_id text nullable`, `metadata jsonb`, `ingested_at timestamptz`. Índices: `(tenant_id, member_id, observation_code, measured_at DESC)`; possível partição mensal se volume crescer.
- `device_sync_cursors` — `connection_id pk`, `last_synced_at timestamptz`, `last_observation_id text` (cursor do provider)
- `device_consents` — `id`, `tenant_id`, `member_id`, `provider`, `granted_at`, `revoked_at nullable`, `purposes text[]` (ex: `['academia_hr', 'nutri_weight', 'fisio_rom']`), `raw_data_access_granted bool`
- `device_incidents` — tracking de erros (rate limit, token expirado, calibração anômala)

**RLS:** tenant_id + scope; permission `devices.read` para leitura, `devices.read_raw` para dado não-agregado, `devices.admin` para config.

## Eventos de domínio emitidos

- `device.connected` / `device.disconnected`
- `device.sync_completed` — `{ connection_id, readings_count }`
- `device.sync_failed`
- `device.reading_ingested` (batch, um por sync; não uma-a-uma por performance)
- `device.consent_granted` / `device.consent_revoked`
- `device.raw_access_requested` (profissional solicitou dado cru — audit)

## Commit (checklist)

- [ ] Schema Drizzle: `device_connections`, `device_readings`, `device_sync_cursors`, `device_consents`, `device_incidents`
- [ ] RLS + testes (member vê só seus dispositivos; profissional vê por scope + permission)
- [ ] Interface `DeviceProvider` + hub em `packages/ai/devices/`
- [ ] Normalizer para Observation FHIR-like
- [ ] Adapter Garmin Connect (OAuth v2 + endpoints Activities, Sleep, VO2)
- [ ] Adapter Oura (OAuth v2 + Daily Activity/Sleep/Readiness endpoints)
- [ ] Adapter Web Bluetooth bioimpedância (Omron GATT service 0x181D + custom; G-Tech)
- [ ] Parser FIT em `packages/ai/devices/parsers/fit.ts`
- [ ] Parser TCX/GPX em `packages/ai/devices/parsers/tcx-gpx.ts`
- [ ] Parser CSV InBody em `packages/ai/devices/parsers/inbody-csv.ts`
- [ ] API routes OAuth callback + job Vercel Cron horário
- [ ] UI `/meu/dispositivos` completa
- [ ] Widget "saúde 24h" em dashboard do member
- [ ] **Integração com Sprint 12 Avaliações — curadoria pelo profissional:** `device_readings` é pool bruto; profissional em `/app/members/[id]/avaliacoes/new` vê leituras recentes compatíveis com o tipo de avaliação (peso, % gordura, HR, VFC, etc.) e **seleciona + valida + edita** quais viram `assessment_measurements` oficiais. Dado de dispositivo **nunca** vira medida clínica sem passar por validação humana (responsabilidade profissional preservada). Rastreabilidade: `assessment_measurements.source_device_reading_id` + `validated_by_user_id` + `validated_at`.
- [ ] Consent granular + revogação + audit
- [ ] Permission `devices.read`, `devices.read_raw`, `devices.admin`
- [ ] Seed: 1 member com dados Garmin simulado + leituras BLE fake
- [ ] Testes unit dos parsers (FIT, TCX, CSV InBody)
- [ ] Testes E2E: fluxo OAuth Garmin sandbox → sync → widget
- [ ] Feature flag `devices_v1`
- [ ] **Pesquisa global** (ADR 0062): **não indexa `device_readings` individualmente** (volume altíssimo, valor baixo); indexa `member_device_connections` como kind=`device_connection` (label=provider + member, `required_permission='devices.read'`) — permite operador achar "quais devices o João tem conectado"
- [ ] ADR 0049 publicado

## Stretch

- [ ] Adapter Fitbit Web API
- [ ] Webhook Garmin push (opcional, reduz polling)
- [ ] Dashboard profissional de "saúde populacional": % alunos com HR elevado, com sono inferior a 6h, etc (só agregados, anonimizado entre members)
- [ ] Detecção de anomalia: HR em repouso muito alto 3 dias seguidos → alerta para fisio/nutri via régua Sprint 13

## Log

- —

## Definition of Done

- [ ] Feature flag `devices_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] Pelo menos 2 providers cloud funcionais em sandbox (Garmin + Oura)
- [ ] Web Bluetooth bioimpedância testado com dispositivo real ou emulador
- [ ] Consent fluxo validado por jurídico
- [ ] RLS + audit verificados
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 32 → `done`
- [ ] ADR 0049 publicado

## Retro

- —
