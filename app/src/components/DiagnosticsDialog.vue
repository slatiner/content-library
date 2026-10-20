<script setup>
import { ref, watch } from 'vue';
import { DIAG_TARGETS, checkTarget } from '../lib/lookup.js';
import Modal from './Modal.vue';

const open = defineModel('open', { type: Boolean, default: false });
const results = ref({});

async function run() {
  results.value = Object.fromEntries(DIAG_TARGETS.map((t) => [t.id, `${t.name}: checking…`]));
  await Promise.all(DIAG_TARGETS.map(async (t) => { results.value[t.id] = await checkTarget(t); }));
}

watch(open, (isOpen) => { if (isOpen) run(); });
</script>

<template>
  <Modal v-model:open="open">
    <h2>Connection diagnostics</h2>
    <p class="form-sub">Tests the exact endpoints "Look up" relies on and reports the real result.</p>
    <div class="mono" style="font-size:12px;line-height:1.8;">
      <div v-for="t in DIAG_TARGETS" :key="t.id">{{ results[t.id] }}</div>
    </div>
    <div class="form-actions">
      <button class="btn ghost" @click="open = false">Close</button>
      <button class="btn" @click="run">Run again</button>
    </div>
  </Modal>
</template>
