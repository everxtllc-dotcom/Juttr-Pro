// Vercel serverless function — Stripe webhook (safety net).
//
// Verifies the Stripe-Signature header by HMAC-SHA256 over `${t}.${rawBody}`
// with STRIPE_WEBHOOK_SECRET (zero npm deps, Node crypto). This is a backstop
// for instant cancellations; the extension's 7-day revalidation already handles
// the common case, so we just log here — no database needed.
//
// Required env var:
//   STRIPE_WEBHOOK_SECRET   whsec_…
//
// Needs the raw body, so Vercel's automatic JSON parsing is disabled below.

import crypto from 'crypto';

export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verify(rawBody, header, secret) {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((kv) => kv.split('=').map((s) => s.trim())),
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${t}.${rawBody.toString('utf8')}`)
    .digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({ error: 'not_configured' });

  const rawBody = await readRawBody(req);
  if (!verify(rawBody, req.headers['stripe-signature'], secret)) {
    return res.status(400).json({ error: 'invalid_signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'invalid_payload' });
  }

  switch (event.type) {
    case 'customer.subscription.deleted':
      console.log('subscription cancelled', event.data?.object?.id);
      break;
    case 'customer.subscription.updated': {
      const status = event.data?.object?.status;
      if (status && status !== 'active') {
        console.log('subscription status changed', event.data?.object?.id, status);
      }
      break;
    }
    default:
      break;
  }

  return res.status(200).json({ received: true });
}
