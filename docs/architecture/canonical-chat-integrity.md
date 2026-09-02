# Canonical chat integrity

Zyra Desktop and the TUI share one canonical Pi transcript per chat. A client may keep local read models for fast rendering, but those models do not replace the JSONL transcript.

The draft [voice-agent architecture](voice-agent/README.md) applies the same rule to finalized speech, typed text, and image-backed messages. Physical realtime session IDs and provisional transcript deltas remain non-canonical transport/presentation identities.

Its optional [Phase Two relationship profile](voice-agent/relationship-first-interaction.md) groups a distinguished Zyra Home conversation and work-thread conversations under one relationship index. Every Home/thread message still belongs to one canonical Pi transcript. Cross-thread Home controller activity receipts reference source IDs and watermarks rather than copying the detailed transcript or creating route-less assistant messages; selecting or disabling the profile never merges or rewrites JSONL.

## Identity, storage, and metadata

These concerns are separate:

- **Canonical chat ID** — the Pi session ID. It is stable across Desktop and TUI.
- **Transcript storage path** — the physical JSONL file. Project/title edits never move it.
- **Project metadata** — the folder future turns use as their cwd.
- **Title metadata** — the shared display title.
- **Desktop local ID** — a compatibility key for Desktop SQLite and IPC.
- **Phase Two relationship/work-thread ID** — additive controller metadata pointing to canonical chat IDs; never a replacement chat ID or provider thread ID.

`src/agent-server/catalog.mjs` stores aliases, mutable project/title metadata, and known physical session roots. `src/agent-server/chat-index.mjs` indexes JSONL files by canonical ID and physical path.

## Incremental transcript index

`chat-index-v2.json` stores file size, mtime, scan offset, line offsets, counts, and bounded private inference evidence. Unchanged files are not parsed again. Appended bytes are parsed from the previous offset. History reads use indexed byte ranges and a backward cursor:

- `startCursor` / `endCursor` identify the raw entry range.
- `oldestCursor` requests the previous page.
- `hasOlder` indicates whether another page exists.

The public catalog excludes first-message text, title candidates, path evidence, and byte offsets.

## Server-owned runtime and presence

The agent server owns the live worker. Desktop and TUI attach as projections:

- repeated client requests reuse an existing attachment;
- switching chat/thread detaches the previous Desktop projection;
- disconnecting a projection does not kill active server work;
- the server reports attached surfaces, active turn ID, background-work state, and latest sequence;
- Desktop shows a remote-surface badge and TUI `/session` shows state plus attached surfaces;
- replay includes durable metadata, provider events, and turn completion;
- the Desktop replay cursor records the highest server event actually projected locally; catalog presence keeps a separate observed high-water mark and cannot acknowledge unseen events.

Project/title updates are broadcast as canonical metadata. Resume prefers stored canonical project/cwd/title over the launching terminal's folder.

## Client projections

### Desktop

Desktop loads shell metadata eagerly. Canonical transcript detail is imported only when a thread is opened, 500 raw entries at a time. Asking for older history imports one earlier page. The first local page may paint before canonical reconciliation; when reconciliation changes the revision, Desktop rehydrates pagination, preserves any already-loaded older range, and retries one revision-rejected upward request.

Canonical fleet snapshots follow the same recovery rule: a late attachment receives the latest full snapshot, explicit Inspector refresh can query the live fleet, and lower-sequence empty snapshots cannot erase newer persisted agents.

Projection preserves:

- user, assistant, and system text;
- tool calls and tool results as activities;
- thinking/reasoning;
- assistant and tool errors;
- compaction markers;
- stable source IDs, timestamps, and timeline order;
- images. User images are materialized lazily under the local `assistant/canonical-media/` cache so Desktop can render them.

The canonical JSONL remains authoritative when a Desktop activity payload must be compacted for SQLite size limits.

### TUI

Resume replays the latest canonical page before input starts. `/older` loads another page. Images appear as medium-appropriate `[Image N: mime/type]` tags. `/session` displays the stable thread ID and `/session copy` copies it with OSC 52.

## Local full-text search projection

Desktop derives a range-candidate FTS5 projection over fixed global buckets of at most 128 durable message row IDs plus an exact per-message FTS5 projection keyed by bucket and archive scope. They index final user messages and only the assistant message owned by a durable turn, with a 16,384-character per-message ceiling; exact results are revalidated against canonical rows. Streaming/provisional output, activities, terminal output, system content, and private reasoning stay outside the indexes. Existing rows backfill in immediately searchable 400-message batches. SQLite triggers enqueue deduplicated dirty bucket/session identities; the search worker owns projection rebuilds for inserts, canonical completion, ownership changes, archive changes, and deletions.

Search runs through a read-only worker connection and returns bounded excerpts with canonical session, thread, and message IDs. Selecting an excerpt reads a small page around that message and focuses it in the virtual timeline; it never hydrates the full transcript. The complete contract is [ADR-0012](../adr/0012-use-a-derived-fts-projection-for-local-chat-search.md).

## File-index boundary

Chat project metadata may legitimately remain the user home folder, but the source-file index does not recursively crawl home, app-data, or drive roots. It indexes explicit project roots only, refreshes only roots already registered, caps depth/entry count, skips generated directories, and quietly ignores inaccessible entries or malformed package metadata.

## Recovery and migration

`npm run chat:migration-report` is read-only. It reads the verified SQLite snapshot and canonical JSONLs, then writes a dry-run report beside the backup. `--generate-ai-titles` asks the utility runtime for titles only for weak/default-title chats.

`npm run chat:migration-apply -- ...` is fail-closed:

1. require an exact confirmation token;
2. verify that the source snapshot SHA-256 still matches the dry-run report;
3. refuse while the agent server is alive or Desktop persistence was recently active;
4. create an online SQLite backup and run `PRAGMA quick_check`;
5. reconstruct missing canonical transcripts additively from preserved Desktop messages/activities;
6. update Desktop SQLite in one transaction;
7. atomically update catalog metadata;
8. verify database, catalog, and recovered transcript hashes;
9. write a migration manifest beside the backup.

The apply script does not terminate Desktop/Zyra and does not delete or move an existing transcript.
