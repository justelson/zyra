# ADR-0015: Use stable Projects and revisioned Chat scopes

- **Status:** Accepted and implemented
- **Date:** 2026-09-02

## Context

Zyra historically stored one `projectPath` on each Chat. That path served as identity, display name, runtime working directory, Files root, terminal root, Git target, and permission boundary. It also meant a folder could not appear in the new-Chat picker until an existing Chat already referenced it.

A durable Project must be able to exist before a repository or folder is attached. One Folder may also belong to several Projects, and one Project may need several repositories or reference folders with different access ceilings.

Development and packaged Zyra can run on the same Windows account. Their existing `userData` roots are intentionally separate (`Zyra-dev` or a suffixed development identity, and `Zyra` for production), so migration must not merge their databases or managed homes.

## Decision

A Project is a stable named record with an ID, a Zyra-managed Project home, a revision, lifecycle state, and zero or more Associated folders.

Each Associated folder records:

- the canonical physical Folder identity;
- its display path and label;
- a per-Project read-only or read-write access ceiling.

A Chat belongs to zero or one Project. Project Chats persist a Chat scope snapshot containing the Project revision, Project home, then-current Associated folders, access ceilings, and one selected Working root. New associations increment the Project revision. Existing Chat scopes do not gain or lose roots automatically; the user must explicitly apply the current Project scope.

`projectPath` remains temporarily as a compatibility projection of the Working root. New code uses `projectId`, `workingRoot`, and `chatScope` as the durable contract.

Project persistence is additive and uses an independent `projectMigrationVersion`. It does not change `PERSISTENCE_VERSION`, because the latter controls destructive development database reset behavior.

Legacy migration is idempotent:

- every canonical legacy path becomes one deterministic Project in that installation;
- Windows path identity is case-insensitive;
- the legacy path becomes a read-write Associated folder and remains the Chat Working root;
- nested legacy paths remain separate Projects initially;
- each migrated Chat receives its own persisted scope snapshot;
- Project homes are created below that installation's Assistant data directory;
- the packaged application's installation directory and Zyra's internal global workspace are never treated as Projects;
- affected Chats that inherited the installation directory are repaired as global Chats and use that installation's neutral managed global workspace;
- configured discovery locations produce review candidates, never automatic Projects.

The development and production databases run the migration independently. Deterministic IDs may match for the same legacy path, but each installation stores a different managed-home path under its own `userData` root. Global Chats also use separate neutral workspaces, so production no longer falls back to `process.cwd()` inside the installed application directory.

The selected Chat scope travels with runtime connection metadata. Direct file tools are checked against every scoped root. Out-of-scope paths and writes targeting read-only roots are blocked before permission-mode review, so Full access and chat approval cannot widen the saved scope. Shell checks reject explicit out-of-scope paths and conservatively restrict commands from or against read-only roots. This is an application authority boundary, not an operating-system filesystem sandbox.

Project-home instructions are always included in the Chat prompt. Root-level instructions from other scoped Folders are labeled as folder-local and apply only while work touches that Folder.

## Consequences

- The new-Chat picker reads the Project catalog and reviewed discovery candidates rather than deriving choices from existing Chats.
- Users can create folderless Projects, attach shared read-only or read-write Folders, detach associations without deleting external files, and archive or restore Projects.
- Files can switch among the roots saved in the selected Chat scope.
- Runtime commands start in the Working root while direct file-tool authorization uses the full saved root set.
- Reapplying a Project scope reconnects the runtime even when the Working root stays the same.
- Archiving a Project preserves its Chats, Project home, and external Folders.
- A future Source Control surface can aggregate repositories from the Chat scope while keeping mutations repository-specific.

## Alternatives

### Keep paths as Project identity

Rejected because renames and moves change identity, folderless Projects remain impossible, shared Folder associations cannot carry per-Project policy, and the new-Chat picker remains coupled to Chat history.

### Automatically import every discovered folder

Rejected because configured locations are discovery boundaries, not consent to create durable Projects.

### Mutate every existing Chat when a Folder is attached

Rejected because it silently expands agent filesystem authority and makes historical scope impossible to audit.

### Share one migration database between development and production

Rejected because the applications already use separate identity and `userData` roots. Sharing would create cross-installation coupling and unsafe lifecycle assumptions.

## Verification

- Database fixtures cover deterministic case-insensitive migration, nested paths, idempotent reruns, installation-directory repair, neutral global workspaces, reviewed discovery, shared associations, read-only ceilings, revisioned scope snapshots, detachment preservation, and independent development/production managed homes.
- Permission-gate fixtures cover scoped reads, hard out-of-scope blocking, read-only file writes, explicit shell paths, and conservative read-only command handling.
- Main, preload, and renderer typechecks cover the persistence, IPC, bridge, store, picker, Settings, Files, and runtime contracts.
- The existing new-Chat surface regression passes with Project-catalog selection.
