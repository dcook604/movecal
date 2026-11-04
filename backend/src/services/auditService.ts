import { PrismaClient } from '@prisma/client';

type AuditDb = Pick<PrismaClient, 'auditLog'>;

/**
 * Creates an audit log entry with optional metadata.
 *
 * @param metadata - Optional metadata object that can include:
 *   - ip: IP address of the request
 *   - userAgent: User agent string
 *   - any other contextual information
 */
export async function logAudit(
  prisma: AuditDb,
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

/** Field-level diff of two records, limited to `keys`. Returns null when nothing changed. */
export function diffFields<T extends Record<string, any>>(before: T, after: T, keys: (keyof T)[]) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of keys) {
    const av: unknown = before[k];
    const bv: unknown = after[k];
    const a = av instanceof Date ? av.toISOString() : av;
    const b = bv instanceof Date ? bv.toISOString() : bv;
    if (a !== b) changes[k as string] = { from: a ?? null, to: b ?? null };
  }
  return Object.keys(changes).length ? changes : null;
}
