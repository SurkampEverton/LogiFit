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

## Gate funcional (regra 28 + ADR 0053)

Para cada feature classificada **Classe II ou superior**:

1. `ai_feature_classifications.requires_committee = true`
2. Wrapper `withAiClassGate(featureKey, fn)` consulta `ai_committee_members` do tenant
3. Sem ao menos **1 membro ativo + ata anexada** → feature **não executa em produção** (mesmo com flag ON)
4. Toda chamada grava `ai_audit_log` com `samd_class`, `committee_validated_at`, decisão humana

## Notificação ANVISA (RDC 657/2022 art. 3º)

Para features Classe II:
- LogiFit (operadora SaaS) atua como **distribuidor** do software clínico
- **Notificação simples** via portal ANVISA antes de ativar em produção
- Documentação técnica + classificação + procedimento de gestão de riscos (ISO 14971)
- LogiFit mantém `docs/compliance/anvisa-notifications/` com cópia das notificações + protocolos
- Tenant cliente continua sendo o **estabelecimento de saúde** responsável pelo uso clínico

## Histórico de mudanças

| Data | Mudança | Aprovado por |
|---|---|---|
| 2026-04-25 | Documento criado (stub inicial) | Fundador |
