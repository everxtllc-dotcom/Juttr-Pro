// Vercel serverless function — creates a Stripe Billing Portal session so a
// Juttr Pro customer can manage/cancel their subscription, update their card, or
// download invoices.
//
// The caller MUST prove they control the account — see _auth.js. A portal
// session is a powerful credential (invoices, payment method, cancellation), and
// an email address is not a secret, so resolving by email alone was an account
// takeover for anyone who knew a customer's address.
//
// Zero npm dependencies: posts form-encoded params to the Stripe REST API.
//
// Required env vars:
//   STRIPE_SECRET_KEY        sk_live_… / sk_test_…
//   plus the vars _auth.js needs (Supabase + licence signing key).
//
// The Customer Portal must first be configured + activated in the Stripe
// Dashboard (Settings → Billing → Customer portal) or Stripe returns
// "No configuration provided".
//
// Request:  { email } + one of { access_token } | { sig, issued_at } | { license_key }
// Response: { url } — open this in a new tab.

import { authorizeCaller } from './_auth.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * The Stripe customer id the webhook recorded on the Supabase profile.
 *
 * We prefer this over resolving the customer by email: Stripe's
 * `customers?email=` filter is CASE-SENSITIVE, so a customer stored as
 * `Foo@x.com` is invisible to a lowercased lookup (the account activates fine —
 * that path matches case-insensitively — but the billing portal 404s). The
 * stored id has no such problem. Returns null if unavailable so the caller can
 * fall back to the email search.
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
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'invalid_email' });
  }

  // SECURITY: a Billing Portal session lets the holder read invoices, change the
  // payment method and cancel the subscription. This endpoint used to hand one
  // out for any email, so knowing a customer's address was enough to take over
  // their billing. Require proof that the caller controls the account, and give
  // a uniform reply on failure so addresses cannot be enumerated.
  if (!(await authorizeCaller(email, body))) {
    return res.status(404).json({ error: 'no_customer' });
  }

  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const origin = `${proto}://${req.headers.host}`;
  const auth = { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` };

  try {
    // Prefer the customer id the webhook saved on the profile (case-independent).
    // Only fall back to Stripe's case-sensitive email search when there's no
    // profile id yet (e.g. before the webhook has run).
    let customerId = await customerIdFromProfile(email);
    if (!customerId) {
      const custRes = await fetch(
        `https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=1`,
        { headers: auth },
      );
      const custData = await custRes.json().catch(() => ({}));
      customerId = custData?.data?.[0]?.id || null;
    }
    if (!customerId) {
      return res.status(404).json({ error: 'no_customer' });
    }

    // Create the hosted billing portal session for that customer.
    const params = new URLSearchParams();
    params.append('customer', customerId);
    params.append('return_url', `${origin}/#pricing`);

    const portalRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        ...auth,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const portalData = await portalRes.json().catch(() => ({}));
    if (!portalRes.ok || !portalData.url) {
      console.error('portal create failed', portalRes.status, portalData?.error?.message);
      return res.status(502).json({ error: 'portal_failed' });
    }
    return res.status(200).json({ url: portalData.url });
  } catch (err) {
    console.error('create-portal error', err);
    return res.status(502).json({ error: 'portal_failed' });
  }
}
