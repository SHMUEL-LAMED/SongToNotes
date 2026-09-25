-- ---------------------------------------------------------------------------
-- Credits and the personal invite link.
--
-- The tools that run in the browser cost the site nothing and stay free. The
-- ones that run on the site's servers — transcription, synced lyrics, the
-- assistant and the other language-model work, an MP3 from text, AI vocal
-- separation and song identification — are paid for in credits:
--
--   * Every account gets a small allowance each day (`daily`), renewed at
--     midnight Israel time. What is not used that day does not carry over.
--   * Every account has a private link (`code`). A first visit through it
--     earns its owner a little (`visit_bonus`, at most `visit_daily_max` a
--     day); a friend who opens an account through it earns much more
--     (`signup_bonus` at once, and `friend_daily` more every day for good, up
--     to `friend_daily_max`), and the friend is welcomed with `welcome_bonus`.
--   * Earned credits (`bonus`) never expire. The day's allowance is spent
--     first, the bonus after it.
--
-- The server functions charge through credit_spend() before they call a paid
-- service and hand the credits back through credit_refund() when the service
-- fails, so nobody pays for an error. The tables are service-role only; an
-- account reads its own position through credit_status(), and the numbers the
-- whole site runs on sit in credit_settings, which anybody may read (the
-- explanation page shows them) and only the admin function may change.
--
-- Nothing here identifies a visitor: a visit is kept as a salted hash of the
-- browser's random id and of its address, only so one person is counted once.
-- ---------------------------------------------------------------------------

create schema if not exists private;

-- ---------------------------------------------------------------- settings

create table if not exists public.credit_settings (
  id boolean primary key default true check (id),
  -- Off: nothing is charged or refused — the site behaves as it did before credits.
  enabled boolean not null default true,
  daily integer not null default 20 check (daily between 0 and 100000),
  signup_bonus integer not null default 50 check (signup_bonus between 0 and 100000),
  friend_daily integer not null default 5 check (friend_daily between 0 and 10000),
  friend_daily_max integer not null default 100 check (friend_daily_max between 0 and 100000),
  welcome_bonus integer not null default 10 check (welcome_bonus between 0 and 100000),
  visit_bonus integer not null default 1 check (visit_bonus between 0 and 10000),
  visit_daily_max integer not null default 10 check (visit_daily_max between 0 and 10000),
  -- A guard against accounts opened only to farm the bonus.
  signup_daily_max integer not null default 10 check (signup_daily_max between 0 and 10000),
  -- How long a new account may still say which friend brought it.
  claim_hours integer not null default 72 check (claim_hours between 1 and 8760),
  -- assistant: a message to the assistant · text: every 10,000 characters of
  -- language-model text work · minute: a minute of transcription or synced
  -- lyrics · tts: every 1,000 characters read into an MP3 · separate: one AI
  -- vocal separation · identify: one song identification.
  prices jsonb not null default '{"assistant": 1, "text": 2, "minute": 1, "tts": 1, "separate": 5, "identify": 2}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.credit_settings (id) values (true) on conflict (id) do nothing;

alter table public.credit_settings enable row level security;
revoke all on public.credit_settings from anon, authenticated;
grant select on public.credit_settings to anon, authenticated;

drop policy if exists "Everybody reads the credit rules" on public.credit_settings;
create policy "Everybody reads the credit rules"
on public.credit_settings for select to anon, authenticated
using (true);

-- ---------------------------------------------------------------- accounts

create table if not exists public.credit_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- The private link: <site>/?ref=<code>.
  code text not null unique,
  -- Earned credits; they never expire.
  bonus integer not null default 0 check (bonus >= 0),
  -- Friends who opened an account through the link. It never goes down, so a
  -- friend who later deletes their account does not take the reward back.
  friends integer not null default 0 check (friends >= 0),
  referred_by uuid references auth.users (id) on delete set null,
  referred_at timestamptz,
  -- Salted hashes of the addresses this account was last seen from, so the
  -- owner opening their own link does not count as somebody new.
  own_ips text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists credit_accounts_referred_by_idx on public.credit_accounts (referred_by);

-- What each account took from its allowance, per day (Israel time).
create table if not exists public.credit_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  spent integer not null default 0 check (spent >= 0),
  primary key (user_id, day)
);

