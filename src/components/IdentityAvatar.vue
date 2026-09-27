<template>
  <v-avatar :size="size" :color="background" class="identity-avatar">
    <span class="identity-avatar__initial" :style="{ fontSize: `${Math.round(Number(size) * 0.42)}px` }">
      {{ initial }}
    </span>
  </v-avatar>
</template>

<script setup>
import { computed } from 'vue'
import { hashString } from '@/utils/format'

const props = defineProps({
  name: { type: String, default: '匿名' },
  size: { type: [Number, String], default: 40 },
})

const initial = computed(() => String(props.name || '匿').trim().slice(0, 1).toUpperCase())

// Deterministic colour per nickname, so the same visitor always looks the same.
const background = computed(() => {
  const hue = hashString(String(props.name || 'anonymous')) % 360
  return `hsl(${hue}, 52%, 44%)`
})
</script>

<style scoped>
.identity-avatar {
  flex: none;
  overflow: hidden;
}

.identity-avatar__initial {
  color: #fff;
  font-weight: 600;
  line-height: 1;
  user-select: none;
}
</style>
