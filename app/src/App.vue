<script setup>
import { computed, onMounted, ref } from 'vue';
import { entries, connection, initStorage, connectStorage, reconnectStorage, signOut, redeemInvite, openShared, filters, ask, deleteEntry, onAddRequest, list } from './state.js';
import { countByMedium, filterAndSort, levelOf, inList, isWish } from './lib/entries.js';
import FilterBar from './components/FilterBar.vue';
import SettingsMenu from './components/SettingsMenu.vue';
import EntryCard from './components/EntryCard.vue';
import EntryDialog from './components/EntryDialog.vue';
import BackupDialog from './components/BackupDialog.vue';
import DiagnosticsDialog from './components/DiagnosticsDialog.vue';
import InviteDialog from './components/InviteDialog.vue';
import SharingDialog from './components/SharingDialog.vue';
import AccountDialog from './components/AccountDialog.vue';

// Consumed or Wishlist (#47): the counts and grid show the current list only.
const listed = computed(() => entries.value.filter(inList(list.value)));
const counts = computed(() => countByMedium(listed.value));
const visible = computed(() => filterAndSort(listed.value, filters, ask.criteria));

// 'unsupported' still shows the library, so Export / Import can be used by hand.
const showMain = computed(() => connection.state === 'ok' || connection.state === 'unsupported');
const showSetup = computed(() => connection.state === 'none');
const showSignIn = computed(() => connection.state === 'signedOut');
const showRedeem = computed(() => connection.state === 'needsInvite');
const showShared = computed(() => connection.state === 'shared');
const isOnline = computed(() => connection.kind === 'supabase');
// Badges only online, where levels mean something.
// Wishes are always private, so they carry no badge.
const levelFor = (e) => (isOnline.value && !isWish(e) ? levelOf(e, connection.profile?.defaultVisibility) : '');
const isFile = computed(() => connection.kind === 'file');
const dot = computed(() => (connection.state === 'warn' || connection.state === 'unsupported') ? 'warn' : '');

const dialog = ref(null);
const backupOpen = ref(false);
const diagOpen = ref(false);
const inviteOpen = ref(false);
const sharingOpen = ref(false);
const accountOpen = ref(false);

// An invite link (?invite=CODE) is kept across the Google sign-in round trip,
// which returns to the page without the query.
const PENDING = 'pendingInvite';
function pendingInvite() {
  const fromUrl = new URLSearchParams(window.location.search).get('invite');
  try {
    if (fromUrl) {
      localStorage.setItem(PENDING, fromUrl);
      history.replaceState(null, '', window.location.pathname + window.location.hash);
    }
    return fromUrl || localStorage.getItem(PENDING) || '';
  } catch (e) { return fromUrl || ''; }
}
const inviteCode = ref(pendingInvite());
const redeemError = ref('');
const redeeming = ref(false);
async function redeem() {
  if (!inviteCode.value.trim() || redeeming.value) return;
  redeeming.value = true;
  redeemError.value = '';
  try {
    await redeemInvite(inviteCode.value.trim());
    try { localStorage.removeItem(PENDING); } catch (e) { /* storage unavailable */ }
  } catch (e) { redeemError.value = e.message; }
  finally { redeeming.value = false; }
}

onAddRequest((text) => dialog.value.describe(text));
// A share link (?share=TOKEN) opens that read-only view instead of the user's own library.
const shareToken = new URLSearchParams(window.location.search).get('share');
onMounted(() => (shareToken ? openShared(shareToken) : initStorage()));
</script>

