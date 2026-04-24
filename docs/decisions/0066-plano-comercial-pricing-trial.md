# ADR 0066 — Plano comercial LogiFit — pricing, trial, cobrança, limites

- **Status:** Accepted
- **Date:** 2026-04-24 (revisado 2026-04-24 com pricing benchmarkado)

## Context

LogiFit é SaaS B2B multi-tenant. Sprint 04 planeja cobrança tenant → member (mensalidade, matrícula, etc.). Faltava formalizar a **cobrança LogiFit → tenant** (quanto custa usar a plataforma, o que inclui cada plano, como é a estrutura comercial).

### Benchmark de mercado (pesquisa abril/2026)

| Concorrente | Faixa R$/mês | Público |
|---|---|---|
| Tecnofit Lite | 99 | Academia pequena |
| Tecnofit Pro | 199 | Academia média |
| SGA Sistemas | 79-199 | Academia básica |
| ActiveWise | 149-299 | Academia |
| iClinic Pro | 119 | Consultório solo |
| iClinic Enterprise | 399 | Clínica média |
| Ninsaúde Apolo | 180-500 | Clínica |
| NutMed | 99-249 | Nutri solo |
| Amplimed | 139-369 | Clínica médica |
| Feegow | 199-599 | Clínica grande |

**Proposta inicial (R$ 149 / R$ 399 / R$ 1.500) ficou acima da média** para tenant pequeno — concorrentes como Tecnofit Pro R$ 199 e iClinic Pro R$ 119 capturam esse segmento. Pricing revisado abaixo.

### Decisões do usuário (2026-04-24)

1. **Free plan rejeitado** — trial 14 dias é suficiente para captação; Free drena recursos sem compensar no MVP
2. **Starter R$ 79 + Pro R$ 199** — preços agressivos para competir com benchmark de mercado
3. **Adicionar Business R$ 449** — tier intermediário para redes pequenas (gap entre Pro e Enterprise)
4. **Overage suave por member** — R$ 0,50/member acima do incluído, com cap = upgrade para próximo tier; evita forçar upgrade hostil quando tenant ultrapassa limite

## Decision

### 4 tiers + Enterprise + trial

| Plano | Preço anual (por mês) | Preço mensal | Perfil |
|---|---|---|---|
| **Starter** | R$ 69/mês | **R$ 79/mês** | Academia pequena independente · consultório fisio/nutri solo |
| **Pro** | R$ 179/mês | **R$ 199/mês** | Academia/clínica média · multi-profissional · todas verticais |
| **Business** | R$ 399/mês | **R$ 449/mês** | Rede pequena 5-10 unidades · multi-company · adquirência integrada |
| **Enterprise** | **sob consulta** (a partir de R$ 1.199/mês) | — | Rede grande · hospital · clínica com DPO próprio · BYOK IA · SLA · white-label |

**Desconto anual:** 2 meses grátis (~14%) — padrão SaaS BR. Pagamento upfront.

**Trial:** **14 dias** · sem cartão de crédito · features equivalentes ao **Pro** · dados retidos 30 dias após expirar se não converter (LGPD-friendly).

### O que inclui cada plano

| Item | Starter (R$ 79) | Pro (R$ 199) | Business (R$ 449) | Enterprise |
|---|---|---|---|---|
| **Companies (CNPJs)** | 1 | 1 | até 3 | ilimitado |
| **Units (locais físicos)** | 1 | até 3 | até 10 | ilimitado |
| **Members incluídos** | 100 | 500 | 2.000 | ilimitado |
| **Overage por member extra** | R$ 0,50/member/mês | R$ 0,50/member/mês | R$ 0,40/member/mês | n/a |
| **Cap de overage (força upgrade)** | +R$ 120 = upgrade para Pro | +R$ 250 = upgrade para Business | +R$ 750 = upgrade para Enterprise | n/a |
| **Users operadores** (além admin) | 2 | 10 | 30 | ilimitado |
| **Profissionais com contrato** | 2 | 10 | 30 | ilimitado |
| **Vertical Academia** | ✅ | ✅ | ✅ | ✅ |
| **Vertical Fisioterapia** | — | ✅ | ✅ | ✅ |
| **Vertical Nutrição** | — | ✅ | ✅ | ✅ |
| **Cobrança Asaas** (do tenant p/ members) | ✅ | ✅ | ✅ | ✅ |
| **Portal do paciente PWA** | ✅ | ✅ | ✅ | ✅ |
| **Controle de acesso QR (Academia)** | ✅ | ✅ | ✅ | ✅ |
| **ERP Financeiro** (AP/AR/plano contas/OCR boleto) | ✅ | ✅ | ✅ | ✅ |
| **Inbox NF-e + manifestação + devolução** | ✅ | ✅ | ✅ | ✅ |
| **Convênios TISS/TUSS** (Fisio) | — | ✅ | ✅ | ✅ |
| **Emissão fiscal Focus NFe** | — | ✅ (NFS-e) | ✅ (NFS-e + NF-e + NFC-e + eventos) | ✅ (todos) |
| **Bancos + Open Finance + conciliação** | — | ✅ | ✅ | ✅ |
| **Device Hub** (Garmin/Oura/BLE) | — | ✅ | ✅ | ✅ |
| **Pipeline Exames IA** | — | ✅ | ✅ | ✅ |
| **Nutri-Agent IA** | — | ✅ | ✅ | ✅ |
| **Churn preditivo IA** | — | ✅ | ✅ | ✅ |
| **Generative UI clínica** (Fase 2) | — | — | ✅ | ✅ |
| **Rateio + intercompany** | — | — | ✅ | ✅ |
| **Adquirência integrada** | — | ✅ | ✅ | ✅ |
| **Folha CLT + eSocial** (Sprint 40 futuro) | — | — | — | ✅ |
| **BYOK IA** | — | — | ✅ (opcional) | ✅ |
| **White-label domínio próprio** | — | — | — | ✅ |
| **DPO-as-a-service** | — | — | — | ✅ (add-on opcional) |
| **SLA 99,9%** | — | — | — | ✅ |
| **Gestor de conta dedicado** | — | — | — | ✅ |

