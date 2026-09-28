'use client';

import type { CSSProperties } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import { CalendarClock, Code2, GitBranch, Globe2, Play, Timer, Variable, Webhook } from 'lucide-react';
import { isTriggerType } from '@/lib/workflow/types';
import type { NodeType, TriggerSource } from '@/lib/workflow/types';
import { JalurEdge } from './jalur-edge';

// Node catalog as the editor sees it: palette order, labels, categories, defaults, icons, and the
// "station" card React Flow renders for every node.

export const SUPPORTED_KINDS: readonly NodeType[] = [
  'trigger.manual',
  'trigger.webhook',
  'trigger.schedule',
  'action.http',
  'action.set_variable',
  'control.condition',
  'control.delay',
  'output.response',
];

export const NODE_LABELS: Record<NodeType, string> = {
  'trigger.manual': 'nodes.triggerManual',
  'trigger.webhook': 'nodes.triggerWebhook',
  'trigger.schedule': 'nodes.triggerSchedule',
  'action.http': 'nodes.actionHttp',
  'action.set_variable': 'nodes.actionSetVariable',
  'control.condition': 'nodes.controlCondition',
  'control.delay': 'nodes.controlDelay',
  'output.response': 'nodes.outputResponse',
};

export const NODE_CATEGORY: Record<NodeType, 'trigger' | 'action' | 'control' | 'output'> = {
  'trigger.manual': 'trigger',
  'trigger.webhook': 'trigger',
  'trigger.schedule': 'trigger',
  'action.http': 'action',
  'action.set_variable': 'action',
  'control.condition': 'control',
  'control.delay': 'control',
  'output.response': 'output',
};

export const DEFAULT_DATA: Record<NodeType, () => Record<string, unknown>> = {
  'trigger.manual': () => ({}),
  'trigger.webhook': () => ({}),
  'trigger.schedule': () => ({ cron: '0 9 * * *', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }),
  'action.http': () => ({ url: '', method: 'GET', headers: {} }),
  'action.set_variable': () => ({ values: {} }),
  'control.condition': () => ({ left: '{{$json.status}}', operator: 'equals', right: '200' }),
  'control.delay': () => ({ amount: 5, unit: 's' }),
  'output.response': () => ({ value: '{{$json}}' }),
};

export const SOURCE_ICON: Record<TriggerSource, typeof Play> = { manual: Play, webhook: Webhook, schedule: CalendarClock };

export interface StationData extends Record<string, unknown> {
  kind: NodeType;
  title: string;
  subtitle: string;
  status?: string;
  statusKey?: string;
  trueLabel: string;
  falseLabel: string;
}

export function NodeIcon({ kind, size }: { kind: NodeType; size: number }) {
  switch (kind) {
    case 'trigger.manual':
      return <Play size={size} />;
    case 'trigger.webhook':
      return <Webhook size={size} />;
    case 'trigger.schedule':
      return <CalendarClock size={size} />;
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

export function Station({ data, selected }: NodeProps<Node<StationData>>) {
  const stationStyle = { '--station-color': `var(--color-cat-${NODE_CATEGORY[data.kind]})` } as CSSProperties;
  const branching = data.kind === 'control.condition';
  return (
    <div
      className={`station ${selected ? 'station-selected' : ''} ${data.statusKey ? `station-${data.statusKey}` : ''}`}
      style={stationStyle}
    >
      {!isTriggerType(data.kind) && <Handle type="target" position={Position.Left} />}
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

export const nodeTypes = { station: Station };
export const edgeTypes = { jalur: JalurEdge };
