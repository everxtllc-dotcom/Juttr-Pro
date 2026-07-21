// Vercel serverless function — creates a Stripe Checkout session for Juttr Pro.
//
// Zero npm dependencies: posts form-encoded params to the Stripe REST API.
//
// Required env vars:
//   STRIPE_SECRET_KEY        sk_live_… / sk_test_…
//   STRIPE_PRICE_MONTHLY     price_… for the $3/month recurring price
//   STRIPE_PRICE_YEARLY      price_… for the $20/year recurring price
//
// Request: { plan: "monthly" | "yearly" }
// Response: { url } — redirect the browser here.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const plan = body.plan === 'yearly' ? 'yearly' : 'monthly';
  const price = plan === 'yearly'
    ? process.env.STRIPE_PRICE_YEARLY
    : process.env.STRIPE_PRICE_MONTHLY;

  if (!process.env.STRIPE_SECRET_KEY || !price) {
    return res.status(500).json({ error: 'not_configured' });
  }

  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const origin = `${proto}://${req.headers.host}`;

  const params = new URLSearchParams();
  params.append('mode', 'subscription');
  params.append('line_items[0][price]', price);
  params.append('line_items[0][quantity]', '1');
  params.append('allow_promotion_codes', 'true');
  params.append('success_url', `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`);
  params.append('cancel_url', `${origin}/#pricing`);

  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const data = await r.json();
    if (!r.ok || !data.url) {
      console.error('checkout create failed', r.status, data?.error?.message);
      return res.status(502).json({ error: 'checkout_failed' });
    }
    return res.status(200).json({ url: data.url });
  } catch (err) {
    console.error('create-checkout error', err);
    return res.status(502).json({ error: 'checkout_failed' });
  }
}
