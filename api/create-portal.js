// Vercel serverless function — creates a Stripe Billing Portal session so a
// Juttr Pro customer can manage/cancel their subscription, update their card, or
// download invoices. No app login: the customer is resolved by email.
//
// Zero npm dependencies: posts form-encoded params to the Stripe REST API.
//
// Required env vars:
//   STRIPE_SECRET_KEY        sk_live_… / sk_test_…
//
// The Customer Portal must first be configured + activated in the Stripe
// Dashboard (Settings → Billing → Customer portal) or Stripe returns
// "No configuration provided". No new secret is needed beyond STRIPE_SECRET_KEY.
//
// Request:  { email }
// Response: { url } — open this in a new tab.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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

  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const origin = `${proto}://${req.headers.host}`;
  const auth = { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` };

  try {
    // Resolve the Stripe customer by email (same lookup as check-user.js).
    const custRes = await fetch(
      `https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=1`,
      { headers: auth },
    );
    const custData = await custRes.json().catch(() => ({}));
    const customer = custData?.data?.[0];
    if (!custRes.ok || !customer) {
      return res.status(404).json({ error: 'no_customer' });
    }

    // Create the hosted billing portal session for that customer.
    const params = new URLSearchParams();
    params.append('customer', customer.id);
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
