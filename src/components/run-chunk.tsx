'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, FormEvent, ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import type { Connection, Edge, EdgeChange, Node, NodeChange, NodeProps } from '@xyflow/react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Check,
  Code2,
  GitBranch,
  Globe2,
  History,
  KeyRound,
  LoaderCircle,
  LogOut,
  Moon,
  Play,
  Plus,
  Save,
  Sun,
  Timer,
  Trash2,
  Variable,
  Workflow,
  X,
} from 'lucide-react';
import {
  CONDITION_OPERATORS,
  CREDENTIAL_TYPES,
  DELAY_UNITS,
  HTTP_METHODS,
  MAX_RETRIES,
  UNARY_OPERATORS,
  UNSAFE_RETRY_METHODS,
  VARIABLE_KEY,
  FORBIDDEN_KEYS,
} from '@/lib/workflow/types';
import type { CredentialType, NodeType, WorkflowDefinition } from '@/lib/workflow/types';
import { createClient as createBrowserSupabase } from '@/lib/supabase/browser';

interface WorkflowRow {
  id: string;
  name: string;
  version: number;
  definition: WorkflowDefinition;
  updated_at: string;
}

interface Execution {
  id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  output?: unknown;
  error?: string | null;
}

interface ExecutionLog {
  node_id: string;
  status: string;
  summary: string;
  duration_ms: number;
  created_at: string;
  output?: { preview?: string; truncated?: boolean; attempts?: number } | null;
}

interface Credential {
  id: string;
  name: string;
  type: CredentialType;
  header_name: string | null;
  key_version: number;
  created_at: string;
}

interface StationData extends Record<string, unknown> {
  kind: NodeType;
  title: string;
  subtitle: string;
  status?: string;
  statusKey?: string;
  trueLabel: string;
  falseLabel: string;
}

type Detail = { execution: Execution; logs: ExecutionLog[] };

const SUPPORTED_KINDS: readonly NodeType[] = [
  'trigger.manual',
  'action.http',
  'action.set_variable',
  'control.condition',
  'control.delay',
  'output.response',
];

const NODE_LABELS: Record<NodeType, string> = {
  'trigger.manual': 'nodes.triggerManual',
  'action.http': 'nodes.actionHttp',
  'action.set_variable': 'nodes.actionSetVariable',
  'control.condition': 'nodes.controlCondition',
  'control.delay': 'nodes.controlDelay',
  'output.response': 'nodes.outputResponse',
};

const NODE_CATEGORY: Record<NodeType, 'trigger' | 'action' | 'control' | 'output'> = {
  'trigger.manual': 'trigger',
  'action.http': 'action',
  'action.set_variable': 'action',
  'control.condition': 'control',
  'control.delay': 'control',
  'output.response': 'output',
};

const DEFAULT_DATA: Record<NodeType, () => Record<string, unknown>> = {
  'trigger.manual': () => ({}),
  'action.http': () => ({ url: '', method: 'GET', headers: {} }),
  'action.set_variable': () => ({ values: {} }),
  'control.condition': () => ({ left: '{{$json.status}}', operator: 'equals', right: '200' }),
  'control.delay': () => ({ amount: 5, unit: 's' }),
  'output.response': () => ({ value: '{{$json}}' }),
};

function NodeIcon({ kind, size }: { kind: NodeType; size: number }) {
  switch (kind) {
    case 'trigger.manual':
      return <Play size={size} />;
    case 'action.http':
      return <Globe2 size={size} />;
    case 'action.set_variable':
      return <Variable size={size} />;
    case 'control.condition':
      return <GitBranch size={size} />;
    case 'control.delay':
      return <Timer size={size} />;
    default:
      return <Code2 size={size} />;
  }
}

function Station({ data, selected }: NodeProps<Node<StationData>>) {
  const stationStyle = { '--station-color': `var(--color-cat-${NODE_CATEGORY[data.kind]})` } as CSSProperties;
  const branching = data.kind === 'control.condition';
  return (
    <div
      className={`station ${selected ? 'station-selected' : ''} ${data.statusKey ? `station-${data.statusKey}` : ''}`}
      style={stationStyle}
    >
      {data.kind !== 'trigger.manual' && <Handle type="target" position={Position.Left} />}
      <span className="station-icon">
        <NodeIcon kind={data.kind} size={16} />
      </span>
      <div className="station-copy">
        <strong>{data.title}</strong>
        <span>{data.subtitle}</span>
        {data.status && <span>{data.status}</span>}
      </div>
      {data.statusKey && <span className={`station-status status-${data.statusKey}`} />}
      {branching ? (
        <>
          <Handle type="source" id="true" position={Position.Right} style={{ top: '30%' }} />
          <span className="port-label port-true">{data.trueLabel}</span>
          <Handle type="source" id="false" position={Position.Right} style={{ top: '70%' }} />
          <span className="port-label port-false">{data.falseLabel}</span>
        </>
      ) : (
        data.kind !== 'output.response' && <Handle type="source" position={Position.Right} />
      )}
    </div>
  );
}

const nodeTypes = { station: Station };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    cache: 'no-store',
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.status === 401) {
    window.location.assign('/login');
    throw new Error('errors.unauthorized');
  }
  if (!response.ok) {
    const errorKey = typeof data.error === 'string' ? data.error : 'errors.server';
    throw new Error(errorKey);
  }
  return data as T;
}

