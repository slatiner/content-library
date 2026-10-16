// App state shared by the components (Vue's built-in reactivity; no Pinia).
import { reactive, ref } from 'vue';
import { MEDIA } from './lib/entries.js';
import { createFileStorage, createSupabaseStorage } from './lib/storage/index.js';
import { STORAGE, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
import { llmJson, FIND_TASK, normalizeFind, askChipsFor } from './lib/llm.js';

export const entries = ref([]);
export const connection = reactive({ state: 'checking', text: 'Loading…', account: '', profile: null, kind: STORAGE });

// profile: { name, avatarUrl, isAdmin } from the sign-in provider, when there is one.
export function setConnection(state, text, account = '', profile = null) {
  connection.state = state; connection.text = text; connection.account = account; connection.profile = profile;
}

let storage = STORAGE === 'file'
  ? createFileStorage(setConnection)
  : createSupabaseStorage(setConnection, { url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY });
// Tests swap in a fake adapter.
export function useStorage(adapter) { storage = adapter; connection.kind = adapter.kind; }

function loaded(list) { if (list) entries.value = list; }
export const initStorage = async () => loaded(await storage.init());
export const connectStorage = async () => loaded(await storage.connect());
export const reconnectStorage = async () => loaded(await storage.reconnect());
export async function signOut() {
  await storage.signOut();
  entries.value = [];
  clearAsk();
}

// Invites (#28). redeemInvite throws a message to show next to the code field.
export const redeemInvite = async (code) => loaded(await storage.redeemInvite(code));
export const createInvite = () => storage.createInvite();
export const listInvites = () => storage.listInvites();

// Create or update. Keeps fields the form doesn't know about (e.g. external ids).
export async function saveEntry(entry) {
  const i = entries.value.findIndex((e) => e.id === entry.id);
  if (i >= 0) entries.value[i] = { ...entries.value[i], ...entry };
  else entries.value.push(entry);
  try {
    await storage.saveEntry(i >= 0 ? entries.value[i] : entry, entries.value);
  } catch (e) {
    alert('Saved in this page but not stored: ' + (e.message || e) + '\nUse Export/Import to back this up manually.');
  }
}

export function deleteEntry(id) {
  const entry = entries.value.find((e) => e.id === id);
  const label = entry ? `"${entry.title}"` : 'this entry';
  if (!confirm(`Delete ${label}? This can't be undone.`)) return;
  entries.value = entries.value.filter((e) => e.id !== id);
  storage.deleteEntry(id, entries.value).catch((e) => alert((e && e.message) || e));
}

// Export/Import: returns how many were added.
export async function mergeEntries(incoming) {
  const existingIds = new Set(entries.value.map((e) => e.id));
  let added = 0;
  incoming.forEach((e) => { if (e && e.id && !existingIds.has(e.id)) { entries.value.push(e); added++; } });
  await storage.replaceAll(entries.value);
  return added;
}
export async function replaceEntries(incoming) {
  entries.value = incoming;
  await storage.replaceAll(entries.value);
}

// ---- Groq key: secrets.json in the data folder, then a key pasted into this browser ----
let groqKey = null;
export async function ensureGroqKey() {
  // Online, the assistant goes through the Supabase proxy; no key in the browser.
  if (storage.llmEndpoint) return storage.llmEndpoint();
  if (groqKey) return groqKey;
  const s = await storage.readSecrets();
  const k = s && s.groq && typeof s.groq.apiKey === 'string' ? s.groq.apiKey.trim() : '';
  if (k) { groqKey = k; return k; }
  try {
    const stored = (localStorage.getItem('groqApiKey') || '').trim();
    if (stored) { groqKey = stored; return stored; }
  } catch (e) { /* storage unavailable */ }
  return null;
}
export function forgetGroqKey() { groqKey = null; }
// Returns true if the key was also stored in this browser.
export function setGroqKey(k) {
  groqKey = k;
  try { localStorage.setItem('groqApiKey', k); return true; } catch (e) { return false; }
}

// ---- Library filters (the controls above the grid) ----
export const filters = reactive({
  search: '',
  dateFrom: '',
  dateTo: '',
  sortBy: 'dateConsumed_desc',
  mediums: [...MEDIA],
});

// ---- Ask the library: plain-language search ----
// Press Enter in the search box to turn a question into filters. Type, medium, date range, sort and text
// reuse the existing controls; rating and release-year have no controls of their own, so they live in criteria.
export const ask = reactive({ criteria: null, status: '', chips: [], busy: false });
let askPrevSort = null;

// The search box can also add: App registers a handler that opens the Add dialog.
let addHandler = null;
export function onAddRequest(fn) { addHandler = fn; }

function setAsk(status, chips) { ask.status = status || ''; ask.chips = chips || []; }

function applyFind(f, question) {
  filters.mediums = f.mediums.length ? [...f.mediums] : [...MEDIA];
  filters.dateFrom = f.consumedFrom || '';
  filters.dateTo = f.consumedTo || '';
  if (askPrevSort === null) askPrevSort = filters.sortBy;
  filters.sortBy = f.sort || askPrevSort;
  filters.search = f.text;
  ask.criteria = { minRating: f.minRating, maxRating: f.maxRating, releasedFrom: f.releasedFrom, releasedTo: f.releasedTo };
  setAsk(`“${question}” →`, askChipsFor(f));
}

export function clearAsk() {
  ask.criteria = null;
  filters.mediums = [...MEDIA];
  filters.dateFrom = '';
  filters.dateTo = '';
  filters.search = '';
  if (askPrevSort !== null) { filters.sortBy = askPrevSort; askPrevSort = null; }
  setAsk('', []);
}

export async function askLibrary(text) {
  if (ask.busy) return;
  ask.busy = true;
  setAsk('Thinking…', []);
  try {
    const r = await llmJson(await ensureGroqKey(), text, FIND_TASK);
    if (r.intent === 'add' && addHandler) {
      filters.search = '';
      setAsk('', []);
      addHandler(text);
      return;
    }
    if (r.intent !== 'find') {
      setAsk('I can search your library or add to it. Try "films I rated above 4 this year" or "just watched Dune, 4 stars".', []);
      return;
    }
    applyFind(normalizeFind(r), text);
  } catch (e) {
    let msg;
    if (e && e.code === 'NO_KEY') msg = 'To ask in plain language, add a Groq API key (Add new → Describe it). Showing a plain text search instead.';
    else if (e && e.code === 401) { forgetGroqKey(); msg = 'Groq rejected the API key. Update it under Add new → Describe it. Showing a plain text search instead.'; }
    else msg = `${(e && e.message) || e} Showing a plain text search instead.`;
    setAsk(msg, []);
  } finally {
    ask.busy = false;
  }
}
