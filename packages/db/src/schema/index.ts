/**
 * Single source of truth pro schema do banco (regra 3 + ADR 0004).
 *
 * `drizzle-kit generate` lê este re-export pra produzir migrations em
 * `packages/db/migrations/*.sql`.
 *
 * Convenção: cada agrupamento de tabelas em arquivo próprio
 * (`persons.ts`, `identity.ts`, `cnpj-cache.ts`, `better-auth.ts`,
 * `auth-attempts.ts`, ...), e este index reexporta tudo.
 *
 * **Por que auth schemas ficam em `@repo/db`** (não em `@repo/auth`):
 * `@repo/auth` consome `@repo/db` (precisa de adapter Drizzle + acesso
 * às tabelas). Inverter dependência criaria ciclo. Schemas são SQL state;
 * config + helpers de auth vivem em `@repo/auth`.
 */
export * from './persons'
export * from './cnpj-cache'
export * from './identity'

// Sprint 01a Faixa B — BetterAuth (ADR 0092) + LogiFit auth_attempts/auth_lockouts
export * from './better-auth'
export * from './auth-attempts'

// Sprint 01a Faixa C — RBAC com scope + recovery codes MFA (regra 43)
export * from './rbac'

// Sprint 01a Faixa F — audit_log + system_alerts (regras 5+34+39 + ADR 0071)
export * from './audit'

// Sprint 01b Faixa A — professional_registrations (ADR 0055) + franchise (ADR 0007) + consents (regra 29)
export * from './professional-registrations'
export * from './franchise'
export * from './consents'

// Sprint 01b Faixa B — passaporte cross-tenant (regra 42 + ADR 0077)
export * from './passport'

// Sprint 02b Path B — passport_signup_otps (cadastro proativo /cadastro pré-auth OTP SMS)
export * from './passport-signup'

// Sprint 02b2 — passport_global_identities (identidade global do paciente — ADR 0093)
export * from './passport-identity'

// Sprint 02b3 — passport_global_sessions (sessões dedicadas pra paciente passport — ADR 0094)
export * from './passport-session'

// Sprint 02b4 fechamento — passport_email_verification_tokens (email confirmation pós-signup)
export * from './passport-email-verification'

// Sprint 02b7 — feature_flags MVP self-host (ADR 0098)
export * from './feature-flags'

// Sprint 02 Faixa A — CRM unificado: members + member_events + member_notes + member_tags (ADR 0011 esperado)
export * from './members'

// Sprint 03 Faixa A — Agenda universal: resources + recurring_slots + appointments + waitlist (ADR 0012 esperado)
export * from './agenda'

// Sprint 04 Faixa A — Financeiro Asaas: plans + contracts + invoices + payments + asaas_keys + webhook_events (ADR 0013 + 0014 esperados)
export * from './financeiro'

// Sprint 05 Faixa A — Ofertas comerciais: promotions + plan_items + appointment_credits + referrals (ADR 0020 esperado)
export * from './ofertas'

// Sprint 06 Faixa A — IA arquitetura: providers + models + task_routing + tenant_usage + audit_log + assistant_sessions/messages + action_proposals + tools_registry (ADR 0064 + 0075)
export * from './ai'

// Sprint 06 Faixa B — RAG (documents/chunks) + cache semântico + member_insights + support_tickets (ADR 0064 + ADR 0070 esqueleto)
export * from './ai-rag'

// Sprint 06 Faixa C/D real — tenant_assistant_settings (white-label + persona overrides + classifier strictness)
export * from './ai-settings'

// Sprint 07 — Cross-alert dispatcher (esqueleto): alert_subscribers (vazio MVP, popula Fase 2)
export * from './alerts'

// Sprint 08 Faixa A — Academia controle de acesso: devices + secrets + events + blocks (ADR 0017+0018 esperados)
export * from './acesso'

// Sprint 01b fechamento — Compliance: ai_committees (CFM 2.454) + privileged_sessions (PAM) + data_subject_requests (LGPD art. 18)
export * from './compliance'

