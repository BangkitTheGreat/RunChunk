import { randomUUID } from "node:crypto";
import type { TriggerSource, WorkflowDefinition } from "../workflow/types";

// The one path that turns "please run this workflow" into an execution row plus an Inngest event.
// Manual button, public webhook and schedule dispatcher all go through here, so quota is reserved the
// same way for each and a failed dispatch never leaves a phantom reservation behind.

export interface StartInput {
  workflowId: string;
  userId: string;
  definition: WorkflowDefinition;
  version: number;
  triggerSource: TriggerSource;
  triggerData: unknown;
  /** Optional Inngest event id for dedupe (schedule slots). */
  eventId?: string;
}

export type StartResult =
  | { ok: true; executionId: string }
  | { ok: false; reason: "quota"; used: number; quota: number }
  | { ok: false; reason: "dispatch"; executionId: string };

export interface Reservation {
  allowed: boolean;
  used: number;
  quota: number;
  periodStart: string;
}

export interface ExecutionRow {
  id: string;
  workflow_id: string;
  user_id: string;
  definition_snapshot: WorkflowDefinition;
  definition_version: number;
  trigger_source: TriggerSource;
  trigger_data: unknown;
  status: "pending";
}

export interface StartDeps {
  reserve(userId: string): Promise<Reservation>;
  release(userId: string, periodStart: string): Promise<void>;
  insertExecution(row: ExecutionRow): Promise<void>;
  markDispatchFailed(executionId: string, userId: string, workflowId: string): Promise<void>;
  send(event: { id?: string; name: "runchunk/workflow.run"; data: Record<string, unknown> }): Promise<void>;
}

export async function startExecution(input: StartInput, deps: StartDeps): Promise<StartResult> {
  const reservation = await deps.reserve(input.userId);
  if (!reservation.allowed) return { ok: false, reason: "quota", used: reservation.used, quota: reservation.quota };

  const executionId = randomUUID();
  try {
    await deps.insertExecution({
      id: executionId, workflow_id: input.workflowId, user_id: input.userId,
      definition_snapshot: input.definition, definition_version: input.version,
      trigger_source: input.triggerSource, trigger_data: input.triggerData ?? {}, status: "pending",
    });
  } catch (error) {
    await deps.release(input.userId, reservation.periodStart);
    throw error;
  }

  try {
    await deps.send({
      id: input.eventId, name: "runchunk/workflow.run",
      data: { executionId, userId: input.userId, workflowId: input.workflowId, triggerData: input.triggerData ?? {} },
    });
  } catch (error) {
    console.error("inngest dispatch failed", { type: error instanceof Error ? error.name : "unknown" });
    await deps.markDispatchFailed(executionId, input.userId, input.workflowId);
    await deps.release(input.userId, reservation.periodStart);
    return { ok: false, reason: "dispatch", executionId };
  }
  return { ok: true, executionId };
}
