import PDFDocument from 'pdfkit';
import { ApprovalSource, BookingStatus, MoveType, PaymentStatus } from '@prisma/client';
import { prisma } from '../prisma.js';

const TZ = process.env.REPORT_TIMEZONE ?? 'America/Vancouver';

const MOVE_LABELS: Record<MoveType, string> = {
  MOVE_IN: 'Move In', MOVE_OUT: 'Move Out', FURNISHED_MOVE: 'Furnished Move', SUITCASE_MOVE: 'Suitcase Move',
  DELIVERY: 'Delivery', RENO: 'Renovation', OPEN_HOUSE: 'Open House',
};
const FEE_LABELS: Record<string, string> = {
  move_in: 'Move In', move_out: 'Move Out', furnished_move: 'Furnished Move', suitcase_move: 'Suitcase Move',
  delivery: 'Delivery', reno: 'Renovation', unknown: 'Unclassified',
};
const ACTION_LABELS: Record<string, string> = {
  BOOKING_APPROVED: 'Approved by staff', BOOKING_QUICK_APPROVED: 'Created and approved by staff', BOOKING_REJECTED: 'Rejected',
  BOOKING_UPDATED: 'Details edited', BOOKING_UPDATED_BY_RESIDENT: 'Edited by resident', BOOKING_CANCELLED_BY_RESIDENT: 'Cancelled by resident',
  BOOKING_DELETED: 'Booking deleted', CONFLICT_OVERRIDE: 'Scheduling conflict overridden',
  PAYMENT_AUTO_MATCHED: 'Payment matched automatically', PAYMENT_MANUALLY_MATCHED: 'Payment matched by staff',
  PAYMENT_UNMATCHED: 'Payment unmatched', PAYMENT_REVERSED: 'Payment reversed', PAYMENT_DISMISSED: 'Payment dismissed',
  PAYMENT_RESTORED: 'Payment restored', PAYMENT_FEE_TYPE_CHANGED: 'Payment fee type changed',
  PAYMENT_REMINDER_SENT: 'Payment reminder sent (automatic)', BOOKING_PAYMENT_REMINDER_SENT: 'Payment reminder sent by staff',
  DOCUMENT_UPLOADED: 'Document uploaded',
};

// ── Formatting helpers ──────────────────────────────────────────────────

