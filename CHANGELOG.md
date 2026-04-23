# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Added — Conformidade regulatória (ADRs 0053, 0054 + regras 28, 29)

- **ADR 0053** — Conformidade CFM 2.454/2026 (IA em medicina) + classificação SaMD por feature (`docs/decisions/0053-conformidade-cfm-2454-2026-ia-saude.md`). Três pilares: (1) classificação SaMD por feature IA (Classe I/II/III/IV conforme RDC 657/2022); (2) supervisão humana documentada em `ai_audit_log`; (3) Comitê de IA interno obrigatório por tenant com feature IA classe II+. Tabela inicial classifica Sprints 06/13/19/28/32/33/34. Deadline regulatório: agosto/2026.
- **ADR 0054** — LGPD art. 11 (dados de saúde sensíveis) + RIPD versionado (`docs/decisions/0054-lgpd-art11-dados-saude-ripd-versionado.md`). Quatro componentes: (1) base legal explícita por tipo de dado; (2) consent granular por finalidade (`consent_purposes`); (3) RIPD versionado por módulo crítico com revisão semestral; (4) direitos do titular (art. 18) atendidos em 15 dias via portal `/meu/privacidade`.
- **Regra 28** em `docs/rules.md` — feature IA classe SaMD II+ não ativa sem Comitê de IA cadastrado + ata anexada (gate em feature flag); toda chamada IA clínica grava `ai_audit_log`; classificador de output proibido ativo.
- **Regra 29** em `docs/rules.md` — dado de saúde sensível só trafega com base legal explícita + RIPD vigente; CI bloqueia módulo clínico sem registro em `ripd_documents`; direitos do titular em 15 dias.
- `docs/modulos.md` — Fundação ganha 8 módulos transversais de conformidade: Classificação SaMD, Supervisão humana documentada, Comitê de IA interno, Dashboard de conformidade IA, RIPD versionado, Consent granular por finalidade, Direitos do titular (art. 18), Retenção e descarte automatizado.
- `docs/modulos.md` — nova seção "Integrações Wellness (Gympass / TotalPass / Wellhub)" com 5 módulos pós-Sprint 19: provider abstrato, check-in via wellness, reconciliação de repasse, card de conversão, cadastro multi-plan.
- `CLAUDE.md` — nova seção "Marcos regulatórios que norteiam o produto" (LGPD art. 11, CFM 2.454/2026, CFM 2.299/2021, COFFITO 414/415/2012, CFN 599/2018, ANVISA RDC 657/751/2022, ANS TISS 4.01); regras operacionais 13 (IA com comitê) e 14 (RIPD/LGPD) adicionadas.

### Changed — correções regulatórias em sprints (CFM/COFFITO/CFN/ANS)

- **Sprint 22 TISS/TUSS**: atualizado de TISS v3.05 (defasado) para **TISS 4.01** (Ofício-Circular ANS nº 1/2026 — vigência janeiro/2026). Adicionado ADR 0030 (pipeline de atualização semestral da terminologia TUSS: OPME +26k termos, medicamentos +334) e ADR 0031 (validador TISS proativo que bloqueia envio com erro conhecido antes da glosa: procedimento × especialidade, autorização vigente, carteirinha válida, co-participação). Nova tabela `tuss_catalog_imports` rastreia deltas semestrais.
- **Sprint 20 Prontuário**: política de fechamento diferenciada por profissão via `signature_mode` enum (`icp_brasil_required` para médicos CFM 2.299/2021; `icp_brasil_optional` para fisioterapeutas COFFITO 414/2012; `authenticated_lock` para nutricionistas CFN 599/2018). Nova tabela `signature_policies` + ADR 0032. Correção: COFFITO **não** exige ICP-Brasil expressamente (interpretação anterior era incorreta); aceita lacre autenticado (MFA + hash SHA-256 + timestamp + audit).
- **Sprint 12 Avaliações Físicas**: seed de 8 escalas funcionais validadas clinicamente (`category='escala_funcional'`): **EVA** (dor), **Oswestry** (lombalgia), **DASH** (membros superiores), **Tampa** (cinesiofobia), **SF-36** (qualidade de vida), **Berg** (equilíbrio), **TUG** (mobilidade), **WOMAC** (joelho/quadril). `assessment_types` ganha coluna `category`, `scoring_method jsonb` (sum/percent/domain + interpretação clínica) e `clinical_reference`. Scorers em `packages/db/assessments/scoring/` (um arquivo por escala).
- **Sprint 07 Dashboard**: cards novos "Inadimplência por Método" (cartão × PIX × boleto, consumindo `payment_method` do Asaas) e "Conversão Wellness vs Direto" (Gympass/TotalPass/Wellhub — view vazia até Sprint de Integrações Wellness existir, mas card já mapeado).

