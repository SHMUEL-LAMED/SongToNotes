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

alter table public.profiles enable row level security;
alter table public.transcriptions enable row level security;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.transcriptions to authenticated;

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
