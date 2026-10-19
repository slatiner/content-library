// Component tests: mount the real app with a fake storage adapter and a fake
// network, then click through it. Real folder permissions and file writes can't
// be simulated here.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { readFileSync } from 'node:fs';

// Read from disk: the dev server config blocks media-archive-data*.json imports.
import { todayLocalIso } from './lib/entries.js';

const EXAMPLE = JSON.parse(readFileSync('media-archive-data.example.json', 'utf8'));

let state, App, adapter;

function fakeAdapter(initial, connState = 'ok', kind = 'file') {
  const calls = [];
  const account = kind === 'supabase' ? 'me@example.com' : '';
  return {
    kind,
    calls,
    async init() {
      const profile = kind === 'supabase' ? { name: 'Ada Lovelace', avatarUrl: '' } : null;
      const signedIn = connState === 'ok' || connState === 'needsInvite';
      state.setConnection(connState, connState === 'ok' ? 'Connected' : 'Not connected', signedIn ? account : '', profile);
      return connState === 'ok' ? structuredClone(initial) : null;
    },
    async connect() { calls.push(['connect']); return null; },
    async signOut() { calls.push(['signOut']); state.setConnection('signedOut', 'Signed out.'); },
    async reconnect() { state.setConnection('ok', 'Connected'); return structuredClone(initial); },
    async saveEntry(entry, all) { calls.push(['save', entry, all.length]); },
    async deleteEntry(id, all) { calls.push(['delete', id, all.length]); },
    async replaceAll(all) { calls.push(['replaceAll', all.length]); },
    async readSecrets() { return { groq: { apiKey: 'gsk_test' } }; },
    ...(kind === 'supabase' && {
      // 'GOOD-CODE' joins; anything else is rejected like the database does.
      async redeemInvite(code) {
        calls.push(['redeem', code]);
        if (code !== 'GOOD-CODE') throw new Error('That invite code isn\'t valid. Check it and try again.');
        state.setConnection('ok', 'Connected', account, { name: 'Ada Lovelace', avatarUrl: '', isAdmin: false });
        return [];
      },
      async setDefaultVisibility(level) {
        calls.push(['setDefault', level]);
        state.setConnection('ok', 'Connected', account, { ...state.connection.profile, defaultVisibility: level });
      },
      async shareLink(entryId) { calls.push(['shareLink', entryId]); return 'tok123'; },
      async listShareLinks() { return [{ token: 'tok123', entryId: null, createdAt: '2026-10-17T00:00:00Z' }]; },
      async revokeShareLink(token) { calls.push(['revoke', token]); },
      async sharedByLink(token) {
        calls.push(['sharedByLink', token]);
        if (token !== 'tok123') return null;
        return { ownerName: 'Ada Lovelace', entries: structuredClone(initial).map((e) => ({ ...e, insights: '' })) };
      },
      async exportAccount() {
        calls.push(['exportAccount']);
        return { exportedAt: '2026-10-19T10:00:00.000Z', account: { email: account }, entries: structuredClone(initial), shareLinks: [], invitesCreated: [] };
      },
      // Fails for an admin, like the last-admin rule in the database.
      async deleteAccount() {
        calls.push(['deleteAccount']);
        if (state.connection.profile?.isAdmin) throw new Error("You're the only admin, so this account can't be deleted.");
        state.setConnection('signedOut', 'Your account and its data have been deleted.');
      },
      async createInvite() { calls.push(['createInvite']); return { code: 'ABCD-1234-EF56', expiresAt: '2026-10-30T00:00:00Z' }; },
      async listInvites() {
        return [
          { code: 'ABCD-1234-EF56', createdAt: '2026-10-16T00:00:00Z', expiresAt: '2099-10-30T00:00:00Z', usedAt: null },
          { code: '0000-1111-2222', createdAt: '2026-09-01T00:00:00Z', expiresAt: '2026-09-15T00:00:00Z', usedAt: null },
        ];
      },
      async llmEndpoint() { return { url: 'https://proj.supabase.co/functions/v1/groq', headers: { Authorization: 'Bearer user-token', apikey: 'sb_publishable_x' } }; },
    }),
  };
}

// Fake network: Groq answers come from `groqAnswer`; lookups find nothing.
let groqAnswer;
// groqAnswer is one answer, or { library_filter, library_entry } keyed by task.
function fakeFetch(url, init) {
  const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  if (url.startsWith('https://api.groq.com/') || url.endsWith('/functions/v1/groq')) {
    const task = JSON.parse(init.body).response_format.json_schema.name;
    const answer = groqAnswer && groqAnswer[task] ? groqAnswer[task] : groqAnswer;
    return json({ choices: [{ message: { content: JSON.stringify(answer) } }] });
  }
  if (url.includes('wbsearchentities')) return json({ search: [] });
  return json({});
}

async function mountApp(initial = EXAMPLE, connState = 'ok', kind = 'file') {
  vi.resetModules();
  state = await import('./state.js');
  App = (await import('./App.vue')).default;
  adapter = fakeAdapter(initial, connState, kind);
  state.useStorage(adapter);
  const wrapper = mount(App, { attachTo: document.body });
  await flushPromises();
  return wrapper;
}

const titles = (w) => w.findAll('.card h3').map((h) => h.text().replace(/\s*\(\d{4}\)$/, ''));

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  vi.stubGlobal('confirm', vi.fn(() => true));
  vi.stubGlobal('alert', vi.fn());
  groqAnswer = null;
});

