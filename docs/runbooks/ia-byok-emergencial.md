# Runbook — Configurar BYOK IA emergencial (cota excedida mid-month)

> **Stub** — runbook citado em [Sprint 06](../sprints/06-geral-copilot-base.md). Será expandido quando Sprint 06 implementar fluxo BYOK.

- **Quando usar:** tenant clínico com operação contínua (Copilot + Pipeline Exames + Nutri-Agent) excede cota mensal de IA antes do reset (CFM 2.454/2026 supervisão humana ativa não pode parar)
- **Severidade típica:** p2 (operação degradada, não crítica)
- **Tempo estimado:** 5 minutos (configuração) + propagação de cota imediata
- **Quem executa:** admin do tenant (auto-serviço) — sem intervenção LogiFit
- **Última revisão:** 2026-04-25 (stub)

## Sintomas que disparam este runbook

- Banner em `/app/dashboard` "Cota IA esgotada — IA desabilitada até DD/MM"
- `system_alerts severity=warning` com `category=ai_quota_exceeded`
- Email automático ao tenant_owner em 80% / 95% / 100% da cota

## Pré-requisitos

- [ ] Conta Google Cloud com Vertex AI ativado (ou conta OpenAI/Anthropic se BYOK alternativo)
- [ ] Cartão de crédito vinculado ao provider (não passa pela LogiFit)
- [ ] Permission `tenant.ai_settings.write` (default em `tenant_owner` e `super_admin_rede`)

## Passos (a expandir no Sprint 06)

1. **Gerar API key no provider:**
   - Google Cloud Console → IAM → Service Accounts → Vertex AI User → criar key JSON
   - OU OpenAI → API Keys → Create new secret key
2. **Acessar `/app/settings/ia`** no tenant
3. **Colar API key** no campo BYOK (criptografada AES-256-GCM via KEK do tenant — ADR 0073 camada 4)
4. **Validar com chamada teste** — botão "Testar BYOK" envia prompt simples e mostra resposta
5. **Ativar BYOK** — toggle "Usar minha chave própria" → tenant passa a consumir do próprio billing do provider, **bypass quota LogiFit**
6. **Verificar funcionamento** — fazer pergunta no Copilot, conferir `ai_audit_log` mostra `provider_config_id` preenchido

## Rollback

Toggle desliga BYOK — retorna a usar cota LogiFit (que continua esgotada até reset).

## Monitoramento pós-execução

- [ ] Próxima chamada IA usa key BYOK (audit confirma)
- [ ] Custo na Google Cloud Console / OpenAI Dashboard começa a contabilizar
- [ ] `system_alerts` resolve automaticamente em até 5min

## Em caso de falha

- Key inválida → erro `INVALID_BYOK_KEY` no envelope; verificar formato + permissões
- Provider rate-limit → BYOK próprio também tem limites; usar fallback cascade (ADR 0064)
- Se nada funcionar: contatar `privacidade@logifit.com.br` — fallback emergência possível com chave LogiFit Enterprise (cobrado avulso, autorização do fundador)

## Histórico

| Data | Tenant | Resultado |
|---|---|---|
| (a preencher pós-Sprint 06) | | |
