# Runbook — Teste trimestral de restauração de backup

> Runbook obrigatório por regra 40 + [ADR 0073 camada 4](../decisions/0073-postura-seguranca-defesa-em-profundidade.md). Atende **LGPD art. 46** (medidas técnicas) e **CFM 2.299/2021** (continuidade de prontuário).

- **Quando usar:** trimestralmente — agendado em `Q1: jan/15` · `Q2: abr/15` · `Q3: jul/15` · `Q4: out/15`
- **Severidade típica:** p2 (manutenção planejada) — escala p1 se falhar 2 trimestres seguidos
- **Tempo estimado:** 2-4h (provisionar + restore + validação + teardown)
- **Quem executa:** fundador / dev ops (DPO supervisiona resultado)
- **Última revisão:** 2026-04-27

## Critérios de sucesso

Restore só é considerado sucesso se **todos** os 6 critérios abaixo passarem:

- [ ] **Descriptografia GPG bem-sucedida** — chave master atual válida
- [ ] **`pg_restore` completa sem erro** em instância temporária limpa
- [ ] **Contagem de linhas bate** com snapshot — diferença <1% em `audit_log`, `members`, `consultas`, `invoices`, `persons`
- [ ] **Hash chain `audit_log` íntegro** — função `verify_audit_chain(start_at, end_at)` retorna `valid=true` (regra 39)
- [ ] **Âncora WORM bate** — última âncora S3 Object Lock corresponde ao hash do dump
- [ ] **RLS funcional** — query como `tenant_id=A` não retorna linha de `tenant_id=B`

## Pré-requisitos

- [ ] Acesso ao bucket Cloudflare R2 (chaves S3-compatíveis em 1Password vault `LogiFit/Backup R2`)
- [ ] Chave GPG master `logifit-backup-2026.asc` em vault separado (1Password vault `LogiFit/Backup GPG` — defesa em profundidade)
- [ ] Conta Supabase free tier `logifit-restore-test` disponível para instância temporária
- [ ] `pgBackRest` ≥2.50 e `pg_restore` ≥16 instalados localmente
- [ ] Sessão privilegiada PAM aberta (registro em `audit_log`)
- [ ] `gpg` 2.4+ disponível no terminal

## Passos

### Fase 1 — Preparação (15min)

1. **Abrir sessão PAM** com motivo `quarterly-restore-test-Q{N}-{YYYY}`
2. **Listar dumps disponíveis** em R2:
   ```bash
   aws s3 ls s3://logifit-backups/pg-dumps/ --endpoint-url=$R2_ENDPOINT
   ```
3. **Selecionar 3 dumps**: último weekly + 1 mensal (1º do mês passado) + 1 trimestral (1º do trimestre passado)
4. **Provisionar Supabase temporário** — projeto `logifit-restore-test-Q{N}` na free tier (descartável)
5. **Anotar `DATABASE_URL`** temporário em variável local (não persistir)

### Fase 2 — Restauração (60min cada dump = 3h total)

Para cada um dos 3 dumps selecionados:

6. **Baixar dump cifrado**:
   ```bash
   aws s3 cp s3://logifit-backups/pg-dumps/$DUMP_FILE.dump.gpg ./tmp/ --endpoint-url=$R2_ENDPOINT
   ```
7. **Descriptografar com chave master**:
   ```bash
   gpg --batch --yes --output ./tmp/$DUMP_FILE.dump --decrypt ./tmp/$DUMP_FILE.dump.gpg
   ```
   - Falha → registrar `incident-id` + abortar (chave comprometida ou backup corrompido — escalar p0)
8. **Restaurar**:
   ```bash
   pg_restore --clean --if-exists --no-owner --no-acl \
     --dbname=$TEMP_DATABASE_URL ./tmp/$DUMP_FILE.dump
   ```
9. **Validar contagem**:
   ```sql
   -- snapshot original deve estar em compliance_retention_log no dia do dump
   SELECT
     (SELECT COUNT(*) FROM audit_log) AS audit,
     (SELECT COUNT(*) FROM members) AS members,
     (SELECT COUNT(*) FROM consultas) AS consultas,
     (SELECT COUNT(*) FROM invoices) AS invoices,
     (SELECT COUNT(*) FROM persons) AS persons;
   ```
   Comparar com snapshot — diferença >1% em qualquer tabela = falha
