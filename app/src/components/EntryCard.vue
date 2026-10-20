<script setup>
import { computed, ref } from 'vue';
import { DONE_VERB, personLine, isWish } from '../lib/entries.js';
import { shareLink, shareUrl } from '../state.js';
import Stars from './Stars.vue';
import MediumIcon from './MediumIcon.vue';

// level: the entry's effective visibility (#20), shown when it isn't public;
// '' hides the badge (file mode). readonly: a shared view, no delete.
// shareable: online, so a consumed card gets a copy-share-link button.
const props = defineProps({
  entry: { type: Object, required: true },
  level: { type: String, default: '' },
  readonly: { type: Boolean, default: false },
  shareable: { type: Boolean, default: false },
});
const emit = defineEmits(['open', 'delete', 'done']);

// A shared view can't open entries, so a tap shows the details the hover shows.
const peek = ref(false);
function onClick() {
  if (props.readonly) peek.value = !peek.value;
  else emit('open');
}

const wish = computed(() => isWish(props.entry));

const people = computed(() => personLine(props.entry));
const hasHover = computed(() => props.entry.dateConsumed || props.entry.insights || people.value || props.entry.streamUrl);

// Same link as "Copy share link" in the form: this entry only, not the notes.
const shareNote = ref('');
let noteTimer = null;
async function copyShareLink() {
  let note;
  try {
    const url = shareUrl(await shareLink(props.entry.id));
    try { await navigator.clipboard.writeText(url); note = 'Link copied'; }
    catch (e) { note = "Couldn't copy; use Copy share link in the entry"; }
  } catch (e) { note = e.message; }
  shareNote.value = note;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { shareNote.value = ''; }, 2500);
}
</script>

<template>
  <div class="card" :class="{ peek }" @click="onClick">
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
      <button v-if="wish && !readonly" class="done" title="Done: move to Consumed and rate it" @click.stop="$emit('done')">✓</button>
      <button v-if="shareable && !wish && !readonly" type="button" class="share" :class="{ copied: shareNote }" title="Copy share link" aria-label="Copy share link" @click.stop="copyShareLink">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" /></svg>
      </button>
      <span v-if="shareable && !wish && !readonly" class="share-note" role="status">{{ shareNote }}</span>
      <span class="shield" :class="entry.medium"><MediumIcon :medium="entry.medium" /></span>
      <span v-if="level === 'private' || level === 'friends'" class="level-badge" :title="level === 'private' ? 'Only you can see this' : 'Your friends can see this'">{{ level === 'private' ? 'Only me' : 'Friends' }}</span>
    </div>
    <div class="info">
      <!-- The title is the card's keyboard handle; its click bubbles to the card. -->
      <h3><button type="button" class="card-open" :aria-expanded="readonly && hasHover ? peek : undefined">{{ entry.title }}<span v-if="entry.year" class="yr"> ({{ entry.year }})</span></button></h3>
      <Stars v-if="!wish" :n="entry.rating" />
    </div>
  </div>
</template>