describe('library view', () => {
  it('shows every entry and the counts', async () => {
    const w = await mountApp();
    expect(w.findAll('.card')).toHaveLength(4);
    expect(w.find('.counts').text()).toBe('1 books1 films1 series1 music');
    // Default sort: recently consumed first.
    expect(titles(w)).toEqual(['In Rainbows', 'Paprika', 'Silo', 'Steppenwolf']);
  });

  it('clicking one type tag with all on shows only that type, then toggles', async () => {
    const w = await mountApp();
    await w.find('.tag-check.film').trigger('click');
    expect(titles(w)).toEqual(['Paprika']);
    await w.find('.tag-check.book').trigger('click');
    expect(titles(w).sort()).toEqual(['Paprika', 'Steppenwolf']);
  });

  it('text search filters titles, people and notes', async () => {
    const w = await mountApp();
    await w.find('.filter-row input[type=text]').setValue('hesse');
    expect(titles(w)).toEqual(['Steppenwolf']);
    await w.find('.filter-row input[type=text]').setValue('friend');
    expect(titles(w)).toEqual(['Paprika']);
  });

  it('sorts by title; dates set by an ask still filter, with no date control', async () => {
    const w = await mountApp();
    expect(w.find('.filter-bar input[type=date]').exists()).toBe(false);
    await w.find('select').setValue('title_asc');
    expect(titles(w)).toEqual(['In Rainbows', 'Paprika', 'Silo', 'Steppenwolf']);
    state.filters.dateFrom = '2026-08-05';
    state.filters.dateTo = '2026-08-12';
    await flushPromises();
    expect(titles(w)).toEqual(['Paprika']);
  });

  it('says read, watched or listened instead of consumed', async () => {
    const w = await mountApp();
    const hover = (t) => w.findAll('.card').find((c) => c.text().includes(t)).find('.hi-date').text();
    expect(hover('Steppenwolf')).toMatch(/^Read /);
    expect(hover('Paprika')).toMatch(/^Watched /);
    expect(hover('In Rainbows')).toMatch(/^Listened /);
    expect(w.find('.grid').text()).not.toMatch(/consumed/i);
    await w.findAll('.card').find((c) => c.text().includes('Steppenwolf')).trigger('click');
    expect(w.findAll('.field label').map((l) => l.text())).toContain('Date read');
  });

  it('deletes an entry after confirming', async () => {
    const w = await mountApp();
    await w.find('.card .del').trigger('click');
    expect(confirm).toHaveBeenCalled();
    expect(w.findAll('.card')).toHaveLength(3);
    expect(adapter.calls[0][0]).toBe('delete');
  });

  it('shows Reconnect when the folder needs permission again', async () => {
    const w = await mountApp(EXAMPLE, 'warn');
    expect(w.find('.card').exists()).toBe(false);
    const btn = w.findAll('.filebar button').find((b) => b.text() === 'Reconnect');
    await btn.trigger('click');
    await flushPromises();
    expect(w.findAll('.card')).toHaveLength(4);
  });
});

describe('signing in (Supabase storage)', () => {
  it('signed out: shows only the sign-in button, which starts Google sign-in', async () => {
    const w = await mountApp(EXAMPLE, 'signedOut', 'supabase');
    expect(w.find('.card').exists()).toBe(false);
    expect(w.find('.add-new-btn').exists()).toBe(false);
    await w.findAll('button').find((b) => b.text() === 'Sign in with Google').trigger('click');
    expect(adapter.calls).toEqual([['connect']]);
  });

  it('shows the Google picture, and initials if it fails to load', async () => {
    const w = await mountApp(EXAMPLE, 'ok', 'supabase');
    state.setConnection('ok', 'Connected', 'me@example.com', { name: 'Ada Lovelace', avatarUrl: 'https://lh3.googleusercontent.com/a/pic' });
    await flushPromises();
    const img = w.find('.avatar img');
    expect(img.attributes('src')).toBe('https://lh3.googleusercontent.com/a/pic');
    expect(img.attributes('referrerpolicy')).toBe('no-referrer');
    await img.trigger('error');
    expect(w.find('.avatar-initials').text()).toBe('AL');
  });

  it('file mode: the ⚙ menu has folder actions and no Sign out', async () => {
    const w = await mountApp();
    expect(w.find('.avatar-btn').exists()).toBe(false);
    await w.find('.account-menu .icon-btn').trigger('click');
    const labels = w.findAll('.account-menu .popover button').map((b) => b.text());
    expect(labels).toEqual(['Change folder', 'Diagnose connection', 'Export / Import JSON']);
  });

  it('signed in: shows the account, no folder controls, and signs out', async () => {
    const w = await mountApp(EXAMPLE, 'ok', 'supabase');
    // An avatar instead of the email: initials when there's no picture, email on hover.
    expect(w.find('.header-right').text() + w.find('.avatar-btn').text()).not.toContain('me@example.com');
    expect(w.find('.avatar').attributes('title')).toBe('Ada Lovelace (me@example.com)');
    expect(w.find('.avatar-initials').text()).toBe('AL');
    expect(w.find('.icon-btn').exists()).toBe(false);
    // One menu, opened from the avatar: who you are, settings, Sign out.
    await w.find('.avatar-btn').trigger('click');
    const menu = w.find('.account-menu .popover');
    expect(menu.classes()).toContain('open');
    expect(menu.find('.menu-who').text()).toContain('me@example.com');
    expect(menu.findAll('button').map((b) => b.text())).toEqual(['Sharing', 'Diagnose connection', 'Export / Import JSON', 'Your data', 'Sign out']);
    await menu.findAll('button').find((b) => b.text() === 'Sign out').trigger('click');
    await flushPromises();
    expect(adapter.calls.at(-1)).toEqual(['signOut']);
    expect(w.find('.card').exists()).toBe(false);
    expect(w.text()).toContain('Sign in with Google');
  });
});

