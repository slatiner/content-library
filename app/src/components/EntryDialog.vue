<script setup>
import { computed, nextTick, reactive, ref } from 'vue';
import { entries, connection, saveEntry, deleteEntry, removeEntry, ensureGroqKey, forgetGroqKey, setGroqKey, shareLink, shareUrl, list } from '../state.js';
import { MEDIA, DONE_VERB, DONE_PAST, ID_FIELDS, LEVELS, LEVEL_LABEL, emptyForm, findTwins, linkKey, personLine, uid, asWish, isWish, todayLocalIso } from '../lib/entries.js';
import { lookupTitle, applyWikidataDetails } from '../lib/lookup.js';
import { llmJson, ADD_TASK, fillFormFromExtraction } from '../lib/llm.js';
import Stars from './Stars.vue';
import Modal from './Modal.vue';

const isOpen = ref(false);
const editingId = ref(null);
const form = reactive(emptyForm());
const view = ref('ai');        // 'ai' | 'manual'
const withTabs = ref(true);
const formStatus = ref('');
const saving = ref(false);

// Manual view: Wikidata matches to choose from.
const suggest = ref(null);     // { choices, uncertain } | null
const lookupBusy = ref(false);
// A new manual entry starts with only type, title and Look up; the rest shows
// once Look up has found or failed (or "fill in by hand"). Details (year,
// people, cover…) fold away when Look up filled them, and open when it didn't.
const found = ref(true);
const detailsOpen = ref(false);
const takeOpen = ref(true);
const coverInputEl = ref(null);
function revealForm(openDetails) { found.value = true; detailsOpen.value = openDetails; }
function editCover() {
  detailsOpen.value = true;
  nextTick(() => coverInputEl.value && coverInputEl.value.focus());
}

const m = computed(() => form.medium);
// Wishlist (#47): no rating, date or visibility.
const wish = computed(() => isWish(form));
const doneMode = ref(false);
const heading = computed(() => {
  if (doneMode.value) return 'Done? Rate it';
  if (editingId.value) return 'Edit entry';
  return wish.value ? 'Add to wishlist' : 'Add entry';
});
// Sharing (#20) exists online only.
const online = computed(() => connection.kind === 'supabase');
const defaultLabel = computed(() => `Library default (${LEVEL_LABEL[connection.profile?.defaultVisibility || 'private']})`);
const labels = computed(() => ({
  year: m.value === 'book' ? 'Year published' : 'Year released',
  author: m.value === 'music' ? 'Artist' : 'Author',
  director: m.value === 'series' ? 'Director / Creator' : 'Director',
  cast: m.value === 'music' ? 'Band members' : 'Cast',
}));

// opts.done: a wish moving to Consumed. It stays a wish until Save.
function open(entry, opts = {}) {
  editingId.value = entry ? entry.id : null;
  doneMode.value = !!(entry && opts.done);
  suggest.value = null;
  dup.value = null;
  lookupSeq++; // a lookup still running for the last entry is dropped
  found.value = !!entry;
  detailsOpen.value = false;
  takeOpen.value = true;
  Object.assign(form, emptyForm());
  if (entry) {
    for (const k of Object.keys(form)) {
      if (entry[k] === undefined || entry[k] === null) continue;
      form[k] = typeof form[k] === 'string' ? String(entry[k]) : entry[k];
    }
    form.rating = Number(entry.rating) || 0;
    if (ID_FIELDS.some((k) => form[k])) form.linkedFor = linkKey(form);
  } else {
    form.status = list.value;
  }
  formStatus.value = '';
  if (doneMode.value) {
    form.status = 'consumed';
    form.dateConsumed = todayLocalIso();
    formStatus.value = 'Rate it and Save to move it to Consumed.';
  }
  if (entry) {
    showView('manual', false);
  } else {
    resetAi();
    showView('ai', true);
  }
  isOpen.value = true;
  // preventScroll: the drawer is still sliding in, so don't scroll it into view.
  if (!entry) nextTick(() => aiInputEl.value && aiInputEl.value.focus({ preventScroll: true }));
}
function close() { isOpen.value = false; }

