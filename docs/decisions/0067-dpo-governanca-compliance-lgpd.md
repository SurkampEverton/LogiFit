# ADR 0067 — DPO + governança de compliance LGPD/CFM

- **Status:** Accepted
- **Date:** 2026-04-24

## Context

LogiFit processa **dados sensíveis de saúde** (LGPD art. 11) e atua em setor regulado (CFM 2.454/2026, CFN 599, COFFITO 414, ANVISA RDC 657/751). Para operar legalmente e ganhar a confiança de tenants clínicos, precisa:

1. **DPO (Data Protection Officer / Encarregado)** formalmente designado — LGPD art. 41 exige para controladores de dado (e LogiFit é controlador em vários contextos: usuários do LogiFit, cobrança Asaas, uso da plataforma) e recomenda para operadores de dado sensível
2. **Canal do titular público** (`privacidade@logifit.com.br`) — LGPD art. 18 §3º
3. **Política de privacidade + Termos de uso + DPA** publicadas e versionadas
4. **Registro ANPD** (opcional até o porte exigir, mas recomendado) — regulamento RANPD
5. **RIPD (Relatório de Impacto)** por módulo que processa dado sensível — ADR 0054 já iniciou
6. **Plano de resposta a incidente** (vazamento, acesso indevido) — 72h para notificar ANPD
7. **Auditoria periódica** (interna ou externa)

Hoje o projeto tem ADRs de compliance (0015 safety IA · 0053 CFM 2.454 · 0054 LGPD art. 11) mas **nenhum ADR trata governança operacional** — quem é o DPO, como incidente é tratado, com que frequência há auditoria, quais documentos são públicos.

Sem esse ADR: tenant clínico no contrato pede "quem é o DPO de vocês?" e LogiFit não tem resposta formal.

## Decision

### DPO (Encarregado de Dados)

**Fase inicial (até 50 tenants pagantes):**
- **DPO interino = fundador (Everton Surkamp)** — cumula papel enquanto empresa é pequena
- **Apoio jurídico externo** — escritório de direito digital (ex: Opice Blum, Mattos Filho, Baptista Luz ou equivalente) com retainer de 10h/mês (~R$ 2-5k/mês)
- Canal público: **`privacidade@logifit.com.br`** — redireciona para fundador inicialmente
- Registrado em Política de Privacidade com nome + email + CPF (opcional)

**Fase de escala (50+ tenants pagantes OU 1º tenant hospital/clínica médica):**
- **DPO dedicado** contratado CLT ou PJ (certificação EXIN PDPE ou Compliance Officer Data Protection)
- Orçamento: R$ 8-15k/mês (júnior) ou R$ 15-30k (pleno)
- Alternativa: **DPO-as-a-service** via empresas especializadas (Privacy Tools, OneTrust BR) — R$ 3-8k/mês com SLA
- Canal `privacidade@logifit.com.br` passa a redirecionar para DPO externo/interno

**Fase enterprise (tenant exige DPO próprio):** Enterprise plano (ADR 0066) pode incluir **DPO-as-a-service para o tenant** como add-on (R$ 1-2k/mês sobre o plano) — LogiFit revende serviço do parceiro jurídico.

### Canal do titular (LGPD art. 18 §3º)

- **Email público:** `privacidade@logifit.com.br` (registra no website + política)
- **Portal público** (pós-MVP): `logifit.com.br/privacidade` — formulário para titular (aluno/paciente de qualquer tenant) exercer direitos sem depender do tenant
- **Resposta inicial em 5 dias úteis**; execução em 15 dias (LGPD art. 18 §5º)
- **SLA formal** documentado em política

### Documentos públicos (gerados pelo LogiFit, acessíveis)

| Documento | Localização | Frequência revisão |
|---|---|---|
| **Política de Privacidade** | `logifit.com.br/privacidade` | Anual ou a cada mudança relevante |
| **Termos de Uso** | `logifit.com.br/termos` | Idem |
| **DPA (Data Processing Agreement) padrão** | download PDF no site + aceito no signup | Anual |
| **RIPD** (por módulo sensível) | `docs/compliance/ripd/*.md` — interno + resumo público | Semestral |
| **ROPA (Record of Processing Activities)** — LGPD art. 37 | interno + disponível sob pedido | Anual |
| **Política de Cookies** | `logifit.com.br/cookies` | Anual |
| **Sub-processors list** (Supabase, Asaas, Vercel, Google Cloud, Groq, Focus NFe, etc.) | `logifit.com.br/sub-processors` | Quando muda |
| **Termo de Consent do titular** (para tenant) | Templates em `/app/settings/compliance/consent-templates` | Anual |
| **Política de Retenção** (`retention_policies`) | `/app/settings/retencao` + público | Anual |

