# Playbook — Eliminação e anonimização de dados pessoais (LGPD art. 16 + 18 IV)

> Procedimento operacional formal para atender solicitações de **eliminação/anonimização** de dados pessoais, respeitando obrigações de retenção legal (prontuário 20a Lei 13.787, fiscal 5a, audit 5a).
> Citado por [ADR 0054](../decisions/0054-lgpd-art11-dados-saude-ripd-versionado.md) + [Sprint 01a — trial 30d](../sprints/01a-identidade-e-topology.md).

- **Versão:** v1.0
- **Data:** 2026-04-25
- **Próxima revisão obrigatória:** 2026-10-25 (semestral)
- **Aprovado por:** DPO (Everton Surkamp Pereira) — ver [docs/compliance/dpo.md](dpo.md)

## Contexto regulatório

LGPD **art. 16** lista hipóteses em que dado pessoal pode ser conservado mesmo após fim do tratamento:

1. **Cumprimento de obrigação legal/regulatória pelo controlador** (ex: prontuário 20a Lei 13.787; fiscal 5a; audit 5a LGPD)
2. **Estudo por órgão de pesquisa** (anonimizado)
3. **Transferência a terceiro** com observância dos requisitos de tratamento
4. **Uso exclusivo do controlador**, vedado acesso por terceiro, anonimizado os dados

LGPD **art. 18 IV** garante direito ao titular de "anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade com o disposto nesta Lei".

**Conclusão:** eliminação total nem sempre é possível. Estratégia LogiFit:
- **Eliminação possível** → executar (drop linha + cascade)
- **Eliminação bloqueada por retenção legal** → anonimizar PII (nome→"Anonimizado", documento→NULL, email/telefone→NULL, cifra-com-chave-perdida em conteúdo clínico) + preservar agregados estatísticos
- **Audit log nunca é eliminado** (regra 5 + 39 — append-only com hash chain)

## Tipos de solicitação

### Tipo A — Solicitação do titular (LGPD art. 18)

- Member/paciente pede via `/meu/privacidade` → cria `data_subject_requests` com `right='anonymization'` ou `'elimination'` + deadline 15d
- Admin tenant + DPO LogiFit avaliam:
  - Se sem retenção legal pendente → eliminação
  - Se retenção legal vigente → anonimização preservando dado retido
- Resultado documentado em `fulfilled_payload` + email ao titular

### Tipo B — Trial expirado D+44 (Sprint 01a)

- Job `process-trial-lifecycle` dispara em `subscription_status='trial_expired' AND trial_ends_at < now() - interval '30 days'`
- Anonimização **automática** sem intervenção humana (já consentida no signup)
- Preserva agregados (member_count, session_count, revenue_simulated) para analytics de funil de conversão

### Tipo C — Encerramento de contrato tenant

- Tenant cancela assinatura → `subscription_status='cancelled'`
- 30 dias de grace para export + reativação
- Após 30d: anonimização automática (mesma função `anonymize_trial_data`)
- Após 5 anos (retenção fiscal/audit): eliminação total possível mediante solicitação tenant_owner

## Função SQL canônica `anonymize_tenant_data(tenant_id uuid)`

Implementada em `packages/db/functions/anonymize-tenant-data.sql` (Sprint 01a).

**Cascata (ordem fixa para preservar integridade referencial):**

| Tabela | Ação | Justificativa |
|---|---|---|
| `persons` | `name='Anonimizado'`, `display_name=NULL`, `document=NULL`, `email=NULL`, `phone=NULL`, `birth_date=NULL`, `address=NULL`, `pii_anonymized_at=now()` | Identidade |
| `users.username` | `'anonimizado-' || substr(md5(id), 1, 8)` | Identidade técnica |
| `members.notes` | NULL (notas livres podem ter PII) | Identidade |
| `member_events.payload` | sanitizar JSONB removendo emails/telefones/CPFs detectados via regex | Timeline preserva tipos de evento, não conteúdo PII |
| `consultas.content` | re-cifrar com chave aleatória descartada (cifra-com-chave-perdida) | **Retenção 20a Lei 13.787 mantida**; conteúdo inacessível |
| `evolucoes_sessao.content` | re-cifrar com chave perdida | **Retenção 5a COFFITO 415 mantida** |
| `lab_results.raw_text` + `lab_results.extractions` | re-cifrar com chave perdida | **Retenção 20a Lei 13.787 mantida** |
| `assessment_measurements.notes` | NULL | Antropometria livre de PII |
| `food_log.note` | NULL | Diário pode ter PII |
| `device_readings` | mantém (já é só métrica + timestamp + provider, sem PII) | — |
| `whatsapp_messages.content` | re-cifrar com chave perdida + redact body | Retenção 1a |
| `invoices.notes` + `payments.raw_payload` | sanitizar PII detectada | **Retenção 5a fiscal mantida** |
| `nfe_received.xml_content` | mantém (XML fiscal não pode ser modificado) | **Retenção 5a fiscal mantida** |
| `audit_log` | **NÃO TOCAR** (append-only + hash chain — regra 5 + 39) | Audit trilha histórica |
| `patient_data_access_log` | **NÃO TOCAR** (auditoria 5a obrigatória — ADR 0077) | Trilha cross-tenant |
| `system_alerts` + `system_alert_occurrences` | sanitizar PII em payload | Retenção variada por severity |
| `ai_audit_log` | sanitizar input/output via regex PII | Retenção 1a + 5a cold |
| `data_subject_requests` | mantém (auditoria do próprio direito exercido) | LGPD art. 38 — accountability |

