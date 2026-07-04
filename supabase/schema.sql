-- ════════════════════════════════════════════════════════════
-- Juttr — Supabase schema (run in the SQL editor)
--
-- profiles.is_pro is intentionally a plain boolean that can be
-- toggled by hand in the Supabase dashboard (influencer/manual
-- bypass — no key generator). pro_source records why it was set
-- so Stripe webhooks never clobber manual grants.
-- ════════════════════════════════════════════════════════════

-- ── Profiles: 1 row per auth user ────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  is_pro boolean not null default false,
  pro_source text check (pro_source in ('stripe', 'manual')),
  stripe_customer_id text unique,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ── Devices: max 2 active browser instances per user ─────────
-- Enforced in /api/license (service role); devices idle > 30
-- days are pruned lazily there.
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,          -- extension-generated UUID
  label text,                        -- e.g. "Chrome · Windows"
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, device_id)
);

create index devices_user_idx on public.devices (user_id, last_seen_at desc);

-- ── Row Level Security ────────────────────────────────────────
-- Users can READ their own rows (account page). All writes go
-- through the service role (webhook + /api/license) — clients can
-- never set is_pro themselves. Devices may be deleted by their
-- owner ("sign out other device" on the account page).
alter table public.profiles enable row level security;
alter table public.devices enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "devices_select_own"
  on public.devices for select
  using (auth.uid() = user_id);

create policy "devices_delete_own"
  on public.devices for delete
  using (auth.uid() = user_id);

-- ════════════════════════════════════════════════════════════
-- Dashboard checklist (not SQL):
--  1. Authentication → Providers: enable Google (Google Cloud
--     OAuth client id/secret) and Email (with password recovery).
--  2. Authentication → URL Configuration → Redirect URLs:
--       https://<SITE_DOMAIN>/account.html
--       https://<SITE_DOMAIN>/reset.html
--       https://<SITE_DOMAIN>/login.html
--       https://<EXTENSION_ID>.chromiumapp.org/
--       <PWA origin, if different>
--  3. Manual Pro (influencer): Table editor → profiles →
--     set is_pro = true and pro_source = 'manual'. The extension
--     picks it up at its next revalidation (≤ 24 h).
-- ════════════════════════════════════════════════════════════
