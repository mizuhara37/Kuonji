<template>
  <div v-if="icon || title" class="empty-state">
    <v-icon v-if="icon" :size="56" class="empty-state__icon">{{ icon }}</v-icon>
    <div class="md-title-medium empty-state__title">{{ title }}</div>
    <div v-if="hint" class="md-body-medium empty-state__hint">{{ hint }}</div>
    <div v-if="$slots.action" class="mt-4"><slot name="action" /></div>
  </div>
</template>

<script setup>
defineProps({
  icon: { type: String, default: 'mdi-movie-open-off-outline' },
  title: { type: String, default: '没有数据了~' },
  hint: { type: String, default: '' },
})
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 16px;
  text-align: center;
  color: rgb(var(--v-theme-on-surface-variant));
}

.empty-state__icon {
  opacity: 0.38;
  margin-bottom: 12px;
}

.empty-state__title {
  opacity: 0.7;
}

.empty-state__hint {
  margin-top: 6px;
  opacity: 0.56;
}
</style>
