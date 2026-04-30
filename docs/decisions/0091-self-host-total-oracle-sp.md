# ADR 0091 — Self-host total: Oracle Cloud SP + Coolify + Postgres + Caddy desde Sprint 00 (supersede ADR 0078)

- **Status:** Accepted
- **Date:** 2026-04-27
- **Revisão 2026-04-27 (mesmo dia):** **Cloudflare R2** substitui **Hetzner Storage Box** como provider de backup off-site. Motivos: (a) free tier 10GB cobre MVP inteiro a custo zero (Hetzner era €3.50/mês fixo); (b) zero egress fee preserva orçamento de DR drills quarterly; (c) S3-compatible API (rclone) é mais simples que SSH+rsync e elimina necessidade de chave SSH dedicada. Externals reduzidos de 9 para 8 categorias (Cloudflare assume DNS + R2 + Turnstile + Email Routing). Hetzner Storage Box mantido como alternativa rejeitada documentada (volta a ser considerado se volume backup >700GB). Regra 40 mantida (off-site cifrado GPG, RPO 24h/RTO 4h, DR drill quarterly). Hetzner CX22 Helsinki **continua** como VPS DR alternativo pre-provisionado — não confundir com Storage Box.

## Context

[ADR 0078](0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md) estabeleceu hospedagem em duas fases: Fase 1 MVP em Vercel + Supabase Pro até Sprint 19, Fase 2 pós-MVP migra Postgres pra Oracle Cloud free tier mantendo Vercel. Conversa de 2026-04-27 reabriu a discussão por preocupação explícita do fundador com **dependência externa**:

1. Cada SaaS plugado adiciona vendor lock-in subliminar — pricing pode mudar, feature pode ser deprecada, conta pode ser suspensa sem aviso
2. Free tiers viram pricing pago em escala que ninguém antecipa quando assina
3. Soberania do dado de saúde (LGPD art. 11) é sempre mais forte com infra própria
4. Tempo de setup de N contas externas no início também é fricção (cartão, captcha, validação) — não só ops

A reavaliação concluiu que **a Fase 1 do ADR 0078 (Vercel + Supabase) só compensava se ops fosse fricção real**. Como o fundador já opera o projeto Deep Control (whitelabel) em Oracle Cloud OCI com Docker, GHCR, rolling updates e tem expertise demonstrada (citada no próprio ADR 0078 §Context item 1), o trade-off muda: a Fase 1 custa mais dependência sem economizar ops significativo.

**Decisão do fundador (2026-04-27):**

> "Vamos usar o Oracle SP."

Significando: pular Fase 1 inteira; rodar self-host total — **incluindo hospedagem do Next.js, não só PG** — desde Sprint 00.

## Decision

### Stack única (sem mais "duas fases")

```
┌──────────────────────────────────────────────────────────────────────┐
│  PRODUÇÃO (Sprint 00 → indefinido)                                   │
├──────────────────────────────────────────────────────────────────────┤
│  VPS único:  Oracle Cloud OCI free tier ARM Ampere                   │
│              Região: Vinhedo (`sa-vinhedo-1`) — distinta de SP       │
│                       (`sa-saopaulo-1`); Vinhedo tem free tier ARM   │
│                       consistente, SP tem waitlist crônico           │
│              Recursos: até 4 OCPU + 24 GB RAM + 200 GB block storage │
│  Orquestrador: Coolify (open-source, "Vercel/Heroku self-hosted")    │
│  Reverse proxy: Caddy (incluso no Coolify) + Let's Encrypt auto      │
│  Frontend + Server Actions: Next.js 15 standalone via Coolify        │
│  Postgres 16: container Coolify (mesmo VPS, volume persistente)      │
│  Auth: BetterAuth ou Lucia (sub-decisão Sprint 01a)                  │
│  Storage: MinIO container S3-compatible (mesmo VPS)                  │
│  Cache / Rate limit: Redis container (mesmo VPS)                     │
│  Observabilidade erro: GlitchTip container (Sentry-API-compatível)   │
│  Observabilidade logs: pino → stdout → Loki container + Grafana      │
│  Realtime: PG LISTEN/NOTIFY + WebSocket próprio Next.js              │
│  Email transacional: AWS SES (única dependência paid externa core)   │
│  Backup off-site: rclone diário pra Cloudflare R2 (free 10GB)        │
│  Audit anchor WORM: pendente Sprint 19+ (avaliar S3 Object Lock      │
│                     ou anchor próprio em VPS independente)           │
│  DNS + WAF/DDoS: Cloudflare free                                     │
│  Captcha: Cloudflare Turnstile free                                  │
│  CI/CD: GitHub Actions → push imagem GHCR → Coolify pull             │
│  Custo MVP: R$ 0 (R2 free 10GB + SES sandbox + Oracle free)          │
│  Ops: médio (PG + Linux + Docker é território conhecido)             │
└──────────────────────────────────────────────────────────────────────┘
```

