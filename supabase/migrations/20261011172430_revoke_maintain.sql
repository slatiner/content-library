-- Postgres 17's MAINTAIN privilege (VACUUM, ANALYZE, REINDEX, LOCK...) came with
-- Supabase's default grants. Signed-in users only need the four row operations.
revoke maintain on public.entries from authenticated;
