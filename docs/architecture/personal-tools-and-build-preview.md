# Personal tools and build previews

**Status: Coming soon / Planned product direction. Recorded 2026-10-13. Consumer-edition implementation has not started. No release date is committed.**

## Product direction

Zyra should help someone describe a need and receive useful software they can run on their own computer. A quick tool can remain temporary or become a saved personal tool they reopen and improve through conversation. Publishing online is optional.

Two experiences can share the underlying creation engine:

- **Developers:** lightweight frontend and UI experiments, working previews, iteration, source export, and deliberate integration into an existing project.
- **Everyday users:** a future consumer edition centered on conversation, useful results, and saved personal tools. Most developer-related functionality and terminology should be stripped out of this edition's user experience. Ordinary tasks should not require repositories, branches, terminals, package managers, compiler output, or deployment configuration.

The consumer edition remains useful for ordinary questions, study help, and everyday assistance. Generate an interactive tool when it serves the task: a study quiz from notes, revision planner, household tracker, calculator, or organizer for an uploaded file.

This direction preserves the developer edition and does not yet decide whether the consumer edition ships as a separate package. Existing [voice-agent product phases](voice-agent/product-phases.md) remain separate draft plans; their names and status are unchanged.

## Intended user journey

1. Describe a need, optionally supplying a file or example.
2. Zyra builds in a scoped local workspace, checks the result, and opens a usable tool. The agent handles supported build and repair work; progress and failures use ordinary language.
3. Use the tool and ask for changes in the same conversation.
4. Keep and name it, reopen it from a personal tools collection, and retain its data across restarts.
5. Later edits preserve existing data and the last working version. Failed changes have a recovery path.
6. Optionally choose **Share online** to create a web link others can open.

Candidate copy: **Open**, **Make changes**, **Keep this tool**, **Share online**. These are proposed actions, not implemented controls or a final layout.

The consumer proof must cover create, use, save, restart, reopen with data, change, and recover from a broken change. A temporary preview alone does not satisfy the personal-tool experience.

## Lightweight local execution

The intended experience requires no Docker setup or separate development machine. Explore a lightweight JavaScript/WebAssembly environment integrated with Zyra, with a defined supported capability set. Measure startup, memory, idle CPU, and concurrent-tool behavior before making efficiency claims.

`tsc-rs` is a candidate compiler/type-checker component. It does not supply the whole runtime, bundler, dependency system, persistence, or security boundary. Its suitability and WASM integration have not been validated in Zyra. Compare compatibility, maintenance, resources, and integration cost before selecting it.

Keep implementation responsibilities separate:

- Project storage and virtual workspaces for edits.
- Supported dependencies, bundling, and diagnostics.
- Isolated preview execution with controlled capabilities.
- Durable source, assets, user data, versions, and recovery.
- Agent feedback from diagnostics and actual interaction checks.
- A publishing adapter for supported online targets.

Generated tools must not inherit Zyra's privileged desktop bridge, arbitrary filesystem access, credentials, or unrestricted network access. Capabilities need scoped host mediation; an in-memory filesystem alone is not a security boundary.

Local tool execution does not imply local model inference or offline generation. Explain provider data use where relevant. Already-created tools without network dependencies should work offline; this needs verification.

## Optional online sharing

Explore Cloudflare-compatible publishing to the **user's own Cloudflare account**, not Zyra-owned Cloudflare projects. **Zyra Cloud** remains a separate future possibility, not a committed service or prerequisite.

Lead with **Share online** and explain the result in plain language. Introduce Cloudflare when explaining account connection, ownership, and any costs. A user should be able to create and keep local tools without knowing what Cloudflare is.

First-time setup still requires supported signup/authorization. Zyra should guide this and handle supported technical configuration after approval. Do not promise zero-setup one-click publishing until that first-run path is proven. Disclose costs before provisioning paid resources.

Sharing a tool and sharing its existing personal data are separate actions. Explain what becomes accessible; do not upload local user data by default. A public link is not private access control. Support updating the published version and taking it offline.

Evaluate static frontend publishing first. Local filesystem access, desktop capabilities, secrets, shared server state, and external services need explicit compatibility checks and possibly a separate backend. WASM compilation does not establish Cloudflare portability. Failed or unsupported publishing must preserve the working local tool.

## Proposed sequence and remaining decisions

1. Prove developer frontend creation and preview, isolation, resource usage, and source export.
2. Build the consumer experience: simplified onboarding, conversation, saved tools, durable data, and recovery, with developer surfaces removed.
3. Prove sharing for supported tools: guided connection to the user's Cloudflare account, explicit sharing scope, verified URLs, updates, and removal.
4. Consider Zyra Cloud separately if account setup remains too much friction.

Runtime, compiler, dependency catalog, storage APIs, consumer packaging, model onboarding, backend support, and Cloudflare authorization remain open. This sequence is proposed, not scheduled.

## References and evidence boundary

- [ts-rust / tsc-rs](https://github.com/pingdotgg/ts-rust): experimental compiler port and WASM motivation; not proof of Zyra integration.
- [Just Bash](https://github.com/vercel-labs/just-bash): candidate virtual shell/filesystem building block.
- [Cloudflare Workers WebAssembly](https://developers.cloudflare.com/workers/runtime-apis/webassembly/): platform reference for future compatibility investigation.

This document delivers no runtime changes, consumer UI, hosting integration, account connection, or deployment.
