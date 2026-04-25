# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Regras — Regra 44 NOVA: ler design system antes de criar tela/componente UI

- [docs/rules.md](docs/rules.md) — **Regra 44** em nova seção "Design system 'Equilíbrio Vital'" complementa regras 27 (i18n) e 31 (responsividade). Define fonte de verdade dual (pré/pós-Sprint 00), lista proibições (hardcode de hex/font/spacing/radius/font-size; construir primitivo do zero; `box-shadow` decorativa) e obrigações (nova variante entra primeiro no styleguide; mudança de token apenas em `tokens.css`). Lint `no-hardcoded-design-token` previsto pra Sprint 00
- [CLAUDE.md](CLAUDE.md) — **item 29** sintetiza a regra 44 inline; rodapé da lista atualizado de "43 regras duras numeradas 1-8 + 21-43" para "44 regras duras numeradas 1-8 + 21-44"

### Prototipo — Design system styleguide "Equilíbrio Vital"

Página única de documentação viva do design system, autossuficiente, dentro do protótipo HTML estático.

**Adicionado:**

- [prototipo/designsystem/index.html](prototipo/designsystem/index.html) — styleguide com 14 seções: Foundation (Cores · Tipografia · Espaçamento · Raios · Layout · Z-index) + Componentes (Botões · Cards · Badges · Inputs · Tabelas · Dots & Divider · Utilities) + Migração shadcn. Sidebar fixa com scroll-spy, toggle light/dark com persistência em localStorage, comparação direta light vs dark sem trocar tema global
- [prototipo/designsystem/styleguide.css](prototipo/designsystem/styleguide.css) — estilos exclusivos da página (sidebar, swatches, code blocks); reusa 100% os tokens `--ev-*`, zero hex hardcoded
- [prototipo/designsystem/shadcn-mapping.css](prototipo/designsystem/shadcn-mapping.css) — bloco "ready to copy" pra Sprint 00: aliases shadcn (`--primary`, `--background`, `--card`, `--ring`, `--chart-1..5`, `--sidebar-*` etc.) apontando pras vars `--ev-*` da fonte de verdade. Dark mode é automático (herda dos overrides em `tokens.css`). Documenta 3 desvios deliberados do default shadcn: radius pill, zero shadows, background ≠ card

**Não altera:** `prototipo/tokens.css`, `prototipo/base.css` nem qualquer arquivo em `docs/` ou ADRs — design system já é coberto por ADR 0001 + ADR 0063 + arquitetura.md §1.

### Docs — Auditoria 2026-04-25 (5ª passada — 10 issues + estabilização final)

Após 4 rodadas, quinta auditoria focada em **validar 4ª rodada + procurar issues sutis que escaparam**. Padrão de retornos decrescentes confirmado (1ª=30 → 2ª=14 → 3ª=18 → 4ª=14 → 5ª=10). **4 críticos + 4 maiores + 2 menores, todos endereçados.** Documentação atinge **estado estável e auditável**.

**Críticos (4):**

- [Sprint 00](docs/sprints/00-setup-infra.md) — **timebox revisado de 3 para 4 semanas** com seção "Estratégia de timebox" organizando trabalho em **3 faixas executáveis** (Faixa 1 infra core; Faixa 2 segurança em profundidade; Faixa 3 lints custom + docs operacionais); Faixa 3 tem **opção de pivot** (mover lints `cross-tenant-read-must-log` para Sprint 02 e `no-hardcoded-design-token` para Sprint 00b se cronograma estourar)
- [Sprint 00](docs/sprints/00-setup-infra.md) — `packages/security/high-risk-actions.ts` ganhou flag `alsoBlockedFromAi?: boolean` em ações que coexistem entre regra 41 (IA bloqueada) e regra 43 (MFA recente humano) — `runOpenFinancePayment`, `anonymizeMember`, `deleteClinicalData`, `exportFullProntuario`. Nota explícita: **as duas proteções são independentes e cumulativas** (IA nunca chega ao handler via lint `ai-block-respected`; se chegasse via bypass, gate `requireRecentMfa()` pegaria)
- [Sprint 01b](docs/sprints/01b-rbac-e-consent.md) — função SQL `resolve_ai_class(p_tenant_id, p_feature_key)` em `packages/db/functions/resolve-ai-class.sql` agora detalhada no commit checklist com assinatura, lógica completa (busca tenant-específico → fallback global → exception se não classificada), retorno tuple (samd_class, requires_committee, requires_anvisa_notification, source) + 5 cenários de teste E2E (feature global classe I, classe II sem comitê, classe II com comitê, override tenant-específico, exception feature_not_classified, comitê removido)
- [Sprint 04](docs/sprints/04-geral-financeiro-asaas.md) — schema `tenant_usage_snapshots` agora alimentado por **`plan_tier_rates` (seed global versionado por `effective_from`/`effective_to`)** + função SQL **`get_tier_rates_for_date(tenant_id, snapshot_date)`** que resolve tier vigente do tenant na data + retorna rates congelados — elimina ambiguidade de "quem popula `member_overage_rate_cents`"; mudança futura de pricing **não retro-afeta** snapshots antigos. Inclui **exemplo numérico completo** (tenant Pro abril 2026: R$ 199 + R$ 75 member overage + R$ 8 fiscal overage = R$ 282 total)

**Maiores (4):**

- [Sprint 04](docs/sprints/04-geral-financeiro-asaas.md) — `tenant_usage_snapshots` PARTITION BY RANGE corrigido de **ano → trimestre** (~27k rows/partição vs ~365 — Postgres aproveita pruning); job `create-next-partitions` (regra 34) inclui agora trimestralmente
- **NOVO** [docs/dev/portability.md](docs/dev/portability.md) — cookbook Sprint 19b com 8 regras de portabilidade tabuladas + tabela de equivalências Fase 1↔2 + checklist "antes de adotar feature Supabase" + lista do que muda vs o que não muda no cutover
- **NOVO** [docs/dev/realtime.md](docs/dev/realtime.md) — padrão LISTEN/NOTIFY canônico (channels, payload format, implementação Sprint 00) + quando usar Supabase Realtime (broadcast ≥5 clients) + nota PgBouncer (LISTEN/NOTIFY exige session mode em conexão dedicada via `DATABASE_URL_DIRECT`) + estratégia de migração no Sprint 19b
- [Sprint 02](docs/sprints/02-geral-crm-pessoas.md) — função SQL `has_cross_tenant_access(p_reader_user_id, p_patient_person_id, p_module_type, p_category)` agora detalhada com lógica completa (8 passos) + 6 cenários de teste cobrindo intra-tenant, cross-tenant ativo, vínculo revogado, módulo não autorizado, categoria fora do `data_level_max`, limite duro financeiro
- [Sprint 00](docs/sprints/00-setup-infra.md) — checklist de **arquivos vazios de RIPD com proprietário + deadline** declarados em `docs/compliance/ripd/`: 8 RIPDs (prontuario-fisio, tiss-convenios, nutri-exames, diario-alimentar, teleconsulta, pipeline-exames-ia, device-hub, reconhecimento-facial) com proprietário declarado (dev Sprint X + DPO) + deadline (feature flag respectivo ON) + CI bloqueia merge se ainda em `Status: TODO` + script `scripts/hash-ripd.ts` calcula SHA-256 automaticamente

**Menores (2):**

- [docs/acesso-e-autorizacao.md](docs/acesso-e-autorizacao.md) — seção Camada 4 reorganizada com **hierarquia de fontes de verdade** explícita: tabela com 6 colunas (Tipo, Cenário canônico, Mecanismo técnico, Regra(s), ADR, Sprint que ativa) + **decision tree em prosa** (mesmo tenant_id+company_id? → cross-module; mesmo tenant_id? → cross-company; nenhum? → cross-tenant) + bloco "limites duros que valem em todos os tipos"
- [docs/compliance/ripd/v1.0-passaporte-paciente.md](docs/compliance/ripd/v1.0-passaporte-paciente.md) — campo "Hash SHA-256 do conteúdo" agora referencia `scripts/hash-ripd.ts` (Sprint 00) com workflow de commit hook automatizado em vez de prosa ambígua

**Veredicto da 5ª passada:**

> Documentação atingiu **threshold de estabilidade auditável** com cadeia "regra → ADR → sprint → lint → arquivo" rastreável de ponta a ponta. Próxima auditoria genuína deve aguardar **pós-Sprint 01b implementação** — achados serão sobre execução real, não sobre estado documental.

**Padrão de auditoria** (1ª=30 → 5ª=10 issues): retornos decrescentes confirmados; auditorias subsequentes em estado documental seriam over-engineering.

### Docs — Auditoria 2026-04-25 (4ª passada — 14 issues remanescentes + materialização de assets)

Após 3ª rodada, quarta auditoria paralela (validação 3ª rodada + cadeia regra→ADR→sprint→lint→arquivo) achou 14 issues — principalmente **lints prometidos sem sprint criador** + **arquivos compliance citados mas não materializados**. **5 críticos + 5 maiores + 4 menores, todos endereçados.**

**Críticos (5):**

- [Sprint 00](docs/sprints/00-setup-infra.md) — checklist completo de **lints custom faltantes**:
  - `no-hardcoded-design-token` (regra 44) com regex bloqueando hex/font/spacing/radius/size literal em `apps/web/**` exceto `tokens.css`
  - `high-risk-action-must-require-recent-mfa` (regra 43) bloqueando Server Actions listadas em `packages/security/high-risk-actions.ts` sem chamar `requireRecentMfa()`
  - **Arquivo `packages/security/high-risk-actions.ts`** com lista canônica MVP de 16 ações alto-risco (cancelTissGuide, cancelNfe, voidPaidInvoice, anonymizeMember, openPamSession, restoreBackup, etc) com `requireMfaMaxAgeMins=15` default
- [Sprint 02](docs/sprints/02-geral-crm-pessoas.md) — checklist explícito da função SQL `has_cross_tenant_access()` + lint custom `cross-tenant-read-must-log` (regra 42) + RIPD obrigatório `docs/compliance/ripd/v1.0-passaporte-paciente.md` antes de feature ir a produção
- **NOVO** [docs/compliance/ripd/v1.0-passaporte-paciente.md](docs/compliance/ripd/v1.0-passaporte-paciente.md) — primeiro RIPD real materializado (era apenas template); 10 seções ANPD compliant; **DPO aceita com restrições** (4 condições obrigatórias antes de ativação em produção: revisão jurídica externa, primeiro tenant clínico só após 30d MVP estável, auditoria interna trimestral 1% das leituras, rate limit ajustável)
- **NOVO** [docs/compliance/data-deletion-playbook.md](docs/compliance/data-deletion-playbook.md) — citado por ADR 0054 + Sprint 01a, agora materializado; cascata canônica `anonymize_tenant_data()` por tabela respeitando retenção legal (prontuário 20a Lei 13.787 / fiscal 5a / audit 5a); preserva agregados estatísticos, remove PII, cifra-com-chave-perdida em conteúdo clínico; idempotente; 3 momentos de comunicação ao titular
- [Sprint 01b](docs/sprints/01b-rbac-e-consent.md) — schema `ai_feature_classifications` resolvido com **`is_global bool` + check constraint** eliminando ambiguidade do `tenant_id` nullable (regra 28 gate funcional para features globais e tenant-específicas) + unique constraints separadas

**Maiores (5):**

- [Sprint 04](docs/sprints/04-geral-financeiro-asaas.md) — schema `tenant_usage_snapshots` **completo** com responsabilidade clara (Sprint 04 cria; Sprint 06/36 populam): member_overage_count + value generated, AI/fiscal counts com limits e overage_value generated, storage tracking; PARTITION BY RANGE (ano)
- [Sprint 01b](docs/sprints/01b-rbac-e-consent.md) — **seed completo de roles** com `requires_mfa` por role (medico/fisio/nutri/personal/enfermeiro/tenant_owner/dpo/super_admin = true; super_admin_rede/diretor_matriz/gerente_filial/contador_externo = true; recepcao/member = false escalável via `tenant_settings.mfa_extra_roles[]`) + 2 testes E2E (login bloqueado sem MFA + recepcao + cancelTissGuide com `requireRecentMfa()`)
- **NOVO** [docs/runbooks/rotate-secrets.md](docs/runbooks/rotate-secrets.md) — citado por ADR 0073 camada 7, agora materializado; inventário de 16 tipos de secrets (JWT_SECRET, KEK master/tenant, Asaas/Focus/Gemini/Groq, Cert A1, etc) com frequência e impacto; passos específicos para JWT_SECRET (transição 24h dual-key) e KEK master (re-cifragem background)
- **NOVO** [docs/compliance/anvisa-notifications/_template.md](docs/compliance/anvisa-notifications/_template.md) — template para notificação SaMD Classe II RDC 657/2022 (ISO 14971 risk management + validação clínica + responsabilidades + pós-mercado)
- [Sprint 36](docs/sprints/36-geral-fiscal-focus-nfe.md) — citação explícita de [ADR 0079](docs/decisions/0079-tiss-401-ans-padrao-vigente.md) com nota sobre coexistência operacional TISS (Sprint 22) + NFS-e (Sprint 36) para co-participação de paciente/repasse de operadora

**Menores (4):**

- Sprints clínicos [20](docs/sprints/20-fisio-prontuario-cid-cif.md), [22](docs/sprints/22-fisio-tiss-tuss-convenios.md), [30](docs/sprints/30-nutri-suplementos-exames.md), [31](docs/sprints/31-geral-diario-alimentar-teleconsulta.md), [33](docs/sprints/33-geral-pipeline-exames.md) — **commit checklist agora exige RIPD próprio** publicado antes do feature flag ir a produção: `v1.0-prontuario-fisio.md`, `v1.0-tiss-convenios.md`, `v1.0-nutri-exames.md`, `v1.0-diario-alimentar.md` + `v1.0-teleconsulta.md`, `v1.0-pipeline-exames-ia.md`
- Sprint 33 — checklist adicional de **notificação ANVISA RDC 657/2022** (Pipeline Exames IA é Classe II) usando o novo template `_template.md`
- ADR 0043 (Nutri-Agent) — já corretamente mapeado em roadmap.md para Sprint 34 (sem ação adicional)
- Cluster ADRs 24/25 — aceitável (já documentado em rodadas anteriores)

**Lições da 4ª passada:**

- Lints custom prometidos por regras precisam ter sprint criador explícito no commit checklist; senão são "regulação fantasma"
- Schemas com flags ambíguas (ex: `tenant_id nullable = global`) viram bombas-relógio; usar `is_global bool` + check constraint elimina interpretação ad-hoc
- Templates de compliance (RIPD, ANVISA, STRIDE) são úteis mas não substituem **arquivos reais por feature** — sprints devem listar criação no commit checklist
- DPO pode aceitar tratamento "com restrições" (LGPD permite) — útil para features de risco médio (passaporte cross-tenant) onde implementação técnica está pronta mas operação requer salvaguardas adicionais
- Cadeia "regra → ADR → sprint → lint → arquivo" precisa ser rastreável de ponta a ponta; gap em qualquer elo torna a regra inexequível

### Docs — Auditoria 2026-04-25 (3ª passada — 18 issues + propagação da regra 44)

Após 2ª rodada, terceira auditoria paralela (validação 2ª rodada + gaps estruturais sistêmicos) achou 18 issues remanescentes — alguns introduzidos pelas correções anteriores, outros estruturais. Em paralelo, **regra 44 (Design System) foi adicionada externamente em rules.md** — propagada para CLAUDE.md e arquivos dependentes. **Total: 18 issues + 1 mudança externa, todos endereçados.**

**Críticos (7):**