describe('invites', () => {
  it('a new account without an invite sees only the code field; a bad code shows the error', async () => {
    const w = await mountApp(EXAMPLE, 'needsInvite', 'supabase');
    expect(w.find('.card').exists()).toBe(false);
    expect(w.find('.add-new-btn').exists()).toBe(false);
    expect(w.find('.redeem').text()).toContain('me@example.com');
    await w.find('.redeem input').setValue('nope');
    await w.find('.redeem').trigger('submit');
    await flushPromises();
    expect(w.find('.redeem-error').text()).toContain("isn't valid");
    await w.find('.redeem input').setValue('GOOD-CODE');
    await w.find('.redeem').trigger('submit');
    await flushPromises();
    expect(adapter.calls.at(-1)).toEqual(['redeem', 'GOOD-CODE']);
    expect(w.find('.redeem').exists()).toBe(false);
    expect(w.text()).toContain('Nothing here yet');
  });

  it('an invite link survives the sign-in round trip and fills in the code', async () => {
    window.history.replaceState(null, '', '/?invite=ABCD-1234-EF56');
    let w = await mountApp(EXAMPLE, 'signedOut', 'supabase');
    expect(w.text()).toContain("You've been invited");
    expect(window.location.search).toBe('');
    w.unmount();
    w = await mountApp(EXAMPLE, 'needsInvite', 'supabase');
    expect(w.find('.redeem input').element.value).toBe('ABCD-1234-EF56');
    localStorage.clear();
  });

  it('only admins see Invite someone; it creates a code and lists recent ones', async () => {
    const w = await mountApp(EXAMPLE, 'ok', 'supabase');
    await w.find('.avatar-btn').trigger('click');
    expect(w.findAll('.account-menu .popover button').map((b) => b.text())).not.toContain('Invite someone');
    state.setConnection('ok', 'Connected', 'me@example.com', { name: 'Ada Lovelace', avatarUrl: '', isAdmin: true });
    await flushPromises();
    await w.findAll('.account-menu .popover button').find((b) => b.text() === 'Invite someone').trigger('click');
    await flushPromises();
    expect(w.find('.invite-list').text()).toContain('unused, expires');
    expect(w.find('.invite-list').text()).toContain('expired');
    await w.findAll('button').find((b) => b.text() === 'Create invite code').trigger('click');
    await flushPromises();
    expect(adapter.calls.at(-1)).toEqual(['createInvite']);
    expect(w.find('.invite-code').text()).toBe('ABCD-1234-EF56');
    expect(w.find('.invite-new input').element.value).toMatch(/\?invite=ABCD-1234-EF56$/);
  });
});

describe('your data (#29)', () => {
  const openYourData = async (w) => {
    await w.find('.avatar-btn').trigger('click');
    await w.findAll('.account-menu .popover button').find((b) => b.text() === 'Your data').trigger('click');
  };

  it('the sign-in screen links the privacy policy', async () => {
    const w = await mountApp(EXAMPLE, 'signedOut', 'supabase');
    expect(w.find('.setup-foot a').attributes('href')).toBe('privacy.html');
  });

  it('downloads everything as one JSON file', async () => {
    const blobs = [];
    URL.createObjectURL = vi.fn((b) => { blobs.push(b); return 'blob:x'; });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const w = await mountApp(EXAMPLE, 'ok', 'supabase');
    await openYourData(w);
    await w.findAll('button').find((b) => b.text() === 'Download my data').trigger('click');
    await flushPromises();
    expect(adapter.calls.at(-1)).toEqual(['exportAccount']);
    expect(click.mock.contexts[0].download).toBe('my-media-data-2026-10-19.json');
    expect(JSON.parse(await blobs[0].text()).entries).toHaveLength(EXAMPLE.length);
    expect(w.text()).toContain(`Downloaded ${EXAMPLE.length} entries.`);
    click.mockRestore();
  });

  it('deletes the account only after typing delete, then shows the sign-in screen', async () => {
    const w = await mountApp(EXAMPLE, 'ok', 'supabase');
    await openYourData(w);
    await w.findAll('button').find((b) => b.text() === 'Delete my account…').trigger('click');
    const go = () => w.findAll('button').find((b) => b.text() === 'Delete everything');
    await w.find('.account-delete input').setValue('yes');
    expect(go().attributes('disabled')).toBeDefined();
    await w.find('.account-delete input').setValue('Delete');
    await w.find('.account-delete form').trigger('submit');
    await flushPromises();
    expect(adapter.calls.at(-1)).toEqual(['deleteAccount']);
    expect(w.find('.card').exists()).toBe(false);
    expect(w.text()).toContain('Your account and its data have been deleted.');
    expect(w.text()).toContain('Sign in with Google');
  });

  it('shows why a deletion was refused', async () => {
    const w = await mountApp(EXAMPLE, 'ok', 'supabase');
    state.setConnection('ok', 'Connected', 'me@example.com', { name: 'Ada Lovelace', avatarUrl: '', isAdmin: true });
    await flushPromises();
    await openYourData(w);
    await w.findAll('button').find((b) => b.text() === 'Delete my account…').trigger('click');
    await w.find('.account-delete input').setValue('delete');
    await w.find('.account-delete form').trigger('submit');
    await flushPromises();
    expect(w.text()).toContain("You're the only admin");
    expect(w.findAll('.card')).toHaveLength(EXAMPLE.length);
  });

  it('a new account waiting for an invite can still delete itself', async () => {
    const w = await mountApp(EXAMPLE, 'needsInvite', 'supabase');
    await w.find('.redeem .link-btn').trigger('click');
    expect(w.find('.account-delete').exists()).toBe(true);
  });
});

