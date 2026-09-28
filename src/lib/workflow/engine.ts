import { evaluateCondition } from "./condition";
import { resolveExpression, type ExpressionScope } from "./expression";
import { preview, redact } from "./redact";
import { delaySeconds, retryCount, retryWaitSeconds } from "./validate";
import { MAX_RUN_SECONDS, type ConditionOperator, type WorkflowDefinition, type WorkflowEdge, type WorkflowNode } from "./types";
import type { SafeHttpResponse } from "./http";

// Durable workflow executor, independent of Inngest so it can be tested with a fake step runner.
// Replay contract: everything outside `step.run`/`step.sleep` must be deterministic given earlier step results.

const MAX_OUTPUT_BYTES = 1_000_000;

export interface EngineStep {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
  sleep(id: string, seconds: number): Promise<void>;
}

export interface HttpNodeRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  credentialId?: string;
}

export type HttpAttemptResult =
  | { ok: true; response: SafeHttpResponse }
  | { ok: false; error: string; retryable: boolean };

export interface LogEntry {
  nodeId: string;
  status: "running" | "success" | "failed" | "skipped";
  summary: string;
  durationMs: number;
  output?: unknown;
}

export interface EngineDeps {
  step: EngineStep;
  writeLog(entry: LogEntry): Promise<void>;
  /** One HTTP attempt. Runs inside a step; must return (not throw) and must redact its own result. */
  http(request: HttpNodeRequest): Promise<HttpAttemptResult>;
  now(): number;
}

export interface EngineInput {
  definition: WorkflowDefinition;
  triggerData: unknown;
  /** Execution creation time (ms); the run-lifetime ceiling counts from here. */
  runStartedAt: number;
}

export class NodeFailure extends Error {
  constructor(public nodeId: string, public reason: string) {
    super("errors.workflowNodeFailed");
  }
}

/** 429 and 5xx are worth retrying; other statuses are the caller's problem. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function boundedOutput(value: unknown): unknown {
  const json = JSON.stringify(value ?? null);
  if (Buffer.byteLength(json) > MAX_OUTPUT_BYTES) throw new Error("errors.outputTooLarge");
  return JSON.parse(json) as unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Kahn order over the whole graph; validated definitions are acyclic. */
function topologicalOrder(definition: WorkflowDefinition, incoming: Map<string, WorkflowEdge[]>, outgoing: Map<string, WorkflowEdge[]>): WorkflowNode[] {
  const byId = new Map(definition.nodes.map((node) => [node.id, node]));
  const remaining = new Map(definition.nodes.map((node) => [node.id, incoming.get(node.id)!.length]));
  const ready = definition.nodes.filter((node) => remaining.get(node.id) === 0).map((node) => node.id);
  const order: WorkflowNode[] = [];
  for (let at = 0; at < ready.length; at++) {
    order.push(byId.get(ready[at])!);
    for (const edge of outgoing.get(ready[at])!) {
      remaining.set(edge.target, remaining.get(edge.target)! - 1);
      if (remaining.get(edge.target) === 0) ready.push(edge.target);
    }
  }
  return order;
}

function buildHttpRequest(node: WorkflowNode, scope: ExpressionScope): HttpNodeRequest {
  const url = resolveExpression(node.data.url, scope);
  const method = resolveExpression(node.data.method ?? "GET", scope);
  if (typeof url !== "string" || !url || typeof method !== "string") throw new Error("errors.httpInvalidUrl");
  const headers: Record<string, string> = {};
  if (node.data.headers !== undefined) {
    if (!isRecord(node.data.headers)) throw new Error("errors.httpInvalidHeaders");
    for (const [key, raw] of Object.entries(node.data.headers)) {
      const value = resolveExpression(raw, scope);
      if (typeof value !== "string") throw new Error("errors.httpInvalidHeaders");
      headers[key] = value;
    }
  }
  const body = node.data.body === undefined || node.data.body === "" ? undefined : resolveExpression(node.data.body, scope);
  const credentialId = typeof node.data.credentialId === "string" && node.data.credentialId ? node.data.credentialId : undefined;
  return { url, method: method.toUpperCase(), headers, body, credentialId };
}

/**
 * Run a validated definition. Branching rule: a node runs when exactly one incoming edge is active,
 * is skipped when none is, and fails when more than one is (two live branches rejoined without a Merge node).
 * Returns the final output; throws NodeFailure after persisting failed/skipped logs.
 */
