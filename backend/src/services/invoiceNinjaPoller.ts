import dayjs from 'dayjs';
import { prisma } from '../prisma.js';
import { config } from '../config.js';
import { classifyFeeText, extractUnit, FeeType, FEE_TYPES, isFeeType } from './feeClassifier.js';
import { autoMatchPayment, markPaymentReversed } from './paymentService.js';
import { sendPaymentConfirmation, sendPaymentReversedNotice } from './emailService.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
// First run (no stored cursor): look back this far to catch anything missed.
const INITIAL_LOOKBACK_HOURS = 24;
// Re-read a little before the stored cursor so clock skew can't drop an invoice.
const CURSOR_OVERLAP_MS = 2 * 60 * 1000;
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

// Invoice Ninja invoice status ids
const STATUS_PAID = 4;
const STATUS_CANCELLED = 5;
const STATUS_REVERSED = 6;

type Logger = { info: (msg: string) => void; error: (obj: object, msg: string) => void };

// ── LLM fallback for line items the rules can't classify ───────────

const CLASSIFY_PROMPT = (productKey: string, notes: string) =>
  `Given this invoice line item:\nItem: "${productKey}"\nDescription: "${notes}"\nClassify this fee. Reply with only one of: ${FEE_TYPES.map((f) => `"${f}"`).join(', ')}, "none". Use "none" if the item is not a move/delivery/reno fee (e.g. key deposit, parking, bike room, amenity booking).`;

function parseLlmAnswer(text: string): FeeType | null {
  const t = text.trim().toLowerCase();
  return isFeeType(t) ? t : null;
}

