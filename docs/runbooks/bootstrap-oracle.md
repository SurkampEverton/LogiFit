# Runbook — Bootstrap Oracle Cloud Vinhedo (Faixa 2 do Sprint 00)

- **Status:** Esqueleto (Sprint 00 Faixa 2 vai expandir com prints e timing real)
- **Quando consultar:** primeira vez (provisionamento) ou re-bootstrap após incidente
- **Duração estimada:** 90-120min na primeira vez; 30min em re-bootstrap

## Pré-requisitos

- Conta Oracle Cloud OCI ativa em **PAYG mode** (não Always Free puro — ver [ADR 0091](../decisions/0091-self-host-total-oracle-sp.md) §"Por que PAYG")
- Cartão de crédito vinculado (PAYG; mantém free tier R$0 enquanto não exceder)
- SSH key gerada localmente (`ed25519` recomendado): `ssh-keygen -t ed25519 -C "logifit-oracle" -f ~/.ssh/logifit-oracle`
- Domínio `logifit.com.br` registrado e DNS apontando pra Cloudflare
- Cloudflare API token (perm. Zone:DNS:Edit) — usado pelo Caddy DNS-01

## Passo a passo

### 1. Conta Oracle PAYG (15min)

- [ ] Login em [cloud.oracle.com](https://cloud.oracle.com)
- [ ] Billing → Upgrade to Pay As You Go (cartão de crédito)
- [ ] Confirmar modo PAYG (não retorna pra Always Free; risco menor de suspensão sem aviso)

### 2. Provisionar VPS na região Vinhedo (15min)

- [ ] Compute → Instances → Create Instance
- [ ] Image: `Ubuntu 22.04 LTS ARM64`
- [ ] Shape: **VM.Standard.A1.Flex** com **4 OCPU + 24 GB RAM**
- [ ] Region: **`sa-vinhedo-1`** (não SP capital `sa-saopaulo-1` — Vinhedo tem free tier ARM consistentemente)
- [ ] Networking: VCN default + subnet pública + assign reserved public IP
- [ ] SSH key: paste do `~/.ssh/logifit-oracle.pub`
- [ ] Boot volume: 200 GB (block storage extra)
- [ ] Wait Provisioning (~3-5min) — anotar IP público

### 3. Configurar DNS no Cloudflare (5min)

- [ ] Cloudflare DNS → adicionar A records (proxied):
  - `app.logifit.com.br` → `<IP público VPS>`
  - `coolify.logifit.com.br` → `<IP>` (proxied + IP allowlist firewall regras)
  - `monitor.logifit.com.br` → `<IP>` (Grafana)
  - `errors.logifit.com.br` → `<IP>` (GlitchTip)
- [ ] TTL 300s

### 4. Bootstrap script (40-60min)

```bash
ssh -i ~/.ssh/logifit-oracle ubuntu@<IP>

# Clone repo
sudo apt update && sudo apt install -y git
git clone https://github.com/EvertonSkp/logifit.git
cd logifit

# Rodar script idempotente (a criar — Faixa 2)
sudo bash infra/bootstrap-oracle.sh
```

O script faz:
- [ ] apt update + Docker + Docker Compose
- [ ] UFW: 22 (SSH only do IP fundador) / 80 / 443 / 8000 (Coolify console restrito)
- [ ] Swap 4GB
- [ ] unattended-upgrades de segurança
- [ ] fail2ban
- [ ] Coolify install via script oficial
- [ ] Usuário `coolify` não-root

### 5. Configurar Coolify (15min)

- [ ] Acessar `https://coolify.logifit.com.br`
- [ ] Setup admin (email do fundador)
- [ ] GitHub integration (PAT pessoal LogiFit, scope `repo` + `read:packages`)
- [ ] Adicionar GHCR como container source
- [ ] Configurar webhook deploy on push em `main` para repo `EvertonSkp/logifit`

### 6. Stack containers (15min)

Cada container em docker-compose próprio gerenciado pelo Coolify:
- [ ] `pgvector/pgvector:pg16` + PgBouncer
- [ ] `redis:7-alpine`
- [ ] `minio/minio:latest`
- [ ] `glitchtip/glitchtip:latest` + ClickHouse
- [ ] `grafana/loki:latest` + Promtail
- [ ] `grafana/grafana:latest`

Volumes em `/data/{postgres,redis,minio,glitchtip,loki,grafana}` (block storage 200GB).

### 7. Caddy SSL automático (10min)

- [ ] Coolify Caddy config — DNS-01 challenge via Cloudflare API token
- [ ] Domains: `app.logifit.com.br` → Next.js, `coolify.` → Coolify, `monitor.` → Grafana, `errors.` → GlitchTip
- [ ] Validar HTTPS A+ em [ssllabs.com](https://www.ssllabs.com/ssltest/)

### 8. Primeiro deploy "Hello World" (10min)

- [ ] Push em `main` no repo
- [ ] GHA `deploy.yml` builda multi-arch + push GHCR
- [ ] Coolify webhook puxa imagem ARM64 + rolling restart
- [ ] `curl https://app.logifit.com.br` retorna 200 + página renderiza tokens EV

## Validação final

- ✓ HTTPS A+ no SSL Labs
- ✓ Security headers presentes (`curl -I` mostra HSTS, X-Frame-Options, CSP)
- ✓ `app.logifit.com.br` retorna home no locale detectado
- ✓ Coolify monitora os 6 containers (todos `healthy`)

## Em caso de erro

- Ver [`oracle-cutover-rollback.md`](oracle-cutover-rollback.md) para rollback
- Postar issue em GitHub com prints e logs do `bootstrap-oracle.sh`
