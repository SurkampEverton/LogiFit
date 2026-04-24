# Sprint 31 — Geral · Diário Alimentar + Teleconsulta

- **Área:** geral (nasce para Nutri; teleconsulta aproveita Fisio e Nutri)
- **Início:** planejado (depois do Sprint 30)
- **Fim planejado:** +3 semanas
- **Status:** planejado (futuro)
- **Item do roadmap:** #29

## Goal

Dois módulos complementares para engajamento paciente-profissional:

1. **Diário alimentar**: paciente registra refeições reais (com foto) no portal (Sprint 26) → nutri valida/comenta.
2. **Teleconsulta**: videoconferência integrada respeitando sigilo médico (LGPD + CFM/COFFITO/CFN) — alternativa à consulta presencial.

## Critério de aceite

**Diário alimentar:**

- Paciente registra refeição em `/meu/diario` com: horário, alimentos consumidos (picker do catálogo Sprint 29 + texto livre), foto opcional (Storage), observação
- Entrada vinculada automaticamente ao dia/refeição do plano (Sprint 29) se houver plano ativo
- Desvio automaticamente calculado: "comi 500 kcal a mais que o previsto no almoço"
- Nutri vê diário em `/app/members/[id]/diario` — pode comentar, aprovar, sinalizar
- Comentário do profissional notifica paciente via régua (Sprint 13)
- Desafio semanal: "registrar 5 refeições" → conquista (Sprint 09)
- Relatório semanal: resumo dos desvios + tendências

**Teleconsulta:**

- Botão "iniciar teleconsulta" em appointment com kind `online` ou toggle
- Sala criada sob demanda com URL única + token; só profissional e paciente entram
- Gravação opcional (se consent) em Storage criptografado com retenção configurável
- Chat em tempo real durante chamada
- **Transcrição automática via Groq Whisper-large-v3-turbo (ADR 0064)** — áudio da gravação → `task='transcription'` no task routing → transcript estruturado em turnos ({"speaker": "profissional"|"paciente", "at": timestamp, "text": "..."}) armazenado em `consultas.transcript jsonb` (quando consent); custo ~US$ 0,04 por 10min → ~US$ 0,30/tenant/mês absorvido pelo LogiFit
- **Rascunho SOAP automático pós-transcrição** — após transcript pronto, dispara `task='chat'` agent `soap_drafter` que recebe transcript completo + contexto do paciente (última consulta, CIDs, plano ativo) + template SOAP da especialidade (Sprint 20 `assessment_types` com `category='anamnese'`) → gera rascunho em 4 seções (S subjetivo / O objetivo / A avaliação / P plano) preenchido → **profissional revisa, edita e assina** (não publica direto em prontuário oficial — regra 28 supervisão humana) → quando assinado vira `consulta.content` do Sprint 20
- **Rascunho marcado claramente como "gerado por IA"** com badge visual; audit registra `ai_audit_log` com decisão humana (accepted/edited/rejected)
- Feature flag `teleconsulta_stt_v1` permite desligar STT se tenant opt-out IA (ADR 0064)
- Integração com prontuário/evolução: pós-call, nutri/fisio **já vê rascunho SOAP pronto** (se STT ativo) ou registra consulta manual (se não)
- Respeita LGPD: provider de video não armazena conteúdo além do contrato + criptografia ponta-a-ponta se provider suporta; transcrição passa pelo Groq (DPA LogiFit + consent do titular cobre)

Testes E2E:
- Paciente registra 3 refeições no dia; nutri vê + comenta; paciente recebe notificação
- Paciente e profissional entram em sala; encerram; gravação disponível

## Dependências

- Sprint 26 (Portal do paciente)
- Sprint 29 (catálogo foods + plano ativo)
- Sprint 20 (consultas — teleconsulta gera consulta no fim)
- Sprint 13 (régua para notificações)
- Sprint 09 (conquistas)

## Decisões tomadas / ADRs esperados

- **ADR 0038 (esperado)** — Teleconsulta provider. Opções: Daily.co (simples, pay-per-use, boa reputação), Whereby Embed (white-label, plano fixo), Jitsi auto-hospedado (open source, operação própria), Twilio Video (robusto, caro). Critérios: LGPD (dados médicos via data processing agreement), custo por minuto, latência no Brasil, qualidade de gravação. Decisão com POC no início do sprint.
- **Pergunta aberta:** diário alimentar — paciente pode registrar sem plano ativo? Sim, permite; valor ainda é rastreabilidade.

## Módulos entregues

