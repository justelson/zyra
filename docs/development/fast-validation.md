# Fast development validation

**Targeted tests are the default for development.** A small fix starts with its owning test file or named target. Whole-renderer typechecks, `check:quick`, full suites and builds are checkpoints, not prerequisites for every edit.

Preserve the release gates. A focused unit test proves its own behavior; add the relevant integration check when a change crosses a real boundary, and report any unverified path.

## Command map

Run these from the repository root unless the command says otherwise.

| Work | Command | What it proves |
| --- | --- | --- |
| Single-file JavaScript syntax | `node --check src/permission-command-policy.mjs` | Parse just the changed module; substitute the actual changed file |
| Chat stuck loading or switching history | `npm --prefix desktop run test:timeline-presentation` | Real React and LegendList in isolated Electron: cold chat reveal, chat switching, hydration, initial paging and failed or abandoned pages |
| Command classification | `npm run test:permissions:command-policy` | Pure policy cases, including PowerShell formatters and real destructive commands; no SDK, filesystem or provider startup |
| Approval lifecycle and projection | `npm run test:permissions:lifecycle` and `npm --prefix desktop run test:assistant-approval-projection` | Tool correlation, waiting state, concurrent/late events, denial and compatible storage hydration |
| Windows profile recovery | `npm --prefix desktop run test:windows-profile-recovery` and `npm run test:computer-window-feedback` | Exact-name selection, existing-browser reuse, scoped candidate details and bounded same-window recovery |
| Computer tool failures | `npm run test:computer-tool-errors` | Installed Pi records failed operations as errors and preserves recovery metadata |
| Bounded drawing sequences | `npm --prefix desktop run test:agent-control-drag-sequence` | Mixed semantic, coordinate-click and drag steps preserve revisions, target bounds, capability checks and interruption |
| Windows cursor tracking | `npm --prefix desktop run test:windows-cursor` | Native progress, failed-drag position and negative display coordinates |
| Computer-use glow | `npm --prefix desktop run test:windows-glow` | Hidden isolated Chromium tests entrance/exit, reduced motion, reactivation and cursor timing; no native input |
| Windows overlay ownership | `npm --prefix desktop run smoke:windows-overlay-hit-test` | Isolated real Win32 hit testing across transparent canvas, cursor and indicator; verifies ordinary occlusion still blocks input |
| Windows display scaling | `node native/zyra-computer-use/scripts/smoke-sidecar.mjs --dpi-only` | Requires the Debug helper; isolated window, no input. Checks runtime DPI awareness, native/UIA bounds and capture dimensions on the current display |
| Permission gate behavior | `npm run test:permissions:gate` | Modes, scope/read-only boundaries, approvals and the installed-app lookup regression |
| Approval prompt rendering | `npm --prefix desktop run test:assistant-tool-approval` | Isolated React rendering; no Electron, dev server or model session |
| New Chat/Project picker | `npm --prefix desktop run test:assistant-new-chat` | Focused catalog/picker and new-chat contracts |
| JavaScript syntax checkpoint | `npm run check:syntax` | Parse-only validation for the maintained JavaScript target list |
| Multi-area CLI checkpoint | `npm run check:quick` | Syntax plus several core suites; broader than an individual fix |
| CLI/runtime checkpoint | `npm run check:core` | Every core CLI suite; excludes desktop integration |
| Desktop integration checkpoint | `npm run check:desktop` | Assistant timeline, handoff, Markdown, Browser, fleet, and agent-platform suites, serially |
| Merge/release gate | `npm run check` | Core, desktop, and doctor checks |
| Inspect available check modes | `npm run check:help` | Prints runner modes and concurrency control |
| Response media contract | `npm --prefix desktop run test:assistant-response-media` | Actual Desktop guide injection, authored image/video syntax, Windows URL decoding, and media policy |
| Response media playback | `npm --prefix desktop run test:assistant-response-media-playback` | Hidden, isolated Electron loads, plays, and seeks local H.264 media with no autoplay; requires `ffmpeg`, or an existing read-only file via `ZYRA_MEDIA_TEST_FILE` |
| Desktop UI development | `npm run ui:dev` | Electron/Vite development server with HMR |
| Chat-switch fixture setup | `npm run chat:seed-dev-fixtures` | Idempotently seeds clearly named light and heavy Chats into the running `Zyra-dev` profile |
| Persistent full type feedback | `npm run ui:typecheck:watch` | Keeps the full TypeScript graph alive between edits |
| Renderer-only type check | `npm run ui:typecheck:renderer` | Renderer and shared contracts only |
| Persistent renderer feedback | `npm run ui:typecheck:watch:renderer` | Keeps the renderer graph alive between edits |
| Main-only type check | `npm run ui:typecheck:main` | Electron main process and shared contracts only |
| Persistent main feedback | `npm run ui:typecheck:watch:main` | Keeps the main graph alive between edits |
| Preload-only type check | `npm run ui:typecheck:preload` | Preload bridge and shared contracts only |
| Persistent preload feedback | `npm run ui:typecheck:watch:preload` | Keeps the preload graph alive between edits |
| Shared contract check | `npm run ui:typecheck:shared` | Cross-process contracts and global declarations only |
| Persistent shared feedback | `npm run ui:typecheck:watch:shared` | Keeps the shared graph alive between edits |
| Authoritative desktop type gate | `npm run ui:typecheck` | Entire desktop source graph |
| Fast structural build | `npm run ui:build:fast` | Cached renderer typecheck plus main/preload bundling |
| Production bundle | `npm run ui:build` | Renderer chunks/workers, main/preload, minification, and copied runtime assets |