describe('sharing', () => {
  it('online, an entry follows the library default unless set, and shows a badge when not public', async () => {
    const w = await mountApp(EXAMPLE, 'ok', 'supabase');
    state.setConnection('ok', 'Connected', 'me@example.com', { name: 'Ada Lovelace', avatarUrl: '', defaultVisibility: 'public' });
    await flushPromises();
    // EXAMPLE[1] (Steppenwolf) is explicitly private; the rest follow the default.
    expect(w.findAll('.level-badge').map((b) => b.text())).toEqual(['Only me']);
    const card = w.findAll('.card').find((c) => c.text().includes('Paprika'));
    await card.trigger('click');
    const select = w.find('.visibility-field select');
    expect(select.element.value).toBe('');
    expect(select.find('option').text()).toContain('Library default (Public');
    await select.setValue('friends');
    await w.findAll('.form-actions button').find((b) => b.text() === 'Save').trigger('click');
    await flushPromises();
    expect(adapter.calls.at(-1)[1]).toMatchObject({ title: 'Paprika', visibility: 'friends' });
    expect(w.findAll('.level-badge').map((b) => b.text()).sort()).toEqual(['Friends', 'Only me']);
  });

  it('an entry can be shared by link from its form', async () => {
    const w = await mountApp(EXAMPLE, 'ok', 'supabase');
    await w.findAll('.card')[0].trigger('click');
    await w.findAll('button').find((b) => b.text() === 'Copy share link').trigger('click');
    await flushPromises();
    expect(adapter.calls.at(-1)).toEqual(['shareLink', EXAMPLE.find((e) => e.title === 'In Rainbows').id]);
  });

  it('file mode has no sharing controls', async () => {
    const w = await mountApp();
    expect(w.find('.level-badge').exists()).toBe(false);
    await w.findAll('.card')[0].trigger('click');
    expect(w.find('.visibility-field').exists()).toBe(false);
  });

  it('Sharing settings change the default, copy a library link and revoke links', async () => {
    const w = await mountApp(EXAMPLE, 'ok', 'supabase');
    await w.find('.avatar-btn').trigger('click');
    await w.findAll('.account-menu .popover button').find((b) => b.text() === 'Sharing').trigger('click');
    await flushPromises();
    const panel = w.findAll('.form-panel').find((p) => p.find('h2').text() === 'Sharing');
    await panel.find('select').setValue('public');
    await flushPromises();
    expect(adapter.calls).toContainEqual(['setDefault', 'public']);
    await panel.findAll('button').find((b) => b.text() === 'Copy library link').trigger('click');
    await flushPromises();
    expect(adapter.calls).toContainEqual(['shareLink', null]);
    expect(panel.find('.share-list').text()).toContain('Whole library');
    await panel.findAll('button').find((b) => b.text() === 'Revoke').trigger('click');
    await flushPromises();
    expect(adapter.calls.at(-1)).toEqual(['revoke', 'tok123']);
  });

  it('a share link opens a read-only library without signing in', async () => {
    window.history.replaceState(null, '', '/?share=tok123');
    const w = await mountApp(EXAMPLE, 'signedOut', 'supabase');
    expect(adapter.calls[0]).toEqual(['sharedByLink', 'tok123']);
    expect(w.find('.filebar').text()).toContain('Shared by Ada Lovelace');
    expect(w.findAll('.card')).toHaveLength(4);
    expect(w.find('.card .del').exists()).toBe(false);
    expect(w.find('.add-new-btn').exists()).toBe(false);
    expect(w.text()).not.toContain('Sign in with Google');
    expect(w.find('.hi-note').exists()).toBe(false);
    window.history.replaceState(null, '', '/');
  });

  it('a revoked share link says so', async () => {
    window.history.replaceState(null, '', '/?share=gone');
    const w = await mountApp(EXAMPLE, 'signedOut', 'supabase');
    expect(w.find('.filebar').text()).toContain('revoked');
    expect(w.find('.card').exists()).toBe(false);
    window.history.replaceState(null, '', '/');
  });
});

