import { createRouter, createWebHistory } from 'vue-router'
import { SITE_NAME } from '@/constants'

/**
 * Read-only site. Publishing is done in the Node admin page (/admin) by bvid,
 * so there is no upload route and no account system.
 */
const routes = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/HomeView.vue'),
    meta: { title: '首页' },
  },
  {
    path: '/search',
    name: 'search',
    component: () => import('@/views/SearchView.vue'),
    meta: { title: '搜索' },
  },
  {
    path: '/video/:bvid',
    name: 'video',
    component: () => import('@/views/VideoView.vue'),
    meta: { title: '视频' },
  },
  {
    path: '/favorites',
    name: 'favorites',
    component: () => import('@/views/FavoritesView.vue'),
    meta: { title: '我的收藏' },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'notfound',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { title: '页面不存在' },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, saved) {
    if (saved) return saved
    return { top: 0 }
  },
})

// Document title: "<page> · <siteName>"（siteName 来自 config.json）；
// the video page overrides it with the video's own title.
router.afterEach((to) => {
  const title = to.meta?.title
  document.title = title ? `${title} · ${SITE_NAME}` : SITE_NAME
})

export default router