// The example under the describe box can be dismissed once it's familiar; the ?
// in the box brings it back. Remembered per browser.
const HINT_KEY = 'describeHintHidden';
const hintHidden = ref((() => { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return false; } })());
function setHintHidden(v) {
  hintHidden.value = v;
  try { v ? localStorage.setItem(HINT_KEY, '1') : localStorage.removeItem(HINT_KEY); } catch { /* storage unavailable */ }
}
// Also on the card, but that × needs hover, which phones don't have.
function remove() {
  const id = editingId.value;
  deleteEntry(id);
  if (!entries.value.some((e) => e.id === id)) close();
}
const isHttp = (u) => /^https?:\/\//i.test((u || '').trim());
// Open on "Describe it" with text already typed, and send it.
function describe(text) {
  open(null);
  aiText.value = text;
  aiSubmit();
}
defineExpose({ open, describe });

function showView(v, tabs) { view.value = v; withTabs.value = tabs; }
function onTab(v) {
  showView(v, true);
  if (v === 'ai') nextTick(() => aiInputEl.value && aiInputEl.value.focus());
}

function collectEntry() {
  const t = (s) => String(s ?? '').trim();
  const existing = editingId.value ? entries.value.find((e) => e.id === editingId.value) : null;
  // Ids found for another title or medium would point at the wrong work.
  const linked = form.linkedFor === linkKey(form);
  const ids = Object.fromEntries(ID_FIELDS.map((k) => [k, linked ? t(form[k]) : '']));
  const entry = {
    id: editingId.value || uid(),
    medium: form.medium,
    title: t(form.title),
    year: t(form.year),
    author: t(form.author),
    director: t(form.director),
    cast: t(form.cast),
    platform: t(form.platform),
    streamUrl: t(form.streamUrl),
    dateConsumed: form.dateConsumed,
    rating: form.rating,
    coverUrl: t(form.coverUrl),
    insights: t(form.insights),
    visibility: form.visibility,
    ...ids,
    status: form.status,
    dateAdded: existing ? existing.dateAdded || Date.now() : Date.now(),
  };
  return isWish(entry) ? asWish(entry) : entry;
}

// A link that shows this one entry to anyone who has it, whatever its level.
async function copyShareLink() {
  try {
    const url = shareUrl(await shareLink(editingId.value));
    try { await navigator.clipboard.writeText(url); formStatus.value = 'Link copied. Anyone with it can see this entry (not your notes).'; }
    catch { formStatus.value = `Copy this link: ${url}`; }
  } catch (e) { formStatus.value = e.message; }
}

// Returns false (and says why in formStatus) when the entry can't be saved, and
// 'asked' when it's already in the library and the dialog asks what to do.
async function save() {
  if (!form.title.trim()) { formStatus.value = 'Title is required.'; return false; }
  const entry = collectEntry();
  if (!editingId.value || doneMode.value) {
    const d = duplicateOf(entry);
    if (d) { dup.value = d; return 'asked'; }
  }
  return store(() => saveEntry(entry));
}

async function store(fn) {
  saving.value = true;
  try {
    await fn();
    close();
  } catch (e) {
    formStatus.value = `${(e && e.message) || e}. Try again.`;
    dup.value = null;
    return false;
  } finally {
    saving.value = false;
  }
  return true;
}