describe('add and edit', () => {
  it('adds an entry through the manual form', async () => {
    const w = await mountApp();
    await w.find('.add-new-btn').trigger('click');
    await w.findAll('.view-tabs button')[1].trigger('click');
    await w.findAll('.medium-toggle button').find((b) => b.text() === 'Film').trigger('click');
    const manual = w.findAll('.form-panel')[0];
    await manual.find('.title-row input').setValue('Perfect Blue');
    await manual.findAll('.star-pick span')[3].trigger('click');
    await manual.findAll('.form-actions button').find((b) => b.text() === 'Save').trigger('click');
    await flushPromises();
    expect(w.findAll('.card')).toHaveLength(5);
    const [, saved, total] = adapter.calls.at(-1);
    expect(saved).toMatchObject({ medium: 'film', title: 'Perfect Blue', rating: 4 });
    expect(saved.id).toMatch(/^e_\d+_/);
    expect(total).toBe(5);
  });

  it('refuses to save without a title', async () => {
    const w = await mountApp();
    await w.find('.add-new-btn').trigger('click');
    await w.findAll('.view-tabs button')[1].trigger('click');
    await w.findAll('.form-actions button').find((b) => b.text() === 'Save').trigger('click');
    expect(w.text()).toContain('Title is required.');
    expect(adapter.calls).toHaveLength(0);
  });

  it('editing keeps fields the form does not show (external ids)', async () => {
    const withId = EXAMPLE.map((e, i) => (i === 0 ? { ...e, wikidataId: 'Q1' } : e));
    const w = await mountApp(withId);
    await w.findAll('.card').find((c) => c.text().includes('Paprika')).trigger('click');
    expect(w.find('.view-tabs').isVisible()).toBe(false);
    await w.find('.title-row input').setValue('paprika');
    await w.findAll('.form-actions button').find((b) => b.text() === 'Save').trigger('click');
    await flushPromises();
    const [, saved] = adapter.calls.at(-1);
    expect(saved).toMatchObject({ id: EXAMPLE[0].id, title: 'paprika', wikidataId: 'Q1', dateAdded: EXAMPLE[0].dateAdded });
  });

  it('drops external ids when the title changes to another work', async () => {
    const withId = EXAMPLE.map((e, i) => (i === 0 ? { ...e, wikidataId: 'Q1' } : e));
    const w = await mountApp(withId);
    await w.findAll('.card').find((c) => c.text().includes('Paprika')).trigger('click');
    await w.find('.title-row input').setValue('Perfect Blue');
    await w.findAll('.form-actions button').find((b) => b.text() === 'Save').trigger('click');
    await flushPromises();
    const [, saved] = adapter.calls.at(-1);
    expect(saved).toMatchObject({ title: 'Perfect Blue', wikidataId: '', openlibraryId: '', itunesId: '' });
  });

  it('Look up stores the Wikidata id, and Open Library work id for books', async () => {
    const entity = { claims: { P648: [{ mainsnak: { datavalue: { value: 'OL123W' } } }] } };
    fetch.mockImplementation((url, init) => {
      const json = (body) => Promise.resolve(new Response(JSON.stringify(body)));
      if (url.includes('wbsearchentities')) return json({ search: [{ id: 'Q42', label: 'Dune', description: '1965 novel by Frank Herbert' }] });
      if (url.includes('wbgetentities')) return json({ entities: { Q42: entity } });
      return fakeFetch(url, init);
    });
    const w = await mountApp();
    await w.find('.add-new-btn').trigger('click');
    await w.findAll('.view-tabs button')[1].trigger('click');
    await w.findAll('.medium-toggle button').find((b) => b.text() === 'Book').trigger('click');
    const manual = w.findAll('.form-panel')[0];
    await manual.find('.title-row input').setValue('Dune');
    // A cover already set skips the image checks, which jsdom can't load.
    await manual.find('input[placeholder^="Auto-filled by Look up"]').setValue('https://example.com/dune.jpg');
    await manual.findAll('button').find((b) => b.text() === 'Look up').trigger('click');
    await flushPromises();
    await manual.findAll('.form-actions button').find((b) => b.text() === 'Save').trigger('click');
    await flushPromises();
    const [, saved] = adapter.calls.at(-1);
    expect(saved).toMatchObject({ title: 'Dune', wikidataId: 'Q42', openlibraryId: 'OL123W', musicbrainzId: '', itunesId: '' });
    // Wikimedia's User-Agent policy (#30).
    const wd = fetch.mock.calls.filter(([u]) => u.includes('wikidata.org'));
    expect(wd.length).toBeGreaterThan(0);
    wd.forEach(([, init]) => expect(init.headers['Api-User-Agent']).toContain('github.com/slatiner/content-library'));
  });

  it('Look up for music fills from MusicBrainz and stores its id', async () => {
    fetch.mockImplementation((url, init) => {
      if (url.startsWith('https://musicbrainz.org/ws/2/release-group')) {
        return Promise.resolve(new Response(JSON.stringify({ 'release-groups': [
          { id: 'mb-1', title: 'OK Computer', 'primary-type': 'Album', 'first-release-date': '1997-05-21', 'artist-credit': [{ name: 'Radiohead' }] },
        ] })));
      }
      return fakeFetch(url, init);
    });
    const w = await mountApp();
    await w.find('.add-new-btn').trigger('click');
    await w.findAll('.view-tabs button')[1].trigger('click');
    await w.findAll('.medium-toggle button').find((b) => b.text() === 'Music').trigger('click');
    const manual = w.findAll('.form-panel')[0];
    await manual.find('.title-row input').setValue('OK Computer');
    await manual.find('input[placeholder^="Auto-filled by Look up"]').setValue('https://example.com/okc.jpg');
    await manual.findAll('button').find((b) => b.text() === 'Look up').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Filled artist, year, and cover from MusicBrainz');
    await manual.findAll('.form-actions button').find((b) => b.text() === 'Save').trigger('click');
    await flushPromises();
    const [, saved] = adapter.calls.at(-1);
    expect(saved).toMatchObject({ title: 'OK Computer', year: '1997', musicbrainzId: 'mb-1', itunesId: '' });
    expect(fetch.mock.calls.some(([u]) => u.includes('itunes.apple.com'))).toBe(false);
  });

  it('Look up suggests only items of the chosen medium, and fills a single exact match', async () => {
    const urls = [];
    const page = (index, title, label, description) => ({ index, title, entityterms: { label: [label], description: [description] } });
    fetch.mockImplementation((url, init) => {
      const json = (body) => Promise.resolve(new Response(JSON.stringify(body)));
      if (url.includes('generator=search')) {
        urls.push(decodeURIComponent(url));
        const heat = url.includes('Heat');
        return json({ query: { pages: heat
          ? { a: page(2, 'Q2', 'Heat', '1972 film'), b: page(1, 'Q1', 'Heat', '1995 film'), c: page(3, 'Q3', 'White Heat', '1949 film') }
          : { a: page(1, 'Q9', 'Paprika', '2006 film'), b: page(2, 'Q8', 'Paprika Girl', '1990 film') } } });
      }
      if (url.includes('wbgetentities')) return json({ entities: { Q9: { claims: {} } } });
      return fakeFetch(url, init);
    });
    const w = await mountApp();
    await w.find('.add-new-btn').trigger('click');
    await w.findAll('.view-tabs button')[1].trigger('click');
    await w.findAll('.medium-toggle button').find((b) => b.text() === 'Film').trigger('click');
    const manual = w.findAll('.form-panel')[0];
    await manual.find('.title-row input').setValue('Heat');
    await manual.findAll('button').find((b) => b.text() === 'Look up').trigger('click');
    await flushPromises();
    expect(urls[0]).toContain('haswbstatement:P31=Q11424');
    expect(manual.findAll('.suggest-item').map((b) => b.text())).toEqual([
      expect.stringContaining('1995 film'), expect.stringContaining('1972 film'), expect.stringContaining('1949 film'),
    ]);
    await manual.find('.suggest-skip').trigger('click');
    await manual.find('.title-row input').setValue('Paprika');
    await manual.find('input[placeholder^="Auto-filled by Look up"]').setValue('https://example.com/p.jpg');
    await manual.findAll('button').find((b) => b.text() === 'Look up').trigger('click');
    await flushPromises();
    expect(manual.findAll('.suggest-item')).toHaveLength(0);
    await manual.findAll('.form-actions button').find((b) => b.text() === 'Save').trigger('click');
    await flushPromises();
    expect(adapter.calls.at(-1)[1]).toMatchObject({ title: 'Paprika', wikidataId: 'Q9' });
  });

  it('Describe it: send, preview, Enter again adds', async () => {
    groqAnswer = { intent: 'add', medium: 'film', title: 'Perfect Blue', year: null, creator: 'Satoshi Kon', rating: 4, dateConsumed: '2026-10-01', note: 'anime night', platform: null, url: null };
    const w = await mountApp();
    await w.find('.add-new-btn').trigger('click');
    const input = w.find('#aiInput');
    await input.setValue('Perfect Blue, solid 4');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(w.find('.ai-preview').exists()).toBe(true);
    expect(w.find('.pv-title').text()).toBe('Perfect Blue');
    expect(w.find('.ai-preview').text()).toContain('Satoshi Kon');
    expect(w.find('.ai-preview .status, .status').text()).toBe('No match found for this title.');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    const [, saved] = adapter.calls.at(-1);
    expect(saved).toMatchObject({ medium: 'film', title: 'Perfect Blue', director: 'Satoshi Kon', rating: 4, dateConsumed: '2026-10-01', insights: 'anime night' });
    expect(w.find('.overlay.open').exists()).toBe(false);
  });
});

