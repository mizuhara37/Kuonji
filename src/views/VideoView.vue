<template>
  <!-- Loading -->
  <div v-if="loading" class="page-container video-view__loading">
    <v-skeleton-loader type="image" rounded="xl" height="420" />
    <v-skeleton-loader class="mt-4" type="article, actions" rounded="xl" />
  </div>

  <!-- Not found -->
  <div v-else-if="!video" class="page-container">
    <EmptyState
      icon="mdi-video-off-outline"
      title="视频不在库中"
      :hint="
        libraryTotal
          ? '它可能已经被后台删除了，或者 bvid 有误'
          : '视频库还是空的：打开 /admin，粘贴一个 B 站 bvid 即可投稿'
      "
    >
      <template #action>
        <v-btn to="/" color="primary" variant="tonal" rounded="lg">返回首页</v-btn>
      </template>
    </EmptyState>
  </div>

  <!-- Content -->
  <div v-else class="page-container video-view">
    <div class="video-view__head">
      <!-- Header: title, meta, uploader -->
      <section class="video-header">
        <div class="video-header__info">
          <h1 class="video-header__title">{{ video.title }}</h1>

          <div class="video-header__meta md-body-medium">
            <v-chip v-if="pendingMeta" size="small" variant="flat" color="warning">
              <v-icon start size="14">mdi-progress-clock</v-icon>
              元数据待补齐
            </v-chip>
            <v-chip v-if="video.collectionName" size="small" variant="flat" color="primary" @click="goCollection">
              <v-icon start size="14">mdi-folder-star-outline</v-icon>
              {{ video.collectionName }}
            </v-chip>
            <v-chip v-if="!pendingMeta" size="small" variant="tonal" color="primary" @click="goCategory">
              {{ video.categoryParent || video.category }}
            </v-chip>
            <span v-if="pubdateText" class="video-header__stat">
              <v-icon size="17">mdi-clock-outline</v-icon>{{ pubdateText }}
            </span>
            <span v-if="!pendingMeta" class="video-header__stat">
              <v-icon size="17">mdi-play-circle-outline</v-icon>{{ formatCount(video.stat.view) }} 播放
            </span>
            <span v-if="!pendingMeta" class="video-header__stat">
              <v-icon size="17">mdi-message-text-outline</v-icon>{{ formatCount(video.stat.danmaku) }} 弹幕
            </span>
            <span class="video-header__stat">
              <v-icon size="17">mdi-open-in-new</v-icon>
              <a :href="biliUrl" target="_blank" rel="noreferrer" class="video-header__bili">
                {{ video.bvid }}
              </a>
            </span>
          </div>

          <div v-if="video.tags?.length" class="video-header__tags">
            <v-chip
              v-for="tag in video.tags"
              :key="tag"
              size="small"
              variant="outlined"
              @click="goTag(tag)"
            >
              # {{ tag }}
            </v-chip>
          </div>
        </div>

        <!-- UP 主卡片（信息来自 B 站；元数据补齐前不显示） -->
        <div v-if="video.owner.mid" class="video-header__up">
          <a
            class="video-header__up-link"
            :href="`https://space.bilibili.com/${video.owner.mid}`"
            target="_blank"
            rel="noreferrer"
          >
            <v-avatar size="56" class="video-header__up-avatar">
              <img v-if="video.owner.face" :src="api.imageUrl(video.owner.face)" :alt="video.owner.name" />
              <span v-else>{{ String(video.owner.name).slice(0, 1) }}</span>
            </v-avatar>
            <div class="video-header__up-info">
              <div class="video-header__up-name text-clamp-1" :title="video.owner.name">
                {{ video.owner.name }}
              </div>
              <div class="md-body-small video-header__up-meta">
                B 站 UP 主 · UID {{ video.owner.mid }}
              </div>
              <div class="md-body-small video-header__up-meta">
                本站收录 {{ upVideoCount }} 个视频
              </div>
            </div>
          </a>

          <v-btn
            block
            color="primary"
            variant="tonal"
            rounded="lg"
            prepend-icon="mdi-account-box-outline"
            :href="`https://space.bilibili.com/${video.owner.mid}`"
            target="_blank"
            rel="noreferrer"
          >
            访问 B 站空间
          </v-btn>
        </div>
      </section>

      <!-- The player itself is mounted once in App.vue and docked onto this
           slot, so navigating away keeps it playing in a mini window. The slot
           reserves the player's real height (frame + info bar). -->
      <div
        ref="slotRef"
        class="video-view__player-slot"
        :style="{ height: slotHeight }"
      />

      <!-- Pending metadata: the 投稿 was accepted but B 站 refused the metadata
           fetch (风控 / 412), so we retry quietly on every visit -->
      <v-alert
        v-if="pendingMeta"
        class="video-view__pending"
        type="info"
        variant="tonal"
        rounded="lg"
      >
        <div class="video-view__pending-title">
          这个视频只保存了 BV 号，封面与简介还在等待 B 站放行
        </div>
        <div class="md-body-small video-view__pending-text">
          {{ hydrateNote }}
        </div>
        <template #append>
          <v-btn
            variant="tonal"
            color="primary"
            size="small"
            rounded="lg"
            prepend-icon="mdi-refresh"
            :loading="hydrating"
            @click="runHydrate(true)"
          >
            立刻补齐
          </v-btn>
        </template>
      </v-alert>

      <!-- Real Bilibili counters -->
      <section v-if="!pendingMeta" class="video-stats">
        <div class="video-stat">
          <v-icon size="20" color="primary">mdi-thumb-up-outline</v-icon>
          <span class="video-stat__value">{{ formatCount(video.stat.like) }}</span>
          <span class="video-stat__label md-body-small">点赞</span>
        </div>
        <div class="video-stat">
          <v-icon size="20" color="primary">mdi-currency-cny</v-icon>
          <span class="video-stat__value">{{ formatCount(video.stat.coin) }}</span>
          <span class="video-stat__label md-body-small">投币</span>
        </div>
        <div class="video-stat">
          <v-icon size="20" color="primary">mdi-star-outline</v-icon>
          <span class="video-stat__value">{{ formatCount(video.stat.favorite) }}</span>
          <span class="video-stat__label md-body-small">收藏</span>
        </div>
        <div class="video-stat">
          <v-icon size="20" color="primary">mdi-share-variant-outline</v-icon>
          <span class="video-stat__value">{{ formatCount(video.stat.share) }}</span>
          <span class="video-stat__label md-body-small">分享</span>
        </div>
        <div class="video-stat">
          <v-icon size="20" color="primary">mdi-comment-text-outline</v-icon>
          <span class="video-stat__value">{{ formatCount(video.stat.reply) }}</span>
          <span class="video-stat__label md-body-small">B 站评论</span>
        </div>
        <v-spacer />
        <span class="md-body-small video-stats__note">数据来自哔哩哔哩</span>
      </section>

      <!-- Actions -->
      <section class="video-actions">
        <v-btn
          class="video-actions__pill"
          :color="favorited ? 'primary' : undefined"
          :variant="favorited ? 'flat' : 'tonal'"
          rounded="lg"
          size="large"
          :prepend-icon="favorited ? 'mdi-star' : 'mdi-star-outline'"
          @click="handleFavorite"
        >
          {{ favorited ? '已在我的收藏' : '加入我的收藏' }}
        </v-btn>

        <v-menu location="bottom start">
          <template #activator="{ props: activatorProps }">
            <v-btn
              v-bind="activatorProps"
              class="video-actions__pill"
              variant="tonal"
              rounded="lg"
              size="large"
              prepend-icon="mdi-share-variant-outline"
            >
              分享
            </v-btn>
          </template>
          <v-list density="comfortable" min-width="220">
            <v-list-item prepend-icon="mdi-link-variant" title="复制本站链接" @click="copyLink" />
            <v-list-item
              prepend-icon="mdi-content-copy"
              title="复制标题与链接"
              @click="copyTitleLink"
            />
            <v-divider class="my-1" />
            <v-list-item
              prepend-icon="mdi-open-in-new"
              title="在 B 站打开原视频"
              :href="biliUrl"
              target="_blank"
              rel="noreferrer"
            />
          </v-list>
        </v-menu>

        <v-btn
          class="video-actions__pill"
          variant="tonal"
          rounded="lg"
          size="large"
          prepend-icon="mdi-open-in-new"
          :href="biliUrl"
          target="_blank"
          rel="noreferrer"
        >
          去 B 站点赞
        </v-btn>

        <v-spacer />

        <v-btn v-if="favorited" variant="text" rounded="lg" size="large" to="/favorites" prepend-icon="mdi-playlist-check">
          去收藏夹
        </v-btn>
      </section>

      <!-- Description (from Bilibili) -->
      <v-card class="video-summary" variant="flat" rounded="xl">
        <div class="video-summary__label md-title-medium">
          简介
          <span class="video-summary__source md-body-small">来源：哔哩哔哩</span>
        </div>
        <p
          v-if="video.desc"
          class="video-summary__text"
          :class="{ 'video-summary__text--clamped': !descExpanded }"
        >
          {{ video.desc }}
        </p>
        <p v-else class="video-summary__text video-summary__text--empty">
          {{
            pendingMeta
              ? '简介还没有取到：B 站暂时拒绝了服务器请求，稍后会自动重试。'
              : 'UP 主在 B 站没有填写简介。'
          }}
        </p>
        <v-btn
          v-if="descLong"
          class="video-summary__toggle"
          variant="text"
          color="primary"
          size="small"
          :append-icon="descExpanded ? 'mdi-chevron-up' : 'mdi-chevron-down'"
          @click="descExpanded = !descExpanded"
        >
          {{ descExpanded ? '收起' : '展开' }}
        </v-btn>
      </v-card>
    </div>

    <!-- Comments: B 站评论（只读）与本站评论两个标签页 -->
    <div class="video-view__comments">
      <CommentSection
        :bvid="video.bvid"
        :up-mid="video.owner.mid"
        :reply-count="video.stat.reply"
      />
    </div>

    <!-- Sidebar -->
    <aside class="video-view__side">
      <v-card v-if="video.pages.length > 1" class="side-card" variant="flat" rounded="xl">
        <div class="side-card__head md-title-medium">
          <v-icon size="18" color="primary">mdi-playlist-play</v-icon>
          视频选集
          <v-spacer />
          <span class="md-body-small side-card__count">
            {{ currentPage }} / {{ video.pages.length }}
          </span>
        </div>

        <v-list class="parts-list" density="comfortable" nav>
          <v-list-item
            v-for="part in video.pages"
            :key="part.cid"
            :active="part.page === currentPage"
            color="primary"
            rounded="lg"
            @click="switchPage(part.page)"
          >
            <template #prepend>
              <span class="parts-list__index mono">{{ String(part.page).padStart(2, '0') }}</span>
            </template>
            <v-list-item-title class="text-clamp-1">{{ part.part }}</v-list-item-title>
            <v-list-item-subtitle v-if="part.duration">
              {{ formatDuration(part.duration) }}
            </v-list-item-subtitle>
          </v-list-item>
        </v-list>
      </v-card>

      <v-card class="side-card" variant="flat" rounded="xl">
        <div class="side-card__head md-title-medium">
          <v-icon size="18" color="primary">mdi-lightbulb-on-outline</v-icon>
          相关推荐
        </div>

        <EmptyState
          v-if="!recommendations.length"
          icon="mdi-video-outline"
          title="暂无推荐"
          hint="视频库里还没有其他视频"
        />

        <div v-else class="recommend-list">
          <router-link
            v-for="item in recommendations"
            :key="item.bvid"
            :to="`/video/${item.bvid}`"
            class="recommend-item"
          >
            <div class="recommend-item__cover">
              <img v-if="item.cover" :src="api.imageUrl(item.cover)" :alt="item.title" loading="lazy" />
              <v-icon v-else class="recommend-item__placeholder" size="22">mdi-video-outline</v-icon>
              <span v-if="item.duration" class="recommend-item__badge">
                {{ formatDuration(item.duration) }}
              </span>
            </div>
            <div class="recommend-item__info">
              <div class="recommend-item__title text-clamp-2">{{ item.title }}</div>
              <div class="recommend-item__meta md-body-small">
                <span class="text-clamp-1">{{ item.owner.name }}</span>
                <span>{{ formatCount(item.stat.view) }} 播放</span>
              </div>
            </div>
          </router-link>
        </div>
      </v-card>
    </aside>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CommentSection from '@/components/CommentSection.vue'