### Added
- ADR 0010 — `financial_mode=centralized` usa 1 matriz + N units (sem schema separado)
- `docs/modulos.md` — catálogo de módulos do sistema agrupado por área (fundação / geral / academia / fisio / nutri) com "quais verticais usam" e "sprint alvo"
- Sprints MVP 02–07 detalhados em formato profundo (módulos · rotas · Server Actions/API Routes · schemas Drizzle · eventos de domínio · ADRs esperados): `02-geral-crm-pessoas.md`, `03-geral-agenda-universal.md`, `04-geral-financeiro-asaas.md`, `05-geral-copilot-base.md`, `06-geral-dashboard.md`, `07-academia-controle-acesso.md`
- Módulo "Dashboard do member" no catálogo: `/app/members/[id]` vira home com grid de widgets; Sprint 02 entrega layout + widget inicial (dados + timeline resumida) via `<MemberWidgetSlot />`; Sprints 03/04/05/07 contribuem widgets de agenda, financeiro, copilot e acessos
- Modelo de visibilidade do Dashboard do member com 4 gates — role (`requiredPermissions`), vertical (`requiredVertical`), presença (`showWhen(member)`) e consent (`consentPurpose` quando cross-module). Matriz completa role × vertical × consent por widget documentada em `docs/modulos.md`; cada sprint registra widget via `registerMemberWidget(meta)` do registry exportado em `packages/ui/members/registry.ts`
- Modelo de autorização expandido no Sprint 01b: além de `user_roles`, agora há **role custom por tenant** (admin edita `role_permissions`) e **grants diretos** via `user_permissions` (exceção pontual user → permission com `expires_at` + `reason`). Policies RLS fazem union entre as duas fontes via função SQL `has_permission(...)`. Atende caso de uso "liberar financeiro para uma pessoa específica" sem inflacionar roles. ADR 0019 esperado no sprint. Documentado em `docs/acesso-e-autorizacao.md` e `docs/modulos.md`
- MVP expandido com 2 sprints novos: **Sprint 05 Ofertas Comerciais** (promoções, pacotes/bundles, appointment_credits, referrals, cashback stretch) — ADR 0020 esperado; e **Sprint 09 Engajamento** (conquistas com regras declarativas, brindes com workflow de entrega, metas com progresso automático) — ADR 0021 esperado
- Renumeração dos sprints: Copilot 05→06, Dashboard 06→07, Acesso Academia 07→08. Ordem reflete dependências (Ofertas depois de Financeiro; Engajamento por último como consumidor de eventos de todos). Fases 2/3 renumeradas em cascata (Fisio 10–13, Nutri 14–15, transversais 16–17)
- Widgets novos no dashboard do member: `creditos` (Sprint 05), `conquistas` e `metas` (Sprint 09). Matriz de visibilidade em `docs/modulos.md` atualizada
- Regra 11 em `CLAUDE.md`: nunca path absoluto em doc versionada

### Changed
- Revisão de documentação pós-estrutura: paths absolutos removidos de `docs/arquitetura.md` e `docs/plano-estrutura.md` (projeto é usado em múltiplas máquinas, só caminhos relativos a partir da raiz do repo); nota de "documento histórico" no topo de `docs/plano-estrutura.md`; `domain_events` adicionado às "Tabelas mestras do MVP" em `docs/arquitetura.md`; linguagem de troca de contexto unificada em `docs/acesso-e-autorizacao.md`; seção "Reanálise Crítica" removida de `docs/arquitetura.md`; `financial_mode` removido da lista de "Decisões pendentes" em `docs/roadmap.md` (agora endereçado pela ADR 0010)
- `docs/roadmap.md` reformulado: tabela Fase MVP com colunas de controle de evolução (Status / Início / Fim / % / Bloqueios / PR); seção "Sprints ativos" removida (redundante com as colunas); ordem dos sprints 05–07 ajustada (Copilot → Dashboard → Acesso) refletindo dependências técnicas
- `CLAUDE.md` seção "Documentação de referência" aponta para `docs/modulos.md`
- Regra 10 (`docs/rules.md` + `CLAUDE.md`): commits vão direto em `main` (dev solo, sem PR review obrigatório). Branches `feat/*`/`fix/*`/`chore/*`/`docs/*` ficam opcionais — só para trabalho longo, arriscado ou que precisa ser testado isolado. Regra 14 também ajustada (era "todo PR", agora "todo commit")

### Added — expansão Academia (sprints 10–15)

