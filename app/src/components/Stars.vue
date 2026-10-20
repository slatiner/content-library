<script setup>
defineProps({ n: { type: Number, default: 0 } });
</script>

<template>
  <div class="stars" role="img" :aria-label="n ? `Rated ${n} of 5` : 'Not rated'"><span v-for="i in 5" :key="i" :class="i <= n ? '' : 'off'" aria-hidden="true">{{ i <= n ? '★' : '☆' }}</span></div>
</template>
