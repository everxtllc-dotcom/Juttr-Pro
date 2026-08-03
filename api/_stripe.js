// Shared Stripe helpers for the license / billing endpoints.
//
// Zero npm deps: talks to the Stripe REST API via global fetch (the site stays a
// build-free static deploy). Files prefixed with `_` are ignored by Vercel's
// router, so this is shared code, not its own endpoint.
//
// Required env var:
//   STRIPE_SECRET_KEY   sk_live_… / sk_test_…

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// A subscription "counts as Pro" when it is active OR in a trial. This is the
// single definition shared by activation, revalidation, and the status endpoint.
export const ACTIVE_STATUSES = new Set(['active', 'trialing']);

export async function stripeGet(path) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

function customerIdOf(sub) {
  return typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
}

/**
 * Resolve a subscription from the Stripe Subscription ID (the license key).
 *
 * Requires the caller's email to match the subscription's customer, so a bare
 * `sub_` id can never unlock Pro or leak a customer's billing details to whoever
 * happens to hold it. Returns { ok, sub, customer } or { error, message }.
 */
export async function resolveByLicenseKey({ email, licenseKey }) {
  if (!licenseKey || !licenseKey.startsWith('sub_')) {
    return { error: 'invalid_key', message: 'Invalid license key format.' };
  }

  const sub = await stripeGet(`subscriptions/${encodeURIComponent(licenseKey)}`);
  if (!sub.ok || !sub.data?.id) {
    return { error: 'not_found', message: 'License key not found.' };
  }
  if (!ACTIVE_STATUSES.has(sub.data.status)) {
    return { error: 'inactive', message: 'Subscription is not active.' };
  }

  const customer = await stripeGet(`customers/${customerIdOf(sub.data)}`);
  const customerEmail = (customer.data?.email || '').toLowerCase();
  if (!customerEmail || customerEmail !== email) {
    return { error: 'email_mismatch', message: 'Email does not match this license key.' };
  }

  return { ok: true, sub: sub.data, customer: customer.data };
}

/**
 * Resolve a customer's active-or-trialing subscription from their email alone.
 * Used by background revalidation and by the extension (which stores the email
 * but not the raw `sub_`). Returns { ok, sub, customer } or { error, message }.
 */
export async function resolveByEmail(email) {
  const customers = await stripeGet(`customers?email=${encodeURIComponent(email)}&limit=1`);
  const customer = customers.data?.data?.[0];
  if (!customer) return { error: 'no_customer', message: 'No customer found.' };

  // status=all so trialing subscriptions are included (a plain status=active
  // filter would drop trials). Then pick the first active-or-trialing sub.
  const subs = await stripeGet(`subscriptions?customer=${customer.id}&status=all&limit=10`);
  const sub = (subs.data?.data || []).find((s) => ACTIVE_STATUSES.has(s.status));
  if (!sub) return { error: 'inactive', message: 'No active subscription.' };

  return { ok: true, sub, customer };
}

/**
 * Resolve a customer's active-or-trialing subscription from a known Stripe
 * customer id. Used when the id is taken from the Supabase profile (written by
 * the webhook) instead of an email search — Stripe's `customers?email=` filter is
 * case-sensitive, so a mixed-case address stored at checkout is missed by our
 * lowercased lookups. Resolving by id sidesteps that. Returns { ok, sub, customer }.
 */
export async function resolveByCustomerId(customerId) {
  if (!customerId) return { error: 'no_customer', message: 'No customer found.' };

  const customer = await stripeGet(`customers/${encodeURIComponent(customerId)}`);
  if (!customer.ok || !customer.data?.id || customer.data?.deleted) {
    return { error: 'no_customer', message: 'No customer found.' };
  }
  const subs = await stripeGet(`subscriptions?customer=${customerId}&status=all&limit=10`);
  const sub = (subs.data?.data || []).find((s) => ACTIVE_STATUSES.has(s.status));
  if (!sub) return { error: 'inactive', message: 'No active subscription.' };

  return { ok: true, sub, customer: customer.data };
}

/**
 * Flatten a Stripe subscription into the safe, display-only fields the account
 * page / settings render. Never includes ids, payment methods, or other PII
 * beyond the account email the caller already proved they own.
 */
export function toStatusPayload(sub, customer) {
  const item = sub.items?.data?.[0];
  const price = item?.price;
  // Recent Stripe API versions moved the billing period onto the item; fall back
  // to the item's period when the subscription-level field is absent.
  const currentPeriodEnd = sub.current_period_end ?? item?.current_period_end ?? null;

  return {
    status: sub.status,
    email: customer?.email || null,
    current_period_end: currentPeriodEnd,
    cancel_at_period_end: sub.cancel_at_period_end === true,
    plan: price
      ? {
          amount: price.unit_amount ?? null,
          currency: price.currency ?? null,
          interval: price.recurring?.interval ?? null,
        }
      : null,
  };
}
