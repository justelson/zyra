export function formatControlObservation(prefix, observation, extras = {}) {
  const sourceElements = Array.isArray(observation?.elements) ? observation.elements : [];
  const elements = sourceElements
    .filter((element) => isUsefulObservationElement(element, observation))
    .slice(0, 256)
    .map(compactObservationElement);
  return `${prefix}\n${JSON.stringify({
    targetId: observation?.targetId,
    revision: observation?.revision,
    state: observation?.targetState,
    title: observation?.title,
    ...extras,
    focusedElementRef: observation?.focusedElementRef,
    elements,
    ...(elements.length < sourceElements.length ? { omittedElementCount: sourceElements.length - elements.length } : {}),
    truncation: observation?.truncation,
    redactions: observation?.redactions || [],
  }, null, 2)}`;
}

export function controlObservationSummary(observation) {
  return {
    targetId: observation?.targetId,
    revision: observation?.revision,
    state: observation?.targetState,
    elementCount: Array.isArray(observation?.elements) ? observation.elements.length : 0,
    screenshotAttached: Boolean(observation?.screenshotRef),
    redactions: observation?.redactions || [],
  };
}

function isUsefulObservationElement(element, observation) {
  if (!element) return false;
  const actions = Array.isArray(element.actions) ? element.actions : [];
  const states = Array.isArray(element.states) ? element.states : [];
  if (states.includes("offscreen")) return false;
  if (actions.length > 0 || element.sensitive || element.value !== undefined && element.value !== "" || element.description) return true;
  const name = String(element.name || "").trim();
  if (!name || name === "System" || name === "System Menu Bar") return false;
  const role = String(element.role || "control");
  if ((role === "window" || role === "titlebar") && name === String(observation?.title || "").trim()) return false;
  return true;
}

function compactObservationElement(element) {
  const actions = Array.isArray(element.actions) ? element.actions : [];
  const states = Array.isArray(element.states) ? element.states.filter((state) => state !== "enabled") : [];
  return {
    ...(actions.length ? { elementRef: element.elementRef } : {}),
    role: element.role,
    ...(element.name ? { name: element.name } : {}),
    ...(element.value !== undefined && element.value !== "" ? { value: element.value } : {}),
    ...(element.description ? { description: element.description } : {}),
    ...(actions.length ? { actions } : {}),
    ...(states.length ? { states } : {}),
    ...(element.sensitive ? { sensitive: true } : {}),
  };
}
