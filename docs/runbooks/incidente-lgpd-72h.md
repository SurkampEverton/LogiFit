# Runbook — Incidente de segurança / LGPD (resposta 72h)

> **v0.1 — esqueleto.** Cumprimento da obrigação **LGPD art. 48** (notificação à ANPD e ao titular em prazo razoável — referência prática 72h, alinhada GDPR art. 33). Citado em [ADR 0067](../decisions/0067-dpo-governanca-compliance-lgpd.md). Será revisado e treinado em incident drill semestral pós-Sprint 00.

- **Quando usar:** vazamento confirmado/suspeito de dados pessoais (especialmente sensíveis: saúde, biometria, financeiro), exfiltração detectada, ransomware, acesso não-autorizado a `audit_log`/`prontuario_evolucao`, perda de chave KEK
- **Severidade típica:** p0 (crítico) — toda execução acende este runbook
- **Tempo estimado:** primeiras 4h fundamentais; ciclo de 72h até notificação ANPD; remediação pode levar dias-semanas
- **Quem executa:** **DPO** (Fundador no MVP — `privacidade@logifit.com.br`) + dev/ops + assessoria jurídica externa se >100 titulares afetados
- **Última revisão:** 2026-04-25 (skeleton)

## Pré-requisitos

- [ ] Sessão privilegiada PAM aberta com justificativa "Incidente LGPD {{ID}} — {{data}}" (ADR 0073 camada 7)
- [ ] MFA recente <15min — gate `requireRecentMfa()` obrigatório (regra 43)
- [ ] Acesso a `security_incidents` (criar registro)
- [ ] Acesso ao Sentry + PostHog + Logtail/Axiom para timeline forense
- [ ] Telefone do canal ANPD à mão (1331) + portal [https://www.gov.br/anpd](https://www.gov.br/anpd)

## Passos (a expandir após primeiro incident drill)

### Hora 0 — Detecção e contenção (primeiras 1-2h)

1. **Confirmar incidente** — sinais: alerta Sentry crítico, falha hash chain (regra 39 — runbook próprio), pico anormal de queries cross-tenant, denúncia externa (titular, pesquisador), `system_alerts severity=critical category=security`
2. **Conter o incidente** — não destruir evidências:
   - Revogar sessões comprometidas (`auth.signOutAll(tenantId)` ou query SQL de invalidação)
   - Se exfiltração via API key: rotação emergencial (runbook `rotate-secrets.md`)
   - Se ransomware: desconectar instância afetada do tráfego (Vercel rollback para deploy anterior se necessário)
   - **Não** apagar logs nem reiniciar serviço sem snapshot
3. **Criar registro em `security_incidents`** com:
   ```
   id, tenant_id (ou NULL se cross-tenant), severity='critical',
   detected_at, detected_by, summary, status='triage',
   evidence_locations[] (links Sentry/Logtail/audit_log)
   ```
4. **Capturar snapshot** — `pg_dump` da janela suspeita + dump Sentry events + `audit_log` da janela
5. **Notificar fundador** (Telegram canal privado) se DPO não for o detector

### Hora 2-24 — Investigação e classificação

6. **Timeline forense** — reconstruir:
   - Quem (user_id, ip, user_agent)
   - O que (action, payload sanitizado, recursos acessados)
   - Quando (timestamps + duração)
   - Como (vetor — credencial vazada? falha em RLS? prompt injection? sub-processador?)
7. **Quantificar exposição:**
   - [ ] Quantos titulares afetados?
   - [ ] Quais categorias de dado? (saúde, biometria, financeiro, identificação)
   - [ ] Há dado sensível LGPD art. 11 envolvido? (geralmente sim em saúde — eleva criticidade)
   - [ ] Dados foram apenas acessados ou também copiados/modificados/destruídos?
8. **Decidir notificação:**
   - **ANPD obrigatória** (LGPD art. 48): se "risco ou dano relevante aos titulares" — em saúde, regra prática = sempre notificar
   - **Titulares obrigatória:** se dado sensível ou risco material concreto
   - **Tenants pagantes obrigatória** (contrato SaaS): em até 24h ao tenant_owner

### Hora 24-72 — Notificação

9. **Notificar ANPD** via portal [https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento) ou email `comunicacao@anpd.gov.br` — preencher template em [`docs/compliance/anpd-notification-template.md`](../compliance/anpd-notification-template.md) (LGPD art. 48 §1º + Resolução ANPD nº 15/2024):
   - Natureza do incidente
   - Categorias e número de titulares afetados
   - Categorias e quantidade de dados afetados
   - Medidas técnicas e administrativas adotadas
   - Riscos para titulares
   - Contato do DPO
10. **Notificar titulares afetados** — email + banner no app:
    - Linguagem clara, sem jargão técnico
    - O que aconteceu, qual dado, o que fazer (trocar senha se vazou; monitorar conta bancária se vazou financeiro)
    - Canal de tira-dúvidas: `privacidade@logifit.com.br`
11. **Notificar tenants pagantes** se afeta dado deles — email tenant_owner com detalhes técnicos + plano de remediação

### Pós-72h — Remediação e aprendizado

12. **Plano de remediação** registrado em `security_incidents.remediation_plan` (texto livre) com prazos
13. **Post-mortem público** (interno + tenant_owner) em até 14 dias
14. **Atualizar threat-model** correspondente (`docs/threat-models/`) com nova ameaça aprendida
15. **Atualizar regras** em `docs/rules.md` se cobrança de novo controle vira mandatória
16. **Atualizar este runbook** com lições do incidente (campo "Histórico" abaixo)

## Rollback

Geral não-aplicável: incidente já ocorreu — rollback é remediação, não desfazer ação. Mas:
- Se rotação de chave deu errado: ver runbook `rotate-secrets.md` (rollback emergencial)
- Se contenção isolou serviço inteiro mas incidente era em sub-tenant: reativar com filtro mais granular

## Monitoramento pós-execução

- [ ] `system_alerts critical` zerado nas 24h seguintes
- [ ] Sentry sem novos events do mesmo padrão
- [ ] `audit_log` hash chain íntegro (rodar `verify-audit-integrity` job manualmente)
- [ ] Sentinel queries: nenhuma query cross-tenant suspeita no padrão observado
- [ ] Verificar se sub-processadores envolvidos (Vercel, Supabase, Asaas) reportam algo relacionado em status pages

## Em caso de falha de notificação

- **Falha portal ANPD:** registrar tentativa em `compliance_retention_log` + email backup `comunicacao@anpd.gov.br` + telefone 1331
- **Falha email titulares (bounce, lista enorme):** banner no app por 30d + carta registrada para titulares de alto risco se vazamento for de dado financeiro

## Histórico

| Data | Tipo | Severidade | Titulares afetados | Resultado |
|---|---|---|---|---|
| (a preencher pós-primeiro incidente OU pós-incident drill) | | | | |

## Referências

- [LGPD art. 48](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)
- [Resolução ANPD nº 15/2024 — Comunicação de incidente](https://www.gov.br/anpd/pt-br)
- [ADR 0067 — DPO + governança compliance](../decisions/0067-dpo-governanca-compliance-lgpd.md)
- [ADR 0073 — Defesa em profundidade](../decisions/0073-postura-seguranca-defesa-em-profundidade.md)
- [Runbook rotate-secrets](rotate-secrets.md)
- [Runbook exfiltracao-detectada](exfiltracao-detectada.md)
- [Runbook falha-hash-chain](falha-hash-chain.md)
