'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RotateCcw, X } from 'lucide-react';
import { diffDefinitions, isEmptyDiff } from '@/lib/workflow/diff';
import type { WorkflowDefinition } from '@/lib/workflow/types';
import { useStamp } from './format';
import type { WorkflowRow } from './model';
import { request } from './request';
import { NODE_LABELS } from './station';

interface VersionSummary {
  version: number;
  name: string;
  route_color: number;
  created_at: string;
  node_count: number;
  edge_count: number;
}

/**
 * Version history of the open workflow. Expanding a row fetches that version and shows what differs from
 * the definition currently on the canvas; "Restore" writes it back as a new version.
 */
export function VersionPanel({
  workflow,
  onRestored,
  onClose,
  fail,
}: {
  workflow: WorkflowRow;
  onRestored: (workflow: WorkflowRow) => void;
  onClose: () => void;
  fail: (e: unknown) => void;
}) {
  const t = useTranslations();
  const stamp = useStamp();
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [definitions, setDefinitions] = useState<Record<number, WorkflowDefinition>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    request<{ versions: VersionSummary[] }>(`/api/workflows/${workflow.id}/versions`)
      .then((data) => {
        if (!cancelled) setVersions(data.versions);
      })
      .catch(fail);
    return () => {
      cancelled = true;
    };
  }, [workflow.id, workflow.version, fail]);

  const expand = async (version: number) => {
    if (open === version) {
      setOpen(null);
      return;
    }
    setOpen(version);
    if (definitions[version]) return;
    try {
      const data = await request<{ version: { definition: WorkflowDefinition } }>(`/api/workflows/${workflow.id}/versions/${version}`);
      setDefinitions((d) => ({ ...d, [version]: data.version.definition }));
    } catch (e) {
      fail(e);
    }
  };

  const restore = async (version: number) => {
    if (!confirm(t('versions.confirmRestore', { version }))) return;
    setBusy(true);
    try {
      const data = await request<{ workflow: WorkflowRow }>(`/api/workflows/${workflow.id}/versions/${version}`, {
        method: 'POST',
        body: JSON.stringify({ expectedVersion: workflow.version }),
      });
      onRestored(data.workflow);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const describe = (definition: WorkflowDefinition) => {
    const diff = diffDefinitions(definition, workflow.definition);
    if (isEmptyDiff(diff)) return <p className="field-help">{t('versions.same')}</p>;
    const label = (nodes: typeof diff.addedNodes) => nodes.map((n) => t(NODE_LABELS[n.type])).join(', ');
    return (
      <ul className="version-diff">
        {diff.removedNodes.length > 0 && <li>{t('versions.nodesOnlyThere', { count: diff.removedNodes.length, names: label(diff.removedNodes) })}</li>}
        {diff.addedNodes.length > 0 && <li>{t('versions.nodesOnlyHere', { count: diff.addedNodes.length, names: label(diff.addedNodes) })}</li>}
        {diff.changedNodes.length > 0 && <li>{t('versions.nodesChanged', { count: diff.changedNodes.length, names: label(diff.changedNodes) })}</li>}
        {(diff.addedEdges > 0 || diff.removedEdges > 0) && <li>{t('versions.edges', { added: diff.removedEdges, removed: diff.addedEdges })}</li>}
      </ul>
    );
  };

  return (
    <aside className="config-panel version-panel">
      <div className="config-heading">
        <h2>{t('versions.title')}</h2>
        <button className="icon-button" aria-label={t('common.close')} onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <p className="field-help">{t('versions.hint')}</p>
      {!versions ? (
        <p className="field-help">{t('common.loading')}</p>
      ) : versions.length === 0 ? (
        <p className="field-help">{t('versions.empty')}</p>
      ) : (
        <ul className="version-list">
          {versions.map((v) => {
            // workflows.version also counts activation/color updates, so "current" is the newest snapshot.
            const current = v.version === versions[0].version;
            return (
              <li key={v.version} className={`version-item ${current ? 'is-current' : ''} ${open === v.version ? 'is-open' : ''}`}>
                <button className="version-row" onClick={() => void expand(v.version)} aria-expanded={open === v.version}>
                  <strong>v{v.version}</strong>
                  <span>{current ? t('versions.current') : v.name}</span>
                  <small>
                    {t('versions.counts', { nodes: v.node_count, edges: v.edge_count })} · {stamp(v.created_at)}
                  </small>
                </button>
                {open === v.version && (
                  <div className="version-detail">
                    {current ? (
                      <p className="field-help">{t('versions.isCurrent')}</p>
                    ) : definitions[v.version] ? (
                      <>
                        {describe(definitions[v.version])}
                        <button className="secondary-button" disabled={busy} onClick={() => void restore(v.version)}>
                          <RotateCcw size={14} />
                          {t('versions.restore', { version: v.version })}
                        </button>
                      </>
                    ) : (
                      <p className="field-help">{t('common.loading')}</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
