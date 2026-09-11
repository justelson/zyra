import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os"; import path from "node:path";
import { readRoleModels, saveRoleModel } from "../src/agents/role-model-preferences.mjs";
import { ModelRouter, normalizeModelSelector } from "../src/agents/model-router.mjs";
import { previewClaudeAgentFile } from "../src/agents/claude-importer.mjs";
const root = await mkdtemp(path.join(os.tmpdir(), "zyra-role-models-"));
try {
 const file = path.join(root, "roles.json");
 await saveRoleModel({ provider: "custom-fixture", role: "reviewer", model: "custom-fixture/CaseSensitive" }, file);
 await assert.rejects(saveRoleModel({ provider: "custom-fixture", role: "reviewer", model: "anthropic/other" }, file));
 const catalog = ["custom-fixture/CaseSensitive", "custom-fixture/chat", "openai-codex/gpt-5.6-terra"].map(key => ({ key, id:key.split("/")[1], model:{provider:key.split("/")[0],id:key.split("/")[1]}, eligible:true, availability:key.includes("terra") ? "available" : "unknown", reasoning:true,toolUse:true }));
 const router = new ModelRouter({catalog});
 assert.equal(normalizeModelSelector("custom-fixture/CaseSensitive").prefer,"custom-fixture/CaseSensitive");
 const input = { model:"role-default", role:"reviewer", inheritModel:"custom-fixture/chat", roleModels:readRoleModels(file) };
 assert.equal(router.route(input).selectedKey,"custom-fixture/CaseSensitive");
 assert.equal(router.route(input).fallback,false,"A saved role choice is not a fallback");
 assert.equal(router.route({...input, model:"custom-fixture/chat"}).selectedKey,"custom-fixture/chat");
 assert.equal(router.route({...input, model:"terra"}).selectedKey,"openai-codex/gpt-5.6-terra");
 await saveRoleModel({provider:"custom-fixture", role:"reviewer", model:"inherit"},file);
 assert.equal(router.route({...input,roleModels:readRoleModels(file)}).selectedKey,"custom-fixture/chat");
 const definition=path.join(root,"review.md"); await writeFile(definition,'---\nname: review\ndescription: Review code\nmodel: sonnet\ntools: Read\n---\nReview code.');
 assert.equal((await previewClaudeAgentFile(definition)).candidate.model.prefer,"terra");
 assert.equal((await previewClaudeAgentFile(definition,{model:"role-default"})).candidate.model.prefer,"role-default");
 console.log("Role models: persisted provider choices, case-sensitive IDs, explicit priority, inherit reset and opt-in Claude import passed");
} finally { await rm(root,{recursive:true,force:true}); }
