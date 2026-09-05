import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = resolve(import.meta.dirname, '..')
export default defineConfig({
    root,
    plugins: [react()],
    cacheDir: resolve(root, 'node_modules/.cache/vite-shell-preview'),
    optimizeDeps: { entries: ['scripts/fixtures/shell-file-preview.html'], exclude: ['@silurus/ooxml'] },
    worker: { format: 'es' },
    resolve: { alias: {
        '@': resolve(root, 'src/renderer/src'),
        '@shared': resolve(root, 'src/shared'),
        // Match the production renderer: the DOM decoder cannot run in a Markdown worker.
        'decode-named-character-reference': resolve(root, 'node_modules/decode-named-character-reference/index.js')
    } },
    css: { postcss: resolve(root) },
    server: { host: '127.0.0.1', port: 5181, strictPort: true }
})