### Por que Vinhedo (`sa-vinhedo-1`) e não São Paulo (`sa-saopaulo-1`)

Oracle Cloud OCI tem **duas regiões distintas no estado de SP** — não são sinônimos:

| Região | Code | Localização | Lançamento | Free tier ARM |
|---|---|---|---|---|
| Brazil East | `sa-saopaulo-1` | Capital SP (metro) | ~2017 | **Waitlist crônico** ("out of capacity" comum) |
| Brazil Southeast | `sa-vinhedo-1` | Vinhedo, interior SP (~80km da capital) | 2021 | **Disponível consistentemente** |

**Decisão:** Vinhedo. Razões em ordem de importância:

1. **Disponibilidade real do free tier ARM Ampere.** SP capital tem dezenas de relatos no fórum Oracle de "out of host capacity" por semanas-meses pra `VM.Standard.A1.Flex`. Vinhedo (mais nova, demanda menor) provisiona em minutos. Free tier que não provisiona é zero valor.
2. **Latência irrelevante.** Vinhedo↔SP capital é ~5-10ms. Pra B2B SaaS (não videogame), 5ms a mais não muda nada de UX.
3. **Bônus DR.** Vinhedo é par geográfico oficial de SP — se um dia quiser réplica de DR ativa, SP capital é destino natural sem custo adicional de latência cross-region.

Foi pareadas como par DR uma da outra — geographic redundancy zone. Operar primária em Vinhedo + futura réplica em SP é caminho natural quando justificar.

### Externals que sobram (cada um justificado)

| Serviço | Motivo de manter | Plano de saída |
|---|---|---|
| **Oracle Cloud OCI** (VPS) | Free tier vitalício SP; 4 OCPU + 24GB RAM cobre LogiFit até ~500 tenants | Hetzner CX22 Helsinki €5/mês (DR pre-provisionado) — runbook restore <4h |
| **Cloudflare** (DNS + Turnstile + proxy) | Free tier real, infra crítica, DDoS mitigation | Registro.br + Caddy WAF + hCaptcha self-host |
| **Cloudflare R2** (backup off-site) | Free tier 10GB cobre MVP; pay-as-you-go $0.015/GB-mês + **zero egress fee** = DR drills sem custo; S3-compatible (rclone); independente da infra Oracle (storage físico em CDN global, bucket separado com chaves dedicadas) | Backblaze B2 (mais barato pra <100GB; tem egress 3x storage); Hetzner Storage Box (€3.50/mês 1TB fixo — vale só se passar de 700GB) |
| **AWS SES** (email transacional) | Self-host SMTP tem deliverability ruim por meses até reputação subir | Postal self-hosted (com 3-6 meses de warmup); ou Mailgun pago se SES virar problema |
| **GitHub** (SCM + Actions + GHCR) | CI gratuito generoso, ecosystem maduro, GHCR free pra repo público/privado pequeno | Forgejo/Gitea self-host + Drone/Woodpecker CI |
| **Vertex AI (Gemini)** | Default LogiFit ([ADR 0064](0064-ia-arquitetura-gemini-default-byok-rag.md)); regra 32 | Ollama+Llama3 local cobre non-clinical; clínico precisa qualidade — mantido como external paga |
| **Asaas** | Pagamentos brasileiros; alternativa similar (Pagar.me/MercadoPago); direct-bank inviável | Não realisticamente — mercado fechado |
| **Focus NFe** | Fiscal NFS-e/NF-e; [ADR 0059](0059-ciclo-fiscal-emissao-focus-nfe.md) explicitamente rejeita motor próprio | Não no MVP — 8-12 meses pra escrever motor |
| **WhatsApp BSP** (Twilio/Gupshup) | Meta exige BSP certificado | Não tem self-host autorizado pela Meta |

