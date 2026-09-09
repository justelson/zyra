import { controlObservationPayload } from "./observation-feedback.mjs";

export function formatWindowMatches(queryValue, windowsValue) {
  const query = String(queryValue || "").trim().slice(0, 128);
  const windows = Array.isArray(windowsValue) ? windowsValue.filter((entry) => entry && !entry.blocked) : [];
  if (windows.length === 0) return `No controllable Windows application matched ${JSON.stringify(query)}. Use computer_open_app if it is not running, then search again.`;
  return [
    `${windows.length} controllable window${windows.length === 1 ? "" : "s"} matched ${JSON.stringify(query)}:`,
    ...windows.slice(0, 16).map((entry, index) => `- match ${index + 1}: application ${JSON.stringify(String(entry.applicationName || "unknown").slice(0, 128))}; title ${JSON.stringify(String(entry.title || "Untitled").slice(0, 256))}; processId ${Number.isInteger(entry.processId) ? entry.processId : "unknown"}; candidateRef ${String(entry.windowToken || "").slice(0, 512)}`),
    "These titles belong only to the requested app search. Choose the exact matching candidateRef with computer_request_access. A new window requires its own grant; do not reuse another window's references. If the candidates remain indistinguishable, ask which one to use.",
  ].join("\n");
}

export function formatComputerObservation(prefix, observation) {
  const state = observation?.targetState;
  const recovery = state === "closed" || state === "detached"
    ? "The selected window ended or was replaced. Continue the requested task by calling computer_list_windows for the same application, then computer_request_access for the exact replacement. Do not replay the previous click, reuse old element references, or open another copy. Ask only if selection is still ambiguous or approval requires it."
    : state === "blocked"
      ? "The selected window could not be observed after bounded recovery. Do not act on stale references or keep retrying. Rediscover the same requested application once to check for a replacement window; report the blocker if the exact target remains unavailable."
      : undefined;
  const { elements, ...metadata } = controlObservationPayload(observation, recovery ? { recovery } : {});
  // A per-observation table saves repeated property names without caching references
  // across revisions. Optional details preserve values, state and redaction flags.
  const controls = elements.map(({ elementRef, role, name, actions, ...details }) => [
    elementRef ?? null, role ?? "control", name ?? "", actions ?? [],
    ...(Object.keys(details).length ? [details] : []),
  ]);
  return `${recovery ? "Computer observation unavailable." : prefix}\n${JSON.stringify({
    ...metadata,
    ...(observation?.viewport ? { viewport: observation.viewport } : {}),
    controlColumns: ["elementRef", "role", "name", "actions", "optionalDetails"],
    controls,
  })}`;
}
