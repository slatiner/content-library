-- Privacy basics (#29): users can delete their own account, and accounts that
-- never redeem an invite are removed once a month.
--
-- Deleting the auth.users row removes everything the account owns: entries,
-- membership, share links and friendships cascade. Invites it created or used
-- stay, with created_by / used_by set to null, so a used code can't be reused.

-- Deletes the signed-in user's account and data, right away. The last admin
-- can't delete themselves, so the app always keeps someone who can invite.
create function public.delete_my_account() returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.is_admin()
     and not exists (select 1 from public.members where is_admin and user_id <> uid) then
    raise exception 'You''re the only admin, so this account can''t be deleted.' using errcode = 'P0001';
  end if;
  delete from auth.users where id = uid;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Accounts that signed in but never redeemed an invite hold no data; they're
-- deleted once they're 30 days old. Returns how many were removed. Not callable
-- from the app; pg_cron runs it.
create function public.cleanup_unredeemed_accounts() returns integer
language sql volatile security definer
set search_path = ''
as $$
  with gone as (
    delete from auth.users u
    where u.created_at < now() - interval '30 days'
      and not exists (select 1 from public.members m where m.user_id = u.id)
    returning 1
  )
  select count(*)::int from gone;
$$;

revoke execute on function public.cleanup_unredeemed_accounts() from public, anon, authenticated;

-- Monthly, on the 1st at 04:00 UTC. pg_cron is included in the free plan.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('cleanup-unredeemed-accounts', '0 4 1 * *',
  'select public.cleanup_unredeemed_accounts()');
