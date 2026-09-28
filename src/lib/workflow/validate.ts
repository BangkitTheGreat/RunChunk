import {
  CONDITION_HANDLES, CONDITION_OPERATORS, DELAY_UNITS, HTTP_METHODS, MAX_DELAY_SECONDS, MAX_RETRIES, MAX_RUN_SECONDS, NODE_CATALOG,
  type DelayUnit, type WorkflowDefinition, type WorkflowEdge, type WorkflowNode,
} from "./types";

const MAX_NODES = 100;
const MAX_EDGES = 300;
const MAX_BYTES = 256_000;
const MAX_VARIABLES = 50;
/** Worst case for one HTTP attempt (safeFetch deadline) used for the run-lifetime budget. */
export const HTTP_ATTEMPT_SECONDS = 10;
export const VARIABLE_KEY = /^[A-Za-z_][\w-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const supported = new Set(NODE_CATALOG.filter((node) => node.implemented).map((node) => node.type));

function invalid(): never {
  throw new Error("errors.invalidWorkflow");
}
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Seconds a `control.delay` node waits. Assumes the node passed validation. */
export function delaySeconds(node: WorkflowNode): number {
  return Number(node.data.amount) * DELAY_UNITS[(node.data.unit ?? "s") as DelayUnit];
}

/** Retry count configured on an HTTP node (0 when unset). */
export function retryCount(node: WorkflowNode): number {
  return node.type === "action.http" && node.data.retries !== undefined ? Number(node.data.retries) : 0;
}

/** Backoff before retry `attempt` (1-based): 2s, 4s, 8s. */
export function retryWaitSeconds(attempt: number): number {
  return 2 ** attempt;
}

/** Worst-case seconds a run of this definition can take; bounded by MAX_RUN_SECONDS. */
export function worstCaseSeconds(definition: WorkflowDefinition): number {
  let total = 0;
  for (const node of definition.nodes) {
    if (node.type === "control.delay") total += delaySeconds(node);
    if (node.type === "action.http") {
      const retries = retryCount(node);
      total += (retries + 1) * HTTP_ATTEMPT_SECONDS;
      for (let attempt = 1; attempt <= retries; attempt++) total += retryWaitSeconds(attempt);
    }
  }
  return total;
}

// Structural checks on typed fields. Free-text fields (url, expressions) stay lenient so drafts can be saved;
// the engine rejects them at run time.
function validateNodeData(node: WorkflowNode) {
  const data = node.data;
  switch (node.type) {
    case "action.http":
      if (data.method !== undefined && !HTTP_METHODS.includes(data.method as (typeof HTTP_METHODS)[number])) invalid();
      if (data.credentialId !== undefined && data.credentialId !== null && data.credentialId !== "" && (typeof data.credentialId !== "string" || !UUID.test(data.credentialId))) invalid();
      if (data.retries !== undefined && (!Number.isInteger(data.retries) || (data.retries as number) < 0 || (data.retries as number) > MAX_RETRIES)) invalid();
      if (data.headers !== undefined && !isRecord(data.headers)) invalid();
      break;
    case "control.condition":
      if (data.operator !== undefined && !CONDITION_OPERATORS.includes(data.operator as (typeof CONDITION_OPERATORS)[number])) invalid();
      break;
    case "control.delay": {
      if (data.unit !== undefined && !Object.hasOwn(DELAY_UNITS, data.unit as string)) invalid();
      if (typeof data.amount !== "number" || !Number.isInteger(data.amount) || data.amount < 1) invalid();
      const seconds = delaySeconds(node);
      if (seconds > MAX_DELAY_SECONDS) invalid();
      break;
    }
    case "action.set_variable": {
      if (data.values === undefined) break;
      if (!isRecord(data.values)) invalid();
      const keys = Object.keys(data.values as Record<string, unknown>);
      if (keys.length > MAX_VARIABLES || keys.some((key) => !VARIABLE_KEY.test(key) || FORBIDDEN_KEYS.has(key))) invalid();
      break;
    }
  }
}

export function validateDefinition(input: unknown): WorkflowDefinition {
  let encoded: string;
  try {
    encoded = JSON.stringify(input);
  } catch {
    return invalid();
  }
  if (!encoded || Buffer.byteLength(encoded) > MAX_BYTES || !isRecord(input)) invalid();
  const candidate = input as Record<string, unknown>;
  if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges) || candidate.nodes.length < 1 || candidate.nodes.length > MAX_NODES || candidate.edges.length > MAX_EDGES) invalid();
  const byId = new Map<string, WorkflowNode>();
  const nodes: WorkflowNode[] = (candidate.nodes as unknown[]).map((raw) => {
    if (!isRecord(raw)) invalid();
    const node = raw as Record<string, unknown>;
    if (typeof node.id !== "string" || !/^[\w-]{1,100}$/.test(node.id) || byId.has(node.id) || typeof node.type !== "string" || !supported.has(node.type as WorkflowNode["type"]) || !isRecord(node.position) || !isRecord(node.data)) invalid();
    const position = node.position as Record<string, unknown>;
    if (typeof position.x !== "number" || !Number.isFinite(position.x) || typeof position.y !== "number" || !Number.isFinite(position.y)) invalid();
    const typed = node as unknown as WorkflowNode;
    validateNodeData(typed);
    byId.set(typed.id, typed);
    return typed;
  });
  if (nodes.filter((node) => node.type === "trigger.manual").length !== 1) invalid();
  const pairs = new Set<string>();
  const edges: WorkflowEdge[] = (candidate.edges as unknown[]).map((raw) => {
    if (!isRecord(raw)) invalid();
    const edge = raw as Record<string, unknown>;
    if (typeof edge.id !== "string" || typeof edge.source !== "string" || typeof edge.target !== "string" || !byId.has(edge.source) || !byId.has(edge.target) || edge.source === edge.target || byId.get(edge.target)!.type === "trigger.manual") invalid();
    const source = byId.get(edge.source as string)!;
    if (source.type === "output.response") invalid();
    // Condition edges must leave through a named port; every other edge uses the default port.
    const handle = edge.sourceHandle ?? null;
    if (source.type === "control.condition" ? !CONDITION_HANDLES.includes(handle as (typeof CONDITION_HANDLES)[number]) : handle !== null) invalid();
    const pair = `${edge.source}\u0000${edge.target}`;
    if (pairs.has(pair)) invalid();
    pairs.add(pair);
    return edge as unknown as WorkflowEdge;
  });
  // A node may have several incoming edges (branches rejoining); the engine runs it only when exactly one is active.
  const edgeIds = new Set<string>();
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const adjacency = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) invalid();
    edgeIds.add(edge.id);
    adjacency.get(edge.source)!.push(edge.target);
    indegree.set(edge.target, indegree.get(edge.target)! + 1);
  }
  const queue = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.pop()!;
    visited++;
    for (const target of adjacency.get(id)!) {
      indegree.set(target, indegree.get(target)! - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  if (visited !== nodes.length) invalid();
  const definition = { nodes, edges };
  if (worstCaseSeconds(definition) > MAX_RUN_SECONDS) invalid();
  return definition;
}
