import { FastifyInstance } from 'fastify';
import { BookingStatus, MoveType, NotifyEvent, UserRole } from '@prisma/client';
import dayjs from 'dayjs';
import { z } from 'zod';
import path from 'path';
import fs from 'fs/promises';
import { nanoid } from 'nanoid';
import { prisma } from '../prisma.js';
import { assertNoConflict } from '../services/conflictService.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { sendEmail, sendNotificationRecipients, bookingDetailsHtml, emailWrapper, sendPaymentConfirmationToDcook } from '../services/emailService.js';
import { logAudit } from '../services/auditService.js';
import { config } from '../config.js';
import { validateMoveTime } from '../utils/moveTimeValidator.js';
import { checkAndApproveMoveRequest } from '../services/moveApprovalService.js';

// ── Email / phone validation helpers ──────────────────────────────────
const COMMON_TLDS = new Set([
  'com','net','org','edu','gov','mil','int','info','biz','name','pro','aero','coop','museum',
  'io','co','app','dev','ai','gg','me','tv','fm','ac','cc','xyz','online','site','store',
  'tech','cloud','digital','media','news','live','shop','web','blog','design','email',
  'ca','uk','au','nz','us','ie','de','fr','es','it','nl','be','ch','at','se','no','dk',
  'fi','pl','pt','cz','sk','hu','ro','gr','hr','bg','lt','lv','ee','si','rs','me','mk',
  'al','ba','by','ua','ru','kz','uz','ge','am','az','md','kg','tj','af','bd','in','pk',
  'lk','np','mm','kh','th','vn','my','sg','id','ph','jp','cn','tw','kr','hk','mo','mn',
  'la','bn','bt','mv','cx','gi','im','je','vg','ky','tc','ms','dm','gd','lc','vc','bb',
  'tt','ag','kn','jm','ht','do','pr','cu','bs','bm','aw','cw','sx','re','yt','nc','pf',
  'mq','gp','tf','pm','sh','gs','fk','ar','br','cl','ec','pe','uy','ve','mx','gt','hn',
  'sv','ni','cr','pa','tz','ke','ng','gh','za','eg','ma','dz','tn','ly','sd','et','ug',
  'rw','mz','zm','zw','bw','na','ls','sz','mw','mg','mu','sc','km','dj','so','er','sa',
  'ae','qa','kw','bh','om','ye','iq','ir','sy','lb','jo','il','ps','tr','cy','mt','is',
  'li','lu','mc','sm','va','ad','fo','gl','nu','tk','to','ws','fj','pg','sb','vu','ki',
  'pw','nr','as','mp','gu','wf','arpa',
]);

function isValidEmailTld(email: string): boolean {
  const atIdx = email.lastIndexOf('@');
  if (atIdx < 0) return false;
  const domain = email.slice(atIdx + 1).toLowerCase();
  const dotIdx = domain.lastIndexOf('.');
  if (dotIdx < 0) return false;
  const tld = domain.slice(dotIdx + 1);
  return /^[a-z]+$/.test(tld) && COMMON_TLDS.has(tld);
}

const BLOCKED_AREA_CODES = new Set(['000', '111', '911']);

function isValidPhonePrefix(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return true; // length check handled separately
  // Strip leading country code 1 (NANP) if present
  const ten = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits.slice(0, 10);
  const area = ten.slice(0, 3);
  if (BLOCKED_AREA_CODES.has(area)) return false;
  // Reject all-same-digit numbers (e.g. 1111111111)
  if (/^(\d)\1{9}$/.test(ten)) return false;
  return true;
}

const createSchema = z.object({
  residentName: z.string().min(1).max(200),
  residentEmail: z.string().email().max(320).refine(isValidEmailTld, { message: 'Email domain does not appear to be valid. Please double-check the address.' }), // RFC 5321 max email length
  residentPhone: z.string().min(1).max(50).refine(isValidPhonePrefix, { message: 'Phone number appears invalid. Please check the area code.' }),
  unit: z.string().min(1).max(20),
  moveType: z.nativeEnum(MoveType),
  companyName: z.string().max(200).optional(),
  moveDate: z.coerce.date(),
  startDatetime: z.coerce.date(),
  endDatetime: z.coerce.date(),
  elevatorRequired: z.boolean(),
  loadingBayRequired: z.boolean(),
  notes: z.string().max(2000).optional(),
  publicUnitMask: z.string().max(20).optional()
});

