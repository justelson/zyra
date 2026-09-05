# Plugins

Zyra Plugins are installable, revisioned packages that contribute Skills, MCP tools, Commands, and later optional visual resources. This architecture keeps package installation, Project enablement, Chat availability, external authentication, and action authority as separate decisions.

The load-bearing decision is recorded in [ADR-0017](../adr/0017-use-revisioned-plugin-scopes-and-capability-declared-contributions.md).

## Product model

The primary user wants to add a stable capability to Zyra, understand what it can access, use it in selected work, update it safely, and remove it completely.

Plugins is a directory and management product. Its core objects are:

- Plugin source
- Plugin
- Plugin release
- Plugin installation
- Plugin contribution
- Project Plugin set
- Chat Plugin scope
- Plugin connection

The common workflow is:

1. Browse or add a Plugin source.
2. Inspect a Plugin and one release.
3. Review publisher, provenance, contributions, and requested capabilities.
4. Install the release on this device.
5. Enable the Plugin globally or for selected Projects.
6. Start a Chat, which snapshots exact enabled releases.
7. Connect external accounts when a contribution requires them.
8. Invoke the Plugin naturally or with `@plugin`.
9. Review updates before applying them to existing Chats.
10. Disable, roll back, or uninstall without leaving credentials or active tools behind.

## Product surfaces

### Plugins directory

The complete Plugins destination has three real views:

- **Discover** browses a bundled, pinned OpenAI directory and opens Plugin detail. Supported Skill packages can be downloaded and reviewed before installation. This is not live catalog discovery.
- **Installed** shows installed releases, active/disabled state, failures and quarantine diagnostics, with availability, explicit Chat refresh, and rollback controls.
- **Sources** exposes installed package provenance. Arbitrary remote-source administration and automatic update discovery remain planned.

Search stays beside the list it filters. The list uses compact rows with icon, name, publisher, short description, source, and state. Categories help filtering but do not become a decorative card grid.

### Plugin detail

Detail is the decision surface for one Plugin. It shows:

- Plugin name and publisher
- active and available versions
- source and immutable content digest
- license, website, privacy policy, and terms links
- bundled Skills, MCP tools, Commands, and unsupported contributions
- requested capability ceilings and external destinations
- authentication timing
- Projects where the Plugin is enabled
- release history and rollback availability
- diagnostics or quarantine reason

Install, update, rollback, disable, and uninstall open bounded review flows. Destructive actions are secondary and never visually compete with ordinary enablement.

### Project and Chat use

Plugin detail controls availability for global Chats or selected Projects. **Use in Chat** starts a new Chat pinned to one reviewed release. Normal Skill discovery and `/skill:name` use the current Chat Plugin scope. `@plugin` composer invocation remains planned.

A Chat can show its exact Plugin releases in details. When the Project Plugin set changes, the Chat offers a reviewable refresh. It never applies that change silently.

### Connections

Connection setup belongs to Plugin detail or the moment a scoped contribution first needs it. The UI shows the service, account identity when safely available, granted scopes, and disconnect action. It does not display tokens, client secrets, raw OAuth payloads, or implementation keys.

## Package compatibility

### OpenAI Plugin adapter

The first package adapter accepts the public OpenAI structure:

```text
plugin-root/
├── .codex-plugin/
│   └── plugin.json
├── skills/                    optional
├── .app.json                  optional MCP connection reference
├── .mcp.json                  optional distributed MCP configuration
├── commands/                  optional
├── agents/                    optional
├── hooks.json                 optional, unsupported initially
└── assets/                    optional
```

The adapter normalizes package metadata into Zyra's internal model. OpenAI field names remain compatibility input, not internal persistence names.

Compatibility was rechecked against OpenAI's public repository on 2026-09-04. Its curated marketplace contained 64 entries, and current manifests use top-level `skills`, `mcpServers`, and `apps` paths. Zyra normalizes `mcpServers` to its internal `mcp` contribution. The repository root published no blanket license file at that snapshot, so each Plugin release's own license and provenance must be reviewed rather than treating the catalog as a general code-reuse grant.

### Future adapters

A Pi package adapter may accept `package.json` with a `pi` manifest. It can contribute compatible Skills, prompts, and themes. Pi extensions remain disabled unless a later isolated-code contribution explicitly supports them.

A local development adapter may point at an unpacked folder. Live folders require a visible development state because changing bytes invalidate the inspected release digest.

## Normalized manifest

The normalized manifest has these groups:

- identity: stable kebab-case name and semantic version;
- presentation: display name, descriptions, publisher, category, icons, brand color, screenshots, and links;
- provenance: source ID, source kind, source locator, release ref, and content digest;
- contributions: declared package-relative paths and host support state;
- capability ceiling: read, write, network, external side effect, local execution, credential, Browser, and computer-use classes;
- compatibility: source format and supported host versions;
- diagnostics: bounded validation and unsupported-contribution records.

Unknown fields are ignored. Recognized but unsupported contributions are retained as bounded diagnostics; neither becomes executable behavior by accident.

## Inspection limits

Package inspection happens before activation and applies hard bounds:

