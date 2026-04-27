# ADR 0090 — Estratégia de testes (taxonomia T1-T21 + 3 níveis + suítes E2E)

- **Status:** Accepted
- **Date:** 2026-04-27

## Context

[ADR 0071](0071-sistema-tratamento-erros-alertas-tempo-real.md) define **como erros viram envelope** mas não diz **como provar que o envelope funciona**. [Sprint 00](../sprints/00-setup-infra.md) lista Vitest + Playwright + `db:rls-check` + 11 lints custom + i18n check, mas não define:

- Taxonomia fechada de tipos de teste (qual ferramenta canônica para qual problema)
- Níveis de obrigatoriedade (o que CI bloqueia vs o que é dívida documentada)
- Categorização de suítes E2E (smoke vs critical vs regression vs nightly)
- Mapa "categoria de risco do sprint → testes obrigatórios"
- Gates por suíte (qual suíte bloqueia merge, qual roda nightly, qual roda em schedule)
- Convenção anti-flakiness para E2E que dura

Auditoria das 40 sprints planejadas (Sprint 00 → 36 + 19b migração) identificou **21 tipos distintos** de teste relevantes ao escopo do LogiFit (saúde sensível LGPD art. 11, fiscal Focus NFe, multi-tenant, IA SaMD II+, integrações externas Asaas/Twilio/Pluggy/Garmin/Anthropic/Gemini), com **rico planejamento de unit/E2E mas lacunas em**: idempotência de webhook, contract test de provider externo, snapshot determinístico de PDF/XML, fuzzing de parser (NF-e XML, FEBRABAN, FIT/TCX, OCR de laudo), property-based em cálculos fiscais/clínicos, perf/load em jobs de cobrança e sync wearable, RLS comportamental (não só estrutural), chaos test em providers externos, mutation testing em hash chain ICP-Brasil e validador TISS.

Sem estratégia formal:
- Cada sprint dono "improvisa" a cobertura no timebox apertado (3-4 semanas) → corte de teste é a primeira vítima
- Suítes E2E crescem sem critério → bateria de PR inflaciona pra 30min e ninguém roda local
- Faltam gates: tudo bloqueia merge ou nada bloqueia
- Lacunas de teste viram incidente pós-merge sem ninguém saber que o teste estava faltando

## Decision

Adotar **taxonomia fechada de 21 tipos (T1-T21)** + **3 níveis de obrigatoriedade** + **10 suítes E2E categorizadas** + **infra base materializada no Sprint 00** + **convenção de citação no DoD de cada sprint**.

### 1. Taxonomia — 21 tipos canônicos

| ID | Tipo | Ferramenta canônica | Quando usar |
|---|---|---|---|
| **T1** | Unit | Vitest | Função pura, validador, calculadora |
| **T2** | Integration com DB real | Vitest + Postgres testcontainer | Schema + migration + trigger + view |
| **T3** | E2E | Playwright | Fluxo de usuário ponta-a-ponta |
| **T4** | Visual regression | Lost Pixel | Tela com layout estável e crítico |
| **T5** | Acessibilidade | axe-playwright | Toda página de `/app/*` e `/meu/*` |
| **T6** | RLS comportamental | Vitest + 2 conexões PG distintas | Provar isolamento tenant A vs B |
| **T7** | Idempotência de webhook | Vitest + helper `replayWebhook()` | Asaas, Twilio, Focus NFe, Pluggy, Garmin, push |
| **T8** | Contract test | MSW snapshot | Provider externo (shape do request/response) |
| **T9** | Type-level | tsd / expect-type | Envelope `{ok,data\|error}`, `resolveModelForTask` |
| **T10** | Property-based | fast-check | Cálculo financeiro/clínico com invariantes |
| **T11** | Snapshot determinístico | Vitest snapshot | PDF/XML/JSON gerado (NF-e, prontuário, DRE, recibo) |
| **T12** | Mutation testing | Stryker | Função fiscal/clínica crítica (commission, hash chain ICP, validador TISS) |
| **T13** | Perf/Load | k6 | Job em lote, dashboard com volume, sync wearable |
| **T14** | Lint custom Biome | regras AST | Arquitetura "não compilável" (`no-unwrapped-action`, `no-raw-fetch`, etc.) |
| **T15** | SQL/migration linter | sqlfluff + lint próprio | Particionamento (regra 34), DDL append-only (regra 5) |
| **T16** | Smoke matrix | Playwright project matrix | Toda página crítica em 3 viewports × 3 locales |
| **T17** | QA manual scripted | runbook em `docs/runbooks/` | Validação humana antes de produção (BLE, ICP-Brasil portal ITI) |
| **T18** | Chaos / resilience | toxiproxy / MSW failure | Provider down, timeout, rede caiu |
| **T19** | Compliance verifier | script CI | RIPD/ADR/threat-model presente; entrada `ai_audit_log` válida |
| **T20** | Coverage gate | Vitest `--coverage` | Threshold por package (regra 18) |
| **T21** | Fuzzing de parser | jazzer.js / fast-check | NF-e XML, FEBRABAN, FIT/TCX, OCR laudo, JWT, OFX |

