<script setup>
import { computed } from 'vue';
import { filters, ask, askLibrary, clearAsk, list, setList } from '../state.js';
import { MEDIA, MEDIUM_TAG_LABEL, SORT_ON_WISHLIST } from '../lib/entries.js';

// withLists: the Consumed / Wishlist toggle (#47); a shared view has no wishlist.
defineProps({ withLists: { type: Boolean, default: false } });

const SORTS = [
  ['dateConsumed_desc', 'Recently finished'],
  ['dateAdded_desc', 'Recently added'],
  ['rating_desc', 'Highest rated'],
  ['year_desc', 'Year, newest'],
  ['title_asc', 'Title, A–Z'],
];
// Wishes have no rating or date finished.
const sorts = computed(() => (list.value === 'wishlist' ? SORTS.filter(([v]) => SORT_ON_WISHLIST.includes(v)) : SORTS));

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
      <input v-model="filters.search" type="text" placeholder="Search, ask, or log something…" @keydown.enter="onSearchEnter">
      <select v-model="filters.sortBy">
        <option v-for="[v, label] in sorts" :key="v" :value="v">{{ label }}</option>
      </select>
      <div class="medium-tags">
        <label v-for="m in MEDIA" :key="m" class="tag-check" :class="[m, { active: filters.mediums.includes(m) }]" @click.prevent="toggleMedium(m)">
          <input type="checkbox" :checked="filters.mediums.includes(m)">{{ MEDIUM_TAG_LABEL[m] }}
        </label>
      </div>
      <div v-if="withLists" class="list-toggle" role="tablist">
        <button type="button" role="tab" :aria-selected="list === 'consumed'" :class="{ active: list === 'consumed' }" @click="setList('consumed')">Consumed</button>
        <button type="button" role="tab" :aria-selected="list === 'wishlist'" :class="{ active: list === 'wishlist' }" @click="setList('wishlist')">Wishlist</button>
      </div>
    </div>
    <div v-if="ask.status || ask.chips.length" class="ask-row">
      <span class="ask-status">{{ ask.status }}</span>
      <span class="ask-chips"><span v-for="c in ask.chips" :key="c" class="ask-chip">{{ c }}</span></span>
      <button v-if="ask.criteria !== null" type="button" class="btn ghost small" @click="clearAsk">Clear</button>
    </div>
  </div>
</template>
