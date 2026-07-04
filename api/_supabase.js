// Shared Supabase helpers for the serverless API (zero npm deps).
//
// Files prefixed with `_` are ignored by Vercel's router — shared code only.
//
// Required env vars:
//   SUPABASE_URL                https://xxxx.supabase.co
//   SUPABASE_ANON_KEY           public anon key (token verification)
//   SUPABASE_SERVICE_ROLE_KEY   service role key (privileged reads/writes)

const URL_ = () => process.env.SUPABASE_URL;
const ANON = () => process.env.SUPABASE_ANON_KEY;
const SERVICE = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

export function isSupabaseConfigured() {
  return !!(URL_() && ANON() && SERVICE());
}

/**
 * Verifies a Supabase access token (from `Authorization: Bearer …`) by asking
 * the auth server. Returns { id, email } or null.
 */
export async function getUserFromRequest(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token || !URL_() || !ANON()) return null;
  try {
    const r = await fetch(`${URL_()}/auth/v1/user`, {
      headers: { apikey: ANON(), authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const user = await r.json();
    if (!user?.id) return null;
    return { id: user.id, email: user.email || '' };
  } catch {
    return null;
  }
}

/** Service-role REST call against PostgREST. Returns parsed JSON (or null). */
export async function serviceRest(path, { method = 'GET', body, headers = {} } = {}) {
  const r = await fetch(`${URL_()}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE(),
      authorization: `Bearer ${SERVICE()}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 204) return { ok: r.ok, status: r.status, data: null };
  const data = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, data };
}

/** Reads a profiles row by user id (service role). */
export async function getProfile(userId) {
  const { ok, data } = await serviceRest(
    `profiles?id=eq.${encodeURIComponent(userId)}&select=*`,
  );
  return ok && Array.isArray(data) && data[0] ? data[0] : null;
}

/** Patches a profiles row by user id (service role). */
export async function updateProfile(userId, patch) {
  return serviceRest(`profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: { ...patch, updated_at: new Date().toISOString() },
  });
}
