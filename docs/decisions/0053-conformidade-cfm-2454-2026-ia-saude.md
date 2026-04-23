# ADR 0053 — Conformidade CFM 2.454/2026 (IA em medicina) + classificação SaMD por feature

- **Status:** Accepted
- **Date:** 2026-04-23

## Context

A **Resolução CFM 2.454/2026** (publicada em 11/02/2026, vigência agosto/2026) estabelece o marco regulatório específico de **Inteligência Artificial na Medicina** no Brasil. Vigência efetiva com prazo de 180 dias de adequação — ou seja, **instituições que usam IA em contexto clínico têm até agosto/2026 para cumprir**.

LogiFit tem features de IA planejadas em múltiplos sprints:

- **Sprint 06** — Copilot (chat ancorado em member)
- **Sprint 19** — Previsão de churn
- **Sprint 13** — WhatsApp inbound com classificador IA (ADR 0051)
- **Sprint 28** — Generative UI clínica Fisio
- **Sprint 32** — Device Hub (classificação de alertas)
- **Sprint 33** — Pipeline Inteligente de Exames Laboratoriais (OCR + extração + interpretação)
- **Sprint 34** — Nutri-Agent cruzando dados

Sem ADR explícito, LogiFit entra em risco regulatório assim que qualquer cliente da vertical Fisio ou que trate com médico usar IA em contexto clínico.

Além da CFM 2.454/2026, aplicam-se:

- **ANVISA RDC 657/2022** — Software as Medical Device (SaMD) — classes I/II (baixo risco) exigem notificação; III/IV (alto risco) exigem registro pleno
- **ANVISA RDC 751/2022** — classificação de risco, rotulagem, instruções de uso
- **PL 2338/2023** — Marco Civil da IA Brasil, em tramitação (Senado aprovou 2024; Câmara adiada para fev/2026) — prevê classificação de risco similar à AI Act europeia

