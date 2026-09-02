# ADR-0014: Share four permission modes across chat and control

- **Status:** Accepted and implemented
- **Date:** 2026-09-01
- **Supersedes:** [ADR-0013](0013-use-chat-permissions-and-critical-only-full-access-escalation.md)
- **Refines:** [ADR-0006](0006-separate-involvement-from-permissions.md)

## Context

Zyra's permission choices must describe one policy for the whole chat. Local commands and files, the in-app Browser, paired Chrome tabs, and explicitly selected Windows app windows cannot use separate mode systems. Duplicate Browser approval UI and remembered per-site policies also made authority difficult to predict.

Reducing the product to two modes removed useful user intent. Auto review and Edits only are distinct operating policies, not migration aliases.

## Decision

Every chat has one of four canonical permission modes:

| Mode | Local tools | Control grants |
| --- | --- | --- |
| **Supervised** (`approval-required`) | Ask in chat before commands and state-changing file tools. | Ask in chat before root Browser, Chrome, or Windows grants. |
| **Auto review** (`auto-review`) | Review automatically. Proceed with routine reversible work; ask when uncertain or consequential. | Issue routine bounded in-app Browser grants automatically. Ask before paired Chrome or Windows grants. |
| **Edits only** (`edits-only`) | Allow non-destructive file edits inside the project. Ask before commands, destructive tools, or out-of-project edits. | Ask in chat before Browser, Chrome, or Windows grants. |
| **Full access** (`full-access`) | Proceed with routine requested work. | Issue routine bounded root grants automatically for Browser, Chrome, and selected Windows windows. |

Critical actions require chat approval in every mode. These include purchases, external sending or publishing, production deployment, account or security changes, destructive deletion or data loss, Git history rewrites, local-file upload, sensitive-data submission, system software installation, legal acceptance, and credential or secret use.

The canonical chat is the only permission-decision surface. Browser chrome, Thread Details, and the sessions rail may show pending status. They do not approve or deny. Chrome pairing, browser-owned permission gestures, exact-tab activation, and Windows window selection remain in their owning setup UI because the platform requires those gestures.

Every automatically issued control grant remains bounded by principal, exact target, capability, origin or executable identity, expiry, action count, and observation revision. Child agents still require attenuated parent leases. No mode bypasses password blocking, secure-desktop restrictions, target arbitration, grant revocation, or Emergency Stop.

## Consequences

- The same selected mode flows from chat configuration through the runtime bridge to the main-process broker.
- Auto review has a deterministic control rule: contained in-app Browser grants are routine; paired Chrome and Windows control require attention.
- Edits only remains useful for code-focused work without silently authorizing commands or computer control.
- Critical single actions and critical staged-plan steps use trusted one-action records and resume only after exact chat approval.
- Old remembered-site and full-access-warning storage is removed during renderer migration.

## Verification

- Shared contracts and settings accept exactly four canonical modes.
- CLI flags, `/access`, and Desktop slash commands preserve all four values.
- Local permission-gate tests cover each mode, including destructive and out-of-project boundaries.
- Broker tests cover Full access, Auto review in-app grants, Auto review paired-Chrome prompts, and Edits-only control prompts.
- Renderer tests prove all four choices appear while approval resolution remains chat-only.
- Desktop, Chrome extension, and native Windows control suites pass.
