import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import path from 'path';
import { config } from './config.js';
import { publicRoutes } from './routes/publicRoutes.js';
import { bookingRoutes } from './routes/bookingRoutes.js';
import { adminRoutes } from './routes/adminRoutes.js';
import { systemRoutes } from './routes/systemRoutes.js';

const app = Fastify({ logger: true });

app.setErrorHandler((error, _req, reply) => {
  const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
  const message = statusCode >= 500 ? 'Internal Server Error' : error.message;
  if (statusCode >= 500) app.log.error(error);
  reply.status(statusCode).send({ message });
});

await app.register(cors, { origin: true });
await app.register(jwt, { secret: config.jwtSecret });
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
await app.register(staticPlugin, { root: path.join(process.cwd(), config.uploadsDir), prefix: '/uploads/' });

await app.register(publicRoutes);
await app.register(bookingRoutes);
await app.register(adminRoutes);
await app.register(systemRoutes);

app.get('/health', async () => ({ ok: true }));

app.listen({ port: config.port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
