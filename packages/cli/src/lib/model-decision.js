/** Canonical model selection/fallback decision shared by parent and child tasks. */
const resolvedFallbacks = new WeakMap();

function endpointIdentity(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      ? `${url.protocol}//${url.host}`
      : null;
  } catch {
    return null;
  }
}

export function rememberModelFallback(result, requested, actual, reason) {
  if (!result || typeof result !== "object" || !reason) return result;
  const inner = resolvedFallbacks.get(result);
  const route =
    inner?.route ??
    Object.freeze({
      provider: actual.provider,
      model: actual.model,
      baseUrl: actual.baseUrl,
      apiKey: actual.apiKey,
    });
  const decision = normalizeModelDecision({
    requestedModel: requested.model,
    actualModel: route.model,
    provider: route.provider,
    fallbackReason: inner?.decision.fallbackReason ?? reason,
    region: actual.region,
    endpoint: endpointIdentity(route.baseUrl),
  });
  // Give each successful attempt its own identity even if a transport reuses
  // a response object. The credential route stays in process-local metadata.
  const response = { ...result };
  resolvedFallbacks.set(response, Object.freeze({ decision, route }));
  return response;
}

export function readModelFallback(result) {
  return resolvedFallbacks.get(result) ?? null;
}

export function normalizeModelDecision(input = {}) {
  return Object.freeze({
    requestedModel: input.requestedModel ?? input.requested ?? null,
    actualModel: input.actualModel ?? input.model ?? null,
    fallbackReason: input.fallbackReason ?? input.reason ?? null,
    provider: input.provider ?? null,
    region: input.region ?? null,
    endpoint: input.endpoint ?? input.baseUrl ?? null,
  });
}

export function inheritModelDecision(parent, child = {}) {
  const base = normalizeModelDecision(parent);
  const next = normalizeModelDecision(child);
  return normalizeModelDecision({
    ...base,
    ...next,
    requestedModel: next.requestedModel ?? base.requestedModel,
    actualModel: next.actualModel ?? base.actualModel,
    provider: next.provider ?? base.provider,
    region: next.region ?? base.region,
    endpoint: next.endpoint ?? base.endpoint,
    fallbackReason: next.fallbackReason ?? base.fallbackReason,
  });
}

export function modelDecisionTaskEvent(taskId, decision, parentTaskId = null) {
  return Object.freeze({
    type: "model_decision",
    taskId: taskId == null ? null : String(taskId),
    parentTaskId: parentTaskId == null ? null : String(parentTaskId),
    modelDecision: normalizeModelDecision(decision),
    at: new Date().toISOString(),
  });
}

export default {
  normalizeModelDecision,
  inheritModelDecision,
  modelDecisionTaskEvent,
};