- Verificação de gaps contra lista de funcionalidades esperadas para Academia (operacional, técnico, financeiro, retenção, diferencial IA). Cobertura atual cruzada com o que falta; 6 sprints novos + ajustes em 3 existentes.
- **Sprint 10 — Funil de Vendas** (`docs/sprints/10-geral-funil-vendas.md`): `leads`, estágios configuráveis, aulas experimentais, propostas versionadas, conversão automática lead → member. ADR 0022 esperado.
- **Sprint 11 — Prescrições + Biblioteca** (`docs/sprints/11-geral-prescricoes-e-biblioteca.md`): catálogo de `exercises` com vídeos, `workouts` versionados, `prescriptions` polimórficas (kind: workout / meal_plan / fisio_protocol), `workout_sessions` com RPE. ADR 0023 esperado.
- **Sprint 12 — Avaliações Físicas** (`docs/sprints/12-geral-avaliacoes-fisicas.md`): `assessment_types` configuráveis (bioimpedância, dobras, anamnese), `measurements` séries temporais, gráficos de evolução, calculadoras (IMC, Pollock, TMB). Antropometria Nutri (Sprint 24) reusa. ADR 0024 esperado.
- **Sprint 13 — WhatsApp + Régua de Cobrança** (`docs/sprints/13-geral-whatsapp-e-regua-cobranca.md`): provider WhatsApp abstraído (Twilio/Z-API/Meta via ADR 0025), templates aprovados, motor declarativo de régua (evento → ação → delay) via ADR 0026. Canal email via Resend consolidado. Opt-out respeitado.
- **Sprint 14 — DRE + Custos Operacionais** (`docs/sprints/14-geral-dre-custos-operacionais.md`): `cost_categories` (fixos/variáveis), `cost_entries` + recorrências, DRE consolidado com export PDF/CSV, previsibilidade de receita 3 meses.
- **Sprint 19 — IA Preditiva de Churn** (`docs/sprints/19-ia-previsao-churn.md`): pipeline de features por member, modelo preditivo `prob_30d/60d/90d` + top factors (ADR 0027), `churn_interventions` integradas à régua, feedback loop para medir accuracy. **Fecha o MVP.**
- Ajuste no **Sprint 04 Financeiro**: DRE básico promovido de stretch para Commit; `contracts` ganha colunas de trancamento (`pause_*`) + `auto_pause_rule` configurável; job diário avalia regra de pause automático. Eventos `contract.paused`/`resumed`/`auto_paused`.
- Ajuste no **Sprint 07 Dashboard**: cards explícitos "Alunos Ativos", "Faturamento 30d", "Taxa de Retenção 90d", "Horário de Pico", "Ocupação por Modalidade", "Ticket Médio por Aluno" (views SQL nomeadas).
- Ajuste no **Sprint 08 Controle de Acesso**: ADR 0018 passa a cobrir **reconhecimento facial** como modalidade alternativa (ou adicional) ao QR, com consent LGPD específico e embeddings em `member_face_embeddings` via pgvector. Subscribers de `contract.paused` criam `access_blocks`.
- Novos widgets no dashboard do member: `treino` (Sprint 11), `avaliacao` (Sprint 12), `risco` (Sprint 19).
- Renumeração Fase 2/3 em cascata: Fisio 10–13 → **16–19**, Nutri 14–15 → **20–21**, App nativo → **22**, Fiscal → **23**. Prescrição adaptativa IA por RPE listada como módulo futuro pós-22 (depende de app nativo + Sprint 11).

### Added — expansão Fisioterapia (sprints 16–24)

- Verificação de gaps contra lista de funcionalidades esperadas para Fisioterapia (prontuário/atendimento, agenda, financeiro-saúde, conformidade legal, diferenciais). Cobertura atual cruzada com o que falta; 9 sprints Fase 2 + ajustes em 2 sprints MVP.
- **Sprint 20 — Prontuário COFFITO + CID/CIF + ICP-Brasil** (`docs/sprints/20-fisio-prontuario-cid-cif.md`): prontuário versionado com assinatura digital, catálogos CID-11 e CIF globais, templates por especialidade (ortopedia/neuro/respiratória reusa `assessment_types` do Sprint 12), nota corretiva. ADR 0028 esperado.
- **Sprint 21 — Evolução SOAP + Mídias** (`docs/sprints/21-fisio-evolucao-midias.md`): registro por sessão em formato SOAP, anexos categorizados (exame imagem / vídeo execução / documento / foto postural) em Storage criptografado com URL assinada TTL 10min.
- **Sprint 22 — TISS/TUSS + Convênios** (`docs/sprints/22-fisio-tiss-tuss-convenios.md`): cadastro de operadoras + acordos, carteirinhas, autorizações, guias XML v3.05 (consulta + SP/SADT), lotes, conciliação de retorno, controle de glosas. ADR 0029 esperado.
- **Sprint 23 — Comissões e Repasse** (`docs/sprints/23-fisio-comissoes-repasse.md`): `professional_contracts` com condições (% faturado/recebido/fixo/tabela), cálculo automático em eventos financeiros/clínicos, fechamento mensal aprovado, transferência Asaas. Aproveitável por Academia (personal trainer) e Nutri. ADR 0030 esperado.
- **Sprint 24 — Estoque** (`docs/sprints/24-geral-estoque.md`): `stock_items` + movimentações (entrada/saída/ajuste/venda) + saldo por soma + alertas de mínimo + POS simples + inventário. ADR 0031 esperado.
- **Sprint 25 — ANVISA + CNES** (`docs/sprints/25-fisio-anvisa-cnes.md`): cadastro de equipamentos regulados com cronograma de manutenção e calibração, certificados anexados, logs de limpeza do ambiente com checklist, integração CNES (manual no MVP da fase), relatório PDF para fiscalização.
- **Sprint 26 — Portal do Paciente Web (PWA)** (`docs/sprints/26-geral-portal-paciente-web.md`): self-service do member via magic link email/SMS (ADR 0032), agenda, pagamento Asaas, recibos PDF, vídeos de exercícios prescritos com URL assinada, QR dinâmico, prontuário resumido via consent.
- **Sprint 27 — Cross-Alert Lesão → Treino** (`docs/sprints/27-cross-alert-lesao-treino.md`): subscriber de `consulta.signed` com CID de lesão + consent `share_injury_to_training` + validação de franchise (regra 25) → adapta workout com `cid_exercise_contraindications`; instrutor revisa antes de confirmar. ADR 0033 esperado.
- **Sprint 28 — Generative UI v1 (Fecha Fase 2)** (`docs/sprints/28-fisio-generative-ui.md`): framework de tool calls com registro de componentes tipados (PatientCard, EvolutionChart, CidSuggestion, ReportSection); copilot Fisio responde com componentes interativos via streaming SSE. ADR 0034 esperado.
- Ajuste no **Sprint 13 WhatsApp+Régua**: réguas pré-prontas novas — confirmação de agendamento D-1/D-0, manutenção D-7 (Sprint 25), estoque crítico (Sprint 24).
- Ajuste no **Sprint 14 DRE**: dimensão adicional "lucratividade por procedimento" via `invoice_items.service_type` (enriquecimento no Sprint 04 com backfill).
- Renumeração cascata Fase 3: Nutri 20–21 → **25–26**, App nativo 22 → **27**, Fiscal 23 → **28**. Prescrição adaptativa IA por RPE: pós-22 → **pós-27**.
- Novos widgets no dashboard do member: `prontuario` (Sprint 20, com consent cross-module), `evolucao` (Sprint 21), `convenio` (Sprint 22), `alerta_lesao` (Sprint 27).

