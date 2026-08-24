import type { Node, Edge } from '@xyflow/react';
import type { TaskDagNode, TaskDagEdge } from '@/types/task';

/**
 * Layered layout for the task DAG (P3.6): depth = longest path from any
 * root (Kahn's algorithm, dynamic longest-path variant), then nodes within
 * a layer wrap into a grid so a wide layer (e.g. many independent roots)
 * doesn't render as one impractically tall column.
 *
 * No layout library (dagre/elkjs) needed for a graph this size — this is a
 * ~30-line topological sort, and one fewer dependency to carry.
 */

const COLUMN_WIDTH = 260;
const ROW_HEIGHT = 90;
const MAX_ROWS_PER_LAYER = 8;
const SUBCOLUMN_WIDTH = 220;

export function layoutDag(
  dagNodes: TaskDagNode[],
  dagEdges: TaskDagEdge[]
): { nodes: Node[]; edges: Edge[] } {
  const ids = new Set(dagNodes.map((n) => n.id));
  // Drop dangling edges (endpoint not in the current node set) defensively.
  const validEdges = dagEdges.filter((e) => ids.has(e.from) && ids.has(e.to));

  const incoming = new Map<string, string[]>(); // to -> [from, ...]
  const outgoing = new Map<string, string[]>(); // from -> [to, ...]
  for (const n of dagNodes) {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
  }
  for (const e of validEdges) {
    incoming.get(e.to)!.push(e.from);
    outgoing.get(e.from)!.push(e.to);
  }

  // Kahn's algorithm with dynamic depth = max(predecessor depth) + 1.
  const depth = new Map<string, number>();
  const inDegreeRemaining = new Map<string, number>(
    dagNodes.map((n) => [n.id, incoming.get(n.id)!.length])
  );
  const queue: string[] = dagNodes.filter((n) => inDegreeRemaining.get(n.id) === 0).map((n) => n.id);
  for (const id of queue) depth.set(id, 0);

  let processed = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    processed++;
    const d = depth.get(id)!;
    for (const next of outgoing.get(id) ?? []) {
      depth.set(next, Math.max(depth.get(next) ?? 0, d + 1));
      const remaining = (inDegreeRemaining.get(next) ?? 0) - 1;
      inDegreeRemaining.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  // Any unprocessed nodes are part of a cycle (shouldn't happen for a valid
  // dependency DAG) — place them one layer past the deepest resolved node
  // rather than silently dropping them.
  if (processed < dagNodes.length) {
    const maxDepth = Math.max(0, ...[...depth.values()]);
    for (const n of dagNodes) {
      if (!depth.has(n.id)) depth.set(n.id, maxDepth + 1);
    }
  }

  // Group by layer, then wrap each layer into sub-columns of MAX_ROWS_PER_LAYER.
  const byLayer = new Map<number, TaskDagNode[]>();
  for (const n of dagNodes) {
    const d = depth.get(n.id) ?? 0;
    (byLayer.get(d) ?? byLayer.set(d, []).get(d)!).push(n);
  }

  // A layer that wraps into N sub-columns is N * SUBCOLUMN_WIDTH wide.
  // Later layers must start past that width, or a wide early layer (many
  // independent roots, e.g. a graph with no recorded dependencies yet)
  // visually overlaps the next depth — this is the bug an inserted test
  // edge surfaced: depth 0 wrapping to 2 sub-columns collided with depth 1
  // at the old fixed `layerDepth * COLUMN_WIDTH` offset.
  const sortedDepths = [...byLayer.keys()].sort((a, b) => a - b);
  const layerBaseX = new Map<number, number>();
  let cumulativeX = 0;
  for (const d of sortedDepths) {
    layerBaseX.set(d, cumulativeX);
    const subcols = Math.ceil(byLayer.get(d)!.length / MAX_ROWS_PER_LAYER);
    cumulativeX += subcols * SUBCOLUMN_WIDTH + (COLUMN_WIDTH - SUBCOLUMN_WIDTH);
  }

  const nodes: Node[] = [];
  for (const [layerDepth, layerNodes] of byLayer) {
    const baseX = layerBaseX.get(layerDepth)!;
    layerNodes.forEach((n, i) => {
      const subcol = Math.floor(i / MAX_ROWS_PER_LAYER);
      const row = i % MAX_ROWS_PER_LAYER;
      nodes.push({
        id: n.id,
        type: 'taskNode',
        position: {
          x: baseX + subcol * SUBCOLUMN_WIDTH,
          y: row * ROW_HEIGHT,
        },
        data: { task: n },
      });
    });
  }

  const edges: Edge[] = validEdges.map((e) => ({
    id: `${e.from}->${e.to}`,
    source: e.from,
    target: e.to,
    animated: false,
  }));

  return { nodes, edges };
}
