# DPO LogiFit (Encarregado pelo Tratamento de Dados Pessoais)

> Documento formal de nomeação do Encarregado, conforme **LGPD art. 41** (Lei 13.709/2018) + **Resolução ANPD nº 18/2024** (Encarregado).

## DPO atual (papel interino — fase MVP)

- **Nome:** Everton Surkamp Pereira
- **CPF:** (mantido off-line por privacidade; disponível mediante contrato com tenant ou autoridade)
- **Cargo na LogiFit:** Fundador / CTO
- **Email do canal oficial:** `privacidade@logifit.com.br`
- **Telefone do canal oficial:** (a configurar quando primeiro tenant pagante assinar)
- **Data de nomeação:** 2026-04-25
- **Vigência:** até **50 tenants pagantes** OU **1º tenant hospital/Enterprise**, o que ocorrer primeiro
- **Próxima revisão obrigatória:** 2026-10-25 (semestral)

### Atribuições (LGPD art. 41 §2º)

1. **Aceitar reclamações e comunicações dos titulares**, prestar esclarecimentos e adotar providências
2. **Receber comunicações da ANPD** e adotar providências
3. **Orientar funcionários e contratados** sobre as práticas a serem tomadas em relação à proteção de dados
4. **Executar demais atribuições** determinadas pelo controlador ou estabelecidas em normas complementares

## Compromissos operacionais

| Compromisso | SLA | Como cumprir |
|---|---|---|
| Resposta a titular (LGPD art. 18) | 15 dias | Portal `/meu/privacidade` (Sprint 26) + email `privacidade@logifit.com.br` |
| Notificação de incidente à ANPD | 72 horas | Plano de resposta documentado em [ADR 0067](../decisions/0067-dpo-governanca-compliance-lgpd.md) + tabela `security_incidents` |
| Atualização de RIPDs (Relatório de Impacto à Proteção de Dados) | Semestral | `docs/compliance/ripd/` versionado em git |
| Revisão da lista de sub-processadores | Quando muda + 30d aviso a tenants pagantes | `logifit.com.br/sub-processors` + lista canônica em [ADR 0067](../decisions/0067-dpo-governanca-compliance-lgpd.md) |
| Auditoria interna de compliance | Trimestral | Checklist documentado em [ADR 0067](../decisions/0067-dpo-governanca-compliance-lgpd.md) |
| Comunicação pública | A cada mudança de DPO ou política | Atualização deste documento + Política de Privacidade do site |

## Limites do papel interino

- **LogiFit (DPO interno) NÃO assume responsabilidade legal de DPO terceirizado** para tenants — é o DPO da própria LogiFit (operador / sub-controlador, conforme contexto).
- Tenant que precisa de DPO próprio (clínicas com >500 titulares; hospitais; redes Enterprise) tem **duas opções**:
  - Designar DPO interno próprio
  - Contratar **DPO-as-a-service add-on** vendido como complemento do plano Enterprise — LogiFit revende firma especializada externa; **responsabilidade legal é do contrato tenant ↔ firma**, LogiFit é intermediária comercial

## Histórico de DPOs

| Período | DPO | Tipo | Motivo da mudança |
|---|---|---|---|
| 2026-04-25 → vigente | Everton Surkamp Pereira | Interino (fundador) | Designação inicial pré-MVP |

## Revisões deste documento

| Data | Mudança | Aprovado por |
|---|---|---|
| 2026-04-25 | Documento criado | Fundador |

## Referências

- [Lei 13.709/2018 (LGPD) art. 41](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)
- [Resolução ANPD nº 18/2024 — Encarregado](https://www.gov.br/anpd/pt-br)
- [ADR 0067 — DPO + Governança Compliance LGPD](../decisions/0067-dpo-governanca-compliance-lgpd.md)
- [ADR 0054 — LGPD art. 11 + RIPD versionado](../decisions/0054-lgpd-art11-dados-saude-ripd-versionado.md)
- Política de Privacidade pública (a publicar em `logifit.com.br/privacidade` no Sprint 00)