Estes 21 cobrem 100% das categorias de risco do MVP. Outros tipos (BDD/Cucumber, Selenium, Cypress, Jest, Postman/Newman) **não entram** — são alternativas a tipos já cobertos, ferramenta única por tipo evita fragmentação.

### 2. Três níveis de obrigatoriedade

| Nível | Significado | Consequência se faltar |
|---|---|---|
| **Obrigatório** | CI bloqueia merge | PR não pode ser merged |
| **Recomendado** | Esperado mas pode ficar em débito documentado | PR merge com issue `test-debt` rastreando |
| **Opcional** | Aplicar quando o risco do sprint justifica | Avaliado caso a caso no DoD |

**Mapeamento Tx → nível padrão:**

- **Obrigatório (sempre):** T1, T14, T15, T19, T20
- **Obrigatório quando o sprint cria/toca o tipo de coisa:** T2 (schema), T3 críticos (fluxo cross-tenant ou fiscal), T6 (tabela com `tenant_id`), T7 (webhook), T11 (PDF/XML fiscal/clínico)
- **Recomendado (esperado mas não bloqueia):** T2 demais, T3 demais, T5, T8, T16, T17
- **Opcional (avaliar caso a caso):** T4, T9, T10, T12, T13, T18, T21

Cada sprint, ao entrar em `doing`, declara no DoD:
- Lista de Ts **Obrigatórios** que aplica (com identificador do caso)
- Lista de Ts **Recomendados** que aplica + os que viram `test-debt` (com link para issue)
- Lista de Ts **Opcionais** justificada (por que aplica ou por que não)

### 3. Linha-base transversal — 10 IDs em todo sprint com código novo

`T1` `T2` `T3` `T5` `T6` `T14` `T16` `T17` `T19` `T20`

Sprint dono não precisa repetir esses no DoD — só lista quem **fica fora** (com motivo) e os Ts adicionais que aplica.

### 4. Suítes E2E — 10 categorias com gates distintos

| Suíte | Pasta | Quando roda | Tempo-alvo | Gate |
|---|---|---|---|---|
| **smoke** | `apps/web/e2e/smoke/` | Todo PR | <2min | Bloqueia merge |
| **critical** | `apps/web/e2e/critical/` | PR de release + nightly | <8min | Bloqueia deploy prod |
| **regression** | `apps/web/e2e/regression/` | Nightly | <30min | Falha cria issue P1 |
| **i18n** | `apps/web/e2e/i18n/` | PR tocando `messages/` | <3min | Bloqueia merge |
| **responsiveness** | `apps/web/e2e/responsiveness/` | PR tocando `packages/ui/` | <4min | Bloqueia merge |
| **a11y** | `apps/web/e2e/a11y/` | Nightly | <10min | Falha cria issue |
| **visual** | `apps/web/e2e/visual/` | PR tocando UI | <5min | Diff >0.2% pede review humano |
| **perf** | `apps/web/e2e/perf/` | Nightly | <15min | Falha alerta Sentry |
| **security** | `apps/web/e2e/security/` | PR tocando auth/security | <3min | Bloqueia merge |
| **external** | `apps/web/e2e/external/` | Nightly + schedule semanal | <20min | Falha alerta DPO/finance |

