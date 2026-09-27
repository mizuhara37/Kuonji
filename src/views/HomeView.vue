<template>
  <div>
    <!-- Hero: a Material Design carousel over the most-watched videos -->
    <section v-if="featured.length" class="hero">
      <div class="page-container">
        <v-carousel
          class="hero__carousel"
          height="320"
          hide-delimiter-background
          delimiter-icon="mdi-circle"
          show-arrows="hover"
          cycle
          interval="6500"
          rounded="xl"
        >
          <v-carousel-item v-for="item in featured" :key="item.bvid" @click="open(item)">
            <div class="hero__slide">
              <img class="hero__image" :src="api.imageUrl(item.cover)" :alt="item.title" />
              <div class="hero__scrim" />
              <div class="hero__content">
                <v-chip class="hero__chip" color="primary" variant="flat" size="small">
                  {{ item.collectionName || item.categoryParent || item.category }}
                </v-chip>
                <h2 class="hero__title text-clamp-2">{{ item.title }}</h2>
                <p v-if="item.desc" class="hero__summary text-clamp-2">{{ item.desc }}</p>
                <div class="hero__meta md-body-medium">
                  <v-avatar size="22" class="hero__avatar">
                    <img v-if="item.owner.face" :src="api.imageUrl(item.owner.face)" :alt="item.owner.name" />
                  </v-avatar>
                  <span>{{ item.owner.name }}</span>
                  <span class="hero__dot">·</span>
                  <span>{{ formatCount(item.stat.view) }} 播放</span>
                  <span v-if="item.duration" class="hero__dot">·</span>
                  <span v-if="item.duration">{{ formatDuration(item.duration) }}</span>
                </div>
                <v-btn
                  class="hero__cta"
                  color="primary"
                  variant="flat"
                  size="large"
                  rounded="lg"
                  prepend-icon="mdi-play"
                  @click.stop="open(item)"
                >
                  立即播放
                </v-btn>
              </div>
            </div>
          </v-carousel-item>
        </v-carousel>
      </div>
    </section>

    <!-- Chips: curated 分类 when they exist, otherwise Bilibili partitions -->
    <section v-if="chips.length > 1" class="page-container categories">
      <v-chip-group v-model="activeChip" selected-class="text-primary" mandatory column>
        <v-chip
          v-for="chip in chips"
          :key="chip.value"
          :value="chip.value"
          variant="tonal"
          size="large"
          filter
        >
          <v-icon v-if="chip.icon" start size="16">{{ chip.icon }}</v-icon>
          {{ chip.label }}
        </v-chip>
      </v-chip-group>
    </section>

    <section class="page-container feed">
      <!-- Loading -->
      <v-row v-if="loading" dense>
        <v-col v-for="n in 12" :key="n" cols="6" sm="4" md="3" lg="2">
          <v-skeleton-loader type="image, list-item-two-line" rounded="xl" />
        </v-col>
      </v-row>

      <EmptyState
        v-else-if="failed"
        icon="mdi-server-network-off"
        title="无法读取视频库"
        :hint="failed"
      />

      <EmptyState
        v-else-if="!total"
        icon="mdi-video-plus-outline"
        title="视频库还是空的"
        hint="视频由 Node 后台按 B 站 bvid 配置：打开 /admin 粘贴一个 BV 号即可投稿。"
      />

      <!-- Curated mode: one section per 分类 -->
      <template v-else-if="isCurated && activeChip === 'all'">
        <section v-for="group in sections" :key="group.id" class="group">
          <div class="group__head">
            <h2 class="md-title-large group__title">
              <v-icon color="primary" size="24">
                {{ group.id === 'uncategorized' ? 'mdi-folder-outline' : 'mdi-folder-star-outline' }}
              </v-icon>
              {{ group.name }}
              <span class="group__count md-body-medium">{{ group.items.length }}</span>
            </h2>
            <v-btn
              variant="text"
              color="primary"
              size="small"
              append-icon="mdi-chevron-right"
              @click="activeChip = group.id"
            >
              查看全部
            </v-btn>
          </div>
          <v-row dense>
            <v-col
              v-for="video in group.items.slice(0, 6)"
              :key="video.bvid"
              cols="6"
              sm="4"
              md="3"
              lg="2"
              class="feed__cell"
            >
              <VideoCard :video="video" />
            </v-col>
          </v-row>
        </section>
      </template>

      <!-- Flat mode: 推荐 / one partition / one 分类 -->
      <template v-else>
        <div class="feed__header">
          <h1 class="md-title-large feed__title">
            <v-icon color="primary" size="26">mdi-fire</v-icon>
            {{ activeLabel }}
          </h1>
          <div class="feed__count md-body-small">共 {{ items.length }} 个视频</div>
        </div>

        <EmptyState
          v-if="!items.length"
          icon="mdi-movie-open-off-outline"
          title="没有数据了~"
          hint="这个分类下还没有视频，去 /admin 把视频归类进来吧"
        />

        <v-row v-else dense>
          <v-col
            v-for="video in items"
            :key="video.bvid"
            cols="6"
            sm="4"
            md="3"
            lg="2"
            class="feed__cell"
          >
            <VideoCard :video="video" />
          </v-col>
        </v-row>

        <div v-if="items.length" class="feed__footer">
          <v-btn
            v-if="hasMore"
            color="primary"
            variant="tonal"
            rounded="lg"
            size="large"
            prepend-icon="mdi-chevron-down"
            @click="loadMore"
          >
            加载更多
          </v-btn>
          <div v-else class="md-body-medium feed__end">没有更多数据了···</div>
        </div>

        <div v-if="hasMore" ref="sentinel" class="feed__sentinel" />
      </template>
    </section>

    <BackTopFab :threshold="240" />
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import VideoCard from '@/components/VideoCard.vue'
import EmptyState from '@/components/EmptyState.vue'
import BackTopFab from '@/components/BackTopFab.vue'
import * as api from '@/api'
import { formatCount, formatDuration } from '@/utils/format'

