<script setup>
// One shared item, as a page (?share=TOKEN for a single entry). Shows what the
// sharer logged (never their note) and, depending on who is looking: sign in,
// join with a code or ask for one, or save a copy to your own wishlist with
// your own note.
import { computed, ref } from 'vue';
import { DONE_VERB, personLine } from '../lib/entries.js';
import { shared, saveSharedToWishlist, joinFromShared, requestAccess } from '../state.js';
import Stars from './Stars.vue';
import GoogleButton from './GoogleButton.vue';

const props = defineProps({ entry: { type: Object, required: true } });
defineEmits(['sign-in']);

const MEDIUM_LABEL = { book: 'Book', film: 'Film', series: 'Series', music: 'Music' };
const people = computed(() => personLine(props.entry));
const owner = computed(() => shared.owner || 'They');
const libraryUrl = window.location.pathname;
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

const note = ref('');
const code = ref('');
const message = ref('');
const asking = ref(false);
const busy = ref(false);
const status = ref('');

async function run(fn) {
  if (busy.value) return;
  busy.value = true;
  status.value = '';
  try { await fn(); } catch (e) { status.value = e.message; }
  finally { busy.value = false; }
}
const save = () => run(() => saveSharedToWishlist(props.entry, note.value));
const join = () => code.value.trim() && run(() => joinFromShared(code.value.trim()));
const ask = () => run(async () => { await requestAccess(message.value); asking.value = false; });
</script>

<template>
  <article class="shared-item">
    <div class="si-cover">
      <img v-if="entry.coverUrl" :src="entry.coverUrl" alt="">
      <div v-else class="pv-ph" :class="entry.medium"></div>
    </div>
    <div class="si-body">
      <span class="pv-chip" :class="entry.medium">{{ MEDIUM_LABEL[entry.medium] || entry.medium }}</span>
      <h2 class="si-title">{{ entry.title }}<span v-if="entry.year" class="yr"> ({{ entry.year }})</span></h2>
      <p v-if="people" class="si-people">{{ people }}</p>
      <dl class="si-facts">
        <template v-if="entry.rating">
          <dt>{{ shared.owner ? `${shared.owner}'s rating` : 'Rating' }}</dt>
          <dd><Stars :n="entry.rating" /></dd>
        </template>
        <template v-if="entry.dateConsumed">
          <dt>{{ DONE_VERB[entry.medium] || 'Finished' }}</dt>
          <dd>{{ entry.dateConsumed }}</dd>
        </template>
        <template v-if="entry.platform">
          <dt>On</dt>
          <dd>{{ entry.platform }}</dd>
        </template>
      </dl>
      <a v-if="entry.streamUrl" class="si-listen" :href="entry.streamUrl" target="_blank" rel="noopener noreferrer">Listen ↗</a>

      <section v-if="shared.viewer" class="si-action" aria-live="polite">
        <template v-if="shared.viewer.state === 'member'">
          <p v-if="shared.mine === 'consumed'" class="si-done">Already in your library. <a :href="libraryUrl">Open it</a></p>
          <p v-else-if="shared.mine === 'wishlist'" class="si-done">On your wishlist. <a :href="libraryUrl">Open it</a></p>
          <form v-else @submit.prevent="save">
            <div class="field">
              <label for="si-note">Your note <span class="label-note">(only you see it)</span></label>
              <textarea id="si-note" v-model="note" rows="2" :placeholder="`For example: ${owner} recommended it`"></textarea>
            </div>
            <button class="btn" type="submit" :disabled="busy">Save to my wishlist</button>
          </form>
        </template>

        <template v-else-if="shared.viewer.state === 'needsInvite'">
          <p>Signed in as {{ shared.viewer.email }}. This app is invite-only for now. Enter your code to save this to your wishlist.</p>
          <form class="redeem-row" @submit.prevent="join">
            <input v-model="code" class="mono" placeholder="XXXX-XXXX-XXXX" aria-label="Invite code" autocomplete="off">
            <button class="btn" type="submit" :disabled="busy || !code.trim()">Join</button>
          </form>
          <p v-if="shared.viewer.requestedAt && !asking" class="form-sub">
            You asked for a code on {{ day(shared.viewer.requestedAt) }}. It will come to {{ shared.viewer.email }}.
            <button type="button" class="link-btn" @click="asking = true">Change your message</button>
          </p>
          <button v-else-if="!asking" type="button" class="link-btn" @click="asking = true">No code? Ask for one</button>
          <form v-if="asking" class="si-ask" @submit.prevent="ask">
            <div class="field">
              <label for="si-message">Message to the admin</label>
              <textarea id="si-message" v-model="message" rows="2" maxlength="500" :placeholder="`For example: ${owner} shared a ${(MEDIUM_LABEL[entry.medium] || 'title').toLowerCase()} with me`"></textarea>
            </div>
            <button class="btn" type="submit" :disabled="busy">Ask for a code</button>
            <button class="btn ghost" type="button" @click="asking = false">Cancel</button>
          </form>
        </template>

        <template v-else-if="shared.viewer.state === 'signedOut'">
          <p>Want to get to this later? Sign in to save it to your wishlist. New here? After signing in you can enter an invite code or ask for one.</p>
          <GoogleButton @click="$emit('sign-in')" />
        </template>

        <p v-else class="form-sub">{{ shared.viewer.text }}</p>
        <div class="status">{{ status }}</div>
      </section>
    </div>
  </article>
</template>
