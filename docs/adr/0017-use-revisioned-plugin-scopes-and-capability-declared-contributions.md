# ADR-0017: Use revisioned Plugin scopes and capability-declared contributions

- **Status:** Accepted; Skill-only phase implemented, later contribution phases planned
- **Date:** 2026-09-04
- **Refines:** [ADR-0014](0014-share-four-permission-modes-across-chat-and-control.md), [ADR-0015](0015-use-stable-projects-and-revisioned-chat-scopes.md)
- **Architecture:** [Plugins](../architecture/plugins.md)

## Context

Zyra already discovers Skills and Commands, can load Pi extensions, exposes deferred tools, connects to external providers, and renders several compiled app workspaces. These mechanisms have different discovery, trust, lifecycle, provenance, and permission rules. Treating any one of them as the Plugin system would leak its limitations into the product.

Pi packages can bundle extensions, Skills, prompts, and themes, but Pi extensions execute arbitrary code with the user's operating-system rights. OpenAI's current Plugin format packages Skills, MCP server connections, optional UI, hooks, agents, Commands, browser extensions, and supporting files behind `.codex-plugin/plugin.json`. Zyra needs compatibility with useful package formats while preserving its own Project, Chat, permission, control, and installation invariants.

A device-level install also must not silently change an existing Chat. A Plugin update can alter instructions, tool schemas, network destinations, or side effects even when its name stays the same.

## Decision

### Durable objects

A Plugin is a durable named package. Each Zyra installation owns independent Plugin sources, installations, releases, enablement records, and Chat Plugin scopes.

A Plugin source identifies a catalog or local package location. A Plugin installation has one active Plugin release. Every release is immutable after inspection and is identified by source, semantic version, and SHA-256 content digest.

Zyra stages and verifies a release before activation. Activation updates one small installation record atomically. Failed staging leaves the active release unchanged. Zyra retains a bounded number of prior releases needed by rollback or existing Chat Plugin scopes.

Plugin persistence uses its own migration version. It does not change `PERSISTENCE_VERSION` or merge development and packaged application state.

### Compatibility and normalization

Zyra accepts OpenAI's `.codex-plugin/plugin.json` package shape through an adapter. A normalized internal manifest owns stable identity, display metadata, provenance, requested capabilities, and declared contribution paths.

A future Pi-package adapter may normalize compatible resources into the same internal model. Pi settings and package internals do not become Zyra's product contract.

Manifest paths must be package-relative, bounded, free of traversal, and contained by the inspected package after real-path resolution. Zyra rejects symbolic links, duplicate identities, malformed Skills, oversized packages, unsupported file kinds, digest mismatches, and source ambiguity before activation.

Installers do not run package-manager lifecycle scripts or Plugin code.

### Enablement and Chat snapshots

Installing a Plugin makes it available on that device. It does not enable the Plugin for every Project or Chat.

Each Project has a revisioned Project Plugin set. The installation also has a revisioned global Plugin set for global Chats. Plugin-set mutations require the revision inspected by the caller so concurrent Desktop and browser clients cannot silently overwrite each other. A new Chat snapshots the applicable enabled set into a Chat Plugin scope containing exact Plugin IDs, release IDs, versions, content digests, and allowed contributions.

An existing Chat Plugin scope changes only through an explicit refresh. Installing or activating a newer release does not alter it. A refresh shows the release and capability differences before applying them.

Project Plugin sets and Chat Plugin scopes are independent from filesystem Chat scopes. Neither can widen the other. Bounded persistence fails closed at capacity rather than evicting an existing Chat Plugin scope or a release that scope retains.

### Supported contribution phases

The implemented phase supports Skills, metadata, icons, provenance, installation diagnostics, release history, and rollback. Skills may contain references, assets, and helper scripts; installation never executes them.

MCP connections and deferred tools, Plugin Commands, external account setup, and connection state are later phases. Listing an unsupported contribution does not activate it.

Arbitrary in-process Pi extensions, lifecycle hooks, browser extensions, and Plugin app views remain disabled until Zyra has a dedicated isolated host and narrower contribution contracts. The manifest may report these contributions as unsupported without executing them.

Plugin Skills use the existing progressive-disclosure loader. Their source metadata includes Plugin and release identity. A later MCP adapter will register tools behind deferred discovery; the current host does not connect or execute them.

Availability sets and new/refreshed Chat scopes accept at most 24 supported Skill packages. Unsupported-only local packages remain inspectable but cannot be enabled. Validation runs before persistence, preserving the previous revision and Chat pins when a request fails.

### Authority

A manifest declares the maximum capability of every executable contribution. Host-side adapters validate the declaration and the actual request. A Plugin cannot derive permission from its name, description, instructions, connection, install state, or enablement state.

Every Plugin action remains subject to:

- the Chat's four-mode permission policy;
- the filesystem Chat scope and read-only ceilings;
- the Chat Plugin scope and exact release digest;
- contribution-specific capability and destination limits;
- critical-action review in canonical Chat;
- root versus child-agent authority;
- interruption, expiry, audit, and Emergency Stop.

