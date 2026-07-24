// Vercel serverless function — verifies a Juttr Pro subscription against Stripe
// and returns an EC-P256-signed token the extension can verify offline.
//
// Zero npm dependencies: talks to the Stripe REST API via global fetch (the site
// stays a build-free static deploy, matching api/subscribe.js). The Stripe
// lookups (and the active/trialing rule) live in api/_stripe.js so activation,
// revalidation, and api/subscription-status.js all agree.
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
import { EMAIL_RE, resolveByLicenseKey, resolveByEmail } from './_stripe.js';

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
    // Revalidation looks the customer up by email (7-day background check, no key);
    // activation verifies the supplied license key + email match. Both accept
    // active OR trialing subscriptions (see ACTIVE_STATUSES in _stripe.js).
    const result = revalidate
      ? await resolveByEmail(email)
      : await resolveByLicenseKey({ email, licenseKey });

    if (!result.ok) {
      return res.status(200).json({ tier: 'free', error: result.message });
    }
    return proResponse(res, email);
  } catch (err) {
    console.error('check-user error:', err);
    return res.status(500).json({ tier: 'free', error: 'Server error. Try again.' });
  }
}
