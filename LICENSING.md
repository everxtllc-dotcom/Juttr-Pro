# Juttr Pro — Licensing & Key Issuance

How the paid **Pro** tier works end to end, and how to operate it.

## Overview

```
User enters email + sub_xxx in the Juttr extension (Settings → Subscription)
            ↓
POST /api/check-user  { email, license_key }
            ↓
Backend checks Stripe:
  • Does this sub_ ID exist?
  • Is it active?
  • Does its customer email match?
            ↓
If yes → sign  email|pro|issued_at  with the EC P-256 PRIVATE key (IEEE-P1363)
            ↓
Return { tier:"pro", email, issued_at, sig }
            ↓
Extension verifies the signature with the embedded PUBLIC key, stores the token
in chrome.storage.local, and sets the profile tier to "pro".
            ↓
Every 7 days online → POST /api/check-user { email, revalidate:true }
  If the subscription is gone → token cleared → back to Free.
```

Signing is **asymmetric**: the private key lives only on the server
(`LICENSE_SIGNING_PRIVATE_KEY`). The extension ships only the public key, so a
leaked client can't forge Pro tokens.

> Format note: Node signs EC as DER by default, but Web Crypto's `ECDSA verify`
> requires raw `ieee-p1363` (r‖s). Both sides use the raw hex form — see
> `api/_sign.js` and `src/kernel/services/subscriptionService.ts`.

## Endpoints

| Route | Purpose |
| --- | --- |
| `POST /api/check-user` | Activation + 7-day revalidation. Returns the signed token. |
| `POST /api/create-checkout` | Creates a Stripe Checkout session (`{ plan: "monthly" \| "yearly" }`). |
| `GET  /api/session?session_id=cs_…` | Resolves a completed Checkout to the `sub_` id for the success page. |
| `POST /api/webhook` | Stripe webhook safety net (logs cancellations). |

## One-time setup

### 1. Generate the signing keypair
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

### 2. Stripe
1. Create a product "Juttr Pro" with two recurring prices at the **regular**
   amounts: **$5/month** and **$49/year**. Copy their `price_…` IDs into
   `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY`. Then create the two intro
   coupons (40% off ×12 months, and $25 off once) and set `STRIPE_COUPON_MONTHLY`
   / `STRIPE_COUPON_YEARLY` — see `STRIPE_SETUP_GUIDE.md` Step 2. Do not create
   the prices at the discounted amounts; the coupon applies on top.
2. Set `STRIPE_SECRET_KEY`.
3. (Optional) Add a webhook endpoint pointing at `/api/webhook` for
   `customer.subscription.deleted` and `customer.subscription.updated`; copy its
   signing secret into `STRIPE_WEBHOOK_SECRET`.

### 3. Extension
Set the deployed origin in `src/config/license.ts` (`SITE_ORIGIN`) so
`LICENSE_API_URL` / `PRICING_URL` point at this site.

## How License Keys Work (for users / support)

1. After paying via Stripe Checkout, the user lands on **`/success.html`**, which
   shows their license key (their Stripe **Subscription ID**, starting with
   `sub_`) and a Copy button. Stripe also emails a receipt.
2. They paste it into Juttr → **Settings → Subscription** with their email and
   click **Activate Pro**.
3. Lost the key? It's in the Stripe receipt email, or at the customer billing
   portal: <https://billing.stripe.com/p/login>.
4. Admin lookup: Stripe Dashboard → Customers → search by email → open the
   customer → Subscriptions → copy the `sub_…` ID.

Cancellation is handled automatically by the extension's 7-day revalidation (the
webhook is just a faster-acting backstop and logs only).