**Pós-cascata:** `tenants.subscription_status='anonymized'` + audit_log entry com `action='tenant.anonymized'` + `legal_basis='lgpd_art16_eliminacao'` + summary do que foi anonimizado (linhas afetadas por tabela, sem PII).

## Idempotência + reversibilidade

- **Idempotente:** rodar `anonymize_tenant_data(X)` 2 vezes não dá erro nem perde mais dado (verifica `pii_anonymized_at`)
- **NÃO reversível** (one-way) — chave de cifragem é descartada; documento/email/nome zerados
- **Backups pré-anonimização** mantidos pelo período de retenção do plano (7-90 dias por tier — ADR 0066)
- Caso titular conteste anonimização **dentro do período de backup**: restore parcial possível com aprovação DPO + auditoria reforçada

## Job + agendamento

- `/api/jobs/process-trial-lifecycle` (Sprint 01a) — diário às 03:00 UTC
  - Detecta `trial_expired` em D+44 → invoca `anonymize_tenant_data(tenant_id)`
  - Detecta `cancelled` em D+30 → mesmo
- `/api/jobs/process-data-subject-requests` (Sprint 01b) — diário às 03:30 UTC
  - Detecta `data_subject_requests.deadline_at < now() + interval '3 days'` + `status='in_review'` → alerta admin tenant + DPO LogiFit
  - Quando `status='approved'` por admin → invoca função apropriada (anonymize_member, delete_member, etc)

## Comunicação ao titular

Email automático em 3 momentos:

1. **Solicitação aceita:** "Recebemos sua solicitação de anonimização. Prazo: 15 dias. ID: {request_id}"
2. **Em revisão:** "Sua solicitação está sendo analisada. Algumas informações precisam ser preservadas por obrigação legal (ex: prontuário 20a Lei 13.787); o que pudermos eliminar/anonimizar, faremos."
3. **Concluída:** "Solicitação concluída. Resumo do que foi feito: {fulfilled_payload}. Caso discorde, contate `privacidade@logifit.com.br`."

## Auditoria

DPO revisa trimestralmente:
- Amostragem de 5% das `data_subject_requests` fechadas
- Verificação de cumprimento de SLA 15d
- Verificação de cascata correta (ex: `consultas.content` foi re-cifrada?)
- Relatório anexado em `compliance_retention_log` com `action='dpo_quarterly_review'`

## Em caso de falha

- Job `process-trial-lifecycle` falha → `system_alerts severity=critical category=compliance` + email DPO + retry manual via runbook (a criar quando primeiro caso surgir)
- Função SQL falha em meio à cascata → transação rollback (atomicidade) + alerta + investigação manual
- Se backup pré-anonimização não está disponível e titular contesta → escalar para fundador + jurídico

## Referências

- [Lei 13.709/2018 (LGPD) art. 16 + 18](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)
- [Lei 13.787/2018 — prontuário eletrônico 20a](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13787.htm)
- [ADR 0054 — LGPD art. 11 + RIPD versionado](../decisions/0054-lgpd-art11-dados-saude-ripd-versionado.md)
- [ADR 0066 — Plano comercial — trial 30d retenção](../decisions/0066-plano-comercial-pricing-trial.md)
- [ADR 0072 — Escalabilidade banco — retenção](../decisions/0072-escalabilidade-banco-particionamento-retencao-cold-storage.md)
- [Sprint 01a — Identidade + trial 30d](../sprints/01a-identidade-e-topology.md)
- [docs/compliance/dpo.md](dpo.md)
