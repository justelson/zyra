# Zyra Release Workflow

Zyra is pre-1.0. Release versions still describe meaningful product and compatibility boundaries.

## Lockstep version policy

The CLI/runtime and Desktop ship as one Zyra product version. These four values must always match exactly:

- `package.json` and the root entry in `package-lock.json`;
- `desktop/package.json` and the root entry in `desktop/package-lock.json`.

For v0.6.0 they are all `0.6.0`. The internal Desktop package is `zyra-desktop`; the visible product remains **Zyra** and the stable application identifier remains `app.zyra.desktop`. Desktop and the local Browser surface both report the Desktop package version injected by the two Vite builds.

Do not independently bump the CLI/runtime or Desktop. Run the release contract after every version change:

```bash
bun run --cwd desktop test:release-infra
node desktop/scripts/release/preflight.mjs --mode=contract --expected-version=0.6.0
```

## Version rule

Within the `0.x.x` era:

- **Patch release** (`0.6.0 -> 0.6.1`): fixes and small product polish without a storage, workflow, or compatibility boundary.
- **New pre-1.0 line** (`0.6.x -> 0.7.0`): new visible workflows, release/install behavior, or meaningful runtime behavior.
- **Plan first**: auth changes, destructive file/Git behavior, session or memory format changes, public prompt/profile architecture changes, or anything that can lose context or break existing chats.

Prereleases use `-alpha.N` or `-beta.N`. Semantic core numbers sort first; for an equal core, stable sorts above beta and beta above alpha. A beta install never follows an alpha feed; stable installs only follow stable releases. Differential updates resolve the previous blockmap from the exact tag for the currently installed version.

## Desktop compatibility baseline

v0.6.0 deliberately pins:

