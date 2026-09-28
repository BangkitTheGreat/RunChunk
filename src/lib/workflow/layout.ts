import dagre from "@dagrejs/dagre";
import { isTriggerType } from "./types";
import type { WorkflowDefinition, WorkflowNode } from "./types";

// "Rapikan otomatis": layered left-to-right layout of the definition. Only node positions change;
// the graph itself is untouched, so this never affects validation or execution.

export const STATION_WIDTH = 210;
export const STATION_HEIGHT = 70;
const MARGIN = 40;
const NODE_GAP = 40;
const RANK_GAP = 90;

export type NodeSizes = Record<string, { width?: number; height?: number } | undefined>;

export function autoLayout(definition: WorkflowDefinition, sizes: NodeSizes = {}): WorkflowDefinition {
  const size = (node: WorkflowNode) => ({
    width: sizes[node.id]?.width ?? STATION_WIDTH,
    height: sizes[node.id]?.height ?? STATION_HEIGHT,
  });
  const byId = new Map(definition.nodes.map((node) => [node.id, node]));

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "LR", nodesep: NODE_GAP, ranksep: RANK_GAP, marginx: MARGIN, marginy: MARGIN });
  graph.setDefaultEdgeLabel(() => ({}));
  // Trigger first so it takes the leftmost rank even when it has no edges yet.
  const ordered = [...definition.nodes].sort((a, b) => Number(isTriggerType(b.type)) - Number(isTriggerType(a.type)));
  for (const node of ordered) graph.setNode(node.id, size(node));
  for (const edge of definition.edges) graph.setEdge(edge.source, edge.target);
  dagre.layout(graph);

  // Dagre decides ranks (x) and a vertical order; the vertical stacking is redone here so condition
  // ports read correctly (true target above false target) and measured heights never overlap.
  const ranks = new Map<number, string[]>();
  for (const node of definition.nodes) {
    const placed = graph.node(node.id);
    ranks.set(placed.x, [...(ranks.get(placed.x) ?? []), node.id]);
  }
  const centerY = (id: string) => graph.node(id).y;
  const positions = new Map<string, { x: number; y: number }>();
  for (const [x, ids] of ranks) {
    const order = ids.sort((a, b) => centerY(a) - centerY(b));
    for (const node of definition.nodes) {
      if (node.type !== "control.condition") continue;
      const target = (handle: string) => definition.edges.find((e) => e.source === node.id && e.sourceHandle === handle)?.target;
      const yes = target("true");
      const no = target("false");
      if (!yes || !no || yes === no) continue;
      const i = order.indexOf(yes);
      const j = order.indexOf(no);
      if (i >= 0 && j >= 0 && i > j) [order[i], order[j]] = [order[j], order[i]];
    }
    const heights = order.map((id) => size(byId.get(id)!).height);
    const total = heights.reduce((sum, h) => sum + h, 0) + NODE_GAP * (order.length - 1);
    const middle = order.reduce((sum, id) => sum + centerY(id), 0) / order.length;
    let y = middle - total / 2;
    order.forEach((id, index) => {
      positions.set(id, { x: Math.round(x - size(byId.get(id)!).width / 2), y: Math.round(y) });
      y += heights[index] + NODE_GAP;
    });
  }
  // Keep everything inside the canvas after re-stacking.
  const minY = Math.min(...[...positions.values()].map((p) => p.y));
  const shift = minY < MARGIN ? MARGIN - minY : 0;
  return {
    ...definition,
    nodes: definition.nodes.map((node) => {
      const p = positions.get(node.id)!;
      return { ...node, position: { x: p.x, y: p.y + shift } };
    }),
  };
}
