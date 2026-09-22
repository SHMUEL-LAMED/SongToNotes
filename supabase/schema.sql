create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transcriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  source_name text,
  note_count integer not null default 0 check (note_count >= 0),
  duration_seconds double precision not null default 0 check (duration_seconds >= 0),
  bpm double precision not null default 0 check (bpm >= 0),
  key_name text,
  analysis_offset double precision not null default 0,
  raw_notes jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists transcriptions_user_created_idx
  on public.transcriptions (user_id, created_at desc);

create table if not exists public.ringtones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The id the ringtone got on the device that created it, so the same
  -- ringtone is never stored twice when a local history is uploaded later.
  client_id text not null,
  title text not null,
  source_name text,
  start_seconds double precision not null default 0 check (start_seconds >= 0),
  duration_seconds double precision not null default 0 check (duration_seconds >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id)
);

create index if not exists ringtones_user_created_idx
  on public.ringtones (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.transcriptions enable row level security;
alter table public.ringtones enable row level security;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.transcriptions to authenticated;
grant select, insert, update, delete on public.ringtones to authenticated;

create policy "Users can view their own profile"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

create policy "Users can insert their own profile"
on public.profiles for insert to authenticated
with check ((select auth.uid()) = id);

create policy "Users can update their own profile"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "Users can view their own transcriptions"
on public.transcriptions for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert their own transcriptions"
on public.transcriptions for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own transcriptions"
on public.transcriptions for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own transcriptions"
on public.transcriptions for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can view their own ringtones"
on public.ringtones for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert their own ringtones"
on public.ringtones for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own ringtones"
on public.ringtones for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own ringtones"
on public.ringtones for delete to authenticated
using ((select auth.uid()) = user_id);

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger transcriptions_set_updated_at
before update on public.transcriptions
for each row execute function private.set_updated_at();

create trigger ringtones_set_updated_at
before update on public.ringtones
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Everything the tools save that is not a transcription or a ringtone: a
-- karaoke track, a practice version, a piano recording, an analysis, an
-- ear-training session, a metronome preset, a tuner setup. One shape for all
-- of them, with the tool-specific part in jsonb, so a tenth tool adds a kind
-- rather than a table. The audio a tool produced stays on the device that made
-- it (device_id says which); only the record of the work crosses devices.
-- ---------------------------------------------------------------------------

create table if not exists public.works (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The id the work got on the device that created it, so a local history
  -- uploaded after signing in never duplicates what is already here.
  client_id text not null,
  kind text not null check (
    kind in ('notes', 'ringtone', 'vocals', 'speed', 'piano', 'analysis', 'ear', 'metronome', 'tuner', 'transcript')
  ),
  title text not null,
  source_name text,
  -- What the personal area shows on the card: counts, tempo, key, duration.
  summary jsonb not null default '{}'::jsonb,
  -- What the tool needs to open the work again: settings, notes, presets.
  payload jsonb not null default '{}'::jsonb,
  file_name text,
  device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id)
);

create index if not exists works_user_created_idx
  on public.works (user_id, created_at desc);

alter table public.works enable row level security;

grant select, insert, update, delete on public.works to authenticated;

create policy "Users can view their own works"
on public.works for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert their own works"
on public.works for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own works"
on public.works for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own works"
on public.works for delete to authenticated
using ((select auth.uid()) = user_id);

create trigger works_set_updated_at
before update on public.works
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- The files the works produce go up with them, into a private bucket where
-- each visitor's folder is their own user id and the policies let nobody else
-- in. The row remembers the path; the device keeps its own copy as well.
-- ---------------------------------------------------------------------------

alter table public.works add column if not exists file_path text;
alter table public.ringtones add column if not exists file_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('works', 'works', false, 62914560, array['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/flac'])
on conflict (id) do nothing;

