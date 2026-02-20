import bcrypt from 'bcryptjs';
import { prisma } from './prisma.js';
import { UserRole } from '@prisma/client';

async function main() {
  const pwd = await bcrypt.hash('ChangeMe123!', 10);
  const conciergeEmail = 'concierge@strata.local'.trim().toLowerCase();
  const managerEmail = 'manager@strata.local'.trim().toLowerCase();

  await prisma.user.upsert({ where: { email: conciergeEmail }, update: {}, create: { name: 'Concierge', email: conciergeEmail, role: UserRole.CONCIERGE, passwordHash: pwd } });
  await prisma.user.upsert({ where: { email: managerEmail }, update: {}, create: { name: 'Manager', email: managerEmail, role: UserRole.PROPERTY_MANAGER, passwordHash: pwd } });
}
main().finally(() => prisma.$disconnect());