const route = useRoute()
const router = useRouter()

const PAGE_SIZE = 20

const all = ref([])
const collections = ref([])
const partitions = ref([])
const featured = ref([])
const visible = ref(PAGE_SIZE)
const loading = ref(true)
const failed = ref('')
const activeChip = ref('all')
const sentinel = ref(null)
let observer = null

const isCurated = computed(() => collections.value.length > 0)
const total = computed(() => all.value.length)

const byCollection = (id) =>
  id === 'uncategorized'
    ? all.value.filter((v) => !v.collectionId)
    : all.value.filter((v) => v.collectionId === id)

/** Curated mode: every video appears exactly once, in a 分类 or under 未分类. */
const sections = computed(() => {
  const groups = collections.value
    .map((c) => ({ id: c.id, name: c.name, items: byCollection(c.id) }))
    .filter((g) => g.items.length > 0)
  const uncategorized = all.value.filter((v) => !v.collectionId)
  if (uncategorized.length) {
    groups.push({ id: 'uncategorized', name: '未分类', items: uncategorized })
  }
  return groups
})

const chips = computed(() => {
  if (!isCurated.value) {
    return [
      { value: 'all', label: '全部' },
      ...partitions.value.map((c) => ({ value: c, label: c })),
    ]
  }
  const list = [
    { value: 'all', label: '全部', icon: 'mdi-view-grid-outline' },
    ...collections.value.map((c) => ({ value: c.id, label: c.name, icon: 'mdi-folder-star-outline' })),
  ]
  if (all.value.some((v) => !v.collectionId)) {
    list.push({ value: 'uncategorized', label: '未分类', icon: 'mdi-folder-outline' })
  }
  return list
})

const activeLabel = computed(() =>
  chips.value.find((c) => c.value === activeChip.value)?.label ?? '推荐',
)

/** Flat list shown when a specific chip is active (or in partition mode). */
const items = computed(() => {
  let list = all.value
  if (isCurated.value) {
    if (activeChip.value !== 'all') list = byCollection(activeChip.value)
  } else if (activeChip.value !== 'all') {
    list = list.filter(
      (v) => v.categoryParent === activeChip.value || v.category === activeChip.value,
    )
  }
  return list.slice(0, visible.value)
})

