import { FastifyInstance } from 'fastify';
import { BookingStatus, MoveType, Prisma, UserRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/auditService.js';
import {
  IdentityRow,
  IgnoredContacts,
  Link,
  classifyLink,
  classifyQuery,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  normalizeUnit,
} from '../utils/identity.js';

const ALL_ROLES = [UserRole.CONCIERGE, UserRole.COUNCIL, UserRole.PROPERTY_MANAGER];
const MANAGER_ROLES = [UserRole.COUNCIL, UserRole.PROPERTY_MANAGER];
// Searching exposes resident PII across the full history — keep bulk scraping expensive.
const searchRateLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };

const searchSchema = z.object({
  q: z.string().trim().min(2).max(100),
  status: z.nativeEnum(BookingStatus).optional(),
  moveType: z.nativeEnum(MoveType).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.number().int().min(1).max(1000).default(1),
  pageSize: z.number().int().min(1).max(50).default(25),
});

const bookingSelect = {
  id: true,
  unit: true,
  unitNorm: true,
  residentName: true,
  residentEmail: true,
  residentPhone: true,
  residentEmailNorm: true,
  residentPhoneNorm: true,
  companyName: true,
  moveType: true,
  status: true,
  moveDate: true,
  startDatetime: true,
  endDatetime: true,
} satisfies Prisma.BookingSelect;

type BookingRow = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;

async function loadIgnored(): Promise<IgnoredContacts> {
  const rows = await prisma.sharedContact.findMany();
  return {
    emails: new Set(rows.filter((r) => r.kind === 'EMAIL').map((r) => r.value)),
    phones: new Set(rows.filter((r) => r.kind === 'PHONE').map((r) => r.value)),
  };
}

/** Bookings that could be linked to any of the given rows (superset; classifyLink does the real check). */
async function fetchCandidates(rows: BookingRow[], ignored: IgnoredContacts): Promise<BookingRow[]> {
  const emails = [...new Set(rows.map((r) => r.residentEmailNorm).filter((v): v is string => !!v && !ignored.emails.has(v)))];
  const phones = [...new Set(rows.map((r) => r.residentPhoneNorm).filter((v): v is string => !!v && !ignored.phones.has(v)))];
  const names = [...new Set(rows.map((r) => normalizeName(r.residentName)).filter((n) => n.includes(' ')))];
  const or: Prisma.BookingWhereInput[] = [
    ...(emails.length ? [{ residentEmailNorm: { in: emails } }] : []),
    ...(phones.length ? [{ residentPhoneNorm: { in: phones } }] : []),
    ...names.map((n) => ({ residentName: { equals: n, mode: 'insensitive' as const } })),
  ];
  if (!or.length) return [];
  return prisma.booking.findMany({ where: { OR: or }, select: bookingSelect, orderBy: { moveDate: 'desc' }, take: 1000 });
}

interface LinkedUnit {
  unit: string;
  strength: 'strong' | 'weak';
  via: string[];
  bookingCount: number;
}

function linkedUnitsFor(row: BookingRow, candidates: BookingRow[], ignored: IgnoredContacts): LinkedUnit[] {
  const byUnit = new Map<string, LinkedUnit>();
  for (const c of candidates) {
    const link = classifyLink(row, c, ignored);
    if (!link) continue;
    const key = c.unitNorm ?? c.unit;
    const cur = byUnit.get(key);
    if (!cur) {
      byUnit.set(key, { unit: c.unit, strength: link.strength, via: [...link.via], bookingCount: 1 });
    } else {
      cur.bookingCount += 1;
      if (link.strength === 'strong') cur.strength = 'strong';
      for (const v of link.via) if (!cur.via.includes(v)) cur.via.push(v);
    }
  }
  return [...byUnit.values()].sort((a, b) => (a.strength === b.strength ? a.unit.localeCompare(b.unit) : a.strength === 'strong' ? -1 : 1));
}

