import {
  DIRECTION_VECTORS,
  OPPOSITE_DIRECTION,
  createEmptyMapGraph,
  normalizeDirection,
  normalizeLocationKey,
  type CompassDirection,
  type GameMapGraph,
  type MapEdge,
  type MapNode,
  type SceneDirectorOutput,
} from '@zorkaliser/shared';
import type { TurnSnapshot } from './glkTypes.js';

export const MAP_GRID_STEP_X = 220;
export const MAP_GRID_STEP_Y = 148;

const DARKNESS_PATTERNS = [
  /it is pitch black/i,
  /too dark to see/i,
  /pitch dark/i,
  /likely to be eaten by a grue/i,
];

const BLOCKED_LOCKED_PATTERNS = [
  { regex: /\b(locked|padlocked|barred|bolted|boarded|nailed shut)\b/i, status: 'locked' as const },
  { regex: /\b(closed|shut)\b.*\b(door|window|gate|grating|trap[- ]?door|hatch)\b/i, status: 'blocked' as const },
  { regex: /\b(door|window|gate|grating|trap[- ]?door|hatch)\b.*\b(closed|shut)\b/i, status: 'blocked' as const },
  { regex: /\b(bars your way|blocks? your path|fends? you off|won't let you pass)\b/i, status: 'blocked' as const },
];

const NO_EXIT_PATTERNS = [
  /^you can't go that way/i,
  /^there is no (exit|way|path)/i,
  /^you cannot go /i,
];

const EXIT_SCAN_DIRECTIONS: CompassDirection[] = [
  'n',
  's',
  'e',
  'w',
  'ne',
  'nw',
  'se',
  'sw',
  'u',
  'd',
];

const EXIT_WORD_REGEX: Array<{ dir: CompassDirection; regex: RegExp }> = [
  { dir: 'ne', regex: /\b(northeast|north-east)\b/i },
  { dir: 'nw', regex: /\b(northwest|north-west)\b/i },
  { dir: 'se', regex: /\b(southeast|south-east)\b/i },
  { dir: 'sw', regex: /\b(southwest|south-west)\b/i },
  { dir: 'n', regex: /\b(?<!-)\bnorth\b(?!-?east|-?west)/i },
  { dir: 's', regex: /\b(?<!-)\bsouth\b(?!-?east|-?west)/i },
  { dir: 'e', regex: /\b(?<!north|south)(?<!-)\beast\b/i },
  { dir: 'w', regex: /\b(?<!north|south)(?<!-)\bwest\b/i },
  { dir: 'u', regex: /\b(stairs? (leading |going )?up|staircase.*up|ladder.*up|upwards?|upstairs)\b/i },
  { dir: 'd', regex: /\b(stairs? (leading |going )?down|staircase.*down|ladder.*down|downwards?|downstairs|trap[- ]?door)\b/i },
];

/**
 * Extracts a canonical movement direction from player commands like
 * "n", "go north", "walk ne", "climb up", "enter house", "exit".
 */
export function parseMovementCommand(command: string): CompassDirection | null {
  const cleaned = command.trim().toLowerCase().replace(/[.!?]+$/, '');
  if (!cleaned) return null;

  const direct = normalizeDirection(cleaned);
  if (direct) return direct;

  const goMatch = cleaned.match(/^(?:go|walk|run|head|move|travel|climb|crawl)\s+(.+)$/);
  if (goMatch) {
    const rest = goMatch[1].trim();
    const firstWord = rest.split(/\s+/)[0];
    const dir = normalizeDirection(rest) ?? normalizeDirection(firstWord);
    if (dir) return dir;
    if (/^up\b/.test(rest)) return 'u';
    if (/^down\b/.test(rest)) return 'd';
    if (/^(in|into|through)\b/.test(rest)) return 'in';
    if (/^(out|out of)\b/.test(rest)) return 'out';
  }

  if (/^(enter|climb through|go through|step through)\s+\S+/.test(cleaned)) {
    return 'in';
  }
  if (/^(leave|exit|step out|climb out)\b/.test(cleaned)) {
    return 'out';
  }

  return null;
}

export function extractMentionedExits(text: string): CompassDirection[] {
  const found = new Set<CompassDirection>();
  for (const { dir, regex } of EXIT_WORD_REGEX) {
    if (regex.test(text)) {
      found.add(dir);
    }
  }
  return EXIT_SCAN_DIRECTIONS.filter((d) => found.has(d));
}

export function inferRoomTitleFromTurn(turn: TurnSnapshot): string | null {
  if (turn.statusRoomTitle?.trim()) {
    return turn.statusRoomTitle.trim();
  }
  // Fallback for status-line-less games: look for a short standalone header line
  const lines = turn.narrativeDelta
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines.slice(0, 4)) {
    if (
      line.length >= 2 &&
      line.length <= 52 &&
      !/[.!?]$/.test(line) &&
      !/^[-=*]{3,}/.test(line) &&
      !/^(release|serial|copyright|score|moves|version)\b/i.test(line)
    ) {
      return line;
    }
  }
  return null;
}

function isPositionOccupied(
  nodes: Record<string, MapNode>,
  level: number,
  x: number,
  y: number,
  excludeId?: string,
): boolean {
  for (const node of Object.values(nodes)) {
    if (node.id === excludeId || node.level !== level) continue;
    const dx = Math.abs(node.position.x - x);
    const dy = Math.abs(node.position.y - y);
    if (dx < MAP_GRID_STEP_X * 0.65 && dy < MAP_GRID_STEP_Y * 0.65) {
      return true;
    }
  }
  return false;
}

function findOpenPosition(
  nodes: Record<string, MapNode>,
  origin: { x: number; y: number },
  level: number,
  dir: CompassDirection,
): { x: number; y: number } {
  const vec = DIRECTION_VECTORS[dir];
  const stepX = vec.dx !== 0 ? vec.dx * MAP_GRID_STEP_X : MAP_GRID_STEP_X;
  const stepY = vec.dy !== 0 ? vec.dy * MAP_GRID_STEP_Y : 0;

  // Vertical transitions keep the same (x, y) on the new floor when free
  if (dir === 'u' || dir === 'd') {
    if (!isPositionOccupied(nodes, level, origin.x, origin.y)) {
      return { x: origin.x, y: origin.y };
    }
  }

  for (let mult = 1; mult <= 8; mult++) {
    const cx = origin.x + (vec.dx === 0 && vec.dy === 0 ? stepX * mult : vec.dx * MAP_GRID_STEP_X * mult);
    const cy = origin.y + (vec.dx === 0 && vec.dy === 0 ? stepY * mult : vec.dy * MAP_GRID_STEP_Y * mult);
    if (!isPositionOccupied(nodes, level, cx, cy)) {
      return { x: cx, y: cy };
    }
  }

  // Spiral fallback around origin
  const offsets = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  for (let ring = 1; ring <= 6; ring++) {
    for (const [ox, oy] of offsets) {
      const cx = origin.x + ox * MAP_GRID_STEP_X * ring;
      const cy = origin.y + oy * MAP_GRID_STEP_Y * ring;
      if (!isPositionOccupied(nodes, level, cx, cy)) {
        return { x: cx, y: cy };
      }
    }
  }

  return { x: origin.x + MAP_GRID_STEP_X, y: origin.y };
}

function getExploredDirections(graph: GameMapGraph, nodeId: string): Set<CompassDirection> {
  const dirs = new Set<CompassDirection>();
  for (const edge of Object.values(graph.edges)) {
    if (edge.fromNodeId === nodeId) {
      dirs.add(edge.direction);
    } else if (edge.toNodeId === nodeId && edge.bidirectional) {
      const opp = OPPOSITE_DIRECTION[edge.direction];
      if (opp) dirs.add(opp);
    }
  }
  return dirs;
}

function mergeUnexploredExits(
  existing: CompassDirection[],
  discovered: CompassDirection[],
  explored: Set<CompassDirection>,
  removed?: CompassDirection,
): CompassDirection[] {
  const set = new Set<CompassDirection>(existing);
  for (const d of discovered) {
    if (d !== 'special' && !explored.has(d)) {
      set.add(d);
    }
  }
  if (removed) {
    set.delete(removed);
  }
  for (const e of explored) {
    set.delete(e);
  }
  return Array.from(set);
}

function findNodeIdForLocation(
  graph: GameMapGraph,
  locationKey: string,
  fromNodeId: string | null,
  moveDir: CompassDirection | null,
): string | null {
  // 1. If an outgoing edge from current node in `moveDir` already targets a room with this locationKey, reuse it
  if (fromNodeId && moveDir) {
    for (const edge of Object.values(graph.edges)) {
      if (edge.fromNodeId === fromNodeId && edge.direction === moveDir) {
        const target = graph.nodes[edge.toNodeId];
        if (target && target.locationKey === locationKey) return target.id;
      }
      if (
        edge.toNodeId === fromNodeId &&
        edge.bidirectional &&
        OPPOSITE_DIRECTION[edge.direction] === moveDir
      ) {
        const target = graph.nodes[edge.fromNodeId];
        if (target && target.locationKey === locationKey) return target.id;
      }
    }
  }

  // 2. Direct canonical ID match
  if (graph.nodes[locationKey]) {
    return locationKey;
  }

  // 3. Any node matching locationKey
  const match = Object.values(graph.nodes).find((n) => n.locationKey === locationKey);
  return match?.id ?? null;
}

/**
 * Pure reducer updating the Auto-Map graph immediately on every settled Z-machine turn.
 */
export function applyTurnToMap(graph: GameMapGraph, turn: TurnSnapshot): GameMapGraph {
  const delta = turn.narrativeDelta.trim();
  const moveDir = parseMovementCommand(turn.command);
  const isDark = DARKNESS_PATTERNS.some((p) => p.test(delta));
  const rawTitle = inferRoomTitleFromTurn(turn);

  // Clone top-level maps shallowly for immutability
  const next: GameMapGraph = {
    ...graph,
    nodes: { ...graph.nodes },
    edges: { ...graph.edges },
    updatedAt: Date.now(),
  };

  const prevNode = next.currentNodeId ? next.nodes[next.currentNodeId] : undefined;

  // Handle failed/blocked movement while staying in the same room
  if (prevNode && moveDir) {
    const noExit = NO_EXIT_PATTERNS.some((p) => p.test(delta));
    if (noExit) {
      const explored = getExploredDirections(next, prevNode.id);
      next.nodes[prevNode.id] = {
        ...prevNode,
        unexploredExits: mergeUnexploredExits(prevNode.unexploredExits, [], explored, moveDir),
      };
      return next;
    }
  }

  // If the game didn't supply a recognizable room title and we're in darkness, keep/create dark room
  const effectiveTitle = rawTitle ?? (isDark ? 'Pitch Black' : null);
  if (!effectiveTitle) {
    return next;
  }

  const locationKey =
    isDark && !rawTitle ? '__darkness__' : normalizeLocationKey(effectiveTitle);

  // Stayed in the same room
  if (prevNode && prevNode.locationKey === locationKey) {
    // Check if player attempted a blocked/locked exit in this room
    if (moveDir) {
      const blockedMatch = BLOCKED_LOCKED_PATTERNS.find((p) => p.regex.test(delta));
      if (blockedMatch) {
        const stubId = `${prevNode.id}--${moveDir}--blocked`;
        next.edges[stubId] = {
          id: stubId,
          fromNodeId: prevNode.id,
          toNodeId: prevNode.id,
          direction: moveDir,
          bidirectional: false,
          status: blockedMatch.status,
          label: blockedMatch.status === 'locked' ? 'locked' : 'blocked',
        };
      }
    }

    const discoveredExits = isDark ? [] : extractMentionedExits(delta);
    const explored = getExploredDirections(next, prevNode.id);
    next.nodes[prevNode.id] = {
      ...prevNode,
      isDark,
      description:
        !isDark && delta.length > (prevNode.description?.length ?? 0)
          ? delta.slice(0, 1200)
          : prevNode.description,
      unexploredExits: mergeUnexploredExits(prevNode.unexploredExits, discoveredExits, explored),
    };
    return next;
  }

  // Entering a new or previously visited room!
  const existingTargetId = findNodeIdForLocation(next, locationKey, prevNode?.id ?? null, moveDir);
  const effectiveDir: CompassDirection = moveDir ?? 'special';
  const vec = DIRECTION_VECTORS[effectiveDir];

  let targetId = existingTargetId;
  if (!targetId) {
    targetId = locationKey;
    const level = prevNode ? prevNode.level + vec.dLevel : 0;
    const position = prevNode
      ? findOpenPosition(next.nodes, prevNode.position, level, effectiveDir)
      : { x: 0, y: 0 };

    const discoveredExits = isDark ? [] : extractMentionedExits(delta);
    next.nodes[targetId] = {
      id: targetId,
      locationKey,
      title: effectiveTitle,
      level,
      position,
      positionLocked: false,
      visited: true,
      isDark,
      description: isDark ? undefined : delta.slice(0, 1200),
      unexploredExits: discoveredExits,
      userNotes: '',
    };
  } else {
    const existing = next.nodes[targetId];
    const discoveredExits = isDark ? [] : extractMentionedExits(delta);
    const explored = getExploredDirections(next, targetId);
    next.nodes[targetId] = {
      ...existing,
      visited: true,
      isDark,
      title: effectiveTitle || existing.title,
      description:
        !isDark && !existing.description && delta.length >= 40
          ? delta.slice(0, 1200)
          : existing.description,
      unexploredExits: mergeUnexploredExits(existing.unexploredExits, discoveredExits, explored),
    };
  }

  // Link edge from prevNode -> targetId
  if (prevNode && prevNode.id !== targetId) {
    // Remove any previous blocked stub for this direction now that passage succeeded
    delete next.edges[`${prevNode.id}--${effectiveDir}--blocked`];

    const oppDir = OPPOSITE_DIRECTION[effectiveDir];
    // Check if reverse edge already exists (targetId -> prevNode via oppDir)
    const reverseEdge = oppDir
      ? Object.values(next.edges).find(
          (e) =>
            e.fromNodeId === targetId &&
            e.toNodeId === prevNode.id &&
            e.direction === oppDir &&
            e.status === 'open',
        )
      : undefined;

    const existingForward = Object.values(next.edges).find(
      (e) =>
        e.fromNodeId === prevNode.id &&
        e.toNodeId === targetId &&
        e.direction === effectiveDir,
    );

    if (reverseEdge) {
      next.edges[reverseEdge.id] = {
        ...reverseEdge,
        bidirectional: true,
        status: 'open',
      };
    } else if (existingForward) {
      next.edges[existingForward.id] = {
        ...existingForward,
        status: 'open',
      };
    } else {
      const edgeId = `${prevNode.id}--${effectiveDir}--${targetId}`;
      const isOneWay = /chimney|chute|slide|falls? behind you|slams shut|cannot go back/i.test(
        delta,
      );
      next.edges[edgeId] = {
        id: edgeId,
        fromNodeId: prevNode.id,
        toNodeId: targetId,
        direction: effectiveDir,
        bidirectional: false,
        status: isOneWay ? 'one_way' : 'open',
      };
    }

    // Prune taken direction from prevNode's unexplored exits
    const prevExplored = getExploredDirections(next, prevNode.id);
    next.nodes[prevNode.id] = {
      ...next.nodes[prevNode.id],
      unexploredExits: mergeUnexploredExits(
        next.nodes[prevNode.id].unexploredExits,
        [],
        prevExplored,
        effectiveDir,
      ),
    };

    // Prune opposite direction on targetId if bidirectional
    if (oppDir) {
      const targetExplored = getExploredDirections(next, targetId);
      next.nodes[targetId] = {
        ...next.nodes[targetId],
        unexploredExits: mergeUnexploredExits(
          next.nodes[targetId].unexploredExits,
          [],
          targetExplored,
        ),
      };
    }
  }

  next.currentNodeId = targetId;
  next.activeLevel = next.nodes[targetId].level;
  return next;
}

/**
 * Enriches the active map node with LLM-extracted exits & canonical room description.
 */
export function applyDirectorHintsToMap(
  graph: GameMapGraph,
  director: SceneDirectorOutput,
): GameMapGraph {
  const targetId =
    graph.currentNodeId && graph.nodes[graph.currentNodeId]?.locationKey === director.locationKey
      ? graph.currentNodeId
      : Object.values(graph.nodes).find((n) => n.locationKey === director.locationKey)?.id ?? null;

  if (!targetId) return graph;
  const node = graph.nodes[targetId];
  if (!node) return graph;

  const hintedDirs = (director.mapHints?.mentionedExits ?? [])
    .map((d) => normalizeDirection(d))
    .filter((d): d is CompassDirection => d !== null);

  const explored = getExploredDirections(graph, targetId);
  const updatedExits = mergeUnexploredExits(node.unexploredExits, hintedDirs, explored);

  const nextEdges = { ...graph.edges };
  if (director.mapHints?.isOneWaySuspected) {
    for (const edge of Object.values(nextEdges)) {
      if (edge.toNodeId === targetId && !edge.bidirectional && edge.status === 'open') {
        nextEdges[edge.id] = { ...edge, status: 'one_way' };
      }
    }
  }

  return {
    ...graph,
    nodes: {
      ...graph.nodes,
      [targetId]: {
        ...node,
        description: director.updatedBaseDescription || node.description,
        unexploredExits: updatedExits,
      },
    },
    edges: nextEdges,
    updatedAt: Date.now(),
  };
}

/**
 * Attaches a Phase 1 generated/cached artwork URL as thumbnail for matching room node(s).
 */
export function attachArtworkToMap(
  graph: GameMapGraph,
  locationKey: string,
  imageUrl: string,
): GameMapGraph {
  let changed = false;
  const nextNodes = { ...graph.nodes };

  for (const [id, node] of Object.entries(nextNodes)) {
    if (node.locationKey === locationKey && node.thumbnailUrl !== imageUrl) {
      nextNodes[id] = { ...node, thumbnailUrl: imageUrl };
      changed = true;
    }
  }

  if (!changed) return graph;
  return { ...graph, nodes: nextNodes, updatedAt: Date.now() };
}

export function moveMapNode(
  graph: GameMapGraph,
  nodeId: string,
  position: { x: number; y: number },
): GameMapGraph {
  const node = graph.nodes[nodeId];
  if (!node) return graph;
  return {
    ...graph,
    nodes: {
      ...graph.nodes,
      [nodeId]: { ...node, position, positionLocked: true },
    },
    updatedAt: Date.now(),
  };
}

export function updateMapNodeNotes(
  graph: GameMapGraph,
  nodeId: string,
  userNotes: string,
): GameMapGraph {
  const node = graph.nodes[nodeId];
  if (!node) return graph;
  return {
    ...graph,
    nodes: {
      ...graph.nodes,
      [nodeId]: { ...node, userNotes },
    },
    updatedAt: Date.now(),
  };
}

export function setMapNodeColor(
  graph: GameMapGraph,
  nodeId: string,
  markerColor: string | undefined,
): GameMapGraph {
  const node = graph.nodes[nodeId];
  if (!node) return graph;
  return {
    ...graph,
    nodes: {
      ...graph.nodes,
      [nodeId]: { ...node, markerColor },
    },
    updatedAt: Date.now(),
  };
}

/**
 * Manual escape hatch for identical-name mazes (e.g. Zork's "Maze of twisty little passages"):
 * forks the current node into a distinct maze node so the player can map each identically named room separately.
 */
export function splitCurrentRoomAsMazeNode(graph: GameMapGraph): GameMapGraph {
  if (!graph.currentNodeId) return graph;
  const current = graph.nodes[graph.currentNodeId];
  if (!current) return graph;

  const existingCount = Object.values(graph.nodes).filter(
    (n) => n.locationKey === current.locationKey,
  ).length;
  const newId = `${current.locationKey}__${existingCount + 1}`;
  const position = findOpenPosition(graph.nodes, current.position, current.level, 'e');

  const newNode: MapNode = {
    ...current,
    id: newId,
    title: `${current.title} (#${existingCount + 1})`,
    position,
    positionLocked: false,
    userNotes: '',
  };

  return {
    ...graph,
    currentNodeId: newId,
    nodes: {
      ...graph.nodes,
      [newId]: newNode,
    },
    updatedAt: Date.now(),
  };
}

export function deleteMapNode(graph: GameMapGraph, nodeId: string): GameMapGraph {
  if (!graph.nodes[nodeId]) return graph;
  const nextNodes = { ...graph.nodes };
  delete nextNodes[nodeId];

  const nextEdges: Record<string, MapEdge> = {};
  for (const [id, edge] of Object.entries(graph.edges)) {
    if (edge.fromNodeId !== nodeId && edge.toNodeId !== nodeId) {
      nextEdges[id] = edge;
    }
  }

  return {
    ...graph,
    currentNodeId: graph.currentNodeId === nodeId ? null : graph.currentNodeId,
    nodes: nextNodes,
    edges: nextEdges,
    updatedAt: Date.now(),
  };
}

export function resetMapGraph(storyId: string): GameMapGraph {
  return createEmptyMapGraph(storyId);
}
