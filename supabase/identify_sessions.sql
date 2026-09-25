-- Song identification: one identification a visitor asks for may send the
-- recognition service up to three clips (the start of the song, about 35%
-- and about 65% of it). The clips share a session id, and this table makes
-- sure the daily allowance is charged once per session, however many clips
-- it took. Service role only: the identify function is the one reader and
-- writer.

create table if not exists public.identify_sessions (
  user_id uuid not null references auth.users (id) on delete cascade,
  session text not null,
  attempts integer not null default 0,
  charged boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, session)
);

alter table public.identify_sessions enable row level security;
revoke all on public.identify_sessions from anon, authenticated;

-- One more clip for a session: returns how many clips it has now sent and
-- whether it has already been charged. Sessions older than a day are cleared.
create or replace function public.identify_claim(p_user uuid, p_session text)
returns table (attempts integer, charged boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.identify_sessions s
  where s.user_id = p_user and s.created_at < now() - interval '1 day';
  return query
  insert into public.identify_sessions as s (user_id, session, attempts)
  values (p_user, p_session, 1)
  on conflict (user_id, session) do update set attempts = s.attempts + 1
  returning s.attempts, s.charged;
end;
$$;

-- Marks the session charged; true only for the call that did it, so the
-- allowance goes down once even if two clips answer at the same moment.
create or replace function public.identify_charge(p_user uuid, p_session text)
returns boolean
language sql
security definer
set search_path = public
as $$
  with flipped as (
    update public.identify_sessions
    set charged = true
    where user_id = p_user and session = p_session and not charged
    returning 1
  )
  select exists (select 1 from flipped);
$$;

revoke all on function public.identify_claim(uuid, text) from public, anon, authenticated;
revoke all on function public.identify_charge(uuid, text) from public, anon, authenticated;
grant execute on function public.identify_claim(uuid, text) to service_role;
grant execute on function public.identify_charge(uuid, text) to service_role;
