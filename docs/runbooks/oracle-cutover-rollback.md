# Runbook — Rollback de cutover Supabase → Oracle Cloud (Sprint 19b)

> **Stub** — runbook esperado para o cutover Supabase → Oracle Cloud OCI documentado em [ADR 0078](../decisions/0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md) e [Sprint 19b](../sprints/19b-migracao-hospedagem-oracle.md). Será expandido durante a Sprint 19b. Complementar a [`restore-pg.md`](restore-pg.md).

- **Quando usar:** cutover para Oracle Cloud falhou (smoke tests reprovam, latência alta, dado corrompido) e precisa voltar para Supabase
- **Severidade típica:** p0 (banco em produção comprometido / serviço degradado)
- **Tempo estimado:** RTO 4h (regra 40)
- **Quem executa:** fundador (PAM session aberta + janela de manutenção comunicada)
- **Última revisão:** 2026-04-25 (stub)

## Pré-requisitos

- [ ] Banner de manutenção comunicado a tenants pagantes ≥24h antes do cutover original
- [ ] Backup pré-cutover do Supabase **ativo** (não desligar instância Supabase até cutover validado)
- [ ] Acesso a Oracle Cloud OCI + Cloudflare R2 com GPG
- [ ] Smoke test suite dos 8 fluxos críticos preparada (lista em Sprint 19b)
- [ ] Sessão PAM aberta com justificativa "cutover Supabase→Oracle ou rollback"

## Passos (a expandir no Sprint 19b)

### Fase 1 — Decisão (15min)

1. Smoke test 1-3 falham → **abortar imediato** (rollback simples)
2. Smoke test 4-6 falham → diagnose 30min, se não resolver → rollback
3. Smoke test 7-8 falham → considerar fix forward se o problema for cosmético; rollback se for funcional

### Fase 2 — Rollback (Oracle → Supabase)

1. Pausar tráfego: feature flag `maintenance_mode` em PostHog (banner global)
2. Reverter `DATABASE_URL` na Vercel para Supabase
3. Reverter `NEXTAUTH_URL` / claims auth se mudaram
4. Reverter buckets Storage de Cloudflare R2 para Supabase Storage (se já tinham migrado)
5. Validar smoke tests no estado Supabase (8 fluxos críticos)
6. Despausar tráfego (remover `maintenance_mode`)
7. Comunicar tenants: "rollback executado, sistema estável"

### Fase 3 — Pós-mortem (24h)

1. Documentar root cause do failure de cutover
2. ADR retroativo (excepcional — regra 13 normalmente proíbe) ajustando ADR 0078 + Sprint 19b
3. Replanejar próxima janela de cutover (não <30 dias)

## Rollback do rollback (se rollback falhar)

Se reverter para Supabase falha:
1. **Não** entrar em pânico — banco Supabase original deveria estar intocado durante cutover
2. Verificar se Supabase free instance ainda ativa (não desligar até estabilidade comprovada por ≥7 dias)
3. Restore via `restore-pg.md` Cenário 1 (último backup pré-cutover)
4. Em último caso: contatar suporte Supabase + Oracle Cloud em paralelo

## Monitoramento pós-execução

- [ ] Sentry zerado por 1h
- [ ] Latência queries hot dentro do baseline pre-cutover
- [ ] `audit_log` hash chain (regra 39) intacta — nenhuma quebra durante cutover
- [ ] Backup automático rodando no estado restaurado

## Em caso de falha total

- Comunicar tenants em até 72h se afeta dados (LGPD art. 48 — incidente)
- Abrir registro em `security_incidents` (ADR 0067)
- Reembolso parcial proporcional ao downtime (cláusula contratual a confirmar com DPO)

## Histórico

| Data | Cenário | Resultado |
|---|---|---|
| (a preencher na Sprint 19b) | | |
