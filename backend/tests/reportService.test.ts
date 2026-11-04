import { describe, expect, it } from 'vitest';
import { clean, money, summarize, ReportBooking, ReportPayment } from '../src/services/reportService.js';

const b = (o: Partial<ReportBooking>): ReportBooking => ({
  id: 'x', moveDate: new Date('2026-03-01'), startDatetime: new Date('2026-03-01T10:00:00Z'), endDatetime: new Date('2026-03-01T13:00:00Z'),
  unit: '1', residentName: 'R', moveType: 'MOVE_IN', status: 'APPROVED', statusReason: null, paymentStatus: 'NONE', approvalSource: null,
  approvedAt: null, approvedByName: null, createdAt: new Date(), invoiceIds: [], amountPaid: null, ...o,
});
const p = (o: Partial<ReportPayment>): ReportPayment => ({
  invoiceId: 'i', unit: '1', feeType: 'move_in', amountPaid: 50, paidAt: new Date(), dismissed: false, dismissedReason: null, reversedAt: null, bookingLabel: null, ...o,
});

describe('summarize', () => {
  it('splits approvals by how they were approved', () => {
    const s = summarize([
      b({ paymentStatus: 'PAID', approvalSource: 'PAYMENT' }),
      b({ approvalSource: 'MANUAL' }),                      // approved without payment
      b({ moveType: 'OPEN_HOUSE', approvalSource: 'AUTO' }),
      b({ status: 'REJECTED' }),
    ], [], new Set());
    expect(s).toMatchObject({ total: 4, approvedByPayment: 1, approvedWithoutPayment: 1, approvedNoFee: 1 });
    expect(s.byStatus).toEqual({ APPROVED: 3, REJECTED: 1 });
  });

  it('totals only live payments and flags missing amounts and unmatched', () => {
    const s = summarize([], [
      p({ invoiceId: 'a', amountPaid: 50 }),
      p({ invoiceId: 'b', amountPaid: null }),
      p({ invoiceId: 'c', amountPaid: 25.5, reversedAt: new Date() }),
      p({ invoiceId: 'd', amountPaid: 10, dismissed: true }),
    ], new Set(['a']));
    expect(s.paymentsReceived).toBe(2);
    expect(s.paymentsTotal).toBe(50);
    expect(s.paymentsMissingAmount).toBe(1);
    expect(s.unmatchedPayments).toBe(1);
    expect(s.reversedPayments).toBe(1);
    expect(s.dismissedPayments).toBe(1);
  });
});

describe('helpers', () => {
  it('replaces characters the PDF font cannot draw', () => {
    expect(clean('José → 王')).toBe('José -> ?');
    expect(money(null)).toBe('n/r');
    expect(money(51.5)).toBe('$51.50');
  });
});
