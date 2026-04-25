# Runbook — Bypass emergencial de MFA (super-admin recovery)

> **v0.1 — esqueleto.** Procedimento extremo para recuperar acesso de um único super-admin LogiFit quando MFA está irrecuperavelmente quebrado (perda de TOTP + recovery codes + WebAuthn key). **Não é recovery de conta de tenant** — para isso, usar runbook `lockout-conta.md`. Será expandido pós-Sprint MFA (regra 43).

- **Quando usar:**
  - Fundador/super-admin LogiFit perdeu acesso a TOTP/WebAuthn + esgotou recovery codes
  - Recovery via DPO (autoatendimento) não funcionou — ex: portal `/meu/privacidade` está down
  - **NUNCA** usar para conta de cliente (tenant_owner) — esses passam por `lockout-conta.md`
- **Severidade típica:** p0 (operação degradada — único super-admin offline impede correção de incidentes)
- **Tempo estimado:** 30 minutos a 2 horas (depende de validação de identidade out-of-band)
- **Quem executa:** **Pelo menos 2 pessoas** — quórum mínimo (regra de duplo controle):
  - Pessoa A: pessoa em recovery (fundador) + identidade out-of-band (vídeo + documento + frase combinada)
  - Pessoa B: outro super-admin OU advogado de confiança OU sócio fundador (no MVP solo, este é o gargalo — ver "Limitação MVP solo" abaixo)
- **Última revisão:** 2026-04-25 (skeleton)

## ⚠️ Limitação MVP solo

**Em modo solo (1 fundador), este runbook não pode ser executado** — não há quórum. Mitigação:
1. **Backup físico off-line** de TOTP secret + recovery codes em cofre (regra 39 procedimento operacional)
2. **WebAuthn key física** (YubiKey) duplicada com cópia em cofre separado
3. **Cláusula contratual com advogado de confiança** detendo envelope lacrado com instruções de recovery
4. Pós primeira contratação (Sprint pós-50 tenants), pelo menos 2 super-admins ativos

Se nem o backup físico funcionar: **última opção é restaurar do backup PG anterior à habilitação MFA**, perdendo dados desde então (runbook `restore-pg.md`).

## Pré-requisitos

- [ ] **Validação de identidade out-of-band** (pessoa em recovery):
  - Videochamada com identificação clara
  - Foto do RG + selfie segurando RG
  - Frase secreta combinada previamente (registrada em cofre off-line, **NÃO** em git, **NÃO** em senha gerenciada)
- [ ] **Quórum de 2** (ver "Limitação MVP solo" se aplicável)
- [ ] Sessão privilegiada PAM (Cloudflare Access ou similar) ativa
- [ ] Contexto justificável: incidente em curso? operação rotineira?
- [ ] **Comunicar tenants pagantes** se bypass causar downtime de incident response

## Passos

### Caminho 1 — Recovery via super-admin par (preferido)

1. **Pessoa A (em recovery)** abre canal Signal/Telegram com Pessoa B
2. Validação out-of-band — vídeo + RG + frase secreta
3. **Pessoa B** acessa Vercel + Supabase com seu MFA + sessão PAM
4. Em SQL direto (Supabase Studio em pré-19b OU psql pós-19b):
   ```sql
   -- Disable MFA temporariamente para o super-admin afetado
   UPDATE users SET mfa_enabled = false, mfa_disabled_at = NOW(), mfa_disabled_by = '<pessoa B id>'
   WHERE id = '<super-admin id>' AND role = 'super_admin'
   RETURNING id, email;
   -- Audit
   INSERT INTO audit_log (action, actor, target, payload)
   VALUES ('mfa.bypass_emergencial', '<pessoa B id>', '<super-admin id>',
           jsonb_build_object('reason', 'recovery após perda total credenciais', 'quorum_witness', '<videochamada timestamp>'));
   ```
