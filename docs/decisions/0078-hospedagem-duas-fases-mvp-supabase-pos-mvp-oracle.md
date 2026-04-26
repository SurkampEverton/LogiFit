# ADR 0078 — Hospedagem em duas fases: MVP em Vercel + Supabase Pro · pós-Sprint 19 migra pra Vercel + Postgres no Oracle Cloud free tier

- **Status:** Accepted
- **Date:** 2026-04-25

## Context

Conversa de visão de produto (2026-04-25) levantou questão fundamental que o repo nunca tinha formalizado em ADR: **onde LogiFit roda?**

A stack base ([ADR 0001](0001-stack-base.md)) lista "Vercel + Supabase" como infra default, mas sem documentar quando esse modelo deixa de servir. A discussão evidenciou:

1. **Usuário tem experiência DevOps real** — opera projeto Deep Control (whitelabel) em Oracle Cloud OCI com Docker, multi-tier (Tier0 → Principal → Secundário → Cliente), GHCR, rolling update via update-agent, sync customizado entre nós, ML worker. Não é dev iniciante terceirizando ops.
2. **[ADR 0077](0077-passaporte-paciente-vinculo-cross-tenant.md) (passaporte cross-tenant)** acabou de aumentar a carga sobre o Postgres: cross-tenant queries em runtime, view materializada `mv_patient_cross_tenant_summary`, `patient_data_access_log` particionado mensal, função `has_cross_tenant_access()` hot, trigger `enforce_one_active_module_per_person` cruzando 2 tabelas com lock. Bloqueia sharding (regra 34 / [ADR 0072](0072-escalabilidade-banco-particionamento-retencao-cold-storage.md)) pra tenants com vínculo cross ativo — tudo num PG só por mais tempo.
3. **Custo Supabase escala mal** quando esse PG cresce: Supabase Pro $25/mês inclui shared CPU 1GB RAM (insuficiente em ~50 tenants); upgrade pra dedicated 2GB+ é $95-185/mês; Small instance $410/mês.
4. **Oracle Cloud free tier vitalício** oferece 24GB RAM ARM Ampere + 4 OCPU + 200GB block storage **grátis para sempre** — cobre LogiFit até ~500 tenants sem pagar nada de compute.
5. **Migração não é trivial mas é finita** — substituir Supabase Auth/Storage/Realtime estima em 45-65 horas (1.5-2 semanas focadas).

**Tensão central:**

- **Lançar MVP rápido** (2-3 meses) exige zero-ops → Vercel + Supabase
- **Operar barato em escala** + ter controle do PG (importante pelo ADR 0077) → Postgres próprio no Oracle
- **Tempo do fundador é o recurso mais caro** — não vale gastar 60h em ops antes de ter cliente

**Decisão do usuário (2026-04-25):**

> "Começar com A, migrar pra B no Sprint 19 quando MVP fechar."

A = Vercel + Supabase Pro (managed). B = Vercel + Postgres no Oracle Cloud free tier (híbrido).

## Decision

### Estratégia em duas fases

```
┌──────────────────────────────────────────────────────────────────────┐
│  FASE 1 — MVP (Sprint 00 → Sprint 19, ~6-8 meses)                    │
├──────────────────────────────────────────────────────────────────────┤
│  Frontend + Server Actions:  Vercel Pro                              │
│  Postgres + Auth + Storage + Realtime:  Supabase Pro                 │
│  Cache / Rate limit:  Upstash Redis                                  │
│  Backup off-site:  Cloudflare R2 (regra 40)                          │
│  Audit anchor WORM:  AWS S3 Object Lock (regra 39)                   │
│  Custo: R$ 50 inicial → R$ 250-400/mês com 1º cliente real           │
│  Ops: zero                                                            │
└──────────────────────────────────────────────────────────────────────┘
                                  ↓
                       Sprint 19b — Migração
                                  ↓
┌──────────────────────────────────────────────────────────────────────┐
│  FASE 2 — Pós-MVP (Sprint 19b+, indefinido)                          │
├──────────────────────────────────────────────────────────────────────┤
│  Frontend + Server Actions:  Vercel Pro (mantém)                     │
│  Postgres:  Oracle Cloud OCI free tier (ARM Ampere 24GB / 4 OCPU)    │
│  Auth:  BetterAuth ou Lucia (substitui Supabase Auth)                │
│  Storage:  Cloudflare R2 (substitui Supabase Storage)                │
│  Realtime:  Postgres LISTEN/NOTIFY + WebSocket próprio (substitui    │
│             Supabase Realtime)                                       │
│  Cache / Rate limit:  Upstash Redis (mantém)                         │
│  Backup off-site:  pgBackRest → Cloudflare R2                        │
│  Audit anchor WORM:  AWS S3 Object Lock (mantém)                     │
│  Monitoring:  Logtail + Grafana ou Better Stack                      │
│  Custo: R$ 100-150/mês fixo, escala bem até ~500 tenants             │
│  Ops: médio (PG é seu, mas usuário já tem expertise — Deep Control)  │
└──────────────────────────────────────────────────────────────────────┘
```

