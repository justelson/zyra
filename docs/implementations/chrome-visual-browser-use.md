# Zyra Chrome Visual Browser Use Implementation

Status: implementation specification for the next Chrome builder

## 1. Product outcome

Zyra can use an installed Chrome browser without taking the user’s active tab, physical mouse, keyboard focus, or foreground application.

The user can say:

> Use the GitHub tab that is already open and review the failed workflow.

Zyra then:

1. discovers a bounded catalog of open ordinary web tabs;
2. matches the user’s description to a tab by title, URL, favicon, and recent explicit references;
3. asks for Chrome control permission if it has not been granted before;
4. assigns the selected tab to one root or child agent;
5. captures the rendered tab as the agent’s visual input;
6. moves an agent-owned virtual cursor over that tab;
7. clicks, drags, scrolls, types, and uses keys through target-local Chrome input;
8. leaves the user’s active tab and Windows pointer untouched;
9. streams cursor and page progress into Zyra’s live Browser view;
10. releases the tab when the task ends, the user takes over, navigation invalidates the document grant, or Emergency Stop is pressed.

Chrome control is available on demand. It is not tied to the beginning of a chat or agent run.

## 2. User-visible concepts

### 2.1 Agent-owned tab

A tab created by an agent for its task. This is the preferred default because it avoids contention with the user.

### 2.2 Borrowed existing tab

A tab the user identifies naturally, such as “the open GitHub tab.” Borrowing requires a bounded tab grant. Manual user interaction pauses the agent before the user and agent can conflict.

### 2.3 Live view

A retained view inside Zyra showing the current rendered page, agent cursor, action label, owning agent, grant status, and Pause, Take Over, Stop, and Open in Chrome controls.

### 2.4 Virtual cursor

The cursor belongs to the Chrome target, not the Windows desktop. Its coordinates are the same coordinates sent to Chrome. It remains visible in Zyra’s mirror and, when possible, as a non-interactive overlay inside the controlled page.

## 3. Default behavior

- Background mode is the default.
- Chrome does not come to the foreground merely because an agent acts.
- The user’s physical cursor never moves in background mode.
- One principal owns one tab at a time.
- Several agents may control separate tabs concurrently.
- Native Chrome UI, browser settings, extension pages, internal pages, downloads, permission bubbles, file pickers, authentication prompts, and password entry pause for the user.
- A tab can be observed before action only after the user has granted the relevant permission and tab scope.

## 4. First-use permission flow

The existing extension deliberately uses narrow permissions. Visual background use requires a separate explicit upgrade flow.

The extension should declare powerful permissions as optional whenever Chrome permits it. The Control Center presents an **Enable background Chrome control** button. The user click is the required browser user gesture for `chrome.permissions.request()`.

Requested capabilities are explained individually:

- `tabs`: enumerate bounded tab metadata such as title and URL so natural-language tab selection works;
- `debugger`: attach Chrome DevTools Protocol to one selected ordinary web tab for target-local screenshots and input;
- optional HTTP(S) host access when required by the extension’s scripting and cursor overlay path;
- `scripting`: install only the bounded visual cursor and trusted-user-interaction detector in the selected page.

The model cannot approve these permissions. It can create a pending request and direct the user to the visible button.

Permission denial keeps ordinary pairing available and returns a structured capability error. Permission removal immediately detaches targets and revokes grants.

## 5. Architecture

### 5.1 Chrome extension

Responsibilities:

- maintain session-only pairing credentials;
- expose a bounded tab catalog after permission;
- track actual top-level document identity;
- detect trusted user pointer and keyboard interaction;
- attach and detach the exact selected tab;
- host a non-interactive cursor overlay;
- relay target-local screenshot and input requests;
- clear all grants and tokens on disconnect.

### 5.2 Loopback pairing service

Responsibilities:

- bind only to loopback;
- authenticate extension origin and rotating bearer credentials;
- correlate bounded requests;
- expire inactive sessions;
- rate-limit handshake and polling;
- reject replayed credentials;
- remove all tab targets on disconnect.

### 5.3 Main-process control broker

The existing `AgentControlBroker` remains authoritative for:

- principals;
- pending requests;
- user-approved grants;
- target ownership;
- capability and action budgets;
- observation revisions;
- action queues;
- cancellation;
- audit summaries;
- Emergency Stop.

Chrome never receives raw model commands. It receives validated actions from the broker.