- CastLabs Electron for Content Security `43.2.0+wvcus` (Chromium 150, Node 24.18.0, Widevine installed through Google's component updater);
- electron-builder `26.15.3`;
- node-pty `1.1.0`.

Electron officially supports its latest three stable major lines. On 2026-08-14 the [official schedule](https://releases.electronjs.org/schedule) and [stable release list](https://releases.electronjs.org/releases/stable) showed supported lines 41, 42, and 43, so Electron 43 remained the current stable line. Zyra uses CastLabs' version-matched Electron fork because stock Electron does not provide the Widevine CDM required by protected web players such as Spotify. The exact source tag and CastLabs release mirror prevent an unreviewed Chromium/Node/DRM jump during release builds. Zyra never bundles Widevine; the component updater downloads it from Google on the user's device. CastLabs 43.2 currently trails stock Electron 43.4's Chromium patch level. Tagged publication is therefore gated until Zyra upgrades to a matching CastLabs patch or the security delta is explicitly reviewed and accepted.

`node-pty` uses Node-API bindings and ships x64 Windows plus universal macOS prebuild families; Linux compiles its Node-API binding during dependency install. A forced `@electron/rebuild` is deliberately disabled: it needlessly rebuilds an ABI-stable binding, and node-pty 1.1.0's packaged winpty gyp step is incompatible with that forced path. Postinstall verifies either the reviewed platform prebuild or Linux source build, the module stays outside ASAR, and a smoke test loads/spawns it under Electron itself on every native runner:

```bash
npm --prefix desktop run native:prepare
npm --prefix desktop run test:native-abi
```

## Packaged runtime contract

An installed app cannot depend on a neighboring source checkout. Every package build stages the root production runtime at:

```text
process.resourcesPath/zyra-runtime
```

The staged contract contains:

- `src/` (including analytics, agent-server, agent-control, memory, TUI, and workflow runtime code);
- `analytics/events.v1.json`, the shared versioned event catalog imported by the CLI and Desktop main client;
- `bin/` for the package-declared CLI entrypoint;
- `prompts/`;
- built-in `agents/` definitions discovered by the fleet loader;
- built-in `workflows/` definitions discovered by the workflow loader;
- optional built-in `commands/` and `themes/` when present;
- root `package.json`, `package-lock.json`, Apache-2.0 `LICENSE`, `NOTICE`, both third-party legal files, and production `node_modules/` installed from that lock;
- `zyra-runtime-manifest.json`, with sorted source paths, sizes, and SHA-256 hashes.

Stage and validate it with:

```bash
npm --prefix desktop run runtime:stage
npm --prefix desktop run runtime:validate
npm --prefix desktop run test:packaged-runtime
```

`resolveZyraRoot()` checks `process.resourcesPath/zyra-runtime` first. Development retains the existing loaded-worktree-first behavior after that packaged check.

Desktop distributions expose that exact runtime through one managed `zyra` terminal launcher. Windows NSIS writes `%LOCALAPPDATA%\\Zyra\\bin\\zyra.cmd`, points it at the packaged Node/runtime pair, and adds the stable directory to the user PATH. macOS/Linux users can install or repair `~/.local/bin/zyra` from **Settings → About → Terminal**; the launcher invokes the native app in `--tui` mode and keeps writable TUI state under the user data root. The standalone TUI executables remain Electron-free, embed the allowlisted TUI/runtime/install resources, and offer an explicit, optional, exact-version Desktop download during onboarding. That download must match the published `v<version>` release and `SHA256SUMS` before the native installer opens.

`scripts/build-tui-release.mjs` produces one lockstep executable for Windows x64, macOS arm64, macOS x64, and Linux x64 under `dist/tui/v<version>/`. It does not archive the repository or include Desktop, native sidecars, extensions, generated output, or local state.

## Native package matrix

All artifacts include version, OS, and architecture in noncolliding names.

| Platform | Target | Release assets | Updater metadata |
| --- | --- | --- | --- |
| Windows x64 | NSIS, assisted install | `Zyra-Desktop-0.6.0-Windows-x64.exe` and `.blockmap` | `latest.yml` |
| macOS universal | DMG and ZIP | `Zyra-Desktop-0.6.0-macOS-universal.dmg`, `.zip`, and ZIP `.blockmap` | `latest-mac.yml` |
| Linux x64 | AppImage and deb | `Zyra-Desktop-0.6.0-Linux-x64.AppImage` and `.deb` (the AppImage carries its blockmap internally) | `latest-linux.yml` |

The assembled release also contains the four lockstep `Zyra-TUI-0.6.0-*` executables, the repository Apache-2.0 license inside every installed app/runtime, and one `SHA256SUMS` file covering the complete upload set.

Windows retains the assisted NSIS flow, changeable install directory, icons, and Explorer shell integration in `desktop/build/installer.nsh`. The self-contained `win-x64` .NET computer-use sidecar is built and included only on Windows. The browser-control extension is built and packaged on every OS.

Before artifact collection, every packaged app is reopened to validate its runtime manifest/dependencies, extension, platform-scoped sidecar, and node-pty native binding. Asset collection is allowlist-based and rejects missing, duplicate, empty, unexpected, or metadata-inconsistent files.

macOS uses the generated ICNS family, universal architecture, hardened runtime, explicit signing entitlements, Developer Tools category, and a microphone usage description. Linux uses the generated PNG size family and Development category. File associations resolve `resources/icon` so electron-builder selects ICO or ICNS correctly by platform.

Native commands must run on their matching host:

```bash
npm --prefix desktop run build:win
npm --prefix desktop run build:mac
npm --prefix desktop run build:linux
```

For an unpacked native smoke build:

```bash
npm --prefix desktop run build:unpack
```

## Local updater feed

Validate the pure platform/channel selection logic:

```bash
npm --prefix desktop run test:updater-release-feed
```

Inspect a published GitHub feed for a specific installed target:

```bash
npm --prefix desktop run update:test-feed -- --platform windows --arch x64 --current-version 0.5.0
npm --prefix desktop run update:test-feed -- --platform macos --arch arm64 --current-version 0.5.0
npm --prefix desktop run update:test-feed -- --platform linux --arch x64 --current-version 0.5.0
```

Serve already-built local assets without publishing:

```bash
npm --prefix desktop run update:serve-feed -- --platform windows --dir dist/releases/v0.6.0/windows/upload
```

Set `ZYRA_DESKTOP_UPDATE_FEED_URL` to the printed loopback URL when launching an older packaged build. The server validates the platform metadata and complete artifact set before listening.

## Deferred: security-aware release signaling

**Status: deferred to the full application release-system pass.** Do not implement this as a standalone Browser notification. Zyra bundles Chromium through Electron, so Chrome or Edge updates installed on the machine do not update Zyra's browser engine. Security urgency must therefore be part of Zyra's signed release and updater contract.

The trusted release metadata must eventually distinguish ordinary product updates from browser or runtime security updates. At minimum it must carry:

```text
urgency: routine | security | critical
minimumSupportedVersion
releasedAt
securitySummary
```

The metadata must be authenticated through the same trusted publication and update chain as the release artifacts. The application must not accept urgency or minimum-version instructions from an arbitrary unsigned endpoint.

The user-facing policy is:

- **Routine:** show only a quiet indicator in Settings. It may be dismissed or skipped.
- **Security:** show a persistent yellow banner with the concrete security reason. It may be snoozed for a bounded period but not permanently dismissed.
- **Critical:** show a red banner with a grace period and the affected browser/runtime component. It cannot be permanently dismissed.
- Never restart Zyra automatically, terminate active work, or discard unsaved state.
- After a critical-update grace period, restrict only new external Browser navigations. Localhost and private development targets, terminals, editors, existing tabs, and unsaved work must remain available.
- When a security update has downloaded, offer restart at an idle point or on normal app exit, then restore the prior workspace and tabs.

The full release-system work must define and test the signed metadata schema, channel behavior, snooze/grace-period state, minimum-supported-version handling, stale-feed behavior, restart restoration, and an end-to-end upgrade from one signed Zyra release to another. Until that work is complete, the current updater must not describe an available update as security-classified or claim that the embedded Chromium is current.

## CI and release workflows

`.github/workflows/desktop-ci.yml` runs focused release, updater, branding, runtime, type, extension, and node-pty checks on native Windows, macOS, and Linux runners.

`.github/workflows/desktop-release.yml` supports:

- `workflow_dispatch`: unsigned native rehearsal builds from `master`; it uploads the complete assembled workflow artifact and places the same validated files in the private `v<version>` GitHub draft;
- `v*` tag pushes: signed/notarized publication candidates that refresh and validate the existing draft before publication.

The tag path requires all of the following before any public release exists:

1. the tag is exactly `v<lockstep package version>`;
2. tag commit, `HEAD`, and `origin/master` are identical;
3. focused checks and the privacy check pass;
4. signing/notarization secrets pass preflight;
5. all native matrix jobs finish and upload their isolated artifacts;
6. updater metadata and every expected platform artifact validate after assembly;
7. Windows Authenticode and macOS codesign/Gatekeeper/notarization markers validate against the exact standalone TUI bytes and pinned publisher identities;
8. sorted `SHA256SUMS` validates all release files, including Linux artifacts;
9. a GitHub **draft** is created, names/sizes are re-read, and its assets are downloaded again for metadata/checksum validation;
10. only then is that existing draft published.

Matrix jobs have read-only repository permissions and cannot race publication. The final publication job alone receives `contents: write`. Releases use `master`, never `main`.

## Signing and notarization gates

The repository contains no signing credentials. Configure these GitHub Actions secrets without committing their values:

### Windows

- `ZYRA_WINDOWS_CERTIFICATE` — PFX supplied in a `CSC_LINK`-compatible form (for example base64/data URI).
- `ZYRA_WINDOWS_CERTIFICATE_PASSWORD` — PFX password.
- `ZYRA_WINDOWS_CERTIFICATE_THUMBPRINT` — the exact 40-character SHA-1 thumbprint expected on the signed Windows TUI.

### macOS

- `ZYRA_MACOS_CERTIFICATE` — Developer ID Application certificate supplied in a `CSC_LINK`-compatible form.
- `ZYRA_MACOS_CERTIFICATE_PASSWORD` — certificate password.
- `ZYRA_MACOS_TEAM_ID` — the exact 10-character Apple Developer Team ID expected on both signed macOS TUI executables.
- `ZYRA_MACOS_NOTARIZATION_API_KEY` — raw App Store Connect API `.p8` contents.
- `ZYRA_MACOS_NOTARIZATION_KEY_ID` — App Store Connect key ID.
- `ZYRA_MACOS_NOTARIZATION_ISSUER_ID` — App Store Connect issuer UUID.

### Widevine VMP

- `EVS_ACCOUNT_NAME` — CastLabs EVS account used for production Widevine VMP signing.
- `EVS_PASSWD` — CastLabs EVS password. Store only as an Actions secret.
- `ZYRA_ACCEPT_ECS_SECURITY_DELTA` — must be exactly `true` only after explicitly accepting the currently documented CastLabs 43.2 versus stock Electron 43.4 web-security delta; remove this gate after upgrading to a matching release.

Tagged Windows and macOS packages are VMP-signed in addition to their platform signatures. macOS VMP signing runs before Apple code signing; Windows VMP signing runs after Authenticode. A successful EVS pass writes the runtime production-VMP marker consumed by Browser status. CastLabs development binaries can negotiate Widevine, while repeated Spotify track skipping is consistent with a production-license/VMP rejection. The cause is not certified until the EVS-signed package passes real multi-track playback. Linux does not use VMP and may require one restart after first Widevine installation.

Every publication tag, including alpha and beta tags, fails in preflight if any signing or notarization value is absent. The workflow never substitutes ad-hoc or fake signatures. Windows verifies the produced installer and standalone TUI with Authenticode. macOS verifies the app and both entitlement-signed standalone TUI architectures with `codesign`, Gatekeeper, and accepted notarization evidence. A raw macOS executable cannot carry a stapled ticket, so its first Gatekeeper assessment requires network access; use the stapled Desktop DMG for offline installation. Signature evidence records each TUI file's final size and SHA-256, and assembly recomputes both before checksums or publication. Unsigned artifacts are permitted only in a manual rehearsal and remain unpublished in both the workflow artifact store and a GitHub draft, so the updater cannot see them.

## Product analytics gate

Product analytics must remain disabled without an explicit enable flag, project key, and approved HTTPS host. Release validation uses only the injected fake transport. Do not add production credentials to CI, build arguments, source, renderer bundles, logs, or release artifacts.

Before approving analytics changes:

```bash
npm run test:analytics
npm run benchmark:analytics
npm run privacy-check
npm run ui:typecheck
npm run ui:build
npm audit --omit=dev --audit-level=low
npm audit --omit=dev --audit-level=low --prefix desktop
```

Review [`analytics/events.v1.json`](analytics/events.v1.json) and [`docs/architecture/product-analytics.md`](docs/architecture/product-analytics.md) together. Confirm PostHog project retention matches each event's documented intent before supplying production configuration. No PostHog SDK is bundled, so dependency and third-party license gates remain unchanged.

## Release checks

Before committing a release-infrastructure change:

```bash
npm run check
npm run privacy-check
node bin/zyra.mjs --version
npm --prefix desktop run typecheck
npm --prefix desktop run typecheck:browser-runtime
npm --prefix desktop run test:release-infra
npm --prefix desktop run test:branding
npm --prefix desktop run runtime:stage
npm --prefix desktop run runtime:validate
npm --prefix desktop run test:packaged-runtime
npm --prefix desktop run test:native-abi
npm --prefix desktop run smoke:protected-media
git diff --check
```

Run only the native package command available on the current OS. Cross-platform package evidence comes from the native CI/release matrix.

## Local artifact cleanup

Every local packaging run must end with cleanup after its artifacts have been tested or uploaded. This includes failed and cancelled package attempts, which can leave the same large staged runtime and package directories behind.

Remove these generated paths when they are no longer needed:

- `.release/manual/v<version>/`, after the downloaded bundle has been validated;
- `desktop/dist/`, after Desktop packages have been uploaded or discarded;
- `desktop/.release/`, after packaged-runtime validation and packaging finish;
- `dist/tui/v<version>/`, after standalone TUI files have been uploaded or discarded;
- matching generated directories inside temporary release worktrees.

Keep `.zyra/release-logs/` when its evidence is useful. Do not delete `desktop/out/` while the development app is running. Do not remove dependencies, source, user data, credentials, or an entire worktree as release cleanup.

## Licensing

Zyra is licensed under Apache License 2.0. Keep the canonical `LICENSE` text unchanged. `NOTICE` records `Copyright 2026 justelson`, and `THIRD_PARTY_NOTICES.md` explains asset and platform-runtime notices.

Run `npm run licenses:generate` after either production lockfile or a pinned release runtime changes. Commit the generated `THIRD_PARTY_LICENSES.txt`, then run `npm run licenses:check`. Release preflight rejects a stale dependency manifest, a dropped legal file, or a Bun or Node runtime version that no longer matches the generated bundle.

Every Desktop package must contain `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md`, and `THIRD_PARTY_LICENSES.txt`. Electron and Chromium keep their upstream license files beside the app. Windows packages also keep the .NET license and third-party notices beside the self-contained computer-use sidecar. Standalone TUI executables extract the four Zyra legal files with their embedded runtime resources.