-- Every credit that came or went, for the history on the credits page.
create table if not exists public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now(),
  day date not null,
  -- spend: an action was paid for · refund: a failed action gave it back ·
  -- visit, signup: the link brought somebody · welcome: joined through a
  -- friend's link · grant: the site's owner gave credits.
  kind text not null check (kind in ('spend', 'refund', 'visit', 'signup', 'welcome', 'grant')),
  -- What was paid for: assistant, text, transcript, lyrics, tts, separate, identify.
  action text,
  delta integer not null,
  from_daily integer not null default 0,
  from_bonus integer not null default 0,
  detail jsonb not null default '{}'::jsonb,
  refunded boolean not null default false
);

create index if not exists credit_ledger_user_at_idx on public.credit_ledger (user_id, at desc);
create index if not exists credit_ledger_day_idx on public.credit_ledger (day, kind);

-- One row per person who opened somebody's link.
create table if not exists public.referral_visits (
  referrer uuid not null references auth.users (id) on delete cascade,
  visitor text not null,
  ip text,
  day date not null,
  rewarded boolean not null default false,
  at timestamptz not null default now(),
  primary key (referrer, visitor)
);

create index if not exists referral_visits_referrer_ip_idx on public.referral_visits (referrer, ip);
create index if not exists referral_visits_referrer_day_idx on public.referral_visits (referrer, day);
create index if not exists referral_visits_ip_day_idx on public.referral_visits (ip, day);

alter table public.credit_accounts enable row level security;
alter table public.credit_days enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.referral_visits enable row level security;
-- No policies on purpose: only the functions below and the service role touch them.
revoke all on public.credit_accounts from anon, authenticated;
revoke all on public.credit_days from anon, authenticated;
revoke all on public.credit_ledger from anon, authenticated;
revoke all on public.referral_visits from anon, authenticated;

-- The salt the hashes are made with; drawn once, readable by nobody but the owner.
create table if not exists private.credit_secret (
  id boolean primary key default true check (id),
  salt text not null
);
insert into private.credit_secret (id, salt)
values (true, encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (id) do nothing;
revoke all on private.credit_secret from public, anon, authenticated;

-- ---------------------------------------------------------------- helpers

-- The credits day is Israel's: the allowance renews at midnight there.
create or replace function private.credit_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Jerusalem')::date;
$$;

create or replace function private.credit_resets_at()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select ((private.credit_today() + 1)::timestamp at time zone 'Asia/Jerusalem');
$$;

create or replace function private.credit_config()
returns public.credit_settings
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.credit_settings where id limit 1;
$$;

-- Eight letters and digits, without the ones that are easy to misread (0 o 1 l i).
create or replace function private.credit_new_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_bytes bytea := extensions.gen_random_bytes(8);
  v_code text := '';
begin
  for v_index in 0..7 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, v_index) % length(v_alphabet)) + 1, 1);
  end loop;
  return v_code;
end;
$$;

-- The account's row, made on first use.
create or replace function private.credit_account(p_user uuid)
returns public.credit_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.credit_accounts;
begin
  select * into v_row from public.credit_accounts where user_id = p_user;
  if found then
    return v_row;
  end if;
  for v_attempt in 1..5 loop
    begin
      insert into public.credit_accounts (user_id, code)
      values (p_user, private.credit_new_code())
      on conflict (user_id) do nothing;
      exit;
    exception when unique_violation then
      -- The code was already somebody's (about one in a hundred billion): draw again.
      null;
    end;
  end loop;
  select * into v_row from public.credit_accounts where user_id = p_user;
  return v_row;
end;
$$;

create or replace function private.credit_allowance(p_friends integer, p_config public.credit_settings)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_config.daily, 0)
    + least(greatest(coalesce(p_friends, 0), 0) * coalesce(p_config.friend_daily, 0), coalesce(p_config.friend_daily_max, 0));
