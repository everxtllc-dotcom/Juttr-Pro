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
  toStatusPayload,
} from './_stripe.js';

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

  try {
    const result = licenseKey
      ? await resolveByLicenseKey({ email, licenseKey })
      : await resolveByEmail(email);

    if (!result.ok) {
      // Distinguish "no active sub" (200, not Pro) from a caller mistake (4xx).
      const status =
        result.error === 'email_mismatch' || result.error === 'invalid_key' ? 403 : 404;
      return res.status(status).json({ error: result.error });
    }

    return res.status(200).json(toStatusPayload(result.sub, result.customer));
  } catch (err) {
    console.error('subscription-status error:', err);
    return res.status(502).json({ error: 'lookup_failed' });
  }
}
