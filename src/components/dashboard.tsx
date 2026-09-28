'use client';

import type { FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { isTriggerType } from '@/lib/workflow/types';
import { STARTER_TEMPLATES, type StarterTemplate } from '@/lib/workflow/templates';
import { useStamp, useTranslated } from './format';
import type { Usage, WorkflowRow } from './model';
import { NODE_LABELS, NodeIcon, SOURCE_ICON } from './station';

/** Workflow list with plan/usage, the create form, starter templates, and last-run status per row. */
export function DashboardView({
  rows,
  usage,
  name,
  onNameChange,
  busy,
  onCreate,
  onOpen,
}: {
  rows: WorkflowRow[];
  usage: Usage | null;
  name: string;
  onNameChange: (name: string) => void;
  busy: boolean;
  onCreate: (template?: StarterTemplate) => void;
  onOpen: (row: WorkflowRow) => void;
}) {
  const t = useTranslations();
  const translated = useTranslated();
  const stamp = useStamp();
  const planLabel = usage ? (usage.plan === 'pro' ? t('dashboard.planPro') : t('dashboard.planFree')) : '';

  return (
    <div className="workflow-home">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('dashboard.studio')}</p>
          <h1>{t('dashboard.title')}</h1>
          <p>{t('dashboard.description')}</p>
          {usage && (
            <p className="usage-line" title={t('dashboard.planHint')}>
              <span className={`plan-badge plan-${usage.plan}`}>{planLabel}</span>
              <span>{t('dashboard.usage', { runs: usage.runs, quota: usage.quota })}</span>
              <span>·</span>
              <span>{t('dashboard.activeCount', { count: usage.activeWorkflows, limit: usage.activeLimit })}</span>
            </p>
          )}
        </div>
        <form
          className="create-row"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            onCreate();
          }}
        >
          <input
            aria-label={t('dashboard.name')}
            placeholder={t('dashboard.name')}
            value={name}
            maxLength={120}
            onChange={(e) => onNameChange(e.target.value)}
          />
          <button className="primary-button" disabled={busy}>
            <Plus size={16} />
            {t('dashboard.create')}
          </button>
        </form>
      </div>
      <section className="templates">
        <div>
          <h2>{t('dashboard.templatesTitle')}</h2>
          <span>{t('dashboard.templatesHint')}</span>
        </div>
        <div className="template-grid">
          {STARTER_TEMPLATES.map((template) => (
            <button key={template.key} className="template-card" disabled={busy} onClick={() => onCreate(template)}>
              <span className="route-color" style={{ background: `var(--color-jalur-l${template.routeColor})` }} />
              <strong>{t(`dashboard.templates.${template.key}.name`)}</strong>
              <small>{t(`dashboard.templates.${template.key}.description`)}</small>
              <span className="template-cta">{t('dashboard.useTemplate')}</span>
            </button>
          ))}
        </div>
      </section>
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
          <button className="primary-button" onClick={() => onCreate()} disabled={busy}>
            <Plus size={16} />
            {t('dashboard.create')}
          </button>
        </div>
      ) : (
        <div className="workflow-list">
          {rows.map((row) => {
            const trigger = row.definition.nodes.find((n) => isTriggerType(n.type))?.type ?? 'trigger.manual';
            const last = row.last_execution;
            const LastIcon = last ? SOURCE_ICON[last.trigger_source] : null;
            return (
              <button className="workflow-row" key={row.id} onClick={() => onOpen(row)}>
                <span className="route-color" style={{ background: `var(--color-jalur-l${row.route_color ?? 1})` }} />
                <NodeIcon kind={trigger} size={18} />
                <span className="workflow-name">
                  {row.name}
                  <small>
                    {t(NODE_LABELS[trigger])}
                    {trigger !== 'trigger.manual' ? ` · ${row.is_active ? t('dashboard.activeBadge') : t('dashboard.inactiveBadge')}` : ''}
                  </small>
                </span>
                {last ? (
                  <span className={`status-pill status-${last.status}`}>
                    {LastIcon && <LastIcon size={11} />}
                    {translated('status.' + last.status)}
                  </span>
                ) : (
                  <span className="status-pill">{t('dashboard.neverRun')}</span>
                )}
                <time className="workflow-date">{stamp(last?.created_at ?? row.updated_at)}</time>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
