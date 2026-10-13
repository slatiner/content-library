-- Keep-alive target (#39). Free Supabase projects pause after a week of low
-- activity. A scheduled GitHub Action reads this one-row table with the page's
-- public key. entries is closed to anon, so the job needs a table of its own.
create table public.keepalive (
  id smallint primary key default 1 check (id = 1),
  note text not null default 'read by .github/workflows/keepalive.yml'
);

insert into public.keepalive default values;

alter table public.keepalive enable row level security;

grant select on public.keepalive to anon;

create policy "keepalive: anyone can read"
  on public.keepalive for select to anon
  using (true);
