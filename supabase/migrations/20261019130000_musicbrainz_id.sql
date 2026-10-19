-- Music lookups move from iTunes to MusicBrainz (#30): iTunes artwork may only
-- be shown to promote the iTunes Store. Music entries get the MusicBrainz
-- release-group id; itunes_id stays for entries matched before.

alter table public.entries add column musicbrainz_id text;

-- What others see of an entry gains the new id. The two readers build the type
-- column by column, so they're redefined with it.
alter type public.shared_entry add attribute musicbrainz_id text;

create or replace function public.shared_entries(p_owner uuid) returns setof public.shared_entry
language sql stable security definer
set search_path = ''
as $$
  select e.id, e.medium, e.title, e.year, e.author, e.director, e.cast_members,
         e.platform, e.stream_url, e.date_consumed, e.rating, e.cover_url,
         e.wikidata_id, e.openlibrary_id, e.itunes_id, e.date_added, e.musicbrainz_id
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

create or replace function public.shared_by_link(p_token text)
returns table (owner_name text, entry public.shared_entry)
language sql stable security definer
set search_path = ''
as $$
  select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', ''),
         row(e.id, e.medium, e.title, e.year, e.author, e.director, e.cast_members,
             e.platform, e.stream_url, e.date_consumed, e.rating, e.cover_url,
             e.wikidata_id, e.openlibrary_id, e.itunes_id, e.date_added, e.musicbrainz_id)::public.shared_entry
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