function matchedOn(row: BookingRow, q: string): string[] {
  const out: string[] = [];
  const lower = q.toLowerCase();
  const tokens = lower.split(/\s+/).filter(Boolean);
  if (tokens.every((t) => row.residentName.toLowerCase().includes(t))) out.push('name');
  if (row.residentEmailNorm?.includes(lower)) out.push('email');
  const phone = normalizePhone(q) ?? q.replace(/\D/g, '');
  if (phone.length >= 7 && row.residentPhoneNorm?.includes(phone)) out.push('phone');
  const u = normalizeUnit(q);
  if (u && row.unitNorm && (row.unitNorm === u || (u.length >= 3 && row.unitNorm.endsWith(u)))) out.push('unit');
  return out;
}

function buildWhere(q: string, f: z.infer<typeof searchSchema>): Prisma.BookingWhereInput {
  const kind = classifyQuery(q);
  let match: Prisma.BookingWhereInput;
  if (kind === 'email') {
    match = { residentEmailNorm: { contains: q.toLowerCase() } };
  } else if (kind === 'phone') {
    const digits = normalizePhone(q) ?? q.replace(/\D/g, '');
    match = { residentPhoneNorm: { contains: digits } };
  } else if (kind === 'unit') {
    const u = normalizeUnit(q);
    match = { OR: [{ unitNorm: u }, ...(u.length >= 3 ? [{ unitNorm: { endsWith: u } }] : [])] };
  } else {
    const tokens = q.split(/\s+/).filter(Boolean);
    const nameMatch: Prisma.BookingWhereInput = { AND: tokens.map((t) => ({ residentName: { contains: t, mode: 'insensitive' as const } })) };
    match = tokens.length === 1 ? { OR: [nameMatch, { residentEmailNorm: { contains: q.toLowerCase() } }] } : nameMatch;
  }
  return {
    AND: [
      match,
      ...(f.status ? [{ status: f.status }] : []),
      ...(f.moveType ? [{ moveType: f.moveType }] : []),
      ...(f.from || f.to ? [{ moveDate: { ...(f.from && { gte: f.from }), ...(f.to && { lte: f.to }) } }] : []),
    ],
  };
}