// ---- Already in the library ----
// A new entry (or a wish being marked done) for a work that's already there.
// kind: 'again'      consumed again: update the consumed entry's date
//       'fromWish'   consumed, and on the wishlist: move the wish to the library
//       'onWishlist' wished, and already on the wishlist: nothing to add
//       'wishAgain'  wished, and consumed before: add a wish next to it
const dup = ref(null); // { kind, twin, entry }
function duplicateOf(entry) {
  const twins = findTwins(entries.value, entry);
  const done = twins.find((e) => !isWish(e));
  const wished = twins.find(isWish);
  if (!isWish(entry)) {
    if (done) return { kind: 'again', twin: done, entry };
    if (wished && !doneMode.value) return { kind: 'fromWish', twin: wished, entry };
  } else {
    if (wished) return { kind: 'onWishlist', twin: wished, entry };
    if (done) return { kind: 'wishAgain', twin: done, entry };
  }
  return null;
}
const mergeNotes = (a, b) => (!b || a === b ? a : !a ? b : `${a}\n\n${b}`);
const newDate = computed(() => (dup.value && dup.value.entry.dateConsumed) || todayLocalIso());
const dupText = computed(() => {
  if (!dup.value) return null;
  const { kind, twin, entry } = dup.value;
  const past = DONE_PAST[entry.medium] || 'finished';
  const name = `"${twin.title}"`;
  const when = twin.dateConsumed ? `You ${past} ${name} on ${twin.dateConsumed}.` : `${name} is already in your library.`;
  const again = `${past[0].toUpperCase()}${past.slice(1)} it again?`;
  return {
    again: { text: `${when} ${again}`, yes: `Yes, change the date to ${newDate.value}` },
    fromWish: { text: `${name} is on your wishlist. Move it to your library?`, yes: 'Move to library' },
    onWishlist: { text: `${name} is already on your wishlist.`, yes: '' },
    wishAgain: { text: `${when} Add it to your wishlist again?`, yes: 'Add to wishlist again' },
  }[kind];
});
function confirmDup() {
  const { kind, twin, entry } = dup.value;
  if (kind === 'wishAgain') return store(() => saveEntry(entry));
  if (kind === 'fromWish') {
    // The wish becomes the library entry; what the wish had fills any gaps.
    const filled = Object.fromEntries(Object.entries(entry).map(([k, v]) => [k, v === '' || v === 0 ? twin[k] ?? v : v]));
    return store(() => saveEntry({ ...filled, id: twin.id, dateAdded: twin.dateAdded, status: 'consumed', insights: mergeNotes(twin.insights, entry.insights) }));
  }
  // 'again': a new date; a new rating if one was given; new notes added to the old.
  const wishId = doneMode.value ? editingId.value : null;
  return store(async () => {
    await saveEntry({ ...twin, dateConsumed: newDate.value, rating: entry.rating || twin.rating, insights: mergeNotes(twin.insights, entry.insights) });
    if (wishId) await removeEntry(wishId); // the wish was for this rewatch
  });
}

// ---- Manual view: Look up ----
// A lookup fills a copy of the form, and only the newest one is kept: an older
// answer arriving late, or one for a title or type changed since, is dropped.
// Fields the lookup changed are copied over; anything else typed meanwhile stays.
let lookupSeq = 0;
async function filling(fn) {
  const seq = ++lookupSeq;
  const before = { ...form };
  const draft = { ...form };
  const res = await fn(draft);
  if (seq !== lookupSeq || form.title !== before.title || form.medium !== before.medium) return { stale: true };
  for (const k of Object.keys(draft)) if (draft[k] !== before[k]) form[k] = draft[k];
  return res;
}

async function manualLookup() {
  if (!form.title.trim()) { formStatus.value = 'Type a title first.'; return; }
  suggest.value = null;
  lookupBusy.value = true;
  formStatus.value = form.medium === 'music' ? 'Looking up on MusicBrainz…' : 'Looking up on Wikidata…';
  const res = await filling(lookupTitle);
  lookupBusy.value = false;
  if (res.stale) { formStatus.value = ''; return; }
  if (res.choices) {
    suggest.value = res;
    formStatus.value = res.uncertain
      ? "Couldn't confirm which of these is the right medium — pick one, or skip."
      : 'Found more than one match — pick the right one.';
  } else {
    formStatus.value = res.status;
    revealForm(!/^Filled/.test(res.status || ''));
  }
}
function onTitleEnter(e) {
  if (e.isComposing) return;
  e.preventDefault();
  if (!lookupBusy.value) manualLookup();
}
async function pickSuggestion(c) {
  formStatus.value = 'Filling details…';
  try {
    const res = await filling((draft) => {
      // The picked match names the entry, not what was typed ("heat" -> "White Heat").
      if (c.label) draft.title = c.label;
      return applyWikidataDetails(c.id, draft);
    });
    if (res && res.stale) return;
    suggest.value = null;
    formStatus.value = `Filled from "${c.label}". Review, then Save.`;
    revealForm(false);
  } catch (e) {
    formStatus.value = `Couldn't load details (${(e && e.message) || e}). Pick again, or fill the fields yourself.`;
  }
}
function skipSuggestions() { suggest.value = null; formStatus.value = 'Skipped — fill in manually and Save.'; revealForm(true); }
function byHand() { suggest.value = null; formStatus.value = ''; revealForm(true); }
// Tapping the star that's already set clears the rating.
function rate(i) { form.rating = form.rating === i ? 0 : i; }