5. **Pessoa A** faz login (sem MFA, janela de 30 minutos)
   > **Exceção controlada à regra 43** (`requireRecentMfa(maxAgeMin=15)`): essa janela de 30min é **maior** que o gate padrão da regra 43 (<15min) por necessidade prática — usuário acabou de perder TOTP+WebAuthn+recovery, é impossível exigir MFA recente. Justificativa de exceção: (a) procedimento exige **2 pessoas presentes** com vídeo gravado; (b) `audit_log` recebe linha `mfa.bypass_emergencial` com `quorum_witness` (passo 4); (c) único caminho permitido é **re-cadastrar MFA imediatamente** (passo 6) — qualquer outra ação no PG durante a janela é violação operacional. Bypass permanente exige ADR formal antes de virar padrão (não há até 2026-04-25). Ver [regra 43 em rules.md](../rules.md) e [ADR 0073 camada 2](../decisions/0073-postura-seguranca-defesa-em-profundidade.md).
6. **Pessoa A** **imediatamente** re-cadastra MFA (TOTP + recovery codes + WebAuthn) em `/account/mfa`
7. Verifica que MFA voltou ativo:
   ```sql
   SELECT mfa_enabled FROM users WHERE id = '<super-admin id>';
   -- Esperado: true
   ```
8. Pessoa B encerra sessão PAM

### Caminho 2 — Recovery via cofre off-line (backup físico)

1. Acessar cofre físico (ou caixa-forte) com 2 pessoas presentes ou via advogado de confiança que detém envelope lacrado
2. Abrir envelope: contém TOTP secret + recovery codes + chave WebAuthn de backup
3. Re-importar TOTP em authenticator app
4. Login com TOTP backup
5. **Imediatamente** rotacionar todos os secrets (runbook `rotate-secrets.md`) — assumir que se cofre foi acessado, controles podem ter sido vazados

### Caminho 3 — Restore PG (último recurso, MVP solo sem cofre)

1. Identificar backup PG **anterior** à habilitação MFA
2. Restaurar em instância temporária (runbook `restore-pg.md`)
3. Cutover para instância restaurada
4. Aceitar perda de dados desde a habilitação MFA
5. **Reportar como incidente LGPD** se afeta dado de tenant — runbook `incidente-lgpd-72h.md`

## Rollback

Se bypass deu errado **antes do passo 4**: simplesmente abandonar — nenhum estado mudou.

Se bypass foi executado mas não foi recovery legítimo (suspeita de fraude pós-execução):
1. Reverter MFA imediatamente:
   ```sql
   UPDATE users SET mfa_enabled = true WHERE id = '<super-admin id>';
   ```
2. Forçar logout global do super-admin (`auth.signOutAll(<id>)`)
3. Abrir incidente em `security_incidents` severity=critical
4. Investigar quórum: a pessoa B foi enganada? deepfake?

## Monitoramento pós-execução

- [ ] Login do super-admin em janela de 30min pós-bypass — apenas 1 sessão (não múltiplas)
- [ ] MFA re-cadastrado dentro da janela
- [ ] `audit_log` registrou `mfa.bypass_emergencial` + `mfa.re_enabled`
- [ ] Sentry sem erros novos relacionados a auth
- [ ] Notificação a tenants pagantes se bypass durou >2h

## Em caso de falha

- Se Pessoa A não consegue logar mesmo após bypass: investigar se `users.email` está correto + cookie de sessão não-cacheado
- Se MFA não pode ser re-cadastrado: aplicar Caminho 3 (restore PG)
- **Sempre** abrir registro em `security_incidents` mesmo se bypass foi legítimo — auditoria precisa do trail

## Histórico

| Data | Quem em recovery | Quem testemunha | Caminho usado | Resultado |
|---|---|---|---|---|
| (a preencher) | | | | |

## Referências

- [regra 43 — MFA obrigatório em rules.md](../rules.md)
- [ADR 0073 camada 2 — autenticação](../decisions/0073-postura-seguranca-defesa-em-profundidade.md)
- [Threat model login-mfa](../threat-models/login-mfa.md)
- [Runbook rotate-secrets](rotate-secrets.md)
- [Runbook restore-pg](restore-pg.md)
- [Runbook incidente-lgpd-72h](incidente-lgpd-72h.md)
