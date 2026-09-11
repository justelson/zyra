import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { withProviderStoreLock, writeProviderJson } from "../provider-transactions.mjs";
export const AGENT_ROLES = ["planner", "implementer", "reviewer", "debugger", "verifier", "researcher", "specialist"];
export const roleModelsPath = () => path.join(process.env.ZYRA_DATA_ROOT || homedir(), ".zyra", "agent-models.json");
export function readRoleModels(file = roleModelsPath()) {
  try { const value = JSON.parse(readFileSync(file, "utf8")); validate(value); return value; }
  catch (error) { if (error.code === "ENOENT") return {}; throw new Error("Agent model preferences could not be read."); }
}
function validate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid agent models.");
  for (const [provider, roles] of Object.entries(value)) {
    if (!/^[a-z0-9_-]+$/.test(provider) || !roles || typeof roles !== "object" || Array.isArray(roles)) throw new Error("Invalid provider.");
    for (const [role, model] of Object.entries(roles)) if (!AGENT_ROLES.includes(role) || typeof model !== "string" || !model.startsWith(`${provider}/`) || /\s/.test(model) || model.length > 300) throw new Error("Choose a model from this provider.");
  }
}
export async function saveRoleModel({ provider, role, model }, file = roleModelsPath()) {
  if (!/^[a-z0-9_-]+$/.test(provider) || !AGENT_ROLES.includes(role)) throw new Error("Choose a provider and agent role.");
  return withProviderStoreLock(file, async () => {
    const value = readRoleModels(file);
    const roles = { ...value[provider] };
    if (model === "inherit" || model === "") delete roles[role]; else roles[role] = model;
    const next = { ...value, [provider]: roles }; validate(next);
    await writeProviderJson(file, next); return next;
  });
}