<template>
  <div class="wrap">
    <header class="top">
      <h1>nik's media.json</h1>
      <div class="header-right">
        <div class="counts mono">
          <span><b>{{ counts.book }}</b> books</span><span><b>{{ counts.film }}</b> films</span><span><b>{{ counts.series }}</b> series</span><span><b>{{ counts.music }}</b> music</span>
        </div>
        <button v-if="showMain" class="add-new-btn" @click="dialog.open(null)">+ Add new</button>
      </div>
      <SettingsMenu v-if="showMain" :can-change-folder="isFile" :can-share="isOnline" :can-invite="!!connection.profile?.isAdmin"
        :account="connection.state === 'ok' ? connection.account : ''" :profile="connection.profile"
        @change-folder="connectStorage" @sharing="sharingOpen = true" @invite="inviteOpen = true" @diagnose="diagOpen = true" @backup="backupOpen = true" @account="accountOpen = true" @sign-out="signOut" />
    </header>

    <div v-if="connection.state !== 'ok'" class="filebar">
      <span class="dot" :class="dot"></span>
      <span>{{ connection.text }}</span>
      <span style="flex:1;"></span>
      <template v-if="connection.state === 'warn' && isFile">
        <button class="btn ghost small" @click="reconnectStorage">Reconnect</button>
        <button class="btn ghost small" @click="connectStorage">Change folder</button>
      </template>
      <template v-else-if="connection.state === 'warn'">
        <button class="btn ghost small" @click="reconnectStorage">Retry</button>
        <button v-if="connection.account" class="btn ghost small" @click="signOut">Sign out</button>
        <button v-else class="btn ghost small" @click="connectStorage">Sign in again</button>
      </template>
    </div>

    <div v-if="showSetup" class="setup">
      <p>No folder connected yet. Pick the folder where you keep your data (for example this project's folder) — the app will create/use a file called <code>media-archive-data.json</code> inside it automatically from now on, no browsing to find it each time. Brave/Chrome will still ask you to reconnect on each new launch — that's the browser's own security check, not something I can skip.</p>
      <button class="btn" @click="connectStorage">Connect folder</button>
    </div>

    <div v-if="showSignIn" class="setup">
      <p v-if="inviteCode">You've been invited. Sign in with Google to accept, and your code will be filled in.</p>
      <p v-else>Your library is stored in your account. Sign in with Google to see it. New here? You'll need an invite code.</p>
      <button class="btn" @click="connectStorage">Sign in with Google</button>
      <p class="setup-foot"><a href="privacy.html" target="_blank" rel="noopener">Privacy policy</a></p>
    </div>

    <form v-if="showRedeem" class="setup redeem" @submit.prevent="redeem">
      <p>Signed in as {{ connection.account }}. This app is invite-only for now: enter the code you were given.</p>
      <div class="redeem-row">
        <input v-model="inviteCode" class="mono" placeholder="XXXX-XXXX-XXXX" aria-label="Invite code" autocomplete="off">
        <button class="btn" type="submit" :disabled="redeeming || !inviteCode.trim()">Join</button>
      </div>
      <p v-if="redeemError" class="redeem-error">{{ redeemError }}</p>
      <button class="btn ghost small" type="button" @click="signOut">Sign out</button>
      <p class="setup-foot"><a href="privacy.html" target="_blank" rel="noopener">Privacy policy</a> · <button class="link-btn" type="button" @click="accountOpen = true">Delete this account</button></p>
    </form>

    <div v-if="showShared && entries.length" class="shared-view">
      <FilterBar />
      <TransitionGroup name="card" tag="div" class="grid">
        <EntryCard v-for="e in visible" :key="e.id" :entry="e" readonly />
      </TransitionGroup>
      <div v-if="!visible.length" class="empty">No matches.</div>
    </div>

    <div v-if="showMain">
      <FilterBar with-lists />
      <TransitionGroup name="card" tag="div" class="grid">
        <EntryCard v-for="e in visible" :key="e.id" :entry="e" :level="levelFor(e)" @open="dialog.open(e)" @done="dialog.open(e, { done: true })" @delete="deleteEntry(e.id)" />
      </TransitionGroup>
      <div v-if="!visible.length" class="empty">
        {{ listed.length
          ? (list === 'wishlist'
            ? 'No matches. Press Enter in the search box to ask in plain language, for example "films from the 90s".'
            : 'No matches. Press Enter in the search box to ask in plain language, for example "films I rated 4 or higher this year".')
          : (list === 'wishlist'
            ? 'Nothing on your wishlist yet. Add something you want to watch, read or listen to. Only you can see it.'
            : 'Nothing here yet. Add your first entry.') }}
      </div>
    </div>
  </div>

  <EntryDialog ref="dialog" />
  <BackupDialog v-model:open="backupOpen" />
  <DiagnosticsDialog v-model:open="diagOpen" />
  <InviteDialog v-model:open="inviteOpen" />
  <SharingDialog v-model:open="sharingOpen" />
  <AccountDialog v-model:open="accountOpen" />
</template>
