-- Asking for an invite code (#28 follow-up). Someone opens a shared item, signs
-- in with Google, and has no code: they can leave a short message asking for one.
-- Admins see the requests in the Invites dialog and send a code by hand; nothing
-- is emailed. One request per account (a second one replaces the message).
--
-- A request goes when its account redeems a code, is dismissed by an admin, or
-- is deleted (the account cascade, including the monthly cleanup of accounts
-- that never redeem).

create table public.access_requests (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  name        text not null default '',
  message     text not null default '' check (char_length(message) <= 500),
  created_at  timestamptz not null default now()
);

-- Signed in and not yet a member. Email and name come from the sign-in, not the
-- caller, so a request can't claim to be someone else.
create function public.request_access(p_message text) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.is_member() then
    raise exception 'You already have access.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_message, '')) > 500 then
    raise exception 'Keep the message under 500 characters.' using errcode = 'P0001';
  end if;
  insert into public.access_requests (user_id, email, name, message)
    select u.id, coalesce(u.email, ''),
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', ''),
           trim(coalesce(p_message, ''))
    from auth.users u where u.id = uid
  on conflict (user_id) do update
    set message = excluded.message, created_at = now();
end;
$$;

revoke execute on function public.request_access(text) from public, anon;
grant execute on function public.request_access(text) to authenticated;

-- Same as before, plus: redeeming clears the account's request.
create or replace function public.redeem_invite(p_code text) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  hex text := upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Fa-f]', '', 'g'));
  inv public.invites;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.is_member() then
    return;
  end if;
  select * into inv from public.invites
    where code = substr(hex, 1, 4) || '-' || substr(hex, 5, 4) || '-' || substr(hex, 9, 4)
    for update;
  if not found or length(hex) <> 12 then
    raise exception 'That invite code isn''t valid. Check it and try again.' using errcode = 'P0001';
  end if;
  if inv.used_at is not null then
    raise exception 'That invite code has already been used.' using errcode = 'P0001';
  end if;
  if inv.expires_at < now() then
    raise exception 'That invite code has expired. Ask for a new one.' using errcode = 'P0001';
  end if;
  update public.invites set used_by = uid, used_at = now() where code = inv.code;
  insert into public.members (user_id) values (uid);
  delete from public.access_requests where user_id = uid;
end;
$$;

-- Requesters read their own (to show "request sent"); admins read and dismiss.
-- Writes otherwise go through request_access.
alter table public.access_requests enable row level security;
grant select, delete on public.access_requests to authenticated;

create policy "access_requests: read own or admin"
  on public.access_requests for select to authenticated
  using ((select auth.uid()) = user_id or (select public.is_admin()));

create policy "access_requests: admins dismiss"
  on public.access_requests for delete to authenticated
  using ((select public.is_admin()));
