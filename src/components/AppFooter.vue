<template>
  <div class="footer" :style="{ paddingBottom: lift ? `${20 + lift}px` : undefined }">
    <div class="page-container footer__inner">
      <div class="footer__brand">
        <BrandMark :size="22" />
        <span class="md-title-medium">{{ SITE_NAME }}</span>
      </div>

      <div class="footer__links md-body-small">
        <router-link to="/">首页</router-link>
        <router-link to="/search">搜索</router-link>
        <router-link to="/favorites">我的收藏</router-link>
        <a href="https://www.bilibili.com" target="_blank" rel="noreferrer">哔哩哔哩</a>
        <a href="https://github.com/KotokawaAkira/VideoStation" target="_blank" rel="noreferrer">
          参考项目
        </a>
      </div>

      <div v-if="FOOTER_NOTE" class="footer__copy md-body-small">
        {{ BRAND_OWNER }} · {{ FOOTER_NOTE }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, watch } from 'vue'
import BrandMark from './BrandMark.vue'
import { BRAND_OWNER, SITE_NAME, siteConfig } from '@/constants'
import { ui } from '@/store/ui'
import { isMini } from '@/store/player'

const FOOTER_NOTE = siteConfig.footerNote

/**
 * Extra bottom space so the floating layers (the fixed comment composer and the
 * mini player) never sit on top of the copyright line.
 */
const lift = computed(() => {
  const composer = ui.bottomComposer ? 76 : 0
  const mini = isMini.value ? 264 : 0
  return Math.max(composer, mini)
})

/**
 * When the extra space is added while the view is already pinned to the bottom,
 * the browser keeps the old scroll offset (the new space stays below the fold),
 * which would leave the copyright line under a floating layer. Re-pin to the
 * true bottom in that case. `behavior: 'instant'` deliberately overrides the
 * global `scroll-behavior: smooth`.
 */
watch(lift, (value, previous) => {
  if (value <= previous) return
  const doc = document.documentElement
  const atBottom = window.scrollY + window.innerHeight >= doc.scrollHeight - previous - 8
  if (!atBottom) return
  requestAnimationFrame(() => {
    window.scrollTo({ top: doc.scrollHeight, behavior: 'instant' })
  })
})
</script>

<style scoped>
.footer {
  margin-top: 48px;
  border-top: 1px solid rgb(var(--v-theme-outline-variant));
  background: rgb(var(--v-theme-surface-container-low));
  transition: padding-bottom 0.25s cubic-bezier(0.2, 0, 0, 1);
}

.footer__inner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 20px;
  /* padding-bottom is set inline so it can clear the floating layers */
}

.footer__brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.footer__links {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  color: rgb(var(--v-theme-on-surface-variant));
}

.footer__links a {
  transition: color 0.2s cubic-bezier(0.2, 0, 0, 1);
}

.footer__links a:hover {
  color: rgb(var(--v-theme-primary));
}

.footer__copy {
  color: rgb(var(--v-theme-on-surface-variant));
  opacity: 0.7;
}

@media (max-width: 600px) {
  .footer__inner {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
