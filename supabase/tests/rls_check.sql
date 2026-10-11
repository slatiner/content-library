-- Live check of the entries row rules (#31). Runs in one transaction and rolls
-- back, so nothing is changed. Usage:
--   sed "s/OWNER_UUID/<auth user id>/" supabase/tests/rls_check.sql > /tmp/rls.sql
--   supabase db query --linked -f /tmp/rls.sql
-- Expected: owner_sees > 0; stranger_sees, stranger_updates, stranger_deletes = 0;
-- stranger_insert_as_owner and anon_read start with "blocked".
begin;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"OWNER_UUID","role":"authenticated"}', true);
select set_config('t.owner_sees', (select count(*) from public.entries)::text, true);

-- A signed-in stranger.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
select set_config('t.stranger_sees', (select count(*) from public.entries)::text, true);
with u as (update public.entries set title = 'rls probe' returning 1)
  select set_config('t.stranger_updates', (select count(*) from u)::text, true);
with d as (delete from public.entries returning 1)
  select set_config('t.stranger_deletes', (select count(*) from d)::text, true);
do $$ begin
  insert into public.entries (user_id, id, medium, title) values ('OWNER_UUID', 'rls_probe', 'film', 'rls probe');
  perform set_config('t.stranger_insert_as_owner', 'ALLOWED', true);
exception when others then
  perform set_config('t.stranger_insert_as_owner', 'blocked: ' || sqlerrm, true);
end $$;

-- Not signed in.
reset role;
set local role anon;
do $$ begin
  perform count(*) from public.entries;
  perform set_config('t.anon_read', 'ALLOWED', true);
exception when others then
  perform set_config('t.anon_read', 'blocked: ' || sqlerrm, true);
end $$;
reset role;

select current_setting('t.owner_sees') as owner_sees,
       current_setting('t.stranger_sees') as stranger_sees,
       current_setting('t.stranger_updates') as stranger_updates,
       current_setting('t.stranger_deletes') as stranger_deletes,
       current_setting('t.stranger_insert_as_owner') as stranger_insert_as_owner,
       current_setting('t.anon_read') as anon_read;

rollback;
