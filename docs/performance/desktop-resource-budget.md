# Desktop performance baseline and resource budget

Status: Active engineering baseline

Measured: 2026-08-17
Branch: `dev`

## User-visible targets

These are Zyra project budgets for a Windows production-renderer launch with an aged local profile. They are not universal Electron guarantees.

| Path | Budget |
| --- | ---: |
| Cold launch to useful chat surface | median ≤ 5 s; p95 ≤ 7 s |
| Existing long-chat open to bounded local timeline | median ≤ 600 ms; p95 ≤ 900 ms |
| Settled working set, no integrated Browser tab | 550–700 MiB including Electron, GPU/network services, and the narrow agent server |
| Settled CPU after background reconciliation | ≤ 10% of one CPU core; GPU process ≤ 1% |
| Main-process private memory | ≤ 225 MiB |
| Renderer private memory | ≤ 225 MiB |

An active integrated Browser tab, Monaco editor, Mermaid diagram, terminal, Voice session, or large file preview has its own incremental budget and must remain lazy or suspendable.

### Hybrid live-transfer resource policy

Chrome-style cross-window transfer keeps Browser pages live by creating them as main-owned `WebContentsView`s from the start and reparenting the same view. This replaces the former renderer-owned `<webview>` guest rather than adding a second page renderer. Terminal transfers retain one main-owned PTY/runtime while destination xterm presentation rehydrates. Files, Review, Resources, Details, and Agents use bounded typed state capsules instead of one renderer per tab.

A local Electron 43 probe measured an otherwise empty app at about **349 MiB** working set, one simple dedicated tab view at **478 MiB**, and four at **815 MiB**—roughly **111 MiB working set / 23 MiB private memory per additional view** before real workspace content. Eager view-per-workspace hosting would therefore violate the 32-tab product limit and desktop memory budget. The approved hybrid policy reserves native live views for Browser pages, retains Terminal processes without another per-tab renderer, and keeps static workspace transfers state-preserving and process-conscious.

## Measurement environment

- Windows 11 Pro build 26200
- Intel Core i5-10310U, 4 cores / 8 logical processors
- 15.78 GiB RAM, SSD, Intel UHD Graphics
- CastLabs Electron 43.2.0+wvcus / Node 24.18.0
- React 19.2, Vite 5.4
- Aged `Zyra-dev` profile: 105 sessions, 106 threads, and a 273 MiB Assistant database
- Production renderer assets launched through Electron against the dev profile
- Detached agent-server memory is included in optimized process totals
- Background machine load was high; paired phase traces and persistence A/B results are stronger evidence than single cold-launch samples

Raw local benchmark output lives under ignored `tmp/perf-20260817/` and must not be published because it is derived from a private local profile.

## Before and after

### End-to-end aged-profile workload

| Metric | Before | Optimized | Change |
| --- | ---: | ---: | ---: |
| Cold useful chat surface | 20.82 s | 4.99 s median | 76.0% faster |
| Heaviest chat open | 5.60 s | 0.38 s median | 93.2% faster |
| Settled working set | 1,293 MiB | 655 MiB median | 49.3% lower |
| Settled CPU after a 60-second reconciliation window | short baseline remained multi-core busy | 0.06% of one core | inside budget |
| Settled private memory | not available from the original short sample | 472 MiB median | inside budget |

The heaviest measured thread exposed 12,300 historical records while returning only the newest bounded page (7 messages and 27 activities). Final frozen-build verification produced a 4.18 s warm-files useful surface, 315 ms chat detail, 643 MiB working set, 465 MiB private memory, and 0.74% of one core after settling. One fresh-build/host-contention outlier reached 8.87 s, so p95 cold-launch work remains open even though the measured median is inside budget.

### Interaction switching pass

A second production-renderer pass targeted the same two aged-profile chats before and after the interaction work. DOM-ready time was observed from route intent through the target timeline mutation; warm values exclude the first cold switch.

