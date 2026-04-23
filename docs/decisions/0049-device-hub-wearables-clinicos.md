# ADR 0049 — Device Hub: integração de wearables e dispositivos clínicos

- **Status:** Accepted
- **Date:** 2026-04-23

## Context

O valor diferencial do LogiFit cresce quando o sistema ingere dados biométricos reais (HR, VO2, composição corporal, glicose, ROM, força) vindos de dispositivos que o member já usa no dia-a-dia. Sem isso, o produto depende de digitação manual e perde concorrência com apps focados em wearables (Whoop, Oura, Garmin Connect).

Categorias de dispositivos relevantes:

1. **Smartwatches consumer** — Apple Watch, Samsung Galaxy Watch, Garmin, Fitbit
2. **Anéis inteligentes** — Oura, Samsung Galaxy Ring
3. **Bioimpedância** — doméstica (Omron, G-Tech via BLE) e profissional (InBody 770, Relaxmedic via USB+CSV)
4. **Dispositivos clínicos** — dinamômetros digitais, IMUs (Xsens, Notch), encoders VBT, pistolas de massagem smart, eletroestimuladores vestíveis
5. **Sensor de glicose contínua (CGM)** — FreeStyle Libre via LibreView

Cada um tem caminho de integração próprio (cloud API, Bluetooth LE, USB proprietário, import de arquivo). A complexidade de manter adapters para 10+ providers é alta; precisa de abstração pluggável.

## Decision

Adotar **`Device Hub`** como módulo transversal com **interface `DeviceProvider` abstrata**, mesmo padrão arquitetural do OCR ([ADR 0035](0035-sem-implementar-ocr-ainda-mas-definido.md)) e CNPJ ([ADR 0048](0048-busca-cnpj-provider-abstrato.md)).

### Arquitetura

```
packages/ai/devices/
├── hub.ts                    # Orquestrador; roteia member+provider → adapter
├── provider.ts               # Interface DeviceProvider (authenticate, sync, ingest)
├── normalizer.ts             # Payload específico → Observation (FHIR-like)
├── providers/
│   ├── apple-health.ts       # iOS HealthKit via app nativo (Sprint 34)
│   ├── google-health.ts      # Health Connect via app nativo (Sprint 34)
│   ├── garmin.ts             # Garmin Connect API (OAuth cloud — Sprint 32)
│   ├── oura.ts               # Oura Cloud API (Sprint 32)
│   ├── fitbit.ts             # Fitbit Web API (stretch Sprint 32)
│   ├── libreview.ts          # FreeStyle Libre (futuro — contrato corporate)
│   ├── ble-scale.ts          # Bioimpedância doméstica (Web Bluetooth desktop; app nativo mobile)
│   ├── ble-dynamometer.ts    # Futuro
│   ├── ble-vbt.ts            # Futuro
│   ├── ble-imu.ts            # Futuro
│   └── file-import.ts        # CSV InBody, FIT/TCX/GPX
└── sync/
    └── cron.ts               # Pull horário dos providers cloud
```

### Modelo de dados normalizado (FHIR-like)

Toda leitura vira **Observation** no schema:

```
device_readings (
  id, tenant_id, member_id,
  observation_code text,     -- HR, VO2_MAX, WEIGHT, BODY_FAT_PCT, SLEEP_DURATION, STEPS, GLUCOSE, ROM, etc
  value numeric,
  unit text,                 -- bpm, ml/kg/min, kg, %, min, mg/dl, graus
  measured_at timestamptz,
  source_provider text,      -- garmin, apple_health, ble_scale_omron, etc
  source_device_id text,     -- device específico se identificável
  metadata jsonb,            -- contexto adicional (atividade, precisão, etc)
  ingested_at timestamptz
)
```

Normalização benefícios:
- Copilot consulta "HR média última semana" sem saber de qual fonte vem
- Dashboard cruza múltiplas fontes sem adapter específico
- Nutri-Agent (Sprint 33) cruza CGM + treino + antropometria com uma query

### Autenticação e consent

- **`device_connections`** por `member_id` + provider armazena `access_token`/`refresh_token` criptografados (padrão OAuth cloud) ou `device_id` + emparelhamento (BLE)
- **Consent específico por provider** (decisão do usuário): ao conectar Garmin, member autoriza explicitamente; autorização separada para Oura; etc
- Revogar autorização em `/meu/dispositivos` apaga tokens + impede ingestão futura (dados históricos permanecem até member pedir apagamento via LGPD direito ao esquecimento)

### Anonimização em reports

