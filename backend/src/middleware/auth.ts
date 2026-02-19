import { FastifyReply, FastifyRequest } from 'fastify';
import { UserRole } from '@prisma/client';

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  await req.jwtVerify();
}

export function requireRole(roles: UserRole[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await req.jwtVerify();
    if (!roles.includes((req.user as any).role)) {
      reply.status(403).send({ message: 'Forbidden' });
    }
  };
}
