<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { filters, ask, askLibrary, clearAsk } from '../state.js';
import { MEDIA, MEDIUM_TAG_LABEL } from '../lib/entries.js';
import SettingsMenu from './SettingsMenu.vue';

defineProps({ canChangeFolder: { type: Boolean, default: false } });
const emit = defineEmits(['change-folder', 'diagnose', 'backup']);

const openPop = ref(null); // 'date' | null
const datePop = ref(null);
function togglePop(name) { openPop.value = openPop.value === name ? null : name; }
function onDocClick(e) {
  if (openPop.value === 'date' && datePop.value && !datePop.value.contains(e.target)) openPop.value = null;
}
onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));

const dateLabel = computed(() => (filters.dateFrom || filters.dateTo)
  ? `${filters.dateFrom || '…'} – ${filters.dateTo || '…'}` : 'Date range');
function clearDates() { filters.dateFrom = ''; filters.dateTo = ''; }

// With every type on, clicking one shows only that type; otherwise clicks toggle.
function toggleMedium(m) {
  if (filters.mediums.length === MEDIA.length) filters.mediums = [m];
  else if (filters.mediums.includes(m)) filters.mediums = filters.mediums.filter((x) => x !== m);
  else filters.mediums = MEDIA.filter((x) => x === m || filters.mediums.includes(x));
}

function onSearchEnter(e) {
  if (e.isComposing) return;
  const q = filters.search.trim();
  if (q) { e.preventDefault(); askLibrary(q); }
}
</script>

<template>
  <div class="filter-bar">
    <div class="filter-row">
      <input v-model="filters.search" type="text" placeholder="Search, ask (films I rated 4+) or add (just saw Dune, 4 stars) ↵" @keydown.enter="onSearchEnter">
      <div ref="datePop" class="popover-wrap">
        <button class="input-btn" @click.stop="togglePop('date')">📅 <span>{{ dateLabel }}</span></button>
        <div class="popover" :class="{ open: openPop === 'date' }">
          <div class="field"><label>From</label><input v-model="filters.dateFrom" type="date"></div>
          <div class="field"><label>To</label><input v-model="filters.dateTo" type="date"></div>
          <div class="pop-actions">
            <button class="btn ghost small" @click="clearDates">Clear</button>
            <button class="btn small" @click="openPop = null">Apply</button>
          </div>
        </div>
      </div>
      <select v-model="filters.sortBy">
        <option value="dateConsumed_desc">Recently consumed</option>
        <option value="dateAdded_desc">Recently added</option>
        <option value="rating_desc">Highest rated</option>
        <option value="year_desc">Year, newest</option>
        <option value="title_asc">Title, A–Z</option>
      </select>
      <div class="medium-tags">
        <label v-for="m in MEDIA" :key="m" class="tag-check" :class="[m, { active: filters.mediums.includes(m) }]" @click.prevent="toggleMedium(m)">
          <input type="checkbox" :checked="filters.mediums.includes(m)">{{ MEDIUM_TAG_LABEL[m] }}
        </label>
      </div>
      <SettingsMenu class="settings-wide" :can-change-folder="canChangeFolder"
        @change-folder="emit('change-folder')" @diagnose="emit('diagnose')" @backup="emit('backup')" />
    </div>
    <div v-if="ask.status || ask.chips.length" class="ask-row">
      <span class="ask-status">{{ ask.status }}</span>
      <span class="ask-chips"><span v-for="c in ask.chips" :key="c" class="ask-chip">{{ c }}</span></span>
      <button v-if="ask.criteria !== null" type="button" class="btn ghost small" @click="clearAsk">Clear</button>
    </div>
  </div>
</template>