- [docs/rules.md](docs/rules.md) — contagem 43→**44**; novo header "Design system 'Equilíbrio Vital' (44)" no índice; bloco "Pesquisa global + responsividade (30–31)" reorganizado; `---` duplicado removido; **regra 43 expandida** com gate `requireRecentMfa(maxAgeMin=15)` + lista canônica de ações alto-risco em `packages/security/high-risk-actions.ts` + lint custom `high-risk-action-must-require-recent-mfa`
- [CLAUDE.md](CLAUDE.md) — contagem 43→44 + **nota de precedência** "rules.md prevalece em conflito"; **regra 29 nova** sobre Design System na lista operacional; referência ao `docs/compliance/dpo.md`; `docs/compliance/`, `docs/runbooks/`, `docs/threat-models/` listados na seção de docs de referência
- **NOVO** [docs/runbooks/_template.md](docs/runbooks/_template.md) + [restore-test.md](docs/runbooks/restore-test.md) + [ia-byok-emergencial.md](docs/runbooks/ia-byok-emergencial.md) + [restore-pg.md](docs/runbooks/restore-pg.md) — sprints 06/19b + ADR 0073 citavam runbooks que não existiam estruturalmente
- **NOVO** [docs/compliance/ripd/_template.md](docs/compliance/ripd/_template.md) + [docs/compliance/samd-classification.md](docs/compliance/samd-classification.md) + [docs/compliance/lgpd-data-inventory.md](docs/compliance/lgpd-data-inventory.md) + [docs/threat-models/_template-stride.md](docs/threat-models/_template-stride.md) — ADRs 0054/0067/0073 prometiam, faltava criar
- [Sprint 02](docs/sprints/02-geral-crm-pessoas.md) — checklist explícito "validar via migration smoke que `patient_data_access_log` existe + partição vigente do mês está criada; falha = bloqueia merge"
- [Sprint 01a](docs/sprints/01a-identidade-e-topology.md) — **commit checklist completo de trial 30d retenção**: schema `subscription_status`/`trial_ends_at`, job diário `process-trial-lifecycle`, função SQL `anonymize_trial_data()` (preserva agregados, remove PII, cifra-com-chave-perdida via rotação KEK), trigger audit_log com `legal_basis='lgpd_art16_eliminacao'`, 2 testes E2E (D+44 anonimização vs D+10 conversão), playbook em `docs/compliance/data-deletion-playbook.md`
- **NOVO** [docs/decisions/0035-ocr-boleto-provider-abstrato.md](docs/decisions/0035-ocr-boleto-provider-abstrato.md) — ADR formal para a "decisão fantasma" reconhecida no roadmap; OCR.space default + 5 adapters; BYOK pattern coerente com 0048/0064/0051; roadmap.md atualizado pra apontar pro arquivo

**Maiores (7):**

- [ADR 0066](docs/decisions/0066-plano-comercial-pricing-trial.md) — **seção "Versão vigente (2026-04-25)" no topo** com tabela canônica (6 tiers); histórico preservado mas marcado como "não-fonte de verdade"; retenção `audit_log` uniformizada **5 anos cross-tier** (era "60 meses" misturando unidades); 3 notas explicativas (retenção é regulatória; cota IA Solo Combo igual a Solo com racional; storage 2GB Solo Combo com gatilho de migração)
- [docs/compliance/dpo.md](docs/compliance/dpo.md) — agora linkado em CLAUDE.md
- [Sprint 02](docs/sprints/02-geral-crm-pessoas.md) — `patient_data_access_log` agora tem dependência explícita
- Stubs Sprint 34/35 — comentário HTML apontando pro `_template.md`
- ADR 0073 backup R2 — já fechado em 2ª rodada (sem mudança aqui)
- ADR 0035 ghost — resolvido (criação acima)
- Estruturas `runbooks/`, `threat-models/`, `compliance/` agora documentadas como dependências de Sprint 00

**Menores (4):**

- Cluster ADRs 24/25 — aceitável (conversa intensiva)
- Tabela retenção em 4 fontes — risco fragmentação documentado para futuro `docs/retencao-compliance.md` se voltar a divergir
- Sprint 35 stub: ADRs futuros >=0080 (era 0047/0048 fora da faixa reservada)
- Pré-existente: numeração CLAUDE.md regra 28 vs rules.md 28 — agora resolvida via nota de precedência

**Lições da 3ª passada:**

- Estruturas de diretórios prometidas em ADRs precisam ser criadas pelo Sprint 00; ADR sozinho não materializa
- Ghost ADRs (números citados sem arquivo) devem ser resolvidos com criação retroativa formal quando decisão já está em uso múltiplo
- ADR com múltiplas revisões precisa de seção "Versão vigente" no topo
- Cota IA não escala automaticamente com features adicionadas — racional precisa estar documentado
- Quando regra nova é adicionada externamente em `rules.md`, propagar imediatamente para CLAUDE.md (contagem + lista operacional + índice)

### Docs — Auditoria 2026-04-25 (2ª passada — 14 issues remanescentes/introduzidas pela 1ª rodada)

Após primeira rodada de correções (abaixo), nova auditoria paralela em 4 frentes (pricing, ADRs, sprints, compliance) achou novos gaps + alguns introduzidos pela própria 1ª rodada. **9 críticos + 5 maiores corrigidos.**

**Críticos:**

- [CLAUDE.md](CLAUDE.md) regra MFA — adicionei como "regra 28" criando colisão visual (já existia regra 27 antes); reordenado: passaporte cross-tenant continua como 27, MFA agora é regra 28 (referencia regra 43 de rules.md). Adicionado gate `requireRecentMfa()` para ações alto-risco mesmo em roles com MFA opcional.
- [ADR 0054](docs/decisions/0054-lgpd-art11-dados-saude-ripd-versionado.md) — Lei 13.787/2018 adicionada explicitamente em **Context** como "lei federal primária" sobre prontuário eletrônico (hierarquicamente superior a CFM 2.299/COFFITO 415/CFN 599); estava antes só em ADR 0072 e CLAUDE.md, faltava no documento de retenção
- [Sprint 01b](docs/sprints/01b-rbac-e-consent.md) — `patient_data_access_log` schema completo + particionamento mensal + RLS (era órfão; nenhum sprint criava a tabela apesar de regra 42 + ADR 0077 dependerem dela)
- [Sprint 01b](docs/sprints/01b-rbac-e-consent.md) — coluna `tenants.mode enum('multi','solo')` + check constraint `NOT (mode='solo' AND cross_company_access=true)` (Plano Solo do ADR 0069 não tinha schema suporte)
- [Sprint 01a](docs/sprints/01a-identidade-e-topology.md) — schema `tenants` ganhou `subscription_status` + `trial_ends_at` + nota sobre `mode` virá em 01b
- [ADR 0066](docs/decisions/0066-plano-comercial-pricing-trial.md) — Planos Solo R$ 49 e Solo Combo R$ 69 **formalizados como tiers MVP aceitos** (estavam como "futuro" no rascunho, divergindo de CLAUDE.md/comercial.md que já vendiam como MVP); tabela de quotas estendida com colunas Solo + nota de cota IA hard-stop sem overage referenciando [ADR 0064](docs/decisions/0064-ia-arquitetura-gemini-default-byok-rag.md); retenção audit_log uniformizada em 5 anos cross-tier (alinhado a ADR 0072)
- [Sprint 22](docs/sprints/22-fisio-tiss-tuss-convenios.md) — citação explícita de [ADR 0079](docs/decisions/0079-tiss-401-ans-padrao-vigente.md) (TISS 4.01) como ADR já publicado; relação com ADRs 0029/0030/0031 esperados clarificada (detalham 0079, não substituem); gate MFA `requireRecentMfa()` para cancelamento de guia
- [docs/roadmap.md](docs/roadmap.md) — tabela de mapeamento de ADRs reservados expandida com **Status** + ADRs 0028 (CID/CIF Sprint 20) + 0029-0031 (TISS Sprint 22 — antes "reservados") + 0043-0046 (Sprint 34/35) com quem produz; ADR 0035 marcado explicitamente como "decisão tomada conversacionalmente, ADR formal será lavrado quando Sprint 15 começar"
- **NOVO** [docs/compliance/dpo.md](docs/compliance/dpo.md) — documento formal de nomeação do Encarregado (LGPD art. 41 + Resolução ANPD nº 18/2024) com nome, email, vigência, próxima revisão, atribuições, limites do papel interino, histórico

**Maiores:**

- [ADR 0073](docs/decisions/0073-postura-seguranca-defesa-em-profundidade.md) regra 40 — escolha de backup off-site **fechada em Cloudflare R2** (era "R2 OU Backblaze OU GitHub — escolher um"); Backblaze e GitHub Releases ficam como fallback DR, não storage paralelo
- [Sprint 06](docs/sprints/06-geral-copilot-base.md) — job `aggregate-tenant-ai-usage` que popula `tenant_usage_snapshots.ai_calls_count` (era referenciado em Sprint 04 sem reciprocidade); runbook "BYOK emergencial" para tenant clínico que excede cota mid-month e não pode parar (CFM 2.454/2026 supervisão humana)
- [ADR 0077](docs/decisions/0077-passaporte-paciente-vinculo-cross-tenant.md) — status mudado de `Proposed` → `Accepted` (decisão já estava sendo tratada como vigente por outros docs)
- [Sprint 35](docs/sprints/35-mobile-app-nativo-expo.md) stub — ADRs esperados 0047/0048 reformulados (faixa reservada acaba em 0046); novos ADRs vão para >=0080

**Menores:**

- CHANGELOG.md — limpeza de menção órfã a "19c" (Sprint 19b nota de escopo descreveu sub-fases sem prometer sprint 19c)

**Lições da 2ª passada:**

- Adicionar regra/coluna em CLAUDE.md sem reordenar quebrou numeração visual; processo: sempre revisar lista numerada após inserção
- Stubs Sprint 34/35 com ADRs esperados fora da faixa reservada criou inconsistência — corrigido alinhando à convenção
- ADR ghost (0035) gerou alarme do agente — agora explícito no roadmap como "decisão conversacional, ADR formal pendente"
- Tabelas de retenção em múltiplos ADRs (0054 vs 0066 vs 0072) divergiam — uniformizado em 5 anos audit_log

### Docs — Auditoria de documentação 2026-04-25 (consolidação de 30 falhas)

Auditoria abrangente paralela em 5 frentes (docs raiz, ADRs, roadmap×sprints, pricing/comercial, compliance) achou contradições, gaps e inconsistências acumuladas. **Todas as falhas críticas e maiores corrigidas em lote**, sem mudança de comportamento de código (apenas documentação).

**Correções de ADRs:**

- [ADR 0001](docs/decisions/0001-stack-base.md) — addendum "IA superseded por 0064" reconhecendo que Gemini é default LogiFit (não Claude como dizia o original)
- [ADR 0054](docs/decisions/0054-lgpd-art11-dados-saude-ripd-versionado.md) — retenção `audit_log` corrigida de "6 meses ideal / 5 anos mínimo" para **5 anos** alinhado a [ADR 0072](docs/decisions/0072-escalabilidade-banco-particionamento-retencao-cold-storage.md); referência a Lei 13.787/2018 para prontuário médico 20a
- [ADR 0072](docs/decisions/0072-escalabilidade-banco-particionamento-retencao-cold-storage.md) — adicionado `patient_data_access_log` (ADR 0077) na tabela de retenção com partição mensal obrigatória + estimativa volume 10-15M linhas/ano (regra 34); Lei 13.787/2018 citada como norma primária
- [ADR 0064](docs/decisions/0064-ia-arquitetura-gemini-default-byok-rag.md) — link quebrado `0015-sem-implementar-copilot-safety.md` corrigido para texto inline citando convenção
- [ADR 0067](docs/decisions/0067-dpo-governanca-compliance-lgpd.md) — sub-processors expandido com Cloudflare R2 (backup), Oracle Cloud OCI (Fase 2), Cloudflare Turnstile, DPO-as-a-service explícito como add-on terceirizado
- [ADR 0079 NOVO](docs/decisions/0079-tiss-401-ans-padrao-vigente.md) — TISS 4.01 ANS (Ofício-Circular 1/2026) como padrão vigente; pipeline atualização semestral + validador proativo + versionamento por guia + RAG global indexa terminologia

**Correções de regras (`docs/rules.md`):**

- **Regra 43 NOVA** — MFA obrigatório para profissionais de saúde (médico/fisio/nutri/personal/enfermeiro) + roles administrativas críticas (tenant_owner/dpo/super_admin); CI tem E2E
- Headers de seção adicionados (Multi-empresa / i18n / IA + LGPD / Pesquisa global / Arquitetura IA / Escalabilidade / Segurança / Assistente IA / Passaporte cross-tenant / MFA / Processo / Código)
- Regra 34 atualizada: retenção 20a prontuário cita Lei 13.787/2018 (não só CFM 2.299) + `patient_data_access_log` 5a (ADR 0077)
- Total: **43 regras** (era 42; CLAUDE.md atualizado)

**Correções de docs raiz:**

- [CLAUDE.md](CLAUDE.md) — Modelo comercial reescrito: Starter "Academia no MVP" (Fisio/Nutri liberam Fase 2/3); Plano Solo R$ 49 / Solo Combo R$ 69 explicitado; "1 active member por (paciente, tenant)" deixa cobrança cross-tenant clara; trial 30d cita anonimização técnica; cota IA explicada com hard-stop; **DPO interno LogiFit (fundador) vs DPO-as-a-service Enterprise (firma externa) distinguidos**; backup off-site MVP é Cloudflare R2; Upstash Redis adicionado em Stack; Lei 13.787/2018 como lei federal primária; gate ICP-Brasil por kind profissional; seção "cross-company vs cross-tenant" para clarificar terminologia
- [docs/roadmap.md](docs/roadmap.md) — seção nova "Convenção de numeração de ADRs" explicando que 0011-0046 estão **reservados a sprints que vão produzi-los** (não são ADRs perdidos); mapeamento de cada número à sprint que produz
- [docs/comercial.md](docs/comercial.md) — pricing alinhado a CLAUDE.md (Plano Solo + Solo Combo adicionados; Starter "Academia no MVP" explicado); cota IA termo "chamadas" (não "mensagens"); DPO-as-a-service esclarecido como add-on terceirizado; eventos NFS-e "não contam" no overage explícito; Supabase como MVP-only formalmente comunicado; member counting cross-tenant esclarecido
- [docs/modulos.md](docs/modulos.md) — link quebrado `0015-sem-implementar-copilot-safety.md` corrigido; Starter R$ 79 → R$ 99; descrição de planos completa com Lei 13.787 / passaporte cross-tenant / Plano Solo
- [docs/arquitetura.md](docs/arquitetura.md) — seção IA atualizada (Gemini default LogiFit, Groq Whisper, BYOK, Upstash sub-processor, cota mensal hard-stop); referências a ADRs 0064 e 0067
- [docs/plano-estrutura.md](docs/plano-estrutura.md) — marca temporal corrigida ("histórico de 2026-04-22; última leitura confirmada 2026-04-25"); contadores atualizados (41 ADRs, 43 regras)

**Correções de sprints:**

- [Sprint 04](docs/sprints/04-geral-financeiro-asaas.md) — UI overage member adicionada (`tenant_usage_snapshots` schema + widget `/app/settings/tenant/plan` + banner topo dashboard)
- [Sprint 01a](docs/sprints/01a-identidade-e-topology.md) — trial 14d + ciclo de retenção 30d especificado tecnicamente (job `process-trial-lifecycle` + anonimização preservando agregados, removendo PII)
- [Sprint 06](docs/sprints/06-geral-copilot-base.md) — cota IA atualizada com Plano Solo + termo "chamadas" + hard-stop (ADR 0066)
- [Sprint 20](docs/sprints/20-fisio-prontuario-cid-cif.md) — Lei 13.787/2018 citada como lei federal primária; gate ICP-Brasil por kind profissional já estava bem detalhado, agora reforçado
- [Sprint 19b](docs/sprints/19b-migracao-hospedagem-oracle.md) — nota de escopo realista adicionada (3 sub-fases internas DB+Auth+Storage; se cronograma estourar, escopo reduz pra DB+Auth em 19b e Storage/Realtime em sprint posterior)
- **NOVO** [Sprint 34](docs/sprints/34-nutri-agent-ia.md) — stub criado (Nutri-Agent IA cruzando módulos)
- **NOVO** [Sprint 35](docs/sprints/35-mobile-app-nativo-expo.md) — stub criado (App Nativo Expo iOS+Android)

**Falhas não acionadas (apenas notadas):**

- ADRs 0011-0046 não estão "perdidos" — são números **reservados a sprints futuros** que vão produzi-los; nada a fazer agora; convenção formalizada em roadmap.md

### Decided — ADR 0078: Hospedagem em duas fases (MVP em Vercel + Supabase Pro · pós-Sprint 19 migra pra Vercel + Postgres Oracle Cloud free tier)

Conversa de produto (2026-04-25) levantou questão fundamental nunca formalizada: onde LogiFit roda? Stack base (ADR 0001) listava "Vercel + Supabase" sem documentar quando esse modelo deixaria de servir. ADR 0077 (passaporte cross-tenant) acabou de aumentar carga no Postgres (cross-tenant queries em runtime, view materializada, audit log particionado mensal, função `has_cross_tenant_access` hot, trigger cruzando 2 tabelas). Custo Supabase escala mal (Pro $25 = shared CPU 1GB; upgrade pra Small $185-410). Oracle Cloud OCI free tier vitalício oferece 24GB ARM Ampere + 4 OCPU + 200GB grátis para sempre.

**Decisão (2026-04-25):**

