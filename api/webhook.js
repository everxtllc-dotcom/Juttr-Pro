// Vercel serverless function — Stripe webhook → Supabase sync.
//
// Keeps public.profiles.subscription_status (+ current_period_end, plan_interval)
// in step with Stripe. This is what ENFORCES the Pro time limit: when a
// subscription renews, lapses, or cancels, Stripe fires an event and we write the
// new status here, so /api/check-user (which reads this table) reflects it.
//
// Verifies the Stripe-Signature header by HMAC-SHA256 over `${t}.${rawBody}`
// (zero npm deps, Node crypto). Needs the raw body, so Vercel's automatic JSON
// parsing is disabled below.
//
// Required env vars:
//   STRIPE_WEBHOOK_SECRET        whsec_…  (verify the event)
//   STRIPE_SECRET_KEY            sk_…     (resolve the customer's email)
//   SUPABASE_URL                 https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    service_role key (write + admin, bypasses RLS)
// Optional:
//   SITE_URL                     https://juttr.cc  (password-link redirect target)
//   BREVO_API_KEY, MAIL_FROM     send the set-password email (else it's skipped)
//
// AUTO-PROVISIONING: if a new subscriber has no Supabase account, we create the
// auth user (the signup trigger makes their profile row), email them a link to
// set a password, then apply the status. Matching is by email; 'lifetime' rows
// are never touched.

import crypto from 'crypto';
import { stripeGet } from './_stripe.js';

export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verify(rawBody, header, secret) {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((kv) => kv.split('=').map((s) => s.trim())),
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${t}.${rawBody.toString('utf8')}`)
    .digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Update the matching profile (by email), never overriding a 'lifetime' grant.
async function updateProfile(email, patch) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const endpoint =
    `${url}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}` +
    `&subscription_status=neq.lifetime`;
  const r = await fetch(endpoint, {
    method: 'PATCH',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify(patch),
  });
  const rows = await r.json().catch(() => []);
  if (!r.ok) {
    console.error('profile update failed', r.status, rows);
    throw new Error(`supabase patch ${r.status}`);
  }
  return Array.isArray(rows) ? rows.length : 0;
}

// ── Auto-provisioning ───────────────────────────────────────────────────────
// Only real, paid statuses are worth creating an account for (skip incomplete /
// past_due / canceled first events).
const PROVISION_STATUSES = new Set(['active', 'trialing']);

function supaAuthHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
}

// Create the Supabase auth user (idempotent — "already registered" counts as ok).
async function createAuthUser(email) {
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: supaAuthHeaders(),
    body: JSON.stringify({ email, email_confirm: true }),
  });
  if (r.ok) return true;
  const data = await r.json().catch(() => ({}));
  const msg = `${data?.msg || data?.error_description || data?.error || ''}`.toLowerCase();
  if (r.status === 422 || r.status === 409 || msg.includes('already') || msg.includes('registered')) {
    return true; // user already exists — its profile should too
  }
  console.error('admin create user failed', r.status, data);
  return false;
}

// Generate a password-set (recovery) link WITHOUT sending Supabase's own email.
async function generateRecoveryLink(email) {
  const body = { type: 'recovery', email };
  if (process.env.SITE_URL) body.redirect_to = `${process.env.SITE_URL}/account`;
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: supaAuthHeaders(),
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('generate_link failed', r.status, data); return null; }
  return data?.action_link || data?.properties?.action_link || null;
}

// Email the setup link via Brevo (best-effort). The link is a credential, so it
// is only ever emailed to the account owner — never logged.
async function sendSetupEmail(email, link) {
  if (!process.env.BREVO_API_KEY) {
    console.warn('provisioned account but BREVO_API_KEY unset — no setup email for', email);
    return;
  }
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: { name: 'Juttr', email: process.env.MAIL_FROM || 'info@juttr.cc' },
        to: [{ email }],
        subject: 'Your Juttr Pro account — set your password',
        htmlContent:
          '<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0d1b2a">' +
          '<h2 style="letter-spacing:-0.02em">Welcome to Juttr Pro 🎉</h2>' +
          '<p>Your account is ready. Set a password to log in and manage your subscription.</p>' +
          `<p style="margin:28px 0"><a href="${link}" ` +
          'style="background:#0d9488;color:#fff;padding:12px 22px;border-radius:12px;' +
          'text-decoration:none;font-weight:600">Set your password</a></p>' +
          '<p style="color:#5b6675;font-size:13px">If you didn’t subscribe, you can ignore this email.<br>' +
          '— Juttr · <a href="https://www.juttr.cc" style="color:#0d9488">juttr.cc</a></p></div>',
      }),
    });
    if (!r.ok) console.error('brevo setup email failed', r.status, await r.text().catch(() => ''));
  } catch (err) {
    console.error('brevo setup email error', err);
  }
}

// Create the account and email the set-password link. Returns true if the user
// now exists (so the caller can re-apply the subscription status).
async function provisionAccount(email) {
  if (!(await createAuthUser(email))) return false;
  const link = await generateRecoveryLink(email);
  if (link) await sendSetupEmail(email, link);
  return true;
}

// Map a Stripe subscription object onto the profile row.
async function syncSubscription(sub, deleted) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.STRIPE_SECRET_KEY) {
    console.warn('webhook: sync skipped — Supabase/Stripe env not configured');
    return;
  }

  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  if (!customerId) return console.warn('webhook: subscription has no customer', sub.id);

  // Subscription payloads don't carry the email — resolve it from the customer.
  const cust = await stripeGet(`customers/${customerId}`);
  const email = (cust.data?.email || '').toLowerCase();
  if (!email) return console.warn('webhook: no email for customer', customerId);

  const item = sub.items?.data?.[0];
  // Recent Stripe API versions moved the period onto the item; fall back to it.
  const periodEnd = deleted ? null : (sub.current_period_end ?? item?.current_period_end ?? null);

  const patch = {
    subscription_status: deleted ? 'canceled' : sub.status,
    stripe_customer_id: customerId,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    plan_interval: deleted ? null : (item?.price?.recurring?.interval || null),
  };

  let matched = await updateProfile(email, patch);

  // No Supabase account yet? Auto-provision one (paid statuses only), then
  // re-apply the update to the freshly-created profile row.
  if (matched === 0 && !deleted && PROVISION_STATUSES.has(patch.subscription_status)) {
    console.log('webhook: no account for', email, '— provisioning');
    if (await provisionAccount(email)) {
      matched = await updateProfile(email, patch);
    }
  }

  if (matched === 0) {
    // Still nothing: e.g. a 'lifetime' row (guarded), or a non-paid status.
    console.warn(`webhook: no profile updated for ${email} (status=${patch.subscription_status})`);
  } else {
    console.log(`webhook: synced ${email} -> ${patch.subscription_status}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({ error: 'not_configured' });

  const rawBody = await readRawBody(req);
  if (!verify(rawBody, req.headers['stripe-signature'], secret)) {
    return res.status(400).json({ error: 'invalid_signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'invalid_payload' });
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await syncSubscription(event.data.object, false);
        break;
      case 'customer.subscription.deleted':
        await syncSubscription(event.data.object, true);
        break;
      default:
        break;
    }
  } catch (err) {
    // Transient failure — return 500 so Stripe retries the delivery.
    console.error('webhook sync error', event.type, err);
    return res.status(500).json({ error: 'sync_failed' });
  }

  return res.status(200).json({ received: true });
}
