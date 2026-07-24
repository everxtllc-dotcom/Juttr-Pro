# Juttr Website — Deployment Guide

## File Structure
```
juttr-site/
├── index.html              ← Page markup
├── styles.css              ← All styling (self-hosted Geist, teal theme)
├── main.js                 ← Interactions, store-link constant + lead-capture modal
├── api/
│   └── subscribe.js        ← Vercel serverless fn: saves name+email to Supabase
└── assets/
    ├── logo.png            ← Juttr icon
    ├── Juttr-Handbook.pdf  ← Downloadable handbook (interim — replace with the final PDF)
    ├── fonts/
    │   ├── Geist-Variable.woff2
    │   └── GeistMono-Variable.woff2
    └── screens/            ← Real app screenshots (captured live from the extension)
        ├── dark-dashboard.webp   ← hero + showcase
        ├── dark-boards.webp
        ├── dark-tasks.webp
        ├── dark-notes.webp
        ├── dark-focus.webp
        ├── dark-calendar.webp
        ├── dark-analytics.webp
        ├── dark-accounts.webp
        ├── dark-tools.webp
        ├── light-dashboard.webp
        ├── light-notes.webp
        └── og-cover.jpg          ← OpenGraph / social preview (1200×630)
```

The page itself is static (no build step). The one dynamic piece —
`api/subscribe.js` — is a zero-dependency serverless function that Vercel runs
automatically; it just needs the two Supabase env vars (see "Email capture" below).

---

## Option A — Cloudflare Pages (Recommended)

1. Go to https://pages.cloudflare.com and sign in (free account).
2. Click **"Create a project"** → **"Direct Upload"**.
3. Name your project (e.g. `juttr`).
4. Drag the entire `juttr-site/` folder into the upload box.
5. Click **Deploy site**.
6. You'll get a free URL like `juttr.pages.dev` immediately.

**Connect your domain:**
1. In Cloudflare, go to **Custom Domains** on your Pages project.
2. Enter your domain (e.g. `juttr.com`).
3. If your domain is registered via Cloudflare: it auto-configures.
4. If registered elsewhere: add a CNAME record pointing your domain to `juttr.pages.dev`.

---

## Option B — Vercel

1. Go to https://vercel.com and sign in.
2. Click **"Add New Project"** → **"Deploy without Git"** (drag & drop).
3. Drag your `juttr-site/` folder.
4. Click **Deploy**.
5. Go to **Settings → Domains** to connect your custom domain.

---

## Update the Chrome Web Store link (one place)

Open **`main.js`** and edit the single constant at the very top. It now points at
the live listing:
```js
const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/juttr/ekhlnpabcklhbbkilicfeiepcgdiklef';
```
Every "Add to Chrome" / "Chrome Store" button on the page reads from this one value.

---

## Email capture → Supabase (the "Add to Chrome" form)

Every store link first asks for a **name + email** (modal in `index.html`, logic in
`main.js`), saves it, then opens the Chrome Web Store. Saving is done by the
serverless function **`api/subscribe.js`**, which writes one row to a Supabase table.

### 1. Create the Supabase table
In your Supabase project → **SQL editor**, run:
```sql
create table if not exists public.subscribers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name   text,
  email  text not null unique,
  source text,
  opt_in boolean not null default true
);
alter table public.subscribers enable row level security;
-- No policies → only the service_role key (used by api/subscribe.js) can read/write.
```
The `unique` email de-dupes re-submits; RLS with no policies keeps the list private.

### 2. Add the env vars in Vercel
Project → **Settings → Environment Variables** (add for Production **and** Preview):

| Name | Value |
|------|-------|
| `SUPABASE_URL` | your project URL, e.g. `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | the **service_role** key (Project Settings → API) — secret, never commit it |

Redeploy after adding them. Because the site deploys from GitHub, Vercel builds and
runs `api/subscribe.js` automatically — no extra configuration.

### 3. See your subscribers
Supabase → **Table editor → subscribers** (export to CSV anytime, or later connect
an email tool).

> The email capture relies on Vercel serverless functions. If the folder is ever
> hosted somewhere without functions (e.g. plain Cloudflare Pages direct-upload), the
> form fails gracefully — the visitor still reaches the store, the email just isn't saved.

---

## Replace the handbook PDF

The current `assets/Juttr-Handbook.pdf` is an interim version generated from the
handbook text. To swap in your final PDF, just overwrite that file (keep the same
filename) — the download button already points at it.

---

## How to connect to the Chrome Web Store

1. Go to https://chrome.google.com/webstore/devconsole
2. Pay the one-time $5 developer registration fee.
3. Click **"New Item"** and upload your `.zip` extension package.
4. Fill in the store listing:
   - **Name:** Juttr
   - **Short description:** A calm, private, local-first productivity workspace in every new tab.
   - **Description:** (use the content from the handbook)
   - **Screenshots:** Upload the `assets/screens/*.webp` images (Chrome accepts
     1280×800 or 640×400 — re-export from the source PNGs if a specific size is required)
5. Submit for review (usually 1–3 business days).
6. Once approved, copy the listing URL and paste it into `main.js` (see above).

---

## Regenerating the screenshots

The screenshots are captured automatically from the running extension via the
scripts in the app repo's `e2e/` folder:

```
# in E:\Juttr\Juttr - V600
npm run dev                       # start the dev server (port 5173)
cd e2e
node capture-screenshots.mjs      # seeds demo data, captures raw PNGs → e2e/shots/raw
node optimize-images.mjs          # PNG → WebP, writes into this site's assets/screens
node build-handbook.mjs           # regenerates the interim handbook PDF
```
