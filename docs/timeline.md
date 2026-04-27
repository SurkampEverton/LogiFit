# Timeline LogiFit — caminho crítico, marcos e buffer (dev solo)

> Complementa [`roadmap.md`](roadmap.md) (status por sprint) e [`plano-estrutura.md`](plano-estrutura.md) (princípios de execução). Aqui declaramos **prazos absolutos**, **caminho crítico**, **buffer** e **gates pré-Sprint**.

- **Dev:** solo (Everton Surkamp)
- **Início efetivo planejado:** 2026-05 (a confirmar)
- **Premissa de capacidade:** ~30h efetivas/semana de execução de código + ~10h de pesquisa/ADR/compliance
- **Última revisão:** 2026-04-27

## Resumo executivo

- **MVP fechado** (Sprints 00-19 + 19b cutover): **~13-14 meses calendar** (com buffer 15%)
- **Fase 2 — Fisio** (Sprints 20-28): **+5-6 meses**
- **Fase 3 — Nutri + Mobile + Fiscal** (Sprints 29-40+): **+8-12 meses**
- **Total até "produto completo"**: **~26-32 meses** desde início efetivo

> **Sem co-founder ou ops externo, esse é um MVP com viabilidade comercial em ~14 meses, e produto completo em ~30 meses.** Compressão depende de: (a) cortar Sprints 14-18 do MVP (financeiro enterprise vai para Fase 2+), ou (b) trazer 2º dev a partir do Sprint 06.

## Caminho crítico — MVP

```
00 → 01a → 01b → 02 → 03 → 04 → 06 → 07 → 08 → 09 → 13 → 14 → 15 → 17 → 18 → 19 → 19b
                              ↑
                  fork: 05 / 10 / 11 / 12 / 16 (paralelos não-críticos)
```

**Justificativa do caminho crítico:**

- **00 (infra)** bloqueia tudo
- **01a → 01b** (identidade + RBAC) bloqueia qualquer feature de tenant
- **04 (financeiro Asaas)** bloqueia 06, 07, 13 (notificações + cobrança), 19 (churn precisa de histórico de pagamento)
- **06 (Copilot)** bloqueia toda IA subsequente; tem **5-6 semanas** declaradas — risco P1 de estourar
- **13 (WhatsApp + régua)** bloqueia 14, 19 (régua de retenção)
- **15 (ERP financeiro core)** bloqueia 17, 18, 19; tem **4 semanas** declaradas — risco P2
- **19b (cutover Oracle)** depende de MVP estável **30 dias** — não pode ser comprimido

## Cronograma absoluto (com buffer 15%)

| Sprint | Início | Fim | Timebox declarado | Com buffer 15% |
|---|---|---|---|---|
| 00 — Setup infra | M+0 (semana 1) | M+0 (semana 4) | 4 sem | 5 sem |
| 00b — Menu lateral | M+1 (sem 5) | M+1 (sem 6) | 1-2 sem | 2 sem |
| 01a — Identidade | M+1 (sem 6) | M+2 (sem 9) | 3 sem | 3.5 sem |
| 01b — RBAC + Consent | M+2 (sem 9) | M+3 (sem 12) | 3 sem | 3.5 sem |
| 02 — CRM | M+3 (sem 12) | M+3 (sem 14) | 2 sem | 2.5 sem |
| 03 — Agenda | M+3 (sem 14) | M+4 (sem 17) | 3 sem | 3.5 sem |
| 04 — Financeiro Asaas | M+4 (sem 17) | M+5 (sem 20) | 3 sem | 3.5 sem |
| 05 — Ofertas | M+5 (sem 20) | M+5 (sem 22) | 2 sem | 2.5 sem |
| **06 — Copilot IA** ⚠️ | M+5 (sem 22) | M+7 (sem 28) | **5-6 sem** | **7 sem** |
| 07 — Dashboard | M+7 (sem 28) | M+7 (sem 30) | 2 sem | 2.5 sem |
| 08 — Controle acesso Academia | M+7 (sem 30) | M+8 (sem 33) | 3 sem | 3.5 sem |
| 09 — Engajamento | M+8 (sem 33) | M+9 (sem 35) | 2 sem | 2.5 sem |
| 10 — Funil | M+9 (sem 35) | M+9 (sem 37) | 2 sem | 2.5 sem |
| 11 — Prescrições | M+9 (sem 37) | M+10 (sem 40) | 3 sem | 3.5 sem |
| 12 — Avaliações | M+10 (sem 40) | M+10 (sem 42) | 2 sem | 2.5 sem |
| 13 — WhatsApp + régua | M+10 (sem 42) | M+11 (sem 45) | 3 sem | 3.5 sem |
| 14 — DRE | M+11 (sem 45) | M+12 (sem 47) | 2 sem | 2.5 sem |
| **15 — ERP Core** ⚠️ | M+12 (sem 47) | M+13 (sem 51) | **4 sem** | **5 sem** |
| 16 — Rateio intercompany | M+13 (sem 51) | M+13 (sem 53) | 2 sem | 2.5 sem |
| 17 — Open Finance | M+13 (sem 53) | M+14 (sem 56) | 3 sem | 3.5 sem |
| 18 — Adquirência | M+14 (sem 56) | M+14 (sem 58) | 2 sem | 2.5 sem |
| 19 — IA churn | M+14 (sem 58) | M+15 (sem 61) | 3 sem | 3.5 sem |
| **+ MVP soak (30d)** | M+15 (sem 61) | M+16 (sem 65) | 4 sem | 4 sem |
| 19b — Cutover Oracle | M+16 (sem 65) | M+16 (sem 67) | 1.5-2 sem | 2.5 sem |