import EmptyState from '@/components/EmptyState.vue'
import * as api from '@/api'
import { SITE_NAME } from '@/constants'
import { formatCount, formatDuration, formatDateTime } from '@/utils/format'
import { isFavorite, toast, toggleFavorite } from '@/store/app'
import { clearSlot, isMini, openVideo, player, setPage, setSlot } from '@/store/player'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const video = ref(null)
const library = ref([])
const libraryTotal = ref(0)
const currentPage = ref(1)
const favorited = ref(false)
const descExpanded = ref(false)
const slotRef = ref(null)
let slotObserver = null
let bodyObserver = null
let rafId = null
const settleTimers = []

/* ------------------------------------------------------------------ *
 * Dock the global player onto this page's slot. Absolute positioning in
 * document coordinates means scrolling needs no listener — only layout
 * changes (window resize, content shifting) have to be re-measured.
 * ------------------------------------------------------------------ */
function syncSlot() {
  const el = slotRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (!rect.width) return
  // The floating player is absolutely positioned inside <body>, so coordinates
  // must be relative to the body's own box (not the viewport) to stay aligned
  // regardless of body margins/padding.
  const origin = document.body.getBoundingClientRect()
  setSlot({
    top: rect.top - origin.top,
    left: rect.left - origin.left,
    width: rect.width,
  })
}

