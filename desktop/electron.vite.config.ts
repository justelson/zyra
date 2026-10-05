import { readFileSync } from 'node:fs'
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { browserAssistantBridgeProxyPlugin } from './scripts/maint/browser-assistant-bridge-proxy'
import { createDesktopBuildMetadata } from './src/shared/distribution-identity'

const projectRoot = resolve(__dirname)
const rendererRoot = resolve(__dirname, 'src/renderer')
const desktopVersion = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version
const buildMetadataDefine = { __ZYRA_BUILD_METADATA__: JSON.stringify(createDesktopBuildMetadata(process.env)) }
// Fast builds bundle main/preload after a cached renderer typecheck. Transforming
// the renderer's complete Monaco/Shiki graph is reserved for the production gate.
const fastBuild = process.env.ZYRA_FAST_BUILD === '1'

// electron-vite's main preset prepends browser-oriented entry fields during its
// enforce:pre config hook. Mutate after that preset instead of returning a
// config fragment, since Vite merges returned mainFields arrays.
const nodeFirstMainEntriesPlugin = {
    name: 'zyra:main-node-first-package-entries',
    apply: 'build' as const,
    enforce: 'post' as const,
    config(config: { resolve?: { mainFields?: string[] } }) {
        config.resolve ??= {}
        config.resolve.mainFields = ['main', 'module']
    }
}

export default defineConfig({
    main: {
        define: buildMetadataDefine,
        plugins: [
            externalizeDepsPlugin({
                include: ['node-pty']
            }),
            nodeFirstMainEntriesPlugin
        ],
        build: {
            ...(fastBuild ? { minify: false, reportCompressedSize: false } : {}),
            // ws catches missing native accelerators and uses its JS fallback.
            // Keep these requires inside that try/catch: the dev resolver would
            // otherwise hoist missing optional peers into throwing ESM imports.
            commonjsOptions: { ignore: ['bufferutil', 'utf-8-validate'] },
            rollupOptions: {
                input: {
                    index: resolve(__dirname, 'src/main/index.ts')
                }
            }
        }
    },
    preload: {
        define: buildMetadataDefine,
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
            __ZYRA_DESKTOP_VERSION__: JSON.stringify(desktopVersion),
            ...buildMetadataDefine
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
                    index: resolve(rendererRoot, 'index.html'),
                    mcpAppSandbox: resolve(rendererRoot, 'mcp-app-sandbox.html')
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
