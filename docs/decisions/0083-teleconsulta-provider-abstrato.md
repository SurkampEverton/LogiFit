---
slug: teleconsulta-provider-abstrato
status: proposed
date: 2026-05-18
---

# ADR 0083 — Teleconsulta provider abstrato (Daily.co default + Whereby/Jitsi/Twilio alternativas)

## Contexto

Sprint 31 entrega **Teleconsulta** integrada ao agendamento (Sprint 03) e prontuário (Sprint 20). Decisões fundamentais:

1. **Provider** — Daily.co? Whereby Embed? Jitsi auto-hospedado? Twilio Video?
2. **Arquitetura cliente** — embed iframe vs SDK JS nativo vs cliente próprio (WebRTC)?
3. **Gravação** — armazenamento próprio MinIO vs storage do provider?
4. **Transcrição** — provider tem? Groq Whisper? Sequencial pós-gravação ou ao vivo?
5. **LGPD + data residency** — provider pode armazenar conteúdo médico além do contrato?
6. **Consent** — quantos consents distintos? Onde gravar?
7. **Failover** — se provider cair?

## Decisão

### 1. **Provider abstrato com Daily.co como default + alternativas (Whereby/Jitsi/Twilio/Mock)**

Definimos uma **interface comum** `TeleconsultaProvider` em `packages/ai/src/teleconsulta/provider.ts`:

```ts
interface TeleconsultaProvider {
  readonly name: 'daily' | 'whereby' | 'jitsi' | 'twilio' | 'mock'
  createRoom(input): Promise<{ roomId, roomUrl, accessToken, expiresAt }>
  endRoom(roomId): Promise<void>
  generateAccessToken(input): Promise<{ token, expiresAt }>
}
```

`resolveTeleconsultaProvider(preferredName?)` retorna instância conforme env / `tenant_settings.teleconsulta_provider` (Sprint 31b).

**Default Daily.co** (justificativa após POC Sprint 31b):

- **Pay-per-use** ~$0.003/min/participante → ~$0.36/consulta de 30min × 2 participantes; barato pra adoção gradual
- **Latência boa no Brasil** (datacenter SP)
- **Gravação nativa** + webhook quando pronta
- **JWT tokens curtos** (controle de acesso granular)
- **DPA (Data Processing Agreement)** disponível (LGPD-compatible)
- **SDK JS robusto** + embed iframe configurável
- **Jitsi auto-hosted** considerado mas rejeitado MVP: operação própria + escalonamento + monitoramento + ICE servers próprios = overhead solo dev inaceitável

**Alternativas mantidas no resolver** (com flag tenant-level Sprint 31b+):

- **Whereby Embed** — plano fixo (~US$ 12/mês) bom pra tenants com volume alto previsível; UX premium
- **Jitsi auto-hosted** — Enterprise solo + soberania total; operação por conta do tenant
- **Twilio Video** — robusto mas caro ($0.004/min/participante + retenção paga); última opção
- **Mock** — dev/test (default no MVP até integrar Daily real Sprint 31b)

**MVP Sprint 31a entrega só Mock** — POC Daily real fica Sprint 31b (depende contrato + DPA assinado).

### 2. **Cliente embed iframe** (não SDK JS nativo)

Frontend usa `<iframe src={roomUrl}>` direto na rota `/app/teleconsulta/[sessionId]` (profissional) e `/meu/teleconsulta/[sessionId]` (paciente). Razões:

- **Zero JS bundle do provider** no LogiFit (provider carrega tudo no iframe; nosso bundle não cresce)
- **Isolamento de segurança** — iframe pode ter `sandbox` + `allow="camera; microphone"`
- **Update do provider** sem deploy nosso
- **Branding limitado** OK pra MVP (botão "← Voltar ao LogiFit" envolvendo iframe)

Sprint 31c: avaliar SDK nativo se branding/UX exigir customização profunda.

### 3. **Gravação no MinIO próprio** (NÃO no storage do provider)

Provider gera gravação → webhook `/api/teleconsulta/webhook` (Sprint 31b) → download + upload pro MinIO bucket `teleconsulta-gravacoes` + `scanUpload()` (regra 38) + storage path em `teleconsultation_sessions.recording_storage_path`.

**Por quê não deixar no provider** (rejeitado):

- **LGPD data residency**: provider pode estar fora do BR; LogiFit prefere data no Oracle Cloud SP/Hetzner
- **Lock-in**: se trocar de provider, gravação fica perdida
- **Custo**: Daily cobra extra por retenção; MinIO próprio é zero marginal
- **Audit chain**: gravação parte do prontuário (Lei 13.787 retenção 20a) — precisa estar no nosso store auditado
- **Criptografia em rest** controlada por nós (`LOGIFIT_DATA_KEY` envelope encryption Sprint 31b)