function scheduleSlotSync() {
  if (rafId !== null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    syncSlot()
  })
}

function observeSlot() {
  if (!slotObserver) slotObserver = new ResizeObserver(scheduleSlotSync)
  slotObserver.disconnect()
  if (!slotRef.value) return
  slotObserver.observe(slotRef.value)
  // The slot can also move when the header above it re-wraps (icon font / tag
  // chips landing) without changing the body height, so watch the parent too.
  if (slotRef.value.parentElement) slotObserver.observe(slotRef.value.parentElement)
  syncSlot()
  settleSlot()
}

/**
 * A short burst of re-measurements while the page settles (fonts, remote
 * covers, tag wrapping). Cheap, and it guarantees the floating player ends up
 * exactly on the slot even if no resize event fires.
 */
function settleSlot() {
  ;[120, 400, 900, 1800, 3000].forEach((ms) => {
    const id = setTimeout(scheduleSlotSync, ms)
    settleTimers.push(id)
  })
}

function clearSettleTimers() {
  settleTimers.forEach((id) => clearTimeout(id))
  settleTimers.length = 0
}

const pubdateText = computed(() =>
  video.value?.pubdate ? formatDateTime(video.value.pubdate * 1000).slice(0, 10) : '',
)

const biliUrl = computed(() => {
  if (!video.value) return ''
  return currentPage.value > 1
    ? `https://www.bilibili.com/video/${video.value.bvid}/?p=${currentPage.value}`
    : `https://www.bilibili.com/video/${video.value.bvid}/`
})