## Default agent workflow

1. Name the changed behavior, owning module and smallest test that exercises it. Include relevant negative permission/safety cases.
2. Reproduce in that target, make the scoped fix, and rerun it. Add a targeted test when one is missing; do not replace it with a whole-app check.
3. Keep pure policy, parsing, formatting and selection tests on leaf modules. A test for one helper must not import the entire SDK or mount the application just to reach it. Runtime-backed tests remain separate.
4. For UI changes, use the isolated component/interaction test and inspect the affected live flow. Icons, spacing and local copy do not require a whole-renderer typecheck or build.
5. For changes crossing data, IPC, store or component contracts, select the affected integration check after the local tests pass. Run one broader typecheck when that boundary justifies it, not after each edit.
6. Start one scoped watcher only for sustained TypeScript work when it saves repeated work and memory allows. A watcher is not mandatory for a small correction. Reuse existing task-owned watchers and close them when finished.
7. Use `check:quick`, core/desktop suites and structural builds at deliberate multi-area checkpoints. Run the required full checks, packaging and release gates before merge/publication as specified in `RELEASE.md`.

A successful typecheck proves type consistency. A successful build proves bundling. Neither replaces a focused behavior test or UI smoke test.

## Resource and test-boundary rules

- Keep local heavyweight work serial. Do not run typechecking, bundling, browser fixtures and native tests together by default.
- Do not make users repeatedly close apps to validate a small fix. Choose a narrower test and reduce unnecessary imports first. Never close or restart their apps without approval.
- If a necessary broad gate cannot run safely, leave that gate explicitly pending, use CI where appropriate, or request a suitable time/resource window. Do not weaken assertions or claim a pass.
- Do not repeatedly raise timeouts or heap limits when a supposed unit test stalls. Inspect its import graph, fixture setup and resource use. A parser or policy test should normally finish in seconds; investigate unexpected startup costs instead of normalizing them.
- Keep test data synthetic and temporary. No provider calls, personal profiles or app startup for checks that do not require those dependencies.
- Add named targets beside existing package scripts. Avoid adding a new test orchestration framework when a direct command is enough. Keep targeted tests in the appropriate broader CI lane too.

### Current permission-flow work

Start with the three permission targets in the command map. Command classification now lives in `src/permission-command-policy.mjs`, which has no imports. The gate retains its existing public exports and uses that policy. The prompt-rendering target imports the component directly.

Waiting-state/event projection has a dedicated lifecycle target. Run it alongside the gate test for correlation, persistence, denial and concurrent requests. The rendering target alone does not prove approval routing or execution timing.

## Live computer-use outcome checks

For multi-step editing tasks, inspect each returned batch screenshot as well as the final artifact. Successful input delivery does not prove an edit survived: cancellation keys can discard unfinished shapes or drafts without producing a tool error. Verify an unfamiliar editing gesture before repeating it, and retain failed or wasted intermediate work in the timing assessment. Keep the test request unchanged across comparable runs and report provider time separately from tool time.

## Chat-switch fixtures

With the development Desktop running, `npm run chat:seed-dev-fixtures` creates two local-only Chats:

- `TEST — LIGHT CHAT — 6 TURNS — SAFE TO DELETE`
- `TEST — HEAVY CHAT — 220 TURNS + LONG TEXT — SAFE TO DELETE`

