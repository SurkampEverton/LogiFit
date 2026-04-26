# ADR 0070 — Insights cross-module computados + Timeline integrada

- **Status:** Accepted
- **Date:** 2026-04-24

## Context

Um cliente que contrata os 3 módulos (Academia + Fisio + Nutri) gera dados ricos em cada vertical. Hoje cada módulo vê **seus próprios dados** isoladamente — se nutri quer saber se o plano alimentar compensa o gasto do treino, tem que:

1. Perguntar ao cliente qual treino ele faz
2. Ir em outro sistema (ou papel) ver
3. Calcular TDEE à mão

**Oportunidade:** o sistema já tem os dados; falta **camada de insights computáveis** que cruza tudo automaticamente — antes mesmo de IA.

Exemplo canônico do usuário (2026-04-24): **nutricionista vê o treino completo do cliente com previsão de gasto calórico calculado automaticamente**.

Isso não é IA — é matemática determinística:

```
Antropometria (Sprint 12) → TMB (Mifflin-St Jeor)
Treino (Sprint 11) + MET por exercício → Gasto calórico por sessão
TMB + gasto treino → TDEE
TDEE → meta calórica do plano alimentar
```

**Sprints atuais cobrem dados de entrada, mas falta a camada computada + cards contextuais cross-module.**

Decisões do usuário (2026-04-24):

1. **Insights determinísticos no MVP** (TMB/TDEE/volume/contraindicações)
2. **Timeline integrada no MVP** (Sprint 02 entrega junto)
3. **Alertas cross-module automáticos no MVP** (reusa cross-alert dispatcher Sprint 07)
4. **`exercises.met_value` seed Compendium 2024 no Sprint 11** (~800 exercícios com MET)
5. **`cid_exercise_contraindications` curado pelo LogiFit** (tenant pode override)
6. **Cache em `member_insights`** com invalidação por evento

## Decision

### Camada de insights determinísticos

Funções puras em `packages/db/insights/` que recebem dados de múltiplos módulos e retornam métricas derivadas — **zero IA, determinísticas, testáveis**.

### Catálogo de insights (MVP + evolução)

#### **MVP (Sprint 02 + 11 + 12 + 27 + 29 + 31)**

| Insight | Fórmula / fonte | Aparece em |
|---|---|---|
| **TMB** (Taxa Metabólica Basal) | Harris-Benedict / Mifflin-St Jeor / Katch-McArdle conforme dados disponíveis | Nutri, Personal |
| **Gasto calórico sessão** | `MET × peso_kg × duração_horas` | Nutri, Personal, Fisio |
| **Volume semanal treino** | Σ duração × intensidade dos últimos 7 dias | Personal, Nutri, Fisio |
| **Frequência treino** | Dias com sessão / período | Personal, Fisio, Nutri |
| **TDEE** | TMB × fator atividade calculado do treino real | Nutri, Personal |
| **Balanço calórico** | food_log.calorias − (TMB + gasto_treino) | Nutri, Personal |
| **Adesão plano alimentar** | % dias com desvio <10% do plano | Nutri, Personal |
| **Contraindicações ativas** | CIDs × exercícios prescritos via `cid_exercise_contraindications` | Fisio, Personal |
| **Saldo créditos** | `appointment_credits.balance` (já existe) | Recepção, todos |

#### **Fase 2 (Sprint 34 + cross-alerts expandidos)**

| Insight | Fórmula / fonte | Aparece em |
|---|---|---|
| **Projeção peso** | Regressão linear últimas 8 semanas antropometria | Nutri, Personal |
| **Sinais overtraining** | RPE crescente + frequência > prescrito + queda performance | Fisio, Personal |
| **Risco lesão** | Volume crescente + dor reportada (WhatsApp inbound) + HR elevado (Device Hub) | Fisio, Personal |
| **Trajetória composição corporal** | Balanço calórico × volume treino → projeção fat%/lean mass | Nutri, Personal |
| **Interações medicamentosas** | Supplement Prescriptions × Rx Fisio × outras | Nutri, Fisio, médico |

