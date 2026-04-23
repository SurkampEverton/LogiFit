# ADR 0051 — WhatsApp inbound como canal multi-fluxo pluggable

- **Status:** Accepted
- **Date:** 2026-04-23

## Context

O Sprint 13 planejou integração WhatsApp primariamente **outbound** (régua de cobrança, confirmações de agendamento, notificações). Mensagens inbound do paciente estavam só como stretch: "Receber mensagens inbound (conversação bilateral)".

Porém, paciente hoje prefere WhatsApp como canal natural de comunicação. Cenários reais:

1. **Envio de exame laboratorial** — paciente baixou PDF do laboratório, manda direto
2. **Envio de boleto** — cliente/fornecedor manda boleto da conta do condomínio/fornecedor
3. **Foto de progresso** — aluna manda foto da barriga para avaliação antropométrica
4. **Receita médica** — paciente envia receita do cardiologista
5. **Pergunta livre** — "Dra, posso comer banana antes do treino?"

Forçar esses fluxos pelo portal web é perder engajamento. WhatsApp como ponto de entrada único aumenta adoção drasticamente.

## Decision

Ampliar Sprint 13 com **hub central de inbound pluggable** + **intent router** + **identity matcher** + **consent específico `whatsapp_exchange`**. Cada sprint consumidor registra seu handler.

### Arquitetura

```
Webhook inbound (provider WhatsApp do ADR 0025)
  ↓
identity_matcher.ts
  ├─ Busca persons.phone
  ├─ Match: prossegue com person_id resolvido
  └─ Sem match: bot pede CPF → valida → salva phone → prossegue
  ↓
intent_router.ts
  ├─ Anexo de mídia?
  │   ├─ IA leve classifica: exam, boleto, photo_progress, receipt, other
  │   ├─ Confidence ≥ 80%: roteia para handler
  │   └─ Confidence < 80%: bot pergunta "Isto é: exame / boleto / foto / receita / outro?"
  ├─ Texto livre?
  │   ├─ "ajuda", "cancelar", etc → resposta template
  │   └─ Pergunta livre → Copilot (Sprint 06) + disclaimer
  └─ Áudio?
      └─ Transcrição (Whisper) → re-roteia como texto
  ↓
handler específico (registrado pelo sprint consumidor)
  ├─ exam-upload.ts        → Pipeline Exames (Sprint 33)
  ├─ boleto-upload.ts      → AP do ERP Financeiro (Sprint 15) via OCR.space
  ├─ photo-progress.ts     → Avaliações (Sprint 12)
  ├─ receipt.ts            → Anexo prontuário (Sprint 20/21)
  ├─ copilot-question.ts   → Copilot (Sprint 06) com contexto member
  └─ fallback-human.ts     → Fila atendimento humano
  ↓
Resposta automática + grava conversation log
```

### Consent específico

- `consent.whatsapp_exchange` — paciente autoriza receber/enviar via WhatsApp
- Ativável em: 1ª interação (bot pergunta), portal `/meu/privacidade`, onboarding
- Sem consent: bot responde "Para trocar mensagens por WhatsApp, ative em seu portal: link"
- Revogação imediata; dados já trocados permanecem no sistema (direito de esquecimento solicitado explicitamente apaga)

### Identity matching

- 1ª mensagem de telefone não-cadastrado: `"Olá! Não te identifiquei. Para atender, qual seu CPF?"`
- Paciente responde CPF → sistema busca em `persons.document` no tenant
- Match: confirma nome (`"Confirma que é você, Maria Silva?"`) → salva `persons.phone` → prossegue
- No match: `"Não encontrei cadastro. Entre em contato com a recepção: (44) xxxx"`
- Tenant com alta sensibilidade (fisio, dado clínico): pode ativar chave secundária (data de nascimento) via `tenant_whatsapp_settings.require_dob`

### Classificação de anexo (IA leve)

- Modelo pequeno (Claude Haiku ou equivalente) recebe primeira página do PDF/imagem
- Prompt: "Classifique como exam | boleto | photo_progress | receipt | rx_image | other"
- Retorna type + confidence
- Se confidence ≥ 80%: processa automático
- Se < 80%: resposta conversacional para o paciente confirmar
- Log de classificação + decisão humana para treinar prompt

### Intent handlers (pluggable)

Cada sprint consumidor registra no hub:

```typescript
// packages/ai/whatsapp/intent-handlers/exam-upload.ts
registerIntentHandler({
  intent: 'exam_upload',
  handle: async (ctx) => {
    // ctx: { personId, attachmentUrl, conversationId, tenantId }
    const doc = await examPipelineSprint33.uploadDocument({
      tenantId: ctx.tenantId,
      memberId: await resolveMember(ctx.personId),
      source: 'whatsapp',
      storagePath: await downloadAndStore(ctx.attachmentUrl),
    })
    return {
      reply: `Olá ${ctx.memberName}! 📄 Recebi seu exame. Em análise pela equipe.
              Você vai ser avisada quando estiver no seu histórico.`,
    }
  },
})
```

