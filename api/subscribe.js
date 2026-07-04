// Vercel serverless function — stores a marketing lead in Supabase.
// Zero dependencies: uses the global fetch + Supabase's REST endpoint, so the
// site stays a plain static deploy (no package.json / build step).
//
// Required Vercel env vars (Project → Settings → Environment Variables):
//   SUPABASE_URL                 e.g. https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    the secret service_role key (server-side only)
//
// The browser POSTs JSON { name, email, source, opt_in, hp } to /api/subscribe.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  // Vercel auto-parses JSON bodies; fall back to manual parse just in case.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  // Honeypot: real users never fill this hidden field. Pretend success so bots
  // don't learn they were caught — but write nothing.
  if (body.hp) return res.status(200).json({ ok: true });

  const name = clip(body.name, 120);
  const email = clip(body.email, 200).toLowerCase();
  const source = clip(body.source, 40) || 'site';
  const opt_in = body.opt_in !== false; // default true

  if (!name || !EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, error: 'invalid_input' });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return res.status(500).json({ ok: false, error: 'not_configured' });
  }

  try {
    // Upsert on the unique email so re-submits don't create duplicates.
    const r = await fetch(`${url}/rest/v1/subscribers?on_conflict=email`, {
      method: 'POST',
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ name, email, source, opt_in }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('supabase insert failed', r.status, detail);
      return res.status(502).json({ ok: false, error: 'store_failed' });
    }

    // "Send to desktop": email the install link via Brevo when configured.
    // Best-effort — the lead is already stored, so a mail failure never
    // fails the request. Requires BREVO_API_KEY (+ optional MAIL_FROM).
    if (source === 'send-to-desktop' && process.env.BREVO_API_KEY) {
      const storeUrl =
        'https://chromewebstore.google.com/detail/juttr/ekhlnpabcklhbbkilicfeiepcgdiklef' +
        '?utm_source=email&utm_medium=send-to-desktop';
      try {
        const mail = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': process.env.BREVO_API_KEY,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            sender: { name: 'Juttr', email: process.env.MAIL_FROM || 'hello@juttr.cc' },
            to: [{ email }],
            subject: 'Your Juttr install link',
            htmlContent:
              '<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0d1b2a">' +
              '<h2 style="letter-spacing:-0.02em">Here\'s Juttr, as promised.</h2>' +
              '<p>Open this on your desktop and add Juttr to Chrome — it takes about 30 seconds. ' +
              'No account needed; everything stays on your device.</p>' +
              `<p style="margin:28px 0"><a href="${storeUrl}" ` +
              'style="background:#0d9488;color:#fff;padding:12px 22px;border-radius:12px;' +
              'text-decoration:none;font-weight:600">Add Juttr to Chrome</a></p>' +
              '<p style="color:#5b6675;font-size:13px">Capture now. Focus now. Return later.<br>' +
              '— Juttr · <a href="https://www.juttr.cc" style="color:#0d9488">juttr.cc</a></p></div>',
          }),
        });
        if (!mail.ok) console.error('brevo send failed', mail.status, await mail.text().catch(() => ''));
      } catch (err) {
        console.error('brevo send error', err);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('subscribe error', err);
    return res.status(502).json({ ok: false, error: 'store_failed' });
  }
}
