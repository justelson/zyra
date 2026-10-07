# Inline visualizations

Agents can read the built-in `skills/visualize/SKILL.md` when a visual explanation is useful. The core and Desktop prompts advertise the capability without requiring a user command. The skill is included in npm files and the staged Desktop runtime. Existing running agents still need their normal prompt/resource refresh to discover newly installed skills.

## Message format

```html
<visualization title="Chart title" summary="A useful text equivalent." height="320">
<!-- Self-contained HTML, CSS and SVG. -->
</visualization>
```

The opening and closing tags occupy separate lines. Attribute values are quoted. Title and summary are text; height is clamped to 160 to 640 pixels. Blocks remain part of the original assistant text, so persisted conversations need no schema migration. Assistant message rendering recognizes the format in new and existing threads. User messages and ordinary fenced/indented examples do not opt into previews.

The shared parser in `src/visualizations/blocks.mjs` separates Markdown from visualization blocks before streaming Markdown is split into paragraphs. Partial opening tags and unfinished blocks show a compact creation state. Only complete blocks reach the iframe. Ended or interrupted responses show an incomplete state instead of an endless spinner. HTML is limited to 64 KiB per block; the UI renders at most eight previews per message.

## Rendering and trust boundary

`VisualizationPreview` loads the app-owned `visualization-frame.html` in an opaque iframe. The parent sends the sanitized document after the frame's ready handshake. Defense in depth:

- DOMPurify uses explicit HTML/SVG tag and attribute allowlists.
- Scripts, event handlers, frames, forms, embedded objects, SVG foreign content/animation, and refresh metadata are removed.
- Links are restricted to local fragments; images to embedded base64 PNG/JPEG/GIF/WebP data.
- The frame CSP denies network, frames, forms, objects and base URLs. Its script policy contains only the SHA-256 hash of the app-owned presentation helper. Authored scripts and handlers cannot run. Inline CSS, raster data images and app-owned embedded fonts remain supported; the sanitizer removes authored font-face/import rules, including nested rules, while preserving explicit font-family choices.
- `sandbox="allow-scripts"` lets that trusted helper measure content, animate disclosures and display point tooltips; it grants no same-origin access, app IPC, filesystem access, popup permission or external navigation action. Initialization accepts only the parent, once. Height messages must match the exact frame, opaque origin and channel. Copy/download documents remain scriptless with `script-src 'none'`.
- The parent app CSP adds only `data:` to `font-src`, permitting the trusted embedded font through the iframe's inherited policy. Other directives remain unchanged.

The helper exposes only presentation behavior over sanitized markup. Agent-authored JavaScript remains unsupported; broader interactive applications require a separate security design.

## Theme and controls

The frame receives the surface background, foreground, muted text, accent, border and font. CSS variables are `--viz-bg`, `--viz-text`, `--viz-muted`, `--viz-accent`, and `--viz-border`. A separate theme-aware chart palette exposes `--viz-series-1` through `--viz-series-6` (purple, teal, amber, rose, blue, lime), `--viz-on-series` for labels inside those marks, and `--viz-track` for quiet bar tracks. `--viz-heat-low` and `--viz-heat-high` provide a monotonic heatmap ramp with readable normal foreground text in the default light/dark themes. Category colors remain stable when the app accent changes. App theme events and root/body attribute changes update existing previews. Authored color overrides remain intact.

The built-in skill guides future generation toward aligned bars, visible values/units, vivid category colors and readable heatmaps. The renderer supplies tokens; it does not reinterpret data or recolor arbitrary authored charts. Existing hardcoded colors retain their appearance. Inline previews and standalone exports share the same palette snapshot, sanitization cache and restrictions on authored content. Exports have no presentation script.

