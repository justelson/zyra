import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const desktop = path.resolve(import.meta.dirname, '..')
const macro = path.join(desktop, 'build/installer-directory-swap.nsh')
if (process.platform !== 'win32') {
    console.log('SKIP native directory-swap fixtures on non-Windows')
    process.exit(0)
}
const cache = path.join(process.env.LOCALAPPDATA, 'electron-builder/Cache/nsis')
const compiler = (await readdir(cache)).map(version => path.join(cache, version, 'makensis.exe')).find(existsSync)
assert.ok(compiler, 'Actual NSIS compiler required')
const fixture = await mkdtemp(path.join(tmpdir(), 'zyra-swap-fixture-'))
const installed = path.join(fixture, 'application')
const sentinel = path.join(fixture, 'profile', 'history-sentinel.txt')
const report = path.join(fixture, 'report.txt')
const uninstaller = path.join(fixture, 'retire.exe')
const builderSource = await readFile(path.join(desktop, 'node_modules/app-builder-lib/templates/nsis/uninstaller.nsh'), 'utf8')
const nativeFunction = name => {
    const match = builderSource.match(new RegExp(`Function un\\.${name}[\\s\\S]*?FunctionEnd`))
    assert.ok(match, `Missing actual electron-builder ${name}`)
    return match[0].replaceAll(`un.${name}`, `un.original${name}`)
}
const env = { ...process.env, ZYRA_SWAP_FIXTURE_ROOT: installed }
function run(file, args, extra = {}) {
    const result = spawnSync(file, args, { env: { ...env, ...extra }, encoding: 'utf8', windowsHide: true, timeout: 30_000 })
    assert.ifError(result.error)
    return result
}
async function seed() {
    await mkdir(path.join(installed, 'resources', 'nested'), { recursive: true })
    await writeFile(path.join(installed, 'a-first.txt'), 'preserve first file')
    await writeFile(path.join(installed, 'resources', 'nested', 'z-locked.txt'), 'preserve locked file')
    await mkdir(path.dirname(sentinel), { recursive: true })
    await writeFile(sentinel, 'profile history stays outside application replacement')
    await rm(report, { force: true })
}
// Hold actual Windows handles without DELETE sharing. Directory-only lock forces
// the real fallback; adding a nested locked file exercises partial-move recovery.
async function holdLocks(nested = false) {
    const script = `import ctypes,sys\nk=ctypes.WinDLL('kernel32',use_last_error=True)\nk.CreateFileW.restype=ctypes.c_void_p\nk.CreateFileW.argtypes=[ctypes.c_wchar_p,ctypes.c_uint32,ctypes.c_uint32,ctypes.c_void_p,ctypes.c_uint32,ctypes.c_uint32,ctypes.c_void_p]\nk.CloseHandle.argtypes=[ctypes.c_void_p]\nhandles=[]\nfor p,flags in [(sys.argv[1],0x02000000)]+([(sys.argv[2],0)] if len(sys.argv)>2 else []):\n h=k.CreateFileW(p,0x80000000,3,None,3,flags,None)\n assert h not in (None,ctypes.c_void_p(-1).value),ctypes.get_last_error()\n handles.append(h)\nprint('READY',flush=True)\nsys.stdin.readline()\nfor h in handles:k.CloseHandle(h)`
    const child = spawn('python', ['-c', script, installed, ...(nested ? [path.join(installed, 'resources/nested/z-locked.txt')] : [])],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const exited = new Promise(resolve => child.once('exit', resolve))
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Fixture Windows locks unavailable')), 5_000)
        child.once('error', reject)
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Lock helper exited ${code}`)) })
        child.stdout.once('data', data => { clearTimeout(timer); assert.match(String(data), /READY/); resolve() })
    })
    return async () => { child.stdin.end('\n'); await exited }
}
try {
    const source = `Unicode true
!include "LogicLib.nsh"
!define UNINSTALL_FILENAME "retire.exe"
Var FixtureMode
Var FallbackCalls
Var RestoreCalls
!define isUpdated '$FixtureMode == "update"'
!include "${macro}"
Name "Bounded Zyra directory fixture"
OutFile "${path.join(fixture, 'fixture.exe')}"
InstallDir "${installed}"
RequestExecutionLevel user
SilentInstall silent
SilentUnInstall silent
Section
  WriteUninstaller "${uninstaller}"
SectionEnd
Function un.onInit
  ReadEnvStr $INSTDIR ZYRA_SWAP_FIXTURE_ROOT
  ReadEnvStr $FixtureMode ZYRA_SWAP_FIXTURE_MODE
  StrCpy $FallbackCalls 0
  StrCpy $RestoreCalls 0
FunctionEnd
${nativeFunction('atomicRMDir')}
${nativeFunction('restoreFiles')}
Function un.atomicRMDir
  IntOp $FallbackCalls $FallbackCalls + 1
  Call un.originalatomicRMDir
FunctionEnd
Function un.restoreFiles
  IntOp $RestoreCalls $RestoreCalls + 1
  Call un.originalrestoreFiles
FunctionEnd
Section "Uninstall"
  !insertmacro customRemoveFiles
  FileOpen $R1 "${report}" w
  FileWrite $R1 "$FallbackCalls,$RestoreCalls"
  FileClose $R1
SectionEnd
`
    const file = path.join(fixture, 'fixture.nsi')
    await writeFile(file, source)
    const compiled = run(compiler, ['/WX', '/V2', file])
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
    assert.equal(run(path.join(fixture, 'fixture.exe'), ['/S']).status, 0)

    await seed()
    const fast = run(uninstaller, ['/S', `_?=${installed}`], { ZYRA_SWAP_FIXTURE_MODE: 'update' })
    assert.equal(fast.status, 0, fast.stdout + fast.stderr)
    assert.equal(await readFile(report, 'utf8'), '0,0', 'One directory rename must skip recursive per-file moves')
    assert.equal(existsSync(installed), false)
    assert.match(await readFile(sentinel, 'utf8'), /profile history/)

    await seed()
    const unlockDirectory = await holdLocks()
    try {
        const fallback = run(uninstaller, ['/S', `_?=${installed}`], { ZYRA_SWAP_FIXTURE_MODE: 'update' })
        assert.equal(fallback.status, 0, fallback.stdout + fallback.stderr)
        assert.equal(await readFile(report, 'utf8'), '1,0', 'A refused folder rename uses actual builder fallback')
    } finally { await unlockDirectory() }
    await rm(installed, { recursive: true, force: true })

    await seed()
    const unlockFiles = await holdLocks(true)
    try {
        const blocked = run(uninstaller, ['/S', `_?=${installed}`], { ZYRA_SWAP_FIXTURE_MODE: 'update' })
        assert.notEqual(blocked.status, 0, 'Locked fallback files must abort replacement')
        assert.equal(existsSync(report), false, 'Failed retirement cannot report success')
        assert.equal(await readFile(path.join(installed, 'a-first.txt'), 'utf8'), 'preserve first file')
        assert.equal(await readFile(path.join(installed, 'resources/nested/z-locked.txt'), 'utf8'), 'preserve locked file')
    } finally { await unlockFiles() }
    await rm(installed, { recursive: true, force: true })

    await seed()
    assert.equal(run(uninstaller, ['/S', `_?=${installed}`], { ZYRA_SWAP_FIXTURE_MODE: 'uninstall' }).status, 0)
    assert.equal(await readFile(report, 'utf8'), '0,0', 'Ordinary uninstall retains its direct removal path')
    assert.equal(existsSync(installed), false)
    assert.match(await readFile(sentinel, 'utf8'), /profile history/)
    console.log('PASS actual NSIS folder swap, refused-rename fallback, locked-file rollback and unchanged uninstall; synthetic application/profile only')
} finally {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(tmpdir()))
    assert.ok(path.basename(fixture).startsWith('zyra-swap-fixture-'))
    await rm(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
