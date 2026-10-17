-- Live check of the row rules (#31, #28) with real accounts. Runs in one
-- transaction and rolls back, so nothing is changed. Usage:
--   supabase db query --linked -f supabase/tests/rls_check.sql
-- The owner is the admin member; the "other" user is another member if one
-- exists (other_is_real = true), otherwise a made-up id.
-- Expected: owner_sees > 0; other_sees_owner_rows, other_updates, other_deletes,
-- other_sees_invites = 0; other_sees_members <= 1; every *_insert/_create/anon_*
-- column starts with "blocked". The full suite is supabase/tests/database.
begin;

select set_config('t.owner', (select user_id::text from public.members where is_admin order by joined_at limit 1), true);
select set_config('t.other', coalesce(
  (select user_id::text from public.members where not is_admin order by joined_at limit 1),
  '00000000-0000-0000-0000-0000000000aa'), true);
select set_config('t.other_is_real', (current_setting('t.other') <> '00000000-0000-0000-0000-0000000000aa')::text, true);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
select set_config('t.owner_sees', (select count(*) from public.entries)::text, true);

-- The other user against the owner's data.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.other'), 'role', 'authenticated')::text, true);
select set_config('t.other_sees_owner_rows',
  (select count(*) from public.entries where user_id::text = current_setting('t.owner'))::text, true);
with u as (update public.entries set title = 'rls probe' where user_id::text = current_setting('t.owner') returning 1)
  select set_config('t.other_updates', (select count(*) from u)::text, true);
with d as (delete from public.entries where user_id::text = current_setting('t.owner') returning 1)
  select set_config('t.other_deletes', (select count(*) from d)::text, true);
select set_config('t.other_sees_members', (select count(*) from public.members)::text, true);
select set_config('t.other_sees_invites', (select count(*) from public.invites)::text, true);
do $$ begin
  insert into public.entries (user_id, id, medium, title) values (current_setting('t.owner')::uuid, 'rls_probe', 'film', 'rls probe');
  perform set_config('t.other_insert_as_owner', 'ALLOWED', true);
exception when others then
  perform set_config('t.other_insert_as_owner', 'blocked: ' || sqlerrm, true);
end $$;
do $$ begin
  update public.members set is_admin = true where user_id::text = current_setting('t.other');
  perform set_config('t.other_make_admin', 'ALLOWED', true);
exception when others then
  perform set_config('t.other_make_admin', 'blocked: ' || sqlerrm, true);
end $$;
do $$ begin
  perform public.create_invite();
  perform set_config('t.other_create_invite', 'ALLOWED', true);
exception when others then
  perform set_config('t.other_create_invite', 'blocked: ' || sqlerrm, true);
end $$;

-- Not signed in.
reset role;
set local role anon;
do $$ begin
  perform count(*) from public.entries;
  perform set_config('t.anon_entries', 'ALLOWED', true);
exception when others then
  perform set_config('t.anon_entries', 'blocked: ' || sqlerrm, true);
end $$;
do $$ begin
  perform count(*) from public.invites;
  perform set_config('t.anon_invites', 'ALLOWED', true);
exception when others then
  perform set_config('t.anon_invites', 'blocked: ' || sqlerrm, true);
end $$;
reset role;

select current_setting('t.other_is_real') as other_is_real,
       current_setting('t.owner_sees') as owner_sees,
       current_setting('t.other_sees_owner_rows') as other_sees_owner_rows,
       current_setting('t.other_updates') as other_updates,
       current_setting('t.other_deletes') as other_deletes,
       current_setting('t.other_sees_members') as other_sees_members,
       current_setting('t.other_sees_invites') as other_sees_invites,
       current_setting('t.other_insert_as_owner') as other_insert_as_owner,
       current_setting('t.other_make_admin') as other_make_admin,
       current_setting('t.other_create_invite') as other_create_invite,
       current_setting('t.anon_entries') as anon_entries,
       current_setting('t.anon_invites') as anon_invites;

rollback;
