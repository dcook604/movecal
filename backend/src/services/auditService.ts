import { PrismaClient } from '@prisma/client';

/**
 * Creates an audit log entry with optional metadata.
 *
 * @param metadata - Optional metadata object that can include:
 *   - ip: IP address of the request
 *   - userAgent: User agent string
 *   - any other contextual information
 */
export async function logAudit(
  prisma: PrismaClient,
  actorUserId: string,
  action: string,
  bookingId?: string,
  metadata?: Record<string, any>
) {
  await prisma.auditLog.create({
    data: {
      actorUserId,
      action,
      bookingId,
      metadataJson: metadata || {}
    }
  });
}
