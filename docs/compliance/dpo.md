# DPO LogiFit (Encarregado pelo Tratamento de Dados Pessoais)

> Documento formal de nomeação do Encarregado, conforme **LGPD art. 41** (Lei 13.709/2018) + **Resolução ANPD nº 18/2024** (Encarregado).

## DPO atual (papel interino — fase MVP)

- **Nome:** Everton Surkamp Pereira
- **CPF:** (mantido off-line por privacidade; disponível mediante contrato com tenant ou autoridade)
- **Cargo na LogiFit:** Fundador / CTO
- **Email do canal oficial:** `privacidade@logifit.com.br`
- **Telefone do canal oficial:** (a configurar quando primeiro tenant pagante assinar)
- **Data de nomeação:** 2026-04-25
- **Vigência:** até **50 tenants pagantes** OU **1º tenant hospital/Enterprise**, o que ocorrer primeiro
- **Próxima revisão obrigatória:** 2026-10-25 (semestral)

## DPO suplente / cobertura (férias, incapacitação, indisponibilidade)

> **Obrigatório por LGPD art. 41** — Encarregado deve estar sempre disponível dentro do SLA. Solo dev sem suplente declarado é não-conformidade que ANPD pode autuar.

### Cobertura curta (até 7 dias — férias planejadas, viagem)

- **Estratégia:** auto-resposta `privacidade@logifit.com.br` informando indisponibilidade + canal de urgência (WhatsApp DPO ou email pessoal)
- **Resposta de titular adiada** dentro do SLA legal de 15 dias úteis (LGPD art. 18) — ainda OK
- **Incidente LGPD** durante esse período: titular ainda recebe email; runbook [incidente-lgpd-72h.md](../runbooks/incidente-lgpd-72h.md) tem `escalation_email` para advogado externo (item abaixo)

### Cobertura longa (>7 dias — incapacitação, internação)

- **Suplente designado:** **a contratar** — assessoria jurídica externa especializada em LGPD com SLA de cobertura de 72h
- **Status atual:** **PENDENTE** — pré-acordo a fechar antes do **1º tenant pagante**. Bloqueador comercial.
- **Candidatos avaliando** (atualizar quando contratado):
  - [ ] Opice Blum Advogados (privacidade@opiceblum.com.br) — ~R$ 3-8k/mês
  - [ ] BBL Advogados (LGPD especializada)
  - [ ] Manesco Ramires Perez (escritório boutique privacidade)
- **Escopo do contrato (mínimo):**
  1. SLA de resposta a ANPD em 24h em casos de incidente
  2. Cobertura férias/incapacitação do DPO interino (até 30 dias por evento)
  3. Revisão semestral de RIPDs + sub-processadores
  4. Drill simulado de incidente uma vez por ano

### Drill obrigatório

Antes do 1º tenant pagante, executar **simulação de incidente LGPD** com prazo de 72h:
- Cenário: vazamento simulado de 50 emails de members
- Objetivo: validar runbook + suplente externo + canal ANPD
- Resultado documentado em `compliance_retention_log` + ajustes no runbook

### Histórico de cobertura

| Data | Período | DPO efetivo | Motivo | Resultado |
|---|---|---|---|---|
| (a preencher quando ocorrer) | | | | |

### Atribuições (LGPD art. 41 §2º)

1. **Aceitar reclamações e comunicações dos titulares**, prestar esclarecimentos e adotar providências
2. **Receber comunicações da ANPD** e adotar providências
3. **Orientar funcionários e contratados** sobre as práticas a serem tomadas em relação à proteção de dados
4. **Executar demais atribuições** determinadas pelo controlador ou estabelecidas em normas complementares

## Compromissos operacionais