- **Fase 1 (Sprint 00 → 19, ~6-8 meses):** Vercel + Supabase Pro — zero ops, foco em validar produto
- **Fase 2 (Sprint 19b+, pós-MVP estável):** migrar pra Vercel + Postgres Oracle Cloud OCI + BetterAuth/Lucia + Cloudflare R2 + LISTEN/NOTIFY (~60h, janela cutover 2-4h madrugada)
- **8 regras de portabilidade** ativas desde Sprint 00 garantem migração finita: storage adapter pattern, RLS em SQL puro (não via Studio), JWT cookie próprio (não `@supabase/auth-helpers-nextjs`), proibido Supabase Edge Functions, PgBouncer-friendly desde dia 1, connection via `DATABASE_URL` (não `supabase.from().select()`), Drizzle única fonte schema
- **Lints custom em CI** (Sprint 00): `no-supabase-functions` + `no-direct-supabase-query` bloqueiam lock-in acidental
- **Gatilhos pra antecipar migração** documentados: compute >70% sustained 2sem · latência cross-tenant >800ms · custo >R$ 600/mês · cliente Enterprise pediu BYOK · vazamento ou downtime >4h
- **Custo comparativo:** decisão A→B gasta R$ 500 a mais que "começar B direto" mas adia 60h de ops pra depois do MVP validado; economiza ~R$ 1.500/mês vs continuar Supabase com upgrades

**O que a decisão NÃO muda:**

Drizzle como ORM (ADR 0004), RLS como isolamento primário (ADR 0002), particionamento (regra 34), sharding via `tenants.shard_url` preparado, audit hash chain (regra 39), IA via `resolveModelForTask` (regra 32), multi-tenant por subdomínio (ADR 0065), cross-tenant via vínculo (regra 42 / ADR 0077). Tudo agnóstico de hospedagem do PG.

**Docs atualizados:**

