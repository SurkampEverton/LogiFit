# Inventário de dados pessoais LogiFit (LGPD)

> Tabela viva de **categorias de dado pessoal tratadas** + base legal + retenção. Referenciada em [ADR 0054](../decisions/0054-lgpd-art11-dados-saude-ripd-versionado.md).
> Atualizada **a cada nova tabela com dado pessoal** ou mudança de finalidade. Sincronizada com `consent_purposes` no banco (Sprint 01b).

- **Última atualização:** 2026-04-25 (stub inicial)
- **Próxima revisão obrigatória:** 2026-10-25 (semestral)

## Esquema da tabela

| Categoria | Tabela/coluna | Base legal LGPD | Retenção | Sub-processador | RIPD |
|---|---|---|---|---|---|
| **Identidade PF** | `persons (kind=pf, name, document, email, phone)` | art. 7º V — execução de contrato (member) ou art. 7º I — consentimento (lead) | 5a após encerramento + anonimização | Supabase | (escopo "Identidade") |
| **Identidade PJ** | `persons (kind=pj, name, document, address)` | art. 7º V — execução de contrato | 5a após encerramento | Supabase | — |
| **Endereço residencial** | `persons.address` | derivada da identidade | mesma da identidade | Supabase | — |
| **Saúde — prontuário** | `consultas.content` (criptografado) | art. 11 II "a" — tutela da saúde por profissional | **20 anos** (Lei 13.787/2018 + CFM 2.299) | Supabase + (Fase 2 Oracle Cloud) | v1.0-prontuario-fisio |
| **Saúde — exame laboratorial** | `lab_results` | art. 11 II "a" — tutela da saúde | **20 anos** (Lei 13.787) | Supabase + (Fase 2) | v1.0-exames-laboratoriais |
| **Saúde — evolução fisio** | `evolucoes_sessao` | art. 11 II "a" — tutela da saúde | **5 anos** (COFFITO 415/2012) | Supabase + (Fase 2) | v1.0-prontuario-fisio |
| **Saúde — diário alimentar** | `food_log` | art. 11 II "a" — tutela da saúde | 6 meses raw + 5 anos agregado | Supabase | v1.0-nutri-diario |
| **Biométrico — face embedding** | `member_face_embeddings` | art. 11 II "d" + consentimento explícito | enquanto member ativo + 90d após desativação | Supabase | v1.0-reconhecimento-facial |
| **Antropometria** | `assessment_measurements` | art. 11 II "a" — tutela da saúde | 5 anos + cold storage | Supabase | (parte de v1.0-prontuario-*) |
| **Wearable raw** | `device_readings` | consentimento específico por provider (ADR 0049) | **90 dias** raw + 1 ano agregado | Supabase | v1.0-device-hub |
| **Treino executado** | `workout_sessions` | art. 11 II "a" — tutela da saúde | 3 anos raw + 5 anos agregado | Supabase | v1.0-academia-treino |
| **Plano alimentar** | `meal_plans` + `meal_plan_meals` | art. 11 II "a" — tutela da saúde | 5 anos | Supabase | v1.0-nutri-plano |
| **Comunicação WhatsApp** | `whatsapp_messages` + `whatsapp_media` | consentimento explícito (`marketing_messages`) ou execução contrato | 1 ano | Twilio/Z-API/Meta + Supabase | v1.0-whatsapp |
| **Financeiro/cobrança** | `invoices`, `payments`, `accounts_receivable` | art. 7º V — execução de contrato + obrigação fiscal | **5 anos** (Lei 8.218/91 + LC 174/2020) | Asaas + Focus NFe + Supabase | (operacional, sem RIPD próprio) |
| **Auditoria** | `audit_log` (apend-only + hash chain) | art. 7º X — proteção do crédito ou exercício regular de direito | **5 anos** (LGPD + ADR 0072) | Supabase + R2 (cold) | (transversal) |
| **IA audit** | `ai_audit_log` | art. 11 II "a" — supervisão CFM 2.454 | 1 ano hot + 5 anos cold | Supabase + R2 | v1.0-pipeline-exames-ia + outros |
| **Cross-tenant access log** | `patient_data_access_log` | art. 7º X — proteção do crédito + LGPD direitos do titular | **5 anos** (auditoria obrigatória) | Supabase + R2 (cold) | v1.0-passaporte-paciente |

## Próximos passos

- Sprint 00: criar este arquivo (✓ feito)
- Sprint 01b: cada categoria gera entrada em `consent_purposes` + `retention_policies`
- Sprints clínicos (20/22/30/31/33/34): cada um produz seu RIPD `v1.0-{{slug}}.md` em `ripd/`
- DPO revisa esta tabela a cada 6 meses + **antes** de cada nova feature clínica

## Referências

- [ADR 0054 — LGPD art. 11 + RIPD versionado](../decisions/0054-lgpd-art11-dados-saude-ripd-versionado.md)
- [ADR 0072 — Escalabilidade banco + retenção + cold storage](../decisions/0072-escalabilidade-banco-particionamento-retencao-cold-storage.md)
- [docs/compliance/dpo.md](dpo.md)
