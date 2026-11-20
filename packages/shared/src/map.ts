export type CompassDirection =
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw'
  | 'u'
  | 'd'
  | 'in'
  | 'out'
  | 'special';

export type MapEdgeStatus = 'open' | 'locked' | 'one_way' | 'blocked';

export interface MapNode {
  id: string;
  locationKey: string;
  title: string;
  level: number;
  position: { x: number; y: number };
  positionLocked: boolean;
  visited: boolean;
  isDark: boolean;
  thumbnailUrl?: string;
  description?: string;
  unexploredExits: CompassDirection[];
  userNotes: string;
  markerColor?: string;
}

export interface MapEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  direction: CompassDirection;
  bidirectional: boolean;
  status: MapEdgeStatus;
  label?: string;
}

export interface GameMapGraph {
  storyId: string;
  currentNodeId: string | null;
  activeLevel: number;
  nodes: Record<string, MapNode>;
  edges: Record<string, MapEdge>;
  updatedAt: number;
}

export const OPPOSITE_DIRECTION: Partial<Record<CompassDirection, CompassDirection>> = {
  n: 's',
  s: 'n',
  e: 'w',
  w: 'e',
  ne: 'sw',
  sw: 'ne',
  nw: 'se',
  se: 'nw',
  u: 'd',
  d: 'u',
  in: 'out',
  out: 'in',
};

export const DIRECTION_COMMAND: Record<CompassDirection, string> = {
  n: 'north',
  s: 'south',
  e: 'east',
  w: 'west',
  ne: 'northeast',
  nw: 'northwest',
  se: 'southeast',
  sw: 'southwest',
  u: 'up',
  d: 'down',
  in: 'in',
  out: 'out',
  special: 'go',
};

export const DIRECTION_VECTORS: Record<
  CompassDirection,
  { dx: number; dy: number; dLevel: number }
> = {
  n: { dx: 0, dy: -1, dLevel: 0 },
  s: { dx: 0, dy: 1, dLevel: 0 },
  e: { dx: 1, dy: 0, dLevel: 0 },
  w: { dx: -1, dy: 0, dLevel: 0 },
  ne: { dx: 1, dy: -1, dLevel: 0 },
  nw: { dx: -1, dy: -1, dLevel: 0 },
  se: { dx: 1, dy: 1, dLevel: 0 },
  sw: { dx: -1, dy: 1, dLevel: 0 },
  u: { dx: 0, dy: 0, dLevel: 1 },
  d: { dx: 0, dy: 0, dLevel: -1 },
  in: { dx: 1, dy: 0, dLevel: 0 },
  out: { dx: -1, dy: 0, dLevel: 0 },
  special: { dx: 1, dy: 1, dLevel: 0 },
};

const DIRECTION_ALIASES: Record<string, CompassDirection> = {
  n: 'n',
  north: 'n',
  s: 's',
  south: 's',
  e: 'e',
  east: 'e',
  w: 'w',
  west: 'w',
  ne: 'ne',
  northeast: 'ne',
  'north-east': 'ne',
  nw: 'nw',
  northwest: 'nw',
  'north-west': 'nw',
  se: 'se',
  southeast: 'se',
  'south-east': 'se',
  sw: 'sw',
  southwest: 'sw',
  'south-west': 'sw',
  u: 'u',
  up: 'u',
  upstairs: 'u',
  d: 'd',
  down: 'd',
  downstairs: 'd',
  in: 'in',
  inside: 'in',
  enter: 'in',
  out: 'out',
  outside: 'out',
  exit: 'out',
  leave: 'out',
};

export function normalizeDirection(raw: string | null | undefined): CompassDirection | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  return DIRECTION_ALIASES[key] ?? null;
}

export function createEmptyMapGraph(storyId: string): GameMapGraph {
  return {
    storyId,
    currentNodeId: null,
    activeLevel: 0,
    nodes: {},
    edges: {},
    updatedAt: Date.now(),
  };
}
