<template>
  <section class="comments-section">
    <div class="comments-section__head">
      <h2 class="md-title-large comments-section__title">
        评论
        <span v-if="replyCount" class="comments-section__count md-body-medium">
          {{ formatCount(replyCount) }}
        </span>
      </h2>

      <v-tabs v-model="tab" color="primary" density="comfortable" align-tabs="end">
        <v-tab value="bili" prepend-icon="mdi-television-play">B 站评论</v-tab>
        <v-tab value="local" prepend-icon="mdi-comment-outline">本站评论</v-tab>
      </v-tabs>
    </div>

    <v-window v-model="tab">
      <v-window-item value="bili">
        <BilibiliComments :bvid="bvid" :up-mid="upMid" />
      </v-window-item>
      <v-window-item value="local">
        <LocalComments :bvid="bvid" />
      </v-window-item>
    </v-window>
  </section>
</template>

<script setup>
import { ref } from 'vue'
import BilibiliComments from './BilibiliComments.vue'
import LocalComments from './LocalComments.vue'
import { formatCount } from '@/utils/format'

defineProps({
  bvid: { type: String, required: true },
  upMid: { type: Number, default: 0 },
  /** Bilibili's own reply count, shown next to the section title. */
  replyCount: { type: Number, default: 0 },
})

const tab = ref('bili')
</script>

<style scoped>
.comments-section {
  padding: 20px 0 40px;
}

.comments-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
}

.comments-section__title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
}

.comments-section__count {
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
