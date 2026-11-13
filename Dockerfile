# syntax=docker/dockerfile:1
# Nova — Next.js standalone server + DB/admin scripts in one image (app and scheduler containers).
# Data (SQLite file, uploaded media, backups) lives in the /data volume.

FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# --- dependencies (cached until package*.json changes) -------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# --- build ---------------------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- runtime -------------------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/data/nova.db \
    MEDIA_DIR=/data/uploads

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --chown=node:node db/schema.sql db/seed.sql db/drop_all.sql ./db/
COPY --chown=node:node db/migrations ./db/migrations
COPY --chown=node:node scripts ./scripts
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN mkdir -p /data && chown node:node /data

USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "server.js"]