**Matriz de execução:**

- Eixos: viewports {390, 768, 1280} × locales {pt-BR, en-US, es-419} × browsers {Chromium, WebKit}
- Padrão por teste: 1 viewport × pt-BR × Chromium
- Marcador `@responsive` expande para 3 viewports
- Marcador `@i18n` expande para 3 locales
- Smoke + critical rodam em **2 browsers** (Chromium + WebKit) para pegar quirks de Safari mobile
- Matriz cheia (3×3×2 = 18 jobs) só nas suítes transversais (i18n, responsiveness)

### 5. Top-12 testes "block release" (suíte `critical/`)

Cada um destes, se quebrar, **vira incidente público**. Suíte `critical/` é o mínimo absoluto antes de deploy prod.

| # | Sprint | Cenário | Por quê |
|---|---|---|---|
| 1 | 01a | RLS cross-tenant: 2 tenants × 3 roles × SELECT em 8 tabelas → 0 rows | Vazamento entre tenants |
| 2 | 01a | Trial 14d expira → 30d depois `anonymizeMember` zera PII | LGPD art. 18 + ADR 0054 |
| 3 | 02 | Cross-tenant read fisio empresa A → resumo paciente Y empresa B → grava `patient_data_access_log` | Regra 42 + ADR 0077 |
| 4 | 02 | Constraint global: 2º vínculo fisio mesmo paciente bloqueia + pede confirmação substituição | ADR 0077 |
| 5 | 04 | Replay 10× mesma `external_id` Asaas → 1 payment | Receita dobrada |
| 6 | 11 | Cross-prescrição: nutri 1.400 kcal + personal HIIT 5x → banner aparece → força com justificativa → audit grava | CFM 2.454 |
| 7 | 17 | Manifestação NF-e 210210 dispara automático em <5s | Prazo SEFAZ 180 dias |
| 8 | 19b | Cutover Vercel/Supabase → Vercel/OCI: hash chain audit_log preservado (última pré ↔ primeira pós) | Regra 39 |
| 9 | 20 | Prontuário CFM assinado ICP-Brasil → validação externa portal ITI confirma | CFM 2.299/2021 |
| 10 | 22 | Lote 1k guias TISS XML valida XSD ANS 4.01 antes de envio | Glosa em massa + Sprint 22 |
| 11 | 26 | Paciente revoga vínculo empresa X → próxima query Empresa X retorna `FORBIDDEN` em <5s | LGPD direitos art. 18 |
| 12 | 27 | Franchise A fisio registra CID → dispatcher bloqueia alerta para Academia B mesmo tenant → audit `blocked_reason='regra_25_franchise_cross_company'` | Regra 25 |

### 6. Top-10 testes "smoke" (suíte `smoke/`)

Cada PR roda estes 10 em <2min. Se quebrar, merge bloqueado.

1. **`auth-magic-link.spec.ts`** — signup → magic link → TOTP setup → login MFA → logout
2. **`tenant-switch.spec.ts`** — `acme.logifit.com.br` vs `globo.logifit.com.br` resolvem tenants distintos
3. **`member-create.spec.ts`** — gerente cria member; trial member → contrato ativo
4. **`agenda-book.spec.ts`** — recepção agenda Maria pra terça 18h; cancela; histórico permanece
5. **`asaas-checkout.spec.ts`** — gerar 1ª invoice → simula webhook pagamento (HMAC válido) → `paid`
6. **`dashboard-by-role.spec.ts`** — gerente vs recepção vs fisio veem widgets diferentes
7. **`global-search.spec.ts`** — `Cmd+K` busca "Maria" respeitando `required_permission`
8. **`messages-catalog.spec.ts`** — Toast/Banner/AlertDialog/ConfirmDialog/PromptDialog/FormError em 3 viewports (regra 45)
9. **`security-headers.spec.ts`** — CSP nonce, HSTS, X-Frame-Options DENY presentes em `/`, `/login`, `/app/dashboard`
10. **`mfa-recent-required.spec.ts`** — `cancelTissGuide` sem `mfa_at` recente → 403 + `MFA_RECENT_REQUIRED`

