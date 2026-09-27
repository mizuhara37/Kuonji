<template>
  <v-bottom-navigation class="bottom-nav" grow color="primary" bg-color="surface" elevation="8">
    <v-btn
      v-for="item in items"
      :key="item.key"
      class="bottom-nav__item"
      :class="{ 'bottom-nav__item--active': activeKey === item.key }"
      :to="item.to"
    >
      <v-icon :color="activeKey === item.key ? 'primary' : undefined">
        {{ activeKey === item.key ? item.iconActive : item.icon }}
      </v-icon>
      <span class="bottom-nav__label md-body-small">{{ item.label }}</span>
    </v-btn>
  </v-bottom-navigation>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

// 投稿 was removed from the site: publishing happens in the Node admin page.
const items = [
  { key: 'home', label: '首页', icon: 'mdi-home-outline', iconActive: 'mdi-home', to: '/' },
  { key: 'search', label: '搜索', icon: 'mdi-magnify', iconActive: 'mdi-magnify', to: '/search' },
  {
    key: 'favorites',
    label: '我的收藏',
    icon: 'mdi-star-outline',
    iconActive: 'mdi-star',
    to: '/favorites',
  },
]

const activeKey = computed(() => {
  if (route.name === 'home') return 'home'
  if (route.name === 'search') return 'search'
  if (route.name === 'favorites') return 'favorites'
  return ''
})
</script>

<style scoped>
.bottom-nav {
  border-top: 1px solid rgb(var(--v-theme-outline-variant));
}

.bottom-nav__item {
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  border-radius: 0;
}

.bottom-nav__label {
  opacity: 0.75;
}

.bottom-nav__item--active .bottom-nav__label {
  opacity: 1;
}
</style>
