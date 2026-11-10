import { mkdirSync, realpathSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

/** A running version stays independent of Desktop's replaceable application folder. */
export function registerDesktopTuiLease() {
  const payload = process.env.ZYRA_DESKTOP_TUI_PAYLOAD;
  if (!payload) return;
  try {
    const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
    if (normalize(realpathSync(path.dirname(process.execPath))) !== normalize(realpathSync(payload))) return;
    const directory = path.join(payload, 'leases');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, `${process.pid}.json`);
    writeFileSync(file, JSON.stringify({ pid: process.pid }), { mode: 0o600 });
    process.once('exit', () => { try { unlinkSync(file); } catch {} });
  } catch { /* A read-only cache must not prevent a terminal from starting. */ }
}
