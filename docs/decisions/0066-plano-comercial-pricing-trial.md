# ADR 0066 — Plano comercial LogiFit — pricing, trial, cobrança, limites

- **Status:** Accepted
- **Date:** 2026-04-24 (versão inicial)
- **Versão vigente:** 2026-04-25 (3ª revisão — ver seção [Versão vigente](#versão-vigente-2026-04-25) abaixo para o estado canônico)

> **🟢 Para leitura rápida da versão vigente, pular para [Versão vigente (2026-04-25)](#versão-vigente-2026-04-25).** Seções "Decisões do usuário (2026-04-24)" + "Revisão 2026-04-25" abaixo são **histórico de evolução** preservado para rastreabilidade — **não são fonte de verdade operacional**.

## Versão vigente (2026-04-25)

| Plano | Preço mensal | Membros | Verticais | Profs | NFS-e/mês | IA/mês | Storage |
|---|---|---|---|---|---|---|---|
| **Solo** | R$ 49 | 30 | 1 à escolha | 1 | 20 | 200 | 1 GB |
| **Solo Combo** | R$ 69 | 60 | até 3 simultâneas | 1 | 30 | 200 | 2 GB |
| **Starter** | R$ 99 | 100 | **Academia (MVP)** — Fisio/Nutri liberam Fases 2/3 | 5 | 50 | 500 | 5 GB |
| **Pro** | R$ 199 | 500 | todas simultâneas | 10 | 200 | 3.000 | 50 GB |
| **Business** | R$ 449 | 2.000 | todas + multi-company (até 3 CNPJs) + intercompany + adquirência | 30 | 1.000 | 10.000 | 200 GB |
| **Enterprise** | sob consulta (~R$ 1.199+) | ilimitado | todas + white-label + DPO add-on | ilimitado | 5.000 | 25.000 ou BYOK | 500 GB+ |

**Cobrança LogiFit:** "1 active member por (paciente, tenant)" — passaporte cross-tenant ([ADR 0077](0077-passaporte-paciente-vinculo-cross-tenant.md)) **não duplica**.

**Overage member:** R$ 0,50/member acima do incluído (Solo/Combo: R$ 0,40); cap por tier força upgrade sugerido após 2 ciclos consecutivos acima do threshold.

**Overage NFS-e:** R$ 0,50 / 0,40 / 0,35 / 0,25 por nota emitida (cobre NFS-e + NF-e + NFC-e + devolução + transferência + conserto). **Eventos não contam** (cancelamento, CC-e, inutilização). Repasse calibrado sobre custo Focus NFe + margem operacional.

**Cota IA hard-stop sem overage** ([ADR 0064](0064-ia-arquitetura-gemini-default-byok-rag.md)): excedido = bloqueio até próximo ciclo + convite BYOK; runbook emergencial em [`docs/runbooks/ia-byok-emergencial.md`](../runbooks/ia-byok-emergencial.md).

**Trial:** 14d com features Pro, sem cartão; dados retidos 30d após expirar e então **anonimizados** (preserva agregados, remove PII — Sprint 01a job `process-trial-lifecycle`).

**Retenção uniforme:** todas as tabelas auditáveis seguem a tabela única em [ADR 0072](0072-escalabilidade-banco-particionamento-retencao-cold-storage.md) — `audit_log` 5 anos, prontuário 20 anos (Lei 13.787/2018), fiscal 5 anos, IA audit 1a hot + 5a cold, `patient_data_access_log` 5 anos. **Não há retenção variável por plano** — compliance regulatória prevalece sobre tier comercial.

---

## Histórico de revisões (não-vigente — preservado para rastreabilidade)

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

### Revisão 2026-04-25 — alinhamento ao ICP real (pequeno negócio de saúde solo/equipe)

Discussão com fundador (2026-04-25) sobre 3 clientes-piloto reais expôs duas falhas no Starter original:

| Cliente piloto | Realidade | Falha do Starter R$ 79 original |
|---|---|---|
| Academia de personals (5 profs compartilhando ~60 alunos) | Vertical Academia, equipe pequena com base modesta de alunos | Limite 2 profissionais força ir pra Pro mesmo com 5 funcionários e poucos alunos |
| Nutricionista solo (~60-80 pacientes) | Vertical Nutrição apenas | Starter só inclui Academia → forçada a pagar R$ 199 só pra ter Nutri |
| Clínica fisio (5 profs com pacientes próprios) | Vertical Fisio | Starter sem Fisio + limite 2 profs → forçada a pagar R$ 199 |

**Decisão (2026-04-25):**

1. **Starter sobe para R$ 99** — alinhado a Tecnofit Lite (R$ 99) e NutMed (R$ 99); +R$ 20 financia mais features no plano de entrada
2. **Starter ganha "1 vertical à escolha"** — Academia OU Fisio OU Nutri (não simultâneas); cobre o ICP "negócio solo/pequeno especializado em uma área"
3. **Limite de profissionais Starter sobe de 2 → 5** — acomoda academia de personals + clínica fisio pequena com equipe enxuta; mantém 100 members
4. **NFS-e Starter ganha 50 emissões inclusas** + R$ 0,50 por nota extra — clínica solo / consultório autônomo precisa emitir nota; Starter sem fiscal era barreira artificial
5. **Quem precisa de mais de 1 vertical (clínica integrada multi-disciplinar) vai para Pro** — degrau natural justifica os R$ 200 do Pro

## Decision

### 6 tiers (4 principais + 2 Solo) + trial

**Adicional 2026-04-25:** Planos **Solo** e **Solo Combo** foram formalizados como tiers MVP aceitos (originalmente "futuro" no rascunho desta ADR). Cobrem profissional autônomo (CREF/CREFITO/CRN/CRP/CRO/Pilates/esteticista) que não cabe no Starter. Tecnicamente são variações do schema base com `tenants.mode='solo'` (ADR 0069) — UX simplificada, templates pré-carregados, fiscal MEI/RPA.

| Plano | Preço anual (por mês) | Preço mensal | Perfil |
|---|---|---|---|
| **Solo** | R$ 44/mês | **R$ 49/mês** | **Profissional autônomo** (1 conselho profissional) atendendo 1-1 · até 30 pacientes ativos · 1 vertical · UX simplificada |
| **Solo Combo** | R$ 62/mês | **R$ 69/mês** | **Profissional autônomo combinando 2-3 áreas** (ex: nutricionista + personal trainer + pilates) · até 60 pacientes ativos |
| **Starter** | R$ 89/mês | **R$ 99/mês** | Negócio solo ou equipe ≤5 profs · **1 vertical à escolha** (Academia no MVP — Fisio/Nutri quando módulos saem nas Fases 2/3) · até 100 members |
| **Pro** | R$ 179/mês | **R$ 199/mês** | Clínica multi-disciplinar · **todas as verticais** simultâneas · até 500 members |
| **Business** | R$ 399/mês | **R$ 449/mês** | Rede pequena 5-10 unidades · multi-company · adquirência integrada |
| **Enterprise** | **sob consulta** (a partir de R$ 1.199/mês) | — | Rede grande · hospital · clínica com DPO próprio · BYOK IA · SLA · white-label · DPO-as-a-service add-on opcional |

**Desconto anual:** 2 meses grátis (~14%) — padrão SaaS BR. Pagamento upfront.

**Trial:** **14 dias** · sem cartão de crédito · features equivalentes ao **Pro** · dados retidos 30 dias após expirar se não converter (LGPD-friendly).

### O que inclui cada plano

| Item | Starter (R$ 99) | Pro (R$ 199) | Business (R$ 449) | Enterprise |
|---|---|---|---|---|
| **Companies (CNPJs)** | 1 | 1 | até 3 | ilimitado |
| **Units (locais físicos)** | 1 | até 3 | até 10 | ilimitado |
| **Members incluídos** | 100 | 500 | 2.000 | ilimitado |
| **Overage por member extra** | R$ 0,50/member/mês | R$ 0,50/member/mês | R$ 0,40/member/mês | n/a |
| **Cap de overage (força upgrade)** | +R$ 100 = upgrade para Pro | +R$ 250 = upgrade para Business | +R$ 750 = upgrade para Enterprise | n/a |
| **Users operadores** (além admin) | 3 | 10 | 30 | ilimitado |
| **Profissionais com contrato** | **5** | 10 | 30 | ilimitado |
| **Verticais** | **1 à escolha** (Academia, Fisio ou Nutri) | **Todas** simultâneas | Todas | Todas |
| **Vertical Academia** | ✅ (se escolhida) | ✅ | ✅ | ✅ |
| **Vertical Fisioterapia** | ✅ (se escolhida) | ✅ | ✅ | ✅ |
| **Vertical Nutrição** | ✅ (se escolhida) | ✅ | ✅ | ✅ |
| **Cobrança Asaas** (do tenant p/ members) | ✅ | ✅ | ✅ | ✅ |
| **Portal do paciente PWA** | ✅ | ✅ | ✅ | ✅ |
| **Controle de acesso QR (Academia)** | ✅ | ✅ | ✅ | ✅ |
| **ERP Financeiro** (AP/AR/plano contas/OCR boleto) | ✅ | ✅ | ✅ | ✅ |
| **Inbox NF-e + manifestação + devolução** | ✅ | ✅ | ✅ | ✅ |
| **Convênios TISS/TUSS** (Fisio) | — | ✅ | ✅ | ✅ |
| **Emissão fiscal Focus NFe** | ✅ (NFS-e — serviço) | ✅ (NFS-e + NF-e + NFC-e + eventos) | ✅ (NFS-e + NF-e + NFC-e + eventos) | ✅ (todos) |
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

> **Cota IA segue [ADR 0064](0064-ia-arquitetura-gemini-default-byok-rag.md)** — provider/modelo (Gemini default) e routing por task lá; aqui apenas o limite mensal por plano. **Excedido = hard-stop com convite a configurar BYOK** (não há overage IA pago — preserva previsibilidade de custo do tenant). Cache semântico (ADR 0064) reduz consumo em ~50%.

| Recurso | Solo | Solo Combo | Starter | Pro | Business | Enterprise |
|---|---|---|---|---|---|---|
| **IA (chamadas/mês)** — Gemini Flash via LogiFit | 200 | 200 | 500 | 3.000 | 10.000 | 25k ou BYOK ilimitado |
| **Storage** (fotos, exames, contratos, docs) | 1 GB | 2 GB | 5 GB | 50 GB | 200 GB | 500 GB+ (R$ 2/GB extra) |
| **Transcrição STT** (Sprint 31, Groq Whisper) | — | — | — | 60 min | 300 min | 1.500 min ou BYOK |
| **Emissões fiscais incluídas** (NFS-e + NF-e + NFC-e + devolução + transferência + conserto) | 20 NFS-e MEI | 30 NFS-e | 50 NFS-e | 200 | 1.000 | 5.000 default |
| **Overage por nota fiscal extra** | R$ 0,50/nota | R$ 0,50/nota | R$ 0,50/nota | R$ 0,40/nota | R$ 0,35/nota | R$ 0,25/nota |
| **Eventos fiscais** (cancelamento, CC-e, inutilização) | **não contam** no overage | idem | idem | idem | idem | idem |
| **Webhooks outgoing** | 1k/mês | 5k/mês | 10k/mês | 100k/mês | 500k/mês | 1M/mês |
| **Retenção audit log** | 5 anos | 5 anos | 5 anos | 5 anos | 5 anos | 5 anos |
| **Backup automático (Supabase point-in-time MVP / pgBackRest pós-19b)** | 7 dias | 7 dias | 7 dias | 14 dias | 30 dias | 90 dias |

> **Nota retenção:** uniforme em **5 anos** cross-tier porque retenção de auditoria é exigência regulatória (LGPD + ADR 0072) — não pode variar por plano comercial. Outras tabelas auditáveis seguem tabela única em [ADR 0072](0072-escalabilidade-banco-particionamento-retencao-cold-storage.md).
>
> **Nota Solo Combo IA:** mesma cota (200 chamadas/mês) que Solo simples, **não escalada com 2-3 verticais**. Racional: cota IA é por **profissional autônomo individual** (1 user real consumindo); combinar verticais não duplica o uso de IA por user. Tenant que sente cota apertada migra pra **Starter R$ 99 (500 chamadas)** com 1 vertical, ou Pro com todas + 3.000 chamadas. Cliente Solo Combo que espera "mais cota por combinar áreas" recebe degrau natural pra Starter/Pro.
>
> **Nota Solo Combo storage:** 2 GB pode ficar apertado para profissional combinando Fisio (prontuário rico + mídia clínica) + Nutri (plano alimentar + diário) + outros. Monitorar via `tenant_usage_snapshots` (Sprint 04) e oferecer upgrade pra Pro 50 GB quando passar de 80% — tag pra acompanhar canibalização Solo Combo → Pro como sinal positivo (cliente cresceu) ou negativo (Solo Combo subdimensionado, ajustar pricing).

### Overage por member — regra suave

**Motivação:** tenant que cresce de 95 para 130 members **não** deve ser forçado a upgrade imediato (Starter → Pro é +R$ 100 de salto). A regra:

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
- Starter: +R$ 100 (200 members overage) → sugere Pro
- Pro: +R$ 250 (500 members overage) → sugere Business
- Business: +R$ 750 (1.875 members overage) → sugere Enterprise
- Enterprise: sem overage — ilimitado

**UI:** `/app/settings/tenant/plan` mostra:
- Members atuais / incluídos
- Overage do mês corrente (preview da fatura)
- "Faça upgrade para Pro e economize R$ X/mês" (comparativo visível)

### Overage por nota fiscal — repasse direto

**Motivação (revisão 2026-04-25):** O modelo original assumia LogiFit absorvendo 100% do custo Focus NFe (~R$ 0,15-0,50/nota), o que **inviabiliza margem em alto volume**:

| Plano | Notas/mês típicas | Custo Focus a R$ 0,30 | % da mensalidade absorvido |
|---|---|---|---|
| Pro R$ 199 | ~500 | R$ 150 | 75% |
| Business R$ 449 | ~2.000 | R$ 600 | 134% ⚠️ (margem negativa) |

A correção é **incluir um pacote de notas no plano** + **cobrar overage proporcional** acima disso, igual à mecânica de members. Tenant que emite pouco paga o plano-base; tenant que emite muito paga proporcional ao volume real (justo + sustentável):

```
tenant_subscriptions.fiscal_emissions_included = 1000 (do plano Business)
tenant_subscriptions.fiscal_overage_rate_cents = 35 (R$ 0,35/nota extra)

fim do mês: count emissões NFS-e + NF-e + NFC-e do mês
  if emissions > included:
    fiscal_overage = (emissions - included) * 0.35
    fatura_mensal = plano_preco + members_overage + fiscal_overage
```

**Importante:** o overage cobre o **custo do provider Focus NFe** (R$ 0,15-0,30 negociado por volume) **+ margem operacional**. Não é "lucro extra" — é repasse calibrado. Quando NFS-e Nacional ([ADR 0076](0076-nfse-nacional-provider-complementar.md)) reduzir custo unitário, a tabela de overage pode cair sem afetar margem.

**UI em `/app/settings/tenant/plan`:**
- "Notas emitidas neste mês: 1.247 / 1.000 incluídas"
- "Overage fiscal estimado: R$ 86,45 (247 notas × R$ 0,35)"
- "Total previsto desta fatura: R$ 449 (plano) + R$ 86,45 (notas) = R$ 535,45"
- Comparativo: "Upgrade para Enterprise inclui 5.000 notas/mês — vale a pena se você emite >1.500 notas/mês"

**Tipos cobertos pelo contador de overage:** NFS-e + NF-e + NFC-e + NF-e devolução + NF-e transferência + NF-e conserto. Eventos (cancelamento, CC-e, inutilização) **não contam** (são correções, não novas emissões).

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
  fiscal_emissions_included int     -- 1000 = mil notas/mês inclusas
  fiscal_overage_rate_cents int     -- 35 = R$ 0,35/nota extra
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
  vertical_choice enum ('academia','fisio','nutri') nullable  -- só Starter usa; Pro+ tem todas
  trial_ends_at timestamp nullable
  current_period_start timestamp
  current_period_end timestamp
  asaas_subscription_id text
  price_override_cents int nullable     -- Enterprise custom
  members_included_override int nullable -- Enterprise custom
  created_at
  cancelled_at timestamp nullable
  cancel_reason text nullable

-- Histórico de overage mensal (members + fiscal)
tenant_usage_snapshots
  id uuid pk
  tenant_id uuid fk
  period_ym text                    -- '2026-04'
  members_active int                -- count(*) de members ativos no fechamento
  members_included int              -- snapshot do plano no fechamento
  members_overage_amount_cents int  -- calculado
  fiscal_emissions_count int        -- count(*) de fiscal_emissions completed no mês
  fiscal_emissions_included int     -- snapshot do plano no fechamento
  fiscal_overage_amount_cents int   -- calculado
  total_overage_cents int           -- soma de members_overage + fiscal_overage
  overage_invoiced_at timestamp nullable
  created_at
  unique (tenant_id, period_ym)
```

Seeded via migration global (tenant_id NULL).

### Análise de margem (revisada 2026-04-25)

**Tabela de custo Focus NFe assumida** — com volume agregado LogiFit projetado (objetivo de negociação enterprise no Sprint 36):

| Volume LogiFit total/mês | Tabela negociada Focus | Premissa para análise |
|---|---|---|
| 0-2.000 notas (early stage) | R$ 0,29/nota | conservador |
| 2.000-10.000 | R$ 0,18/nota | volume médio |
| 10.000+ (post-PMF) | R$ 0,12/nota | enterprise |

**Margem por plano com fiscal_emissions_included + overage** (premissa Focus a R$ 0,18/nota fase média):

| Plano | Preço base | Notas inclusas | Custo Focus inclusas | + outros custos | Total custo | **Margem base** | **Margem %** |
|---|---|---|---|---|---|---|---|
| Starter R$ 99 | 99 | 50 NFS-e | R$ 9 | ~16 (infra + IA 500 + Asaas + suporte) | 25 | **R$ 74** | **75%** |
| Pro R$ 199 | 199 | 200 | R$ 36 | ~40 | 76 | **R$ 123** | **62%** |
| Business R$ 449 | 449 | 1.000 | R$ 180 | ~80 | 260 | **R$ 189** | **42%** |
| Enterprise R$ 1.199+ | 1.199+ | 5.000 | R$ 900 | ~200 (DPO + SLA + conta) | 1.100 | **R$ 99+** | **8%+** ⚠️ |

**Margem em alto volume (com overage):** tenant Business que emite 2.000 notas/mês paga R$ 449 + (1.000 × R$ 0,35) = **R$ 799**. Custo: R$ 360 Focus + R$ 80 outros = R$ 440. Margem: **R$ 359 (45%)**. Sustentável.

**Enterprise alto volume:** preço base é piso, customizado por contrato. Contrato real cobra a partir de R$ 1.799-2.499 quando volume >5k notas/mês — não há prejuízo, apenas o piso público é apertado por simplicidade.

### Caminhos de melhoria contínua de margem

| Caminho | Quando ativa | Ganho esperado |
|---|---|---|
| **Negociar tabela enterprise com Focus NFe** | Sprint 36 (pré-lançamento fiscal) | R$ 0,18 → R$ 0,12 = -33% custo unitário |
| **NFS-e Nacional como complemento** ([ADR 0076](0076-nfse-nacional-provider-complementar.md)) | Pós Sprint 36 + 10k notas/mês LogiFit | Custo médio cai mais ~30-50% para municípios aderidos |
| **Cache + reuso semântico de IA** ([ADR 0064](0064-ia-arquitetura-gemini-default-byok-rag.md)) | Sprint 06 já entrega | Custo IA cai ~60% |
| **Volume LogiFit cresce** (escala em Supabase/Vercel) | Pós 50 tenants | Custo infra unitário cai ~20% |

**Custo inclui:** Supabase rows/storage/bandwidth, Vercel invocations, Sentry/PostHog/Logtail quota, IA (Gemini Flash via Vertex AI), Asaas fee 2-3% sobre pagamento, Focus NFe (tabela negociada por volume), Upstash Redis, suporte alocado.

## Consequences

### Positivas

- **Pricing competitivo** — Starter R$ 99 alinha com Tecnofit Lite (R$ 99) e NutMed (R$ 99) mas oferece **multi-vertical à escolha + IA + emissão fiscal incluída** (concorrentes não têm); Pro R$ 199 equivalente a Tecnofit Pro com vantagem multi-disciplinar
- **Trial 14 dias sem cartão** — reduz fricção; padrão de mercado
- **Overage suave** — tenant que cresce paga proporcional, sem susto de upgrade forçado
- **Cap de overage = upgrade** — evita tenant ficar pagando 3x o plano sem migrar
- **Business intermediário** — captura rede 5-10 un que hoje iria para Enterprise ou ficaria em Pro espremido
- **Enterprise sob consulta** — flexibilidade máxima para fechar contrato
- **Ciclo humano de inadimplência** — 21d até read-only preserva usuário final
- **NFS-e automática** — LogiFit emite nota sem trabalho manual
- **Margem saudável** em todos os tiers (68-83%)

### Negativas (mitigáveis)

- **Starter R$ 99 com margem 75%** — saudável; +R$ 20 vs versão anterior financia 50 NFS-e inclusas + verticais Fisio/Nutri opcionais
- **Sem Free plan** — LogiFit perde aquisição "sem fricção" que concorrentes SaaS têm (Notion, Canva). Trial 14d mitiga; reavaliar se conversão ficar baixa.
- **Overage pode confundir no início** — UI precisa mostrar **preview** do impacto antes do fim do mês (members + fiscal). Sprint 04 entrega isso.
- **Tenant pode ter 2 sources de overage** (members e fiscal) — UI deve apresentar agregado claro com breakdown opcional
- **Grandfather clause** — tenant ativo precisa manter preço por ≥12 meses se LogiFit aumentar; reajuste IPCA automático anual documentado
- **Tenant com 98 members pode ficar próximo do limit** e evitar cadastrar um novo — aceitar; conversão para Pro natural quando passa de 120
- **Repasse fiscal pode parecer "taxa extra"** na UX comercial — mitigado: copy clara "notas fiscais emitidas pelo sistema" + comparação com concorrentes que cobram nota fiscal à parte (Tecnofit Pro, iClinic Pro)

### Riscos não endereçados

- **Concorrente lançar Free plan** — LogiFit pode responder com "Starter R$ 39" limitado (1 un, 30 members, features muito reduzidas) como porta de entrada. Decisão ad-hoc pós-MVP
- **Enterprise que cancela** — churn pesado. Mitigar com onboarding excelente + gestor de conta + NPS trimestral
- **Inadimplência maior que modelado** — empresa nova; revisar régua após 6 meses de produção
- **Reajuste IPCA pode parecer brusco** em ano de alta inflação — comunicar com 60d de antecedência

## Tiers futuros (validação pendente)

### Solo — R$ 49/mês (não-MVP, registrado 2026-04-25)

Confirmado em 2026-04-25 como **opção futura válida** após implementação do MVP. Atende profissional autônomo muito pequeno (personal trainer com 30 alunos, nutricionista começando, fisioterapeuta home care iniciante) — segmento abaixo do que o Starter R$ 99 captura.

**Esboço (a refinar pós-validação):**

| Item | Valor proposto |
|---|---|
| Preço | R$ 49/mês (anuidade R$ 39) |
| Vertical | 1 à escolha (Academia, Fisio ou Nutri) |
| Members incluídos | 30 |
| Profissionais com contrato | 1 (solo) |
| Companies / Units | 1 / 1 |
| NFS-e inclusas | 20/mês |
| Overage NFS-e | R$ 0,50/nota |
| IA assistente | Camada 1 (Help/RAG) apenas — sem Camada 2/3 |
| Storage | 2 GB |
| Portal do paciente | Versão limitada (só calendário + boletos) |
| Convênios TISS/TUSS | — |
| Multi-empresa | — |
| Audit log retenção | 6 meses |

**Custo estimado LogiFit:** ~R$ 12 (infra mínima + Asaas fee + 20 notas Focus). **Margem: R$ 37 (76%)** — sustentável.

**Por que não entra no MVP:**
- Distrai do caminho crítico (4 tiers já cobrem ICP principal)
- Risco de canibalizar Starter (tenant que caberia em R$ 99 escolhe R$ 49 e fica espremido)
- Precisa validar demanda real com clientes-piloto antes de investir em tier diferenciado

**Gatilho de ativação:** ≥10 leads inbound rejeitados por preço Starter R$ 99 nos primeiros 6 meses pós-MVP. Decisão re-aberta nesse ponto.

**Bloqueado em Camada 2/3 IA:** decisão deliberada — IA executável em "Solo" reduz margem demais. Solo tem só RAG help (cache hit barato) + tools manuais via UI.

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
| **LogiFit absorver 100% do custo Focus NFe** (modelo original) | Recusada em revisão 2026-04-25 — margem em Business cai para zero ou negativa em alto volume (2.000+ notas/mês); insustentável |
| **Construir motor fiscal próprio** (substituir Focus NFe por implementação interna) | Recusada em conversa 2026-04-25 — escopo de 8-12 meses solo + manutenção fiscal eterna + risco regulatório alto; nenhum SaaS BR comparável faz; ganho marginal não compensa atraso de MVP |
| **Plano único com fiscal incluso ilimitado** | Convida abuso (tenant emite 10k notas/mês num plano R$ 199); insustentável |

## Escopo de impacto

**Novo ADR:** este (0066) — revisado após benchmark de mercado.

**Sprints ajustados:**

- **Sprint 00** — landing com pricing 4 tiers (Starter/Pro/Business/Enterprise) + "fale com comercial" Enterprise + página de comparação; **comparativo deve incluir notas fiscais inclusas + custo overage**
- **Sprint 01a** — `/signup` escolhe plano + trial 14 dias (sem cartão); `logifit_plans` + `tenant_subscriptions` + `tenant_usage_snapshots` seed com 4 planos (com `fiscal_emissions_included` + `fiscal_overage_rate_cents`)
- **Sprint 04** — Asaas próprio LogiFit; cobrança recorrente tenant; régua inadimplência (21d/45d/135d); upgrade/downgrade UI em `/app/settings/tenant/plan`; **cálculo de overage members + fiscal + preview da fatura do mês com breakdown**
- **Sprint 36** — emissão automática de NFS-e LogiFit→tenant todo mês (cron job); **count de fiscal_emissions agrega no `tenant_usage_snapshots.fiscal_emissions_count`**; **negociar tabela enterprise Focus NFe pré-lançamento (target R$ 0,12/nota acima de 10k/mês agregado)**
- **Sprint 08** — `access_blocks` tipo `logifit_overdue` quando tenant em read-only (Academia — block parcial)

**Docs:**

- `docs/comercial.md` — pricing atualizado com 4 tiers + overage
- `docs/modulos.md` — módulo "Planos comerciais LogiFit" atualizado
- `CHANGELOG.md` — entrada
- `CLAUDE.md` — seção "Modelo comercial" com novos preços

## Related

- Depende de [ADR 0001 — Stack base (Asaas como gateway de pagamento)](0001-stack-base.md) — LogiFit reusa infra
- Depende de [ADR 0059 — Emissão fiscal Focus NFe](0059-ciclo-fiscal-emissao-focus-nfe.md) — emite NFS-e própria + provider único no MVP
- Depende de [ADR 0064 — Arquitetura IA](0064-ia-arquitetura-gemini-default-byok-rag.md) — quotas por plano
- Integra com [ADR 0067 — DPO + governança](0067-dpo-governanca-compliance-lgpd.md) — Enterprise inclui DPO-as-a-service add-on
- Complementado por [ADR 0076 — NFS-e Nacional como provider complementar](0076-nfse-nacional-provider-complementar.md) — caminho de redução de custo unitário fiscal pós-Sprint 36
- Fontes: benchmarks Tecnofit, ActiveWise, W12, Feegow, iClinic, Amplimed, Ninsaúde, NutMed, Dietpro (abril/2026); revisão de modelo de custo fiscal 2026-04-25
