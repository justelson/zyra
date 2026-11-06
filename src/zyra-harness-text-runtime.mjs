import {
  detectHarness,
  ensureHarnessServe,
  runHarnessTextTurn,
} from "./opencode-harness.mjs";

export async function runZyraHarnessTextPrompt({
  modelId,
  prompt,
  systemPrompt,
  thinking,
  signal,
  cwd = process.cwd(),
  executable,
  detectHarness: detect = detectHarness,
  ensureHarnessServe: ensureServe = ensureHarnessServe,
  runHarnessTextTurn: runTextTurn = runHarnessTextTurn,
  fetchImpl,
  spawnImpl,
} = {}) {
  const selectedModelId = String(modelId ?? "").trim();
  if (!selectedModelId) throw new Error("An OpenCode harness model is required.");
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("A text prompt is required.");
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Text request was cancelled.");
  const detected = executable ? { executable } : await detect();
  if (!detected?.executable) throw new Error("OpenCode is not installed or its harness is unavailable.");
  const lease = await ensureServe({ cwd, executable: detected.executable, spawnImpl, fetchImpl });
  try {
    const reply = await runTextTurn({
      client: { ...lease.client, fetch: fetchImpl, cwd },
      modelId: selectedModelId,
      context: {
        ...(systemPrompt ? { systemPrompt } : {}),
        messages: [{ role: "user", content: prompt }],
      },
      signal,
      variant: thinking,
      fetchImpl,
      sessionIdRef: { current: null },
    });
    if (typeof reply?.text !== "string") throw new Error("OpenCode returned no text.");
    return reply.text;
  } finally {
    try { lease.release?.(); } catch {}
  }
}