### 7. Mapa "categoria de risco → testes obrigatórios extras"

Além da linha-base, cada categoria de sprint tem extras compulsórios:

| Categoria | Sprints exemplares | Ts obrigatórios extras |
|---|---|---|
| **Multi-tenant base** | 01a, 01b, 02 | T6 (≥5 cenários) + T6+ (PAM session, grant expirado) |
| **Webhook de provider** | 04, 13, 17, 22, 36 | T7 (replay 10× = 1 efeito) + T8 (MSW snapshot) |
| **Cálculo financeiro** | 04, 14, 15, 16, 23 | T10 (invariantes) + T11 (PDF/CSV determinístico) |
| **Parser de documento** | 15, 20, 22, 32, 33, 36 | T11 (snapshot) + T21 (fuzzing) |
| **IA SaMD II+** | 06, 19, 28, 33, 34 | T19 (`ai_audit_log` + Comitê + RIPD) + T21 (prompt injection) |
| **Cross-tenant clínico** | 02, 26, 27 | T6 (`patient_data_access_log` append-only) + T19 (RIPD passaporte) |
| **Fiscal** | 15, 17, 22, 36 | T7 (idempotência por chave) + T11 (XML/PDF) + T15 (XSD) + T21 (XML malformed) |
| **Clínico assinado** | 20, 21 | T11 (PDF + hash ICP) + T12 (mutation hash chain) + T17 (validação portal ITI) |
| **Mobile/PWA** | 26, 35 | T16 (smoke matrix) + T5 (touch ≥44px) + T18 (offline rebase) |
| **Migração de infra** | 19b | T2 (dump/restore equivalence) + T15 (extensions + roles pós-restore) + T17 (rehearsal cronometrado 2×) + T18 (PgBouncer cai) |

### 8. Anti-flakiness — 8 regras para E2E que dura

1. **Frozen time** obrigatório em todo teste com data: `page.clock.install()` ou helper `freezeAt('2026-04-27T10:00:00-03:00')`
2. **Sem `waitForTimeout()`** — só `waitForResponse()` / `waitForSelector()` / `waitForLoadState()`
3. **Webhook simulado por POST direto** com HMAC válido em fixture; nunca esperar cron real
4. **Provider sandbox real** apenas em `external/` nightly; PRs usam MSW
5. **`storageState` por persona** — login direto via API + cookie em `beforeAll`, nunca UI repetida
6. **Workers paralelos com fixtures isoladas** — cada worker recebe um schema PG dedicado (template + clone) ou tenant_id próprio
7. **Retry 1×** apenas em `external/`; demais suítes 0 retry — flake = bug
8. **Trace + video em failure** sempre (`trace: 'retain-on-failure'`, `video: 'retain-on-failure'`)

### 9. Infra materializada no Sprint 00

Sprint 00 entrega **11 com código rodando + 7 com ferramenta pronta** — total 18 dos 21 Ts. Os 3 restantes (T4, T12, T21) ficam para sprint dono (primeiro consumidor real existir).

