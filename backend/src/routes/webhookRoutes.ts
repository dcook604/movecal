import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import dayjs from 'dayjs';
import { BookingStatus, MoveType } from '@prisma/client';
import { prisma } from '../prisma.js';
import { config } from '../config.js';
import { checkAndApproveMoveRequest } from '../services/moveApprovalService.js';

function classifyFeeType(productKey: string, notes: string): 'move_in' | 'move_out' | null {
  const normalized = (productKey + ' ' + notes).toLowerCase().replace(/[^a-z0-9 ]/g, ' ');

  const moveInPatterns = /\b(move in|moving in|movein|move-in|into)\b/;
  const moveOutPatterns = /\b(move out|moving out|moveout|move-out|out|exit|vacate)\b/;

  if (moveInPatterns.test(normalized)) return 'move_in';
  if (moveOutPatterns.test(normalized)) return 'move_out';
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
      messages: [
        {
          role: 'user',
          content: `Given this invoice line item:\nItem: "${productKey}"\nDescription: "${notes}"\nIs this a move-in fee or a move-out fee? Reply with only "move_in" or "move_out".`,
        },
      ],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text.trim().toLowerCase() : '';
    if (text === 'move_in' || text === 'move_out') return text;
  } catch {
    // Fall through to unknown
  }

  return null;
}

function extractUnit(description: string): string | null {
  if (!description) return null;

  // Match patterns like: T4-3102, Unit 101, #502, Apt 3B, Suite 400, or bare numbers like 1204
  const patterns = [
    /\b(unit|apt|suite|apartment)\s*#?\s*([a-z0-9][-a-z0-9]*)/i,
    /#\s*([a-z0-9][-a-z0-9]*)/i,
    /\b([A-Z]\d{1,2}-\d{2,4})\b/,   // T4-3102 style
    /\b(\d{3,4})\b/,                  // bare 3-4 digit unit numbers
  ];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) {
      const unit = (match[2] ?? match[1]).trim();
      if (unit.length <= 20) return unit;
    }
  }

  return null;
}

export async function webhookRoutes(app: FastifyInstance) {
  // Capture raw body for HMAC verification before JSON parsing
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      (req as any).rawBody = body;
      const parsed = JSON.parse(body as string);
      done(null, parsed);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.post('/api/webhooks/invoice-ninja', async (req, reply) => {
    const secret = config.invoiceNinjaWebhookSecret;

    if (secret) {
      const signature = req.headers['x-ninja-signature'] as string | undefined;
      if (!signature) {
        return reply.status(401).send({ message: 'Missing signature' });
      }

      const rawBody = (req as any).rawBody as string ?? JSON.stringify(req.body);
      const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

      try {
        const sigBuf = Buffer.from(signature, 'hex');
        const expBuf = Buffer.from(expected, 'hex');
        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
          return reply.status(401).send({ message: 'Invalid signature' });
        }
      } catch {
        return reply.status(401).send({ message: 'Invalid signature' });
      }
    }

    const data = req.body as any;
    const lineItem = data?.data?.line_items?.[0] ?? data?.line_items?.[0];

    const invoiceId = String(data?.data?.id ?? data?.id ?? '');
    const clientId = String(data?.data?.client_id ?? data?.client_id ?? '');

    if (!invoiceId || !clientId) {
      app.log.warn({ body: req.body }, 'Invoice Ninja webhook missing invoice_id or client_id');
      return { received: true };
    }

    const paidDateRaw = data?.data?.paid_date ?? data?.paid_date;
    const paidAt = paidDateRaw ? new Date(paidDateRaw) : new Date();

    const productKey = String(lineItem?.product_key ?? '');
    const notes = String(lineItem?.notes ?? '');

    // billing_period: prefer line_item.date, fall back to invoice date
    const lineItemDate = lineItem?.date ?? data?.data?.date ?? data?.date;
    const billingPeriod = lineItemDate ? dayjs(lineItemDate).format('YYYY-MM') : dayjs(paidAt).format('YYYY-MM');

    // unit extraction
    const unit = extractUnit(notes) ?? extractUnit(productKey);

    // fee_type classification
    let feeType: string = 'unknown';
    const layer1 = classifyFeeType(productKey, notes);
    if (layer1) {
      feeType = layer1;
    } else {
      const layer2 = await classifyWithClaude(productKey, notes);
      if (layer2) {
        feeType = layer2;
      }
    }

    // Upsert the payments ledger record (idempotent via invoiceId unique)
    let payment;
    try {
      payment = await prisma.paymentsLedger.upsert({
        where: { invoiceId },
        create: { clientId, invoiceId, billingPeriod, feeType, unit, paidAt },
        update: {},
      });
    } catch (err) {
      app.log.error({ err, invoiceId }, 'Failed to upsert payment ledger record');
      return reply.status(500).send({ message: 'Internal error' });
    }

    // Try to auto-approve a matching booking
    if (feeType !== 'unknown' && unit) {
      const moveTypeFilter = feeType === 'move_in' ? MoveType.MOVE_IN : MoveType.MOVE_OUT;

      // Find matching pending booking for this unit + move type + billing period month
      const [yearStr, monthStr] = billingPeriod.split('-');
      const monthStart = new Date(Number(yearStr), Number(monthStr) - 1, 1);
      const monthEnd = new Date(Number(yearStr), Number(monthStr), 1);

      const matchingBooking = await prisma.booking.findFirst({
        where: {
          unit,
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
          app.log.error({ err, invoiceId, bookingId: matchingBooking.id }, 'Invoice approval check failed');
        });
      }
    }

    return { received: true };
  });
}
