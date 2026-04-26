# Classificação SaMD por feature LogiFit

> Tabela viva de classificação de cada feature de IA conforme **CFM 2.454/2026** + **ANVISA RDC 657/2022 + 751/2022** (Software as Medical Device). Base para gate `requires_committee` (regra 28) e decisão de notificação ANVISA.
> Atualizada **a cada nova feature de IA** ou mudança substancial. Sincronizada com tabela `ai_feature_classifications` no banco (Sprint 01b).

- **Última atualização:** 2026-04-25
- **Próxima revisão obrigatória:** 2026-10-25 (semestral) ou ao adicionar feature IA classe II+

## Critérios de classificação (RDC 657/2022)

| Classe | Risco | Critério |
|---|---|---|
| **I** | Baixo | Informação geral; sem impacto em decisão clínica individual |
| **II** | Moderado | Apoio à decisão clínica com supervisão humana obrigatória |
| **III** | Alto | Decisão clínica direta sobre paciente individual sem supervisão imediata |
| **IV** | Crítico | Suporte à vida ou diagnóstico de doença grave |

**Política LogiFit:** evitar Classe III e IV por design. Toda IA opera Classe I (info) ou Classe II (apoio com humano sempre no loop). Classe III/IV exigiria registro pleno ANVISA + responsabilidade médica direta.

## Features ativas/planejadas

| Feature | Sprint | Classe SaMD | Notificação ANVISA | Comitê IA exigido | ADR |
|---|---|---|---|---|---|
| Copilot chat ancorado em member | 06 | I | Não | Opcional | [0064](../decisions/0064-ia-arquitetura-gemini-default-byok-rag.md) + [0075](../decisions/0075-assistente-ia-universal-tres-camadas-tool-registry.md) |
| Classificador anti-prescrição (guardrail) | 06 | I (proteção, não decisão) | Não | Não | [0053](../decisions/0053-conformidade-cfm-2454-2026-ia-saude.md) |
| Régua declarativa (cobrança/engajamento) | 13 | I (operacional) | Não | Não | — |
| Sugestão CID por descrição clínica | 06/20 | II (apoio decisão) | Sim | **Sim** | [0053](../decisions/0053-conformidade-cfm-2454-2026-ia-saude.md) |
| Previsão de churn (operacional) | 19 | I | Não | Não | — |
| SOAP automático pós-teleconsulta (rascunho) | 31 | II (rascunho com revisão obrigatória) | Sim | **Sim** | — |
| Pipeline Exames — extração OCR + analitos | 33 | I (extração estruturada, sem decisão) | Não | Não | [0050](../decisions/0050-pipeline-exames-laboratoriais.md) |
| Pipeline Exames — interpretação conservadora | 33 | II (apoio decisão clínica) | Sim | **Sim** | [0050](../decisions/0050-pipeline-exames-laboratoriais.md) |
| Nutri-Agent IA cruzando módulos | 34 | II (apoio decisão clínica) | Sim | **Sim** | (ADR 0043 esperado) |
| Prescrição adaptativa por RPE | pós-35 | II (ajuste de carga com supervisão) | Sim | **Sim** | (a produzir) |
| Cross-alert lesão→treino | 27 | II (alerta clínico operacional) | Sim | **Sim** | [0070](../decisions/0070-insights-cross-module-timeline-integrada.md) |
| Generative UI fisio (componentes gerados por LLM) | 28 | I (UI estruturada via tools tipadas Zod; sem decisão clínica direta — apenas apresentação) | Não | Não | (ADR 0034 esperado) |
| Modo Coach mobile-first PWA | (ADR 0074) | I se só sugere lembretes/treinos (apoio motivacional) — **revisar para II se ganhar prescrição adaptativa por feedback do member** | Condicional (II → sim) | Condicional (II → sim) | [0074](../decisions/0074-modo-coach-mobile-first-pwa.md) |

## Gate funcional (regra 28 + ADR 0053)

Para cada feature classificada **Classe II ou superior**:

1. `ai_feature_classifications.requires_committee = true`
2. Wrapper `withAiClassGate(featureKey, fn)` consulta `ai_committee_members` do tenant
3. Sem ao menos **1 membro ativo + ata anexada** → feature **não executa em produção** (mesmo com flag ON)
4. Toda chamada grava `ai_audit_log` com `samd_class`, `committee_validated_at`, decisão humana

