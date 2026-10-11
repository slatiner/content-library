<script setup>
import { ref, watch } from 'vue';
import { entries, mergeEntries, replaceEntries } from '../state.js';

const open = defineModel('open', { type: Boolean, default: false });
const exportText = ref('');
const importText = ref('');
const status = ref('');
const exportEl = ref(null);

watch(open, (isOpen) => {
  if (!isOpen) return;
  exportText.value = JSON.stringify(entries.value, null, 2);
  importText.value = '';
  status.value = '';
});

function parseImport() {
  const raw = importText.value.trim();
  if (!raw) throw new Error('empty');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('not an array');
  return parsed;
}

async function copy() {
  try { await navigator.clipboard.writeText(exportText.value); status.value = 'Copied to clipboard.'; }
  catch (e) { exportEl.value.select(); status.value = 'Clipboard blocked — text selected, copy manually.'; }
}

async function merge() {
  try {
    const added = await mergeEntries(parseImport());
    status.value = `Merged — added ${added} new entr${added === 1 ? 'y' : 'ies'}.`;
  } catch (e) { status.value = "Couldn't read that as a backup."; }
}

async function replace() {
  try {
    const incoming = parseImport();
    if (!confirm(`Replace all ${entries.value.length} current entries with ${incoming.length} from this backup?`)) return;
    await replaceEntries(incoming);
    status.value = `Replaced — now ${entries.value.length} entries.`;
  } catch (e) { status.value = "Couldn't read that as a backup."; }
}
</script>

<template>
  <div class="overlay" :class="{ open }" @click.self="open = false">
    <div class="form-panel">
      <h2>Export / Import JSON</h2>
      <p class="form-sub">Your library is saved automatically. Use this as a manual backup, or to move data between machines, browsers or accounts.</p>
      <div class="field">
        <label>Current data — copy this</label>
        <textarea ref="exportEl" :value="exportText" class="mono" readonly style="min-height:110px;font-size:11px;"></textarea>
      </div>
      <button class="btn small" @click="copy">Copy to clipboard</button>
      <div class="field" style="margin-top:20px;border-top:1px solid var(--line);padding-top:16px;">
        <label>Restore from a backup — paste JSON here</label>
        <textarea v-model="importText" class="mono" placeholder="Paste a previously copied backup here" style="min-height:90px;font-size:11px;"></textarea>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn small ghost" @click="merge">Merge (add missing only)</button>
        <button class="btn small danger" @click="replace">Replace all</button>
      </div>
      <div class="status">{{ status }}</div>
      <div class="form-actions">
        <button class="btn ghost" @click="open = false">Close</button>
      </div>
    </div>
  </div>
</template>
