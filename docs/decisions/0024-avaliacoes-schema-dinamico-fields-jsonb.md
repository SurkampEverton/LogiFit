---
slug: avaliacoes-schema-dinamico-fields-jsonb
status: accepted
date: 2026-05-13
---

# ADR 0024 — `assessment_types.fields jsonb` como schema dinâmico de avaliações

## Contexto

Sprint 12 entrega avaliações físicas (bioimpedância, dobras, antropometria,
anamnese, escalas funcionais). O domínio tem 3 forças em tensão:

### Tensão 1: tipos múltiplos com schemas diferentes

- **Antropometria Academia**: peso, altura, 4 circunferências (cintura,
  quadril, braço, coxa)
- **Bioimpedância InBody**: peso, % gordura, massa magra, % água,
  gordura visceral, taxa metabólica medida
- **Dobras 7-pregas Pollock**: 7 medidas (tricipital, subescapular,
  supra-ilíaca, abdominal, peitoral, axilar média, coxa) + idade + sexo
- **Anamnese Academia**: questionário com perguntas abertas + múltipla
  escolha + numéricos
- **Escala EVA / Oswestry / DASH / SF-36 / Berg / TUG / WOMAC (Fisio)**:
  cada uma com 1-30 itens + scoring específico

Cada tipo tem 4-30 campos com kinds heterogêneos (numérico, texto, enum,
likert). E novos tipos surgem (Petroski, Guedes, customizado por tenant).

### Tensão 2: tipos configuráveis por tenant

LogiFit cura biblioteca global (5 + 8 escalas), mas tenant precisa criar
tipos próprios (ex: "Avaliação postural Personal Master"). Sem migration
toda vez.

### Tensão 3: cross-vertical reuso

- Academia: composição corporal + anamnese inicial
- Fisio Sprint 20: escalas funcionais + ROM/força
- Nutri Sprint 29: antropometria detalhada (4 dobras Petroski) + recordatório

Mesma estrutura "tipo + medidas serializadas" serve todas. Sem isso,
Sprint 29 teria que duplicar o módulo só pra trocar nomes de campos.

## Decisão

### `assessment_types.fields jsonb` declarativo

```sql
CREATE TABLE assessment_types (
  id uuid PRIMARY KEY,
  tenant_id uuid,                              -- NULL = biblioteca global
  name text NOT NULL,
  category assessment_category NOT NULL,
  vertical assessment_vertical,
  fields jsonb NOT NULL,                       -- ← schema declarativo
  scoring_method jsonb,                        -- ← regras de escalas
  clinical_reference text,                     -- ← citação bibliográfica
  version int NOT NULL DEFAULT 1,
  parent_type_id uuid                          -- ← versionamento
);
```

**Formato canônico de `fields`:**

```json
[
  {
    "key": "peso_kg",
    "label": "Peso",
    "kind": "number",
    "unit": "kg",
    "min": 30, "max": 250
  },
  {
    "key": "nivel_atividade",
    "label": "Nível atividade",
    "kind": "enum",
    "options": ["sedentario","leve","moderado","intenso"]
  },
  {
    "key": "eva_value",
    "label": "Intensidade dor",
    "kind": "likert",
    "min": 0, "max": 10
  }
]
```

**Kinds suportados:** `number` (com unit + min/max) / `text` (livre) /
`enum` (com options) / `likert` (numérico escala fechada com weight).

### `assessment_measurements` armazena por field_key

```sql
CREATE TABLE assessment_measurements (
  assessment_id uuid NOT NULL,
  field_key text NOT NULL,
  value_num numeric,
  value_text text,
  value_enum text,
  CHECK ((value_num IS NOT NULL) OR (value_text IS NOT NULL) OR (value_enum IS NOT NULL)),
  UNIQUE (assessment_id, field_key)
);
```

**3 colunas mutuamente exclusivas** (não JSONB único): permite índices
e queries de série temporal por field_key sem JSONB scan. `value_num`
permite GROUP BY + AVG em gráficos de evolução — barato.

### Snapshot da versão do tipo em `assessments.type_version`

```sql
CREATE TABLE assessments (
  assessment_type_id uuid NOT NULL,
  type_version int NOT NULL,  -- ← snapshot do version no momento da medição
  performed_at timestamptz NOT NULL,
  soft_deleted_at timestamptz  -- ← retenção 20a (COFFITO 415 + CFM 2.299)
);
```

Tenant edita tipo → cria nova row em `assessment_types` com `version+1` +
`parent_type_id`. Assessments antigas seguem apontando pra versão
original → leitura preserva schema histórico.

### Cálculos derivados em `assessment_calculations` cache

```sql
CREATE TABLE assessment_calculations (
  assessment_id uuid NOT NULL,
  calc_key text NOT NULL,
  value numeric NOT NULL,
  classification text,
  UNIQUE (assessment_id, calc_key)
);
```

Server Action `createAssessment` chama `@repo/db/avaliacoes/calc.ts`:
detecta combinações canônicas (peso + altura → IMC; 7 dobras + idade +
sexo → Pollock; cintura + quadril → RCQ; peso + altura + idade + sexo
→ TMB Mifflin) e popula cache. Widget perfil + gráfico de evolução leem
cache sem recalcular. **Calc keys canônicos** namespace consistente
(`imc`, `pct_gordura_pollock7`, `tmb_mifflin`, `rcq`, `massa_magra_kg`).