## Notificação ANVISA (RDC 657/2022 art. 3º) — procedimento operacional

Para features Classe II:
- LogiFit (operadora SaaS) atua como **distribuidor** do software clínico
- **Notificação simples** via portal ANVISA **antes** de ativar em produção (feature flag obrigatoriamente OFF até protocolo emitido)
- Documentação técnica + classificação + procedimento de gestão de riscos (ISO 14971)
- LogiFit mantém [`docs/compliance/anvisa-notifications/`](anvisa-notifications/) com cópia das notificações + protocolos
- Tenant cliente continua sendo o **estabelecimento de saúde** responsável pelo uso clínico

### Quando notificar (gatilho)

| Situação | Ação | Prazo |
|---|---|---|
| Nova feature Classe II identificada (em sprint) | Iniciar preparação da notificação **no início do sprint** | T-zero |
| Mudança substancial em feature já notificada (modelo IA novo, escopo expandido) | Atualizar notificação existente | Antes de deploy em produção |
| Recall obrigatório (incidente de segurança clínica relevante) | Comunicação à ANVISA + retirada da feature | 72h (alinhado RDC 67/2009) |
| Renovação periódica | Confirmação anual de que a notificação continua vigente | Calendar Q1 |

### Quem é responsável

- **DPO LogiFit** (fundador no MVP, ver [dpo.md](dpo.md)) — responsável pela submissão e correspondência com ANVISA
- **Tech Lead** (fundador no MVP) — responsável pela documentação técnica (descrição da feature, modelo IA, validação, gestão de riscos)
- **Comitê IA do tenant** (regra 28) — responsável pela aplicação clínica e supervisão humana no contexto do tenant

### Documento técnico mínimo (anexo da notificação)

Cada notificação ANVISA acompanha um documento técnico padronizado em [`docs/compliance/anvisa-notifications/_template.md`](anvisa-notifications/_template.md) cobrindo:

1. **Identificação da feature**
   - Nome comercial + nome técnico (key da feature)
   - Sprint que entrega + ADR de referência
   - Versão do software (semver)
2. **Classificação SaMD** (Classe II justificada — apoio à decisão clínica com supervisão humana)
3. **Descrição funcional**
   - Caso de uso clínico pretendido
   - Profissional-alvo (médico/fisio/nutri/personal)
   - Tipo de paciente (adulto/criança/gestante — restrições de aplicabilidade)
   - Output da feature (tipo de saída + formato)
4. **Modelo de IA**
   - Provider (Vertex AI / OpenAI BYOK / etc)
   - Modelo específico (Gemini 2.5 Flash / GPT-4o / etc)
   - Limitações documentadas pelo provider
5. **Gestão de riscos (ISO 14971)**
   - Riscos identificados + probabilidade × severidade
   - Mitigações técnicas (gate Comitê IA, classifier anti-prescrição, supervisão humana bloqueante)
   - Riscos residuais aceitos
6. **Evidências de validação**
   - Dataset de validação (sintético + retrospectivo se houver)
   - Métricas (acurácia, sensibilidade, especificidade, F1)
   - Auditoria de viés (fairness por raça/sexo/idade quando aplicável)
7. **Plano de monitoramento pós-mercado**
   - `ai_audit_log` — telemetria de uso
   - Auditoria trimestral interna de viés
   - Canal de reporte de incidentes (`privacidade@logifit.com.br`)
8. **Rotulagem (instruções de uso)**
   - Aviso UX obrigatório: "IA é apoio à decisão; responsabilidade é do profissional"
   - Indicação clara da Classe II + número do protocolo ANVISA

### Fluxo de submissão

```
1. Sprint detalhada → identifica feature como Classe II
2. Tech Lead preenche documento técnico (template)
3. DPO revisa + assina
4. Submissão portal ANVISA (sistema PEC ou Solicita)
5. Aguardar protocolo (geralmente 30-60 dias para notificação simples)
6. Protocolo recebido → arquivo em docs/compliance/anvisa-notifications/{ano}/{feature}-{protocolo}.md
7. Feature flag pode ser ativado em produção
8. Comunicação ao Comitê IA do primeiro tenant a ativar
```

### Gatilhos & SLA por classe

