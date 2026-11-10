import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..'), directory = await mkdtemp(join(tmpdir(), 'zyra-extension-native-'));
try {
    const main = join(directory, 'main.cjs');
    await build({ entryPoints: [join(desktop, 'scripts/fixtures/browser-extension-native.ts')], outfile: main, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], plugins: [{ name: 'isolated-browser-session', setup(b) { b.onResolve({ filter: /browser-preview-handlers$/ }, () => ({ path: 'browser-session', namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export function getGlobalBrowserSession(){throw Error("Fixture must inject its private persistent session")}', loader: 'js' })); } }] });
    for (const restart of ['0', '1']) {
        const env = { ...process.env, ZYRA_EXTENSION_TEST_PROFILE: join(directory, 'profile'), ZYRA_EXTENSION_TEST_RESTART: restart };
        delete env.ELECTRON_RUN_AS_NODE;
        const code = await new Promise((done, reject) => { const child = spawn(electron, [main], { env, windowsHide: true, stdio: 'inherit' }); const timeout = setTimeout(() => child.kill(), 45000); child.once('error', reject); child.once('exit', code => { clearTimeout(timeout); done(code); }); });
        assert.equal(code, 0, 'actual extension lifecycle passes');
    }
}
finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-extension-native-'))
        throw Error('Unexpected cleanup path');
    await rm(directory, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
}
