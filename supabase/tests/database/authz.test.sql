-- Authorization tests (#31): one user cannot read or change another's data, a
-- new account can't do anything until it redeems an invite (#28), and signed-out
-- visitors reach only the keep-alive row and share links. Visibility (#20):
-- others read entries only through shared_entries / shared_by_link, never notes. Creates throwaway users,
-- so it runs against the local database only:
--   supabase start, then: supabase test db supabase/tests/database
-- Rolls back at the end.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(59);

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
  array['shared_by_link'], 'signed-out visitors can call only shared_by_link (trigger functions aside)');

select is(
  (select array_agg(a.attname::text order by 1) from pg_attribute a
    where a.attrelid = 'public.shared_entry'::regclass and a.attname in ('insights', 'user_id', 'visibility')),
  null, 'what others see of an entry has no notes, owner id or level');

-- ---- Fixtures: an admin (a), a member (b), a newcomer without an invite (c) ----

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test', '{"full_name": "Ada Admin"}'),
  ('00000000-0000-0000-0000-00000000000b', 'member@test', '{}'),
  ('00000000-0000-0000-0000-00000000000c', 'newcomer@test', '{}');
-- a shares by default; b keeps the private default.
insert into public.members (user_id, is_admin, default_visibility) values
  ('00000000-0000-0000-0000-00000000000a', true, 'public'),
  ('00000000-0000-0000-0000-00000000000b', false, 'private');
insert into public.entries (user_id, id, medium, title, visibility) values
  ('00000000-0000-0000-0000-00000000000a', 'a_private', 'film', 'A private', 'private'),
  ('00000000-0000-0000-0000-00000000000a', 'a_public',  'book', 'A public',  'public'),
  ('00000000-0000-0000-0000-00000000000a', 'a_default', 'book', 'A default', null),
  ('00000000-0000-0000-0000-00000000000a', 'a_friends', 'film', 'A friends', 'friends'),
  ('00000000-0000-0000-0000-00000000000b', 'b_1',       'film', 'B one',     null),
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
select is((select count(*)::int from public.entries where user_id <> '00000000-0000-0000-0000-00000000000b'), 0,
  'the entries table stays owner-only, even for public entries');
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


-- ---- Visibility: members reading each other (#20) ----

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select set_eq($$ select id from public.shared_entries('00000000-0000-0000-0000-00000000000a') $$,
  array['a_public', 'a_default'], 'a member sees another''s public entries, including ones following a public default');
reset role;
insert into public.friendships (user_a, user_b) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
set local role authenticated;
select set_eq($$ select id from public.shared_entries('00000000-0000-0000-0000-00000000000a') $$,
  array['a_public', 'a_default', 'a_friends'], 'a friend also sees friends-level entries, never private ones');
reset role;
delete from public.friendships;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select is_empty($$ select 1 from public.shared_entries('00000000-0000-0000-0000-00000000000b') $$,
  'a private default hides the whole library');
select lives_ok($$ update public.members set default_visibility = 'private' $$, 'a member can change their library default');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select set_eq($$ select id from public.shared_entries('00000000-0000-0000-0000-00000000000a') $$,
  array['a_public'], '... and entries following it go private; explicit public ones stay');
select is_empty($$ update public.members set default_visibility = 'public' where user_id = '00000000-0000-0000-0000-00000000000a' returning 1 $$,
  'a member cannot change another''s library default');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update public.members set default_visibility = 'public';

-- ---- Share links ----

select set_config('t.lib', public.get_share_link(), true);
select set_config('t.one', public.get_share_link('a_private'), true);
select is(public.get_share_link(), current_setting('t.lib'), 'asking again returns the same library link');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select is_empty('select 1 from public.share_links', 'a member cannot see another''s share links');
select throws_ok($$ insert into public.share_links (user_id) values ('00000000-0000-0000-0000-00000000000a') $$, '42501', null,
  'a member cannot create a link for another''s library');
select throws_ok($$ select public.get_share_link('a_private') $$, '23503', null,
  'a member cannot create a link for another''s entry');

-- ---- A newcomer who hasn't redeemed an invite ----

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select ok(not public.is_member(), 'a newcomer is not a member');
select is_empty('select 1 from public.entries', 'a newcomer sees no entries, not even their own');
select throws_ok($$ insert into public.entries (id, medium, title) values ('c_2', 'film', 'x') $$, '42501', null,
  'a newcomer cannot add entries');
select is_empty($$ update public.entries set title = 'x' returning 1 $$, 'a newcomer cannot change entries');
select throws_ok($$ insert into public.members (user_id) values ('00000000-0000-0000-0000-00000000000c') $$, '42501', null,
  'a newcomer cannot add themselves to members');
select is_empty($$ select 1 from public.shared_entries('00000000-0000-0000-0000-00000000000a') $$,
  'a newcomer cannot read members'' shared entries');
select throws_ok('select public.get_share_link()', '42501', null, 'a newcomer cannot create share links');

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
select throws_ok('select 1 from public.share_links', '42501', null, 'signed out: share links cannot be listed');
select set_eq($$ select (entry).id from public.shared_by_link(current_setting('t.lib')) $$,
  array['a_public', 'a_default'], 'signed out: a library link shows only public entries');
select is((select distinct owner_name from public.shared_by_link(current_setting('t.lib'))), 'Ada Admin',
  'signed out: a link shows the sharer''s name');
select set_eq($$ select (entry).id from public.shared_by_link(current_setting('t.one')) $$,
  array['a_private'], 'signed out: an entry link shows that entry, whatever its level');
select is_empty($$ select 1 from public.shared_by_link('00000000000000000000000000000000') $$,
  'signed out: an unknown token shows nothing');
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ delete from public.share_links where token = current_setting('t.lib') $$, 'the owner can revoke a link');
reset role;
set local role anon;
select is_empty($$ select 1 from public.shared_by_link(current_setting('t.lib')) $$, 'signed out: a revoked link shows nothing');
select throws_ok('insert into public.keepalive (id) values (2)', '42501', null, 'signed out: keepalive is read-only');
reset role;

select * from finish();
rollback;