### Biblioteca global compartilhada cross-tenant

`assessment_types.tenant_id IS NULL` = template curado LogiFit (read-only
via RLS). INSERT/UPDATE via app-role bloqueado. Curadoria via superuser
em script de seed (`pnpm db:seed:avaliacoes`).

MVP seeda 5 tipos (Antropometria, Bioimpedância, Dobras 7 Pollock,
Anamnese Academia, EVA Fisio). Sprint 12+ adiciona 7 escalas Fisio
restantes (Oswestry, DASH, Tampa, SF-36, Berg, TUG, WOMAC) via mesmo
mecanismo.

## Consequências

### Positivas

- **Adicionar tipo = INSERT row**: zero migration. Tenant cria avaliação
  customizada via `/app/avaliacoes/tipos/new` em segundos.
- **Cross-vertical reuso garantido**: Sprint 20 Fisio + Sprint 29 Nutri
  consomem mesmo módulo, só adicionam tipos próprios.
- **Cálculos derivados sem código por tenant**: `calc.ts` detecta
  combinações canônicas via `field_key` (`peso_kg`, `dobra_tricipital`)
  e popula `assessment_calculations` automaticamente. Tenant não escreve
  código.
- **Audit + retenção sólidos**: soft-delete preserva row 20a (COFFITO
  415 + CFM 2.299 + Lei 13.787). `audit_log` via `wrapServerAction`
  registra cada leitura.
- **Particionável futuro**: `assessment_measurements` previsão >1M
  rows/ano em rede grande. Particionar por `RANGE (created_at)` mensal
  entra Sprint 12+ (regra 34 + ADR 0072) quando volume justificar.

### Negativas

- **Validação Zod dinâmica em runtime**: schema dos measurements vem do
  `fields jsonb` do tipo — não há tipo TypeScript estático que diga
  "peso_kg é number obrigatório". Server Action valida em runtime; UI
  renderiza form via switch em `kind`. Custo: tipos errados só
  detectados em runtime (vs compile-time se schemas fossem tabelas).
- **Cálculos derivados acoplados a field_key canônico**: se tenant criar
  tipo customizado e nomear `peso_corporal_kg` em vez de `peso_kg`, IMC
  não calcula. Mitigação: documentar conjunto canônico de field_keys
  reconhecidos. UI futura pode mapear via dropdown "este campo
  representa: peso/altura/...".
- **JSONB perde validação SQL nativa**: schema dos fields não tem CHECK
  constraint. Server Action faz validação Zod no INSERT. Trade aceito
  pela flexibilidade.

### Alternativas consideradas

1. **Tabela por tipo** (`bioimpedance_assessments`,
   `skinfold_assessments`, ...). Rejeitada: explode N tabelas conforme
   tipos surgem; migration por cada novo tipo; cross-vertical reuso
   inviável; tenant não cria tipo customizado sem migration.
2. **EAV (Entity-Attribute-Value) puro**: 1 tabela `attributes` + 1
   tabela `attribute_values`. Rejeitada: query lenta (N self-joins por
   leitura), perde tipagem por kind, validação inviável.
3. **JSONB único em `assessments.measurements`** (sem `assessment_measurements`).
   Rejeitada: perde unique constraint por field_key, perde índices por
   field_key (gráfico de evolução vira JSONB scan), audit fica em 1
   blob opaco.
4. **Postgres polymorphic types** (`hstore`, custom types per type).
   Rejeitada: portabilidade ruim, tooling fraco, mesma fragmentação da
   alternativa 1.

## Status

Accepted (Sprint 12 Faixa D, 2026-05-13).

## Referências

- Sprint 12 [`docs/sprints/12-geral-avaliacoes-fisicas.md`](../sprints/12-geral-avaliacoes-fisicas.md)
- Regra 7 (Zod dinâmico no boundary — Server Action valida fields contra `assessment_types.fields jsonb`)
- Regra 29 + [ADR 0054](0054-lgpd-art11-dados-saude-ripd-versionado.md) — dado de saúde, audit + RIPD obrigatórios pra ativação clínica
- Regra 33 + [ADR 0071](0071-sistema-tratamento-erros-alertas-tempo-real.md) — `wrapServerAction` envelope + audit_log
- Regra 34 + [ADR 0072](0072-escalabilidade-banco-particionamento-retencao-cold-storage.md) — particionamento `assessment_measurements` Sprint 12+ quando volume justificar
- [ADR 0070](0070-cache-member-insights-mev-kcal.md) — `assessment_calculations` cache de derivados (IMC, Pollock, TMB, RCQ) consumido por widget + gráficos
- [ADR 0011](0011-member-perfil-unico-cross-module.md) — member como perfil único cross-module; avaliações decoram o member
- [ADR 0023](0023-prescricoes-polimorficas-base.md) — `prescriptions` polimórfico (mesmo padrão de "tipo + dados específicos" em outro domínio)
- Sprint 34 (Device Hub) — `assessment_measurements.source` + `source_device_reading_id` pré-cabeados; trigger valida quando source='device' aterrissar
