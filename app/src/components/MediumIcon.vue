<script setup>
defineProps({ medium: { type: String, required: true } });
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <template v-if="medium === 'book'">
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H12v20H6.5A2.5 2.5 0 0 1 4 19.5v-15Z" />
      <path d="M20 4.5A2.5 2.5 0 0 0 17.5 2H12v20h5.5a2.5 2.5 0 0 0 2.5-2.5v-15Z" />
    </template>
    <template v-else-if="medium === 'film'">
      <path d="m4 8 15.5-3 .8 4-15.5 3Z" />
      <rect x="4" y="10" width="16" height="10" rx="1" />
    </template>
    <template v-else-if="medium === 'series'">
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="m8 3 4 3 4-3" />
    </template>
    <template v-else-if="medium === 'music'">
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </template>
  </svg>
</template>