### Regras de portabilidade durante a Fase 1 (cravadas pra migração ser tranquila)

| # | Regra | Por quê |
|---|---|---|
| 1 | **Drizzle como única fonte de schema** (regra 3 já existente) | Schema migra direto pra qualquer Postgres |
| 2 | **RLS policies em SQL puro** em `packages/db/policies/*.sql`, **NUNCA criar via Supabase Studio** | Studio não exporta direito; SQL puro vai junto no Drizzle migrations |
| 3 | **Auth via JWT + cookie próprio**, NÃO usar Supabase Auth UI helpers | JWT é padrão — qualquer Auth lib (BetterAuth/Lucia) substitui sem refactor |
| 4 | **Storage com adapter pattern** — interface `StorageAdapter` em `packages/storage/`, default `SupabaseStorageAdapter`, env var `STORAGE_PROVIDER` | Sprint 19b só pluga `R2StorageAdapter` |
| 5 | **Realtime usa PG LISTEN/NOTIFY** quando possível; Supabase Realtime apenas onde compensa (broadcast pra muitos clients) | LISTEN/NOTIFY é portátil; Supabase Realtime é lock-in |
| 6 | **PROIBIDO Supabase Edge Functions** — toda lógica server-side via Next.js Server Actions ou API Routes | Edge Functions são lock-in puro; quebram migração |
| 7 | **PgBouncer-friendly desde dia 1** — sem prepared statements long-lived; transaction pooling assumido | Oracle vai usar PgBouncer; pegar lock-in agora dá retrabalho |
| 8 | **Connection string no `DATABASE_URL` env**, NUNCA cliente Supabase JS pra queries (usar Drizzle direto) | Drizzle abstrai connection — troca de host = mudar env var |

**Lint e verificações em CI** garantem regras 6 e 8: bloqueia commit se aparecer `import { ... } from '@supabase/functions'` ou `supabase.from(...).select()` (queries diretas via supabase-js).

### Quando antecipar a migração (gatilhos)

Se algum sinal aparecer **antes** do Sprint 19, antecipa pra Sprint mais cedo:

| Sinal | Severidade |
|---|---|
| Supabase compute >70% sustained por 2+ semanas | Antecipa pra Sprint mais próximo |
| Latência p95 de cross-tenant query (ADR 0077) >800ms | Antecipa imediato |
| Custo Supabase passou R$ 600/mês | Migração paga em 6 meses |
| 1º cliente Enterprise pediu BYOK ou hospedagem dedicada | Caso especial — separa instância pra ele |
| Vazamento Supabase ou downtime >4h em incidente | Reavalia urgência |

### Plano de migração (Sprint 19b — detalhado em `docs/sprints/19b-migracao-hospedagem-oracle.md`)

7 fases com ~60h de trabalho, janela de cutover 2-4h:

| Fase | O que faz | Horas |
|---|---|---|
| 1. Provisionamento | Oracle Cloud OCI free tier (VM ARM Ampere + block 200GB) | 4h |
| 2. Setup Postgres | Postgres 17 + extensions (pg_trgm, unaccent, pgvector) + PgBouncer + SSL + firewall + monitoring básico | 8h |
| 3. Backup automático | pgBackRest configurado pra dump diário cifrado em Cloudflare R2 | 4h |
| 4. Substituir Supabase Auth | BetterAuth ou Lucia + JWT custom claims pra RLS | 15-20h |
| 5. Substituir Storage | Trocar `SupabaseStorageAdapter` → `R2StorageAdapter` (já existe interface — só pluga) | 4h |
| 6. Substituir Realtime | PG LISTEN/NOTIFY + WebSocket próprio (Vercel Edge Runtime ou Node) | 8h |
| 7. Cutover | `pg_dump` Supabase → restore Oracle (janela 2-4h madrugada) + DNS switch + smoke tests | 6h |
| Monitoring final | Grafana ou Better Stack apontando pra Oracle | 4h |
| **Total** | | **~60h** |

