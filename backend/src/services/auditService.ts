import { PrismaClient } from '@prisma/client';

export async function logAudit(prisma: PrismaClient, actorUserId: string, action: string, bookingId?: string, metadataJson?: unknown) {
  await prisma.auditLog.create({ data: { actorUserId, action, bookingId, metadataJson: metadataJson as any } });
}
