# Plano de submissão ANVISA — Copilot clínico (Sprint 06)

> **Status:** rascunho — plano de submissão, **não é a notificação final**. Notificação completa (template em [`_template.md`](_template.md)) será preenchida ao final da Sprint 06 com dados de validação interna.

- **Feature:** Copilot clínico (Camada 2 Insight + Camada 3 Action) — assistente IA universal LogiFit
- **Classe SaMD:** **II** (informação para conduzir paciente em condição não-crítica)
- **Sprint que entrega:** [Sprint 06](../../sprints/06-geral-copilot-base.md)
- **ADRs de referência:** [ADR 0053](../../decisions/0053-conformidade-cfm-2454-2026-ia-saude.md) · [ADR 0064](../../decisions/0064-ia-arquitetura-gemini-default-byok-rag.md) · [ADR 0075](../../decisions/0075-assistente-ia-universal-tres-camadas-tool-registry.md)
- **Status notificação:** **rascunho — submissão planejada antes do fim Sprint 06**

## Por que este plano existe

[Sprint 06](../../sprints/06-geral-copilot-base.md) entrega **primeira feature IA SaMD II** do LogiFit. Sem notificação ANVISA prévia + protocolo gerado, a feature **não pode ser ativada em prod** (regra 28 + lint `feature-flag-blocked-without-anvisa-protocol` em CI).

Tempo de submissão ANVISA: **~30-60 dias úteis**. Sprint 06 dura **5-6 semanas**. Logo: **submissão deve sair na semana 1 do Sprint 06**, em paralelo ao desenvolvimento, para que protocolo chegue antes do go-live.

## Cronograma de submissão

| Etapa | Quando | Responsável | Status |
|---|---|---|---|
| 1. Classificação SaMD final (revisão de [`samd-classification.md`](../samd-classification.md)) | **Semana -1 (pré-Sprint 06)** | DPO + fundador | pendente |
| 2. Análise de risco ISO 14971 — Copilot Camada 3 | **Semana -1** | DPO + parceiro técnico | pendente |
| 3. Manual técnico v1.0 (versão pública resumida) | **Semana 0 do Sprint 06** | Fundador | pendente |
| 4. Submissão ANVISA via portal gov.br (peticionamento eletrônico) | **Semana 1 Sprint 06** | DPO interno | pendente |
| 5. Aguardar protocolo ANVISA | **Semana 1-5 Sprint 06** | — | pendente |
| 6. Resposta a observações ANVISA (se houver) | **Semana 2-6 Sprint 06** | DPO + fundador | pendente |
| 7. Protocolo aceito + lint CI desbloqueia feature flag | **Semana 6 Sprint 06** | Fundador | pendente |
| 8. Go-live com primeiro tenant pagante | **Pós-Sprint 06** | — | pendente |

**Bloqueio explícito:** Se etapa 7 não concluir até o fim da Sprint 06, **a feature fica em flag `disabled` indefinidamente** até protocolo chegar. Não há override silencioso em prod — apenas tenant interno LogiFit em ambiente de homolog.

## Documentos a produzir (anexos da notificação)

- [ ] **Manual técnico v1.0** — descrição funcional, limitações, contraindicações
- [ ] **Análise de risco ISO 14971** — matriz de risco com mitigações
- [ ] **Relatório de validação clínica** — metodologia + n amostras + métricas (sensibilidade/especificidade onde aplicável)
- [ ] **Política de pós-mercado** — como `ai_audit_log` será analisado mensalmente
- [ ] **Política de privacidade pública** — `logifit.com.br/privacidade` (também a publicar Sprint 00)
- [ ] **Lista de sub-processadores IA** — link para [`docs/compliance/sub-processors.md`](../sub-processors.md)
- [ ] **DPA Google Vertex AI** — anexar contrato vigente

## Validação clínica — escopo MVP

Sem hospital parceiro no MVP, validação será **interna comparativa**:

1. **Dataset:** 200 casos clínicos sintéticos cobrindo 5 cenários canônicos (Academia + Fisio + Nutri)
2. **Padrão-ouro:** decisão de profissional sênior (CRM/CREFITO/CRN — contratado externo) sobre cada caso
3. **Métrica primária:** taxa de divergência IA vs profissional sênior — meta <20%
4. **Métrica secundária:** taxa de output bloqueado pelo classificador (proibições "diagnóstico", "prescrever") — meta 0%
5. **Resultado documentado** em relatório anexo + atualizado trimestralmente em pós-mercado

Validação clínica em hospital parceiro fica como **gate Fase 2** quando primeiro Enterprise contratar.

## Riscos do plano

| Risco | Severidade | Mitigação |
|---|---|---|
| ANVISA pedir documentação adicional inesperada | Médio | Buffer de 2 semanas no fim do Sprint 06 declarado em [timeline.md](../../timeline.md) |
| Protocolo demorar >60 dias | Alto | Feature fica em flag `disabled`; lançamento M2 (1ª venda) adiado proporcionalmente |
| Validação interna mostrar >20% divergência | Crítico | Suspender Sprint 06; reavaliar arquitetura prompt/RAG; possível troca de modelo (ADR 0064 permite) |
| Mudança regulatória (RDC nova) durante Sprint 06 | Baixo | Acompanhamento ANVISA via newsletter; ADR retroativo se ocorrer |

## Próximos passos imediatos

1. **Esta semana (pré-Sprint 06):**
   - Confirmar classificação SaMD II vs III com leitura crítica de RDC 657/2022 art. 4º
   - Iniciar redação manual técnico v0.1
2. **Semana -1:**
   - Contratar revisor técnico ISO 14971 (consultor externo ~R$ 5-10k single-shot)
   - Finalizar análise de risco
3. **Semana 0:**
   - Cadastrar conta peticionamento eletrônico ANVISA (gov.br)
   - Submeter notificação

## Referências

- [Template notificação ANVISA](_template.md)
- [`docs/compliance/samd-classification.md`](../samd-classification.md) — classificação atual
- [ADR 0053 — Conformidade CFM 2.454/2026](../../decisions/0053-conformidade-cfm-2454-2026-ia-saude.md)
- [Sprint 06 — Copilot base](../../sprints/06-geral-copilot-base.md)
- [Portal Peticionamento Eletrônico ANVISA](https://www9.anvisa.gov.br/peticionamento/)
- RDC ANVISA 657/2022 — SaMD notificação
- ISO 14971 — Risk management for medical devices
