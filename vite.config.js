import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/reddit-content-assistant-new/', // Asegúrate que sea el nombre de tu repositorio
  plugins: [react()],
})