Ver [`modulos.md` — Geral](../modulos.md#geral):

- Diário alimentar (paciente) + validação (nutri)
- Cálculo automático de desvio vs plano
- Comentários profissional ↔ paciente
- Teleconsulta com provider abstrato
- Gravação de teleconsulta (opt-in)
- Transcrição automática (stretch)

## Rotas Next.js

- `/meu/diario` — paciente registra + vê histórico
- `/meu/diario/novo?meal=cafe|almoco|lanche|jantar|ceia` — entrada rápida
- `/meu/diario/semana` — visão semanal
- `/app/members/[id]/diario` — nutri vê + comenta
- `/app/members/[id]/diario/relatorio` — resumo semanal/mensal
- `/meu/teleconsulta/[appointmentId]` — sala do paciente
- `/app/teleconsulta/[appointmentId]` — sala do profissional
- `/app/teleconsulta/gravacoes` — lista (audit)

## Server Actions + API Routes

Server Actions:

- `logMeal(date, mealName, items[], photo?, notes?)` — paciente no portal
- `validateMealEntry(entryId)` / `commentMealEntry(entryId, body)` — nutri
- `generateDiaryReport(memberId, from, to)` — resumo com desvios
- `scheduleTeleconsultation(appointmentId)` — cria sala + token
- `endTeleconsultation(appointmentId, recordingPath?, transcriptPath?)` — finaliza, anexa à consulta

API Routes:

- `POST /api/diario/upload` — foto da refeição
- `POST /api/teleconsulta/webhook` — callback do provider (gravação pronta, etc)

## Schemas Drizzle (esperado)

Em `packages/db/schema/diario.ts`:

- `meal_log_entries` — `id`, `tenant_id`, `member_id`, `meal_plan_id nullable` (linka ao plano ativo), `date`, `meal_name text`, `logged_at timestamptz`, `foods_structured jsonb` (array `{ food_id, grams, measure? }`), `free_text_description text nullable`, `photo_storage_path nullable`, `notes_member text`, `calculated_nutrition jsonb` (kcal, macros calculados)
- `meal_log_reviews` — `entry_id`, `reviewed_by_user_id`, `status` enum (`approved`, `needs_adjustment`, `flagged`), `comment text`, `reviewed_at`

Em `packages/db/schema/teleconsulta.ts`:

- `teleconsultation_sessions` — `id`, `tenant_id`, `appointment_id`, `consulta_id nullable`, `provider text` (do ADR 0038), `room_id text`, `started_at nullable`, `ended_at nullable`, `recording_storage_path nullable`, `transcript_storage_path nullable`, `recording_consent_granted bool`, `transcription_consent_granted bool`, `participants_log jsonb`

**RLS:** diário — member vê os seus; nutri vê dos pacientes em scope. Teleconsulta — member vê sessões próprias; profissional vê sessões em scope. Dado clínico (regra 25).

## Eventos de domínio emitidos

- `meal.logged` / `meal.reviewed`
- `diary.weekly_report_generated`
- `teleconsultation.scheduled` / `teleconsultation.started` / `teleconsultation.ended`
- `teleconsultation.recording_ready`

## Commit (checklist)

- [ ] Schema Drizzle: `meal_log_entries`, `meal_log_reviews`, `teleconsultation_sessions`
- [ ] RLS + audit + franchise
- [ ] POC dos providers (ADR 0038) + escolha final com justificativa
- [ ] Wrapper de teleconsulta em `packages/ai/teleconsulta/provider.ts` (interface)
- [ ] API Routes de upload + webhook
- [ ] UI paciente em `/meu/diario` (mobile-first)
- [ ] UI nutri em `/app/members/[id]/diario` com aprovação rápida
- [ ] UI teleconsulta com preview de câmera, toggle mute/câmera, chat
- [ ] Relatório semanal PDF
- [ ] Integração com régua: `meal.reviewed` notifica paciente; diário parado 3 dias alerta nutri
- [ ] Integração conquistas: registrar 5 refeições → achievement
- [ ] Widget "diário recente" em `/app/members/[id]` (slot `diario`): `{ slot: 'diario', requiredPermissions: ['nutri.read'], requiredVertical: 'nutri', consentPurpose: null, showWhen: (m) => m.has_active_meal_plan }`
- [ ] Feature flags `diario_v1` e `teleconsulta_v1`
- [ ] ADR 0038 publicado

## Stretch

- [ ] Reconhecimento de alimento via IA a partir da foto (ex: "isso parece arroz + frango + salada")
- [ ] Diário por voz (ditar em vez de digitar)
- [ ] Teleconsulta em grupo (workshop nutricional com 10 pacientes)
- [ ] Compartilhamento de arquivo na teleconsulta (laudo, plano)
- [ ] Reminder automático pré-consulta (1h antes) via WhatsApp com link direto da sala

## Log

- —

## Definition of Done

- [ ] Feature flags ligadas em dev
- [ ] Testes unit + E2E verdes
- [ ] POC teleconsulta validado em sandbox
- [ ] Gravação criptografada em Storage confirmada
- [ ] Consent UI funcional (paciente aceita antes de gravar)
- [ ] RLS verificada
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 27 → `done`
- [ ] ADR 0038 publicado

## Retro

- —
