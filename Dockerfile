FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --legacy-peer-deps && npm install --no-save --legacy-peer-deps tsx

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src ./src
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts

RUN mkdir -p /data/uploads

EXPOSE 3000

CMD ["npx", "tsx", "server.ts"]