### Added — expansão Nutrição (sprints 25–27)

- Verificação de gaps contra lista de funcionalidades esperadas para Nutrição (prontuário CFN, antropometria, prescrição dietética, exames laboratoriais, engajamento app, administrativo). Cobertura atual cruzada com o que falta; 3 sprints Fase 3 + 4 ajustes em sprints MVP/Fase 2.
- **Sprint 29 — Banco de Alimentos (TACO) + Plano Alimentar** (`docs/sprints/29-nutri-alimentos-e-plano.md`): catálogo ~3000 alimentos TACO com 30+ nutrientes em `jsonb`, medidas caseiras normalizadas, alimentos customizados por tenant, editor drag-drop, cálculo nutricional em tempo real, lista de substituição automática, export PDF com branding do tenant, versionamento. ADRs 0035 e 0036 esperados.
- **Sprint 30 — Suplementação + Exames Laboratoriais** (`docs/sprints/30-nutri-suplementos-exames.md`): catálogo de suplementos com interações medicamentosas, prescrição com posologia/duração, catálogo de analitos (glicose, colesterol, ferritina…) com valores de referência por sexo/idade, registro de exames com destaque visual de alteração, gráfico de evolução por analito. ADR 0037 esperado.
- **Sprint 31 — Diário Alimentar + Teleconsulta** (`docs/sprints/31-geral-diario-alimentar-teleconsulta.md`): paciente registra refeições no portal com foto + cálculo de desvio vs plano, nutri valida/comenta, relatório semanal; teleconsulta com provider abstrato (Daily.co/Whereby/Jitsi/Twilio via ADR 0038), gravação opt-in, transcrição stretch.
- Ajuste no **Sprint 20 Prontuário**: `consultas` agora é polimórfica com `kind` enum (`fisio`/`nutri`/`custom`); `signature_required` boolean separa COFFITO (obrigatório) de CFN (opcional). Nutri Sprint 29 reusa a infra sem sprint de prontuário próprio.
- Ajuste no **Sprint 02 CRM**: `members` ganha `family_history jsonb` + `sex` (usado pela anamnese Fisio e Nutri).
- Ajuste no **Sprint 12 Avaliações**: calculadoras ampliadas — Petroski, Guedes, Faulkner (dobras); Mifflin-St Jeor, Cunningham, Katch-McArdle (TMB); Jackson-Pollock por circunferência. Organizadas por categoria.
- Ajuste no **Sprint 13 Régua**: réguas padrão nutri — lembrete de água (4x/dia), lembrete de refeição (horários do plano), pedir diário alimentar semanal, comentário do profissional no diário, exame laboratorial alterado.
- Ajuste no **Sprint 26 Portal**: rotas `/meu/{cardapio,diario,teleconsulta/[id],exames,suplementos}` declaradas como ativadas em sprints posteriores (25/26/27).
- Novos widgets no dashboard do member: `alimentar` (Sprint 29), `suplementos` e `exames` (Sprint 30), `diario` (Sprint 31). Antigo `antropometria` consolidado em `avaliacao` (já vinha do Sprint 12).
- Renumeração Fase 3: sprints 28–30 (Nutri-Agent 26→28, App nativo 27→29, Fiscal 28→30). Prescrição adaptativa IA por RPE: pós-27 → **pós-29**.