// Sprint 09 Faixa A — Engajamento: achievements + rewards_catalog + goals (ADR 0021 esperado)
export * from './engajamento'

// Sprint 10 Faixa A — Funil de vendas: lead_stages + leads + lead_events + trial_classes + proposals (ADR 0022 esperado)
export * from './vendas'

// Sprint 11 Faixa A — Treinos: exercises + workouts + workout_items + prescriptions (polimórfico) + workout_sessions + workout_session_items (ADR 0023 esperado)
export * from './treinos'

// Sprint 12 Faixa A — Avaliações físicas: assessment_types (com biblioteca global) + assessments + assessment_measurements + assessment_photos + assessment_calculations (ADR 0024 esperado)
export * from './avaliacoes'

// Sprint 13 Faixa A — Mensagens: message_providers + message_templates + reguas + regua_executions + messages_sent (ADR 0025 + 0026)
export * from './mensagens'

// Sprint 14 Faixa A — Custos operacionais + DRE: cost_categories + cost_entries + recurring_costs
export * from './custos'

// Sprint 15 Faixa A — ERP Financeiro Core: chart_of_accounts (hierárquico) + suppliers + approval_rules + accounts_payable + accounts_receivable + ap_ar_payments (ADR 0033 + 0034)
export * from './erp-financeiro'

// Sprint 16 Faixa A — Rateio entre filiais + Intercompany: allocation_rules + ap_allocations + intercompany_entries (ADR 0036). Regra 25 enforced via trigger (franchise bloqueia).
export * from './rateio-ic'

// Sprint 17 Faixa A — Bancos + Open Finance + Conciliação: bank_accounts + openfinance_connections + bank_transactions + reconciliation_rules (ADRs 0037 + 0038). bank_transactions @volume 6M+/ano (regra 34 + ADR 0072 — particionamento trimestral migration manual).
export * from './bancos'

// Sprint 17 Faixa A — Certificado digital A1 + NF-e SEFAZ cursors: company_certificates (PFX cifrado AES-256-GCM + senha separada) + nfe_sefaz_cursors.
export * from './certificados'

// Sprint 18 Faixa A — Adquirência (maquininhas): acquirer_connections + acquirer_sales + anticipations + acquirer_reconciliation_rules (ADR 0039 esperado). acquirer_sales @volume 12M+/ano (regra 34 + ADR 0072 — particionamento trimestral migration manual).
export * from './adquirencia'

// Sprint 19 Faixa A — Retenção/Churn: churn_features_snapshot + churn_predictions + churn_interventions + churn_events (ADR 0027 promover Accepted). churn_features_snapshot @volume 6M+/ano (regra 34 + ADR 0072 — particionamento trimestral migration manual). Fase 1 LLM Gemini classifier + cache 24h + fallback heurístico.
export * from './retencao'

// Sprint 20 Faixa A — Prontuário Fisio + CID-11 + CIF + signature_policies (ADR 0028 esperado + ADR 0032 Accepted). consultas @volume 6M+/ano (regra 34 + ADR 0072) + retenção 20 anos (Lei 13.787/2018). Política de assinatura por profissão (CFM 2.299/COFFITO 414/CFN 599) com gate de registro profissional ativo (ADR 0055).
export * from './fisio'

// Sprint 21 Faixa A — Evolução por sessão Fisio + anexos categorizados (exame_imagem/video_execucao/documento/foto_postural/audio_anamnese). evolucoes_sessao @volume 52M+/ano (regra 34 + ADR 0072 — top 5 volume MVP) + retenção 20a (Lei 13.787 + COFFITO 415). Anexos em MinIO bucket fisio-evolucoes com scanUpload obrigatório (regra 38) + URL assinada TTL 10min.
export * from './evolucoes'

