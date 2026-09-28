<template>
  <section class="banner">
    <h1>Ship it on Friday</h1>
    <p class="lead">Small changes, reviewed properly.</p>
    <p>{{ count }} deploys, {{ label.length }} chars</p>
    <p>Read our <a href="/guide">guide</a></p>
  </section>
</template>

<script setup>
import { ref } from 'vue';

const label = ref('<p>not markup</p>');
const count = ref(12);
</script>

<style scoped>
.banner { padding: 22px; }
p { color: #475569; }
</style>
