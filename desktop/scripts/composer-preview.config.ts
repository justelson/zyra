import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
const root = resolve(import.meta.dirname, '..')
export default defineConfig({
    root: resolve(root, 'src/renderer'),
    cacheDir: resolve(root, 'node_modules/.cache/vite-composer-preview'),
    plugins: [react()],
    define: { __ZYRA_DESKTOP_VERSION__: JSON.stringify('composer-review'), __ZYRA_BUILD_METADATA__: JSON.stringify({ distribution: 'preview' }) },
    optimizeDeps: { entries: ['composer-review.html'], include: ['react', 'react-dom/client', 'react-router-dom', 'lucide-react'] },
    resolve: { alias: { '@': resolve(root, 'src/renderer/src'), '@shared': resolve(root, 'src/shared') } },
    css: { postcss: root },
    server: { host: '127.0.0.1', port: 5187, strictPort: true, fs: { allow: [root] } }
})