const descLong = computed(() => String(video.value?.desc || '').length > 140)

/** A deferred 投稿: the record only holds the bvid, metadata is still missing. */
const pendingMeta = computed(() => video.value?.metadataState === 'pending')

const hydrating = ref(false)
const hydrateNote = ref('')

/**
 * Ask the server to retry the metadata fetch.
 *
 * B 站 bans datacentre IPs intermittently (412 request was banned), so a 投稿 is
 * stored with just the bvid and every visit retries once — the server throttles
 * it to one attempt per 20 seconds, so this is safe to call on load.
 */
async function runHydrate(manual = false) {
  const current = video.value
  if (!current || hydrating.value) return
  if (current.metadataState !== 'pending') return
  hydrating.value = true
  hydrateNote.value = manual ? '正在向 B 站请求封面与简介…' : '正在自动补齐封面与简介…'
  try {
    const res = await api.hydrateVideo(current.bvid)
    if (res?.hydrated && res.item) {
      video.value = res.item
      library.value = library.value.map((v) => (v.bvid === res.item.bvid ? res.item : v))
      hydrateNote.value = ''
      document.title = `${res.item.title} · ${SITE_NAME}`
      openVideo({
        bvid: res.item.bvid,
        page: currentPage.value,
        pageCount: res.item.pages.length,
        title: res.item.title,
        poster: res.item.cover,
      })
      // the header just grew (UP 主卡片 / 数据条), so re-dock the player
      await nextTick()
      observeSlot()
      toast('封面与简介已补齐')
    } else if (res?.throttled) {
      hydrateNote.value = '刚刚已经尝试过，稍后再刷新页面就会自动重试。'
    } else {
      hydrateNote.value = `${manual ? '还是失败' : '本次自动补齐没有成功'}：${
        res?.error || 'B 站暂时没有放行'
      }`
    }
  } catch (err) {
    hydrateNote.value = `补齐失败：${err.message}`
  } finally {
    hydrating.value = false
  }
}