> Esclarece quem dispara o procedimento, em qual evento, e em que prazo a feature pode ir live.

| Classe | Evento gatilho | Quem detecta / dispara | SLA até feature ir live | Bloqueio em caso de descumprimento |
|---|---|---|---|---|
| **I** (baixo risco — calculadora, sumarizador sem prescrição) | Merge de PR que adiciona linha em `ai_feature_classifications (class='I')` | Tech Lead via review obrigatório de PRs com label `ai-feature` | **D+0** — apenas registro em `samd-classification.md` + tabela; sem submissão ANVISA | Lint CI `samd-class-required` se feature IA novo é mergeada sem entrada na tabela |
| **II** (apoio à decisão — copilot clínico, sugestão de exercício, pipeline de exames) | Merge de PR que adiciona ou eleva para `class='II'` + flag `requires_anvisa_notification=true` | Tech Lead detecta no review; DPO recebe alerta `system_alerts critical` (canal slack/email) | **D+30** mínimo (notificação ANVISA simples 30-60d) — feature flag fica `disabled` em produção até protocolo arquivado em `anvisa-notifications/{ano}/`. Comitê IA do tenant precisa estar ativo para flag ligar (regra 28) | CI `feature-flag-blocked-without-anvisa-protocol` — bloqueia merge para `main` se flag está `enabled=true` em config sem protocolo correspondente |
| **III/IV** (alto risco — diagnóstico autônomo, decisão clínica sem revisão humana) | **Não permitido por design no LogiFit.** Qualquer PR que tente classificar feature como III/IV exige ADR de exceção + revisão jurídica externa | Lint CI bloqueia automaticamente | N/A | Hard block; revogar tentativa |
| **Mudança de classe (I→II)** | Quando feature cresce em escopo (ex: copilot ganha sugestão prescritiva) — Tech Lead atualiza linha em `ai_feature_classifications` | Tech Lead + Comitê IA tenant que primeiro detectar | **D+30** — feature flag desabilita automaticamente até nova notificação | Trigger SQL `prevent_class_downgrade_without_adr` |
| **Recall** (incidente clínico relevante) | Detecção via `ai_audit_log` ou reporte externo | DPO + Tech Lead + Comitê IA | **72h** para comunicar ANVISA + retirar feature (RDC 67/2009) | Runbook [`incidente-lgpd-72h.md`](../runbooks/incidente-lgpd-72h.md) + RIPD afetado revisado |
| **Renovação anual** | Calendar Q1 | DPO | **D+30** após Q1 — confirmar todas notificações vigentes em portal ANVISA | Auditoria interna trimestral (ADR 0067) flagga lapso |

**Fonte da verdade:** tabela `ai_feature_classifications (feature_key, class, requires_anvisa_notification, requires_committee, anvisa_protocol, classified_at, classified_by)` (Sprint 01b). Este documento é o reflexo humano-legível; em divergência, a tabela vence e o documento é atualizado em D+1.

**Linkagem com RIPDs:** RIPDs de features classe II+ ([`v1.0-exames-laboratoriais.md`](ripd/v1.0-exames-laboratoriais.md), [`v1.0-nutri-plano.md`](ripd/v1.0-nutri-plano.md), [`v0.1-ia-copilot-clinico.md`](ripd/v0.1-ia-copilot-clinico.md)) referenciam este SLA na seção "Próximos passos antes de v1.0" — o pendência ANVISA é gate explícito para promoção a v1.0.

### Repositório local

Estrutura em [`docs/compliance/anvisa-notifications/`](anvisa-notifications/):
- `_template.md` — template canônico (já existente, a expandir)
- `{ano}/{feature-key}-{protocolo}.md` — uma notificação por feature/versão
- `_index.md` — índice de todas as notificações vigentes (a criar quando primeira for emitida)

### Riscos do não-cumprimento

- **Operação SaMD sem notificação:** infração sanitária — multa + interdição da feature pela ANVISA
- **Tenant clínico que ativa sem notificação:** tenant também responde solidariamente como estabelecimento de saúde
- **Reputacional:** publicação no DOU em caso de auto-de-infração

## Histórico de mudanças

| Data | Mudança | Aprovado por |
|---|---|---|
| 2026-04-25 | Documento criado (stub inicial) | Fundador |