- Dashboard do profissional mostra por padrão **agregados** (média HR semana, % gordura mês, etc)
- Dado cru (stream de HR minuto a minuto, por exemplo) exige **2º consent específico** do member + justificativa do profissional; audit reforçado
- Nutri-Agent e Copilot acessam apenas agregados em prompts; dado cru só sob demanda explícita

### Faseamento

- **Sprint 32 Device Hub v1:** arquitetura core + cloud providers (Garmin, Oura) + BLE via Web Bluetooth (desktop Chrome/Edge) + import CSV/FIT/TCX
- **Sprint 33 Nutri-Agent:** consome Device Hub para enriquecer prompts
- **Sprint 34 App Nativo:** adiciona Apple Health + Google Health Connect + BLE mobile completo
- **Futuro (pós-35):** CGM (FreeStyle Libre LibreView corporate), dispositivos clínicos (IMU, dinamômetro, VBT), quando cliente pedir

### Limitações conhecidas aceitas

1. **iOS Safari PWA não suporta BLE nem HealthKit** — paciente iOS precisa baixar app nativo (Sprint 34) para integração full
2. **Manutenção contínua** — cada provider muda API periodicamente (Garmin mudou em 2024; Apple Health adiciona types a cada iOS)
3. **CGM corporate** — FreeStyle Libre exige contrato com Abbott (BR ou US); adiado até demanda real
4. **Calibração cruzada** — peso da balança doméstica ≠ peso InBody profissional. Reports deixam claro a fonte; não "mistura" médias entre fontes diferentes

## Consequences

### Positivas

- Valor clínico e esportivo alto — dados reais, não auto-reported
- Base normalizada FHIR-like permite queries simples cross-fonte
- Cliente Academia/Fisio/Nutri ganha visão unificada do aluno
- Nutri-Agent (Sprint 33) + Copilot (Sprint 06) ganham contexto rico
- Arquitetura pluggable reduz custo de adicionar novo provider futuro

### Negativas (mitigáveis)

- **Alto custo de manutenção** de 10+ adapters — mitigado por cobrir apenas "essenciais de mercado" (Garmin + Oura + Apple Health + Google Health Connect + BLE bioimpedância) inicialmente; outros só sob demanda
- **Dependência crítica do App Nativo (Sprint 34)** para integrações iOS/BLE completas — Sprint 32 cobre só cloud para mitigar; web PWA complementa com Web Bluetooth (Chrome desktop)
- **LGPD reforçada** — dado biométrico contínuo é especial; consent granular + anonimização obrigatórios; audit pesado
- **Falha de provider externo** — Garmin API cai: ingestão pausa, dados históricos permanecem; fallback manual (import FIT) sempre disponível

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Integração direta (1 provider por vez sem abstração) | Código repetitivo; adicionar novo provider vira refactor |
| Usar apenas cloud (sem BLE) | Perde bioimpedância doméstica + 50% dos dinamômetros/VBTs |
| Usar apenas BLE (sem cloud) | Perde Garmin/Oura que não têm BLE direto (só via Connect/Cloud) |
| Padronizar em HealthKit/Health Connect apenas | Força app nativo desde dia 1; Device Hub cloud-only via PWA fica inviável |
| Esperar Fase 4 | Cliente perde valor; concorrência (GymPass Wellness, Gympass Plus) oferece isso |

## Escopo de impacto

- **Sprint 32 (NOVO)** — Device Hub v1 com cloud providers + BLE Web + file import
- **Sprint 33 renumerado** — Nutri-Agent IA (era 32); consome Device Hub para enriquecer
- **Sprint 34 renumerado** — App Nativo Expo (era 33); adiciona Apple Health + Google Health Connect + BLE mobile
- **Sprint 35 renumerado** — Fiscal NFS-e (era 34)
- **Pós-34** — Prescrição adaptativa por RPE (agora depende de #34 App Nativo)
- **Sprint 12 Avaliações** — link para Device Hub: bioimpedância registra também em `device_readings` além de `assessment_measurements`
- **Sprint 30 Exames Nutri** — preparado para CGM futuro
- **docs/modulos.md** — módulos de Device Hub na área Geral
- **docs/arquitetura.md** — Device Hub como integração externa relevante
- **CHANGELOG.md** — entrada

## Related

- Complementa [ADR 0047 — Cadastro central persons](0047-cadastro-central-persons.md) (member_id é a chave)
- Usa mesmo padrão de [ADR 0035 — OCR provider abstrato] e [ADR 0048 — CNPJ provider abstrato]
- Informa Sprint 33 (Nutri-Agent) e Sprint 34 (App Nativo)
- Reforça regras 4 (criptografia at-rest para dado sensível), 6 (consent cross-module) e 25 (dado clínico cross-company em franchise)
