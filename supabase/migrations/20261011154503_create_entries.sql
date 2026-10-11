-- Library entries, one row per user per logged work (#13).
--
-- Mirrors the shape in media-archive-data.example.json. The storage adapter
-- (#41) maps camelCase app fields to these snake_case columns:
--   id, medium, title, year, author, director, cast -> cast_members,
--   platform, streamUrl -> stream_url, dateConsumed -> date_consumed, rating,
--   coverUrl -> cover_url, insights, dateAdded (epoch ms) -> date_added.
--
-- Per-user entries only, no shared catalogue yet: works are matched across users
-- by the canonical external ids (#26). A shared works table can be added later
-- from those ids without changing this one.

create table public.entries (
  user_id        uuid not null default auth.uid()
                 references auth.users (id) on delete cascade,
  -- App-generated ids (e_<ms>_<slug>), kept so export/import round-trips.
  -- Unique per user, so two users importing the same file don't collide.
  id             text not null check (length(id) between 1 and 200),

  medium         text not null check (medium in ('film', 'book', 'series', 'music')),
  title          text not null check (length(btrim(title)) > 0),
  -- The form field is free text; the adapter stores a plain year or null.
  year           smallint check (year between 0 and 3000),
  author         text not null default '',   -- book author, music artist
  director       text not null default '',   -- film director, series creator
  cast_members   text not null default '',   -- comma-separated, as in the app
  platform       text not null default '',
  stream_url     text not null default '',
  date_consumed  date,                       -- null when not given
  rating         smallint not null default 0 check (rating between 0 and 5),  -- 0 = unrated
  cover_url      text not null default '',
  insights       text not null default '',   -- always private, even when the entry is shared

  -- Canonical external ids (#26). A book can have both a QID and an Open Library id.
  wikidata_id    text check (wikidata_id ~ '^Q[0-9]+$'),
  openlibrary_id text check (openlibrary_id ~ '^OL[0-9]+W$'),
  itunes_id      text check (itunes_id ~ '^[0-9]+$'),

  -- Sharing level for Phase 6. Only the owner can read rows until then.
  visibility     text not null default 'private'
                 check (visibility in ('private', 'friends', 'public')),

  date_added     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  primary key (user_id, id)
);

-- Cross-user matching on the same work (Phase 6 aggregates).
create index entries_wikidata_id_idx    on public.entries (wikidata_id)    where wikidata_id is not null;
create index entries_openlibrary_id_idx on public.entries (openlibrary_id) where openlibrary_id is not null;
create index entries_itunes_id_idx      on public.entries (itunes_id)      where itunes_id is not null;

create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger entries_set_updated_at
  before update on public.entries
  for each row execute function public.set_updated_at();

-- Row-level security: each signed-in user can only see and change their own rows.
-- The page's public key is visible to everyone, so this must stay on (#31).
alter table public.entries enable row level security;

revoke all on public.entries from anon;
grant select, insert, update, delete on public.entries to authenticated;

create policy "entries: owner can read"
  on public.entries for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "entries: owner can insert"
  on public.entries for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "entries: owner can update"
  on public.entries for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "entries: owner can delete"
  on public.entries for delete to authenticated
  using ((select auth.uid()) = user_id);
