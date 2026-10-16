<script setup>
// The account menu in the header: opens from the avatar when signed in, or
// from ⚙ in file mode. Holds the settings actions and Sign out.
import { onBeforeUnmount, onMounted, ref } from 'vue';
import Avatar from './Avatar.vue';

defineProps({
  canChangeFolder: { type: Boolean, default: false },
  canInvite: { type: Boolean, default: false },
  account: { type: String, default: '' },
  profile: { type: Object, default: null },
});
const emit = defineEmits(['change-folder', 'invite', 'diagnose', 'backup', 'sign-out']);

const open = ref(false);
const root = ref(null);
function onDocClick(e) { if (open.value && root.value && !root.value.contains(e.target)) open.value = false; }
onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));

function menu(event) { open.value = false; emit(event); }
</script>

<template>
  <div ref="root" class="popover-wrap account-menu">
    <button v-if="account" class="avatar-btn" :aria-expanded="open" aria-haspopup="menu" @click.stop="open = !open">
      <Avatar :email="account" :name="profile?.name || ''" :src="profile?.avatarUrl || ''" />
    </button>
    <button v-else class="icon-btn" title="More options" :aria-expanded="open" aria-haspopup="menu" @click.stop="open = !open">⚙</button>
    <div class="popover" :class="{ open }" role="menu">
      <div v-if="account" class="menu-who">
        <b v-if="profile?.name">{{ profile.name }}</b>
        <span>{{ account }}</span>
      </div>
      <button v-if="canChangeFolder" class="btn ghost small full" @click="menu('change-folder')">Change folder</button>
      <button v-if="canInvite" class="btn ghost small full" @click="menu('invite')">Invite someone</button>
      <button class="btn ghost small full" @click="menu('diagnose')">Diagnose connection</button>
      <button class="btn ghost small full" @click="menu('backup')">Export / Import JSON</button>
      <button v-if="account" class="btn ghost small full" @click="menu('sign-out')">Sign out</button>
    </div>
  </div>
</template>
