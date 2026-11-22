/** Canonical model selection/fallback decision shared by parent and child tasks. */
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
