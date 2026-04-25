# Threat Model STRIDE — {{Feature crítica}}

> Template para análise de ameaças aplicado em **5 features críticas obrigatórias** (regra 35-40 + [ADR 0073](../decisions/0073-postura-seguranca-defesa-em-profundidade.md)): login + sessão, pagamento Asaas, prontuário, pipeline exames, WhatsApp inbound. Outras features fazem STRIDE leve no commit checklist.
> Copie para `docs/threat-models/{{slug}}-stride.md`, preencha durante sprint da feature, atualize a cada mudança arquitetural.

- **Feature:** {{nome}}
- **Sprint:** {{N}}
- **Data:** {{YYYY-MM-DD}}
- **Autor:** {{nome}}
- **Revisão:** {{data próxima revisão}}

## Diagrama de fluxo de dados

```
{{ASCII ou link para diagrama externo}}
[Cliente] → [Edge Vercel] → [Server Action] → [DB Postgres + RLS]
                                ↓
                        [Provider externo X]
```

Identificar **trust boundaries** (linhas onde dados cruzam zona de confiança):
1. Cliente → Edge (DDoS + WAF Cloudflare — ADR 0073 camada 1)
2. Edge → Server Action (auth + MFA + rate limit — regras 36, 43)
3. Server Action → DB (RLS + Drizzle param binding — regras 1, 3)
4. Server Action → Provider externo (safeFetch + allowlist — regra 37)

## Análise STRIDE

| Ameaça | Cenário | Mitigação | Status |
|---|---|---|---|
| **S**poofing (identidade falsa) | {{ex: atacante usa magic link de outro user}} | TTL 15min + binding por `user_agent` + audit | ✅ implementado |
| **T**ampering (modificação não autorizada) | {{ex: atacante altera payload Asaas webhook}} | HMAC validation + idempotência via `external_id` | ✅ implementado |
| **R**epudiation (negar ação) | {{ex: profissional nega ter assinado prontuário}} | Hash chain `audit_log` (regra 39) + ICP-Brasil (CFM 2.299) | ✅ implementado |
| **I**nformation disclosure (vazamento) | {{ex: tenant A vê dado de tenant B}} | RLS multi-tenant + teste CI (regra 2) | ✅ implementado |
| **D**enial of service | {{ex: bombardeio de Server Actions}} | Rate limit Upstash + Cloudflare WAF (regras 36, ADR 0073 camada 1) | ✅ implementado |
| **E**levation of privilege | {{ex: member ganha permissions de admin}} | RBAC com expires_at + audit + grants validados (regra 6) | ✅ implementado |

## Riscos residuais (aceitos)

| Risco | Por que aceito | Compensação |
|---|---|---|
| {{ex: latência de cold storage para auditoria histórica >2a}} | Caso muito raro (LGPD art. 18) | Job assíncrono + notificação ao titular |

## Plano de revisão

- Próxima revisão obrigatória: **{{quando — semestral por default}}**
- Revisar antes de:
  - [ ] Lançar nova versão da feature
  - [ ] Adicionar novo provider externo
  - [ ] Mudança regulatória relevante (LGPD, CFM, ANVISA)
  - [ ] Incidente de segurança relacionado

## Referências

- [ADR 0073 — Postura de segurança defesa em profundidade](../decisions/0073-postura-seguranca-defesa-em-profundidade.md)
- [OWASP Top 10 2021](https://owasp.org/Top10/)
- [STRIDE — Microsoft Threat Modeling](https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats)
