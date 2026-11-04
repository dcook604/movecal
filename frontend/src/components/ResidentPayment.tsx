import { useEffect, useState } from 'react';
import { api } from '../api';

let cached: string | null | undefined;

/** Staff-configured fee / payment instructions (null when none are set). */
export function usePaymentInstructions(): string | null {
  const [text, setText] = useState<string | null>(cached ?? null);
  useEffect(() => {
    if (cached !== undefined) return;
    api.get('/api/public/payment-info')
      .then((r) => { cached = r.data?.instructions ?? null; setText(cached ?? null); })
      .catch(() => { cached = null; });
  }, []);
  return text;
}

/** "How to pay / what happens next" panel for any booking that carries a fee. */
export function PaymentGuide({ unit, heading = 'How to pay' }: { unit?: string; heading?: string }) {
  const instructions = usePaymentInstructions();
  return (
    <aside className="payment-guide" aria-label={heading}>
      <h3 className="payment-guide-title">{heading}</h3>
      <ol>
        <li>Pay the move fee{instructions ? ' as described below' : ' to the Concierge / management'}. Please quote <strong>unit {unit || 'your unit number'}</strong> on your invoice or payment.</li>
        <li>Once your payment is received your booking is <strong>approved automatically</strong>, usually within a few minutes, and you will get a confirmation email.</li>
        <li>Requests that are not paid may be declined.</li>
      </ol>
      {instructions && <p className="payment-guide-text">{instructions}</p>}
    </aside>
  );
}

interface ProgressProps { status: string; paymentStatus?: string; requiresPayment?: boolean; statusReason?: string | null }

/** Requested → Paid → Approved tracker so residents can see where their booking is. */
export function BookingProgress({ status, paymentStatus = 'NONE', requiresPayment = true, statusReason }: ProgressProps) {
  if (status === 'REJECTED' || status === 'CANCELLED') {
    return (
      <div className="progress-closed" role="status">
        <strong>{status === 'REJECTED' ? 'Not approved' : 'Cancelled'}</strong>
        {statusReason && <span> — {statusReason}</span>}
      </div>
    );
  }
  const paid = !requiresPayment || paymentStatus === 'PAID';
  const reversed = paymentStatus === 'REFUNDED';
  const approved = status === 'APPROVED';
  const steps: { label: string; state: 'done' | 'current' | 'todo' | 'bad' }[] = [
    { label: 'Requested', state: 'done' },
    requiresPayment
      ? { label: reversed ? 'Payment reversed' : paid ? 'Paid' : 'Awaiting payment', state: reversed ? 'bad' : paid ? 'done' : 'current' }
      : { label: 'No fee', state: 'done' },
    { label: approved ? 'Approved' : 'Approval', state: approved ? 'done' : paid && !reversed ? 'current' : 'todo' },
  ];
  return (
    <ol className="progress" aria-label="Booking progress">
      {steps.map((s, i) => (
        <li key={i} className={`progress-step progress-step--${s.state}`} aria-current={s.state === 'current' ? 'step' : undefined}>
          <span className="progress-dot" aria-hidden="true">{s.state === 'done' ? '✓' : s.state === 'bad' ? '!' : i + 1}</span>
          <span className="progress-label">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}
