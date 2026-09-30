# syntax=docker/dockerfile:1

# One image runs everything: the API, background jobs and the built web app on a single origin.

FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @et/web build && pnpm --filter @et/api build
# A self-contained copy of the API package with production dependencies only.
RUN pnpm --filter @et/api deploy --prod --legacy /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST_DIR=/app/web \
    MIGRATIONS_DIR=/app/drizzle
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
COPY --from=build /repo/apps/web/dist ./web
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
# Migrations run automatically on start.
CMD ["node", "dist/server.js"]
