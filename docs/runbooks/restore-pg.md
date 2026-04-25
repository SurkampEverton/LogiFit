# Runbook — Restore Postgres em produção (rollback de migração quebrada ou disaster recovery)

> **Stub** — runbook citado em [Sprint 19b](../sprints/19b-migracao-hospedagem-oracle.md). Será expandido durante Sprint 19b (cutover Supabase → Oracle Cloud).

- **Quando usar:** migração quebrou banco em produção / data corruption / disaster recovery completo
- **Severidade típica:** p0 (banco em produção comprometido)
- **Tempo estimado:** RTO 4h (regra 40)
- **Quem executa:** fundador / dev ops (PAM session aberta)
- **Última revisão:** 2026-04-25 (stub)

## Pré-requisitos

- [ ] Sessão privilegiada PAM aberta com justificativa (ADR 0073 camada 7)
- [ ] Acesso Cloudflare R2 com chave GPG
- [ ] Notificar tenants pagantes via banner + email **antes** de iniciar (manutenção planejada se possível)
- [ ] `pgBackRest` instalado + configurado para conexão Postgres alvo

## Passos (a expandir no Sprint 19b)

### Cenário 1: Rollback de migração quebrada (Fase 1 Supabase)

1. Identificar último backup pré-migração via Supabase Dashboard → Database → Backups
2. Restaurar via Supabase point-in-time (até 7d Starter / 14d Pro / 30d Business)
3. Validar smoke tests (login, criar member, prescrição, cobrança)
4. Reabilitar tráfego

### Cenário 2: Disaster recovery (Fase 2 Oracle Cloud)

1. Provisionar nova instância Oracle Cloud OCI ARM Ampere
2. Restaurar último `pg_dump` cifrado de R2:
   ```bash
   gpg --decrypt logifit-pg-{{date}}.dump.gpg | pg_restore --clean --if-exists --no-owner -d logifit_prod
   ```
3. Atualizar `DATABASE_URL` na Vercel
4. Smoke tests dos 8 fluxos críticos (igual cutover Sprint 19b)
5. Validar hash chain `audit_log` (regra 39) — última âncora WORM coincide com primeira pós-restore

## Rollback (do rollback)

Se restore falhar:
1. Manter banco original (read-only) e restaurar em paralelo no temporário
2. Após sucesso, fazer cutover novamente
3. **Nunca** executar `DROP DATABASE` no banco original sem backup verificado

## Monitoramento pós-execução

- [ ] Sentry sem erros novos por 1h
- [ ] `system_alerts critical` zerado
- [ ] Latência das queries hot dentro do baseline
- [ ] Backup automático da nova instância configurado e rodando

## Em caso de falha

- Notificar tenants em até 72h se afeta dados (LGPD art. 48 — incidente)
- Abrir registro em `security_incidents` (ADR 0067)
- Invocar DPO + fundador para resposta coordenada

## Histórico

| Data | Cenário | Resultado |
|---|---|---|
| (a preencher) | | |
