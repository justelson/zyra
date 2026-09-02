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

## Example dialogue

> **Dev:** "Can this Project exist before the user associates a repository?"
> **Domain expert:** "Yes. The Project already has its Project home, and the repository can be added later as an Associated folder."

## Flagged ambiguities

- "Workspace" already refers to app and terminal work areas. The Project-owned filesystem location is called **Project home**.
- Existing code often uses a folder path as Project identity. In the domain, a **Project** and an **Associated folder** are distinct.
