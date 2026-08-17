import { fileURLToPath, URL } from 'node:url'

import { templateCompilerOptions } from '@tresjs/core'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import vuetify from 'vite-plugin-vuetify'

export default defineConfig({
  plugins: [
    // TresJS renders `<TresMesh>`, `<primitive>` and friends itself, so the Vue
    // compiler has to be told they are not components to resolve. Without this
    // the 3D canvas mounts and stays empty, with only a console warning.
    vue({ ...templateCompilerOptions }),
    vuetify({ autoImport: true }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