### 5.4 Chrome visual driver

Add a `ChromeVisualDriver` using the `chrome.debugger` transport with a strict protocol allowlist.

Expected CDP domains:

- `Page` for rendered screenshots and navigation lifecycle;
- `Input` for mouse, wheel, drag, and keyboard events;
- `Runtime` or `DOM` only for the owned cursor overlay and narrow safety checks;
- `Accessibility` only as a secondary safety and labeling signal.

Raw CDP is never exposed to the renderer, model, workflow, or child agent.

### 5.5 Zyra live renderer

Use the same `ControlCursorState` contract as the in-app Browser. The live view receives bounded frames and cursor states. It does not receive cookies, request headers, storage, or debugger protocol traffic.

## 6. Vision-first action loop

1. The driver captures a bounded JPEG of the selected tab through CDP.
2. The image is returned as a Pi image content block.
3. The agent chooses an action and viewport coordinates.
4. Main validates target, principal, grant, capability, document identity, observation revision, viewport bounds, and side-effect policy.
5. Cursor state moves to the requested coordinates.
6. CDP sends the corresponding target-local input event.
7. A fresh screenshot receives a strictly higher revision.
8. The agent continues from the new rendered state.

DOM and accessibility data may block unsafe typing or clarify a control. They are not the primary navigation mechanism.

## 7. Supported actions

Initial complete set:

- move;
- hover/wait;
- left, middle, and right click;
- double click;
- drag and drop;
- wheel and horizontal scroll;
- bounded text entry;
- replacement text entry;
- key presses and modifier shortcuts;
- select controls;
- navigation to approved HTTP(S) origins;
- wait for visual, URL, loading, or document changes.

Coordinate typing must perform a narrow safety lookup before text is inserted. Password, OTP, payment, credential, and browser-owned fields pause for manual entry.

## 8. Tab discovery and natural-language selection

The tab catalog contains only bounded metadata:

- opaque tab token;
- window token;
- title;
- normalized origin and bounded URL;
- favicon URL after scheme validation;
- active/audible/pinned/group state;
- ownership state;
- top-level document identity.

It excludes page bodies, cookies, storage, form values, history, and request headers.

The root or child agent receives the catalog through `browser_control list_targets`. The model may select a clear match. Ambiguous matches produce a short user choice rather than guessing.

## 9. Real document identity

Do not generate a synthetic document ID and assume it follows Chrome navigation.

Use top-level committed navigation events and Chrome’s actual document identity where available. Revoke or suspend the tab grant on:

- reload, including same-URL reload;
- top-level navigation;
- tab replacement;
- renderer crash;
- debugger detach;
- tab close;
- extension suspension without resumable session state.

A grant can be renewed only through a fresh bounded approval or an explicitly configured session policy.

## 10. Background and user interaction

The selected tab does not need to be active for CDP target input and page capture. Unsupported or throttled background behavior returns a structured error and pauses; it must not silently activate Chrome.

The cursor overlay listens for trusted human events. A trusted pointer, wheel, touch, or keyboard event in an agent-owned tab causes:

1. immediate action-queue cancellation;
2. cursor status `paused-by-user`;
3. grant suspension;
4. visible Take Back or Resume choice.

Opening the Zyra live view does not pause the agent. Opening the actual Chrome tab also does not pause by itself; interacting with it does.

## 11. Agent attachment

Every connected desktop root and child agent may have the `browser_control` tool registered without authority.

On demand:

1. it lists visible Chrome targets;
2. it requests a target and capability set;
3. Supervised, Auto review, and Edits only render the bounded paired-Chrome request in canonical chat, while Full access issues the bounded root grant automatically;
4. any approval binds the grant to that exact principal and tab;
5. completion, cancellation, disconnection, or Emergency Stop revokes active grants and pending requests.

A child cannot request Windows control, enumerate protected targets, widen a grant, redelegate, or retain control after its run.

## 12. Sensitive actions

Grant approval is separate from side-effect approval.

The first implementation must add an executable per-action confirmation path for:

- send or publish;
- purchase;
- account or security changes;
- destructive deletion;
- uploads;
- sensitive-data submission;
- software installation;
- legal acceptance.

While awaiting approval, the screenshot and cursor remain visible but the input queue is paused. Main creates an exact pending action record and canonical chat resolves it. Full access does not bypass this per-action path.

## 13. Bounded data and privacy

