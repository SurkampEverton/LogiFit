# DPA — Data Processing Agreement template (LogiFit ↔ tenant CONTRATANTE)

> **Status:** v1.0-skeleton (criado 2026-04-26 — auditoria 19ª)
> **Próxima revisão obrigatória:** 2026-10-26 (semestral)
> **Aprovado por:** DPO LogiFit (Everton Surkamp Pereira) — ver [`dpo.md`](dpo.md)
> Template-base do Data Processing Agreement assinado entre LogiFit (operador LGPD art. 5º VII) e tenant CONTRATANTE (controlador). Anexo obrigatório do Termo de Uso do plano. Versão final completa será produzida pré-Sprint 02 quando passaporte cross-tenant entra em produção (ADR 0067 §"Escopo de impacto").

## Contexto regulatório

- **LGPD (Lei 13.709/2018) art. 39 + 40** — operador segue instruções do controlador; ambos respondem solidariamente em incidente.
- **Resolução ANPD nº 23/2024** — RIPD obrigatório para tratamento de larga escala de dados sensíveis (saúde — LGPD art. 11).
- **CFM 2.299/2021 + COFFITO 414/2012 + CFN 599/2018** — prontuário eletrônico tem requisitos específicos de retenção (20 anos / 5 anos).

## Estrutura mínima (a expandir Sprint 02)

### Cláusula 1 — Identificação das partes
- **Operador:** LogiFit Tecnologia Ltda. (CNPJ a registrar)
- **Controlador:** tenant CONTRATANTE (CNPJ informado no signup)
- **DPO Operador:** `privacidade@logifit.com.br` ([`dpo.md`](dpo.md))

### Cláusula 2 — Objeto e finalidade
LogiFit trata dados pessoais e dados pessoais sensíveis (saúde — LGPD art. 11) **exclusivamente** para prestação do serviço SaaS LogiFit conforme descrito em [`docs/comercial.md`](../comercial.md) e nos planos contratados.

### Cláusula 3 — Categorias de dado tratado
Listadas em [`lgpd-data-inventory.md`](lgpd-data-inventory.md) — referência explícita por categoria + base legal + retenção.

### Cláusula 4 — Sub-processadores
LogiFit utiliza os sub-processadores listados em [`dpo.md` §"Sub-processadores"](dpo.md). Tenant aceita lista atual; mudanças notificadas com **30 dias de antecedência** via email para o admin do tenant.

### Cláusula 5 — Medidas técnicas e organizacionais
Conforme [ADR 0073 — postura de segurança em profundidade](../decisions/0073-postura-seguranca-defesa-em-profundidade.md) (7 camadas: rede, auth/MFA, app, dados, IA, operacional, PAM super_admin) e regras 35-43 de [`rules.md`](../rules.md).

### Cláusula 6 — Direitos do titular
LogiFit cumpre as obrigações de operador para com os titulares através do controlador. Solicitações dirigidas diretamente ao LogiFit são respondidas em **15 dias úteis** (Resolução ANPD nº 2/2024) via [`/meu/privacidade`](../../apps/web/app/(portal)/meu/privacidade) ou `privacidade@logifit.com.br`.

### Cláusula 7 — Resposta a incidente
Plano detalhado em [`incidente-lgpd-72h.md`](../runbooks/incidente-lgpd-72h.md). LogiFit notifica o tenant em até **24 horas** após detecção; notificação ANPD em até **72 horas** conjunta.

### Cláusula 7-bis — Cross-tenant via Passaporte do Paciente
**Aplicável quando o tenant CONTRATANTE habilita o recurso "Passaporte do Paciente"** ([ADR 0077](../decisions/0077-passaporte-paciente-vinculo-cross-tenant.md)).

Texto canônico (espelhado de [ADR 0067 §Cláusula 7-bis](../decisions/0067-dpo-governanca-compliance-lgpd.md)):

> Caso o tenant CONTRATANTE habilite o recurso "Passaporte do Paciente" (ADR 0077), o tenant aceita que: (a) dados clínicos resumidos por ele gerados podem ser disponibilizados a outros tenants LogiFit mediante consent explícito e granular do titular; (b) dados recebidos de outros tenants via vínculo são **informativos** — toda decisão clínica continua sendo responsabilidade exclusiva do profissional do tenant CONTRATANTE com habilitação regulatória correspondente (CRM/CREFITO/CRN/CREF); (c) LogiFit atua exclusivamente como operador no fluxo cross-tenant, mantendo audit síncrono em `patient_data_access_log`; (d) qualquer incidente envolvendo dado cross-tenant aciona protocolo conjunto entre LogiFit + tenant-origem + tenant-destino + paciente, com notificação tripla à ANPD em 72h (regra 39 hash chain garante rastreabilidade); (e) o tenant CONTRATANTE pode desabilitar o recurso a qualquer momento via `/app/settings/privacidade/passport` — vínculos ativos continuam até paciente revogar individualmente, mas novos pedidos ficam bloqueados.

### Cláusula 8 — Retenção e eliminação
Conforme [`lgpd-data-inventory.md`](lgpd-data-inventory.md) por categoria. Eliminação reduzida quando há conflito com retenção legal — ver [`data-deletion-playbook.md`](data-deletion-playbook.md).

### Cláusula 9 — Auditoria
Tenant pode solicitar relatório de processamento (resumo de `audit_log` filtrado por `tenant_id`) em até **5 dias úteis**. Auditoria externa anual prevista para Fase 2 (50+ tenants).

### Cláusula 10 — Vigência
DPA é parte integrante do Termo de Uso do plano. Vigência igual ao contrato SaaS. Mudanças substantivas notificadas com 30 dias.

## Próximos passos antes de v1.0 final

- [ ] Sprint 02 — texto jurídico completo (jurídico LogiFit + escritório externo)
- [ ] Sprint 02 — versionamento via `dpa_versions` + `tenant_dpa_acceptances` (PDF assinado armazenado)
- [ ] Anexar política de privacidade pública (`politica-privacidade.md`)
- [ ] Anexar Termos de Uso (`termos-de-uso.md`)
- [ ] Validar com escritório de privacidade externo (jurídico LogiFit)

## Referências

- [ADR 0067 — DPO + governança compliance LGPD](../decisions/0067-dpo-governanca-compliance-lgpd.md) (cláusula 7-bis, sub-processadores, plano resposta incidente)
- [ADR 0077 — Passaporte cross-tenant](../decisions/0077-passaporte-paciente-vinculo-cross-tenant.md)
- [ADR 0054 — LGPD art. 11 + RIPD versionado](../decisions/0054-lgpd-art11-dados-saude-ripd-versionado.md)
- [`dpo.md`](dpo.md) — DPO interno LogiFit + sub-processadores
- [`lgpd-data-inventory.md`](lgpd-data-inventory.md) — inventário de categorias
- [`data-deletion-playbook.md`](data-deletion-playbook.md) — eliminação + retenção legal
- [`incidente-lgpd-72h.md`](../runbooks/incidente-lgpd-72h.md) — runbook de resposta
