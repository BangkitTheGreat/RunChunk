// Shared domain contract for workflow definitions and execution.
// Only runnable nodes belong in the domain contract.

export type NodeType =
  | "trigger.manual"
  | "action.http"
  | "action.set_variable"
  | "control.condition"
  | "control.delay"
  | "output.response";

export type NodeCategory = "trigger" | "action" | "control" | "output";

export interface NodeCatalogEntry {
  type: NodeType;
  category: NodeCategory;
  implemented: boolean;
}

export const NODE_CATALOG: NodeCatalogEntry[] = [
  { type: "trigger.manual", category: "trigger", implemented: true },
  { type: "action.http", category: "action", implemented: true },
  { type: "action.set_variable", category: "action", implemented: true },
  { type: "control.condition", category: "control", implemented: true },
  { type: "control.delay", category: "control", implemented: true },
  { type: "output.response", category: "output", implemented: true },
];

export const CONDITION_OPERATORS = ["equals", "not_equals", "contains", "gt", "lt", "exists", "is_empty"] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];
/** Operators that ignore the right operand. */
export const UNARY_OPERATORS: readonly ConditionOperator[] = ["exists", "is_empty"];

/** Condition nodes route through exactly these source handles. */
export const CONDITION_HANDLES = ["true", "false"] as const;

export const DELAY_UNITS = { s: 1, m: 60, h: 3600 } as const;
export type DelayUnit = keyof typeof DELAY_UNITS;
/** One delay node may wait at most one hour. */
export const MAX_DELAY_SECONDS = 3600;
/** Hard ceiling on a run's lifetime, including every delay and retry wait. */
export const MAX_RUN_SECONDS = 24 * 3600;

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;
/** Methods whose replay can repeat a side effect on the target API. */
export const UNSAFE_RETRY_METHODS = ["POST", "PUT", "PATCH", "DELETE"];
export const MAX_RETRIES = 3;

export const CREDENTIAL_TYPES = ["api_key", "bearer", "basic"] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

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

export interface NodeLogEntry {
  nodeId: string;
  status: ExecutionStatus;
  summary?: string;
  durationMs: number;
}