// Sprint 22 Faixa A — TISS/TUSS + Convênios ANS: insurance_plans + tuss_catalog (versionado) + insurance_agreements + member_insurances + authorizations + billing_guides (TISS 4.01 ADR 0079) + billing_guide_items + billing_batches + billing_glosas. billing_guides @volume 2.4M+/ano (regra 34 + ADR 0072). ADRs 0029/0030/0031 esperados.
export * from './convenios'

// Sprint 23 Faixa A — Comissões e repasse profissional: professional_contracts (4 kinds × 4 bases) + commission_rules overrides + commission_entries + commission_periods. commission_entries @volume 18M+/ano (regra 34 + ADR 0072). ADR 0086 esperado. Gate ADR 0055 + retenções placeholder (ADR 0061 integração Sprint 23b).
export * from './rh'

// Sprint 24 Faixa A — Estoque + POS + Inventário: stock_items + stock_movements (append-only) + stock_inventories + stock_inventory_entries. stock_movements @volume 2.4M+/ano (regra 34 + ADR 0072). ADR 0087 esperado (PEPS vs custo médio). Saldo calculado por soma (não denormalizado).
export * from './estoque'

// Sprint 25 Faixa A — Vigilância Sanitária (ANVISA + CNES + limpeza): equipment + equipment_maintenance (fluxo manutenção externa com NF-e remessa/retorno ADR 0059 Sprint 36) + equipment_usage_log @volume 18M+/ano + cleaning_checklists + cleaning_logs.
export * from './vigilancia'

// Sprint 26 Faixa A — Portal do Paciente: member_auth_tokens (magic link 15min TTL) + member_sessions (refresh 30d multi-device) + member_consents (intra-tenant finalidades granulares). ADR 0088 esperado. RLS member role aplica em todas tabelas de domínio via 0045_portal_member_rls.sql.
export * from './portal-member'

// Sprint 27 Faixa A — Cross-alert lesão Fisio → ajuste treino Academia: cid_exercise_contraindications (global + tenant override) + member_injury_alerts (com blocked_reason audit) + workout_adaptations (suggested→confirmed via versionamento Sprint 11). ADR 0084 esperado. Regra 25 (franchise) + consent cross_module_share (Sprint 26) gates obrigatórios.
export * from './cross'

// Sprint 29 Faixa A — Nutri: banco alimentos TACO/USDA (global) + tenant custom + medidas caseiras + equivalências curadas + meal_plans versionado polimórfico (Sprint 11 prescriptions kind='meal_plan') + tenant_branding (PDF). ADRs 0080 + 0081 esperados. nutrients jsonb Zod-validated (30+ campos). meal_items @volume 2.4M+/ano — particionamento Sprint 29b.
export * from './nutri'

// Sprint 30 Faixa A — Nutri-labs: supplements (global + tenant) + supplement_interactions + supplement_prescriptions (consulta_id opcional Sprint 20) + lab_analytes (global) + lab_reference_ranges (1:N sex/age/condition) + lab_results (tenant + member, out_of_range denormalizado). ADR 0082 esperado. lab_results @volume 6M+/ano (regra 34 + ADR 0072 particionamento anual Sprint 30b). Retenção 20a Lei 13.787 + CFM 2.299.
export * from './nutri-labs'

// Sprint 31 Faixa A — Diário alimentar: meal_log_entries (paciente registra refeições) + food_log_daily_summary (agregado dia, alimenta calculateCaloricBalance ADR 0070) + meal_log_reviews (validações nutri). @volume 30M+/ano (regra 34 + ADR 0072 particionamento mensal Sprint 31b). Retenção 6m raw + agregado perpétuo.
export * from './diario'

// Sprint 31 Faixa A — Teleconsulta: teleconsultation_sessions (provider abstrato Daily/Whereby/Jitsi/Twilio — ADR 0083 esperado). Consent gravação + transcrição separados (LGPD art. 11). Rascunho SOAP IA Sprint 31b. Retenção 20a quando vincula a consulta.
export * from './teleconsulta'

