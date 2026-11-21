<script setup>
import { computed } from 'vue';
import { filters, ask, askLibrary, clearAsk, list, setList } from '../state.js';
import { MEDIA, MEDIUM_TAG_LABEL, SORT_ON_WISHLIST } from '../lib/entries.js';
import MediumIcon from './MediumIcon.vue';

// withLists: the Consumed / Wishlist toggle (#47); a shared view has no wishlist.
// counts: entries per medium in the current list, shown on each type's tag.
// drag: while swiping between the lists, how far (-1..1) the toggle's highlight has moved off its list.
const props = defineProps({ withLists: { type: Boolean, default: false }, counts: { type: Object, default: () => ({}) }, drag: { type: Number, default: 0 } });
// 0 = Consumed, 1 = Wishlist; the highlight sits there and the label over it turns white.
const pillPos = computed(() => Math.min(1, Math.max(0, (list.value === 'wishlist' ? 1 : 0) + props.drag)));

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
      <input v-model="filters.search" type="text" placeholder="Type anything…" @keydown.enter="onSearchEnter">
      <!-- On phones the select is invisible over an icon of the current sort; tapping still opens the native picker. -->
      <span class="sort-pick" :data-sort="filters.sortBy">
        <svg class="sort-icon" viewBox="0 0 24 24" aria-hidden="true">
          <template v-if="filters.sortBy === 'dateConsumed_desc'"><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></template>
          <template v-else-if="filters.sortBy === 'dateAdded_desc'"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></template>
          <template v-else-if="filters.sortBy === 'rating_desc'"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9Z" /></template>
          <template v-else-if="filters.sortBy === 'year_desc'"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></template>
          <template v-else><path d="M4 17 7.5 7 11 17M5.2 13.5h4.6M14 7h6l-6 10h6" /></template>
        </svg>
        <svg class="sort-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
        <select v-model="filters.sortBy" aria-label="Sort">
          <option v-for="[v, label] in sorts" :key="v" :value="v">{{ label }}</option>
        </select>
      </span>
      <div class="medium-tags">
        <label v-for="m in MEDIA" :key="m" class="tag-check" :class="[m, { active: filters.mediums.includes(m) }]" @click.prevent="toggleMedium(m)">
          <input type="checkbox" class="visually-hidden" :checked="filters.mediums.includes(m)" :aria-label="`${MEDIUM_TAG_LABEL[m]}, ${counts[m] ?? 0}`">
          <MediumIcon :medium="m" class="tag-icon" /><span class="tag-label">{{ MEDIUM_TAG_LABEL[m] }}</span>
          <span class="tag-count mono">{{ counts[m] ?? 0 }}</span>
        </label>
      </div>
      <div v-if="withLists" class="list-toggle" role="tablist" :class="{ dragging: drag !== 0 }" :style="{ '--pill': pillPos }">
        <span class="list-pill" aria-hidden="true" />
        <button type="button" role="tab" :aria-selected="list === 'consumed'" :class="{ active: list === 'consumed', lit: pillPos < 0.5 }" @click="setList('consumed')">Consumed</button>
        <button type="button" role="tab" :aria-selected="list === 'wishlist'" :class="{ active: list === 'wishlist', lit: pillPos >= 0.5 }" @click="setList('wishlist')">Wishlist</button>
      </div>
    </div>
    <div v-if="ask.status || ask.chips.length" class="ask-row">
      <span class="ask-status">{{ ask.status }}</span>
      <span class="ask-chips"><span v-for="c in ask.chips" :key="c" class="ask-chip">{{ c }}</span></span>
      <button v-if="ask.criteria !== null" type="button" class="btn ghost small" @click="clearAsk">Clear</button>
    </div>
  </div>
</template>