### Schema

```sql
-- Campo novo em exercises (Sprint 11)
ALTER TABLE exercises ADD COLUMN met_value numeric(3,1) DEFAULT 3.5 NOT NULL;
-- Referência: Compendium of Physical Activities 2024
-- Exemplos: musculação geral 5.0 · corrida 8km/h 8.3 · HIIT 10.0 · yoga 2.5

-- Contraindicações CID × exercícios (Sprint 27 expandido)
cid_exercise_contraindications
  id uuid pk
  cid_code text fk cid_catalog     -- 'M54.5','M54.4','S83.5',...
  exercise_id uuid fk exercises nullable
  exercise_pattern text nullable    -- 'agachamento*', 'stiff*' (LIKE match)
  severity enum ('avoid','adapt','caution')
  alternative_exercise_ids uuid[]
  medical_reference text             -- publicação/diretriz citada
  curated_by enum ('logifit_global','tenant')
  tenant_id uuid nullable           -- null = global
  created_at
  -- seed global LogiFit: ~200 contraindicações mais comuns
  -- tenant pode adicionar custom

-- Cache de insights (invalidado por evento ou TTL)
member_insights
  id uuid pk
  tenant_id uuid
  member_id uuid fk
  insight_key text                  -- 'tdee','weekly_volume','caloric_balance_7d',...
  value jsonb                       -- estrutura varia por insight
  computed_at timestamptz
  stale_after timestamptz           -- TTL (ex: 6h para volume, 24h para TDEE)
  invalidated_by_event text nullable -- qual evento força recálculo
  unique (tenant_id, member_id, insight_key)

-- Timeline integrada unificada (materialized view)
-- Agrega eventos de múltiplos módulos em ordem cronológica por member
CREATE MATERIALIZED VIEW member_timeline AS
  SELECT tenant_id, member_id, 'consulta' as kind, id as ref_id,
         signed_at as at, jsonb_build_object(...) as summary
  FROM consultas
  WHERE signed_at IS NOT NULL
UNION ALL
  SELECT tenant_id, member_id, 'workout_session' as kind, id,
         performed_at as at, jsonb_build_object(...) as summary
  FROM workout_sessions
UNION ALL
  SELECT tenant_id, member_id, 'food_log_day' as kind, id,
         day as at, jsonb_build_object(...) as summary
  FROM food_log_daily_summary
UNION ALL
  SELECT tenant_id, member_id, 'assessment' as kind, id,
         performed_at as at, jsonb_build_object(...) as summary
  FROM assessments
UNION ALL
  SELECT tenant_id, member_id, 'invoice' as kind, id,
         created_at as at, jsonb_build_object(...) as summary
  FROM invoices
UNION ALL
  -- ... outros eventos relevantes
  ;

REFRESH MATERIALIZED VIEW member_timeline; -- via job + invalidation
```

### Funções principais em `packages/db/insights/`

```ts
// packages/db/insights/anthropometry.ts
calculateTMB(input): { value: number, formula: string, explanation: string }
calculateBodyFatPercent(input): { value: number, protocol: string }

// packages/db/insights/workout.ts
calculateKcalPerSession(metValue, weightKg, durationMin): number
calculateWeeklyVolume(sessions): { totalMin, totalKcal, intensityAvg, avgFrequency }
calculateFrequencyTrend(sessions, period): { current, previous, deltaPercent }

// packages/db/insights/nutrition.ts
calculateTDEE(member, assessments, workoutSessions):
  { tmb, activityFactor, tdee, breakdown: { resting, trainingWeekly, dailyAvg } }
calculateCaloricBalance(member, period, foodLog, workoutSessions):
  { avgIn, avgOut, avgNet, trend }
calculatePlanAdherence(mealPlan, foodLog, period): { percent, missedDays, overDays }

// packages/db/insights/cross.ts
detectContraindications(activeCids, activeWorkouts): Contraindication[]
detectOvertrainingSignals(sessions, painReports, period): { risk, signals[] }
estimateBodyTrajectory(assessments, caloricBalance): { slopeKgPerMonth, confidence }

// Orchestrator
computeAllInsights(memberId, tenantId): Promise<MemberInsights>
// Chamada pelo worker de atualização de cache ou on-demand
```