### Quotas

| Recurso | Starter | Pro | Business | Enterprise |
|---|---|---|---|---|
| **IA (chamadas/mês)** — Gemini Flash via LogiFit | 500 | 3.000 | 10.000 | 25k ou BYOK ilimitado |
| **Storage** (fotos, exames, contratos, docs) | 5 GB | 50 GB | 200 GB | 500 GB+ (R$ 2/GB extra) |
| **Transcrição STT** (Sprint 31, Groq Whisper) | — | 60 min | 300 min | 1.500 min ou BYOK |
| **Emissões fiscais** (NFS-e + NF-e + NFC-e) | — | 500/mês | 3.000/mês | 10.000/mês + Focus fee variável |
| **Webhooks outgoing** | 10k/mês | 100k/mês | 500k/mês | 1M/mês |
| **Retenção audit log** | 12 meses | 24 meses | 36 meses | 5 anos |
| **Backup automático (Supabase point-in-time)** | 7 dias | 14 dias | 30 dias | 90 dias |

### Overage por member — regra suave

**Motivação:** tenant que cresce de 95 para 130 members **não** deve ser forçado a upgrade imediato (Starter → Pro é +R$ 120 de salto). A regra:

```
tenant_subscriptions.members_included = 100 (do plano Starter)
tenant_subscriptions.members_overage_rate_cents = 50 (R$ 0,50)

fim do mês: se members_active > members_included:
  overage = (members_active - members_included) * 0.50
  factura_mensal = plano_preco + overage

IF overage > upgrade_threshold_for_plan:
  UI sugere upgrade ao próximo tier
  após 2 ciclos consecutivos acima do threshold: upgrade automático opt-in
  após 3 ciclos: upgrade forçado no próximo ciclo (aviso 30d)
```

**Thresholds:**
- Starter: +R$ 120 (240 members overage) → sugere Pro
- Pro: +R$ 250 (500 members overage) → sugere Business
- Business: +R$ 750 (1.875 members overage) → sugere Enterprise
- Enterprise: sem overage — ilimitado

**UI:** `/app/settings/tenant/plan` mostra:
- Members atuais / incluídos
- Overage do mês corrente (preview da fatura)
- "Faça upgrade para Pro e economize R$ X/mês" (comparativo visível)

### Cobrança

- **Pagamento**: LogiFit usa Asaas próprio (root tenant). Tenant é cliente do LogiFit no Asaas; recebe boleto/PIX/cartão recorrente
- **Ciclo**: mensal (1º dia do mês seguinte) OU anual (upfront com desconto 2 meses)
- **NFS-e**: LogiFit emite automaticamente via Focus NFe (Sprint 36) — tenant recebe NFS-e no email
- **Método preferido**: PIX recorrente (Asaas Split) — sem taxa adicional; cartão tem 2% taxa absorvida pelo LogiFit
- **Overage** fatura junto com mensalidade do mês seguinte (mensalidade + overage do mês anterior)

### Inadimplência — régua (ADR 0026 + Sprint 13)

