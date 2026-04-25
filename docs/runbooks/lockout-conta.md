# Runbook — Lockout de conta (recovery de tenant_owner ou profissional)

> **v0.1 — esqueleto.** Procedimento operacional para destravar conta de cliente (tenant_owner, profissional, member) quando MFA quebra ou usuário é vítima de lockout brute-force. Diferente de [`mfa-bypass-emergencial.md`](mfa-bypass-emergencial.md) que é para super-admin LogiFit. Será expandido pós-Sprint MFA.

- **Quando usar:**
  - Tenant_owner perdeu acesso TOTP/WebAuthn + esgotou recovery codes
  - Profissional ou member ficou bloqueado após 5 falhas (regra 36) e não consegue resetar via auto-serviço
  - Atacante deliberou lockout em massa contra accounts conhecidos
- **Severidade típica:** p2 (impacto individual) — exceto se lockout em massa (p1)
- **Tempo estimado:** 15-45 minutos por conta (com validação de identidade)
- **Quem executa:** DPO (fundador no MVP) ou suporte com permission `account.unlock` (a criar Sprint 01a)
- **Última revisão:** 2026-04-25 (skeleton)

## Pré-requisitos

- [ ] Sessão privilegiada PAM aberta (ADR 0073 camada 7) **se** atuar como super_admin
- [ ] MFA recente <15min próprio (regra 43) — gate `requireRecentMfa()`
- [ ] Validação de identidade do usuário em recovery:
  - **Tenant_owner:** vídeo + RG + frase de recuperação cadastrada no onboarding
  - **Profissional:** vídeo + RG + número de conselho ativo + selfie
  - **Member:** vídeo + RG + dados de cadastro originais (data de nascimento, endereço completo) — duplo cuidado em saúde
- [ ] Acesso a `users` + `user_lockouts` + `audit_log`

## Passos

### Cenário A — Recovery por auto-serviço (preferido — usuário tenta antes de pedir suporte)

Usuário deve tentar PRIMEIRO:
1. `/recovery/recovery-code` com código de recovery one-time (criados no onboarding MFA)
2. `/recovery/email-link` com link especial enviado ao email cadastrado (TTL 30min, exige re-cadastro MFA imediato)
3. `/recovery/sms-fallback` se tenant_owner cadastrou número (recurso opcional, sem MFA reset — apenas desbloqueia lockout brute-force)

Se nenhum funcionou → escalada para suporte.

### Cenário B — Lockout brute-force (atacante tentou 5+ vezes)

1. **Identificar lockout em `user_lockouts`:**
   ```sql
   SELECT user_id, locked_until, attempts, last_ip, last_attempt_at
   FROM user_lockouts
   WHERE user_id = '<id>' AND locked_until > NOW();
   ```
2. **Validar se foi vítima** (não atacante):
   - Logs Sentry mostram tentativas de IPs distintos? → vítima de credential stuffing
   - Mesmo IP? → ou vítima esquecida ou conta comprometida
3. **Se vítima:**
   ```sql
   DELETE FROM user_lockouts WHERE user_id = '<id>';
   INSERT INTO audit_log (action, actor, target, payload)
   VALUES ('account.unlock_brute_force', '<suporte id>', '<id>',
           jsonb_build_object('reason', 'vítima credential stuffing', 'ips_observed', ARRAY[...]));
   ```
4. **Recomendar ao usuário:**
   - Trocar senha imediato
   - Habilitar/reforçar MFA
   - Verificar email principal por sinais de comprometimento

### Cenário C — Recovery MFA (tenant_owner ou profissional)

1. Validação de identidade out-of-band (vídeo + RG + frase recovery)
2. **Reset MFA** (mantém senha):
   ```sql
   UPDATE users SET mfa_enabled = false, mfa_disabled_at = NOW(),
                    mfa_disabled_by = '<suporte id>',
                    mfa_disabled_reason = 'recovery após perda credenciais — validação out-of-band'
   WHERE id = '<id>';
   ```
3. Enviar magic link especial com TTL 1h para login + obrigatoriedade de re-cadastrar MFA imediato
4. Gate de feature crítica fica off por 24h (`flags.high_risk_actions_blocked_until` = NOW + 24h):
   - Não pode assinar evolução
   - Não pode anular invoice
   - Não pode mudar role de outro user
5. Audit detalhado:
   ```sql
   INSERT INTO audit_log (action, actor, target, payload)
   VALUES ('mfa.reset_by_support', '<suporte id>', '<user id>',
           jsonb_build_object('validation_method', 'video+rg+frase',
                              'high_risk_lockout_until', '<24h depois>'));
   ```

### Cenário D — Member em lockout (paciente que perdeu acesso)

1. Validação simples (data nascimento + telefone original) — não exige out-of-band rigoroso
2. Reset senha via magic link
3. **Não há MFA obrigatório para member** (regra 43 → role member é opcional), então recovery é mais simples

## Rollback

Se reset de MFA aconteceu mas suspeita de fraude pós-execução:
1. Restaurar `mfa_enabled = true` imediatamente
2. Forçar logout global do user (`auth.signOutAll(<id>)`)
3. Abrir incidente em `security_incidents`
4. Investigar quórum: validação out-of-band foi enganada?

Se desbloqueio brute-force foi engano e a conta era atacante:
1. Re-criar lockout
2. Forçar logout
3. Bloquear IPs observados na ofensa

## Monitoramento pós-execução

- [ ] Próximo login do user em janela esperada (não além de 24-48h)
- [ ] MFA re-cadastrado se aplicável
- [ ] `audit_log` registrou ação
- [ ] `system_alerts` zerados na categoria afetada
- [ ] Se lockout em massa: rate limit por IP + Turnstile (regra 36) ainda escalando

## Em caso de falha

- Magic link não chega: verificar Resend dashboard + spam pasta + reenviar
- User reclama que não pediu reset: registrar como tentativa de fraude → `security_incidents` + investigar suporte
- Tenant_owner perdeu acesso completo (sem email backup): pode escalar para `mfa-bypass-emergencial.md` (com cuidado adicional — ele é o dono do tenant)

## Histórico

| Data | Cenário | Resultado |
|---|---|---|
| (a preencher) | | |

## Referências

- [regra 36 — rate limit em rules.md](../rules.md)
- [regra 43 — MFA em rules.md](../rules.md)
- [Threat model login-mfa](../threat-models/login-mfa.md)
- [Runbook mfa-bypass-emergencial](mfa-bypass-emergencial.md)
