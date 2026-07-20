# Runbook — Webhook Focus NFe (registro + IP allowlist + troubleshooting)

- **Quando usar:** ao configurar credenciais Focus NFe de um tenant (registro do webhook), ao rotacionar o webhook secret, ou quando emissões ficam presas em `processing` (callback não chega).
- **Severidade típica:** p2 (emissões presas) / p3 (setup)
- **Tempo estimado:** 15-30 min
- **Quem executa:** fundador / dev
- **Última revisão:** 2026-07-19

## Contexto

O ciclo de emissão é assíncrono: `POST /v2/{nfse|nfe|nfce}?ref=...` responde `processando_autorizacao` e o resultado final (autorizada/rejeitada/cancelada) chega via webhook em `POST /api/fiscal/focus-nfe/callback?token={secret}` (Sprint 36b.1, ADR 0059).

**Modelo de segurança do callback** (Focus não assina HMAC nativo):

1. **Token na URL** — secret de 48 hex chars gerado no wizard (`/app/settings/fiscal`), armazenado cifrado AES-256-GCM em `fiscal_provider_credentials.webhook_secret_*`, verificado com `timingSafeEqual`. Exibido **uma única vez** no save.
2. **TLS** — Cloudflare proxy + HSTS; token nunca trafega em claro.
3. **IP allowlist (esta seção)** — camada extra no Cloudflare WAF.
4. **Lookup defensivo** — a ref só resolve se existir emissão `focus_nfe` com aquele `provider_ref` no tenant cujo secret bate; 401 uniforme não vaza existência.
5. **Idempotência + no-downgrade** — replay converge; `completed` nunca regride pra `processing`; `cancelled` é terminal.

## Pré-requisitos

- [ ] Acesso ao painel Focus NFe da conta do tenant (https://app-v2.focusnfe.com.br) — cadastro em https://focusnfe.com.br/cadastro/ (30 dias de teste, sem setup nem fidelidade); doc da API em https://doc.focusnfe.com.br
- [ ] Acesso ao Cloudflare (zona logifit.com.br) pra regra WAF
- [ ] MFA recente: **N/A** — registro de webhook não passa por Server Action de alto risco; o secret é gerado/salvo pelo wizard com gate `fiscal.admin`
- [ ] Credenciais Focus já salvas no wizard (`/app/settings/fiscal` Step 1) e secret anotado

## Passos

1. **Gerar/rotacionar o secret** — em `/app/settings/fiscal`, salvar as credenciais (re-salvar rotaciona o secret). Copiar a URL exibida:
   ```
   https://app.logifit.com.br/api/fiscal/focus-nfe/callback?token={secret-48-hex}
   ```
   Resultado esperado: bloco "Webhook registrado — anote o secret (exibido só agora)".

2. **Registrar no Focus NFe** — painel Focus → Configurações → Webhooks (ou via API):
   ```bash
   curl -u "$FOCUS_TOKEN:" -X POST https://api.focusnfe.com.br/v2/hooks \
     -H "Content-Type: application/json" \
     -d '{"cnpj":"<CNPJ_EMITENTE>","event":"nfe","url":"https://app.logifit.com.br/api/fiscal/focus-nfe/callback?token=<SECRET>"}'
   ```
   Repetir com `"event":"nfse"` e `"event":"nfce"` conforme os tipos usados pelo tenant.
   Resultado esperado: HTTP 201 com id do hook.

3. **IP allowlist no Cloudflare WAF** — criar regra na zona:
   - Expressão: `(http.request.uri.path eq "/api/fiscal/focus-nfe/callback" and not ip.src in $focus_nfe_ips)`
   - Ação: **Block**
   - Lista `$focus_nfe_ips`: solicitar a faixa de IPs de saída atual ao suporte Focus NFe (suporte@focusnfe.com.br) — eles não publicam faixa fixa em doc pública; **revalidar a cada 6 meses** ou quando callbacks começarem a ser bloqueados.
   - Enquanto a faixa não for confirmada pelo suporte, **não ativar** a regra (o token + TLS seguram o threat model); registrar pendência no Histórico abaixo.

4. **Testar ponta-a-ponta (homologação)** — emitir 1 NFS-e avulsa em `/app/fiscal/emitir/nfse` com credencial de homologação e acompanhar:
   ```bash
   # logs do app (Coolify) — callback deve chegar em segundos/minutos
   docker logs -f logifit-web 2>&1 | grep focus-nfe/callback
   ```
   Resultado esperado: `POST /api/fiscal/focus-nfe/callback 200` e emissão indo de `processing` → `Autorizada` no detalhe.

5. **Validar** —
   - [ ] Emissão de teste em status `Autorizada` com chave preenchida
   - [ ] Botões ⬇ PDF / ⬇ XML funcionando no detalhe (download real via proxy autenticado)
   - [ ] `curl -X POST ".../callback?token=errado" -d '{"ref":"x","status":"autorizado"}'` retorna **401**

## Troubleshooting — emissões presas em `processing`

1. **Re-consultar manualmente** — botão "🔄 Re-consultar status" no detalhe da emissão (chama `GET /v2/{recurso}/{ref}` no Focus e atualiza local). Se resolver, o problema é só o callback.
2. **Callback não chega:**
   - Conferir hook registrado: `curl -u "$FOCUS_TOKEN:" https://api.focusnfe.com.br/v2/hooks`
   - Conferir se a URL registrada tem o secret **atual** (rotacionou e esqueceu de re-registrar? → passo 2)
   - Conferir WAF do Cloudflare (Security → Events) — se a regra do passo 3 está bloqueando IPs novos do Focus, atualizar a lista
3. **Callback chega mas retorna 401:** secret rotacionado sem re-registro no Focus → passo 2.
4. **Callback chega, 200, mas emissão não atualiza:** ver resposta `{"processed": false, "reason": ...}` — `out-of-order ignorado` é benigno (replay atrasado); `status desconhecido` indica status novo do Focus → abrir issue pra mapear em `mapFocusStatus`.

## Rollback

Registro de webhook e regra WAF são independentes e reversíveis isoladamente:

1. Remover hook: `curl -u "$FOCUS_TOKEN:" -X DELETE https://api.focusnfe.com.br/v2/hooks/{id}` (emissões seguem funcionando via re-consulta manual).
2. Desativar a regra WAF no Cloudflare (o token continua protegendo o endpoint).

Tempo máximo aceitável de rollback: 5 minutos.

## Monitoramento pós-execução

- [ ] Verificar `system_alerts` críticos nas próximas 2h
- [ ] Conferir emissões `processing` com mais de 1h: query `SELECT id, kind, numero, submitted_at FROM fiscal_emissions WHERE status IN ('queued','processing') AND submitted_at < now() - interval '1 hour';`
- [ ] Conferir `audit_log` das ações fiscais do período

## Em caso de falha

Contato emergência:
- **Fundador / DPO:** privacidade@logifit.com.br
- **Suporte Focus NFe:** suporte@focusnfe.com.br (SLA conforme contrato — ver `docs/contratos/focus-nfe.md` quando negociado)
- Ver também [`falha-nfe.md`](falha-nfe.md) e [`focus-nfe-outage.md`](focus-nfe-outage.md)

## Histórico

| Data | Quem | O quê | Resultado |
|---|---|---|---|
| 2026-07-19 | Claude (Sprint 36b.7) | Runbook criado; IP allowlist pendente de faixa confirmada pelo suporte Focus | ok |
