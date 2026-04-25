# Runbook — Rotação de secrets (chaves de API + KEKs + JWT_SECRET)

> Procedimento operacional para rotacionar chaves criptográficas e tokens. Citado por [ADR 0073 camada 7](../decisions/0073-postura-seguranca-defesa-em-profundidade.md). **Obrigatório:** anual + emergencial em caso de suspeita de comprometimento.

- **Quando usar:**
  - **Periódico:** anual (calendar Q1) — rotação proativa
  - **Emergencial:** suspeita de comprometimento, ex-colaborador com acesso, vazamento de log, alerta Sentry de exfiltração
- **Severidade típica:** p2 periódico / p0 emergencial
- **Tempo estimado:** 30-60 minutos por secret (com testes)
- **Quem executa:** fundador (PAM session aberta) — único autorizado no MVP
- **Última revisão:** 2026-04-25

## Inventário de secrets a rotacionar

| Secret | Onde vive | Frequência | Impacto da rotação |
|---|---|---|---|
| `JWT_SECRET` (sessão LogiFit) | Vercel encrypted env | Anual | **Invalida todas as sessões** — usuários precisam re-logar |
| `BACKUP_GPG_KEY` | Vercel encrypted env | Anual | Backups antigos só descriptografáveis com chave anterior (manter histórico off-line) |
| `KEK` master LogiFit | Vault separado | Anual + emergencial | Re-cifrar todos os campos sensíveis em background (encryption_key_version++) |
| `KEK` por tenant | `tenants.kek_encrypted` (cifrado pela master) | Sob demanda | Idem — escopo tenant |
| `UPSTASH_REDIS_REST_TOKEN` | Vercel env | Anual | Rate limit perde estado por ~30s; usuários veem `RATE_LIMITED` falso |
| `ASAAS_API_KEY` (default LogiFit) | Vercel env | Anual | Asaas operação cessa por ~5min; reagendar webhook test |
| `ASAAS_API_KEY` por company (BYO) | `asaas_keys.api_key` (cifrado) | Tenant gerencia | Tenant é responsável; LogiFit notifica se Asaas reportar key inválida |
| `FOCUS_NFE_TOKEN` | Vercel env | Anual | Emissão fiscal cessa por ~5min; reagendar test sandbox |
| `GEMINI_VERTEX_AI_KEY` | Vercel env (service account JSON) | Anual | IA cessa por ~5min; circuit breaker Cota IA dispara fallback |
| `GROQ_API_KEY` (STT) | Vercel env | Anual | Transcrição cessa; teleconsulta usa fallback OpenAI Whisper se BYOK |
| `RESEND_API_KEY` | Vercel env | Anual | Email transacional cessa; fila acumula 5min |
| `TURNSTILE_SECRET` | Vercel env | Anual | Signup/login com captcha cessa; lockout temporário |
| `SENTRY_DSN` | Vercel env | Sob demanda | Erros não capturados durante janela; manualmente checar Sentry pós |
| `POSTHOG_API_KEY` | Vercel env | Anual | Analytics não capturado; manualmente backfill se necessário |
| `CLOUDFLARE_R2_ACCESS_KEY` + `SECRET` | Vercel env | Anual | Backup off-site falha; alerta dispara; rotacionar primeiro |
| `Cert A1 NF-e` (por company) | `companies_certs.cert_a1_encrypted` | **Anual obrigatório** (cert A1 vence em 1a) | Tenant precisa carregar novo cert antes do vencimento; alerta D-30 |

## Pré-requisitos

- [ ] Sessão privilegiada PAM aberta com justificativa "Rotação de secrets {{tipo}} {{data}}" (ADR 0073 camada 7)
- [ ] MFA recente (<15min) confirmado — gate `requireRecentMfa()` obrigatório (regra 43)
- [ ] Notificar tenants pagantes via banner se rotação causar downtime > 1min
- [ ] Janela de manutenção planejada (madrugada UTC) se possível
- [ ] Backup do estado atual de secrets (criptografado, off-line) — emergência de rollback

## Passos genéricos (replicar por secret)