async function classifyWithDeepSeek(productKey: string, notes: string): Promise<FeeType | null> {
  if (!config.deepseekApiKey) return null;
  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.deepseekApiKey}` },
      body: JSON.stringify({ model: 'deepseek-chat', max_tokens: 10, messages: [{ role: 'user', content: CLASSIFY_PROMPT(productKey, notes) }] }),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return parseLlmAnswer(json.choices?.[0]?.message?.content ?? '');
  } catch { return null; }
}

async function classifyWithClaude(productKey: string, notes: string): Promise<FeeType | null> {
  if (!config.anthropicApiKey) return null;
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 10,
      messages: [{ role: 'user', content: CLASSIFY_PROMPT(productKey, notes) }],
    });
    return parseLlmAnswer(message.content[0].type === 'text' ? message.content[0].text : '');
  } catch { return null; }
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
  amount?: number | string;
  paid_to_date?: number | string;
  date?: string;
  line_items: InvoiceNinjaLineItem[];
}

async function fetchInvoices(statusId: number, since: Date): Promise<InvoiceNinjaInvoice[]> {
  const base = config.invoiceNinjaUrl!.replace(/\/$/, '');
  const all: InvoiceNinjaInvoice[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL(`${base}/api/v1/invoices`);
    url.searchParams.set('status_id', String(statusId));
    url.searchParams.set('updated_at', String(Math.floor(since.getTime() / 1000)));
    url.searchParams.set('per_page', String(PAGE_SIZE));
    url.searchParams.set('page', String(page));

    const response = await fetch(url.toString(), {
      headers: { 'X-Api-Token': config.invoiceNinjaApiToken!, 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!response.ok) throw new Error(`Invoice Ninja API responded with ${response.status}`);

    const json = (await response.json()) as { data?: InvoiceNinjaInvoice[] };
    const batch = json.data ?? [];
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return all;
}

// ── Process invoices ───────────────────────────────────────────────

async function classifyInvoice(invoice: InvoiceNinjaInvoice) {
  // Use the first line item that classifies; unit may come from any line item.
  const items = invoice.line_items?.length ? invoice.line_items : [{ product_key: '', notes: '' }];
  let feeType: FeeType | null = null;
  let chosen = items[0];
  for (const li of items) {
    const t = classifyFeeText(li.product_key ?? '', li.notes ?? '');
    if (t) { feeType = t; chosen = li; break; }
  }
  if (!feeType) {
    feeType = (await classifyWithDeepSeek(chosen.product_key ?? '', chosen.notes ?? ''))
           ?? (await classifyWithClaude(chosen.product_key ?? '', chosen.notes ?? ''));
  }
  let unit: string | null = null;
  for (const li of [chosen, ...items]) {
    unit = extractUnit(li.notes ?? '') ?? extractUnit(li.product_key ?? '');
    if (unit) break;
  }
  return { feeType: feeType ?? 'unknown', unit, lineDate: chosen.date };
}

async function processPaidInvoice(invoice: InvoiceNinjaInvoice, log: Logger): Promise<void> {
  if (await prisma.paymentsLedger.findUnique({ where: { invoiceId: invoice.id } })) return;

  const paidAt = invoice.paid_date ? new Date(invoice.paid_date) : new Date();
  const { feeType, unit, lineDate } = await classifyInvoice(invoice);
  const invoiceDate = lineDate ?? invoice.date;
  const billingPeriod = dayjs(invoiceDate ?? paidAt).format('YYYY-MM');

  const paidToDate = Number(invoice.paid_to_date);
  const invoiceAmount = Number(invoice.amount);
  const amountPaid = paidToDate > 0 ? paidToDate : Number.isFinite(invoiceAmount) ? invoiceAmount : null;

  const payment = await prisma.paymentsLedger.create({
    data: {
      clientId: invoice.client_id,
      invoiceId: invoice.id,
      billingPeriod,
      feeType,
      unit,
      paidAt,
      invoiceDate: invoiceDate ? new Date(invoiceDate) : null,
      amountPaid,
    },
  });

  if (feeType === 'unknown' || !unit) return; // needs a human; shows in the review queue

  const result = await autoMatchPayment(payment).catch((err) => {
    log.error({ err, invoiceId: invoice.id }, 'Auto-match failed');
    return null;
  });
  if (result?.ok && result.transitioned) {
    await sendPaymentConfirmation(prisma, result.booking).catch((err) => {
      log.error({ err, bookingId: result.booking.id }, 'Failed to send payment confirmation');
    });
  }
}

async function processReversedInvoice(invoice: InvoiceNinjaInvoice, log: Logger): Promise<void> {
  const payment = await prisma.paymentsLedger.findUnique({ where: { invoiceId: invoice.id } });
  if (!payment || payment.reversedAt) return;
  const booking = await markPaymentReversed(payment);
  if (booking) {
    await sendPaymentReversedNotice(prisma, booking, invoice.id).catch((err) => {
      log.error({ err, bookingId: booking.id }, 'Failed to send payment reversal notice');
    });
  }
}

// ── Poller ─────────────────────────────────────────────────────────

let running = false;

export async function runInvoiceNinjaPoll(log: Logger): Promise<void> {
  if (running) return;
  const settings = await prisma.appSetting.findFirst();
  if (!settings?.invoiceNinjaEnabled) return;

  running = true;
  try {
    const startedAt = new Date();
    const since = settings.invoiceNinjaCursor
      ? new Date(settings.invoiceNinjaCursor.getTime() - CURSOR_OVERLAP_MS)
      : dayjs().subtract(INITIAL_LOOKBACK_HOURS, 'hour').toDate();

    log.info('Invoice Ninja poll started');

    let paid: InvoiceNinjaInvoice[];
    let reversed: InvoiceNinjaInvoice[];
    try {
      paid = await fetchInvoices(STATUS_PAID, since);
      reversed = [...(await fetchInvoices(STATUS_CANCELLED, since)), ...(await fetchInvoices(STATUS_REVERSED, since))];
    } catch (err) {
      // Cursor is not advanced, so the same window is retried on the next poll.
      log.error({ err }, 'Failed to fetch invoices from Invoice Ninja');
      return;
    }

    for (const invoice of paid) {
      await processPaidInvoice(invoice, log).catch((err) => log.error({ err, invoiceId: invoice.id }, 'Failed to process Invoice Ninja invoice'));
    }
    for (const invoice of reversed) {
      await processReversedInvoice(invoice, log).catch((err) => log.error({ err, invoiceId: invoice.id }, 'Failed to process reversed invoice'));
    }

    await prisma.appSetting.update({ where: { id: settings.id }, data: { invoiceNinjaCursor: startedAt } });
  } finally {
    running = false;
  }
}

export function startInvoiceNinjaPoller(log: Logger): void {
  if (!config.invoiceNinjaUrl || !config.invoiceNinjaApiToken) {
    log.info('Invoice Ninja poller disabled — INVOICE_NINJA_URL or INVOICE_NINJA_API_TOKEN not set');
    return;
  }
  setTimeout(() => runInvoiceNinjaPoll(log).catch(() => {}), 15_000);
  setInterval(() => runInvoiceNinjaPoll(log).catch(() => {}), POLL_INTERVAL_MS);
}