### Changed — correções da auditoria interna

Auditoria sistemática da documentação identificou achados que viraram correções pontuais (maioria dos achados eram falsos positivos — ADRs 0011-0046 "faltando" são deliberados por regra 13 e renumerações fantocheos eram reais; descrição abaixo é só o que virou ação):

- **CHANGELOG** — texto anterior sugeria que ADRs 0027+ foram "renumerados em cascata para 0040+". Isso não aconteceu no disco porque esses ADRs ainda não existem como arquivo (nascem no dia da decisão, regra 13). Texto reescrito explicitando que a renumeração só se aplica aos ADRs **esperados** que nascerão nos sprints renumerados.
- **Sprint 07** — ganha API pública `registerCrossAlertHandler({ event, handler })` em `packages/ai/alerts/registry.ts`; consumidores (Sprint 08 bloqueios, Sprint 13 régua, Sprint 19 churn, Sprint 27 lesão→treino, Sprint 32 alertas device, Sprint 33 exame crítico) vão registrar handlers explicitamente.
- **Sprint 08** — itens de subscriber agrupados sob "Registrar handlers no cross-alert dispatcher do Sprint 07".
- **Sprint 12** — adiciona item Commit "registrar handler `photo-progress` no WhatsApp inbound hub".
- **Sprint 20** — adiciona item Commit "registrar handler `receipt` no WhatsApp inbound hub" para receitas enviadas pelo paciente.
- **Sprint 01b** — teste E2E explícito da regra 25 (franquia + dois members em companies diferentes; cross-company de dado clínico deve retornar 0 rows via RLS + bloquear consent).
- **Sprint 27** — teste E2E reforçado da regra 25: mesmo com consent `share_injury_to_training` ativo, franchise cross-company **deve bloquear** e registrar `audit_log.blocked_reason='regra_25_franchise_cross_company'`.
- **Sprint 15** — marcado como candidato à quebra em 15a/15b (AP/AR core vs OCR+NF-e+import) se estourar 3 semanas.
- **Sprint 13** — marcado como candidato à quebra em 13a/13b (outbound+régua vs hub inbound multi-fluxo).
- **Roadmap** — nova seção "Convenção sobre sprints em alto nível" explicando que sprints 34-37 ainda não têm arquivo detalhado em `docs/sprints/` (deliberado; nasce quando sprint vira candidato a `doing`).

### Added — i18n em 3 idiomas: pt-BR, en-US, es-419 (ADR 0052)

- **ADR 0052** — LogiFit nasce com i18n em 3 idiomas desde Sprint 00, usando next-intl v4+ no Next.js 15 App Router. Locales: `pt-BR` (default), `en-US`, `es-419` (espanhol LATAM neutro). Regulamentação continua Brasil-only (LGPD/CFM/CFN/COFFITO/TISS); só a interface é traduzida. Multi-país (l10n) fica como ADR futuro quando houver demanda real de mercado.
- **Regra 27 (nova)** em `docs/rules.md` e `CLAUDE.md`: proibido hardcode de string de UI; toda string visível via `t('namespace.key')` com catálogo em 3 locales; CI `pnpm i18n:check` falha se faltar chave. Exceções: nomes técnicos (CID, TUSS, Pollock), feature flags, logs.
- **Sprint 00 cresce** para +3 semanas incluindo: configuração next-intl + middleware + estrutura `apps/web/src/messages/{pt-BR,en-US,es-419}/` + `packages/i18n` (config, utils) + scripts `i18n:extract` e `i18n:check` + `LocaleSwitcher` em `packages/ui` + seed inicial de strings comuns traduzidas via Claude.
- **Sprint 00 também ganha**: script `db:rls-check` (enforce regra 1+2), `packages/ai/observability.ts` (wrapper com tokens/latência/custo de IA), Logtail/Axiom movido de stretch para core.
- **Catálogos (exercícios, alimentos TACO, analitos, CID, CIF, suplementos)** ganharão colunas `name_pt/name_en/name_es` OU tabela `translations` — decisão por catálogo durante execução do sprint correspondente.
- **Todos os sprints** ganham no DoD: "Strings UI extraídas em 3 locales (pt-BR obrigatório, en-US + es-419 via Claude + revisão)".
- **Fallback em cadeia** para chave faltante: es-419 → en-US → pt-BR com log de missing string.
- `CLAUDE.md` seção de stack inclui next-intl; convenções listam regra 27.
- `docs/arquitetura.md` stack frontend menciona next-intl.
- `docs/modulos.md` na Fundação ganha "i18n (3 idiomas)" e "LocaleSwitcher".

### Added — WhatsApp Inbound como canal multi-fluxo pluggable (ADR 0051)