$$;

-- A salted hash, so the same value is recognised without being kept.
create or replace function private.credit_hash(p_kind text, p_value text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when nullif(trim(coalesce(p_value, '')), '') is null then null
    else left(encode(extensions.digest((select salt from private.credit_secret limit 1) || ':' || p_kind || ':' || trim(p_value), 'sha256'), 'hex'), 32)
  end;
$$;

-- The caller's address, as the API gateway passes it on, hashed.
create or replace function private.credit_request_ip()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_headers jsonb;
begin
  begin
    v_headers := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  exception when others then
    return null;
  end;
  return private.credit_hash('ip', coalesce(
    nullif(v_headers ->> 'cf-connecting-ip', ''),
    nullif(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1), ''),
    nullif(v_headers ->> 'x-real-ip', '')
  ));
end;
$$;

-- Where an account stands right now.
create or replace function private.credit_balance(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_config public.credit_settings := private.credit_config();
  v_account public.credit_accounts;
  v_spent integer;
  v_allowance integer;
begin
  select * into v_account from public.credit_accounts where user_id = p_user;
  select coalesce((select d.spent from public.credit_days d where d.user_id = p_user and d.day = private.credit_today()), 0)
  into v_spent;
  v_allowance := private.credit_allowance(v_account.friends, v_config);
  return jsonb_build_object(
    'enabled', coalesce(v_config.enabled, false),
    'allowance', v_allowance,
    'daily_left', greatest(v_allowance - v_spent, 0),
    'bonus', coalesce(v_account.bonus, 0),
    'resets_at', private.credit_resets_at()
  );
end;
$$;

revoke all on function private.credit_today() from public, anon, authenticated;
revoke all on function private.credit_resets_at() from public, anon, authenticated;
revoke all on function private.credit_config() from public, anon, authenticated;
revoke all on function private.credit_new_code() from public, anon, authenticated;
revoke all on function private.credit_account(uuid) from public, anon, authenticated;
revoke all on function private.credit_allowance(integer, public.credit_settings) from public, anon, authenticated;
revoke all on function private.credit_hash(text, text) from public, anon, authenticated;
revoke all on function private.credit_request_ip() from public, anon, authenticated;
revoke all on function private.credit_balance(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- the site

-- The signed-in visitor's credits, link, friends and recent history.
create or replace function public.credit_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_config public.credit_settings := private.credit_config();
  v_account public.credit_accounts;
  v_today date := private.credit_today();
  v_spent integer;
  v_allowance integer;
  v_created timestamptz;
  v_ip text;
begin
  if v_user is null then
    return null;
  end if;
  v_account := private.credit_account(v_user);

  -- Remember where the owner is, so their own visits to their link are not counted.
  v_ip := private.credit_request_ip();
  if v_ip is not null and not (v_ip = any (v_account.own_ips)) then
    update public.credit_accounts
    set own_ips = (array[v_ip] || own_ips)[1:5]
    where user_id = v_user;
  end if;

  select coalesce((select d.spent from public.credit_days d where d.user_id = v_user and d.day = v_today), 0)
  into v_spent;
  v_allowance := private.credit_allowance(v_account.friends, v_config);
  select u.created_at into v_created from auth.users u where u.id = v_user;

  return jsonb_build_object(
    'enabled', coalesce(v_config.enabled, false),
    'code', v_account.code,
    'allowance', v_allowance,
    'daily_left', greatest(v_allowance - v_spent, 0),
    'spent_today', v_spent,
    'bonus', v_account.bonus,
    'friends', v_account.friends,
    'visits', (select count(*) from public.referral_visits v where v.referrer = v_user),
    'visits_rewarded_today', (select count(*) from public.referral_visits v where v.referrer = v_user and v.day = v_today and v.rewarded),
    'earned', (select coalesce(sum(l.delta), 0) from public.credit_ledger l where l.user_id = v_user and l.kind in ('visit', 'signup', 'welcome', 'grant')),
    'referred', v_account.referred_by is not null,
    'can_claim', v_account.referred_by is null
      and v_created is not null
      and v_created > now() - make_interval(hours => coalesce(v_config.claim_hours, 72)),
    'resets_at', private.credit_resets_at(),
    'history', (
      select coalesce(jsonb_agg(to_jsonb(h) order by h.at desc, h.id desc), '[]'::jsonb)
      from (
        select l.id, l.at, l.kind, l.action, l.delta, l.detail, l.refunded
        from public.credit_ledger l
        where l.user_id = v_user
        order by l.at desc, l.id desc
        limit 40
      ) h
    ),
    'config', to_jsonb(v_config) - 'id' - 'updated_at'
  );
end;
$$;

revoke all on function public.credit_status() from public, anon, authenticated;
grant execute on function public.credit_status() to authenticated;

-- Somebody opened a link. Counted once per browser and once per address for
-- each link; rewarded within the day's ceiling. Anyone may call it.
create or replace function public.credit_visit(p_code text, p_visitor text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.credit_settings := private.credit_config();
  v_code text := lower(trim(coalesce(p_code, '')));
  v_referrer uuid;
  v_own_ips text[];
  v_name text;
  v_visitor text;
  v_ip text;
  v_today date := private.credit_today();
  v_inserted integer;
  v_rewarded boolean := false;
begin
  if v_code !~ '^[a-z0-9]{6,16}$' or coalesce(p_visitor, '') !~ '^[A-Za-z0-9-]{8,64}$' then
    return jsonb_build_object('ok', false);
  end if;

  select a.user_id, a.own_ips into v_referrer, v_own_ips
  from public.credit_accounts a where a.code = v_code;
  if v_referrer is null then
    return jsonb_build_object('ok', false);
  end if;
  -- The first name only, for "an invitation from …".
  select nullif(split_part(trim(coalesce(p.full_name, '')), ' ', 1), '') into v_name
  from public.profiles p where p.id = v_referrer;

  v_ip := private.credit_request_ip();
  if auth.uid() = v_referrer or (v_ip is not null and v_ip = any (v_own_ips)) then
    return jsonb_build_object('ok', true, 'self', true, 'name', v_name);
  end if;

  -- One address sending dozens of "new people" a day is not people.
  if v_ip is not null
     and (select count(*) from public.referral_visits v where v.ip = v_ip and v.day = v_today) >= 30 then
    return jsonb_build_object('ok', true, 'name', v_name, 'counted', false);
  end if;

  v_visitor := private.credit_hash('visitor', p_visitor);
  insert into public.referral_visits (referrer, visitor, ip, day)
  values (v_referrer, v_visitor, v_ip, v_today)
  on conflict (referrer, visitor) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('ok', true, 'name', v_name, 'counted', false);
  end if;

  if coalesce(v_config.enabled, false)
     and coalesce(v_config.visit_bonus, 0) > 0
     and (v_ip is null or not exists (
       select 1 from public.referral_visits v
       where v.referrer = v_referrer and v.ip = v_ip and v.visitor <> v_visitor
     ))
     and (select count(*) from public.referral_visits v
          where v.referrer = v_referrer and v.day = v_today and v.rewarded) < coalesce(v_config.visit_daily_max, 0)
  then
    update public.referral_visits set rewarded = true
    where referrer = v_referrer and visitor = v_visitor;
    update public.credit_accounts set bonus = bonus + v_config.visit_bonus
    where user_id = v_referrer;
    insert into public.credit_ledger (user_id, day, kind, delta)
    values (v_referrer, v_today, 'visit', v_config.visit_bonus);
    v_rewarded := true;
  end if;

  return jsonb_build_object('ok', true, 'name', v_name, 'counted', true, 'rewarded', v_rewarded);
end;
$$;

revoke all on function public.credit_visit(text, text) from public, anon, authenticated;
grant execute on function public.credit_visit(text, text) to anon, authenticated;

-- A new account says which friend's link brought it: the friend is rewarded
-- and the newcomer welcomed. Only within `claim_hours` of opening the account,
-- only once, and never one's own code.
create or replace function public.credit_claim(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_config public.credit_settings := private.credit_config();
  v_code text := lower(trim(coalesce(p_code, '')));
  v_referrer uuid;
  v_account public.credit_accounts;
  v_created timestamptz;
  v_today date := private.credit_today();
  v_name text;
  v_on boolean := coalesce(v_config.enabled, false);
  v_welcome integer := 0;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'signed_out');
  end if;
  if v_code !~ '^[a-z0-9]{6,16}$' then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  select a.user_id into v_referrer from public.credit_accounts a where a.code = v_code;
  if v_referrer is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  if v_referrer = v_user then
    return jsonb_build_object('ok', false, 'reason', 'self');
  end if;

  perform private.credit_account(v_user);
  -- Both rows, always in the same order, so two claims never wait on each other.
  perform 1 from public.credit_accounts a
  where a.user_id in (v_user, v_referrer)
  order by a.user_id
  for update;

  select * into v_account from public.credit_accounts where user_id = v_user;
  if v_account.referred_by is not null then
    return jsonb_build_object('ok', false, 'reason', 'already');
  end if;
  select u.created_at into v_created from auth.users u where u.id = v_user;
  if v_created is null or v_created < now() - make_interval(hours => coalesce(v_config.claim_hours, 72)) then
    return jsonb_build_object('ok', false, 'reason', 'too_late');
  end if;
  -- Two new accounts cannot each be the other's friend.
  if exists (select 1 from public.credit_accounts a where a.user_id = v_referrer and a.referred_by = v_user) then
    return jsonb_build_object('ok', false, 'reason', 'loop');
  end if;

  select nullif(split_part(trim(coalesce(p.full_name, '')), ' ', 1), '') into v_name
  from public.profiles p where p.id = v_referrer;

  update public.credit_accounts set referred_by = v_referrer, referred_at = now()
  where user_id = v_user;

  if v_on and coalesce(v_config.welcome_bonus, 0) > 0 then
    v_welcome := v_config.welcome_bonus;
    update public.credit_accounts set bonus = bonus + v_welcome where user_id = v_user;
    insert into public.credit_ledger (user_id, day, kind, delta, detail)
    values (v_user, v_today, 'welcome', v_welcome, jsonb_build_object('from', coalesce(v_name, '')));
  end if;

  update public.credit_accounts set friends = friends + 1 where user_id = v_referrer;
  if v_on
     and coalesce(v_config.signup_bonus, 0) > 0
     and (select count(*) from public.credit_ledger l
          where l.user_id = v_referrer and l.kind = 'signup' and l.day = v_today) < coalesce(v_config.signup_daily_max, 0)
  then
    update public.credit_accounts set bonus = bonus + v_config.signup_bonus where user_id = v_referrer;
    insert into public.credit_ledger (user_id, day, kind, delta)
    values (v_referrer, v_today, 'signup', v_config.signup_bonus);
  end if;

  return jsonb_build_object('ok', true, 'welcome', v_welcome, 'name', v_name);
end;
$$;

revoke all on function public.credit_claim(text) from public, anon, authenticated;
grant execute on function public.credit_claim(text) to authenticated;

-- ---------------------------------------------------------------- the server

-- Takes `p_units` × the price of `p_price` from the account: the day's
-- allowance first, then the bonus. Refuses (ok: false) when there is not
-- enough, unless `p_force` — the site's owner is never refused, and is charged
-- whatever there is. Returns the ledger entry, to refund if the work fails.
create or replace function public.credit_spend(
  p_user uuid,
  p_action text,
  p_price text,
  p_units integer,
  p_detail jsonb default '{}'::jsonb,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.credit_settings := private.credit_config();
  v_today date := private.credit_today();
  v_price integer;
  v_amount integer;
  v_account public.credit_accounts;
  v_spent integer;
  v_allowance integer;
  v_daily_left integer;
  v_take_daily integer;
  v_take_bonus integer;
  v_entry bigint;
begin
  if not coalesce(v_config.enabled, false) then
    return jsonb_build_object('ok', true, 'enabled', false, 'charged', 0);
  end if;
  begin
    v_price := greatest(0, coalesce((v_config.prices ->> p_price)::integer, 0));
  exception when others then
    v_price := 0;
  end;
  v_amount := v_price * greatest(coalesce(p_units, 0), 0);
  if v_amount <= 0 then
    return private.credit_balance(p_user) || jsonb_build_object('ok', true, 'charged', 0);
  end if;

  perform private.credit_account(p_user);
  select * into v_account from public.credit_accounts where user_id = p_user for update;
  insert into public.credit_days (user_id, day) values (p_user, v_today) on conflict do nothing;
  select d.spent into v_spent from public.credit_days d where d.user_id = p_user and d.day = v_today for update;

  v_allowance := private.credit_allowance(v_account.friends, v_config);
  v_daily_left := greatest(v_allowance - v_spent, 0);
  if v_daily_left + v_account.bonus < v_amount and not coalesce(p_force, false) then
    return jsonb_build_object(
      'ok', false,
      'enabled', true,
      'needed', v_amount,
      'daily_left', v_daily_left,
      'bonus', v_account.bonus,
      'allowance', v_allowance,
      'resets_at', private.credit_resets_at()
    );
  end if;

  v_take_daily := least(v_amount, v_daily_left);
  v_take_bonus := least(v_amount - v_take_daily, v_account.bonus);
  if v_take_daily > 0 then
    update public.credit_days set spent = spent + v_take_daily where user_id = p_user and day = v_today;
  end if;
  if v_take_bonus > 0 then
    update public.credit_accounts set bonus = bonus - v_take_bonus where user_id = p_user;
  end if;
  if v_take_daily + v_take_bonus > 0 then
    insert into public.credit_ledger (user_id, day, kind, action, delta, from_daily, from_bonus, detail)
    values (
      p_user, v_today, 'spend', left(coalesce(p_action, p_price), 30),
      -(v_take_daily + v_take_bonus), v_take_daily, v_take_bonus,
      coalesce(p_detail, '{}'::jsonb)
    )
    returning id into v_entry;
  end if;

  return jsonb_build_object(
    'ok', true,
    'enabled', true,
    'entry', v_entry,
    'charged', v_take_daily + v_take_bonus,
    'daily_left', v_daily_left - v_take_daily,
    'bonus', v_account.bonus - v_take_bonus,
    'allowance', v_allowance,
    'resets_at', private.credit_resets_at()
  );
end;
$$;

-- Gives back what one spend took, once. The day's part comes back only while
-- it is still that day — after midnight the allowance is whole again anyway.
create or replace function public.credit_refund(p_user uuid, p_entry bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := private.credit_today();
  v_day date;
  v_action text;
  v_daily integer;
  v_bonus integer;
  v_back integer;
begin
  update public.credit_ledger
  set refunded = true
  where id = p_entry and user_id = p_user and kind = 'spend' and not refunded
  returning day, action, from_daily, from_bonus into v_day, v_action, v_daily, v_bonus;
  if not found then
    return jsonb_build_object('ok', false);
  end if;

  perform 1 from public.credit_accounts where user_id = p_user for update;
  v_back := v_bonus;
  if v_day = v_today and v_daily > 0 then
    update public.credit_days set spent = greatest(spent - v_daily, 0) where user_id = p_user and day = v_today;
    v_back := v_back + v_daily;
  end if;
  if v_bonus > 0 then
    update public.credit_accounts set bonus = bonus + v_bonus where user_id = p_user;
  end if;
  insert into public.credit_ledger (user_id, day, kind, action, delta, detail)
  values (p_user, v_today, 'refund', v_action, v_back, jsonb_build_object('entry', p_entry));

  return private.credit_balance(p_user) || jsonb_build_object('ok', true, 'refunded', v_back);
end;
$$;

-- Adds to what an entry remembers — the job a separation started, say.
create or replace function public.credit_note(p_entry bigint, p_detail jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.credit_ledger set detail = detail || coalesce(p_detail, '{}'::jsonb) where id = p_entry;
$$;

-- The refund for a job that failed after it started (a separation, polled later).
create or replace function public.credit_refund_job(p_user uuid, p_job text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry bigint;
begin
  select l.id into v_entry
  from public.credit_ledger l
  where l.user_id = p_user and l.kind = 'spend' and not l.refunded and l.detail ->> 'job' = p_job
  order by l.id desc
  limit 1;
  if v_entry is null then
    return jsonb_build_object('ok', false);
  end if;
  return public.credit_refund(p_user, v_entry);
end;
$$;

revoke all on function public.credit_spend(uuid, text, text, integer, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.credit_refund(uuid, bigint) from public, anon, authenticated;
revoke all on function public.credit_note(bigint, jsonb) from public, anon, authenticated;
revoke all on function public.credit_refund_job(uuid, text) from public, anon, authenticated;
grant execute on function public.credit_spend(uuid, text, text, integer, jsonb, boolean) to service_role;
grant execute on function public.credit_refund(uuid, bigint) to service_role;
grant execute on function public.credit_note(bigint, jsonb) to service_role;
grant execute on function public.credit_refund_job(uuid, text) to service_role;

-- ---------------------------------------------------------------- the admin area

-- Totals only: how the credits move across the site, never whose they are.
create or replace function public.admin_credit_stats(p_since date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'accounts', (select count(*) from public.credit_accounts),
    'referred', (select count(*) from public.credit_accounts a where a.referred_at >= p_since),
    'referred_total', (select count(*) from public.credit_accounts a where a.referred_by is not null),
    'visits', (select count(*) from public.referral_visits v where v.day >= p_since),
    'visits_rewarded', (select count(*) from public.referral_visits v where v.day >= p_since and v.rewarded),
    'bonus_outstanding', (select coalesce(sum(a.bonus), 0) from public.credit_accounts a),
    'spent_today', (
      select coalesce(-sum(l.delta), 0) from public.credit_ledger l
      where l.kind = 'spend' and not l.refunded and l.day = private.credit_today()
    ),
    'spent', (
      select coalesce(-sum(l.delta), 0) from public.credit_ledger l
      where l.kind = 'spend' and not l.refunded and l.day >= p_since
    ),
    'refunds', (select count(*) from public.credit_ledger l where l.kind = 'refund' and l.day >= p_since),
    'granted', (
      select coalesce(jsonb_object_agg(g.kind, g.total), '{}'::jsonb)
      from (
        select l.kind, sum(l.delta) as total from public.credit_ledger l
        where l.kind in ('visit', 'signup', 'welcome', 'grant') and l.day >= p_since
        group by l.kind
      ) g
    ),
    'by_action', (
      select coalesce(jsonb_agg(jsonb_build_object('action', a.action, 'credits', a.total, 'count', a.times) order by a.total desc), '[]'::jsonb)
      from (
        select l.action, -sum(l.delta) as total, count(*) as times from public.credit_ledger l
        where l.kind = 'spend' and not l.refunded and l.day >= p_since
        group by l.action
      ) a
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'spent', d.total) order by d.day), '[]'::jsonb)
      from (
        select l.day, -sum(l.delta) as total from public.credit_ledger l
        where l.kind = 'spend' and not l.refunded and l.day >= p_since
        group by l.day
      ) d
    )
  );
$$;

revoke all on function public.admin_credit_stats(date) from public, anon, authenticated;
grant execute on function public.admin_credit_stats(date) to service_role;

-- "Reset today's allowances" in the admin area: every account's day starts again.
create or replace function public.admin_credit_reset_today()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed bigint;
begin
  delete from public.credit_days where day = private.credit_today();
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

revoke all on function public.admin_credit_reset_today() from public, anon, authenticated;
grant execute on function public.admin_credit_reset_today() to service_role;
