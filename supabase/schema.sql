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