### RIPD por módulo (ADR 0054 formaliza)

Sprints que processam dado sensível têm RIPD obrigatório em `docs/compliance/ripd/`:

- **Sprint 01b** — Identidade + autenticação
- **Sprint 02** — Members (dados pessoais gerais)
- **Sprint 08** — Controle de acesso biométrico (foto/face se facial ativo)
- **Sprint 20** — Prontuário Fisio (dado saúde sensível)
- **Sprint 21** — Evolução + mídias clínicas
- **Sprint 22** — Convênios (dado plano saúde)
- **Sprint 25** — ANVISA (dado ambiente clínico)
- **Sprint 26** — Portal paciente PWA (dado pessoal + saúde)
- **Sprint 28** — Generative UI clínica
- **Sprint 30** — Suplementos + exames
- **Sprint 32** — Device Hub (dado biométrico contínuo)
- **Sprint 33** — Pipeline Exames (dado saúde + OCR)
- **Sprint 34** — Nutri-Agent IA cross-module
- Sprint de IA base (06) — RIPD global cobrindo uso de LLMs

Cada RIPD versionado em `ripd_documents` + `ripd_versions` (schema Sprint 01b, ADR 0054). Revisão semestral.

### Incidente de segurança — plano de resposta

**Triagem (dentro de 4h):**
- Alerta de Sentry/Logtail/PostHog anomaly + operador humano classifica severidade
- Severidades: **P0** (vazamento confirmado) · **P1** (vazamento suspeito) · **P2** (falha que expõe superfície) · **P3** (operacional)

**Ação P0/P1 (72h LGPD art. 48):**

| Hora | Ação |
|---|---|
| 0h | Registrar `security_incidents` (schema novo no Sprint 01b) |
| 0h-4h | Conter (revogar keys, bloquear IPs, rotacionar secrets) |
| 4h-24h | Investigar escopo (quais tenants, quais titulares, quais dados) |
| 24h-48h | Rascunho da comunicação para ANPD + titulares afetados + tenants |
| 48h-72h | **Notificar ANPD** (art. 48 §1º) via canal oficial com: descrição + data + dados afetados + medidas tomadas + titulares notificados |
| 72h-7d | Notificar **titulares afetados** via email individual + publicar **aviso público** em `logifit.com.br/seguranca` |
| 7d-30d | Post-mortem público (anônimo quanto a dados específicos) + melhoria implementada |

**Tabela nova (Sprint 01b):**

```sql
security_incidents
  id uuid pk
  severity enum ('p0','p1','p2','p3')
  status enum ('triaging','contained','investigating','resolved','closed')
  detected_at timestamptz
  reported_to_anpd_at timestamptz nullable
  affected_tenants uuid[]
  affected_data_categories text[]   -- 'health_data','personal_data','financial',...
  root_cause text nullable
  remediation text nullable
  notified_holders_count int default 0
  public_disclosure_url text nullable
  created_at
```

### Sub-processors (LGPD art. 33 — transferência internacional)

LogiFit mantém lista pública de sub-processores em `logifit.com.br/sub-processors`. Exigência da LGPD + de tenants enterprise. Lista atual (pós-MVP):

| Sub-processor | Serviço | País | Base legal |
|---|---|---|---|
| **Supabase** (AWS) | Database + Auth + Storage | US + SP (sa-east-1) | DPA + Cláusulas Padrão |
| **Vercel** | Hospedagem + CDN | US (global edge) | DPA + Cláusulas Padrão |
| **Google Cloud** (Vertex AI) | IA default (Gemini) | BR (São Paulo) | DPA — dentro do BR, sem art. 33 |
| **Groq** | IA STT (Whisper) | US | DPA + Cláusulas Padrão |
| **Anthropic / OpenAI** | IA fallback/BYOK | US | DPA + Cláusulas Padrão (quando LogiFit usa como fallback) |
| **Asaas** | Pagamentos | BR | DPA — dentro do BR |
| **Resend** | Email transacional | US | DPA + Cláusulas Padrão |
| **Sentry / PostHog** | Observabilidade | US | DPA + Cláusulas Padrão |
| **Logtail (Better Stack)** | Logs | US | DPA + Cláusulas Padrão |
| **Focus NFe** | Emissão fiscal | BR | DPA — dentro do BR |
| **Upstash Redis** | Rate limit + cache | US | DPA + Cláusulas Padrão |

