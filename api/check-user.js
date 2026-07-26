// Vercel serverless function — verifies a user's access and issues the signed
// Pro token the extension verifies offline.
//
// ── SECURITY: this endpoint requires proof of possession ────────────────────
// It used to accept a bare { email } and return a signed Pro licence for it.
// That made it an open oracle: anyone could mint a working Pro licence for any
// paying customer's address, and — because the reply differed for unknown vs
// inactive accounts — enumerate arbitrary addresses to discover who pays for
// Juttr. Email alone is no longer sufficient. A caller must present ONE of:
//
//   1. license_key = `sub_…`   the Stripe Subscription ID. Verified against
//                              Stripe, and the subscription's customer email
//                              must match (see _stripe.js resolveByLicenseKey).
//   2. license_key = other     the profile's `activation_key`, used only by
//                              manually granted 'lifetime' accounts, which have
//                              no Stripe subscription. See supabase/profiles.sql.
//   3. sig + issued_at         a licence signature THIS server issued earlier.
//                              Used by background revalidation: installs that
//                              activated before the key requirement never stored
//                              the key, but they do hold the signature, so this
//                              keeps existing Pro customers working.
//   4. access_token            a Supabase session token, verified against
//                              /auth/v1/user and matched to the email. This is
//                              how account.html authenticates after login — it
//                              has a session, not a licence key.
//
// Every failure returns the SAME payload and message, so the response cannot be
// used to distinguish "no such account" from "inactive" from "wrong key".
//
// CORS is deliberately still `*`. It is not a security control here — a non-
// browser caller ignores it entirely — and narrowing it would break locally
// unpacked extensions, whose ids are random. The credential check above is the
// control.
//
// SOURCE OF TRUTH: profiles.subscription_status, set by Stripe (webhook) OR by a
// manual 'lifetime' override in the Supabase dashboard.
//
// ACCESS RULE (isActive):
//   • lifetime            → active:true  — granted key, bypasses Stripe, full Pro
//   • active | trialing   → active:true  — live Stripe subscription, full Pro
//   • free (signup default) / anything else → active:false — can log in, no Pro
//
// TWO CALLERS, ONE RESPONSE (a superset):
//   • account.html  reads  { active, subscription_status }
//   • the extension reads  { tier:'pro', issued_at, sig }  (offline-verified token)
//
// Zero npm deps: queries Supabase via its REST endpoint, exactly like
// the other endpoints in this folder — the site stays a build-free static deploy.
//
// Required env vars (Project → Settings → Environment Variables):
//   SUPABASE_URL                 https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    service_role key (server-side only; bypasses RLS)
//   LICENSE_SIGNING_PRIVATE_KEY  EC P-256 key — signs the extension's Pro token
//   STRIPE_SECRET_KEY            sk_… — verifies a `sub_…` licence key

import { signLicense } from './_sign.js';
import { authorizeCaller } from './_auth.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// The only statuses that grant Pro access (active:true + signed token). The
// signup default 'free' is deliberately absent: free users can log in but get
// no Pro. Everything not in this set (free, canceled, past_due, none) is inactive.
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'lifetime']);

// One reply for every failure mode. Never vary this by cause — the difference is
// exactly what let addresses be enumerated.
const DENY = {
  active: false,
  tier: 'free',
  error: 'No active subscription for this account.',
};

// Look up a single profile by email using the service-role key (bypasses RLS).
async function getProfile(email) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const query =
    `${url}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}` +
    `&select=email,subscription_status,stripe_customer_id,activation_key&limit=1`;
  const r = await fetch(query, {
    headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

export default async function handler(req, res) {
  // CORS — allow the Chrome extension origin. See the note in the header: this
  // is a convenience for browser callers, not an access control.
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
    // A malformed email is a client bug, not an auth outcome — it reveals nothing.
    return res.status(400).json({ active: false, tier: 'free', error: 'A valid email is required.' });
  }

  try {
    const profile = await getProfile(email);

    const basis = await authorizeCaller(email, body, profile);
    if (!basis) return res.status(200).json({ ...DENY });

    // Proof accepted — now report the CURRENT entitlement. A valid old signature
    // proves prior activation, not present status, so a cancelled subscriber
    // still ends up denied here and the extension clears its token.
    //
    // The 'stripe' basis is the exception: resolveByLicenseKey already confirmed
    // a live active/trialing subscription owned by this email, so honour it even
    // if the webhook has not yet written the profile row.
    const dbStatus = profile?.subscription_status || 'none';
    const status = basis === 'stripe' ? 'active' : dbStatus;
    if (!ACTIVE_STATUSES.has(status)) return res.status(200).json({ ...DENY });

    const payload = { active: true, subscription_status: status, email, tier: 'free' };

    if (process.env.LICENSE_SIGNING_PRIVATE_KEY) {
      const issued_at = Date.now();
      payload.tier = 'pro';
      payload.issued_at = issued_at;
      payload.sig = signLicense(email, 'pro', issued_at);
    }

    return res.status(200).json(payload);
  } catch (err) {
    console.error('check-user error:', err);
    return res.status(500).json({ active: false, tier: 'free', error: 'Server error. Try again.' });
  }
}
