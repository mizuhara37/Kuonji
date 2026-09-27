<template>
  <transition name="fab">
    <v-btn
      v-show="visible"
      class="back-top"
      :class="{ 'back-top--shifted': shifted }"
      icon="mdi-chevron-up"
      color="primary"
      size="large"
      elevation="4"
      aria-label="返回顶部"
      @click="toTop"
    />
  </transition>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { isMini } from '@/store/player'

const props = defineProps({
  threshold: { type: Number, default: 380 },
})

const visible = ref(false)

/** Move above the floating mini player so they don't overlap. */
const shifted = computed(() => isMini.value)

function onScroll() {
  visible.value = document.documentElement.scrollTop > props.threshold
}

function toTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})

onUnmounted(() => window.removeEventListener('scroll', onScroll))
</script>

<style scoped>
.back-top {
  position: fixed;
  right: 28px;
  bottom: 96px;
  z-index: 1200;
  transition: bottom 0.25s cubic-bezier(0.2, 0, 0, 1);
}

.back-top--shifted {
  bottom: 288px;
}

.fab-enter-active,
.fab-leave-active {
  transition: opacity 0.25s cubic-bezier(0.2, 0, 0, 1),
    transform 0.25s cubic-bezier(0.2, 0, 0, 1);
}

.fab-enter-from,
.fab-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.9);
}

@media (max-width: 600px) {
  .back-top--shifted {
    bottom: 344px;
  }
}
</style>