Mudança de sub-processor (adicionar/remover) gera aviso 30d antes a todos tenants pagantes.

### Auditoria

**MVP (primeiros 12 meses):**
- **Auditoria interna** trimestral — fundador revisa checklist de compliance (RIPD atualizado, incidentes, logs retention, sub-processors)
- **Pentest gratuito ou barato** — OWASP ZAP + SQLMap via CI; um pentest profissional (~R$ 5-8k) após 6 meses produção

**Pós-MVP (50+ tenants):**
- **Auditoria externa anual** — firma independente (BDO, Grant Thornton, KPMG Privacy ou boutique LGPD) — orçamento R$ 15-30k/ano
- **Relatório de Conformidade** público em `logifit.com.br/conformidade` (versão resumida)
- **Certificações consideradas** (quando fizer sentido comercial):
  - ISO 27001 (segurança da informação) — R$ 80-150k + manutenção
  - ISO 27701 (privacidade) — extensão da 27001
  - HIPAA (se atender mercado US — fora escopo atual)

### Consent do titular — operacional

Já coberto em ADR 0054. Este ADR formaliza:

- **Consent Management Platform (CMP)** no site público — banner de cookies (Essenciais / Analytics / Marketing)
- **Cookies consent log** em tabela pública (não-autenticada)
- **Revogação simples** em `logifit.com.br/privacidade/cookies`

### Governança interna — papéis

| Papel | Responsabilidade | Quem (MVP) |
|---|---|---|
| **Controlador** | Decisões sobre dado | Tenant (para dado do member/paciente); LogiFit (para dado do tenant) |
| **Operador** | Tratamento do dado | LogiFit (para dado do tenant + member) |
| **DPO / Encarregado** | Canal LGPD, resposta a titular, ANPD | Fundador (fase inicial); DPO externo (fase escala) |
| **DevSec** | Segurança técnica (RLS, criptografia, secrets) | Fundador |
| **Jurídico** | Contratos, DPA, termos | Escritório externo (retainer) |
| **Suporte** | Resposta ao usuário operacional | Fundador (fase inicial) |
| **Auditor** | Revisão periódica de conformidade | Firma externa (contratar quando escalar) |

### Co-controllership LGPD cross-tenant (addendum 2026-04-25 — ADR 0077)

[ADR 0077](0077-passaporte-paciente-vinculo-cross-tenant.md) introduz cenário inédito: dado clínico de um paciente cruza tenants comerciais distintos via vínculo + consent granular. Isso muda o modelo de papéis LGPD **nesse fluxo específico** — fora do passaporte, modelo Controlador (tenant) + Operador (LogiFit) continua valendo.

**Papéis no fluxo cross-tenant:**

| Papel | Quem | Responsabilidade |
|---|---|---|
| **Titular** | Paciente | Dono do dado; consente, revoga, acessa, audita |
| **Controlador-origem** | Tenant que GEROU o dado (ex: Clínica Bem-Estar produziu evolução de fisio) | Decide sobre dado original; retém pelo prazo legal (CFM 2.299 / COFFITO 415: 20 anos) |
| **Controlador-destino** | Tenant que RECEBE resumo via vínculo (ex: Academia Forma vê "lesão lombar ativa, restrição: sem deadlift") | Decide sobre uso operacional do dado recebido (planejamento de treino); não copia, apenas lê |
| **Operador único** | LogiFit | Trafega + armazena + audita; nunca decide finalidade |

Tenant-origem e Tenant-destino são **co-controladores funcionalmente** no fluxo: o paciente consentiu via `patient_company_links` + `patient_link_modules`. Cada um responde por suas decisões sobre o uso do dado em seu domínio (CFM/COFFITO/CFN/CONFEF do profissional de cada lado).

