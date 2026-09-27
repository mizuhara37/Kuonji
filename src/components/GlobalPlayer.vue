<template>
  <Teleport to="body">
    <div
      v-if="isActive"
      ref="root"
      class="gp"
      :class="{ 'gp--mini': isMini, 'gp--docked': !isMini }"
      :style="rootStyle"
    >
      <!-- Mini window chrome -->
      <div v-if="isMini" class="gp__bar">
        <v-icon size="15" color="primary">mdi-television-play</v-icon>
        <span class="gp__title text-clamp-1" :title="player.title">{{ player.title }}</span>
        <v-btn
          icon="mdi-arrow-expand"
          size="x-small"
          variant="text"
          aria-label="回到视频页"
          @click="goToVideo"
        />
        <v-btn
          icon="mdi-close"
          size="x-small"
          variant="text"
          aria-label="关闭小窗"
          @click="closePlayer"
        />
      </div>

      <BilibiliPlayer
        class="gp__player"
        :bvid="player.bvid"
        :page="player.page"
        :page-count="player.pageCount"
        :title="player.title"
        :poster="posterUrl"
        :mini="isMini"
      />
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import BilibiliPlayer from './BilibiliPlayer.vue'
import { imageUrl } from '@/api'
import {
  closePlayer,
  isActive,
  isMini,
  player,
  setPlayerHeight,
} from '@/store/player'

const router = useRouter()
const root = ref(null)
let observer = null

/** Publish the docked height so VideoView can reserve exactly that space. */
function publishHeight() {
  if (!root.value || isMini.value) return
  setPlayerHeight(root.value.offsetHeight)
}

function attach() {
  observer?.disconnect()
  observer = null
  if (!root.value) return
  observer = new ResizeObserver(publishHeight)
  observer.observe(root.value)
  publishHeight()
}

onMounted(async () => {
  await nextTick()
  attach()
})

watch(isActive, async (active) => {
  await nextTick()
  if (active) attach()
  else setPlayerHeight(0)
})

// re-measure when the bar appears/disappears (switching parts reloads the frame)
watch(
  () => [player.bvid, player.page, player.slot !== null].join('|'),
  async () => {
    await nextTick()
    publishHeight()
  },
)

onUnmounted(() => observer?.disconnect())

const posterUrl = computed(() => imageUrl(player.poster))

/**
 * Docked: absolutely positioned in document coordinates, so it stays glued to
 * the slot while scrolling without needing a scroll listener.
 * Mini: fixed in the corner (see the CSS class).
 */
const rootStyle = computed(() => {
  if (isMini.value || !player.slot) return {}
  return {
    top: `${player.slot.top}px`,
    left: `${player.slot.left}px`,
    width: `${player.slot.width}px`,
  }
})

function goToVideo() {
  if (!player.bvid) return
  router.push(`/video/${player.bvid}`)
}
</script>

<style scoped>
.gp {
  /* docked mode — sits in the page, under the app bar */
  position: absolute;
  z-index: 1;
}

.gp--mini {
  position: fixed;
  right: 24px;
  bottom: 24px;
  width: 360px;
  z-index: 1300;
  border-radius: 16px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface-container-low));
  border: 1px solid rgb(var(--v-theme-outline-variant));
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.28);
}

.gp__bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px 4px 10px;
  background: rgb(var(--v-theme-surface-container));
}

.gp__title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 500;
}

/* the player supplies its own 16:9 frame */
.gp__player {
  display: block;
}

.gp--mini .gp__player :deep(.bp__frame) {
  border-radius: 0;
  box-shadow: none;
}

@media (max-width: 600px) {
  .gp--mini {
    right: 8px;
    left: 8px;
    bottom: 84px;
    width: auto;
  }
}
</style>
