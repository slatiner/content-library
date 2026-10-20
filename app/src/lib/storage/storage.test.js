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

  it('status: a wish stays a wish, anything else is consumed (#47)', () => {
    expect(entryToRow({ ...EXAMPLE[0], status: 'wishlist' }, 'u1').status).toBe('wishlist');
    expect(entryToRow({ ...EXAMPLE[0], status: undefined }, 'u1').status).toBe('consumed');
    expect(rowToEntry({ ...entryToRow(EXAMPLE[0], 'u1'), status: undefined }).status).toBe('consumed');
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
// member is the caller's members row (null = hasn't redeemed an invite); rpc
// maps a function name to its { data, error }.
function fakeClient({ session = null, rows = [], error = null, member = { is_admin: false, default_visibility: 'private' }, rpc = {} } = {}) {
  const log = [];
  const db = { member }; // tests change db.member to simulate the database
  const builder = (table) => {
    const q = { table, calls: [] };
    const chain = new Proxy(q, {
      get(target, prop) {
        if (prop === 'then') {
          log.push(q);
          const data = q.table === 'members' ? db.member
            : q.calls[0][0] === 'select' ? rows.slice(...rangeOf(q)) : null;
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
    db,
    from: builder,
    rpc: async (name, args) => { log.push({ rpc: name, args }); return rpc[name] || { data: null, error: null }; },
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
    expect(status.at(-1)).toEqual(['ok', 'Signed in as me@example.com', 'me@example.com', { name: '', avatarUrl: '', isAdmin: false, defaultVisibility: 'private' }]);
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

  it('an account without an invite is asked for one and loads nothing', async () => {
    const { storage, client, status } = adapterWith({ session, member: null, rows: [entryToRow(EXAMPLE[0], 'u1')] });
    expect(await storage.init()).toBe(null);
    expect(status.at(-1)[0]).toBe('needsInvite');
    expect(client.log.some((q) => q.table === 'entries')).toBe(false);
  });

  it('redeeming an invite calls redeem_invite, then loads the library', async () => {
    const { storage, client, status } = adapterWith({ session, member: null });
    await storage.init();
    client.log.length = 0;
    client.db.member = { is_admin: false }; // what redeem_invite does
    expect(await storage.redeemInvite('abcd-1234-ef56')).toEqual([]);
    expect(client.log[0]).toEqual({ rpc: 'redeem_invite', args: { p_code: 'abcd-1234-ef56' } });
    expect(status.at(-1)[0]).toBe('ok');
  });

  it('a rejected invite code throws the database message', async () => {
    const { storage } = adapterWith({ session, member: null, rpc: { redeem_invite: { data: null, error: { message: 'That invite code has expired. Ask for a new one.' } } } });
    await storage.init();
    await expect(storage.redeemInvite('x')).rejects.toThrow('That invite code has expired. Ask for a new one.');
  });

  it('an empty visibility follows the library default: stored as null', async () => {
    expect(entryToRow({ ...EXAMPLE[0], visibility: '' }, 'u1').visibility).toBe(null);
    expect(rowToEntry({ ...entryToRow(EXAMPLE[0], 'u1'), visibility: null }).visibility).toBe('');
  });

  it('a share link returns the sharer and entries, without notes', async () => {
    const row = entryToRow(EXAMPLE[0], 'u1');
    delete row.insights; delete row.user_id; delete row.visibility;
    const { storage, client } = adapterWith({ rpc: { shared_by_link: { data: [{ owner_name: 'Ada', entry: row }], error: null } } });
    const r = await storage.sharedByLink('tok');
    expect(client.log[0]).toEqual({ rpc: 'shared_by_link', args: { p_token: 'tok' } });
    expect(r.ownerName).toBe('Ada');
    expect(r.entries[0]).toMatchObject({ id: EXAMPLE[0].id, title: EXAMPLE[0].title, insights: '' });
  });

  it('an unknown or revoked share link returns null', async () => {
    const { storage } = adapterWith({ rpc: { shared_by_link: { data: [], error: null } } });
    expect(await storage.sharedByLink('gone')).toBe(null);
  });

  it('says who views a share link without changing the connection or loading a library', async () => {
    expect(await adapterWith().storage.viewer()).toEqual({ state: 'signedOut' });
    const member = adapterWith({ session });
    expect(await member.storage.viewer()).toEqual({ state: 'member', email: 'me@example.com' });
    expect(member.status).toEqual([]);
    expect(member.client.log.some((q) => q.table === 'entries')).toBe(false);
    const newcomer = adapterWith({ session, member: null });
    expect(await newcomer.storage.viewer()).toEqual({ state: 'needsInvite', email: 'me@example.com', requestedAt: '' });
  });

  it('joining from a share link redeems without loading the library; asking for a code calls request_access', async () => {
    const { storage, client, status } = adapterWith({ session, member: null });
    await storage.viewer();
    await storage.joinWithCode('abcd-1234-ef56');
    await storage.requestAccess('hi');
    expect(client.log).toContainEqual({ rpc: 'redeem_invite', args: { p_code: 'abcd-1234-ef56' } });
    expect(client.log).toContainEqual({ rpc: 'request_access', args: { p_message: 'hi' } });
    expect(status).toEqual([]);
  });

  it('changing the library default updates own members row and the profile', async () => {
    const { storage, client, status } = adapterWith({ session });
    await storage.init();
    client.log.length = 0;
    await storage.setDefaultVisibility('public');
    expect(client.log[0].table).toBe('members');
    expect(client.log[0].calls).toEqual([['update', { default_visibility: 'public' }], ['eq', 'user_id', 'u1']]);
    expect(status.at(-1)[3].defaultVisibility).toBe('public');
  });

  it('admins are flagged in the profile and can create invites', async () => {
    const created = { code: 'ABCD-1234-EF56', expires_at: '2026-10-30T00:00:00Z' };
    const { storage, status } = adapterWith({ session, member: { is_admin: true }, rpc: { create_invite: { data: created, error: null } } });
    await storage.init();
    expect(status.at(-1)[3].isAdmin).toBe(true);
    expect(await storage.createInvite()).toEqual({ code: 'ABCD-1234-EF56', expiresAt: '2026-10-30T00:00:00Z' });
  });
});
