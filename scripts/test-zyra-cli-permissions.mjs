import assert from "node:assert/strict";
import { extractZyraPermissionModeArgs } from "../src/permission-mode.mjs";
import { resolveTuiPermissionAttachFields } from "../src/agent-server/tui-runtime.mjs";
import { ACCESS_MODES, getSlashCommand } from "../src/slash-commands.mjs";

const fullAccessShortcut = extractZyraPermissionModeArgs(["new", "--full-access"]);
assert.equal(
  fullAccessShortcut.permissionMode,
  "full-access",
  "the full-access shortcut must reach the runtime options",
);
assert.deepEqual(fullAccessShortcut.args, ["new"], "permission flags must not leak into prompt text");
assert.equal(
  extractZyraPermissionModeArgs(["resume", "chat-1", "--permission-mode", "supervised"]).permissionMode,
  "approval-required",
  "the supervised alias must normalize to the canonical mode",
);
assert.equal(
  extractZyraPermissionModeArgs(["new", "--permissions", "yolo"]).permissionMode,
  "full-access",
  "the value flag must accept the familiar yolo alias",
);
assert.equal(
  extractZyraPermissionModeArgs(["new", "--safe"]).permissionMode,
  "approval-required",
  "the safe shortcut must explicitly select supervised mode",
);
assert.equal(
  extractZyraPermissionModeArgs(["new", "--auto-review"]).permissionMode,
  "auto-review",
  "the auto-review shortcut must preserve the automatic review mode",
);
assert.equal(
  extractZyraPermissionModeArgs(["new", "--edits-only"]).permissionMode,
  "edits-only",
  "the edits-only shortcut must preserve the edit-focused mode",
);
assert.equal(
  extractZyraPermissionModeArgs(["--permission-mode=full-access", "new"]).permissionMode,
  "full-access",
  "the equals form must work before the command name",
);
assert.throws(
  () => extractZyraPermissionModeArgs(["new", "--permission-mode", "sometimes"]),
  /Permission mode must be one of/i,
  "invalid permission modes must fail instead of becoming prompt text",
);
assert.throws(
  () => extractZyraPermissionModeArgs(["new", "--permission-mode"]),
  /requires a value/i,
  "a missing permission mode must fail at argument parsing",
);

assert.deepEqual(
  resolveTuiPermissionAttachFields({}, { profile: "default" }),
  {},
  "an ordinary attach must not overwrite the mode stored in the chat",
);
assert.deepEqual(
  resolveTuiPermissionAttachFields({ permissionMode: "full-access" }, { profile: "default" }),
  { runtimeMode: "full-access" },
  "an explicit full-access launch must be sent to the agent server",
);
assert.deepEqual(
  resolveTuiPermissionAttachFields({ permissionMode: "auto" }, { profile: "default" }),
  { runtimeMode: "auto-review" },
  "the auto alias must attach with automatic review",
);
assert.deepEqual(
  resolveTuiPermissionAttachFields({ permissionMode: "edits" }, { profile: "default" }),
  { runtimeMode: "edits-only" },
  "the edits alias must attach with edit-only authority",
);
assert.deepEqual(
  resolveTuiPermissionAttachFields({}, { profile: "yolo-fast" }),
  { runtimeMode: "full-access" },
  "the legacy yolo profile must retain its full-access behavior",
);
assert.deepEqual(ACCESS_MODES, ["supervised", "auto", "edits", "full"]);
assert.equal(getSlashCommand("/access")?.name, "access", "the TUI must expose the permission-mode command");
assert.equal(getSlashCommand("/permissions")?.name, "access", "the permissions alias must resolve to /access");

process.stdout.write("Zyra CLI permission mode tests passed\n");
