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
import { historyRoutes } from './routes/historyRoutes.js';
import { systemRoutes } from './routes/systemRoutes.js';
import { startInvoiceNinjaPoller } from './services/invoiceNinjaPoller.js';
import { prisma } from './prisma.js';
import { startAutoApprovalJob } from './services/autoApprovalService.js';
import { startPaymentReminderJob } from './services/paymentReminderService.js';
import { ZodError } from 'zod';

const app = Fastify({ logger: true, bodyLimit: 2 * 1024 * 1024, trustProxy: (_addr: string, hop: number) => hop < 1 });

app.setErrorHandler((error, _req, reply) => {
  if (error instanceof ZodError) {
    return reply.status(400).send({ message: 'Validation error', issues: error.issues.map((i) => ({ path: i.path, message: i.message })) });
  }
  const err = error as Error & { statusCode?: number };
  const statusCode = err.statusCode ?? 500;
  const message = statusCode >= 500 ? 'Internal Server Error' : err.message;
  if (statusCode >= 500) app.log.error(err);
  reply.status(statusCode).send({ message });
});

await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: config.env === 'production' ? ["'self'"] : ["'self'", "'unsafe-inline'"], // Vite dev server needs inline scripts
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  }
});

// Auth uses a Bearer token in the Authorization header (not cookies), so requests are not
// CSRF-able and no CSRF plugin is needed.

await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });

if (config.env === 'development') {
  await app.register(cors, { origin: true });
} else {
  await app.register(cors, { origin: config.frontendOrigins, credentials: true });
}
await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: '12h' } });
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

// Uploaded documents are private: they are only served through the authenticated
// /api/admin/documents/:id route, never as public static files.
await fs.mkdir(path.resolve(config.uploadsDir), { recursive: true });

const frontendDist = path.resolve('frontend', 'dist');
const hasFrontend = await fs
  .access(frontendDist)
  .then(() => true)
  .catch(() => false);

if (hasFrontend) {
  await app.register(staticPlugin, { root: frontendDist, prefix: '/' });
  app.setNotFoundHandler(async (req, reply) => {
    if (req.raw.url?.startsWith('/api') || req.raw.url?.startsWith('/uploads')) {
      return reply.status(404).send({ message: 'Not Found' });
    }
    return reply.sendFile('index.html');
  });
}

await app.register(publicRoutes);
await app.register(bookingRoutes);
await app.register(adminRoutes);
await app.register(historyRoutes);
await app.register(systemRoutes);

startAutoApprovalJob();
startPaymentReminderJob();
startInvoiceNinjaPoller(app.log);

app.get('/health', async (_req, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'healthy', timestamp: new Date().toISOString() };
  } catch (error) {
    app.log.error(error);
    reply.status(503);
    return { status: 'unhealthy', error: 'Database connection failed' };
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
