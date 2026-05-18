---
slug: cross-alert-cid-contraindicacao
status: proposed
date: 2026-05-18
---

# ADR 0084 — Mapeamento CID → contraindicação de exercício (Cross-alert lesão Fisio → Academia)

## Contexto

Sprint 27 entrega o primeiro **cross-alert real do produto**: quando uma lesão é registrada no prontuário Fisio (CID actionable) de um paciente que também é aluno da Academia, o sistema deve sugerir adaptação automática da ficha de treino — respeitando consent, franchise (regra 25) e supervisão humana.

Decisões fundamentais que este ADR fecha:

1. **Como mapear CID → exercício contraindicado** — IA infere em runtime, tabela curada, ou ambos?
2. **Granularidade do mapeamento** — exercício específico, grupo muscular, padrão de movimento?
3. **Severidade** — escala canônica para classificar a contraindicação
4. **Catálogo global vs override per tenant** — quem decide o que é contraindicado?
5. **Autonomia** — adaptação automática ou só sugere e instrutor confirma?
6. **Quais CIDs são "actionable"** — todo CID dispara? Como filtrar?

## Decisão

### 1. Tabela curada `cid_exercise_contraindications` (catálogo global) + tenant override

Optamos por **tabela curada pela LogiFit** (~200 mapeamentos canônicos curados a partir de COFFITO 414/2012, ACSM 2023 e literatura clínica) com possibilidade de cada tenant adicionar overrides locais.

**Por quê não IA generativa em runtime** (rejeitado):
- Comportamento clínico precisa ser **determinístico e auditável** (regra 28 CFM 2.454/2026 — toda decisão IA clínica grava `ai_audit_log`)
- Curadoria estatística > inferência estocástica para regras conhecidas há décadas
- Custo + latência (Gemini Flash chamada por CID por item = $$$ + 200ms/item)
- Pode complementar (Sprint 27c stretch — IA infere quando catálogo não tem cobertura), mas não substitui

**Por quê suportar tenant override:**
- Clínica especializada (ortopédica desportiva) tem protocolos específicos
- Profissional sênior local quer endurecer (`caution` → `modify`) ou flexibilizar com justificativa
- RLS policy permite SELECT em ambos (global + tenant); INSERT/UPDATE só na linha do tenant; curadoria global vai por `platform_admin` direto no banco (mesmo padrão Sprint 11 exercises globais)

### 2. Granularidade de **3 níveis** (precedência exercise_id > movement_pattern > muscle_group)

Cada regra alvo é declarado em **pelo menos um** dos três:

- **`exercise_id`** — mais preciso (ex: "agachamento livre com barra"); usado quando equipamento e técnica importam para a contraindicação
- **`movement_pattern`** — intermediário (ex: `flexao_lombar_carga`, `agachamento_profundo`); cobre família de movimentos similares com cargas axiais perigosas
- **`muscle_group`** — mais amplo (ex: `lombar`, `joelho`); cobre tudo que ativa o grupo

Check constraint `cid_contra_at_least_one_target` força ≥1 dos três NOT NULL. Matcher na lib pura `detectContraindications` testa nessa ordem de precedência.

`movement_pattern` é texto livre no MVP (match exato com `exercises.metadata.movement_patterns` quando enriquecido). Sprint 27b: enum dedicado + lookup table.

### 3. Severidade canônica de **3 níveis**: `avoid` / `modify` / `caution`

- **`avoid`** — proibido durante recuperação (ex: agachamento pesado com lombalgia M30.0)
- **`modify`** — permitido com adaptação (ex: trocar barra livre por máquina guiada)
- **`caution`** — atenção redobrada, instrutor avalia em loco (ex: amplitude reduzida, monitorar dor)

**Função de agregação** `maxSeverity(a, b)` retorna a mais restritiva (ranking `avoid=3 > modify=2 > caution=1`). Quando múltiplas regras matcham o mesmo item, a severidade efetiva é a mais restritiva.

### 4. Diff `workout_adaptations.changes` jsonb canônico

