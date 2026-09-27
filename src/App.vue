<template>
  <v-app>
    <AppNavbar />

    <v-main :class="{ 'v-main--bottom-nav': mobile }">
      <router-view v-slot="{ Component }">
        <transition name="route-fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>

      <AppFooter />
    </v-main>

    <AppBottomNav v-if="mobile" />

    <!-- Mounted once for the whole app: keeps playing while you browse -->
    <GlobalPlayer />

    <v-snackbar
      v-model="state.snackbar.show"
      :color="state.snackbar.color"
      :timeout="state.snackbar.timeout"
      location="bottom center"
      rounded="lg"
      elevation="6"
    >
      <span class="md-body-medium">{{ state.snackbar.text }}</span>
      <template #actions>
        <v-btn variant="text" size="small" @click="state.snackbar.show = false">关闭</v-btn>
      </template>
    </v-snackbar>
  </v-app>
</template>

<script setup>
import { watch } from 'vue'
import { useDisplay, useTheme } from 'vuetify'
import AppNavbar from '@/components/AppNavbar.vue'
import AppBottomNav from '@/components/AppBottomNav.vue'
import AppFooter from '@/components/AppFooter.vue'
import GlobalPlayer from '@/components/GlobalPlayer.vue'
import { state } from '@/store/app'

const theme = useTheme()
const { mobile } = useDisplay()

// Single source of truth for the colour scheme: the store drives Vuetify.
watch(
  () => state.theme,
  (value) => theme.change(value),
  { immediate: true },
)
</script>

<style scoped>
.v-main--bottom-nav {
  padding-bottom: 80px !important;
}
</style>
