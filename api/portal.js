// Vercel serverless function — opens the Stripe Billing Portal for the
// signed-in user (manage/cancel subscription, update payment method).
//
// Request:  POST {}  + Authorization: Bearer <supabase access token>
// Response: { url }

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

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'not_configured' });
  }

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });

  const profile = await getProfile(user.id);
  if (!profile?.stripe_customer_id) {
    return res.status(404).json({ error: 'no_subscription' });
  }

  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const origin = `${proto}://${req.headers.host}`;

  const params = new URLSearchParams();
  params.append('customer', profile.stripe_customer_id);
  params.append('return_url', `${origin}/account.html`);

  try {
    const r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const data = await r.json();
    if (!r.ok || !data.url) {
      console.error('portal create failed', r.status, data?.error?.message);
      return res.status(502).json({ error: 'portal_failed' });
    }
    return res.status(200).json({ url: data.url });
  } catch (err) {
    console.error('portal error', err);
    return res.status(502).json({ error: 'portal_failed' });
  }
}
