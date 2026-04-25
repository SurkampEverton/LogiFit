# Runbook — Teste trimestral de restauração de backup

> **Stub** — runbook obrigatório por regra 40 + [ADR 0073 camada 4](../decisions/0073-postura-seguranca-defesa-em-profundidade.md). Será expandido quando Sprint 00 implementar pipeline de backup.

- **Quando usar:** trimestralmente (calendar Q1/Q2/Q3/Q4) — falha = `system_alerts critical` + ADR retroativo
- **Severidade típica:** p2 (manutenção planejada)
- **Tempo estimado:** 2-4h (provisionar instância temporária + restore + validação)
- **Quem executa:** fundador / dev ops
- **Última revisão:** 2026-04-25 (stub)

## Pré-requisitos

- [ ] Acesso ao bucket Cloudflare R2 com chave GPG de descriptografia (ADR 0073 regra 40)
- [ ] Conta Supabase free tier disponível para instância temporária
- [ ] Sessão privilegiada PAM aberta (ADR 0073 camada 7)
- [ ] `pgBackRest` ou `pg_restore` instalado localmente

## Passos (a expandir no Sprint 00)

1. **Listar dumps disponíveis** em R2 — escolher último weekly + 1 mensal + 1 trimestral
2. **Provisionar Supabase temporário** — instância free tier descartável
3. **Descriptografar dump GPG** com chave LogiFit master
4. **Executar `pg_restore`** com `--clean` no temporário
5. **Validar integridade**:
   - [ ] Contagem de linhas em `audit_log`, `members`, `consultas`, `invoices` bate com snapshot
   - [ ] Hash chain `audit_log` (regra 39) verificável — última âncora WORM existe e bate
   - [ ] RLS funcional — query como tenant A não vê tenant B
6. **Documentar resultado** em `compliance_retention_log` + email DPO

## Rollback

Não aplicável — instância temporária descarta em 24h.

## Em caso de falha

- Se descriptografia falhar: chave GPG comprometida ou backup corrompido — incidente p0 + notificar tenants em 72h (LGPD art. 48)
- Se restore falhar: testar dump anterior; se sucessivos falham, problema no pipeline `pg_dump` — bloquear novos deploys até resolver

## Histórico

| Data | Quem | Resultado |
|---|---|---|
| (a preencher pós-Sprint 00) | | |
