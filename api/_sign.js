// Shared signing helper for the license system.
//
// Signs `${email}|${tier}|${issued_at}` with the EC P-256 private key using the
// IEEE-P1363 (raw r‖s) encoding so the extension's Web Crypto `ECDSA verify`
// accepts it. Node's default EC encoding is DER — which Web Crypto rejects — so
// `dsaEncoding: 'ieee-p1363'` is REQUIRED here. Output is lowercase hex.
//
// Files prefixed with `_` are ignored by Vercel's router, so this is shared code,
// not its own endpoint.
//
// Required env var:
//   LICENSE_SIGNING_PRIVATE_KEY   EC P-256 private key, PEM (PKCS#8 or SEC1)

import crypto from 'crypto';

export function signLicense(email, tier, issuedAt) {
  const key = process.env.LICENSE_SIGNING_PRIVATE_KEY;
  if (!key) throw new Error('LICENSE_SIGNING_PRIVATE_KEY not configured');

  const payload = `${email}|${tier}|${issuedAt}`;
  const sig = crypto.sign('sha256', Buffer.from(payload), {
    key,
    dsaEncoding: 'ieee-p1363',
  });
  return sig.toString('hex');
}
