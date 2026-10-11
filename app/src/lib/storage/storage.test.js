// Tests for the row mapping and the Supabase adapter, against a fake client
// that records the queries it would send.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { entryToRow, rowToEntry, parseYear } from './rows.js';
import { createSupabaseStorage } from './supabaseStorage.js';

const EXAMPLE = JSON.parse(readFileSync('media-archive-data.example.json', 'utf8'));

describe('row mapping', () => {
  it('round-trips every example entry unchanged', () => {
    for (const e of EXAMPLE) expect(rowToEntry(entryToRow(e, 'u1'))).toEqual(e);
  });

  it('maps fields to columns', () => {
    const row = entryToRow({ ...EXAMPLE[0], year: '', dateConsumed: '', wikidataId: 'Q1' }, 'u1');
    expect(row).toMatchObject({ user_id: 'u1', year: null, date_consumed: null, cast_members: '', wikidata_id: 'Q1', openlibrary_id: null });
    expect(row.date_added).toBe(new Date(EXAMPLE[0].dateAdded).toISOString());
  });

  it('reads a year out of free text', () => {
    expect(parseYear('2019')).toBe(2019);
    expect(parseYear('2019–2022')).toBe(2019);
    expect(parseYear('')).toBe(null);
    expect(parseYear('soon')).toBe(undefined);
  });
});

// A fake supabase-js client. Query builders record their calls and resolve
// to { data, error } when awaited.
function fakeClient({ session = null, rows = [], error = null } = {}) {
  const log = [];
  const builder = (table) => {
    const q = { table, calls: [] };
    const chain = new Proxy(q, {
      get(target, prop) {
        if (prop === 'then') {
          log.push(q);
          const data = q.calls[0][0] === 'select' ? rows.slice(...rangeOf(q)) : null;
          return (resolve) => resolve({ data, error });
        }
        return (...args) => { q.calls.push([prop, ...args]); return chain; };
      },
    });
    return chain;
  };
  const rangeOf = (q) => { const r = q.calls.find((c) => c[0] === 'range'); return r ? [r[1], r[2] + 1] : []; };
  return {
    log,
    from: builder,
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      signInWithOAuth: async (opts) => { log.push({ oauth: opts }); return { error: null }; },
      signOut: async () => { log.push({ signOut: true }); return { error: null }; },
    },
  };
}

const session = { user: { id: 'u1', email: 'me@example.com' } };

function adapterWith(clientOpts) {
  const status = [];
  const client = fakeClient(clientOpts);
  const storage = createSupabaseStorage((...s) => status.push(s), { client });
  return { storage, client, status };
}

describe('Supabase adapter', () => {
  it('without a session reports signedOut and loads nothing', async () => {
    const { storage, status } = adapterWith();
    expect(await storage.init()).toBe(null);
    expect(status.at(-1)[0]).toBe('signedOut');
  });

  it('with a session loads the rows as entries', async () => {
    const rows = EXAMPLE.map((e) => entryToRow(e, 'u1'));
    const { storage, status } = adapterWith({ session, rows });
    expect(await storage.init()).toEqual(EXAMPLE);
    expect(status.at(-1)).toEqual(['ok', 'Signed in as me@example.com', 'me@example.com']);
  });

  it('a load error is reported, not thrown', async () => {
    const { storage, status } = adapterWith({ session, error: { message: 'boom' } });
    expect(await storage.init()).toBe(null);
    expect(status.at(-1)[0]).toBe('warn');
    expect(status.at(-1)[1]).toContain('boom');
  });

  it('sign-in uses Google and returns to this page', async () => {
    const { storage, client } = adapterWith();
    await storage.connect();
    expect(client.log[0].oauth).toEqual({ provider: 'google', options: { redirectTo: window.location.origin + window.location.pathname } });
  });

  it('saves one entry as an upsert on (user_id, id)', async () => {
    const { storage, client } = adapterWith({ session });
    await storage.init();
    client.log.length = 0;
    await storage.saveEntry(EXAMPLE[1]);
    const q = client.log[0];
    expect(q.calls[0][0]).toBe('upsert');
    expect(q.calls[0][1]).toMatchObject({ user_id: 'u1', id: EXAMPLE[1].id, title: 'Steppenwolf' });
    expect(q.calls[0][2]).toEqual({ onConflict: 'user_id,id' });
  });

  it('a save error is thrown so the page can warn', async () => {
    const { storage } = adapterWith({ session });
    await storage.init();
    const failing = adapterWith({ session, error: { message: 'check constraint' } });
    await failing.storage.init();
    await expect(failing.storage.saveEntry(EXAMPLE[0])).rejects.toThrow('Could not save: check constraint');
  });

  it('replaceAll upserts the list and deletes the user rows not in it', async () => {
    const { storage, client } = adapterWith({ session });
    await storage.init();
    client.log.length = 0;
    await storage.replaceAll(EXAMPLE.slice(0, 2));
    const [up, del] = client.log;
    expect(up.calls[0][0]).toBe('upsert');
    expect(up.calls[0][1]).toHaveLength(2);
    expect(del.calls).toEqual([
      ['delete'],
      ['eq', 'user_id', 'u1'],
      ['not', 'id', 'in', `("${EXAMPLE[0].id}","${EXAMPLE[1].id}")`],
    ]);
  });
});