**Cláusula nova no DPA padrão LogiFit↔tenant:**

> **Cláusula 7-bis (Cross-tenant via Passaporte do Paciente):** Caso o tenant CONTRATANTE habilite o recurso "Passaporte do Paciente" (ADR 0077), o tenant aceita que: (a) dados clínicos resumidos por ele gerados podem ser disponibilizados a outros tenants LogiFit mediante consent explícito e granular do titular; (b) dados recebidos de outros tenants via vínculo são **informativos** — toda decisão clínica continua sendo responsabilidade exclusiva do profissional do tenant CONTRATANTE com habilitação regulatória correspondente (CRM/CREFITO/CRN/CREF); (c) LogiFit atua exclusivamente como operador no fluxo cross-tenant, mantendo audit síncrono em `patient_data_access_log`; (d) qualquer incidente envolvendo dado cross-tenant aciona protocolo conjunto entre LogiFit + tenant-origem + tenant-destino + paciente, com notificação tripla à ANPD em 72h (regra 39 hash chain garante rastreabilidade); (e) o tenant CONTRATANTE pode desabilitar o recurso a qualquer momento via `/app/settings/privacidade/passport` — vínculos ativos continuam até paciente revogar individualmente, mas novos pedidos ficam bloqueados.

**Cláusula nova no Termo de Uso paciente↔LogiFit:**

> **Seção 5 — Compartilhamento entre profissionais (Passaporte):** Você pode autorizar que profissionais de empresas distintas que usam o LogiFit visualizem categorias específicas dos seus dados de saúde. O LogiFit transmite apenas o que você liberou, em formato resumido (não bruto), e registra cada acesso para sua consulta em `/meu/privacidade/acessos`. Você pode revogar ou pausar acessos a qualquer momento — o efeito é imediato. Profissionais que receberem seus dados são juridicamente responsáveis pelas decisões clínicas que tomarem com base neles, conforme habilitação do conselho profissional. O LogiFit é operador (LGPD art. 5º VII): nunca decidimos finalidade nem usamos seus dados além do que você autorizou. Dados sensíveis de saúde (LGPD art. 11) trafegam com base legal art. 11 §2º II.f (procedimento realizado por profissionais de saúde) combinada com seu consent específico por categoria.

**Plano de resposta a incidente cross-tenant** (extensão do plano P0/P1):

| Hora | Ação adicional cross-tenant |
|---|---|
| 0h | Acionar canal conjunto: DPO LogiFit + DPO tenant-origem + DPO tenant-destino |
| 0h-4h | Conter: pausar todos os vínculos do paciente afetado; suspender acesso cross-tenant temporariamente via feature flag global emergencial; revogar tokens de invite ativos |
| 4h-24h | Investigar escopo: query em `patient_data_access_log` por person_id afetado + module_type + janela temporal; identificar tenants envolvidos |
| 24h-72h | **Notificação tripla a ANPD:** LogiFit (operador) + cada tenant envolvido (controlador). Notificação ao paciente afetado direta pelo LogiFit (canal preferencial — `/meu/privacidade/incidentes`) + comunicação obrigatória aos tenants. |
| 72h-7d | Post-mortem público inclui linha do tempo cross-tenant + número de pacientes afetados + número de tenants origem/destino envolvidos (anonimizado) |

**Sub-processor vs co-controlador no passaporte:**

Cada tenant-destino é, do ponto de vista do tenant-origem, um **sub-controlador autorizado pelo titular** — não sub-processor (sub-processor é quem trata dado em nome do controlador, e tenant-destino trata em nome próprio com base legal própria). Lista pública de sub-processors LogiFit (`logifit.com.br/sub-processors`) não muda; lista de **tenants vinculados ao paciente** vive em `/meu/privacidade/compartilhamento` (visível apenas pro paciente).

**RIPD específico do passaporte (Sprint 02 entrega):**

`docs/compliance/ripd/passport-cross-tenant.md` cobrindo:

