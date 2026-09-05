import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = resolve(import.meta.dirname, '..')
export default defineConfig({
    root,
    plugins: [react()],
    optimizeDeps: { entries: ['scripts/fixtures/project-creation-preview.html'], include: ['react', 'react-dom', 'react-dom/client', 'lucide-react'] },
    resolve: { alias: { '@': resolve(root, 'src/renderer/src'), '@shared': resolve(root, 'src/shared') } },
    css: { postcss: resolve(root) },
    server: { host: '127.0.0.1', port: 5179, strictPort: true }
})