/** Standard PDF fonts only cover Latin-1; replace anything else so text never renders as garbage. */
export function clean(v: unknown): string {
  return String(v ?? '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/→/g, '->')
    .replace(/[^\x20-\x7E -ÿ–—•]/g, '?');
}
export const money = (n: number | null | undefined) => (n == null ? 'n/r' : `$${n.toFixed(2)}`);
// moveDate is a date-only column and booking times are stored as wall-clock digits labelled UTC.
const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const fmtTimeRange = (a: Date, b: Date) => `${a.toISOString().slice(11, 16)}-${b.toISOString().slice(11, 16)}`;
const fmtStamp = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(',', '');

// ── Data ────────────────────────────────────────────────────────────────

export interface ReportParams {
  from: Date;          // inclusive, date-only
  to: Date;            // inclusive, date-only
  includeLog: boolean;
  generatedBy: string;
}

export interface ReportBooking {
  id: string; moveDate: Date; startDatetime: Date; endDatetime: Date; unit: string; residentName: string;
  moveType: MoveType; status: BookingStatus; statusReason: string | null; paymentStatus: PaymentStatus;
  approvalSource: ApprovalSource | null; approvedAt: Date | null; approvedByName: string | null; createdAt: Date;
  invoiceIds: string[]; amountPaid: number | null;
}
export interface ReportPayment {
  invoiceId: string; unit: string | null; feeType: string; amountPaid: number | null; paidAt: Date;
  dismissed: boolean; dismissedReason: string | null; reversedAt: Date | null;
  bookingLabel: string | null;
}
export interface ReportLogEntry { at: Date; actor: string; action: string; unit: string | null; detail: string }

export interface ReportData {
  params: ReportParams;
  bookings: ReportBooking[];
  payments: ReportPayment[];
  log: ReportLogEntry[];
  summary: Summary;
}

export interface Summary {
  total: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  approvedByPayment: number;
  approvedManuallyWithPayment: number;
  approvedWithoutPayment: number;
  approvedNoFee: number;
  paymentsReceived: number;
  paymentsTotal: number;
  paymentsMissingAmount: number;
  unmatchedPayments: number;
  reversedPayments: number;
  dismissedPayments: number;
}

export function summarize(bookings: ReportBooking[], payments: ReportPayment[], matchedInvoiceIds: Set<string>): Summary {
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let approvedByPayment = 0, approvedWithoutPayment = 0, approvedNoFee = 0, approvedManuallyWithPayment = 0;
  for (const b of bookings) {
    byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;
    byType[b.moveType] = (byType[b.moveType] ?? 0) + 1;
    if (b.status !== BookingStatus.APPROVED) continue;
    if (b.approvalSource === ApprovalSource.AUTO) approvedNoFee++;
    else if (b.paymentStatus === PaymentStatus.NONE) approvedWithoutPayment++;
    else if (b.approvalSource === ApprovalSource.PAYMENT) approvedByPayment++;
    else approvedManuallyWithPayment++;
  }
  const live = payments.filter((p) => !p.dismissed && !p.reversedAt);
  const withAmount = live.filter((p) => p.amountPaid != null);
  return {
    total: bookings.length, byStatus, byType,
    approvedByPayment, approvedManuallyWithPayment, approvedWithoutPayment, approvedNoFee,
    paymentsReceived: live.length,
    paymentsTotal: withAmount.reduce((sum, p) => sum + (p.amountPaid ?? 0), 0),
    paymentsMissingAmount: live.length - withAmount.length,
    unmatchedPayments: live.filter((p) => !matchedInvoiceIds.has(p.invoiceId)).length,
    reversedPayments: payments.filter((p) => p.reversedAt).length,
    dismissedPayments: payments.filter((p) => p.dismissed).length,
  };
}

function describeLog(action: string, meta: any): string {
  const parts: string[] = [];
  if (meta?.changes) {
    for (const [field, c] of Object.entries<any>(meta.changes)) parts.push(`${field}: ${c.from ?? '-'} -> ${c.to ?? '-'}`);
  }
  if (meta?.reason) parts.push(`Reason: ${meta.reason}`);
  if (meta?.invoiceId) parts.push(`Invoice ${meta.invoiceId}${meta.amountPaid ? ` ($${Number(meta.amountPaid).toFixed(2)})` : ''}`);
  if (action === 'BOOKING_APPROVED' && meta?.withoutPayment) parts.push('without matched payment');
  return parts.join('; ');
}

export async function gatherReport(params: ReportParams): Promise<ReportData> {
  const dayAfter = new Date(params.to.getTime() + 86_400_000);

  const rawBookings = await prisma.booking.findMany({
    where: { moveDate: { gte: params.from, lte: params.to } },
    orderBy: [{ moveDate: 'asc' }, { startDatetime: 'asc' }],
    include: { approvedBy: { select: { name: true } } },
  });
  const ids = rawBookings.map((b) => b.id);
  const approvals = await prisma.moveApproval.findMany({
    where: { moveRequestId: { in: ids } },
    include: { payment: { select: { invoiceId: true, amountPaid: true } } },
  });
  const approvalsByBooking = new Map<string, typeof approvals>();
  for (const a of approvals) approvalsByBooking.set(a.moveRequestId, [...(approvalsByBooking.get(a.moveRequestId) ?? []), a]);

  const bookings: ReportBooking[] = rawBookings.map((b) => {
    const pays = approvalsByBooking.get(b.id) ?? [];
    const amounts = pays.map((p) => (p.payment.amountPaid == null ? null : Number(p.payment.amountPaid)));
    return {
      id: b.id, moveDate: b.moveDate, startDatetime: b.startDatetime, endDatetime: b.endDatetime, unit: b.unit,
      residentName: b.residentName, moveType: b.moveType, status: b.status, statusReason: b.statusReason,
      paymentStatus: b.paymentStatus, approvalSource: b.approvalSource, approvedAt: b.approvedAt,
      approvedByName: b.approvedBy?.name ?? null, createdAt: b.createdAt,
      invoiceIds: pays.map((p) => p.payment.invoiceId),
      amountPaid: amounts.length && amounts.every((a) => a != null) ? amounts.reduce((s, a) => s + (a as number), 0) : null,
    };
  });

  const rawPayments = await prisma.paymentsLedger.findMany({
    where: { paidAt: { gte: params.from, lt: dayAfter } },
    orderBy: { paidAt: 'asc' },
    include: { moveApprovals: true },
  });
  const payBookingIds = rawPayments.flatMap((p) => p.moveApprovals.map((a) => a.moveRequestId));
  const payBookings = await prisma.booking.findMany({
    where: { id: { in: payBookingIds } },
    select: { id: true, unit: true, moveType: true, moveDate: true },
  });
  const pbById = new Map(payBookings.map((b) => [b.id, b]));
  const payments: ReportPayment[] = rawPayments.map((p) => {
    const b = pbById.get(p.moveApprovals[0]?.moveRequestId ?? '');
    return {
      invoiceId: p.invoiceId, unit: p.unit, feeType: p.feeType, amountPaid: p.amountPaid == null ? null : Number(p.amountPaid),
      paidAt: p.paidAt, dismissed: p.dismissed, dismissedReason: p.dismissedReason, reversedAt: p.reversedAt,
      bookingLabel: b ? `Unit ${b.unit} ${MOVE_LABELS[b.moveType]} ${fmtDate(b.moveDate)}` : null,
    };
  });
  const matched = new Set(rawPayments.filter((p) => p.moveApprovals.length).map((p) => p.invoiceId));

  let log: ReportLogEntry[] = [];
  if (params.includeLog) {
    const rows = await prisma.auditLog.findMany({
      where: {
        timestamp: { gte: params.from, lt: dayAfter },
        action: { notIn: ['SEARCH_HISTORY', 'VIEW_BOOKING_DETAILS', 'VIEW_RELATED_BOOKINGS', 'REPORT_GENERATED'] },
      },
      orderBy: { timestamp: 'asc' },
      take: 5000,
      include: { actor: { select: { name: true } }, booking: { select: { unit: true } } },
    });
    log = rows.map((r) => ({
      at: r.timestamp, actor: r.actor.name, action: ACTION_LABELS[r.action] ?? r.action.replace(/_/g, ' ').toLowerCase(),
      unit: r.booking?.unit ?? null, detail: describeLog(r.action, r.metadataJson),
    }));
  }

  return { params, bookings, payments, log, summary: summarize(bookings, payments, matched) };
}

// ── PDF rendering ───────────────────────────────────────────────────────

const INK = '#0f172a', MUTED = '#64748b', RULE = '#cbd5e1', BRAND = '#1d6fa5', ZEBRA = '#f1f5f9', WARN = '#b45309';

interface Col<T> { title: string; width: number; get: (row: T) => string; align?: 'left' | 'right' }

export function renderReport(data: ReportData): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: 'Move Booking Activity Report', Author: 'MoveCal' } });
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 20;

  const heading = (text: string) => {
    if (doc.y > bottom() - 80) doc.addPage();
    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(13).fillColor(BRAND).text(text, left, doc.y);
    doc.moveTo(left, doc.y + 2).lineTo(left + width, doc.y + 2).strokeColor(RULE).lineWidth(0.5).stroke();
    doc.moveDown(0.5).fillColor(INK);
  };

  const note = (text: string, color = MUTED) => doc.font('Helvetica').fontSize(8.5).fillColor(color).text(clean(text), left, doc.y, { width }).moveDown(0.3).fillColor(INK);

  function table<T>(cols: Col<T>[], rows: T[], empty: string) {
    if (!rows.length) { note(empty); return; }
    const total = cols.reduce((s, c) => s + c.width, 0);
    const widths = cols.map((c) => (c.width / total) * width);
    const drawHeader = () => {
      const y = doc.y;
      doc.rect(left, y, width, 16).fill(BRAND);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff');
      let x = left;
      cols.forEach((c, i) => { doc.text(c.title, x + 3, y + 4.5, { width: widths[i] - 6, align: c.align ?? 'left', lineBreak: false }); x += widths[i]; });
      doc.y = y + 16;
      doc.fillColor(INK);
    };
    drawHeader();
    rows.forEach((row, ri) => {
      doc.font('Helvetica').fontSize(7.5);
      const cells = cols.map((c, i) => clean(c.get(row)));
      const h = Math.max(...cells.map((t, i) => doc.heightOfString(t, { width: widths[i] - 6 }))) + 6;
      if (doc.y + h > bottom()) { doc.addPage(); drawHeader(); doc.font('Helvetica').fontSize(7.5); }
      const y = doc.y;
      if (ri % 2 === 1) doc.rect(left, y, width, h).fill(ZEBRA);
      doc.fillColor(INK);
      let x = left;
      cells.forEach((t, i) => { doc.text(t, x + 3, y + 3, { width: widths[i] - 6, align: cols[i].align ?? 'left' }); x += widths[i]; });
      doc.y = y + h;
    });
    doc.moveDown(0.4);
  }

  function keyValues(rows: [string, string][]) {
    doc.font('Helvetica').fontSize(9.5);
    rows.forEach(([k, v]) => {
      const y = doc.y;
      doc.fillColor(MUTED).text(clean(k), left, y, { width: 250, continued: false });
      doc.fillColor(INK).font('Helvetica-Bold').text(clean(v), left + 260, y, { width: width - 260 });
      doc.font('Helvetica');
    });
    doc.moveDown(0.3);
  }

  const { params, summary: s } = data;

  // ── Title ──
  doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text('Move Booking Activity Report', left, 40);
  doc.font('Helvetica').fontSize(10.5).fillColor(MUTED)
    .text(`Period: ${fmtDate(params.from)} to ${fmtDate(params.to)} (by move date; payments by date received)`)
    .text(`Generated ${fmtStamp(new Date())} (${TZ}) by ${clean(params.generatedBy)}`);
  doc.fillColor(INK);

  // ── Summary ──
  heading('1. Summary');
  keyValues([
    ['Booking requests in period', String(s.total)],
    ...Object.entries(s.byStatus).map(([k, v]) => [`   ${k.charAt(0) + k.slice(1).toLowerCase()}`, String(v)] as [string, string]),
  ]);
  keyValues([
    ['Approved - move fee paid and matched', String(s.approvedByPayment + s.approvedManuallyWithPayment)],
    ['Approved - no fee applicable (open house)', String(s.approvedNoFee)],
    ['Approved WITHOUT a matched payment', String(s.approvedWithoutPayment)],
  ]);
  keyValues([
    ['Payments received in period', String(s.paymentsReceived)],
    ['Total of payments with a recorded amount', money(s.paymentsTotal)],
    ...(s.paymentsMissingAmount ? [['Payments with no recorded amount (n/r)', String(s.paymentsMissingAmount)] as [string, string]] : []),
    ['Payments not yet matched to a booking', String(s.unmatchedPayments)],
    ['Payments reversed / cancelled', String(s.reversedPayments)],
    ['Payments dismissed (not move fees)', String(s.dismissedPayments)],
  ]);
  doc.moveDown(0.2);
  table<[string, number]>(
    [{ title: 'Request type', width: 3, get: (r) => r[0] }, { title: 'Count', width: 1, align: 'right', get: (r) => String(r[1]) }],
    Object.entries(s.byType).map(([k, v]) => [MOVE_LABELS[k as MoveType] ?? k, v] as [string, number]).sort((a, b) => b[1] - a[1]),
    'No requests in this period.'
  );

  // ── Exceptions ──
  heading('2. Items for attention');
  const noPay = data.bookings.filter((b) => b.status === BookingStatus.APPROVED && b.paymentStatus === PaymentStatus.NONE && b.approvalSource !== ApprovalSource.AUTO);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text('Approved without a matched payment', left, doc.y).moveDown(0.2);
  table<ReportBooking>([
    { title: 'Move date', width: 1.2, get: (b) => fmtDate(b.moveDate) },
    { title: 'Unit', width: 0.8, get: (b) => b.unit },
    { title: 'Resident', width: 2, get: (b) => b.residentName },
    { title: 'Type', width: 1.4, get: (b) => MOVE_LABELS[b.moveType] },
    { title: 'Approved by', width: 1.6, get: (b) => b.approvedByName ?? 'n/r' },
    { title: 'Approved on', width: 1.6, get: (b) => (b.approvedAt ? fmtStamp(b.approvedAt) : 'n/r') },
  ], noPay, 'None - every approved booking with a fee has a matched payment.');

  const reversed = data.bookings.filter((b) => b.paymentStatus === PaymentStatus.REFUNDED);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text('Bookings whose payment was later reversed', left, doc.y).moveDown(0.2);
  table<ReportBooking>([
    { title: 'Move date', width: 1.2, get: (b) => fmtDate(b.moveDate) },
    { title: 'Unit', width: 0.8, get: (b) => b.unit },
    { title: 'Resident', width: 2, get: (b) => b.residentName },
    { title: 'Type', width: 1.4, get: (b) => MOVE_LABELS[b.moveType] },
    { title: 'Invoice', width: 1.6, get: (b) => b.invoiceIds.join(', ') },
    { title: 'Status', width: 1.2, get: (b) => b.status },
  ], reversed, 'None.');

  // ── Booking register ──
  heading('3. Booking requests');
  note('Contact details (email, phone) are intentionally omitted from this report.');
  table<ReportBooking>([
    { title: 'Move date', width: 1.15, get: (b) => fmtDate(b.moveDate) },
    { title: 'Time', width: 1.05, get: (b) => fmtTimeRange(b.startDatetime, b.endDatetime) },
    { title: 'Unit', width: 0.7, get: (b) => b.unit },
    { title: 'Resident', width: 1.7, get: (b) => b.residentName },
    { title: 'Type', width: 1.3, get: (b) => MOVE_LABELS[b.moveType] },
    { title: 'Status', width: 1.1, get: (b) => b.status + (b.statusReason ? ` (${b.statusReason})` : '') },
    { title: 'Payment', width: 1.7, get: (b) => paymentCell(b) },
    { title: 'Approval', width: 1.5, get: (b) => approvalCell(b) },
  ], data.bookings, 'No booking requests in this period.');

  // ── Payment register ──
  heading('4. Payments received');
  table<ReportPayment>([
    { title: 'Paid', width: 1.1, get: (p) => fmtDate(p.paidAt) },
    { title: 'Invoice', width: 1.3, get: (p) => p.invoiceId },
    { title: 'Unit', width: 0.8, get: (p) => p.unit ?? 'n/r' },
    { title: 'Fee type', width: 1.3, get: (p) => FEE_LABELS[p.feeType] ?? p.feeType },
    { title: 'Amount', width: 1, align: 'right', get: (p) => money(p.amountPaid) },
    { title: 'Matched booking / status', width: 3, get: (p) => p.reversedAt ? `REVERSED ${fmtDate(p.reversedAt)}` : p.dismissed ? `Dismissed: ${p.dismissedReason ?? ''}` : p.bookingLabel ?? 'Not matched' },
  ], data.payments, 'No payments received in this period.');
  note('n/r = not recorded. Amounts were not captured for payments received before amount tracking began.');

  // ── Activity log ──
  if (params.includeLog) {
    heading('5. Activity log');
    note(`System-recorded actions in the period (${data.log.length} entries${data.log.length >= 5000 ? ', truncated at 5000' : ''}). Every entry is timestamped and attributed to a user or to the system.`);
    table<ReportLogEntry>([
      { title: 'Date / time', width: 1.5, get: (l) => fmtStamp(l.at) },
      { title: 'By', width: 1.3, get: (l) => l.actor },
      { title: 'Unit', width: 0.7, get: (l) => l.unit ?? '' },
      { title: 'Action', width: 2.2, get: (l) => l.action },
      { title: 'Detail', width: 3, get: (l) => l.detail },
    ], data.log, 'No recorded activity in this period.');
  }

  // ── Page footers ──
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
    // Draw inside the bottom margin without triggering an automatic page break.
    const y = doc.page.height - 30;
    doc.page.margins.bottom = 0;
    doc.text(`MoveCal activity report  |  ${fmtDate(params.from)} to ${fmtDate(params.to)}`, left, y, { width: width - 80, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, left + width - 80, y, { width: 80, align: 'right', lineBreak: false });
  }
  return doc;
}

function paymentCell(b: ReportBooking): string {
  if (b.paymentStatus === PaymentStatus.REFUNDED) return `REVERSED (${b.invoiceIds.join(', ')})`;
  if (b.paymentStatus === PaymentStatus.PAID) return `Paid ${b.invoiceIds.join(', ')}${b.amountPaid != null ? ` - ${money(b.amountPaid)}` : ''}`;
  if (b.status === BookingStatus.APPROVED) return b.approvalSource === ApprovalSource.AUTO ? 'No fee' : 'NONE';
  if (b.status === BookingStatus.SUBMITTED || b.status === BookingStatus.PENDING) return 'Awaiting payment';
  return '-';
}

function approvalCell(b: ReportBooking): string {
  if (b.status !== BookingStatus.APPROVED) return '-';
  const how = b.approvalSource === ApprovalSource.PAYMENT ? 'By payment' : b.approvalSource === ApprovalSource.AUTO ? 'Automatic' : 'Manual';
  return `${how}${b.approvedByName ? ` - ${b.approvedByName}` : ''}`;
}
