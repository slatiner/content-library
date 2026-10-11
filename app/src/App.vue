<script setup>
import { computed, onMounted, ref } from 'vue';
import { entries, connection, initStorage, connectStorage, reconnectStorage, filters, ask, deleteEntry } from './state.js';
import { countByMedium, filterAndSort } from './lib/entries.js';
import FilterBar from './components/FilterBar.vue';
import EntryCard from './components/EntryCard.vue';
import EntryDialog from './components/EntryDialog.vue';
import BackupDialog from './components/BackupDialog.vue';
import DiagnosticsDialog from './components/DiagnosticsDialog.vue';

const counts = computed(() => countByMedium(entries.value));
const visible = computed(() => filterAndSort(entries.value, filters, ask.criteria));

// 'unsupported' still shows the library, so Export / Import can be used by hand.
const showMain = computed(() => connection.state === 'ok' || connection.state === 'unsupported');
const showSetup = computed(() => connection.state === 'none');
const dot = computed(() => (connection.state === 'warn' || connection.state === 'unsupported') ? 'warn' : '');

const dialog = ref(null);
const backupOpen = ref(false);
const diagOpen = ref(false);

onMounted(initStorage);
</script>

<template>
  <div class="wrap">
    <header class="top">
      <h1>nik's media.json</h1>
      <div class="header-right">
        <div class="counts mono">
          <span><b>{{ counts.book }}</b> books</span><span><b>{{ counts.film }}</b> films</span><span><b>{{ counts.series }}</b> series</span><span><b>{{ counts.music }}</b> music</span>
        </div>
        <button class="add-new-btn" @click="dialog.open(null)">+ Add new</button>
      </div>
    </header>

    <div v-if="connection.state !== 'ok'" class="filebar">
      <span class="dot" :class="dot"></span>
      <span>{{ connection.text }}</span>
      <span style="flex:1;"></span>
      <template v-if="connection.state === 'warn'">
        <button class="btn ghost small" @click="reconnectStorage">Reconnect</button>
        <button class="btn ghost small" @click="connectStorage">Change folder</button>
      </template>
    </div>

    <div v-if="showSetup" class="setup">
      <p>No folder connected yet. Pick the folder where you keep your data (for example this project's folder) — the app will create/use a file called <code>media-archive-data.json</code> inside it automatically from now on, no browsing to find it each time. Brave/Chrome will still ask you to reconnect on each new launch — that's the browser's own security check, not something I can skip.</p>
      <button class="btn" @click="connectStorage">Connect folder</button>
    </div>

    <div v-if="showMain">
      <FilterBar @change-folder="connectStorage" @diagnose="diagOpen = true" @backup="backupOpen = true" />
      <TransitionGroup name="card" tag="div" class="grid">
        <EntryCard v-for="e in visible" :key="e.id" :entry="e" @open="dialog.open(e)" @delete="deleteEntry(e.id)" />
      </TransitionGroup>
      <div v-if="!visible.length" class="empty">
        {{ entries.length
          ? 'No matches. Press Enter in the search box to ask in plain language, for example "films I rated 4 or higher this year".'
          : 'Nothing here yet. Add your first entry.' }}
      </div>
    </div>
  </div>

  <EntryDialog ref="dialog" />
  <BackupDialog v-model:open="backupOpen" />
  <DiagnosticsDialog v-model:open="diagOpen" />
</template>
