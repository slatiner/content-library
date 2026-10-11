#!/usr/bin/env node
// Import a media-archive JSON file into the Supabase entries table (#14).
//
//   node scripts/import-json.mjs --owner <email> [--file media-archive-data.json] [--dry-run]
//
// Uses the secret key from secrets.json (server side only, bypasses row rules).
// Creates the owner's auth user if it doesn't exist yet. Re-runnable: rows are
// upserted on (user_id, id), so a second run updates instead of duplicating.

import { readFile } from 'node:fs/promises';
import { entryToRow, parseYear } from '../app/src/lib/storage/rows.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const ownerEmail = opt('--owner');
const file = opt('--file', 'media-archive-data.json');
const dryRun = args.includes('--dry-run');
if (!ownerEmail) {
  console.error('Usage: node scripts/import-json.mjs --owner <email> [--file <path>] [--dry-run]');
  process.exit(2);
}

const MEDIA = ['film', 'book', 'series', 'music'];

function toRow(e, userId) {
  const problems = [];
  if (!e.id) problems.push('missing id');
  if (!MEDIA.includes(e.medium)) problems.push(`unknown medium "${e.medium}"`);
  if (!String(e.title ?? '').trim()) problems.push('empty title');
  const rating = Number(e.rating ?? 0);
  if (!Number.isInteger(rating) || rating < 0 || rating > 5) problems.push(`bad rating ${e.rating}`);
  if (parseYear(e.year) === undefined) problems.push(`unparseable year "${e.year}"`);
  const date = String(e.dateConsumed ?? '').trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push(`bad dateConsumed "${date}"`);
  return problems.length ? { problems } : { row: entryToRow(e, userId) };
}

const secrets = JSON.parse(await readFile('secrets.json', 'utf8'));
const { url, secretKey } = secrets.supabase || {};
if (!url || !secretKey) throw new Error('secrets.json is missing supabase.url or supabase.secretKey');
const headers = { apikey: secretKey, 'Content-Type': 'application/json' };

async function api(path, init = {}) {
  const res = await fetch(url + path, { ...init, headers: { ...headers, ...init.headers } });
  const body = await res.text();
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${res.status}: ${body}`);
  return body ? JSON.parse(body) : null;
}

async function findOrCreateUser(email) {
  const wanted = email.toLowerCase();
  for (let page = 1; ; page++) {
    const { users } = await api(`/auth/v1/admin/users?page=${page}&per_page=200`);
    const hit = users.find((u) => (u.email || '').toLowerCase() === wanted);
    if (hit) return { id: hit.id, created: false };
    if (users.length < 200) break;
  }
  if (dryRun) return { id: '00000000-0000-0000-0000-000000000000', created: 'would create' };
  const user = await api('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, email_confirm: true }),
  });
  return { id: user.id, created: true };
}

const entries = JSON.parse(await readFile(file, 'utf8'));
if (!Array.isArray(entries)) throw new Error(`${file} is not a JSON array`);

const owner = await findOrCreateUser(ownerEmail);
console.log(`Owner ${ownerEmail}: ${owner.id} (${owner.created === true ? 'created' : owner.created || 'existing'})`);

const rows = [];
const seen = new Set();
for (const e of entries) {
  const { row, problems } = toRow(e, owner.id);
  if (problems) { console.log(`skip ${e.id || '(no id)'} "${e.title}": ${problems.join(', ')}`); continue; }
  if (seen.has(row.id)) { console.log(`skip duplicate id ${row.id}`); continue; }
  seen.add(row.id);
  rows.push(row);
}
console.log(`${rows.length} of ${entries.length} entries ready`);

if (dryRun) { console.log('Dry run: nothing written.'); process.exit(0); }

await api('/rest/v1/entries?on_conflict=user_id,id', {
  method: 'POST',
  headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify(rows),
});
const count = await api(`/rest/v1/entries?select=id&user_id=eq.${owner.id}`);
console.log(`Upserted ${rows.length}. Owner now has ${count.length} entries in Supabase.`);