Sprints que registram:

- **Sprint 13** entrega hub + handlers default (copilot-question, fallback-human)
- **Sprint 15** registra boleto-upload (chama OCR.space e cria AP)
- **Sprint 33** registra exam-upload (chama pipeline de exames)
- **Sprint 12** (stretch) registra photo-progress
- **Sprint 20/21** (Fase 2 Fisio) registra receipt para anexar ao prontuário

### Respostas automáticas

Templates registrados por intent + personalizados por tenant em `/app/mensagens/templates`. Exemplos:

- `exam.received`: "Olá {{member.name}}! 📄 Recebi seu {{exam.type}}. Em análise pela equipe."
- `exam.published`: "{{member.name}}, seu exame foi analisado! ✓ Ver: {{portal.link}}"
- `boleto.received`: "Recebi seu boleto de R$ {{amount}}. Encaminhado ao financeiro."
- `identity.needed`: "Olá! Não te identifiquei pelo número. Qual seu CPF?"
- `classification.confirm`: "Como devo tratar este arquivo? 1️⃣ Exame  2️⃣ Boleto  3️⃣ Receita  4️⃣ Outro"

### Rate limit e segurança

- Rate limit por telefone em Upstash Redis (reusa infra Sprint 06): 10 mensagens/min/telefone
- Dedupe por `provider_message_id` (evita reprocessar)
- Arquivos baixados validados por MIME type e tamanho (≤20MB)
- Log completo em `whatsapp_inbound_messages` + `whatsapp_conversations` com audit

## Consequences

### Positivas

- **UX radicalmente melhor**: paciente não precisa aprender portal para enviar exame
- **Adoção maior**: WhatsApp é canal que já está no bolso dele
- **Canal único para múltiplos fluxos**: exame, boleto, foto, pergunta — tudo pelo mesmo contato
- **Arquitetura pluggable**: sprints futuros adicionam handlers sem refactor
- **Reuso**: Pipeline Exames (33) + OCR (15) + Copilot (06) + Avaliação (12) ganham canal novo sem mudar seu próprio código

### Negativas (mitigadas)

- **WhatsApp não é ponta-a-ponta para Business API**: consent explícito + paciente informado; opt-out disponível
- **Classificação errada do anexo**: confiança <80% → pergunta explícita; retroalimentação para melhorar prompt
- **Custo de mensagem**: cada anexo recebido pode gerar 2-3 mensagens outbound (confirmação + status); monitorar via métricas Sprint 13
- **Paciente spam**: rate limit + se detectar abuso, bloqueia telefone com aviso
- **Spoofing**: CPF + opcionalmente data nascimento (tenant decide); números desconhecidos passam por validação antes de processar dados sensíveis

## Escopo de impacto

- **Sprint 13 Whatsapp+Régua** — cresce com inbound handler + intent router + identity matcher + classifier + consent + templates inbound
- **Sprint 15 ERP Financeiro** — handler boleto-upload (reusa OCR.space do próprio sprint)
- **Sprint 33 Pipeline Exames** — handler exam-upload (reusa pipeline inteiro)
- **Sprint 12 Avaliação** — stretch: handler photo-progress (foto antropométrica)
- **Sprint 20 Prontuário Fisio** (Fase 2) — handler receipt (anexa receita ao prontuário)
- **Sprint 06 Copilot** — handler copilot-question já previsto conceitualmente

Não cria sprint novo — cresce Sprint 13 e cada sprint consumidor ganha bullet no Commit checklist.

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Sprint novo dedicado só para WhatsApp inbound | Cria dependência artificial — cada feature espera sprint "infra" pronto antes de crescer; melhor infra ser parte do Sprint 13 |
| Cada sprint implementa seu webhook próprio | Duplica código de identity/classifier/consent; perde padronização; UX inconsistente |
| Classificação sempre manual (paciente escolhe) | Atrita fluxo mais comum (exame); IA + fallback é equilibrio melhor |
| Sem identity matching (só aceita número cadastrado) | Perde caso comum de paciente mandar do celular da esposa/filho |

## Related

- Reusa [ADR 0025 — Provider WhatsApp] (Sprint 13)
- Reusa [ADR 0035 — OCR abstrato] para classificador + anexos
- Alimenta [ADR 0050 — Pipeline Exames Laboratoriais] (Sprint 33)
- Alimenta [ADR 0033/0034 — ERP Financeiro AP] (Sprint 15)
- Respeita regras 4 (dado sensível criptografado), 5 (audit), 6 (consent)
