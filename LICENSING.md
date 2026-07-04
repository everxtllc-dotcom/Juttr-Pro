# Juttr Pro — Accounts, Licensing & Billing

How the paid **Pro** tier works end to end, and how to operate it.

## Overview (V2 — Supabase accounts)

```
User signs in with Google (website login.html, or the extension via
chrome.identity) → Supabase session
            ↓
Extension: POST /api/license   Authorization: Bearer <access token>
           { device_id, device_label }
            ↓
Backend:
  • verifies the token with Supabase
  • reads profiles.is_pro (manual/influencer flips included)
  • legacy backfill: links an active Stripe sub found by email
  • registers the device (max 2 active; 409 device_limit otherwise)
            ↓
Signs  userId|email|tier|issued_at  with the EC P-256 PRIVATE key (IEEE-P1363)
            ↓
Extension verifies the signature with the embedded PUBLIC key, caches the
token (juttr_license_v2), and sets profileStore.tier.
            ↓
Refresh on every boot + every 24h (setInterval + chrome.alarms heartbeat).
Signed tokens older than 14 days require a successful refresh (offline grace).
```

Signing is **asymmetric**: the private key lives only on the server
(`LICENSE_SIGNING_PRIVATE_KEY`). The extension ships only the public key, so a
leaked client can't forge Pro tokens, and hand-editing chrome.storage reverts
on the next boot.

> Format note: Node signs EC as DER by default, but Web Crypto's `ECDSA verify`
> requires raw `ieee-p1363` (r‖s). Both sides use the raw hex form — see
> `api/_sign.js` and `src/kernel/services/subscriptionService.ts`.

## Endpoints

| Route | Purpose |
| --- | --- |
| `POST /api/license` | V2 entitlement + device registration. Bearer auth. Returns the signed token. |
| `POST /api/device` | Removes one of the caller's devices (device-limit modal). Bearer auth. |
| `POST /api/create-checkout` | Stripe Checkout (`{ plan: "annual" \| "monthly" \| "influencer", code? }`). Bearer auth. |
| `POST /api/portal` | Stripe Billing Portal session for the caller. Bearer auth. |
| `POST /api/webhook` | Stripe webhook → sets `profiles.is_pro` in Supabase. |
| `POST /api/check-user` | **Legacy** email+`sub_…` activation / 7-day revalidation. Kept for the migration window. |
| `GET  /api/session?session_id=cs_…` | Legacy success-page helper. |

## Pricing model (no lifetime deals)

Base prices + coupons, so renewals step up automatically inside Stripe:

| Plan | First period | Renewal | Mechanism |
| --- | --- | --- | --- |
| Annual (default, visually dominant) | **$24 / first year** | $49 / year | $49 price + `ANNUAL_INTRO` coupon ($25 off, `once`) |
| Monthly (launch promo) | **$3 / mo × 12** | $5 / month | $5 price + `MONTHLY_INTRO` coupon ($2 off, `repeating`, 12 months) |
| Influencer (hidden `partner.html?c=<code>`) | **$19 / first year** | $49 / year | $49 price + `INFLUENCER` coupon ($30 off, `once`) |

Existing $20/yr and $3/mo subscribers are grandfathered on their old prices.

## One-time setup

### 1. Supabase
1. Create a project; run `supabase/schema.sql` in the SQL editor
   (profiles + devices tables, RLS, signup trigger).
2. Auth → Providers: enable **Google** (needs a Google Cloud OAuth client) and
   **Email** with password recovery.
3. Auth → URL Configuration → Redirect URLs: add
   `https://<domain>/login.html`, `/account.html`, `/reset.html`,
   `https://<EXTENSION_ID>.chromiumapp.org/`, and the PWA origin.
4. Copy the project URL + anon key into `js/supabase-config.js` **and**
   `src/config/license.ts` (extension); set `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` in Vercel.

### 2. Generate the signing keypair
```bash
openssl ecparam -genkey -name prime256v1 -noout -out license_private.pem
openssl ec -in license_private.pem -pubout -out license_public.pem
```
- Put the **private** PEM in Vercel as `LICENSE_SIGNING_PRIVATE_KEY`.
- Convert the **public** PEM to JWK and paste it into the extension at
  `src/config/license.ts` (`LICENSE_PUBLIC_KEY_JWK`):
  ```bash
  node -e "console.log(JSON.stringify(require('crypto').createPublicKey(require('fs').readFileSync('license_public.pem')).export({format:'jwk'})))"
  ```

### 3. Stripe
1. Product "Juttr Pro" with two recurring prices: **$5/month** and **$49/year**
   → `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY`.
2. Coupons (Products → Coupons) → env vars:
   - `STRIPE_COUPON_ANNUAL_INTRO` — $25 off, duration **once**
   - `STRIPE_COUPON_MONTHLY_INTRO` — $2 off, **repeating**, 12 months
   - `STRIPE_COUPON_INFLUENCER` — $30 off, duration **once**
3. Pick a URL secret for the hidden partner page → `INFLUENCER_CODE`
   (share `https://<domain>/partner.html?c=<code>` privately; the page is
   noindexed and excluded via robots.txt).
4. Enable the **Billing Portal** (Settings → Billing → Customer portal):
   cancellation + payment-method update.
5. Webhook endpoint → `https://<domain>/api/webhook` for
   `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted` → `STRIPE_WEBHOOK_SECRET`.
6. Set `STRIPE_SECRET_KEY`.

### 4. Extension
1. Set the deployed origin in `src/config/license.ts` (`SITE_ORIGIN`) and fill
   `SUPABASE_URL` / `SUPABASE_ANON_KEY` there.
2. Pin the extension ID: add a `"key"` field to `public/manifest.json` so the
   `https://<id>.chromiumapp.org/` OAuth redirect stays stable between dev
   loads and matches the Supabase allowlist. (Get the key from
   chrome://extensions → Pack extension, or the Web Store developer dashboard.)

## Influencer / manual Pro (no key generator)

Flip it in the Supabase dashboard: Table editor → `profiles` → set
`is_pro = true`, `pro_source = 'manual'`. The extension picks it up at its
next revalidation (≤ 24h, or immediately via Settings → "Refresh status").
`pro_source = 'manual'` guarantees Stripe webhooks never downgrade the grant.
To revoke, set `is_pro = false`.

## Multi-device policy

Same account active on up to **2 browser instances**. `/api/license` upserts
`(user_id, device_id)`; a third device gets `409 device_limit` and the
extension shows a modal listing devices with "Sign out" buttons. Devices idle
more than 30 days are pruned automatically. Users can also manage devices on
`account.html`.

## Legacy email + key flow (migration window)

The old flow (email + Stripe `sub_…` ID via `/api/check-user`, 7-day
revalidation) still works and is reachable in the extension under
Settings → Subscription → "Have a legacy license key?". On first Google
sign-in with the same email, `/api/license` backfills the account
automatically (`is_pro = true`, customer linked). Plan to remove
`check-user.js` and the legacy UI a few months after launch.