describe('assistant online', () => {
  it('Describe it online goes through the Supabase proxy, with no key in the browser', async () => {
    groqAnswer = { intent: 'add', medium: 'film', title: 'Perfect Blue', year: null, creator: null, rating: null, dateConsumed: null, note: null, platform: null, url: null };
    const w = await mountApp(EXAMPLE, 'ok', 'supabase');
    await w.find('.add-new-btn').trigger('click');
    const input = w.find('#aiInput');
    await input.setValue('Perfect Blue');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    const [url, init] = fetch.mock.calls.find(([u]) => u.includes('groq'));
    expect(url).toBe('https://proj.supabase.co/functions/v1/groq');
    expect(init.headers.Authorization).toBe('Bearer user-token');
    expect(init.headers.Authorization).not.toContain('gsk_');
    expect(w.find('.pv-title').text()).toBe('Perfect Blue');
  });

  it('Describe it online: an expired sign-in says so instead of asking for a key', async () => {
    fetch.mockImplementation((url, init) => (url.endsWith('/functions/v1/groq')
      ? Promise.resolve(new Response('{}', { status: 401 }))
      : fakeFetch(url, init)));
    const w = await mountApp(EXAMPLE, 'ok', 'supabase');
    await w.find('.add-new-btn').trigger('click');
    const input = w.find('#aiInput');
    await input.setValue('Perfect Blue');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(w.text()).toContain('Your sign-in has expired');
    expect(w.text()).not.toContain('API key');
  });

  it('the daily assistant limit says so, in Describe it and in search', async () => {
    const limit = { error: { code: 'daily_limit', message: 'All 50 assistant requests for today are used. They reset at midnight UTC.' } };
    fetch.mockImplementation((url, init) => (url.endsWith('/functions/v1/groq')
      ? Promise.resolve(new Response(JSON.stringify(limit), { status: 429 }))
      : fakeFetch(url, init)));
    const w = await mountApp(EXAMPLE, 'ok', 'supabase');
    await w.find('.add-new-btn').trigger('click');
    const input = w.find('#aiInput');
    await input.setValue('Perfect Blue');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(w.text()).toContain('All 50 assistant requests for today are used');
    expect(w.text()).not.toContain('Groq rate limit');
    await state.askLibrary('films I rated 4');
    expect(state.ask.status).toContain('All 50 assistant requests for today are used');
  });
});

