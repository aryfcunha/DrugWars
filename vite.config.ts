import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Set base for GitHub Pages: /<repo-name>/
// Repo is github.com/aryfcunha/DrugWars
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/DrugWars/' : '/',
  plugins: [react(), tailwindcss()],
})
