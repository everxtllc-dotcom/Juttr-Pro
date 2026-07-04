// Vercel serverless function — creates a Stripe Checkout session for Juttr Pro.
//
// Zero npm dependencies: posts form-encoded params to the Stripe REST API.
// Requires a signed-in Supabase user (Authorization: Bearer <access token>)
// so the resulting subscription can be linked to the account via webhook.
//
// Pricing model (base prices + coupons — renewals step up automatically):
//   annual:     $49/yr  + ANNUAL_INTRO  coupon ($25 off once)         → $24 first year, then $49/yr
//   monthly:    $5/mo   + MONTHLY_INTRO coupon ($2 off, 12 months)    → $3/mo for 12 months, then $5/mo
//   influencer: $49/yr  + INFLUENCER    coupon ($30 off once)         → $19 first year, then $49/yr
//               (hidden — requires the INFLUENCER_CODE url secret)
//
// Required env vars:
//   STRIPE_SECRET_KEY             sk_live_… / sk_test_…
//   STRIPE_PRICE_MONTHLY          price_… for the $5/month recurring price
//   STRIPE_PRICE_YEARLY           price_… for the $49/year recurring price
//   STRIPE_COUPON_ANNUAL_INTRO    coupon id — $25 off, duration once
//   STRIPE_COUPON_MONTHLY_INTRO   coupon id — $2 off, repeating 12 months
//   STRIPE_COUPON_INFLUENCER      coupon id — $30 off, duration once
//   INFLUENCER_CODE               url secret for partner.html
//   SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
//
// Request:  { plan: "annual" | "monthly" | "influencer", code? }  + Bearer token
// Response: { url } — redirect the browser here.

import { getUserFromRequest, getProfile } from './_supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });

  const PLANS = {
    annual: {
      price: process.env.STRIPE_PRICE_YEARLY,
      coupon: process.env.STRIPE_COUPON_ANNUAL_INTRO,
    },
    monthly: {
      price: process.env.STRIPE_PRICE_MONTHLY,
      coupon: process.env.STRIPE_COUPON_MONTHLY_INTRO,
    },
    influencer: {
      price: process.env.STRIPE_PRICE_YEARLY,
      coupon: process.env.STRIPE_COUPON_INFLUENCER,
    },
  };

  const plan = PLANS[body.plan] ? body.plan : 'annual';
  if (plan === 'influencer') {
    const expected = process.env.INFLUENCER_CODE;
    if (!expected || body.code !== expected) {
      return res.status(403).json({ error: 'invalid_code' });
    }
  }

  const { price, coupon } = PLANS[plan];
  if (!process.env.STRIPE_SECRET_KEY || !price) {
    return res.status(500).json({ error: 'not_configured' });
  }

  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const origin = `${proto}://${req.headers.host}`;

  const params = new URLSearchParams();
  params.append('mode', 'subscription');
  params.append('line_items[0][price]', price);
  params.append('line_items[0][quantity]', '1');
  if (coupon) params.append('discounts[0][coupon]', coupon);
  // Note: allow_promotion_codes cannot be combined with discounts.
  params.append('client_reference_id', user.id);
  params.append('metadata[user_id]', user.id);
  params.append('subscription_data[metadata][user_id]', user.id);
  params.append('success_url', `${origin}/account.html?checkout=success`);
  params.append('cancel_url', `${origin}/#pricing`);

  // Reuse the existing Stripe customer when the account already has one so
  // renewals and the billing portal stay on a single customer record.
  const profile = await getProfile(user.id);
  if (profile?.stripe_customer_id) {
    params.append('customer', profile.stripe_customer_id);
  } else if (user.email) {
    params.append('customer_email', user.email);
  }

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