### Mitigação dos riscos do Oracle SP free tier

O risco específico do free tier Oracle (suspensão de conta sem aviso, com histórico documentado em fóruns) é real e mitigado por **4 camadas**:

**1. Upgrade pra "Pay As You Go" (PAYG) mode com cartão de crédito**

- Conta deixa de ser "free trial / always-free" classificação e vira "paying customer"; histórico empírico mostra que contas PAYG raramente são reclaimed sem aviso
- Mantém recursos do free tier grátis (cobra R$ 0 se ficar dentro dos limites)
- **Custo:** R$ 0 enquanto não exceder limites de always-free
- **Ação:** ativar PAYG no primeiro acesso ao console Oracle, antes de subir produção

**2. Backup off-site em provider INDEPENDENTE de Oracle (regra 40)**

- `rclone` diário cifrado GPG → Cloudflare R2 (free tier 10GB; pay-as-you-go zero egress)
- `pg_dump` weekly cifrado → mesmo destino
- Mídia (MinIO uploads) → snapshot semanal pra mesmo destino
- Chave GPG armazenada em GitHub Secrets (criptografada) + cópia offline em pen drive físico do fundador
- **RPO 24h / RTO 4h** (regra 40 mantém)

**3. Bootstrap totalmente scriptado**

- VPS recriável em <2h de zero via shell script versionado em `infra/bootstrap-oracle.sh` (Sprint 00 entrega esqueleto)
- Coolify reinstall via 1 comando
- Restore Postgres via `pg_restore` script
- DNS Cloudflare aponta pra IP novo em segundos (TTL 300s)
- **Plano DR alternativo:** Hetzner CX22 Helsinki (€5/mês) pre-provisionado mas desligado; em caso de Oracle morrer, ligar e restaurar em <4h

**4. Quarterly DR drill (regra 40)**

- A cada 3 meses: derrubar VPS de staging, recriar do zero via script, restaurar último backup, validar smoke tests
- Runbook em `docs/runbooks/dr-drill.md` (Sprint 00 Faixa 3 entrega esqueleto; primeiro drill real Sprint 04+ quando há dado)

### ARM compatibility

Oracle free tier é ARM Ampere. Imagens Docker oficiais que serão usadas — todas com suporte ARM64 nativo:

- `postgres:16-alpine` ✓
- `redis:7-alpine` ✓
- `minio/minio:latest` ✓
- `caddy:2-alpine` ✓
- `coollabsio/coolify` ✓
- `glitchtip/glitchtip` ✓ (precisa também ClickHouse — `clickhouse/clickhouse-server` tem ARM)
- `grafana/grafana` ✓
- `grafana/loki` ✓
- `node:22-alpine` ✓ (base do Next.js standalone build)

Casos de atenção:

- **`sharp`** (Next.js Image optimization) — funciona ARM mas requer install nativo correto; resolvido por `--platform linux/arm64` no `docker buildx build` do CI
- **Build de imagem Next.js** feito via GitHub Actions com `docker buildx` multi-arch (`linux/amd64,linux/arm64`) e push pra GHCR; Coolify no Oracle pull a variante ARM
- **Dev local x86** continua funcionando (compose roda variante x86 das mesmas imagens)
- **Lint/CI x86** GitHub Actions (irrelevante pra produção ARM)

### Dev local: Docker Compose (substitui Supabase CLI)

`docker-compose.yml` na raiz com mesmos serviços de produção (em pequeno):

- `postgres:16-alpine` (porta 5432)
- `redis:7-alpine` (porta 6379)
- `minio/minio` (porta 9000 + 9001 console)
- `mailhog/mailhog` (SMTP fake — captura email sem mandar; dev only)
- `glitchtip/glitchtip` (porta 8000) — opcional em dev
- `grafana/loki` + `grafana/grafana` — opcional em dev

