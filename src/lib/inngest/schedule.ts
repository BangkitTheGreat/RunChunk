import { inngest } from "./client";
import { createAdminClient } from "../supabase/admin";
import { DISPATCH_BATCH, dispatchSlot, type DispatchDeps, type DueSchedule } from "../executions/dispatch";
import { start } from "../executions/db";

/**
 * One cron dispatcher for every user schedule. Runs each minute, claims due slots with compare-and-swap
 * (see dispatch.ts) and starts executions through the same quota path as manual runs. Each slot is its
 * own memoized step, so a retried invocation never dispatches a slot twice.
 */
export const dispatchSchedules = inngest.createFunction(
  { id: "schedule-dispatcher", triggers: [{ cron: "* * * * *" }], retries: 0 },
  async ({ step }) => {
    const db = createAdminClient();
    const deps: DispatchDeps = {
      now: () => new Date(),
      async listDue(now, limit) {
        const { data, error } = await db.rpc("due_schedules", { p_now: now.toISOString(), p_limit: limit });
        if (error) throw new Error("errors.schedulePersistenceFailed");
        return (data ?? []) as DueSchedule[];
      },
      async claim(id, expected, next) {
        const { data, error } = await db.rpc("claim_schedule", { p_id: id, p_expected: expected, p_next: next });
        if (error) throw new Error("errors.schedulePersistenceFailed");
        return data === true;
      },
      async loadWorkflow(workflowId, userId) {
        const { data, error } = await db.from("workflows").select("definition,version,is_active")
          .eq("id", workflowId).eq("user_id", userId).maybeSingle();
        if (error) throw new Error("errors.schedulePersistenceFailed");
        return data;
      },
      start: (input) => start(db, input),
      async pause(workflowId, userId, reason, snapshot) {
        await db.rpc("set_workflow_active", { p_workflow_id: workflowId, p_user_id: userId, p_active: false });
        if (!snapshot) return;
        const now = new Date().toISOString();
        await db.from("executions").insert({
          workflow_id: workflowId, user_id: userId, definition_snapshot: snapshot.definition, definition_version: snapshot.version,
          trigger_source: "schedule", trigger_data: snapshot.triggerData, status: "failed", error: reason, started_at: now, finished_at: now,
        });
      },
      async removeSchedule(id) {
        await db.from("workflow_schedules").delete().eq("id", id);
      },
    };

    const due = await step.run("list-due", () => deps.listDue(new Date(), DISPATCH_BATCH));
    const outcomes: Record<string, string> = {};
    for (const row of due) {
      outcomes[row.id] = await step.run(`slot-${row.id}-${row.next_run_at}`, () => dispatchSlot(row, deps));
    }
    await step.run("prune-rate-limits", async () => {
      await db.rpc("prune_rate_limits");
    });
    return { due: due.length, outcomes };
  },
);
