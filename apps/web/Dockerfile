# LogiFit web app — Next.js 15 standalone multi-stage build
# Sprint 00 Faixa 2 (ADR 0091) — image puxada pelo Coolify no VPS Oracle Vinhedo ARM64.
#
# Build context = raiz do monorepo (não apps/web/) — pnpm workspaces precisam.
# Coolify configura: Base Directory = / · Dockerfile Path = apps/web/Dockerfile
#
# 3 stages:
#  1. base    — Node 22 alpine + corepack pnpm + libc6-compat (Next.js precisa)
#  2. builder — instala deps + build Next.js standalone
#  3. runner  — runtime mínimo, non-root, copia só standalone + static + public

# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22-alpine

# ============================================================
# Stage 1 — base
# ============================================================
FROM node:${NODE_VERSION} AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# ============================================================
# Stage 2 — builder (instala + buildar Next.js standalone)
# ============================================================
FROM base AS builder
WORKDIR /repo

# Copia tudo do monorepo (.dockerignore filtra node_modules/.next/etc)
COPY . .

# Instala deps com cache mount pro pnpm store (BuildKit)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Build apenas o @app/web (transpilePackages cuida dos @repo/*)
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @app/web build

# ============================================================
# Stage 3 — runner (runtime mínimo)
# ============================================================
FROM node:${NODE_VERSION} AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user (defense in depth — regra 35 + ADR 0073)
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

# Next.js standalone output (monorepo aware via outputFileTracingRoot no next.config.ts):
#   /repo/apps/web/.next/standalone/         → root do runtime (tem node_modules deduzido)
#   /repo/apps/web/.next/standalone/apps/web/server.js  → entrypoint
#   /repo/apps/web/.next/static               → assets estáticos
#   /repo/apps/web/public                     → public dir
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public

USER nextjs

EXPOSE 3000

# Healthcheck simples (Next.js responde / com 200 quando rota raiz existe).
# IMPORTANTE: usar 127.0.0.1 (não localhost) — Alpine BusyBox wget resolve
# localhost como IPv6 [::1] primeiro, e Next.js standalone com HOSTNAME=0.0.0.0
# só bind em IPv4 → connection refused. 127.0.0.1 força IPv4.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/ || exit 1

CMD ["node", "apps/web/server.js"]