**Sub-decisão pendente — BetterAuth vs Lucia:** a escolha do provider de Auth da Fase 2 fica adiada para spike no início do Sprint 19b (mini-ADR como sub-decisão). Critérios a avaliar: maturidade da lib, tamanho da comunidade, suporte WebAuthn/TOTP nativo (regra 43), custo de migrar claims customizados (`tenant_id`, `scopes[]`, `topology`, `mfa_at`), portabilidade pra eventual troca futura. Até a sub-decisão, este ADR + CLAUDE.md + arquitetura.md grafam "BetterAuth ou Lucia" intencionalmente — não é indecisão por esquecimento.

### Custo comparativo (12 meses pós-MVP)

| Cenário | Mês 1-8 (MVP) | Mês 9-20 (pós-MVP) | Total 20 meses |
|---|---|---|---|
| **Decidido (A→B)** | R$ 50→250 (R$ ~1.500) | R$ 100-150 (R$ ~1.500) | **R$ ~3.000** + custo de 60h migração |
| Hipotético: continuar A com upgrade | R$ 50→250 (R$ ~1.500) | R$ 600-1.500 (R$ ~12.000) | R$ ~13.500 |
| Hipotético: começar direto B | R$ 100-150 (R$ ~1.000) | R$ 100-150 (R$ ~1.500) | R$ ~2.500 + custo de 60h **antes do MVP** |

**Conclusão:** decisão (A→B) gasta R$ 500 a mais que "começar B" mas adia 60h de ops pra depois do MVP estar validado. **R$ 500 é preço justo pelos 6-8 meses de "zero ops" durante a fase mais crítica de validação de produto**.

### Implicações arquiteturais que ficam congeladas

A decisão A→B **não muda**:
- Drizzle como ORM ([ADR 0004](0004-drizzle-fonte-unica-schema.md))
- RLS como isolamento primário ([ADR 0002](0002-rls-como-isolamento-primario.md))
- Particionamento (regra 34 / [ADR 0072](0072-escalabilidade-banco-particionamento-retencao-cold-storage.md))
- Sharding via `tenants.shard_url` (regra 34 — preparado, não ativado)
- Audit hash chain (regra 39 / [ADR 0073](0073-postura-seguranca-defesa-em-profundidade.md))
- IA via `resolveModelForTask` (regra 32 / [ADR 0064](0064-ia-arquitetura-gemini-default-byok-rag.md))
- Multi-tenant por subdomínio ([ADR 0065](0065-multi-tenant-por-subdominio.md))
- Cross-tenant via vínculo (regra 42 / [ADR 0077](0077-passaporte-paciente-vinculo-cross-tenant.md))

Tudo isso é **agnóstico** de hospedagem do PG — funciona igual em Supabase ou Oracle.

## Consequences

### Positivas

- **MVP entrega em 6-8 meses sem distração de ops** — fundador foca em produto
- **Migração planejada** evita "vazou tempo, fica em Supabase pra sempre por inércia" — Sprint 19b já escrito força a executar
- **Custo escala bem** — economiza ~R$ 1.500/mês a partir do mês 9 (vs continuar Supabase com upgrade)
- **Controle do Postgres** pós-migração — particionamento agressivo, pgvector tunado, query plans previsíveis (importante pelo ADR 0077)
- **Reusa pipeline Deep Control** — usuário já tem GHCR + self-hosted runner Windows + experiência PG-on-host
- **Independência de fornecedor** — Supabase pode mudar pricing, deprecar feature, ter incidente; pós-migração só Vercel é dependência única (e Vercel é trocável por Cloudflare Pages se necessário)

### Negativas (mitigáveis)

