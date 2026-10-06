---
name: visualize
description: Create full-width, themed inline HTML/CSS/SVG visualizations in Zyra chat, with native view/data toggles, collapsed supporting details and optional motion. Use proactively when charts, comparisons, diagrams, timelines or visual explanations help. Users need not name the skill. Prefer plain text for simple answers.
---

# Visualize in chat

Use a visualization when it communicates something that prose would make harder to see. Do not decorate every reply. Use real data, label illustrative data, and never invent measurements. Optimize for reading a chat thread, not presenting a standalone dashboard.

## Message format

Emit this directly in an assistant response, outside code fences. The opening tag must occupy one line; the closing tag must occupy its own line. Put normal explanatory text before or after it.

```html
<visualization title="Delivery stages" summary="Research, build, and verify form three sequential stages." height="240">
<style>
.stages { display: flex; flex-wrap: wrap; gap: 12px; }
.stage { flex: 1 1 120px; border-top: 3px solid var(--viz-accent); padding-top: 12px; }
small { color: var(--viz-muted); }
</style>
<div class="stages" aria-label="Delivery stages">
  <div class="stage"><small>1</small><h3>Research</h3><p>Find the constraint.</p></div>
  <div class="stage"><small>2</small><h3>Build</h3><p>Make the smallest useful change.</p></div>
  <div class="stage"><small>3</small><h3>Verify</h3><p>Check the real behavior.</p></div>
</div>
</visualization>
```

- Always include a concise title and a meaningful plain-text summary. Quote attribute values; escape double quotes as `&quot;` and ampersands as `&amp;`.
- Optional height is a quoted pixel number between 160 and 640, default 320. The preview keeps this height. Its menu contains only Copy HTML and Download HTML.
- Use self-contained HTML, CSS, and SVG only. No JavaScript, event handlers, external images, libraries, imports, fonts, iframes, forms, file access, or network requests. Native `<details>` can reveal supporting explanations.
- Do not wrap a complete document in the tag. Supply body content and optional `<style>` rules.
- Keep HTML under 64 KiB and responses under eight visualization blocks. Prefer one focused visual.
- Ordinary HTML code fences remain code examples and will not render as visualizations.

## Theme and layout

Defaults follow the current chat surface, including later theme changes:

- `--viz-bg`: background
- `--viz-text`: primary text
- `--viz-muted`: secondary text
- `--viz-accent`: accent
- `--viz-border`: dividers

The default font also follows the app. Inline previews have no surrounding card or background. Let the visual sit on the page; do not add an enclosing card just to frame it. The title's options menu contains only Copy HTML and Download HTML. The summary remains available to assistive technology; include important context in the visible visual or surrounding text. Use explicit colors only when the subject requires them, such as a flag or series colors. Keep labels readable in light and dark themes. Use responsive SVG viewBoxes, flexible grids, wrapping labels, and compact legends. Prefer inline styles or locally named CSS classes; no fixed viewport-width layouts.

## Fit the chat thread

- Use the full message width by default: a fluid wrapper, `width:100%` for charts, flexible labels and wrapping controls. Do not add an arbitrary `max-width:640px`, fixed chart width, centered narrow column, or surrounding card. Exceptions are intrinsically sized objects such as a flag or icon, not data charts.
- Start with the answer and one useful visual. Do not repeat the title, headline number, legend and explanatory paragraph unless each adds information.
- Keep critical context visible, such as the unit, selected period and next reset. Put snapshot time, provenance, missing secondary windows, caveats and secondary counts inside a closed `<details><summary>Details</summary>...</details>` within the visualization. A caveat that changes the main conclusion must remain visible.
- Choose a compact height that fits the main content. Details can use the frame's scrolling; there is no Expand action. Do not reserve a tall blank region for hidden content. The iframe does not automatically resize to disclosures.
- Keep visualizations self-contained and lightweight. Prefer one small chart to several duplicate panels. Avoid large precomputed state combinations, rasterized charts, repeated styles across many blocks and decorative effects. The 64 KiB limit is a ceiling, not a target.

## Useful interactions without scripts

When the user wants controls, author them inside the visualization. The runtime supplies Copy HTML and Download HTML, not a universal chart toolbar.

