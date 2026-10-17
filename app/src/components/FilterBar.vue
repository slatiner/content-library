<script setup>
import { filters, ask, askLibrary, clearAsk } from '../state.js';
import { MEDIA, MEDIUM_TAG_LABEL } from '../lib/entries.js';

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
        <option value="dateConsumed_desc">Recently finished</option>
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
    </div>
    <div v-if="ask.status || ask.chips.length" class="ask-row">
      <span class="ask-status">{{ ask.status }}</span>
      <span class="ask-chips"><span v-for="c in ask.chips" :key="c" class="ask-chip">{{ c }}</span></span>
      <button v-if="ask.criteria !== null" type="button" class="btn ghost small" @click="clearAsk">Clear</button>
    </div>
  </div>
</template>
