# Juttr Website — Deployment Guide

Static site, no build step. The dynamic pieces are the zero-dependency serverless
functions in `api/`, which Vercel runs automatically.

---

## 🚦 LAUNCH CHECKLIST — before this build goes live on www.juttr.cc

This deployment serves from **juttr-pro-1.vercel.app** and is held out of every
search index on purpose. `www.juttr.cc` still serves the older free build.

**1. Legal sign-off**
- [x] GDPR **Art. 27 EU/UK representative** — removed 26 Jul 2026 on the owner's
      instruction; they rely on the Art. 27(2) derogation. Not independently verified.
      Note Art. 27(2)(a) is conjunctive: processing must be *occasional* **and**
      low-risk.
- [x] **Privacy §3 now matches the code** — the marketing list was deleted so the
      minimal-collection statement is true. See "Install-link email" below.
- [ ] Drop the old Supabase `subscribers` table (see below). Until that is done the
      Policy says we hold no marketing list while the rows still exist.
- [ ] Confirm the retention periods in `privacy.html` §8 match the real settings in
      Supabase, Brevo, Stripe and Vercel. They are public commitments.
- [ ] Confirm the Stripe refund process honours the **14-day** window in `terms.html` §6.
- [ ] Check the Chrome Web Store developer account name matches **EverXt, LLC** — a
      mismatch between the store publisher and the Terms counterparty is a review flag.

**2. Flip indexing on**

`vercel.json` is deliberately **not** used for this — it is left exactly as it was
(`cleanUrls` + the `/success` rewrite only). The switch is a per-page meta tag, so
no Vercel, Stripe or Supabase configuration is involved.

- [ ] Remove `<meta name="robots" content="noindex, nofollow" />` from the **4 public
      pages**: `index.html` and the three `blog/*.html`. Each is preceded by a
      `PREVIEW ONLY` comment — delete that too.
- [ ] Remove it from `privacy.html` and `terms.html` once the legal pages are signed off.
- [ ] **Keep** it on `account.html` and `success.html` — those stay noindex in production.
- [ ] `sitemap.xml` — add the `/privacy` and `/terms` `<url>` blocks (a comment marks the spot).
- [ ] `robots.txt` needs **no change** — already written for production.

```bash
# find every tag that must go at launch
grep -rn 'name="robots"' --include=*.html .
```

**3. Verify after deploying**
- [ ] `curl -s https://www.juttr.cc/ | grep -i 'name="robots"'` returns **nothing**.
- [ ] `curl -sI https://www.juttr.cc/privacy` returns **200** (cleanUrls handles the
      `.html` → extensionless 308 automatically).
- [ ] Every `sitemap.xml` URL returns 200 and none carries a noindex.
- [ ] Re-run the structured-data check on `/` and the three blog posts.

**4. Point the old host at the new one**
- [ ] Once `www.juttr.cc` serves this build, redirect `juttr-pro-1.vercel.app` so the
      preview host stops serving a duplicate.

---

## File structure

```
juttr-site - V4/
├── index.html                   ← Homepage
├── privacy.html  terms.html     ← Legal pages (/privacy, /terms via cleanUrls)
├── account.html  success.html   ← Login + post-checkout (noindex)
├── blog/                        ← 3 articles, each with Article JSON-LD
├── css/  theme.css site.css preserved.css
├── styles.css                   ← Used by account.html / success.html only
├── js/
│   ├── site.js                  ← Theme, nav, reveal, store links, send-to-desktop, checkout
│   └── widgets.js               ← Theme-preview widget
├── api/
│   ├── send-install-link.js     ← Emails the install link. STORES NOTHING.
│   ├── check-user.js            ← Verifies access against Supabase `profiles`
│   ├── create-checkout.js       ← Stripe Checkout session
│   ├── create-portal.js         ← Stripe billing portal
│   ├── session.js               ← Resolves a Checkout session (success page)
│   ├── subscription-status.js   ← Live subscription details (display only)
│   ├── _sign.js  _stripe.js     ← Shared helpers
│   └── webhook.js               ← Stripe webhook → profiles.subscription_status
├── supabase/profiles.sql        ← Account schema
├── assets/                      ← Fonts, logo, screenshots, OG cover, handbook
├── robots.txt  sitemap.xml
└── vercel.json                  ← cleanUrls + /success rewrite (unmodified)
```

---

## Update the Chrome Web Store link (one place)

Edit the single constant at the top of **`js/site.js`**:
```js
const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/juttr/ekhlnpabcklhbbkilicfeiepcgdiklef';
```
Every "Add to Chrome" / "Chrome Web Store" link on the site reads from this value.
The CTAs are plain links — nothing is asked for or sent before the visitor reaches
the store.

---

## Install-link email (no data stored)

The site has **no marketing list**. It was removed deliberately so the Privacy
Policy's minimal-collection statement is true.

- `api/subscribe.js` — **deleted.** It used to write `{ name, email, source, opt_in }`
  to a Supabase `subscribers` table, and a modal gated every store CTA behind a
  name + email form.
- `api/send-install-link.js` — its replacement. Validates an address, asks Brevo to
  send the install link, and **stores nothing**.

Required env var: `BREVO_API_KEY` (optional `MAIL_FROM`, defaults to `info@juttr.cc`).

> **Do not re-add a database write here.** `privacy.html` §3 states that the only
> personal information Juttr holds is the account email and the Pro subscription
> record. Storing install-link addresses would make that false and would undercut
> the Art. 27(2) position. If a list is ever wanted back, update `privacy.html` in
> the same change.

### One-time cleanup in Supabase

The old `subscribers` table may still exist with real rows in it. The Policy now
says no marketing list is held, so drop it:

```sql
drop table if exists public.subscribers;
```

The `profiles` table (accounts + subscription status) **stays** — that is the login
data the Policy describes. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are still
required by `api/check-user.js`.

---

## Environment variables

Vercel → Project → Settings → Environment Variables (set for Production **and** Preview):

| Name | Used by | Purpose |
|------|---------|---------|
| `SUPABASE_URL` | `check-user.js`, `webhook.js` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | same | service_role key — secret, never commit |
| `STRIPE_SECRET_KEY` | checkout, portal, session, status, webhook | `sk_live_…` / `sk_test_…` |
| `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY` | `create-checkout.js` | regular recurring prices |
| `STRIPE_COUPON_MONTHLY` / `STRIPE_COUPON_YEARLY` | `create-checkout.js` | optional intro pricing |
| `STRIPE_WEBHOOK_SECRET` | `webhook.js` | webhook signature verification |
| `LICENSE_SIGNING_PRIVATE_KEY` | `check-user.js` | EC P-256 key, signs the Pro token |
| `BREVO_API_KEY` | `send-install-link.js` | transactional email |
| `MAIL_FROM` | `send-install-link.js` | optional sender, defaults to `info@juttr.cc` |

---

## Replace the handbook PDF

`assets/Juttr-Handbook.pdf` is an interim version. Overwrite the file, keeping the
same filename — the download button already points at it.

---

## Regenerating the screenshots

Captured from the running extension via the scripts in the app repo's `e2e/` folder:

```
npm run dev                       # start the dev server (port 5173)
cd e2e
node capture-screenshots.mjs      # seeds demo data, captures raw PNGs → e2e/shots/raw
node optimize-images.mjs          # PNG → WebP, writes into this site's assets/screens
node build-handbook.mjs           # regenerates the interim handbook PDF
```
