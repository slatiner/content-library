-- Visibility (#20). Each library has a default level and each entry can
-- override it; entries.visibility null means "follow the library default".
--   private  only the owner
--   friends  the owner's friends (friendships arrive in Phase 6, #34)
--   public   every member, and non-members through a share link
-- Non-members never browse: they see only what a secret share link names (one
-- entry, or a whole library's public entries). Notes (insights) are never
-- shared. Others read only through the functions below, which leave insights
-- out; the entries table itself stays owner-only.

-- ---- Levels ----

alter table public.members
  add column default_visibility text not null default 'private'
  check (default_visibility in ('private', 'friends', 'public'));

-- The owner (the only admin so far) shares by default.
update public.members set default_visibility = 'public' where is_admin;

-- Members change only their own default, and no other column.
grant update (default_visibility) on public.members to authenticated;
create policy "members: update own"
  on public.members for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter table public.entries alter column visibility drop not null;
alter table public.entries alter column visibility drop default;
-- Existing entries follow the default from now on.
update public.entries set visibility = null;

-- ---- Friends (filled in by Phase 6, #34) ----

-- One row per pair, smaller id first.
create table public.friendships (
  user_a     uuid not null references auth.users (id) on delete cascade,
  user_b     uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
alter table public.friendships enable row level security;

create function public.are_friends(x uuid, y uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.friendships
    where user_a = least(x, y) and user_b = greatest(x, y));
$$;

-- ---- Share links ----

create table public.share_links (
  token      text primary key default replace(gen_random_uuid()::text, '-', ''),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- null shares the whole library (its public entries); otherwise one entry,
  -- whatever its level.
  entry_id   text,
  created_at timestamptz not null default now(),
  foreign key (user_id, entry_id) references public.entries (user_id, id) on delete cascade
);
create unique index share_links_one_per_target on public.share_links (user_id, coalesce(entry_id, ''));

alter table public.share_links enable row level security;
grant select, insert, delete on public.share_links to authenticated;

create policy "share_links: owner can read"
  on public.share_links for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "share_links: members can create their own"
  on public.share_links for insert to authenticated
  with check ((select auth.uid()) = user_id and (select public.is_member()));
create policy "share_links: owner can revoke"
  on public.share_links for delete to authenticated
  using ((select auth.uid()) = user_id);

-- The caller's link for one entry (or, with null, their library), created on
-- first use. Runs as the caller, so the policies above apply.
create function public.get_share_link(p_entry_id text default null) returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  t text;
begin
  insert into public.share_links (entry_id) values (p_entry_id)
    on conflict (user_id, coalesce(entry_id, '')) do nothing;
  select token into t from public.share_links
    where user_id = (select auth.uid()) and entry_id is not distinct from p_entry_id;
  return t;
end;
$$;

-- ---- Reading what others share ----

-- What others see of an entry: everything but the notes and the owner's id.
create type public.shared_entry as (
  id text, medium text, title text, year smallint, author text, director text,
  cast_members text, platform text, stream_url text, date_consumed date,
  rating smallint, cover_url text, wikidata_id text, openlibrary_id text,
  itunes_id text, date_added timestamptz
);

-- A member reading another member's library: public entries, plus friends-level
-- ones for friends.
create function public.shared_entries(p_owner uuid) returns setof public.shared_entry
language sql stable security definer
set search_path = ''
as $$
  select e.id, e.medium, e.title, e.year, e.author, e.director, e.cast_members,
         e.platform, e.stream_url, e.date_consumed, e.rating, e.cover_url,
         e.wikidata_id, e.openlibrary_id, e.itunes_id, e.date_added
  from public.entries e
  join public.members m on m.user_id = e.user_id
  where e.user_id = p_owner
    and public.is_member()
    and p_owner <> (select auth.uid())
    and case coalesce(e.visibility, m.default_visibility)
          when 'public' then true
          when 'friends' then public.are_friends(p_owner, (select auth.uid()))
          else false
        end
  order by e.date_added;
$$;

-- Anyone holding a share link, signed in or not. owner_name is the sharer's
-- display name from their Google profile. No rows for an unknown or revoked token.
create function public.shared_by_link(p_token text)
returns table (owner_name text, entry public.shared_entry)
language sql stable security definer
set search_path = ''
as $$
  select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', ''),
         row(e.id, e.medium, e.title, e.year, e.author, e.director, e.cast_members,
             e.platform, e.stream_url, e.date_consumed, e.rating, e.cover_url,
             e.wikidata_id, e.openlibrary_id, e.itunes_id, e.date_added)::public.shared_entry
  from public.share_links l
  join public.members m on m.user_id = l.user_id
  join auth.users u on u.id = l.user_id
  join public.entries e on e.user_id = l.user_id
  where l.token = p_token
    and (case when l.entry_id is null
           then coalesce(e.visibility, m.default_visibility) = 'public'
           else e.id = l.entry_id end)
  order by e.date_added;
$$;

revoke execute on function public.are_friends(uuid, uuid), public.shared_entries(uuid),
  public.get_share_link(text), public.shared_by_link(text) from public, anon;
grant execute on function public.are_friends(uuid, uuid), public.shared_entries(uuid),
  public.get_share_link(text) to authenticated;
grant execute on function public.shared_by_link(text) to anon, authenticated;
