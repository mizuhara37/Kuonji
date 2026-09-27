import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import vuetify from './plugins/vuetify'
import { siteConfig } from './constants'
import { state } from './store/app'
import { mix, normalizeHex } from './utils/theme'
import '@mdi/font/css/materialdesignicons.css'
import './styles/global.css'

// Apply the stored colour scheme before the first paint (no theme flash).
vuetify.theme.change(state.theme)

/**
 * Site-wide look from config.json: icon, brand CSS variables and the optional
 * page background (image or plain colour). Done here (not in a component) so it
 * applies to every route and to the very first paint.
 */
function applySiteAppearance() {
  const primary = normalizeHex(siteConfig.primaryColor || '#6BBF8A')

  // --ava is the avatar fallback tint used by several components
  document.documentElement.style.setProperty('--ava', primary.toLowerCase())
  document.documentElement.style.setProperty('--ava-soft', mix(primary, '#9AC8E2', 0.5).toLowerCase())

  if (siteConfig.icon) {
    let link = document.querySelector('link[rel~="icon"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.href = siteConfig.icon
  }

  const image = String(siteConfig.backgroundImage || '').trim()
  if (image) {
    const opacity = Number(siteConfig.backgroundOpacity)
    const backdrop = document.createElement('div')
    backdrop.className = 'site-backdrop'
    backdrop.style.backgroundImage = `url("${image}")`
    backdrop.style.opacity = String(Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 0.35)
    document.body.prepend(backdrop)
    // the app paints an opaque background by default — let the image show through
    document.body.classList.add('has-site-backdrop')
  } else if (siteConfig.backgroundColor) {
    document.body.style.backgroundColor = normalizeHex(siteConfig.backgroundColor)
  }
}

applySiteAppearance()

createApp(App).use(router).use(vuetify).mount('#app')