- **ADR 0051** — WhatsApp inbound amplia Sprint 13 com hub central pluggable: identity matcher (busca `persons.phone` → se não acha, pede CPF conversacional) + intent router (IA classifica anexo com confidence threshold 80%) + consent específico `whatsapp_exchange`. Cada sprint consumidor registra seu handler (exame, boleto, foto, pergunta, receita). Sem novo sprint.
- **Sprint 13 ampliado**: tabelas `whatsapp_inbound_messages`, `whatsapp_conversations`, `tenant_whatsapp_settings`; API Route `POST /api/mensagens/webhook/whatsapp-inbound`; hub em `packages/ai/whatsapp/` com `inbound-handler.ts`, `intent-router.ts`, `identity-matcher.ts`, `classifier.ts`; default handlers `copilot-question` e `fallback-human`; templates inbound (`exam.received`, `boleto.received`, `identity.needed`, `classification.confirm`).
- **Sprint 15 registra handler `boleto-upload`** — fornecedor manda PDF pelo WhatsApp → OCR (provider abstrato ADR 0035) → cria AP em draft no ERP Financeiro → resposta "Recebi boleto de R$ X".
- **Sprint 33 registra handler `exam-upload`** — paciente manda PDF laudo pelo WhatsApp → pipeline completo (OCR + IA extração + IA interpretação + fila de revisão profissional) → resposta "Recebi seu exame, em análise" + notificação quando publicado.
- **`exam_documents.source`** enum ganha `patient_whatsapp`; `source_ref` linka `whatsapp_inbound_messages.id` para rastreabilidade completa.
- **Consent `whatsapp_exchange`** ativável em `/meu/privacidade` ou na 1ª interação do bot; revogável a qualquer momento.
- **Identity matching**: telefone não cadastrado → bot pergunta CPF → valida → salva `persons.phone` (baixa fricção + segurança). Tenant sensível pode ativar chave secundária (data de nascimento) em `tenant_whatsapp_settings.require_dob`.
- **Rate limit** 10 msgs/min/telefone via Upstash Redis (reusa Sprint 06). Dedupe por `provider_message_id`.
- **Handlers futuros previstos**: `photo-progress` (Sprint 12 — antropometria via WhatsApp), `receipt` (Sprint 20/21 — receita clínica via WhatsApp).

### Added — Pipeline inteligente de exames laboratoriais (ADR 0050)

- **ADR 0050** — Pipeline OCR → IA extração → IA interpretação conservadora → revisão profissional → `lab_results` oficial. IA nunca diagnostica; profissional sempre valida. Paciente pode subir exame pelo portal com consent específico; fica em fila de revisão.
- **Sprint 33 (NOVO) — Pipeline Inteligente de Exames Laboratoriais** (`docs/sprints/33-geral-pipeline-exames.md`): upload de PDF (por profissional ou paciente) → Storage criptografado → OCR (reusa ADR 0035) → Claude extrai analitos estruturados mapeados contra `lab_analytes` (Sprint 30) → Claude sugere padrões cross-analito e hipóteses (vocabulário conservador: "sugere", "compatível com") → classificador de output bloqueia termos proibidos ("tem [doença]", "diagnóstico de") → profissional revisa lado-a-lado (PDF + valores + hipóteses) → publica em `lab_results` oficial com rastreabilidade completa.
- **Economia massiva de tempo**: ~30 min de digitação manual de hemograma completo (~30 analitos) → ~2 min de revisão. Padronização cross-laboratório (Sabin, DB, Hermes Pardini, Fleury, Delboni).
- **Self-upload pelo paciente** em `/meu/exames/upload` com `consent.self_upload_exam`. Entra em fila de revisão do profissional; vira oficial só após validação humana.
- **Categorização sensível**: exames HIV/psiquiátrico/genético/paternidade em `sensitivity='high'`; acesso exige permission `exam.sensitive.read` + audit reforçado.
- **Opt-out de IA por tenant** em `/app/settings/exames/ia` — tenant LGPD-restritivo pode manter só OCR + revisão humana.
- **Escopo vs Sprint 17**: exame laboratorial (PDF com analitos numéricos) entra no Pipeline do Sprint 33; anexo clínico de mídia (raio-X, RM, foto postural, vídeo) continua no Sprint 17 Fisio.
- **Integração com Nutri-Agent (Sprint 34 renumerado)** — consome `lab_results` publicados + pode sugerir exames complementares pela ausência nos últimos 12 meses.
- **Renumeração Fase 3**: Nutri-Agent 33→**34**, App Nativo 34→**35**, Fiscal 35→**36**. Prescrição adaptativa IA por RPE: pós-34 → **pós-35**.

### Added — Device Hub (wearables + dispositivos clínicos) — ADR 0049

