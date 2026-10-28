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
!define PRODUCT_NAME "Zyra Syntax Profile"
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
    // electron-builder compiles a separate uninstaller pass and treats warnings
    // as errors. Never execute either generated fixture installer.
    await writeFile(path.join(directory, 'uninstaller.nsi'), `Unicode true
!define BUILD_UNINSTALLER
!include "LogicLib.nsh"
!define PROJECT_DIR "${root}"
!define APP_FILENAME "Zyra Syntax Fixture"
!define PRODUCT_NAME "Zyra Syntax Profile"
!define APP_EXECUTABLE_FILENAME "NonexistentFixture.exe"
!define VERSION "0.8.0-dev.1"
!include "\${PROJECT_DIR}\\build\\preview-installer.nsh"
Name "Uninstaller syntax check only"
OutFile "${path.join(directory, 'uninstaller-fixture.exe')}"
InstallDir "$TEMP/Zyra Syntax Fixture"
RequestExecutionLevel user
Section
 WriteUninstaller "$INSTDIR\\unused-uninstaller.exe"
SectionEnd
Section "Uninstall"
 !insertmacro customCheckAppRunning
 !insertmacro customUnInstall
SectionEnd
`);
    const uninstall = spawnSync(executable, ['/WX', '/V2', path.join(directory, 'uninstaller.nsi')], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
    assert.equal(uninstall.status, 0, uninstall.stdout + uninstall.stderr);
    assert.equal(existsSync(path.join(directory, 'uninstaller-fixture.exe')), true);
    const result = spawnSync(executable, ['/WX', '/V2', path.join(directory, 'fixture.nsi')], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(existsSync(path.join(directory, 'fixture.exe')), true);
    const expanded = spawnSync(executable, ['/PPO', path.join(directory, 'fixture.nsi')], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
    assert.equal(expanded.status, 0, expanded.stdout + expanded.stderr);
    assert.ok(expanded.stdout.includes('$APPDATA\\Zyra Syntax Profile\\updates\\installer-requests'), 'actual NSIS expansion must target the product profile, not the installation folder');
    assert.ok(!expanded.stdout.includes('$APPDATA\\Zyra Syntax Fixture\\updates'), 'installation folder identity must never locate consent flags');
    console.log('PASS actual NSIS installer/uninstaller compilation with warnings-as-errors, manual/automatic flags, exact-file wait and success receipt. No installer executed.');
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
}
