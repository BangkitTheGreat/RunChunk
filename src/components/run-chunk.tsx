'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import type { Connection, EdgeChange, Node, NodeChange } from '@xyflow/react';
import { ArrowLeft, Check, GitCommitVertical, KeyRound, LayoutGrid, LoaderCircle, LogOut, Moon, Play, Power, Save, Sun, Workflow, X } from 'lucide-react';
import { UNARY_OPERATORS, isTriggerType } from '@/lib/workflow/types';
import type { NodeType, WorkflowDefinition } from '@/lib/workflow/types';
import type { StarterTemplate } from '@/lib/workflow/templates';
import { autoLayout } from '@/lib/workflow/layout';
import type { JalurEdgeType } from './jalur-edge';
import { CredentialsView } from './credentials-view';
import { DashboardView } from './dashboard';
import { ExecutionDock } from './execution-dock';
import { useTranslated } from './format';
import type { Credential, Detail, DockTab, Execution, Usage, View, WorkflowRow } from './model';
import { NodeDrawer } from './node-drawer';
import { request } from './request';
import { DEFAULT_DATA, NODE_CATEGORY, NODE_LABELS, NodeIcon, SUPPORTED_KINDS, edgeTypes, nodeTypes } from './station';
import type { StationData } from './station';
import { useRealtimeRefetch } from './use-realtime';
import { VersionPanel } from './version-panel';