Fontes:
- [CFM 2.454/2026 — Mattos Filho](https://www.mattosfilho.com.br/unico/cfm-ia-medicina/)
- [Conjur: o que fazer até agosto/2026](https://www.conjur.com.br/2026-mar-30/ia-na-saude-o-que-hospitais-e-clinicas-precisam-fazer-ate-agosto-com-a-resolucao-cfm-2-454-2026/)
- [RDC 657/2022 SaMD — Vera Rosas](https://www.verarosas.com.br/noticias/rdc-657-2022-regularizacao-de-software-como-dispositivo-medico-samd)
- [ANVISA Manual Regularização 2025](https://inovide.com.br/2025/10/24/nova-versao-do-manual-para-regularizacao-de-equipamentos-medicos-e-software-medico-na-anvisa/)
- [PL 2338 votação adiada 2026 — Desinformante](https://desinformante.com.br/votacao-do-marco-da-ia-fica-para-2026-em-meio-a-impasses-politicos-e-criticas-ao-texto)

## Decision

Instituir **três pilares de conformidade** que todas as features IA do LogiFit devem cumprir antes do release:

### Pilar 1 — Classificação SaMD por feature

Cada feature IA é classificada conforme RDC 657/2022 + 751/2022:

| Classe | Risco | Exemplo LogiFit | Ação regulatória |
|---|---|---|---|
| **Classe I** (muito baixo) | Informativo puro | Copilot respondendo "qual o próximo agendamento de Maria?" | Sem registro ANVISA obrigatório |
| **Classe II** (baixo-moderado) | Suporte de decisão | Pipeline exames IA sugerindo "LDL elevado compatível com perfil aterogênico" | **Notificação ANVISA** |
| **Classe III** (alto) | Diagnóstico assistido | Classificar imagem de raio-X com probabilidade de fratura | **Registro pleno ANVISA** |
| **Classe IV** (muito alto) | Decisão autônoma | Não aplicável ao LogiFit (por princípio, IA nunca decide sem humano) | Evitar |

**Classificação formal por feature** fica em `docs/compliance/samd-classification.md` (a criar no Sprint 00) — tabela viva atualizada a cada sprint de IA.

### Pilar 2 — Supervisão humana documentada (CFM 2.454/2026)

Toda feature IA em contexto clínico precisa:

1. **Log de supervisão humana** — quem revisou, quando, qual decisão tomou (aceitou/editou/rejeitou sugestão IA)
2. **Transparência ao paciente** — aviso explícito quando IA está envolvida ("esta análise foi assistida por IA, revisada por Dr. X")
3. **Classificação de risco pela própria feature** — exposta na UI do profissional
4. **Validação antes de persistir em histórico oficial** — IA gera draft; profissional valida (padrão já adotado em Sprint 33)
5. **Auditoria imutável** — entradas em `ai_audit_log` append-only com payload de input, output, decisão humana, modelo usado, versão do prompt

### Pilar 3 — Comitê de IA interno (obrigatório CFM 2.454/2026)

Toda instituição-cliente (tenant) que usa IA em contexto clínico precisa ter Comitê de IA. **LogiFit suporta isso como módulo**:

- Tabela `ai_committee_members (tenant_id, user_id, role_in_committee, started_at)` — seed com pelo menos 1 membro obrigatório quando tenant ativa feature IA clínica
- UI `/app/settings/compliance/comite-ia` — admin cadastra membros, anexa ata de criação, registra revisões periódicas
- Dashboard `/app/compliance/ia` — mostra features IA ativas + classe SaMD + última revisão do comitê + log de decisões
- **Gate em feature flag**: feature IA classe II+ **não ativa** sem comitê cadastrado + ata anexada

### Vocabulário proibido (IA nunca diagnostica)

Já reforçado em ADR 0015 e Sprint 33. Consolidado aqui:

- **Proibido**: "diagnóstico de", "tem [doença]", "apresenta [condição patológica]", "prescrever", "tratamento é", "paciente deve tomar"
- **Permitido**: "sugere", "compatível com", "pode indicar", "considerar avaliação profissional de", "recomenda-se validar com"
- Classificador de output ativo em cada chamada IA clínica (implementação no Sprint 33, expansão no 0053)

### Classificação inicial das features LogiFit

| Sprint | Feature | Classe SaMD | Requer comitê | Observações |
|---|---|---|---|---|
| 06 | Copilot chat ancorado member | I | Opcional | Info puro; valida com ADR 0015 |
| 13 | Classificador anexo WhatsApp | I | Opcional | Classifica tipo de documento, não faz diagnóstico |
| 19 | Previsão de churn | I | Opcional | Comercial, não clínico |
| 28 | Generative UI clínica | II | **Sim** | Renderiza sugestões clínicas |
| 32 | Device Hub alertas | II | **Sim** (quando alerta for clínico: "HR elevado 3 dias") | Limítrofe; gate profissional |
| 33 | Pipeline Exames IA | **II** | **Sim (obrigatório)** | Interpretação de laudo = suporte decisão clínica |
| 34 | Nutri-Agent | II | **Sim** | Sugere ajuste alimentar com contexto clínico |

### Gate em cada sprint de IA

Cada sprint de IA ganha item no Commit checklist:

```
- [ ] Feature classificada em docs/compliance/samd-classification.md
- [ ] Log de supervisão humana implementado (ai_audit_log)
- [ ] Aviso ao paciente documentado na UI quando aplicável
- [ ] Feature flag bloqueia ativação se tenant não tem comitê (quando classe II+)
- [ ] Classificador de output ativo (vocabulário proibido bloqueado)
- [ ] Teste adversarial (10+ prompts que tentam burlar guardrails)
- [ ] Teste E2E valida que histórico oficial só recebe dado validado por humano
```

## Consequences

### Positivas

- **Conformidade regulatória antes do deadline** — LogiFit entra no mercado já preparado, diferente de concorrentes que vão correr em agosto/2026
- **Argumento comercial forte** — "LogiFit é o único ERP de saúde BR IA-conformes desde o dia 1"
- **Auditabilidade nativa** — ANPD e CFM fiscalizam com facilidade (logs prontos)
- **Classificação SaMD explícita** evita registro ANVISA para features que não precisam, e obriga registro quando necessário
- **Comitê de IA como feature** — oferta cross-vertical que concorrente não tem

### Negativas (mitigáveis)

- **Overhead por sprint IA** — cada feature ganha itens no Commit checklist; aumenta ~4-6h por sprint
- **Tenant pequeno resistente** — obrigar Comitê de IA em clínica de 1 profissional é burocrático; solução: comitê pode ser "unipessoal" se for o único profissional, com nota jurídica explícita
- **Classe III features** (se surgirem) exigem registro ANVISA pleno — custo alto (~R$ 50-100k + tempo); LogiFit **evita** Classe III no MVP e Fase 2/3 por design
- **Atualização da classificação** quando regulamentação mudar — pipeline de manutenção regulatória em `docs/compliance/`

### Riscos não endereçados

- **PL 2338/2023** (Marco Civil IA) ainda em tramitação; quando virar lei pode adicionar exigências. Arquitetura atual (classificação de risco, explicabilidade, auditoria) já prepara para compliance.
- **Convergência CFM/CFN/COFFITO** — CFN e COFFITO ainda não publicaram equivalente da CFM 2.454. Quando publicarem, revisar este ADR.
- **Atualização CFM 2.454** em meses — monitorar via portal.cfm.org.br.

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Ignorar CFM 2.454 e focar só em ADR 0015 | Deadline regulatório duro agosto/2026; risco de clínicas médicas não aceitarem LogiFit |
| Registrar todas features IA como Classe III | Custo excessivo; maioria é Classe I-II |
| Adiar Comitê de IA até 1º cliente pedir | Obrigação legal; sem comitê, tenant médico não pode usar |
| Modelo local obrigatório (sem enviar a Claude) | Custo de infra absurdo; Claude com contrato Enterprise LGPD + auditoria é aceitável |

## Escopo de impacto

- **Novo arquivo** `docs/compliance/samd-classification.md` (a criar no Sprint 00)
- **Novo arquivo** `docs/compliance/cfm-2454-compliance.md` (template de compliance por feature IA)
- **modulos.md** — novo módulo transversal "Comitê de IA interno" + "Classificação SaMD"
- **Sprints 06, 13, 19, 28, 32, 33, 34** — gate no Commit checklist (itens de classificação + supervisão + comitê)
- **Sprint 01b** — tabelas `ai_committee_members`, `ai_audit_log`, `ai_feature_classifications` + permissions
- **rules.md** — regra 28 nova (proibição de ativar feature IA classe II+ sem comitê cadastrado)

## Related

- Reforça [ADR 0015 — Copilot safety] (expandido para todas features IA)
- Complementa [ADR 0050 — Pipeline Exames Laboratoriais] (classificação SaMD explícita)
- Relacionado com **ADR 0054 — LGPD art. 11** (conformidade de dados sensíveis)
- Fontes oficiais: CFM, ANVISA, ANPD, Conjur, Mattos Filho
