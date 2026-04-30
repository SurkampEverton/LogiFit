#!/usr/bin/env bash
# bootstrap-oracle.sh — provisiona VPS Oracle Cloud Vinhedo do zero pra LogiFit.
# Sprint 00 Faixa 2 (ADR 0091). Idempotente — rodar de novo após Oracle morrer = restaurar.
#
# Pré-requisitos:
#   - VPS Ubuntu 22.04 LTS ARM64 provisionado (VM.Standard.A1.Flex 4 OCPU + 24 GB RAM)
#   - SSH como ubuntu (sudo sem senha)
#   - Domínio logifit.com.br no Cloudflare apontando A record para IP do VPS
#   - Cloudflare API token (DNS:Edit) — necessário pro Caddy DNS-01 challenge
#
# Uso (no VPS após SSH):
#   sudo bash /opt/logifit/infra/bootstrap-oracle.sh
#
# Documentação companheira: docs/runbooks/bootstrap-oracle.md

set -euo pipefail

LOG="/var/log/logifit-bootstrap-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1

echo "→ LogiFit bootstrap Oracle Vinhedo"
echo "→ Log em $LOG"
echo

# ──────────────────────────────────────────
# 1. Pacotes base + atualizações de segurança
# ──────────────────────────────────────────
echo "• apt update + upgrade"
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get -y -o Dpkg::Options::="--force-confold" upgrade
apt-get install -y \
  curl wget git \
  ufw fail2ban \
  unattended-upgrades \
  ca-certificates \
  gnupg lsb-release \
  htop iotop ncdu

# ──────────────────────────────────────────
# 2. Docker + Docker Compose plugin
# ──────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  echo "• Instalando Docker"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    | tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi

# ──────────────────────────────────────────
# 3. UFW firewall (regra 35)
# ──────────────────────────────────────────
echo "• Configurando UFW"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP (Caddy redirect)'
ufw allow 443/tcp comment 'HTTPS (Caddy)'
ufw allow 8000/tcp comment 'Coolify console (restringir ao IP fundador depois)'
ufw --force enable

# ──────────────────────────────────────────
# 4. fail2ban
# ──────────────────────────────────────────
echo "• Habilitando fail2ban"
systemctl enable --now fail2ban

# ──────────────────────────────────────────
# 5. Unattended upgrades (segurança automática)
# ──────────────────────────────────────────
echo "• Habilitando unattended-upgrades"
echo 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";' > /etc/apt/apt.conf.d/20auto-upgrades

# ──────────────────────────────────────────
# 6. Swap 4GB (defesa contra OOM em picos)
# ──────────────────────────────────────────
if ! swapon --show | grep -q '/swapfile'; then
  echo "• Criando swap 4GB"
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ──────────────────────────────────────────
# 7. Hardening SSH
# ──────────────────────────────────────────
echo "• Hardening SSH (PasswordAuthentication no, PermitRootLogin no)"
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh

# ──────────────────────────────────────────
# 8. Coolify install (script oficial)
# ──────────────────────────────────────────
if [ ! -d /data/coolify ]; then
  echo "• Instalando Coolify"
  curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
else
  echo "• Coolify já instalado em /data/coolify (skip)"
fi

# ──────────────────────────────────────────
# 9. /data partition check (block volume Oracle 200GB)
# ──────────────────────────────────────────
if [ ! -d /data ]; then
  echo "⚠ AVISO: /data ausente — anexar block volume Oracle 200GB e montar em /data antes de provisionar containers persistentes."
  echo "   Comando típico: oci compute volume-attachment attach-paravirtualized-volume + sudo mkfs.ext4 /dev/oracleoci/oraclevdb + adicionar a /etc/fstab"
fi

echo
echo "✓ Bootstrap base completo em $(date -Iseconds)"
echo
echo "→ Próximos passos manuais (no painel Coolify):"
echo "  1. Acessar Coolify em https://<IP-VPS>:8000 (ou coolify.logifit.com.br após DNS) e fazer setup admin"
echo "  2. Adicionar GitHub PAT pessoal (scope repo + read:packages) em Sources"
echo "  3. Configurar webhook deploy on push em main"
echo "  4. Provisionar containers: pgvector/pgvector:pg16 + pgbouncer + redis:7-alpine + minio/minio + glitchtip/glitchtip + clickhouse/clickhouse-server (req GlitchTip) + grafana/loki + grafana/promtail + grafana/grafana"
echo "  5. Configurar Caddy: app.logifit.com.br → Next.js, coolify. + monitor. + errors. (DNS-01 challenge via Cloudflare API token)"
echo "  6. Primeiro deploy 'Hello World': push em main → GHA multi-arch → GHCR → webhook → Coolify pull arm64 + rolling restart"
echo "  7. Validar: curl https://app.logifit.com.br retorna 200 + headers de segurança presentes (HSTS, X-Frame-Options, CSP)"
echo
echo "→ Log completo em $LOG"
