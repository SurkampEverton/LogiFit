# Threat Model STRIDE — Backup pipeline (pg_dump + GPG + R2/S3 Object Lock)

> **Stub** — Threat model esperado para o pipeline de backup off-site (regra 40 + [ADR 0073](../decisions/0073-postura-seguranca-defesa-em-profundidade.md) camada 4). MVP: Cloudflare R2 free tier 10GB; Fase 2: AWS S3 us-east-1 com Object Lock WORM. Será expandido conforme pipeline for materializado em Sprint 00. Template-base em [`_template-stride.md`](_template-stride.md).

- **Feature:** Backup off-site cifrado de Postgres — `pg_dump` weekly via Vercel Cron + GPG encryption + upload R2 (MVP) / S3 (Fase 2) + retenção 12 meses + teste de restauração trimestral
- **Sprint:** 00 (pipeline base) + 19b (cutover Oracle Cloud)
- **Data:** stub criado em 2026-04-26
- **ADR de referência:** [ADR 0073 — Postura de segurança defesa em profundidade](../decisions/0073-postura-seguranca-defesa-em-profundidade.md) (camada 4 — backup)

## Superfície de ataque (a expandir)

```
[Vercel Cron weekly]
        │
        │ 1. invoca worker pg-backup
        ▼
[pg_dump --format=custom DATABASE_URL]
        │
        │ 2. dump bruto em /tmp (ephemeral runtime)
        ▼
[gpg --encrypt --recipient logifit-backup-key]
        │
        │ 3. dump cifrado AES-256 (chave assimétrica)
        ▼
[upload Cloudflare R2 / AWS S3 us-east-1 (Fase 2)]
        │
        │ 4. retenção 12 meses; Object Lock WORM (Fase 2)
        ▼
[Auditoria: registro em compliance_retention_log + alerta system_alerts se falhar]

Restore (raro):
[runbook restore-pg.md] → baixa dump → gpg --decrypt (chave privada em vault separado) → pg_restore --clean
```

**Trust boundaries críticos:**
1. Cron Vercel → DB (credencial DATABASE_URL com role read-only `backup_role`)
2. Worker → R2/S3 (credenciais R2 token / AWS IAM role com escopo write-only no bucket)
3. Chave GPG privada (recovery) → vault separado da infra de produção (1Password Business / HashiCorp Vault)
4. Operator humano → restore (PAM session com justificativa, ADR 0073 camada 7)

## Análise STRIDE (a expandir antes de Sprint 00 fechar)

| Ameaça | Cenário-chave |
|---|---|
| **S**poofing | Atacante obtém credencial R2/S3 e sobe dump falso (poisoning) — bucket aceita put autenticado mesmo sem ser do worker oficial |
| **T**ampering | Atacante modifica dump existente em R2 antes de WORM (Fase 2 mitiga via Object Lock; MVP R2 não tem WORM, apenas versionamento) |
| **R**epudiation | Falha silenciosa do cron — backup não roda; sem alerta, descobre-se só no próximo restore que falhou. Mitigação: heartbeat + `system_alerts critical` se últimas 24h sem dump confirmado |
| **I**nformation disclosure | **Vetor crítico** — chave GPG privada vaza, dump cifrado pode ser decifrado offline. Chave nunca toca infra de produção; armazenada em vault separado com MFA + audit de acesso. Quebra nesse modelo = catastrófica → notificação 72h LGPD art. 48 |
| **D**enial of service | Cron Vercel sob ataque/quota — backup não roda; alerta dispara pra fundador agir manualmente. Worker idempotente (lock por timestamp) |
| **E**levation of privilege | Role de backup tem leitura de tudo (necessário para `pg_dump`) — abuso compromete tudo. Mitigação: role `backup_role` é read-only + sem login interativo + senha rotacionada trimestralmente + auditoria de uso |

## Áreas críticas que o threat model expandido precisa cobrir

- **Separação física de chave GPG vs dump cifrado** (regra 40 — "chaves de criptografia em backup separado do dado") — chave em vault corporativo, dump em R2/S3; comprometer um dos dois não decripta sozinho
- **Teste de restauração trimestral** ([runbook restore-test.md](../runbooks/restore-test.md), regra 40) — gera evidência de que pipeline funciona end-to-end; falha dispara incidente
- **Object Lock WORM (Fase 2)** — bucket S3 us-east-1 com retenção compliance mode 12 meses; impede DELETE mesmo do dono. Sprint 19b ativa
- **R2 sem WORM no MVP** — risco aceito; mitigado por versioning bucket + monitoramento de operações DELETE/PUT via R2 audit logs + alerta se PUT em arquivo já existente
- **Hash chain de backups** — cada dump registra `previous_hash` em `compliance_retention_log` (regra 39 análoga ao audit_log) — quebra detectável
- **Restore drill com tenant isolation validation** — após restore em ambiente temporário, validar que RLS funciona (query como tenant A não vê tenant B)
- **Cross-border** — R2 região automática (Cloudflare global); S3 us-east-1 = cross-border. DPA + sub-processor declarados em [`dpo.md`](../compliance/dpo.md)
- **Retenção alinhada à regra 34** — 12 meses de dumps weekly = 52 dumps; mensais e anuais a partir do 13º mês conforme política
- **Drop de partição cold storage Parquet (ADR 0072)** — pipeline de archive a partir do 5º ano usa caminho separado deste backup; threat model do archive merece análise própria quando Sprint 19b+ ativar

## Riscos residuais (aceitos)

| Risco | Por que aceito | Compensação |
|---|---|---|
| Cloudflare R2 sofre breach e dumps cifrados vazam | Provider externo, cobertura LGPD via DPA | Criptografia GPG AES-256 protege offline; chave separada; rotação anual de chave GPG (re-encrypt dumps antigos) |
| Vercel Cron falha simultânea com indisponibilidade do alerta | Falha multi-componente improvável | Backup secundário manual mensal documentado em runbook (Sprint 19b+) |
| Operador autoriza restore com PAM mas dado é exposto durante o processo | Restore é evento raro; humano supervisiona | Sessão PAM gravada + audit + notificação DPO antes de iniciar |

## Referências

- [ADR 0073 — Postura de segurança defesa em profundidade](../decisions/0073-postura-seguranca-defesa-em-profundidade.md) (camada 4)
- [Runbook restore-pg.md](../runbooks/restore-pg.md)
- [Runbook restore-test.md](../runbooks/restore-test.md)
- [Regra 40 — backup off-site + DR plan + teste trimestral](../rules.md)
- [Regra 39 — hash chain (analogia para backups)](../rules.md)
- [docs/compliance/dpo.md](../compliance/dpo.md) — sub-processors R2 / S3