### 4. **Transcrição via Groq Whisper sequencial pós-gravação** (NÃO ao vivo)

Pós-call: job consome gravação (áudio extraído via ffmpeg) → `resolveModelForTask('transcription')` retorna Groq Whisper-large-v3-turbo (ADR 0064) → JSON estruturado em turnos:

```json
[
  { "speaker": "professional", "at": "00:00:05", "text": "Como está sua dor lombar?" },
  { "speaker": "patient", "at": "00:00:08", "text": "Melhorou bastante essa semana..." }
]
```

→ persistido em `teleconsultation_sessions.transcript jsonb` (quando `transcription_consent_granted=true`).

**Por quê pós-gravação e não ao vivo**:

- **Custo**: ao vivo via Daily transcript add-on cobra extra (~$0.015/min × participantes); Groq custa ~$0.04 por 10min de gravação → 4× mais barato
- **Qualidade**: Whisper-large-v3-turbo > transcrição ao vivo do provider em PT-BR
- **Audit**: Groq retorna confiança por trecho — útil pra flag passagens com baixa qualidade
- **DPA**: Groq Brasil-friendly + opt-out de treino confirmado em contrato

**Por quê não ao vivo de qualquer forma**:

- UX: profissional não olha pro transcript durante consulta — vai ler o rascunho SOAP depois
- Latência: STT real-time tem 1-2s de delay; mais distração que ajuda

### 5. **Provider tem que assinar DPA** (data processing agreement LGPD)

Antes de migrar do Mock pra Daily/Whereby/Twilio em produção:

1. Contrato + DPA assinado com cláusulas LGPD art. 11 + art. 33 (data residency BR ou DPA com cláusulas standard)
2. Auditoria de subprocessors do provider (Sprint 31b: documentar em `docs/compliance/sub-processors.md`)
3. RIPD `v1.0-teleconsulta.md` assinado pelo DPO antes de feature flag em prod

**Jitsi auto-hosted** dispensa DPA (provider = nós) mas reintroduz responsabilidade operacional total.

### 6. **Dois consents distintos** (gravação ≠ transcrição)

`teleconsultation_sessions.recording_consent_granted bool` e `transcription_consent_granted bool` separados. Paciente pode aceitar gravar (para revisão do nutri) mas recusar transcrição (não quer texto em IA). Check constraints garantem:

```sql
CHECK (recording_storage_path IS NULL OR recording_consent_granted = true)
CHECK (transcript IS NULL OR transcription_consent_granted = true)
```

UI dispara `<ConfirmDialog>` (regra 45) no início da sessão com texto LGPD por finalidade; Server Actions `acceptRecordingConsent` e `acceptTranscriptionConsent` separadas.

### 7. **Failover** — sem MVP

Se Daily cair durante a sessão, paciente + profissional reagendam (notificação via régua Sprint 13). Não vamos fazer multi-provider failover ao vivo — complexidade alta + Daily SLA 99.9% é suficiente.

Sprint 31c: se SLA piorar, avaliar `provider_fallback` em `tenant_settings` (Whereby de backup).

## Esquema persistido

1 tabela `teleconsultation_sessions` (já criada Sprint 31 Faixa A) — campos relevantes:

- `provider` enum (daily/whereby/jitsi/twilio/other)
- `room_id text` (slug no provider)
- `room_url text` (URL do iframe)
- `access_token text` (JWT curto)
- `recording_consent_granted bool` + `recording_storage_path text`
- `transcription_consent_granted bool` + `transcript jsonb` + `transcript_storage_path text`
- `ai_draft_soap jsonb` + `ai_draft_status text` ('pending' | 'generated' | 'accepted' | 'edited' | 'rejected')

Check constraints garantem consistência consent ↔ artefato.

## Server Actions implementadas (Sprint 31a)

`apps/web/app/app/teleconsulta/actions.ts`:

- `scheduleTeleconsultation({appointmentId, memberId, enableRecording, maxDurationMinutes, provider?})` — cria room via provider + persiste sessão `status='scheduled'`
- `startTeleconsultation({sessionId})` — `status='active'` + `started_at`
- `endTeleconsultation({sessionId, failureReason?})` — encerra room + `status='ended'` (ou `failed`); best-effort (não bloqueia se provider falha)
- `listTeleconsultations({status?, memberId?, limit})` — fila + filtros
- `acceptRecordingConsent({sessionId})` / `acceptTranscriptionConsent({sessionId})` — granulares

## Consequências

✅ **Positivas:**
- Interface abstrata permite trocar provider sem refactor das Server Actions
- Mock provider habilita dev/test sem dependência externa
- Gravação em MinIO próprio garante data residency + audit chain
- Consents granulares respeitam LGPD art. 11 (finalidades distintas)
- Transcrição via Groq Whisper desacoplada de provider de vídeo

