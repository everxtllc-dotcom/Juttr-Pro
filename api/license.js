// Vercel serverless function — V2 entitlement check for the extension/PWA.
//
// The extension calls this with its Supabase access token on boot and every
// ~24h. It returns the account's tier as an EC P-256 signed token the client
// verifies OFFLINE (see api/_sign.js), so a user can never forge Pro locally.
//
// Also enforces the multi-device limit: the same account may be active on at
// most 2 browser instances. Devices idle > 30 days are pruned lazily; an
// active conflict returns 409 device_limit with the device list so the user
// can sign one out (no silent LRU eviction — that would allow 3+ devices to
// rotate Pro between them).
//
// Legacy backfill: users who bought Pro under the old email+key flow get
// linked automatically on first sign-in — we look up an active Stripe
// subscription by email and set is_pro accordingly.
//
// Request:  POST { device_id, device_label? }  + Authorization: Bearer <token>
// Response: { tier, email, user_id, issued_at, sig }
//        or 409 { error: 'device_limit', devices: [{ id, label, last_seen_at }] }

import { signLicenseV2 } from './_sign.js';
import {
  getUserFromRequest,
  getProfile,
  updateProfile,
  serviceRest,
  isSupabaseConfigured,
} from './_supabase.js';

const DEVICE_LIMIT = 2;
const IDLE_DAYS = 30;

/** Looks up an active Stripe subscription for this email (legacy backfill). */
async function findActiveStripeCustomer(email) {
  if (!process.env.STRIPE_SECRET_KEY || !email) return null;
  try {
    const q = encodeURIComponent(email);
    const r = await fetch(`https://api.stripe.com/v1/customers?email=${q}&limit=10`, {
      headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    });
    const data = await r.json();
    if (!r.ok || !Array.isArray(data.data)) return null;

    for (const customer of data.data) {
      const sr = await fetch(
        `https://api.stripe.com/v1/subscriptions?customer=${customer.id}&status=active&limit=1`,
        { headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } },
      );
      const subs = await sr.json();
      if (sr.ok && subs.data?.[0]) {
        return { customerId: customer.id, subscriptionId: subs.data[0].id };
      }
    }
  } catch (err) {
    console.error('legacy backfill lookup failed', err);
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!isSupabaseConfigured()) return res.status(500).json({ error: 'not_configured' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });

  const deviceId = typeof body.device_id === 'string' ? body.device_id.slice(0, 128) : '';
  const deviceLabel = typeof body.device_label === 'string' ? body.device_label.slice(0, 80) : null;
  if (!deviceId) return res.status(400).json({ error: 'missing_device_id' });

  let profile = await getProfile(user.id);

  // Legacy backfill: link old email+key purchasers on first sign-in.
  if (profile && !profile.is_pro && !profile.stripe_customer_id) {
    const legacy = await findActiveStripeCustomer(user.email);
    if (legacy) {
      await updateProfile(user.id, {
        is_pro: true,
        pro_source: 'stripe',
        stripe_customer_id: legacy.customerId,
        stripe_subscription_id: legacy.subscriptionId,
      });
      profile = await getProfile(user.id);
      console.log('legacy pro backfilled', user.id);
    }
  }

  // ── Device registration (max 2 active) ──
  const cutoff = new Date(Date.now() - IDLE_DAYS * 86400000).toISOString();

  // Lazily prune devices idle beyond the window.
  await serviceRest(
    `devices?user_id=eq.${encodeURIComponent(user.id)}&last_seen_at=lt.${encodeURIComponent(cutoff)}`,
    { method: 'DELETE' },
  );

  const { data: devices } = await serviceRest(
    `devices?user_id=eq.${encodeURIComponent(user.id)}&select=id,device_id,label,last_seen_at&order=last_seen_at.desc`,
  );
  const list = Array.isArray(devices) ? devices : [];
  const existing = list.find((d) => d.device_id === deviceId);

  if (existing) {
    await serviceRest(`devices?id=eq.${encodeURIComponent(existing.id)}`, {
      method: 'PATCH',
      body: { last_seen_at: new Date().toISOString(), label: deviceLabel || existing.label },
    });
  } else if (list.length >= DEVICE_LIMIT) {
    return res.status(409).json({
      error: 'device_limit',
      devices: list.map((d) => ({ id: d.id, label: d.label, last_seen_at: d.last_seen_at })),
    });
  } else {
    await serviceRest('devices', {
      method: 'POST',
      body: { user_id: user.id, device_id: deviceId, label: deviceLabel },
    });
  }

  // ── Signed entitlement (free responses are signed too — uniform client) ──
  const tier = profile?.is_pro ? 'pro' : 'free';
  const issuedAt = Date.now();
  let sig;
  try {
    sig = signLicenseV2(user.id, user.email, tier, issuedAt);
  } catch (err) {
    console.error('signing failed', err);
    return res.status(500).json({ error: 'signing_failed' });
  }

  return res.status(200).json({
    tier,
    email: user.email,
    user_id: user.id,
    issued_at: issuedAt,
    sig,
  });
}
