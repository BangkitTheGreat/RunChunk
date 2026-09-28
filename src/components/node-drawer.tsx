'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Plus, Trash2, X } from 'lucide-react';
import {
  CONDITION_OPERATORS,
  DELAY_UNITS,
  FORBIDDEN_KEYS,
  HTTP_METHODS,
  MAX_RETRIES,
  UNARY_OPERATORS,
  UNSAFE_RETRY_METHODS,
  VARIABLE_KEY,
} from '@/lib/workflow/types';
import type { WorkflowNode } from '@/lib/workflow/types';
import { useStamp } from './format';
import type { Credential, Usage, WorkflowRow } from './model';
import { NODE_LABELS } from './station';
import { ScheduleConfig, WebhookConfig } from './trigger-config';

/** Right-hand configuration panel for the selected node. Field edits go straight into the definition. */
export function NodeDrawer({
  node,
  workflow,
  credentials,
  usage,
  headers,
  onHeadersChange,
  onUpdate,
  onRemove,
  onClose,
  onManageCredentials,
  onError,
  fail,
}: {
  node: WorkflowNode;
  workflow: WorkflowRow;
  credentials: Credential[];
  usage: Usage | null;
  /** Raw headers JSON as typed, kept separately so invalid drafts do not clobber the node. */
  headers: string;
  onHeadersChange: (text: string) => void;
  onUpdate: (data: Record<string, unknown>) => void;
  onRemove: () => void;
  onClose: () => void;
  onManageCredentials: () => void;
  /** Sets the banner error key; '' clears it. */
  onError: (key: string) => void;
  fail: (e: unknown) => void;
}) {
  const t = useTranslations();
  const stamp = useStamp();
  const method = String(node.data.method ?? 'GET');
  const retries = Number(node.data.retries ?? 0);

  return (
    <aside className="config-panel">
      <div className="config-heading">
        <h2>{t('editor.drawerTitle')}</h2>
        <button className="icon-button" aria-label={t('common.close')} onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <h2>{t(NODE_LABELS[node.type])}</h2>

      {node.type === 'action.http' && (
        <>
          <label className="field-label">
            {t('editor.method')}
            <select value={method} onChange={(e) => onUpdate({ method: e.target.value })}>
              {HTTP_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="field-label">
            {t('editor.url')}
            <input
              value={String(node.data.url ?? '')}
              onChange={(e) => onUpdate({ url: e.target.value })}
              placeholder="https://api.example.com/data"
            />
          </label>
          <label className="field-label">
            {t('editor.credential')}
            <select
              value={String(node.data.credentialId ?? '')}
              onChange={(e) => onUpdate({ credentialId: e.target.value || undefined })}
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
            <button className="link-button" onClick={onManageCredentials}>
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
                onHeadersChange(e.target.value);
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
                  onUpdate({ headers: value as Record<string, string> });
                  onError('');
                } catch {
                  onError('errors.invalidHeaders');
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
                typeof node.data.body === 'string'
                  ? node.data.body
                  : node.data.body === undefined
                    ? ''
                    : JSON.stringify(node.data.body)
              }
              onChange={(e) => onUpdate({ body: e.target.value })}
            />
          </label>
          <label className="field-label">
            {t('editor.retries')}
            <select value={retries} onChange={(e) => onUpdate({ retries: Number(e.target.value) || undefined })}>
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

      {node.type === 'control.condition' && (
        <>
          <label className="field-label">
            {t('editor.left')}
            <input
              className="code-input"
              value={String(node.data.left ?? '')}
              onChange={(e) => onUpdate({ left: e.target.value })}
              placeholder="{{$json.status}}"
            />
          </label>
          <label className="field-label">
            {t('editor.operator')}
            <select value={String(node.data.operator ?? 'equals')} onChange={(e) => onUpdate({ operator: e.target.value })}>
              {CONDITION_OPERATORS.map((op) => (
                <option key={op} value={op}>
                  {t(`operators.${op}`)}
                </option>
              ))}
            </select>
          </label>
          {!UNARY_OPERATORS.includes(String(node.data.operator ?? 'equals') as (typeof UNARY_OPERATORS)[number]) && (
            <label className="field-label">
              {t('editor.right')}
              <input
                className="code-input"
                value={String(node.data.right ?? '')}
                onChange={(e) => onUpdate({ right: e.target.value })}
                placeholder="404"
              />
            </label>
          )}
          <p className="field-help">{t('editor.conditionHint')}</p>
        </>
      )}

      {node.type === 'control.delay' && (
        <>
          <div className="field-row">
            <label className="field-label">
              {t('editor.amount')}
              <input
                type="number"
                min={1}
                step={1}
                value={String(node.data.amount ?? '')}
                onChange={(e) => onUpdate({ amount: e.target.value === '' ? '' : Number(e.target.value) })}
              />
            </label>
            <label className="field-label">
              {t('editor.unit')}
              <select value={String(node.data.unit ?? 's')} onChange={(e) => onUpdate({ unit: e.target.value })}>
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

      {node.type === 'action.set_variable' && (
        <VariablesEditor
          key={node.id}
          values={(node.data.values as Record<string, unknown>) ?? {}}
          onChange={(values) => onUpdate({ values })}
        />
      )}

      {node.type === 'output.response' && (
        <>
          <label className="field-label">
            {t('editor.expression')}
            <textarea
              className="code-input"
              rows={5}
              value={String(node.data.value ?? '{{$json}}')}
              onChange={(e) => onUpdate({ value: e.target.value })}
            />
          </label>
          <p className="field-help">
            {t('editor.expressionHint')} <code>{'{{$json}}'}</code>
          </p>
        </>
      )}

      {node.type === 'trigger.manual' && <p className="field-help">{t('editor.manualHint')}</p>}

      {node.type === 'trigger.webhook' && (
        <WebhookConfig
          key={workflow.id}
          workflowId={workflow.id}
          isActive={workflow.is_active}
          webhookPerMinute={usage?.webhookPerMinute ?? null}
          stamp={stamp}
          fail={fail}
        />
      )}

      {node.type === 'trigger.schedule' && (
        <ScheduleConfig cron={String(node.data.cron ?? '')} timezone={String(node.data.timezone ?? '')} onChange={onUpdate} />
      )}

      <div className="config-bottom">
        <button className="danger-button" onClick={onRemove}>
          <Trash2 size={15} />
          {t('common.delete')}
        </button>
      </div>
    </aside>
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
      <button className="secondary-button" disabled={names.includes('')} onClick={() => write([...entries, ['', '']])}>
        <Plus size={14} />
        {t('editor.addVariable')}
      </button>
      <p className="field-help">{t('editor.variableHint')}</p>
    </>
  );
}
