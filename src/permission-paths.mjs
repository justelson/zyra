import path from "node:path";
import { lstatSync, realpathSync } from "node:fs";

// Static import lets Bun include the pinned helpers in standalone executables.
// Both the checkout and staged Desktop runtime keep src beside node_modules.
// edit/write/grep/find/ls use resolveToCwd in Pi 0.84.3; read adds ordered fallbacks.
import { resolveToCwd, resolveReadPath } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/path-utils.js";

export function resolvePermissionPath(value, project, toolName) {
  return toolName === "read" ? resolveReadPath(value, project) : resolveToCwd(value, project);
}

export function canonicalPermissionPath(value) {
  let ancestor = path.resolve(value);
  const suffix = [];
  for (;;) {
    try {
      return path.join(realpathSync.native(ancestor), ...suffix);
    } catch (error) {
      if (error.code !== "ENOENT") return null;
      // A dangling link is not a new path component. Never authorize it by
      // falling back to its lexical parent. Fail closed on inaccessible paths.
      try {
        lstatSync(ancestor);
        return null;
      } catch (statError) {
        if (statError.code !== "ENOENT") return null;
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) return null;
      suffix.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
}
