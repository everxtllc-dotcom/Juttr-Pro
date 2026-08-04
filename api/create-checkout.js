// Vercel serverless function — creates a Stripe Checkout session for Juttr Pro.
//
// Zero npm dependencies: posts form-encoded params to the Stripe REST API.
//
// Required env vars:
//   STRIPE_SECRET_KEY        sk_live_… / sk_test_…
//   STRIPE_PRICE_MONTHLY     price_… for the $5/month REGULAR recurring price
//   STRIPE_PRICE_YEARLY      price_… for the $49/year REGULAR recurring price
// Optional (intro pricing — applied automatically):
//   STRIPE_COUPON_MONTHLY    40% off, repeating 12 months  → $3/mo year 1, then $5
//   STRIPE_COUPON_YEARLY     $25.00 off, duration once     → $24 year 1, then $49
//
// The prices are the REGULAR amounts; the promo is a coupon so Stripe reverts to
// full price automatically at renewal (no subscription schedules needed).
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

  // If the buyer is a signed-in account holder, bind the Stripe customer to their
  // exact account email (lowercased). This keeps the Stripe customer and the
  // Supabase account in sync and avoids the case-sensitive email-lookup gap.
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    params.append('customer_email', email);
  }

  // Stripe rejects a session that sets BOTH `discounts[]` and
  // `allow_promotion_codes` — they are mutually exclusive, so send exactly one.
  // The auto-applied intro coupon wins; if it isn't configured, fall back to
  // letting the customer type a promo code (the previous behavior).
  // The coupon id stays server-side — never let the client name a coupon.
  const coupon = plan === 'yearly'
    ? process.env.STRIPE_COUPON_YEARLY
    : process.env.STRIPE_COUPON_MONTHLY;

  if (coupon) params.append('discounts[0][coupon]', coupon);
  else params.append('allow_promotion_codes', 'true');

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
