# ADR-0013: Use chat permissions and critical-only Full access escalation

- **Status:** Superseded by [ADR-0014](0014-share-four-permission-modes-across-chat-and-control.md)
- **Date:** 2026-09-01
- **Refines:** [ADR-0006](0006-separate-involvement-from-permissions.md)

## Context

Zyra had several permission presentations for the same conversation: tool approval cards, a terminal modal, Browser overlays, Browser toolbar buttons, Thread Details controls, and remembered per-site Browser approvals. Full access bypassed ordinary command and file prompts but did not reach Browser, Chrome, or Windows control grants. Critical control side effects were rejected without an executable approval path.

This made authority hard to predict. Users could select Full access and still be interrupted by routine control prompts, then encounter a different UI when an action actually needed attention.

## Decision

Zyra exposes two permission modes:

1. **Supervised** asks in the canonical chat before commands, file changes, and root control grants.
2. **Full access** performs routine work required by the user's request without another prompt.

Full access still escalates critical actions in chat. Critical actions include purchases, external sending or publishing, production deployment, account or security changes, destructive deletion or data loss, Git history rewrites, local-file upload, sensitive-data submission, system software installation, legal acceptance, and credential or secret use.

The same policy applies to local tools, the in-app Browser, paired Chrome tabs, and explicitly selected ordinary Windows application windows.

Root control grants remain bounded by target, capability, origin or executable identity, expiry, action count, principal, and observation revision. Full access may issue that bounded root grant without a separate approval. It does not bypass target selection, Chrome pairing and browser-owned permission gestures, child lease attenuation, password blocking, secure-desktop restrictions, or Emergency Stop.

Critical Browser and computer actions create a trusted, one-action approval record. The action waits, the canonical chat renders the request, and main resumes only after a trusted renderer approves that exact record. Denial, timeout, cancellation, target closure, grant revocation, or Emergency Stop removes the record and cancels the action.

Permission decisions render in chat. Browser chrome and Thread Details may show status, but they do not approve or deny. Platform setup gestures such as pairing Chrome or selecting a Windows window remain in their owning setup UI because the browser or operating system requires those gestures.

## Consequences

### Benefits

- One predictable place for user decisions.
- Full access behaves consistently across files, commands, Browser, Chrome, and Windows control.
- Routine work flows without per-step prompts.
- Critical control actions have a real pause-and-resume path instead of a permanent rejection.
- Broker safety checks remain independent from permission presentation.

### Costs

- The renderer subscribes to broker approval state while a chat is open.
- Critical action tool calls may remain pending while the user responds.
- Legacy unreleased permission aliases require input-only migration.

## Alternatives considered

### Keep four permission modes

Rejected. Auto review and Edits only added labels and branches without giving users a clearer mental model. Their useful behavior now belongs to Full access and Supervised.

### Remember approvals per website

Rejected. It created a second persistent permission policy beside the chat's selected mode.

### Keep Browser approval controls on the Browser surface

Rejected. It split one conversation's decisions across chat, Browser, and Thread Details.

### Let Full access bypass critical side effects

Rejected. Full access authorizes routine execution, not purchases, publishing, destructive actions, account changes, secret handling, or similar consequences.

## Verification

- Permission-mode contract tests expose only Supervised and Full access.
- Full access routine tool tests produce no user prompt.
- Critical tool tests cover reviewer approve, deny, fallback, and chat escalation.
- Broker tests prove Full access issues bounded root grants without pending grant state.
- Broker tests prove critical control actions wait for exact approval and cancel on denial.
- Renderer tests prove grant and critical-action requests render in chat without Browser or terminal permission modals.
- Main and renderer TypeScript scopes pass.