create policy "Users can read their own work files"
on storage.objects for select to authenticated
using (bucket_id = 'works' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users can upload their own work files"
on storage.objects for insert to authenticated
with check (bucket_id = 'works' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users can replace their own work files"
on storage.objects for update to authenticated
using (bucket_id = 'works' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'works' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users can delete their own work files"
on storage.objects for delete to authenticated
using (bucket_id = 'works' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- Speech to text runs on the server (supabase/functions/transcribe), against
-- a paid service whose key is a function secret. Each account gets a daily
-- allowance of audio; the function keeps the tally here with the service
-- role, and no policy lets the site read or change it.
-- ---------------------------------------------------------------------------

create table if not exists public.stt_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  seconds integer not null default 0,
  primary key (user_id, day)
);

alter table public.stt_usage enable row level security;

-- The function's settings can live here instead of as function secrets;
-- the private schema is not exposed through the API and only the service
-- role reads the table. Keys: STT_API_KEY, STT_BASE_URL, STT_MODEL,
-- STT_DAILY_SECONDS.
create table if not exists private.stt_settings (
  key text primary key,
  value text not null
);
revoke all on private.stt_settings from anon, authenticated;

-- The private schema is not served by the API, so the function reads the
-- settings through this RPC, which only the service role may call.
create or replace function public.stt_settings()
returns table (key text, value text)
language sql
security definer
set search_path = private
as $$
  select key, value from private.stt_settings;
$$;
revoke all on function public.stt_settings() from public, anon, authenticated;
grant execute on function public.stt_settings() to service_role;

-- ---------------------------------------------------------------------------
-- The other server-side AI work — the language model (supabase/functions/ai)
-- and vocal separation (supabase/functions/separate) — keeps its daily
-- allowances here, one row per account, day and kind ('ai' counts tokens,
-- 'separation' counts songs). Service role only.
-- ---------------------------------------------------------------------------

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  kind text not null,
  amount integer not null default 0,
  primary key (user_id, day, kind)
);

alter table public.ai_usage enable row level security;

-- The functions may also write a setting — the language model they found
-- when the configured one went away — through this, service role only.
create or replace function public.stt_set_setting(setting_key text, setting_value text)
returns void
language sql
security definer
set search_path = private
as $$
  insert into private.stt_settings (key, value) values (setting_key, setting_value)
  on conflict (key) do update set value = excluded.value;
$$;
revoke all on function public.stt_set_setting(text, text) from public, anon, authenticated;
grant execute on function public.stt_set_setting(text, text) to service_role;

-- New tools bring new kinds of work; the check on works.kind grows with them.
alter table public.works drop constraint if exists works_kind_check;
alter table public.works add constraint works_kind_check check (
  kind in ('notes', 'ringtone', 'vocals', 'speed', 'piano', 'analysis', 'ear', 'metronome', 'tuner', 'transcript',
           'chords', 'song', 'convert', 'rhythm', 'mix', 'lyrics', 'tts')
);

-- ---------------------------------------------------------------------------
-- Public share links. A row is a snapshot of one work at the moment it was
-- shared — title, summary, payload and the cloud file's path — under a
-- random token. Only the share function reads it (service role); the owner
-- lists and revokes their own links through RLS.
-- ---------------------------------------------------------------------------

create table if not exists public.shares (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  origin text not null default 'works',
  work_id text not null,
  kind text not null,
  title text not null,
  summary jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  file_path text,
  file_name text,
  views integer not null default 0,
  created_at timestamptz not null default now(),
  -- When set, the link stops working on its own; the owner chooses this in
  -- the personal area and can move it or take it away again.
  expires_at timestamptz,
  revoked_at timestamptz,
  unique (user_id, origin, work_id)
);

alter table public.shares add column if not exists expires_at timestamptz;

alter table public.shares enable row level security;

create policy "Users can see their own share links"
on public.shares for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can revoke their own share links"
on public.shares for delete to authenticated
using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- The assistant's conversations. Each one is a thread the visitor can come
-- back to, rename or delete; the messages themselves are a jsonb array, so a
-- conversation is one row and one round trip. A conversation made without an
-- account lives in the browser and is uploaded on the first sign-in, exactly
-- like the works above.
-- ---------------------------------------------------------------------------

create table if not exists public.assistant_chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The id the conversation got in the browser that started it.
  client_id text not null,
  title text not null default 'שיחה חדשה',
  -- [{ role, content, hidden?, actions? }], oldest first.
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id)
);

create index if not exists assistant_chats_user_updated_idx
  on public.assistant_chats (user_id, updated_at desc);

alter table public.assistant_chats enable row level security;

grant select, insert, update, delete on public.assistant_chats to authenticated;

create policy "Users can view their own chats"
on public.assistant_chats for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert their own chats"
on public.assistant_chats for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own chats"
on public.assistant_chats for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own chats"
on public.assistant_chats for delete to authenticated
using ((select auth.uid()) = user_id);

create trigger assistant_chats_set_updated_at
before update on public.assistant_chats
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- The admin area (`#/admin`). One account — the address in the `ADMIN_EMAILS`
-- secret of `supabase/functions/admin` — sees the whole site: accounts, saved
-- work, daily allowances, share links and the cloud folder. The site itself
-- never gets that reach: every figure comes from the admin function with the
-- service role, after it has checked the caller's verified address, so the
-- policies above keep holding for everybody, the admin included.
--
-- Nothing here is readable through the API. The two functions and the log are
-- granted to the service role alone.
-- ---------------------------------------------------------------------------

