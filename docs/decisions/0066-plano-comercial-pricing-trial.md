# ADR 0066 — Plano comercial LogiFit — pricing, trial, cobrança, limites

- **Status:** Accepted
- **Date:** 2026-04-24

## Context

LogiFit é SaaS B2B multi-tenant. Sprint 04 planeja cobrança tenant → member (mensalidade, matrícula, etc.). Faltava formalizar a **cobrança LogiFit → tenant** (quanto custa usar a plataforma, o que inclui cada plano, como é a estrutura comercial).

Sem decisão prévia, cada sprint assumia pricing implícito:
- Sprint 04 "planos do tenant" — refere-se a planos que o tenant vende para seus members, não à cobrança LogiFit
- ADR 0064 já estabeleceu quotas de IA por plano: 500 / 3.000 / 10.000 chamadas/mês
- Sprint 36 (Fiscal) assume que LogiFit emite NFS-e para tenant — mas de qual valor?

Este ADR fecha a estrutura comercial.

## Decision

### 3 planos + trial

| Plano | Preço/mês (anual) | Preço/mês (mensal) | Perfil |
|---|---|---|---|
| **Starter** | R$ 129/mês | R$ 149/mês | Independente pequena: 1 academia familiar, consultório fisio/nutri solo |
| **Pro** | R$ 349/mês | R$ 399/mês | Média: academia estabelecida, rede pequena, consultório multi-profissional |
| **Enterprise** | **sob consulta** (a partir de R$ 1.499/mês) | — | Rede com ≥5 unidades, hospital, clínica grande, BYOK IA, SLA, white-label |

**Desconto anual:** 2 meses grátis (~14%) — padrão de mercado SaaS BR.

**Trial:** **14 dias** gratuitos · **sem cartão de crédito** · todas as features do plano Pro · dados mantidos por 30 dias após trial se não converter.

### O que inclui cada plano

| Item | Starter | Pro | Enterprise |
|---|---|---|---|
| **Companies (CNPJs)** | 1 | 1 | ilimitado |
| **Units (locais físicos)** | 1 | até 3 | ilimitado |
| **Members ativos** | até 150 | até 500 | ilimitado |
| **Users operadores** (além do admin) | 2 | 10 | ilimitado |
| **Profissionais com contrato** | 2 | 10 | ilimitado |
| **Vertical Academia** | ✅ | ✅ | ✅ |
| **Vertical Fisioterapia** | — | ✅ | ✅ |
| **Vertical Nutrição** | — | ✅ | ✅ |
| **Cobrança Asaas (para members)** | ✅ | ✅ | ✅ |
| **Portal do paciente PWA** | ✅ | ✅ | ✅ |
| **Controle de acesso QR (Academia)** | ✅ | ✅ | ✅ |
| **ERP Financeiro** (AP/AR/plano de contas/OCR boleto) | ✅ | ✅ | ✅ |
| **Inbox NF-e + manifestação + devolução** | ✅ | ✅ | ✅ |
| **Convênios TISS/TUSS** (Fisio) | — | ✅ | ✅ |
| **Emissão fiscal Focus NFe** | — | ✅ (NFS-e) | ✅ (NFS-e + NF-e + NFC-e + eventos) |
| **Bancos + Open Finance + conciliação** | — | ✅ | ✅ |
| **Device Hub** (wearables Garmin/Oura) | — | ✅ | ✅ |
| **Pipeline Exames IA** | — | ✅ | ✅ |
| **Generative UI clínica** (Fase 2) | — | — | ✅ |
| **Nutri-Agent IA** | — | ✅ | ✅ |
| **Churn preditivo IA** | — | ✅ | ✅ |
| **Rateio + intercompany** | — | — | ✅ |
| **Adquirência integrada** | — | ✅ | ✅ |
| **Folha CLT + eSocial** (futuro Sprint 40) | — | — | ✅ |

### Quotas

