-- Authorization tests (#31): one user cannot read or change another's data, a
-- new account can't do anything until it redeems an invite (#28), and signed-out
-- visitors can't reach anything but the keep-alive row. Creates throwaway users,
-- so it runs against the local database only:
--   supabase start, then: supabase test db supabase/tests/database
-- Rolls back at the end.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(39);

-- ---- Every table, including future ones ----

select is(
  (select array_agg(relname::text order by relname) from pg_class
    where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') and not relrowsecurity),
  null, 'row-level security is on for every public table');

select is(
  (select array_agg(table_name || ':' || privilege_type order by 1) from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'),
  array['keepalive:SELECT']::text[], 'signed-out visitors can only read keepalive');

select is(
  (select array_agg(table_name || ':' || privilege_type order by 1) from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated'
      and privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  null, 'signed-in users have no TRUNCATE, REFERENCES, TRIGGER or MAINTAIN');

select is(
  (select array_agg(table_name || ':' || privilege_type order by 1) from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated' and table_name in ('members', 'invites')
      and privilege_type <> 'SELECT'),
  null, 'members and invites are written only through the invite functions');

select is(
  (select array_agg(p.proname::text order by 1) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('anon', p.oid, 'execute')),
  null, 'signed-out visitors can call no public function (trigger functions aside)');

-- ---- Fixtures: an admin (a), a member (b), a newcomer without an invite (c) ----

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test'),
  ('00000000-0000-0000-0000-00000000000b', 'member@test'),
  ('00000000-0000-0000-0000-00000000000c', 'newcomer@test');
insert into public.members (user_id, is_admin) values
  ('00000000-0000-0000-0000-00000000000a', true),
  ('00000000-0000-0000-0000-00000000000b', false);
insert into public.entries (user_id, id, medium, title, visibility) values
  ('00000000-0000-0000-0000-00000000000a', 'a_private', 'film', 'A private', 'private'),
  ('00000000-0000-0000-0000-00000000000a', 'a_public',  'book', 'A public',  'public'),
  ('00000000-0000-0000-0000-00000000000b', 'b_1',       'film', 'B one',     'private'),
  -- A newcomer's row can only exist through the service key or an old membership.
  ('00000000-0000-0000-0000-00000000000c', 'c_1',       'film', 'C one',     'private');

create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;

-- ---- A member against another member's entries ----

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');

select results_eq('select id from public.entries order by id', array['b_1'],
  'a member sees only their own entries');
select is((select count(*)::int from public.entries where visibility = 'public'), 0,
  'another user''s public entries stay hidden until visibility (#20) is built');
select is_empty($$ update public.entries set title = 'x' where user_id = '00000000-0000-0000-0000-00000000000a' returning 1 $$,
  'a member cannot change another user''s entries');
select is_empty($$ delete from public.entries where user_id = '00000000-0000-0000-0000-00000000000a' returning 1 $$,
  'a member cannot delete another user''s entries');
select throws_ok($$ insert into public.entries (user_id, id, medium, title) values ('00000000-0000-0000-0000-00000000000a', 'planted', 'film', 'x') $$,
  '42501', null, 'a member cannot add an entry to another user''s library');
select throws_ok($$ update public.entries set user_id = '00000000-0000-0000-0000-00000000000a' where id = 'b_1' $$,
  '42501', null, 'a member cannot hand their entry to another user');
select lives_ok($$ insert into public.entries (id, medium, title) values ('b_2', 'film', 'B two') $$,
  'a member can add an entry (user_id filled in)');
select lives_ok($$ update public.entries set rating = 4 where id = 'b_2' $$, 'a member can edit their entry');
select lives_ok($$ delete from public.entries where id = 'b_2' $$, 'a member can delete their entry');
select throws_ok('truncate public.entries', '42501', null, 'a member cannot truncate entries');

-- ---- Members and invites, as a non-admin member ----

select results_eq('select user_id::text from public.members', array['00000000-0000-0000-0000-00000000000b'],
  'a member sees only their own membership');
select throws_ok($$ update public.members set is_admin = true $$, '42501', null, 'a member cannot make themselves admin');
select throws_ok($$ insert into public.invites (code) values ('AAAA-BBBB-CCCC') $$, '42501', null,
  'a member cannot write an invite directly');
select throws_ok('select public.create_invite()', '42501', null, 'a non-admin cannot create invites');
select is_empty('select 1 from public.invites', 'a non-admin cannot see invites');

-- ---- A newcomer who hasn't redeemed an invite ----

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select ok(not public.is_member(), 'a newcomer is not a member');
select is_empty('select 1 from public.entries', 'a newcomer sees no entries, not even their own');
select throws_ok($$ insert into public.entries (id, medium, title) values ('c_2', 'film', 'x') $$, '42501', null,
  'a newcomer cannot add entries');
select is_empty($$ update public.entries set title = 'x' returning 1 $$, 'a newcomer cannot change entries');
select throws_ok($$ insert into public.members (user_id) values ('00000000-0000-0000-0000-00000000000c') $$, '42501', null,
  'a newcomer cannot add themselves to members');

-- ---- Invites: the admin creates, the newcomer redeems ----

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select set_config('t.code', (public.create_invite()).code, true);
select set_config('t.old', (public.create_invite()).code, true);
select is((select count(*)::int from public.invites), 2, 'the admin sees their invites');
reset role;
update public.invites set expires_at = now() - interval '1 day' where code = current_setting('t.old');
set local role authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select throws_like($$ select public.redeem_invite('0000-0000-0000') $$, '%isn''t valid%', 'a wrong code is rejected');
select throws_like($$ select public.redeem_invite(current_setting('t.old')) $$, '%expired%', 'an expired code is rejected');
select lives_ok($$ select public.redeem_invite(lower(replace(current_setting('t.code'), '-', ''))) $$,
  'a valid code works in lower case without dashes');
select ok(public.is_member() and not public.is_admin(), 'redeeming makes a member, not an admin');
select results_eq('select id from public.entries', array['c_1'], 'a new member sees only their own entries');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select lives_ok($$ select public.redeem_invite(current_setting('t.old')) $$,
  'redeeming as an existing member is a no-op');
reset role;
select is((select used_at from public.invites where code = current_setting('t.old')), null,
  '... and does not use up the code');
set local role authenticated;

-- ---- Signed out ----

reset role;
set local role anon;
select throws_ok('select 1 from public.entries', '42501', null, 'signed out: entries are refused');
select throws_ok('select 1 from public.members', '42501', null, 'signed out: members are refused');
select throws_ok('select 1 from public.invites', '42501', null, 'signed out: invites are refused');
select throws_ok($$ select public.redeem_invite('x') $$, '42501', null, 'signed out: cannot redeem');
select is((select count(*)::int from public.keepalive), 1, 'signed out: the keep-alive row is readable');
select throws_ok('insert into public.keepalive (id) values (2)', '42501', null, 'signed out: keepalive is read-only');
reset role;

select * from finish();
rollback;
