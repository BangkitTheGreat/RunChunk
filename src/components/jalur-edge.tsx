'use client';

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from '@xyflow/react';
import type { Edge, EdgeProps } from '@xyflow/react';

export interface JalurEdgeData extends Record<string, unknown> {
  /** Jalur color of the workflow (`var(--color-jalur-lN)`). */
  color: string;
  /** False once a run shows this route was not taken. */
  taken: boolean;
  /** A train rides the edge while its target node is running. */
  running: boolean;
  label?: string;
}

export type JalurEdgeType = Edge<JalurEdgeData, 'jalur'>;

/**
 * Transit-map edge: 90° smoothstep line in the workflow's Jalur color, an optional port label, and the
 * "kereta" (a dot moving along the path) while the run is passing through. `prefers-reduced-motion`
 * swaps the moving dot for a static marker (see globals.css).
 */
export function JalurEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<JalurEdgeType>) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 0 });
  const color = data?.color ?? 'var(--color-edge)';
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: color, strokeWidth: 2, opacity: data?.taken === false ? 0.3 : 1 }} />
      {data?.running && (
        <>
          <circle className="train" r={4.5} fill={color} stroke="var(--color-bg)" strokeWidth={1.5}>
            <animateMotion dur="1.2s" repeatCount="indefinite" path={path} />
          </circle>
          <circle className="train-static" cx={labelX} cy={labelY} r={4.5} fill={color} stroke="var(--color-bg)" strokeWidth={1.5} />
        </>
      )}
      {data?.label && (
        <EdgeLabelRenderer>
          <span className="edge-label" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            {data.label}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