| Recurso | Starter | Pro | Enterprise |
|---|---|---|---|
| **IA (chamadas/mês)** — Gemini Flash via LogiFit | 500 | 3.000 | 10.000 ou ilimitado BYOK |
| **Storage** (fotos avaliação, exames, contratos, docs) | 5 GB | 50 GB | 500 GB (+R$ 2/GB extra) |
| **Transcrição STT** (min/mês) — Groq Whisper via LogiFit | — | 60 min | 600 min ou BYOK |
| **Emissões fiscais** (NFS-e + NF-e + NFC-e via Focus NFe) | — | 500/mês | 5.000/mês (+custo Focus variável) |
| **Webhooks outgoing** (para sistemas do tenant) | 10k/mês | 100k/mês | 1M/mês |
| **Portal paciente PWA** — members ativos | limite members | limite members | ilimitado |
| **Retenção de logs de auditoria** | 12 meses | 24 meses | 5 anos |

### Cobrança

- **Pagamento**: LogiFit usa Asaas próprio (root tenant). Tenant é cliente do LogiFit no Asaas; recebe boleto/PIX/cartão recorrente via Asaas (ADR 0004).
- **Ciclo**: mensal (1º dia do mês seguinte) OU anual (com desconto 2 meses, upfront)
- **NFS-e**: LogiFit emite automaticamente via Focus NFe (Sprint 36) — tenant recebe nota fiscal eletrônica no email cadastrado
- **Método preferido**: PIX recorrente (Asaas Split) — sem taxa adicional; cartão tem 2% taxa absorvida pelo LogiFit
- **Antecipação**: não aplicável (LogiFit recebe mensal; não há antecipação)

### Inadimplência — régua (ADR 0026 + Sprint 13)

| Dia | Ação |
|---|---|
| Vencimento (D+0) | Email "sua fatura venceu hoje" |
| D+3 | Email + WhatsApp (opt-in) "3 dias em atraso" |
| D+7 | Banner persistente no `/app/*`: "Fatura em atraso — regularize" |
| D+14 | Email "modo read-only em 7 dias se não regularizar" + super_admin vê alerta |
| D+21 | **Read-only mode**: tenant não cria/edita; só lê. Members/alunos continuam usando Portal Paciente normalmente (proteção ao usuário final) |
| D+45 | **Suspenso**: nenhum login operador aceito; members vêem aviso "Plataforma temporariamente indisponível. Entre em contato com a academia". Dados preservados por 90 dias. |
| D+135 (4,5 meses após venc.) | **Anonimização**: LGPD art. 16 — dados pessoais do tenant e seus members anonimizados exceto obrigação de retenção (prontuário 20a, fiscal 5a). Tenant recebe 30 dias de aviso antes. |

### Upgrade / downgrade

- **Upgrade** imediato. Pró-rata calculado e adicionado à próxima fatura. Features novas disponíveis no mesmo dia.
- **Downgrade** só no fim do ciclo mensal (evita gaming). Aviso no `/app/settings/tenant/plan` sobre o que vai desaparecer (ex: "você vai perder acesso a Convênios TISS; 3 guias em aberto precisam ser finalizadas antes").
- **Cancelamento**: também só no fim do ciclo. Confirmação em 2 etapas (email + botão). Dados mantidos por 30 dias (recupera se mudar de ideia); depois anonimização (LGPD).

### Enterprise — custom

Enterprise não tem página de preço público. Contato leva a formulário → call comercial → proposta com:

- **BYOK** para IA (tenant contrata direto; custo passa do LogiFit para o tenant)
- **SLA** — uptime 99.9% com credit se violar; suporte com D+1 response
- **White-label avançado** — domínio próprio (`app.clinicavital.com.br`), logo, paleta de cores, email `from` custom
- **Onboarding assistido** — setup de 2-4 semanas com LogiFit
- **Gestor de conta** dedicado
- **Integrações custom** — LogiFit aceita dev especificamente para o cliente (projeto à parte)
- **Retenção estendida de logs** (5 anos vs 2 Pro)
- **DPO-as-a-service** opcional (ADR 0067)
- **Contratos anuais ou plurianuais** com valor fixo

### Schema

```sql
-- Catálogo de planos LogiFit (global curado)
logifit_plans
  id uuid pk
  slug text unique       -- 'starter','pro','enterprise'
  label text
  price_monthly_cents int
  price_annual_cents int nullable -- null = sob consulta
  includes jsonb          -- { units, members, users, storage_gb, ai_calls_month, ... }
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
  asaas_subscription_id text   -- ref externa Asaas
  price_override_cents int nullable  -- Enterprise custom
  created_at
  cancelled_at nullable
  cancel_reason text nullable
```

Seeded via migration global (tenant_id NULL).

## Consequences

### Positivas

