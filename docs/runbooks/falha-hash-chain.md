# Runbook — Falha de hash chain do audit_log

> **v0.1 — esqueleto.** Procedimento de resposta quando o job semanal `verify-audit-integrity` detecta quebra na cadeia hash da `audit_log` (regra 39). Quebra é **sinal vermelho** — pode indicar tampering, corrupção ou bug. Será expandido pós-Sprint 00 (job + WORM anchor).

- **Quando usar:** alerta `system_alerts severity=critical category=audit_chain_broken` disparado pelo job `verify-audit-integrity` (semanal por default; ad-hoc após restore PG)
- **Severidade típica:** **p0** (potencial tampering em registro append-only)
- **Tempo estimado:** 1-4h investigação + plano de remediação (que pode levar dias se houver dado afetado)
- **Quem executa:** DPO (fundador) + dev/ops (PAM session aberta)
- **Última revisão:** 2026-04-25 (skeleton)

## Pré-requisitos

- [ ] Sessão privilegiada PAM aberta com justificativa "Investigação hash chain {{ID}}" (ADR 0073 camada 7)
- [ ] MFA recente <15min — `requireRecentMfa()` obrigatório (regra 43)
- [ ] Acesso ao Cloudflare R2 / AWS S3 onde âncoras WORM Object Lock são gravadas
- [ ] Acesso `audit_log` + `audit_anchors` + `system_alerts`

## Contexto

A `audit_log` mantém invariante: `current_hash = sha256(payload || previous_hash)` por linha, dentro do escopo `(tenant_id, ordered by created_at)`. Quebra significa:

- **Cenário 1:** linha foi modificada após inserção (UPDATE direto ou bug)
- **Cenário 2:** linha foi deletada (DELETE direto, ainda mais grave — INSERT-only é hard-coded em policies)
- **Cenário 3:** corrupção de disco (raro com Postgres + replicação)
- **Cenário 4:** restore PG sem re-âncora WORM (gap legítimo entre `audit_anchors` antiga e nova primeira-linha pós-restore — não é tampering)
- **Cenário 5:** bug no trigger BEFORE INSERT (computa hash errado em uma linha) — diferente de tampering: hash de uma linha está "errado" mas linhas seguintes continuam com hash correto sobre a base errada

## Passos

### Hora 0 — Triagem

1. **Confirmar alerta** — abrir `system_alerts` correspondente, ver:
   - `tenant_id` afetado (NULL se cross-tenant log de sistema)
   - Linha de quebra: primeira `audit_log.id` onde `current_hash != sha256(payload || previous_hash)`
   - Janela temporal afetada
2. **NÃO** modificar `audit_log` em nada — qualquer mudança piora forense
3. **Capturar snapshot** — `pg_dump` da `audit_log` do tenant afetado + `audit_anchors`
4. **Comparar com âncora WORM** — última âncora válida antes da quebra:
   ```sql
   SELECT * FROM audit_anchors
   WHERE tenant_id = '<id>'
     AND anchored_at < (SELECT created_at FROM audit_log WHERE id = '<linha quebra>')
   ORDER BY anchored_at DESC LIMIT 1;
   ```
   Validar hash da âncora bate com Cloudflare R2 / AWS S3 Object Lock (imutável):
   ```bash
   aws s3api head-object --bucket logifit-audit-anchors --key tenant-{id}/{anchor_id}.json
   # Verificar metadata.hash bate
   ```

### Hora 1-4 — Investigação por cenário

5. **Cenário 4 (restore PG legítimo):** verificar `audit_log.id` da quebra coincide com primeira linha pós-restore (timestamp correlato). Se sim, ação é re-âncora forçada (passo 8) + post-mortem documentando restore.
6. **Cenário 5 (bug trigger):** rodar SQL diff manual sobre linha suspeita:
   ```sql
   WITH suspect AS (
     SELECT id, payload, current_hash, previous_hash, created_at,
            encode(sha256(convert_to(payload::text, 'UTF8') || decode(previous_hash, 'hex')), 'hex') as expected_hash
     FROM audit_log
     WHERE id = '<linha>'
   ) SELECT *, expected_hash = current_hash AS hash_correct FROM suspect;
   ```
   Se `expected_hash` bate em fórmula diferente: bug do trigger. Reportar em Sentry severity=critical + corrigir migration + recomputar chain do tenant.
7. **Cenário 1/2 (tampering):** abrir incidente `security_incidents` severity=critical + acionar runbook `incidente-lgpd-72h.md` (notificação ANPD obrigatória):
   - Quem teve acesso DDL/DML direto a `audit_log` na janela?
   - Logs de Supabase/PG show queries suspeitas?
   - Conta privilegiada comprometida?
   - Forense: extrair timeline + dump dados afetados

### Hora 4+ — Remediação

8. **Re-âncora forçada** (Cenário 4 ou 5 corrigido):
   ```sql
   INSERT INTO audit_anchors (tenant_id, anchor_hash, audit_log_until_id, anchored_at, anchored_by, reason)
   VALUES ('<id>', '<sha256 do estado atual>', '<última linha conhecida>', NOW(), '<dpo id>', 'Re-âncora pós-{{cenário}} {{detalhes}}');
   ```
   Persistir nova âncora em R2/S3 Object Lock:
   ```bash
   aws s3api put-object --bucket logifit-audit-anchors \
     --key tenant-{id}/{anchor_id}.json --body anchor.json \
     --object-lock-mode COMPLIANCE --object-lock-retain-until-date <+5y>
   ```
9. **Post-mortem público** (Cenário 1/2/3): notificar tenants afetados — eles precisam saber que `audit_log` deles teve incidente
10. **Atualizar regra/threat-model:** se foi tampering por vetor não-coberto, aumentar controles — ex: bloquear DDL em produção via row-level security em `pg_catalog`

## Rollback

Não-aplicável diretamente: hash chain quebra não é desfazer, é remediar. Mas em **Cenário 4** (restore PG), se re-âncora foi prematura:
1. Marcar âncora como `revoked` (campo `audit_anchors.revoked_at`)
2. Re-rodar `verify-audit-integrity` para validar continuidade legítima

## Monitoramento pós-execução

- [ ] `system_alerts` `audit_chain_broken` resolved
- [ ] Próximas execuções do job `verify-audit-integrity` passam (semanais; rodar ad-hoc para confirmação imediata)
- [ ] Âncora WORM nova confirmada em R2/S3 (head-object retorna sucesso)
- [ ] Sentry sem novos erros relacionados a `audit_log` trigger
- [ ] Se foi tampering: revisão de permissões DDL/DML em `audit_log`

## Em caso de falha (não consegue diagnosticar cenário)

- Tratar como Cenário 1/2 (tampering) por precaução — runbook `incidente-lgpd-72h.md`
- Notificar fundador via Telegram + escalar quando MVP solo
- Considerar restore PG do último backup íntegro (`restore-pg.md`) se quebra é generalizada (>1% das linhas afetadas)

## Histórico

| Data | Cenário | Tenant | Resultado |
|---|---|---|---|
| (a preencher) | | | |

## Referências

- [regra 39 — hash chain em rules.md](../rules.md)
- [ADR 0073 camada 6 — auditoria forense](../decisions/0073-postura-seguranca-defesa-em-profundidade.md)
- [Runbook restore-pg](restore-pg.md)
- [Runbook incidente-lgpd-72h](incidente-lgpd-72h.md)
- [Threat model prontuario](../threat-models/prontuario.md)
