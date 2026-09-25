-- Feedback from visitors: a problem, an idea or anything else, sent from the
-- "משוב והצעות" dialog at the foot of every page. Anyone may add a row, the
-- way anyone may add an anonymous event; nobody may read one back. Only the
-- admin function, with the service role, lists them, marks them handled and
-- deletes them. Safe to run again.

create table if not exists public.site_feedback (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('problem', 'idea', 'other')),
  message text not null check (length(message) between 1 and 2000),
  -- An address for an answer, only when the visitor wrote one.
  contact text check (contact is null or length(contact) <= 200),
  -- Where it was sent from, and on what: the tool, the site's language, the
  -- kind of device and browser. Nothing else about the visitor.
  page text check (page is null or length(page) <= 40),
  language text check (language is null or length(language) <= 12),
  device text check (device is null or device in ('phone', 'tablet', 'desktop')),
  browser text check (browser is null or length(browser) <= 40),
  os text check (os is null or length(os) <= 40),
  handled boolean not null default false
);

create index if not exists site_feedback_created_idx on public.site_feedback (created_at desc);

alter table public.site_feedback enable row level security;

revoke all on public.site_feedback from anon, authenticated;
grant insert on public.site_feedback to anon, authenticated;

drop policy if exists "Anyone may send feedback" on public.site_feedback;
create policy "Anyone may send feedback"
on public.site_feedback for insert to anon, authenticated
with check (handled = false);
-- No select, update or delete policy on purpose.