Mapeamento de severidade → ação:
- `avoid` + tem alternativa → **replaced**
- `avoid` + sem alternativa → **removed**
- `modify` + tem alternativa → **replaced**
- `modify` + sem alternativa → **mantém com warning** (não vira diff; instrutor decide)
- `caution` → **mantém com warning** (não vira diff)

Formato do `changes` jsonb:

```json
{
  "removed": [{"itemId": "...", "exerciseId": "...", "exerciseName": "...", "reason": "..."}],
  "replaced": [{"fromItemId": "...", "toExerciseId": "...", "toExerciseName": "...", "rationale": "..."}],
  "added": [],
  "summary": "Substituído Agachamento Livre → Leg Press 45 (MG30.0 avoid); Removido Stiff (MG30.0 avoid, sem alternativa cadastrada)",
  "primaryCidCode": "MG30.0",
  "secondaryCidCodes": [],
  "avoidCount": 2,
  "modifyCount": 0,
  "cautionCount": 0
}
```

**Sprint 27 MVP não preenche `added`** (heurística de "exercício compensatório" para grupo muscular afetado entra em Sprint 27b/IA).

### 5. **Sempre sugere, nunca aplica direto** — instrutor confirma

Decisão consciente de autonomia limitada por dois motivos:

- **Clínico**: adaptação automática sem supervisão pode levar a erros (ex: alternativa cadastrada genérica não cabe para o aluno específico)
- **Regulatório**: regra 25 + CFM 2.454/2026 (IA classe SaMD com supervisão humana documentada) — mesmo a sugestão é classificada SaMD I (não-diagnóstica) e o agente humano é quem assina o ato

Workflow `workout_adaptations.status`:
- `suggested` (dispatcher gerou) → `confirmed` (instrutor aplicou) | `rejected` (instrutor decidiu manter original) | `manually_overridden` (instrutor editou e aplicou versão custom — Sprint 27b)
- Sprint 27c stretch: cliente pode optar (Enterprise) por `auto_apply=true` em casos `severity=modify` com alternativa registrada — exige assinatura de termo adicional de responsabilidade clínica.

### 6. Filtro de **CIDs actionable** por capítulo CID-11

Apenas CIDs dos seguintes chapters disparam cross-alert lesão na Sprint 27:

- **MG** — Sintomas musculoesqueléticos
- **FA** — Dor crônica
- **FB** — Sintomas neurológicos / partes moles
- **NB** — Lesão cabeça/pescoço/tronco
- Codes prefixados `22`, `ND`, `NE`, `NF` — capítulos de lesões (CID-11 dedica capítulo 22 a "Lesões, envenenamentos e outras consequências de causas externas")

Função pura `isActionableCid(chapter, code)` em `franchise-gate.ts`. CIDs de outras categorias (cardiovascular BD, endócrino 5A, mental MA, oncológico 2A-2F) **não** disparam cross-alert lesão — exigem fluxo dedicado:

- Cardiovascular → Sprint 27b stretch (avaliação cardiovascular pré-treino, escalas tipo PARQ)
- Endócrino → Sprint 27c (alerta nutri/médico)
- Mental → não cabe automatizar (decisão exclusivamente humana)

**MVP simplificado**: match por chapter prefix em vez de lookup table. Sprint 27b: tabela `cid_chapter_actionable` curada para refinamento.

## Esquema persistido

```ts
cid_exercise_contraindications (
  id, tenant_id?,
  cid_code FK cid_catalog,
  exercise_id? FK exercises, muscle_group?, movement_pattern?,
  severity ('avoid' | 'modify' | 'caution'),
  alternative_exercise_ids uuid[],
  rationale, source, active,
  created_at, updated_at
)
// CHECK at_least_one_target
// uniqueIndex(tenant_id, cid_code, COALESCE(exercise_id::text,''), COALESCE(muscle_group,''), COALESCE(movement_pattern,''))
// index(cid_code, active) WHERE active = true

member_injury_alerts (
  id, tenant_id, member_id,
  source_consulta_id, primary_cid_code,
  secondary_cid_codes jsonb,
  source_company_id, target_company_id,
  status ('pending_review' | 'accepted' | 'rejected' | 'expired' | 'blocked'),
  blocked_reason (text — 'regra_25_franchise_cross_company' | 'consent_missing' | 'no_active_academia_contract' | 'no_active_workout' | 'cid_not_actionable'),
  consent_id_used,
  reviewed_by_user_id, reviewed_at, rejection_reason,
  expires_at,
  created_at, updated_at
)
// CHECK blocked_requires_reason + reviewed_consistency

workout_adaptations (
  id, tenant_id, alert_id FK,
  original_workout_id, adapted_workout_id?,
  changes jsonb,
  status ('suggested' | 'confirmed' | 'rejected' | 'manually_overridden'),
  confirmed_at, confirmed_by_user_id, rejection_reason,
  created_at, updated_at
)
// uniqueIndex(alert_id) — 1:1 com alert
// CHECK confirmed_consistency
```

