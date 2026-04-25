# Runbook — Falha de emissão fiscal (NF-e/NFS-e/NFC-e via Focus NFe)

> **v0.1 — esqueleto.** Resposta a falha de emissão fiscal — Focus NFe rejeição, SEFAZ/prefeitura indisponível, cert A1 expirado. Tema fiscal é P0 — emissão atrasa = compliance vermelho. Será expandido durante [Sprint 36](../sprints/36-geral-fiscal-focus-nfe.md).

- **Quando usar:**
  - Focus NFe retorna `rejected` em emissão
  - Webhook Focus NFe não chega (timeout fila)
  - SEFAZ ou prefeitura municipal está fora do ar (status indisponível)
  - Cert A1 do tenant venceu ou está prestes a vencer
  - Tenant reporta nota não emitida que deveria ter sido
- **Severidade típica:** p1 (impacto fiscal direto; pode escalar a p0 se afeta múltiplos tenants ou janela de emissão crítica)
- **Tempo estimado:** 15-60 minutos por nota (manual); fila acumulada pode levar horas
- **Quem executa:** dev/ops + tenant_owner se cert é problema do tenant
- **Última revisão:** 2026-04-25 (skeleton)

## Pré-requisitos

- [ ] Acesso ao painel Focus NFe + token API válido
- [ ] Acesso a `invoices` + `fiscal_emissions` + `system_alerts` no banco
- [ ] **MFA recente <15min** — toda Server Action de re-emissão fiscal (`retryFiscalEmission`, `cancelFiscalEmission`, `replaceCertificate`) usa gate `requireRecentMfa({ maxAgeMinutes: 15 })` no `wrapAction()` (regra 33 + regra 43 + ADR 0073 camada 2). Gate é **backend** (não UX) — se MFA expirou, refazer 2º fator antes do retry; tentativa sem MFA recente retorna `MFA_REQUIRED` (envelope) sem tocar Focus NFe. Bypass de emergência só via [`mfa-bypass-emergencial.md`](mfa-bypass-emergencial.md).
- [ ] Status pages externos: [SEFAZ status](https://www.fazenda.gov.br/sef-azuis) + Focus NFe status

## Cenários e ações

### Cenário 1 — Focus NFe rejeição (validação)

Sintoma: `fiscal_emissions.status='rejected'` + `rejection_reason` populado.

1. **Identificar causa do rejection** — Focus NFe retorna código:
   - `cnpj_invalido` / `inscricao_estadual_invalida` — corrigir cadastro do tenant ou cliente
   - `nfse_codigo_servico_invalido` — código LC 116/2003 errado para o município
   - `cest_obrigatorio` (NF-e produto) — adicionar CEST no item
   - `aliquota_iss_divergente` — município mudou alíquota; atualizar `tax_rules`
   - Dezenas de outros — Focus NFe documenta cada
2. **Corrigir** no cadastro/item ofensor
3. **Reemitir** via `/app/financeiro/notas/{id}/reemitir` (botão UI futuro Sprint 36) ou diretamente:
   ```bash
   curl -X POST https://api.focusnfe.com.br/v2/nfse \
     -u "${FOCUS_TOKEN}:" \
     -H "Content-Type: application/json" \
     -d @nota_corrigida.json
   ```
4. Aguardar webhook ou polling — atualizar `fiscal_emissions.status`

### Cenário 2 — SEFAZ/prefeitura indisponível

Sintoma: Focus NFe retorna `503` ou pendente >30min.

1. **Verificar status oficial:**
   - SEFAZ NF-e: portal nacional + status região do tenant
   - NFS-e municipal: cada município tem painel próprio (provider nacional cobre alguns)
2. **Aguardar e retry exponencial:**
   - Job `fiscal-emission-retry` roda de 15 em 15 minutos com backoff
   - Para NF-e: emitir em **contingência SVC-AN/SVC-RS** se SEFAZ origem >15min indisponível (Focus suporta)
   - Para NFS-e municipal: muitos municípios não suportam contingência; aguardar
3. **Comunicar tenant** — banner "Emissão fiscal aguardando SEFAZ — retry automático" em `/app/financeiro/notas/pendentes`
4. **Escalar se >4h:**
   - Status oficial confirma indisponibilidade ampla → publicar comunicado em status.logifit
   - Verificar se afeta múltiplos tenants → escalar a p0
5. **Pós-restabelecimento:** todas as notas pendentes processam em fila — validar que a fila escoa em <2h

### Cenário 3 — Cert A1 expirado

Sintoma: Focus NFe retorna `certificado_invalido` ou `certificado_expirado`.

1. **Tenant é responsável pelo cert** — alerta vai ao `tenant_owner`:
   - Email + banner em `/app/settings/empresas/{id}/cert-a1`
   - Alertas D-30, D-15, D-7 (regra de negócio)
2. **Tenant faz upload do novo cert** (procedimento em `rotate-secrets.md` seção "Cert A1 NF-e")
3. **Emissão pendente** retoma após cert atualizado
4. **Se tenant não atualiza:** suspender capacidade de emissão (não apurar/cobrar) e notificar fundador como issue contratual

### Cenário 4 — Webhook Focus NFe não chega

Sintoma: `fiscal_emissions.status='processing'` por >30min.

1. **Polling manual** Focus NFe pelo `external_id`:
   ```bash
   curl https://api.focusnfe.com.br/v2/nfse/{ref} -u "${FOCUS_TOKEN}:"
   ```
2. Se Focus retornou `authorized` mas LogiFit ainda mostra `processing`: webhook perdeu — atualizar manualmente:
   ```sql
   UPDATE fiscal_emissions
   SET status = 'authorized', authorized_at = '<timestamp focus>', authorization_number = '<chave>'
   WHERE external_id = '<ref>';
   INSERT INTO audit_log (action, target, payload)
   VALUES ('fiscal.webhook_lost_recovered', '<emission id>', jsonb_build_object('focus_response', '<json>'));
   ```
3. Investigar webhook lost: secret HMAC bate? IP allowlist correto? Vercel logs mostram tentativa entregando 4xx?

### Cenário 5 — Tenant reclama nota não emitida (que deveria)

1. Verificar `invoices.fiscal_emission_required` está true
2. Verificar `fiscal_emissions` tem registro associado — se não, é bug (não criou registro de emissão); criar manualmente + emitir
3. Se cobrança Asaas confirmou pago mas `fiscal_emissions.created_at IS NULL`: bug crítico em pipeline financeiro→fiscal — abrir Sentry severity=high

## Rollback

Para emissão equivocada (NF-e emitida e não deveria):
1. **Cancelamento** dentro de 24h (NFS-e) ou 7 dias (NF-e produto) via Focus NFe
2. Após o prazo: **carta de correção** (NF-e) ou solicitação manual à prefeitura (NFS-e)
3. Audit em `audit_log`

## Monitoramento pós-execução

- [ ] `fiscal_emissions.status` = `authorized` para todas emissões da janela
- [ ] `system_alerts category=fiscal_emission_failed` resolved
- [ ] Tenant_owner confirma recebimento da nota (PDF + XML em `/app/financeiro/notas`)
- [ ] Pós-pico: backlog escoado em <2h
- [ ] `tenant_usage_snapshots.fiscal_emissions_count` (Sprint 04 + 36) atualizou

## Em caso de falha persistente

- Suspender cobrança recorrente do tenant até resolver fiscal (não cobrar sem nota — risco fiscal recíproco)
- Escalar Focus NFe via canal corporativo
- Avaliar provider complementar NFS-e Padrão Nacional ([ADR 0076](../decisions/0076-nfse-nacional-provider-complementar.md)) para municípios aderidos quando emergir como pattern

## Histórico

| Data | Cenário | Tenant | Resultado |
|---|---|---|---|
| (a preencher pós-Sprint 36) | | | |

## Referências

- [Sprint 36 — Geral fiscal Focus NFe](../sprints/36-geral-fiscal-focus-nfe.md)
- [ADR 0059 — Ciclo fiscal Focus NFe](../decisions/0059-ciclo-fiscal-emissao-focus-nfe.md)
- [ADR 0066 — Plano comercial pricing trial (overage fiscal)](../decisions/0066-plano-comercial-pricing-trial.md)
- [ADR 0076 — NFS-e Nacional provider complementar](../decisions/0076-nfse-nacional-provider-complementar.md)
- [Runbook rotate-secrets — Cert A1](rotate-secrets.md)
