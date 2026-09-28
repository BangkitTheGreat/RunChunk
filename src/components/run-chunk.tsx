'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, FormEvent } from 'react';
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
  ArrowLeft,
  Check,
  Code2,
  Globe2,
  History,
  LoaderCircle,
  LogOut,
  Moon,
  Play,
  Plus,
  Save,
  Sun,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';
import type { NodeType, WorkflowDefinition } from '@/lib/workflow/types';

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
  error?: string;
}

interface ExecutionLog {
  node_id: string;
  status: string;
  summary: string;
  duration_ms: number;
  created_at: string;
}

interface StationData extends Record<string, unknown> {
  kind: string;
  title: string;
  subtitle: string;
  status?: string;
}

const SUPPORTED_KINDS: readonly NodeType[] = ['trigger.manual', 'action.http', 'output.response'];

const NODE_LABELS: Record<string, string> = {
  'trigger.manual': 'nodes.triggerManual',
  'action.http': 'nodes.actionHttp',
  'output.response': 'nodes.outputResponse',
};

const NODE_COLORS: Record<string, string> = {
  'trigger.manual': 'var(--color-cat-trigger)',
  'action.http': 'var(--color-cat-action)',
  'output.response': 'var(--color-cat-output)',
};

function Station({ data, selected }: NodeProps<Node<StationData>>) {
  const stationStyle = { '--station-color': NODE_COLORS[data.kind] } as CSSProperties;
  return (
    <div className={`station ${selected ? 'station-selected' : ''}`} style={stationStyle}>
      {data.kind !== 'trigger.manual' && <Handle type="target" position={Position.Left} />}
      <span className="station-icon">
        {data.kind === 'trigger.manual' ? (
          <Play size={16} />
        ) : data.kind === 'action.http' ? (
          <Globe2 size={16} />
        ) : (
          <Code2 size={16} />
        )}
      </span>
      <div className="station-copy">
        <strong>{data.title}</strong>
        <span>{data.subtitle}</span>
        {data.status && <span>{data.status}</span>}
      </div>
      {data.kind !== 'output.response' && <Handle type="source" position={Position.Right} />}
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

  const [rows, setRows] = useState<WorkflowRow[]>([]);
  const [active, setActive] = useState<WorkflowRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<Execution[]>([]);
  const [detail, setDetail] = useState<{ execution: Execution; logs: ExecutionLog[] } | null>(null);
  const [tab, setTab] = useState<'history' | 'logs'>('history');
  const [theme, setTheme] = useState(() =>
    typeof document === 'undefined' ? 'dark' : document.documentElement.dataset.theme ?? 'dark'
  );
  const [headers, setHeaders] = useState('');
  const [measured, setMeasured] = useState<Record<string, Node['measured']>>({});

  const activeRef = useRef<WorkflowRow | null>(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const fail = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : 'errors.server');
  }, []);

  const translated = (key: string): string => {
    return t.has(key as unknown as Parameters<typeof t>[0])
      ? t(key as unknown as Parameters<typeof t>[0])
      : key;
  };

  useEffect(() => {
    // ponytail: theme read via lazy state init; loading screen hides icon so no hydration mismatch.
    request<{ workflows: WorkflowRow[] }>('/api/workflows')
      .then((d) => setRows(d.workflows))
      .catch(fail)
      .finally(() => setLoading(false));
  }, [fail]);

  const workflowId = active?.id;
  useEffect(() => {
    // history/detail reset happens in open()/create() when workflow changes.
    if (!workflowId) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const data = await request<{ executions: Execution[] }>(
          `/api/executions?workflowId=${workflowId}`
        );
        if (!cancelled) setHistory(data.executions);
      } catch (e) {
        if (!cancelled) fail(e);
      }
    };
    void refresh();
    const timer = setInterval(refresh, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [workflowId, fail]);

  const executionId = detail?.execution.id;
  useEffect(() => {
    if (!executionId) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const data = await request<{ execution: Execution; logs: ExecutionLog[] }>(
          `/api/executions/${executionId}`
        );
        if (!cancelled) setDetail(data);
      } catch (e) {
        if (!cancelled) fail(e);
      }
    };
    void refresh();
    const timer = setInterval(refresh, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [executionId, fail]);

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
      const { workflow } = await request<{ workflow: WorkflowRow }>(
        `/api/workflows/${current.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            name: current.name,
            definition: current.definition,
            expectedVersion: current.version,
          }),
        }
      );
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
        edges: active.definition.edges.filter(
          (e) => e.source !== selected && e.target !== selected
        ),
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

  const open = (row: WorkflowRow | null) => {
    if (dirty && !confirm(t('editor.discard'))) return;
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
            nodes: [
              {
                id: 'manual',
                type: 'trigger.manual',
                position: { x: 100, y: 140 },
                data: {},
              },
            ],
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

  const add = (
    type: NodeType,
    position = { x: 150 + (active?.definition.nodes.length ?? 0) * 230, y: 140 }
  ) => {
    if (!active) return;
    change({
      ...active.definition,
      nodes: [
        ...active.definition.nodes,
        {
          id: `node-${crypto.randomUUID()}`,
          type,
          position,
          data:
            type === 'action.http'
              ? { url: '', method: 'GET', headers: {} }
              : type === 'output.response'
              ? { value: '{{$json}}' }
              : {},
        },
      ],
    });
  };

  const connect = (connection: Connection) => {
    if (!active || !connection.source || !connection.target) return;
    const edgeId = `e-${connection.source}-${connection.target}`;
    change({
      ...active.definition,
      edges: addEdge(
        {
          id: edgeId,
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle,
          targetHandle: connection.targetHandle,
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
        nodes: active.definition.nodes.map((n) =>
          n.id === currentNode.id ? { ...n, data: { ...n.data, ...data } } : n
        ),
      });
    }
  };

  const run = async () => {
    if (!active) return;
    const ok = await save();
    if (!ok) return;
    setBusy(true);
    try {
      const { executionId } = await request<{ executionId: string }>(
        `/api/workflows/${active.id}/run`,
        { method: 'POST' }
      );
      const data = await request<{ execution: Execution; logs: ExecutionLog[] }>(
        `/api/executions/${executionId}`
      );
      setDetail(data);
      setHistory((h) => [data.execution, ...h]);
      setTab('logs');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const stamp = (value: string | null) =>
    value ? new Date(value).toLocaleString(locale) : '—';

  const nodes: Node<StationData>[] = (active?.definition.nodes ?? []).map((n) => ({
    id: n.id,
    type: 'station',
    position: n.position,
    measured: measured[n.id],
    selected: n.id === selected,
    data: {
      kind: n.type,
      title: t(NODE_LABELS[n.type] ?? 'common.appName'),
      subtitle:
        n.type === 'action.http'
          ? `${String(n.data.method ?? 'GET')} · ${String(n.data.url || t('editor.configure'))}`
          : n.type === 'output.response'
          ? String(n.data.value ?? '{{$json}}')
          : t('editor.manualHint'),
      status: detail?.logs.find((l) => l.node_id === n.id)?.status
        ? translated('status.' + detail.logs.find((l) => l.node_id === n.id)!.status)
        : undefined,
    },
  }));

  const flowEdges: Edge[] = (active?.definition.edges ?? []).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
    type: 'smoothstep',
    style: { stroke: 'var(--color-jalur-l1)', strokeWidth: 2 },
  }));

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
        <button className="nav-item nav-active" onClick={() => open(null)}>
          <Workflow size={17} />
          {t('dashboard.title')}
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
            <span>{t('dashboard.title')}</span>
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
                document.cookie = `locale=${
                  locale === 'id' ? 'en' : 'id'
                };path=/;max-age=31536000;samesite=lax`;
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

        {!active ? (
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
                    <span
                      className="route-color"
                      style={{ background: `var(--color-jalur-l${(i % 6) + 1})` }}
                    />
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
                <button
                  className="back-button"
                  aria-label={t('common.back')}
                  onClick={() => open(null)}
                >
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
                  <div key={kind}>
                    <div className="palette-section">{t(NODE_LABELS[kind])}</div>
                    <button
                      className="palette-node"
                      aria-label={t('editor.add', { name: t(NODE_LABELS[kind]) })}
                      draggable
                      onDragStart={(e: DragEvent<HTMLButtonElement>) =>
                        e.dataTransfer.setData('application/runchunk', kind)
                      }
                      onClick={() => add(kind)}
                    >
                      <span
                        className={`palette-icon ${
                          kind === 'trigger.manual'
                            ? 'trigger'
                            : kind === 'action.http'
                            ? 'action'
                            : 'output'
                        }`}
                      >
                        {kind === 'trigger.manual' ? (
                          <Play size={15} />
                        ) : kind === 'action.http' ? (
                          <Globe2 size={15} />
                        ) : (
                          <Code2 size={15} />
                        )}
                      </span>
                      <span>
                        <strong>{t(NODE_LABELS[kind])}</strong>
                        <small>{t('editor.clickAdd')}</small>
                      </span>
                    </button>
                  </div>
                ))}
              </aside>

              <div className="canvas-wrap">
                <div className="canvas-label">
                  <span className="live-dot" />
                  {t('editor.canvas')}
                  <span className="canvas-count">
                    {t('editor.nodeCount', { count: nodes.length })}
                  </span>
                </div>
                <ReactFlow
                  nodes={nodes}
                  edges={flowEdges}
                  nodeTypes={nodeTypes}
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
                    <button
                      className="icon-button"
                      aria-label={t('common.close')}
                      onClick={() => setSelected(null)}
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <h2>{t(NODE_LABELS[currentNode.type] ?? 'common.appName')}</h2>

                  {currentNode.type === 'action.http' && (
                    <>
                      <label className="field-label">
                        {t('editor.method')}
                        <select
                          value={String(currentNode.data.method ?? 'GET')}
                          onChange={(e) => update({ method: e.target.value })}
                        >
                          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => (
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
                      <label className="field-label">
                        {t('editor.body')}
                        <textarea
                          className="code-input"
                          rows={5}
                          value={
                            typeof currentNode.data.body === 'string'
                              ? currentNode.data.body
                              : JSON.stringify(currentNode.data.body ?? '')
                          }
                          onChange={(e) => update({ body: e.target.value })}
                        />
                      </label>
                      <p className="field-help">{t('editor.httpWarning')}</p>
                    </>
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

                  {currentNode.type === 'trigger.manual' && (
                    <p className="field-help">{t('editor.manualHint')}</p>
                  )}

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
                <button
                  className={tab === 'history' ? 'active' : ''}
                  onClick={() => setTab('history')}
                >
                  <History size={15} />
                  {t('common.history')}
                  <span className="tab-count">{history.length}</span>
                </button>
                <button className={tab === 'logs' ? 'active' : ''} onClick={() => setTab('logs')}>
                  <Activity size={15} />
                  {t('common.logs')}
                </button>
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
                            const data = await request<{
                              execution: Execution;
                              logs: ExecutionLog[];
                            }>(`/api/executions/${ex.id}`);
                            setDetail(data);
                            setTab('logs');
                          } catch (e) {
                            fail(e);
                          }
                        }}
                      >
                        <span className={`status-pill status-${ex.status}`}>
                          {translated('status.' + ex.status)}
                        </span>
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
                      <time>
                        {stamp(detail.execution.started_at ?? detail.execution.created_at)}
                      </time>
                      <span>
                        {t('execution.finished')}: {stamp(detail.execution.finished_at)}
                      </span>
                    </div>

                    {detail.execution.error && <p role="alert">{translated(detail.execution.error)}</p>}

                    {detail.logs.map((log, i) => (
                      <div className="log-item" key={`${log.node_id}-${i}`}>
                        <span className={`log-dot status-${log.status}`} />
                        <strong>{log.node_id}</strong>
                        <span>
                          {translated('status.' + log.status)} ·{' '}
                          {t.has(log.summary as unknown as Parameters<typeof t>[0])
                            ? t(log.summary as unknown as Parameters<typeof t>[0])
                            : log.summary}
                        </span>
                        <time>{stamp(log.created_at)}</time>
                        <small>{log.duration_ms} ms</small>
                      </div>
                    ))}

                    {detail.execution.output !== undefined && (
                      <>
                        <h2>{t('execution.result')}</h2>
                        <pre className="result-output">
                          {JSON.stringify(detail.execution.output, null, 2)}
                        </pre>
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
