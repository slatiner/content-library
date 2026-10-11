<script setup>
defineProps({ n: { type: Number, default: 0 } });
</script>

<template>
  <div class="stars"><span v-for="i in 5" :key="i" :class="i <= n ? '' : 'off'">★</span></div>
</template>
