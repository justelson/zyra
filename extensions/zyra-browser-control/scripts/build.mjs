import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'dist', 'unpacked')
await rm(path.join(root, 'dist'), { recursive: true, force: true })
await mkdir(out, { recursive: true })
await cp(path.join(root, 'manifest.json'), path.join(out, 'manifest.json'))
for (const name of (await readdir(path.join(root, 'assets'))).sort()) {
  await cp(path.join(root, 'assets', name), path.join(out, name))
}
// Keep injected page functions intact: they are serialized into an isolated world.
await build({ absWorkingDir: root, entryPoints: { 'service-worker': 'src/service-worker.ts', ui: 'src/ui/main.tsx' }, outdir: out,
  external: ['./font.woff2'], bundle: true, format: 'esm', platform: 'browser', target: 'chrome125', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof' })
for (const name of ['popup', 'console']) await writeFile(path.join(out, `${name}.html`), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zyra Browser</title><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script type="module" src="ui.js"></script></body></html>`)
console.log(`Built unpacked extension: ${path.relative(root, out)}`)
