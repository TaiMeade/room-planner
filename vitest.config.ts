import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

// Kept separate from vite.config.ts so the unit tests don't pull in the Vuetify
// plugin — the geometry and unit layers are plain TypeScript by design.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
