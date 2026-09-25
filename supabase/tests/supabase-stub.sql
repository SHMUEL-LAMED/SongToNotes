-- ---------------------------------------------------------------------------
-- The little of Supabase that supabase/credits.sql relies on, for testing it
-- on a scratch Postgres (never on the project's database). See
-- supabase/tests/credits-passes.sql for how to run it.
-- ---------------------------------------------------------------------------
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin; end if; end $$;
create schema extensions;
create extension pgcrypto with schema extensions;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz not null default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.profiles (id uuid primary key references auth.users (id) on delete cascade, full_name text);
