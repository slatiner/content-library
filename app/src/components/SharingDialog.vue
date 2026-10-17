<script setup>
// Sharing settings (#20): the library's default level, and secret links for
// people without an account. Notes are never shared.
import { computed, ref, watch } from 'vue';
import { connection, entries, setDefaultVisibility, shareLink, listShareLinks, revokeShareLink, shareUrl } from '../state.js';
import { LEVELS, LEVEL_LABEL } from '../lib/entries.js';

const open = defineModel('open', { type: Boolean, default: false });
const links = ref([]);
const status = ref('');
const level = computed(() => connection.profile?.defaultVisibility || 'private');

const titleOf = (id) => (entries.value.find((e) => e.id === id) || {}).title || id;

async function refresh() {
  try { links.value = await listShareLinks(); } catch (e) { status.value = e.message; }
}

watch(open, (isOpen) => {
  if (!isOpen) return;
  status.value = '';
  refresh();
});

async function changeLevel(e) {
  try { await setDefaultVisibility(e.target.value); status.value = 'Saved.'; }
  catch (err) { status.value = err.message; }
}

async function copyLibraryLink() {
  try {
    const url = shareUrl(await shareLink(null));
    await refresh();
    try { await navigator.clipboard.writeText(url); status.value = 'Library link copied.'; }
    catch (e) { status.value = `Copy this link: ${url}`; }
  } catch (e) { status.value = e.message; }
}

async function revoke(token) {
  try { await revokeShareLink(token); await refresh(); status.value = 'Link revoked. It no longer works.'; }
  catch (e) { status.value = e.message; }
}
</script>

<template>
  <div class="overlay" :class="{ open }" @click.self="open = false">
    <div class="form-panel">
      <h2>Sharing</h2>
      <p class="form-sub">Who can see your entries. Each entry follows this unless you change it on the entry. Notes are never shared.</p>
      <div class="field">
        <label>Library default</label>
        <select :value="level" @change="changeLevel">
          <option v-for="l in LEVELS" :key="l" :value="l">{{ LEVEL_LABEL[l] }}</option>
        </select>
      </div>
      <div class="field" style="margin-top:16px;border-top:1px solid var(--line);padding-top:16px;">
        <label>Share with someone without an account</label>
        <p class="form-sub" style="margin:0 0 8px;">Anyone with the link sees your public entries, read-only. They can't find anything without it.</p>
        <button class="btn small" @click="copyLibraryLink">Copy library link</button>
      </div>
      <div v-if="links.length" class="field" style="margin-top:16px;">
        <label>Active links</label>
        <ul class="share-list">
          <li v-for="l in links" :key="l.token">
            <span>{{ l.entryId ? titleOf(l.entryId) : 'Whole library (public entries)' }}</span>
            <button class="btn ghost small" @click="revoke(l.token)">Revoke</button>
          </li>
        </ul>
      </div>
      <div class="status">{{ status }}</div>
      <div class="form-actions">
        <button class="btn ghost" @click="open = false">Close</button>
      </div>
    </div>
  </div>
</template>