- **Finalidade:** continuidade do cuidado interdisciplinar autorizada pelo titular
- **Base legal LGPD:** art. 11 §2º II.f (proteção da saúde, em procedimento realizado por profissionais de saúde) + consent específico granular por categoria
- **Categorias de dado:** conforme 5 níveis ADR 0077 (Identidade, Antropometria, Treino, Clínico, Workspace — Workspace **nunca** cruza tenant)
- **Volume estimado:** ~30% dos pacientes vão habilitar (hipótese a validar com dados reais 6 meses pós-lançamento)
- **Risco residual:** vazamento por tenant-destino comprometido (mitigação: audit chain regra 39 + revogação imediata pelo paciente + tenant-origem pode bloquear unilateralmente em caso de incidente do tenant-destino)
- **Retenção:** dado cross-tenant **não é copiado** — tenant-destino apenas LÊ via query em runtime; só fica em `patient_data_access_log` retido 5 anos
- **Direitos do titular:** revogação imediata em `/meu/privacidade/compartilhamento`; export de log em `/meu/privacidade/acessos` (CSV + PDF assinado); pausa temporária com retomada agendada
- **Transferência internacional:** dado nunca sai do BR (Vertex AI São Paulo, Supabase sa-east-1)

Revisão semestral; primeira revisão em 2026-10-25.

**Atualizações em "Governança interna — papéis":**

Tabela acima ganha 2 linhas extras quando recurso passaporte estiver ativo:

| Papel | Responsabilidade | Quem (MVP) |
|---|---|---|
| **Co-controlador (tenant-origem)** | Decide sobre dado original; retém prazo legal | Tenant que gerou o dado |
| **Co-controlador (tenant-destino)** | Decide sobre uso operacional do dado recebido; responde pela decisão clínica do seu profissional | Tenant que recebe via vínculo |

### Custo operacional estimado (MVP → escala)

| Fase | DPO | Jurídico | Audit | Total/mês |
|---|---|---|---|---|
| **Fase 0** (0-10 tenants) | R$ 0 (fundador) | R$ 2k | R$ 0 | **R$ 2k** |
| **Fase 1** (10-50 tenants) | R$ 0 (fundador) | R$ 3k | R$ 500 (ferramenta ZAP/CI) | **R$ 3,5k** |
| **Fase 2** (50-200 tenants) | R$ 5k (DPO-as-a-service) | R$ 5k | R$ 2k (audit trimestral interna + anual externa amortizada) | **R$ 12k** |
| **Fase 3** (200+ tenants, enterprise) | R$ 15k (DPO dedicado) | R$ 10k | R$ 4k | **R$ 29k** |

**Marco gatilho** para cada transição: 1º tenant clínico-médico OU número de tenants específico (50/200).

## Consequences

### Positivas

- **Tenant clínico fecha contrato sem fricção** — "quem é o DPO?" "quer ver nosso RIPD?" — tudo pronto
- **ANPD não pega ninguém de surpresa** — registro + DPO + canal + resposta a incidente + documentos = LogiFit passível de auditoria sem revírio
- **Enterprise valoriza** — DPA público + lista de sub-processors + SLA de incidente é discovery call fechada
- **Custo escalona com volume** — MVP fica barato (~R$ 2k/mês); só cresce quando tenant enterprise paga pra cobrir
- **Incidente tratado tem rastro** — `security_incidents` + post-mortem público gera confiança vs ocultar
- **DPO-as-a-service vira receita** — Enterprise plano embute; LogiFit vira intermediador do jurídico

### Negativas (mitigáveis)

- **Custo mínimo R$ 2k/mês desde Fase 0** — mitiga escolhendo escritório com retainer flexível (10h/mês) em vez de contrato gordo
- **Fundador cumula DPO não é ideal** — aceitável até primeiro tenant clínico; aí migra para externo. Documentar a intenção no ADR reduz ruído.
- **Auditoria externa é cara** (R$ 15-30k/ano) — adiar até Fase 2; MVP tem auditoria interna
- **Incidente mal tratado destrói reputação** — investimento prévio em plano de resposta + treinar fundador + escritório faz sentido antes de acontecer
- **Lista pública de sub-processors** expõe stack — trade-off: transparência > ofuscação; enterprise pede transparência obrigatório mesmo

### Riscos não endereçados

