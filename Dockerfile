# ==============================
# Build stage
# ==============================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency files first (layer caching)
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Pass Vite env vars at build time via build args
ARG VITE_CARTO_BASEMAP_KEY
ENV VITE_CARTO_BASEMAP_KEY=${VITE_CARTO_BASEMAP_KEY}

# Build the Vite app (TypeScript check + production build)
RUN npm run build

# ==============================
# Production stage
# ==============================
FROM node:22-alpine AS production

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/tsconfig.json ./tsconfig.json

ENV PORT=4174
ENV HOST=0.0.0.0
ENV APP_ORIGIN=https://biojaveriana-admin.downloadablefox.dev
ENV BACKEND_URL=https://biojaveriana.downloadablefox.dev/api/v1

EXPOSE 4174
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4174/ >/dev/null 2>&1 || exit 1

CMD ["node", "--import", "tsx", "server/index.ts"]