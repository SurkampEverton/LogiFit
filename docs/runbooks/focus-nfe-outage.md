# Runbook — Focus NFe outage prolongado (>30min)

> **Stub** — complementar a [`falha-nfe.md`](falha-nfe.md), que cobre rejeição de nota individual. Este runbook cobre **outage prolongado** do provider Focus NFe (motor fiscal terceirizado — ADR 0059). Citado por ADR 0059 + Sprint 36. Será expandido no primeiro incidente real ou na Sprint 36.

- **Quando usar:** Focus NFe API retorna 5xx persistente >30min OU SEFAZ municipal/estadual fora do ar via Focus; emissão de NFS-e/NF-e/NFC-e bloqueada
- **Severidade típica:** p1 (afeta operação fiscal) — escalar p0 se afeta tenant Business/Enterprise com volume alto + se contingência SEFAZ não estiver disponível
- **Tempo estimado:** 30min mitigação + variável
- **Quem executa:** fundador / dev
- **Última revisão:** 2026-04-25 (stub)

## Distinção importante

- `falha-nfe.md` — nota individual rejeitada por regra de validação (CFOP errado, CNAE errado, dados do destinatário inválidos). Tratamento: corrigir + reemitir.
- **Este runbook** — provider Focus NFe inteiro indisponível. Tratamento: queue + retry + comunicação.

## Pré-requisitos

- [ ] Acesso ao painel Focus NFe (https://focusnfe.com.br)
- [ ] Acesso ao status SEFAZ (https://www.fazenda.sp.gov.br/SefazSitiosVirtuais/SitioConsultaSituacaoSEFAZ.aspx — exemplo SP)
- [ ] Sentry filtro por `provider:focus-nfe`
- [ ] Conhecimento da tabela `fiscal_emissions` (estados pending/issued/rejected/queued)

## Passos (a expandir)

### Fase 1 — Diagnose (5min)

1. Verificar status Focus NFe + status SEFAZ alvo
2. Verificar Sentry padrão de erros + queue `fiscal_emissions status=queued`
3. Determinar escopo: provider down OU SEFAZ específica down (NFS-e municipal pode estar fora em uma cidade enquanto NF-e estadual funciona)

### Fase 2 — Mitigação (25min)

1. **Não** quebrar a UI de emissão — emissões novas vão para `fiscal_emissions status=queued` automaticamente (já é comportamento default da abstração ADR 0059)
2. Banner em `/app/fiscal` informando "Provider fiscal em manutenção — notas serão emitidas assim que voltar"
3. Para tenant que precisa emitir **agora** (cliente esperando recibo): orientar a emitir manualmente via portal Focus NFe (ou via portal SEFAZ municipal) e cadastrar `external_reference` na fila para reconciliação posterior
4. Para SEFAZ específica down: orientar tenant a emitir em **contingência** (NF-e em modo offline, transmite depois) — Focus NFe suporta

### Fase 3 — Recuperação (após provider voltar)

1. Job `process-fiscal-queue` desbloqueia DLQ em ordem cronológica
2. Auditar nenhuma nota duplicada via `(tenant_id, company_id, numero, serie)` unique
3. Reabilitar banner

## Rollback

Não aplicável diretamente. Se reprocessamento gera duplicidade:
- Identificar duplicadas + cancelar a redundante (regra 43 — MFA recente)
- ADR retroativo se for falha de design

## Monitoramento pós-execução

- [ ] Queue `fiscal_emissions status=queued` zera
- [ ] Sentry sem erros `provider:focus-nfe` por 2h
- [ ] Custo do mês não excede projeção (Focus NFe cobra por nota — outage não deve gerar overage)

## Em caso de falha

- Outage >24h: comunicar tenants Business/Enterprise diretamente
- ADR 0076 prevê NFS-e Padrão Nacional como provider complementar futuro — não substitui Focus NFe no MVP, mas serve de mitigação parcial Fase 2

## Histórico

| Data | Cenário | Resultado |
|---|---|---|
| (a preencher) | | |
