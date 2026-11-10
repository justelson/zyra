import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tuiReleaseAssetName } from '../../../scripts/tui-release-contract.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
export const desktopTuiTargets = platform => platform === 'windows' ? ['windows-x64'] : platform === 'macos' ? ['macos-arm64', 'macos-x64'] : platform === 'linux' ? ['linux-x64'] : (() => { throw new Error('Unsupported Desktop TUI platform.'); })();
export function run(command, args, cwd = root, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited ${code}`)));
  });
}
export async function stageDesktopTui({ platform, version, channel, output = path.join(root, 'desktop/.release/zyra-tui') }) {
  const build = path.join(root, 'desktop/.release/tui-build');
  await mkdir(build, { recursive: true });
  const targets = desktopTuiTargets(platform);
  for (const target of targets) await run(process.execPath, ['scripts/build-tui-release.mjs', `--target=${target}`, `--version=${version}`, `--output=${build}`]);
  if (process.env.ZYRA_EXPECT_SIGNED === '1' && platform !== 'linux') {
    const marker = path.join(build, 'signature.json');
    await writeFile(marker, JSON.stringify({ schemaVersion: 1, platform }));
    await run(process.execPath, ['scripts/sign-standalone-tui.mjs', `--platform=${platform}`, `--version=${version}`, `--dir=${build}`, `--marker=${marker}`]);
  }
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const binaries = [];
  for (const target of targets) {
    const source = path.join(build, tuiReleaseAssetName(version, target));
    const file = `zyra-${target}${target.startsWith('windows') ? '.exe' : ''}`;
    const destination = path.join(output, file);
    await copyFile(source, destination);
    const digest = createHash('sha256'); for await (const bytes of createReadStream(destination)) digest.update(bytes);
    binaries.push({ file, platform: platform === 'windows' ? 'win32' : platform === 'macos' ? 'darwin' : 'linux', arch: target.endsWith('arm64') ? 'arm64' : 'x64', size: (await stat(destination)).size, sha256: digest.digest('hex') });
  }
  const manifest = { schemaVersion: 1, version, channel, sourceSha: process.env.ZYRA_BUILD_SOURCE_SHA || null, binaries };
  await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = JSON.parse(await readFile(path.join(root, 'desktop/package.json'), 'utf8')).version;
  const platform = process.argv.find(arg => arg.startsWith('--platform='))?.split('=')[1];
  await stageDesktopTui({ platform, version, channel: process.env.ZYRA_BUILD_DISTRIBUTION === 'preview' ? 'preview' : 'stable' });
}