10. **Validar hash chain**:
    ```sql
    SELECT verify_audit_chain(
      (SELECT MIN(created_at) FROM audit_log),
      (SELECT MAX(created_at) FROM audit_log)
    );
    ```
    Resultado esperado: `{ valid: true, broken_at: null, total_rows: N }`
11. **Validar âncora WORM**:
    ```bash
    # hash do dump original
    sha256sum ./tmp/$DUMP_FILE.dump
    # comparar com S3 Object Lock metadata em compliance_retention_log
    aws s3api head-object --bucket logifit-worm-anchors \
      --key audit-anchors/$DATE.hash --endpoint-url=$AWS_S3_ENDPOINT
    ```
    Hashes devem bater
12. **Validar RLS** (executar como tenant fictício):
    ```sql
    SET LOCAL app.current_tenant_id = '00000000-0000-0000-0000-000000000001';
    SELECT COUNT(*) FROM members;  -- deve retornar só tenant 1
    SET LOCAL app.current_tenant_id = '00000000-0000-0000-0000-000000000002';
    SELECT COUNT(*) FROM members;  -- deve retornar só tenant 2 (número diferente)
    ```

### Fase 3 — Documentação (15min)

13. **Registrar resultado** em `compliance_retention_log`:
    ```sql
    INSERT INTO compliance_retention_log
      (test_type, quarter, dump_file, restored_at, success, notes, executed_by)
    VALUES ('quarterly_restore', 'Q{N}-{YYYY}', '$DUMP_FILE',
      now(), true, 'all 6 criteria passed', '$user_id');
    ```
14. **Email DPO** (`privacidade@logifit.com.br`) com resultado + duração + notas
15. **Atualizar tabela "Histórico"** abaixo

### Fase 4 — Teardown (10min)

16. **Limpar dumps locais**:
    ```bash
    shred -u ./tmp/$DUMP_FILE.dump ./tmp/$DUMP_FILE.dump.gpg
    ```
17. **Deletar projeto Supabase temporário** via dashboard ou API
18. **Fechar sessão PAM** com nota de conclusão

## Rollback

Não aplicável — instância temporária descarta em 24h (free tier auto-pause). Dumps locais são apagados na Fase 4.

## Em caso de falha

| Falha | Severidade | Ação |
|---|---|---|
| Descriptografia GPG falha | p0 | Chave comprometida ou dump corrompido — incidente LGPD; notificar tenants em 72h se chave atual ([incidente-lgpd-72h.md](incidente-lgpd-72h.md)) |
| `pg_restore` falha | p1 | Testar dump anterior; 2 sucessivos falham → bloquear novos deploys até resolver pipeline `pg_dump` |
| Contagem não bate (>1% diff) | p1 | Auditar pipeline de backup (truncate/skip indevido); investigar últimos 30 dias |
| Hash chain quebra | p0 | Disparar [`falha-hash-chain.md`](falha-hash-chain.md) — possível tampering ou bug em trigger |
| Âncora WORM divergente | p0 | S3 Object Lock comprometido — escalar AWS Support + ANPD se prontuário afetado |
| RLS vaza dados entre tenants | p0 | Bloquear todos deploys; revisar policies; possível incidente LGPD multi-tenant |

## Monitoramento pós-execução

- [ ] `compliance_retention_log` entrada criada
- [ ] Email DPO enviado com sucesso
- [ ] Sentry sem `provider:r2` ou `provider:gpg` errors nas próximas 24h
- [ ] Próximo trimestre agendado em calendário (recurrence)

## Histórico

| Data | Quem | Quarter | Resultado | Tempo total | Notas |
|---|---|---|---|---|---|
| (a preencher após primeira execução pós-Sprint 00) | | | | | |

## Referências

- [ADR 0073 — Defesa em profundidade](../decisions/0073-postura-seguranca-defesa-em-profundidade.md) (camada 4 — backup off-site)
- [ADR 0072 — Escalabilidade banco](../decisions/0072-escalabilidade-banco-particionamento-retencao-cold-storage.md)
- Regra 40 ([rules.md](../rules.md))
- LGPD art. 46 (medidas técnicas + administrativas de segurança)
- CFM 2.299/2021 — continuidade de prontuário eletrônico
