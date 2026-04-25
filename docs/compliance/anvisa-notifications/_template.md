# Notificação ANVISA — {{Feature de IA Classe II/III}}

> Template de notificação ANVISA para SaMD (Software as Medical Device) Classe II ou superior, conforme **RDC 657/2022** (notificação) ou **RDC 751/2022** (registro pleno Classe III/IV — LogiFit evita por design).
> Copie para `docs/compliance/anvisa-notifications/{{YYYY-MM}}-{{slug}}.md`, preencha, anexe protocolo ANVISA + decisão técnica.

- **Feature:** {{nome — ex: Pipeline Exames IA — interpretação}}
- **Classe SaMD:** {{II}}
- **Sprint que entrega:** {{ex: Sprint 33}}
- **ADR de referência:** {{ex: ADR 0050}}
- **Status notificação:** {{rascunho / submetida / em análise / aprovada / observações ANVISA}}
- **Data submissão:** {{YYYY-MM-DD}}
- **Protocolo ANVISA:** {{número}}
- **Próxima revisão obrigatória:** {{YYYY-MM-DD}} (anual ou em mudança substancial — ISO 14971 pós-mercado)

## 1. Identificação do produto SaMD

- **Nome comercial:** LogiFit — {{Feature}}
- **Versão:** {{vX.Y.Z do release}}
- **Classificação SaMD (RDC 657/2022 art. 4º):**
  - **Significância da informação:** {{informação para tratar uma condição / informação para conduzir paciente em condição séria}}
  - **Estado da condição de saúde:** {{não-séria / séria / crítica}}
  - **Resultado:** **Classe {{I/II/III/IV}}**
- **Não é dispositivo Classe III/IV** (LogiFit evita por design — ver [docs/compliance/samd-classification.md](../samd-classification.md))

## 2. Descrição funcional

{{Como a feature opera, qual decisão clínica apoia, como a saída é apresentada ao profissional, como humano sempre tem decisão final.}}

Exemplo (Pipeline Exames):
> Sistema recebe upload de PDF/imagem de exame laboratorial → OCR extrai analitos estruturados (hemograma, lipídico, glicêmico) → IA generativa (Gemini 2.5 Flash via Vertex AI) sugere padrões compatíveis com referências clínicas, **sem nunca emitir diagnóstico** (classificador de output bloqueia termos proibidos: "diagnóstico de", "tem [doença]") → profissional revisa lado-a-lado → publica em `lab_results` oficial somente após aceite humano.

## 3. Limitações e contraindicações

- Sistema **NÃO** substitui avaliação clínica completa
- Sistema **NÃO** emite diagnóstico — apenas sugere padrões compatíveis
- Sistema **NÃO** prescreve medicamentos
- Sistema **NÃO** adapta dosagem
- Saídas exigem revisão humana antes de virar dado oficial em prontuário
- Profissional executor é responsável final pela decisão clínica (CFM 2.454/2026)

## 4. Gestão de riscos (ISO 14971)

| Risco identificado | Severidade | Probabilidade | Mitigação | Risco residual aceito |
|---|---|---|---|---|
| {{ex: IA sugere padrão incorreto e profissional aceita sem revisar}} | alto | baixa | Disclaimer fixo + classificador output + revisão humana obrigatória + ai_audit_log com decisão humana | aceitável |
| {{ex: vazamento de dado clínico via prompt engineering ataque}} | alto | baixa | PII redaction antes do LLM + anti-prompt-injection + Vertex AI SP (BR) | aceitável |
| {{ex: IA viesa por dado de treinamento de outra etnia}} | médio | média | Comitê IA monitora viés trimestral via amostragem; tenant pode desabilitar IA mantendo OCR humano | aceitável com monitoramento |

## 5. Validação clínica

- **Estudo de validação:** {{descrever metodologia, n amostras, sensibilidade/especificidade vs padrão-ouro}}
- **Provedor de validação:** {{LogiFit interno / parceiro acadêmico / hospital piloto}}
- **Data:** {{YYYY-MM-DD}}
- **Resultados:** {{anexar relatório ou link interno}}

## 6. Pós-mercado (ISO 14971 + RDC 657)

- **Monitoramento:** `ai_audit_log` captura input/output/decisão humana — análise mensal de divergência entre sugestão IA e decisão final humana
- **Gatilho de revisão:** taxa de "rejeitado pelo humano" > 30% → suspender feature + investigar
- **Reporte de incidente:** evento adverso reportado em até 72h à ANVISA via portal
- **Comitê de IA do tenant** (regra 28) atua como ponto focal local

## 7. Responsabilidades

- **LogiFit (distribuidor SaaS):** classificação SaMD, notificação ANVISA, gestão de riscos no software, classificador output, audit log, supervisão pós-mercado
- **Tenant (estabelecimento de saúde — controlador clínico):** uso clínico responsável, supervisão humana profissional, Comitê de IA local, ata de revisão
- **Profissional executor (CRM/CREFITO/CRN/CREF):** decisão clínica final, conforme regulamentação do conselho

## 8. Anexos obrigatórios

- [ ] Manual técnico (versão pública resumida)
- [ ] Análise de risco completa (ISO 14971)
- [ ] Relatório de validação clínica
- [ ] Política de pós-mercado
- [ ] Política de privacidade (link `logifit.com.br/privacidade`)
- [ ] DPA com sub-processadores envolvidos (Google Vertex AI, Groq se aplicável) — ver [ADR 0067](../decisions/0067-dpo-governanca-compliance-lgpd.md)

## 9. Histórico de mudanças

| Versão | Data | Mudança | Aprovado por |
|---|---|---|---|
| v1.0 | {{YYYY-MM-DD}} | Notificação inicial | {{nome}} |

## 10. Referências

- [RDC ANVISA 657/2022 — SaMD notificação](https://www.gov.br/anvisa)
- [RDC ANVISA 751/2022 — registro pleno (não usado)](https://www.gov.br/anvisa)
- [CFM 2.454/2026 — IA em medicina](https://portal.cfm.org.br)
- [ISO 14971 — Risk management for medical devices]
- [ADR 0053 — Conformidade CFM 2.454/2026](../../decisions/0053-conformidade-cfm-2454-2026-ia-saude.md)
- [docs/compliance/samd-classification.md](../samd-classification.md)
