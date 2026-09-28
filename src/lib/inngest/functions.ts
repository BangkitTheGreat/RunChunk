import { inngest } from "./client";
import { validateDefinition } from "../workflow/validate";
import { resolveExpression, type ExpressionScope } from "../workflow/expression";
import { safeFetch } from "../workflow/http";
import { createAdminClient } from "../supabase/admin";
import type { WorkflowNode } from "../workflow/types";

const MAX_OUTPUT_BYTES = 1_000_000;

function boundedOutput(value: unknown): unknown {
  const json = JSON.stringify(value ?? null);
  if (Buffer.byteLength(json) > MAX_OUTPUT_BYTES) throw new Error("errors.outputTooLarge");
  return JSON.parse(json) as unknown;
}

/** Execute one validated snapshot. No retries: HTTP side effects cannot be safely replayed. */
export const runWorkflow = inngest.createFunction(
  {
    id: "run-workflow", triggers: [{ event: "runchunk/workflow.run" }], retries: 0,
    onFailure: async ({ event }) => {
      const { executionId, userId, workflowId } = event.data.event.data;
      if (typeof executionId !== "string" || typeof userId !== "string" || typeof workflowId !== "string") return;
      const db = createAdminClient();
      const { data, error } = await db.from("executions").update({
        status: "failed", finished_at: new Date().toISOString(), output: { error: "errors.workflowFailed" },
      }).eq("id", executionId).eq("user_id", userId).eq("workflow_id", workflowId)
        .in("status", ["pending", "running"]).select("definition_snapshot").maybeSingle();
      if (error) throw new Error("errors.executionPersistenceFailed");
      if (!data) return;
      const { error: logError } = await db.from("execution_logs").update({ status: "failed", summary: "status.failed" })
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
      .select("definition_snapshot,workflow_id,status")
      .eq("id", executionId).eq("user_id", userId).eq("workflow_id", workflowId).single();
    if (loadError || !execution) throw new Error("errors.executionNotFound");
    if (execution.status !== "pending" && execution.status !== "running") return;

    const writeStatus = async (status: string, output?: unknown) => {
      const { error } = await db.from("executions").update({
        status, ...(status === "running" ? {} : { output: boundedOutput(output), finished_at: new Date().toISOString() }),
      }).eq("id", executionId).eq("user_id", userId).eq("workflow_id", workflowId);
      if (error) throw new Error("errors.executionPersistenceFailed");
    };
    const writeLog = async (nodeId: string, status: string, summary: string, durationMs: number) => {
      const { error } = await db.from("execution_logs").upsert({
        execution_id: executionId, node_id: nodeId, status, summary, duration_ms: durationMs,
      }, { onConflict: "execution_id,node_id" });
      if (error) throw new Error("errors.executionPersistenceFailed");
    };

    try {
      const definition = validateDefinition(execution.definition_snapshot);
      const byId = new Map(definition.nodes.map((node) => [node.id, node]));
      const outgoing = new Map(definition.nodes.map((node) => [node.id, [] as string[]]));
      const incoming = new Map(definition.nodes.map((node) => [node.id, [] as string[]]));
      for (const edge of definition.edges) {
        outgoing.get(edge.source)!.push(edge.target);
        incoming.get(edge.target)!.push(edge.source);
      }
      const trigger = definition.nodes.find((node) => node.type === "trigger.manual")!;
      const reachable = new Set([trigger.id]);
      const queue = [trigger.id];
      for (let at = 0; at < queue.length; at++) {
        for (const next of outgoing.get(queue[at])!) if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
      const remaining = new Map(definition.nodes.map((node) => [node.id, incoming.get(node.id)!.length]));
      const ready = definition.nodes.filter((node) => remaining.get(node.id) === 0).map((node) => node.id);
      const order: WorkflowNode[] = [];
      for (let at = 0; at < ready.length; at++) {
        const id = ready[at];
        if (reachable.has(id)) order.push(byId.get(id)!);
        for (const next of outgoing.get(id)!) {
          remaining.set(next, remaining.get(next)! - 1);
          if (remaining.get(next) === 0) ready.push(next);
        }
      }
      await step.run("execution-running", () => writeStatus("running"));
      const outputs: Record<string, unknown> = {};
      let finalOutput: unknown = triggerData ?? {};
      for (const node of order) {
        const started = Date.now();
        try {
          await step.run(`log-running-${node.id}`, () => writeLog(node.id, "running", "status.running", 0));
          const predecessor = incoming.get(node.id)![0];
          const scope: ExpressionScope = { json: predecessor ? outputs[predecessor] : triggerData ?? {}, node: outputs, vars: {}, trigger: triggerData ?? {} };
          let output: unknown;
          if (node.type === "trigger.manual") output = triggerData ?? {};
          else if (node.type === "action.http") {
            const url = resolveExpression(node.data.url, scope);
            const method = resolveExpression(node.data.method ?? "GET", scope);
            if (typeof url !== "string" || typeof method !== "string") throw new Error("errors.httpInvalidUrl");
            const headers: Record<string, string> = {};
            if (node.data.headers !== undefined) {
              if (!node.data.headers || typeof node.data.headers !== "object" || Array.isArray(node.data.headers)) throw new Error("errors.httpInvalidHeaders");
              for (const [key, raw] of Object.entries(node.data.headers)) {
                const value = resolveExpression(raw, scope);
                if (typeof value !== "string") throw new Error("errors.httpInvalidHeaders");
                headers[key] = value;
              }
            }
            const body = node.data.body === undefined ? undefined : resolveExpression(node.data.body, scope);
            output = await step.run(`node-${node.id}`, () => safeFetch({ url, method, headers, body }));
          } else if (node.type === "output.response") {
            output = resolveExpression(node.data.value ?? "{{$json}}", scope);
            finalOutput = output;
          } else throw new Error("errors.invalidWorkflow");
          output = boundedOutput(output);
          outputs[node.id] = output;
          const summary = "status.success";
          await step.run(`log-${node.id}`, () => writeLog(node.id, "success", summary, Date.now() - started));
        } catch {
          // No request URL, headers, body, response, expression or raw exception reaches logs.
          await step.run(`log-failed-${node.id}`, () => writeLog(node.id, "failed", "status.failed", Date.now() - started));
          for (const pending of definition.nodes) if (pending.id !== node.id && !Object.hasOwn(outputs, pending.id)) {
            await step.run(`log-skipped-${pending.id}`, () => writeLog(pending.id, "skipped", "status.skipped", 0));
          }
          throw new Error("errors.workflowNodeFailed");
        }
      }
      for (const node of definition.nodes) if (!reachable.has(node.id)) {
        await step.run(`log-skipped-${node.id}`, () => writeLog(node.id, "skipped", "status.skipped", 0));
      }
      await step.run("execution-success", () => writeStatus("success", finalOutput));
    } catch {
      await step.run("execution-failed", () => writeStatus("failed", { error: "errors.workflowFailed" }));
      // No retry; failed status and node log already persisted.
    }
  },
);