- **Pricing transparente** — Starter/Pro públicos no site; Enterprise discovery call
- **Trial sem cartão** — reduz fricção de experimentar; tenant pequeno testa antes
- **Ciclo de inadimplência humano** — 21 dias até read-only preserva usuário final (members/alunos) do tenant em débito
- **Upgrade amigável** (pró-rata) — incentiva mover pra Pro quando sente limite
- **Enterprise sob consulta** — flexibilidade para fechar contrato grande
- **NFS-e automática** — LogiFit emite nota fiscal própria sem trabalho manual (Sprint 36 cobre)
- **LogiFit vira seu próprio tenant** — dogfooding do sistema (testa edge cases em produção)

### Negativas (mitigáveis)

- **Preço perto do concorrente** (W12, Tecnofit na faixa R$ 200-400) — LogiFit precisa diferenciar por IA + Fisio + conformidade. Acompanhar preço do mercado trimestralmente.
- **Custo real de IA na Starter (R$ 1-3)** come ~1% da margem — aceitável; cache reduz
- **Pricing pode mudar no futuro** — grandfather clause: tenant ativo mantém preço por ≥12 meses; reajuste IPCA automático anual
- **Tenant pequeno que explode storage** (5GB pequeno se ele upload muitos exames) — upgrade ou R$ 2/GB extra
- **Trial 14 dias pode ser curto** para alguns perfis — oferecer extensão manual sob pedido

### Riscos não endereçados

- **Tenant em Enterprise que cancela** — churn pesado. Mitigar com onboarding excelente + gestor de conta.
- **Concorrente lançar preço abaixo do Starter** (ex: freemium) — LogiFit pode responder com plano "Free" de 1 unidade + 30 members; decisão ad-hoc.
- **Inadimplência acima do modelado** — empresa nova, sem histórico; revisar régua após 6 meses de produção.

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Freemium (plano R$ 0 para sempre) | Custo de IA + storage + Asaas fee comem margem; tenant que só usa grátis não gera valor |
| 1 único plano flat R$ 399 "ilimitado" | Perde tenant pequeno; não escala para enterprise |
| Preço por member (R$ 2/member/mês) | Dificulta previsão do tenant; gera fricção quando member cancela |
| Pagamento só anual upfront | Reduz cash flow na entrada; exclui tenant pequeno que não tem capital |
| Sem trial | Aumenta fricção e hesitação; padrão de mercado é ter trial |
| Read-only permanente em inadimplência | Prejudica member/aluno do tenant; LGPD obriga tratar dado; melhor ciclo até suspensão |

## Escopo de impacto

**Novo ADR:** este (0066).

**Sprints ajustados:**

- **Sprint 00** — landing com pricing Starter/Pro + "fale com comercial" Enterprise
- **Sprint 01a** — `/signup` escolhe plano + trial 14 dias (sem cartão); `logifit_plans` + `tenant_subscriptions` seed
- **Sprint 04** — Asaas próprio do LogiFit configurado; cobrança recorrente tenant; régua de inadimplência (21d→45d→135d); upgrade/downgrade UI em `/app/settings/tenant/plan`
- **Sprint 36** — emissão automática de NFS-e do LogiFit para tenant todo mês (cron job)
- **Sprint 08** — `access_blocks` tipo `logifit_overdue` quando tenant em read-only (Academia — block parcial)

**Docs:**

- `docs/comercial.md` — atualiza com pricing e features por plano
- `docs/modulos.md` — módulo "Planos comerciais LogiFit"
- `CHANGELOG.md` — entrada
- `CLAUDE.md` — nota sobre tier matrix

## Related

- Depende de [ADR 0004 — Pagamentos Asaas](0004-pagamentos-asaas.md) — LogiFit reusa infra de cobrança
- Depende de [ADR 0059 — Emissão fiscal Focus NFe](0059-ciclo-fiscal-emissao-focus-nfe.md) — emite NFS-e própria
- Depende de [ADR 0064 — Arquitetura IA](0064-ia-arquitetura-gemini-default-byok-rag.md) — quotas de IA por plano
- Integra com [ADR 0067 — DPO + governança](0067-dpo-governanca-compliance-lgpd.md) — pricing Enterprise inclui DPO-as-a-service
- Fontes: benchmarks Tecnofit, ActiveWise, W12, TotalPass, Bitrix24, referências SaaS BR
