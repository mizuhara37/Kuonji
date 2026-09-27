<template>
  <div class="page-container favorites">
    <header class="favorites__head">
      <h1 class="md-title-large favorites__title">
        <v-icon color="primary" size="26">mdi-star-outline</v-icon>
        我的收藏
        <span v-if="items.length" class="favorites__count md-body-medium">
          {{ items.length }}
        </span>
      </h1>

      <v-btn
        v-if="items.length"
        variant="text"
        color="error"
        prepend-icon="mdi-delete-sweep-outline"
        @click="confirmClear = true"
      >
        清空收藏
      </v-btn>
    </header>

    <p class="md-body-small favorites__note">
      收藏保存在当前浏览器本地，不需要账号。视频画面与信息来自哔哩哔哩。
    </p>

    <v-progress-linear v-if="loading" indeterminate color="primary" rounded class="mb-4" />

    <EmptyState
      v-else-if="!items.length"
      icon="mdi-star-outline"
      title="收藏夹为空~"
      hint="在视频页点击「加入我的收藏」，视频就会出现在这里"
    >
      <template #action>
        <v-btn to="/" color="primary" variant="flat" rounded="lg" prepend-icon="mdi-compass-outline">
          去逛逛
        </v-btn>
      </template>
    </EmptyState>

    <v-row v-else dense>
      <v-col v-for="video in items" :key="video.bvid" cols="6" sm="4" md="3" lg="2">
        <VideoCard :video="video" />
      </v-col>
    </v-row>

    <v-dialog v-model="confirmClear" max-width="400">
      <v-card rounded="xl">
        <v-card-title class="md-title-medium">清空收藏</v-card-title>
        <v-card-text class="md-body-medium">确定清空本地的全部收藏吗？</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmClear = false">取消</v-btn>
          <v-btn color="error" variant="flat" rounded="lg" @click="clearAll">清空</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import VideoCard from '@/components/VideoCard.vue'
import EmptyState from '@/components/EmptyState.vue'
import * as api from '@/api'
import { pruneFavorites, state, toast } from '@/store/app'

const items = ref([])
const loading = ref(true)
const confirmClear = ref(false)

async function load() {
  loading.value = true
  try {
    const [favorites, all] = await Promise.all([
      api.fetchVideosByIds(state.favorites),
      api.fetchVideos(),
    ])
    // drop anything the admin page removed from the library
    pruneFavorites(all.items.map((v) => v.bvid))
    items.value = favorites.items
  } catch (err) {
    items.value = []
  } finally {
    loading.value = false
  }
}

function clearAll() {
  confirmClear.value = false
  state.favorites.splice(0, state.favorites.length)
  try {
    localStorage.removeItem('m37_favorites')
  } catch (err) {
    /* ignore */
  }
  items.value = []
  toast('已清空收藏')
}

onMounted(load)
</script>

<style scoped>
.favorites {
  padding-top: 24px;
}

.favorites__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.favorites__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}

.favorites__count {
  color: rgb(var(--v-theme-on-surface-variant));
}

.favorites__note {
  margin: 8px 0 20px;
  color: rgb(var(--v-theme-on-surface-variant));
  opacity: 0.85;
}
</style>
