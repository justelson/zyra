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

`VisualizationPreview` renders a separate `srcdoc` document, not HTML inside the app DOM. Defense in depth:

- DOMPurify uses explicit HTML/SVG tag and attribute allowlists.
- Scripts, event handlers, frames, forms, embedded objects, SVG foreign content/animation, and refresh metadata are removed.
- Links are restricted to local fragments; images to embedded base64 PNG/JPEG/GIF/WebP data.
- The document CSP denies network, scripts, fonts, frames, forms, objects, and base URLs. Inline CSS and raster data images are the only resource exceptions.
- An empty iframe sandbox grants neither scripts nor same-origin access. There is no app IPC, postMessage command bridge, filesystem access, popup permission, or external navigation action.
- The parent app CSP is unchanged.

This is not an arbitrary JavaScript app runner. Native HTML disclosures can provide limited interaction. A later interactive-runtime proposal needs its own security design rather than adding sandbox permissions to this renderer.

## Theme and controls

The frame receives the surface background, foreground, muted text, accent, border and font. CSS variables are `--viz-bg`, `--viz-text`, `--viz-muted`, `--viz-accent`, and `--viz-border`. App theme events and root/body attribute changes update existing previews. Authored color overrides remain intact.

Previews sit directly in the message without an enclosing card, border, padding or background. The iframe uses the matching color scheme so its transparent canvas blends into the chat. An options button beside the title opens a keyboard-accessible menu with exactly Copy HTML and Download HTML. The description is also available to assistive technology on the iframe. In regular assistant replies, the message timestamp sits beside each completed visualization's options button. Text following a visualization gets the same message timestamp at the end of its text segment. A reply ending in a visualization does not repeat the timestamp below it; copy and elapsed-time controls remain available. Plain-text replies keep their existing timestamp placement.

The preview keeps its authored height. There are no expand/collapse controls or source dialog. Copy HTML and Download HTML export the same sanitized, self-contained document with the same restrictive CSP and a snapshot of the current theme. The menu supports arrows, Escape and focus return. Standalone exports keep their page background and padding; they never save raw active content.

## Browser and Chrome extension

The ordinary browser client and Chrome sidebar import the same `App` and assistant-message renderer as Desktop. They use the same visualization parser, sanitizer, cache, timestamps and opaque iframe sandbox. No separate HTML-rendering implementation or relaxed extension policy is needed. Browser adapters omit Desktop-native overlay methods, and the HTTP bridge rejects them. The two-action options menu uses an in-page portal on every client, not a Desktop-owned companion window.

`test:browser-surface-parity` checks the browser dev server's real shared-parser import and runs the preview fixture from an isolated `chrome-extension:` page using the extension manifest's CSP. It also verifies font bytes survive the HTTP bridge and load through `FontFace`, and exercises the extension settings disclosure. These checks do not refresh an already-built browser/extension bundle or the installed Desktop process.

## Scroll lifecycle

Completed previews reserve their requested height before the iframe is ready. The document builder caches only immutable sanitized HTML, with an LRU limit of 48 entries and 2 MiB of estimated string payload. Theme, title and export styling remain fresh. The cache does not retain additional iframe instances or change the sandbox.

The pinned LegendList web patch uses state-preserving DOM moves when supported, so sorting existing rows does not reload their embedded previews. Its older-engine fallback preserves the original ordering behavior. True virtual-row unmounts still recreate frames. See [performance measurements and verification limits](../development/visualization-performance.md).

## Terminal

The TUI shares the parser. It shows the title, summary and a note to view the rendered block in Zyra chat. It suppresses raw HTML during streaming and marks stopped or historical incomplete blocks correctly. There is no terminal open-preview command in this version. Agents must supply a summary that remains useful without the graphic.

## Verification

- `npm run test:visualizations`: parser prefixes/literal examples/limits, actual TUI output, skill discovery and distribution paths.
- `npm --prefix desktop run test:visualizations`: isolated Electron with the real parent CSP, sanitization, source suppression, cancellation, theme changes, two-action keyboard/focus behavior and copy/download-document safety, opaque-origin isolation, blocked scripts and zero external requests; plus actual assistant Markdown routing/cache checks.
- `node desktop/scripts/test-runtime-source-imports.mjs`: runtime manifest and import-boundary validation.

These fixtures do not prove that an already-running installed app or agent server has loaded the new code. No production build, restart, or deployment is implicit in these checks.