Unknown or missing action metadata fails closed. Tool-name heuristics may remain a compatibility fallback for built-in tools, but they cannot authorize Plugin actions.

A direct user install from the Plugins area uses an explicit trusted install review. An agent-requested install is a critical software-install action and requires canonical Chat approval. Neither path approves later tool actions.

Future Plugin connections require separate OAuth or credential setup. Secrets must use the operating-system credential store and never enter Plugin files, manifests, prompts, model-facing tool results, or ordinary logs.

Current Skill instructions can influence any tool in their Chat, so an authority decrease retires the whole affected Chat runtime. A dedicated server operation fences stale requests and attachments, interrupts the exact turn, cancels managed jobs and child fleets, revokes affected control grants, and awaits cleanup acknowledgement. Ordinary disconnect still retains work; unrelated Chats continue running. Older servers must pass a capability preflight before a registry mutation can proceed.

Registry persistence and server revocation are separate operations. If the server becomes unreachable between them, the operation reports failure and revokes local control grants, but cannot certify that server-owned work has stopped. No success message or documentation may describe that state as completed revocation.

### Product placement

Plugins is a first-class directory and management area with Discover, Installed, and Sources views. Plugin detail shows publisher, source, version, content digest, requested capabilities, contributions, connection requirements, update history, and install state.

Settings holds host-wide Plugin policy and source administration. It does not replace the browse, install, and detail workflows.

The current phase exposes enabled Skills through normal progressive disclosure and `/skill:name`. **Use in Chat** starts a new Chat pinned to the reviewed release. `@plugin` invocation is planned. Skill source metadata retains Plugin and release provenance.

## Consequences

### Benefits

- OpenAI-compatible packages can enter through a narrow adapter.
- Existing Chats remain reproducible and do not gain instructions or tools after install or update.
- Plugin identity, package bytes, Project enablement, Chat availability, external connection, and action authority stay separate.
- Skills reuse Zyra's bounded loader and conflict diagnostics.
- MCP tools can use deferred loading without increasing every prompt's tool schema.
- Failed installs and updates are reversible.
- Development and packaged Zyra remain isolated.

### Costs

- Zyra must maintain a Plugin catalog, installer, persistence module, scope resolver, contribution adapters, and management UI.
- Exact release retention consumes bounded disk space while old Chats reference prior releases.
- MCP authentication and optional UI require dedicated host work.
- Some OpenAI or Pi package contributions will appear as unsupported until Zyra implements an isolated adapter.
- Existing Chats need an explicit refresh to use newly installed or updated Plugins.

## Alternatives considered

### Enable Pi extensions as the Plugin system

Rejected because extensions execute arbitrary in-process code, expose terminal-oriented UI contracts, and do not model Project enablement or revisioned Chat Plugin scope.

### Treat every Plugin as a Skill source folder

Rejected because a source folder has no durable installation, immutable release, digest, Project enablement, connection state, rollback, or contribution-level authority.

### Enable installed Plugins in every Chat immediately

Rejected because install and update would silently change instructions, tools, network access, and behavior in existing conversations.

### Let each contribution own its permission UI

Rejected because ADR-0014 establishes one Chat permission policy and canonical Chat as the agent approval surface.

### Support arbitrary hooks and app code in the first release

Rejected because safe execution needs an isolated host, a constrained bridge, explicit lifecycle limits, and separate UI security review.

## Verification

- Manifest fixtures cover OpenAI-compatible packages, traversal, absolute paths, malformed metadata, duplicate Skills, symbolic links, size and depth bounds, unsupported contributions, and deterministic content digests.
- Installer fixtures prove approval is required, lifecycle scripts never run, staging is atomic, interrupted activation preserves the current release, tampering fails, rollback works, and cleanup removes temporary state.
- Persistence fixtures prove independent migration, development/production separation, bounded release retention, and reopen stability.
- Scope fixtures prove Project/global separation, exact release snapshots, optimistic Plugin-set revisions, explicit refresh, unchanged existing Chats after update, fail-closed capacity, and no filesystem-scope expansion.
- Availability fixtures prove 24 supported packages can be enabled, a 25th or an unsupported-only package is rejected before persistence, and invalid creation/refresh leaves revisions and pins unchanged.
- Runtime fixtures prove only scoped Plugin Skills load, provenance survives projection, and `/reload` never changes the Chat Plugin scope.
- Revocation fixtures cover detached active turns, managed/background jobs, child fleets, affected control grants, stale attachments, mutation races, cleanup acknowledgement/failure, unaffected Chats, and the next connection's Skill sources.
- UI fixtures cover the bundled directory, install review, availability, update diff, disable, rollback, errors, empty states, and supported-versus-unsupported controls. MCP connection, credential, command, app-view, and uninstall tests remain requirements for their future implementation.
