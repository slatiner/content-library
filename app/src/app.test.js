// Component tests: mount the real app with a fake storage adapter and a fake
// network, then click through it. Real folder permissions and file writes can't
// be simulated here.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { readFileSync } from 'node:fs';

// Read from disk: the dev server config blocks media-archive-data*.json imports.
const EXAMPLE = JSON.parse(readFileSync('media-archive-data.example.json', 'utf8'));

let state, App, adapter;

function fakeAdapter(initial, connState = 'ok') {
  const calls = [];
  return {
    calls,
    async init() {
      state.setConnection(connState, connState === 'ok' ? 'Connected' : 'Reconnect to your folder');
      return connState === 'ok' ? structuredClone(initial) : null;
    },
    async connect() { return null; },
    async reconnect() { state.setConnection('ok', 'Connected'); return structuredClone(initial); },
    async saveEntry(entry, all) { calls.push(['save', entry, all.length]); },
    async deleteEntry(id, all) { calls.push(['delete', id, all.length]); },
    async replaceAll(all) { calls.push(['replaceAll', all.length]); },
    async readSecrets() { return { groq: { apiKey: 'gsk_test' } }; },
  };
}

// Fake network: Groq answers come from `groqAnswer`; lookups find nothing.
let groqAnswer;
function fakeFetch(url) {
  const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  if (url.startsWith('https://api.groq.com/')) return json({ choices: [{ message: { content: JSON.stringify(groqAnswer) } }] });
  if (url.includes('wbsearchentities')) return json({ search: [] });
  return json({});
}

async function mountApp(initial = EXAMPLE, connState = 'ok') {
  vi.resetModules();
  state = await import('./state.js');
  App = (await import('./App.vue')).default;
  adapter = fakeAdapter(initial, connState);
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

  it('sorts by title and filters by date range', async () => {
    const w = await mountApp();
    await w.find('select').setValue('title_asc');
    expect(titles(w)).toEqual(['In Rainbows', 'Paprika', 'Silo', 'Steppenwolf']);
    const [from, to] = w.findAll('.popover input[type=date]');
    await from.setValue('2026-08-05');
    await to.setValue('2026-08-12');
    expect(titles(w)).toEqual(['Paprika']);
    expect(w.find('.input-btn').text()).toContain('2026-08-05 – 2026-08-12');
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
    await w.find('.title-row input').setValue('Paprika (film)');
    await w.findAll('.form-actions button').find((b) => b.text() === 'Save').trigger('click');
    await flushPromises();
    const [, saved] = adapter.calls.at(-1);
    expect(saved).toMatchObject({ id: EXAMPLE[0].id, title: 'Paprika (film)', wikidataId: 'Q1', dateAdded: EXAMPLE[0].dateAdded });
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
