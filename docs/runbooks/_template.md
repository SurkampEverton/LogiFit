# Runbook — {{nome}}

> Template para runbooks operacionais LogiFit. Copie este arquivo, renomeie, preencha. Manter sempre **passo-a-passo executável** sem precisar de contexto adicional.

- **Quando usar:** {{quando este runbook é acionado — gatilho específico}}
- **Severidade típica:** {{p0 / p1 / p2 / p3}}
- **Tempo estimado:** {{minutos / horas}}
- **Quem executa:** {{role — fundador / dev / ops / DPO / contador externo}}
- **Última revisão:** {{YYYY-MM-DD}}

## Pré-requisitos

- [ ] Acesso a `{{sistema}}` com credenciais válidas
- [ ] MFA recente (<15min) — gate `requireRecentMfa()` **obrigatório** para qualquer ação de alto-risco (regra 43): cancelar guia TISS, anular invoice, alterar role, executar runbook destrutivo, recovery emergencial. Marcar **N/A** apenas se runbook é **read-only** (consulta sem efeito) — justificar a exceção no preenchimento.
- [ ] Sessão privilegiada PAM aberta se acesso super-admin (ADR 0073 camada 7)
- [ ] Ferramenta `{{X}}` instalada localmente
- [ ] Backup recente confirmado (RPO 24h — regra 40)

## Passos

1. **{{passo 1}}** — descrição + comando exato
   ```bash
   {{comando}}
   ```
   Resultado esperado: `{{output}}`

2. **{{passo 2}}** — ...

3. **Validar** — checklist de smoke tests pós-execução
   - [ ] {{check 1}}
   - [ ] {{check 2}}

## Rollback

Se algo der errado **antes do passo {{N}}**: simplesmente abandonar — nada foi alterado.

Se algo der errado **após passo {{N}}**:

1. {{rollback 1}}
2. {{rollback 2}}

Tempo máximo aceitável de rollback: {{X minutos/horas}}.

## Monitoramento pós-execução

- [ ] Verificar `system_alerts` críticos nas próximas 2h
- [ ] Conferir métricas em `/app/super-admin/database` (ADR 0072)
- [ ] Conferir `audit_log` para rastrear mudanças do procedimento

## Em caso de falha

Contato emergência:
- **Fundador / DPO:** privacidade@logifit.com.br
- **Sentry:** alerta automático já dispara
- **Telegram:** canal privado (config local em `.env.runbooks`)

Abrir incidente em `security_incidents` (ADR 0067) se afeta múltiplos tenants ou expõe dado.

## Histórico

| Data | Quem | O quê | Resultado |
|---|---|---|---|
| {{YYYY-MM-DD}} | {{nome}} | Primeira execução | {{ok / parcial / falha}} |
