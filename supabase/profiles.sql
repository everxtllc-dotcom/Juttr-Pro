-- ============================================================================
-- Juttr — public.profiles
-- ----------------------------------------------------------------------------
-- One row per authenticated user (auth.users) holding their billing status.
-- The website (account.html) and the Chrome extension read this via
-- /api/check-user (service-role key, which bypasses RLS). The status is set by
-- Stripe (webhook) OR by a manual 'lifetime' grant + activation key you make in
-- the Supabase dashboard — see the bottom of this file. Access rule:
--   lifetime / active / trialing → Pro;  free (default) / anything else → no Pro.
--
-- Run this once in the Supabase SQL Editor (Dashboard → SQL → New query).
-- It is re-runnable: every statement is `if not exists` / `create or replace`.
-- ============================================================================

create table if not exists public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  email               text,
  stripe_customer_id  text,
  -- 'active' | 'trialing' | 'lifetime' | 'free' | 'canceled' | 'past_due' | null
  subscription_status text        not null default 'free',
  -- End of the current paid period + the plan interval. Kept fresh by the Stripe
  -- webhook (api/webhook.js). Null for lifetime / free — they have no expiry.
  current_period_end  timestamptz,
  plan_interval       text,        -- 'month' | 'year'
  -- Activation secret for manually granted ('lifetime') accounts. See the notes
  -- at the foot of this file. Null for everyone else.
  activation_key      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Add the billing-period columns to tables created before this migration.
alter table public.profiles add column if not exists current_period_end timestamptz;
alter table public.profiles add column if not exists plan_interval text;

-- Registered devices for the Pro seat cap. Each element is
--   { "device_id": "device_…", "last_seen": "2026-08-03T12:00:00.000Z" }
-- Written only by /api/check-user (service role): activation adds/refreshes a
-- device (evicting the least-recently-seen when over the cap); background
-- revalidation refreshes a known device and drops one that has been evicted.
-- This is what stops one paid subscription from unlocking Pro on unlimited PCs
-- or being shared as email + `sub_…` with everyone. See api/check-user.js.
alter table public.profiles add column if not exists devices jsonb not null default '[]'::jsonb;

-- Opt-in marketing consent. Set only when the user ticks the "email me updates" box
-- at sign-up (the box is unticked by default). `marketing_opt_in_at` records WHEN
-- consent was given, which GDPR expects you to be able to show. Users who never
-- sign up are never here at all. Written by the signup trigger below; cleared when
-- a user unsubscribes.
alter table public.profiles add column if not exists marketing_opt_in boolean not null default false;
alter table public.profiles add column if not exists marketing_opt_in_at timestamptz;

-- Activation secret for MANUALLY GRANTED ('lifetime') accounts only.
--
-- Paying customers activate with their Stripe Subscription ID (`sub_…`), which
-- /api/check-user verifies against Stripe. A lifetime grant has no Stripe
-- subscription, so it needs its own proof-of-possession — otherwise the only
-- thing standing between a stranger and a Pro licence would be knowing the
-- grantee's email address. Leave NULL for everyone else.
alter table public.profiles add column if not exists activation_key text;

-- Fast, case-insensitive lookup by email (the /api/check-user query key).
create index if not exists profiles_email_idx on public.profiles (lower(email));

-- ── Row Level Security ──────────────────────────────────────────────────────
-- Enabled so the public anon key can NEVER read another user's billing data.
-- A logged-in user may READ ONLY their own row (auth.uid() = id). Nobody may
-- write through the anon key at all. The service-role key used by
-- /api/check-user bypasses RLS, so the server can look up any profile by email.
alter table public.profiles enable row level security;

drop policy if exists "Profiles are viewable by their owner" on public.profiles;
create policy "Profiles are viewable by their owner"
  on public.profiles for select
  using (auth.uid() = id);

-- ── SECURITY: no client-side writes to profiles, ever ───────────────────────
-- There used to be an UPDATE policy here:
--     using (auth.uid() = id) with check (auth.uid() = id)
-- A WITH CHECK is column-blind — it can say WHICH ROW may be written but not
-- WHICH COLUMNS. Combined with Supabase's default `grant all ... to anon,
-- authenticated` and the anon key published in account.html, any logged-in user
-- could PATCH their own row to subscription_status = 'lifetime' and then have
-- /api/check-user mint them a signed, offline-verifiable Pro licence. That is a
-- complete paywall bypass reachable from the browser console.
--
-- The policy is dropped and the table-level grant revoked. Billing columns are
-- written only by the Stripe webhook (service role). If a user-writable column
-- is ever needed, expose it through a SECURITY DEFINER function that sets every
-- related column coherently — never by re-adding a broad UPDATE policy.
drop policy if exists "Users can update their own profile" on public.profiles;
revoke update, insert, delete on public.profiles from anon, authenticated;

-- ── Auto-create a profile row on signup ─────────────────────────────────────
-- SECURITY DEFINER so the insert runs with owner privileges (bypasses RLS).
-- New users default to 'free'; Stripe (or a manual override) promotes them.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  opt_in boolean := coalesce((new.raw_user_meta_data ->> 'marketing_opt_in')::boolean, false);
begin
  -- Carry the marketing-consent checkbox from sign-up (supabase.auth.signUp passed
  -- it in options.data → raw_user_meta_data). Default false when absent (Google
  -- sign-in, or the box left unticked).
  insert into public.profiles (id, email, marketing_opt_in, marketing_opt_in_at)
  values (new.id, new.email, opt_in, case when opt_in then now() else null end)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Keep updated_at fresh on any change ─────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- Manually grant a comped ('lifetime') account — no Stripe needed
-- ----------------------------------------------------------------------------
-- 1. Supabase Dashboard → Authentication → Users → "Add user":
--      enter the email + a password and tick "Auto Confirm User".
--    That fires the trigger above, creating a profiles row with status 'free'
--    (they can log in, but 'free' does NOT grant Pro).
-- 2. To grant full Pro access, set subscription_status = 'lifetime' AND an
--    activation_key. The key is what the grantee types into the extension in
--    place of a Stripe `sub_…` id — without it they cannot activate, because
--    /api/check-user no longer issues a licence on an email alone.
--
--    From the SQL Editor. This generates the key for you and returns it — copy
--    it from the result, it is not shown again:
--
--       update public.profiles
--          set subscription_status = 'lifetime',
--              activation_key      = 'life_' || replace(gen_random_uuid()::text, '-', '')
--        where email = 'someone@example.com'
--      returning email, activation_key;
--
--    DO NOT invent the key yourself. It is the ONLY credential protecting a free
--    Pro account, so it must be random — a memorable string is guessable, and
--    anyone who guesses it gets Pro. gen_random_uuid() is built into Postgres 13+
--    (no pgcrypto extension needed) and gives 122 bits of randomness.
--
--    Send it to the grantee over a channel you trust, and treat it like a
--    password. To revoke:
--       update public.profiles
--          set subscription_status = 'free', activation_key = null
--        where email = 'someone@example.com';
--    (Leave the row at 'free' with a null key if you only want them to have a
--    login without Pro.)
-- ============================================================================
