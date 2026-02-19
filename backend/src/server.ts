import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import staticPlugin from '@fastify/static';
import fs from 'fs/promises';
import path from 'path';
import { config } from './config.js';
import { publicRoutes } from './routes/publicRoutes.js';
import { bookingRoutes } from './routes/bookingRoutes.js';
import { adminRoutes } from './routes/adminRoutes.js';
import { systemRoutes } from './routes/systemRoutes.js';
import { prisma } from './prisma.js';
import { ZodError } from 'zod';

const app = Fastify({ logger: true, bodyLimit: 2 * 1024 * 1024, trustProxy: true });

app.setErrorHandler((error, _req, reply) => {
  if (error instanceof ZodError) {
    return reply.status(400).send({ message: 'Validation error', issues: error.issues });
  }
  const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
  const message = statusCode >= 500 ? 'Internal Server Error' : error.message;
  if (statusCode >= 500) app.log.error(error);
  reply.status(statusCode).send({ message });
});

await app.register(helmet, { contentSecurityPolicy: false });
await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });

const corsOptions =
  config.env === 'development'
    ? { origin: true }
    : {
        origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
          if (!origin) return cb(null, true);
          if (config.frontendOrigins.includes(origin)) return cb(null, true);
          return cb(new Error('Origin not allowed'), false);
        },
        credentials: true
      };

await app.register(cors, corsOptions);
await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: '12h' } });
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

const uploadsRoot = path.resolve(config.uploadsDir);
await fs.mkdir(uploadsRoot, { recursive: true });
await app.register(staticPlugin, { root: uploadsRoot, prefix: '/uploads/' });

const frontendDist = path.resolve('frontend', 'dist');
const hasFrontend = await fs
  .access(frontendDist)
  .then(() => true)
  .catch(() => false);

if (hasFrontend) {
  await app.register(staticPlugin, { root: frontendDist, prefix: '/' });
  app.setNotFoundHandler(async (req, reply) => {
    if (req.raw.url?.startsWith('/api') || req.raw.url?.startsWith('/uploads/')) {
      return reply.status(404).send({ message: 'Not Found' });
    }
    return reply.sendFile('index.html');
  });
}

await app.register(publicRoutes);
await app.register(bookingRoutes);
await app.register(adminRoutes);
await app.register(systemRoutes);

app.get('/health', async (_req, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (error) {
    app.log.error(error);
    return reply.status(500).send({ ok: false });
  }
});

app.listen({ port: config.port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

const shutdown = async () => {
  try {
    await app.close();
  } finally {
    await prisma.$disconnect();
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
