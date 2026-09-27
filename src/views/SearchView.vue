<template>
  <div class="page-container search">
    <div v-if="mobile" class="search__bar">
      <v-text-field
        v-model="keywordInput"
        class="search__field"
        placeholder="输入关键词，搜索视频、UP 主或分区"
        variant="solo"
        rounded="pill"
        density="comfortable"
        hide-details
        single-line
        clearable
        bg-color="surface-container-high"
        prepend-inner-icon="mdi-magnify"
        @keyup.enter="applySearch"
      >
        <template #append-inner>
          <v-btn color="primary" variant="flat" rounded="pill" size="small" @click="applySearch">
            搜索
          </v-btn>
        </template>
      </v-text-field>
    </div>

    <div class="search__options">
      <h1 class="md-title-large search__heading">
        <v-icon color="primary" size="26">mdi-magnify</v-icon>
        视频搜索
      </h1>

      <v-spacer />

      <div class="search__sort">
        <v-chip
          :variant="sort === 'play' ? 'flat' : 'tonal'"
          :color="sort === 'play' ? 'primary' : undefined"
          size="large"
          @click="sort = 'play'"
        >
          ↑点击量
        </v-chip>
        <v-chip
          :variant="sort === 'pubdate' ? 'flat' : 'tonal'"
          :color="sort === 'pubdate' ? 'primary' : undefined"
          size="large"
          @click="sort = 'pubdate'"
        >
          ↑投稿时间
        </v-chip>
      </div>
    </div>

    <div class="search__filters">
      <v-select
        v-model="duration"
        :items="durationOptions"
        label="时长"
        density="comfortable"
        variant="outlined"
        hide-details
        class="search__filter"
      />
      <v-select
        v-model="category"
        :items="categoryOptions"
        label="分区"
        density="comfortable"
        variant="outlined"
        hide-details
        class="search__filter"
      />
      <v-btn variant="text" prepend-icon="mdi-filter-off-outline" @click="resetFilters">
        重置筛选
      </v-btn>
    </div>

    <div class="search__summary md-body-medium">
      <template v-if="loading">加载中…</template>
      <template v-else-if="keyword">
        找到 <strong>{{ results.length }}</strong> 个与 “{{ keyword }}” 相关的视频
      </template>
      <template v-else>浏览全部视频 · 共 {{ results.length }} 个</template>
    </div>

    <div class="search__results">
      <v-row v-if="loading" dense>
        <v-col v-for="n in 12" :key="n" cols="6" sm="4" md="3" lg="2">
          <v-skeleton-loader type="image, list-item-two-line" rounded="xl" />
        </v-col>
      </v-row>

      <template v-else>
        <EmptyState
          v-if="!paged.length"
          icon="mdi-magnify-close"
          :title="hasAny ? '没有数据了~' : '视频库还是空的'"
          :hint="
            hasAny
              ? '换一个关键词或者调整筛选条件试试'
              : '视频由 Node 后台按 bvid 配置：打开 /admin 投稿'
          "
        >
          <template #action>
            <v-btn v-if="hasAny" color="primary" variant="tonal" rounded="lg" @click="resetAll">
              清空筛选
            </v-btn>
          </template>
        </EmptyState>

        <v-row v-else dense>
          <v-col v-for="video in paged" :key="video.bvid" cols="6" sm="4" md="3" lg="2">
            <VideoCard :video="video" />
          </v-col>
        </v-row>
      </template>

      <div class="search__pagination">
        <v-pagination
          v-if="pageCount > 1"
          v-model="page"
          :length="pageCount"
          :total-visible="7"
          rounded="circle"
          color="primary"
          @update:model-value="scrollTop"
        />
      </div>
    </div>

    <BackTopFab :threshold="300" />
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'
import VideoCard from '@/components/VideoCard.vue'
import EmptyState from '@/components/EmptyState.vue'
import BackTopFab from '@/components/BackTopFab.vue'
import * as api from '@/api'

