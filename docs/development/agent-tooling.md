# Shared agent tooling

`full-send` owns implementation through meaningful verification and the authorized finish. `zyra-tools` documents the connected browser, Chrome and Windows tools. Both are maintained under `skills/` and discovered by Zyra as built-in skills.

## Personal installation

Run `node scripts/install-agent-tooling.mjs` from this checkout. It links both skills into the shared Agent Skills folder and the personal Codex, Pi and Zyra skill directories. Existing unmanaged files are preserved. The Pi extension is installed in its normal extension discovery directory; no Pi package is added to Zyra.

The default Pi connection matches `zyra-dev` and Desktop's development profile. Use `--state-directory <path> --channel <name>` to connect a different Zyra instance. Connection configuration contains no credential. The adapter reads the existing local server discovery descriptor through Zyra's client and never receives the Desktop authority proof.

Pi `/reload` discovers the extension and skills. A fresh Codex session discovers new skills. Zyra exposes them through its usual skill resource discovery/reload. A running older server must be activated to expose the new gateway methods; installation never restarts user apps or upgrades a live service automatically.

## Tool gateway

The agent-server protocol exposes `tools.status`, `tools.open`, `tools.control` and `tools.close`. Pi uses Zyra's existing tool definitions and formats observations/screenshots as normal Pi tool results. Browser and computer schemas load on demand through `browser_use` and `zyra_tool_search`; unrelated tools remain active.

An external tool turn uses a client-owned identity and a canonical tool-verification chat. Desktop can resolve that chat for existing approvals. The verification chat contains metadata rather than a copy of Pi's conversation; no generation worker is started. One chat is reused across turns, with a new control principal for each turn. Cancellation, turn end and disconnect cancel outstanding calls and notify Desktop to revoke that principal. Active external turns prevent automatic service retirement.

The Desktop host and paired Chrome extension remain prerequisites. The default detached path preserves supervised control approval. It does not inherit a random Desktop chat's Full-access mode. Native computer actions can focus windows; a hidden-only task must use an allowed hidden fixture instead.

## Attention and checkpoints

Pi exposes `full_send_notify` and alerts when its `ask_user` tool is invoked in an interactive UI. Duplicate alerts are suppressed. Windows delivery depends on OS notification settings; requesting a balloon is not confirmation that the user received it. Headless children do not raise notifications.

The Full Send task helper writes private records below the current project's `.zyra/agent-runs/full-send/`. Verification requires evidence and completion refuses pending gates. These records are agent-maintained checkpoints, not a user task board.

## Focused verification

- `node scripts/test-external-tools.mjs`: real protocol transport with a synthetic Desktop driver, ownership, screenshot bytes, cancellation, timeouts and reconnect cleanup.
- `node scripts/test-external-tools-catalog.mjs`: persisted canonical verification chat, Desktop discovery, turn reuse and separate child identity.
- `node scripts/test-pi-tool-adapter.mjs`: registration, deferred schemas, tool results, attention and turn cleanup.
- `node scripts/test-full-send-task-state.mjs`: persistent evidence and completion gates.
- `bun desktop/scripts/test-canonical-chat-availability.ts`: first-call synchronization and stable routing when a verification chat is opened.
- `bun desktop/scripts/test-external-tools-broker.ts`: Pi tool definitions through the real server and Desktop permission broker using a synthetic target.
- `node scripts/test-installed-agent-tooling.mjs [installed-pi-package-root]`: optional local installation check using Pi's bundled SDK, without a model request.

These checks do not prove real Windows/Chrome control or OS notification delivery. Those require an activated Desktop host and an authorized target.

## Offline tool-log benchmarks

`npm run test:tool-log-benchmark` covers action-label validation, compact fleet responses and the offline replay analyzer. Action labels accept bounded generated text and retain a 72-character display limit. Fleet JSON removes formatting whitespace while preserving values and the existing output budget.

`scripts/benchmark-chat-tools.mjs` consumes a private frozen corpus and a pre-change schema snapshot:

```sh
node scripts/benchmark-chat-tools.mjs --corpus <private-corpus.json> --baseline <private-baseline.json> --out <private-report.json>
```

The corpus is `{version:1, selection:"description", sessions:[{path:"absolute-session.jsonl", bytes:1234}]}`. Freeze each source's byte length before a run. The baseline is `{actionBatchSchema:<pre-change tool parameter schema>}`. Keep both files under ignored `docs.local/`. The reader streams only the frozen prefix, records its SHA-256, deduplicates inherited tool-call/result IDs and separates text from image data. Reports contain counts, sizes and validation outcomes, without chat text, arguments, file paths, model reasoning or tool output. Source logs are never written, and historical external tools are never executed.

The replay validates recorded action-label arguments against both schemas and passes recorded JSON values through the current local fleet serializer. It cannot establish model accuracy, end-to-end task success, token savings or future subscription cost. Errors and incomplete/non-JSON responses remain explicit exclusions from the serialization comparison.

Desktop `npm run test:tool-discovery` checks current and historical loader names, both display modes, lifecycle states and real hidden Electron rendering at desktop and narrow widths. Discovery rows have no details control, lazy hydration or payload rendering. Real control actions retain their details. Android uses the same plain-row rule; the focused JVM targets are `WorkActionsTest` and `WorkSegmentsTest`.
