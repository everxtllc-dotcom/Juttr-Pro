// Vercel serverless function — verifies a Juttr Pro subscription against Stripe
// and returns an EC-P256-signed token the extension can verify offline.
//
// Zero npm dependencies: talks to the Stripe REST API via global fetch (the site
// stays a build-free static deploy, matching api/subscribe.js).
//
// Required env vars (Project → Settings → Environment Variables):
//   STRIPE_SECRET_KEY             sk_live_… (or sk_test_…)
//   LICENSE_SIGNING_PRIVATE_KEY   EC P-256 private key (PEM) — see api/_sign.js
//
// Request bodies:
//   Activation:    { email, license_key: "sub_..." }
//   Revalidation:  { email, revalidate: true }
// Responses:
//   Pro:   { tier: "pro", email, issued_at, sig }
//   Free:  { tier: "free", error }

import { signLicense } from './_sign.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function stripeGet(path) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

function proResponse(res, email) {
  const issued_at = Date.now();
  const sig = signLicense(email, 'pro', issued_at);
  return res.status(200).json({ tier: 'pro', email, issued_at, sig });
}

export default async function handler(req, res) {
  // CORS — allow the Chrome extension origin.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ tier: 'free', error: 'method_not_allowed' });
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.LICENSE_SIGNING_PRIVATE_KEY) {
    return res.status(500).json({ tier: 'free', error: 'Server not configured.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const email = (typeof body.email === 'string' ? body.email.trim() : '').toLowerCase();
  const licenseKey = typeof body.license_key === 'string' ? body.license_key.trim() : '';
  const revalidate = body.revalidate === true;

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ tier: 'free', error: 'A valid email is required.' });
  }

  try {
    // ── Revalidation path (7-day background check, no license key) ──
    if (revalidate) {
      const customers = await stripeGet(
        `customers?email=${encodeURIComponent(email)}&limit=1`,
      );
      const customer = customers.data?.data?.[0];
      if (!customer) return res.status(200).json({ tier: 'free', error: 'No customer found.' });

      const subs = await stripeGet(
        `subscriptions?customer=${customer.id}&status=active&limit=1`,
      );
      if (!subs.data?.data?.length) {
        return res.status(200).json({ tier: 'free', error: 'No active subscription.' });
      }
      return proResponse(res, email);
    }

    // ── Activation path ──
    if (!licenseKey.startsWith('sub_')) {
      return res.status(400).json({ tier: 'free', error: 'Invalid license key format.' });
    }

    // 1. Look up the subscription.
    const sub = await stripeGet(`subscriptions/${encodeURIComponent(licenseKey)}`);
    if (!sub.ok || !sub.data?.id) {
      return res.status(200).json({ tier: 'free', error: 'License key not found.' });
    }

    // 2. Must be active.
    if (sub.data.status !== 'active') {
      return res.status(200).json({ tier: 'free', error: 'Subscription is not active.' });
    }

    // 3. Email must match the subscription's customer.
    const customerId = typeof sub.data.customer === 'string'
      ? sub.data.customer
      : sub.data.customer?.id;
    const customer = await stripeGet(`customers/${customerId}`);
    const customerEmail = (customer.data?.email || '').toLowerCase();
    if (!customerEmail || customerEmail !== email) {
      return res.status(200).json({ tier: 'free', error: 'Email does not match this license key.' });
    }

    // 4. All checks passed — sign and return.
    return proResponse(res, email);
  } catch (err) {
    console.error('check-user error:', err);
    return res.status(500).json({ tier: 'free', error: 'Server error. Try again.' });
  }
}
