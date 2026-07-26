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

/**
 * Verify a signature this server previously issued.
 *
 * Used as proof-of-possession on background revalidation: an extension that
 * holds a valid token demonstrably completed a legitimate activation at some
 * point, so it may ask for a fresh one. That lets us drop email-only licence
 * issuance (which let anyone mint Pro for any customer's address) WITHOUT
 * breaking installs that activated before the licence key was required —
 * they never stored the key, but they do hold the signature.
 *
 * ECDSA is randomised, so a signature cannot be checked by re-signing and
 * comparing; it must be verified against the public key, which Node derives
 * from the private key we already hold.
 */
export function verifyLicense(email, tier, issuedAt, sigHex) {
  const key = process.env.LICENSE_SIGNING_PRIVATE_KEY;
  if (!key) throw new Error('LICENSE_SIGNING_PRIVATE_KEY not configured');
  if (typeof sigHex !== 'string' || !/^[0-9a-f]+$/i.test(sigHex) || sigHex.length % 2) {
    return false;
  }

  try {
    const payload = `${email}|${tier}|${issuedAt}`;
    return crypto.verify(
      'sha256',
      Buffer.from(payload),
      { key: crypto.createPublicKey(key), dsaEncoding: 'ieee-p1363' },
      Buffer.from(sigHex, 'hex'),
    );
  } catch {
    // Malformed signature / key — treat as a failed verification, never a 500.
    return false;
  }
}
