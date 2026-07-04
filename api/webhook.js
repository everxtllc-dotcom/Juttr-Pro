// Vercel serverless function — Stripe webhook → Supabase profiles.is_pro.
//
// Verifies the Stripe-Signature header by HMAC-SHA256 over `${t}.${rawBody}`
// with STRIPE_WEBHOOK_SECRET (zero npm deps, Node crypto), then keeps the
// user's is_pro flag in sync:
//
//   checkout.session.completed      → is_pro = true (link customer + subscription)
//   customer.subscription.updated   → is_pro = status in (active, trialing)
//   customer.subscription.deleted   → is_pro = false
//
// Guard: subscription events only ever touch profiles whose pro_source is
// 'stripe' — a manual/influencer grant (pro_source = 'manual', toggled in the
// Supabase dashboard) is never clobbered by Stripe.
//
// Required env vars:
//   STRIPE_WEBHOOK_SECRET   whsec_…
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (see _supabase.js)
//
// Needs the raw body, so Vercel's automatic JSON parsing is disabled below.

import crypto from 'crypto';
import { serviceRest, updateProfile } from './_supabase.js';

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

/** Finds the profile row for a subscription event (by sub id, then metadata). */
async function findProfileForSubscription(sub) {
  const bySub = await serviceRest(
    `profiles?stripe_subscription_id=eq.${encodeURIComponent(sub.id)}&select=*`,
  );
  if (bySub.ok && bySub.data?.[0]) return bySub.data[0];

  const userId = sub.metadata?.user_id;
  if (userId) {
    const byId = await serviceRest(
      `profiles?id=eq.${encodeURIComponent(userId)}&select=*`,
    );
    if (byId.ok && byId.data?.[0]) return byId.data[0];
  }
  return null;
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

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id || session.metadata?.user_id;
        if (!userId) {
          console.error('checkout.session.completed without user_id', session.id);
          break;
        }
        await updateProfile(userId, {
          is_pro: true,
          pro_source: 'stripe',
          stripe_customer_id: session.customer || null,
          stripe_subscription_id: session.subscription || null,
        });
        console.log('pro activated', userId, session.subscription);
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const profile = await findProfileForSubscription(sub);
        if (!profile || profile.pro_source !== 'stripe') break;
        const active = sub.status === 'active' || sub.status === 'trialing';
        if (profile.is_pro !== active) {
          await updateProfile(profile.id, { is_pro: active });
          console.log('subscription status →', sub.id, sub.status, 'is_pro =', active);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const profile = await findProfileForSubscription(sub);
        if (!profile || profile.pro_source !== 'stripe') break;
        await updateProfile(profile.id, { is_pro: false });
        console.log('subscription cancelled', sub.id, '→ downgraded', profile.id);
        break;
      }

      default:
        break;
    }
  } catch (err) {
    // Return 500 so Stripe retries the delivery.
    console.error('webhook handler error', event.type, err);
    return res.status(500).json({ error: 'handler_failed' });
  }

  return res.status(200).json({ received: true });
}
