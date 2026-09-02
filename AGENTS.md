# Zyra CLI Instructions

This project is Zyra, a local CLI built on top of the Pi SDK.

## Project Contract

- Keep the user-facing command surface small. Prefer normal conversation and a few durable commands over exposing internal machinery.
- The CLI should feel like a local workshop: it can inspect files, make scoped fixes, run checks, and explain the next useful thing without becoming a course.
- Preserve the distinction between Zyra's public core behavior, selectable profile overlays, and local private context.
- Public prompts/docs/code should not hardcode private people, local exports, raw datasets, or relationship-specific assumptions.

## Repo Map

- CLI entrypoints and install wrappers: `bin/`, `zyra.ps1`, `install.ps1`, `install.sh`
- Desktop application: `desktop/`
- Core CLI/runtime: `src/`
- Terminal UI: `src/tui/`
- Memory pipeline: `src/memory/`
- Built-in prompts and profiles: `prompts/`
- Tests and smoke scripts: `scripts/`

## Public And Local Files

- `AGENTS.md` is the shared repository instruction file and stays public.
- `AGENTS.override.md` is the ignored local override recognized by Codex. It must explicitly retain this shared contract because an override replaces `AGENTS.md` during discovery.
- Keep durable contributor guidance, architecture, security policy, and implementation contracts under `docs/`.
- Keep one-off prompts, plans, handoffs, research snapshots, QA evidence, and personal working notes under ignored `docs.local/`.
- Keep public automation inputs next to their owners under `scripts/automation/`; do not hide files that automation needs in `docs.local/`.
- Keep machine agent configuration under ignored `.agents/` or `.codex/` unless a specific shared configuration is intentionally added to the public repository.

## Working Style

- Act like a warm, direct, practical builder beside the user.
- Prefer action over broad explanation when the task is clear.
- When the user points at a concrete behavior, fix that exact behavior first.
- Do not turn frustration into a lecture or a prompt-theory discussion.
- Preserve intentional terminal spacing and rendering choices unless the request explicitly targets them.

## Zyra Voice

- The interaction should feel human, but not fake-sweet.
- Keep UI copy minimal but specific. Empty cute words are worse than plain useful words.
- Avoid generic assistant closers when a concrete next move is visible.
- Keep the pleasant workshop feel in public core behavior; use local profiles only for optional private/person-specific context.

## Prompt And Profile Architecture

- `prompts/zyra_system_prompt.md` is the public core behavior prompt.
- `prompts/profiles/default.md`, `learner.md`, and `builder.md` are public built-in profile overlays.
- `.zyra/profiles/<name>.md` is the local private profile overlay path.
- `/profile` selects an overlay; `auto` resolves to the configured default.
- Do not bake private local profiles into the public core prompt.

## Zyra Memory

- Treat `/memory` as a summary/control surface for local memory, not a raw memory dump.
- Use layered memory under `.zyra/memory` for local context and consolidation history.
- Use `/consolidate` as the manual cleanup pass that moves stable session learnings into the right layer and trims stale or vague notes.
- Memory files are local/private by default and should stay ignored.

## Custom Commands

- Do not keep generic starter prompt commands in the repo.
- Custom slash commands should emerge from repeated real workflows.
- If a repeated process shows up, the agent may suggest saving it as a slash command, but only as a light suggestion.
- Use `commands/<name>.md` for global Zyra CLI commands and `<project>/.zyra/commands/<name>.md` for project-local commands.
- After command files change, run or mention `/reload`.

## Live Adaptation

- Sometimes the user will not need a coding lesson or a fix; they may just need to chat, orient, vent, ask a small thing, or feel accompanied while they figure out what changed.
- Track the conversation as it evolves. If the user’s mood, goal, confidence, context, or identity signal changes mid-conversation, adapt instead of forcing the earlier frame.
- Do not over-classify the speaker. Use a working guess when useful, but stay ready to revise it from new evidence.
- When the moment is conversational, respond conversationally: warm, present, and specific, without turning it into a plan unless a plan is clearly wanted.
- When the moment becomes concrete engineering again, return to the normal coding loop: inspect files, make scoped changes, verify, and explain the diff.

## Privacy Safety

- Keep private exports, raw datasets, relationship-specific interpretation rules, local memory, and local profiles out of public prompts/docs/code.
- Treat local `.zyra/` context as private by default.
- Keep personal privacy patterns in `.zyra/privacy-patterns.json`; the public checker must contain only generic rules.
- If public readiness is in scope, run `npm run privacy-check` and inspect the output before shipping.
- Do not rewrite Git history, force-push, or delete public traces without explicit approval for that exact destructive operation.

## Engineering

- Read the real files before guessing.
- Keep changes scoped and maintainable.
- Run syntax checks or the relevant smoke test before calling work done.
- Commit meaningful checkpoints when asked, but do not include generated dependency folders, private local memory, sessions, or raw private exports.

## Validation

- Read `docs/development/fast-validation.md` before choosing broad checks. It is the canonical command map for quick, scoped, full, watch, and build validation.
- Keep a scoped TypeScript watcher running during desktop iteration; do not repeatedly restart the full graph after every edit.
- Do not run production builds unless the user explicitly asks for one or the change is massive enough that build-level verification is necessary. For normal scoped changes, use the narrowest relevant test, typecheck, syntax check, or lint check instead.
- Minor renderer, styling, and CSS changes must not trigger `npm run build`, packaging, or a full-app typecheck unless the user explicitly requests it. Use source inspection, a focused test, and live visual verification instead.
- Do not run root-level or desktop full-app typechecks after every scoped change. Prefer a focused contract test, file-level syntax check, or the narrowest affected-package check. Run a full-app typecheck only when the change crosses module/type boundaries, changes shared contracts or configuration, is structurally broad, is being prepared for release, or the user explicitly requests it.
- Iteration check: `npm run check:quick`.
- Core CLI checkpoint: `npm run check:core`.
- Desktop integration checkpoint: `npm run check:desktop`.
- Merge/release check: `npm run check`.
- Public readiness check: `npm run privacy-check`.
- Terminal rendering changes should include `scripts/test-zyra-ui-render.mjs`.
- Memory command changes should include `scripts/test-zyra-memory.mjs`.
- Installed CLI behavior should be verified with the local install path when the request touches command startup or global usage.
