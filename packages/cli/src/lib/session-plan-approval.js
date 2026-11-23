import {
  appendAuthorityEvent,
  readVerifiedProjection,
  sessionExists,
} from "../harness/jsonl-session-store.js";
import { permissionProfileDigest } from "./permission-profile.js";
import { PlanModeManager, PlanStatus } from "./plan-mode.js";

const EVENT = "session_plan_approval";

function approvalFor(manager, lock) {
  const { sessionId } = manager;
  const approvedItems = lock?.approvedItemIds.map((id) => {
    const item = manager.currentPlan.getItem(id);
    return { id, tool: item.tool, params: item.params };
  });
  return {
    sessionId,
    planId: lock?.planId ?? null,
    permissionMode: lock?.permissionMode ?? null,
    permissionProfileDigest: lock
      ? permissionProfileDigest({ sessionId, lock, approvedItems })
      : null,
  };
}

export function openSessionPlan(
  sessionId,
  requestedMode,
  { permissionModeIsFallback = false } = {},
) {
  const manager = new PlanModeManager({ sessionId });
  const lock = manager.getExecutionLock();
  if (!lock && !sessionExists(sessionId))
    return { manager, permissionMode: requestedMode };

  const approval = approvalFor(manager, lock);
  const verified = readVerifiedProjection(sessionId, () => {
    let current = null;
    return {
      accept(event) {
        if (event.type === EVENT && event.data?.sessionId === sessionId)
          current = event.data;
      },
      finish() {
        return current;
      },
    };
  });
  if (!lock && verified?.permissionProfileDigest == null)
    return { manager, permissionMode: requestedMode };
  if (
    !lock ||
    verified?.planId !== approval.planId ||
    verified?.permissionMode !== approval.permissionMode ||
    verified?.permissionProfileDigest !== approval.permissionProfileDigest
  )
    throw new Error("The saved plan has no matching session approval receipt");
  if (
    !permissionModeIsFallback &&
    requestedMode !== undefined &&
    requestedMode !== lock.permissionMode
  )
    throw new Error(
      "Requested permission mode conflicts with the approved plan",
    );
  if (
    manager.lastEvent?.type === "plan-execution-started" ||
    manager.currentPlan.items.some(
      (item) => item.status === PlanStatus.EXECUTING,
    )
  )
    throw new Error(
      "An interrupted approved plan item requires reconciliation",
    );

  return { manager, permissionMode: lock.permissionMode };
}

export function recordSessionPlanApproval(manager) {
  const approval = approvalFor(manager, manager.getExecutionLock());
  const receipt = appendAuthorityEvent(manager.sessionId, EVENT, approval);
  if (!/^[a-f0-9]{64}$/u.test(receipt?.hash ?? ""))
    throw new Error("The session plan receipt was not committed");
  return approval;
}
