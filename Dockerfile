FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
  libcairo2 \
  libgif7 \
  libjpeg62-turbo \
  libpango-1.0-0 \
  librsvg2-2 \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DOCUMENT_STORE_DIR=/app/data/documents

RUN apt-get update && apt-get install -y --no-install-recommends \
  libreoffice-impress \
  fonts-liberation \
  fonts-noto-cjk \
  libcairo2 \
  libgif7 \
  libjpeg62-turbo \
  libpango-1.0-0 \
  librsvg2-2 \
  && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 nextjs
RUN mkdir -p /app/data/documents && chown -R nextjs:nodejs /app/data

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
