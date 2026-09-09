import assert from 'node:assert/strict'
import { BrowserWindow, globalShortcut, screen } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function handle(window: BrowserWindow): string {
    const value = window.getNativeWindowHandle()
    return value.length === 8 ? value.readBigUInt64LE().toString() : value.readUInt32LE().toString()
}

async function rootsAt(points: Array<{ x: number; y: number }>): Promise<string[]> {
    // Match InputProvider.ValidatePoint's actual Win32 ownership check. No input is sent.
    const script = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OverlayHitTest {
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    public static long RootAt(int x, int y) {
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        return GetAncestor(WindowFromPoint(new Point {X=x,Y=y}),2).ToInt64();
    }
}
'@
${points.map((point) => `[OverlayHitTest]::RootAt(${Math.round(point.x)},${Math.round(point.y)})`).join('\n')}`
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 30_000 })
    return stdout.trim().split(/\r?\n/)
}

export async function verifyOverlayHitTesting(target: BrowserWindow, safety: BrowserWindow, cursor: BrowserWindow): Promise<void> {
    const bounds = target.getBounds()
    const point = screen.dipToScreenPoint({ x: bounds.x + 138, y: bounds.y + 138 })
    const label = await safety.webContents.executeJavaScript('(() => { const r = document.querySelector("#indicator").getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()')
    const safetyBounds = safety.getBounds()
    const points = [
        point,
        screen.dipToScreenPoint({ x: bounds.x + 134, y: bounds.y + 133 }),
        screen.dipToScreenPoint({ x: safetyBounds.x + label.x, y: safetyBounds.y + label.y })
    ]
    const actualRoots = await rootsAt(points)
    console.log('OVERLAY_WIN32_HIT_TEST', JSON.stringify({ target: handle(target), safety: handle(safety), cursor: handle(cursor), actualRoots, points, safetyEnabled: safety.isEnabled(), cursorEnabled: cursor.isEnabled() }))
    for (const actualRoot of actualRoots) assert.equal(actualRoot, handle(target), 'visible decorative overlays must not obscure the authorized target in WindowFromPoint')
    assert.equal(safety.isVisible(), true)
    assert.equal(cursor.isVisible(), true)
    assert.equal(globalShortcut.isRegistered('Esc'), true, 'noninteractive decoration must preserve global emergency stop')

    const obstruction = new BrowserWindow({ x: bounds.x + 110, y: bounds.y + 110, width: 100, height: 100, frame: false, show: false, focusable: false, skipTaskbar: true })
    try {
        await obstruction.loadURL('data:text/html,<body style="background:red">Owned obstruction fixture</body>')
        obstruction.setAlwaysOnTop(true, 'screen-saver', 2)
        obstruction.showInactive()
        await new Promise((resolve) => setTimeout(resolve, 150))
        assert.equal((await rootsAt([point]))[0], handle(obstruction), 'a real obstructing window must still fail the exact target ownership check')
    } finally {
        obstruction.destroy()
    }
}
