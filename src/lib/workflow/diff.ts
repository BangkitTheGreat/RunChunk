import type { WorkflowDefinition, WorkflowNode } from "./types";

// Structural summary of what changed between two definitions, for the version history panel.
// Node identity is the node id; a node "changed" when its type or data differ (positions are ignored).

export interface DefinitionDiff {
  addedNodes: WorkflowNode[];
  removedNodes: WorkflowNode[];
  changedNodes: WorkflowNode[];
  addedEdges: number;
  removedEdges: number;
}

const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : item
  );

const edgeKey = (edge: WorkflowDefinition["edges"][number]) => `${edge.source}|${edge.sourceHandle ?? ""}|${edge.target}`;

export function diffDefinitions(from: WorkflowDefinition, to: WorkflowDefinition): DefinitionDiff {
  const before = new Map(from.nodes.map((node) => [node.id, node]));
  const after = new Map(to.nodes.map((node) => [node.id, node]));
  const addedNodes = to.nodes.filter((node) => !before.has(node.id));
  const removedNodes = from.nodes.filter((node) => !after.has(node.id));
  const changedNodes = to.nodes.filter((node) => {
    const old = before.get(node.id);
    return old && (old.type !== node.type || stable(old.data) !== stable(node.data));
  });
  const beforeEdges = new Set(from.edges.map(edgeKey));
  const afterEdges = new Set(to.edges.map(edgeKey));
  return {
    addedNodes,
    removedNodes,
    changedNodes,
    addedEdges: [...afterEdges].filter((key) => !beforeEdges.has(key)).length,
    removedEdges: [...beforeEdges].filter((key) => !afterEdges.has(key)).length,
  };
}

export function isEmptyDiff(diff: DefinitionDiff): boolean {
  return !diff.addedNodes.length && !diff.removedNodes.length && !diff.changedNodes.length && !diff.addedEdges && !diff.removedEdges;
}