Volume persistente em `.docker-data/` (gitignored). Comandos:

```bash
pnpm dev:up      # docker compose up -d
pnpm dev:down    # docker compose down
pnpm dev         # next dev (assume dev:up rodando)
pnpm dev:reset   # drop volumes + recriar (uso em teste limpo)
```

### Regras de portabilidade revisadas (8 regras de ADR 0078 → reformuladas)

ADR 0078 estabeleceu 8 regras de portabilidade pensadas pra **fugir de Supabase no futuro**. Como agora **nunca usamos Supabase**, as regras viram **regras de soberania perpétua**:

| # | Regra original (ADR 0078) | Regra revisada (ADR 0091) |
|---|---|---|
| 1 | Drizzle única fonte de schema | Mantém — regra 3 já existente em `rules.md` |
| 2 | RLS em SQL puro, não Supabase Studio | RLS em SQL puro versionada com Drizzle migrations (Studio nunca existiu aqui) |
| 3 | Auth via JWT cookie próprio, não Supabase Auth helpers | Auth via JWT cookie próprio (BetterAuth/Lucia em Sprint 01a) |
| 4 | Storage adapter pattern (substituir Supabase → R2 depois) | Storage adapter pattern (`MinioStorageAdapter` default em prod e dev) |
| 5 | Realtime via LISTEN/NOTIFY quando possível | Realtime SEMPRE via LISTEN/NOTIFY (Supabase Realtime nunca existiu) |
| 6 | PROIBIDO Supabase Edge Functions | Irrelevante — nunca usamos Supabase. Lint `no-supabase-functions` deletado |
| 7 | PgBouncer-friendly | PgBouncer integrado no Coolify Postgres setup |
| 8 | DATABASE_URL env, Drizzle direto | Mantém — Drizzle direto sempre. Lint `no-direct-supabase-query` deletado |

**Lints obsoletos (deletar do Sprint 00 Faixa 3):**

- `no-supabase-functions` — não há Supabase
- `no-direct-supabase-query` — não há `supabase.from(...)`

### Nova regra 46 — justificar dependência externa

> **46.** Toda dependência externa nova (SaaS, API paga, serviço gerenciado de terceiro) exige ADR justificando: (a) por que self-host não atende; (b) qual o lock-in concreto; (c) qual o custo mensal estimado; (d) qual o plano de saída. Sem ADR, sem dependência. Externals já aprovados no MVP listados neste ADR (0091): Oracle Cloud, Cloudflare, Cloudflare R2, AWS SES, Vertex AI, Asaas, Focus NFe, WhatsApp BSP, GitHub.

## Consequences

### Positivas

- **Soberania do dado** — 100% dos dados de saúde (LGPD art. 11) ficam em VPS controlado por LogiFit
- **Custo MVP ~R$ 0/mês** (R2 free tier 10GB + SES sandbox + Oracle free tier + Cloudflare DNS+Turnstile free) vs ~R$ 250-400/mês ADR 0078 fase A
- **Custo previsível** — não escala com tráfego, escala com VPS upgrade discreto e visível
- **Sem timeout 10s** (Vercel hobby) — jobs longos (OCR exames, IA, NFS-e batch) rodam livre
- **Latência baixa Next.js↔PG** (mesmo container host)
- **Stack 100% open-source** (exceto SES) — auditável, fork-able, sem surpresa contratual
- **Reusa expertise Deep Control** (Oracle + Docker + GHCR + rolling updates)
- **Sprint 19b deletado do roadmap** — não há migração futura, pula 60h de trabalho
- **Menos contas externas pra criar no Sprint 00** — fricção inicial menor

### Negativas (mitigáveis)