**Materializados (✅ código rodando):**
- T1 Vitest config + 1 teste exemplo
- T2 testcontainer Postgres + helper `setupTestDb()` + 1 teste exemplo
- T3 Playwright config + matriz + 10 esqueletos suíte `smoke/` + 12 esqueletos `critical/` (`test.skip` com nome do caso)
- T5 axe-playwright instalado + suíte `a11y/` com 1 teste em `/`
- T6 helper `twoConnectionsTest()` + 1 teste exemplo (criar tabela `_dummy` com `tenant_id`, provar isolamento)
- T9 tsd config + 1 type test do envelope `{ok,data|error}` (ADR 0071)
- T14 11 lints custom já planejados + lint pipeline
- T15 SQL linter + lint de `@volume_estimate_yearly` + partição obrigatória (regra 34)
- T16 matriz Playwright (3 viewports × 3 locales × 2 browsers) + helper `forEachViewport()` / `forEachLocale()`
- T19 script `compliance:check` (RIPD hash, ADR esperado, threat-model presente, `ai_audit_log` schema válido)
- T20 Vitest `--coverage` + threshold por package: ≥80% em `packages/errors|security|db/policies`; ≥70% em `packages/db`; ≥60% em Server Actions (regra 18)

**Ferramentas instaladas mas sem caso ainda (⚪):**
- T7 helper `replayWebhook(externalId)` — sem caso até Sprint 04 Asaas
- T8 MSW instalado + diretório `apps/web/e2e/_mocks/` — sem snapshots até Sprint 01a Supabase Auth
- T10 fast-check instalado — sem invariante até Sprint 15 retenções fiscais
- T11 helper `frozenClock()` + ordenação fixa em snapshots — sem PDF/XML até Sprint 15
- T13 k6 binary disponível em CI + diretório `apps/web/e2e/perf/` — sem cenário até Sprint 04 cobrança
- T17 template `_template.md` (já existe) + convenção de runbook por sprint dono
- T18 toxiproxy + `MSWHandlerWithFailure` — sem caso até Sprint 04

**Decisão sobre infra (não materializa Sprint 00):**
- T4 Lost Pixel — instalar quando primeira UI estabilizada (Sprint 00b ou 02)
- T12 Stryker — instalar quando primeira função fiscal/clínica crítica existir (Sprint 04 ou 23)
- T21 jazzer.js — instalar quando primeiro parser real existir (Sprint 15 OCR)

### 10. Convenção de citação no DoD

Todo sprint NN, ao entrar em `doing`, abre o DoD com:

```markdown
## Estratégia de testes (ADR 0090)

**Linha-base transversal:** T1 T2 T3 T5 T6 T14 T16 T17 T19 T20 (default — sem ressalvas)
**Obrigatórios extras** (categoria do sprint = "X"): T7 T8 T11 (3 itens)
- T7 — replay webhook Asaas `payment.confirmed` 10× = 1 payment ([fluxo `confirmAsaasPayment`](path))
- T8 — MSW snapshot Asaas customer/subscription/payment endpoints
- T11 — invoice PDF bitwise igual após re-geração

**Recomendados aplicados:** T13 T18 (2 itens)
- T13 — k6 simula 5k contratos × job cobrança diária <30s
- T18 — Asaas timeout 5s no webhook → queue retry 3×, 4ª falha cria `system_alerts critical`

**Recomendados em débito** (issue criada): nenhum
**Opcionais avaliados:** T10 (descartado — Asaas não tem invariante matemática evidente), T21 (descartado — webhook payload já validado por Zod + HMAC)
```

Lint custom `dod-cites-adr-0090` (a criar — não bloqueante MVP) verifica que o bloco existe.

## Consequences

### Positivas

- **Categorias de risco têm cobertura mínima garantida.** Não é mais "lembrei de RLS test" — é Obrigatório por categoria.
- **Sprints solo têm timebox protegido.** Recomendado pode virar `test-debt` documentado; Obrigatório CI bloqueia. Ninguém mais "esquece" um teste crítico nem "estoura" sprint por testar coisas opcionais.
- **Lacunas viram issues rastreáveis.** `test-debt` label permite triagem em Fase 2.
- **Infra base reduz fricção do sprint dono.** Esqueletos `test.skip` com nome → autor preenche em 30min, não cria do zero.
- **Suítes categorizadas mantêm CI rápido.** Smoke <2min em todo PR; regression noturno; external só em schedule. PR de UI não roda perf de financeiro.
- **Onboarding de futuro contratado simplifica.** ADR 0090 é referência única para "como testamos aqui".

