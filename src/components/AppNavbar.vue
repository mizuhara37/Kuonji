<template>
  <div>
    <v-app-bar class="app-bar" flat height="64" color="surface" scroll-behavior="elevate">
      <v-app-bar-nav-icon v-if="mobile" aria-label="打开导航" @click="drawer = !drawer" />

      <router-link to="/" class="brand" :aria-label="`${SITE_NAME} 首页`">
        <BrandMark :size="28" class="brand__mark" />
        <span class="brand__text">
          <span class="brand__owner">{{ BRAND_OWNER }}</span>
          <span class="brand__product">{{ BRAND_PRODUCT }}</span>
        </span>
      </router-link>

      <v-spacer v-if="mobile" />
      <div v-if="!mobile" class="search-bar">
        <v-text-field
          v-model="searchText"
          class="search-bar__field"
          placeholder="type here to search"
          variant="solo"
          rounded="pill"
          density="compact"
          hide-details
          single-line
          clearable
          bg-color="surface-container-high"
          prepend-inner-icon="mdi-magnify"
          @keyup.enter="submitSearch"
          @click:clear="searchText = ''"
        />
      </div>

      <v-spacer v-if="!mobile" />

      <v-btn
        v-if="mobile"
        icon="mdi-magnify"
        variant="text"
        aria-label="搜索"
        @click="router.push('/search')"
      />

      <v-btn
        :icon="isDark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
        variant="text"
        :aria-label="isDark ? '切换到浅色主题' : '切换到深色主题'"
        @click="toggleTheme()"
      />

      <v-btn
        icon="mdi-star-outline"
        variant="text"
        aria-label="我的收藏"
        to="/favorites"
      />
    </v-app-bar>

    <v-navigation-drawer v-model="drawer" temporary :width="272">
      <div class="drawer__header">
        <BrandMark :size="40" />
        <div>
          <div class="md-title-medium">{{ SITE_NAME }}</div>
          <div class="md-body-small drawer__sub">视频分享 · Material Design 3</div>
        </div>
      </div>

      <v-divider />

      <v-list density="comfortable" nav>
        <v-list-item prepend-icon="mdi-home-outline" title="首页" to="/" />
        <v-list-item prepend-icon="mdi-magnify" title="搜索" to="/search" />
        <v-list-item prepend-icon="mdi-star-outline" title="我的收藏" to="/favorites" />
      </v-list>

      <v-divider class="my-1" />

      <div v-if="categories.length" class="drawer__section md-label-large">分区</div>
      <v-list v-if="categories.length" density="compact" nav>
        <v-list-item
          v-for="category in categories"
          :key="category"
          :title="category"
          @click="goCategory(category)"
        />
      </v-list>
    </v-navigation-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'
import BrandMark from './BrandMark.vue'
import * as api from '@/api'
import { BRAND_OWNER, BRAND_PRODUCT, SITE_NAME } from '@/constants'
import { state, toggleTheme } from '@/store/app'

const router = useRouter()
const route = useRoute()
const { mobile } = useDisplay()

const drawer = ref(false)
const searchText = ref('')
const categories = ref([])

onMounted(async () => {
  try {
    categories.value = await api.fetchCategories()
  } catch (err) {
    categories.value = []
  }
})

const isDark = computed(() => state.theme === 'dark')

watch(
  () => route.query.keywords,
  (value) => {
    searchText.value = value ? String(value) : ''
  },
  { immediate: true },
)

watch(
  () => route.fullPath,
  () => {
    drawer.value = false
  },
)

function submitSearch() {
  const keywords = searchText.value.trim()
  router.push({ name: 'search', query: keywords ? { keywords } : {} })
}

function goCategory(category) {
  drawer.value = false
  router.push({ name: 'search', query: { category } })
}
</script>

<style scoped>
.app-bar {
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-right: 8px;
  flex: none;
}

.brand__mark {
  display: block;
  transition: transform 0.3s cubic-bezier(0.2, 0, 0, 1);
}

.brand:hover .brand__mark {
  transform: rotate(-6deg) scale(1.06);
}

.brand__text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}

.brand__owner {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1.4px;
  text-transform: uppercase;
  color: rgb(var(--v-theme-primary));
}

.brand__product {
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: rgb(var(--v-theme-on-surface));
}

.search-bar {
  flex: 1 1 auto;
  display: flex;
  justify-content: center;
  padding: 0 16px;
}

.search-bar__field {
  max-width: 560px;
}

.drawer__header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 20px 16px;
}

.drawer__sub {
  color: rgb(var(--v-theme-on-surface-variant));
  opacity: 0.8;
}

.drawer__section {
  padding: 10px 16px 4px;
  color: rgb(var(--v-theme-on-surface-variant));
  opacity: 0.75;
}

@media (max-width: 600px) {
  .brand__owner {
    font-size: 10px;
  }

  .brand__product {
    font-size: 15px;
  }
}
</style>