### Widget cross-module (registry ampliado)

`registerMemberWidget` (Sprint 02) ganha campo:

```ts
registerMemberWidget({
  slot: 'treino-cross-nutri',
  component: TrainingCrossViewNutri,
  requiredPermissions: ['nutri.read'],
  requiredVertical: 'nutri',
  crossModuleRequires: {                          // NOVO
    source: 'academia',                            // pega dados de qual vertical
    permission: 'prescricao.read',                 // profissional precisa dessa permission no source
    consent: 'nutri_sees_training',                // consent do paciente
  },
  insights: ['tdee', 'weekly_volume', 'caloric_balance_7d'],  // NOVO
  showWhen: (m) => m.has_active_workout_prescription && m.has_assessment,
})
```

Sistema:
1. Checa permissions + vertical + consent
2. Se tudo OK, chama `getMemberInsights(memberId, insights)` (cache-first)
3. Renderiza componente com dados

### Consent granular por contexto

Expande `consent_purposes` (ADR 0005):

```sql
-- Consent purposes adicionados
INSERT INTO consent_purposes (key, label, ...) VALUES
  ('nutri_sees_training', 'Nutricionista vê meus treinos',
    'Permite que sua nutricionista veja o plano de treino e calcule gasto calórico automaticamente'),
  ('nutri_sees_prontuario', 'Nutricionista vê meu prontuário fisio',
    'Permite cruzamento de condições clínicas com plano alimentar'),
  ('personal_sees_prontuario', 'Personal trainer vê meu prontuário fisio',
    'Permite adaptar exercícios às restrições médicas'),
  ('personal_sees_nutri_plan', 'Personal trainer vê meu plano alimentar',
    'Permite orientar suplementação pré/pós-treino'),
  ('fisio_sees_training', 'Fisioterapeuta vê meus treinos',
    'Permite avaliar compatibilidade com tratamento')
  ...
```

Paciente controla cada um separadamente em `/meu/privacidade`. Revogação imediata (regra 6).

### Exemplos de widgets cross-module

#### Aba Alimentar (Nutri) — card "Treino deste paciente"

```
┌─ 🏋️ Treino deste paciente · semana atual ───────────────┐
│  Plano ativo: "Hipertrofia A/B/C" · 4x/sem · 45min      │
│                                                          │
│  Seg: Treino A (peito) 45min · MET 5.0 · ~280 kcal       │
│  Ter: Corrida 8km/h     30min · MET 8.3 · ~310 kcal      │
│  Qua: Treino B (pernas) 50min · MET 6.0 · ~320 kcal      │
│  Sex: Treino C (costas) 45min · MET 5.0 · ~280 kcal      │
│  Sáb: HIIT              20min · MET 10.0· ~270 kcal      │
│                                                          │
│  🔥 Gasto calórico treino: ~1.460 kcal/semana             │
│  📊 TDEE estimado: 2.560 kcal/dia                         │
│     (TMB Mifflin 1.580 × fator atividade 1.62)           │
│                                                          │
│  💡 Para seu plano alimentar:                            │
│     Manutenção: 2.560 · Ganho: 3.060 · Perda: 2.060      │
│                                                          │
│  [Usar TDEE no plano]  [Detalhe do cálculo]              │
└──────────────────────────────────────────────────────────┘
```

#### Aba Treino (Personal) — card "Alimentação do cliente"

