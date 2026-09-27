import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import vuetify from './plugins/vuetify'
import { state } from './store/app'
import '@mdi/font/css/materialdesignicons.css'
import './styles/global.css'

// Apply the stored colour scheme before the first paint (no theme flash).
vuetify.theme.change(state.theme)

createApp(App).use(router).use(vuetify).mount('#app')