| Dia | Ação |
|---|---|
| D+0 (venc.) | Email "sua fatura venceu hoje" |
| D+3 | Email + WhatsApp (opt-in) "3 dias em atraso" |
| D+7 | Banner persistente no `/app/*`: "Fatura em atraso — regularize" |
| D+14 | Email "modo read-only em 7 dias se não regularizar" + super_admin vê alerta |
| D+21 | **Read-only mode**: tenant não cria/edita; só lê. Members/alunos continuam usando Portal Paciente normalmente |
| D+45 | **Suspenso**: nenhum login operador aceito; members vêem aviso "Plataforma temporariamente indisponível. Entre em contato com a academia". Dados preservados por 90 dias |
| D+135 | **Anonimização**: LGPD art. 16 — dados pessoais do tenant e seus members anonimizados exceto obrigação de retenção (prontuário 20a, fiscal 5a). Tenant recebe 30 dias de aviso antes |

### Upgrade / downgrade

- **Upgrade** imediato. Pró-rata calculado e adicionado à próxima fatura. Features novas disponíveis no mesmo dia
- **Downgrade** só no fim do ciclo mensal (evita gaming). UI avisa sobre features que vão desaparecer (ex: "3 guias TISS em aberto precisam ser finalizadas antes")
- **Cancelamento**: também só no fim do ciclo. Confirmação em 2 etapas. Dados mantidos por 30 dias

### Enterprise — custom

Não tem página pública de preço. Contato `contato@logifit.com.br` → call comercial → proposta com:
- **BYOK** para IA (tenant contrata direto; LogiFit não intermedia custo)
- **SLA** 99,9% com credit se violar; suporte D+1 response
- **White-label** — domínio próprio (`app.clinicavital.com.br`), logo, paleta, email from
- **Onboarding assistido** 2-4 semanas
- **Gestor de conta** dedicado
- **Integrações custom** — dev à parte
- **Retenção estendida** de logs (5 anos)
- **DPO-as-a-service** opcional (ADR 0067)
- **Contrato anual ou plurianual** com valor fixo negociado

### Schema

```sql
-- Catálogo de planos LogiFit (global curado)
logifit_plans
  id uuid pk
  slug text unique                  -- 'starter','pro','business','enterprise'
  label text
  price_monthly_cents int
  price_annual_cents int nullable   -- null = sob consulta
  members_included int
  members_overage_rate_cents int    -- 50 = R$ 0,50/member
  members_overage_cap_cents int     -- R$ 120 → sugere upgrade
  includes jsonb                    -- { units, users, storage_gb, ai_calls_month, verticals, ... }
  active bool
  archived_at timestamp nullable

-- Subscription do tenant ao plano LogiFit
tenant_subscriptions
  id uuid pk
  tenant_id uuid fk
  plan_id fk
  cycle enum ('monthly'|'annual')
  status enum ('trial'|'active'|'grace'|'read_only'|'suspended'|'cancelled')
  trial_ends_at timestamp nullable
  current_period_start timestamp
  current_period_end timestamp
  asaas_subscription_id text
  price_override_cents int nullable     -- Enterprise custom
  members_included_override int nullable -- Enterprise custom
  created_at
  cancelled_at timestamp nullable
  cancel_reason text nullable

-- Histórico de overage mensal
tenant_usage_snapshots
  id uuid pk
  tenant_id uuid fk
  period_ym text                    -- '2026-04'
  members_active int                -- count(*) de members ativos no fechamento
  members_included int              -- snapshot do plano no fechamento
  overage_amount_cents int          -- calculado
  overage_invoiced_at timestamp nullable
  created_at
  unique (tenant_id, period_ym)
```

Seeded via migration global (tenant_id NULL).

### Análise de margem

| Plano | Preço | Custo estimado | Margem | % |
|---|---|---|---|---|
| Starter R$ 79 | 79 | ~25 (infra + IA 500 + Asaas fee) | **R$ 54** | 68% |
| Pro R$ 199 | 199 | ~40 (infra + IA 3k + storage 50GB + Focus NFe) | **R$ 159** | 80% |
| Business R$ 449 | 449 | ~80 (infra + IA 10k + storage 200GB + fiscal + intercompany) | **R$ 369** | 82% |
| Enterprise R$ 1.199+ | 1.199+ | ~200 (inclui DPO parceiro + gestor conta + SLA) | **R$ 999+** | 83%+ |

**Custo inclui:** Supabase rows/storage/bandwidth, Vercel invocations, Sentry/PostHog/Logtail quota, IA (Gemini Flash via Vertex AI), Asaas fee 2-3% sobre pagamento, Focus NFe (R$ 0,15-0,50 por emissão), Upstash Redis, suporte alocado.

## Consequences

### Positivas

- **Pricing competitivo** — Starter R$ 79 abaixo de Tecnofit Lite (R$ 99); Pro R$ 199 equivalente a Tecnofit Pro
- **Trial 14 dias sem cartão** — reduz fricção; padrão de mercado
- **Overage suave** — tenant que cresce paga proporcional, sem susto de upgrade forçado
- **Cap de overage = upgrade** — evita tenant ficar pagando 3x o plano sem migrar
- **Business intermediário** — captura rede 5-10 un que hoje iria para Enterprise ou ficaria em Pro espremido
- **Enterprise sob consulta** — flexibilidade máxima para fechar contrato
- **Ciclo humano de inadimplência** — 21d até read-only preserva usuário final
- **NFS-e automática** — LogiFit emite nota sem trabalho manual
- **Margem saudável** em todos os tiers (68-83%)

