-- packages/db/migrations/0048_feature_flags.sql
-- Sprint 02b7 — feature_flags MVP (ADR 0098).
--
-- Tabela global (sem tenant_id) pra flags binárias on/off com cache
-- in-memory 60s no helper. Toggle hot via UPDATE (Sprint 02b7+ adiciona
-- UI admin /app/super-admin/feature-flags + audit_log integration).
--
-- metadata jsonb reservado pra evolução pós-MVP:
--   - rollout_percentage (0-100)
--   - tenant_overrides { tenantId: bool }
--   - cohort (segmentos por plano/criação/etc)

CREATE TABLE IF NOT EXISTS "feature_flags" (
  "key" text PRIMARY KEY,
  "name" text NOT NULL,
  "description" text,
  "enabled" boolean NOT NULL DEFAULT false,
  "enabled_at" timestamp with time zone,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Seed canônico — 10 flags MVP iniciais (todas disabled — operador habilita
-- quando feature estiver pronta pra prod). passport_signup_v1 fecha pendência
-- Sprint 02b4; demais estão em estado "futuro" alinhado com sprints.
INSERT INTO "feature_flags" ("key", "name", "description", "enabled") VALUES
  ('passport_signup_v1',  'Cadastro proativo do paciente', 'Habilita rota /cadastro Path B (paciente cria conta sem invite). Sprint 02b4.', false),
  ('genui_v1',            'Generative UI v1', 'Cards de relatório clínico via tool calls (Sprint 28).', false),
  ('device_hub_v1',       'Device Hub v1', 'Integração wearables + BLE + import CSV (Sprint 32).', false),
  ('diario_v1',           'Diário alimentar', 'Paciente registra refeições + nutri valida (Sprint 31).', false),
  ('teleconsulta_v1',     'Teleconsulta', 'Vídeo via Daily.co + gravação MinIO (Sprint 31).', false),
  ('teleconsulta_stt_v1', 'Teleconsulta STT', 'Transcrição automática via Groq Whisper (Sprint 31).', false),
  ('churn_v1',            'IA preditiva de churn', 'Score + intervenções de retenção (Sprint 19).', false),
  ('treinos_v1',          'Prescrições treino', 'Workouts + biblioteca exercícios + sessões (Sprint 11).', false),
  ('avaliacoes_v1',       'Avaliações físicas', 'Antropometria + bioimpedância + dobras (Sprint 12).', false),
  ('fisio_prontuario_v1', 'Prontuário fisio', 'COFFITO + CID-11/CIF + assinatura ICP-Brasil (Sprint 20).', false),
  ('adquirencia_v1',      'Adquirência', 'Maquininhas Cielo/Stone/Rede + split + antecipação (Sprint 18).', false),
  ('portal_member_v1',    'Portal do paciente', 'PWA /meu/* completo (Sprint 26).', false),
  ('custos_v1',           'DRE + custos operacionais', 'Lucratividade por procedimento (Sprint 14).', false),
  ('cross_alert_lesao_v1', 'Cross-alert lesão→treino', 'Adaptação automática de workout via CID (Sprint 27).', false)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE "feature_flags" IS
  'Sprint 02b7 (ADR 0098) — feature flags globais MVP. Toggle hot via UPDATE; cache helper 60s TTL. metadata jsonb reservado pra rollout%/overrides.';

COMMENT ON COLUMN "feature_flags"."key" IS
  'Slug do flag (lowercase + snake_case). Ex: passport_signup_v1.';

COMMENT ON COLUMN "feature_flags"."metadata" IS
  'Reservado pra evolução Sprint 02b7+: rollout_percentage, tenant_overrides, cohort.';
