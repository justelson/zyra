# Zyra Repository Map

**Status: Current — 2026-08-31.** This map covers only the Zyra repository. It distinguishes committed product source from generated, private, compatibility, and local working material.

## Committed product and support surfaces

| Path | Purpose / owner | State and evidence | Action |
|---|---|---|---|
| `src/` | Terminal app, shared CLI runtime, memory, agent fleet, workflow runtime, and TUI. | Tracked; loaded by `bin/zyra.mjs` and root scripts. | Keep as product source. |
| `desktop/` | Electron main/preload/renderer application, cross-platform release tooling, and Desktop contract tests. | Tracked; root `ui:*` and agent-platform scripts invoke its package. | Keep as product source. Generated `out/`, `dist/`, `.release/`, local logs, and Desktop state stay ignored. |
| `extensions/` | Chrome exact-tab visual-control extension. | Tracked source; packaged by Desktop from `extensions/zyra-browser-control/dist/unpacked`. | Keep source; keep generated `dist/` ignored. |
| `native/` | Windows computer-use sidecar and deterministic tests. | Tracked .NET source; root `test:agent-control` builds the test project. | Keep source; keep `bin/` and `obj/` ignored. |
| `agents/` | Built-in child-agent definitions. | Tracked; discovered by the fleet definition loader. | Keep. |
| `workflows/` | Built-in sandboxed workflow definitions. | Tracked; discovered by the workflow registry. | Keep. |
| `prompts/` | Public Zyra system prompt, inspection prompt, and profile overlays. | Tracked; loaded by CLI startup/profile code and packaged by `package.json`. | Keep. |
| `bin/` | Published/local CLI entry point. | Tracked; root `bin` metadata and scripts invoke `bin/zyra.mjs`. | Keep. |
| `scripts/` | Regression checks, automation prompts, release helpers, and maintenance entry points. | Tracked; referenced by `package.json` and automation entry points. | Keep source public; generated outputs belong outside this directory and development scripts do not ship in the runtime package. |
| `docs/` | Current guides, architecture, decision records, implementation contracts, runbooks, and automation-required records. | Tracked; indexed by `docs/README.md`. | Keep durable public material only. |
| `.github/` | Public issue and pull-request contribution templates. | Tracked; consumed by GitHub contribution flows. | Keep templates aligned with repository privacy and architecture rules. |
| Root launch/config files | `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `LICENSE`, `RELEASE.md`, manifests, lockfiles, installers, and shell launchers. | Tracked; required for development, licensing, installation, and package metadata. | Keep at repository root. `AGENTS.md` is source guidance and is not part of the runtime package. |

## Local, ignored, or generated surfaces

| Path | Classification | Evidence | Action |
|---|---|---|---|
| `node_modules/`, `desktop/node_modules/` | Generated dependencies. | Ignored and installed from lockfiles. | Keep locally when needed; never commit. |
| `.zyra/`, `desktop/.zyra/` | Private local sessions, memory, preferences, and handoffs. | Explicitly ignored; privacy checks reject local/private material. | Keep private and local. |
| `docs.local/` | One-off prompts, plans, research, handoffs, QA evidence, and working notes. | Explicitly ignored; no runtime consumer. | Keep locally when useful; distill durable conclusions into public docs. |
| `AGENTS.override.md` | Machine-local repository instructions. | Explicitly ignored; Codex gives it precedence over `AGENTS.md`. | Keep local and make it retain the shared `AGENTS.md` contract. |
| `.agents/`, `.codex/` | Machine-specific agent configuration and caches. | Explicitly ignored; public Zyra agent definitions live in `agents/`. | Keep local unless a separate shared configuration is intentionally designed. |
| `.zyra-worktrees/` | Registered temporary Git worktrees. | Ignored; branch/worktree metadata proves their purpose. | Remove a worktree only after ancestry and cleanliness checks. |
| `.coord/` | Autonomous-run coordination state. | Ignored; no production import/package reference. | Local-only historical run state; remove only after its run is accepted. |
| `.playwright-cli/`, `desktop/.playwright-cli/` | Browser automation state and captures. | Ignored; referenced only by test/migration documentation. | Generated test state; safe to recreate. |
| `dist/` | Root release archives and checksums. | Ignored; release tooling is the source. | Generated release output. Preserve intentionally retained archives; do not package as source. |
| `.release/` | Root release-job logs, fetched artifacts, and extracted helper dependencies. | Ignored; release workflows can recreate the contents. | Keep only while investigating a release, then remove through a bounded cleanup. |
| `desktop/out/`, `desktop/dist/`, `desktop/release/` | Electron compile/package output. | Ignored and recreated by Desktop scripts. | Generated; remove exact copies when cleaning. |
| `desktop/.release/` | Deterministic package-input staging for `zyra-runtime` and the Windows-only self-contained sidecar. | Ignored; rebuilt from tracked source and lockfiles by `desktop/scripts/release/prepare-release-resources.mjs`. | Never commit; validate before packaging. |
| `output/` | Screenshots and report render output. | Ignored; no runtime consumer. | Generated review evidence; retain or remove by explicit review. |
| `tmp/` | Database-recovery work, stress-test output, downloaded tools, and scratch files. | Ignored; no production import. Some recovery files may be unique evidence. | Local-only; review subdirectories individually rather than deleting broadly. |
| `resources/` (repository root) | Private exports and derived local analysis. | Root `.gitignore` intentionally excludes it; no package/runtime source dependency. | Keep private; never commit or copy into public docs. This is separate from tracked `desktop/resources/`. |
| `tools/import-*.mjs`, `tools/normalize-*.mjs` | Private export import/normalization helpers. | Narrow ignore rules; no production call path. | Keep local with the private data workflow or archive outside public source. |
| `shims/zyra.cmd` | Local compatibility launcher forwarding to root `zyra.cmd`. | Ignored; no tracked code reference. | Keep only if a local PATH entry still uses it. |
| `apps/` | Residual generated experiment output. | The inspected local child contains only ignored `node_modules/`, `dist/`, and `.playwright-cli/`; no source file, package manifest, nested Git history, or tracked Zyra reference was found. | It is not a movable project. Remove the exact local child only with destructive-cleanup approval. |
| `NUL`, `nul`, `desktop/NUL`, `desktop/nul`, `document.readyState` | Accidental command/shell output files. | Ignored; no source or package reference. | Disposable exact-path clutter. |
| `desktop/electron.vite.config.<timestamp>.mjs` | Timestamped temporary Electron config. | Ignored by a narrow pattern; canonical tracked config exists. | Disposable exact-path generated clutter. |

## Side-project conclusion

No self-contained side project with source or Git history was found inside Zyra. The ignored `apps/` child is generated residue rather than project source, so moving it to a playground would only relocate dependencies and build output. No project move is proposed.

## Verification boundaries

- Tracked references were searched across the repository while excluding dependency/generated directories.
- The external consolidation backup bundle was hash-verified before root cleanup.
- A clean Git status proves committed-source cleanliness; it does not claim that ignored private state or retained local recovery evidence has been deleted.
