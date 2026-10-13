<script setup>
// The ⚙ menu. It sits in the filter row on wide screens and in the header on
// phones (see the 640px rules in styles.css).
import { onBeforeUnmount, onMounted, ref } from 'vue';

defineProps({ canChangeFolder: { type: Boolean, default: false } });
const emit = defineEmits(['change-folder', 'diagnose', 'backup']);

const open = ref(false);
const root = ref(null);
function onDocClick(e) { if (open.value && root.value && !root.value.contains(e.target)) open.value = false; }
onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));

function menu(event) { open.value = false; emit(event); }
</script>

<template>
  <div ref="root" class="popover-wrap">
    <button class="icon-btn" title="More options" @click.stop="open = !open">⚙</button>
    <div class="popover" :class="{ open }">
      <button v-if="canChangeFolder" class="btn ghost small full" @click="menu('change-folder')">Change folder</button>
      <button class="btn ghost small full" @click="menu('diagnose')">Diagnose connection</button>
      <button class="btn ghost small full" @click="menu('backup')">Export / Import JSON</button>
    </div>
  </div>
</template>
