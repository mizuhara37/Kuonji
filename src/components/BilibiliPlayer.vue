<template>
  <div class="bp" :class="{ 'bp--wide': wide, 'bp--loading': !loaded, 'bp--mini': mini }">
    <div class="bp__frame">
      <iframe
        ref="frame"
        class="bp__iframe"
        :src="embedUrl"
        scrolling="no"
        frameborder="0"
        allowfullscreen
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
        :title="title"
        @load="onLoad"
      />

      <!-- Cover + spinner until the embedded player reports it loaded -->
      <transition name="bp-fade">
        <div v-if="!loaded" class="bp__cover">
          <img v-if="poster" :src="poster" :alt="title" class="bp__poster" />
          <div class="bp__scrim" />
          <div class="bp__cover-body">
            <v-progress-circular indeterminate color="primary" size="46" width="4" />
            <p class="bp__cover-text">正在载入 B 站播放器…</p>
          </div>
        </div>
      </transition>

      <div v-if="wide" class="bp__exit">
        <v-btn variant="text" color="white" prepend-icon="mdi-close" @click="wide = false">
          退出宽屏（Esc）
        </v-btn>
      </div>
    </div>

    <div v-if="!mini" class="bp__bar">
      <v-icon size="16" color="primary">mdi-television-play</v-icon>
      <span class="bp__source md-body-small">画面与弹幕由哔哩哔哩提供</span>
      <span class="bp__bvid mono md-body-small">{{ bvid }}</span>
      <span v-if="pageCount > 1" class="bp__page md-body-small">P{{ page }} / {{ pageCount }}</span>
      <v-spacer />
      <v-btn
        :icon="wide ? 'mdi-arrow-collapse-horizontal' : 'mdi-arrow-expand-horizontal'"
        variant="text"
        size="small"
        :aria-label="wide ? '退出宽屏' : '宽屏观看'"
        @click="wide = !wide"
      />
      <v-btn
        size="small"
        variant="text"
        prepend-icon="mdi-open-in-new"
        :href="biliUrl"
        target="_blank"
        rel="noreferrer"
      >
        在原站观看
      </v-btn>
    </div>

    <div v-if="slow && !loaded && !mini" class="bp__warn">
      <v-icon size="16">mdi-alert-circle-outline</v-icon>
      播放器似乎没有加载出来：可能是网络无法访问 player.bilibili.com，或浏览器插件拦截了内嵌播放器。
      可以点右上角「在原站观看」。
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  bvid: { type: String, required: true },
  page: { type: Number, default: 1 },
  pageCount: { type: Number, default: 1 },
  title: { type: String, default: '' },
  poster: { type: String, default: '' },
  /** Rendered inside the floating mini window: chrome is supplied by the host. */
  mini: { type: Boolean, default: false },
})

const loaded = ref(false)
const slow = ref(false)
const wide = ref(false)
const frame = ref(null)
let slowTimer = null

const embedUrl = computed(() => {
  const params = new URLSearchParams({
    bvid: props.bvid,
    page: String(props.page || 1),
    high_quality: '1',
    danmaku: '1',
    autoplay: '0',
    as_wide: '1',
  })
  return `https://player.bilibili.com/player.html?${params.toString()}`
})

const biliUrl = computed(() =>
  props.page > 1
    ? `https://www.bilibili.com/video/${props.bvid}/?p=${props.page}`
    : `https://www.bilibili.com/video/${props.bvid}/`,
)

function startSlowTimer() {
  clearTimeout(slowTimer)
  slowTimer = setTimeout(() => {
    if (!loaded.value) slow.value = true
  }, 10000)
}

function onLoad() {
  loaded.value = true
  slow.value = false
  clearTimeout(slowTimer)
}

function onKeydown(event) {
  if (event.key === 'Escape' && wide.value) wide.value = false
}

// switching parts reloads the iframe
watch(
  () => props.page,
  () => {
    loaded.value = false
    slow.value = false
    startSlowTimer()
  },
)

onMounted(() => {
  startSlowTimer()
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  clearTimeout(slowTimer)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.bp {
  width: 100%;
}

.bp__frame {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 16px;
  overflow: hidden;
  background: #000;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.24);
}

.bp--mini .bp__frame {
  box-shadow: none;
  border-radius: 0;
  pointer-events: auto;
}

.bp__iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}

.bp__cover {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.bp__poster {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(2px);
  transform: scale(1.04);
}

.bp__scrim {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
}

.bp__cover-body {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: #fff;
  text-align: center;
  padding: 16px;
}

.bp__cover-text {
  margin: 0;
  font-size: 14px;
  opacity: 0.9;
}

.bp-fade-enter-active,
.bp-fade-leave-active {
  transition: opacity 0.3s cubic-bezier(0.2, 0, 0, 1);
}

.bp-fade-enter-from,
.bp-fade-leave-to {
  opacity: 0;
}

.bp__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 4px 0;
  color: rgb(var(--v-theme-on-surface-variant));
}

.bp__bvid {
  padding: 2px 8px;
  border-radius: 6px;
  background: rgb(var(--v-theme-surface-container-high));
}

.bp__warn {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 10px;
  padding: 10px 14px;
  border-radius: 12px;
  background: rgb(var(--v-theme-surface-container-high));
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 13px;
  line-height: 20px;
}

/* wide / theatre mode */
.bp--wide .bp__frame {
  position: fixed;
  inset: 0;
  z-index: 2200;
  border-radius: 0;
  aspect-ratio: auto;
  height: 100vh;
}

.bp__exit {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 3;
}

@media (max-width: 600px) {
  .bp__source {
    display: none;
  }
}
</style>