The default visualization font follows the active app UI family. The appearance loader loads bundled Bricolage/Hanken assets or existing managed font bytes once and retains an immutable serialized resource beside the loaded FontFaces. A family filter selects only the active matching resource, and font-load/removal events update existing previews. Theme comparisons use scalar/resource-reference equality rather than serializing font bytes. Preview, Copy HTML and Download HTML share that resource through the document builder; they do not perform additional font IPC reads. Parent CSP allows data fonts so its inherited policy permits the trusted iframe resource; the child still denies network and scripts. An explicit authored font-family takes precedence. Local/system families use fonts installed on the viewing computer and are not extracted or embedded.

Previews sit directly in the message without an enclosing card, border, padding or background. The iframe uses the matching color scheme so its transparent canvas blends into the chat. Title stays left; timestamp and vertical options button sit at the right. The keyboard-accessible menu contains exactly Copy HTML and Download HTML. The description is also available to assistive technology on the iframe. Text following a visualization gets the same message timestamp at the end of its text segment. A reply ending in a visualization does not repeat the timestamp below it; copy and elapsed-time controls remain available. Plain-text replies keep their existing timestamp placement.

The preview fits its measured content up to the authored height maximum. A stable scrollbar gutter reserves space even when the scrollbar is unnecessary. Full-width details summaries animate open and closed, with bounded settling for offscreen frames. Chart marks labeled with `data-viz-tooltip`, SVG title or an accessible label expose floating values on hover and keyboard focus. Captions use compact spacing. Copy HTML and Download HTML export the same sanitized, scriptless document and theme snapshot; the menu supports arrows, Escape and focus return. Standalone exports keep their page background and padding; they never save raw active content.

## Browser and Chrome extension

The ordinary browser client and Chrome sidebar import the same `App` and assistant-message renderer as Desktop. Their Vite builds emit the same trusted frame. MV3 registers it as a sandbox page with no extension API access; its hash CSP restricts scripts to the same helper. The parent extension-page CSP is unchanged. Browser adapters omit Desktop-native overlay methods, and the HTTP bridge rejects them. The two-action options menu uses an in-page portal on every client, not a Desktop-owned companion window.

`test:browser-surface-parity` checks the browser dev server's real shared-parser import and runs the preview fixture from an isolated `chrome-extension:` page using the extension manifest's CSP. It also verifies font bytes survive the HTTP bridge and load through `FontFace`, and exercises the extension settings disclosure. These checks do not refresh an already-built browser/extension bundle or the installed Desktop process.

## Scroll lifecycle

Completed previews reserve their requested height before the iframe is ready. The document builder caches only immutable sanitized HTML, with an LRU limit of 48 entries and 2 MiB of estimated string payload. Theme, title and export styling remain fresh. The cache does not retain additional iframe instances or change the sandbox.

The pinned LegendList web patch uses state-preserving DOM moves when supported, so sorting existing rows does not reload their embedded previews. Its older-engine fallback preserves the original ordering behavior. True virtual-row unmounts still recreate frames. See [performance measurements and verification limits](../development/visualization-performance.md).

## Terminal

The TUI shares the parser. It shows the title, summary and a note to view the rendered block in Zyra chat. It suppresses raw HTML during streaming and marks stopped or historical incomplete blocks correctly. There is no terminal open-preview command in this version. Agents must supply a summary that remains useful without the graphic.

## Verification

- `npm run test:visualizations`: parser prefixes/literal examples/limits, actual TUI output, skill discovery and distribution paths.
- `npm --prefix desktop run test:visualizations`: trusted font serialization and descriptor validation; palette contrast across all heatmap percentages; isolated Electron with the real parent CSP, actual decoded bundled/managed font glyphs in inline and exported documents, explicit family overrides, painted chart pixels, data geometry, dark/light and 320px layout, sanitization, source suppression, cancellation, theme changes, two-action keyboard/focus behavior and copy/download-document safety, opaque-origin isolation, blocked scripts and zero external requests; plus actual assistant Markdown routing/cache checks.
- `node desktop/scripts/test-runtime-source-imports.mjs`: runtime manifest and import-boundary validation.

These fixtures do not prove that an already-running installed app or agent server has loaded the new code. No production build, restart, or deployment is implicit in these checks.