/** Collapses bursts of Realtime events into at most one in-flight refetch plus one follow-up. */
function coalesce(fn: () => Promise<void>) {
  let running = false;
  let again = false;
  const go = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await fn();
      } while (again);
    } finally {
      running = false;
    }
  };
  return go;
}

type Subscription = { table: 'executions' | 'execution_logs'; filter: string };

/**
 * Supabase Realtime (Postgres Changes, owner-filtered by RLS) as a change signal only: every event and every
 * (re)subscribe triggers a refetch through the API, which stays the source of truth. No polling.
 */
function useRealtimeRefetch(key: string | undefined, subscriptions: Subscription[], refetch: () => Promise<void>) {
  const [live, setLive] = useState<boolean | null>(null);
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);
  const subsKey = JSON.stringify(subscriptions);

  useEffect(() => {
    if (!key) return;
    const subs = JSON.parse(subsKey) as Subscription[];
    const run = coalesce(() => refetchRef.current());
    const onWake = () => void run();
    window.addEventListener('focus', onWake);
    window.addEventListener('online', onWake);
    // Initial load never waits for Realtime; an unreachable socket must not leave the view empty.
    void run();
    let supabase: ReturnType<typeof createBrowserSupabase>;
    try {
      supabase = createBrowserSupabase();
    } catch {
      return () => {
        window.removeEventListener('focus', onWake);
        window.removeEventListener('online', onWake);
      };
    }
    let channel = supabase.channel(`runchunk:${key}:${crypto.randomUUID()}`);
    for (const sub of subs) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: sub.table, filter: sub.filter },
        () => void run()
      );
    }
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setLive(true);
        // Covers events missed before the first subscribe and during any disconnect.
        void run();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setLive(false);
      }
    });
    return () => {
      window.removeEventListener('focus', onWake);
      window.removeEventListener('online', onWake);
      void supabase.removeChannel(channel);
      setLive(null);
    };
  }, [key, subsKey]);

  return live;
}

export default function RunChunk() {
  return (
    <ReactFlowProvider>
      <Workspace />
    </ReactFlowProvider>
  );
}