### Negativas (mitigáveis)

- **Starter R$ 79 com margem 68%** — apertado; se cache semântico de IA falhar, margem cai. Monitorar trimestralmente e ajustar quota ou preço.
- **Sem Free plan** — LogiFit perde aquisição "sem fricção" que concorrentes SaaS têm (Notion, Canva). Trial 14d mitiga; reavaliar se conversão ficar baixa.
- **Overage pode confundir no início** — UI precisa mostrar **preview** do impacto antes do fim do mês. Sprint 04 entrega isso.
- **Grandfather clause** — tenant ativo precisa manter preço por ≥12 meses se LogiFit aumentar; reajuste IPCA automático anual documentado
- **Tenant com 98 members pode ficar próximo do limit** e evitar cadastrar um novo — aceitar; conversão para Pro natural quando passa de 120

### Riscos não endereçados

- **Concorrente lançar Free plan** — LogiFit pode responder com "Starter R$ 39" limitado (1 un, 30 members, features muito reduzidas) como porta de entrada. Decisão ad-hoc pós-MVP
- **Enterprise que cancela** — churn pesado. Mitigar com onboarding excelente + gestor de conta + NPS trimestral
- **Inadimplência maior que modelado** — empresa nova; revisar régua após 6 meses de produção
- **Reajuste IPCA pode parecer brusco** em ano de alta inflação — comunicar com 60d de antecedência

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Free plan R$ 0 permanente | Recusada na decisão 2026-04-24 — drena recursos sem compensar no MVP; trial 14 dias substitui; reavaliar após 12 meses se conversão ficar baixa |
| Pricing per-member como modelo principal (R$ 2/member) | Imprevisibilidade financeira para o tenant; disincentiva cadastro; UX comercial ruim ("quanto custa?" → "depende"); concorrência usa plano fixo |
| Preço antigo Starter R$ 149 + Pro R$ 399 | Acima de Tecnofit Pro (R$ 199) e iClinic Pro (R$ 119); perde tenant pequeno |
| 1 único plano flat R$ 199 "ilimitado" | Perde tenant pequeno; não escala para enterprise |
| Pagamento só anual upfront | Reduz cash flow; exclui tenant pequeno |
| Hard limit sem overage | Força upgrade hostil; tenant frustrado quando passa de 101 members |
| Sem Business intermediário | Gap de R$ 199 → R$ 1.199+ é grande demais; rede 5-10 un não se encaixa |

## Escopo de impacto

**Novo ADR:** este (0066) — revisado após benchmark de mercado.

**Sprints ajustados:**

- **Sprint 00** — landing com pricing 4 tiers (Starter/Pro/Business/Enterprise) + "fale com comercial" Enterprise + página de comparação
- **Sprint 01a** — `/signup` escolhe plano + trial 14 dias (sem cartão); `logifit_plans` + `tenant_subscriptions` + `tenant_usage_snapshots` seed com 4 planos
- **Sprint 04** — Asaas próprio LogiFit; cobrança recorrente tenant; régua inadimplência (21d/45d/135d); upgrade/downgrade UI em `/app/settings/tenant/plan`; **cálculo de overage + preview da fatura do mês**
- **Sprint 36** — emissão automática de NFS-e LogiFit→tenant todo mês (cron job)
- **Sprint 08** — `access_blocks` tipo `logifit_overdue` quando tenant em read-only (Academia — block parcial)

**Docs:**

- `docs/comercial.md` — pricing atualizado com 4 tiers + overage
- `docs/modulos.md` — módulo "Planos comerciais LogiFit" atualizado
- `CHANGELOG.md` — entrada
- `CLAUDE.md` — seção "Modelo comercial" com novos preços

## Related

- Depende de [ADR 0004 — Pagamentos Asaas](0004-pagamentos-asaas.md) — LogiFit reusa infra
- Depende de [ADR 0059 — Emissão fiscal Focus NFe](0059-ciclo-fiscal-emissao-focus-nfe.md) — emite NFS-e própria
- Depende de [ADR 0064 — Arquitetura IA](0064-ia-arquitetura-gemini-default-byok-rag.md) — quotas por plano
- Integra com [ADR 0067 — DPO + governança](0067-dpo-governanca-compliance-lgpd.md) — Enterprise inclui DPO-as-a-service add-on
- Fontes: benchmarks Tecnofit, ActiveWise, W12, Feegow, iClinic, Amplimed, Ninsaúde, NutMed, Dietpro (abril/2026)