/**
 * Reserve the floating player's real height so its info bar never spills onto
 * the stats strip. Falls back to the CSS aspect-ratio estimate until the player
 * has reported its height.
 */
const slotHeight = computed(() => {
  if (!video.value || player.bvid !== video.value.bvid) return undefined
  if (!player.height || isMini.value) return undefined
  return `${player.height}px`
})

const upVideoCount = computed(() =>
  video.value ? library.value.filter((v) => v.owner.mid === video.value.owner.mid).length : 0,
)

/** Related videos from the local library: same partition, shared tags, same UP. */
const recommendations = computed(() => {
  if (!video.value) return []
  const current = video.value
  return library.value
    .filter((v) => v.bvid !== current.bvid)
    .map((v) => {
      let score = 0
      if (v.categoryParent === current.categoryParent) score += 4
      if (v.category === current.category) score += 2
      if (v.owner.mid === current.owner.mid) score += 3
      score += v.tags.filter((t) => (current.tags || []).includes(t)).length * 2
      score += Math.min((v.stat?.view || 0) / 500000, 3)
      return { v, score }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((s) => s.v)
})

async function load(bvid) {
  loading.value = true
  currentPage.value = 1
  hydrateNote.value = ''
  descExpanded.value = false

  try {
    const [item, all] = await Promise.all([api.fetchVideo(bvid), api.fetchVideos()])
    video.value = item
    library.value = all.items
    libraryTotal.value = all.total
  } catch (err) {
    video.value = null
    library.value = []
    libraryTotal.value = 0
  } finally {
    loading.value = false
  }

  if (video.value) {
    document.title = `${video.value.title} · ${SITE_NAME}`
    favorited.value = isFavorite(video.value.bvid)
    currentPage.value = 1
    openVideo({
      bvid: video.value.bvid,
      page: 1,
      pageCount: video.value.pages.length,
      title: video.value.title,
      poster: video.value.cover,
    })
    // dock the global player onto this page's slot
    await nextTick()
    observeSlot()
    // a deferred 投稿 (stored without metadata) retries quietly on this visit
    if (video.value.metadataState === 'pending') runHydrate(false)
  } else {
    document.title = SITE_NAME
    clearSlot()
  }
}

function switchPage(page) {
  if (page === currentPage.value) return
  currentPage.value = page
  setPage(page)
}

function handleFavorite() {
  favorited.value = toggleFavorite(video.value.bvid)
  toast(favorited.value ? '已加入我的收藏' : '已取消收藏')
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text)
    toast(message)
  } catch (err) {
    toast('复制失败，请手动复制链接', 'warning')
  }
}

