import { inngest } from "./client";
import { validateDefinition } from "../workflow/validate";
import { executeWorkflow, type HttpAttemptResult, type LogEntry } from "../workflow/engine";
import { runHttpAttempt, type CredentialRow } from "../workflow/http-node";
import { safeFetch } from "../workflow/http";
import { createAdminClient } from "../supabase/admin";

/**
 * Execute one validated snapshot. Function-level retries stay at 0: HTTP side effects cannot be safely
 * replayed wholesale. Per-node retry (opt-in, 0-3) lives in the engine as separate steps.
 */
export const runWorkflow = inngest.createFunction(
  {
    id: "run-workflow", triggers: [{ event: "runchunk/workflow.run" }], retries: 0,
    onFailure: async ({ event }) => {
      const { executionId, userId, workflowId } = event.data.event.data;
      if (typeof executionId !== "string" || typeof userId !== "string" || typeof workflowId !== "string") return;
      const db = createAdminClient();
      const { data, error } = await db.from("executions").update({
        status: "failed", finished_at: new Date().toISOString(), output: null, error: "errors.workflowFailed",
      }).eq("id", executionId).eq("user_id", userId).eq("workflow_id", workflowId)
        .in("status", ["pending", "running"]).select("definition_snapshot").maybeSingle();
      if (error) throw new Error("errors.executionPersistenceFailed");
      if (!data) return;
      const { error: logError } = await db.from("execution_logs").update({ status: "failed", summary: "errors.workflowFailed" })
        .eq("execution_id", executionId).eq("status", "running");
      if (logError) throw new Error("errors.executionPersistenceFailed");
      const definition = validateDefinition(data.definition_snapshot);
      const { error: skippedError } = await db.from("execution_logs").upsert(
        definition.nodes.map((node) => ({ execution_id: executionId, node_id: node.id, status: "skipped", summary: "status.skipped", duration_ms: 0 })),
        { onConflict: "execution_id,node_id", ignoreDuplicates: true },
      );
      if (skippedError) throw new Error("errors.executionPersistenceFailed");
    },
  },
  async ({ event, step }) => {
    const data: unknown = event.data;
    if (!data || typeof data !== "object") throw new Error("errors.invalidEvent");
    const { executionId, userId, workflowId, triggerData } = data as Record<string, unknown>;
    if (typeof executionId !== "string" || typeof userId !== "string" || typeof workflowId !== "string") throw new Error("errors.invalidEvent");
    const db = createAdminClient();
    const { data: execution, error: loadError } = await db.from("executions")
      .select("definition_snapshot,workflow_id,status,created_at")
      .eq("id", executionId).eq("user_id", userId).eq("workflow_id", workflowId).single();
    if (loadError || !execution) throw new Error("errors.executionNotFound");
    if (execution.status !== "pending" && execution.status !== "running") return;

    const writeStatus = async (status: "running" | "success" | "failed", fields: Record<string, unknown> = {}) => {
      const now = new Date().toISOString();
      const { error } = await db.from("executions").update({
        status, ...(status === "running" ? { started_at: now } : { finished_at: now }), ...fields,
      }).eq("id", executionId).eq("user_id", userId).eq("workflow_id", workflowId);
      if (error) throw new Error("errors.executionPersistenceFailed");
    };
    const writeLog = async (entry: LogEntry) => {
      const { error } = await db.from("execution_logs").upsert({
        execution_id: executionId, node_id: entry.nodeId, status: entry.status, summary: entry.summary,
        duration_ms: entry.durationMs, output: entry.output ?? null,
      }, { onConflict: "execution_id,node_id" });
      if (error) throw new Error("errors.executionPersistenceFailed");
    };
    const loadCredential = async (credentialId: string): Promise<CredentialRow | null> => {
      // Service role bypasses RLS, so ownership is enforced here explicitly.
      const { data: row, error } = await db.from("credentials")
        .select("id,type,header_name,ciphertext,nonce,tag,key_version")
        .eq("id", credentialId).eq("user_id", userId).maybeSingle();
      if (error) throw new Error("errors.credentialNotFound");
      return row as CredentialRow | null;
    };

    try {
      const definition = validateDefinition(execution.definition_snapshot);
      await step.run("execution-running", () => writeStatus("running"));
      const output = await executeWorkflow(
        { definition, triggerData, runStartedAt: Date.parse(execution.created_at) },
        {
          step: {
            run: async <T>(id: string, fn: () => Promise<T>) => (await step.run(id, fn)) as T,
            sleep: (id, seconds) => step.sleep(id, `${seconds}s`),
          },
          writeLog,
          http: (request) => runHttpAttempt(request, { userId, loadCredential, fetch: safeFetch }) as Promise<HttpAttemptResult>,
          now: Date.now,
        },
      );
      await step.run("execution-success", () => writeStatus("success", { output }));
    } catch (error) {
      const reason = error instanceof Error && error.message.startsWith("errors.") ? error.message : "errors.workflowFailed";
      await step.run("execution-failed", () => writeStatus("failed", { output: null, error: reason }));
      // No retry; failed status and node logs already persisted.
    }
  },
);