- 64 KiB manifest input;
- 2,048 files;
- 128 MiB total package bytes;
- 16 MiB per file;
- 12 directory levels;
- 256 Skills;
- 1,024 characters per description;
- bounded marketplace entries and diagnostics.

The inspector rejects:

- absolute or escaping contribution paths;
- control characters and invalid names;
- symbolic links, junction traversal, devices, sockets, and unsupported file kinds;
- a contribution whose real path leaves the package;
- missing declared contributions;
- malformed or duplicate Skill identities;
- package changes during staging;
- a digest mismatch between inspection and activation.

The installer copies bytes. It never evaluates a manifest, imports Plugin modules, invokes a package manager, or runs lifecycle scripts. Local package paths and install confirmation are accepted only from trusted Desktop IPC; the browser Assistant bridge can manage already-installed Plugins but cannot inspect or install local packages. Browser catalog projection also removes absolute source and installed-release paths.

## Installation lifecycle

```text
available
  -> inspecting
  -> staged
  -> awaiting-review
  -> activating
  -> active

inspection or staging failure -> failed
policy or integrity failure   -> quarantined
active update failure         -> previous active release remains active
active                        -> disabled
active or disabled            -> uninstalling -> removed
```

A trusted direct UI action can approve the exact staged digest. An agent-requested install creates a critical software-install approval in canonical Chat. Approval binds to source, Plugin ID, version, digest, contribution summary, and requested capability ceiling.

The activation record changes only after the staged copy passes a second inspection. Temporary directories are removed after success, failure, cancellation, process recovery, or application restart.

Zyra retains the active release, a bounded rollback set, and any release referenced by a Chat Plugin scope. Garbage collection never removes a referenced release.

## Enablement and scope

Installation and enablement are separate.

The global Plugin set and each Project Plugin set contain ordered stable Plugin IDs plus a revision. Setting the same ordered IDs is idempotent. Adding, removing, or reordering a Plugin increments the applicable revision. Every mutation supplies the revision the client inspected; a stale Desktop or browser client must refresh instead of overwriting a newer Plugin-set change.

A Chat Plugin scope records:

- owner kind and owner ID;
- Plugin-set revision;
- exact Plugin ID;
- exact release ID, semantic version, and content digest;
- normalized contribution paths;
- capability ceiling at snapshot time;
- creation and last-refresh timestamps.

A Chat created before Plugin support receives an empty scope. A new Chat snapshots the applicable set. Updating an installation changes its active release but leaves existing Chat Plugin scopes unchanged.

Availability and new/refreshed scopes reject more than 24 supported Skill packages before saving. An unsupported-only package can be imported for inspection, but cannot be enabled or offered as executable Chat functionality. Invalid mutations leave revisions, existing scopes and persisted bytes unchanged.

Explicit refresh computes a diff:

- added Plugins;
- removed Plugins;
- release changes;
- contribution changes;
- capability increases or decreases;
- connection changes.

A capability increase requires review even when the semantic version looks minor.

## Runtime flow

```text
Plugin source
  -> package adapter
  -> bounded inspector
  -> immutable staged release
  -> trusted install review
  -> installation catalog
  -> Project/global Plugin set
  -> Chat Plugin scope
  -> contribution adapters
     -> Skill loader
     -> deferred MCP tool loader
     -> Command expansion
  -> Zyra permission and control policy
  -> provider
  -> provenance-bearing Action and Evidence
```

### Skills

The Skill adapter contributes only directories recorded in the Chat Plugin scope. It reuses Zyra's bounded Agent Skills loader, conflict diagnostics, progressive disclosure, and explicit `/skill:name` behavior.

Skill source metadata includes Plugin ID, release ID, source label, and content digest. `/reload` rereads files from the same release. It does not switch the Chat to another release.

A package may include scripts inside a Skill. Their presence raises the Plugin's local-execution capability ceiling. Running one still goes through normal command and filesystem permission checks.

### MCP tools

The MCP adapter starts connections on demand. It does not connect every installed Plugin at application startup.

The host validates server configuration, transport, destination, authentication mode, tool schemas, output bounds, cancellation, and timeout before registering tools. Registered Plugin tools remain inactive until deferred search selects them.

Each normalized tool carries host-owned metadata describing:

- Plugin and release identity;
- read or write class;
- possible external side effect;
- allowed network destination;
- credential requirement;
- input and output size limits;
- cancellation and timeout behavior.

Missing metadata blocks the call. The model cannot supply or widen this metadata.

### Commands

Plugin Commands expand into ordinary user-visible Chat work. They do not execute privately or bypass the prompt, permission, or Action timeline.

Built-in command names remain reserved. Collisions are namespaced or shown for explicit resolution.

### Optional UI

A future UI adapter may render MCP Apps resources in a dedicated sandboxed frame. The frame receives a narrow message bridge, strict CSP, bounded resources, no Node integration, no ambient clipboard, no direct filesystem access, and no trusted approval controls.

Plugin UI is presentation. It cannot grant authority or submit canonical approvals.

### Hooks and arbitrary code

