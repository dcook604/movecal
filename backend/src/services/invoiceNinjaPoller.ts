import dayjs from 'dayjs';
import { BookingStatus, MoveType } from '@prisma/client';
import { prisma } from '../prisma.js';
import { config } from '../config.js';
import { checkAndApproveMoveRequest } from './moveApprovalService.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
// On startup, look back 24 hours to catch anything missed while the server was down
const STARTUP_LOOKBACK_HOURS = 24;

let lastPollAt: Date | null = null;

// ── Fee-type classification ────────────────────────────────────────

function classifyFeeType(productKey: string, notes: string): 'move_in' | 'move_out' | null {
  const normalized = (productKey + ' ' + notes).toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
  const moveInPattern  = /\b(move in|moving in|movein|move-in|into)\b/;
  const moveOutPattern = /\b(move out|moving out|moveout|move-out|out|exit|vacate)\b/;
  if (moveInPattern.test(normalized))  return 'move_in';
  if (moveOutPattern.test(normalized)) return 'move_out';
  return null;
}

async function classifyWithClaude(productKey: string, notes: string): Promise<'move_in' | 'move_out' | null> {
  if (!config.anthropicApiKey) return null;
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 10,
      messages: [{
        role: 'user',
        content: `Given this invoice line item:\nItem: "${productKey}"\nDescription: "${notes}"\nIs this a move-in fee or a move-out fee? Reply with only "move_in" or "move_out".`,
      }],
    });
    const text = message.content[0].type === 'text' ? message.content[0].text.trim().toLowerCase() : '';
    if (text === 'move_in' || text === 'move_out') return text as 'move_in' | 'move_out';
  } catch { /* fall through */ }
  return null;
}

// ── Unit extraction ────────────────────────────────────────────────

function extractUnit(text: string): string | null {
  if (!text) return null;
  const patterns = [
    /\b(?:unit|apt|suite|apartment)\s*#?\s*([a-z0-9][-a-z0-9]*)/i,
    /#\s*([a-z0-9][-a-z0-9]*)/i,
    /\b([A-Z]\d{1,2}-\d{2,4})\b/,   // T4-3102 style
    /\b(\d{3,4})\b/,                  // bare 3–4 digit unit numbers
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const unit = (m[2] ?? m[1]).trim();
      if (unit.length <= 20) return unit;
    }
  }
  return null;
}

// ── Invoice Ninja API ──────────────────────────────────────────────

interface InvoiceNinjaLineItem {
  product_key: string;
  notes: string;
  date?: string;
}

interface InvoiceNinjaInvoice {
  id: string;
  client_id: string;
  status_id: string;
  paid_date?: string;
  date?: string;
  line_items: InvoiceNinjaLineItem[];
}

async function fetchPaidInvoices(since: Date): Promise<InvoiceNinjaInvoice[]> {
  const base = config.invoiceNinjaUrl!.replace(/\/$/, '');
  const url = new URL(`${base}/api/v1/invoices`);
  url.searchParams.set('status_id', '4');                                    // 4 = paid
  url.searchParams.set('updated_at', String(Math.floor(since.getTime() / 1000)));
  url.searchParams.set('per_page', '100');

  const response = await fetch(url.toString(), {
    headers: {
      'X-Api-Token': config.invoiceNinjaApiToken!,
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

  if (!response.ok) {
    throw new Error(`Invoice Ninja API responded with ${response.status}`);
  }

  const json = await response.json() as { data?: InvoiceNinjaInvoice[] };
  return json.data ?? [];
}

// ── Process a single invoice ───────────────────────────────────────

async function processInvoice(invoice: InvoiceNinjaInvoice, log: { error: (obj: object, msg: string) => void }): Promise<void> {
  // Skip if already recorded
  const exists = await prisma.paymentsLedger.findUnique({ where: { invoiceId: invoice.id } });
  if (exists) return;

  const lineItem = invoice.line_items?.[0];
  const productKey = lineItem?.product_key ?? '';
  const notes      = lineItem?.notes ?? '';

  const paidAt = invoice.paid_date ? new Date(invoice.paid_date) : new Date();

  const lineItemDate = lineItem?.date ?? invoice.date;
  const billingPeriod = lineItemDate
    ? dayjs(lineItemDate).format('YYYY-MM')
    : dayjs(paidAt).format('YYYY-MM');

  const unit = extractUnit(notes) ?? extractUnit(productKey);

  let feeType: string = classifyFeeType(productKey, notes) ?? 'unknown';
  if (feeType === 'unknown') {
    feeType = (await classifyWithClaude(productKey, notes)) ?? 'unknown';
  }

  await prisma.paymentsLedger.create({
    data: {
      clientId: invoice.client_id,
      invoiceId: invoice.id,
      billingPeriod,
      feeType,
      unit,
      paidAt,
    },
  });

  if (feeType !== 'unknown' && unit) {
    const moveTypeFilter = feeType === 'move_in' ? MoveType.MOVE_IN : MoveType.MOVE_OUT;
    const [yearStr, monthStr] = billingPeriod.split('-');
    const monthStart = new Date(Number(yearStr), Number(monthStr) - 1, 1);
    const monthEnd   = new Date(Number(yearStr), Number(monthStr), 1);

    // Also try the unit suffix after the last dash (e.g. "T4-1105" → "1105")
    const unitVariants = [unit];
    if (unit.includes('-')) unitVariants.push(unit.split('-').pop()!);

    const matchingBooking = await prisma.booking.findFirst({
      where: {
        unit: { in: unitVariants },
        moveType: moveTypeFilter,
        moveDate: { gte: monthStart, lt: monthEnd },
        status: { in: [BookingStatus.SUBMITTED, BookingStatus.PENDING] },
      },
    });

    if (matchingBooking) {
      await checkAndApproveMoveRequest({
        unit,
        feeType,
        billingPeriod,
        bookingId: matchingBooking.id,
      }).catch((err) => {
        log.error({ err, invoiceId: invoice.id, bookingId: matchingBooking.id }, 'Invoice approval check failed');
      });
    }
  }
}

// ── Poller ─────────────────────────────────────────────────────────

export async function runInvoiceNinjaPoll(log: { info: (msg: string) => void; error: (obj: object, msg: string) => void }): Promise<void> {
  const settings = await prisma.appSetting.findFirst();
  if (!settings?.invoiceNinjaEnabled) return;

  const since = lastPollAt ?? dayjs().subtract(STARTUP_LOOKBACK_HOURS, 'hour').toDate();
  lastPollAt = new Date();

  log.info('Invoice Ninja poll started');

  let invoices: InvoiceNinjaInvoice[];
  try {
    invoices = await fetchPaidInvoices(since);
  } catch (err) {
    log.error({ err }, 'Failed to fetch invoices from Invoice Ninja');
    return;
  }

  for (const invoice of invoices) {
    await processInvoice(invoice, log).catch((err) => {
      log.error({ err, invoiceId: invoice.id }, 'Failed to process Invoice Ninja invoice');
    });
  }
}

export function startInvoiceNinjaPoller(log: { info: (msg: string) => void; error: (obj: object, msg: string) => void }): void {
  if (!config.invoiceNinjaUrl || !config.invoiceNinjaApiToken) {
    log.info('Invoice Ninja poller disabled — INVOICE_NINJA_URL or INVOICE_NINJA_API_TOKEN not set');
    return;
  }

  // Initial run shortly after startup
  setTimeout(() => runInvoiceNinjaPoll(log).catch(() => {}), 15_000);
  // Recurring poll
  setInterval(() => runInvoiceNinjaPoll(log).catch(() => {}), POLL_INTERVAL_MS);
}