## Gates de regra 25 + consent

`canCrossModuleAlert()` em `franchise-gate.ts` (lib pura) avalia em ordem:

1. **Regra 25 primeiro** (regulatório CFM/COFFITO): `topology='franchise' && sourceCompanyId !== targetCompanyId` → `regra_25_franchise_cross_company` (consent não destrava)
2. **Consent** (`member_consents.cross_module_share` ativo) → `consent_missing` se faltar
3. **Contrato Academia ativo** → `no_active_academia_contract` se faltar
4. **Workout ativo** → `no_active_workout` se faltar

Cada bloqueio cria `member_injury_alerts` com `status='blocked' + blocked_reason` para audit trail completo — toda tentativa fica gravada (regra 5 audit + ADR 0067 DPO governance).

## Consequências

✅ **Positivas:**
- Determinístico e auditável (curadoria > IA estocástica em decisão clínica)
- Defesa em profundidade: regra 25 > consent > contrato > workout (cada gate é um audit point)
- Supervisão humana mandatória (Sprint 27 nunca aplica sem instrutor)
- Extensível: tenant override + IA complementar Sprint 27c stretch

⚠️ **Trade-offs aceitos:**
- Curadoria inicial trabalhosa (~200 mapeamentos canônicos a popular); Sprint 27 entrega ~35 cobrindo top patologias musculoesqueléticas; expansão progressiva em Sprint 27b/c
- `movement_pattern` text livre no MVP → match exato (pode falhar para variantes de nome); enum dedicado em Sprint 27b
- `added` (heurística de exercício compensatório) só entra em Sprint 27b/IA — MVP só `removed` + `replaced`
- Catálogo global é um vetor de erro centralizado (mapeamento errado afeta todos os tenants) — mitigação: source citado por regra + curadoria por profissional referência + override per tenant disponível
- Sem `auto_apply` no MVP — fricção do passo "instrutor confirma" é aceitável (e desejável) para v1

⚠️ **Decisões adiadas (Sprint 27b+):**
- IA complementar quando catálogo não cobre (chamada Gemini Flash com `resolveModelForTask('classification')` regra 32 — output classificado por classificador conservador + `ai_audit_log`)
- `cid_chapter_actionable` lookup table dedicada (refina filtro além de prefix match)
- `movement_pattern` enum + enriquecimento de `exercises.metadata.movement_patterns`
- `auto_apply` opcional Enterprise (com termo)
- Integração com régua Sprint 13 (notificar instrutor via WhatsApp quando `pending_review` criado)
- Cron expirar `pending_review` > 14d → `status='expired'`
- E2E completo (happy + bloqueio sem consent + bloqueio regra 25)
- Adaptação cross-prescription (Sprint 11): quando 2+ profissionais prescrevem coisas conflitantes, gera `cross_prescription_alert` que paciente vê em `/meu/privacidade/alertas-cruzados` (Sprint 26)
- `overrideAdaptation` Server Action (instrutor edita o diff antes de confirmar)
- Feature flag `cross_alert_lesao_v1`

## Alternativas consideradas

| Opção | Rejeitada por |
|---|---|
| IA generativa runtime único (sem catálogo) | Não-determinístico + custo + latência + sem audit reproducível |
| Mapping em código (constants TS) | Sem override por tenant + sem governança de versão + nada extensível |
| Severidade binária (proibido / permitido) | Perde nuance clínica (modify vs caution); literatura usa 3+ níveis |
| `auto_apply=true` por default | Risco clínico inaceitável MVP; precisa supervisão humana |
| Cross-alert sem consent (regulatório força) | Quebra LGPD art. 11 (dado sensível exige base legal explícita) |
| `member_injury_alerts` só criado se decisão é go (sem `status='blocked'`) | Perde audit trail completo; bloqueado também é evidência de governança |

