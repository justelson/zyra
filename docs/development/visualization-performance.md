# Visualization scrolling

## Changes

- The existing, version-pinned LegendList 3.3.5 web patch now uses `Element.moveBefore` to reorder connected containers. Unlike remove/reinsert operations, this preserves an iframe's document, focus and native disclosure state. Both CommonJS and ESM bundles are patched through the existing Desktop postinstall command. Engines without the API retain the original insertion fallback.
- The document builder reuses immutable sanitized HTML across virtual-row remounts, theme updates and exports. Its LRU cache holds at most 48 entries and 2 MiB of estimated UTF-16 key/value payload, plus small Map/object overhead. It retains no iframe nodes or extra mounted rows. Title, theme, CSP and inline/export styles are assembled separately on every request. Changed HTML gets a new cache entry; evicted HTML is sanitized again.
- The preparation state reserves the final preview height. The title row also reserves its control height. A newly mounted preview no longer briefly presents a text-height row before becoming a full-height chart.
- Inline chat previews now retain a bounded set of offscreen iframe documents across actual row unmounts. Identity includes the chat, message row, block offset and exact themed source. Atomic moves preserve native disclosure state. Browsers without `moveBefore`, standalone and expanded previews retain the original reload-on-remount behavior. The pool holds at most 32 parked frames and 2 MiB of source strings, in addition to the existing sanitizer cache. These are count/source limits, not a 2 MiB browser-memory limit. Parked animations pause, tooltips close, and parked frames cannot receive focus or pointer input.
- A shared message router dispatches opaque-frame notifications only to their exact registered source. Media anchoring searches visible prose before native caret lookup; media-only viewports avoid the old 21-point caret scan.
- Virtual-list height averages now distinguish user bubbles from assistant replies by stable role. Growing or streaming text does not change a row's pool type.
- Before replacing a reading anchor on scroll, the timeline settles any pending intra-row media adjustment. This prevents a fast grow/shrink or error fallback from losing the inverse correction. A controlled browser sequence reproduced 148 px drift with that one call removed; three fixed runs retained the text at 0 px.

No screenshot substitutes, reduced SVG precision, lower-resolution assets, disabled controls or relaxed sandbox permissions were introduced.

## Reproduction

```sh
npm --prefix desktop run test:visualization-scroll
npm --prefix desktop run benchmark:visualization-scroll
```

An optional absolute JSON output path can follow the benchmark command. `test:visualization-scroll` also verifies both dependency bundles' ordering and older-engine fallback, rejects same-frame reloads during the measured scroll/update phases, and checks bounded caching and zero repeated sanitization on the final warm scroll pass.

`test:visualization-frame-policy` runs the small anchor/router/pool policies without Electron. `test:visualization-frame-lifecycle` adds a real iframe check for document/disclosure preservation across unmounts, chat isolation, source changes, tooltip reset and composer focus. The full scroll check includes that lifecycle flow and rejects any new iframe loads on the last two warmed sweeps. `--profile` writes a CPU profile beside a JSON report; `--native-compositor` measures an unfocused test window outside all displays instead of offscreen rendering. `--variant-dir=<private directory>` substitutes saved preview/anchor sources for controlled local comparisons without editing the running checkout.

`test:visualization-media-scroll` isolates the eight reading-position checks, including valid 180/480 px WebM metadata, unavailable-media fallback, a forced contraction before scroll delivery, resize and a real row remount. The two tiny generated video fixtures are decoded by Chromium; FFmpeg is not required at test time. `--trace-media` instruments only the disposable test bundle for anchor/event-order diagnosis.

The fixture uses the real `AssistantVirtualTimeline`, LegendList, visualization components, DOMPurify and app CSP. It renders 20 synthetic messages with two 80-bar SVG charts each, waits for the bottom previews to load, applies six append/remove prompt pairs, then performs three 64-frame back-and-forth scroll passes. It records iframe loads separately from reloads of the same iframe element. It also checks source invalidation and the empty iframe sandbox.

## Local results, 2026-09-17

Measured sequentially on Windows, Electron 43.2.0 / Chromium 150, LegendList 3.3.5, production React, an 8-logical-CPU i5-10310U and 16 GiB RAM. Tests used a hidden offscreen Electron window, not the running chat. The same workload was used for baseline, atomic-move-only and two optimized runs. Counts and cumulative sanitization durations include initial setup; scroll frame statistics exclude it.

| Metric | Baseline | Optimized, two runs | Change |
| --- | ---: | ---: | --- |
| Sanitization calls across the workload | 211 | 41 / 41 | 80.6% fewer |
| Cumulative sanitization wall time | 2,175.9 ms | 387.2 / 395.0 ms | 81.8% to 82.2% less |
| Sanitizations in each of the last two warm scroll passes | 48 / 48 | 0 / 0 in both runs | Repeated work removed |
| Reloads of existing iframe elements during scrolling | 12 | 0 / 0 | Reordering reloads removed |
| Scroll frames over 32 ms, 192 samples per run | 106 | 34 / 46 | 56.6% to 67.9% fewer |
| Median of three per-pass p95 frame intervals | 83.3 ms | 66.6 / 66.7 ms | About 20% lower, directional |
| Cached key/value payload after workload | No cache | 970,668 bytes | Bounded memory-for-CPU trade-off |

