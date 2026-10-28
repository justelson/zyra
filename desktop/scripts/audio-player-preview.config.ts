import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createAudioPlayerWave } from './fixtures/audio-player-wave'
import { audioPlayerSampleMp3 } from './fixtures/audio-player-sample.mjs'

const root = resolve(import.meta.dirname, '..')
const audio = {
    '/__audio-preview__/sample.mp3': { bytes: Buffer.from(audioPlayerSampleMp3, 'base64'), mime: 'audio/mpeg' },
    '/__audio-preview__/sample.wav': { bytes: Buffer.from(createAudioPlayerWave()), mime: 'audio/wav' },
    '/__audio-preview__/short.wav': { bytes: Buffer.from(createAudioPlayerWave(1)), mime: 'audio/wav' }
}
export default defineConfig({
    root: resolve(root, 'src/renderer'),
    cacheDir: resolve(root, 'node_modules/.cache/vite-audio-preview'),
    plugins: [react(), {
        name: 'synthetic-audio-preview',
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                const path = (request.url || '').split('?')[0]
                if (!path.startsWith('/__audio-preview__/')) return next()
                const sample = audio[path as keyof typeof audio]
                if (!sample) { response.statusCode = 404; response.end(); return }
                const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
                const start = range ? Number(range[1]) : 0
                const end = range?.[2] ? Math.min(Number(range[2]), sample.bytes.length - 1) : sample.bytes.length - 1
                if (start > end || start >= sample.bytes.length) { response.statusCode = 416; response.end(); return }
                response.setHeader('Content-Type', sample.mime)
                response.setHeader('Accept-Ranges', 'bytes')
                response.setHeader('Cache-Control', 'no-store')
                if (range) {
                    response.statusCode = 206
                    response.setHeader('Content-Range', `bytes ${start}-${end}/${sample.bytes.length}`)
                }
                response.setHeader('Content-Length', end - start + 1)
                response.end(sample.bytes.subarray(start, end + 1))
            })
        }
    }],
    define: { __ZYRA_DESKTOP_VERSION__: JSON.stringify('audio-review'), __ZYRA_BUILD_METADATA__: JSON.stringify({ distribution: 'preview' }) },
    optimizeDeps: { entries: ['audio-review.html'], include: ['react', 'react-dom/client', 'lucide-react'] },
    resolve: { alias: { '@': resolve(root, 'src/renderer/src'), '@shared': resolve(root, 'src/shared') } },
    css: { postcss: root },
    server: { host: '127.0.0.1', port: 5201, strictPort: true, fs: { allow: [root] } }
})
