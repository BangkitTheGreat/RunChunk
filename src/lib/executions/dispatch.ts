import { nextRunAt } from "../workflow/schedule";
import { validateDefinition } from "../workflow/validate";
import type { ScheduleTriggerData, WorkflowDefinition } from "../workflow/types";
import type { StartInput, StartResult } from "./start";

// Schedule dispatcher logic, independent of Inngest and Supabase so the claim/dedupe rules can be tested.
// Each due row is a slot (schedule id + next_run_at). Advancing next_run_at with compare-and-swap is the
// claim: whoever wins the swap owns the slot, everyone else skips it. A crash between the claim and the
// dispatch loses that one slot (at-most-once); it is never fired twice.

export interface DueSchedule {
  id: string;
  workflow_id: string;
  user_id: string;
  cron: string;
  timezone: string;
  next_run_at: string;
}

export interface DispatchDeps {
  now(): Date;
  listDue(now: Date, limit: number): Promise<DueSchedule[]>;
  claim(id: string, expected: string, next: string): Promise<boolean>;
  loadWorkflow(workflowId: string, userId: string): Promise<{ definition: unknown; version: number; is_active: boolean } | null>;
  start(input: StartInput): Promise<StartResult>;
  /** Turns the workflow off and leaves one failed execution explaining why (quota, invalid definition). */
  pause(workflowId: string, userId: string, reason: string, snapshot: { definition: WorkflowDefinition; version: number; triggerData: unknown } | null): Promise<void>;
  removeSchedule(id: string): Promise<void>;
}

export type SlotOutcome = "started" | "lost-claim" | "inactive" | "paused-quota" | "paused-invalid" | "dispatch-failed";

export const DISPATCH_BATCH = 50;

/** Handles one due slot. Safe to call from a memoized Inngest step. */
export async function dispatchSlot(row: DueSchedule, deps: DispatchDeps): Promise<SlotOutcome> {
  const now = deps.now();
  // Next slot is computed from now, not from the missed one: a dispatcher that was down does not catch up.
  const next = nextRunAt(row.cron, row.timezone, now);
  if (!next) {
    await deps.removeSchedule(row.id);
    await deps.pause(row.workflow_id, row.user_id, "errors.scheduleInvalid", null);
    return "paused-invalid";
  }
  if (!(await deps.claim(row.id, row.next_run_at, next.toISOString()))) return "lost-claim";

  const workflow = await deps.loadWorkflow(row.workflow_id, row.user_id);
  if (!workflow || !workflow.is_active) return "inactive";
  let definition: WorkflowDefinition;
  try {
    definition = validateDefinition(workflow.definition);
  } catch {
    await deps.pause(row.workflow_id, row.user_id, "errors.invalidWorkflow", null);
    return "paused-invalid";
  }
  const triggerData: ScheduleTriggerData = { scheduledAt: row.next_run_at, timezone: row.timezone, cron: row.cron };
  const result = await deps.start({
    workflowId: row.workflow_id, userId: row.user_id, definition, version: workflow.version,
    triggerSource: "schedule", triggerData, eventId: `schedule:${row.id}:${row.next_run_at}`,
  });
  if (result.ok) return "started";
  if (result.reason === "quota") {
    // Out of runs: stop the schedule instead of failing silently every minute until the month ends.
    await deps.pause(row.workflow_id, row.user_id, "errors.quotaExceeded", { definition, version: workflow.version, triggerData });
    return "paused-quota";
  }
  return "dispatch-failed";
}
