const PERMISSION_MODE_VALUE_FLAGS = new Set(["--permission-mode", "--permissions"]);
const FULL_ACCESS_FLAGS = new Set([
  "--full-access",
  "--danger-full-access",
  "--dangerously-bypass-approvals-and-sandbox",
  "--yolo",
]);
const AUTO_REVIEW_FLAGS = new Set(["--auto-review"]);
const EDITS_ONLY_FLAGS = new Set(["--edits-only"]);
const SUPERVISED_FLAGS = new Set(["--approval-required", "--safe", "--supervised"]);

export const ZYRA_PERMISSION_MODES = Object.freeze([
  "approval-required",
  "auto-review",
  "edits-only",
  "full-access",
]);

export function normalizeZyraPermissionMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["full-access", "full", "danger-full-access", "yolo"].includes(normalized)) return "full-access";
  if (["auto-review", "auto", "review", "guardian"].includes(normalized)) return "auto-review";
  if (["edits-only", "edit-only", "edits", "workspace-write"].includes(normalized)) return "edits-only";
  if (["approval-required", "approval", "safe", "supervised"].includes(normalized)) return "approval-required";
  return null;
}

export function isZyraPermissionMode(value) {
  return ZYRA_PERMISSION_MODES.includes(value);
}

export function extractZyraPermissionModeArgs(argv) {
  const input = Array.isArray(argv) ? argv : [];
  const args = [];
  let permissionMode;

  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index];
    const inlineValueFlag = typeof arg === "string"
      ? [...PERMISSION_MODE_VALUE_FLAGS].find((flag) => arg.startsWith(`${flag}=`))
      : null;
    if (inlineValueFlag) {
      permissionMode = normalizeZyraPermissionMode(arg.slice(inlineValueFlag.length + 1));
      if (!permissionMode) throw new Error("Permission mode must be one of: supervised, auto-review, edits-only, or full-access.");
      continue;
    }
    if (PERMISSION_MODE_VALUE_FLAGS.has(arg)) {
      const value = input[index + 1];
      if (!value || String(value).startsWith("-")) {
        throw new Error(`${arg} requires a value: supervised, auto-review, edits-only, or full-access.`);
      }
      permissionMode = normalizeZyraPermissionMode(value);
      if (!permissionMode) throw new Error("Permission mode must be one of: supervised, auto-review, edits-only, or full-access.");
      index += 1;
      continue;
    }
    if (FULL_ACCESS_FLAGS.has(arg)) {
      permissionMode = "full-access";
      continue;
    }
    if (AUTO_REVIEW_FLAGS.has(arg)) {
      permissionMode = "auto-review";
      continue;
    }
    if (EDITS_ONLY_FLAGS.has(arg)) {
      permissionMode = "edits-only";
      continue;
    }
    if (SUPERVISED_FLAGS.has(arg)) {
      permissionMode = "approval-required";
      continue;
    }
    args.push(arg);
  }

  return { args, permissionMode };
}