## Cenário de teste E2E (Sprint 27b, planejado)

**Happy path** (`accepted`):
1. Maria é paciente fisio (company A) + aluna Academia (company A, mesmo tenant `owned`)
2. Consent `cross_module_share` ativo
3. Contrato Academia ativo + workout ativo (agachamento livre)
4. Fisio registra CID `MG30.0` (dor lombar) + assina consulta
5. `processInjuryAlert(consultaId)` cria `member_injury_alerts status='pending_review'` + `workout_adaptations status='suggested'`
6. Diff sugerido: replaced "Agachamento Livre" → "Leg Press 45° amplitude curta" (avoid + alternativa)
7. Instrutor clica "Confirmar" em `/app/treinos/adaptacao-pendente/[id]`
8. `confirmAdaptation` cria new workout (`parent_workout_id = original`) + atualiza prescription
9. Maria vê em `/meu/alertas`: "Aplicado — sua ficha foi adaptada"
10. `audit_log` registra `cross.injury_alert.process` + `cross.adaptation.confirm` com `consent_id_used`

**Bloqueio regra 25** (`blocked + regra_25_franchise_cross_company`):
1. Maria é paciente fisio (company A clínica) + aluna Academia (company B academia, mesma franquia tenant `franchise`)
2. Consent `cross_module_share` ativo (não destrava!)
3. Fisio registra CID `MG30.0` + assina
4. Dispatcher avalia: `topology='franchise' && sourceCompanyId !== targetCompanyId` → bloqueia
5. Cria `member_injury_alerts status='blocked' + blocked_reason='regra_25_franchise_cross_company'`
6. `workout_adaptations` NÃO é criado
7. Instrutor em company B nunca recebe alerta
8. Maria não vê o alert em `/meu/alertas` (filtro UI exclui blocked do paciente)
9. Gerente em `/app/cross/alertas?status=blocked` vê para audit

**Bloqueio consent_missing**:
1. Mesmo cenário happy path, mas consent revogado
2. Dispatcher: `hasConsent=false` → bloqueia
3. `status='blocked' + blocked_reason='consent_missing'`

## Status

Proposed — promove para **Accepted** quando Sprint 27b implementar testes E2E completos + integração com régua Sprint 13 + feature flag em produção piloto com ≥10 cross-alerts reais processados.

## Referências

- [Sprint 27 — Cross-alert lesão Fisio → ajuste treino Academia](../sprints/27-cross-alert-lesao-treino.md)
- [ADR 0023 — Prescrições polimórficas + versionamento workouts](0023-prescricoes-polimorficas-base.md)
- [ADR 0028 — CID-11 / CIF catálogo global](0028-cid-cif-catalogos-globais.md)
- [ADR 0053 — Conformidade CFM 2.454/2026 IA saúde](0053-conformidade-cfm-2454-2026-ia-saude.md)
- [ADR 0054 — LGPD art. 11 dados saúde](0054-lgpd-art11-dados-saude-ripd-versionado.md)
- [ADR 0077 — Passaporte cross-tenant (clínico nunca cruza CFM bruto)](0077-passaporte-paciente-vinculo-cross-tenant.md)
- [ADR 0088 — Portal member magic link (paciente vê `/meu/alertas`)](0088-portal-member-magic-link-auth.md)
- [regra 25 — clínico não cruza company em franquia](../rules.md#25-clinico-nao-cruza-company-em-franquia)
- [regra 28 — IA SaMD II+ exige Comitê IA + ai_audit_log](../rules.md#28-ia-samd-comite)
- [regra 42 — passaporte cross-tenant + cross-prescription](../rules.md#42-passaporte-cross-tenant)
- COFFITO 414/2012 + 415/2012 — Resoluções fisioterapia eletrônica
- ACSM 2023 — Guidelines for Exercise Testing and Prescription
