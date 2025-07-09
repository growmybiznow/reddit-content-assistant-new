    import { defineConfig } from 'vite'
    import react from '@vitejs/plugin-react'

    export default defineConfig({
      // This line is CRITICAL for GitHub Pages!
      // It must be the name of your repository, surrounded by forward slashes.
      base: '/reddit-content-assistant-new/', // <--- VERIFY THIS!
      plugins: [react()],
    })