// Application shell: workspace state, API calls, the canvas, and the frame around the views.
// Views that only render state live in their own files (dashboard, node-drawer, execution-dock, ...).

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
  const translated = useTranslated();
  const { screenToFlowPosition } = useReactFlow();

  const [view, setView] = useState<View>('workflows');
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
  const [tab, setTab] = useState<DockTab>('history');
  const [theme, setTheme] = useState(() =>
    typeof document === 'undefined' ? 'dark' : document.documentElement.dataset.theme ?? 'dark'
  );
  const [headers, setHeaders] = useState('');
  const [measured, setMeasured] = useState<Record<string, Node['measured']>>({});
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  // The canvas follows the newest execution (webhook/schedule runs arrive without a click) until the
  // user pins an older one from the history list.
  const followLatestRef = useRef(true);

  const activeRef = useRef<WorkflowRow | null>(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const fail = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : 'errors.server');
  }, []);

  const loadCredentials = useCallback(async () => {
    const data = await request<{ credentials: Credential[] }>('/api/credentials');
    setCredentials(data.credentials);
  }, []);

  const loadUsage = useCallback(() => {
    request<Usage>('/api/me').then(setUsage).catch(() => setUsage(null));
  }, []);

  const loadWorkflows = useCallback(async () => {
    const data = await request<{ workflows: WorkflowRow[] }>('/api/workflows');
    setRows(data.workflows);
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
    request<Usage>('/api/me').then(setUsage).catch(() => setUsage(null));
  }, [fail]);

  const workflowId = active?.id;
  const refreshHistory = useCallback(async () => {
    if (!workflowId) return;
    try {
      const data = await request<{ executions: Execution[] }>(`/api/executions?workflowId=${workflowId}`);
      if (activeRef.current?.id !== workflowId) return;
      setHistory(data.executions);
      const newest = data.executions[0];
      if (newest && followLatestRef.current) {
        setDetail((current) => {
          if (current?.execution.id === newest.id) return current;
          request<Detail>(`/api/executions/${newest.id}`)
            .then((loaded) => setDetail((again) => (followLatestRef.current && again?.execution.id !== loaded.execution.id ? loaded : again)))
            .catch(fail);
          return current;
        });
      }
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
          routeColor: current.route_color,
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

  const open = (row: WorkflowRow | null, nextView: View = 'workflows') => {
    if (dirty && !confirm(t('editor.discard'))) return;
    followLatestRef.current = true;
    if (!row) {
      loadWorkflows().catch(fail);
      loadUsage();
    }
    setView(nextView);
    setActive(row);
    setShowVersions(false);
    setMeasured({});
    setDirty(false);
    setSelected(null);
    setError('');
    setDetail(null);
    setHistory([]);
  };

  const create = async (template?: StarterTemplate) => {
    setBusy(true);
    setError('');
    setDetail(null);
    setHistory([]);
    followLatestRef.current = true;
    try {
      const { workflow } = await request<{ workflow: WorkflowRow }>('/api/workflows', {
        method: 'POST',
        body: JSON.stringify({
          name: template ? t(`dashboard.templates.${template.key}.name`) : name.trim() || t('dashboard.untitled'),
          definition: template?.definition ?? {
            nodes: [{ id: 'manual', type: 'trigger.manual', position: { x: 100, y: 140 }, data: {} }],
            edges: [],
          },
          ...(template ? { routeColor: template.routeColor } : {}),
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
    setShowVersions(false);
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
    followLatestRef.current = true;
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
      loadUsage();
    }
  };

  const pickExecution = async (execution: Execution) => {
    // Picking an older run pins it; the newest keeps following.
    followLatestRef.current = history[0]?.id === execution.id;
    try {
      const data = await request<Detail>(`/api/executions/${execution.id}`);
      setDetail(data);
      setTab('logs');
    } catch (e) {
      fail(e);
    }
  };

  const setActivation = async (activeFlag: boolean) => {
    if (!active) return;
    if (dirty && !(await save())) return;
    setBusy(true);
    setError('');
    try {
      const { workflow } = await request<{ workflow: WorkflowRow }>(`/api/workflows/${active.id}/active`, {
        method: 'PUT',
        body: JSON.stringify({ active: activeFlag }),
      });
      setActive((a) => (a && a.id === workflow.id ? { ...a, is_active: workflow.is_active, version: workflow.version } : a));
      setRows((r) => r.map((row) => (row.id === workflow.id ? { ...row, is_active: workflow.is_active } : row)));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      loadUsage();
    }
  };

  const restored = (workflow: WorkflowRow) => {
    setActive(workflow);
    setRows((r) => r.map((row) => (row.id === workflow.id ? workflow : row)));
    setDirty(false);
    setSelected(null);
    setShowVersions(false);
  };

  const openVersions = async () => {
    // Unsaved edits would be lost on restore; save first so they become a version too.
    if (dirty && !(await save())) return;
    setSelected(null);
    setShowVersions(true);
  };

  const tidy = () => {
    if (!active) return;
    change(autoLayout(active.definition, measured));
  };

  const setRouteColor = (color: number) => {
    setActive((a) => (a ? { ...a, route_color: color } : a));
    setDirty(true);
  };

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
      case 'trigger.webhook':
        return `POST /api/v1/webhooks/… · ${active?.is_active ? t('editor.active') : t('editor.inactive')}`;
      case 'trigger.schedule':
        return `${String(n.data.cron || '—')} · ${String(n.data.timezone || 'UTC')} · ${active?.is_active ? t('editor.active') : t('editor.inactive')}`;
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

  const routeColor = `var(--color-jalur-l${active?.route_color ?? 1})`;
  const flowEdges: JalurEdgeType[] = (active?.definition.edges ?? []).map((e) => {
    const targetLog = logFor(e.target);
    const sourceLog = logFor(e.source);
    // A route is dimmed once the run shows it was not taken; the train rides it while its target runs.
    const taken = !detail || !targetLog || targetLog.status !== 'skipped' || sourceLog?.status === 'skipped';
    const running = targetLog?.status === 'running' && sourceLog?.status === 'success';
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
      type: 'jalur',
      data: {
        color: routeColor,
        taken,
        running,
        label: e.sourceHandle ? translated(e.sourceHandle === 'true' ? 'editor.portTrue' : 'editor.portFalse') : undefined,
      },
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

  const handleEdgesChange = (changes: EdgeChange<JalurEdgeType>[]) => {
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

  const triggerType = active?.definition.nodes.find((n) => isTriggerType(n.type))?.type;
  const needsActivation = triggerType === 'trigger.webhook' || triggerType === 'trigger.schedule';
  const planLabel = usage ? (usage.plan === 'pro' ? t('dashboard.planPro') : t('dashboard.planFree')) : '';

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
          {usage && (
            <div className="side-usage" title={t('dashboard.planHint')}>
              <span className={`plan-badge plan-${usage.plan}`}>{planLabel}</span>
              <small>{t('dashboard.usage', { runs: usage.runs, quota: usage.quota })}</small>
            </div>
          )}
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
          <CredentialsView credentials={credentials} reload={loadCredentials} fail={fail} />
        ) : !active ? (
          <DashboardView
            rows={rows}
            usage={usage}
            name={name}
            onNameChange={setName}
            busy={busy}
            onCreate={(template) => void create(template)}
            onOpen={(row) => open(row)}
          />
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
                <span className="color-picker" role="group" aria-label={t('editor.routeColor')}>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`color-dot ${active.route_color === n ? 'is-current' : ''}`}
                      style={{ background: `var(--color-jalur-l${n})` }}
                      aria-label={t('editor.routeColorPick', { n })}
                      aria-pressed={active.route_color === n}
                      onClick={() => setRouteColor(n)}
                    />
                  ))}
                </span>
                <button className="secondary-button" disabled={busy} title={t('versions.title')} aria-pressed={showVersions} onClick={() => void openVersions()}>
                  <GitCommitVertical size={15} />
                  {t('versions.button')}
                </button>
                <button className="secondary-button" disabled={busy} title={t('editor.autoLayoutHint')} onClick={tidy}>
                  <LayoutGrid size={15} />
                  {t('editor.autoLayout')}
                </button>
                {needsActivation && (
                  <button
                    className={`secondary-button active-toggle ${active.is_active ? 'is-active' : ''}`}
                    disabled={busy}
                    aria-pressed={active.is_active}
                    title={t('editor.activeHint')}
                    onClick={() => void setActivation(!active.is_active)}
                  >
                    <Power size={15} />
                    {active.is_active ? t('editor.active') : t('editor.activate')}
                  </button>
                )}
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
                  edgeTypes={edgeTypes}
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

              {showVersions && !currentNode && (
                <VersionPanel workflow={active} onRestored={restored} onClose={() => setShowVersions(false)} fail={fail} />
              )}

              {currentNode && (
                <NodeDrawer
                  node={currentNode}
                  workflow={active}
                  credentials={credentials}
                  usage={usage}
                  headers={headers}
                  onHeadersChange={setHeaders}
                  onUpdate={update}
                  onRemove={remove}
                  onClose={() => setSelected(null)}
                  onManageCredentials={() => open(null, 'credentials')}
                  onError={setError}
                  fail={fail}
                />
              )}
            </div>

            <ExecutionDock
              history={history}
              detail={detail}
              tab={tab}
              onTabChange={setTab}
              live={live}
              nodeTitle={nodeTitle}
              onPick={(execution) => void pickExecution(execution)}
            />
          </>
        )}
      </section>
    </main>
  );
}