const route = useRoute()
const router = useRouter()
const { mobile } = useDisplay()

const PAGE_SIZE = 20

const keywordInput = ref('')
const keyword = ref('')
const sort = ref('play')
const category = ref('全部分区')
const duration = ref('全部时长')
const page = ref(1)

const allResults = ref([])
const categories = ref([])
const loading = ref(true)

const durationOptions = ['全部时长', '5分钟以下', '5-20分钟', '20分钟以上']
const categoryOptions = computed(() => ['全部分区', ...categories.value])

const hasAny = computed(() => allResults.value.length > 0)

const results = computed(() =>
  allResults.value
    .filter((v) => category.value === '全部分区' || v.categoryParent === category.value || v.category === category.value)
    .filter(inDuration),
)

const paged = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE
  return results.value.slice(start, start + PAGE_SIZE)
})

const pageCount = computed(() => Math.max(1, Math.ceil(results.value.length / PAGE_SIZE)))

function inDuration(video) {
  const d = Number(video.duration) || 0
  if (duration.value === '全部时长') return true
  if (duration.value === '5分钟以下') return d < 300
  if (duration.value === '5-20分钟') return d >= 300 && d <= 1200
  return d > 1200
}

async function fetchResults() {
  loading.value = true
  try {
    const res = await api.fetchVideos({ keywords: keyword.value, sort: sort.value })
    allResults.value = res.items
  } catch (err) {
    allResults.value = []
  } finally {
    loading.value = false
  }
}

/** Category options are a nice-to-have: never let them break the results. */
async function loadCategories() {
  try {
    categories.value = await api.fetchCategories()
  } catch (err) {
    categories.value = [...new Set(allResults.value.map((v) => v.categoryParent).filter(Boolean))]
  }
}

function applySearch() {
  const next = keywordInput.value.trim()
  keyword.value = next
  page.value = 1
  router.replace({ name: 'search', query: next ? { keywords: next } : {} })
  fetchResults()
}

function resetFilters() {
  category.value = '全部分区'
  duration.value = '全部时长'
  page.value = 1
}

function resetAll() {
  resetFilters()
  keyword.value = ''
  keywordInput.value = ''
  router.replace({ name: 'search' })
  fetchResults()
}

function scrollTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function syncFromRoute() {
  const q = route.query
  keyword.value = q.keywords ? String(q.keywords) : ''
  keywordInput.value = keyword.value
  category.value =
    q.category && categoryOptions.value.includes(String(q.category))
      ? String(q.category)
      : '全部分区'
  page.value = 1
}

watch([sort, category, duration], () => {
  page.value = 1
})

watch(
  () => route.query.keywords,
  (value) => {
    const next = value ? String(value) : ''
    if (next !== keyword.value) {
      keyword.value = next
      keywordInput.value = next
      page.value = 1
      fetchResults()
    }
  },
)

onMounted(() => {
  syncFromRoute()
  fetchResults()
  loadCategories()
})
</script>

<style scoped>
.search {
  padding-top: 20px;
}

.search__bar {
  display: flex;
  justify-content: center;
  margin-bottom: 12px;
}

.search__field {
  max-width: 720px;
}

.search__options {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding-bottom: 6px;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
}

.search__heading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}

.search__sort {
  display: flex;
  gap: 8px;
  padding-bottom: 6px;
}

.search__filters {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 0 0;
}

.search__filter {
  max-width: 180px;
}

.search__summary {
  padding: 14px 0 4px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.search__results {
  padding-top: 8px;
  min-height: 420px;
}

.search__pagination {
  display: flex;
  justify-content: center;
  padding: 28px 0 40px;
}

@media (max-width: 600px) {
  .search__options {
    justify-content: space-between;
  }

  .search__filter {
    max-width: 100%;
    width: 100%;
  }
}
</style>