```
┌─ 🥗 Alimentação deste cliente · esta semana ────────────┐
│  Plano: "Hipertrofia · Fase 2" · Nutri: Marcos          │
│                                                          │
│  Meta: 2.800 kcal · 180P/350C/80G                        │
│  Média: 2.650 kcal · 170P/320C/75G  (94% adesão ✅)      │
│                                                          │
│  Timing pré-treino: 3/4 sessões (✅ 75%)                 │
│  Suplementos ativos: Whey, Creatina, Ômega-3             │
│                                                          │
│  💡 Cliente em superávit 240 kcal/dia                    │
│     → ganho ~0.25kg/sem (compatível com plano)           │
└──────────────────────────────────────────────────────────┘
```

#### Aba Clínico (Fisio) — card "Treino + contraindicações"

```
┌─ 🏋️ Treino atual do paciente ──────────────────────────┐
│  Personal: Prof. Ana · 4x/sem · intensidade moderada    │
│                                                          │
│  ⚠ CRUZAMENTO COM DIAGNÓSTICO:                          │
│     CID M54.5 (lombalgia) · tratamento desde 15/mar     │
│                                                          │
│     Exercícios contraindicados no treino:               │
│     ⚠ Stiff (terça) · pode agravar lombar                │
│     ⚠ Agachamento carga >70% · pressão axial            │
│     ✅ Rosca direta · compatível                         │
│     ✅ Remada cavalinho · OK com postura controlada      │
│                                                          │
│     Alternativas sugeridas: glute bridge, crucifixo     │
│                                                          │
│  [Discutir com personal via WhatsApp]                    │
│  [Enviar alerta clínico automático]                     │
└──────────────────────────────────────────────────────────┘
```

### Timeline integrada

Widget `timeline-integrada` no perfil do paciente:

```
┌─ 📅 LINHA DO TEMPO ──────────────────────────────────────┐
│                                                          │
│  HOJE · 24 abr                                           │
│  ● Consulta fisio (Dr. Carlos) · 14:30                   │
│                                                          │
│  ONTEM · 23 abr                                          │
│  ✓ Treino B realizado (45min · ~320 kcal)                │
│  ✓ Diário alimentar registrado (2.500 kcal · 90% plano)  │
│  ✓ PIX R$ 120 pago (sessão fisio extra)                  │
│                                                          │
│  22/04                                                   │
│  ✓ Treino A realizado                                    │
│  ⚠ Dor reportada WhatsApp: "lombar incomodou no stiff"   │
│                                                          │
│  21/04                                                   │
│  ✓ Consulta fisio (3ª sessão · Oswestry 32→28)           │
│  ⚠ Nutri Marcos revisou plano: +200 kcal                 │
│                                                          │
│  18/04                                                   │
│  ✓ Bioimpedância: 72kg · 14% gordura (+0.3kg vs sem.)    │
│  ✓ Treino C realizado                                    │
│                                                          │
│  [Filtrar: Fisio ✓ Treino ✓ Nutri ✓ Financeiro ✓]        │
└──────────────────────────────────────────────────────────┘
```

Materialized view `member_timeline` alimenta; refresh a cada 5min via cron + invalidation por evento.

### Alertas cross-module automáticos

Reusa cross-alert dispatcher do Sprint 07. Handlers novos:

```ts
// Sprint 27 expandido
registerCrossAlertHandler({
  event: 'workout_prescription.updated',
  handler: async (payload) => {
    const member = await getMember(payload.member_id)
    const activeCids = await getActiveCids(member.id)
    const contras = detectContraindications(activeCids, payload.workout)
    if (contras.length > 0) {
      await dispatchAlert({
        targetRoles: ['fisio', 'personal'],
        memberId: member.id,
        severity: 'warning',
        message: `Novo treino contém ${contras.length} exercícios contraindicados pelo diagnóstico`,
        actions: [
          { label: 'Ver detalhes', url: `/app/members/${member.id}?tab=clinico` },
          { label: 'Enviar mensagem', url: `...` },
        ],
      })
    }
  },
})

// Exemplos adicionais:
// - caloric_balance_7d < -1000 AND weekly_volume > 400min → alerta overtraining
// - weight_change_30d > 2kg → alerta revisão plano
// - missed_appointments_7d > 2 → alerta aderência
// - food_log_adherence < 60% → alerta nutri
```