- **Sprint 00 ganha ~1 semana extra** (subir VPS + Coolify + bootstrap script + DR runbook + GlitchTip + Loki/Grafana + MinIO) — absorve dentro do timebox de 4 semanas atual; possivelmente vira 5 semanas (aceitar com revisão de regra 9)
- **Ops sobre o fundador** — mitiga: Coolify abstrai 80% das operações; SSH + docker logs pra resto; runbooks maduros desde dia 1
- **Sem preview deploys per PR** (Vercel feature) — mitiga: dev solo raramente precisa; Coolify suporta git-branch-deploy via webhook se necessário
- **Sem Edge CDN global** — mitiga: Cloudflare proxy free na frente cobre cache static + DDoS; B2B BR não precisa de edge global
- **Risco Oracle suspensão** — mitiga: 4 camadas acima (PAYG + backup independente + bootstrap script + DR drill quarterly + alternativa Hetzner pre-provisionada)
- **Risco ARM incompatibility** — mitiga: imagens canônicas listadas funcionam ARM64; sharp tratado via multi-arch build
- **Single-VPS = ponto de falha único** — mitiga: aceitar pro MVP (RTO 4h é suficiente pra B2B saúde non-emergency); Fase 2 pode adicionar VPS replica HA quando justificar

### Riscos não endereçados

- **VPS Oracle morre durante incidente clínico crítico** — RTO 4h pode ser longo se Asaas/Focus NFe estão tentando processar pagamento/nota. Aceito como risco residual; runbook DR documenta comunicação ao tenant.
- **Sharp em ARM tem edge case** — sem issue conhecida recente; se aparecer, fallback é desabilitar Next.js Image optimization e servir static via Caddy + cache.
- **Cloudflare suspende por algo absurdo** — improvável; backup DNS via Registro.br ou outro provider documentado no runbook DR.
- **Coolify abandonware** — open-source ativo (~30k stars, releases regulares); fallback é Dokku ou systemd direto + scripts próprios (mais trabalho mas não bloqueia).

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| **Manter ADR 0078 (Vercel + Supabase MVP)** | Trade-off não compensa: fundador tem expertise ops e quer reduzir external dependency desde dia 1 |
| **Hetzner CX22 Helsinki desde dia 1** | €5/mês vs R$ 0 Oracle SP; latência +200ms BR; aceitamos risco Oracle pra economizar custo + latência |
| **Vercel mantido + Postgres Oracle desde dia 1** | Mantém dependência Vercel sem ganho proporcional; trabalho de PG self-host já feito |
| **AWS Lightsail SP** | US$ 5-10/mês vs R$ 0; lock-in AWS sutil |
| **Magalu Cloud / Locaweb BR-nativo** | R$ 25-50/mês; sem free tier comparável; sem ganho prático sobre Oracle |
| **DigitalOcean / Vultr / Linode** | Sem free tier vitalício; custo R$ 25+/mês |
| **Postal self-hosted (substituir SES)** | Deliverability ruim por meses até reputação subir; risco de email indo pra spam de cliente novo é maior que custo pequeno do SES |
| **GitHub self-host (Forgejo/Gitea) desde dia 1** | Possível mas baixa prioridade; GitHub free é real; CI gratuito generoso; pode virar action futura quando virar dor |
| **Hetzner Storage Box** (revisão 2026-04-27) | Considerado em primeira draft (€3.50/mês 1TB fixo); preterido em favor do R2 por (a) free tier 10GB cobre MVP a custo zero, (b) zero egress fee = DR drills sem custo, (c) S3 API + rclone mais simples que SSH+rsync. Voltar a considerar se volume backup >700GB |
| **Continuar com Supabase mas mover Auth/Storage gradualmente** | Pior dos mundos: ainda paga Supabase, ainda tem lock-in, ainda tem ops parcial |

## Escopo de impacto

**Novo ADR:** este (0091).

**ADRs ajustados:**

- **[ADR 0078](0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md)** — Status muda pra `Superseded by ADR 0091 (2026-04-27)`. Adicionar nota no topo apontando aqui. Conteúdo histórico preservado pra rastreabilidade.
- **[ADR 0001](0001-stack-base.md)** — addendum: stack final é self-host total Oracle SP (não mais "Vercel + Supabase MVP"); reflete também ADR 0091
- **[ADR 0067](0067-dpo-governanca-compliance-lgpd.md)** — sub-processors LogiFit revisados: remove Vercel + Supabase + Upstash; adiciona Oracle Cloud OCI, AWS SES; promove Cloudflare a multi-uso (DNS + R2 backup + Turnstile + Email Routing — 4 funções no mesmo provider); mantém Asaas + Focus NFe + Vertex AI + WhatsApp BSP + GitHub