// ---- "Describe it" view: natural-language add via the LLM ----
// The view is always in one of three stages. Only one primary action is on screen at a time:
// 'input' = Send, 'choices' = pick a match, 'preview' = Add to library.
const aiInputEl = ref(null);
const aiText = ref('');
const aiLastText = ref('');
const aiStatus = ref('');
const aiStage = ref('input');
const aiChoices = ref(null);   // { choices, uncertain } | null
const keyBox = ref(false);
const keyInput = ref('');
const sendBusy = ref(false);
const addBusy = ref(false);
const preview = computed(() => (aiStage.value === 'preview' ? collectEntry() : null));

function resetAi() {
  aiText.value = '';
  aiLastText.value = '';
  aiStatus.value = '';
  aiStage.value = 'input';
  keyBox.value = false;
  sendBusy.value = false;
  addBusy.value = false;
}

async function aiSubmit() {
  const text = aiText.value.trim();
  if (!text) return;
  aiLastText.value = text;
  aiStage.value = 'input';
  keyBox.value = false;
  sendBusy.value = true;
  aiStatus.value = 'Thinking…';
  try {
    const r = await llmJson(await ensureGroqKey(), text, ADD_TASK);
    if (r.intent !== 'add' || !(r.title || '').trim()) {
      aiStatus.value = 'I couldn\'t find an item to add in that. Tell me what you watched, read or listened to, e.g. "Perfect Blue, film, solid 4". To search your library, use the search box on the main page and press Enter.';
      return;
    }
    suggest.value = null;
    fillFormFromExtraction(form, r);
    formStatus.value = '';
    aiStatus.value = 'Looking up details…';
    const res = await filling(lookupTitle);
    if (res.stale) return;
    if (res.choices) {
      aiChoices.value = { choices: res.choices.slice(0, 6), uncertain: res.uncertain };
      aiStatus.value = '';
      aiStage.value = 'choices';
      return;
    }
    aiStage.value = 'preview';
    aiStatus.value = res.status;
  } catch (e) {
    if (e && e.code === 'NO_KEY') {
      keyBox.value = true;
      aiStatus.value = '';
    } else if (e && e.code === 401) {
      forgetGroqKey();
      keyBox.value = true;
      aiStatus.value = e.message;
    } else {
      aiStatus.value = (e && e.message) || String(e);
    }
  } finally {
    sendBusy.value = false;
  }
}

async function pickAiChoice(c) {
  aiStage.value = 'input';
  sendBusy.value = true;
  aiStatus.value = 'Filling in details…';
  try {
    const res = await filling((draft) => {
      if (c.label) draft.title = c.label;
      return applyWikidataDetails(c.id, draft);
    });
    if (res && res.stale) { sendBusy.value = false; return; }
    aiStatus.value = `Filled from Wikidata (${c.label}).`;
  } catch (e) {
    aiStatus.value = `Couldn't load details (${(e && e.message) || e}). Showing what you told me.`;
  }
  sendBusy.value = false;
  aiStage.value = 'preview';
}
function aiChoiceNone() { aiStatus.value = 'Using just what you typed.'; aiStage.value = 'preview'; }

function onAiKeydown(e) {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  e.preventDefault();
  // Enter twice: the first sends, the second confirms the preview for the same text.
  if (aiStage.value === 'preview' && aiText.value.trim() === aiLastText.value) aiAdd();
  else if (aiStage.value === 'input') aiSubmit();
}
function onAiInput() {
  if (aiStage.value !== 'input') { aiStage.value = 'input'; aiStatus.value = ''; }
}

async function aiAdd() {
  if (addBusy.value) return;
  addBusy.value = true;
  try {
    // If save refuses (e.g. missing title), say why here, not in the hidden form.
    if ((await save()) === false) aiStatus.value = formStatus.value || "Couldn't save this entry.";
  } catch (e) {
    aiStatus.value = `Couldn't save: ${(e && e.message) || e}`;
  } finally {
    addBusy.value = false;
  }
}