### Invalidação de cache

Eventos que invalidam `member_insights`:

```
workout_prescription.created/updated → invalida: weekly_volume, caloric_balance, tdee, contraindications
assessment.created                    → invalida: tmb, tdee, caloric_balance, body_trajectory
food_log_day.created                  → invalida: caloric_balance, plan_adherence
consulta.signed                       → invalida: contraindications
meal_plan.created/updated             → invalida: caloric_balance, plan_adherence
```

Handler em `packages/db/insights/invalidation.ts` escuta eventos + limpa cache correspondente.

### Performance + escalabilidade

- **Cache TTL** varia por insight: TDEE 24h, volume_semanal 6h, caloric_balance_7d 6h
- **Materialized view** refreshed em job noturno + on-demand se invalidada por evento crítico
- **Widget UI** renderiza cache + re-compute em background se stale
- **Particionamento** por tenant_id se tabela `member_insights` passar de 1M linhas
- **Testes unit** em `packages/db/insights/__tests__/` cobrem 30+ cenários (MVP)

## Consequences

### Positivas

- **Integração real entre módulos** — não é só "compartilhar widget", é computar insights úteis cross-vertical
- **Valor clínico imediato** — nutri calcula TDEE automático; fisio alerta contraindicação; personal adapta com consent
- **Determinístico e auditável** — funções puras testáveis, sem "caixa-preta" de IA
- **Base para Sprint 34 Nutri-Agent** — IA narra insights já calculados; foca em natural language, não cálculo
- **Timeline integrada reduz desconexão** — profissional vê história do paciente em 1 tela
- **Alertas proativos reduzem erro clínico** — contraindicação detectada antes de sessão acontecer
- **Consent granular preserva privacidade** — paciente controla cruzamentos
- **Compendium 2024 seed** dá base sólida para MET-based calculations
- **Curadoria LogiFit de contraindicações** padroniza qualidade clínica cross-tenant

### Negativas (mitigáveis)

- **Cache + invalidação são complexos** — edge cases de stale data; mitigado por testes + TTL conservador
- **Compendium 2024 tem ~800 atividades** — seed inicial cobre 80% dos treinos; curadoria iterativa ajusta
- **Contraindicações podem estar desatualizadas** ou imprecisas — revisão semestral + tenant pode override + disclaimer "orientação; profissional decide"
- **Consent cross-module adiciona friction inicial** — wizard guia paciente no onboarding com exemplos práticos
- **Performance de materialized view** em tenant grande (1M events) — particionar + limit de 6 meses de history na view padrão
- **Cálculo errado gera dano clínico** — disclaimer + sempre exige validação humana antes de agir; nunca auto-aplica

### Riscos não endereçados

- **Fórmulas de TMB variam** — oferecer escolha (Harris-Benedict/Mifflin/Katch-McArdle); Mifflin-St Jeor como default mais aceito
- **MET de Compendium 2024 é estimativa populacional** — não substitui medição direta (ergoespirometria); aceitar aproximação
- **Paciente que não usa diário alimentar** — caloric_balance fica incompleto; UI mostra "registre diário para cálculo completo"
- **Contraindicação falsa-positiva** frustra personal — feedback loop de revisão na curadoria global
- **Cross-consent revogado depois que plano foi feito com insight** — plano continua válido, mas próximos não têm acesso; audit completo

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Só IA (Sprint 34 Nutri-Agent) faz todo o cruzamento | IA chega em Fase 3; cálculo determinístico pode nascer no MVP e alimentar IA depois |
| Compendium 2024 só como stretch | 800 exercícios sem MET viraria placeholder inútil; seed no Sprint 11 é barato e fundamental |
| Cada tenant cura contraindicações | Curadoria médica requer expertise; global LogiFit dá base; tenant customiza |
| On-demand sem cache | Performance ruim em múltiplos widgets por página; cache é necessário |
| Consent geral "cross-module" sem granularidade | Paciente não entende consent genérico; granular por contexto é LGPD-friendly |
| Timeline só em tabela relacional | Aggregation de múltiplas fontes em runtime é lenta; materialized view é padrão |
| Insights calculados no client | Lógica sensível deve ser server-side (audit + consistência) |