**Sprints ajustados:**

- **Sprint 00** — escopo expandido (+1 semana, total ~5 semanas):
  - **Removido:** Supabase CLI, supabase-js, regras "anti-Supabase" de portabilidade (6, 8 viram irrelevantes), lints `no-supabase-functions` e `no-direct-supabase-query`, Upstash Redis (vira Redis self-host)
  - **Adicionado:** bootstrap Oracle Cloud OCI account + PAYG upgrade, `infra/bootstrap-oracle.sh` (provisiona VPS + firewall + Docker + Coolify), Coolify install + config, Caddy reverse proxy + Let's Encrypt, GlitchTip self-host (substitui Sentry), Loki + Grafana self-host (substitui Logtail/Axiom), MinIO container, Postgres 16 container, Redis container, `docker-compose.yml` dev local, runbook `dr-drill.md`, runbook `bootstrap-oracle.md`, runbook `restore-test.md` (atualizado pra Cloudflare R2), GitHub Actions multi-arch build (`linux/amd64,linux/arm64`) + push GHCR + webhook Coolify
  - **Mantido:** Drizzle, Next.js 15, React 19, Tailwind v4, Biome, Vitest, Playwright, i18n 3 locales, design system "Equilíbrio Vital", security headers + CSP, wrap actions (regra 33), lints custom restantes, RIPDs esqueleto, ADR 0090 estratégia de testes
- **Sprint 19b** — **DELETADO do roadmap.** Não há migração futura.
- **Sprint 01a** — Auth nasce direto BetterAuth ou Lucia (não Supabase Auth); MFA TOTP via package padrão (otplib ou similar); WebAuthn via SimpleWebAuthn

**Docs:**

- **CLAUDE.md** — seção "Stack" reescrita; nova seção "Hospedagem"; seção "Regras de portabilidade durante MVP" reescrita pra "Regras de soberania perpétua"; sub-processors no bloco DPO atualizados
- **`docs/rules.md`** — nova **regra 46** (justificar dependência externa); 8 regras antigas reformuladas (ou marcadas obsoletas onde apropriado)
- **`docs/roadmap.md`** — Sprint 19b removido da tabela; nota sobre supercessão de ADR 0078 → 0091
- **`docs/arquitetura.md`** — diagrama de hospedagem atualizado (próximo sprint relevante revisa)
- **README.md** — comandos `pnpm dev:up`/`dev:down`/`dev:reset` documentados; pré-requisitos (Docker Desktop em vez de Supabase CLI)
- **CHANGELOG.md** — entrada `[Unreleased] - Decided — ADR 0091 self-host total Oracle Cloud SP`

**Cron jobs (Vercel Cron → ?):**

- Vercel Cron some. Substituto: `node-cron` rodando dentro do container Next.js OU container `ofelia` separado (cron orchestrator pra Docker). Decisão fina dentro do Sprint 00.

## Related

- **Supersede [ADR 0078 — Hospedagem em duas fases](0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md)** — Fase 1 (Vercel + Supabase) eliminada; vai direto pra Fase 2 (PG Oracle) e amplia pra hospedagem do Next.js + observabilidade self-host também
- Estende [ADR 0001 — Stack base](0001-stack-base.md) — addendum sobre hospedagem final
- Atualiza [ADR 0067 — DPO + Governança LGPD](0067-dpo-governanca-compliance-lgpd.md) — sub-processors revisados
- Reforça [ADR 0072 — Escalabilidade banco](0072-escalabilidade-banco-particionamento-retencao-cold-storage.md) — controle total do PG desde dia 1
- Reforça [ADR 0073 — Postura segurança](0073-postura-seguranca-defesa-em-profundidade.md) — backup off-site em Cloudflare R2 (regra 40)
- Reforça [ADR 0077 — Passaporte cross-tenant](0077-passaporte-paciente-vinculo-cross-tenant.md) — carga PG cross-tenant em servidor próprio
- Cria **regra 46** em [`docs/rules.md`](../rules.md) — justificar dependência externa
- Inspiração operacional: projeto Deep Control (whitelabel) do mesmo usuário em Oracle Cloud OCI com Docker + GHCR