function copyLink() {
  copyText(window.location.href, '链接已复制')
}

function copyTitleLink() {
  copyText(`${video.value.title} ${window.location.href}`, '标题与链接已复制')
}

function goCategory() {
  router.push({ name: 'search', query: { category: video.value.categoryParent || video.value.category } })
}

/** Jump to the home page with this curated 分类 selected. */
function goCollection() {
  router.push({ path: '/', query: { collection: video.value.collectionId } })
}

function goTag(tag) {
  router.push({ name: 'search', query: { keywords: tag } })
}

watch(
  () => route.params.bvid,
  (bvid) => {
    if (bvid) load(bvid)
  },
)

onMounted(() => {
  load(route.params.bvid)
  window.addEventListener('resize', scheduleSlotSync)
  // catches layout shifts above the slot (late images, font swaps, …)
  bodyObserver = new ResizeObserver(scheduleSlotSync)
  bodyObserver.observe(document.body)
})

onUnmounted(() => {
  window.removeEventListener('resize', scheduleSlotSync)
  slotObserver?.disconnect()
  bodyObserver?.disconnect()
  clearSettleTimers()
  if (rafId !== null) cancelAnimationFrame(rafId)
  // keep playing: dropping the slot moves the player into the mini window
  clearSlot()
  document.title = SITE_NAME
})
</script>

<style scoped>
.video-view__loading {
  padding-top: 20px;
}

.video-view {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  grid-template-areas:
    'head side'
    'comments side';
  gap: 24px;
  padding-top: 20px;
  align-items: start;
}

.video-view__head {
  grid-area: head;
  min-width: 0;
}

.video-view__comments {
  grid-area: comments;
  min-width: 0;
}

.video-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 16px;
}

.video-header__info {
  flex: 1;
  min-width: 0;
}

.video-header__title {
  margin: 0 0 10px;
  font-size: 24px;
  line-height: 32px;
  font-weight: 600;
}

.video-header__meta {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  color: rgb(var(--v-theme-on-surface-variant));
}