- **Fundador indisponível no P0** (doença, viagem): sem backup. Mitigar: procuração + escritório externo com poderes limitados de resposta emergencial.
- **Provider sub-processor tem incidente** (ex: Supabase vaza dado): LogiFit responde ao tenant; escalamos ao Supabase; tenant ao titular. Cadeia definida mas lenta.
- **Tenant reporta incidente de dado só dele**: fluxo específico — tenant é controlador do dado dos members; LogiFit ajuda operacionalmente mas não notifica ANPD em nome do tenant.

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Sem DPO formal no MVP | LGPD art. 41 + CFM 2.454 esperam formalização; tenant enterprise recusaria |
| DPO pleno contratado desde o dia 1 | R$ 15-30k/mês sem receita ainda; financeiramente inviável |
| Terceirizar tudo para consultoria de compliance | R$ 30-50k/mês; desproporcional ao porte MVP |
| Só auditoria externa anual, sem interna trimestral | Audit anual detecta tarde; interna + externa é padrão |
| Resposta a incidente ad-hoc (sem plano) | 72h LGPD é pouco tempo; improvisar no dia trava a empresa |
| Sub-processors privados (só DPA individual) | Enterprise exige transparência + lista pública é padrão global (GitHub, Stripe, Notion têm) |

## Escopo de impacto

**Novo ADR:** este (0067).

**Sprints ajustados:**

- **Sprint 00** — setup inicial: email `privacidade@logifit.com.br`, landing com links "Privacidade" + "Termos" + "Sub-processors" (placeholders); `retention_policies` schema preparado
- **Sprint 01b** — `security_incidents` schema + UI admin `/app/admin/incidents` (apenas `super_admin_logifit` role — nasce no root tenant do LogiFit); RIPD schemas já previstos ADR 0054
- **Sprint 02** — RIPD novo `passport-cross-tenant.md` em `docs/compliance/ripd/` cobrindo passaporte ADR 0077; cláusula 7-bis no DPA padrão; cláusula Seção 5 no Termo de Uso paciente; UI admin tenant `/app/settings/privacidade/passport` (toggle de habilitação do recurso); UI paciente `/meu/privacidade/incidentes` (notificação direta de incidentes cross-tenant)
- **Sprint 26** — Portal `/meu/privacidade` + canal do titular (ADR 0054 + 0067) — responde a solicitações em 15d; **inclui telas cross-tenant de ADR 0077:** `/meu/privacidade/compartilhamento` (gestão de vínculos + módulos + níveis) + `/meu/privacidade/acessos` (audit log de leituras cross-tenant) + `/meu/privacidade/incidentes`

**Docs:**

- **`docs/compliance/`** — pasta nova com:
  - `dpo.md` — contato, responsabilidades, escala
  - `politica-privacidade.md` — fonte da versão pública
  - `termos-de-uso.md` — idem
  - `dpa-template.md` — template que tenant assina no signup
  - `cookies-policy.md` 
  - `sub-processors.md` — lista atualizada
  - `incident-response-playbook.md` — runbook do plano de 72h
  - `ripd/` — RIPDs por módulo
- `docs/modulos.md` — módulo "Governança LGPD + DPO" em Fundação
- `CLAUDE.md` — nota sobre DPO + canal privacidade
- `CHANGELOG.md` — entrada
- `.env.example` — `PRIVACY_EMAIL=privacidade@logifit.com.br`

## Related

- Depende de [ADR 0054 — LGPD art. 11](0054-lgpd-art11-dados-saude-ripd-versionado.md) — RIPD schema
- Depende de [ADR 0053 — CFM 2.454](0053-conformidade-cfm-2454-2026-ia-saude.md) — Comitê IA do tenant
- Integra com [ADR 0066 — Plano comercial](0066-plano-comercial-pricing-trial.md) — Enterprise inclui DPO-as-a-service add-on
- **Estendido por [ADR 0077 — Passaporte do paciente cross-tenant](0077-passaporte-paciente-vinculo-cross-tenant.md)** — addendum 2026-04-25 modela co-controllership LGPD entre tenants no fluxo cross-tenant via vínculo
- Fontes: LGPD (Lei 13.709/2018) art. 5º VII (operador), 11 §2º II.f (saúde), 18, 37, 41, 48; Regulamento RANPD; ANPD Guia de Segurança; CFM 2.454/2026; experiência de mercado SaaS BR (Totvs, Conta Azul, Omie divulgam sub-processors)
