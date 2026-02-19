FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package.json
COPY backend/package.json backend/package.json

RUN npm install -w backend

COPY backend backend

RUN npm run prisma:generate -w backend
RUN npm run build -w backend

FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/backend/dist backend/dist
COPY --from=builder /app/backend/prisma backend/prisma
COPY --from=builder /app/backend/node_modules backend/node_modules
COPY --from=builder /app/backend/package.json backend/package.json
COPY --from=builder /app/package.json package.json
COPY docker-entrypoint.sh /app/docker-entrypoint.sh

RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 4000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