| Path | Before | Optimized | Change |
| --- | ---: | ---: | ---: |
| Rich-Markdown chat, warm median | 308 ms | 37 ms | 88.0% faster |
| Rich-Markdown chat, first cold switch | 1,278 ms | 358 ms | 72.0% faster |
| 12,300-record chat, warm median | 155 ms | 26 ms | 83.4% faster |
| Warm Settings route sweep, median | 23.6 ms | 6.7 ms | 71.8% faster |
| Warm Settings route sweep, slowest page | 184.5 ms | 20.8 ms | 88.7% faster |
| Account repeat switch, median | 22.3 ms plus remount reads | 10.0 ms with cached values | 55.2% faster plus zero repeat reads |

The rich chat's mounted timeline fell from 67 rendered rows, 15 Markdown roots, and 2,409 live DOM nodes to 6 rows, 2 Markdown roots, and 491 nodes. The second heavy chat fell from 12 rows, 5 Markdown roots, and 823 nodes to 2 rows, 1 Markdown root, and 375 nodes. No >50 ms renderer long task remained in the optimized warm switches; the prior rich-chat switches spent 235–355 ms in one long task.

Intent-prefetched first visits across all Settings destinations had a 36.8 ms median. Twelve of fourteen measured pages opened within 58 ms; Providers took 85 ms and the first Archived chats visit took 165 ms. Once loaded, all fourteen destinations opened within 21 ms. Three Account leave/re-enter cycles inside the freshness window caused zero overview, connection-status, or model IPC requests. Visible Account polling moved from 15 seconds to 60 seconds, reducing its normal connected-account request cadence by 75%.

After the complete Settings/chat sweep and settlement, the full production process tree measured 543 MiB working set, 461 MiB private memory, 0.62% of one CPU core, and 0.12% GPU-process CPU. Renderer private memory was 78 MiB. A post-GC renderer retention probe moved from 71.5 MiB to 18.7 MiB JavaScript heap and from 34,202 to 952 retained DOM nodes; treat that retention comparison as directional because the older window had accumulated more prior interaction cycles.

### Paired startup phase trace

| Main-process phase | Before | Optimized | Change |
| --- | ---: | ---: | ---: |
| Assistant initialization | 22.07 s | 2.53 s | 88.5% faster |
| Persistence load | 5.83 s | 0.83 s | 85.8% faster |
| Canonical catalog import | 15.64 s | 1.16 s | 92.6% faster |
| Debounced persistence flush | 3.14 s | 0.017 s | 99.5% faster |

### Exact persistence A/B on the optimized code

| Metric | Forced SQL.js | Native SQLite | Change |
| --- | ---: | ---: | ---: |
| Settled working set | 1,565 MiB | 682 MiB median | 56.5% lower |
| Settled private memory | 1,380 MiB | 497 MiB median | 64.0% lower |
| Long-chat detail | 2.90 s | 1.94 s median before local-first ordering | 32.9% faster |
| Useful surface | 5.30 s | 4.69 s median | 11.6% faster |

## Local chat-search scale

`desktop/scripts/benchmark-assistant-chat-search.mjs` builds 10,000 chats and 1,000,000 realistic durable messages, then exercises the production worker with common, phrase-like, rare, active, and all-chat queries. The authoritative Windows run used Electron 43.2.0's Node 24.18.0 / SQLite 3.53.1 runtime.

| Metric | Result | Budget |
| --- | ---: | ---: |
| Warm search p50 | 21.01 ms | — |
| Warm search p95 | 32.05 ms | < 50 ms |
| Cold worker/search p50 | 125.98 ms | — |
| Cold worker/search p95 | 194.92 ms | < 200 ms |
| Electron-main dispatch p95 | 0.087 ms | < 2 ms |
| Cold worker-constructor p95 | 1.131 ms | — |

