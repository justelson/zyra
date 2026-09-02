import { readFileSync } from 'node:fs'
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { browserAssistantBridgeProxyPlugin } from './scripts/maint/browser-assistant-bridge-proxy'

const projectRoot = resolve(__dirname)
const rendererRoot = resolve(__dirname, 'src/renderer')
const desktopVersion = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version
// Fast builds bundle main/preload after a cached renderer typecheck. Transforming
// the renderer's complete Monaco/Shiki graph is reserved for the production gate.
const fastBuild = process.env.ZYRA_FAST_BUILD === '1'

export default defineConfig({
    main: {
        plugins: [
            externalizeDepsPlugin({
                include: ['node-pty']
            })
        ],
        build: {
            ...(fastBuild ? { minify: false, reportCompressedSize: false } : {}),
            rollupOptions: {
                input: {
                    index: resolve(__dirname, 'src/main/index.ts')
                }
            }
        }
    },
    preload: {
        plugins: [externalizeDepsPlugin()],
        build: {
            ...(fastBuild ? { minify: false, reportCompressedSize: false } : {}),
            rollupOptions: {
                input: {
                    index: resolve(__dirname, 'src/preload/index.ts')
                },
                output: {
                    format: 'cjs',
                    entryFileNames: '[name].cjs'
                }
            }
        }
    },
    renderer: fastBuild ? undefined : {
        root: rendererRoot,
        define: {
            __ZYRA_DESKTOP_VERSION__: JSON.stringify(desktopVersion)
        },
        optimizeDeps: {
            include: ['@pierre/diffs', '@pierre/diffs/react', '@pierre/diffs/worker/worker.js'],
            exclude: ['@silurus/ooxml']
        },
        worker: {
            format: 'es'
        },
        build: {
            ...(fastBuild ? { minify: false, reportCompressedSize: false } : {}),
            rollupOptions: {
                input: {
                    index: resolve(rendererRoot, 'index.html')
                }
            }
        },
        plugins: [
            react(),
            ...(fastBuild ? [] : [viteStaticCopy({
                targets: [{
                    src: resolve(__dirname, 'node_modules/material-icon-theme/icons/*.svg').replace(/\\/g, '/'),
                    dest: 'material-icons'
                }]
            })]),
            browserAssistantBridgeProxyPlugin()
        ],
        resolve: {
            alias: {
                '@': resolve(__dirname, 'src/renderer/src'),
                '@shared': resolve(__dirname, 'src/shared'),
                react: resolve(__dirname, 'node_modules/react'),
                'react-dom': resolve(__dirname, 'node_modules/react-dom'),
                'react/jsx-runtime': resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
                'react/jsx-dev-runtime': resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),
                'decode-named-character-reference': resolve(__dirname, 'node_modules/decode-named-character-reference/index.js')
            }
        },
        server: {
            port: 5174,
            hmr: { clientPort: 5174 },
            fs: {
                allow: [
                    projectRoot
                ]
            }
        }
    }
})
