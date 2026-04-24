# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [Unreleased]

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
