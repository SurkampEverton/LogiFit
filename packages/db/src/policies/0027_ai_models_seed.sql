-- packages/db/src/policies/0027_ai_models_seed.sql
-- Sprint 06 Faixa B — Seed de models + task_routing default (ADR 0064).
--
-- Default LogiFit: Gemini 2.5 Flash (Vertex AI) em chat/embedding/classification/
-- extraction/vision; Groq Whisper Large v3 Turbo em transcription; Anthropic
-- Claude Opus 4.7 em reasoning (BYOK opcional).
--
-- Fallback cascade priority:
--   priority=100 → default LogiFit (Gemini)
--   priority=200 → fallback 1 (Anthropic / OpenAI)
--   priority=300 → fallback 2 (OpenAI / Maritaca)
--
-- Pricing em micro-USD por 1M tokens (input_micros, output_micros) — capabilities
-- jsonb tem campo `pricing.input_per_million_micros` e `pricing.output_per_million_micros`.

-- ─── Models seed ────────────────────────────────────────────────────────
-- Gemini 2.5 Flash (default LogiFit) — Vertex AI SP
INSERT INTO ai_models (provider_id, slug, name, capabilities)
SELECT id, 'gemini-2.5-flash', 'Gemini 2.5 Flash',
  jsonb_build_object(
    'function_calling', true,
    'vision', true,
    'streaming', true,
    'context_window', 1048576,
    'output_window', 65535,
    'pricing', jsonb_build_object(
      'input_per_million_micros', 300000,
      'output_per_million_micros', 2500000
    ),
    'tasks_supported', jsonb_build_array('chat','classification','extraction','vision')
  )
FROM ai_providers WHERE slug = 'vertex-ai-gemini'
ON CONFLICT DO NOTHING;

-- Gemini 2.5 Pro — reasoning fallback (BYOK)
INSERT INTO ai_models (provider_id, slug, name, capabilities)
SELECT id, 'gemini-2.5-pro', 'Gemini 2.5 Pro',
  jsonb_build_object(
    'function_calling', true,
    'vision', true,
    'streaming', true,
    'context_window', 2097152,
    'output_window', 65535,
    'pricing', jsonb_build_object(
      'input_per_million_micros', 1250000,
      'output_per_million_micros', 10000000
    ),
    'tasks_supported', jsonb_build_array('chat','reasoning','vision','extraction')
  )
FROM ai_providers WHERE slug = 'vertex-ai-gemini'
ON CONFLICT DO NOTHING;

-- text-embedding-004 (768d) — embedding default
INSERT INTO ai_models (provider_id, slug, name, capabilities)
SELECT id, 'text-embedding-004', 'Gemini Embedding 004',
  jsonb_build_object(
    'function_calling', false,
    'vision', false,
    'streaming', false,
    'context_window', 2048,
    'embedding_dim', 768,
    'pricing', jsonb_build_object(
      'input_per_million_micros', 25000
    ),
    'tasks_supported', jsonb_build_array('embedding')
  )
FROM ai_providers WHERE slug = 'vertex-ai-gemini'
ON CONFLICT DO NOTHING;

-- Anthropic Claude Opus 4.7 — reasoning premium (BYOK)
INSERT INTO ai_models (provider_id, slug, name, capabilities)
SELECT id, 'claude-opus-4-7', 'Claude Opus 4.7',
  jsonb_build_object(
    'function_calling', true,
    'vision', true,
    'streaming', true,
    'context_window', 1000000,
    'output_window', 64000,
    'pricing', jsonb_build_object(
      'input_per_million_micros', 15000000,
      'output_per_million_micros', 75000000
    ),
    'tasks_supported', jsonb_build_array('chat','reasoning','vision','extraction')
  )
FROM ai_providers WHERE slug = 'anthropic'
ON CONFLICT DO NOTHING;

-- Claude Sonnet 4.6 — chat balanceado (BYOK)
INSERT INTO ai_models (provider_id, slug, name, capabilities)
SELECT id, 'claude-sonnet-4-6', 'Claude Sonnet 4.6',
  jsonb_build_object(
    'function_calling', true,
    'vision', true,
    'streaming', true,
    'context_window', 500000,
    'output_window', 32000,
    'pricing', jsonb_build_object(
      'input_per_million_micros', 3000000,
      'output_per_million_micros', 15000000
    ),
    'tasks_supported', jsonb_build_array('chat','reasoning','vision','extraction')
  )
FROM ai_providers WHERE slug = 'anthropic'
ON CONFLICT DO NOTHING;

-- OpenAI GPT-4 Turbo — fallback 2
INSERT INTO ai_models (provider_id, slug, name, capabilities)
SELECT id, 'gpt-4-turbo', 'OpenAI GPT-4 Turbo',
  jsonb_build_object(
    'function_calling', true,
    'vision', true,
    'streaming', true,
    'context_window', 128000,
    'output_window', 16384,
    'pricing', jsonb_build_object(
      'input_per_million_micros', 10000000,
      'output_per_million_micros', 30000000
    ),
    'tasks_supported', jsonb_build_array('chat','classification','extraction','vision')
  )
FROM ai_providers WHERE slug = 'openai'
ON CONFLICT DO NOTHING;