describe('ask the library', () => {
  it('turns a question into filters and clears them', async () => {
    groqAnswer = { intent: 'find', mediums: ['film', 'series'], text: null, minRating: 4, maxRating: null, consumedFrom: null, consumedTo: null, releasedFrom: 2000, releasedTo: null, sort: 'title_asc' };
    const w = await mountApp();
    const search = w.find('.filter-row input[type=text]');
    await search.setValue('films and shows rated 4+ since 2000');
    await search.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(titles(w)).toEqual(['Paprika', 'Silo']);
    expect(w.findAll('.ask-chip').map((c) => c.text())).toEqual(['films + series', 'rated 4+', 'released 2000 or later', 'sorted: A–Z']);
    expect(w.find('select').element.value).toBe('title_asc');
    await w.findAll('.ask-row button').find((b) => b.text() === 'Clear').trigger('click');
    expect(w.findAll('.card')).toHaveLength(4);
    expect(w.find('select').element.value).toBe('dateConsumed_desc');
    expect(w.find('.ask-row').exists()).toBe(false);
  });
});

describe('adding from the search box', () => {
  it('an add request opens Describe it with the preview, and Enter adds', async () => {
    groqAnswer = {
      library_filter: { intent: 'add', mediums: [], text: null, minRating: null, maxRating: null, consumedFrom: null, consumedTo: null, releasedFrom: null, releasedTo: null, sort: null },
      library_entry: { intent: 'add', medium: 'film', title: 'Dune', year: null, creator: null, rating: 4, dateConsumed: null, note: null, platform: null, url: null },
    };
    const w = await mountApp();
    const search = w.find('.filter-row input[type=text]');
    await search.setValue('just saw dune, 4 stars');
    await search.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(search.element.value).toBe('');
    expect(w.findAll('.card')).toHaveLength(4);
    expect(w.find('.overlay.open').exists()).toBe(true);
    expect(w.find('#aiInput').element.value).toBe('just saw dune, 4 stars');
    expect(w.find('.pv-title').text()).toBe('Dune');
    await w.find('#aiInput').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(adapter.calls.at(-1)[1]).toMatchObject({ medium: 'film', title: 'Dune', rating: 4 });
    expect(w.findAll('.card')).toHaveLength(5);
  });
});

