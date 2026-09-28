import { NODE_CATALOG, type WorkflowDefinition, type WorkflowEdge, type WorkflowNode } from "./types";

const MAX_NODES = 100;
const MAX_EDGES = 300;
const MAX_BYTES = 256_000;
const supported = new Set(NODE_CATALOG.filter((node) => node.implemented).map((node) => node.type));

export function validateDefinition(input: unknown): WorkflowDefinition {
  let encoded: string;
  try {
    encoded = JSON.stringify(input);
  } catch {
    throw new Error("errors.invalidWorkflow");
  }
  if (!encoded || Buffer.byteLength(encoded) > MAX_BYTES || !input || typeof input !== "object" || Array.isArray(input)) throw new Error("errors.invalidWorkflow");
  const candidate = input as Record<string, unknown>;
  if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges) || candidate.nodes.length < 1 || candidate.nodes.length > MAX_NODES || candidate.edges.length > MAX_EDGES) throw new Error("errors.invalidWorkflow");
  const ids = new Set<string>();
  const nodes: WorkflowNode[] = candidate.nodes.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("errors.invalidWorkflow");
    const node = raw as Record<string, unknown>;
    if (typeof node.id !== "string" || !/^[\w-]{1,100}$/.test(node.id) || ids.has(node.id) || typeof node.type !== "string" || !supported.has(node.type as WorkflowNode["type"]) || !node.position || typeof node.position !== "object" || !node.data || typeof node.data !== "object" || Array.isArray(node.data)) throw new Error("errors.invalidWorkflow");
    const position = node.position as Record<string, unknown>;
    if (typeof position.x !== "number" || !Number.isFinite(position.x) || typeof position.y !== "number" || !Number.isFinite(position.y)) throw new Error("errors.invalidWorkflow");
    ids.add(node.id);
    return node as unknown as WorkflowNode;
  });
  if (nodes.filter((node) => node.type === "trigger.manual").length !== 1) throw new Error("errors.invalidWorkflow");
  const edges: WorkflowEdge[] = candidate.edges.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("errors.invalidWorkflow");
    const edge = raw as Record<string, unknown>;
    if (typeof edge.id !== "string" || typeof edge.source !== "string" || typeof edge.target !== "string" || !ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target || nodes.find((node) => node.id === edge.target)!.type === "trigger.manual") throw new Error("errors.invalidWorkflow");
    return edge as unknown as WorkflowEdge;
  });
  const edgeIds = new Set<string>();
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const adjacency = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) throw new Error("errors.invalidWorkflow");
    edgeIds.add(edge.id);
    adjacency.get(edge.source)!.push(edge.target);
    indegree.set(edge.target, indegree.get(edge.target)! + 1);
    if (indegree.get(edge.target)! > 1) throw new Error("errors.invalidWorkflow");
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
  if (visited !== nodes.length) throw new Error("errors.invalidWorkflow");
  return { nodes, edges };
}
