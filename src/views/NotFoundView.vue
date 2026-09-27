<template>
  <div class="notfound">
    <div class="notfound__code">404</div>
    <h1 class="md-title-large notfound__title">这个页面走丢了</h1>
    <p class="md-body-medium notfound__hint">
      你访问的地址不存在，或者视频已经被删除了。
    </p>
    <div class="notfound__actions">
      <v-btn color="primary" variant="flat" rounded="lg" prepend-icon="mdi-home" to="/">
        返回首页
      </v-btn>
      <v-btn variant="tonal" rounded="lg" prepend-icon="mdi-magnify" to="/search">
        去搜索
      </v-btn>
    </div>
  </div>
</template>

<script setup>
// 404 — the reference project had no such page (five separate apps), added here
// so unknown SPA routes degrade gracefully.
</script>

<style scoped>
.notfound {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 96px 16px 140px;
}

.notfound__code {
  font-size: clamp(64px, 14vw, 132px);
  font-weight: 800;
  line-height: 1;
  background: linear-gradient(135deg, #9fe0b8, #3e8f63);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.notfound__title {
  margin: 12px 0 0;
}

.notfound__hint {
  margin: 8px 0 0;
  color: rgb(var(--v-theme-on-surface-variant));
}

.notfound__actions {
  display: flex;
  gap: 12px;
  margin-top: 22px;
}
</style>