// Sprint 32 Faixa A — Device Hub v1: device_connections (OAuth + BLE) + device_readings (FHIR-like Observation, @volume 180M+/ano, particionamento diário Sprint 32b retenção raw 90d) + device_readings_daily_summary (agregado perpétuo) + device_readings_curated (curadoria profissional Uso 1) + device_sync_cursors + device_consents (granular por provider + raw_data_access flag) + device_incidents. ADR 0049 esperado.
export * from './devices'

// Sprint 33 Faixa A — Pipeline Exames Laboratoriais: exam_documents (status workflow upload→processing→pending_review→published) + exam_extractions (OCR + IA structured) + exam_interpretations_draft (padrões+hipóteses conservadoras + classifier guard) + exam_interpretations_final (revisão profissional) + exam_review_edits (audit append-only) + tenant_exam_ai_settings (opt-out IA). ADR 0050 Accepted. @volume 2M+/ano. SaMD Classe II ANVISA RDC 657/2022.
export * from './exames'

// Sprint 34 Faixa A — Nutri-Agent IA: nutri_agent_runs (execução cross-module) + nutri_agent_suggestions (propostas pending/accepted/rejected revisão profissional obrigatória ADR 0044) + nutri_agent_metrics_snapshot (audit + reprodutibilidade). ADRs 0043+0044 esperados. SaMD Classe II ANVISA. Gate funcional: ai_committees.status='active' regra 13/28.
export * from './nutri-agent'

// Sprint 35 Faixa A — Mobile App Nativo backbone: mobile_app_versions (registry + min_required force update) + mobile_push_tokens (APNs/FCM com unique active por device + soft-revoke) + mobile_sessions (refresh 90d + device fingerprint distintas da web). ADRs 0045+0046 esperados. Sprint 35b/c entrega Expo project completo + APNs/FCM dispatcher real.
export * from './mobile'

// Sprint 36 Faixa A — Fiscal Emissions backbone (ADR 0059 Accepted): fiscal_emissions (8 kinds + status workflow + provider plug-in ADR 0076) + fiscal_events (append-only cancellation/CC-e/inutilizacao) + fiscal_numbering_sequences (atomic UPDATE...RETURNING) + fiscal_service_catalog (LC116/ISS/retenções) + fiscal_provider_credentials (AES-256-GCM cifrado KEK por tenant ADR 0073). @volume 3.6M+/ano (regra 34). Sprint 36b/c entrega payload builders 7 tipos + webhook Focus + portal contador + retencoes.
export * from './fiscal'

// Sprint 37 Faixa A — Fiscal Apuração Mensal backbone Grupo C (ADR 0100 Proposed): fiscal_revenue_aggregations (1:1 por tenant+company+year_month + snapshot tax_regime + memorial jsonb + status draft→closed) + fiscal_revenue_breakdown (1:N por emission_kind) + fiscal_simples_brackets (GLOBAL Anexos III+V vigentes + valid_from/to). @volume 12k+/ano (regra 34 não aplica). Sprint 37b/c entrega cron mensal + permissions RBAC + memorial PDF + Lucro Real completo + feature flag + E2E.
export * from './fiscal-apuracao'

// Sprint 24b — Vendas POS (ADR 0101; débito do Sprint 24): sales (comprador opcional + soft-cancel) + sale_items (snapshot fiscal sku/NCM/CEST no momento da venda) + sale_payments (método semântico → código SEFAZ na borda). Fonte de fiscal_emissions source_kind='sale' (NF-e produto + NFC-e — ADR 0059). @volume 200k/ano (regra 34 não aplica).
export * from './pos'

// Sprint 04b — Billing de uso mensal (ADR 0102 + ADR 0066; débito do Sprint 04): tenant_usage_snapshots (1 row por tenant+year_month; 4 cotas do plano — members/notas/IA/storage). Escrita só via job aggregate-usage-snapshots (UPSERT idempotente); leitura tenant próprio + super_admin.
export * from './billing'
