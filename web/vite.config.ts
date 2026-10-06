import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: { main: 'index.html', safety: 'safety.html', legal: 'legal.html' },
    },
  },
})