The command is idempotent: it replaces only the two reserved development-fixture IDs and restores the previously selected Chat. Both fixtures are read-only and skip provider attachment. The heavy fixture ends with a deliberately short Turn after a 132-Action Turn, exercising retained history, initial backfill, pagination, long Markdown measurement, and virtualization. The seeder refuses packaged and non-`Zyra-dev` profiles and never creates provider conversations.

## Typecheck scopes and caches

The desktop scopes are:

- `main`: Electron process, filesystem, services, IPC handlers
- `preload`: context bridge and renderer-facing adapters
- `renderer`: React UI and browser-side state
- `shared`: contracts passed between processes

Each scope stores incremental state under `desktop/node_modules/.cache/typescript/`, which is already ignored by Git. The full typecheck also has an incremental cache, but a one-shot invocation still has to parse the complete graph. Watch mode is faster during iteration because it keeps that graph in memory.

Use the full graph after changing shared contracts because a scoped check cannot prove every consumer.

## Check runner behavior

`scripts/check.mjs` documents and implements five stable lanes:

- `syntax`: parse-only checks for the maintained JavaScript target list
- `quick`: syntax plus side-effect-light core contracts
- `core`: all CLI/runtime contracts
- `desktop`: heavyweight desktop suites
- `full`: core, desktop, and doctor; this is the default behind `npm run check`

Syntax and independent core tests use bounded concurrency. Desktop suites stay serial because they can share Electron, browser, process, port, and profile resources.

For order-sensitive debugging, force serial core execution:

```powershell
$env:ZYRA_CHECK_CONCURRENCY = '1'
npm run check:core
```

```bash
ZYRA_CHECK_CONCURRENCY=1 npm run check:core
```

Do not increase concurrency casually on 16 GB machines. TypeScript, Vite, Electron, and browser processes can push Windows into paging, which is slower than conservative scheduling.

## Fast build limitations

`ui:build:fast` deliberately runs the cached renderer typecheck and bundles only Electron main/preload. Measurement showed that a full unminified renderer build was slower than production because it still transformed and wrote the complete Monaco, Shiki, Mermaid, and document-preview graph.

The fast command does not prove renderer chunk generation, worker bundling, minification, or copied runtime assets. Do not package or release its output. Use the unchanged `ui:build` command for those authoritative checks.

Before either build, avoid running another production build at the same time. If free memory is low, first reconsider whether that build is needed for the current change. Defer a required build or ask the user before closing any apps. The fast-build script prints a warning below 2 GB available memory.

## Targeted permission-check measurements

A local Windows run of the direct targets, including process startup, measured:

| Target | Wall time |
| --- | ---: |
| Pure command-policy regression | 0.19 s |
| Permission-gate behavior | 0.33 s |
| Isolated approval-panel rendering | 0.94 s |

All three passed in about 1.5 seconds total. No dev server, app restart, provider call, build or typecheck ran. These are observations from one local run, not portable timing thresholds. The classifier target first reproduced the `Format-List` false positive, then passed after the scoped correction while real destructive commands stayed gated.

## Reference measurements

Measured on the Windows development machine used when this workflow was introduced (4 cores / 8 threads, 16 GB RAM). Other machines will differ.

| Gate | Observed time |
| --- | ---: |
| Original cold full desktop typecheck | 62.4s |
| Shared scope, cold | 11.2s |
| Main scope, cold | 16.3s |
| Preload scope, cold | 7.7s |
| Renderer scope, cold | 53.5s |
| Renderer scope, cached | 15.6s, later 6–7s warm |
| Quick check after suite classification | 12.6s runner time / 14.9s through npm |
| Fast structural build, warm | 13.1s |
| Full production build, isolated | 109s |
| Full production build under severe paging before isolation | did not finish within 4 minutes |

The failed unminified-full-build experiment took 131.5s. Its renderer still had to transform and write the complete dependency graph, so it was removed. Keep the fast lane scoped unless profiling demonstrates a better full-renderer strategy.

Memory availability changes these numbers substantially. Do not run full typecheck, production build, and large Electron/browser suites concurrently on a 16 GB machine.

## Maintaining the workflow

When adding tests:

- Provide a direct target for the owning module or feature, with no implicit build/typecheck chain.
- Keep helper tests independent of SDK/application startup. Put unavoidable full-runtime tests in an explicit integration target.
- Put deterministic, isolated tests in the core list.
- Add a test to quick mode only when it does not bind fixed ports, mutate shared repository state, launch persistent processes, or depend on another suite's order.
- Keep Electron/browser/global-profile tests in the serial desktop list.
- Give every test its own temporary directory and clean it in `finally` blocks.

When adding a new desktop source surface, add or update its scoped `tsconfig.*.json` and verify both the scope and the full graph.
