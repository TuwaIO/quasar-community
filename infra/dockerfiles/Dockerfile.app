# syntax=docker/dockerfile:1
# ── Stage: Base ──────────────────────────────────────────────────────────────
# Use Node.js 24 based on Debian Bookworm Slim for maximum compatibility.
FROM node:24-bookworm-slim AS base

# Lets GHCR associate every published target, including quasar-migrate, with
# the repository so repository-based package permissions can be applied.
LABEL org.opencontainers.image.source="https://github.com/TuwaIO/quasar-community"

# Run full system upgrade to patch vulnerabilities, then install essential dependencies
# Cache bust: 2026-08-03
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    libc6 \
    openssl \
    curl \
    ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Enable corepack and prepare pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate && npm install -g npm@latest

# ── Stage: Dependencies ──────────────────────────────────────────────────────
# This stage only fetches packages to prime the pnpm store cache.
FROM base AS deps
WORKDIR /app

# Copy workspace meta
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/dashboard/package.json ./apps/dashboard/package.json

# Prefetch dependencies using BuildKit cache mount
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── Stage: Builder ───────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

# Copy full source code
COPY . .

# Ensure devDependencies are installed for the build phase
ENV NODE_ENV=development

# IMPORTANT: Run pnpm install with the full source present.
# The cache mount ensures this is fast, while having all package.json files
# present ensures correct workspace symlinking.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Build environment variables
ARG NEXT_PUBLIC_SERVER_URL
ARG NEXT_PUBLIC_ENGINE_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SENTRY_DSN

ENV NEXT_PUBLIC_SERVER_URL=${NEXT_PUBLIC_SERVER_URL}
ENV NEXT_PUBLIC_ENGINE_URL=${NEXT_PUBLIC_ENGINE_URL}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN}

# Sentry source map upload (build-time only, not persisted in runner)
ARG SENTRY_AUTH_TOKEN
ARG SENTRY_ORG
ARG SENTRY_PROJECT_DASHBOARD
ARG SENTRY_RELEASE

ENV SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN}
ENV SENTRY_ORG=${SENTRY_ORG}
ENV SENTRY_PROJECT=${SENTRY_PROJECT_DASHBOARD}
ENV SENTRY_RELEASE=${SENTRY_RELEASE}

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--no-deprecation --max-old-space-size=1792"
# Dummy secrets for build-time validation bypass
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
ENV PAYLOAD_SECRET="dummy-payload-secret-min-32-chars-long"
ENV REDIS_URL="redis://:dummy@localhost:6379/0"
ENV REDIS_API_URL="redis://:dummy@localhost:6379/0"
ENV REDIS_UI_URL="redis://:dummy@localhost:6379/0"
ENV INTERNAL_SECRET="dummy-internal-secret"
ENV ENCRYPTION_KEY="74fa5f9de2d9ae4018ca49e0bd387f830e325cde6fcfbe371dcb15bb038a89f7"

# Ensure production environment for the build phase to avoid React hook/context issues
ENV NODE_ENV=production

# 1. Build local shared workspace packages (e.g., @tuwaio/shared)
RUN pnpm --filter @tuwaio/shared build

# 2. Build Next.js application with cache mount
RUN --mount=type=cache,id=next-cache,target=/app/apps/dashboard/.next/cache \
    pnpm --filter @tuwaio/quasar build

# Next's standalone tracing currently copies only the CommonJS side of
# @swc/helpers when dependencies are installed with pnpm. Next's runtime
# require-hook also loads the ESM helper files, so make that part explicit in
# the traced output before it is copied into the runner image. Keep the
# package lookup version-agnostic because the lockfile may update @swc/helpers.
RUN set -eux; \
    helper_link="$(find /app/apps/dashboard/.next/standalone/node_modules/.pnpm \
      -path '*/node_modules/@swc/helpers' -type l -print -quit)"; \
    test -n "${helper_link}"; \
    helper_dst="$(readlink -f "${helper_link}")"; \
    test -d "${helper_dst}"; \
    helper_package_dir="$(dirname "$(dirname "$(dirname "${helper_dst}")")")"; \
    helper_package="$(basename "${helper_package_dir}")"; \
    helper_src="$(find "/app/node_modules/.pnpm/${helper_package}" \
      -path '*/node_modules/@swc/helpers/esm' -type d -print -quit)"; \
    test -n "${helper_src}"; \
    cp -a "${helper_src}" "${helper_dst}/"; \
    test -f "${helper_dst}/esm/_interop_require_default.js"

# ── Stage: Runner ────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

# Production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Remove global package manager from runtime image to eliminate attack surface & bundled CVEs
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /root/.npm

# Create a system user for security
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs --create-home nextjs

# Set user home for npx/npm write operations
ENV HOME=/home/nextjs

# Copy ONLY the standalone Next.js build output
# Migration-related files (tsconfig.json, payload.config.ts, migrations, collections)
# have been removed from the runner as per request.
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/public ./apps/dashboard/public
COPY --from=builder --chown=nextjs:nodejs /app/release-manifest.json* ./

USER nextjs

EXPOSE 3000

# Metadata
LABEL maintainer="Oleksandr Tkach"
LABEL project="Quasar Dashboard"

CMD ["node", "apps/dashboard/server.js"]