**MVP entregável (Sprint 19 fechado):** semana 61 → **~14 meses calendar**
**Cutover Oracle (Sprint 19b done):** semana 67 → **~15.5 meses calendar**

## Buffer global

- **Buffer por sprint:** 15% (incorporado na coluna "com buffer")
- **Buffer global adicional:** **2 semanas/trimestre** para férias, doença, imprevistos, refactor não-planejado
- **Buffer de compliance:** **2 semanas no fim do Sprint 06** para responder ANVISA (notificação SaMD do Copilot leva ~30 dias) e finalizar drill DPO

Total buffer absoluto: ~10 semanas extras = **~17 meses calendar** com buffers consumidos.

## Marcos (milestones)

| Marco | Quando | Critério de sucesso |
|---|---|---|
| **M1 — Identidade pronta** | Fim Sprint 01b (~M+3) | RLS testado, RBAC funcional, MFA enforcado para roles clínicas |
| **M2 — 1ª venda possível** | Fim Sprint 06 (~M+7) | Copilot básico + auth + RBAC + CRM. Suficiente para 1 piloto Solo R$49 |
| **M3 — Tenant Academia completo** | Fim Sprint 13 (~M+11) | Academia + WhatsApp + régua. **Beta privado com 3-5 clientes pilot** |
| **M4 — Pricing transparente** | Fim Sprint 18 (~M+14) | ERP financeiro + adquirência. Faturamento auditável + DRE |
| **M5 — MVP comercial** | Fim Sprint 19 (~M+15) | Churn IA. **Lançamento público pago** |
| **M6 — Custo otimizado** | Fim Sprint 19b (~M+17) | Migração Oracle concluída + custo infra <50% Supabase Pro |
| **M7 — Fisio em produção** | Fim Sprint 25 (~M+22) | Prontuário + TISS + ANVISA. Plano Pro com vertical Fisio |
| **M8 — Fiscal completo** | Fim Sprint 36 (~M+30) | Emissão fiscal end-to-end via Focus NFe. Plano Business |

## Gates pré-Sprint (não pode entrar em `doing` sem)

| Sprint | Gate obrigatório |
|---|---|
| 00 | Conta GitHub + Vercel + Supabase + Cloudflare R2 + Sentry + PostHog provisionadas |
| 06 | ADR 0015 (Copilot safety) publicado + ANVISA notification disparada (30d antes) + Comitê IA cadastrado |
| 13 | ADR 0025 + ADR 0026 publicados + POC BSP WhatsApp concluído |
| 15 | ADR 0033 + ADR 0034 publicados + provider OCR escolhido |
| 17 | ADR 0037 + ADR 0038 publicados + sandbox Pluggy/Belvo testado |
| 19 | ADR 0027 publicado (✅ feito 2026-04-27) + dataset de features instrumentado |
| 19b | Drill de cutover em ambiente espelho **realizado e validado** + runbook expandido + DPO comunicação tenants 30d antes |
| 20 | ADR 0028 + ADR 0032 (✅ feito 2026-04-27) + provider ICP-Brasil escolhido + DPO suplente externo contratado |

## Riscos de prazo (P1/P2)

| Sprint | Risco | Mitigação | Plano B |
|---|---|---|---|
| **06** (Copilot) | 5-6 sem viola regra 9 (teto 3 sem) | Pré-fatiar 06a (RAG + cota + tools básicas) e 06b (3 camadas + personas + FAB) | Mover 06b para depois Sprint 13 |
| **15** (ERP Core) | 4 sem + dependências OCR + provider abstrato | Pré-fatiar 15a (AP/AR + plano contas) e 15b (OCR multi-provider + NF-e XML) | Adiar 15b para após Sprint 18 |
| **19b** (Cutover) | 116 itens em 1.5-2 sem | Drill obrigatório antes; pivot "pilot tenant only" | Adiar 30 dias se MVP teve 2+ incidentes na soak |
| **14-18** (financeiro enterprise) | Escopo inflado para MVP | Avaliar mover 16-18 para Fase 2 após M3 (beta privado) | Lançar M5 sem rateio/Open Finance/adquirência avançada |

## Quando reavaliar

- **Após M3** (beta privado, ~M+11): com 3-5 clientes pilot, decidir se Sprints 14-18 são MVP-must ou Fase 2
- **Após M5** (lançamento público): contratar 2º dev se chegou a 10 clientes pagantes
- **Após M6** (cutover Oracle): se custo Oracle estável <R$ 200/mês, manter; caso contrário, considerar AWS RDS

## Atualizações deste documento

| Data | Mudança |
|---|---|
| 2026-04-27 | Documento criado a partir de auditoria de planejamento |
