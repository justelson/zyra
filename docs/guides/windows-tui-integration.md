# Windows TUI icon and launch integration

**Status: implemented locally for the v0.6.2 candidate; not yet released.** See the [roadmap](../roadmap.md).

The standalone TUI executable and Desktop use the same approved ICO artwork. The Windows installer also needs to supply that icon to the shell and terminal host.

## Branded launch entry

The updated installer adds:

- **Zyra Terminal** in Start Menu, using the shared Desktop icon.
- A **Zyra** Windows Terminal profile, using an application-owned JSON fragment and local icon.
- The existing stable `zyra` command, including its verified pending-update behavior.

It does not edit Windows Terminal's `settings.json`, change the default profile, or replace unrelated profiles. Use `-NoTerminalIntegration` with `install.ps1` to opt out of the shortcut/profile additions.

Windows Terminal **1.24 or newer** supports the local icon supplied with the fragment. Existing Cmd or PowerShell tabs keep their host profile's icon when `zyra` runs inside them. Launch through **Zyra Terminal** or select the **Zyra** profile for the branded tab. If an already-open Terminal has not discovered the profile, finish or save active work before reopening Terminal; the installer never closes it automatically.

## Shared asset and compatibility

The build uses `desktop/resources/icon.ico` both for the Windows executable icon and the embedded `assets/zyra.ico` resource. Metadata-capable binaries expose those exact bytes to the installer without starting the SDK, opening a Chat or reading credentials.

The branding probe passes only `--version`, with a process-local metadata opt-in restored afterward. Older binaries therefore stay on their existing version-only path. For a legacy binary, the installer extracts the existing executable icon; only newer binaries can provide the original full multi-resolution ICO.

## Verification

- `node scripts/test-standalone-install-metadata.mjs` checks exact bytes, ICO bounds, legacy-safe version arguments and the metadata-only startup boundary.
- `node scripts/test-windows-tui-integration.mjs` checks actual shortcut/fragment creation in temporary user directories, idempotence, fallback, and preservation of existing settings.
- `node scripts/test-standalone-tui-binary.mjs <binary> <version>` checks the compiled payload, isolated install/update, installed icon files, and Windows first-input behavior through a pseudo-terminal.
- `node scripts/test-zyra-slash-suggestions.mjs` checks model, permission, theme and other picker selections without a live provider.

The headless input check uses a fake local provider and the embedded test runtime, while the normal shared server/bridge path remains covered by the standalone smoke. It does not log in, send a model prompt or modify a real user profile.

References: Microsoft's [fragment extension documentation](https://learn.microsoft.com/en-us/windows/terminal/json-fragment-extensions) and [Terminal command-line reference](https://learn.microsoft.com/en-us/windows/terminal/command-line-arguments), inspected 2026-09-06.
