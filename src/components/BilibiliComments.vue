<template>
  <div class="bc">
    <div class="bc__bar">
      <div class="bc__sort">
        <v-chip
          :variant="mode === 'hot' ? 'flat' : 'tonal'"
          :color="mode === 'hot' ? 'primary' : undefined"
          size="small"
          @click="setMode('hot')"
        >
          <v-icon start size="14">mdi-fire</v-icon>热门
        </v-chip>
        <v-chip
          :variant="mode === 'time' ? 'flat' : 'tonal'"
          :color="mode === 'time' ? 'primary' : undefined"
          size="small"
          @click="setMode('time')"
        >
          <v-icon start size="14">mdi-clock-outline</v-icon>最新
        </v-chip>
      </div>

      <v-spacer />

      <span class="md-body-small bc__source">
        <v-icon size="14">mdi-television-play</v-icon>
        来自哔哩哔哩 · 只读
      </span>
      <v-btn
        size="small"
        variant="text"
        color="primary"
        prepend-icon="mdi-open-in-new"
        :href="biliUrl"
        target="_blank"
        rel="noreferrer"
      >
        去 B 站评论
      </v-btn>
    </div>

    <div v-if="loading && !items.length" class="bc__loading">
      <v-skeleton-loader v-for="n in 4" :key="n" type="list-item-avatar-three-line" class="mb-2" />
    </div>

    <EmptyState
      v-else-if="error"
      icon="mdi-alert-circle-outline"
      title="B 站评论加载失败"
      :hint="error"
    >
      <template #action>
        <v-btn color="primary" variant="tonal" rounded="lg" prepend-icon="mdi-refresh" @click="reload">
          重试
        </v-btn>
      </template>
    </EmptyState>

    <EmptyState
      v-else-if="!items.length"
      icon="mdi-comment-outline"
      title="这个视频还没有评论"
      hint="去 B 站抢个沙发吧"
    />

    <template v-else>
      <article v-for="comment in items" :key="comment.rpid" class="bc-item">
        <a
          class="bc-item__avatar"
          :href="`https://space.bilibili.com/${comment.mid}`"
          target="_blank"
          rel="noreferrer"
        >
          <v-avatar size="46">
            <img v-if="comment.avatar" :src="api.imageUrl(comment.avatar)" :alt="comment.uname" />
            <span v-else>{{ comment.uname.slice(0, 1) }}</span>
          </v-avatar>
        </a>

        <div class="bc-item__body">
          <div class="bc-item__head">
            <a
              class="bc-item__name"
              :href="`https://space.bilibili.com/${comment.mid}`"
              target="_blank"
              rel="noreferrer"
            >
              {{ comment.uname }}
            </a>
            <v-chip v-if="comment.isUp" size="x-small" color="primary" variant="flat">UP 主</v-chip>
            <span v-if="comment.location" class="bc-item__loc md-body-small">
              {{ comment.location }}
            </span>
            <span class="bc-item__time md-body-small">{{ relativeTime(comment.ctime * 1000) }}</span>
          </div>

          <p class="bc-item__text">{{ comment.message }}</p>

          <div class="bc-item__actions">
            <span class="bc-item__like" :title="`${comment.like} 赞`">
              <v-icon size="14">mdi-thumb-up-outline</v-icon>{{ formatCount(comment.like) }}
            </span>
          </div>

          <!-- 楼中楼：B 站只随主楼返回前几条 -->
          <div v-if="comment.replies.length" class="bc-subs">
            <article v-for="sub in comment.replies" :key="sub.rpid" class="bc-sub">
              <a
                :href="`https://space.bilibili.com/${sub.mid}`"
                target="_blank"
                rel="noreferrer"
                class="bc-sub__avatar"
              >
                <v-avatar size="28">
                  <img v-if="sub.avatar" :src="api.imageUrl(sub.avatar)" :alt="sub.uname" />
                  <span v-else>{{ sub.uname.slice(0, 1) }}</span>
                </v-avatar>
              </a>
              <div class="bc-sub__body">
                <div class="bc-sub__head">
                  <a
                    class="bc-sub__name"
                    :href="`https://space.bilibili.com/${sub.mid}`"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {{ sub.uname }}
                  </a>
                  <v-chip v-if="sub.isUp" size="x-small" color="primary" variant="flat">UP 主</v-chip>
                  <span class="bc-item__time md-body-small">{{ relativeTime(sub.ctime * 1000) }}</span>
                </div>
                <p class="bc-sub__text">{{ sub.message }}</p>
              </div>
            </article>

            <div v-if="comment.subCount > comment.replies.length" class="bc-subs__more md-body-small">
              共 {{ comment.subCount }} 条回复，剩余的在 B 站查看
            </div>
          </div>
        </div>
      </article>

      <div class="bc__more">
        <v-btn
          v-if="!isEnd"
          color="primary"
          variant="tonal"
          rounded="lg"
          :loading="loading"
          prepend-icon="mdi-chevron-down"
          @click="loadMore"
        >
          加载更多评论
        </v-btn>
        <span v-else class="md-body-medium bc__end">没有更多评论了~</span>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import EmptyState from './EmptyState.vue'
