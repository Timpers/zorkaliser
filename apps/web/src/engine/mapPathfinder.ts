import {
  DIRECTION_COMMAND,
  OPPOSITE_DIRECTION,
  type CompassDirection,
  type GameMapGraph,
} from '@zorkaliser/shared';

export interface WalkStep {
  direction: CompassDirection;
  command: string;
  fromNodeId: string;
  expectedNodeId: string;
}

export interface WalkPlan {
  targetNodeId: string;
  targetTitle: string;
  steps: WalkStep[];
}

/**
 * Computes the shortest known safe path between two rooms using BFS over open edges.
 * Respects one-way drops and locked/blocked doors (never routes backwards up a one-way edge
 * or through locked/blocked passages).
 */
export function findShortestWalkPath(
  graph: GameMapGraph,
  fromNodeId: string,
  toNodeId: string,
): WalkPlan | null {
  if (fromNodeId === toNodeId) {
    const target = graph.nodes[toNodeId];
    return target ? { targetNodeId: toNodeId, targetTitle: target.title, steps: [] } : null;
  }
  if (!graph.nodes[fromNodeId] || !graph.nodes[toNodeId]) {
    return null;
  }

  // Build directed adjacency list of safe open transitions
  const adj = new Map<string, Array<{ nextId: string; dir: CompassDirection }>>();
  for (const edge of Object.values(graph.edges)) {
    if (edge.status !== 'open') continue;
    if (edge.fromNodeId === edge.toNodeId) continue;

    // Forward direction (if commandable)
    if (edge.direction !== 'special') {
      const list = adj.get(edge.fromNodeId) ?? [];
      list.push({ nextId: edge.toNodeId, dir: edge.direction });
      adj.set(edge.fromNodeId, list);
    }

    // Reverse direction only when explicitly bidirectional and invertible
    if (edge.bidirectional) {
      const opp = OPPOSITE_DIRECTION[edge.direction];
      if (opp && opp !== 'special') {
        const revList = adj.get(edge.toNodeId) ?? [];
        revList.push({ nextId: edge.fromNodeId, dir: opp });
        adj.set(edge.toNodeId, revList);
      }
    }
  }

  const visited = new Set<string>([fromNodeId]);
  const parent = new Map<string, { prevId: string; dir: CompassDirection }>();
  const queue: string[] = [fromNodeId];

  let found = false;
  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (curr === toNodeId) {
      found = true;
      break;
    }

    for (const neighbor of adj.get(curr) ?? []) {
      if (!visited.has(neighbor.nextId)) {
        visited.add(neighbor.nextId);
        parent.set(neighbor.nextId, { prevId: curr, dir: neighbor.dir });
        queue.push(neighbor.nextId);
      }
    }
  }

  if (!found) return null;

  const steps: WalkStep[] = [];
  let cursor = toNodeId;
  while (cursor !== fromNodeId) {
    const link = parent.get(cursor);
    if (!link) return null;
    steps.push({
      direction: link.dir,
      command: DIRECTION_COMMAND[link.dir],
      fromNodeId: link.prevId,
      expectedNodeId: cursor,
    });
    cursor = link.prevId;
  }

  steps.reverse();
  return {
    targetNodeId: toNodeId,
    targetTitle: graph.nodes[toNodeId].title,
    steps,
  };
}
