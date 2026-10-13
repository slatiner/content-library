#!/usr/bin/env node
// Fill canonical external ids on entries that have none (#26).
//
//   node scripts/backfill-ids.mjs [--dry-run]
//
// Films, series and books get a Wikidata id (books also an Open Library work
// id); music gets the iTunes album id. A match is kept only when the title and
// medium agree and, if the entry has a year, the year is within one. Anything
// unclear is listed and left alone. Writes only the three id columns, using the
// secret key from secrets.json. Requests are spaced out: Wikidata answers bursts
// with HTTP 429.

import { readFile } from 'node:fs/promises';
import { linkKey } from '../app/src/lib/entries.js';
import {
  wikidataSearch, candidateMatchesMedium, wikidataGetEntity, wikidataYear,
  openLibraryWork, openLibrarySearchWork,
} from '../app/src/lib/lookup.js';

const dryRun = process.argv.includes('--dry-run');
const GAP_MS = 1100;

// Wikimedia asks scripts to identify themselves.
const UA = 'content-library-backfill/0.1 (https://github.com/slatiner/content-library)';
const plainFetch = globalThis.fetch;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
globalThis.fetch = async (url, init = {}) => {
  await sleep(GAP_MS);
  const go = () => plainFetch(url, { ...init, headers: { 'User-Agent': UA, ...init.headers } });
  let res = await go();
  if (res.status === 429) { console.log('  429, waiting 30s'); await sleep(30000); res = await go(); }
  return res;
};

const secrets = JSON.parse(await readFile('secrets.json', 'utf8'));
const { url, secretKey } = secrets.supabase || {};
if (!url || !secretKey) throw new Error('secrets.json is missing supabase.url or supabase.secretKey');
async function api(path, init = {}) {
  const res = await plainFetch(url + path, { ...init, headers: { apikey: secretKey, 'Content-Type': 'application/json', ...init.headers } });
  const body = await res.text();
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${res.status}: ${body}`);
  return body ? JSON.parse(body) : null;
}

const same = (a, b) => linkKey({ title: a }) === linkKey({ title: b });
const yearOk = (want, got) => !want || (got && Math.abs(Number(got) - want) <= 1);

async function matchWikidata(e) {
  const candidates = (await wikidataSearch(e.title)).filter((c) => candidateMatchesMedium(c, e.medium) && same(c.label, e.title));
  const hits = [];
  for (const c of candidates.slice(0, 3)) {
    const entity = await wikidataGetEntity(c.id);
    const year = wikidataYear(entity, e.medium);
    if (yearOk(e.year, year)) hits.push({ c, entity, year });
  }
  if (hits.length !== 1) return { why: hits.length ? `${hits.length} candidates: ${hits.map((h) => h.c.id).join(', ')}` : 'no matching candidate' };
  const { c, entity, year } = hits[0];
  const ids = { wikidata_id: c.id };
  if (e.medium === 'book') ids.openlibrary_id = openLibraryWork(entity.claims) || (await openLibrarySearchWork(e.title, e.author)) || null;
  return { ids, label: `${c.label} (${year || '?'}) — ${c.description}` };
}

async function matchItunes(e) {
  const term = encodeURIComponent(`${e.title} ${e.author || ''}`.trim());
  const res = await fetch(`https://itunes.apple.com/search?term=${term}&media=music&entity=album&limit=5`);
  if (!res.ok) return { why: `iTunes HTTP ${res.status}` };
  const artist = linkKey({ title: e.author });
  const hits = ((await res.json()).results || []).filter((r) =>
    linkKey({ title: r.collectionName }).startsWith(linkKey({ title: e.title }))
    && (!e.author || linkKey({ title: r.artistName }).includes(artist.slice(1))));
  if (!hits.length) return { why: 'no matching album' };
  const r = hits[0];
  return { ids: { itunes_id: String(r.collectionId) }, label: `${r.collectionName} — ${r.artistName} (${(r.releaseDate || '').slice(0, 4)})` };
}

const rows = await api('/rest/v1/entries?select=user_id,id,medium,title,year,author&wikidata_id=is.null&openlibrary_id=is.null&itunes_id=is.null&order=medium,title');
console.log(`${rows.length} entries without ids${dryRun ? ' (dry run, nothing written)' : ''}\n`);

const skipped = [];
let filled = 0;
for (const e of rows) {
  let m;
  try {
    m = e.medium === 'music' ? await matchItunes(e) : await matchWikidata(e);
  } catch (err) {
    m = { why: err.message };
  }
  if (!m.ids) { skipped.push(`${e.medium} "${e.title}" (${e.year || 'no year'}): ${m.why}`); continue; }
  console.log(`${e.medium.padEnd(6)} ${e.title} (${e.year || '-'}) -> ${Object.values(m.ids).filter(Boolean).join(' ')}  ${m.label}`);
  if (!dryRun) {
    await api(`/rest/v1/entries?user_id=eq.${e.user_id}&id=eq.${encodeURIComponent(e.id)}`, { method: 'PATCH', body: JSON.stringify(m.ids) });
  }
  filled++;
}
console.log(`\n${dryRun ? 'Would fill' : 'Filled'} ${filled}; left alone ${skipped.length}:`);
for (const s of skipped) console.log('  ' + s);
