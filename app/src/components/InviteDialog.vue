<script setup>
// Admins create invite codes here (#28). Each code works once and expires
// after 14 days; the link fills the code in for the person signing up.
import { ref, watch } from 'vue';
import { createInvite, listInvites } from '../state.js';

const open = defineModel('open', { type: Boolean, default: false });
const invites = ref([]);
const latest = ref(null);
const status = ref('');
const busy = ref(false);

const linkFor = (code) => `${window.location.origin}${window.location.pathname}?invite=${code}`;
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
function stateOf(inv) {
  if (inv.usedAt) return `used ${day(inv.usedAt)}`;
  if (new Date(inv.expiresAt) < new Date()) return 'expired';
  return `unused, expires ${day(inv.expiresAt)}`;
}

async function refresh() {
  try { invites.value = await listInvites(); } catch (e) { status.value = e.message; }
}

watch(open, (isOpen) => {
  if (!isOpen) return;
  latest.value = null;
  status.value = '';
  refresh();
});

async function create() {
  busy.value = true;
  status.value = '';
  try {
    latest.value = await createInvite();
    await refresh();
  } catch (e) { status.value = e.message; }
  finally { busy.value = false; }
}

async function copy() {
  try { await navigator.clipboard.writeText(linkFor(latest.value.code)); status.value = 'Link copied.'; }
  catch (e) { status.value = 'Clipboard blocked. Copy the link by hand.'; }
}
</script>

<template>
  <div class="overlay" :class="{ open }" @click.self="open = false">
    <div class="form-panel">
      <h2>Invite someone</h2>
      <p class="form-sub">Each code works once and expires after 14 days. They sign in with Google, then enter the code (the link fills it in).</p>
      <button class="btn small" :disabled="busy" @click="create">Create invite code</button>
      <div v-if="latest" class="field invite-new" style="margin-top:16px;">
        <label>New code</label>
        <div class="mono invite-code">{{ latest.code }}</div>
        <input class="mono" :value="linkFor(latest.code)" readonly @focus="$event.target.select()">
        <button class="btn small ghost" style="margin-top:8px;" @click="copy">Copy link</button>
      </div>
      <div class="status">{{ status }}</div>
      <div v-if="invites.length" class="field" style="margin-top:16px;border-top:1px solid var(--line);padding-top:16px;">
        <label>Recent codes</label>
        <ul class="invite-list mono">
          <li v-for="inv in invites" :key="inv.code"><b>{{ inv.code }}</b> · {{ stateOf(inv) }}</li>
        </ul>
      </div>
      <div class="form-actions">
        <button class="btn ghost" @click="open = false">Close</button>
      </div>
    </div>
  </div>
</template>
