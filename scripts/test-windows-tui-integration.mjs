import { spawnSync } from 'node:child_process';
import path from 'node:path';

if (process.platform !== 'win32') {
  console.log('Windows TUI shortcut/profile check: skipped on this host');
} else {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-File', path.join(import.meta.dirname, 'test-windows-tui-integration.ps1')], {
    stdio: 'inherit', windowsHide: true, timeout: 120_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