- **ADR 0049** — Device Hub com provider abstrato + modelo normalizado FHIR-like (`device_readings` com observation_code/value/unit/measured_at). Ingestão de dados biométricos de dispositivos consumer e clínicos respeitando LGPD com consent específico por provider.
- **Sprint 32 (NOVO) — Device Hub v1** (`docs/sprints/32-geral-device-hub.md`): arquitetura core + cloud providers (Garmin Connect, Oura) + BLE Web bioimpedância doméstica (Omron, G-Tech — Chrome/Edge desktop) + import de arquivos FIT/TCX/GPX/CSV InBody. Job Vercel Cron horário puxa novos dados dos providers cloud.
- **4 usos dos dados**: (1) **curadoria profissional** — profissional seleciona leituras em `/app/members/[id]/avaliacoes/new`, valida/edita, importa para `assessment_measurements` com rastreabilidade; (2) **monitoramento contínuo** — painel com tracks de peso/HR/sono/recovery entre avaliações formais; (3) **alertas inteligentes** — regras declarativas (DSL do Sprint 13) consomem `device_readings` e disparam via cross-alert (HR subiu, sedentarismo, etc); (4) **timeline enriquecida** no widget do member com tracks paralelos (oficial vs dispositivo).
- **Separação oficial vs dispositivo**: tags visuais obrigatórias (🩺 avaliação validada vs 📱 dispositivo); relatórios oficiais usam só dados validados; dado de dispositivo nunca vira medida clínica sem assinatura humana.
- **Garmin no Sprint 32** via Connect API OAuth cloud (sem dependência de app nativo). Apple Health + Google Health Connect ficam para Sprint 36 App Nativo (dependem de HealthKit/Health Connect que só funcionam em app nativo, não em PWA).
- **LGPD reforçada**: consent específico por provider (`device_consents`); dado cru exige permission `devices.read_raw` + 2º consent; audit reforçado em leituras cruzadas.
- **Retenção**: dado cru minuto a minuto rotaciona 90 dias; agregados diários indefinidos. Job mensal `cleanup_raw_readings` preserva leituras referenciadas em assessments curados.
- **Ajuste Sprint 12 Avaliações**: `assessment_measurements` ganha `source` enum (`manual`/`device`/`import_csv`) + `source_device_reading_id` + `validated_by_user_id` + `validated_at`. Schema pronto desde Sprint 12; UI de importação de dispositivos ativa quando Sprint 34 Device Hub existir.
- **Renumeração Fase 3**: Nutri-Agent 32→**33** (agora consome Device Hub), App Nativo 33→**34** (adiciona Apple Health + Google Health Connect + BLE mobile), Fiscal 34→**35**. Prescrição adaptativa por RPE: pós-33 → **pós-34**.

### Added — busca automática de dados por CNPJ (ADR 0048)

- **ADR 0048** — Busca de CNPJ via provider abstrato no cadastro de pessoa jurídica. Elimina digitação manual de razão social, endereço, CNAE, porte, regime tributário; dados vêm da Receita Federal automaticamente ao digitar os 14 dígitos.
- **Providers suportados:** BrasilAPI (default, gratuito, open source), ReceitaWS (fallback gratuito), CNPJá! (pago, opcional, enriquece com QSA/quadro societário). Admin configura via `/app/settings/pessoas/cnpj` com credenciais próprias.
- **Cache global 7 dias** em `cnpj_cache` (não por tenant — dado de CNPJ é público). Reduz ~95% das chamadas à API. Três caminhos para refresh forçado: expiração automática, botão manual `/app/pessoas/[id]/refresh-cnpj`, job Vercel Cron semanal `/api/jobs/cnpj/validate-situacao-weekly`.
- **Detecção de situação cadastral** — empresa baixada/suspensa/inapta dispara modal obrigatório de confirmação com razão; job semanal alerta quando companies/suppliers ativos mudam de situação.
- Atualiza Sprint 01a com: interface `CnpjProvider`, 3 adapters, tabelas `cnpj_cache` + `tenant_cnpj_settings`, UI auto-fill, alerta de situação, job de validação semanal.

### Added — cadastro central `persons` (modelo Contact-FK)

- **ADR 0047** — Cadastro central de `persons` com FK em tabelas especializadas (Contact-FK). Todos os cadastros (members, leads, suppliers, companies, users, professional_contracts) agora linkam uma `persons` central; dados de identidade (nome/CPF/CNPJ/email/phone/endereço) ficam em um lugar só, papéis múltiplos acontecem naturalmente sem tabela intermediária.
- **Auto-detecção PF/PJ** pelo documento digitado (11 dígitos = CPF/PF, 14 = CNPJ/PJ) com validação matemática do dígito verificador.
- **`<PersonPicker>` reutilizável** — componente de autocomplete que busca persons existentes e mostra papéis ativos; usado em toda tela de cadastro especializado (users/members/suppliers/companies).
- **Fluxo de UI:** cadastra pessoa em `/app/pessoas/new` (genérico); nas telas especializadas linka via picker ou cria inline. Não redigita dados de identidade.
- **Constraints de integridade:** `users.person_id` exige kind=pf; `companies.person_id` exige kind=pj; `(tenant_id, document)` unique em persons; conversão lead→member reusa mesmo `person_id` (regra 24 reforçada).
- **Views consolidadas** `v_members_full`, `v_suppliers_full`, `v_companies_full`, `v_person_roles` para leituras quentes.
- Ajustes em 5 sprints: **01a** (persons central + companies/users ganham FK), **02** (members.person_id), **10** (leads.person_id nullable até proposta), **15** (suppliers.person_id + XML NF-e cria/reusa persons), **23** (professional_contracts.person_id com user_id opcional para terceirizados).