- `docs/decisions/0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md` — ADR completo (estratégia 2 fases + regras portabilidade + gatilhos antecipação + plano migração 7 fases + custo comparativo)
- `docs/sprints/19b-migracao-hospedagem-oracle.md` — Sprint detalhado da migração (7 fases + cutover plan + rollback ≤30min + 60h estimadas + 30d observação pós-cutover)
- `CLAUDE.md` — seção Stack indica 2 fases + 8 regras de portabilidade listadas
- `docs/roadmap.md` — Sprint 19b adicionado entre Sprint 19 e Fase 2 (#22)
- `docs/sprints/00-setup-infra.md` — checklist com storage adapter pattern + RLS SQL puro + lints + 8 regras portabilidade ativas desde dia 1
- `docs/sprints/01a-identidade-e-topology.md` — Auth portátil: JWT custom claims + cookie httpOnly próprio; **proibido `@supabase/auth-helpers-nextjs`**; uso minimalista `@supabase/supabase-js` (só `signInWithOtp`/`verifyOtp`/`signInWithOAuth`)

**Riscos abertos:**

1. Oracle muda free tier — improvável (vitalício documentado), mitigação: AWS RDS / DigitalOcean Managed PG são alternativas com pricing previsível
2. Janela de cutover dá problema — mitigação: backup pré-cutover + rollback plan documentado RTO ≤30min
3. Cliente Enterprise no MVP exigindo hospedagem dedicada — caso especial faturado à parte, instância separada Supabase Pro ou Oracle dedicado
4. Decisões pendentes pra Sprint 19b: BetterAuth vs Lucia (spike 4h), WebSocket onde rodar (Vercel Edge limitado vs Node container Oracle — spike 2h)

### Added — ADR 0077: Passaporte do paciente cross-tenant + vínculo por empresa com módulos explícitos + invite-link + auto-cadastro proativo

Visão de produto (2026-04-25) revelou contradição: usuário queria "todos os profissionais [da rede LogiFit] podem acessar os dados de um paciente em tenants diferentes" — mas o modelo vigente proibia cross-tenant individual (princípio implícito em `docs/acesso-e-autorizacao.md`, referenciado erroneamente como "regra 26" — regra 26 real é sobre `groups`).

**Decisões fechadas (2026-04-25):**

- **Modelo C (híbrido)** escolhido contra Modelo A (vínculo por módulo) e Modelo B (vínculo só por empresa): vínculo é com a **empresa**, módulos liberados são **explícitos** (`patient_company_links` + `patient_link_modules`), responsável técnico **por módulo** (atende exigência CFM/COFFITO/CFN/CONFEF)
- **5 módulos canônicos no MVP** via lookup table extensível (`patient_module_types`): `academia`, `personal_training`, `fisioterapia`, `nutricao`, `pilates` — psicologia/medicina/fonoaudiologia entram em Fase 3+ sem migration
- **Constraint global:** 1 paciente tem no máximo 1 módulo do mesmo tipo ativo em toda a rede — nova empresa do mesmo módulo dispara substituição com confirmação
- **Aceite parcial** suportado: paciente pode aceitar só alguns módulos do pedido (não tudo-ou-nada)
- **Invite-link** sem stub — dados pessoais só persistem após paciente aceitar; branch automático "CPF existe → login" vs "CPF novo → cadastro" + confirmação anti-fraude por nome mascarado
- **Auto-cadastro proativo** (Path B paralelo): paciente pode criar conta sozinho em `app.logifit.com.br/cadastro` (SMS + email + Turnstile), receber invites, **convidar profissional/empresa** (path inverso). Não pode log de treino próprio sem vínculo (foge do foco — não competimos com Strava)
- **5 níveis de dados** taxonomia oficial (Identidade → Antropometria → Treino → Clínico → Workspace interno); Nível 5 nunca cruza tenant nem é exibido pro paciente
- **Cross-tenant entrega resumido**, não bruto — Tenant B recebe "lesão lombar ativa, restrição: sem deadlift", não SOAP completo
- **Limites duros que nunca cruzam tenant** mesmo com vínculo: financeiro, Nível 5, prontuário CFM original, dado de outras pessoas mencionado no prontuário
- **Cobrança LogiFit:** 1 active member por (paciente, tenant) — paciente em tenant multi-vertical com 2 módulos liberados conta como 1 member
- **Audit obrigatório** em `patient_data_access_log` (síncrono não-bloqueante, particionado por mês — regra 34); paciente vê histórico em `/meu/privacidade/acessos`
- **Diferencial-chave:** alerta cross-prescrição entre tenants — Sprint 11 detecta "dieta 1.400kcal de Tenant A + treino aumentado em Tenant B = risco hipoglicemia" (só existe porque dados cruzam)

**Mudanças em regras:**

- **Regra 42 NOVA** em `docs/rules.md` — cross-tenant SOMENTE via `patient_company_links` ativo + módulo + categoria coberta + audit obrigatório; lint custom `cross-tenant-read-must-log` enforça
- Regra 26 NÃO muda — continua sobre `groups`. Confusão histórica em `docs/acesso-e-autorizacao.md` corrigida.

**Docs atualizados:**

- `docs/decisions/0077-passaporte-paciente-vinculo-cross-tenant.md` — ADR completo (9 partes: modelo, schema, fluxo invite, níveis, substituição, profissional sai, cobrança, auto-cadastro proativo, audit)
- `docs/rules.md` — regra 42 nova
- `docs/acesso-e-autorizacao.md` — Camada 4 expandida com 3 tipos de cruzamento (cross-module, cross-company, cross-tenant); Camada 1 documenta os 2 paths de criação de conta de paciente; matriz resumida atualizada; referências corrigidas
- `CLAUDE.md` — regra 42 listada na seção "Regras que você (Claude) DEVE respeitar"; contagem atualizada 41 → 42 regras
- `docs/sprints/02-geral-crm-pessoas.md` — fluxo de invite + tela de pedidos pendentes + cadastro proativo + UX de vínculo cross-tenant

**Riscos abertos (documentados no ADR):**

1. Regulatório CFM/COFFITO/CFN — exige parecer jurídico antes do GA (sem norma específica sobre troca clínica entre instituições mediada por consent do paciente)
2. Co-controllership LGPD — paciente é controlador? Co-controlador com empresa? LogiFit é operador? DPO precisa modelar (addendum ADR 0067)
3. Liability — Termo de Uso precisa explicitar: dado cross-tenant é informativo, profissional do Tenant B é responsável pela decisão clínica que tomar
4. Performance — view materializada `mv_patient_cross_tenant_summary` + cache Redis 5min
5. Adversarial spam — rate limit 50 invites/dia/tenant + 3 invites/CPF/30d
6. Profissional desonesto migrando pacientes antigos — UX de aceite mostra "essa empresa é nova" + alerta visual
7. Sharding futuro (regra 34 / ADR 0072) — tenants com vínculo cross ativo bloqueados de migrar pra shard separado no MVP

**Status:** Proposed — aguarda confirmação do usuário sobre constraint global de 1 módulo ativo por paciente na rede + limite de invites/dia (default sugerido 50) + parecer jurídico antes do Sprint 02.

### Changed — ADR 0066: Starter R$ 79 → R$ 99 com 1 vertical à escolha + 5 profissionais + 50 NFS-e inclusas (alinhado a ICP real)

Conversa com fundador (2026-04-25) sobre 3 clientes-piloto reais (academia de personals com 5 profs e ~60 alunos, nutricionista solo, clínica fisio com 5 profs) expôs duas falhas no Starter R$ 79 original:

1. **Limite de 2 profissionais com contrato** forçava academia de personals e clínica fisio a pagar Pro R$ 199 mesmo com equipe pequena
2. **Starter só incluía Academia** — nutricionista solo e fisio solo eram forçados a pagar R$ 199 só pra acessar a vertical apropriada

**Decisão (2026-04-25):**

- **Starter sobe para R$ 99** (anuidade R$ 89) — alinhado a Tecnofit Lite/NutMed; +R$ 20 financia mais features
- **Starter ganha "1 vertical à escolha"** — Academia OU Fisio OU Nutri (não simultâneas); cobre o ICP "negócio solo/pequeno especializado em uma área"
- **Limite de profissionais com contrato sobe de 2 → 5** no Starter; users operadores 2 → 3
- **Starter ganha 50 NFS-e inclusas** + R$ 0,50/nota extra (era sem fiscal antes)
- **Cap de overage Starter** ajustado de +R$ 120 → +R$ 100 (reflete novo gap Starter→Pro)
- **Pro mantém todas as verticais simultâneas** — degrau natural: "negócio solo/especializado" (Starter) vs "clínica multi-disciplinar integrada" (Pro)
- Schema `tenant_subscriptions` ganha coluna `vertical_choice enum ('academia','fisio','nutri') nullable` — só Starter usa

**Margem revisada:** Starter R$ 99 - R$ 25 (custo: ~R$ 16 infra + R$ 9 fiscal 50 notas) = **R$ 74 (75%)** — saudável, melhor que os 68% do tier original.

**Cobertura dos 3 clientes-piloto:**

| Cliente | Plano natural | Mensalidade |
|---|---|---|
| Academia de personals (5 profs + 60 alunos compartilhados) | Starter Academia | R$ 99/mês |
| Nutricionista solo (~60-80 pacientes) | Starter Nutrição | R$ 99/mês |
| Clínica fisio (5 profs + pacientes) | Starter Fisio | R$ 99/mês (até 100 pacientes) ou Pro R$ 199 se passar |

**Comparativo competitivo (post-revisão):**

- Tecnofit Lite R$ 99 → mesmo preço, LogiFit ganha multi-vertical à escolha + IA + NFS-e incluída
- iClinic Pro R$ 119 → -R$ 20 + IA + WhatsApp régua
- NutMed R$ 99 → mesmo preço + IA + Portal paciente
- Dietpro R$ 89 → +R$ 10 com features superiores

**Docs atualizados:**

- `CLAUDE.md` — seção Modelo Comercial reflete Starter R$ 99 + vertical à escolha
- `docs/comercial.md` — nova seção "Planos e preços" com tabela detalhada + "Por que Starter à escolha" + comparativo direto com 7 concorrentes
- `docs/decisions/0064-ia-arquitetura-gemini-default-byok-rag.md` — tabela de quotas IA atualizada com pricing vigente (Starter R$ 99/Pro R$ 199/Business R$ 449/Enterprise R$ 1.199+) — corrige defasagem com pricing antigo (R$ 149/R$ 399/R$ 1.500)
- `docs/decisions/0075-assistente-ia-universal-tres-camadas-tool-registry.md` — tabela de cotas mensais
- `docs/decisions/0076-nfse-nacional-provider-complementar.md` — análise de custo Starter atualizada (50 notas/mês ao invés de 100)
- `docs/decisions/0069-perfil-paciente-hub-operacional.md` — observação sobre tier "Solo" R$ 49 futuro registrada como espaço pós-validação

**Princípio orientador:** ICP de pequeno negócio de saúde solo/equipe pequena (≤5 funcionários) é a maioria dos clientes-piloto. Starter precisa atendê-los **sem fricção de upgrade artificial** — quem precisa de 2+ verticais tem motivo real pra ir pro Pro; quem está em 1 vertical não deve ser empurrado pro Pro só por limites mesquinhos.

**Tier "Solo" R$ 49 confirmado como opção futura válida (2026-04-25):** spec preliminar registrada em ADR 0066 seção "Tiers futuros" — 1 vertical, 30 members, 1 prof, 20 NFS-e, IA Camada 1 apenas. Custo ~R$ 12, margem 76%. Não entra no MVP — gatilho de ativação: ≥10 leads inbound rejeitados por preço Starter R$ 99 nos 6 meses pós-MVP.

### Changed — ADR 0066 revisado + ADR 0076: modelo de custo fiscal corrigido + NFS-e Nacional como caminho de redução

Pergunta do usuário (2026-04-25): "600 reais em 2.000 [notas/mês] é muito" — exposta falha no modelo de custo do ADR 0066 que assumia LogiFit absorvendo 100% do custo Focus NFe (~R$ 0,30/nota). Em alto volume (Business com 2.000+ notas/mês) margem virava negativa.

**Decisão (2026-04-25):** combinar 4 caminhos (A+B+C+D) — repasse fiscal via overage + NFS-e Nacional como provider complementar futuro + negociação enterprise Focus + UI de preview de fatura. Rejeitada explicitamente a alternativa de "construir motor fiscal próprio" (escopo 8-12 meses solo + manutenção fiscal eterna + risco regulatório alto; nenhum SaaS BR comparável faz).

**Mudanças no [ADR 0066](docs/decisions/0066-plano-comercial-pricing-trial.md):**

- Tabela de quotas ganha `Emissões fiscais incluídas` (Pro 200/Business 1.000/Enterprise 5.000) + `Overage por nota fiscal extra` (Pro R$ 0,40/Business R$ 0,35/Enterprise R$ 0,25)
- Schema `logifit_plans` ganha colunas `fiscal_emissions_included` + `fiscal_overage_rate_cents`
- Schema `tenant_usage_snapshots` ganha colunas `fiscal_emissions_count`, `fiscal_emissions_included`, `fiscal_overage_amount_cents`, `total_overage_cents`
- Análise de margem reescrita com tabela de custo Focus NFe negociado por volume (R$ 0,29 → R$ 0,18 → R$ 0,12); margem real Business ~42% (base) ou ~45% (com overage); Enterprise piso público é apertado, contrato real cobra a partir de R$ 1.799-2.499 quando volume >5k notas/mês
- Nova seção "Caminhos de melhoria contínua de margem" listando 4 alavancas (negociação Focus, NFS-e Nacional, cache IA, escala)
- UI `/app/settings/tenant/plan` (Sprint 04) mostra preview de fatura com breakdown members + fiscal

**Novo [ADR 0076 — NFS-e Nacional como provider complementar](docs/decisions/0076-nfse-nacional-provider-complementar.md):**

- Não substitui Focus NFe — complementa para municípios aderidos ao padrão nacional (gratuito, infra federal)
- Não entra no MVP — gatilhos: Sprint 36 estável há 3 meses + 10k notas/mês LogiFit + 30% emissões em municípios aderidos + feedback comercial
- Reusa interface `FiscalProvider` ([ADR 0059:59-77](docs/decisions/0059-ciclo-fiscal-emissao-focus-nfe.md)) sem refactor
- Sprint 36c condicional (~2-3 semanas) quando ativar
- Eventos sempre no provider que emitiu (cancelamento/CC-e)

**Sprint 36 atualizado:**

- Pré-Sprint: negociação comercial Focus NFe documentada em `docs/contratos/focus-nfe.md` (target R$ 0,12/nota acima de 10k/mês)
- Coluna `provider` em `fiscal_emissions` preparada para `nfse_nacional` futuro
- Job mensal `aggregate-fiscal-usage-snapshot` alimenta `tenant_usage_snapshots.fiscal_emissions_count` (eventos não contam — só `status='completed'` na primeira emissão)
- Stretch: documentar pontos de plug-in para adapter futuro NFS-e Nacional

**Docs:**

- `docs/comercial.md` — nova seção "Emissão fiscal — pacote incluso + custo proporcional" + comparativo com Tecnofit/iClinic/Feegow + Fase 3 reescrita ("emissão fiscal completa" + "otimização gradual via NFS-e Padrão Nacional pós-PMF")

**Princípio orientador:** repasse proporcional em vez de absorção total + provider plugável em vez de motor próprio + negociação contínua com provider em vez de lock-in.

### Added — ADR 0075: Assistente IA universal — 3 camadas + tool registry distribuído + cotas por plano

Pergunta do usuário (2026-04-24): "vamos ter um chat com a IA para resolver qualquer questão relacionada ao sistema para auxiliar os usuários — qualquer usuário, tudo (perguntas + ações), com urgência". O Sprint 06 original ("Copilot base") cobria apenas profissional clínico ancorado em member com 5 tools hardcoded (`findMember`, `scheduleAppointment`, `findCidByDescription`, `summarizeEvolutions`, `report_issue`). Esse escopo é **3-4× menor** que o pedido: precisava cobrir aluno, recepção, admin, super-admin, contador externo, DPO, personal coach — cada um com persona própria, tools próprias, scope de RBAC próprio.

**Decisão (2026-04-24):** universalizar o assistente em 3 camadas com gates progressivos, tool registry distribuído por módulo, cotas alinhadas aos planos comerciais (ADR 0066), framework de confirmação UI obrigatório para ações de write.

**Princípio orientador:** O Assistente IA do LogiFit é **universal por papel** (qualquer usuário, qualquer tela), **estratificado por risco** (3 camadas com gates), e **extensível por módulo** (cada sprint adiciona suas tools no registry).

**3 camadas de capacidade:**

| Camada | Capacidade | Risco | Gate | Confirma UI? |
|---|---|---|---|---|
| **1. Help** (RAG read-only) | "Como faço X?", "O que significa Y?" | Baixo | Default todos os papéis e planos | Não |
| **2. Insight** (read data) | "Qual minha mensalidade?", "Última avaliação João" | Médio (RBAC + RLS) | Server Actions read-only com `wrapAction()` | Não |
| **3. Action** (write) | "Cancela aula amanhã", "Cria lead João Silva" | Alto | `<ActionConfirmDialog>` obrigatório + audit reforçado + proteção dupla | **Sim sempre** |

**7 personas com `inferPersona(user, tenant)`:**

`member`, `professional_clinical`, `professional_coach`, `admin`, `recepcao`, `super_admin`, `contador_externo`, `dpo` — cada uma com template em `packages/ai/personas/*.ts` (tom + permissões IA + tools típicas) em pt-BR/en-US/es-419 (regra 27). Chip "Falar como: X" sempre visível no header do sheet permite trocar runtime; última escolha persiste em cookie.

**Tool registry distribuído (regra nova 41):**

Cada módulo cria `apps/web/app/(modules)/<modulo>/ai-tools.ts` chamando `registerAITool({ key, layer, label/description i18n, whenAvailable, showInPersonas, argsSchema, resultSchema, requiresConfirmation, confirmationCopy, handler, audit, rateLimitKey })`. Build hook gera `tools_manifest.json` no deploy → seed `tools_registry`. Padrão idêntico a `registerMenuItem` (Sprint 00b) e `search_index_sync` (regra 30).

Server Action que **não** deve ser exposta tem comentário literal `// ai-blocked: <motivo>` no topo. Lint custom `ai-block-respected` em CI bloqueia commit se `registerAITool` aponta para handler bloqueado.

**Whitelist Camada 3 conservadora no MVP (~9 tools seguras):**

- `member`: `cancelMyAppointment`, `requestSecondCopy`, `confirmAppointment`
- `professional_*`: `createDraftEvolution`, `report_issue`
- `recepcao`/`admin`: `scheduleAppointmentForMember`, `requestSecondCopyForMember`, `createLead`, `inviteUser`

**Bloqueado:** qualquer `DELETE`, `signEvolution` (ICP-Brasil), `chargeBatch`, `anonymizeMember`, `transferMemberBetweenCompanies`, `runOpenFinancePayment`, mudanças em `tenant_settings`/RBAC/plano.

**Fluxo Camada 3 (proteção dupla):**

```
1. LLM emite tool call proposeAction({tool, args, reason})
2. Backend INSERT assistant_action_proposals (state=pending, expires=+5min)
   retorna { proposalId, confirmationCopy: { title, description, impact, affectedEntities } }
3. Frontend renderiza <ActionConfirmDialog> com [Confirmar/Editar/Cancelar]
4. User confirma → POST /api/ai/proposals/{id}/confirm
5. Handler real exige proposal_id confirmado válido (actionSource=ai_assistant + sem proposta = FORBIDDEN)
6. Audit log grava action_source='ai_assistant' + proposal_id + decisão humana
```

**UI universal (mobile-first regra 31):**

- `<AssistantFAB>` em `<AppLayout>` — 56×56px mobile / 64×64px desktop, sempre visível em `/app/*`
- `<AssistantSheet>` — bottom sheet 92vh mobile (drag-down fecha) / side panel 420px desktop
- Página dedicada `/app/assistente` + variantes `/meu/assistente` (Sprint 26) e `/app/coach/assistente` (ADR 0074)
- Atalho `Ctrl+/` ou `Cmd+/`; cross-link em busca global Ctrl+K (ADR 0062)
- Contexto auto-injetado por rota (`/app/members/[id]/*` → member ativo + tools com scope=member)

**Cotas alinhadas aos planos comerciais (ADR 0066):**

| Plano | Mensal | Soft diário | BYOK |
|---|---|---|---|
| Starter R$ 79 | 500 | ~50/dia | — |
| Pro R$ 199 | 3.000 | ~150/dia | opcional add-on |
| Business R$ 449 | 10.000 | ~500/dia | ✅ opcional |
| Enterprise | 25.000 default | sem soft | ✅ ilimitado quando ativo |

**Regras de contagem:**
- Camada 1 cache hit ⇒ 0 chamadas; cache miss ⇒ 1
- Camada 2 ⇒ 1 por turn
- Camada 3 (proposta + reformulação pós-execução) ⇒ até 2
- Tool execution (Server Action) **não conta** na quota IA — conta no rate limit Server Actions (regra 36)
- STT minutos separado (Pro 60min, Business 300min, Enterprise 1500min)

Soft diário excedido → toast informativo. Mensal excedido → circuit breaker + CTA "Configure BYOK".

**Schemas novos:**

```sql
tools_registry              -- ~500 linhas, não particiona
assistant_action_proposals  -- particionada por mês, @volume_estimate_yearly: 5M+
tenant_assistant_personas   -- 1 linha por tenant

ALTER TABLE ai_audit_log ADD COLUMN persona text;
ALTER TABLE ai_audit_log ADD COLUMN layer text;
ALTER TABLE ai_audit_log ADD COLUMN action_proposal_id uuid;
ALTER TABLE ai_audit_log ADD COLUMN tool_keys text[];
```

**Telemetria PostHog (12 eventos novos):**

`assistant.session_opened`, `assistant.message_sent`, `assistant.cache_hit`, `assistant.tool_called`, `assistant.action_proposed`, `assistant.action_confirmed`, `assistant.action_rejected`, `assistant.action_executed`, `assistant.quota_warning` (80%), `assistant.quota_blocked` (100%), `assistant.rate_limited`, `assistant.incident`.

Dashboard `/app/super-admin/ai-usage` mostra top tenants por consumo, top tools usadas, cache hit rate global, latência média por persona, taxa de aceitação Camada 3 por tool.

**Sprints ajustados:**

- **Sprint 06 (renomeado "Assistente IA universal base")** — cresce de 3-4 → 5-6 semanas
- **Sprints 02, 03, 04, 05, 08, 09, 10, 11, 12, 13, 15, 17, 19, 20, 21, 22, 24, 26, 30, 31, 32, 33, 36** — cada um adiciona arquivo `<modulo>/ai-tools.ts` registrando suas tools (~1-2 dias por sprint, parte do Definition of Done)
- **Sprint 26 (portal paciente PWA)** — adiciona `/meu/assistente` no shell
- **Sprint 11 (treinos coach PWA)** — adiciona `/app/coach/assistente` no shell

**Regra nova:**

- **Regra 41** — Toda Server Action de módulo que deve ser usável pelo Assistente IA registra-se em `tools_registry` via `registerAITool({...})`. Server Action que NÃO deve ser exposta tem `// ai-blocked: <motivo>` no topo. Tools Camada 3 (write) sempre passam por `<ActionConfirmDialog>`. LLM nunca chama Server Action diretamente — sempre via `proposeAction(toolKey, args)`. Handler real rejeita execução se `actionSource='ai_assistant'` sem `proposal_id` confirmado.

**Compliance integrada:** regras 28 (CFM 2.454/2026 — Comitê IA aplicado em persona profissional clínica), 29 (LGPD art. 11 — RIPD novo), 32 (resolveModelForTask — featureKey por persona), 33 (wrapAction obrigatório em handlers), 35/ADR 0073 camada 5 (PII redaction antes do LLM, anti-prompt-injection), 36 (rate limit IA 20/min/user), 39 (audit hash chain).

**Negativas/riscos endereçados:** Sprint 06 cresceu (aceitável pela urgência declarada), confirmação UI adiciona fricção (mitigada por copy curta + Enter como default), persona mal classificada (chip switcher sempre visível), quota soft diary potencialmente confuso (UI explicativa), abuso Camada 3 (rate limit `proposeAction` 10/min separado do chat).

**Telas a prototipar:**

- `prototipo/telas/assistente-fab-mobile.html` (375×812)
- `prototipo/telas/assistente-confirm-action.html` — `<ActionConfirmDialog>`
- `prototipo/telas/assistente-persona-switcher.html`
- `prototipo/telas/assistente-quota-warning.html` — 80% e 100%

### Added — ADR 0074: Modo Coach mobile-first PWA + offline-first workout logging

Pergunta do usuário (2026-04-24): "tenho o caso do instrutor olhar o treino do aluno durante o treino pelo celular, como poderiamos fazer?". Identificado **gap arquitetural real**: ADR 0063 decidiu `/app/*` responsivo mas não-PWA (gestor desktop em mente); ADR 0069 criou Modo Atendimento desktop-first (fisio em consultório). Personal trainer mobile-only no chão da academia ficou sem solução — wifi instável, mãos suadas/sujas, multi-aluno simultâneo, timer crítico entre sets.

**Decisão — escopo PWA dedicado `/app/coach/*`:**

1. **PWA separado** com `manifest scope: /app/coach/`, ícone roxo Treina (`#C77DFF`), Service Worker próprio. Não conflita com `/meu/*` (paciente PWA Sprint 26) nem com `/app/*` (responsivo sem SW). Coach instala via `beforeinstallprompt` após 2ª visita.

2. **Reusa `attendance_sessions`** (ADR 0069) com enum estendido: `kind ∈ ('consulta','treino','avaliacao_fisica','sessao_pilates')`. `draft_content jsonb` armazena sets executados em estrutura tipada `{ exercises: [{ prescribed, executed: [{ set, weight_kg, reps, rpe, ts, client_id }], media }] }`. Ao finalizar, migra pra tabelas oficiais `workout_sessions` + `workout_logs` (Sprint 11).

3. **Tela `/app/coach/sessao/[id]`** mobile-only by design (375-414px):
   - Header compacto 56px com nome + timer + progresso (4/6 exercícios)
   - **Foco em 1 exercício/1 set ativo** (não os 12 de uma vez)
   - Steppers ▼▲ gigantes (44px+ touch) para kg/reps — não keyboard
   - RPE picker 1-10 com cores (verde/amarelo/vermelho)
   - Botão "Confirmar set" full-width 64px (ação mais frequente)
   - Timer regressivo entre sets (vibrate ao zerar)
   - Bottom nav fixo `[📷] [🎤] [💬] [→ Próximo]`

4. **Modo "supervisão multi-aluno"** `/app/coach/multi`: cards 1/3 por aluno em sessão simultânea (até 4 num estúdio); tap entra na sessão daquele aluno; state persiste em IndexedDB; coach troca sem perder progresso.

5. **Service Worker offline-first com sync queue:**
   - Pré-cacheia plano + member info + assets antes da sessão
   - Marca set offline → enqueue em IndexedDB com `client_id = uuid()`
   - Toast "X sets offline" no canto; UI otimista
   - Voltou online → sync background em ordem; idempotência via `client_id` (server upsert); conflito raro vai pra `needs_review`
   - Permite **finalizar sessão offline**; sincroniza tudo na próxima conexão

6. **Voz, foto, vídeo inline** reutilizando schema `clinical_media` (Sprint 21) com `kind='workout_form_check'`. STT background (Groq Whisper · ADR 0064) transcreve notas de voz. Vídeo curto comprimido client-side (Web Codecs/ffmpeg.wasm).

7. **Push web** via Service Worker para "next_student_arrived" (detector via QR/catraca/check-in), "set_overdue" (>2× tempo esperado), "session_complete". Subscription registrada em `coach_push_subscriptions`. Notificação tem ações `[Iniciar agora]` + `[Em 5 min]`.

8. **Web Bluetooth** (Android Chrome only): parear bioimpedância BLE (Tanita BC-401, Renpho), cardiofrequencímetro (Polar H10, Garmin HRM-Pro), encoder de velocidade VBT (Vitruve, GymAware). iOS Safari não suporta — fallback manual entry; cobertura completa só com app nativo Expo Sprint 31.

9. **Onboarding contextual:** mobile detecta UA + viewport → tour; desktop mostra QR "abra no celular"; após 2ª visita → install prompt; após instalar → push permission prompt.

**Schemas novos (Sprint 11):**

```sql
ALTER TYPE attendance_kind ADD VALUE 'treino';
ALTER TYPE attendance_kind ADD VALUE 'avaliacao_fisica';
ALTER TYPE attendance_kind ADD VALUE 'sessao_pilates';

workout_sessions (id, tenant_id, member_id, workout_id, coach_user_id,
                  attendance_session_id, started_at, ended_at, duration_min,
                  total_volume_kg, avg_rpe, notes, status)

workout_logs (id, tenant_id, session_id, exercise_id, set_index,
              weight_kg, reps, rpe, rest_actual_s, is_pr, client_id, logged_at)
              -- client_id unique pra idempotência offline

coach_push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth,
                          device_name, installed_at)
```

**Sprints ajustados:**

- **Sprint 00** — `<CoachLayout>` + manifest base + SW template (derivado de `<PortalLayout>`)
- **Sprint 11 (treinos)** — sprint principal: `/app/coach/sessao/[id]` + execução de set + sync queue + tabelas
- **Sprint 12 (avaliações físicas)** — adapta tela coach pra perimetria/1RM/saltos no celular
- **Sprint 13 (engajamento)** — push channels coach
- **Sprint 21 (mídias clínicas)** — extensão de `clinical_media` pra `workout_form_check`; ffmpeg.wasm client-side
- **Sprint 26 (portal paciente PWA)** — refatora pra `<SharedPWAShell>` reusável
- **Sprint 31 (futuro · app nativo Expo)** — cobre BLE iOS, HealthKit, push iOS reliable

**Telas a prototipar:**

- `prototipo/telas/coach-treino-mobile.html` (viewport 375×812)
- `prototipo/telas/coach-multi-mobile.html` (supervisão multi-aluno)
- `prototipo/telas/coach-install-prompt.html` (onboarding + instalação)

**Negativas/riscos endereçados:** 2 PWAs no mesmo subdomínio (scope explicit), Service Worker complexity (entrega incremental), background sync iOS Safari instável (toast + manual sync), coach esquece finalizar (job nightly auto-close 12h), bundle size (<200KB JS gzipped via code-split).

**Diferencial vs concorrência:** Trainerize (US$ 8) + TrueCoach (US$ 12) + Tecnofit Personal (R$ 79) — todos têm app nativo, mas nenhum tem **coach mode robusto offline-first** com sync queue, multi-aluno simultâneo, e mídia inline integrada.

Inspiração UX: Hevy (execução de set), MyFitnessPal (steppers grandes), Strong (timer entre sets).

### Added — ADR 0073: Postura de segurança (defesa em profundidade) + Regras 35-40

Pergunta do usuário: "agora vamos ver a segurança do código e do sistema". Análise identificou 7 gaps críticos (security headers ausentes, rate limit só em IA, sem brute force protection, sem backup/DR documentado, CSRF não documentado, sem virus scan em uploads, sem SSRF protection nos fetchers externos), 8 altos e 8 médios. Aplicada **Opção B** (ADR consolidado + 6 regras novas + ajustes pontuais nos sprints).

**ADR 0073 — Defesa em profundidade em 7 camadas:**

1. **Rede e perímetro** — Vercel WAF/DDoS (Pro tier requirement); TLS 1.3 obrigatório; HSTS preload; security headers via `next.config.ts headers()` (CSP com nonce dinâmico, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin, Permissions-Policy restritiva, COOP/CORP); CORS restritivo same-origin; cookies escopo `.logifit.com.br` SameSite=Lax + Secure + HttpOnly
2. **Autenticação e sessão** — MFA por role (`roles.requires_mfa`); login lockout (5 falhas/15min → 30min lockout + Turnstile); Cloudflare Turnstile no signup/login/forgot/trial; recovery codes TOTP; página `/meu/sessoes` lista + revoga; trocar senha invalida refresh tokens
3. **Aplicação** — `wrapAction()` reforçado (Origin check + rate limit + auth + permissions + Zod + sanitize); rate limit por endpoint/IP/user (login 10/15min IP · read 100/min · write 30/min · IA 20/min); CSRF via Origin === Host (Next.js 15 nativo) + opcional `x-csrf-token`; **`safeFetch()` SSRF protection** (allowlist + bloqueio IP privado/loopback/link-local + timeout + maxBytes + redirect manual); **virus scan obrigatório em uploads** (MIME real, magic bytes, embed proibido, ClamAV); output encoding via React + DOMPurify+nonce em casos especiais
4. **Dados em repouso e em trânsito** — TLS 1.3 fim-a-fim; AES-256-GCM em campos sensíveis com KEK por tenant via HKDF; cert A1 com KEK por company + senha cifrada separadamente; rotação anual via `encryption_key_version`; **hash chain no `audit_log`** (cada linha referencia hash anterior + anchor S3 Object Lock WORM 1h); **backup off-site AWS S3** semanal cifrado + Object Lock 90d (RPO 24h, RTO 4h); teste restauração trimestral
5. **IA** — `redactBeforeLLM()` mascara CPF/CNPJ/RG/email/telefone/endereço/cartão/PIX antes do provider; `aggressive_redaction` Enterprise mascara nome próprio; classificador anti-prompt-injection; output que vaza system prompt = bloqueado; detecção de abuso (10x consumo médio → soft-block); tool calling sempre Server Action tipada
6. **Operacional** — Vercel encrypted env (LogiFit-level); Supabase Vault (tenant-level: BYOK IA, cert A1); rotação anual de secrets; **Gitleaks** pre-commit + CI; **Dependabot** semanal; **OSV-scanner** CI bloqueia ≥high; **SBOM** CycloneDX por release; CI permissions read-all default + actions pinadas por SHA; logs sanitizados via `sanitizeForAlert()` em Sentry/Logtail
7. **PAM (Privileged Access Management) super_admin LogiFit** — `privileged_sessions` 4h com MFA recente + justificativa ≥20 chars; `privileged_audit_log` com snapshot before/after + hash chain; JWT secundário `privileged=true` exigido em `/app/super-admin/*`; alerta automático ao abrir (email + Telegram fundador); revogação automática se query >50k linhas

**Threat model STRIDE** aplicado obrigatoriamente em 5 features críticas (login, pagamento Asaas, prontuário, pipeline exames, WhatsApp inbound) durante seu sprint, registrado em `docs/threat-models/`.

**OWASP Top 10 (2021)** mapeado item-a-item para mitigações LogiFit; `scripts/owasp-check.ts` em CI antes de release.

**Documentos públicos:**
- `/.well-known/security.txt` (RFC 9116) com `security@logifit.com.br` + Encryption + Policy + Canonical
- Página pública `/seguranca` com postura resumida + política divulgação responsável (90d coordinated) + hall da fama
- Disaster Recovery Plan público para tenants Enterprise

**Pentest:** auditoria interna trimestral (fundador + jurídico) + pentest externo anual (Tempest/Conviso, R$ 8-15k MVP). Bug bounty informal Fase 2 (R$ 200-2k regular, R$ 5-10k critical).

**Compliance roadmap:** LGPD/CFM 2.454/COFFITO/CFN cobertos no MVP. ISO 27001 e SOC 2 Type 1→2 mapeados como objetivo Fase 2-3 (não bloqueia MVP).

**Regras 35-40 (novas) em `docs/rules.md` (total 40 regras):**
- **35** Security headers (`next.config.ts headers()` com CSP nonce + HSTS preload + X-Frame DENY + X-Content nosniff + Referrer-Policy + Permissions-Policy + COOP/CORP)
- **36** Rate limit Upstash em toda Server Action/API Route via wrapper (chave por tenant+user+ip+endpoint)
- **37** `safeFetch()` único para fetch externo + lint `no-raw-fetch`
- **38** `scanUpload()` único para upload em Storage + lint `no-unscanned-upload`
- **39** Hash chain no `audit_log` + anchor S3 WORM
- **40** Backup off-site + RPO 24h/RTO 4h + teste restauração trimestral

**Regras operacionais 20-25 em `CLAUDE.md` (total 25 regras operacionais para Claude).**

**Sprints ajustados (12):**

| Sprint | Ajuste |
|---|---|
| **00 setup-infra** | Security headers + middleware CSP nonce + Upstash rate limit + `packages/security/safe-fetch.ts` + `packages/security/scan-upload.ts` + Gitleaks pre-commit + Dependabot config + OSV-scanner CI + script `pnpm sbom:generate` + `/.well-known/security.txt` + página `/seguranca` + DNS `security@logifit.com.br` + conta Cloudflare Turnstile |
| **01a identidade** | `audit_log.previous_hash` + trigger SHA256 chain + `system_audit_anchor` + job verify-integrity + `auth_attempts` + `auth_lockouts` + Turnstile signup/login/forgot + página `/meu/sessoes` + recovery codes TOTP |
| **01b RBAC** | `roles.requires_mfa` explícito + `privileged_sessions` + `privileged_audit_log` + JIT access super_admin + alerta automático abertura + revogação por data exfiltration |
| **04 financeiro** | safeFetch Asaas (`asaas.com`, `sandbox.asaas.com`) + validação IP source no webhook |
| **06 copilot** | `redactBeforeLLM()` em `buildSystemPrompt` + safeFetch nos providers IA (Gemini/Anthropic/OpenAI/Groq/Maritaca) + classificador anti-prompt-injection + detecção abuse |
| **13 WhatsApp** | safeFetch nos providers (Twilio/Z-API/Resend) + safeFetch no media download + scanUpload nos anexos do paciente + validação HMAC + IP source |
| **17 bancos+NF-e** | safeFetch Open Finance (Pluggy/Belvo) + safeFetch NFe providers (Arquivei/Sieg/Focus/SEFAZ direto) + scanUpload cert A1 + KEK por company + senha cifrada separadamente |
| **20 prontuário** | STRIDE prontuário + cert A1 com KEK |
| **21 evolução** | scanUpload em `evolucao_attachments` (raio-X PDF, vídeo execução) |
| **32 device hub** | scanUpload em `importFile` (FIT/CSV) + safeFetch nos providers Garmin/Oura |
| **33 pipeline exames** | STRIDE exames + scanUpload obrigatório em `lab-documents` (paciente sobe PDF malicioso disfarçado) + safeFetch OCR provider |
| **36 fiscal Focus** | safeFetch Focus NFe (`focusnfe.com.br`, `homologacao.focusnfe.com.br`) + validação IP source + KEK por tenant em `fiscal_provider_credentials` |

**Documentação:**
- `docs/decisions/0073-postura-seguranca-defesa-em-profundidade.md` — ADR completo
- `docs/rules.md` — regras 35-40 + header menciona "segurança em profundidade"
- `docs/modulos.md` — 15 novos módulos na fundação (Security headers, Rate limit, safeFetch+SSRF, Virus scan, Login lockout, Hash chain, PAM, Backup+DR, Criptografia at-rest, PII redaction, Anti-injection, Secret scanning, security.txt, Threat model, OWASP checklist, Pentest)
- `CLAUDE.md` — regras operacionais 20-25 + contador 40 regras

**Custos operacionais adicionais MVP: R$ 0 fixo.** Decisão do fundador: zero custo extra de segurança no MVP — todos os componentes pagos foram substituídos por alternativas free OU postergados para Fase 2 (com receita).

**Free no MVP:**
- **Vercel Hobby** + **Cloudflare proxy free** (DDoS L3/L4 + 5 regras WAF + bot fight mode + 10k requests rate limit) — substitui Vercel Pro WAF
- **Cloudflare Turnstile** (free)
- **Upstash Redis** free tier (10k commands/dia) — suficiente MVP solo
- **Scan próprio de upload** (`packages/security/scan-upload.ts` ~150 linhas TS): MIME real (file-type) + magic bytes + extension allowlist + size cap + embed detection (PDF JS, Office macro, polyglot) + hash SHA256 com seed `known_malicious_hashes` opcional. Provider abstrato permite plugar ClamAV em Fase 2 sem refactor.
- **Backup off-site free**: `pg_dump` weekly cifrado GPG → **Cloudflare R2 free 10GB** OU **Backblaze B2 free 10GB** OU **GitHub Releases privado** — Vercel Cron weekly. Substitui AWS S3 (postergado).
- **OWASP ZAP automated scan weekly** em GitHub Action — substitui pentest pago no MVP. Hall da Fama (sem recompensa monetária) substitui bug bounty pago.
- **Better Stack** free tier (1 monitor, 5min interval) ou GitHub Pages com Action — substitui Better Stack pago
- **DPO interino fundador** (ADR 0067 já permite) — substitui DPO externo retainer

**Postergado para Fase 2 (gatilho: receita / 1º cliente Enterprise / volume > 5GB / clínica médico-hospitalar pagante):**
- Vercel Pro $20-150/mês
- ClamAV self-hosted Fly.io R$ 30/mês ou cloudmersive R$ 200/mês
- AWS S3 backup off-site com Object Lock WORM R$ 100-300/mês
- Better Stack status page completo R$ 30-50/mês
- Pentest externo anual R$ 8-15k
- DPO externo retainer R$ 2-5k/mês

**Total Fase 2 (referência futura):** ~R$ 1.000-2.500/mês fixo + R$ 8-15k anual pentest. **Receita paga isso** — não bloqueia MVP. Adapter pattern em `packages/security/*.ts` permite trocar provider sem refactor de código consumidor.

**Trade-offs aceitos no MVP:**
- Scan próprio cobre ~90% dos casos comuns; malware 0-day sofisticado pode passar (aceitável solo, baixo volume)
- R2/Backblaze 10GB limita volume — migração para S3 quando passar de 5GB (1k-3k tenants)
- OWASP ZAP automated cobre menos que pentest humano experiente — upgrade Fase 2
- Vercel Hobby tem limites (100GB bandwidth, sem preview env por PR) — upgrade quando volume real exigir

---

### Added — ADR 0072: Escalabilidade do banco (particionamento + retenção + cold storage) + Regra 34

Pergunta do usuário: "Não corro o risco de ficar muito grande a base de dados?". Análise de volume sem mitigação: 100 tenants × 1 ano = 5B+ rows; com estratégia em camadas: ~50M hot + 200M cold (~80% redução de custo de storage). Aplicadas todas as 5 recomendações (1A · 2A · 3A · 4A · 5A).

**ADR 0072 — 5 camadas de defesa em profundidade:**
1. **Particionamento nativo PostgreSQL** — `PARTITION BY RANGE` temporal (mês/trimestre/ano) ou `PARTITION BY HASH (tenant_id)`. Drop = metadata-only (ms vs hours em DELETE row-by-row). Indexes vivem na partição.
2. **Retenção por compliance** — 5a audit (LGPD) · 20a prontuário (CFM 2.299/2021 + COFFITO 415/2012) · 5a fiscal · 1a IA audit + 5a cold (CFM 2.454/2026)
3. **Aggregation rollups** — raw drop após retenção, mas summary diário/mensal indefinido (`food_log_daily_summary`, `device_readings_daily_summary`, `member_events_summary_quarterly`, `workout_sessions_summary_quarterly`)
4. **Materialized views** — `tenant_metrics_daily` com `REFRESH CONCURRENTLY` (hourly nas quentes, daily nas frias) reduz queries do dashboard de O(rows) para O(dias)
5. **Cold storage Parquet zstd** — dados >2-5 anos exportados para Supabase Storage criptografado AES-256 com KMS; cold partitions preservam metadata leve na quente (member_id, signed_at, hash) para busca

**Sharding multi-cluster preparado** — `tenants.shard_url text NULL` (NULL = compartilhado; preenchido = dedicated cluster); ativação futura quando 1 tenant >100k members ou banco >500GB. View `v_sharding_candidates` lista candidatos.

**Regra 34 (nova)** em `docs/rules.md` (total **34 regras**):
- Toda tabela com volume estimado >5M linhas/ano OU >50k linhas/dia **deve** nascer particionada
- Migration declara `@volume_estimate_yearly: <N>` em comentário SQL; CI lint bloqueia se excede sem partição
- Toda tabela com retenção definida tem job de partition lifecycle cadastrado: `create-next-partitions` (cria futuras), `drop-old-partitions` (descarta após retenção), `archive-cold-partitions` (move para Storage)

**Regra operacional 19** em `CLAUDE.md` (total 19 regras operacionais para Claude).

**Tabelas afetadas (12 sprints ajustados):**
| Sprint | Tabela | Estratégia | @volume_estimate_yearly | Retenção |
|---|---|---|---|---|
| 01a | `audit_log` | Mensal | 50M+ | 5a (LGPD) |
| 01a | `tenants.shard_url` (coluna) | — | — | preparação sharding |
| 02 | `member_events` | Trimestral | 10M+ | 3a + summary perpétuo |
| 06 | `ai_audit_log` | Mensal | 30M+ | 1a hot + 5a cold (CFM 2.454) |
| 06 | `ai_semantic_cache` | TTL 30d | — | LRU eviction |
| 06 | `member_insights` (cache) | TTL 6-24h | — | por insight_key |
| 11 | `workout_sessions` | Trimestral | 8M+ | 5a + summary |
| 11 | `workout_session_items` | Trimestral | 80M+ | 2a + summary |
| 17 | `bank_transactions` | Trimestral | 6M+ | 5a fiscal + cold 2a+ |
| 17 | `nfe_received` | Anual | 12M+ | 5a hot + 5a cold |
| 20 | `consultas` | Trimestral | 5M+ | **20a** (CFM 2.299) — 5a hot + 15a cold AES-256 |
| 21 | `evolucoes_sessao` | Trimestral | 12M+ | **20a** (COFFITO 415) — 5a hot + 15a cold |
| 30 | `lab_results` | Anual | 6M+ | 20a (CFM 2.299) — 5a hot + 15a cold |
| 31 | `meal_log_entries` | Mensal | 30M+ | 6m raw + summary perpétuo |
| 32 | **`device_readings`** ⚠ | **DIÁRIA** | **180M+** | 90d raw + summary perpétuo + curated indefinido — **CRÍTICO** |
| 33 | `exam_documents` | Anual | 2M+ | 20a (CFM 2.299) — 5a hot + 15a cold |

**Sprints com infra de banco ajustada:**
- **Sprint 01a** — `audit_log` + `system_alerts` (já preparado em ADR 0071) já nasceram particionados; adiciona `tenants.shard_url`; jobs Vercel Cron `create-next-partitions` (mensal), `monitor-database-size` (diário), `vacuum-analyze-partitions` (semanal); schemas `archive_jobs` + `compliance_retention_log`
- **Sprint 07** — UI `/app/super-admin/database` (super-admin LogiFit fora do RBAC do tenant) com tamanho total + por tenant + projeção 12 meses + inventário de partições + histórico de jobs + cold storage usage + sharding candidates; permission `super_admin.database.read`; materialized view `tenant_metrics_daily` + jobs `aggregate-daily-summaries` + `refresh-materialized-views` + `monitor-database-size`
- **Sprint 32** ⚠ **TABELA-MONSTRO**: `device_readings` particionada DIÁRIA desde dia 1; sem isso explode em meses; pipeline de migração para `device_readings_curated` antes do drop diário preserva rastreabilidade clínica de leituras validadas em `assessment_measurements`

**Documentação atualizada:**
- `docs/rules.md` — regra 34 completa com 5 sub-itens; header menciona "escalabilidade do banco"
- `docs/modulos.md` — 4 novos módulos (Particionamento + retenção, Cold storage Parquet zstd, Monitoring de banco, Sharding multi-cluster preparado)
- `CLAUDE.md` — regra operacional 19 + contador 34 regras
- `docs/decisions/0072-*.md` — ADR completo com SQL examples (audit_log mensal, device_readings diário, food_log_daily_summary, materialized view), retention table, monitoring UI mockup, schemas (`archive_jobs`, `compliance_retention_log`)

---

### Added — ADR 0071: Sistema de tratamento de erros + Alertas em tempo real + Regra 33

Inspirado em modelo maduro do projeto Deep Control + corrige 3 pontos cegos reconhecidos (push ativo, role-based visibility, APM externo). Aplica todas as recomendações (1A-7A).

**ADR 0071 — Sistema de erros + alertas:**
- **Envelope unificado** `{code, message, details, request_id, runbook, retry_after_ms}` com **16 códigos fechados** (VALIDATION_ERROR, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, CONFLICT, RATE_LIMITED, INTERNAL_ERROR, SERVICE_UNAVAILABLE, AI_QUOTA_EXCEEDED, AI_PROVIDER_ERROR, PAYMENT_FAILED, FISCAL_REJECTED, CONSENT_REQUIRED, COMMITTEE_REQUIRED, SLUG_TAKEN, TENANT_SUSPENDED)
- **Fingerprint** SHA256(type|module|path|status|tenant_id)[:16] com TTL 24h — dedup multi-tenant
- Schema **`system_alerts`** + **`system_alert_occurrences`** (ring buffer timeline) com RLS + role-based visibility (`min_role`) — correção do ponto cego "só tier" do modelo Deep Control
- **4 canais de notificação no MVP**: badge SideMenu com Realtime subscribe + toast `sonner` na sessão ativa + email critical via Resend + WhatsApp urgent via provider (rate limit 3/hora) — corrige ponto cego "admin precisa entrar no dashboard"
- **Canais complementares**: push PWA (Sprint 26) + Sentry (LogiFit dev team — stack traces)
- **10 translators por domínio**: Asaas, Focus NFe (90+ códigos SEFAZ), Supabase RLS, Anthropic, Gemini, Groq, OpenAI, Twilio WhatsApp, TISS (~40 códigos glosa), Pluggy, Zod + fallback
- **Auto-resolução inteligente**: TTL, HTTP 503 recovery por webhook.success do mesmo provider, AI_QUOTA_EXCEEDED reseta no mês, FISCAL_REJECTED transient resolve na próxima emissão OK
- **Sanitização LGPD**: `sanitizeForAlert()` mascara CPF/CNPJ (últimos 4), email (só domínio), telefone (DDD+4), redact senha/token/dado clínico
- **Retenção por severity**: info 30d · warning 90d · error 365d · critical 1825d · security_event 1825d+obrigação legal
- **Trigger SQL** auto-cria `security_incidents` (ADR 0067) quando severity='critical' + category IN (security/data_leak/compliance) → dispara plano resposta 72h
- **Sentry complementar** (não substitui system_alerts): admin do tenant vê erros do próprio tenant no `/app/admin/alertas`; LogiFit dev team vê stack traces em Sentry

**Regra 33 (nova)** em `docs/rules.md` (total 33 regras):
- Server Action / API Route / Job **sempre** usa `wrapAction()` / `wrapApiHandler()` / `wrapJob()` de `packages/errors/`
- Wrapper: request_id + auth + permissions + rate limit + gates IA classe II+ (regra 28) + consent cross-module (regra 6) + translator + alert async + audit + Sentry + retorno `{ ok, data | error }`
- **Lint custom `no-unwrapped-action`** bloqueia commit se Server Action sem wrapper (exceção `// wrap-exempt: <motivo>`)

**Regra operacional 18** em `CLAUDE.md`.

**Sprints ajustados:**
- **Sprint 00** — `packages/errors/` completo (api-error + 3 wrappers + 10 translators stubs + sanitize + fingerprint) + middleware `x-request-id` + Sentry/PostHog/Logtail clients + lint `no-unwrapped-action` + i18n catalog de mensagens + teste E2E panic→envelope→alert→Sentry→toast
- **Sprint 00b (SideMenu)** — `useAlertCount()` hook com Supabase Realtime subscribe + toast global
- **Sprint 01a** — schema `system_alerts` + `system_alert_occurrences` (particionado por mês) + RLS + trigger `security_incidents` + `notification_queue`
- **Sprint 07** — UI `/app/admin/alertas` com KPIs/filtros/timeline/similar-alerts + realtime subscribe + jobs auto-resolve e retention expurge
- **Sprint 13** — worker da `notification_queue` com email Resend (critical) + WhatsApp provider (urgent) + rate limit + templates aprovados; canal privacidade@ recebe todos `security`
- **Translators por sprint de integração**: 04 (Asaas) · 06 (Gemini/OpenAI/Anthropic/Groq) · 15 (OCR) · 17 (Arquivei/Pluggy) · 20 (ICP-Brasil) · 22 (TISS) · 36 (Focus NFe 90+)

**Decisões do usuário (2026-04-24):** todas recomendações aprovadas (1A-7A).

**Impacto**: corrige 3 pontos cegos do modelo Deep Control; LGPD-safe; compliance auto-ligada a ADR 0067; diferencial operacional forte (admin vê erros em tempo real via múltiplos canais).

### Added — ADRs 0069 + 0070: Perfil como hub + Modo Solo + Insights cross-module + Timeline integrada

Duas decisões interdependentes que transformam `/app/members/[id]` no hub central do profissional:

**ADR 0069 — Perfil do paciente como hub operacional + Modo Solo:**

- Reestrutura `/app/members/[id]` em 4 camadas fixas: header (identidade) · action bar (role-aware) · tabs por visão · corpo contextual
- **Tabs por visão auto-detectadas por role**: Geral/Clínico/Treino/Alimentar/Financeiro/Comunicação/IA; filtradas por permission + vertical + consent
- **Modo atendimento**: timer visível + header diferenciado + SOAP editor inline; ao finalizar pergunta "salvar evolução? cobrar? próxima consulta?"
- **Sidebar direita**: histórico recente + favoritos (desktop); `user_member_favorites` + `user_recent_members` schemas
- **Registry `registerMemberAction`**: cada sprint registra suas ações (~60 ações totais); handler navega OU executa inline (modal/sheet)
- **Ações inline sempre** que possível — profissional permanece na página do paciente 80%+ do tempo
- **Modo Solo (`tenants.mode='solo'`)** detectado por onboarding wizard (perfil autônomo + 1 user) — UX simplificada sem tabs; action bar expandida; dashboard enxuto focado em agenda do dia + cobranças + mensal
- **Plano Solo R$ 49/mês** (R$ 39 anual) · 1 user · 80 clientes · overage R$ 0,80/member · cap +R$ 40 = sugere Starter; **Solo Combo R$ 69** com todas as verticais
- **Onboarding wizard**: pergunta "como atua?" (autônomo/clínica/rede) + "qual profissão?" → sugere plano + carrega templates
- **Templates pré-carregados por profissão** (CREF/CREFITO/CRN/CRP/Pilates/Esteticista): `services` típicos + escalas + CIDs + protocolos comuns
- **Fiscal Solo simplificado**: MEI (recibo ou NFS-e conforme município) · ME Simples Nacional · PF autônomo com RPA

**ADR 0070 — Insights cross-module computados + Timeline integrada:**

- Camada de **funções puras determinísticas** em `packages/db/insights/` — sem IA: `calculateTMB()`, `calculateTDEE()`, `calculateKcalPerSession()`, `calculateWeeklyVolume()`, `calculateCaloricBalance()`, `detectContraindications()`, `detectOvertrainingSignals()`, `estimateBodyTrajectory()`
- **9 insights no MVP**: TMB · gasto calórico sessão · volume semanal · frequência · TDEE · balanço calórico · adesão plano alimentar · contraindicações ativas · saldo créditos
- **5 insights Fase 2** (Sprint 34 Nutri-Agent consome): projeção peso · overtraining · risco lesão · trajetória composição corporal · interações medicamentosas
- **Exemplo canônico**: nutri vê treino do cliente → sistema calcula gasto calórico semanal (MET × peso × duração) + TDEE + sugere meta calórica do plano alimentar automaticamente
- **Widget cross-module** via `registerMemberWidget` ampliado com `crossModuleRequires` (source vertical + permission + consent) + `insights[]` (array de insight keys)
- **Timeline integrada**: materialized view `member_timeline` agrega consultas + sessões + food_log + avaliações + invoices em ordem cronológica; refresh 5min + invalidation por evento
- **Alertas cross-module automáticos** no MVP (reusa cross-alert dispatcher Sprint 07): contraindicação em novo treino, overtraining, balanço calórico crítico, adesão baixa, mudança de peso brusca
- **`exercises.met_value`** obrigatório (Sprint 11) + seed **Compendium of Physical Activities 2024** com ~800 exercícios curados
- **`cid_exercise_contraindications`** seed global LogiFit (~200 contraindicações mais comuns: lombalgia, hérnia discal, lesão meniscal, tendinite, LCA, etc.) + tenant pode override
- **Cache `member_insights`** com TTL variável (6h volume, 24h TDEE) + invalidação por evento; handlers em `packages/db/insights/invalidation.ts`
- **Consent granular por contexto cross-module**: `nutri_sees_training`, `personal_sees_prontuario`, `nutri_sees_prontuario`, `personal_sees_nutri_plan`, `fisio_sees_training` — paciente controla em `/meu/privacidade`

**Decisões do usuário (2026-04-24):**

Hub operacional:
1. Top tabs (não sidebar vertical)
2. Modo atendimento no MVP
3. Sidebar direita MVP
4. Ações inline sempre
5. Tabs auto por role sem customização

Modo Solo:
1. Plano Solo R$ 49/mês
2. Solo 1 vertical · Solo Combo R$ 69 todas
3. Modo auto-detectado no wizard
4. Templates por profissão no MVP
5. Perfil sem tabs no modo Solo

Insights cross-module:
1. MVP (não Fase 2)
2. Timeline integrada MVP
3. Alertas automáticos MVP
4. Compendium 2024 no Sprint 11
5. Contraindicações LogiFit-curadas
6. Cache `member_insights` com invalidação por evento

**Sprints ajustados**: 01a (wizard) · 02 (hub + timeline + cache + modo Solo) · 03 (agenda pessoal Solo) · 04 (plano Solo + pricing revisado) · 05 (templates por profissão) · 07 (dashboard adapta + cross-alert handlers) · 11 (met_value + Compendium 2024) · 12 (calculadoras em packages/db/insights/) · 15 (recibo MEI/RPA) · 20 (sheet SOAP inline) · 26 (portal Solo) · 27 (cid_exercise_contraindications) · 29 (usar TDEE + card treino) · 31 (food_log alimenta balance) · 34 (Nutri-Agent consome insights) · 36 (NFS-e opcional Solo)

**Schema**:
- `tenants.mode` enum (`solo`/`clinic`/`chain`/`hospital`)
- `attendance_sessions` (modo atendimento com timer + SOAP rascunho)
- `user_member_favorites` + `user_recent_members` (sidebar)
- `exercises.met_value` numeric(3,1)
- `cid_exercise_contraindications` (seed global + tenant override)
- `member_insights` (cache com TTL + invalidação)
- `member_timeline` materialized view
- 5 novos `consent_purposes` cross-module

**Pricing revisado (ADR 0066 + 0069):**
- **Solo** R$ 49/mês (R$ 39 anual) — autônomo, 1 user, 80 clientes · NOVO
- **Solo Combo** R$ 69 — autônomo com múltiplas verticais · NOVO
- Starter R$ 79/mês mantido
- Pro R$ 199/mês mantido
- Business R$ 449/mês mantido
- Enterprise sob consulta

**Cobertura**: captura mercado de ~700k profissionais autônomos saúde/fitness no Brasil antes desatendidos + entrega valor clínico cross-module real (nutri calcula TDEE automaticamente do treino; fisio alerta contraindicação antes de sessão; personal adapta com consent).

### Added — ADR 0068: Catálogo de serviços + Preços contextuais + Construtor de planos + Link financeiro

Resolve 3 fragmentações identificadas no modelo comercial durante análise do widget "Plano Premium · bundle":

1. **Preço fragmentado** — mesmo serviço morava em `plans`, `bundles`, `insurance_procedure_prices` separados
2. **Sem UI visual para admin montar planos** — só form simples no Sprint 04
3. **Link cliente↔financeiro disperso** — contract + invoice + AR + credit_ledger + cashback sem view unificada

Decisões do usuário (2026-04-24):
1. Construtor = **B** (form + modal "Adicionar serviço"; sem drag-drop no MVP)
2. Preços contextuais = **A** (tabela única `service_prices` com context discriminator)
3. Preview member = **A** (tela dedicada reduz erro de config)
4. Plano custom por member = **A** (via `service_prices` com `context='member_custom'`)
5. Plus: **link financeiro completo** detalhado no ADR (contratação → consumo → renovação → pagamento → inadimplência)

**Schema:**
- `services` (catálogo do tenant com slug, vertical, kind, default_price, CBO/TUSS, chart_account, stock_item, tax_nature)
- `plan_items` (composição do plano: qtd incluída, período, preço extra, hard limit)
- `service_prices` (7 contextos: default/plan/contract/member_custom/insurance/promotion/company com priority)
- `contracts` ganha discount_type/value/valid_until + referral_code_applied
- `invoices` ganha breakdown jsonb (base + overage + discounts + surcharges + taxes)
- `accounts_receivable` ganha member_id + service_id + appointment_id + parent_contract_id

**5 telas admin** (`/app/settings/servicos`, `/app/settings/planos`, `/app/settings/planos/[id]/preview`, `/app/settings/precos`, `/app/settings/promocoes`)

**Resolução de preço** — função pura `resolveServicePrice()` com prioridade decrescente (insurance > member_custom > promotion > contract > plan > company > default)

**Link financeiro completo** — ciclo documentado: contratação → consumo (crédito ou AR extra via Asaas) → renovação mensal (reset credits + desconto aplicado) → pagamento (webhook) → inadimplência (régua Sprint 13 integrada)

**Widget financeiro member unificado** — operador (`/app/members/[id]`) vê plano + consumo + extras em aberto + histórico + saldo cashback + ações administrativas; portal (`/meu/financeiro`) espelha com ações de autoatendimento (pagar, baixar recibo, usar cashback, portabilidade LGPD)

**Sprints ajustados:** 04 (plan_items + invoices.breakdown + widget), 05 (services + construtor + 5 telas + service_prices), 15 (AR ganha member_id/service_id/appointment_id), 22 (migração `insurance_procedure_prices` → `service_prices`), 02 (widget financeiro), 26 (portal `/meu/financeiro`), 13 (régua consome AR overdue)

**Descontos — 4 mecanismos integrados:** cupom/promoção (context='promotion'), desconto contratual (contracts.discount_*), preço VIP member (context='member_custom'), cashback acumulado (ledger opt-in aplicado na próxima invoice). Visualização consolidada no `invoices.breakdown`.

### Changed — ADR 0066 pricing revisado (Starter R$ 79 · Pro R$ 199 · Business R$ 449 · overage R$ 0,50/member)

Após benchmark de mercado (Tecnofit Lite R$ 99, Pro R$ 199; iClinic Pro R$ 119; NutMed R$ 99-249; Amplimed R$ 139-369), pricing inicial foi considerado **acima da média para tenant pequeno**. Revisão:

- **Starter:** R$ 149 → **R$ 79/mês** (anual R$ 69) · 100 members · 1 un · só Academia
- **Pro:** R$ 399 → **R$ 199/mês** (anual R$ 179) · 500 members · 3 un · todas verticais + Focus NFe + Device Hub + Pipeline Exames
- **Business (NOVO):** **R$ 449/mês** (anual R$ 399) · 2.000 members · 10 un · multi-company + intercompany + adquirência integrada — fecha gap entre Pro e Enterprise
- **Enterprise:** sob consulta (a partir de R$ 1.199/mês) · ilimitado + BYOK IA + SLA 99,9% + white-label + DPO-as-a-service
- **Free plan rejeitado** na decisão (opção B escolhida) — trial 14 dias substitui; reavaliar após 12 meses se conversão ficar baixa

**Overage suave por member:**
- R$ 0,50/member acima do incluído (Starter/Pro); R$ 0,40 (Business)
- Cap por tier força upgrade sugerido (ex: Starter +R$ 120 overage = 240 members → sugere Pro)
- Tenant que cresce de 95 para 130 members paga R$ 79 + R$ 15 overage (proporcional) sem upgrade hostil
- 3 ciclos acima do threshold = upgrade forçado no próximo ciclo (aviso 30d)

**Margem analisada:**
- Starter: 68% (R$ 54 líquido após ~R$ 25 de custo)
- Pro: 80% (R$ 159 líquido)
- Business: 82% (R$ 369 líquido)
- Enterprise: 83%+ (R$ 999+ líquido)

**Schema adicional:**
- `tenant_usage_snapshots` (period_ym, members_active, overage_amount_cents) para rastrear overage mensal
- `logifit_plans` ganha `members_included`, `members_overage_rate_cents`, `members_overage_cap_cents`
- `tenant_subscriptions` ganha `members_included_override` para Enterprise customizado

**Decisões do usuário (2026-04-24):**
1. Free plan = **B** (não adotar; trial 14d é suficiente)
2. Reduzir Starter para R$ 79 e Pro para R$ 199 = **A** (sim)
3. Business R$ 449 intermediário = **A** (sim)
4. Overage R$ 0,50/member suave = **A** (sim)

`docs/modulos.md` · `CLAUDE.md` · `CHANGELOG.md` atualizados.

### Added — 3 ADRs pré-Sprint 00: subdomínio + pricing + DPO (0065, 0066, 0067)

Trinca de decisões pré-implementação fechando os últimos bloqueadores antes do Sprint 00 iniciar:

- **ADR 0065 — Multi-tenant por subdomínio**: `{slug}.logifit.com.br`; middleware Next.js extrai slug do Host; wildcard DNS + SSL via Vercel; dev local com `*.localhost`; slug validation (3-30 chars, regex, reserved list); mudança de slug com redirect 301 por 90d; cookies escopo `.logifit.com.br`; rotas reservadas (`app`, `api`, `status`, `docs`); schema `tenants.slug` + `tenant_slug_history`
- **ADR 0066 — Plano comercial LogiFit**:
  - 3 planos: **Starter R$ 149/mês** (1 un, 150 members, 500 chamadas IA, 5GB), **Pro R$ 399/mês** (3 un, 500 members, 3k IA, 50GB, todas verticais, Focus NFe NFS-e, Device Hub, Pipeline Exames), **Enterprise sob consulta** (ilimitado + BYOK + SLA + white-label + DPO-as-a-service)
  - **Trial 14 dias** sem cartão com features Pro
  - Desconto anual ~14% (2 meses grátis)
  - **Régua inadimplência** D+3/D+7/D+14/D+21 read-only/D+45 suspenso/D+135 anonimização LGPD
  - Upgrade pró-rata imediato; downgrade fim do ciclo; cancelamento 2 etapas
  - LogiFit usa Asaas próprio para cobrar tenants + emite NFS-e automática via Focus NFe (Sprint 36)
  - Schema `logifit_plans` + `tenant_subscriptions`
- **ADR 0067 — DPO + Governança Compliance LGPD/CFM**:
  - **DPO interino (fundador)** até 50 tenants; **DPO-as-a-service** R$ 3-8k/mês na escala; DPO dedicado (200+ tenants)
  - Canal público `privacidade@logifit.com.br` + portal `logifit.com.br/privacidade` pós-MVP
  - **8 documentos públicos** (política privacidade, termos, DPA template, RIPD resumo, ROPA, cookies, sub-processors, política retenção)
  - **`security_incidents` schema** + plano resposta 72h ANPD (LGPD art. 48 §1º)
  - **Lista pública de sub-processors** (Supabase, Vercel, Google Cloud, Groq, Anthropic, OpenAI, Asaas, Resend, Sentry, PostHog, Logtail, Focus NFe, Upstash)
  - Custo operacional escala com porte: Fase 0 R$ 2k/mês → Fase 3 R$ 29k/mês
  - Auditoria interna trimestral (fundador) + externa anual (firma) na Fase 2
  - Pasta nova `docs/compliance/` com templates e playbooks

**`.env.example`** — `NEXT_PUBLIC_ROOT_DOMAIN`, `PRIVACY_EMAIL`, `COMMERCIAL_EMAIL`

**`docs/modulos.md`** — 3 módulos novos em Fundação (multi-tenant subdomínio, planos comerciais, DPO + governança)

**`CLAUDE.md`** — nova seção "Modelo comercial" consolidando pricing + IA embutida + DPO

Com esses 3 ADRs, Sprint 00 pode iniciar. Bloqueadores resolvidos: subdomínio, pricing, repo privacy (próxima decisão externa do usuário), DPO formalizado.

### Added — ADR 0064: Arquitetura de IA (Gemini Flash default + BYOK + RAG + tasks tipadas + regra 32)

Após 3 iterações sobre relação LogiFit ↔ IA ↔ tenant (revenda rejeitada · BYOK-only rejeitado) e análise da arquitetura de IA do projeto Deep Control, fechada arquitetura definitiva:

- **ADR 0064** — `docs/decisions/0064-ia-arquitetura-gemini-default-byok-rag.md`. Define:
  - **Default LogiFit:** Gemini 2.5 Flash via Vertex AI São Paulo (resolve LGPD data residency) — custo absorvido no plano (~R$ 1,50-17/mês/tenant conforme plano)
  - **BYOK opcional:** admin tenant cola API key própria (Anthropic/OpenAI/Gemini/Groq/Maritaca) em `/app/settings/ia` → bypass quota
  - **Quota por plano:** 500 (Starter) / 3.000 (Pro) / 10.000 (Enterprise) chamadas/mês; excedida = circuit breaker + CTA BYOK (sem overage pago)
  - **Cache semântico pgvector** reduz 40-60% consumo
  - **STT embutido** via Groq Whisper-large-v3-turbo (Sprint 31 teleconsulta) — ~US$ 0,30/tenant/mês absorvido
  - **Fallback cascade** automático Gemini → OpenAI → Anthropic em caso de 429/500/timeout
  - **7 tabelas** (`ai_providers`, `ai_models`, `ai_provider_configs`, `ai_task_routing`, `ai_tenant_usage`, `ai_documents`, `ai_document_chunks`, `ai_semantic_cache`)
  - **Tasks tipadas** (chat/embedding/classification/extraction/vision/transcription/reasoning) com `resolveModelForTask()` — nunca hardcode
  - **RAG global curado LogiFit:** ADRs + Sprints + schema Drizzle + regulações (CFM 2.454, LGPD, TISS 4.01, CFN 599, COFFITO 414, ANVISA RDC) como seed; Copilot cita fonte
  - **System prompt composto** (`buildSystemPrompt()` com agent + regras globais + user + RBAC + RAG)
  - **Tool calling restrito** — Server Actions tipadas (proibido LLM emitir SQL arbitrário)
  - **White-label** do nome do assistente (`tenant_settings.ai_assistant_name`)
  - **Sistema mínimo de tickets** com tool `report_issue`
- **Regra 32** em `docs/rules.md` — chamada IA via `resolveModelForTask()`; tool calling tipado; tier mínimo por feature clínica; CI bloqueia hardcode
- **Regra operacional 17** em `CLAUDE.md` (total 32 regras)
- **Sprint 06** — escopo cresce de 2 para 3-4 semanas: entrega infraestrutura IA completa (7 tabelas + RAG ingestion + quota + BYOK UI + white-label + tickets) além do Copilot
- **Sprint 31** — STT Groq Whisper + **rascunho SOAP automático pós-teleconsulta** (transcript + contexto → IA gera 4 seções → profissional revisa/edita/assina — regra 28 supervisão humana)
- `docs/modulos.md` — 9 módulos novos (arquitetura IA, RAG, BYOK, quota, white-label, STT, rascunho SOAP, tickets, etc.)
- `CLAUDE.md` — stack atualizada: Gemini default + Groq STT + BYOK opcional; regra 17 adicionada
- `.env.example` — GOOGLE_CLOUD_PROJECT, VERTEX_AI_LOCATION, GOOGLE_APPLICATION_CREDENTIALS, GROQ_API_KEY, ENCRYPTION_KEY adicionados

Decisões confirmadas pelo usuário (2026-04-24):
1. Default LogiFit = Gemini 2.5 Flash (custo R$ 5 / 3k chamadas/mês; datacenter SP)
2. STT = Groq Whisper embutido no plano
3. `ai_tenant_usage` para quota tracking mensal
4. Quota excedida = bloqueio + CTA BYOK (sem overage pago)

Inspiração: arquitetura de IA do projeto Deep Control (tasks tipadas + task routing + RAG completo + multimodal + white-label) adaptada ao contexto saúde com gates de compliance (CFM 2.454, LGPD art. 11, tier mínimo regra 32).

### Added — Sprint 00b Menu lateral + evolução ADR 0063 (hamburger overlay único)

- **Sprint 00b (novo)** — `docs/sprints/00b-menu-lateral.md` com escopo detalhado de `<SideMenu>` hamburger overlay + registry por módulo + filtros automáticos de permission/vertical/consent/feature flag.
- **ADR 0063 atualizado** — padrão de navegação muda de "sidebar fixa em desktop + bottom-nav mobile + drawer tablet" (original) para **overlay único em todos os viewports** — ícone `☰` sempre visível, página ocupa 100% da largura em qualquer dispositivo. Trade-off aceito: mais cliques para navegar em desktop, compensado pelo atalho `Ctrl+B`/`Cmd+B` + pesquisa global `Ctrl+K` (ADR 0062) que vira caminho primário de navegação.
- **Organização por módulos** (decisão do usuário 2026-04-23): menu agrupa itens em ~15 módulos (Início, Pessoas, Agenda, Acesso, Comercial, Financeiro, Fiscal, Clínico, Vigilância, Relacionamento, Estoque, Engajamento, RH, Compliance, Integrações, Configurações); cada módulo colapsa/expande; **módulo inteiro oculto** se nenhum item passa nos filtros.
- **Filtros automáticos** na renderização: `requiredPermission` (via `has_permission()`), `requiredVertical` (tenant tem vertical ativa), `requiredConsent` (consent ativo), `featureFlag` (feature ligada). Padrão consistent com `registerMemberWidget` / `registerQuickAction` / `registerCrossAlertHandler` existentes.
- **Sprint 00 ajustado** — `<AppLayout>` agora é só header compacto + slot de conteúdo 100% viewport; componentes `<BottomNav>`, `<Drawer>`, `<Sidebar>` fixa **removidos** (não existirão); entrega apenas slot do `<HamburgerTrigger>` (implementação completa no 00b).
- **Sprint 07 ajustado** — não implementa sidebar própria; apenas registra itens do módulo "Início" via `registerMenuItem()`; botão 🔍 do Command Palette ao lado do ☰ no header.
- **Atalhos de teclado** (desktop): `Ctrl+B` / `Cmd+B` abre/fecha menu (padrão VSCode); `Esc` fecha + restaura foco; `Ctrl+K` continua abrindo pesquisa global.
- **Touch gestures** (mobile/tablet): swipe da borda esquerda abre; swipe para esquerda no menu aberto fecha.
- **Acessibilidade:** focus trap `role="dialog"` + `aria-modal="true"` + restore focus no trigger ao fechar; WCAG AA.
- **Roadmap atualizado** — Sprint 00b adicionado como item #1b entre #1 (Setup) e #2 (Identidade).
- **`docs/modulos.md`** — módulo "SideMenu hamburger overlay" adicionado em Fundação.

### Added — Responsividade total mobile-first (ADR 0063 + regra 31)

- **ADR 0063** — Responsividade total (`docs/decisions/0063-responsividade-total-mobile-first.md`). Toda UI `/app/*` e `/meu/*` adapta em 5 breakpoints (default/sm/md/lg/xl/2xl) via biblioteca de componentes base em `packages/ui/layout/*`. Mobile-first, touch targets ≥44px, safe-area-inset, testes Playwright em 3 viewports canônicos (mobile 390, tablet 768, desktop 1280). Zero serviço externo (Tailwind + shadcn nativos).
- **Regra 31** em `docs/rules.md` — proíbe layout próprio duplicado; exige componentes base de `packages/ui/layout/*`; CI bloqueia `<button>` com altura <44px e `<table>` fora de `<ResponsiveTable>`.
- **Sprint 00** — entrega biblioteca completa:
  - `<AppLayout>` (sidebar desktop ↔ bottom-nav mobile ↔ drawer tablet)
  - `<PortalLayout>` (`/meu/*` PWA com safe-area-inset)
  - `<ResponsiveModal>` (full-screen mobile ↔ centered desktop)
  - `<ResponsiveTable>` (table ↔ card-list com prioridade de colunas)
  - `<ResponsiveForm>` + `<StickyFooter>` (grid 2-col ↔ stack 1-col com rodapé fixo mobile)
  - `<BottomNav>` (tab bar inferior com 5 slots configuráveis por role)
  - `<Drawer>` (gaveta lateral com swipe tablet)
  - Tokens `min-h-touch` (44px) + `min-h-input` (48px) + `safe-area-*`
  - Helper `packages/config/playwright-viewports.ts` com matrix de viewports
  - Regra Biome "no-desktop-only-layout" (CI)
- **Sprint 07** — Dashboard adapta: mobile usa `<BottomNav>` (Home/Agenda/Financeiro/Pessoas/Mais); tablet usa `<Drawer>`; desktop usa `<Sidebar>` fixa; cards colapsam 4→3→2→1; Command Palette ganha botão 🔍 visível em mobile (substitui Ctrl+K).
- **Sprint 08** — QR do aluno otimizado mobile portrait; UI recepção aceita tablet landscape; feed live usa `<ResponsiveTable>` (cards em mobile).
- **Sprint 26** — Portal paciente confirma PWA mobile-first com safe-area-inset, bottom nav 4 slots, install prompt após 2ª visita, Lighthouse PWA ≥95.
- **`docs/sprints/_template.md`** — Definition of Done ganha 3 itens: responsividade (3 viewports), busca global (search_index), i18n (3 locales).
- **`docs/modulos.md`** — módulo "Componentes base responsivos" em Fundação.
- **`CLAUDE.md`** — regra operacional 16 + contagem 31 regras.
- Viewports de teste canônicos: iphone-13, pixel-5, ipad-portrait, ipad-landscape, desktop-1280, desktop-1920.

### Added — Pesquisa global Command Palette Ctrl+K (ADR 0062 + regra 30)

- **ADR 0062** — Pesquisa global via Command Palette (`docs/decisions/0062-pesquisa-global-command-palette.md`). Atalho `Ctrl+K` (Windows/Linux) e `Cmd+K` (Mac) abre overlay em qualquer tela; busca cross-module respeitando RLS + permission + consent + regra 25; modificadores `>` ações / `/` rotas / `@` pessoas / `#` tags; full-text PostgreSQL (tsvector) + trigram (pg_trgm) + unaccent; zero serviço externo (Algolia/Meilisearch rejeitados por custo + LGPD).
- **Regra 30** em `docs/rules.md` — módulo novo com dado pesquisável registra-se em `search_index` com `required_permission` explícita; omissão proibida (operador sem permission nunca pode ver resultado).
- **Sprint 00** — extensões PostgreSQL `pg_trgm` + `unaccent` habilitadas + scaffolding `<CommandPalette>` em `packages/ui` (componente base + hook `useCommandPalette()` + atalhos globais).
- **Sprint 07** — entrega MVP: tabela `search_index` + `search_telemetry` + triggers `search_index_sync()` para 7 tipos (person, member, lead, supplier, user, professional, appointment, ap, ar, setting, quick_action) + API `/api/search` + `<CommandPalette>` completo + API `registerQuickAction()` + atalho no layout + audit em clique em sensível.
- **Sprints 15, 17, 20, 21, 22, 25, 32, 33, 36** — cada sprint adiciona trigger de indexação de seus tipos no `search_index`: `ap`/`ar`/`supplier`/`nfe_received` (15), `bank_tx`/`nfe_return` (17), `consulta` sensível (20), `evolucao` sensível (21), `billing_guide`/`authorization` (22), `equipment`/`maintenance` (25), `device_connection` (32 — readings individuais NÃO indexados por volume), `lab_result` sensível (33), `fiscal_emission` (36).
- `docs/modulos.md` — módulo "Pesquisa global (Command Palette Ctrl+K)" em Fundação.
- `CLAUDE.md` — regra operacional 15 + contagem total de regras atualizada para 30.
- **Sem semântica no MVP** — embeddings pgvector mapeados para sprint futuro pós-33 se busca por sinônimos clínicos virar dor.

### Changed — Auditoria de cobertura de telas + ajustes em 7 sprints

Após auditoria sistemática cruzando 218 rotas documentadas × 10 roles × 61 ADRs × módulos prometidos, aplicados ajustes em 7 sprints:

- **Sprint 01b** — 4 telas novas detalhadas:
  - `/app/settings/compliance/comite-ia` (ADR 0053) — cadastro de membros, ata anexada, calendário de revisões semestrais, gate visual de features IA classe II+
  - `/app/compliance/ia` (ADR 0053) — dashboard de conformidade IA: features ativas + classe SaMD + última revisão + log de decisões humanas
  - `/meu/privacidade` (ADR 0054, scaffold) — 8 botões dos direitos LGPD art. 18; apagamento como solicitação (não automático)
  - 3 schemas novos: `data_subject_requests`, `ai_committee_members`, `ai_committee_reviews`, `ai_feature_classifications`
  - Wrapper `withAiClassGate(featureKey, fn)` bloqueia execução de features IA classe II+ sem comitê ativo
- **Sprint 13** — 2 telas: `/app/settings/canais/whatsapp` (config handlers inbound + identity matcher + log de classificações) + `/app/mensagens/inbound` (mensagens sem roteamento automático)
- **Sprint 15** — `/app/settings/financeiro/naturezas` (ADR 0061) — CRUD de `tax_natures` globais + custom do tenant com preview de retenções
- **Sprint 17** — 4 telas detalhadas:
  - `/app/financeiro/nfe/[id]/manifestar` — modal dos 4 eventos (ciência/confirmar/desconhecer/não realizada) com validação de justificativa ≥20 chars
  - `/app/financeiro/nfe/[id]/devolver` — modal de devolução (total/parcial + categoria + motivo) + PDF controle
  - `/app/financeiro/nfe/[id]/importar-devolucao` — upload do XML da devolução emitida externamente
  - `/app/financeiro/devolucoes` — lista consolidada de `nfe_returns` com alertas >7d em espera
- **Sprint 26** — `/meu/privacidade` expandido com UI completa dos 8 direitos LGPD + `/meu/privacidade/solicitacoes/[id]` + rotas admin espelho (`/app/compliance/titular-requests`, `/app/settings/retencao`)
- **Sprint 32** — 2 telas Device Hub detalhadas: `/app/members/[id]/dispositivos/curar` (curadoria profissional das leituras para avaliação) + `/app/settings/devices/[provider]` (config por provider) + `/meu/dispositivos/[provider]/consent` (consent granular por integração)
- **Sprint 36** — `/app/contador/*` expandido em **8 abas**: dashboard, xmls (massa), ap-ar (CSV/OFX), retenções, **DRE por período** (Sprint 14 read-only), **KPIs agregados** (nunca individuais — regra 26), fiscal-emissions, certificados (visualização); decisão: contador precisa de DRE para fechar balanço + KPIs para sanity check
- `docs/modulos.md` — módulos "Direitos do titular" e "Portal do contador externo" com escopo completo (8 abas do contador explicitadas)

**Decisões aplicadas nesta rodada** (respostas às 3 perguntas):
1. ✅ `/meu/privacidade` direito de apagamento = **solicitação** (admin + profissional + contador validam obrigações de retenção em 15d); evita cliente apagar acidentalmente dado com retenção legal
2. ✅ `/app/contador` inclui **DRE + KPIs agregados** (contador precisa para fechar balanço; agregados respeitam regra 26 — nunca dado individual)
3. ✅ Device Hub — telas em `/meu/dispositivos` (member pareia/revoga) **e** `/app/members/[id]/dispositivos` (profissional curta leituras para avaliação formal)

### Added — Motor de retenções + portal contador + roadmap fiscal faseado (ADR 0061)

- **ADR 0061** — Motor de retenções tributárias + cobertura fiscal faseada (`docs/decisions/0061-motor-retencoes-e-cobertura-fiscal-faseada.md`). Mapeia os 7 grupos de impostos (A-G) e define cobertura progressiva: Fase atual cobre B (retenções em AP) + G (retenções em comissão/RPA) + role/portal contador externo; Fases futuras cobrem C (apuração mensal), D (guias DAS/DARF/DAM), E (obrigações acessórias SPED/ECD/ECF), F (folha CLT + eSocial). Ambição de cobertura completa longo prazo, com tempo para avaliar make vs buy em cada grupo complexo.
- **Sprint 01b** — nova role `contador_externo` com permissions `fiscal.read` + `financeiro.read` + `nfe.read` + `retencoes.read` em todas as companies do tenant; MFA obrigatório; **sem** acesso a dados clínicos (LGPD art. 11); convite via magic link + fluxo de onboarding.
- **Sprint 15** — schemas `tax_natures` (10 globais + custom por tenant) + `tax_retentions`; calculadora em `packages/ai/fiscal/tax-calculator.ts` com suporte a rate_table (IRRF progressivo), cap_cents (teto INSS), threshold_cents, condition por UF/tomador; UI de AP com select de natureza + preview de retenções; coluna `accounts_payable.net_amount_cents`; UI admin `/app/settings/financeiro/naturezas`; job anual `tax-tables-annual-update`.
- **Sprint 23** — cálculo automático de retenções em comissão/RPA conforme tipo do profissional (PF autônomo → RPA com INSS 11%/IRRF progressivo; PJ → PIS/COFINS/CSLL/IRRF; Simples → sem retenção); UI mostra decomposição bruto → retenções → líquido; `commission_entries.net_amount_cents`.
- **Sprint 36** — aba `/app/fiscal/retencoes` (relatório mensal agrupado por tributo + export PDF/CSV) + **portal `/app/contador`** read-only para role `contador_externo` (download ZIP em massa de XMLs + CSV/OFX + relatório de retenções) + `/app/contador/convidar` para admin do tenant convidar contador externo.
- **Roadmap** — 4 sprints novos mapeados como **futuro (pós-produção)** cobrindo Grupos C/D/E/F: Sprint 37 (Apuração mensal), Sprint 38 (Guias oficiais DAS/DARF/DAM), Sprint 39 (Obrigações acessórias SPED/ECD/ECF — avaliar make vs buy), Sprint 40 (Folha CLT + eSocial — avaliar integração TOTVS/Senior/ADP). ADRs 0062-0065 previstos.
- `docs/modulos.md` — 4 módulos novos (motor de retenções, relatório retenções, portal contador, 4 fases futuras).
- `CLAUDE.md` — cobertura fiscal faseada explicitada; fontes regulatórias ampliadas (Lei 10.833/2003, IN RFB 1.234/2012, tabela IRRF anual, Portaria INSS, LC 116/2003).

**Integrações com Contabilizei/Conube/Omie/Alterdata/Domínio:** mencionadas no ADR 0061 como opções a avaliar nos Sprints 37+; não implementadas agora.

### Added — Ciclo fiscal completo: devolução + emissão via Focus + recepção avançada (ADRs 0058, 0059, 0060 + Sprint 36)

Resposta à verificação sistemática de todas as 22 operações NF-e do Brasil contra os módulos LogiFit. Cobertura anterior: 2 operações (recepção + manifestação). Agora: **ciclo fiscal completo** com 8 emissões + 3 eventos + 4 cenários avançados de recepção.

- **ADR 0058** — Devolução de compra (`docs/decisions/0058-devolucao-de-compra-nfe.md`). Duas camadas: registro interno (`nfe_returns`) no Sprint 17 com PDF de controle + import de XML emitido externamente; emissão automática via Focus NFe no Sprint 36. Reconciler integra com AP/AR (estorno ou criação de crédito).
- **ADR 0059** — Ciclo fiscal de emissão completo via Focus NFe (`docs/decisions/0059-ciclo-fiscal-emissao-focus-nfe.md`). Amplia Sprint 36 de "só NFS-e" para 8 tipos de emissão (NFS-e, NF-e produto, NFC-e varejo, NF-e devolução, NF-e transferência filial, NF-e remessa/retorno conserto, NF-e entrada própria) + 3 eventos (cancelamento, CC-e, inutilização). Interface `FiscalProvider` abstrata; Focus NFe como impl primária. LogiFit **não toca em motor tributário**.
- **ADR 0060** — Tratamento avançado de recepção NF-e (`docs/decisions/0060-recepcao-nfe-avancada-nfs-relacionadas.md`). Parser estendido extrai `finNFe`, CFOP primário, `refNFe` → link automático entre NFs relacionadas; `inbound_direction` diferencia compra/devolução-de-venda-recebida/complementar/ajuste/entrada-própria; job noturno resolve links órfãos.
- **Sprint 36 (novo)** — `docs/sprints/36-geral-fiscal-focus-nfe.md` implementa ADR 0059: 10 Server Actions de emissão + 3 de eventos + webhook callback Focus + wizard de onboarding + catálogo de serviços tributáveis + integrações com Sprints 04/16/17/22/24/25.
- **Sprint 15** — schemas adicionais: `nfe_returns` (ADR 0058), colunas `finality`/`cfop_primary`/`related_nfe_id`/`related_chave`/`is_self_issued_entry`/`self_issue_emission_id`/`inbound_direction` em `nfe_received` (ADR 0060), `fiscal_emissions` + `fiscal_events` + `fiscal_numbering_sequences` (ADR 0059 — preparação de schema sem UI); parser estendido para extrair metadados do XML; coluna `nfse_chave` em `invoices`.
- **Sprint 17** — UI completa de devolução (modal + PDF controle + import XML + reconciler) + badges contextuais por `inbound_direction` na inbox + filtro por tipo + job de resolução de links órfãos + 6 Server Actions novas.
- **Sprint 24** — POS emite NFC-e ou NF-e produto automaticamente (quando Sprint 36 ativo); novos `kind` em `stock_movements` (`exit_return_to_supplier`, `entry_return_from_customer`); FKs para `nfe_returns` e `fiscal_emissions`; listeners de devolução integram com estoque.
- **Sprint 16** — `intercompany_entries` ganha `requires_nfe_transfer` + `nfe_transfer_emission_id`; trigger marca transferências de bens entre CNPJs distintos; botão "Emitir NF-e transferência" quando Sprint 36 ativo.
- **Sprint 25** — `equipment_maintenance` ganha ciclo para manutenção externa com status `in_transit_to_external`/`at_external`/`returning`; FKs para NF-e de remessa (5.915) e retorno (1.916); integra com inbox de recepção do retorno.
- `docs/modulos.md` — 3 módulos novos no bloco "Geral" (devolução, recepção avançada) + nova seção completa "Emissão Fiscal" com 11 módulos cobertos pelo Sprint 36.
- `docs/roadmap.md` — Sprint 36 escopo atualizado com descrição completa.
- `CLAUDE.md` — marcos regulatórios ampliados: Focus NFe como provider oficial, NT 2013/005 (NFC-e), NT 2011/004 (CC-e), RTC 1.400/2016 ABRASF (NFS-e).

**Cobertura fiscal LogiFit agora:**

| Dimensão | Antes | Depois |
|---|---|---|
| Recepção NF-e | ✓ básica | ✓ básica + 4 cenários avançados (devolução de venda, complementar, ajuste, entrada própria) |
| Manifestação | ✓ 4 eventos | ✓ 4 eventos |
| Devolução | ✗ | ✓ registro interno + emissão automática |
| Emissão NFS-e | ⏳ Sprint 36 (só) | ✓ Sprint 36 |
| Emissão NF-e produto | ✗ | ✓ Sprint 36 |
| Emissão NFC-e | ✗ | ✓ Sprint 36 (integra POS Sprint 24) |
| Transferência entre filiais | ⚠ só contábil | ✓ contábil + NF-e de transferência |
| Remessa conserto | ✗ | ✓ ciclo completo com NF-e 5.915 / 1.916 |
| Entrada própria | ✗ | ✓ emissão + espelho na recepção |
| Eventos (cancelar/CC-e/inutilizar) | ✗ | ✓ via Focus NFe |

### Added — Manifestação do Destinatário NF-e (ADR 0057)

- **ADR 0057** — Manifestação do Destinatário de NF-e (`docs/decisions/0057-manifestacao-destinatario-nfe.md`). Cobre os 4 eventos fiscais da NT 2012/002 SEFAZ: Ciência (210210), Confirmação (210200), Desconhecimento (210220), Não Realizada (210240). Ciclo de vida integrado à inbox `/app/financeiro/nfe` (ADR 0056).
- **Ciência automática ON por padrão** (decisão do usuário) — tenant pequeno sem contador tem conformidade fiscal sem configurar; demais eventos **sempre manuais** com audit por `user_id`.
- **Gate por CNPJ** — company sem CNPJ (tenant PF) recebe `manifestation_status='not_applicable'` via trigger; UI esconde ações.
- **Sprint 15** — adiciona colunas de manifestação em `nfe_received` (`manifestation_status`, `manifestation_protocol`, `manifestation_at`, `manifestation_deadline`, `manifestation_by_user_id`, `manifestation_mode`, `manifestation_justification`, `manifestation_attempts`, `manifestation_last_error`) + `company_settings.nfe_manifestation_enabled`, `nfe_auto_ciencia_enabled` (default true), `nfe_manifestation_deadline_days` (default 180) + trigger do gate por CNPJ.
- **Sprint 17** — UI completa (coluna "Manifestação" + modal 4 opções) + `NfeFetcher.sendManifestation()` com retry + handler de ciência automática + jobs `nfe-manifestation-expiry` e `nfe-manifestation-deadline-warn` + card "NFs a manifestar" no dashboard do gerente + Server Actions `toggleNfeAutoCiencia` e `manifestNfe`.
- **Prazo padrão 180 dias** com alerta D-7 via cross-alert dispatcher (Sprint 07); override por UF fica como evolução.
- `CLAUDE.md` — NT 2012/002 SEFAZ adicionada aos marcos regulatórios.
- `docs/modulos.md` — módulo "Manifestação do Destinatário NF-e" em Geral.

### Added — Inbox unificada de NF-e com 4 métodos de ingestão (ADR 0056)

- **ADR 0056** — Inbox unificada de NF-e (`docs/decisions/0056-nfe-inbox-unificada-e-metodos-ingestao.md`). Tela única `/app/financeiro/nfe` concentra os 4 métodos de entrada: (1) download automático SEFAZ, (2) download por chave 44 dígitos, (3) upload XML, (4) entrada manual sem NF. Um único toggle em settings liga/desliga o automático; os 3 métodos manuais ficam sempre disponíveis como ações na inbox.
- **Sprint 15** — cria `nfe_received` (compartilhada com Sprint 17), inbox unificada com Upload XML + Entrada manual ativos; botão "Por chave" presente mas desabilitado com tooltip explicativo; `/app/settings/financeiro/nfe` com toggle em estado "aguardando Sprint 17"; interface `NfeFetcher` esqueleto em `packages/ai/nfe/fetcher.ts`; Server Actions: `uploadNfeXml`, `createApManual`, `convertNfeToAp`, `discardNfe`.
- **Sprint 17** — habilita os 2 métodos dependentes de provider externo + certificado A1: toggle "Download automático" vira funcional + botão "Por chave" habilitado na mesma inbox; implementações concretas de `NfeFetcher` (Arquivei, Sieg, Focus, SEFAZ direto); `nfe_sefaz_cursors` (novo); nova Server Action `fetchNfeByKey`.
- `docs/modulos.md` — módulo "Inbox unificada de NF-e" (Sprint 15+17) + módulo "Download por chave NF-e" (Sprint 17).
- **`accounts_payable`** ganha coluna `nfe_received_id uuid nullable` (FK) + `no_invoice bool default false` + enum `source` ampliado com `nfe_manual_key`.

### Added — Registros profissionais em conselho (ADR 0055)

- **ADR 0055** — Registros profissionais em conselho: CRM/CRN/CREFITO/CREF (+ enum aberto para CRF/CRP/COREN/CRO) (`docs/decisions/0055-registros-profissionais-em-conselho.md`). Tabela `professional_registrations` com unicidade global `(council_body, council_number, council_state)`; uma pessoa pode ter N registros (profissional dual); `situation` enum (`active`/`suspended`/`cassated`/`expired`/`pending_verification`/`unknown`); MVP = `operator_attested`, Fase 2 = job de validação automática nos portais oficiais.
- **Sprint 01b** — cria tabela, permissions `profissional.read/write`, UI `/app/pessoas/[id]/registros`, view `v_professional_registrations_active`, seed dos 4 conselhos base, testes E2E.
- **Sprint 20** (Prontuário) — `signConsulta`/`lockConsulta` exige registro ativo coerente com `kind` (medico→CRM, fisio→CREFITO, nutri→CRN); PDF inclui `{council_body}-{council_state} {council_number}` no rodapé (obrigatório CFM 2.299/2021, COFFITO 414/2012 art. 7º III, CFN 599/2018).
- **Sprint 22** (TISS) — gerador de XML popula `NumeroConselhoProfissional`, `SiglaConselho`, `UF`, `CBOS` a partir de `professional_registrations`; bloqueia geração se profissional sem `cbo_code` cadastrado.
- **Sprint 23** (Comissões) — `createProfessionalContract` valida registro ativo coerente com tipo de serviço do contrato.
- **Sprint 08** (Acesso Academia) — onboarding de user com role `personal`/`instrutor` exige CREF ativo (Lei 9.696/1998).
- `docs/modulos.md` — novo módulo "Registros profissionais em conselho" em Fundação + linhagem adicionada ao Contact-FK model.
- `CLAUDE.md` — marcos regulatórios ampliados: Leis 3.268/1957 (CFM), 6.316/1975 (COFFITO), 6.583/1978 (CFN), 9.696/1998 (CONFEF).

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
