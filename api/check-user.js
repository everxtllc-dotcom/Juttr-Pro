// Vercel serverless function — verifies a user's access against the Supabase
// `public.profiles` table (no longer against a Stripe Subscription ID).
//
// SOURCE OF TRUTH: profiles.subscription_status, set by Stripe (webhook) OR by a
// manual 'lifetime' override in the Supabase dashboard. See the schema and the
// manual-override how-to in supabase/profiles.sql.
//
// ACCESS RULE (isActive):
//   • lifetime            → active:true  — granted key, bypasses Stripe, full Pro
//   • active | trialing   → active:true  — live Stripe subscription, full Pro
//   • free (signup default) / anything else → active:false — can log in, no Pro
//
// TWO CALLERS, ONE RESPONSE (a superset):
//   • account.html  reads  { active, subscription_status }
//   • the extension reads  { tier:'pro', issued_at, sig }  (offline-verified token)
// Active accounts get both; the signed Pro token is issued exactly when
// active === true. Free/inactive accounts get { active:false, tier:'free' }.
//
// Zero npm deps: queries Supabase via its REST endpoint, exactly like
// api/subscribe.js — the site stays a build-free static deploy.
//
// Required env vars (Project → Settings → Environment Variables):
//   SUPABASE_URL                 https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    service_role key (server-side only; bypasses RLS)
//   LICENSE_SIGNING_PRIVATE_KEY  EC P-256 key — signs the extension's Pro token
//
// Request:  { email }   (legacy license_key / revalidate fields are ignored)

import { signLicense } from './_sign.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// The only statuses that grant Pro access (active:true + signed token). The
// signup default 'free' is deliberately absent: free users can log in but get
// no Pro. Everything not in this set (free, canceled, past_due, none) is inactive.
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'lifetime']);

// Look up a single profile by email using the service-role key (bypasses RLS).
async function getProfile(email) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const query =
    `${url}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}` +
    `&select=email,subscription_status,stripe_customer_id&limit=1`;
  const r = await fetch(query, {
    headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

export default async function handler(req, res) {
  // CORS — allow the Chrome extension origin.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ active: false, tier: 'free', error: 'method_not_allowed' });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ active: false, tier: 'free', error: 'Server not configured.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const email = (typeof body.email === 'string' ? body.email.trim() : '').toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ active: false, tier: 'free', error: 'A valid email is required.' });
  }

  try {
    const profile = await getProfile(email);
    const status = profile?.subscription_status || 'none';
    const active = ACTIVE_STATUSES.has(status);

    const payload = { active, subscription_status: status, email, tier: 'free' };

    if (active && process.env.LICENSE_SIGNING_PRIVATE_KEY) {
      // Add the offline-verifiable Pro token the extension expects (unchanged
      // contract) — issued exactly when the account is active.
      const issued_at = Date.now();
      payload.tier = 'pro';
      payload.issued_at = issued_at;
      payload.sig = signLicense(email, 'pro', issued_at);
    } else if (!active) {
      payload.error = 'No active subscription for this account.';
    }

    return res.status(200).json(payload);
  } catch (err) {
    console.error('check-user error:', err);
    return res.status(500).json({ active: false, tier: 'free', error: 'Server error. Try again.' });
  }
}