- Native `<details>` and `<summary>` work with mouse, touch and keyboard. CSS `[open]` sibling selectors or `:has()` can switch the visible representation, selected measure or included data. Give the summary a clear, current-state label and keep its focus indicator.
- Offer only useful choices, for example Bar / Ring, Remaining / Used, or Summary / Table. Switching the representation must preserve the selected data and scale. Switching a measure must update its number, label and geometry together.
- The choice must have a real effect. Do not render pretend buttons, tabs, filters, refresh actions or motion switches. Form controls, buttons, scripts and event handlers are not supported by this sanitizer. Do not relax the sandbox to make an authored chart interactive.
- Toggles choose between values already present in the verified snapshot. They cannot fetch new data, refresh a subscription, change an account or persist preferences. Never imply otherwise.
- Prefer one or two controls for a simple chart. Add a motion control when requested or when a transition materially benefits from a user choice. Collapse additional settings rather than building a permanent toolbar of options.
- Keep every view accessible: visible values and units, meaningful SVG labels, keyboard-operable summaries and an understandable static fallback. CSS-hidden alternative views should not duplicate the visible accessible content. Do not hardcode `aria-expanded`; native details owns that state.

A native data-toggle pattern, using explicitly illustrative values:

```html
<style>
.example-used, .example-measure[open] .example-current-remaining { display: none; }
.example-measure[open] .example-used { display: inline; }
.example-fill { width: 75%; height: 100%; background: var(--viz-accent); }
.example-measure[open] ~ .example-chart .example-fill { width: 25%; }
.example-measure[open] ~ .example-chart .example-current-remaining { display: none; }
.example-measure[open] ~ .example-chart .example-used { display: inline; }
.example-measure summary { cursor: pointer; }
.example-measure summary:focus-visible { outline: 2px solid var(--viz-accent); outline-offset: 3px; }
</style>
<details class="example-measure">
  <summary>Measure: <span class="example-current-remaining">remaining</span><span class="example-used">used</span></summary>
</details>
<div class="example-chart">
  <p><span class="example-current-remaining">75% remaining</span><span class="example-used">25% used</span> · illustrative data</p>
  <div style="width:100%;height:10px;background:var(--viz-border)" aria-hidden="true"><div class="example-fill"></div></div>
</div>
```

## Motion on changes

- Default to no motion. Never animate indefinitely or on every mount, scroll, theme change or streamed token.
- If the user enables motion, use brief CSS transitions on actual changing geometry, such as fill width or stroke dash offset. Keep representation changes to a short fade. Do not bounce, spin or grow the enclosing visual.
- A motion toggle must actually enable and disable these transitions. For example, `.motion[open] ~ .chart .fill { transition: width 180ms ease-out; }`, with no transition on the default rule.
- Always honor `prefers-reduced-motion: reduce`, even when the local toggle is on. Zyra enforces this too. Make the label clear if the system setting overrides the toggle.
- Never fetch libraries, create a video, start a render server or load a motion framework for a chart transition.

## Retrieve the actual data first

Use an existing authorized, read-only account/API helper before attempting UI automation when one is available. If a UI lookup fails, do not claim all retrieval paths are unavailable. Inspect the supported direct path before asking the user to transcribe data. Return only the needed usage fields, not credentials or unrelated account identifiers. Do not redeem reset credits or change subscription settings to obtain usage information.

Distinguish remaining from used, state the window and units, and preserve the actual source timestamp. Missing windows are unknown, not zero or unlimited. Keep this supporting provenance in Details. An existing visualization is a snapshot; changing a view does not make its data live.

## Streaming and other surfaces

Zyra displays a small creation placeholder until the closing tag arrives. It never executes partial HTML. An interrupted block becomes an incomplete state when the response finishes. Completed blocks in existing threads use the same renderer; no new conversation is required.

The terminal shows the title and summary instead of HTML. It tells the user to view the rendered block in Zyra chat. There is not yet a terminal open-preview command. Make the summary useful without seeing the graphic.

Rendering is not proof of visual correctness. Do not claim you inspected a preview unless you actually did. If the running app predates visualization support, explain that the snippet requires the updated renderer. Do not restart the user's app without permission.
