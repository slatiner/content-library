-- Check of the invite rules (#28). Creates throwaway users, so run it against a
-- local database only (supabase start), never the live project:
--   docker exec -i supabase_db_Content_Project psql -U postgres -d postgres < supabase/tests/invites_check.sql
-- Runs in one transaction and rolls back. Every row of the result should say ok.
begin;

create temp table results (step text, outcome text) on commit drop;
grant insert, select on results to authenticated, anon;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test'),
  ('00000000-0000-0000-0000-00000000000b', 'newcomer@test'),
  ('00000000-0000-0000-0000-00000000000c', 'latecomer@test');
insert into public.members (user_id, is_admin) values ('00000000-0000-0000-0000-00000000000a', true);

create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.check(step text, ok boolean, detail text default '') returns void language sql as $$
  insert into results values (step, case when ok then 'ok' else 'FAILED ' || detail end);
$$;
grant execute on function pg_temp.as_user(text), pg_temp.check(text, boolean, text) to authenticated, anon;

set local role authenticated;

-- A newcomer who hasn't redeemed anything.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check('newcomer is not a member', not public.is_member());
do $$ begin
  insert into public.entries (id, medium, title) values ('probe', 'film', 'probe');
  perform pg_temp.check('newcomer cannot add entries', false, 'insert allowed');
exception when insufficient_privilege then perform pg_temp.check('newcomer cannot add entries', true);
end $$;
do $$ begin
  perform public.create_invite();
  perform pg_temp.check('newcomer cannot create invites', false, 'allowed');
exception when insufficient_privilege then perform pg_temp.check('newcomer cannot create invites', true);
end $$;
do $$ begin
  insert into public.members (user_id) values ('00000000-0000-0000-0000-00000000000b');
  perform pg_temp.check('newcomer cannot add themselves to members', false, 'allowed');
exception when insufficient_privilege then perform pg_temp.check('newcomer cannot add themselves to members', true);
end $$;

-- The admin makes two codes; one is then backdated past its expiry.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select set_config('t.code', (public.create_invite()).code, true);
select set_config('t.old', (public.create_invite()).code, true);
select pg_temp.check('admin sees their invites', (select count(*) from public.invites) = 2);
reset role;
update public.invites set expires_at = now() - interval '1 day' where code = current_setting('t.old');
set local role authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check('newcomer cannot list invites', (select count(*) from public.invites) = 0);
do $$ begin
  perform public.redeem_invite('0000-0000-0000');
  perform pg_temp.check('wrong code is rejected', false, 'accepted');
exception when raise_exception then perform pg_temp.check('wrong code is rejected', sqlerrm like '%isn''t valid%', sqlerrm);
end $$;
do $$ begin
  perform public.redeem_invite(current_setting('t.old'));
  perform pg_temp.check('expired code is rejected', false, 'accepted');
exception when raise_exception then perform pg_temp.check('expired code is rejected', sqlerrm like '%expired%', sqlerrm);
end $$;
-- Lower case, without dashes.
select public.redeem_invite(lower(replace(current_setting('t.code'), '-', '')));
select pg_temp.check('newcomer is a member after redeeming', public.is_member());
select pg_temp.check('newcomer is not an admin', not public.is_admin());
insert into public.entries (id, medium, title) values ('probe', 'film', 'probe');
select pg_temp.check('member can add entries', (select count(*) from public.entries) = 1);

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin
  perform public.redeem_invite(current_setting('t.code'));
  perform pg_temp.check('a used code is rejected', false, 'accepted');
exception when raise_exception then perform pg_temp.check('a used code is rejected', sqlerrm like '%already been used%', sqlerrm);
end $$;
select pg_temp.check('latecomer is still not a member', not public.is_member());

reset role;
set local role anon;
do $$ begin
  perform public.redeem_invite('x');
  perform pg_temp.check('anon cannot call redeem_invite', false, 'allowed');
exception when insufficient_privilege then perform pg_temp.check('anon cannot call redeem_invite', true);
end $$;
reset role;

select * from results;
rollback;