### Added — expansão ERP Financeiro (sprints 15–18 + renumeração cascata +4)

- Verificação de gaps contra lista de ERP financeiro completo (contas a pagar, contas a receber, fornecedores, plano de contas, rateio, intercompany, bancos, adquirência, OCR de boleto, NF-e entrada). Sprint 04 (Asaas) + Sprint 14 (DRE) atendiam só mensalidade + custos; agora 4 sprints novos cobrem ERP financeiro completo. Todos os sprints >=15 renumeraram +4.
- **Sprint 15 — ERP Financeiro Core** (`docs/sprints/15-geral-erp-financeiro-core.md`): plano de contas hierárquico, cadastro de fornecedores, contas a pagar com **workflow multi-aprovador configurável**, contas a receber avulso, **OCR de boleto provider-abstrato configurável pelo admin do tenant** (OCR.space default + opções Google Vision, AWS Textract, Azure Computer Vision, Tesseract self-hosted; config via `/app/settings/financeiro/ocr`; fallback em cadeia — ADR 0035 accepted), upload manual XML NF-e com parser FEBRABAN + criação automática de AP. ADRs 0033, 0034, 0035.
- **Sprint 16 — Rateio + Intercompany** (`docs/sprints/16-geral-rateio-intercompany.md`): `allocation_rules` (fixed/proporcional/por KPI) para conta da matriz ser rateada entre filiais; `intercompany_entries` com contrapartida automática entre companies; fechamento mensal IC. Regra 25 enforced (só `topology=owned`). ADR 0036.
- **Sprint 17 — Bancos + Open Finance + NF-e SEFAZ** (`docs/sprints/17-geral-bancos-open-finance.md`): integração Open Finance (Pluggy/Belvo via ADR 0037) + fallback OFX upload; conciliação automática com `reconciliation_rules`; projeção de fluxo de caixa 30/60/90d; recepção automática NF-e via SEFAZ/Arquivei (ADR 0038) com gestão criptografada de certificado A1 por company. ADRs 0037 e 0038.
- **Sprint 18 — Adquirência** (`docs/sprints/18-geral-adquirencia.md`): integração com Cielo, Stone, Rede, GetNet e PagSeguro via adapter comum; sincronização diária de vendas; conciliação venda maquininha ↔ extrato bancário; antecipação de recebíveis via API; split automático em franquias (usa `franchise_agreements`); dashboard unificado de receita (online Asaas + presencial). ADR 0039. **Fecha bloco ERP Financeiro.**
- Renumeração cascata +4 em todos os sprints 15-27: **19** Churn (antes 15), **20** Prontuário Fisio (antes 16), **21** Evolução (antes 17), **22** TISS (antes 18), **23** Comissões (antes 19), **24** Estoque (antes 20), **25** ANVISA (antes 21), **26** Portal (antes 22), **27** Cross-alert (antes 23), **28** GenUI (antes 24), **29** Nutri alimentos (antes 25), **30** Nutri suplementos (antes 26), **31** Diário+Teleconsulta (antes 27). ADRs esperados que nasceriam com numeração antiga (0027+) agora nascem com numeração nova (0040+) **quando cada sprint executar** — nenhum ADR foi renomeado no disco porque eles ainda não existem como arquivo (por design, conforme regra 13: ADR nasce no mesmo dia da decisão). Fase 3 permanece intocada numericamente (sprints 32+).
- Numeração final: MVP vai de 00 a 19 (21 sprints, inclui fundação 00-01b e 4 novos financeiros 15-18); Fase 2 vai de 20 a 28; Fase 3 vai de 29 a 34 + pós-33 prescrição adaptativa.

### Added — material comercial

- `docs/comercial.md` — apresentação comercial/pitch do produto consolidando todos os módulos em linguagem de venda (para clientes, investidores, decisores de compra). Espelho do planejamento técnico sem jargão; inclui roadmap transparente, números de venda, público-alvo por perfil e frase de fechamento.
- `CLAUDE.md` seção "Documentação de referência" lista `docs/comercial.md` com nota de que é material de apoio, não fonte técnica.

### Fixed
- —

### Security
- —

---

## [0.0.0] - 2026-04-22

### Added
- Documentação inicial: `docs/arquitetura.md`, `docs/rules.md`, `docs/multiempresa.md`, `docs/acesso-e-autorizacao.md`, `docs/roadmap.md`
- ADRs 0001–0009 em `docs/decisions/`
- Templates de sprint em `docs/sprints/` (template + Sprint 00, 01a, 01b)
- `CLAUDE.md` na raiz (contexto persistente para Claude Code)
- `.github/pull_request_template.md` (checklist de PR)
- `docs/plano-estrutura.md` (plano histórico de estruturação)
