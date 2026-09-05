# Model catalog presentation

## Source and scope

The Pi model runtime supplies built-in and configured model entries. Zyra's runtime availability checks filter that catalog; `listAvailableModels` projects provider-qualified IDs, labels, descriptions, supported efforts, and context windows into the Desktop/Browser model list.

A local Pi `models.json` entry can register a model before the provider catalog includes it. There is no supported `latest` flag in that config. Adding a model does not verify account access; availability checks remain responsible for that.

## Ordering and the Latest badge

`src/model-order.mjs` is the shared presentation policy used by the runtime model list, fleet catalog, and Desktop/Browser composer. Its declaration file keeps renderer imports typed without maintaining a second implementation.

- Runtime entries use separate `provider` and `id` fields; UI entries use `provider/id`. Both forms receive the same order.
- GPT versions compare numerically, including future major, minor, and patch versions. Display labels are never parsed as release metadata.
- Existing documented GPT-5.6 tier preferences remain tie-breakers within that version. They do not pin the latest release. Other versions put full-size variants ahead of mini/spark variants, keeping catalog order for remaining ties.
- Identical model IDs prefer the existing `openai-codex` route over `openai`.
- The composer badges the highest versioned GPT entry in its supplied list. This is a catalog-relative label, not a claim about global release chronology, account entitlement, or model quality.
- Unknown model families keep their catalog order and receive no speculative Latest badge. Supporting another version convention requires an explicit parser and tests, not a label substring check.
- Search filters results without reassigning the badge to an older visible result.
- The UI never inserts a fixed “latest” model missing from its input. The existing selected-model fallback while the catalog is unavailable is retained.
- Catalog changes affect presentation only. They do not switch an established Chat's selected model or rewrite defaults.

Desktop and the local Browser application use the same composer implementation. Keep its badge and ordering logic free of release-specific model IDs.

## Regression checks

```bash
node scripts/test-model-order.mjs
cd desktop
bun scripts/test-assistant-model-catalog.tsx
bun scripts/test-assistant-startup-connection.ts
```

The ordering suite runs in the quick/core gates. The composer suite runs in the Desktop gate and covers the real hooks and rendered picker rows in both composer layouts. Fixtures include an illustrative future release to prevent a new hardcoded “latest” model from passing unnoticed.
