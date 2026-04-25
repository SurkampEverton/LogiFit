# Threat Model STRIDE — WhatsApp inbound

> **v0.1-skeleton** — STRIDE obrigatório (regras 28, 33, 36, 38 + [ADR 0073](../decisions/0073-postura-seguranca-defesa-em-profundidade.md)). Substância completa quando [Sprint 18](../sprints/13-geral-whatsapp-e-regua-cobranca.md) implementar webhook + bot first-line.

- **Feature:** WhatsApp Business inbound — paciente envia mensagem; webhook do BSP (Twilio/Gupshup/Z-API/Meta) entrega ao LogiFit; sistema roteia para bot ou profissional; mídia (foto, áudio, PDF) passa por scanUpload
- **Sprint:** [Sprint 13 — WhatsApp + Régua de Cobrança](../sprints/13-geral-whatsapp-e-regua-cobranca.md)
- **Data:** 2026-04-25 (skeleton)
- **Autor:** Fundador
- **Próxima revisão:** quando feature em produção + a cada mudança de BSP/template/bot

> Note: este threat-model cobre o WhatsApp inbound + outbound (Sprint 13 entrega ambos). Mantemos o filename `whatsapp-inbound.md` por foco em ameaças do canal recebendo dado externo (vetor mais relevante de exposição); ameaças outbound (template falso, hijack de canal) são tratadas em "Spoofing" abaixo.

## Diagrama de fluxo de dados (a expandir Sprint 18)

```
[Paciente WhatsApp] → mensagem ou template
   ↓
[Meta WhatsApp Business API]
   ↓ (webhook HTTPS)
[BSP (Twilio/Gupshup/Z-API/Meta direto)]
   ↓ (webhook LogiFit + HMAC)
[/api/webhooks/whatsapp — wrapApiHandler]
   ↓ (HMAC validation + idempotência por external_id)
[Roteamento: bot first-line OR profissional]
   ↓ (bot: classifier anti-prescrição regra 28 → resposta segura ou escala)
   ↓ (profissional: notificação push/web)
[INSERT messages (RLS) + media via scanUpload (regra 38)]
   ↓
[Cloudflare R2 cifrado (mídia) + audit_log (regra 39)]
```

**Trust boundaries:**
1. Meta → BSP — termos Meta, DPA específico
2. BSP → LogiFit webhook — HMAC obrigatório (regra 33) + IP allowlist se BSP fornece
3. Webhook → DB — RLS + idempotência
4. Bot → IA (resposta) — classifier anti-prescrição (regra 28) + cota IA por plano (ADR 0064)

## Análise STRIDE

| Ameaça | Cenário | Mitigação | Status |
|---|---|---|---|
| **S**poofing | Atacante envia webhook falso fingindo ser BSP | HMAC validation com secret BSP (env var rotacionado anualmente) + IP allowlist | 🟡 a implementar Sprint 18 |
| **S**poofing | Atacante envia mensagem com number spoof | LogiFit confia no BSP (BSP valida assinatura WhatsApp); LogiFit não autentica end-user via WhatsApp para ações críticas (ex: cancelar plano) | 🟢 política definida |
| **T**ampering | Replay de webhook | Idempotência via `external_id` BSP/Meta | 🟡 a implementar |
| **T**ampering | Manipulação de payload entre BSP e LogiFit | HMAC cobre payload completo | 🟡 a implementar |
| **R**epudiation | Tenant nega ter recebido mensagem | `messages` append-only + `audit_log` hash chain (regra 39) | 🟡 a implementar |
| **R**epudiation | Paciente nega ter enviado mensagem | LogiFit não pode provar; armazena conteúdo + número origem; em disputa, BSP/Meta tem prova primária | 🟢 aceito (responsabilidade BSP) |
| **I**nformation disclosure | Vazamento de mensagem (dado de saúde) | RLS multi-tenant + cifrado at-rest + retenção 2a + opt-out delete em /meu/privacidade | 🟡 a implementar |
| **I**nformation disclosure | Mídia (foto exame) sem proteção | scanUpload (regra 38) + R2 cifrado + signed URL TTL curto | 🟢 padrão definido |
| **I**nformation disclosure | LLM bot vaza dados de outros pacientes na resposta | RAG isolado por tenant (ADR 0064); resposta gerada sem cross-tenant + classifier output bloqueia menção a outros pacientes | 🟡 a implementar |
| **D**enial of service | Spam de leads bombardeia tenant | Rate limit por número origem + bloqueio manual + lista de bloqueados | 🟡 a implementar |
| **D**enial of service | BSP cai | Queue persistente + retry no LogiFit; mensagem outbound enfileirada; UI mostra "WhatsApp temporariamente indisponível" | 🟡 a implementar |
| **E**levation of privilege | Bot dá conselho clínico ("você tem hipertensão") | Classifier anti-prescrição (regra 28 + ADR 0053) bloqueia output que afirma diagnóstico; bot escala ao profissional para tópicos clínicos | 🟢 política definida |
| **E**levation of privilege | Bot executa ação (cancelar plano, agendar consulta) sem confirmação | Bot é Camada 1/2 IA (help/insight) — Camada 3 (action) exige UI confirm dialog (regra 41 + ADR 0075) | 🟢 política definida |

## Riscos residuais (aceitos)

| Risco | Por que aceito | Compensação |
|---|---|---|
| Meta sofre incidente que vaza histórico WhatsApp | LogiFit não controla Meta | DPA Meta + criptografia E2E padrão WhatsApp + LogiFit retém apenas o que recebe via webhook (sem media original Meta) |
| Paciente compartilha conteúdo sensível em conversa pública (família, grupo) | Comportamento humano | Aviso de privacidade no template de boas-vindas + UX educa |
| LLM bot dá resposta vaga "consulte seu médico" muitas vezes (UX ruim) | Custo de garantia anti-prescrição | A/B test de UX + template específico para casos comuns (agendamento, lembrete) que bot resolve sem IA |

## Plano de revisão

- Próxima revisão obrigatória: **antes de production launch (Sprint 18)** + a cada novo BSP/template/feature bot
- Revisar antes de:
  - [ ] Sprint 18 production launch
  - [ ] Mudar BSP (afeta DPA + HMAC)
  - [ ] Adicionar bot Camada 2 (insight, ex: "qual seu peso esta semana")
  - [ ] Mudança regulatória (Resolução ANPD canais de atendimento)

## Referências

- [Sprint 13 — WhatsApp + Régua de Cobrança](../sprints/13-geral-whatsapp-e-regua-cobranca.md)
- [ADR 0053 — CFM 2.454/2026](../decisions/0053-conformidade-cfm-2454-2026-ia-saude.md)
- [ADR 0064 — IA arquitetura](../decisions/0064-ia-arquitetura-gemini-default-byok-rag.md)
- [ADR 0075 — Assistente IA universal 3 camadas](../decisions/0075-assistente-ia-universal-tres-camadas-tool-registry.md)
- [v1.0-whatsapp.md (RIPD)](../compliance/ripd/v1.0-whatsapp.md)
- [regras 28, 33, 36, 38 em rules.md](../rules.md)
- Termos WhatsApp Business / Meta (DPA)
