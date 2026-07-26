// Vercel serverless function — emails the Juttr Chrome install link.
//
// This endpoint STORES NOTHING. It replaced the former api/subscribe.js, which
// wrote { name, email, source, opt_in } to a Supabase `subscribers` table. That
// marketing list was removed deliberately: Juttr collects an email address only
// for account login (Supabase Auth) and Pro billing (Stripe). The address below
// is used once, to deliver a message the visitor explicitly asked for, and is
// never written to our database.
//
// Keep it that way. Adding a write here re-creates the marketing-list problem
// and would make the Privacy Policy inaccurate — see privacy.html §3.
//
// Required env var: BREVO_API_KEY   (optional: MAIL_FROM)

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const STORE_URL =
  'https://chromewebstore.google.com/detail/juttr/ekhlnpabcklhbbkilicfeiepcgdiklef' +
  '?utm_source=email&utm_medium=send-to-desktop';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  // Honeypot: real users never fill this hidden field. Pretend success so bots
  // don't learn they were caught — but send nothing.
  if (body.hp) return res.status(200).json({ ok: true });

  const email = (typeof body.email === 'string' ? body.email.trim().slice(0, 200) : '').toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, error: 'invalid_input' });
  }

  if (!process.env.BREVO_API_KEY) {
    return res.status(500).json({ ok: false, error: 'not_configured' });
  }

  try {
    const mail = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'Juttr', email: process.env.MAIL_FROM || 'info@juttr.cc' },
        to: [{ email }],
        subject: 'Your Juttr install link',
        htmlContent:
          '<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0d1b2a">' +
          '<h2 style="letter-spacing:-0.02em">Here\'s Juttr, as promised.</h2>' +
          '<p>Open this on your desktop and add Juttr to Chrome — it takes about 30 seconds. ' +
          'Free to start, and your workspace stays on your device.</p>' +
          `<p style="margin:28px 0"><a href="${STORE_URL}" ` +
          'style="background:#0d9488;color:#fff;padding:12px 22px;border-radius:12px;' +
          'text-decoration:none;font-weight:600">Add Juttr to Chrome</a></p>' +
          '<p style="color:#5b6675;font-size:13px">You asked us to send this link, so this is a ' +
          'one-off message — you have not been added to any mailing list.<br>' +
          '— Juttr · <a href="https://www.juttr.cc" style="color:#0d9488">juttr.cc</a></p></div>',
      }),
    });

    if (!mail.ok) {
      console.error('brevo send failed', mail.status, await mail.text().catch(() => ''));
      return res.status(502).json({ ok: false, error: 'send_failed' });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('send-install-link error', err);
    return res.status(502).json({ ok: false, error: 'send_failed' });
  }
}
