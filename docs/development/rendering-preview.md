# Chat rendering preview

Run from `desktop`:

```powershell
node node_modules/vite/bin/vite.js --config scripts/providers-review.config.ts --port 5184 --strictPort
```

Open `http://127.0.0.1:5184/rendering-review.html`. It uses production chart, Mermaid, plugin activity and virtual chat timeline components with fictional local data. It never signs in, sends requests to providers or touches installed-app threads. Chat labels and settlement changes are intentionally absent from this preview.

The Streaming section has **Replay diagram**, **Replay visualization** and **Replay response**. Mermaid stays on a dotted **Creating diagram** canvas while its fence is incomplete; visualization HTML uses a distinct **Creating visualization** chart panel until its tag closes. Finished content shows **Loading diagram** or **Loading visualization** while the renderer prepares it. Creating and loading labels shimmer with fixed-width dots cycling 3, 2, 1, 2, 3; app and OS reduced-motion settings disable the motion. The response replay sends paragraph deltas through the production streaming Markdown renderer and virtual timeline. Scroll upward while it runs to release bottom-follow. The inline and expanded Mermaid canvases use the same dotted grid; the expanded viewer supports drag, zoom, fit and keyboard navigation.

With the preview server running:

```powershell
node scripts/test-rendering-review.mjs ../docs.local/reviews/plugins-ui-review
bun scripts/test-streaming-mermaid.ts
node scripts/test-visualization-renderer.mjs
node scripts/test-visualization-renderer.mjs --extension
```

The first check launches an isolated Electron renderer and exercises chart compactness, both diagram grids, expanded sizing/zoom/fit/physical drag/focus restoration, plugin icons and structured results, partial-fence streaming, animated bottom-follow, manual release and completion. Screenshots go to the supplied directory. The visualization fixtures separately use the real renderer and MV3 sandbox CSPs and verify sanitization, scriptless exports, fonts, stable gutters, animated disclosures and point tooltips. The scroll benchmark verifies retained iframe state and bounded sanitizer caching.

These checks use simulated events and local test data. They do not prove that the installed desktop app or a running agent server has loaded the changes. On the next update, restart the agent server before testing the pending server-side changes and optimizations.
