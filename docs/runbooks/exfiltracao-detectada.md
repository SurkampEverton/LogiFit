# Runbook — Exfiltração de dados detectada (kill switch + bloqueio tenant)

> **v0.1 — esqueleto.** Resposta a sinal de exfiltração detectado por monitoria (volume anormal de queries, padrão de leitura cross-tenant suspeito, alerta de DLP futuro). Cobre o cenário de "dados estão saindo agora" — para post-mortem de incidente já consumado, ver [`incidente-lgpd-72h.md`](incidente-lgpd-72h.md). Será expandido após implementar primeiros sentinelas (Sprint pós-19).

- **Quando usar:**
  - `system_alerts severity=critical category=exfiltration_suspected` disparado por sentinela
  - Volume anormal de leitura `patient_data_access_log` (>50/hora por reader)
  - Picos de download em `/api/exports/*` por user/tenant não-pagante
  - Denúncia de tenant ou pesquisador externo (responsible disclosure)
  - Logs Cloudflare WAF mostram padrão de scraping
- **Severidade típica:** **p0** (urgência: estancar antes de remediar)
- **Tempo estimado:** primeiros 30 minutos críticos (estancar); investigação e remediação 24-72h
- **Quem executa:** DPO (fundador) + dev/ops (PAM session aberta)
- **Última revisão:** 2026-04-25 (skeleton)

## Pré-requisitos

- [ ] Sessão privilegiada PAM aberta com justificativa "Exfiltração suspeita {{ID}}" (ADR 0073 camada 7)
- [ ] MFA recente <15min (regra 43)
- [ ] Acesso ao Vercel + Supabase + Cloudflare WAF + Sentry + Logtail/Axiom
- [ ] Telefone canal Cloudflare emergência (se ataque ativo precisa rate limit dinâmico)

## Princípio: estancar primeiro, investigar depois

A regra é: **se há dúvida razoável de exfiltração ativa, bloquear é melhor do que esperar prova**. Falso positivo = downtime curto (recuperável); falso negativo = mais dados saindo (irrecuperável).

## Passos

### Minuto 0-15 — Estancar

1. **Identificar vetor** rapidamente:
   - Vetor A: API key/JWT comprometido — atacante usa creds válidas
   - Vetor B: Server Action com bug autoriza leitura indevida
   - Vetor C: Insider (profissional ou admin tenant) baixa em massa
   - Vetor D: Sub-processador comprometido (Supabase admin, Cloudflare workers)
2. **Estancar imediatamente:**
   - **Vetor A:** revogar sessão + rotacionar key (runbook `rotate-secrets.md` modo emergencial)
     ```sql
     UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = '<suspeito>';
     -- + rotação Asaas/Focus/etc se key específica vazou
     ```
   - **Vetor B:** rollback do deploy via Vercel CLI
     ```bash
     vercel rollback <previous-deployment-url>
     ```
   - **Vetor C:** suspender user + tenant + bloquear acesso ao app
     ```sql
     UPDATE users SET status = 'suspended', suspended_reason = 'exfiltracao_suspeita' WHERE id = '<id>';
     UPDATE tenants SET status = 'frozen', frozen_reason = 'exfiltracao_suspeita' WHERE id = '<tenant id>';
     ```
   - **Vetor D:** desabilitar provider afetado (bloquear sub-processador no allowlist) + ativar fallback se houver
3. **Audit + alerta crítico:**
   ```sql
   INSERT INTO audit_log (action, actor, target, payload)
   VALUES ('security.exfiltration_kill_switch', '<dpo id>', '<tenant ou user id>',
           jsonb_build_object('vector', '<A/B/C/D>', 'evidence', '<links>'));
   INSERT INTO system_alerts (severity, category, summary, details)
   VALUES ('critical', 'exfiltration_kill_switch', 'Kill switch ativado para {{target}}', '...');
   ```
4. **Comunicação interna:** Telegram canal privado + email DPO + (se hours business) ligar fundador

### Minuto 15-60 — Quantificar

5. **Reconstruir timeline forense** (similar a `incidente-lgpd-72h.md` mas com foco em "o que saiu"):
   - `audit_log` da janela: quais ações de leitura?
   - `patient_data_access_log` (regra 42): leituras cross-tenant
   - Vercel logs: requisições outbound suspeitas
   - Cloudflare logs: requisições servidas + bytes
6. **Estimar dados exfiltrados:**
   - Linhas lidas × tamanho médio do registro
   - Categorias atingidas (saúde, financeiro, biometria — afeta classificação LGPD)
   - Quantos titulares?
7. **Confirmar exfiltração** (vs. falso positivo):
   - Vetor A: queries em scale (não 1-2 leituras de teste)
   - Vetor B: padrão repetitivo automatizado
   - Vetor C: download de export gigante
   - **Falso positivo:** profissional legítimo fazendo backup local autorizado (verificar `audit_log` action vs. denúncia)

### Hora 1-72 — Notificação e remediação

8. **Acionar runbook `incidente-lgpd-72h.md`** — notificação ANPD + titulares + tenants pagantes
9. **Investigar root cause:**
   - Vetor A: como vazou a key? (logs, GitHub, ex-colaborador)
   - Vetor B: code review do PR que introduziu bug + threat-model atualizado
   - Vetor C: contratual + civil — denúncia ao conselho profissional + ação cível
   - Vetor D: status page + DPA invocado + provider notifica suas medidas
10. **Remediação técnica:**
    - Bug fix + deploy + smoke test
    - Hardening de sentinela: alerta gatilha em 1/3 do volume que disparou
    - Rate limit por user, não só por IP, em endpoints sensíveis
    - DLP em export (Sprint pós-19) — assinatura digital + watermark visível em PDFs

## Rollback

Se foi falso positivo:
1. Reverter suspensão:
   ```sql
   UPDATE users SET status = 'active', suspended_reason = NULL WHERE id = '<id>';
   UPDATE tenants SET status = 'active', frozen_reason = NULL WHERE id = '<id>';
   ```
2. Magic link de recovery para usuário
3. Pedir desculpas ao tenant + creditar 1 mês de plano por incômodo
4. Documentar lição no histórico — refinar sentinela para evitar re-FP

## Monitoramento pós-execução

- [ ] Volume de queries do vetor identificado normalizado
- [ ] Sentinelas reativados e ajustados (sensibilidade)
- [ ] `system_alerts critical` zerado em 24h
- [ ] Sentry sem novos events do mesmo padrão
- [ ] Notificações ANPD/titulares confirmadas (timeline 72h)
- [ ] DLP/watermark hardening planejado em sprint próximo

## Em caso de falha (não consegue estancar)

- Cloudflare emergency rate limit via API (aplica regra global)
- Em casos extremos: deploy "manutenção" (Vercel) bloqueando todas as requisições por 30min até estancar
- **Aceitar que falso negativo de bloqueio total é melhor que vazamento contínuo** — comunicar tenants em <2h sobre downtime

## Histórico

| Data | Vetor | Volume estimado | Notificação ANPD? | Resultado |
|---|---|---|---|---|
| (a preencher) | | | | |

## Referências

- [regra 39 — hash chain em rules.md](../rules.md)
- [regra 42 — passaporte cross-tenant em rules.md](../rules.md)
- [ADR 0073 camada 6/7 — auditoria + DLP futuro](../decisions/0073-postura-seguranca-defesa-em-profundidade.md)
- [Runbook incidente-lgpd-72h](incidente-lgpd-72h.md)
- [Runbook rotate-secrets](rotate-secrets.md)
- [Runbook falha-hash-chain](falha-hash-chain.md)
