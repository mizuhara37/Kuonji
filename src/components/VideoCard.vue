<template>
  <article class="video-card" :class="{ 'video-card--compact': compact }">
    <router-link :to="`/video/${video.bvid}`" class="video-card__link" :aria-label="video.title">
      <div class="video-card__cover" :class="{ 'video-card__cover--pending': pending }">
        <img v-if="cover" :src="cover" :alt="video.title" loading="lazy" decoding="async" />
        <div v-else class="video-card__pending">
          <v-icon size="30">mdi-progress-clock</v-icon>
          <span class="md-body-small">封面待补齐</span>
        </div>
        <div class="video-card__overlay">
          <v-icon size="46" color="#fff">mdi-play-circle</v-icon>
        </div>
        <span v-if="duration" class="video-card__badge">{{ duration }}</span>
        <span v-if="!pending" class="video-card__category">
          {{ video.categoryParent || video.category }}
        </span>
      </div>

      <h3 class="video-card__title text-clamp-2" :title="video.title">{{ video.title }}</h3>
    </router-link>

    <div class="video-card__meta">
      <div v-if="video.collectionName" class="video-card__collection" :title="video.collectionName">
        <v-icon size="13">mdi-folder-star-outline</v-icon>
        <span class="text-clamp-1">{{ video.collectionName }}</span>
      </div>

      <a
        v-if="video.owner.mid"
        class="video-card__up"
        :href="`https://space.bilibili.com/${video.owner.mid}`"
        target="_blank"
        rel="noreferrer"
        :title="video.owner.name"
        @click.stop
      >
        <v-avatar size="22" class="video-card__avatar">
          <img v-if="video.owner.face" :src="face" :alt="video.owner.name" />
          <span v-else class="video-card__avatar-fallback">
            {{ String(video.owner.name || '?').slice(0, 1) }}
          </span>
        </v-avatar>
        <span class="text-clamp-1">{{ video.owner.name }}</span>
      </a>

      <div class="video-card__stats md-body-small">
        <span v-if="pending" class="video-card__stat" title="元数据待补齐">
          <v-icon size="14">mdi-open-in-new</v-icon>{{ video.bvid }}
        </span>
        <template v-else>
          <span class="video-card__stat" :title="`播放量 ${video.stat.view}`">
            <v-icon size="14">mdi-play-circle-outline</v-icon>{{ formatCount(video.stat.view) }}
          </span>
          <span class="video-card__stat" :title="`弹幕 ${video.stat.danmaku}`">
            <v-icon size="14">mdi-message-text-outline</v-icon>{{ formatCount(video.stat.danmaku) }}
          </span>
          <span class="video-card__stat video-card__stat--date" :title="pubdateText">
            {{ pubdateText }}
          </span>
        </template>
      </div>
    </div>
  </article>
</template>

<script setup>
import { computed } from 'vue'
import { imageUrl } from '@/api'
import { formatCount, formatDuration, formatDateTime } from '@/utils/format'

const props = defineProps({
  video: { type: Object, required: true },
  compact: { type: Boolean, default: false },
})

const cover = computed(() => imageUrl(props.video.cover))
const face = computed(() => imageUrl(props.video.owner?.face))
/** Deferred 投稿: no cover / 简介 / UP 主 yet, filled in on a later visit. */
const pending = computed(() => props.video.metadataState === 'pending')
const duration = computed(() => (props.video.duration ? formatDuration(props.video.duration) : ''))
const pubdateText = computed(() =>
  props.video.pubdate ? formatDateTime(props.video.pubdate * 1000).slice(0, 10) : '',
)
</script>

<style scoped>
.video-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.video-card__link {
  display: block;
  min-width: 0;
}

.video-card__cover {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: 16px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface-container-high));
  transition: border-radius 0.25s cubic-bezier(0.2, 0, 0, 1);
}

.video-card__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.4s cubic-bezier(0.2, 0, 0, 1);
}

/* deferred 投稿 placeholder (no cover yet) */
.video-card__cover--pending {
  background:
    linear-gradient(135deg, rgb(var(--v-theme-surface-container-high)), rgb(var(--v-theme-surface-container-low)));
}

.video-card__pending {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.video-card__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.28);
  opacity: 0;
  transition: opacity 0.25s cubic-bezier(0.2, 0, 0, 1);
}

.video-card:hover .video-card__overlay {
  opacity: 1;
}

.video-card:hover .video-card__cover img {
  transform: scale(1.05);
}

.video-card:hover .video-card__cover {
  border-radius: 12px;
}

.video-card__badge {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.4px;
  font-variant-numeric: tabular-nums;
}

.video-card__category {
  position: absolute;
  left: 8px;
  top: 8px;
  padding: 2px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(6px);
  color: #fff;
  font-size: 11px;
  font-weight: 500;
  opacity: 0;
  transform: translateY(-4px);
  transition: all 0.25s cubic-bezier(0.2, 0, 0, 1);
}

.video-card:hover .video-card__category {
  opacity: 1;
  transform: translateY(0);
}

.video-card__title {
  margin: 0;
  font-size: 15px;
  font-weight: 500;
  line-height: 22px;
  color: rgb(var(--v-theme-on-surface));
  transition: color 0.2s cubic-bezier(0.2, 0, 0, 1);
}

.video-card__link:hover .video-card__title {
  color: rgb(var(--v-theme-primary));
}

.video-card__meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.video-card__collection {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-size: 12px;
  font-weight: 500;
  color: rgb(var(--v-theme-primary));
}

.video-card__up {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
  transition: color 0.2s cubic-bezier(0.2, 0, 0, 1);
}

.video-card__up:hover {
  color: rgb(var(--v-theme-primary));
}

.video-card__avatar {
  flex: none;
  overflow: hidden;
  background: rgb(var(--v-theme-surface-container-high));
}

.video-card__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.video-card__avatar-fallback {
  font-size: 11px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.video-card__stats {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  color: rgb(var(--v-theme-on-surface-variant));
  opacity: 0.85;
}

.video-card__stat {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
}

.video-card--compact .video-card__title {
  font-size: 14px;
  line-height: 20px;
}

@media (max-width: 600px) {
  .video-card__title {
    font-size: 13px;
    line-height: 18px;
  }

  .video-card__up {
    font-size: 12px;
  }

  .video-card__stat--date {
    display: none;
  }
}
</style>
