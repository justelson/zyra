import assert from 'node:assert/strict';
import { isDefinitelyCriticalZyraToolPermission, isPotentiallyCriticalZyraToolPermission } from '../src/permission-command-policy.mjs';

const classify = command => isDefinitelyCriticalZyraToolPermission({ toolName: 'bash', command });
const probe = `powershell -NoProfile -Command "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' | Where-Object { $_.DisplayName -like '*ExampleApp*' } | Format-List; Get-AppxPackage *ExampleApp*; Test-Path (Join-Path $env:LOCALAPPDATA 'Programs\\ExampleApp\\ExampleApp.exe')"`;
assert.equal(classify(probe), false, 'read-only installed-app lookup must not match disk formatting');
for (const formatter of ['Format-List', 'Format-Table', 'Format-Wide', 'Format-Custom', 'Format-Hex']) {
  assert.equal(classify(`Get-Item example | ${formatter}`), false, formatter);
  assert.equal(classify(`powershell -Command "Get-Item example | ${formatter} -Property Name"`), false, formatter);
}
for (const command of [
  'format C:', 'FORMAT D: /FS:NTFS', 'format.com E:', '"C:\\Windows\\System32\\format.exe" F:',
  'Format-Volume -DriveLetter D', 'format-list.exe D:', 'format-list-custom D:',
  'diskpart', 'Remove-Item data -Recurse -Force', 'git push origin dev',
  'terraform apply -auto-approve', 'winget install ExampleApp', 'Set-ExecutionPolicy Unrestricted',
]) assert.equal(classify(command), true, `critical action remains gated: ${command}`);
assert.equal(isPotentiallyCriticalZyraToolPermission({ toolName: 'bash', command: probe }), false);
assert.equal(isPotentiallyCriticalZyraToolPermission({ toolName: 'bash', command: 'echo token' }), true);
assert.equal(isPotentiallyCriticalZyraToolPermission({ toolName: 'read', outsideProject: true }), true);
assert.equal(isDefinitelyCriticalZyraToolPermission({ toolName: 'delete', detail: 'example' }), true);
assert.equal(classify('npm test'), false);
console.log('Permission command policy: read-only formatters, real destructive commands and escalation boundaries: ok');
