import { FastifyReply, FastifyRequest } from 'fastify';
import { UserRole } from '@prisma/client';
import { prisma } from '../prisma.js';

// Verifies the JWT, then re-checks the user against the database so deleted users,
// role changes and password changes take effect immediately instead of at token expiry.
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  await req.jwtVerify();
  const claims = req.user as typeof req.user & { iat?: number };
  const user = await prisma.user.findUnique({
    where: { id: claims.id },
    select: { role: true, email: true, name: true, mustChangePassword: true, passwordChangedAt: true }
  });
  const issuedAt = claims.iat ?? 0;
  if (!user || (user.passwordChangedAt && issuedAt < Math.floor(user.passwordChangedAt.getTime() / 1000))) {
    return reply.status(401).send({ message: 'Session is no longer valid' });
  }
  req.user = {
    id: claims.id,
    role: user.role,
    email: user.email,
    name: user.name,
    mustChangePassword: user.mustChangePassword
  };
}

export function requireRole(roles: UserRole[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const denied = await requireAuth(req, reply);
    if (denied) return denied;
    if (!roles.includes(req.user.role)) {
      return reply.status(403).send({ message: 'Forbidden' });
    }
  };
}
