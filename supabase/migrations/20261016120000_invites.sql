-- Invite-only sign-up (#28).
--
-- Google sign-in can't carry an invite code into account creation, so sign-up
-- stays open but a new account can't do anything until it redeems a code:
-- entries and the assistant proxy (supabase/functions/groq) are limited to
-- members. Admins (the owner) create codes from the app. Codes are single-use
-- and expire after 14 days.

create table public.members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  is_admin   boolean not null default false,
  joined_at  timestamptz not null default now()
);

-- Sign-ups were closed until now, so every existing account is the owner's.
insert into public.members (user_id, is_admin)
  select id, true from auth.users;

create table public.invites (
  code        text primary key check (code ~ '^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$'),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  used_by     uuid unique references auth.users (id) on delete set null,
  used_at     timestamptz
);

-- Security definer so the row rules below can check membership without
-- granting reads on members to everyone.
create function public.is_member() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.members where user_id = (select auth.uid()));
$$;

create function public.is_admin() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.members where user_id = (select auth.uid()) and is_admin);
$$;

-- Admins only. 48 random bits, shown as XXXX-XXXX-XXXX.
create function public.create_invite() returns public.invites
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  hex text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  inv public.invites;
begin
  if not public.is_admin() then
    raise exception 'Only admins can create invites' using errcode = '42501';
  end if;
  insert into public.invites (code, created_by)
    values (substr(hex, 1, 4) || '-' || substr(hex, 5, 4) || '-' || substr(hex, 9, 4), (select auth.uid()))
    returning * into inv;
  return inv;
end;
$$;

-- Makes the signed-in user a member. Accepts the code with or without dashes,
-- in any case.
create function public.redeem_invite(p_code text) returns void
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
end;
$$;

-- Functions are executable by public by default; only signed-in users need these.
revoke execute on function public.is_member(), public.is_admin(), public.create_invite(),
  public.redeem_invite(text) from public, anon;
grant execute on function public.is_member(), public.is_admin(), public.create_invite(),
  public.redeem_invite(text) to authenticated;

-- Row rules. Users read their own membership (the app checks it after sign-in);
-- admins read invites to list them. All writes go through the functions above.
alter table public.members enable row level security;
alter table public.invites enable row level security;
grant select on public.members, public.invites to authenticated;

create policy "members: read own"
  on public.members for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "invites: admins can read"
  on public.invites for select to authenticated
  using ((select public.is_admin()));

-- Entries are for members only, on top of the owner-only policies.
create policy "entries: members only"
  on public.entries as restrictive for all to authenticated
  using ((select public.is_member()))
  with check ((select public.is_member()));
