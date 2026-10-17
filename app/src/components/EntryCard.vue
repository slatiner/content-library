<script setup>
import { computed } from 'vue';
import { DONE_VERB, personLine } from '../lib/entries.js';
import Stars from './Stars.vue';
import MediumIcon from './MediumIcon.vue';

// level: the entry's effective visibility (#20), shown when it isn't public;
// '' hides the badge (file mode). readonly: a shared view, no delete.
const props = defineProps({
  entry: { type: Object, required: true },
  level: { type: String, default: '' },
  readonly: { type: Boolean, default: false },
});
defineEmits(['open', 'delete']);

const people = computed(() => personLine(props.entry));
const hasHover = computed(() => props.entry.dateConsumed || props.entry.insights || people.value || props.entry.streamUrl);
</script>

<template>
  <div class="card" @click="$emit('open')">
    <button v-if="!readonly" class="del" title="Delete" @click.stop="$emit('delete')">×</button>
    <div class="cover">
      <img v-if="entry.coverUrl" :src="entry.coverUrl" alt="" loading="lazy">
      <div v-else class="ph" :class="entry.medium">{{ entry.title }}</div>
      <div v-if="hasHover" class="hover-info">
        <div v-if="people" class="hi-people">{{ people }}</div>
        <div v-if="entry.dateConsumed" class="hi-date">{{ DONE_VERB[entry.medium] || 'Finished' }} {{ entry.dateConsumed }}</div>
        <div v-if="entry.insights" class="hi-note">{{ entry.insights }}</div>
        <a v-if="entry.streamUrl" class="hi-listen" :href="entry.streamUrl" target="_blank" rel="noopener noreferrer" @click.stop>Listen ↗</a>
      </div>
      <span class="shield" :class="entry.medium"><MediumIcon :medium="entry.medium" /></span>
      <span v-if="level === 'private' || level === 'friends'" class="level-badge" :title="level === 'private' ? 'Only you can see this' : 'Your friends can see this'">{{ level === 'private' ? 'Only me' : 'Friends' }}</span>
    </div>
    <div class="info">
      <h3>{{ entry.title }}<span v-if="entry.year" class="yr"> ({{ entry.year }})</span></h3>
      <Stars :n="entry.rating" />
    </div>
  </div>
</template>