export async function historyRoutes(app: FastifyInstance) {
  // POST (not GET) so resident PII typed into the search box never lands in access-log URLs.
  app.post('/api/admin/bookings/search', { preHandler: [requireRole(ALL_ROLES)], config: searchRateLimit }, async (req) => {
    const body = searchSchema.parse(req.body);
    const where = buildWhere(body.q, body);

    const [total, rows] = await Promise.all([
      prisma.booking.count({ where }),
      prisma.booking.findMany({
        where,
        select: bookingSelect,
        orderBy: [{ moveDate: 'desc' }, { createdAt: 'desc' }],
        skip: (body.page - 1) * body.pageSize,
        take: body.pageSize,
      }),
    ]);

    // Cross-unit detection runs on the page's identities, independent of pagination.
    const ignored = await loadIgnored();
    const candidates = await fetchCandidates(rows, ignored);

    const results = rows.map((r) => {
      const linkedUnits = linkedUnitsFor(r, candidates, ignored);
      const { residentEmailNorm, residentPhoneNorm, unitNorm, ...rest } = r;
      return {
        ...rest,
        matchedOn: matchedOn(r, body.q),
        linkedUnits,
        linkStrength: linkedUnits.length ? (linkedUnits.some((l) => l.strength === 'strong') ? 'strong' : 'weak') : null,
        sharedContact: !!(
          (residentEmailNorm && ignored.emails.has(residentEmailNorm)) ||
          (residentPhoneNorm && ignored.phones.has(residentPhoneNorm))
        ),
      };
    });

    // Never log the raw query — it may be a phone number or email.
    await logAudit(prisma, req.user.id, 'SEARCH_HISTORY', undefined, {
      field: classifyQuery(body.q),
      resultCount: total,
      filters: { status: body.status, moveType: body.moveType, from: body.from, to: body.to },
    });

    return { results, total, page: body.page, pageSize: body.pageSize };
  });

  // Full details for one booking (history "open move" view). Staff-only; the resident's edit token is never returned.
  app.get('/api/admin/bookings/:id/details', { preHandler: [requireRole(ALL_ROLES)], config: searchRateLimit }, async (req, reply) => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = await prisma.booking.findUnique({
      where: { id },
      include: {
        createdBy: { select: { name: true, role: true } },
        approvedBy: { select: { name: true, role: true } },
        documents: { select: { id: true, originalName: true, mimeType: true, uploadedAt: true }, orderBy: { uploadedAt: 'asc' } },
        auditLogs: { select: { id: true, action: true, timestamp: true, actor: { select: { name: true } } }, orderBy: { timestamp: 'asc' } },
      },
    });
    if (!b) return reply.status(404).send({ message: 'Booking not found' });
    const approval = await prisma.moveApproval.findFirst({ where: { moveRequestId: id } });
    const { editToken, residentEmailNorm, residentPhoneNorm, unitNorm, ...rest } = b;
    await logAudit(prisma, req.user.id, 'VIEW_BOOKING_DETAILS', id);
    return { ...rest, paymentMatched: !!approval, paymentInvoiceId: approval?.invoiceId ?? null };
  });

  // Everything linked to one booking's resident, across units (identity drawer).
  app.get('/api/admin/bookings/:id/related', { preHandler: [requireRole(ALL_ROLES)], config: searchRateLimit }, async (req) => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id }, select: bookingSelect });
    const ignored = await loadIgnored();
    const candidates = await fetchCandidates([booking], ignored);

    const related = candidates
      .filter((c) => c.id !== id)
      .map((c) => ({ c, link: classifyLink(booking, c, ignored) }))
      .filter((x): x is { c: BookingRow; link: Link } => !!x.link)
      .map(({ c, link }) => {
        const { residentEmailNorm, residentPhoneNorm, unitNorm, ...rest } = c;
        return { ...rest, link };
      });

    await logAudit(prisma, req.user.id, 'VIEW_RELATED_BOOKINGS', id, { relatedCount: related.length });

    return {
      booking: { id: booking.id, unit: booking.unit, residentName: booking.residentName },
      contacts: {
        email: booking.residentEmailNorm,
        phone: booking.residentPhoneNorm,
        emailShared: !!(booking.residentEmailNorm && ignored.emails.has(booking.residentEmailNorm)),
        phoneShared: !!(booking.residentPhoneNorm && ignored.phones.has(booking.residentPhoneNorm)),
      },
      related,
    };
  });

  // Shared-contact ignore list (movers, agents, property managers...)
  app.get('/api/admin/shared-contacts', { preHandler: [requireRole(ALL_ROLES)] }, async () =>
    prisma.sharedContact.findMany({ orderBy: { createdAt: 'desc' } })
  );

  app.post('/api/admin/shared-contacts', { preHandler: [requireRole(MANAGER_ROLES)] }, async (req, reply) => {
    const body = z
      .object({ kind: z.enum(['EMAIL', 'PHONE']), value: z.string().min(1).max(320), label: z.string().max(200).optional() })
      .parse(req.body);
    const value = body.kind === 'EMAIL' ? normalizeEmail(body.value) : normalizePhone(body.value);
    if (!value) return reply.status(400).send({ message: `Invalid ${body.kind.toLowerCase()}` });
    const contact = await prisma.sharedContact.upsert({
      where: { kind_value: { kind: body.kind, value } },
      create: { kind: body.kind, value, label: body.label },
      update: { label: body.label },
    });
    await logAudit(prisma, req.user.id, 'SHARED_CONTACT_ADDED', undefined, { kind: body.kind });
    return contact;
  });

  app.delete('/api/admin/shared-contacts/:id', { preHandler: [requireRole(MANAGER_ROLES)] }, async (req) => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    await prisma.sharedContact.delete({ where: { id } });
    await logAudit(prisma, req.user.id, 'SHARED_CONTACT_REMOVED');
    return { ok: true };
  });
}