export async function executeWorkflow(input: EngineInput, deps: EngineDeps): Promise<unknown> {
  const { definition, runStartedAt } = input;
  const triggerData = input.triggerData ?? {};
  const { step } = deps;
  const incoming = new Map(definition.nodes.map((node) => [node.id, [] as WorkflowEdge[]]));
  const outgoing = new Map(definition.nodes.map((node) => [node.id, [] as WorkflowEdge[]]));
  for (const edge of definition.edges) {
    outgoing.get(edge.source)!.push(edge);
    incoming.get(edge.target)!.push(edge);
  }
  const order = topologicalOrder(definition, incoming, outgoing);

  const outputs: Record<string, unknown> = {};
  const vars: Record<string, unknown> = {};
  const activeEdges = new Set<string>();
  const logged = new Set<string>();
  let finalOutput: unknown = triggerData;

  const log = async (id: string, entry: LogEntry) => {
    await step.run(id, () => deps.writeLog(entry));
    logged.add(entry.nodeId);
  };

  for (const node of order) {
    const active = incoming.get(node.id)!.filter((edge) => activeEdges.has(edge.id));
    if (node.type !== "trigger.manual" && active.length === 0) {
      await log(`log-skipped-${node.id}`, { nodeId: node.id, status: "skipped", summary: "status.skipped", durationMs: 0 });
      continue;
    }

    // Start time comes back memoized from the step, so durations and the deadline check survive replay.
    const started = await step.run(`log-running-${node.id}`, async () => {
      await deps.writeLog({ nodeId: node.id, status: "running", summary: "status.running", durationMs: 0 });
      return deps.now();
    });
    logged.add(node.id);

    let output: unknown;
    let summary = "status.success";
    let routes: WorkflowEdge[] = outgoing.get(node.id)!;
    let attempts: number | undefined;
    try {
      if (started - runStartedAt > MAX_RUN_SECONDS * 1000) throw new Error("errors.runTooLong");
      if (active.length > 1) throw new Error("errors.multipleActiveInputs");
      const predecessor = active[0]?.source;
      const json = predecessor ? outputs[predecessor] : triggerData;
      const scope: ExpressionScope = { json, node: outputs, vars, trigger: triggerData };

      switch (node.type) {
        case "trigger.manual":
          output = triggerData;
          break;
        case "action.http": {
          const request = buildHttpRequest(node, scope);
          const retries = retryCount(node);
          for (let attempt = 0; ; attempt++) {
            if (attempt > 0) await step.sleep(`retry-wait-${node.id}-${attempt}`, retryWaitSeconds(attempt));
            const result = await step.run(`node-${node.id}-attempt-${attempt}`, () => deps.http(request));
            attempts = attempt + 1;
            const canRetry = attempt < retries;
            if (result.ok) {
              if (canRetry && isRetryableStatus(result.response.status)) continue;
              output = result.response;
              break;
            }
            if (canRetry && result.retryable) continue;
            throw new Error(result.error);
          }
          break;
        }
        case "control.condition": {
          const operator = (node.data.operator ?? "equals") as ConditionOperator;
          const passed = evaluateCondition(operator, resolveExpression(node.data.left, scope), resolveExpression(node.data.right, scope));
          output = json;
          summary = passed ? "condition.true" : "condition.false";
          routes = routes.filter((edge) => edge.sourceHandle === String(passed));
          break;
        }
        case "control.delay":
          await step.sleep(`delay-${node.id}`, delaySeconds(node));
          output = json;
          break;
        case "action.set_variable": {
          const resolved = resolveExpression(node.data.values ?? {}, scope) as Record<string, unknown>;
          for (const [key, value] of Object.entries(resolved)) Object.defineProperty(vars, key, { value, enumerable: true, configurable: true, writable: true });
          output = { ...(isRecord(json) ? json : {}), ...resolved };
          break;
        }
        case "output.response":
          output = resolveExpression(node.data.value ?? "{{$json}}", scope);
          finalOutput = output;
          break;
        default:
          throw new Error("errors.invalidWorkflow");
      }
      output = boundedOutput(output);
    } catch (error) {
      const reason = error instanceof Error && error.message.startsWith("errors.") ? error.message : "errors.workflowNodeFailed";
      // Only the error key is persisted: no URL, headers, body, response, expression or raw exception.
      await log(`log-failed-${node.id}`, {
        nodeId: node.id, status: "failed", summary: reason, durationMs: Math.max(0, deps.now() - started),
        output: attempts ? { attempts } : undefined,
      });
      for (const pending of order) if (!logged.has(pending.id)) {
        await log(`log-skipped-${pending.id}`, { nodeId: pending.id, status: "skipped", summary: "status.skipped", durationMs: 0 });
      }
      throw new NodeFailure(node.id, reason);
    }

    outputs[node.id] = output;
    for (const edge of routes) activeEdges.add(edge.id);
    await step.run(`log-${node.id}`, () => deps.writeLog({
      nodeId: node.id, status: "success", summary, durationMs: Math.max(0, deps.now() - started),
      output: { ...preview(redact(output)), ...(attempts ? { attempts } : {}) },
    }));
  }
  return redact(finalOutput);
}
