// Shared Supabase auth client for login.html / account.html / reset.html.
// Loaded as an ES module; supabase-js v2 comes from the jsDelivr ESM CDN so
// the site stays zero-build.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.JUTTR_SUPABASE || {};

export const supabase = cfg.url && cfg.anonKey
  ? createClient(cfg.url, cfg.anonKey)
  : null;

/** True when js/supabase-config.js has been filled in. */
export const isConfigured = !!supabase;

/** Returns the current session, or null. */
export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

/**
 * Redirects to login.html (preserving intent/plan params) when there is no
 * session. Returns the session otherwise.
 */
export async function requireSession() {
  const session = await getSession();
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `login.html?next=${next}`;
    return null;
  }
  return session;
}

/** fetch() against our /api endpoints with the Supabase access token. */
export async function authedFetch(path, body, method = 'POST') {
  const session = await getSession();
  if (!session) throw new Error('not_authenticated');
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/**
 * Continues the post-login journey:
 *  - intent=upgrade → straight into Stripe Checkout for the chosen plan
 *  - next=…        → back to the requested page
 *  - otherwise     → account.html
 */
export async function continueAfterAuth(params) {
  const intent = params.get('intent');
  const plan = params.get('plan') || 'annual';
  const code = params.get('c') || undefined;
  const next = params.get('next');

  if (intent === 'upgrade') {
    const { ok, data } = await authedFetch('/api/create-checkout', { plan, code });
    if (ok && data.url) {
      location.href = data.url;
      return;
    }
    // Fall through to the account page with an error flag.
    location.href = 'account.html?checkout=failed';
    return;
  }
  location.href = next ? decodeURIComponent(next) : 'account.html';
}
