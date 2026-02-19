import bcrypt from 'bcryptjs';
import { prisma } from './prisma.js';
import { UserRole } from '@prisma/client';

async function main() {
  const pwd = await bcrypt.hash('ChangeMe123!', 10);
  await prisma.user.upsert({ where: { email: 'concierge@strata.local' }, update: {}, create: { name: 'Concierge', email: 'concierge@strata.local', role: UserRole.CONCIERGE, passwordHash: pwd } });
  await prisma.user.upsert({ where: { email: 'manager@strata.local' }, update: {}, create: { name: 'Manager', email: 'manager@strata.local', role: UserRole.PROPERTY_MANAGER, passwordHash: pwd } });
}
main().finally(() => prisma.$disconnect());
