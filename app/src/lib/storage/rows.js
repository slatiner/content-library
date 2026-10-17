// Mapping between app entries (camelCase, the shape in
// media-archive-data.example.json) and rows of the Supabase entries table
// (snake_case, supabase/migrations/). Used by the Supabase adapter and by
// scripts/import-json.mjs.

const text = (v) => String(v ?? '').trim();
const orNull = (v) => text(v) || null;

// The form's year is free text; the table stores a plain year or null.
// Returns undefined when there is text but no year in it.
export function parseYear(v) {
  const s = text(v);
  if (!s) return null;
  const m = s.match(/\d{4}/) || s.match(/^\d{1,4}$/);
  return m ? Number(m[0]) : undefined;
}

export function entryToRow(e, userId) {
  const row = {
    id: e.id,
    medium: e.medium,
    title: text(e.title),
    year: parseYear(e.year) ?? null,
    author: text(e.author),
    director: text(e.director),
    cast_members: text(e.cast),
    platform: text(e.platform),
    stream_url: text(e.streamUrl),
    date_consumed: text(e.dateConsumed) || null,
    rating: Number(e.rating) || 0,
    cover_url: text(e.coverUrl),
    insights: text(e.insights),
    wikidata_id: orNull(e.wikidataId),
    openlibrary_id: orNull(e.openlibraryId),
    itunes_id: orNull(e.itunesId),
    // '' follows the library's default level (#20).
    visibility: e.visibility || null,
    date_added: new Date(Number(e.dateAdded) || Date.now()).toISOString(),
  };
  if (userId) row.user_id = userId;
  return row;
}

export function rowToEntry(r) {
  return {
    id: r.id,
    medium: r.medium,
    title: r.title,
    year: r.year == null ? '' : String(r.year),
    author: r.author || '',
    director: r.director || '',
    cast: r.cast_members || '',
    platform: r.platform || '',
    streamUrl: r.stream_url || '',
    dateConsumed: r.date_consumed || '',
    rating: r.rating || 0,
    coverUrl: r.cover_url || '',
    insights: r.insights || '',
    wikidataId: r.wikidata_id || '',
    openlibraryId: r.openlibrary_id || '',
    itunesId: r.itunes_id || '',
    visibility: r.visibility || '',
    dateAdded: Date.parse(r.date_added) || Date.now(),
  };
}
