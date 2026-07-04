// Vercel serverless function — resolves a completed Checkout session to the
// subscription id (the user's license key) + email, for the success page.
//
// Zero npm deps. Request: GET /api/session?session_id=cs_...
// Response: { subscription_id, email } or { error }.
//
// Required env var: STRIPE_SECRET_KEY

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const sessionId = (req.query?.session_id || '').toString();
  if (!sessionId.startsWith('cs_')) {
    return res.status(400).json({ error: 'invalid_session' });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'not_configured' });
  }

  try {
    const r = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      { headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } },
    );
    const data = await r.json();
    if (!r.ok) return res.status(404).json({ error: 'session_not_found' });

    const subscription_id = typeof data.subscription === 'string'
      ? data.subscription
      : data.subscription?.id || null;
    const email = data.customer_details?.email || data.customer_email || null;

    return res.status(200).json({ subscription_id, email });
  } catch (err) {
    console.error('session lookup error', err);
    return res.status(502).json({ error: 'lookup_failed' });
  }
}
