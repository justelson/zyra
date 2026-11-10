import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const marker = "zyra-development-launcher:v1";
const checkoutRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function installDevCommand({ root = checkoutRoot, directory, configurePath = true, platform = process.platform } = {}) {
  const binDirectory = directory || (platform === "win32"
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Zyra", "bin")
    : path.join(os.homedir(), ".local", "bin"));
  const target = path.join(binDirectory, platform === "win32" ? "zyra-dev-source.cmd" : "zyra-dev-source");
  let current;
  try { current = await readFile(target, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (current !== undefined && !current.includes(marker)) throw new Error(`Refusing to replace an unmanaged command at ${target}.`);
  const entry = path.join(path.resolve(root), "bin", "zyra-dev.mjs");
  const batchQuote = (value) => value.replaceAll("%", "%%");
  const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const contents = platform === "win32"
    ? `@echo off\r\nrem ${marker}\r\n"${batchQuote(process.execPath)}" "${batchQuote(entry)}" %*\r\nexit /b %ERRORLEVEL%\r\n`
    : `#!/bin/sh\n# ${marker}\nexec ${shellQuote(process.execPath)} ${shellQuote(entry)} "$@"\n`;
  await mkdir(binDirectory, { recursive: true });
  if (current !== contents) await writeFile(target, contents);
  if (platform !== "win32") await chmod(target, 0o755);
  const onPath = () => String(process.env.PATH || "").split(path.delimiter).some((value) => path.resolve(value).toLowerCase() === path.resolve(binDirectory).toLowerCase());
  if (configurePath && platform === "win32") {
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", [
      '$dir=$env:ZYRA_DEV_COMMAND_DIRECTORY',
      '$current=[Environment]::GetEnvironmentVariable("Path","User")',
      '$parts=@($current -split ";" | Where-Object { $_ })',
      'if($parts -notcontains $dir){[Environment]::SetEnvironmentVariable("Path",(($parts+$dir)-join ";"),"User")}'
    ].join(";")], { env: { ...process.env, ZYRA_DEV_COMMAND_DIRECTORY: binDirectory }, windowsHide: true });
    if (!onPath()) process.env.PATH = `${process.env.PATH || ""}${path.delimiter}${binDirectory}`;
  }
  return { path: target, pathConfigured: onPath() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await installDevCommand();
  console.log(`Registered zyra-dev-source: ${result.path}`);
  if (!result.pathConfigured) console.log(`Add ${path.dirname(result.path)} to PATH to run zyra-dev-source from any folder.`);
}