- **60h de migração no Sprint 19b** — mitiga: planejar bem, pré-trabalho de portabilidade durante MVP (regras 1-8 acima), janela de cutover noturna
- **Risco de "esquecer migração"** — mitiga: ADR + Sprint 19b já no roadmap + gatilhos pra antecipar
- **Auth/Storage/Realtime sem features built-in pós-migração** — mitiga: BetterAuth/Lucia maduros; R2 + signed URLs cobre 100% do uso; LISTEN/NOTIFY suficiente pra escala MVP
- **Single-server PG no Oracle** = ponto de falha único — mitiga Fase 2: read replica em Oracle separado (free tier permite); pós-Fase 2: Patroni HA quando justificar
- **Latência Vercel→Oracle SP** ~30-50ms — mitiga: Vercel SP edge → Oracle região SP é viável; pra crítica, query batching + cache Redis 5min (`mv_patient_cross_tenant_summary` da ADR 0077 já planeja)

### Riscos não endereçados

- **Oracle muda free tier** — improvável (vitalício documentado), mas pode acontecer. Mitigação: AWS RDS / DigitalOcean Managed PG são alternativas com pricing previsível (~R$ 200-400/mês em entrada)
- **Janela de cutover dá problema** — backup pré-cutover + rollback plan documentado em Sprint 19b; aceitar 2-4h downtime madrugada planejada
- **Cliente Enterprise no MVP que exige hospedagem dedicada** — caso especial, faturado à parte; instância separada Supabase Pro ou Oracle dedicado pra ele

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| **Começar B (Oracle direto)** | 60h de ops ANTES do MVP atrasa validação de produto; ROI negativo até ter cliente |
| **Ficar em Supabase pra sempre** | Escala custa R$ 600-1.500/mês a partir de ~50 tenants; sem controle do PG (ruim pra ADR 0077) |
| **Full self-hosted Oracle (Opção C — Deep Control style)** | Perde Vercel preview + edge + auto-scale; ganha pouco vs híbrido (B); só vale se quiser zero dependência externa |
| **AWS RDS managed** | R$ 200-400/mês entry-level vs Oracle free; mata o argumento de custo |
| **DigitalOcean Managed PG** | Idem AWS RDS |
| **Mover Postgres pra Supabase Self-hosted** | Mantém lock-in da stack Supabase mas sem nenhum dos benefícios managed; pior dos mundos |

## Escopo de impacto

**Novo ADR:** este (0078).

**ADRs ajustados:**

- **[ADR 0001](0001-stack-base.md)** — adicionar nota: stack assumida pra MVP; pós-Sprint 19 muda hospedagem ([ADR 0078](0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md))

**Sprints ajustados:**

- **Sprint 00** — adicionar checklist: storage adapter pattern + RLS em SQL puro + lint `no-supabase-functions` + lint `no-direct-supabase-query` + JWT cookie próprio (não Supabase Auth UI helpers)
- **Sprint 01a** — Auth com JWT custom claims via cookie httpOnly; **NÃO** usar `@supabase/auth-helpers-nextjs`; documenta padrão portátil
- **Sprint 19b — NOVO** — migração detalhada de Supabase pra Oracle Cloud (7 fases, ~60h, cutover 2-4h)

**Docs:**

- **CLAUDE.md** — seção "Stack" ganha nota sobre estratégia em duas fases
- **`docs/roadmap.md`** — Sprint 19b adicionado entre Sprint 19 e Fase 2
- **`docs/decisions/0001-stack-base.md`** — addendum
- **CHANGELOG.md** — entrada `[Unreleased] - Decided — ADR 0078`

## Related

- Estende [ADR 0001 — Stack base](0001-stack-base.md)
- Depende de [ADR 0072 — Escalabilidade do banco](0072-escalabilidade-banco-particionamento-retencao-cold-storage.md) — particionamento + retenção
- Reforçado por [ADR 0077 — Passaporte cross-tenant](0077-passaporte-paciente-vinculo-cross-tenant.md) — carga PG cross-tenant justifica controle do banco
- Referencia regra 34 (escalabilidade) + regra 39 (audit hash chain) + regra 40 (backup off-site)
- Inspiração operacional: projeto Deep Control (whitelabel) do mesmo usuário em Oracle Cloud OCI com Docker