## Escopo de impacto

**Novo ADR:** este (0070).

**Sprints ajustados:**

- **Sprint 02 CRM** — entrega widget `timeline-integrada` + materialized view `member_timeline` + registry ampliado com `crossModuleRequires` e `insights[]` + `member_insights` cache + invalidação por eventos
- **Sprint 07 Dashboard** — cross-alert dispatcher ganha handlers: contraindicação, overtraining, balanço calórico crítico, adesão baixa, mudança de peso brusca
- **Sprint 11 Prescrições** — `exercises.met_value` obrigatório + seed Compendium 2024 (~800 exercícios curados LogiFit) + `workout_sessions.calculated_kcal` preenchido automático
- **Sprint 12 Avaliações** — calculadoras TMB/TDEE/body fat viram funções públicas em `packages/db/insights/anthropometry.ts` (reuso cross-module)
- **Sprint 27 Cross-alert lesão→treino** — expande com `cid_exercise_contraindications` + seed LogiFit global (~200 contraindicações mais comuns) + detector em `packages/db/insights/cross.ts`
- **Sprint 29 Nutri plano alimentar** — botão "Usar TDEE calculado" pré-preenche meta calórica + card cross-module "treino deste paciente" + consent wizard
- **Sprint 31 Diário + teleconsulta** — `food_log_daily_summary` alimenta `calculateCaloricBalance` + widget na aba Alimentar
- **Sprint 34 Nutri-Agent** — consome `member_insights` pré-calculados + gera narrativa/sugestões em linguagem natural; **não calcula, interpreta**

**Schema:**
- `exercises` ganha `met_value`
- `cid_exercise_contraindications` nova (seed global LogiFit)
- `member_insights` nova (cache)
- `member_timeline` materialized view
- `consent_purposes` ganha 5 purposes cross-module

**Docs:**
- `docs/modulos.md` — módulos "Insights cross-module", "Timeline integrada", "Contraindicações CID×exercício"
- `CLAUDE.md` — regra operacional sobre uso de `packages/db/insights/`
- `CHANGELOG.md` — entrada consolidada

**`packages/db/insights/` estrutura:**
```
packages/db/insights/
├── anthropometry.ts      (TMB, body fat)
├── workout.ts            (kcal session, volume, frequency)
├── nutrition.ts          (TDEE, balance, adherence)
├── cross.ts              (contraindications, overtraining, trajectory)
├── invalidation.ts       (event handlers)
├── orchestrator.ts       (computeAllInsights)
├── types.ts              (MemberInsights interface)
└── __tests__/            (30+ cenários MVP)
```

## Related

- Estende [ADR 0005 — RBAC com consent cross-module](0005-rbac-com-consent-cross-module.md) — consent granular
- Estende [ADR 0069 — Perfil do paciente como hub](0069-perfil-paciente-hub-operacional.md) — widgets cross-module aparecem nas abas
- Prepara [Sprint 34 Nutri-Agent](../sprints/34... nutri-agent) — IA consome insights
- Reforça regra 6 (consent cross-module obrigatório + testado no CI)
- **Escopo intra-tenant** — insights cross-module são SEMPRE intra-tenant + intra-company (regra 25 bloqueia clínico cross-company em franchise). Cruzamento entre tenants distintos requer vínculo `patient_company_links` ativo + `has_cross_tenant_access()` (regra 42 + [ADR 0077](0077-passaporte-paciente-vinculo-cross-tenant.md)) + audit em `patient_data_access_log` — fora do escopo deste ADR.
- Fontes: Compendium of Physical Activities 2024 (Ainsworth et al.), Mifflin-St Jeor equation (1990), Harris-Benedict revised (Roza & Shizgal 1984), Katch-McArdle formula (1983), Oswestry Disability Index, Compendium of Drug-Drug Interactions (farmacologia)
