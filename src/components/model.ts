import type { CredentialType, TriggerSource, WorkflowDefinition } from '@/lib/workflow/types';

// Shapes the browser receives from the API. Kept together so every view reads the same fields.

export interface LastExecution {
  execution_id: string;
  status: string;
  trigger_source: TriggerSource;
  created_at: string;
  finished_at: string | null;
}

export interface WorkflowRow {
  id: string;
  name: string;
  version: number;
  definition: WorkflowDefinition;
  is_active: boolean;
  route_color: number;
  updated_at: string;
  last_execution?: LastExecution | null;
}

export interface Usage {
  plan: string;
  runs: number;
  quota: number;
  activeWorkflows: number;
  activeLimit: number;
  webhookPerMinute: number;
}

export interface Execution {
  id: string;
  status: string;
  trigger_source?: TriggerSource;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  output?: unknown;
  error?: string | null;
}

export interface ExecutionLog {
  node_id: string;
  status: string;
  summary: string;
  duration_ms: number;
  created_at: string;
  output?: { preview?: string; truncated?: boolean; attempts?: number } | null;
}

export interface Credential {
  id: string;
  name: string;
  type: CredentialType;
  header_name: string | null;
  key_version: number;
  created_at: string;
}

export type Detail = { execution: Execution; logs: ExecutionLog[] };

export type View = 'workflows' | 'credentials';
export type DockTab = 'history' | 'logs';
