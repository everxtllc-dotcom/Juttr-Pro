// Shared proof-of-possession check for the account / licence endpoints.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// check-user, create-portal and subscription-status all used to accept a bare
// { email } and act on it. Because a Juttr customer's email address is not a
// secret, that made all three abusable by anyone who knew or guessed one:
//
//   • check-user          → minted a signed, offline-verifiable Pro licence,
//                           and its differing replies allowed addresses to be
//                           enumerated to discover who pays for Juttr.
//   • create-portal       → returned a live Stripe Billing Portal URL, letting
//                           a stranger read invoices, change the payment method
//                           and CANCEL the subscription.
//   • subscription-status → returned plan, price and renewal date.
//
// Every one of those endpoints must now establish that the caller actually
// controls the account. `authorizeCaller` is that single check.
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// LICENSE_SIGNING_PRIVATE_KEY, STRIPE_SECRET_KEY.

import crypto from 'crypto';
import { verifyLicense } from './_sign.js';
import { resolveByLicenseKey, stripeGet } from './_stripe.js';

/** Constant-time compare that tolerates unequal lengths. */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  // timingSafeEqual throws on a length mismatch, so compare fixed-size digests:
  // constant-time for the comparison itself, and leaks nothing about length.
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(a, 'utf8').digest(),
    crypto.createHash('sha256').update(b, 'utf8').digest(),
  );
}

/** Confirm a Supabase access token belongs to `email`. */
async function verifySupabaseToken(accessToken, email) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${accessToken}`,
      },
    });
    if (!r.ok) return false;
    const user = await r.json().catch(() => null);
    return (user?.email || '').toLowerCase() === email;
  } catch {
    return false;
  }
}

/**
 * Confirm a completed Stripe Checkout Session belongs to `email`.
 *
 * The `cs_…` id is unguessable and lands in the buyer's URL bar on the success
 * page, which is the only credential they have before choosing a password. The
 * session must be complete — an abandoned one proves nothing.
 */
async function verifyCheckoutSession(sessionId, email) {
  if (!process.env.STRIPE_SECRET_KEY) return false;
  try {
    const s = await stripeGet(`checkout/sessions/${encodeURIComponent(sessionId)}`);
    if (!s.ok || s.data?.status !== 'complete') return false;
    const sessionEmail = (
      s.data?.customer_details?.email || s.data?.customer_email || ''
    ).toLowerCase();
    return !!sessionEmail && sessionEmail === email;
  } catch {
    return false;
  }
}

/** Read just the activation_key for a manually granted account. */
async function getActivationKey(email) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}` +
        `&select=activation_key&limit=1`,
      { headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' } },
    );
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    return rows?.[0]?.activation_key || null;
  } catch {
    return null;
  }
}

/**
 * Decide whether the caller proved they control `email`.
 *
 * Accepts any one of four credentials, in the order tried:
 *   'session'        body.access_token — a Supabase session (account.html)
 *   'checkout'       body.session_id = `cs_…` — a completed Stripe Checkout
 *                    Session whose email matches. The only credential a buyer
 *                    holds on success.html, before they have set a password.
 *   'token'          body.sig + body.issued_at — a licence signature this server
 *                    issued earlier. Lets installs that predate the licence-key
 *                    requirement keep revalidating; they never stored the key,
 *                    but they do hold the signature.
 *   'stripe'         body.license_key = `sub_…` — checked against Stripe, and the
 *                    subscription's customer email must match. Authoritative for
 *                    a live subscription, independent of webhook lag.
 *   'activation_key' body.license_key — matches profiles.activation_key, used by
 *                    manually granted 'lifetime' accounts (no Stripe sub).
 *
 * @param profile optional pre-fetched profile row, to avoid a second round trip.
 * @returns the basis string, or null. Callers MUST treat null as a uniform
 *          failure and must not reveal which check failed.
 */
export async function authorizeCaller(email, body, profile) {
  const licenseKey = typeof body?.license_key === 'string' ? body.license_key.trim() : '';
  const sig = typeof body?.sig === 'string' ? body.sig.trim() : '';
  const issuedAt = Number(body?.issued_at);
  const accessToken = typeof body?.access_token === 'string' ? body.access_token.trim() : '';
  const checkoutId = typeof body?.session_id === 'string' ? body.session_id.trim() : '';

  if (accessToken && (await verifySupabaseToken(accessToken, email))) return 'session';

  if (checkoutId.startsWith('cs_') && (await verifyCheckoutSession(checkoutId, email))) {
    return 'checkout';
  }

  if (sig && Number.isFinite(issuedAt) && verifyLicense(email, 'pro', issuedAt, sig)) {
    return 'token';
  }

  if (!licenseKey) return null;

  if (licenseKey.startsWith('sub_')) {
    if (!process.env.STRIPE_SECRET_KEY) return null;
    const resolved = await resolveByLicenseKey({ email, licenseKey });
    return resolved.ok === true ? 'stripe' : null;
  }

  const activationKey =
    profile === undefined ? await getActivationKey(email) : profile?.activation_key || null;
  if (activationKey && safeEqual(licenseKey, activationKey)) return 'activation_key';

  return null;
}