.video-header__stat {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.video-header__tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.video-header__up {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 16px;
  background: rgb(var(--v-theme-surface-container-low));
  border: 1px solid rgb(var(--v-theme-outline-variant));
  flex: none;
  width: 250px;
}

.video-header__up-link {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.video-header__up-avatar {
  flex: none;
  overflow: hidden;
  background: rgb(var(--v-theme-surface-container-high));
}

.video-header__up-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.video-header__up-info {
  min-width: 0;
}

.video-header__up-name {
  font-size: 17px;
  font-weight: 600;
  transition: color 0.2s cubic-bezier(0.2, 0, 0, 1);
}

.video-header__up-link:hover .video-header__up-name {
  color: rgb(var(--v-theme-primary));
}

.video-header__up-meta {
  color: rgb(var(--v-theme-on-surface-variant));
}

.video-view__player-slot {  width: 100%;
  aspect-ratio: 16 / 9;
  margin-bottom: 12px;
  border-radius: 16px;
  background: rgb(var(--v-theme-surface-container-high));
}

.video-header__bili {
  color: rgb(var(--v-theme-primary));
  font-variant-numeric: tabular-nums;
}

.video-header__bili:hover {
  text-decoration: underline;
}

/* deferred 投稿 notice */
.video-view__pending {
  margin-bottom: 16px;
}

.video-view__pending-title {
  font-size: 15px;
  font-weight: 600;
}

.video-view__pending-text {
  margin-top: 2px;
  opacity: 0.9;
}

.video-stats {
  display: flex;
  align-items: center;
  gap: 22px;
  flex-wrap: wrap;
  padding: 12px 16px;
  margin-bottom: 16px;
  border-radius: 16px;
  background: rgb(var(--v-theme-surface-container-low));
  border: 1px solid rgb(var(--v-theme-outline-variant));
}

.video-stat {
  display: flex;
  align-items: center;
  gap: 6px;
}

.video-stat__value {
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.video-stat__label {
  color: rgb(var(--v-theme-on-surface-variant));
}

.video-stats__note {
  color: rgb(var(--v-theme-on-surface-variant));
  opacity: 0.8;
}

.video-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding-bottom: 18px;
}

.video-summary {
  padding: 16px;
  background: rgb(var(--v-theme-surface-container-low));
  border: 1px solid rgb(var(--v-theme-outline-variant));
}

.video-summary__label {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.video-summary__source {
  opacity: 0.8;
}

.video-summary__text {
  margin: 0;
  font-size: 15px;
  line-height: 24px;
  white-space: pre-wrap;
  word-break: break-word;
}

.video-summary__text--empty {
  color: rgb(var(--v-theme-on-surface-variant));
  opacity: 0.8;
}

.video-summary__text--clamped {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.video-summary__toggle {
  margin-top: 4px;
  margin-left: -8px;
}

/* sidebar */
.video-view__side {
  grid-area: side;
  display: flex;
  flex-direction: column;
  gap: 16px;
  position: sticky;
  top: 80px;
}

.side-card {
  padding: 14px;
  background: rgb(var(--v-theme-surface-container-low));
  border: 1px solid rgb(var(--v-theme-outline-variant));
}

.side-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
  margin-bottom: 8px;
}

.side-card__count {
  color: rgb(var(--v-theme-on-surface-variant));
}

.parts-list {
  max-height: 280px;
  overflow-y: auto;
  padding: 0;
}

.parts-list__index {
  width: 26px;
  margin-right: 10px;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.recommend-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.recommend-item {
  display: flex;
  gap: 10px;
  padding: 6px;
  border-radius: 12px;
  transition: background-color 0.2s cubic-bezier(0.2, 0, 0, 1);
}

.recommend-item:hover {
  background: rgb(var(--v-theme-surface-container-high));
}

.recommend-item__cover {
  position: relative;
  flex: none;
  width: 132px;
  aspect-ratio: 16 / 9;
  border-radius: 10px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface-container-high));
}

.recommend-item__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.recommend-item__placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgb(var(--v-theme-on-surface-variant));
  opacity: 0.7;
}

.recommend-item__badge {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 1px 5px;
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.recommend-item__info {
  min-width: 0;
  flex: 1;
}

.recommend-item__title {
  font-size: 13px;
  line-height: 18px;
  font-weight: 500;
}

.recommend-item:hover .recommend-item__title {
  color: rgb(var(--v-theme-primary));
}

.recommend-item__meta {
  margin-top: 4px;
  color: rgb(var(--v-theme-on-surface-variant));
  display: flex;
  flex-direction: column;
}

@media (max-width: 1180px) {
  .video-view {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'head'
      'side'
      'comments';
  }

  .video-view__side {
    position: static;
  }
}

@media (max-width: 700px) {
  .video-header {
    flex-direction: column;
  }

  .video-header__up {
    width: 100%;
  }

  .video-header__title {
    font-size: 19px;
    line-height: 26px;
  }

  .video-actions {
    gap: 8px;
  }

  .video-actions__pill {
    flex: 1 1 auto;
  }

  .video-stats {
    gap: 14px;
  }
}
</style>