function saveKey() {
  const k = keyInput.value.trim();
  if (!k) return;
  const persisted = setGroqKey(k);
  keyInput.value = '';
  keyBox.value = false;
  aiStatus.value = persisted ? 'Key saved in this browser. Send your message again.' : 'Key set for this session only (browser storage is unavailable). Send your message again.';
}
</script>

<template>
  <Modal v-model:open="isOpen" drawer>
    <h2>{{ heading }}</h2>

    <div v-show="withTabs && !dup" class="view-tabs" style="display:flex;">
      <button type="button" :class="{ active: view === 'ai' }" @click="onTab('ai')">Describe it</button>
      <button type="button" :class="{ active: view === 'manual' }" @click="onTab('manual')">Manual</button>
    </div>

    <div v-if="dupText" class="dup-box" role="alert">
      <div class="entry-head">
        <div class="eh-cover"><img v-if="dup.twin.coverUrl" :src="dup.twin.coverUrl" alt=""><span v-else class="pv-ph" :class="dup.twin.medium"></span></div>
        <div class="eh-body">
          <span class="pv-chip" :class="dup.twin.medium">{{ dup.twin.medium }}</span>
          <div class="pv-title">{{ dup.twin.title }}<span v-if="dup.twin.year" class="yr"> ({{ dup.twin.year }})</span></div>
          <div v-if="personLine(dup.twin)" class="pv-meta">{{ personLine(dup.twin) }}</div>
        </div>
      </div>
      <p class="dup-text">{{ dupText.text }}</p>
      <div class="status">{{ formStatus }}</div>
      <div class="form-actions">
        <template v-if="dupText.yes">
          <button type="button" class="btn ghost" @click="dup = null">Back</button>
          <button type="button" class="btn" :disabled="saving" @click="confirmDup">{{ dupText.yes }}</button>
        </template>
        <button v-else type="button" class="btn" @click="close">Close</button>
      </div>
    </div>

    <div v-show="view === 'ai' && !dup">
      <div v-if="!hintHidden" id="describe-hint" class="form-sub hint">
        <p v-if="wish">Say what you want to watch, read or listen to. For example: "Perfect Blue, Sam recommended it".</p>
        <p v-else>Just say what you watched, read or listened to. For example: "Perfect Blue, solid 4, watched two weeks ago, note: anime night at home".</p>
        <button type="button" class="hint-close" aria-label="Hide this tip" title="Hide this tip" @click="setHintHidden(true)">×</button>
      </div>

      <div v-if="keyBox" class="suggest-box">
        <div class="suggest-head">Groq API key needed</div>
        <p class="form-sub" style="margin-bottom:8px;">Paste it here; it's stored only in this browser. (In file mode it can also come from <code>secrets.json</code> in your data folder.)</p>
        <div class="title-row">
          <div class="field"><input v-model="keyInput" type="password" placeholder="gsk_…" autocomplete="off"></div>
          <button type="button" class="btn small" @click="saveKey">Save key</button>
        </div>
      </div>

      <div class="ai-input-wrap">
        <textarea id="aiInput" ref="aiInputEl" v-model="aiText" :placeholder="wish ? 'What do you want to get to?' : 'What did you just finish?'" @keydown="onAiKeydown" @input="onAiInput"></textarea>
        <button v-if="hintHidden" type="button" class="hint-open" aria-label="How to describe it" title="How to describe it" @click="setHintHidden(false)">?</button>
      </div>
      <div class="status">{{ aiStatus }}</div>

      <div v-if="aiStage === 'choices' && aiChoices" class="suggest-box">
        <div class="suggest-head">{{ aiChoices.uncertain
          ? "Couldn't tell which of these is the right kind of item. Which one did you mean?"
          : 'More than one match. Which one did you mean?' }}</div>
        <button v-for="c in aiChoices.choices" :key="c.id" type="button" class="suggest-item" @click="pickAiChoice(c)">
          <div class="s-title">{{ c.label }}</div>
          <div class="s-desc">{{ c.description || 'No description available' }}</div>
        </button>
        <button type="button" class="suggest-skip" @click="aiChoiceNone">None of these, use what I typed</button>
      </div>

      <div v-if="preview" class="ai-preview">
        <div class="pv-row">
          <div class="pv-cover"><img v-if="preview.coverUrl" :src="preview.coverUrl" alt=""><div v-else class="pv-ph" :class="preview.medium"></div></div>
          <div class="pv-body">
            <span class="pv-chip" :class="preview.medium">{{ preview.medium }}</span>
            <div class="pv-title">{{ preview.title }}<span v-if="preview.year" class="yr"> ({{ preview.year }})</span></div>
            <div v-if="personLine(preview)" class="pv-meta">{{ personLine(preview) }}</div>
            <div v-if="wish" class="pv-meta">On your wishlist</div>
            <template v-else>
              <Stars :n="preview.rating" style="margin-top:4px;" />
              <div class="pv-meta">{{ preview.dateConsumed ? `${DONE_VERB[preview.medium] || 'Finished'} ${preview.dateConsumed}` : 'No date' }}</div>
            </template>
            <div v-if="preview.insights" class="pv-note">{{ preview.insights }}</div>
          </div>
        </div>
        <div class="pv-actions">
          <span class="pv-hint">Press Enter to add</span>
          <button type="button" class="btn ghost" @click="close">Cancel</button>
          <button type="button" class="btn ghost" @click="revealForm(true); showView('manual', true)">Edit details</button>
          <button type="button" class="btn" :disabled="addBusy" @click="aiAdd">{{ wish ? 'Add to wishlist' : 'Add to library' }}</button>
        </div>
      </div>

      <div v-if="aiStage === 'input'" class="form-actions">
        <button type="button" class="btn ghost" @click="close">Cancel</button>
        <button type="button" class="btn" :disabled="sendBusy" @click="aiSubmit">Send</button>
      </div>
    </div>

    <div v-show="view === 'manual' && !dup">
      <div class="medium-toggle">
        <button v-for="x in MEDIA" :key="x" type="button" :data-m="x" :class="{ active: form.medium === x }" :aria-pressed="form.medium === x" @click="form.medium = x">{{ x[0].toUpperCase() + x.slice(1) }}</button>
      </div>

      <div class="title-row">
        <div class="field"><label for="entry-title">Title</label><input id="entry-title" v-model="form.title" type="text" @keydown.enter="onTitleEnter"></div>
        <button type="button" class="btn small" :disabled="lookupBusy" @click="manualLookup">Look up</button>
      </div>

      <div v-if="suggest" class="suggest-box">
        <div class="suggest-head">Multiple matches — which one is it?</div>
        <button v-for="c in suggest.choices" :key="c.id" type="button" class="suggest-item" @click="pickSuggestion(c)">
          <div class="s-title">{{ c.label }}</div>
          <div class="s-desc">{{ c.description || 'No description available' }}</div>
        </button>
        <button type="button" class="suggest-skip" @click="skipSuggestions">None of these</button>
      </div>
      <p v-if="!found && !suggest" class="form-sub by-hand"><button type="button" class="link-btn" @click="byHand">Or fill it in by hand</button></p>

      <!-- The entry itself; the cover opens Details at the cover field. -->
      <div v-show="found" class="entry-head">
        <button type="button" class="eh-cover" title="Change cover" aria-label="Change cover" @click="editCover">
          <img v-if="form.coverUrl" :src="form.coverUrl" alt=""><span v-else class="pv-ph" :class="m"></span>
        </button>
        <div class="eh-body">
          <span class="pv-chip" :class="m">{{ m }}</span>
          <div class="pv-title">{{ form.title.trim() || 'Untitled' }}<span v-if="form.year" class="yr"> ({{ form.year }})</span></div>
          <div v-if="personLine(form)" class="pv-meta">{{ personLine(form) }}</div>
        </div>
      </div>

      <section v-show="found" class="form-section take">
        <button type="button" class="section-toggle" :aria-expanded="takeOpen" aria-controls="entry-take" @click="takeOpen = !takeOpen">Your take</button>
        <div v-show="takeOpen" id="entry-take">
          <div v-if="!doneMode" class="status-toggle" role="group" aria-label="List">
            <button type="button" :class="{ active: !wish }" :aria-pressed="!wish" @click="form.status = 'consumed'">Finished</button>
            <button type="button" :class="{ active: wish }" :aria-pressed="wish" @click="form.status = 'wishlist'">Wishlist</button>
          </div>

          <div v-if="!wish" class="row-two">
            <div class="field">
              <label for="entry-date">Date {{ DONE_VERB[m].toLowerCase() }}</label>
              <input id="entry-date" v-model="form.dateConsumed" type="date">
              <div class="date-quick">
                <button type="button" class="link-btn" @click="form.dateConsumed = todayLocalIso()">Today</button>
                <button type="button" class="link-btn" @click="form.dateConsumed = todayLocalIso(1)">Yesterday</button>
              </div>
            </div>
            <div class="field field-rating">
              <label id="entry-rating">Rating</label>
              <div class="star-pick" role="group" aria-labelledby="entry-rating">
                <button v-for="i in 5" :key="i" type="button" :class="{ on: i <= form.rating }" :aria-label="`${i} of 5`" :aria-pressed="form.rating === i" @click="rate(i)">{{ i <= form.rating ? '★' : '☆' }}</button>
              </div>
            </div>
          </div>

          <div class="field"><label for="entry-notes">Notes</label><textarea id="entry-notes" v-model="form.insights" :placeholder="wish ? 'Why you want it, who recommended it.' : 'Reactions, quotes, whatever\'s worth keeping.'"></textarea></div>

          <p v-if="online && wish" class="form-sub">Only you can see your wishlist.</p>
          <div v-else-if="online" class="field visibility-field">
            <label for="entry-visibility">Who can see this</label>
            <select id="entry-visibility" v-model="form.visibility">
              <option value="">{{ defaultLabel }}</option>
              <option v-for="l in LEVELS" :key="l" :value="l">{{ LEVEL_LABEL[l] }}</option>
            </select>
            <div class="field-hint">Notes are always private.<button v-if="editingId" type="button" class="link-btn" @click="copyShareLink">Copy share link</button></div>
          </div>
        </div>
      </section>

      <section v-show="found" class="form-section details">
        <button v-if="found" type="button" class="section-toggle" :aria-expanded="detailsOpen" aria-controls="entry-details" @click="detailsOpen = !detailsOpen">Details</button>
        <div v-show="found && detailsOpen" id="entry-details">
          <div>
            <div class="row-two">
              <div class="field"><label>{{ labels.year }}</label><input v-model="form.year" type="text" placeholder="e.g. 2019"></div>
              <div v-if="m === 'book' || m === 'music'" class="field"><label>{{ labels.author }}</label><input v-model="form.author" type="text"></div>
            </div>
            <div v-if="m === 'film' || m === 'series'" class="field"><label>{{ labels.director }}</label><input v-model="form.director" type="text"></div>
            <div v-if="m !== 'book'" class="field"><label>{{ labels.cast }}</label><input v-model="form.cast" type="text" placeholder="Comma-separated"></div>
            <div v-if="m === 'film' || m === 'series'" class="field"><label>Watched on</label><input v-model="form.platform" type="text" placeholder="e.g. Netflix, cinema, Mubi"></div>
            <div v-if="m === 'music'" class="field"><label>Listen link</label><input v-model="form.streamUrl" type="text" placeholder="Spotify, YouTube, SoundCloud, Mixcloud…"><a v-if="isHttp(form.streamUrl)" class="field-link" :href="form.streamUrl.trim()" target="_blank" rel="noopener noreferrer">Open link ↗</a></div>
            <div class="field"><label for="entry-cover">Cover image URL</label><input id="entry-cover" ref="coverInputEl" v-model="form.coverUrl" type="text" placeholder="Auto-filled by Look up, or paste your own"></div>
          </div>
        </div>
      </section>

      <div class="status">{{ formStatus }}</div>
      <div class="form-actions">
        <button v-if="editingId && !doneMode" type="button" class="btn ghost danger push-left" @click="remove">Delete</button>
        <button class="btn ghost" @click="close">Cancel</button>
        <button class="btn" :disabled="saving" @click="save">Save</button>
      </div>
    </div>
  </Modal>
</template>
