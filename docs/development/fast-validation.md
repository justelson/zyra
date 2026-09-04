# Fast development validation

Zyra has separate development checks and release gates. Choose the smallest command that proves the change, then run the full gate once when the work crosses boundaries or is ready to merge.

## Command map

Run these from the repository root unless the command says otherwise.

| Work | Command | What it proves |
| --- | --- | --- |
| JavaScript syntax only | `npm run check:syntax` | Parse-only validation for the maintained JavaScript target list |
| Normal CLI iteration | `npm run check:quick` | JavaScript syntax and fast deterministic core contracts |
| CLI/runtime checkpoint | `npm run check:core` | Every core CLI suite; excludes desktop integration |
| Desktop integration checkpoint | `npm run check:desktop` | Browser, fleet, and agent-platform desktop suites, serially |
| Merge/release gate | `npm run check` | Core, desktop, and doctor checks |
| Inspect available check modes | `npm run check:help` | Prints runner modes and concurrency control |
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

1. Run the focused contract test for the code being changed.
2. During desktop work, keep one scoped typecheck watcher running instead of restarting full `tsc` after every edit.
3. Run `npm run check:quick` at a useful checkpoint.
4. Run the authoritative full typecheck only after shared contracts, configuration, or multiple desktop surfaces change.
5. Run `npm run ui:build:fast` for ordinary desktop structural checkpoints.
6. Run `npm run ui:build` when renderer bundle boundaries, workers, imports, or Vite configuration change, and once for merge/release readiness.
7. Run `npm run check` once for merge/release readiness, not after every local edit.

A successful typecheck proves type consistency. A successful build proves bundling. Neither replaces a focused behavior test or UI smoke test.

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

Before either build, avoid running another production build at the same time. If free memory is low, close unused browser tabs or duplicate Electron development sessions. The fast-build script prints a warning below 2 GB available memory.

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

- Put deterministic, isolated tests in the core list.
- Add a test to quick mode only when it does not bind fixed ports, mutate shared repository state, launch persistent processes, or depend on another suite's order.
- Keep Electron/browser/global-profile tests in the serial desktop list.
- Give every test its own temporary directory and clean it in `finally` blocks.

When adding a new desktop source surface, add or update its scoped `tsconfig.*.json` and verify both the scope and the full graph.
