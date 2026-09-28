'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Activity, History } from 'lucide-react';
import { useStamp, useTranslated } from './format';
import type { Detail, DockTab, Execution, ExecutionLog } from './model';

/** Bottom panel: run history, per-node logs of the selected run, and the Realtime indicator. */
export function ExecutionDock({
  history,
  detail,
  tab,
  onTabChange,
  live,
  nodeTitle,
  onPick,
}: {
  history: Execution[];
  detail: Detail | null;
  tab: DockTab;
  onTabChange: (tab: DockTab) => void;
  live: boolean | null;
  nodeTitle: (nodeId: string) => string;
  onPick: (execution: Execution) => void;
}) {
  const t = useTranslations();
  const translated = useTranslated();
  const stamp = useStamp();

  return (
    <footer className="execution-dock">
      <div className="dock-tabs">
        <button className={tab === 'history' ? 'active' : ''} onClick={() => onTabChange('history')}>
          <History size={15} />
          {t('common.history')}
          <span className="tab-count">{history.length}</span>
        </button>
        <button className={tab === 'logs' ? 'active' : ''} onClick={() => onTabChange('logs')}>
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
              <button className="execution-item" key={ex.id} onClick={() => onPick(ex)}>
                <span className={`status-pill status-${ex.status}`}>{translated('status.' + ex.status)}</span>
                <span className="execution-source">{translated('execution.source.' + (ex.trigger_source ?? 'manual'))}</span>
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
              <span className="execution-source">{translated('execution.source.' + (detail.execution.trigger_source ?? 'manual'))}</span>
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