1. **Gerar novo secret** no provider (Asaas/Focus NFe/etc) ou via `openssl rand -hex 32` (JWT_SECRET, GPG passphrase)
2. **Validar** novo secret com chamada teste em ambiente staging
3. **Atualizar** Vercel env var via `vercel env add VAR_NAME production` ou Dashboard
4. **Deploy** novo build — Vercel propaga env em segundos
5. **Smoke test** do fluxo afetado em produção (1 transação real ou mocada)
6. **Revogar** secret anterior no provider
7. **Audit:** `audit_log` entry `action='secret.rotated'` + `actor=privileged_session_id` + payload sanitizado (nunca vazar valor)
8. **Documentar** em `compliance_retention_log` com `action='secret_rotated'` + `legal_basis='security_policy_annual'`

## Passos específicos por secret crítico

### JWT_SECRET (rotação invalida todas as sessões)

1. Comunicar via email + banner 24h antes: "Manutenção de segurança em DD/MM HH:MM — todos os usuários precisarão re-logar (operação <1min)"
2. Gerar novo: `openssl rand -hex 32`
3. Adicionar como `JWT_SECRET_NEW` em Vercel env (manter `JWT_SECRET` atual)
4. Deploy: middleware aceita JWTs assinados por **ambos** (transição)
5. Aguardar 24h (período de transição) — sessões antigas se renovam com novo secret
6. Remover `JWT_SECRET` antigo, renomear `JWT_SECRET_NEW` → `JWT_SECRET`
7. Deploy final — rejeita JWTs assinados por chave antiga
8. Smoke test: login + sessão persistente + magic link

### KEK master (re-cifra todos os dados em background)

1. Gerar novo via vault (ex: AWS KMS, GCP KMS) — **nunca** colocar diretamente em Vercel env (apenas referência)
2. Bump `encryption_key_version` em `tenants` + `companies_certs` etc
3. Job background `re-encrypt-with-new-kek` itera todas as linhas com `encryption_key_version < latest` e re-cifra
4. Aguardar conclusão (pode levar dias para tenants grandes)
5. Marcar KEK antiga como "deprecated" — manter por 1 ano para descriptografia de backups antigos
6. Após 1 ano: KEK antiga destruída no vault (quando todos backups que dependem dela estiverem fora da retenção)

### Cert A1 NF-e (por company)

1. Tenant recebe alerta D-30, D-15, D-7 antes do vencimento
2. Em `/app/settings/empresas/{id}/cert-a1`, tenant faz upload do novo .pfx + senha
3. Sistema valida cert (CN, validade, cadeia ICP-Brasil)
4. Re-cifra senha com KEK do tenant + grava `companies_certs.encryption_key_version`
5. Smoke test: emissão de NF-e teste em homologação
6. Cert antigo arquivado por 5 anos (obrigação fiscal — nota emitida com cert X precisa ser auditável)

## Rollback

Para rotação periódica:
- Manter secret anterior por 24-48h pós-rotação como `*_OLD`
- Se algo quebrar, reverter env var em <1min via `vercel env`

Para rotação emergencial:
- Sem rollback — secret antigo já está comprometido, voltar pra ele agrava o problema
- Em vez disso: investigar root cause, fortalecer controles, documentar incidente em `security_incidents` (ADR 0067)

## Monitoramento pós-execução

- [ ] Sentry sem erros novos relacionados a auth/payment/email/IA por 1h
- [ ] `system_alerts` zerados na categoria afetada
- [ ] Métricas em `/app/super-admin/database` (ADR 0072) sem anomalia
- [ ] Verificar provider externo (Asaas/Focus/Gemini) reporta zero falhas de auth

## Em caso de falha

- Notificar fundador imediato (Telegram canal privado) se rotação emergencial falhar
- Abrir registro em `security_incidents` com timeline detalhada
- Se afeta múltiplos tenants ou expõe dado: notificar ANPD em 72h (LGPD art. 48)

## Histórico

| Data | Tipo | Secrets rotacionados | Quem | Resultado |
|---|---|---|---|---|
| (a preencher quando primeira rotação ocorrer pós-Sprint 00) | | | | |
