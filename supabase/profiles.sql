-- ============================================================================
-- Juttr — public.profiles
-- ----------------------------------------------------------------------------
-- One row per authenticated user (auth.users) holding their billing status.
-- The website (account.html) and the Chrome extension read this via
-- /api/check-user (service-role key, which bypasses RLS). The status is set by
-- Stripe (webhook) OR by a manual 'lifetime' grant you make in the Supabase
-- dashboard — see the bottom of this file. Access rule:
--   lifetime / active / trialing → Pro;  free (default) / anything else → no Pro.
--
-- Run this once in the Supabase SQL Editor (Dashboard → SQL → New query).
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
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Add the billing-period columns to tables created before this migration.
alter table public.profiles add column if not exists current_period_end timestamptz;
alter table public.profiles add column if not exists plan_interval text;

-- Fast, case-insensitive lookup by email (the /api/check-user query key).
create index if not exists profiles_email_idx on public.profiles (lower(email));

-- ── Row Level Security ──────────────────────────────────────────────────────
-- Enabled so the public anon key can NEVER read another user's billing data.
-- A logged-in user may read/update ONLY their own row (auth.uid() = id). The
-- service-role key used by /api/check-user bypasses RLS, so the server can look
-- up any profile by email.
alter table public.profiles enable row level security;

drop policy if exists "Profiles are viewable by their owner" on public.profiles;
create policy "Profiles are viewable by their owner"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ── Auto-create a profile row on signup ─────────────────────────────────────
-- SECURITY DEFINER so the insert runs with owner privileges (bypasses RLS).
-- New users default to 'free'; Stripe (or a manual override) promotes them.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
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
-- 2. To grant full Pro access, Dashboard → Table Editor → profiles → edit that
--    user's row → set subscription_status to 'lifetime'. This returns
--    active:true from /api/check-user with NO Stripe subscription attached.
--    (Leave it 'free' if you only want them to have a login without Pro.)
--
-- Or do step 2 from the SQL Editor:
--    update public.profiles
--       set subscription_status = 'lifetime'
--     where email = 'someone@example.com';
-- ============================================================================
