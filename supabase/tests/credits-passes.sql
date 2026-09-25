-- ---------------------------------------------------------------------------
-- Passes and payments in supabase/credits.sql, played through on a scratch
-- Postgres (tested on 16; never the project's database):
--
--   createdb credits_test
--   psql -d credits_test -f supabase/tests/supabase-stub.sql
--   psql -d credits_test -f supabase/credits.sql
--   psql -d credits_test -f supabase/tests/credits-passes.sql
--
-- Everything runs in one transaction that is rolled back on the first
-- failure; "ALL SCENARIOS PASSED" at the end means every check held.
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP 1

-- Two accounts, and one transcription paid in credits before any pass.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com');
insert into public.profiles values ('00000000-0000-0000-0000-00000000000a', 'Avi Cohen');
select public.credit_spend('00000000-0000-0000-0000-00000000000a', 'transcript', 'minute', 3, '{}', false);

set client_min_messages = notice;
create function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAILED: %', p_what; end if;
  raise notice 'ok  %', p_what;
end $$;

do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000000a';
  b uuid := '00000000-0000-0000-0000-00000000000b';
  r jsonb; p1 uuid; p2 uuid; p3 uuid; p4 uuid; pb uuid; u1 timestamptz; u2 timestamptz; e bigint; st jsonb; i int;
begin
  -- Selling is off by default.
  r := public.credit_purchase_start(a, 'week', true);
  perform pg_temp.check(r->>'reason' = 'off', 'selling off by default: ' || r::text);

  update public.credit_settings set pay_enabled = true;
  r := public.credit_purchase_start(a, 'week', false);
  perform pg_temp.check(r->>'reason' = 'test_mode', 'test mode refuses a visitor');
  r := public.credit_purchase_start(a, 'year', true);
  perform pg_temp.check(r->>'reason' = 'plan', 'unknown plan refused');

  r := public.credit_purchase_start(a, 'week', true);
  perform pg_temp.check((r->>'ok')::boolean and (r->>'amount')::numeric = 10 and (r->>'days')::int = 7 and r->>'currency' = 'ILS' and r->>'mode' = 'sandbox', 'owner starts a week in test mode: ' || r::text);
  p1 := (r->>'id')::uuid;
  perform public.credit_purchase_order(p1, 'ORDER-1');
  perform pg_temp.check((select order_id from public.credit_purchases where id = p1) = 'ORDER-1', 'order id kept');

  -- The wrong sum never gives a pass.
  r := public.credit_purchase_complete(p1, 'CAP-1', 1.00, 'ILS', '{}');
  perform pg_temp.check(r->>'reason' = 'mismatch' and (select status from public.credit_purchases where id = p1) = 'failed', 'a wrong amount fails the purchase');
  perform pg_temp.check((select pass_until from public.credit_accounts where user_id = a) is null, 'no pass after a mismatch');

  r := public.credit_purchase_start(a, 'week', true); p2 := (r->>'id')::uuid;
  r := public.credit_purchase_complete(p2, 'CAP-2', 10, 'ils', '{}');
  u1 := (r->>'until')::timestamptz;
  perform pg_temp.check((r->>'ok')::boolean and u1 between now() + interval '6 days 23 hours' and now() + interval '7 days 1 minute', 'paid week gives 7 days: ' || r::text);
  perform pg_temp.check((select pass_plan from public.credit_accounts where user_id = a) = 'week', 'pass plan is week');
  perform pg_temp.check((select count(*) from public.credit_ledger where user_id = a and kind = 'purchase') = 1, 'purchase line in the history');
  r := public.credit_purchase_complete(p2, 'CAP-2', 10, 'ILS', '{}');
  perform pg_temp.check((r->>'already')::boolean and (r->>'until')::timestamptz = u1, 'completing twice gives nothing more');
  perform pg_temp.check((select count(*) from public.credit_ledger where user_id = a and kind = 'purchase') = 1, 'still one purchase line');

  -- Spending under the pass costs no credits.
  r := public.credit_spend(a, 'transcript', 'minute', 5, '{}', false);
  perform pg_temp.check((r->>'charged')::int = 0 and (r->>'pass_used')::int = 5 and (r->>'pass_left')::int = 195 and (r->>'daily_left')::int = 17, 'pass covers the work: ' || r::text);
  perform pg_temp.check((select from_pass from public.credit_ledger where id = (r->>'entry')::bigint) = 5 and (select delta from public.credit_ledger where id = (r->>'entry')::bigint) = 0, 'ledger: from_pass 5, delta 0');

  -- Past the fair use, the usual credits pay the rest.
  update public.credit_settings set pass_daily = 10;
  r := public.credit_spend(a, 'transcript', 'minute', 8, '{}', false);
  e := (r->>'entry')::bigint;
  perform pg_temp.check((r->>'pass_used')::int = 5 and (r->>'charged')::int = 3 and (r->>'daily_left')::int = 14 and (r->>'pass_left')::int = 0, 'fair use: 5 from the pass, 3 from the day: ' || r::text);
  r := public.credit_spend(a, 'separate', 'separate', 1, '{}', false);
  perform pg_temp.check((r->>'pass_used')::int = 0 and (r->>'charged')::int = 5 and (r->>'daily_left')::int = 9, 'pass used up for today: credits pay');
  r := public.credit_refund(a, e);
  perform pg_temp.check((r->>'refunded')::int = 3 and (r->>'pass_left')::int = 5 and (r->>'daily_left')::int = 12, 'refund gives back the day and the pass share: ' || r::text);
  perform pg_temp.check((select from_pass from public.credit_ledger where kind = 'refund' and detail->>'entry' = e::text) = 5, 'refund line records the pass share');
  update public.credit_settings set pass_daily = 200;

  -- Refused with the pass used up and no credits left.
  update public.credit_settings set pass_daily = 1;
  r := public.credit_spend(a, 'separate', 'separate', 10, '{}', false);
  perform pg_temp.check(not (r->>'ok')::boolean and (r->>'needed')::int = 50 and r->>'pass_until' is not null, 'refusal says the pass is there but used up: ' || r::text);
  update public.credit_settings set pass_daily = 200;

  -- A month bought on top of the week starts where the week ends.
  r := public.credit_purchase_start(a, 'month', true); p3 := (r->>'id')::uuid;
  perform pg_temp.check((r->>'amount')::numeric = 30 and (r->>'days')::int = 30, 'month costs 30 for 30 days');
  r := public.credit_purchase_complete(p3, 'CAP-3', 30.00, 'ILS', '{}');
  u2 := (r->>'until')::timestamptz;
  perform pg_temp.check(u2 = u1 + interval '30 days', 'month added after the week');
  perform pg_temp.check((select pass_plan from public.credit_accounts where user_id = a) = 'month', 'pass is now called month');

  -- What the page sees.
  perform set_config('request.jwt.claim.sub', a::text, true);
  st := public.credit_status();
  perform pg_temp.check((st->>'pass_until')::timestamptz = u2 and st->>'pass_plan' = 'month' and (st->>'pass_daily')::int = 200, 'status carries the pass');
  perform pg_temp.check(jsonb_array_length(st->'purchases') = 2, 'status lists the 2 paid purchases, not the failed one: ' || (st->'purchases')::text);
  perform pg_temp.check(exists (select 1 from jsonb_array_elements(st->'history') h where h->>'kind' = 'purchase') and exists (select 1 from jsonb_array_elements(st->'history') h where (h->>'from_pass')::int > 0), 'history has the purchase and a pass-covered line');
  perform pg_temp.check(st->'config' ? 'pass_week_price' and st->'config' ? 'pay_enabled', 'config carries the pay settings');

  -- A refund in PayPal takes the month back.
  r := public.credit_purchase_refund(null, 'CAP-3', '{"reason":"test"}');
  perform pg_temp.check(r->>'status' = 'refunded' and (select pass_until from public.credit_accounts where user_id = a) = u1, 'refund of the month leaves the week: ' || r::text);
  r := public.credit_purchase_refund(p3, null, '{}');
  perform pg_temp.check(r->>'status' = 'refunded' and (select pass_until from public.credit_accounts where user_id = a) = u1, 'refunding twice changes nothing');
  r := public.credit_purchase_complete(p3, 'CAP-3', 30, 'ILS', '{}');
  perform pg_temp.check(r->>'reason' = 'refunded', 'a refunded purchase cannot be completed again');

  -- Status changes that must not happen.
  r := public.credit_purchase_mark(p2, 'failed', '{}');
  perform pg_temp.check(not (r->>'ok')::boolean and (select status from public.credit_purchases where id = p2) = 'completed', 'a completed purchase does not fail later');
  r := public.credit_purchase_start(a, 'week', true); p4 := (r->>'id')::uuid;
  r := public.credit_purchase_mark(p4, 'pending', '{}');
  r := public.credit_purchase_mark(p4, 'canceled', '{}');
  perform pg_temp.check((select status from public.credit_purchases where id = p4) = 'pending', 'a pending payment is not canceled by a late click');
  r := public.credit_purchase_mark(p4, 'completed', '{}');
  perform pg_temp.check(r->>'reason' = 'status', 'mark cannot complete');

  -- Live mode: anybody may buy; the revenue counts real money only.
  update public.credit_settings set pay_mode = 'live';
  r := public.credit_purchase_start(b, 'week', false); pb := (r->>'id')::uuid;
  perform pg_temp.check((r->>'ok')::boolean and r->>'mode' = 'live', 'live mode: a visitor can buy');
  r := public.credit_purchase_complete(pb, 'CAP-B', 10, 'ILS', '{}');
  r := public.admin_credit_stats(current_date - 30);
  perform pg_temp.check((r->'revenue'->>'ILS')::numeric = 10 and (r->'sales'->>'week')::int = 1 and (r->>'test_sales')::int = 1 and (r->>'passes_active')::int = 2, 'admin stats: ' || (r - 'recent_purchases' - 'daily' - 'by_action')::text);
  perform pg_temp.check(jsonb_array_length(r->'recent_purchases') >= 4 and not (r->'recent_purchases'->0 ? 'user_id'), 'recent purchases, without who');
  perform pg_temp.check((select (x->>'credits')::int from jsonb_array_elements(r->'by_action') x where x->>'action' = 'transcript') = 8, 'usage by action counts the pass share (3 before the upgrade + 5 under the pass)');

  -- Twenty starts an hour at most.
  for i in 1..19 loop perform public.credit_purchase_start(b, 'week', false); end loop;
  r := public.credit_purchase_start(b, 'week', false);
  perform pg_temp.check(r->>'reason' = 'busy', 'the 21st start in an hour is refused');

  -- The account is deleted while its payment is on the way: the money stays on record.
  delete from public.credit_purchases where user_id = b and status = 'created';
  r := public.credit_purchase_start(b, 'month', false); pb := (r->>'id')::uuid;
  delete from auth.users where id = b;
  perform pg_temp.check((select user_id from public.credit_purchases where id = pb) is null, 'purchase kept, account gone');
  r := public.credit_purchase_complete(pb, 'CAP-B2', 30, 'ILS', '{}');
  perform pg_temp.check((r->>'orphan')::boolean and (select status from public.credit_purchases where id = pb) = 'completed', 'orphan payment recorded as completed');

  -- An expired pass covers nothing.
  update public.credit_accounts set pass_until = now() - interval '1 second' where user_id = a;
  r := public.credit_spend(a, 'assistant', 'assistant', 1, '{}', false);
  perform pg_temp.check((r->>'pass_used')::int = 0 and (r->>'charged')::int = 1 and r->>'pass_until' is null, 'expired pass: credits pay: ' || r::text);

  -- Everybody may read the rules; nobody but the server touches purchases.
  perform pg_temp.check(has_table_privilege('anon', 'public.credit_settings', 'select'), 'anon reads the rules');
  perform pg_temp.check(not has_table_privilege('anon', 'public.credit_purchases', 'select') and not has_table_privilege('authenticated', 'public.credit_purchases', 'select'), 'purchases are closed to the page');
  perform pg_temp.check(not has_function_privilege('authenticated', 'public.credit_purchase_complete(uuid, text, numeric, text, jsonb)', 'execute') and not has_function_privilege('anon', 'public.credit_purchase_start(uuid, text, boolean)', 'execute'), 'purchase functions are server-only');
  raise notice 'ALL SCENARIOS PASSED';
end $$;