function Workspace() {
  const t = useTranslations();
  const locale = useLocale();
  const { screenToFlowPosition } = useReactFlow();

  const [view, setView] = useState<'workflows' | 'credentials'>('workflows');
  const [rows, setRows] = useState<WorkflowRow[]>([]);
  const [active, setActive] = useState<WorkflowRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<Execution[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState<'history' | 'logs'>('history');
  const [theme, setTheme] = useState(() =>
    typeof document === 'undefined' ? 'dark' : document.documentElement.dataset.theme ?? 'dark'
  );
  const [headers, setHeaders] = useState('');
  const [measured, setMeasured] = useState<Record<string, Node['measured']>>({});
  const [credentials, setCredentials] = useState<Credential[]>([]);

  const activeRef = useRef<WorkflowRow | null>(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const fail = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : 'errors.server');
  }, []);

  const translated = (key: string, values?: Record<string, string | number>): string => {
    return t.has(key as unknown as Parameters<typeof t>[0])
      ? t(key as unknown as Parameters<typeof t>[0], values)
      : key;
  };

  const loadCredentials = useCallback(async () => {
    const data = await request<{ credentials: Credential[] }>('/api/credentials');
    setCredentials(data.credentials);
  }, []);

  useEffect(() => {
    // ponytail: theme read via lazy state init; loading screen hides icon so no hydration mismatch.
    request<{ workflows: WorkflowRow[] }>('/api/workflows')
      .then((d) => setRows(d.workflows))
      .catch(fail)
      .finally(() => setLoading(false));
    // Credentials are optional for the editor; a Vault that is not configured must not block workflows.
    request<{ credentials: Credential[] }>('/api/credentials')
      .then((d) => setCredentials(d.credentials))
      .catch(() => setCredentials([]));
  }, [fail]);

  const workflowId = active?.id;
  const refreshHistory = useCallback(async () => {
    if (!workflowId) return;
    try {
      const data = await request<{ executions: Execution[] }>(`/api/executions?workflowId=${workflowId}`);
      if (activeRef.current?.id === workflowId) setHistory(data.executions);
    } catch (e) {
      fail(e);
    }
  }, [workflowId, fail]);
  const historyLive = useRealtimeRefetch(
    workflowId,
    workflowId ? [{ table: 'executions', filter: `workflow_id=eq.${workflowId}` }] : [],
    refreshHistory
  );

  const executionId = detail?.execution.id;
  const refreshDetail = useCallback(async () => {
    if (!executionId) return;
    try {
      const data = await request<Detail>(`/api/executions/${executionId}`);
      setDetail((current) => (current?.execution.id === executionId ? data : current));
    } catch (e) {
      fail(e);
    }
  }, [executionId, fail]);
  const detailLive = useRealtimeRefetch(
    executionId,
    executionId
      ? [
          { table: 'executions', filter: `id=eq.${executionId}` },
          { table: 'execution_logs', filter: `execution_id=eq.${executionId}` },
        ]
      : [],
    refreshDetail
  );
  const live = executionId ? detailLive : historyLive;

  const change = (definition: WorkflowDefinition) => {
    setActive((a) => (a ? { ...a, definition } : a));
    setDirty(true);
  };

  const save = useCallback(async (): Promise<boolean> => {
    const current = activeRef.current;
    if (!current) return false;
    setBusy(true);
    setError('');
    try {
      const { workflow } = await request<{ workflow: WorkflowRow }>(`/api/workflows/${current.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: current.name,
          definition: current.definition,
          expectedVersion: current.version,
        }),
      });
      setRows((r) => r.map((row) => (row.id === workflow.id ? workflow : row)));
      if (activeRef.current === current) {
        setActive(workflow);
        setDirty(false);
      } else {
        setActive((a) => (a && a.id === workflow.id ? { ...a, version: workflow.version } : a));
      }
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(false);
    }
  }, [fail]);

  const remove = useCallback(() => {
    if (active && selected) {
      change({
        nodes: active.definition.nodes.filter((n) => n.id !== selected),
        edges: active.definition.edges.filter((e) => e.source !== selected && e.target !== selected),
      });
      setSelected(null);
    }
  }, [active, selected]);

  useEffect(() => {
    const listener = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      } else if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        selected &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)
      ) {
        e.preventDefault();
        remove();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [save, selected, remove]);

  useEffect(() => {
    if (!dirty) return;
    const listener = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [dirty]);

  const open = (row: WorkflowRow | null, nextView: 'workflows' | 'credentials' = 'workflows') => {
    if (dirty && !confirm(t('editor.discard'))) return;
    setView(nextView);
    setActive(row);
    setMeasured({});
    setDirty(false);
    setSelected(null);
    setError('');
    setDetail(null);
    setHistory([]);
  };

  const create = async () => {
    setBusy(true);
    setError('');
    setDetail(null);
    setHistory([]);
    try {
      const { workflow } = await request<{ workflow: WorkflowRow }>('/api/workflows', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim() || t('dashboard.untitled'),
          definition: {
            nodes: [{ id: 'manual', type: 'trigger.manual', position: { x: 100, y: 140 }, data: {} }],
            edges: [],
          },
        }),
      });
      setRows((r) => [workflow, ...r]);
      setActive(workflow);
      setMeasured({});
      setName('');
      setDirty(false);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const add = (type: NodeType, position = { x: 150 + (active?.definition.nodes.length ?? 0) * 230, y: 140 }) => {
    if (!active) return;
    change({
      ...active.definition,
      nodes: [...active.definition.nodes, { id: `node-${crypto.randomUUID()}`, type, position, data: DEFAULT_DATA[type]() }],
    });
  };

  const connect = (connection: Connection) => {
    if (!active || !connection.source || !connection.target) return;
    // One edge per source/target pair; the server rejects duplicates.
    if (active.definition.edges.some((e) => e.source === connection.source && e.target === connection.target)) return;
    change({
      ...active.definition,
      edges: addEdge(
        {
          id: `e-${connection.source}-${connection.sourceHandle ?? 'out'}-${connection.target}`,
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle ?? null,
          targetHandle: connection.targetHandle ?? null,
        },
        active.definition.edges
      ),
    });
  };

  const choose = (id: string) => {
    setSelected(id);
    const targetNode = active?.definition.nodes.find((n) => n.id === id);
    setHeaders(JSON.stringify(targetNode?.data.headers ?? {}, null, 2));
  };

  const currentNode = active?.definition.nodes.find((n) => n.id === selected);

  const update = (data: Record<string, unknown>) => {
    if (active && currentNode) {
      change({
        ...active.definition,
        nodes: active.definition.nodes.map((n) => (n.id === currentNode.id ? { ...n, data: { ...n.data, ...data } } : n)),
      });
    }
  };

  const run = async () => {
    if (!active) return;
    const ok = await save();
    if (!ok) return;
    setBusy(true);
    try {
      const { executionId } = await request<{ executionId: string }>(`/api/workflows/${active.id}/run`, {
        method: 'POST',
      });
      const data = await request<Detail>(`/api/executions/${executionId}`);
      setDetail(data);
      setHistory((h) => [data.execution, ...h.filter((ex) => ex.id !== executionId)]);
      setTab('logs');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const stamp = (value: string | null) => (value ? new Date(value).toLocaleString(locale) : '—');

  const nodeTitle = (id: string) => {
    const found = active?.definition.nodes.find((n) => n.id === id);
    return found ? t(NODE_LABELS[found.type]) : id;
  };

  const subtitle = (n: WorkflowDefinition['nodes'][number]): string => {
    switch (n.type) {
      case 'action.http': {
        const credential = credentials.find((c) => c.id === n.data.credentialId);
        return `${String(n.data.method ?? 'GET')} · ${String(n.data.url || t('editor.configure'))}${credential ? ` · 🔑 ${credential.name}` : ''}`;
      }
      case 'output.response':
        return String(n.data.value ?? '{{$json}}');
      case 'control.condition': {
        const operator = String(n.data.operator ?? 'equals');
        const right = UNARY_OPERATORS.includes(operator as (typeof UNARY_OPERATORS)[number]) ? '' : ` ${String(n.data.right ?? '')}`;
        return `${String(n.data.left ?? '')} ${translated('operators.' + operator)}${right}`;
      }
      case 'control.delay':
        return `${String(n.data.amount ?? '')} ${translated('units.' + String(n.data.unit ?? 's'))}`;
      case 'action.set_variable':
        return Object.keys((n.data.values as Record<string, unknown>) ?? {}).join(', ') || t('editor.variables');
      default:
        return t('editor.manualHint');
    }
  };

  const logFor = (id: string) => detail?.logs.find((l) => l.node_id === id);

  const nodes: Node<StationData>[] = (active?.definition.nodes ?? []).map((n) => {
    const log = logFor(n.id);
    return {
      id: n.id,
      type: 'station',
      position: n.position,
      measured: measured[n.id],
      selected: n.id === selected,
      data: {
        kind: n.type,
        title: t(NODE_LABELS[n.type]),
        subtitle: subtitle(n),
        status: log ? translated(log.summary.startsWith('condition.') ? log.summary : 'status.' + log.status) : undefined,
        statusKey: log?.status,
        trueLabel: t('editor.portTrue'),
        falseLabel: t('editor.portFalse'),
      },
    };
  });

  const flowEdges: Edge[] = (active?.definition.edges ?? []).map((e) => {
    const targetLog = logFor(e.target);
    const sourceLog = logFor(e.source);
    // A route is dimmed once the run shows it was not taken.
    const taken = !detail || !targetLog || targetLog.status !== 'skipped' || sourceLog?.status === 'skipped';
    const color =
      e.sourceHandle === 'true'
        ? 'var(--color-success)'
        : e.sourceHandle === 'false'
          ? 'var(--color-jalur-l4)'
          : 'var(--color-jalur-l1)';
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
      type: 'smoothstep',
      label: e.sourceHandle ? translated(e.sourceHandle === 'true' ? 'editor.portTrue' : 'editor.portFalse') : undefined,
      style: { stroke: color, strokeWidth: 2, opacity: taken ? 1 : 0.3 },
    };
  });

  const handleNodesChange = (changes: NodeChange<Node<StationData>>[]) => {
    if (!active) return;
    const next = applyNodeChanges(changes, nodes);
    if (changes.some((c) => c.type === 'dimensions')) {
      setMeasured(Object.fromEntries(next.map((n) => [n.id, n.measured])));
    }
    if (changes.some((c) => c.type === 'position' || c.type === 'remove')) {
      change({
        nodes: next.map((n) => {
          const old = active.definition.nodes.find((item) => item.id === n.id)!;
          return { ...old, position: n.position };
        }),
        edges: active.definition.edges.filter(
          (e) => next.some((n) => n.id === e.source) && next.some((n) => n.id === e.target)
        ),
      });
    }
  };

  const handleEdgesChange = (changes: EdgeChange<Edge>[]) => {
    if (!active) return;
    if (changes.some((c) => c.type === 'remove')) {
      const nextEdges = applyEdgeChanges(changes, flowEdges);
      change({
        ...active.definition,
        edges: nextEdges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? null,
          targetHandle: e.targetHandle ?? null,
        })),
      });
    }
  };

  if (loading) {
    return (
      <main className="loading-screen">
        <LoaderCircle className="spin" />
        {t('common.loading')}
      </main>
    );
  }

  const method = String(currentNode?.data.method ?? 'GET');
  const retries = Number(currentNode?.data.retries ?? 0);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button type="button" onClick={() => open(null)} className="brand">
          <span className="brand-mark">
            <Workflow size={20} />
          </span>
          <span>runchunk</span>
        </button>
        <div className="workspace-label">{t('dashboard.workspace')}</div>
        <button className={`nav-item ${view === 'workflows' ? 'nav-active' : ''}`} onClick={() => open(null)}>
          <Workflow size={17} />
          {t('dashboard.title')}
        </button>
        <button
          className={`nav-item ${view === 'credentials' ? 'nav-active' : ''}`}
          onClick={() => open(null, 'credentials')}
        >
          <KeyRound size={17} />
          {t('common.credentials')}
        </button>
        <div className="side-bottom">
          <button
            className="nav-item"
            onClick={async () => {
              try {
                await request('/api/auth/logout', { method: 'POST' });
                window.location.assign('/login');
              } catch (e) {
                fail(e);
              }
            }}
          >
            <LogOut size={17} />
            {t('common.logout')}
          </button>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>{view === 'credentials' ? t('common.credentials') : t('dashboard.title')}</span>
            {active && (
              <>
                <span>/</span>
                <strong>{active.name}</strong>
              </>
            )}
          </div>
          <div className="top-actions">
            {active && (
              <span className="saved-label">
                <Check size={14} />
                {dirty ? t('common.unsaved') : t('common.saved')}
              </span>
            )}
            <button
              className="icon-button"
              aria-label={t('common.theme')}
              onClick={() => {
                const next = theme === 'dark' ? 'light' : 'dark';
                setTheme(next);
                document.documentElement.dataset.theme = next;
                document.cookie = `theme=${next};path=/;max-age=31536000;samesite=lax`;
              }}
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button
              className="locale-button"
              aria-label={t('common.language')}
              onClick={() => {
                if (dirty && !confirm(t('editor.discard'))) return;
                document.cookie = `locale=${locale === 'id' ? 'en' : 'id'};path=/;max-age=31536000;samesite=lax`;
                location.reload();
              }}
            >
              {locale.toUpperCase()}
            </button>
          </div>
        </header>

        {error && (
          <div className="error-banner" role="alert">
            {translated(error)}
            <button onClick={() => setError('')} aria-label={t('common.close')}>
              <X size={16} />
            </button>
          </div>
        )}

        {view === 'credentials' ? (
          <CredentialsView credentials={credentials} reload={loadCredentials} fail={fail} stamp={stamp} />
        ) : !active ? (
          <div className="workflow-home">
            <div className="page-heading">
              <div>
                <p className="eyebrow">{t('dashboard.studio')}</p>
                <h1>{t('dashboard.title')}</h1>
                <p>{t('dashboard.description')}</p>
              </div>
              <form
                className="create-row"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  void create();
                }}
              >
                <input
                  aria-label={t('dashboard.name')}
                  placeholder={t('dashboard.name')}
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                />
                <button className="primary-button" disabled={busy}>
                  <Plus size={16} />
                  {t('dashboard.create')}
                </button>
              </form>
            </div>
            {rows.length === 0 ? (
              <div className="empty-state">
                <div className="empty-route" aria-hidden="true">
                  <span className="empty-dot" />
                  <i />
                  <span className="empty-dot" />
                  <i />
                  <span className="empty-dot" />
                </div>
                <h2>{t('dashboard.emptyTitle')}</h2>
                <p>{t('dashboard.emptyBody')}</p>
                <button className="primary-button" onClick={create} disabled={busy}>
                  <Plus size={16} />
                  {t('dashboard.create')}
                </button>
              </div>
            ) : (
              <div className="workflow-list">
                {rows.map((row, i) => (
                  <button className="workflow-row" key={row.id} onClick={() => open(row)}>
                    <span className="route-color" style={{ background: `var(--color-jalur-l${(i % 6) + 1})` }} />
                    <Workflow size={18} />
                    <span className="workflow-name">{row.name}</span>
                    <time className="workflow-date">{stamp(row.updated_at)}</time>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="editor-toolbar">
              <div className="editor-title">
                <button className="back-button" aria-label={t('common.back')} onClick={() => open(null)}>
                  <ArrowLeft size={17} />
                </button>
                <input
                  aria-label={t('dashboard.name')}
                  value={active.name}
                  maxLength={120}
                  onChange={(e) => {
                    setActive({ ...active, name: e.target.value });
                    setDirty(true);
                  }}
                />
              </div>
              <div className="toolbar-buttons">
                <button className="secondary-button" disabled={busy} onClick={() => void save()}>
                  <Save size={15} />
                  {t('common.save')}
                  <kbd>Ctrl S</kbd>
                </button>
                <button className="primary-button" disabled={busy} onClick={run}>
                  <Play size={15} />
                  {busy ? t('common.loading') : t('common.run')}
                </button>
              </div>
            </div>

            <div className="editor-workspace">
              <aside className="palette">
                <div className="panel-title">
                  <div>
                    <h2>{t('editor.paletteTitle')}</h2>
                    <span>{t('editor.paletteHint')}</span>
                  </div>
                </div>
                {SUPPORTED_KINDS.map((kind) => (
                  <button
                    key={kind}
                    className="palette-node"
                    aria-label={t('editor.add', { name: t(NODE_LABELS[kind]) })}
                    draggable
                    onDragStart={(e: DragEvent<HTMLButtonElement>) => e.dataTransfer.setData('application/runchunk', kind)}
                    onClick={() => add(kind)}
                  >
                    <span className={`palette-icon ${NODE_CATEGORY[kind]}`}>
                      <NodeIcon kind={kind} size={15} />
                    </span>
                    <span>
                      <strong>{t(NODE_LABELS[kind])}</strong>
                      <small>{t('editor.clickAdd')}</small>
                    </span>
                  </button>
                ))}
              </aside>

              <div className="canvas-wrap">
                <div className="canvas-label">
                  <span className="live-dot" />
                  {t('editor.canvas')}
                  <span className="canvas-count">{t('editor.nodeCount', { count: nodes.length })}</span>
                </div>
                <ReactFlow
                  nodes={nodes}
                  edges={flowEdges}
                  nodeTypes={nodeTypes}
                  // React Flow tags its wrapper `light` by default, which pulls in the light theme tokens.
                  colorMode={theme === 'light' ? 'light' : 'dark'}
                  onNodesChange={handleNodesChange}
                  onEdgesChange={handleEdgesChange}
                  onConnect={connect}
                  onNodeClick={(_, n) => choose(n.id)}
                  onPaneClick={() => setSelected(null)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const kind = e.dataTransfer.getData('application/runchunk');
                    if (SUPPORTED_KINDS.includes(kind as NodeType)) {
                      add(kind as NodeType, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
                    }
                  }}
                  fitView
                >
                  <Background color="var(--color-canvas-dot)" gap={24} />
                  <Controls />
                </ReactFlow>
                <div className="canvas-hint">{t('editor.canvasHint')}</div>
              </div>

              {currentNode && (
                <aside className="config-panel">
                  <div className="config-heading">
                    <h2>{t('editor.drawerTitle')}</h2>
                    <button className="icon-button" aria-label={t('common.close')} onClick={() => setSelected(null)}>
                      <X size={16} />
                    </button>
                  </div>

                  <h2>{t(NODE_LABELS[currentNode.type])}</h2>

                  {currentNode.type === 'action.http' && (
                    <>
                      <label className="field-label">
                        {t('editor.method')}
                        <select value={method} onChange={(e) => update({ method: e.target.value })}>
                          {HTTP_METHODS.map((m) => (
                            <option key={m}>{m}</option>
                          ))}
                        </select>
                      </label>
                      <label className="field-label">
                        {t('editor.url')}
                        <input
                          value={String(currentNode.data.url ?? '')}
                          onChange={(e) => update({ url: e.target.value })}
                          placeholder="https://api.example.com/data"
                        />
                      </label>
                      <label className="field-label">
                        {t('editor.credential')}
                        <select
                          value={String(currentNode.data.credentialId ?? '')}
                          onChange={(e) => update({ credentialId: e.target.value || undefined })}
                        >
                          <option value="">{t('editor.noCredential')}</option>
                          {credentials.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} · {t(`credentials.type_${c.type}`)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="field-help">
                        {t('editor.credentialHint')}{' '}
                        <button className="link-button" onClick={() => open(null, 'credentials')}>
                          {t('editor.manageCredentials')}
                        </button>
                      </p>
                      <label className="field-label">
                        {t('editor.headers')}
                        <textarea
                          className="code-input"
                          rows={4}
                          value={headers}
                          onChange={(e) => {
                            setHeaders(e.target.value);
                            try {
                              const value: unknown = JSON.parse(e.target.value);
                              if (
                                !value ||
                                typeof value !== 'object' ||
                                Array.isArray(value) ||
                                Object.values(value).some((v) => typeof v !== 'string')
                              ) {
                                throw new Error();
                              }
                              update({ headers: value as Record<string, string> });
                              setError('');
                            } catch {
                              setError('errors.invalidHeaders');
                            }
                          }}
                        />
                      </label>
                      <p className="field-help">{t('editor.headersSecretHint')}</p>
                      <label className="field-label">
                        {t('editor.body')}
                        <textarea
                          className="code-input"
                          rows={5}
                          value={
                            typeof currentNode.data.body === 'string'
                              ? currentNode.data.body
                              : currentNode.data.body === undefined
                                ? ''
                                : JSON.stringify(currentNode.data.body)
                          }
                          onChange={(e) => update({ body: e.target.value })}
                        />
                      </label>
                      <label className="field-label">
                        {t('editor.retries')}
                        <select
                          value={retries}
                          onChange={(e) => update({ retries: Number(e.target.value) || undefined })}
                        >
                          {Array.from({ length: MAX_RETRIES + 1 }, (_, n) => (
                            <option key={n} value={n}>
                              {n === 0 ? t('editor.retryNone') : t('editor.retryCount', { count: n })}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="field-help">{t('editor.retriesHint')}</p>
                      {retries > 0 && UNSAFE_RETRY_METHODS.includes(method) && (
                        <p className="field-warning" role="alert">
                          <AlertTriangle size={14} />
                          {t('editor.retryWarning', { method })}
                        </p>
                      )}
                      <p className="field-help">{t('editor.httpWarning')}</p>
                    </>
                  )}

                  {currentNode.type === 'control.condition' && (
                    <>
                      <label className="field-label">
                        {t('editor.left')}
                        <input
                          className="code-input"
                          value={String(currentNode.data.left ?? '')}
                          onChange={(e) => update({ left: e.target.value })}
                          placeholder="{{$json.status}}"
                        />
                      </label>
                      <label className="field-label">
                        {t('editor.operator')}
                        <select
                          value={String(currentNode.data.operator ?? 'equals')}
                          onChange={(e) => update({ operator: e.target.value })}
                        >
                          {CONDITION_OPERATORS.map((op) => (
                            <option key={op} value={op}>
                              {t(`operators.${op}`)}
                            </option>
                          ))}
                        </select>
                      </label>
                      {!UNARY_OPERATORS.includes(
                        String(currentNode.data.operator ?? 'equals') as (typeof UNARY_OPERATORS)[number]
                      ) && (
                        <label className="field-label">
                          {t('editor.right')}
                          <input
                            className="code-input"
                            value={String(currentNode.data.right ?? '')}
                            onChange={(e) => update({ right: e.target.value })}
                            placeholder="404"
                          />
                        </label>
                      )}
                      <p className="field-help">{t('editor.conditionHint')}</p>
                    </>
                  )}

                  {currentNode.type === 'control.delay' && (
                    <>
                      <div className="field-row">
                        <label className="field-label">
                          {t('editor.amount')}
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={String(currentNode.data.amount ?? '')}
                            onChange={(e) => update({ amount: e.target.value === '' ? '' : Number(e.target.value) })}
                          />
                        </label>
                        <label className="field-label">
                          {t('editor.unit')}
                          <select
                            value={String(currentNode.data.unit ?? 's')}
                            onChange={(e) => update({ unit: e.target.value })}
                          >
                            {Object.keys(DELAY_UNITS).map((unit) => (
                              <option key={unit} value={unit}>
                                {t(`units.${unit}`)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <p className="field-help">{t('editor.delayHint')}</p>
                    </>
                  )}

                  {currentNode.type === 'action.set_variable' && (
                    <VariablesEditor
                      key={currentNode.id}
                      values={(currentNode.data.values as Record<string, unknown>) ?? {}}
                      onChange={(values) => update({ values })}
                    />
                  )}

                  {currentNode.type === 'output.response' && (
                    <>
                      <label className="field-label">
                        {t('editor.expression')}
                        <textarea
                          className="code-input"
                          rows={5}
                          value={String(currentNode.data.value ?? '{{$json}}')}
                          onChange={(e) => update({ value: e.target.value })}
                        />
                      </label>
                      <p className="field-help">
                        {t('editor.expressionHint')} <code>{'{{$json}}'}</code>
                      </p>
                    </>
                  )}

                  {currentNode.type === 'trigger.manual' && <p className="field-help">{t('editor.manualHint')}</p>}

                  <div className="config-bottom">
                    <button className="danger-button" onClick={remove}>
                      <Trash2 size={15} />
                      {t('common.delete')}
                    </button>
                  </div>
                </aside>
              )}
            </div>

            <footer className="execution-dock">
              <div className="dock-tabs">
                <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
                  <History size={15} />
                  {t('common.history')}
                  <span className="tab-count">{history.length}</span>
                </button>
                <button className={tab === 'logs' ? 'active' : ''} onClick={() => setTab('logs')}>
                  <Activity size={15} />
                  {t('common.logs')}
                </button>
                {live !== null && (
                  <span className={`live-indicator ${live ? 'is-live' : ''}`}>
                    <span className="live-dot" />
                    {live ? t('execution.live') : t('execution.offline')}
                  </span>
                )}
              </div>

              <div className="dock-content">
                {tab === 'history' ? (
                  history.length === 0 ? (
                    <p className="dock-empty">{t('execution.empty')}</p>
                  ) : (
                    history.map((ex) => (
                      <button
                        className="execution-item"
                        key={ex.id}
                        onClick={async () => {
                          try {
                            const data = await request<Detail>(`/api/executions/${ex.id}`);
                            setDetail(data);
                            setTab('logs');
                          } catch (e) {
                            fail(e);
                          }
                        }}
                      >
                        <span className={`status-pill status-${ex.status}`}>{translated('status.' + ex.status)}</span>
                        <time>{stamp(ex.started_at ?? ex.created_at)}</time>
                        <span className="execution-id">{ex.id.slice(0, 8)}</span>
                      </button>
                    ))
                  )
                ) : !detail ? (
                  <p className="dock-empty">{t('execution.select')}</p>
                ) : (
                  <>
                    <div className="execution-item">
                      <span className={`status-pill status-${detail.execution.status}`}>
                        {translated('status.' + detail.execution.status)}
                      </span>
                      <time>{stamp(detail.execution.started_at ?? detail.execution.created_at)}</time>
                      <span>
                        {t('execution.finished')}: {stamp(detail.execution.finished_at)}
                      </span>
                    </div>

                    {detail.execution.error && <p role="alert">{translated(detail.execution.error)}</p>}

                    {detail.logs.map((log, i) => (
                      <LogRow key={`${log.node_id}-${i}`} log={log} title={nodeTitle(log.node_id)} stamp={stamp}>
                        {translated('status.' + log.status)} · {translated(log.summary)}
                        {log.output?.attempts && log.output.attempts > 1
                          ? ` · ${t('execution.attempts', { count: log.output.attempts })}`
                          : ''}
                      </LogRow>
                    ))}

                    {detail.execution.output !== undefined && detail.execution.output !== null && (
                      <>
                        <h2>{t('execution.result')}</h2>
                        <pre className="result-output">{JSON.stringify(detail.execution.output, null, 2)}</pre>
                      </>
                    )}
                  </>
                )}
              </div>
            </footer>
          </>
        )}
      </section>
    </main>
  );
}

function LogRow({
  log,
  title,
  stamp,
  children,
}: {
  log: ExecutionLog;
  title: string;
  stamp: (value: string | null) => string;
  children: ReactNode;
}) {
  const t = useTranslations();
  return (
    <details className="log-entry">
      <summary className="log-item">
        <span className={`log-dot status-${log.status}`} />
        <strong>{title}</strong>
        <span>{children}</span>
        <time>{stamp(log.created_at)}</time>
        <small>{log.duration_ms} ms</small>
      </summary>
      {log.output?.preview !== undefined && (
        <div className="log-output">
          <span className="eyebrow">
            {t('execution.nodeOutput')}
            {log.output.truncated ? ` · ${t('execution.truncated')}` : ''}
          </span>
          <pre className="result-output">{log.output.preview}</pre>
        </div>
      )}
    </details>
  );
}

/** Translation key describing why these variable names cannot be committed, or '' when they can. */
function variableProblem(names: string[]): string {
  if (names.some((key) => !VARIABLE_KEY.test(key) || FORBIDDEN_KEYS.includes(key))) return 'editor.variableInvalid';
  return new Set(names).size !== names.length ? 'editor.variableDuplicate' : '';
}

function VariablesEditor({
  values,
  onChange,
}: {
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}) {
  const t = useTranslations();
  // Draft rows live here until every name is valid and unique; committing a duplicate through
  // Object.fromEntries would silently drop one of the values.
  const [entries, setEntries] = useState<[string, unknown][]>(() => Object.entries(values));
  const names = entries.map(([key]) => key);
  const problem = variableProblem(names);
  const write = (next: [string, unknown][]) => {
    setEntries(next);
    if (!variableProblem(next.map(([key]) => key))) onChange(Object.fromEntries(next));
  };
  return (
    <>
      <span className="field-label">{t('editor.variables')}</span>
      {entries.map(([key, value], index) => (
        <div className="variable-row" key={index}>
          <input
            aria-label={t('editor.variableKey')}
            placeholder={t('editor.variableKey')}
            value={key}
            maxLength={64}
            onChange={(e) => write(entries.map((entry, i) => (i === index ? [e.target.value, entry[1]] : entry)))}
          />
          <input
            className="code-input"
            aria-label={t('editor.variableValue')}
            placeholder="{{$json.data.id}}"
            value={typeof value === 'string' ? value : JSON.stringify(value)}
            onChange={(e) => write(entries.map((entry, i) => (i === index ? [entry[0], e.target.value] : entry)))}
          />
          <button
            className="icon-button"
            aria-label={t('editor.removeVariable', { name: key })}
            onClick={() => write(entries.filter((_, i) => i !== index))}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      {problem && (
        <p className="field-warning" role="alert">
          <AlertTriangle size={14} />
          {t(problem)}
        </p>
      )}
      <button
        className="secondary-button"
        disabled={names.includes('')}
        onClick={() => write([...entries, ['', '']])}
      >
        <Plus size={14} />
        {t('editor.addVariable')}
      </button>
      <p className="field-help">{t('editor.variableHint')}</p>
    </>
  );
}

function CredentialsView({
  credentials,
  reload,
  fail,
  stamp,
}: {
  credentials: Credential[];
  reload: () => Promise<void>;
  fail: (e: unknown) => void;
  stamp: (value: string | null) => string;
}) {
  const t = useTranslations();
  const empty = { name: '', type: 'bearer' as CredentialType, headerName: 'x-api-key', value: '', username: '', password: '' };
  const [form, setForm] = useState(empty);
  const [replacing, setReplacing] = useState<Credential | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    reload().catch(fail);
  }, [reload, fail]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      const body = {
        name: form.name,
        type: form.type,
        ...(form.type === 'api_key' ? { headerName: form.headerName, value: form.value } : {}),
        ...(form.type === 'bearer' ? { value: form.value } : {}),
        ...(form.type === 'basic' ? { username: form.username, password: form.password } : {}),
      };
      await request(replacing ? `/api/credentials/${replacing.id}` : '/api/credentials', {
        method: replacing ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      // Drop the secret from memory as soon as the server has it.
      setForm(empty);
      setReplacing(null);
      setNotice(t('credentials.saved'));
      await reload();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const destroy = async (credential: Credential) => {
    if (!confirm(t('credentials.deleteConfirm', { name: credential.name }))) return;
    try {
      await request(`/api/credentials/${credential.id}`, { method: 'DELETE' });
      await reload();
    } catch (error) {
      fail(error);
    }
  };

  return (
    <div className="workflow-home">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('credentials.eyebrow')}</p>
          <h1>{t('credentials.title')}</h1>
          <p>{t('credentials.description')}</p>
        </div>
      </div>

      <div className="credentials-layout">
        <form className="credential-form" onSubmit={submit} autoComplete="off">
          <h2>{replacing ? `${t('credentials.replace')}: ${replacing.name}` : t('credentials.create')}</h2>
          <label className="field-label">
            {t('credentials.name')}
            <input
              required
              maxLength={80}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="field-label">
            {t('credentials.type')}
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as CredentialType })}
            >
              {CREDENTIAL_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`credentials.type_${type}`)}
                </option>
              ))}
            </select>
          </label>
          {form.type === 'api_key' && (
            <label className="field-label">
              {t('credentials.headerName')}
              <input
                required
                className="code-input"
                maxLength={64}
                pattern="[A-Za-z0-9!#$%&'*+.^_`|~\-]+"
                value={form.headerName}
                onChange={(e) => setForm({ ...form, headerName: e.target.value })}
              />
            </label>
          )}
          {form.type === 'basic' ? (
            <>
              <label className="field-label">
                {t('credentials.username')}
                <input
                  required
                  maxLength={256}
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </label>
              <label className="field-label">
                {t('credentials.password')}
                <input
                  required
                  type="password"
                  minLength={4}
                  maxLength={1024}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </label>
            </>
          ) : (
            <label className="field-label">
              {t('credentials.value')}
              <input
                required
                type="password"
                minLength={8}
                maxLength={4096}
                autoComplete="new-password"
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
              />
            </label>
          )}
          <p className="field-help">{t('credentials.valueHint')}</p>
          <div className="toolbar-buttons">
            <button className="primary-button" disabled={busy}>
              <KeyRound size={15} />
              {replacing ? t('credentials.replace') : t('credentials.create')}
            </button>
            {replacing && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setReplacing(null);
                  setForm(empty);
                }}
              >
                {t('credentials.cancelReplace')}
              </button>
            )}
          </div>
          {notice && (
            <p className="field-help" role="status">
              <Check size={14} /> {notice}
            </p>
          )}
        </form>

        <div className="workflow-list credential-list">
          {credentials.length === 0 ? (
            <p className="dock-empty">{t('credentials.empty')}</p>
          ) : (
            credentials.map((credential) => (
              <div className="workflow-row" key={credential.id}>
                <KeyRound size={18} />
                <span className="workflow-name">
                  {credential.name}
                  <small>
                    {t(`credentials.type_${credential.type}`)}
                    {credential.header_name ? ` · ${credential.header_name}` : ''} · {t('credentials.secretHidden')} ·{' '}
                    {t('credentials.keyVersion', { version: credential.key_version })}
                  </small>
                </span>
                <time className="workflow-date">{stamp(credential.created_at)}</time>
                <button
                  className="secondary-button"
                  onClick={() => {
                    setReplacing(credential);
                    setForm({ ...empty, name: credential.name, type: credential.type, headerName: credential.header_name ?? 'x-api-key' });
                  }}
                >
                  {t('credentials.replace')}
                </button>
                <button
                  className="icon-button"
                  aria-label={`${t('common.delete')} ${credential.name}`}
                  onClick={() => void destroy(credential)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
