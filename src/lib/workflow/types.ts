// Shared domain contract for workflow definitions and execution.
// Only runnable week 1-2 nodes belong in the domain contract.

export type NodeType =
  | "trigger.manual"
  | "action.http"
  | "output.response";

export type NodeCategory = "trigger" | "action" | "control" | "output";

export interface NodeCatalogEntry {
  type: NodeType;
  category: NodeCategory;
  /** Minggu 1-2 implements only manual trigger, http action, response output. */
  implemented: boolean;
}

export const NODE_CATALOG: NodeCatalogEntry[] = [
  { type: "trigger.manual", category: "trigger", implemented: true },
  { type: "action.http", category: "action", implemented: true },
  { type: "output.response", category: "output", implemented: true },
];

export interface WorkflowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export type ExecutionStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped"
  | "partial_failed"
  | "dispatch_failed";

export interface ExecutionContext {
  workflowId: string;
  executionId: string;
  triggerData: unknown;
  nodeOutputs: Record<string, unknown>;
  variables: Record<string, unknown>;
  startedAt: string;
}

export interface NodeLogEntry {
  nodeId: string;
  status: ExecutionStatus;
  summary?: string;
  durationMs: number;
}
