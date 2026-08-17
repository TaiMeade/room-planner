import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import vuetify from './plugins/vuetify'

import '@fontsource-variable/archivo'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './styles/main.css'

createApp(App).use(createPinia()).use(vuetify).mount('#app')
