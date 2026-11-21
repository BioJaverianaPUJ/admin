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

# Copy dependency files and install production-only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built assets from builder
COPY --from=builder /app/dist ./dist

# Copy server and shared source (needed by tsx at runtime)
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Expose the server port
EXPOSE 4174

# Environment variables (set at runtime via docker-compose or docker run -e)
ENV NODE_ENV=production
ENV PORT=4174
ENV APP_ORIGIN=http://localhost:4174
ENV BACKEND_URL=https://biojaveriana.downloadablefox.dev/api/v1

# Start the Express server
CMD ["node", "--import", "tsx", "server/index.ts"]
