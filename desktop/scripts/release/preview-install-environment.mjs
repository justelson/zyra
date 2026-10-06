import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { win32 as windows } from 'node:path'

export function assertHostedWindows(platform, env) {
    assert.equal(platform, 'win32', 'Preview installation requires Windows')
    assert.equal(env.GITHUB_ACTIONS, 'true', 'Preview installation requires GitHub Actions')
    assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted', 'Preview installation requires a hosted runner')
    assert.equal(env.RUNNER_OS, 'Windows', 'Preview installation requires a Windows runner')
}

export function assertHostedInstallLocation(platform, env, execute = execFileSync) {
    assertHostedWindows(platform, env)
    const powershell = windows.join(absoluteWindowsPath(env.SystemRoot, 'Windows root'),
        'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const script = String.raw`$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ZyraPreviewKnownFolder {
    [DllImport("shell32.dll", ExactSpelling = true)]
    private static extern int SHGetKnownFolderPath(ref Guid folder, uint flags, IntPtr token, out IntPtr result);
    public static string UserProgramFiles() {
        Guid folder = new Guid("5CD7AEE2-2219-4A67-B85D-6C9CE15660CB");
        IntPtr result = IntPtr.Zero;
        try {
            // KF_FLAG_DONT_VERIFY resolves the configured path without creating it.
            Marshal.ThrowExceptionForHR(SHGetKnownFolderPath(ref folder, 0x00004000, IntPtr.Zero, out result));
            return Marshal.PtrToStringUni(result);
        } finally {
            if (result != IntPtr.Zero) Marshal.FreeCoTaskMem(result);
        }
    }
}
'@
[ZyraPreviewKnownFolder]::UserProgramFiles()`
    const actual = execute(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
        { env, encoding: 'utf8', timeout: 30_000, windowsHide: true }).trim()
    const expected = windows.join(absoluteWindowsPath(env.LOCALAPPDATA, 'Local app data'), 'Programs')
    assert.equal(absoluteWindowsPath(actual, 'Windows UserProgramFiles').toLowerCase(), expected.toLowerCase(),
        'Windows UserProgramFiles differs from LOCALAPPDATA/Programs; refusing Preview installation')
}

export function absoluteWindowsPath(value, label) {
    assert.equal(typeof value, 'string', `${label} is required`)
    assert.match(value, /^[A-Za-z]:[\\/]/, `${label} must be an absolute local-drive path`)
    assert.ok(!value.includes('\0'), `${label} contains a null byte`)
    return windows.resolve(value)
}