### Negativas

- **CI mais complexo.** 10 suítes × matriz = ~15 jobs paralelos. Custo CI cresce ~3× vs setup ingênuo.
- **Ferramentas adicionais** elevam dev deps: MSW, fast-check, axe-playwright, k6, tsd, jazzer.js (futuro), Stryker (futuro), Lost Pixel (futuro). Bundle de dev cresce ~50MB.
- **Cada sprint dono precisa estimar testes no DoD** (~10-15% do timebox). Rito novo.
- **Infra de teste vira sub-projeto** — fixtures, POMs, helpers — exige manutenção própria.

### Mitigações

- **Stryker, Lost Pixel, jazzer.js só instalam quando primeiro consumidor real existir** (sem peso pré-MVP).
- **Fixtures dos 5 cenários canônicos** (já obrigatórios por CLAUDE.md) e **POMs reusáveis** amortizam custo entre sprints.
- **`storageState` por persona × cenário** evita 50% do tempo de teste E2E.
- **CI usa cache agressivo** para Playwright browsers + Postgres testcontainer image + pnpm store.
- **Auditoria pós-M3** (beta privado, ~Sprint 12 done) reavalia: cobertura real vs planejada, custo médio de teste por sprint, lacunas de tipo, candidatos a deprecação (T12 se nunca usado, T4 se ruidoso).

### Riscos

- **Sprint 00 estoura timebox por excesso de infra de teste.** Mitigação: 18 dos 21 Ts são scaffolding (config + 1 exemplo); só T6 + T19 + T20 exigem implementação não-trivial.
- **Suíte `external/` fica frágil** porque depende de sandbox Asaas/Focus/Twilio com SLA não-LogiFit. Mitigação: rodar só em nightly, retry 1×, falha não bloqueia merge — só alerta DPO/finance.
- **Lost Pixel detecta mudança visual legítima como regressão** e gera ruído. Mitigação: ativar só após Sprint 00b (primeiro consumidor de UI) e limitar a 5-10 telas-chave; demais usam apenas axe + smoke.

## Status — futuras revisões

Reavaliar após **M3 (beta privado, ~Sprint 12 done)**:

- Cobertura real vs planejada por categoria de risco
- Custo médio de teste por sprint (Obrigatório vs Recomendado vs Opcional)
- Lacunas de tipo (faltou alguma categoria que apareceu na prática?)
- Candidatos a deprecação (T12 se nunca usado, T4 se ruidoso, T18 se nunca quebrou nada)
- Custo CI mensal (alvo: <R$ 200/mês até Sprint 19)

Reavaliar também **antes de Sprint 19b (cutover)**: T17 rehearsal está cronometrado? T18 cobre PgBouncer? T2 tem dump/restore equivalence?

## Decisões correlatas

- [ADR 0001 — Stack base](0001-stack-base.md) — Vitest + Playwright + Biome
- [ADR 0071 — Sistema de tratamento de erros + alertas em tempo real](0071-sistema-tratamento-erros-alertas-tempo-real.md) — envelope que T9 valida
- [ADR 0072 — Escalabilidade banco (particionamento + retenção)](0072-escalabilidade-banco-particionamento-retencao-cold-storage.md) — regra 34 que T15 enforça
- [ADR 0073 — Postura de segurança (defesa em profundidade)](0073-postura-seguranca-defesa-em-profundidade.md) — headers/CSP/MFA que T3 `security/` valida
- [ADR 0077 — Passaporte cross-tenant](0077-passaporte-paciente-vinculo-cross-tenant.md) — 12 testes "block release" #3, #4, #11
- [ADR 0078 — Hospedagem em duas fases](0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md) — 12 testes "block release" #8 (cutover)
- [`docs/rules.md`](../rules.md) — regra 18 (cobertura) referencia este ADR como fonte canônica completa