create table if not exists public.admin_audit (
  id bigint generated always as identity primary key,
  actor_email text not null,
  action text not null,
  target text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.admin_audit enable row level security;
-- No policy on purpose: with RLS on and nothing granted, only the service
-- role — that is, the admin function — writes and reads the log.
revoke all on public.admin_audit from anon, authenticated;

create index if not exists admin_audit_created_idx on public.admin_audit (created_at desc);

-- How much room each account takes in the private bucket. Listing the bucket
-- folder by folder would be one request per account; this is one query.
create or replace function public.admin_storage_usage()
returns table (user_id text, files bigint, bytes bigint)
language sql
security definer
set search_path = ''
as $$
  select
    (storage.foldername(o.name))[1] as user_id,
    count(*)::bigint as files,
    coalesce(sum(coalesce((o.metadata ->> 'size')::bigint, 0)), 0)::bigint as bytes
  from storage.objects o
  where o.bucket_id = 'works'
  group by 1;
$$;
revoke all on function public.admin_storage_usage() from public, anon, authenticated;
grant execute on function public.admin_storage_usage() to service_role;

-- The counterpart of stt_set_setting: the admin area can clear a setting it
-- put in, so a key that was replaced does not linger in the database.
create or replace function public.stt_delete_setting(setting_key text)
returns void
language sql
security definer
set search_path = private
as $$
  delete from private.stt_settings where key = setting_key;
$$;
revoke all on function public.stt_delete_setting(text) from public, anon, authenticated;
grant execute on function public.stt_delete_setting(text) to service_role;

-- ---------------------------------------------------------------------------
-- What the site measures about itself — and what it refuses to measure.
--
-- A row says that some browser opened a tool, how long it stayed, whether the
-- work finished or failed, and on what kind of device. It does NOT say who:
-- there is no user id here, no title, no file name, no text. `visitor` is a
-- random number the browser keeps for a month so "new or returning" can be
-- counted; it points at nothing and nobody, and the visitor can switch it off
-- entirely from the personal area.
--
-- Anyone may insert (that is the whole point — the site writes as it is used),
-- and nobody may read: there is no select policy, so only the admin function,
-- with the service role, ever sees it.
-- ---------------------------------------------------------------------------

create table if not exists public.site_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- The day and hour as the visitor experienced them, so "when do people work"
  -- is answered in their time, not the server's.
  day date not null,
  hour smallint not null check (hour between 0 and 23),
  weekday smallint not null check (weekday between 0 and 6),
  -- view: the tool was opened · input: something was fed to it · result: it
  -- produced something · error: it failed · leave: how long the visit lasted.
  kind text not null check (kind in ('view', 'input', 'result', 'error', 'leave')),
  tool text not null,
  -- Seconds on the tool (leave) or seconds the work took (result).
  seconds integer not null default 0 check (seconds >= 0),
  -- A short label: an error code, a provider name. Never anything a person typed.
  detail text,
  device text check (device in ('phone', 'tablet', 'desktop')),
  browser text,
  os text,
  language text,
  -- The host a visitor arrived from, never the full address.
  referrer text,
  visitor text,
  signed_in boolean not null default false
);

create index if not exists site_events_at_idx on public.site_events (at desc);
create index if not exists site_events_day_idx on public.site_events (day, tool);

alter table public.site_events enable row level security;

grant insert on public.site_events to anon, authenticated;

create policy "Anyone may record an anonymous event"
on public.site_events for insert to anon, authenticated
with check (
  kind in ('view', 'input', 'result', 'error', 'leave')
  and length(tool) <= 40
  and seconds between 0 and 86400
  and (detail is null or length(detail) <= 60)
  and (visitor is null or length(visitor) <= 24)
);
-- No select, update or delete policy on purpose: the rows go in and only the
-- admin function, with the service role, ever reads them.

-- Old rows are of no use to anybody; the admin area clears them on request.
create or replace function public.admin_prune_events(older_than_days integer)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed bigint;
begin
  delete from public.site_events
  where at < now() - make_interval(days => greatest(30, older_than_days));
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.admin_prune_events(integer) from public, anon, authenticated;
grant execute on function public.admin_prune_events(integer) to service_role;

-- ---------------------------------------------------------------------------
-- The switches the admin area throws: a notice for everybody, a closed sign,
-- and the ability to turn one tool off when its service is broken. One row,
-- readable by the whole site (it is public by nature) and writable only by
-- the admin function.
-- ---------------------------------------------------------------------------

create table if not exists public.site_control (
  id boolean primary key default true check (id),
  maintenance boolean not null default false,
  maintenance_message text,
  banner text,
  banner_kind text not null default 'info' check (banner_kind in ('info', 'warn', 'good')),
  disabled_tools text[] not null default '{}',
  updated_at timestamptz not null default now()
);

insert into public.site_control (id) values (true) on conflict (id) do nothing;

alter table public.site_control enable row level security;

grant select on public.site_control to anon, authenticated;

create policy "Everybody reads the site's notices"
on public.site_control for select to anon, authenticated
using (true);
-- Writing is the service role's alone, through the admin function.