The atomic-move-only run removed the measured reordering reloads, but repeated sanitization remained. This separates the lifecycle fix from the caching improvement. Raw samples, the failed initial hidden-window experiment and the investigation plan are retained as local QA evidence.

## Correctness checks

- `node desktop/scripts/test-legend-list-stateful-reorder.mjs`: passed for ESM/CJS order, stable nodes, atomic movement and fallback.
- `node desktop/scripts/benchmark-visualization-scroll.mjs --verify`: passed twice after optimization.
- `node desktop/scripts/test-visualization-renderer.mjs`: passed, including pre-effect height, cache hits across theme/title/export changes, entry/byte eviction, re-sanitization after eviction, HTML escaping, controls, CSP, opaque origin and denied network/scripts.
- `bun desktop/scripts/test-assistant-timeline-scroll.ts`: passed with 1,000 synthetic turns.
- `node desktop/scripts/test-assistant-timeline-presentation.mjs`: passed for startup, chat switching, hydration, paging and stale request ownership.
- The document-builder leaf module passed a scoped TypeScript check. No whole-app typecheck or production build was run.

## Follow-up measurement, 2026-11-14

The earlier work removed reorder reloads, but actual virtual-row unmounts still recreated iframe documents. A sequential comparison using saved previous sources and the same 40-chart workload measured the following on the machine above. Native test windows stayed outside every display and did not take focus. Both runs had an idle median of 16.7 ms.

| Warm scroll pass | Previous median / p95 | Current median / p95 | New iframe loads, previous / current |
| --- | ---: | ---: | ---: |
| Second sweep | 33.4 / 66.8 ms | 17.2 / 50.1 ms | 19 / 0 |
| Third sweep | 33.4 / 66.9 ms | 18.1 / 50.8 ms | 11 / 0 |

The current run finished with 31 parked frames containing 538,458 source-string bytes and two active frames. Total disposable Electron process working sets were approximately 805 MiB, compared with approximately 800 MiB previously. This single comparison establishes neither a memory reduction nor a hard browser-memory bound. Cold iframe startup and occasional slow frames remain measurable; repeat scrolling avoids recreating those documents. The six delayed-image/video/resize/remount reading checks all retained prose within 0 px in this run.

A later native regression run still had zero warm loads and passed lifecycle/reading checks, but recorded warm medians near 50 ms and p95 values near 108–111 ms. The initial sanitizer phase also slowed substantially. The earlier improvement is directional and must not be presented as a stable frame-rate guarantee. A private message-corpus profile identified container measurement as the largest remaining layout cost. Separating role averages reduced native measurement samples in a sequential replay by about 40%; full-history sweeps still had slow frames.

These initial timing runs used the fixture's minimal CSS. A subsequent repeat exposed that it omitted the production timeline's `overflow-anchor:none` utility, allowing browser anchoring to compete with explicit media compensation. The fixture now supplies and asserts that rule. Historical timing values above remain diagnostics; installed-app acceptance requires the actual production styles and renderer.

The initial canvas-recorded video fixture was also found to be undecodable in the hidden renderer. Its earlier geometry checks exercised the error fallback, so they do not establish successful metadata decoding. The current fixture uses fixed valid bytes, requires the actual decoded dimensions, and checks failure separately. Tracing the failure also exposed the genuine pending-compensation race described above; the CSS correction alone did not resolve that race.

The final corrected offscreen run passed all eight reading checks at 0 px, real metadata and error fallback, exact document/disclosure reuse, chat isolation, source invalidation, focus, tooltip cleanup and animation pause/resume. Both warm sweeps created zero new iframe documents, with medians of 16.7 ms and p95 intervals of 66.6/33.4 ms. Renderer typechecking and both desktop/MV3 visualization renderer suites passed. These checks establish the scoped lifecycle and anchoring repairs; occasional slow frames and installed-app acceptance remain separate.

## Limits and remaining verification

Frame timings are directional. Offscreen Chromium, virtual-list measurement warmup, iframe startup and unrelated machine load are confounders; these numbers do not establish a live-app FPS or total CPU/RAM improvement. A bounded cache adds memory rather than claiming memory savings.

Same-frame reloads and React remounts are different. Eligible, unexpired parked frames now survive genuine virtual-row unmounts; eviction, changed source or an engine without atomic moves can still recreate a document. Do not claim every prompt-triggered flash is resolved from this fixture alone. The user's exact prompt submission in an updated installed renderer remains a separate acceptance check.

The independent reviewer was attempted twice but cancelled by the agent runner before producing findings. No independent audit is claimed. No user app was restarted. The dependency patch must be included in the running renderer's dependency bundle; already-built or prebundled code is not updated merely by changing its source on disk.

Reference: [MDN `Element.moveBefore`](https://developer.mozilla.org/en-US/docs/Web/API/Element/moveBefore), including iframe-state preservation and same-document constraints.