Hooks and in-process Pi extensions remain unsupported in the first release. A future code host must use a separate process or stronger OS isolation, explicit capabilities, bounded messages, deterministic shutdown, crash containment, and no direct access to Desktop internals or credentials.

## Permission model

Plugin policy composes with ADR-0014 and ADR-0015.

The effective authority for one action is the intersection of:

1. the contribution's declared capability ceiling;
2. the exact Chat Plugin scope;
3. the filesystem Chat scope and read-only ceilings;
4. the Chat permission mode;
5. the root or attenuated child principal;
6. critical-action approval when required;
7. current connection scopes;
8. target, destination, revision, expiry, action-count, interruption, and Emergency Stop checks.

No factor can widen another. Full access can remove routine prompting, but it cannot create a missing Plugin scope, capability declaration, connection scope, or filesystem root.

## Persistence

Plugin state lives below each installation's Assistant data directory. Development profiles, display-QA profiles, and packaged Zyra do not share it.

The Plugin store uses an independent migration version and atomic writes or dedicated SQLite tables. It does not change `PERSISTENCE_VERSION`.

Persisted state contains normalized bounded records. Capacity and serialized-size limits fail closed before mutation; they never evict an existing Chat Plugin scope or referenced Plugin release to make room. Raw marketplace responses, package archives, OAuth responses, tokens, prompt text, and unbounded diagnostics are excluded.

## Recovery

On startup Zyra:

1. removes abandoned staging directories;
2. validates active release paths and state records;
3. quarantines missing or mismatched active releases;
4. preserves the last verified release for rollback;
5. disconnects stale Plugin connections;
6. leaves Chat Plugin scopes unchanged;
7. reports bounded diagnostics in Plugins.

Disabling a Plugin uses a dedicated authority-revocation path. Ordinary Desktop detach intentionally preserves work, so it is not used as proof of cancellation. Main selects affected pinned Chat scopes, serializes authority mutations and waits for the server to fence stale requests, interrupt work, cancel managed jobs and child fleets, and acknowledge cleanup. It also revokes affected root/child control grants, including those owned by detached Chats. Other Chats keep running.

Older servers must support the revocation operation before the registry changes. A cleanup error or timeout is reported as failure, never successful revocation. If the server becomes unreachable after registry persistence but before receiving revocation, local grants are revoked but server-side work may still be running. Retry or a verified clean server stop is required to establish that it ended. Completed effects and deliberately escaped processes cannot be undone by this mechanism.

Uninstall and Plugin account connections remain planned. Their eventual implementation must wait for cleanup and remove only credentials owned by the selected Plugin after explicit confirmation.

## Implementation phases

Current source status: Phase 1 and the Skill-only product workflow are implemented. The directory uses bundled pinned metadata; Desktop supports local-folder import and verified catalog downloads, exact-release review, installation state, global/Project availability, Use in Chat, explicit Chat scope refresh, disable with acknowledged runtime cleanup, and rollback. Arbitrary remote-source management, uninstall, Plugin account connections, MCP tools, `@plugin` invocation, hooks and isolated Plugin UI remain future work.

Publisher descriptions are labeled as publisher text and accompanied by the current host-support boundary. `plugin-description-overrides.json` holds reviewed Zyra-written summaries where vendor copy would be misleading; the catalog records their origin so they are never attributed to the publisher. `node scripts/update-plugin-directory.mjs --apply-descriptions` applies those summaries without changing the upstream commit or package pins.

### Phase 1: durable skills foundation

- normalized OpenAI manifest and marketplace parser;
- bounded package inspection and deterministic digest;
- staged local installation with approval binding;
- installation catalog and independent migration;
- Project/global Plugin sets and Chat Plugin scopes;
- exact-release Skill adapter;
- provenance and deterministic tests.

### Phase 2: MCP connections and deferred tools

- MCP transport and schema validation;
- OAuth and OS credential storage;
- host-owned action metadata;
- deferred discovery and activation;
- permission, redaction, cancellation, and audit tests.

### Phase 3: Plugins product area

- Discover, Installed, Sources, and detail views;
- install review, Project enablement, Chat refresh diff;
- connection setup, disable, rollback, and uninstall;
- `@plugin` composer invocation and provenance display.

The read-only directory can ship before remote installation. Every visible action must have a working lifecycle behind it.

### Phase 4: isolated optional UI

- MCP Apps resource host;
- sandboxed Plugin workspace tabs;
- theme tokens and accessibility bridge;
- strict CSP, navigation, storage, and permission tests.

### Phase 5: isolated hooks and code

This phase begins only after a separate threat model and ADR.

## Source references

- OpenAI, [Plugin architecture](https://developers.openai.com/plugins/concepts/plugins)
- OpenAI, [Package your plugin](https://developers.openai.com/plugins/build/plugins)
- OpenAI, [Plugin security and privacy](https://developers.openai.com/plugins/guides/security-privacy)
- OpenAI, [public Plugin repository](https://github.com/openai/plugins)
- Pi, `docs/packages.md`, `docs/extensions.md`, and `docs/skills.md` in the installed SDK documentation
