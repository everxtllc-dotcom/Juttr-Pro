// Vercel serverless function — removes one of the signed-in user's devices
// (used by the extension's device-limit modal; the account page deletes via
// RLS directly).
//
// Request:  DELETE { device_id } or { id }  + Authorization: Bearer <token>
// Response: { removed: true }

import { getUserFromRequest, serviceRest, isSupabaseConfigured } from './_supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'DELETE' && req.method !== 'POST') {
    res.setHeader('Allow', 'DELETE, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!isSupabaseConfigured()) return res.status(500).json({ error: 'not_configured' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });

  // Scoped to the caller's own user_id — no cross-account deletion possible.
  let filter = null;
  if (typeof body.id === 'string' && body.id) {
    filter = `id=eq.${encodeURIComponent(body.id)}`;
  } else if (typeof body.device_id === 'string' && body.device_id) {
    filter = `device_id=eq.${encodeURIComponent(body.device_id)}`;
  }
  if (!filter) return res.status(400).json({ error: 'missing_device' });

  const { ok } = await serviceRest(
    `devices?user_id=eq.${encodeURIComponent(user.id)}&${filter}`,
    { method: 'DELETE' },
  );
  if (!ok) return res.status(502).json({ error: 'delete_failed' });

  return res.status(200).json({ removed: true });
}
