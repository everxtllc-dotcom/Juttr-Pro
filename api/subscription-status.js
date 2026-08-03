// Vercel serverless function — returns a Pro subscription's live, display-only
// details (status, plan, renewal date) for the website /account page and the
// extension's Subscription settings. No database — Stripe is the source of truth.
//
// This endpoint never issues a Pro token (that's api/check-user.js). It only
// reads the subscription for display, and it reuses check-user's email-match
// rule so a bare `sub_` id can never leak a customer's email / renewal date.
//
// Zero npm dependencies: Stripe REST via global fetch.
//
// Required env var:
//   STRIPE_SECRET_KEY   sk_live_… / sk_test_…
//
// Request (POST):
//   With key:   { email, license_key: "sub_..." }   (website account page)
//   Email only: { email }                            (extension — stores email, not the sub_)
// Response:
//   { status, email, current_period_end, cancel_at_period_end, plan } | { error }

import {
  EMAIL_RE,
  resolveByLicenseKey,
  resolveByEmail,
  resolveByCustomerId,
  toStatusPayload,
} from './_stripe.js';
import { authorizeCaller } from './_auth.js';

/**
 * The Stripe customer id the webhook recorded on the Supabase profile. Preferred
 * over an email search because Stripe's `customers?email=` filter is
 * case-sensitive (a mixed-case address stored at checkout is missed by our
 * lowercased lookup). Returns null when unavailable so callers can fall back.
 */
async function customerIdFromProfile(email) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}` +
        `&select=stripe_customer_id&limit=1`,
      { headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' } },
    );
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    return rows?.[0]?.stripe_customer_id || null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  // CORS — allow the Chrome extension origin.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'not_configured' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const email = (typeof body.email === 'string' ? body.email.trim() : '').toLowerCase();
  const licenseKey = typeof body.license_key === 'string' ? body.license_key.trim() : '';

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'invalid_email' });
  }

  // SECURITY: this returns plan, price and renewal date. It previously fell back
  // to a bare email lookup, so anyone who knew a customer's address could read
  // their billing details. Require proof of control first; on failure reply
  // exactly as for an unknown account so addresses cannot be enumerated.
  if (!(await authorizeCaller(email, body))) {
    return res.status(404).json({ error: 'no_customer' });
  }

  try {
    let result = licenseKey
      ? await resolveByLicenseKey({ email, licenseKey })
      : await resolveByEmail(email);

    // Email search is case-sensitive on Stripe's side; if it missed, retry via the
    // customer id the webhook stored on the profile (case-independent).
    if (!result.ok) {
      const customerId = await customerIdFromProfile(email);
      if (customerId) result = await resolveByCustomerId(customerId);
    }

    if (!result.ok) {
      return res.status(404).json({ error: 'no_customer' });
    }

    return res.status(200).json(toStatusPayload(result.sub, result.customer));
  } catch (err) {
    console.error('subscription-status error:', err);
    return res.status(502).json({ error: 'lookup_failed' });
  }
}
