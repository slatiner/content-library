<script setup>
import { computed, nextTick, reactive, ref } from 'vue';
import { entries, connection, saveEntry, deleteEntry, ensureGroqKey, forgetGroqKey, setGroqKey, shareLink, shareUrl, list } from '../state.js';
import { MEDIA, DONE_VERB, ID_FIELDS, LEVELS, LEVEL_LABEL, emptyForm, linkKey, personLine, uid, asWish, isWish, todayLocalIso } from '../lib/entries.js';
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
  if (!entry) nextTick(() => aiInputEl.value && aiInputEl.value.focus());
}
function close() { isOpen.value = false; }
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
    catch (e) { formStatus.value = `Copy this link: ${url}`; }
  } catch (e) { formStatus.value = e.message; }
}

// Returns false (and says why in formStatus) when the entry can't be saved.
async function save() {
  if (!form.title.trim()) { formStatus.value = 'Title is required.'; return false; }
  saving.value = true;
  try {
    await saveEntry(collectEntry());
    close();
  } finally {
    saving.value = false;
  }
  return true;
}

// ---- Manual view: Look up ----
async function manualLookup() {
  if (!form.title.trim()) { formStatus.value = 'Type a title first.'; return; }
  suggest.value = null;
  lookupBusy.value = true;
  formStatus.value = form.medium === 'music' ? 'Looking up on MusicBrainz…' : 'Looking up on Wikidata…';
  const res = await lookupTitle(form);
  lookupBusy.value = false;
  if (res.choices) {
    suggest.value = res;
    formStatus.value = res.uncertain
      ? "Couldn't confirm which of these is the right medium — pick one, or skip."
      : 'Found more than one match — pick the right one.';
  } else {
    formStatus.value = res.status;
  }
}
async function pickSuggestion(c) {
  formStatus.value = 'Filling details…';
  try {
    await applyWikidataDetails(c.id, form);
    suggest.value = null;
    formStatus.value = `Filled from "${c.label}". Review, then Save.`;
  } catch (e) {
    formStatus.value = `Couldn't load details (${(e && e.message) || e}). Pick again, or fill the fields yourself.`;
  }
}
function skipSuggestions() { suggest.value = null; formStatus.value = 'Skipped — fill in manually and Save.'; }

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
    const res = await lookupTitle(form);
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
    await applyWikidataDetails(c.id, form);
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
    if (!(await save())) aiStatus.value = formStatus.value || "Couldn't save this entry.";
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
  <Modal v-model:open="isOpen">
    <h2>{{ heading }}</h2>

    <div v-show="withTabs" class="view-tabs" style="display:flex;">
      <button type="button" :class="{ active: view === 'ai' }" @click="onTab('ai')">Describe it</button>
      <button type="button" :class="{ active: view === 'manual' }" @click="onTab('manual')">Manual</button>
    </div>

    <div v-show="view === 'ai'">
      <p v-if="wish" class="form-sub">Say what you want to watch, read or listen to. For example: "Perfect Blue, Sam recommended it".</p>
      <p v-else class="form-sub">Just say what you watched, read or listened to. For example: "Perfect Blue, solid 4, watched two weeks ago, note: anime night at home".</p>

      <div v-if="keyBox" class="suggest-box">
        <div class="suggest-head">Groq API key needed</div>
        <p class="form-sub" style="margin-bottom:8px;">Paste it here; it's stored only in this browser. (In file mode it can also come from <code>secrets.json</code> in your data folder.)</p>
        <div class="title-row">
          <div class="field"><input v-model="keyInput" type="password" placeholder="gsk_…" autocomplete="off"></div>
          <button type="button" class="btn small" @click="saveKey">Save key</button>
        </div>
      </div>

      <textarea id="aiInput" ref="aiInputEl" v-model="aiText" :placeholder="wish ? 'What do you want to get to?' : 'What did you just finish?'" @keydown="onAiKeydown" @input="onAiInput"></textarea>
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
          <button type="button" class="btn ghost" @click="showView('manual', true)">Edit details</button>
          <button type="button" class="btn" :disabled="addBusy" @click="aiAdd">{{ wish ? 'Add to wishlist' : 'Add to library' }}</button>
        </div>
      </div>

      <div v-if="aiStage === 'input'" class="form-actions">
        <button type="button" class="btn ghost" @click="close">Cancel</button>
        <button type="button" class="btn" :disabled="sendBusy" @click="aiSubmit">Send</button>
      </div>
    </div>

    <div v-show="view === 'manual'">
      <p class="form-sub">Type a title, then hit "Look up" to pull director/cast/year/poster automatically.</p>
      <div class="medium-toggle">
        <button v-for="x in MEDIA" :key="x" :data-m="x" :class="{ active: form.medium === x }" @click="form.medium = x">{{ x[0].toUpperCase() + x.slice(1) }}</button>
      </div>

      <div class="title-row">
        <div class="field"><label>Title</label><input v-model="form.title" type="text"></div>
        <button type="button" class="btn small" :disabled="lookupBusy" @click="manualLookup">Look up</button>
      </div>

      <div v-if="suggest" class="suggest-box">
        <div class="suggest-head">Multiple matches — which one is it?</div>
        <button v-for="c in suggest.choices" :key="c.id" class="suggest-item" @click="pickSuggestion(c)">
          <div class="s-title">{{ c.label }}</div>
          <div class="s-desc">{{ c.description || 'No description available' }}</div>
        </button>
        <button class="suggest-skip" @click="skipSuggestions">None of these</button>
      </div>

      <div class="row-two">
        <div class="field"><label>{{ labels.year }}</label><input v-model="form.year" type="text" placeholder="e.g. 2019"></div>
        <div v-if="m === 'book' || m === 'music'" class="field"><label>{{ labels.author }}</label><input v-model="form.author" type="text"></div>
      </div>

      <div v-if="m === 'film' || m === 'series'" class="field"><label>{{ labels.director }}</label><input v-model="form.director" type="text"></div>
      <div v-if="m !== 'book'" class="field"><label>{{ labels.cast }}</label><input v-model="form.cast" type="text" placeholder="comma-separated"></div>
      <div v-if="m === 'film' || m === 'series'" class="field"><label>Streaming service / watched on</label><input v-model="form.platform" type="text" placeholder="e.g. Netflix, cinema, Mubi"></div>
      <div v-if="m === 'music'" class="field"><label>Listen link</label><input v-model="form.streamUrl" type="text" placeholder="Spotify, YouTube, SoundCloud, Mixcloud…"><a v-if="isHttp(form.streamUrl)" class="field-link" :href="form.streamUrl.trim()" target="_blank" rel="noopener noreferrer">Open link ↗</a></div>

      <label v-if="!doneMode" class="wish-check"><input type="checkbox" :checked="wish" @change="form.status = $event.target.checked ? 'wishlist' : 'consumed'"> On my wishlist</label>

      <div v-if="!wish" class="row-two">
        <div class="field"><label>Date {{ DONE_VERB[m].toLowerCase() }}</label><input v-model="form.dateConsumed" type="date"></div>
        <div class="field">
          <label id="entry-rating">Rating</label>
          <div class="star-pick" role="group" aria-labelledby="entry-rating">
            <button v-for="i in 5" :key="i" type="button" :class="{ on: i <= form.rating }" :aria-label="`${i} of 5`" :aria-pressed="form.rating === i" @click="form.rating = i">{{ i <= form.rating ? '★' : '☆' }}</button>
          </div>
        </div>
      </div>

      <div class="field"><label>Cover URL</label><input v-model="form.coverUrl" type="text" placeholder="Auto-filled by Look up, or paste your own"></div>
      <div class="field"><label>Insights</label><textarea v-model="form.insights" :placeholder="wish ? 'Why you want it, who recommended it.' : 'Notes, reactions, quotes, whatever\'s worth keeping.'"></textarea></div>

      <p v-if="online && wish" class="form-sub">Only you can see your wishlist.</p>
      <div v-else-if="online" class="field visibility-field">
        <label>Who can see this <span class="label-note">(notes stay private)</span></label>
        <select v-model="form.visibility">
          <option value="">{{ defaultLabel }}</option>
          <option v-for="l in LEVELS" :key="l" :value="l">{{ LEVEL_LABEL[l] }}</option>
        </select>
        <button v-if="editingId" class="btn ghost small" style="margin-top:8px;" @click="copyShareLink">Copy share link</button>
      </div>

      <div class="status">{{ formStatus }}</div>
      <div class="form-actions">
        <button v-if="editingId && !doneMode" type="button" class="btn ghost danger push-left" @click="remove">Delete</button>
        <button class="btn ghost" @click="close">Cancel</button>
        <button class="btn" :disabled="saving" @click="save">Save</button>
      </div>
    </div>
  </Modal>
</template>
