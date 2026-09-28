import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inngest } from "../inngest/client";
import { nextRunAt } from "../workflow/schedule";
import { scheduleConfig } from "../workflow/validate";
import type { WorkflowDefinition } from "../workflow/types";
import { startExecution, type StartDeps, type StartInput, type StartResult } from "./start";

// Supabase/Inngest-backed dependencies for the execution helpers. The pure logic lives next door so it
// can be tested without a database.

export function startDeps(admin: SupabaseClient): StartDeps {
  return {
    async reserve(userId) {
      const { data, error } = await admin.rpc("reserve_run", { p_user_id: userId }).single();
      if (error || !data) throw new Error("errors.quotaUnavailable");
      const row = data as { allowed: boolean; used: number; quota: number; period_start: string };
      return { allowed: row.allowed, used: row.used, quota: row.quota, periodStart: row.period_start };
    },
    async release(userId, periodStart) {
      const { error } = await admin.rpc("release_run", { p_user_id: userId, p_period_start: periodStart });
      if (error) console.error("release_run failed", { code: error.code });
    },
    async insertExecution(row) {
      const { error } = await admin.from("executions").insert(row);
      if (error) throw error;
    },
    async markDispatchFailed(executionId, userId, workflowId) {
      const { error } = await admin.from("executions")
        .update({ status: "dispatch_failed", error: "errors.dispatchFailed", finished_at: new Date().toISOString() })
        .eq("id", executionId).eq("user_id", userId).eq("workflow_id", workflowId).eq("status", "pending");
      if (error) console.error("dispatch_failed mark failed", { code: error.code });
    },
    async send(event) {
      await inngest.send(event);
    },
  };
}

export function start(admin: SupabaseClient, input: StartInput): Promise<StartResult> {
  return startExecution(input, startDeps(admin));
}

/**
 * Keeps workflow_schedules in step with the definition: upserts the cron of a schedule trigger (next run
 * computed from now) or removes the row when the workflow has no runnable schedule.
 */
export async function syncSchedule(admin: SupabaseClient, workflow: { id: string; user_id: string; definition: WorkflowDefinition }): Promise<void> {
  const config = scheduleConfig(workflow.definition);
  const next = config ? nextRunAt(config.cron, config.timezone, new Date()) : null;
  if (!config || !next) {
    const { error } = await admin.from("workflow_schedules").delete().eq("workflow_id", workflow.id).eq("user_id", workflow.user_id);
    if (error) throw error;
    return;
  }
  const { error } = await admin.from("workflow_schedules").upsert({
    workflow_id: workflow.id, user_id: workflow.user_id, cron: config.cron, timezone: config.timezone, next_run_at: next.toISOString(),
  }, { onConflict: "workflow_id" });
  if (error) throw error;
}