describe('wishlist (#47)', () => {
  const WISH = { ...structuredClone(EXAMPLE[0]), id: 'e_1_wish', title: 'Perfect Blue', year: '1997', rating: 0, dateConsumed: '', insights: 'Sam recommended it', visibility: '', status: 'wishlist', dateAdded: 1800000000000 };
  const WISH2 = { ...WISH, id: 'e_2_wish', title: 'Akira', year: '1988', dateAdded: 1700000000001 };
  const WITH_WISHES = [...EXAMPLE, WISH, WISH2];
  const toList = async (w, label) => { await w.findAll('.list-toggle button').find((b) => b.text() === label).trigger('click'); };
  const saveBtn = (w) => w.findAll('.form-actions button').find((b) => b.text() === 'Save');

  it('the toggle switches lists, with counts, sorts and filters per list', async () => {
    const w = await mountApp(WITH_WISHES);
    expect(titles(w)).toEqual(['In Rainbows', 'Paprika', 'Silo', 'Steppenwolf']);
    expect(w.find('.counts').text()).toBe('1 books1 films1 series1 music');
    await w.find('.tag-check.film').trigger('click');
    await toList(w, 'Wishlist');
    // Newest wish first; the consumed list's type filter stays behind.
    expect(titles(w)).toEqual(['Perfect Blue', 'Akira']);
    expect(w.find('.counts').text()).toBe('0 books2 films0 series0 music');
    expect(w.find('.card .stars').exists()).toBe(false);
    expect(w.findAll('.card .done')).toHaveLength(2);
    expect(w.findAll('.filter-bar option').map((o) => o.element.value)).toEqual(['dateAdded_desc', 'year_desc', 'title_asc']);
    await w.find('.filter-bar select').setValue('title_asc');
    expect(titles(w)).toEqual(['Akira', 'Perfect Blue']);
    await toList(w, 'Consumed');
    expect(titles(w)).toEqual(['Paprika']);
    expect(w.find('.filter-bar select').element.value).toBe('dateConsumed_desc');
    await toList(w, 'Wishlist');
    expect(titles(w)).toEqual(['Akira', 'Perfect Blue']);
  });

  it('adding on the wishlist saves a private wish with no rating or date', async () => {
    const w = await mountApp(EXAMPLE, 'ok', 'supabase');
    await toList(w, 'Wishlist');
    expect(w.find('.empty').text()).toContain('Nothing on your wishlist yet');
    await w.find('.add-new-btn').trigger('click');
    expect(w.find('.form-panel h2').text()).toBe('Add to wishlist');
    await w.findAll('.view-tabs button')[1].trigger('click');
    expect(w.find('.wish-check input').element.checked).toBe(true);
    expect(w.find('.star-pick').exists()).toBe(false);
    expect(w.find('.visibility-field').exists()).toBe(false);
    expect(w.find('.form-panel').text()).toContain('Only you can see your wishlist.');
    await w.find('.title-row input').setValue('Dune');
    await saveBtn(w).trigger('click');
    await flushPromises();
    expect(adapter.calls.at(-1)[1]).toMatchObject({ title: 'Dune', status: 'wishlist', rating: 0, dateConsumed: '', visibility: '' });
    expect(titles(w)).toEqual(['Dune']);
    await toList(w, 'Consumed');
    expect(w.findAll('.card')).toHaveLength(4);
  });

  it('Done moves a wish to Consumed in place, dated today, with a rating', async () => {
    const w = await mountApp(WITH_WISHES);
    await toList(w, 'Wishlist');
    await w.findAll('.card')[0].find('.done').trigger('click');
    expect(w.find('.form-panel h2').text()).toBe('Done? Rate it');
    expect(w.find('input[type=date]').element.value).toBe(todayLocalIso());
    expect(w.find('.wish-check').exists()).toBe(false);
    await w.findAll('.star-pick span')[4].trigger('click');
    await saveBtn(w).trigger('click');
    await flushPromises();
    expect(adapter.calls.at(-1)[1]).toMatchObject({ id: 'e_1_wish', status: 'consumed', rating: 5, dateConsumed: todayLocalIso(), insights: 'Sam recommended it', coverUrl: WISH.coverUrl, dateAdded: WISH.dateAdded });
    expect(titles(w)).toEqual(['Akira']);
    await toList(w, 'Consumed');
    expect(titles(w)[0]).toBe('Perfect Blue');
  });

  it('Cancel on Done leaves it a wish', async () => {
    const w = await mountApp(WITH_WISHES);
    await toList(w, 'Wishlist');
    await w.findAll('.card')[0].find('.done').trigger('click');
    await w.findAll('.form-actions button').find((b) => b.text() === 'Cancel').trigger('click');
    expect(adapter.calls).toHaveLength(0);
    expect(titles(w)).toEqual(['Perfect Blue', 'Akira']);
  });

  it('ticking On my wishlist turns an entry into a wish and drops its rating, date and level', async () => {
    const w = await mountApp(EXAMPLE, 'ok', 'supabase');
    await w.findAll('.card').find((c) => c.text().includes('Steppenwolf')).trigger('click');
    await w.find('.wish-check input').setValue(true);
    await saveBtn(w).trigger('click');
    await flushPromises();
    expect(adapter.calls.at(-1)[1]).toMatchObject({ title: 'Steppenwolf', status: 'wishlist', rating: 0, dateConsumed: '', visibility: '' });
    expect(w.findAll('.card')).toHaveLength(3);
  });

  it('"want to watch Dune" from the search box lands on the wishlist', async () => {
    groqAnswer = {
      library_filter: { intent: 'add', mediums: [], text: null, minRating: null, maxRating: null, consumedFrom: null, consumedTo: null, releasedFrom: null, releasedTo: null, sort: null },
      library_entry: { intent: 'add', medium: 'film', title: 'Dune', year: null, creator: null, rating: null, dateConsumed: null, note: null, platform: null, url: null, status: 'wishlist' },
    };
    const w = await mountApp();
    const search = w.find('.filter-row input[type=text]');
    await search.setValue('want to watch dune');
    await search.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(w.find('.ai-preview').text()).toContain('On your wishlist');
    expect(w.findAll('.pv-actions button').map((b) => b.text())).toContain('Add to wishlist');
    await w.find('#aiInput').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(adapter.calls.at(-1)[1]).toMatchObject({ title: 'Dune', status: 'wishlist', rating: 0 });
    expect(w.findAll('.card')).toHaveLength(4);
  });

  it('Describe it on the wishlist adds a wish when the message does not say', async () => {
    groqAnswer = { intent: 'add', medium: 'film', title: 'Dune', year: null, creator: null, rating: null, dateConsumed: null, note: null, platform: null, url: null, status: null };
    const w = await mountApp();
    await toList(w, 'Wishlist');
    await w.find('.add-new-btn').trigger('click');
    await w.find('#aiInput').setValue('dune');
    await w.find('#aiInput').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    await w.find('#aiInput').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(adapter.calls.at(-1)[1]).toMatchObject({ title: 'Dune', status: 'wishlist' });
  });

  it('asking on the wishlist ignores ratings and dates finished', async () => {
    groqAnswer = { intent: 'find', mediums: ['film'], text: null, minRating: 4, maxRating: null, consumedFrom: '2026-01-01', consumedTo: '2026-12-31', releasedFrom: null, releasedTo: null, sort: 'rating_desc' };
    const w = await mountApp(WITH_WISHES);
    await toList(w, 'Wishlist');
    const search = w.find('.filter-row input[type=text]');
    await search.setValue('good films this year');
    await search.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(titles(w)).toEqual(['Perfect Blue', 'Akira']);
    expect(w.find('.ask-chips').text()).toBe('films');
  });
});

describe('export / import', () => {
  it('merges only entries with new ids', async () => {
    const w = await mountApp();
    await w.find('.icon-btn').trigger('click');
    await w.findAll('.popover button').find((b) => b.text() === 'Export / Import JSON').trigger('click');
    const extra = { ...EXAMPLE[0], id: 'e_new', title: 'New one' };
    await w.find('textarea[placeholder^="Paste"]').setValue(JSON.stringify([EXAMPLE[0], extra]));
    await w.findAll('button').find((b) => b.text() === 'Merge (add missing only)').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Merged — added 1 new entry.');
    expect(w.findAll('.card')).toHaveLength(5);
    expect(adapter.calls.at(-1)).toEqual(['replaceAll', 5]);
  });
});
