# Desktop-managed terminal updates

Desktop packages include a native standalone TUI with the same version and source identity. Windows and Linux carry x64; universal macOS carries arm64 and x64. The terminal command executes that binary directly. It does not start Electron, query a registry or contact an updater on each launch. Normal application startup checks only package identity and cached file size; installation verifies full SHA-256 digests.

The Windows installer updates the managed command during installation. On macOS and Linux, opening the updated app refreshes an already-owned command. An existing legacy `Desktop --tui` launcher also performs the one-time migration on its next invocation. Settings can install the command on a fresh Unix system. New launches use the installed payload; existing processes keep their loaded version.

## Existing systems

Stable owns `zyra`; Preview owns `zyra-dev`. Each has an independent immutable payload cache outside the replaceable Desktop folder. Only recognized Zyra-owned launchers are migrated. Custom files and symlinks are preserved.

The installer preserves the former data namespace. A source `zyra-dev` launcher keeps `Zyra-dev`, including its instance-suffix behavior. An existing standalone command keeps its `.zyra` namespace. A Desktop-owned command keeps its explicit namespace. Fresh Preview commands use the installed Preview profile. No chat, credential, project preference or model-speed setting is migrated or reset.

A migrated source launcher is retained as `zyra-dev-source` unless that name is already occupied. `npm run zyra-dev-source` always runs the checkout. `npm run install:dev` now registers that explicit source command. This keeps installed version selection separate from checkout development.

Payload directories include version and content hash. The new launcher is published only after verification and staging. A running terminal registers its PID lease. An update retains live or uncertain old versions and removes unused versions. On Windows an executable lock additionally prevents removing an active binary. No terminal is killed or hot-reloaded. Uninstall only removes its own matching installation's command and can restore the prior source/standalone launcher.

Existing background-agent update admission and explicit Stop requirements remain in force. Retaining a terminal process does not authorize interrupting its server-owned work.

## Build and validation

`prepare-release-resources.mjs` compiles and stages the native TUI before Desktop packaging. Release signing signs the TUI before its manifest is generated; Desktop packaging preserves those signatures. Packaged validation checks the matching version, platform, architecture and checksum, including both macOS binaries. Preview compilation accepts its derived `-dev.N` version. All candidate builds for this change run on hosted workers.

`desktop-tui-checks.yml` runs in the helper repository against an exact allowlisted source SHA. It builds and validates unpacked native Desktop applications on Windows, macOS and Linux, exercises the compiled terminal's real launcher and live-process retention, and records first-invocation and warm process-start samples. The version-command benchmark measures launcher overhead, not provider latency or an OS cold cache. No installer is published or installed on the user's PC.

Focused checks:

- `node scripts/test-desktop-tui-install.mjs`: migration, namespaces, custom commands, integrity and cleanup using isolated fixtures.
- `node scripts/test-dev-command.mjs`: explicit source development.
- `bun desktop/scripts/test-preview-terminal-isolation.ts`: Dev versus stable ownership.
- `node scripts/test-desktop-tui-native.mjs <staged-package>`: actual compiled payload and launcher, Unicode account paths, process retention and startup timings. Run after a hosted build.
