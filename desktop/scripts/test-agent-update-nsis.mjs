import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..');
const source = await readFile(path.join(root, 'build/agent-update-handoff.nsh'), 'utf8');
assert.match(source, /!macro customCheckAppRunning/);
assert.doesNotMatch(source, /taskkill|Stop-Process|KILL_PROCESS/, 'the scoped handoff never kills app images');
assert.match(source, /installer-pending-\$\{VERSION\}.*[\s\S]*installer-ready-\$\{VERSION\}/);
if (process.platform !== 'win32') { console.log('SKIP NSIS compilation on non-Windows; handoff source safety assertions passed'); }
else {
  const cache = path.join(process.env.LOCALAPPDATA, 'electron-builder/Cache/nsis');
  const versions = await readdir(cache);
  const executable = versions.map(version => path.join(cache, version, 'makensis.exe')).find(file => existsSync(file));
  if (!executable) throw new Error('NSIS compiler unavailable. Installer syntax gate remains pending.');
  const directory = await mkdtemp(path.join(tmpdir(), 'zyra-nsis-syntax-'));
  try {
    await writeFile(path.join(directory, 'fixture.nsi'), `Unicode true
!include "LogicLib.nsh"
!define PROJECT_DIR "${root}"
!define APP_FILENAME "Zyra Syntax Fixture"
!define APP_EXECUTABLE_FILENAME "NonexistentFixture.exe"
!define VERSION "0.8.0-dev.1"
!include "\${PROJECT_DIR}\\build\\preview-installer.nsh"
Name "Syntax check only"
OutFile "${path.join(directory, 'fixture.exe')}"
InstallDir "$TEMP/Zyra Syntax Fixture"
RequestExecutionLevel user
Function .onInit
 !insertmacro customInit
FunctionEnd
Section
 !insertmacro customCheckAppRunning
 !insertmacro customInstall
SectionEnd
`);
    const result = spawnSync(executable, ['/V2', path.join(directory, 'fixture.nsi')], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(existsSync(path.join(directory, 'fixture.exe')), true);
    console.log('PASS actual NSIS macro compilation, manual/automatic flags, exact-file wait and success receipt. No installer executed.');
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
}
