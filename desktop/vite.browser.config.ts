import { readFileSync } from 'node:fs'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { browserAssistantBridgeProxyPlugin } from './scripts/maint/browser-assistant-bridge-proxy'
import { visualizationFramePlugin } from './scripts/maint/visualization-frame-document.mjs'

const projectRoot = resolve(__dirname)
const rendererRoot = resolve(__dirname, 'src/renderer')
const desktopVersion = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version

export default defineConfig({
    root: rendererRoot,
    base: './',
    define: {
        __ZYRA_DESKTOP_VERSION__: JSON.stringify(desktopVersion)
    },
    optimizeDeps: {
        include: ['@pierre/diffs', '@pierre/diffs/react', '@pierre/diffs/worker/worker.js']
    },
    worker: {
        format: 'es'
    },
    build: {
        outDir: resolve(projectRoot, 'out/browser'),
        emptyOutDir: true,
        minify: false,
        reportCompressedSize: false,
        chunkSizeWarningLimit: 5_000
    },
    plugins: [react(), visualizationFramePlugin(), browserAssistantBridgeProxyPlugin()],
    resolve: {
        alias: {
            '@': resolve(projectRoot, 'src/renderer/src'),
            '@shared': resolve(projectRoot, 'src/shared'),
            react: resolve(projectRoot, 'node_modules/react'),
            'react-dom': resolve(projectRoot, 'node_modules/react-dom'),
            'react/jsx-runtime': resolve(projectRoot, 'node_modules/react/jsx-runtime.js'),
            'react/jsx-dev-runtime': resolve(projectRoot, 'node_modules/react/jsx-dev-runtime.js')
        }
    },
    server: {
        port: 5174,
        strictPort: true,
        hmr: { clientPort: 5174 },
        fs: {
            allow: [projectRoot]
        }
    },
    preview: {
        port: 4175,
        strictPort: true
    }
})
