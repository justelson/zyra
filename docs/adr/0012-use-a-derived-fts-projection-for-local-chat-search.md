# ADR-0012: Use a derived FTS projection for local chat search

- **Status:** Accepted and implemented
- **Date:** 2026-08-31

## Context

Zyra needs global message search across long-lived local chat history. The canonical Assistant tables already own durable messages, turns, sessions, archive state, and deletion. Loading that history into the renderer or scanning it with an unindexed `%LIKE%` query would make search cost grow with the full database and could stall Electron main.

Search results must also respect canonical chat identity. Streaming deltas, provisional output, raw tool/terminal activity, private reasoning, and assistant text that is not the final message owned by a durable turn cannot become searchable content.

The packaged Electron runtime includes SQLite FTS5. The `sql.js` compatibility runtime used by some tests does not.

## Decision

Use two rebuildable SQLite FTS5 projections. `assistant_search_bucket_search` stores fixed global buckets of 128 canonical message rows, split into active and archived scope rows, for fast range-stratified candidates. `assistant_message_search` stores eligible messages individually with bucket and scope keys so exact lookup cannot confuse terms from different messages. Exact identity, eligibility, ranking, and excerpts are revalidated against canonical rows. No projection value grows with the lifetime of a chat.

- User messages become eligible after durable persistence with `streaming = 0`.
- Assistant messages become eligible only when a durable turn identifies them as its final `assistant_message_id` and the message is no longer streaming.
- Indexed message text is capped at 16,384 characters, and each candidate bucket spans at most 128 message row IDs, capping a worst-case candidate value near 2 MiB while keeping exact-navigation payloads bounded.
- SQLite triggers only enqueue deduplicated dirty bucket or session identities. The worker rebuilds affected projection rows, avoiding history-sized synchronous FTS work on Electron main.
- Existing messages are backfilled in resumable 400-row background batches. Every committed batch is immediately searchable and reports that older chats are still indexing.
- The Assistant canonical tables remain authoritative. FTS metadata is versioned separately and the projection can be dropped and rebuilt.
- A dedicated `node:worker_threads` worker owns the read-only search connection, write-side backfill, dirty-bucket refresh, and exact-message fallback. A search refreshes a bounded dirty set before reading; Electron main performs bounded message dispatch rather than synchronous FTS work.
- Queries require two characters, are capped at 200 characters, use full-detail quoted FTS terms with prefix matching, and return at most 50 results. Scoped buckets are sampled across two ranges and canonical candidates are capped at 300 rows. Exact per-message validation rejects cross-message bucket matches; when a multi-token sample contains any cross-message-only bucket, the worker merges exact message documents from both ranges. Phrase/proximity, role, and recency ranking returns one result per session.
- Results contain one bounded 240-character excerpt per session plus canonical `sessionId`, `threadId`, and `messageId` identities.
- Active chats are the default scope. `is:archived` and `is:all` are explicit query scopes.
- Exact-message navigation revalidates the same canonical user/final-assistant predicate, requests a bounded history page, collapses an oversized turn to the target message, then asks the virtual timeline to center, focus, and briefly highlight it.
- Environments without FTS5 use a compatibility scan bounded to the 5,000 most recent durable message rows. That fallback is not the packaged Desktop architecture.

## Consequences

- Search cost is isolated from the renderer and Electron main, and result payloads stay bounded.
- Search can be useful while migration continues without blocking startup or streaming turns.
- The two derived indexes trade additional local disk space for bounded candidates, exact same-message matching, and one idle search worker with a small process-memory cost.
- Very broad terms use a bounded, range-stratified bucket sample before canonical per-message ranking, with exact-message fallback for false-positive bucket samples. A long-lived chat adds fixed-size buckets instead of repeatedly rebuilding one full-history aggregate.
- Deleting a message, changing final-message ownership, or deleting canonical turn ownership removes assistant text from the projection.
- A stale result can fail between search and selection. The UI reports that the result is no longer available rather than hydrating unrelated history.

## Alternatives considered

### Full-table `%LIKE%`

Rejected for packaged Desktop because a result limit does not bound rows scanned and latency grows with total history.

### Hydrate all messages into the renderer

Rejected because it duplicates persistence authority, increases memory, crosses privacy boundaries unnecessarily, and conflicts with bounded history hydration.

### Make the FTS table canonical storage

Rejected because search tokenization and projection schema must be replaceable without changing chat durability or identity.

### Run FTS synchronously on Electron main

Rejected because `node:sqlite` is synchronous even when the underlying query is fast.

## Verification

- `desktop/scripts/test-assistant-chat-search.ts` covers query parsing, partial resumable backfill, canonical assistant eligibility, punctuation-heavy technical queries, streaming completion, deletion, fallback bounds, archive scope, FTS worker results, and bounded history anchoring.
- `desktop/scripts/test-assistant-chat-routing.ts` covers stable exact-message routes and the renderer focus contract.
- `desktop/scripts/benchmark-assistant-chat-search.mjs` builds a 10,000-session / 1,000,000-message FTS fixture and enforces warm p95 under 50 ms, cold p95 under 200 ms, and Electron-main dispatch p95 under 2 ms.