- Frames are resized and JPEG-compressed before entering model context.
- Only the latest required frame and a small bounded history are retained.
- Screenshot bytes are never written to chat metadata, Resources, or audit logs.
- Audit records contain target kind, origin, action type, revision, timing, outcome, and redaction labels.
- Pairing tokens, debugger traffic, cookies, storage, headers, typed text, and page bodies are excluded from audit persistence.
- Incognito tabs remain unsupported unless a separate explicit product decision enables them.

## 14. Failure handling

- Debugger detach revokes target grants.
- Extension restart clears uncertain document grants and asks for reattachment.
- A stale observation returns the current revision and requires a fresh frame.
- A timed-out action is cancelled and never retried blindly.
- A navigation during queued input invalidates the queue.
- Conflicting agent ownership returns `CONTROL_TARGET_BUSY`.
- Chrome DevTools attachment conflicts are visible and recoverable.

## 15. Migration from the current extension

Retain:

- MV3 packaging;
- loopback pairing;
- rotating session tokens;
- session storage;
- HTTP(S)-only page policy;
- exact target registration;
- Control Center and Emergency Stop;
- common broker contracts.

Replace or extend:

- synthetic document tokens with actual navigation identity;
- active-tab-only capture with optional debugger-backed background frames;
- element-path actions with viewport coordinate actions;
- hidden action dispatch with shared cursor state;
- per-tab popup-only grant selection with natural-language tab discovery plus user approval;
- source-regex tests with executable extension lifecycle and background-tab tests.

## 16. Implementation phases

### Phase A — permission and catalog

- optional permission request UI;
- bounded tab catalog;
- ordinary-page filtering;
- target ownership and document lifecycle;
- permission removal and disconnect cleanup.

### Phase B — visual background driver

- CDP attach/detach broker;
- bounded background screenshot;
- viewport metrics;
- coordinate move, click, drag, scroll, and keys;
- fresh revision after every action.

### Phase C — cursor and live view

- extension cursor overlay;
- Zyra mirrored cursor;
- action labels and owner identity;
- user interaction auto-pause;
- Take Over, Resume, and Stop.

### Phase D — dynamic agents and side effects

- child on-demand requests;
- principal-bound grants;
- completion cleanup;
- per-action approval UI;
- multi-agent separate-tab concurrency.

### Phase E — packaging and live proof

- deterministic extension package;
- permission upgrade/migration tests;
- Chrome-for-Testing end-to-end run;
- signed release checklist.

## 17. Verification matrix

Automated:

- permission declaration and runtime request;
- tab metadata redaction;
- blocked URL schemes;
- actual document revocation, including same-URL reload;
- target ownership conflict;
- screenshot byte bounds;
- coordinate viewport bounds;
- stale revision race;
- drag cancellation;
- trusted user interaction pause;
- debugger detach cleanup;
- child completion revocation;
- pairing replay and rotation;
- no credentials in logs or artifacts.

Live isolated:

1. install unpacked extension in Chrome-for-Testing with a temporary profile;
2. grant optional control permission through the extension UI;
3. open two tabs;
4. keep tab A active for the user;
5. assign tab B to an agent;
6. watch tab B in Zyra’s live view while tab A remains usable;
7. complete a visual click, drag, scroll, and type task;
8. interact manually with tab B and confirm immediate pause;
9. reload the same URL and confirm revocation;
10. disconnect and confirm zero targets, grants, pending requests, cursor state, and session credentials.

## 18. Acceptance criteria

Chrome visual use is complete when:

- the user can name an already-open tab naturally;
- first use requests clear optional permissions through a user gesture;
- the agent controls the selected tab without activating it or moving the Windows cursor;
- the model sees bounded rendered frames;
- the visible cursor matches exact action coordinates;
- separate tabs support separate agents;
- human interaction pauses the owning agent;
- navigation and reload invalidate document authority;
- sensitive actions pause for approval;
- completion and Emergency Stop remove every authority path;
- the complete flow passes in an isolated real Chrome process.

## 19. Primary references

- Chrome Debugger API: <https://developer.chrome.com/docs/extensions/reference/api/debugger?hl=en>
- Chrome Permissions API: <https://developer.chrome.com/docs/extensions/reference/api/permissions?hl=en>
- Chrome Tabs API: <https://developer.chrome.com/docs/extensions/reference/api/tabs?hl=en>
- Chrome extension permission declarations: <https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions?hl=en>
