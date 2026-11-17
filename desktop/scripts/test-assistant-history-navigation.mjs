import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(join(tmpdir(), 'zyra-navigation-input-'))
try {
    const messages = Array.from({ length: 160 }, (_, index) => {
        const at = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()
        return { id: `navigation-message-${index}`, role: index % 2 === 0 ? 'user' : 'assistant', text: `Saved message ${index}.\n\n${'Saved conversation context stays readable while history windows change. '.repeat(8)}`, turnId: `navigation-turn-${Math.floor(index / 2)}`, createdAt: at, updatedAt: at, streaming: false, timelineSequence: index + 1 }
    })
    const input = join(directory, 'pages.json'), report = join(directory, 'report.json')
    await writeFile(input, JSON.stringify([{ messages, activities: [], proposedPlans: [] }]))
    const code = await new Promise((done, reject) => {
        const child = spawn(process.execPath, [join(desktop, 'scripts/replay-assistant-long-chat.mjs'), input, report, '--navigation'], { cwd: desktop, windowsHide: true, stdio: 'inherit' })
        child.once('error', reject); child.once('exit', value => done(value ?? 1))
    })
    if (code !== 0) throw new Error(`History navigation renderer failed (${code})`)
    if (process.argv[2]) await writeFile(resolve(process.argv[2]), await readFile(report))
} finally {
    if (dirname(directory) !== tmpdir() || !basename(directory).startsWith('zyra-navigation-input-')) throw new Error('Unexpected navigation cleanup path')
    await rm(directory, { recursive: true, force: true })
}
