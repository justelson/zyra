# Zyra

Zyra organizes durable conversations and agent work across user-defined Projects while preserving explicit filesystem and authority scopes.

## Language

**Project**:
A durable named work context whose identity does not depend on any filesystem folder.
_Avoid_: Folder, project path

**Project home**:
The user-visible filesystem home owned by a Project, including a Project with no Associated folders.
_Avoid_: Workspace, project folder

**Folder**:
An external filesystem directory that can be associated with one or more Projects.
_Avoid_: Project, Project home

**Associated folder**:
The relationship connecting one Project to one Folder with a read-only or read-write maximum access level.
_Avoid_: Project path, owned folder

**Chat**:
A durable conversation that is global or belongs to exactly one Project.
_Avoid_: Project, thread

**Chat scope**:
The revisioned set of filesystem roots and maximum access levels a Chat may use without gaining later Associated folders automatically.
_Avoid_: Project path, current folder

**Working root**:
The one filesystem root a Chat uses as the starting location for relative work.
_Avoid_: Project, Chat scope

**Project instructions**:
Rules inherited by every Chat belonging to a Project.
_Avoid_: Folder rules

**Folder-local instructions**:
Rules that govern work performed inside one Folder.
_Avoid_: Project instructions

**Turn**:
One user message and the assistant work it starts, ending in a completed, failed, or interrupted outcome.
_Avoid_: Tool call, transport request

**Work summary**:
The collapsible turn-level account of elapsed work and action count.
_Avoid_: Tool-call group

**Work narration**:
The assistant's original user-facing progress text inside a Work summary, kept verbatim and in chronological order.
_Avoid_: Action title, internal thought

**Action batch**:
One collapsed block for consecutive Actions between Work narration boundaries. Its short `-ing` title follows the current running Action, then the latest settled Action; opening it reveals every Action rather than a last-five subset.
_Avoid_: Tool-call group, Work narration

**Action**:
One typed operation within an Action batch or standing alone, such as a command, read, edit, search, skill load, browser operation, or agent assignment.
_Avoid_: Work narration, raw protocol event

**Evidence**:
The event-time result retained for an Action, including captured read ranges, diffs, command output, structured web results, and meaningful screenshots.
_Avoid_: Current file state, transport envelope

**Question handoff**:
A structured question set that ends its assistant Turn. Submitted answers become a linked user message and start a new Turn.
_Avoid_: Approval, blocking tool continuation

## Relationships

- A **Project** owns exactly one **Project home**.
- A **Project** has zero or more **Associated folders**.
- A **Folder** may have an **Associated folder** relationship with more than one **Project**.
- An **Associated folder** remains physically independent from the **Project home**.
- A **Chat** belongs to zero or one **Project**.
- A new Project **Chat** inherits the current **Project home** and **Associated folders** into its **Chat scope**.
- A **Chat scope** cannot exceed an **Associated folder's** maximum access level.
- An existing **Chat scope** changes only through an explicit scope update.
- Every **Chat** has exactly one **Working root** selected from its **Chat scope**.
- **Project instructions** apply throughout every Chat belonging to their Project.
- **Folder-local instructions** apply only while work touches their Folder.
- A **Turn** owns zero or one **Work summary** and one terminal outcome.
- A **Work summary** preserves the chronological sequence of **Work narration**, **Action batches**, and lone **Actions**.
- An **Action batch** contains every consecutive typed **Action** until the next narration or conversation boundary.
- An **Action** owns its captured **Evidence** and never substitutes newer filesystem or page state during replay.
- A **Question handoff** is durable conversation state outside the completed assistant Turn; its answer message links back to the question set.
- An approval remains an in-Turn authorization action and never becomes a **Question handoff**.

## Example dialogue

> **Dev:** "Can this Project exist before the user associates a repository?"
> **Domain expert:** "Yes. The Project already has its Project home, and the repository can be added later as an Associated folder."

## Migration invariants

- Legacy `projectPath` values migrate independently inside each Zyra installation's data root.
- A packaged Zyra installation directory is internal application state, never a Project or Working root.
- A global Chat uses a neutral managed workspace inside its installation's data root instead of `process.cwd()`.
- Each desktop installation runs its canonical agent server from an installation-specific namespace under its own `userData`; development and packaged builds never share the server endpoint, authority, lock, journal, or catalog.
- Windows path identity is case-insensitive.
- Nested legacy paths remain separate Projects until a later explicit merge.
- Configured discovery locations produce review candidates; discovery never creates Projects automatically.
- `projectPath` remains a compatibility projection of the Chat's **Working root** during migration.

## Flagged ambiguities

- "Workspace" already refers to app and terminal work areas. The Project-owned filesystem location is called **Project home**.
- Existing code often uses a folder path as Project identity. In the domain, a **Project** and an **Associated folder** are distinct.
- A moved external Folder is currently shown as unavailable. The product semantics for relinking it while preserving Folder identity remain unresolved; detaching and associating the new path creates a new Folder identity.