| Compromisso | SLA | Como cumprir |
|---|---|---|
| Resposta a titular (LGPD art. 18) | 15 dias úteis (Resolução ANPD 2/2024) | Portal `/meu/privacidade` (Sprint 26) + email `privacidade@logifit.com.br` |
| Notificação de incidente à ANPD | 72 horas | Plano de resposta documentado em [ADR 0067](../decisions/0067-dpo-governanca-compliance-lgpd.md) + tabela `security_incidents` |
| Atualização de RIPDs (Relatório de Impacto à Proteção de Dados) | Semestral | `docs/compliance/ripd/` versionado em git |
| Revisão da lista de sub-processadores | Quando muda + 30d aviso a tenants pagantes | `logifit.com.br/sub-processors` + tabela canônica neste documento (seção "Inventário de sub-processadores") espelhada em [ADR 0067](../decisions/0067-dpo-governanca-compliance-lgpd.md) |
| Auditoria interna de compliance | Trimestral | Checklist documentado em [ADR 0067](../decisions/0067-dpo-governanca-compliance-lgpd.md) |
| Comunicação pública | A cada mudança de DPO ou política | Atualização deste documento + Política de Privacidade do site |

## Inventário de sub-processadores

> **Obrigação LGPD art. 6º + Resolução ANPD nº 18/2024.** Lista pública mantida em `logifit.com.br/sub-processors` (a publicar no Sprint 00) com mesma versão deste documento. Tenants pagantes recebem aviso 30 dias antes de qualquer adição/troca.