// Quick-entry schema: name/email/phone are optional (admin knows who they're booking for)
const quickEntrySchema = createSchema.extend({
  residentName:  z.string().max(200).optional().default(''),
  residentEmail: z.string().max(320).optional().default(''),
  residentPhone: z.string().max(50).optional().default(''),
});

// UUID validation schema for ID parameters
const uuidSchema = z.string().uuid();

export async function bookingRoutes(app: FastifyInstance) {
  app.post('/api/bookings', async (req, reply) => {
    const body = createSchema.parse(req.body);

    // Validate move time restrictions
    const timeValidation = validateMoveTime(body.startDatetime, body.endDatetime, body.moveType);
    if (!timeValidation.valid) {
      return reply.status(400).send({ message: timeValidation.error });
    }

    const systemUser = await prisma.user.findFirst({ where: { role: UserRole.CONCIERGE } });
    if (!systemUser) return reply.status(500).send({ message: 'Seed concierge user first' });

    const booking = await prisma.$transaction(async (tx) => {
      await assertNoConflict(
        tx,
        { startDatetime: body.startDatetime, endDatetime: body.endDatetime, elevatorRequired: body.elevatorRequired, moveType: body.moveType },
        false
      );
      return tx.booking.create({
        data: {
          createdById: systemUser.id,
          residentName: body.residentName,
          residentEmail: body.residentEmail,
          residentPhone: body.residentPhone,
          unit: body.unit,
          companyName: body.companyName,
          moveType: body.moveType,
          moveDate: body.moveDate,
          startDatetime: body.startDatetime,
          endDatetime: body.endDatetime,
          elevatorRequired: body.elevatorRequired,
          loadingBayRequired: body.loadingBayRequired,
          notes: body.notes,
          publicUnitMask: body.publicUnitMask,
          status: BookingStatus.SUBMITTED
        }
      });
    });

    // Check if payment already exists for this booking (payment-first flow)
    let paymentConfirmed = false;
    if (booking.moveType === MoveType.MOVE_IN || booking.moveType === MoveType.MOVE_OUT) {
      const billingPeriod = dayjs(booking.moveDate).format('YYYY-MM');
      const feeType = booking.moveType === MoveType.MOVE_IN ? 'move_in' : 'move_out';
      const approvalResult = await checkAndApproveMoveRequest({
        unit: booking.unit,
        feeType,
        billingPeriod,
        bookingId: booking.id,
      }).catch((err) => {
        app.log.error({ err, bookingId: booking.id }, 'Invoice approval check failed');
        return { approved: false };
      });
      paymentConfirmed = approvalResult.approved;
    }

    const moveTypeLabel = { MOVE_IN: 'Move In', MOVE_OUT: 'Move Out', DELIVERY: 'Delivery', RENO: 'Renovation', OPEN_HOUSE: 'Open House' }[booking.moveType] ?? booking.moveType;
    const dateLabel = dayjs(booking.startDatetime).format('MMM D, YYYY');

    if (paymentConfirmed) {
      // Booking was auto-approved — send approval emails, not a pending-review email
      await sendNotificationRecipients(
        prisma,
        NotifyEvent.APPROVED,
        `Booking Auto-Approved (Payment Confirmed) — ${moveTypeLabel} for Unit ${booking.unit}`,
        emailWrapper(
          'Booking Auto-Approved',
          'A move fee payment was confirmed in Invoice Ninja. The following booking has been automatically approved.',
          bookingDetailsHtml(booking, true, true)
        )
      ).catch((err) => {
        app.log.error({ err, bookingId: booking.id, event: 'APPROVED' }, 'Failed to send auto-approval notification email');
      });

      await sendEmail(
        prisma,
        body.residentEmail,
        `Booking Approved — ${moveTypeLabel} on ${dateLabel}`,
        emailWrapper(
          'Booking Approved',
          'Your move fee payment has been confirmed. Your booking has been automatically approved.',
          bookingDetailsHtml(booking, false, true)
        )
      ).catch((err) => {
        app.log.error({ err, bookingId: booking.id, email: body.residentEmail }, 'Failed to send auto-approval email');
      });

      await sendPaymentConfirmationToDcook(prisma, booking).catch((err) => {
        app.log.error({ err, bookingId: booking.id }, 'Failed to send payment confirmation to dcook');
      });
    } else {
      await sendNotificationRecipients(
        prisma,
        NotifyEvent.SUBMITTED,
        `New Booking Request — ${moveTypeLabel} for Unit ${booking.unit}`,
        emailWrapper(
          'New Booking Request',
          'A new booking request has been submitted and is awaiting review.',
          bookingDetailsHtml(booking, true)
        )
      ).catch((err) => {
        app.log.error({ err, bookingId: booking.id, event: 'SUBMITTED' }, 'Failed to send notification email');
      });

      await sendEmail(
        prisma,
        body.residentEmail,
        `Booking Request Received — ${moveTypeLabel} on ${dateLabel}`,
        emailWrapper(
          'Booking Request Received',
          'Your booking request has been submitted and is pending review. If no action is taken within 24 hours, it will be automatically approved.',
          bookingDetailsHtml(booking)
        )
      ).catch((err) => {
        app.log.error({ err, bookingId: booking.id, email: body.residentEmail }, 'Failed to send booking confirmation email');
      });
    }

    return booking;
  });

  app.post('/api/admin/quick-entry/approve', { preHandler: [requireRole([UserRole.CONCIERGE, UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (req, reply) => {
    const body = quickEntrySchema.parse(req.body);

    // Validate move time restrictions (admins can override with proper role)
    const user = req.user;
    const overrideRoles: UserRole[] = [UserRole.COUNCIL, UserRole.PROPERTY_MANAGER];
    const allowOverride = overrideRoles.includes(user.role);

    if (!allowOverride) {
      const timeValidation = validateMoveTime(body.startDatetime, body.endDatetime, body.moveType);
      if (!timeValidation.valid) {
        return reply.status(400).send({ message: timeValidation.error });
      }
    }

    const booking = await prisma.$transaction(async (tx) => {
      await assertNoConflict(
        tx,
        { startDatetime: body.startDatetime, endDatetime: body.endDatetime, elevatorRequired: body.elevatorRequired, moveType: body.moveType },
        allowOverride
      );

      return tx.booking.create({
        data: {
          createdById: user.id,
          residentName: body.residentName,
          residentEmail: body.residentEmail,
          residentPhone: body.residentPhone,
          unit: body.unit,
          companyName: body.companyName,
          moveType: body.moveType,
          moveDate: body.moveDate,
          startDatetime: body.startDatetime,
          endDatetime: body.endDatetime,
          elevatorRequired: body.elevatorRequired,
          loadingBayRequired: body.loadingBayRequired,
          notes: body.notes,
          publicUnitMask: body.publicUnitMask,
          status: BookingStatus.APPROVED,
          approvedById: user.id,
          approvedAt: new Date()
        }
      });
    });

    await logAudit(prisma, user.id, 'BOOKING_QUICK_APPROVED', booking.id, { source: 'concierge_quick_entry' });
    return booking;
  });

  app.get('/api/bookings/:id', { preHandler: [requireAuth] }, async (req) => {
    const id = uuidSchema.parse((req.params as { id: string }).id);
    return prisma.booking.findUnique({ where: { id } });
  });

  app.get(
    '/api/admin/bookings',
    { preHandler: [requireRole([UserRole.CONCIERGE, UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] },
    async () => {
      const bookings = await prisma.booking.findMany({ include: { documents: true }, orderBy: { startDatetime: 'asc' } });
      const approvals = await prisma.moveApproval.findMany({ where: { moveRequestId: { in: bookings.map(b => b.id) } } });
      const approvalByBooking = new Map(approvals.map(a => [a.moveRequestId, a]));
      return bookings.map(b => {
        const approval = approvalByBooking.get(b.id);
        return { ...b, paymentMatched: !!approval, paymentInvoiceId: approval?.invoiceId ?? null };
      });
    }
  );

  app.patch('/api/admin/bookings/:id', { preHandler: [requireRole([UserRole.CONCIERGE, UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (req, reply) => {
    const body = z
      .object({
        status: z.nativeEnum(BookingStatus).optional(),
        startDatetime: z.coerce.date().optional(),
        endDatetime: z.coerce.date().optional(),
        overrideConflict: z.boolean().optional(),
        residentName: z.string().min(1).max(200).optional(),
        residentEmail: z.string().email().max(320).refine(isValidEmailTld, { message: 'Email domain does not appear to be valid.' }).optional(),
        residentPhone: z.string().min(1).max(50).refine(isValidPhonePrefix, { message: 'Phone number appears invalid. Please check the area code.' }).optional(),
        unit: z.string().min(1).max(20).optional(),
        companyName: z.string().max(200).nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
        moveType: z.nativeEnum(MoveType).optional(),
        elevatorRequired: z.boolean().optional(),
        loadingBayRequired: z.boolean().optional(),
      })
      .parse(req.body);

    const user = req.user;
    const bookingId = uuidSchema.parse((req.params as { id: string }).id);
    const existing = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const overrideRoles: UserRole[] = [UserRole.COUNCIL, UserRole.PROPERTY_MANAGER];
    const allowOverride = overrideRoles.includes(user.role) && !!body.overrideConflict;

    // Validate move time restrictions if times or move type are being updated
    if ((body.startDatetime || body.endDatetime || body.moveType) && !allowOverride) {
      const newStart = body.startDatetime ?? existing.startDatetime;
      const newEnd = body.endDatetime ?? existing.endDatetime;
      const timeValidation = validateMoveTime(newStart, newEnd, body.moveType ?? existing.moveType);
      if (!timeValidation.valid) {
        return reply.status(400).send({ message: timeValidation.error });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      await assertNoConflict(
        tx,
        {
          id: existing.id,
          startDatetime: body.startDatetime ?? existing.startDatetime,
          endDatetime: body.endDatetime ?? existing.endDatetime,
          elevatorRequired: body.elevatorRequired ?? existing.elevatorRequired,
          moveType: body.moveType ?? existing.moveType,
        },
        allowOverride
      );

      return tx.booking.update({
        where: { id: existing.id },
        data: {
          status: body.status ?? existing.status,
          ...(body.startDatetime !== undefined && { startDatetime: body.startDatetime, moveDate: body.startDatetime }),
          ...(body.endDatetime !== undefined && { endDatetime: body.endDatetime }),
          ...(body.residentName !== undefined && { residentName: body.residentName }),
          ...(body.residentEmail !== undefined && { residentEmail: body.residentEmail }),
          ...(body.residentPhone !== undefined && { residentPhone: body.residentPhone }),
          ...(body.unit !== undefined && { unit: body.unit }),
          ...(body.companyName !== undefined && { companyName: body.companyName }),
          ...(body.notes !== undefined && { notes: body.notes }),
          ...(body.moveType !== undefined && { moveType: body.moveType }),
          ...(body.elevatorRequired !== undefined && { elevatorRequired: body.elevatorRequired }),
          ...(body.loadingBayRequired !== undefined && { loadingBayRequired: body.loadingBayRequired }),
          ...(body.status === BookingStatus.APPROVED && { approvedById: user.id, approvedAt: new Date() }),
        }
      });
    });

    if (allowOverride) await logAudit(prisma, user.id, 'CONFLICT_OVERRIDE', updated.id, { old: existing, new: updated });

    if (body.status === BookingStatus.APPROVED) {
      const [settings, moveApproval] = await Promise.all([
        prisma.appSetting.findFirst(),
        prisma.moveApproval.findFirst({ where: { moveRequestId: updated.id } }),
      ]);
      const includeContact = !!settings?.includeResidentContactInApprovalEmails;
      const paymentConfirmed = !!moveApproval;
      const approvedMoveLabel = { MOVE_IN: 'Move In', MOVE_OUT: 'Move Out', DELIVERY: 'Delivery', RENO: 'Renovation', OPEN_HOUSE: 'Open House' }[updated.moveType] ?? updated.moveType;
      const approvedSubject = `Booking Approved — ${approvedMoveLabel} on ${dayjs(updated.startDatetime).format('MMM D, YYYY')}`;

      await sendEmail(
        prisma,
        updated.residentEmail,
        approvedSubject,
        emailWrapper(
          'Booking Approved',
          'Your booking request has been approved. Please see the details below.',
          bookingDetailsHtml(updated, false, paymentConfirmed)
        )
      ).catch((err) => {
        app.log.error({ err, bookingId: updated.id, email: updated.residentEmail }, 'Failed to send booking approval email');
      });

      await sendNotificationRecipients(
        prisma,
        NotifyEvent.APPROVED,
        approvedSubject,
        emailWrapper(
          'Booking Approved',
          'The following booking has been approved.',
          bookingDetailsHtml(updated, includeContact, paymentConfirmed)
        )
      ).catch((err) => {
        app.log.error({ err, bookingId: updated.id, event: 'APPROVED' }, 'Failed to send approval notification');
      });

      await logAudit(prisma, user.id, 'BOOKING_APPROVED', updated.id, { status: updated.status });
    }

    if (body.status === BookingStatus.REJECTED) {
      const rejectedMoveLabel = { MOVE_IN: 'Move In', MOVE_OUT: 'Move Out', DELIVERY: 'Delivery', RENO: 'Renovation', OPEN_HOUSE: 'Open House' }[updated.moveType] ?? updated.moveType;
      const rejectedSubject = `Booking Not Approved — ${rejectedMoveLabel} on ${dayjs(updated.startDatetime).format('MMM D, YYYY')}`;

      await sendEmail(
        prisma,
        updated.residentEmail,
        rejectedSubject,
        emailWrapper(
          'Booking Not Approved',
          'Unfortunately your booking request could not be approved. Please contact building management if you have any questions.',
          bookingDetailsHtml(updated)
        )
      ).catch((err) => {
        app.log.error({ err, bookingId: updated.id, email: updated.residentEmail }, 'Failed to send booking rejection email');
      });

      await sendNotificationRecipients(
        prisma,
        NotifyEvent.REJECTED,
        rejectedSubject,
        emailWrapper(
          'Booking Rejected',
          'The following booking request has been rejected.',
          bookingDetailsHtml(updated, true)
        )
      ).catch((err) => {
        app.log.error({ err, bookingId: updated.id, event: 'REJECTED' }, 'Failed to send rejection notification');
      });

      await logAudit(prisma, user.id, 'BOOKING_REJECTED', updated.id, { status: updated.status });
    }

    return updated;
  });

  app.delete('/api/admin/bookings/:id', { preHandler: [requireRole([UserRole.CONCIERGE, UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (req) => {
    const bookingId = uuidSchema.parse((req.params as { id: string }).id);
    const user = req.user;
    const existing = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });

    // Nullify audit log FK references then delete booking (documents cascade automatically)
    await prisma.$transaction([
      prisma.auditLog.updateMany({ where: { bookingId }, data: { bookingId: null } }),
      prisma.booking.delete({ where: { id: bookingId } })
    ]);

    await logAudit(prisma, user.id, 'BOOKING_DELETED', undefined, {
      residentName: existing.residentName,
      unit: existing.unit,
      moveType: existing.moveType,
      status: existing.status
    });

    return { message: 'Booking deleted successfully' };
  });

  app.post('/api/admin/bookings/:id/documents', { preHandler: [requireRole([UserRole.CONCIERGE, UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (req) => {
    const data = await req.file();
    if (!data) throw new Error('No file');
    const allowedMime = new Set(['application/pdf', 'image/jpeg', 'image/png']);
    if (!allowedMime.has(data.mimetype)) {
      throw new Error('Unsupported file type');
    }
    const id = uuidSchema.parse((req.params as { id: string }).id);
    const uploadsRoot = path.resolve(config.uploadsDir);
    await fs.mkdir(uploadsRoot, { recursive: true });
    const safeName = path.basename(data.filename);
    const ext = path.extname(safeName);
    const name = `${Date.now()}-${nanoid(8)}${ext}`;
    const storagePath = path.join(uploadsRoot, name);
    await fs.writeFile(storagePath, await data.toBuffer());
    return prisma.document.create({ data: { bookingId: id, originalName: safeName, storagePath, mimeType: data.mimetype } });
  });
}
