-- Tighten table privileges (#31).
--
-- Supabase's defaults grant ALL on every new public table to anon and
-- authenticated. Row-level security doesn't cover TRUNCATE, so limit signed-in
-- users on entries to the four row operations the policies govern.
revoke truncate, references, trigger on public.entries from authenticated;

-- New tables start closed to the page's keys: each migration that adds a table
-- must enable RLS, add policies and grant what it needs explicitly, as
-- create_entries does. service_role keeps its default grants.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
