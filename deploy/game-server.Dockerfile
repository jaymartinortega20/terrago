# TerraGo authoritative game server — production image.
# Build from the repository root:
#   docker build -f deploy/game-server.Dockerfile -t terrago-game-server .

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/game-data/package.json packages/game-data/
COPY packages/database/package.json packages/database/
COPY apps/game-server/package.json apps/game-server/
COPY apps/web/package.json apps/web/
RUN npm ci -w @terrago/game-server --include-workspace-root
COPY packages packages
COPY apps/game-server apps/game-server
RUN npm run build -w @terrago/game-server

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/game-data/package.json packages/game-data/
COPY packages/database/package.json packages/database/
COPY apps/game-server/package.json apps/game-server/
COPY apps/web/package.json apps/web/
RUN npm ci -w @terrago/game-server --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production \
    MIGRATIONS_DIR=/app/dist/migrations \
    PORT=4000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/game-server/dist ./dist
RUN printf '{"type":"module"}' > package.json
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1
CMD ["node", "--enable-source-maps", "dist/index.js"]
