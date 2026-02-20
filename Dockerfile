FROM node:20-alpine AS builder

WORKDIR /app

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

COPY package.json package.json
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN apk add --no-cache openssl
# Ensure dev deps are installed for build tools like tsc even if NODE_ENV is set in the build environment.
RUN npm install --include=dev

COPY backend backend
COPY frontend frontend

RUN npm run prisma:generate -w backend
RUN npm run build -w backend
RUN npm run build -w frontend
RUN npm prune --omit=dev

FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache openssl

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

COPY --from=builder /app/backend/dist backend/dist
COPY --from=builder /app/backend/prisma backend/prisma
COPY --from=builder /app/frontend/dist frontend/dist
COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/backend/package.json backend/package.json
COPY --from=builder /app/package.json package.json
COPY docker-entrypoint.sh /app/docker-entrypoint.sh

RUN chmod +x /app/docker-entrypoint.sh

# Set ownership to non-root user and switch
RUN chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 4000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
