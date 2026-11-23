FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY scripts/copy-migrations.js ./scripts/
COPY src ./src
RUN npm run build
RUN cp -r src/prompts dist/src/prompts && cp package.json dist/package.json

FROM node:22-alpine AS production-deps

WORKDIR /app
COPY package*.json ./
RUN apk add --no-cache python3 make g++ && \
    npm ci --omit=dev --no-audit --no-fund

FROM node:22-alpine AS production

ENV NODE_ENV=production
ENV PORT=3000

RUN adduser -D appuser && mkdir -p /app/data && chown appuser:appuser /app/data
COPY --from=production-deps /app/node_modules /app/node_modules
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/dist /app/dist

WORKDIR /app/data
USER appuser
EXPOSE 3000

HEALTHCHECK --interval=5s --timeout=3s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "/app/dist/src/index.js"]