The dual-projection 1,000,000-message fixture built in 88.50 seconds under Electron 43.2.0's Node mode. Search samples scope-specific fixed buckets across two history ranges, caps canonical candidates at 300 rows, and merges exact message documents whenever a multi-token sample contains a cross-message-only bucket. The 80-run warm maximum was 123.95 ms; the enforced release target remains p95 so isolated host scheduling outliers do not redefine the interaction budget.

## Optional product analytics overhead

`npm run benchmark:analytics` uses an in-process fake transport and 100 synthetic allowlisted events. On the Windows release workstation, disabled initialization took 2.06 ms with a 48,496-byte observed heap delta and zero requests or payload bytes. The enabled durability stress pass took 33.31 ms to initialize, recorded a 321,328-byte heap delta and 18.66 ms maximum event-loop delay, and emitted 36,845 bytes across five fake batches. Persisting 100 events sequentially took 1,996.86 ms because each accepted event fsyncs the bounded queue; product callers do not await that I/O.

Disabled analytics remains outside the launch critical path and creates no identity, queue, timer, directory, or network work.

## Material changes

1. The agent-server catalog and chat index now import a narrow project-path module instead of the 2,200-line Zyra runtime. A direct cold import fell from roughly 9.0 s for `zyra-sdk.mjs` to 50–73 ms for the narrow catalog/index modules.
2. Startup no longer exports and atomically rewrites the entire 273 MiB SQL.js database before Assistant bootstrap can return.
3. Electron production persistence uses Node 24's disk-backed SQLite connection in WAL mode. SQL.js remains the deterministic test backend outside Electron.
4. Compact JSON recovery snapshots are generated from the in-memory shell rather than rescanning every persisted history row.
5. Model discovery no longer prewarms automatically during startup. It runs only when a caller actually needs models.
6. Chat detail returns the bounded persisted page first; canonical reconciliation continues in the background with duplicate-load suppression.
7. Session/thread selection no longer waits for remote presence refresh.
8. The local Browser bridge binds Assistant on its first protected request instead of constructing Assistant before the Desktop window exists.
9. Canonical history reconciliation uses persisted canonical modified-time/entry-count revisions plus generation-safe invalidation; current chats no longer rescan on every launch and an in-flight refresh cannot erase a newer change.
10. Failed persistence batches remain queued, shutdown waits for SQLite close, and a failed final commit keeps Zyra running instead of discarding state. Recovery preserves the database, WAL, and shared-memory files as one set.
11. Incremental JSONL indexing retains incomplete tails and fully rescans same-size rewrites.
12. The Review inspector and its large diff bundle remain lazy until opened; an unused Poppins request was removed.

## Profile growth still to address

The aged dev profile occupies about 1.55 GiB:

| Area | Size |
| --- | ---: |
| Chromium session data | 1,095.5 MiB |
| Default HTTP cache | 359.7 MiB |
| Code cache | 272.6 MiB |
| Browser partitions | 455.5 MiB |
| Assistant directory | 439.6 MiB |

Two unreachable legacy Browser partition directories account for roughly 243 MiB. They are safe candidates for an explicit, confirmed cleanup action; Zyra must not silently remove Browser identity or storage. Cache cleanup and inactive Browser-tab suspension are the next bounded resource projects.

## Correctness boundaries

- Native SQLite opens the existing database directly and adds only nullable canonical-revision columns; no history payload rewrite or destructive compaction is performed.
- A private pre-change database backup was taken for the local verification run.
- Canonical history remains authoritative and converges after local-first rendering. Explicit canonical modified-time and entry-count revisions prevent every-launch rescans and preserve invalidations that arrive during an in-flight refresh.
- The compact JSON file is metadata recovery only; SQLite/WAL is the canonical source for local-only history.
- Full authoritative row ownership for a hard canonical transcript rollback/truncation remains a follow-up. Zyra detects the revision change, but must not delete unmatched local rows until canonical ownership is persisted per row.
- Voice, Browser, Agent Inbox, onboarding, permissions, and persistence contracts remain unchanged.
- No paid provider generation, reset redemption, credential reset, or public release action is part of this benchmark.