const hasMore = computed(() => items.value.length < filteredLength.value)

const filteredLength = computed(() => {
  if (isCurated.value) {
    return activeChip.value === 'all' ? all.value.length : byCollection(activeChip.value).length
  }
  if (activeChip.value === 'all') return all.value.length
  return all.value.filter(
    (v) => v.categoryParent === activeChip.value || v.category === activeChip.value,
  ).length
})

async function load() {
  loading.value = true
  failed.value = ''
  try {
    const res = await api.fetchVideos()
    all.value = res.items
    partitions.value = res.categories || []
    collections.value = res.collections || []
  } catch (err) {
    failed.value = err.message
    all.value = []
    collections.value = []
  } finally {
    loading.value = false
  }
}

async function loadFeatured() {
  try {
    const res = await api.fetchVideos({ sort: 'play' })
    featured.value = res.items.slice(0, 5)
  } catch (err) {
    featured.value = []
  }
}

function loadMore() {
  visible.value += PAGE_SIZE
}

function open(video) {
  router.push(`/video/${video.bvid}`)
}

watch(activeChip, () => {
  visible.value = PAGE_SIZE
})

onMounted(() => {
  // a 分类 chip on the video page links here with ?collection=<id>
  const requested = route.query.collection
  if (requested) activeChip.value = String(requested)

  load()
  loadFeatured()

  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore()
    },
    { rootMargin: '240px' },
  )
  if (sentinel.value) observer.observe(sentinel.value)
})

onUnmounted(() => observer?.disconnect())
</script>

<style scoped>
.hero {
  padding-top: 20px;
}

.hero__carousel {
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.16);
  /* Vuetify's `rounded` only rounds the carousel box — the slides (and the
     cover images inside them) keep square corners unless they are clipped
     here, so the hero looked like a full-bleed rectangle. */
  border-radius: 24px;
  overflow: hidden;
  isolation: isolate;
}

.hero__carousel :deep(.v-window),
.hero__carousel :deep(.v-carousel__item),
.hero__carousel :deep(.v-window__container) {
  border-radius: inherit;
  overflow: hidden;
}

.hero__slide {
  position: relative;
  height: 100%;
  overflow: hidden;
  cursor: pointer;
}

.hero__image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.hero__scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    rgba(0, 0, 0, 0.78) 0%,
    rgba(0, 0, 0, 0.55) 42%,
    rgba(0, 0, 0, 0.08) 100%
  );
}

.hero__content {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  padding: 0 clamp(20px, 5vw, 64px);
  max-width: 720px;
  color: #fff;
}

.hero__chip {
  align-self: flex-start;
}

.hero__title {
  margin: 0;
  font-size: clamp(20px, 2.4vw, 32px);
  font-weight: 600;
  line-height: 1.3;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.4);
}

.hero__summary {
  margin: 0;
  font-size: 14px;
  line-height: 20px;
  opacity: 0.86;
  max-width: 560px;
}

.hero__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  opacity: 0.92;
}

.hero__avatar {
  overflow: hidden;
}

.hero__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.hero__dot {
  opacity: 0.6;
}

.hero__cta {
  align-self: flex-start;
  margin-top: 6px;
}

.categories {
  padding-top: 24px;
}

.feed {
  padding-top: 8px;
}

.group {
  margin-bottom: 28px;
}

.group__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.group__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}

.group__count {
  color: rgb(var(--v-theme-on-surface-variant));
}

.feed__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.feed__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}

.feed__count {
  color: rgb(var(--v-theme-on-surface-variant));
}

.feed__cell {
  margin-bottom: 8px;
}

.feed__footer {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 28px 0 40px;
  min-height: 72px;
}

.feed__end {
  color: rgb(var(--v-theme-on-surface-variant));
}

.feed__sentinel {
  height: 1px;
}

@media (max-width: 600px) {
  .hero__carousel {
    height: 240px !important;
  }

  .hero__summary,
  .hero__cta {
    display: none;
  }
}
</style>