⚠️ **Trade-offs aceitos:**
- Sprint 31a usa só Mock — POC Daily real Sprint 31b depende DPA assinado
- Embed iframe limita branding (aceitável MVP)
- Transcrição pós-gravação adiciona latência (~2-5min) — UX OK porque rascunho SOAP é assíncrono
- Sem failover multi-provider — depende SLA Daily 99.9% (Sprint 31c reavalia)
- UI canvas vídeo (preview câmera + chat realtime + toggle mute) fica Sprint 31b — MVP só lista de sessões

⚠️ **Decisões adiadas (Sprint 31b/c):**
- POC Daily.co real + DPA assinado + ADR promove pra Accepted
- UI canvas vídeo embed iframe + chat realtime + toggle mute/câmera
- Webhook `/api/teleconsulta/webhook` (gravação pronta, transcrição pronta)
- Job consome gravação → áudio → `resolveModelForTask('transcription')` Groq Whisper
- Rascunho SOAP via `soap_drafter` agent (Sprint 31b — ADR 0085 GenUI tool calling)
- `tenant_settings.teleconsulta_provider` (Enterprise pode escolher Whereby/Jitsi)
- RIPD `v1.0-teleconsulta.md` + DPO sign-off
- Feature flag `teleconsulta_v1` + `teleconsulta_stt_v1`
- Reminder pré-consulta via régua Sprint 13 (1h antes via WhatsApp com link da sala)
- Compartilhamento de arquivo dentro da sala (laudo, plano)
- Teleconsulta em grupo (workshop nutricional com 10 pacientes) — stretch
- E2E Playwright (schedule → join → end → recording disponível)

## Alternativas consideradas

| Opção | Rejeitada por |
|---|---|
| Jitsi auto-hosted MVP | Operação própria + ICE servers + monitoramento + escala = overhead solo dev inaceitável; valor pra futuro Enterprise |
| Twilio Video default | $0.004/min/participante mais caro + UX premium não é diferencial MVP |
| SDK JS nativo embed | Aumenta bundle LogiFit + acopla com versão do provider |
| Gravação no provider storage | Data residency + lock-in + retenção paga + audit fora do prontuário (Lei 13.787) |
| STT ao vivo Daily | 4× mais caro que Groq pós-gravação + qualidade PT-BR inferior + sem audit confiança |
| Consent único (gravação + transcrição) | LGPD art. 11 exige consent por finalidade — paciente pode aceitar gravar e recusar transcrever |
| Failover multi-provider | Complexidade alta + Daily SLA 99.9% suficiente; reagendamento via régua já cobre falha rara |

## POC plan (Sprint 31b)

1. Cadastrar conta Daily.co (free tier 10k min/mês) + obter DPA pra assinatura
2. Implementar `DailyTeleconsultaProvider` em `packages/ai/src/teleconsulta/daily.ts`
3. Testar fluxo end-to-end com 2 dispositivos reais
4. Medir latência + qualidade vídeo SP
5. Configurar webhook + bucket MinIO + scanUpload pipeline
6. Comparar custos reais 100 consultas Daily vs Whereby (plano fixo)
7. ADR promove pra Accepted com provider final + custo confirmado

## Status

Proposed — promove para **Accepted** quando Sprint 31b implementar POC Daily real + DPA assinado + RIPD + feature flag em piloto com ≥50 teleconsultas reais.

## Referências

- [Sprint 31 — Diário alimentar + Teleconsulta](../sprints/31-geral-diario-alimentar-teleconsulta.md)
- [ADR 0064 — IA arquitetura (resolveModelForTask `transcription`)](0064-ia-arquitetura-gemini-default-byok-rag.md) — Groq Whisper
- [ADR 0054 — LGPD art. 11 dados saúde](0054-lgpd-art11-dados-saude-ripd-versionado.md) — consent granular
- [ADR 0028 — Prontuário Fisio (teleconsulta gera consulta Sprint 20)](0028-cid-cif-catalogos-globais.md)
- [ADR 0085 — Generative UI (rascunho SOAP via tool calling Sprint 31b)](0085-generative-ui-framework.md)
- [ADR 0088 — Portal member magic link (paciente entra em `/meu/teleconsulta`)](0088-portal-member-magic-link-auth.md)
- Lei 13.787/2018 — retenção 20a (gravação vincula a prontuário)
- CFM 2.314/2022 — Telemedicina (consent + sigilo + criptografia)
- [regra 38 — scanUpload em todo upload MinIO](../rules.md#38-scanupload-uploads)
- [regra 45 — `<ConfirmDialog>` (consent UI)](../rules.md#45-mensagens-usuario)