-- Groq Whisper Large v3 Turbo — STT
INSERT INTO ai_models (provider_id, slug, name, capabilities)
SELECT id, 'whisper-large-v3-turbo', 'Whisper Large v3 Turbo',
  jsonb_build_object(
    'function_calling', false,
    'vision', false,
    'streaming', false,
    'pricing', jsonb_build_object(
      'audio_minutes_per_micros', 4000
    ),
    'tasks_supported', jsonb_build_array('transcription')
  )
FROM ai_providers WHERE slug = 'groq'
ON CONFLICT DO NOTHING;

-- Maritaca Sabiá-3 — data residency BR (BYOK)
INSERT INTO ai_models (provider_id, slug, name, capabilities)
SELECT id, 'sabia-3', 'Maritaca Sabiá-3',
  jsonb_build_object(
    'function_calling', true,
    'vision', false,
    'streaming', true,
    'context_window', 32768,
    'output_window', 8192,
    'data_residency', 'BR',
    'pricing', jsonb_build_object(
      'input_per_million_micros', 5000000,
      'output_per_million_micros', 15000000
    ),
    'tasks_supported', jsonb_build_array('chat','classification','extraction')
  )
FROM ai_providers WHERE slug = 'maritaca'
ON CONFLICT DO NOTHING;

-- ─── Task routing seed (priority cascade) ──────────────────────────────
-- chat: Gemini Flash (default) → Claude Sonnet 4.6 → GPT-4 Turbo
INSERT INTO ai_task_routing (task, model_id, priority, scope, active)
SELECT 'chat'::ai_task, m.id, 100, 'global', true
FROM ai_models m WHERE m.slug = 'gemini-2.5-flash' ON CONFLICT DO NOTHING;

INSERT INTO ai_task_routing (task, model_id, priority, scope, active)
SELECT 'chat'::ai_task, m.id, 200, 'global', true
FROM ai_models m WHERE m.slug = 'claude-sonnet-4-6' ON CONFLICT DO NOTHING;

INSERT INTO ai_task_routing (task, model_id, priority, scope, active)
SELECT 'chat'::ai_task, m.id, 300, 'global', true
FROM ai_models m WHERE m.slug = 'gpt-4-turbo' ON CONFLICT DO NOTHING;

-- embedding: text-embedding-004 only (fallback é re-tentar)
INSERT INTO ai_task_routing (task, model_id, priority, scope, active)
SELECT 'embedding'::ai_task, m.id, 100, 'global', true
FROM ai_models m WHERE m.slug = 'text-embedding-004' ON CONFLICT DO NOTHING;

-- classification: Gemini Flash → Claude Sonnet → Sabiá
INSERT INTO ai_task_routing (task, model_id, priority, scope, active)
SELECT 'classification'::ai_task, m.id, 100, 'global', true
FROM ai_models m WHERE m.slug = 'gemini-2.5-flash' ON CONFLICT DO NOTHING;

INSERT INTO ai_task_routing (task, model_id, priority, scope, active)
SELECT 'classification'::ai_task, m.id, 200, 'global', true
FROM ai_models m WHERE m.slug = 'claude-sonnet-4-6' ON CONFLICT DO NOTHING;

-- extraction: Gemini Flash → Claude Sonnet → GPT-4
INSERT INTO ai_task_routing (task, model_id, priority, scope, active)
SELECT 'extraction'::ai_task, m.id, 100, 'global', true
FROM ai_models m WHERE m.slug = 'gemini-2.5-flash' ON CONFLICT DO NOTHING;

INSERT INTO ai_task_routing (task, model_id, priority, scope, active)
SELECT 'extraction'::ai_task, m.id, 200, 'global', true
FROM ai_models m WHERE m.slug = 'claude-sonnet-4-6' ON CONFLICT DO NOTHING;

-- vision: Gemini Flash → Claude Sonnet → GPT-4 Turbo
INSERT INTO ai_task_routing (task, model_id, priority, scope, active)
SELECT 'vision'::ai_task, m.id, 100, 'global', true
FROM ai_models m WHERE m.slug = 'gemini-2.5-flash' ON CONFLICT DO NOTHING;

INSERT INTO ai_task_routing (task, model_id, priority, scope, active)
SELECT 'vision'::ai_task, m.id, 200, 'global', true
FROM ai_models m WHERE m.slug = 'claude-sonnet-4-6' ON CONFLICT DO NOTHING;

-- transcription: Whisper only
INSERT INTO ai_task_routing (task, model_id, priority, scope, active)
SELECT 'transcription'::ai_task, m.id, 100, 'global', true
FROM ai_models m WHERE m.slug = 'whisper-large-v3-turbo' ON CONFLICT DO NOTHING;

-- reasoning: Claude Opus 4.7 → Gemini Pro → GPT-4
INSERT INTO ai_task_routing (task, model_id, priority, scope, active)
SELECT 'reasoning'::ai_task, m.id, 100, 'global', true
FROM ai_models m WHERE m.slug = 'claude-opus-4-7' ON CONFLICT DO NOTHING;

INSERT INTO ai_task_routing (task, model_id, priority, scope, active)
SELECT 'reasoning'::ai_task, m.id, 200, 'global', true
FROM ai_models m WHERE m.slug = 'gemini-2.5-pro' ON CONFLICT DO NOTHING;

INSERT INTO ai_task_routing (task, model_id, priority, scope, active)
SELECT 'reasoning'::ai_task, m.id, 300, 'global', true
FROM ai_models m WHERE m.slug = 'gpt-4-turbo' ON CONFLICT DO NOTHING;
