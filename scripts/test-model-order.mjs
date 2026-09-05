import assert from "node:assert/strict";
import { getLatestModelId, sortModelsLatestFirst } from "../src/model-order.mjs";

const runtime = (id, provider = "openai-codex") => ({ id, provider });
const selector = (id, provider = "openai-codex") => ({ id: `${provider}/${id}`, label: id });
const ids = (models) => models.map((model) => model.id);
const releases = ["gpt-5.6-luna", "gpt-6-astra", "gpt-5.6-sol", "gpt-7-example", "gpt-5.6-terra"];
const expected = ["gpt-7-example", "gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];
assert.deepEqual(ids(sortModelsLatestFirst(releases.map((id) => runtime(id)))), expected);
assert.deepEqual(ids(sortModelsLatestFirst(releases.map((id) => selector(id)))), expected.map((id) => `openai-codex/${id}`));
assert.equal(getLatestModelId(releases.map((id) => selector(id))), "openai-codex/gpt-7-example");
assert.equal(getLatestModelId(releases.slice(0, 3).map((id) => selector(id))), "openai-codex/gpt-6-astra");
assert.equal(getLatestModelId([runtime("gpt-5.6-sol")]), "gpt-5.6-sol");
assert.equal(getLatestModelId(), null);
assert.equal(getLatestModelId([]), null);
assert.equal(getLatestModelId([{ id: "custom/model", label: "GPT-99 latest" }]), null, "labels cannot manufacture release metadata");
assert.equal(getLatestModelId([runtime("gpt-latest"), runtime("gpt-6oops"), runtime("gpt-9007199254740992")] ), null);
assert.deepEqual(ids(sortModelsLatestFirst([
  runtime("gpt-6.9"), runtime("gpt-6.10"), runtime("gpt-6.10.1"), runtime("gpt-6"), runtime("gpt-6.10.1.2"),
])), ["gpt-6.10.1.2", "gpt-6.10.1", "gpt-6.10", "gpt-6.9", "gpt-6"]);

// Known equal-version tiers keep their documented order, without teaching the
// picker every future release name. Unranked equal versions retain input order.
assert.deepEqual(ids(sortModelsLatestFirst([
  runtime("gpt-5.6-terra"), runtime("gpt-5.6-luna"), runtime("gpt-5.6"), runtime("gpt-5.6-sol"),
])), ["gpt-5.6-sol", "gpt-5.6", "gpt-5.6-terra", "gpt-5.6-luna"]);
assert.deepEqual(ids(sortModelsLatestFirst([
  runtime("gpt-7-mini"), runtime("gpt-7-spark"), runtime("gpt-7-example"),
])), ["gpt-7-example", "gpt-7-mini", "gpt-7-spark"]);
assert.deepEqual(ids(sortModelsLatestFirst([
  runtime("gpt-7-example-b"), runtime("gpt-7-example-a"),
])), ["gpt-7-example-b", "gpt-7-example-a"]);
for (const make of [runtime, selector]) {
  const api = make("gpt-6-astra", "openai");
  const codex = make("gpt-6-astra", "openai-codex");
  assert.deepEqual(sortModelsLatestFirst([api, codex]), [codex, api], "prefer the existing subscription route for identical IDs");
}
const custom = [runtime("local-b"), runtime("claude-example"), runtime("local-a")];
assert.deepEqual(sortModelsLatestFirst(custom), custom);
assert.equal(getLatestModelId(custom), null);
const rich = Object.freeze({ ...selector("gpt-6-astra"), contextWindow: 1050000, supportedEfforts: ["high", "max"] });
const input = Object.freeze([Object.freeze(selector("gpt-5.6-sol")), rich]);
const sorted = sortModelsLatestFirst(input);
assert.equal(sorted[0], rich, "preserve metadata and object identity");
assert.notEqual(sorted, input);
assert.equal(input[0].id, "openai-codex/gpt-5.6-sol", "never mutate caller catalogs");
assert.deepEqual(sortModelsLatestFirst(sorted), sorted, "sorting is idempotent");
console.log("Shared model ordering contracts passed");