| # | Provider | Categoria | Dado tratado | Jurisdição | Fase | Contrato/DPA | Link público |
|---|---|---|---|---|---|---|---|
| 1 | **Vercel** | Hospedagem aplicação + edge | Logs HTTP, env vars cifradas, código | US (multi-region edge) | MVP + Fase 2 | DPA Vercel padrão | [vercel.com/legal/dpa](https://vercel.com/legal/dpa) |
| 2 | **Supabase** | Banco PG + Auth + Storage + Realtime | Dados aplicação completos (cifrados at-rest) | SP — Brasil (region SA-East-1) | MVP (até Sprint 19b) | DPA Supabase padrão (BR data residency) | [supabase.com/legal](https://supabase.com/legal) |
| 3 | **Oracle Cloud OCI** | Postgres self-hosted (ARM Ampere free tier) | Dados aplicação completos (cifrados at-rest) | SP — Brasil | **Fase 2** (pós-Sprint 19b — [ADR 0078](../decisions/0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md)) | DPA Oracle Cloud | [oracle.com/legal/cloud](https://www.oracle.com/legal/cloud/) |
| 4 | **Cloudflare R2** | Object storage (mídia + backup off-site MVP) | Mídia clínica cifrada + dumps PG cifrados GPG | Multi-region (BR opt-in via Workers) | MVP + Fase 2 | DPA Cloudflare | [cloudflare.com/cloudflare-customer-dpa](https://www.cloudflare.com/cloudflare-customer-dpa) |
| 5 | **AWS S3** | Backup off-site Object Lock WORM | Dumps PG cifrados (camada extra além R2) | us-east-1 | **Fase 2** (regra 40 — [ADR 0073](../decisions/0073-postura-seguranca-defesa-em-profundidade.md)) | DPA AWS GDPR addendum | [aws.amazon.com/compliance/gdpr-center](https://aws.amazon.com/compliance/gdpr-center/) |
| 6 | **Asaas** | Pagamentos (boleto/Pix/cartão) + cobrança recorrente | Dados financeiros + identificação tenant/member | BR (SP) | MVP + Fase 2 | DPA Asaas + LogiFit | [asaas.com/termos](https://www.asaas.com/) |
| 7 | **Focus NFe** | Emissão fiscal unificada (NFS-e + NF-e + NFC-e + eventos) | Dados fiscais + cadastrais empresa/cliente | BR | MVP + Fase 2 ([ADR 0059](../decisions/0059-ciclo-fiscal-emissao-focus-nfe.md)) | DPA Focus NFe | [focusnfe.com.br/termos-de-uso](https://focusnfe.com.br/termos-de-uso/) |
| 8 | **Resend** | Email transacional | Email destinatário + corpo (sem dado clínico) | US/EU (multi-region) | MVP + Fase 2 | DPA Resend | [resend.com/legal/dpa](https://resend.com/legal/dpa) |
| 9 | **Sentry** | Error tracking + APM | Logs sanitizados (sem PII clínica via scrubber) | US (self-hosted EU opt) | MVP + Fase 2 | DPA Sentry | [sentry.io/legal/dpa](https://sentry.io/legal/dpa/) |
| 10 | **PostHog** | Product analytics | Eventos pseudonimizados (não-PII) | US (EU opt) | MVP + Fase 2 | DPA PostHog | [posthog.com/dpa](https://posthog.com/dpa) |
| 11 | **Logtail / Axiom** | Logs estruturados | Logs aplicação + audit não-clínico | US/EU | MVP + Fase 2 | DPA respectivo | [logtail.com](https://betterstack.com/) / [axiom.co](https://axiom.co/) |
| 12 | **Upstash Redis** | Rate limit + cache (chaves transientes) | Chaves de rate limit por (tenant_id, user_id, ip, endpoint) | US/EU (Global) | MVP + Fase 2 (regra 36) | DPA Upstash | [upstash.com/dpa](https://upstash.com/dpa) |
| 13 | **Google Cloud Vertex AI** | LLM default (Gemini 2.5 Flash) + OCR + embeddings | Prompts + respostas IA + extração documentos | **SP — Brasil (region southamerica-east1)** | MVP + Fase 2 ([ADR 0064](../decisions/0064-ia-arquitetura-gemini-default-byok-rag.md)) | DPA Google Cloud + region BR | [cloud.google.com/terms/data-processing-addendum](https://cloud.google.com/terms/data-processing-addendum) |
| 14 | **Groq** | Speech-to-Text (Whisper) | Áudio transcrição (teleconsulta + diário voz) | US | MVP + Fase 2 ([ADR 0064](../decisions/0064-ia-arquitetura-gemini-default-byok-rag.md)) | DPA Groq | [groq.com/dpa](https://groq.com/) |

### Sub-processadores opcionais (BYOK — responsabilidade do tenant)

Tenants podem optar por **trazer sua própria chave** (BYOK) para serviços de IA + pagamento, hipótese em que o provider do tenant **não é** sub-processador da LogiFit:

- **Anthropic / OpenAI / Maritaca** — IA BYOK ([ADR 0064](../decisions/0064-ia-arquitetura-gemini-default-byok-rag.md))
- **Asaas BYOK por company** — quando tenant opera com conta Asaas própria

### Política de mudança

1. **Adição/troca de sub-processador:** comunicação 30 dias antes via banner no app + email aos tenant_owner
2. **Tenant pode opor-se:** hipótese rara; LogiFit avalia caso a caso (downgrade de feature ou rescisão amistosa)
3. **Auditoria interna trimestral** valida que cada sub-processador tem DPA atualizado e jurisdição declarada bate com lista
4. **Hash da lista** publicado em `logifit.com.br/sub-processors/hash` para detectar mudança não-anunciada

## Limites do papel interino

- **LogiFit (DPO interno) NÃO assume responsabilidade legal de DPO terceirizado** para tenants — é o DPO da própria LogiFit (operador / sub-controlador, conforme contexto).
- Tenant que precisa de DPO próprio (clínicas com >500 titulares; hospitais; redes Enterprise) tem **duas opções**:
  - Designar DPO interno próprio
  - Contratar **DPO-as-a-service add-on** vendido como complemento do plano Enterprise — LogiFit revende firma especializada externa; **responsabilidade legal é do contrato tenant ↔ firma**, LogiFit é intermediária comercial

## Histórico de DPOs

| Período | DPO | Tipo | Motivo da mudança |
|---|---|---|---|
| 2026-04-25 → vigente | Everton Surkamp Pereira | Interino (fundador) | Designação inicial pré-MVP |

## Revisões deste documento

| Data | Mudança | Aprovado por |
|---|---|---|
| 2026-04-25 | Documento criado | Fundador |

## Referências

- [Lei 13.709/2018 (LGPD) art. 41](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)
- [Resolução ANPD nº 18/2024 — Encarregado](https://www.gov.br/anpd/pt-br)
- [ADR 0067 — DPO + Governança Compliance LGPD](../decisions/0067-dpo-governanca-compliance-lgpd.md)
- [ADR 0054 — LGPD art. 11 + RIPD versionado](../decisions/0054-lgpd-art11-dados-saude-ripd-versionado.md)
- Política de Privacidade pública (a publicar em `logifit.com.br/privacidade` no Sprint 00)