import * as api from '@/api'
import { formatCount, relativeTime } from '@/utils/format'

const props = defineProps({
  bvid: { type: String, required: true },
  upMid: { type: Number, default: 0 },
})

const mode = ref('hot')
const items = ref([])
const next = ref(0)
const isEnd = ref(false)
const loading = ref(false)
const error = ref('')

const biliUrl = computed(() => `https://www.bilibili.com/video/${props.bvid}#comment`)

async function load(reset) {
  loading.value = true
  error.value = ''
  try {
    const data = await api.fetchBilibiliComments({
      bvid: props.bvid,
      mode: mode.value,
      next: reset ? 0 : next.value,
    })
    items.value = reset ? data.replies : [...items.value, ...data.replies]
    next.value = data.next
    isEnd.value = data.isEnd
  } catch (err) {
    error.value = err.message
    if (reset) items.value = []
  } finally {
    loading.value = false
  }
}

function setMode(value) {
  if (value === mode.value) return
  mode.value = value
  load(true)
}

function loadMore() {
  if (!isEnd.value && !loading.value) load(false)
}

function reload() {
  load(true)
}

watch(
  () => props.bvid,
  () => {
    mode.value = 'hot'
    load(true)
  },
)

onMounted(() => load(true))
</script>

<style scoped>
.bc__bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.bc__sort {
  display: flex;
  gap: 8px;
}

.bc__source {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.bc__loading {
  padding-top: 4px;
}

.bc-item {
  display: flex;
  gap: 14px;
  padding: 16px 0;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
}

.bc-item__avatar {
  flex: none;
}

.bc-item__avatar :deep(.v-avatar),
.bc-sub__avatar :deep(.v-avatar) {
  overflow: hidden;
  background: rgb(var(--v-theme-surface-container-high));
}

.bc-item__avatar img,
.bc-sub__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.bc-item__body {
  flex: 1;
  min-width: 0;
}

.bc-item__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.bc-item__name {
  font-size: 14px;
  font-weight: 500;
  color: rgb(var(--v-theme-primary));
}

.bc-item__name:hover {
  text-decoration: underline;
}

.bc-item__loc,
.bc-item__time {
  color: rgb(var(--v-theme-on-surface-variant));
  opacity: 0.85;
}

.bc-item__text {
  margin: 6px 0 0;
  font-size: 15px;
  line-height: 24px;
  white-space: pre-wrap;
  word-break: break-word;
}

.bc-item__actions {
  margin-top: 4px;
}

.bc-item__like {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.bc-subs {
  margin-top: 10px;
  padding: 10px 14px;
  border-radius: 12px;
  background: rgb(var(--v-theme-surface-container-low));
}

.bc-sub {
  display: flex;
  gap: 10px;
  padding: 8px 0;
}

.bc-sub__body {
  min-width: 0;
  flex: 1;
}

.bc-sub__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.bc-sub__name {
  font-size: 13px;
  font-weight: 500;
  color: rgb(var(--v-theme-primary));
}

.bc-sub__text {
  margin: 4px 0 0;
  font-size: 14px;
  line-height: 22px;
  white-space: pre-wrap;
  word-break: break-word;
}

.bc-subs__more {
  padding-top: 4px;
  color: rgb(var(--v-theme-on-surface-variant));
  opacity: 0.85;
}

.bc__more {
  display: flex;
  justify-content: center;
  padding: 22px 0 4px;
}

.bc__end {
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
