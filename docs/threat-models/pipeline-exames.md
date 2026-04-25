# Threat Model STRIDE — Pipeline de exames laboratoriais com IA

> **v0.1-skeleton** — STRIDE obrigatório (regras 28, 33, 38 + [ADR 0073](../decisions/0073-postura-seguranca-defesa-em-profundidade.md) + [ADR 0050](../decisions/0050-pipeline-exames-laboratoriais.md)). SaMD Classe II — feature de **alto risco**. Substância completa quando [Sprint 33](../sprints/33-geral-pipeline-exames.md) iniciar.

- **Feature:** Pipeline exames — upload PDF/JPG → scanUpload → OCR Vertex AI → extração analitos → interpretação conservadora IA → revisão humana obrigatória → liberação
- **Sprint:** [Sprint 33 — Pipeline exames](../sprints/33-geral-pipeline-exames.md)
- **Data:** 2026-04-25 (skeleton)
- **Autor:** Fundador
- **Próxima revisão:** **antes de production launch** + auditoria de viés trimestral (CFM 2.454/2026)

## Diagrama de fluxo de dados (a expandir Sprint 33)

```
[Profissional ou paciente] → /app/exames → upload PDF/JPG
   ↓ (Server Action wrapAction)
[scanUpload (regra 38): MIME real + magic bytes + ClamAV + embed proibido]
   ↓
[Cloudflare R2 (cifrado AES-256-GCM)]
   ↓
[Job OCR Vertex AI (BR) — safeFetch allowedHosts]
   ↓
[Extração analitos via LLM com schema Zod (estruturado)]
   ↓
[withAiClassGate — Comitê IA do tenant + ata]
   ↓
[Interpretação conservadora (recusa se confiança baixa)]
   ↓
[ai_audit_log: input, output, modelo, samd_class, decisão humana]
   ↓
[REVISÃO HUMANA OBRIGATÓRIA — profissional libera para paciente]
   ↓
[exam_results visível em /app/me/exames]
```

**Trust boundaries:**
1. Upload → scanUpload — bloqueio de embed JS / Office macro / EICAR
2. Upload → R2 — cifrado at-rest + signed URL com TTL curto
3. Server → Vertex AI — safeFetch allowedHosts (regra 37) + timeout
4. IA → DB — schema Zod valida output + classifier anti-prescrição (regra 28)
5. Liberação ao paciente — gate humano bloqueante

## Análise STRIDE

| Ameaça | Cenário | Mitigação | Status |
|---|---|---|---|
| **S**poofing | Atacante envia PDF falso fingindo ser laboratório | OCR é apenas extração; profissional valida fonte do laudo (ID lab, CRM solicitante) antes de liberar | 🟡 a implementar Sprint 33 |
| **S**poofing | Atacante envia PDF infectado (JS embed, polyglot) | scanUpload (regra 38) bloqueia: MIME real, magic bytes, embed proibido, ClamAV | 🟢 padrão definido |
| **T**ampering | Modificação de analitos extraídos antes da revisão profissional | Schema Zod valida ranges; alteração manual gera evento `audit_log`; profissional vê diff lab vs. extraído | 🟡 a implementar |
| **T**ampering | Atacante manipula prompt da IA (prompt injection no PDF) | LLM com system prompt rígido (`buildSystemPrompt` regra 32) + classifier anti-prescrição (regra 28) + extração estruturada (não-conversacional) | 🟡 a implementar |
| **R**epudiation | Profissional nega ter liberado interpretação errada | `ai_audit_log` + audit_log hash chain (regra 39) + log da revisão (timestamp, profissional, alterações vs. sugestão IA) | 🟡 a implementar |
| **R**epudiation | Paciente nega ter recebido resultado | `notification_log` + read receipt + signed URL access logged | 🟡 a implementar |
| **I**nformation disclosure | Vazamento de PDF de exame (sensível) | RLS + cifrado R2 + signed URL TTL 5min + retenção 5a com cold storage Parquet | 🟢 padrão definido (regra 34) |
| **I**nformation disclosure | Embedding vetorial vaza dado clínico em busca | RAG isolado por tenant; embeddings nunca cruzam tenant; cota IA por plano (ADR 0064) | 🟢 padrão definido |
| **D**enial of service | Upload de PDFs gigantes para travar pipeline | Limite tamanho (50MB) + rate limit por user/dia + circuit breaker queue OCR | 🟡 a implementar |
| **D**enial of service | Vertex AI BR cai | Cota IA hard-stop por plano evita degradação cross-tenant; fallback BYOK opcional (regra 17 + ADR 0064) | 🟡 a implementar |
| **E**levation of privilege | IA libera resultado direto ao paciente sem revisão | **BLOQUEADO** — gate humano obrigatório (CFM 2.454/2026 + classifier anti-prescrição); paciente só vê após `released_by_professional_at IS NOT NULL` | 🟢 política definida (regra 28) |
| **E**levation of privilege | Tenant ativa feature sem Comitê IA | `withAiClassGate` bloqueia hard — feature flag não passa | 🟢 padrão definido (regra 28 + ADR 0053) |

## Riscos residuais (aceitos)

| Risco | Por que aceito | Compensação |
|---|---|---|
| Bias algorítmico em populações sub-representadas no treinamento | Modelos comerciais (Vertex/Gemini) têm bias inerente | Auditoria trimestral + opção de fallback "interpretação manual sem IA"; aviso UX "IA é apoio, decisão é profissional" |
| Profissional confia cegamente na IA sem revisar | Comportamento humano | UI força clicar em "Revisei e concordo" antes de liberar; classifier de output obriga texto profissional não cópia-cola |
| OCR erra valor (vírgula → ponto, etc.) | Inerente a OCR | Schema Zod valida ranges; profissional vê PDF original lado a lado |

## Plano de revisão

- Próxima revisão obrigatória: **antes de production launch** + **trimestral** (auditoria de viés)
- Revisar antes de:
  - [ ] Sprint 33 production launch
  - [ ] Adicionar novo tipo de exame (genético, imagem)
  - [ ] Mudar modelo IA (de Gemini para Claude/GPT)
  - [ ] Mudança CFM 2.454 (ago/2026)
  - [ ] Incidente clínico relacionado a interpretação errada

## Referências

- [Sprint 33](../sprints/33-geral-pipeline-exames.md)
- [ADR 0050 — Pipeline exames](../decisions/0050-pipeline-exames-laboratoriais.md)
- [ADR 0053 — CFM 2.454/2026 IA saúde](../decisions/0053-conformidade-cfm-2454-2026-ia-saude.md)
- [ADR 0064 — IA arquitetura Gemini default + BYOK + RAG](../decisions/0064-ia-arquitetura-gemini-default-byok-rag.md)
- [samd-classification.md](../compliance/samd-classification.md)
- [v1.0-exames-laboratoriais.md (RIPD)](../compliance/ripd/v1.0-exames-laboratoriais.md)
- [regra 28 + 38 em rules.md](../rules.md)
