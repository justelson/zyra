import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const runtimePath = fileURLToPath(new URL('../../src/renderer/src/components/ui/visualization/visualization-frame-runtime.js', import.meta.url))
export function visualizationFrameDocument() {
    const script = readFileSync(runtimePath, 'utf8').replace(/\r\n/g, '\n')
    const hash = createHash('sha256').update(script).digest('base64')
    const policy = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"></head><body><script>${script}</script></body></html>`
}
export function visualizationFramePlugin() {
    return {
        name: 'zyra:visualization-frame',
        configureServer(server) {
            server.watcher.add(runtimePath)
            const refresh = file => { if (file === runtimePath) server.ws.send({ type: 'full-reload', path: '*' }) }
            server.watcher.on('change', refresh)
            server.httpServer?.once('close', () => server.watcher.off('change', refresh))
            server.middlewares.use((request, response, next) => {
                if (request.url?.split('?')[0]?.endsWith('/visualization-frame.html')) {
                    response.setHeader('Content-Type', 'text/html; charset=utf-8')
                    response.end(visualizationFrameDocument())
                } else next()
            })
        },
        generateBundle() { this.emitFile({ type: 'asset', fileName: 'visualization-frame.html', source: visualizationFrameDocument() }) }
    }
}
