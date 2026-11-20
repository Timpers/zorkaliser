import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DIRECTION_VECTORS,
  type CompassDirection,
  type GameMapGraph,
  type MapNode,
} from '@zorkaliser/shared';
import {
  Compass,
  Crosshair,
  Download,
  Footprints,
  GitFork,
  Layers,
  Lock,
  Moon,
  RotateCcw,
  Square,
  StickyNote,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  deleteMapNode,
  moveMapNode,
  resetMapGraph,
  setMapNodeColor,
  splitCurrentRoomAsMazeNode,
  updateMapNodeNotes,
} from '../engine/mapEngine.js';
import { findShortestWalkPath } from '../engine/mapPathfinder.js';
import { putSavedMap } from '../services/storage.js';
import { useGameStore } from '../store/gameStore.js';

interface MapCanvasProps {
  onWalkToNode: (nodeId: string) => void;
  onStopWalk: () => void;
}

const NODE_W = 156;
const NODE_H = 84;
const STUB_LEN = 46;

const MARKER_COLORS = [
  { label: 'None', value: undefined, swatch: '#3f3f46' },
  { label: 'Amber', value: '#f59e0b', swatch: '#f59e0b' },
  { label: 'Emerald', value: '#10b981', swatch: '#10b981' },
  { label: 'Sky', value: '#38bdf8', swatch: '#38bdf8' },
  { label: 'Rose', value: '#f43f5e', swatch: '#f43f5e' },
  { label: 'Violet', value: '#a855f7', swatch: '#a855f7' },
];

function stubOffset(dir: CompassDirection): { dx: number; dy: number; label: string } {
  if (dir === 'u') return { dx: 0, dy: -(NODE_H / 2 + 26), label: '↑' };
  if (dir === 'd') return { dx: 0, dy: NODE_H / 2 + 26, label: '↓' };
  const v = DIRECTION_VECTORS[dir];
  const len = Math.hypot(v.dx, v.dy) || 1;
  const nx = v.dx / len;
  const ny = v.dy / len;
  return {
    dx: nx * (NODE_W / 2 + STUB_LEN),
    dy: ny * (NODE_H / 2 + STUB_LEN),
    label: dir.toUpperCase(),
  };
}

function formatFloorLabel(level: number): string {
  if (level === 0) return 'Ground';
  return level > 0 ? `F+${level}` : `F${level}`;
}

export const MapCanvas: React.FC<MapCanvasProps> = ({ onWalkToNode, onStopWalk }) => {
  const { story, mapGraph, autoWalkStatus, setMapGraph, updateMapGraph } = useGameStore();

  const svgRef = useRef<SVGSVGElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [viewLevel, setViewLevel] = useState<number>(0);

  const panDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null,
  );
  const nodeDragRef = useRef<{
    nodeId: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);

  // Sync viewed floor when player changes elevation
  useEffect(() => {
    if (mapGraph && typeof mapGraph.activeLevel === 'number') {
      setViewLevel(mapGraph.activeLevel);
    }
  }, [mapGraph?.activeLevel, mapGraph?.currentNodeId]);

  const centerOnCurrent = () => {
    if (!mapGraph?.currentNodeId) return;
    const node = mapGraph.nodes[mapGraph.currentNodeId];
    if (!node) return;
    setViewLevel(node.level);
    setPan({ x: -node.position.x * zoom, y: -node.position.y * zoom });
  };

  // Auto-center when first node appears or current node changes while user isn't dragging
  useEffect(() => {
    if (!mapGraph?.currentNodeId || panDragRef.current || nodeDragRef.current) return;
    const node = mapGraph.nodes[mapGraph.currentNodeId];
    if (!node) return;
    setPan({ x: -node.position.x * zoom, y: -node.position.y * zoom });
  }, [mapGraph?.currentNodeId]);

  const persistUpdate = (updater: (g: GameMapGraph) => GameMapGraph) => {
    updateMapGraph((curr) => {
      const next = updater(curr);
      void putSavedMap(next);
      return next;
    });
  };

  const allNodes = useMemo(() => (mapGraph ? Object.values(mapGraph.nodes) : []), [mapGraph]);
  const allEdges = useMemo(() => (mapGraph ? Object.values(mapGraph.edges) : []), [mapGraph]);

  const levels = useMemo(() => {
    const set = new Set<number>([0]);
    for (const n of allNodes) set.add(n.level);
    return Array.from(set).sort((a, b) => b - a);
  }, [allNodes]);

  const levelNodes = useMemo(
    () => allNodes.filter((n) => n.level === viewLevel),
    [allNodes, viewLevel],
  );
  const ghostNodes = useMemo(
    () => allNodes.filter((n) => Math.abs(n.level - viewLevel) === 1),
    [allNodes, viewLevel],
  );

  const selectedNode: MapNode | null =
    selectedNodeId && mapGraph?.nodes[selectedNodeId] ? mapGraph.nodes[selectedNodeId] : null;

  const selectedWalkPlan = useMemo(() => {
    if (!mapGraph?.currentNodeId || !selectedNode || selectedNode.id === mapGraph.currentNodeId) {
      return null;
    }
    return findShortestWalkPath(mapGraph, mapGraph.currentNodeId, selectedNode.id);
  }, [mapGraph, selectedNode]);

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom((z) => Math.min(2.2, Math.max(0.4, Number((z * factor).toFixed(2)))));
  };

  const handleSvgMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    panDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pan.x,
      origY: pan.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (nodeDragRef.current) {
      const dx = (e.clientX - nodeDragRef.current.startX) / zoom;
      const dy = (e.clientY - nodeDragRef.current.startY) / zoom;
      if (Math.hypot(dx, dy) > 4) {
        nodeDragRef.current.moved = true;
      }
      const { nodeId, origX, origY } = nodeDragRef.current;
      updateMapGraph((g) => moveMapNode(g, nodeId, { x: Math.round(origX + dx), y: Math.round(origY + dy) }));
      return;
    }
    if (panDragRef.current) {
      const dx = e.clientX - panDragRef.current.startX;
      const dy = e.clientY - panDragRef.current.startY;
      setPan({ x: panDragRef.current.origX + dx, y: panDragRef.current.origY + dy });
    }
  };

  const handleMouseUp = () => {
    if (nodeDragRef.current?.moved && useGameStore.getState().mapGraph) {
      void putSavedMap(useGameStore.getState().mapGraph!);
    }
    nodeDragRef.current = null;
    panDragRef.current = null;
  };

  const handleExportJson = () => {
    if (!mapGraph || !story) return;
    const blob = new Blob([JSON.stringify(mapGraph, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${story.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_map.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const buildCleanSvgMarkup = (): string | null => {
    if (!mapGraph || levelNodes.length === 0) return null;
    const pad = 140;
    const minX = Math.min(...levelNodes.map((n) => n.position.x)) - NODE_W / 2 - pad;
    const maxX = Math.max(...levelNodes.map((n) => n.position.x)) + NODE_W / 2 + pad;
    const minY = Math.min(...levelNodes.map((n) => n.position.y)) - NODE_H / 2 - pad;
    const maxY = Math.max(...levelNodes.map((n) => n.position.y)) + NODE_H / 2 + pad;
    const width = Math.max(600, maxX - minX);
    const height = Math.max(400, maxY - minY);

    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const edgeMarkup = allEdges
      .filter((e) => {
        const a = mapGraph.nodes[e.fromNodeId];
        const b = mapGraph.nodes[e.toNodeId];
        return a && b && a.level === viewLevel && b.level === viewLevel && a.id !== b.id;
      })
      .map((e) => {
        const a = mapGraph.nodes[e.fromNodeId];
        const b = mapGraph.nodes[e.toNodeId];
        const stroke = e.status === 'one_way' ? '#f59e0b' : '#71717a';
        const dash = e.status === 'one_way' ? 'stroke-dasharray="6 4"' : '';
        return `<line x1="${a.position.x}" y1="${a.position.y}" x2="${b.position.x}" y2="${b.position.y}" stroke="${stroke}" stroke-width="2.5" ${dash} />`;
      })
      .join('\n');

    const nodeMarkup = levelNodes
      .map((n) => {
        const x = n.position.x - NODE_W / 2;
        const y = n.position.y - NODE_H / 2;
        const isCurr = n.id === mapGraph.currentNodeId;
        const stroke = isCurr ? '#f59e0b' : n.markerColor || '#52525b';
        return `<g>
          <rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="10" fill="#18181b" stroke="${stroke}" stroke-width="${isCurr ? 3 : 1.5}" />
          <text x="${n.position.x}" y="${n.position.y + 4}" text-anchor="middle" fill="#f4f4f5" font-family="Georgia, serif" font-size="13" font-weight="600">${esc(n.title.slice(0, 22))}</text>
        </g>`;
      })
      .join('\n');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}">
  <rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#09090b" />
  ${edgeMarkup}
  ${nodeMarkup}
</svg>`;
  };

  const handleExportSvg = () => {
    const svg = buildCleanSvgMarkup();
    if (!svg || !story) return;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${story.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_map.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPng = () => {
    const svg = buildCleanSvgMarkup();
    if (!svg || !story) return;
    const img = new Image();
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width * 2;
      canvas.height = img.height * 2;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(2, 2);
        ctx.drawImage(img, 0, 0);
        const pngUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = `${story.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_map.png`;
        a.click();
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const handleImportJson = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as GameMapGraph;
      if (parsed && typeof parsed.nodes === 'object' && typeof parsed.edges === 'object') {
        const imported: GameMapGraph = {
          ...parsed,
          storyId: story?.header.storyId ?? parsed.storyId,
          updatedAt: Date.now(),
        };
        setMapGraph(imported);
        void putSavedMap(imported);
      }
    } catch {
      // ignore invalid JSON
    }
  };

  if (!mapGraph || !story) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950 text-xs text-zinc-500">
        Load a story to begin auto-mapping.
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-zinc-950 select-none">
      {/* Top Map Toolbar */}
      <div className="z-20 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/90 bg-zinc-950/95 px-3 py-2 text-xs">
        <div className="flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 text-amber-400" />
          <div className="flex items-center gap-1">
            {levels.map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setViewLevel(lvl)}
                className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                  viewLevel === lvl
                    ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                    : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {formatFloorLabel(lvl)}
              </button>
            ))}
          </div>
          <span className="ml-1 text-[11px] text-zinc-500">
            {allNodes.length} {allNodes.length === 1 ? 'room' : 'rooms'}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={centerOnCurrent}
            className="rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-300 hover:bg-zinc-800"
            title="Center on current room"
          >
            <Crosshair className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.4, Number((z - 0.15).toFixed(2))))}
            className="rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-300 hover:bg-zinc-800"
            title="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2.2, Number((z + 0.15).toFixed(2))))}
            className="rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-300 hover:bg-zinc-800"
            title="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>

          <div className="mx-0.5 h-4 w-px bg-zinc-800" />

          <button
            type="button"
            onClick={handleExportSvg}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
            title="Export floor as SVG"
          >
            SVG
          </button>
          <button
            type="button"
            onClick={handleExportPng}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
            title="Export floor as PNG"
          >
            PNG
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            className="rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-300 hover:bg-zinc-800"
            title="Export map JSON"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImportJson(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-300 hover:bg-zinc-800"
            title="Import map JSON"
          >
            <Upload className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              const fresh = resetMapGraph(story.header.storyId);
              setMapGraph(fresh);
              setSelectedNodeId(null);
              void putSavedMap(fresh);
            }}
            className="rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 hover:border-red-500/40 hover:text-red-300"
            title="Reset map"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Active Click-to-Walk Banner */}
      {autoWalkStatus && (
        <div className="z-20 flex items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3.5 py-1.5 text-xs text-amber-200">
          <div className="flex items-center gap-2">
            <Footprints className="h-3.5 w-3.5 text-amber-400" />
            <span>
              {autoWalkStatus.notice
                ? autoWalkStatus.notice
                : `Walking to ${autoWalkStatus.targetTitle} (${autoWalkStatus.remainingSteps} ${autoWalkStatus.remainingSteps === 1 ? 'step' : 'steps'} left)...`}
            </span>
          </div>
          {autoWalkStatus.remainingSteps > 0 ? (
            <button
              type="button"
              onClick={onStopWalk}
              className="flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-200 hover:bg-amber-500/30"
            >
              <Square className="h-2.5 w-2.5 fill-current" />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={onStopWalk}
              className="rounded p-0.5 hover:bg-amber-500/20"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Interactive SVG Map Viewport */}
      <div className="relative flex-1 overflow-hidden">
        <svg
          ref={svgRef}
          onWheel={handleWheel}
          onMouseDown={handleSvgMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={() => {
            if (!nodeDragRef.current?.moved) setSelectedNodeId(null);
          }}
          className="h-full w-full cursor-grab active:cursor-grabbing"
        >
          <defs>
            <pattern id="zork-map-grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="rgba(161,161,170,0.14)" />
            </pattern>
            <marker
              id="arrow-oneway"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#f59e0b" />
            </marker>
            <linearGradient id="node-vignette" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#09090b" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#09090b" stopOpacity="0.88" />
            </linearGradient>
            {levelNodes.map((n) => (
              <clipPath key={`clip-${n.id}`} id={`clip-${n.id}`}>
                <rect
                  x={n.position.x - NODE_W / 2}
                  y={n.position.y - NODE_H / 2}
                  width={NODE_W}
                  height={NODE_H}
                  rx="10"
                />
              </clipPath>
            ))}
          </defs>

          <rect width="100%" height="100%" fill="url(#zork-map-grid)" />

          {/* World Transform Group centered in SVG */}
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            <g transform="translate(360, 220)">
              {/* Ghosted Adjacent-Floor Nodes */}
              {ghostNodes.map((n) => (
                <g
                  key={`ghost-${n.id}`}
                  opacity={0.22}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setViewLevel(n.level);
                  }}
                >
                  <rect
                    x={n.position.x - NODE_W / 2}
                    y={n.position.y - NODE_H / 2}
                    width={NODE_W}
                    height={NODE_H}
                    rx="10"
                    fill="#18181b"
                    stroke="#71717a"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={n.position.x}
                    y={n.position.y + 4}
                    textAnchor="middle"
                    fill="#a1a1aa"
                    fontSize="11"
                  >
                    {n.title.slice(0, 18)} ({formatFloorLabel(n.level)})
                  </text>
                </g>
              ))}

              {/* Edges on Active Floor & Cross-Floor Stair Links */}
              {allEdges.map((edge) => {
                const from = mapGraph.nodes[edge.fromNodeId];
                const to = mapGraph.nodes[edge.toNodeId];
                if (!from || !to) return null;

                // Blocked/Locked directional stub on current floor
                if (from.id === to.id && from.level === viewLevel) {
                  const stub = stubOffset(edge.direction);
                  const tx = from.position.x + stub.dx;
                  const ty = from.position.y + stub.dy;
                  return (
                    <g key={edge.id}>
                      <line
                        x1={from.position.x}
                        y1={from.position.y}
                        x2={tx}
                        y2={ty}
                        stroke="#ef4444"
                        strokeWidth={2}
                        strokeDasharray="4 3"
                      />
                      <circle cx={tx} cy={ty} r="9" fill="#450a0a" stroke="#ef4444" strokeWidth={1.5} />
                      <text
                        x={tx}
                        y={ty + 3.5}
                        textAnchor="middle"
                        fill="#fca5a5"
                        fontSize="9"
                        fontWeight="700"
                      >
                        ✕
                      </text>
                    </g>
                  );
                }

                // Cross-floor UP/DOWN indicator badge
                if (from.level !== to.level) {
                  if (from.level !== viewLevel && to.level !== viewLevel) return null;
                  const anchor = from.level === viewLevel ? from : to;
                  const goesUp =
                    from.level === viewLevel ? to.level > from.level : from.level > to.level;
                  const targetLevel = from.level === viewLevel ? to.level : from.level;
                  const badgeY = anchor.position.y + (goesUp ? -NODE_H / 2 - 14 : NODE_H / 2 + 14);
                  return (
                    <g
                      key={edge.id}
                      className="cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setViewLevel(targetLevel);
                      }}
                    >
                      <rect
                        x={anchor.position.x - 24}
                        y={badgeY - 9}
                        width="48"
                        height="18"
                        rx="9"
                        fill="#27272a"
                        stroke="#f59e0b"
                        strokeWidth={1}
                      />
                      <text
                        x={anchor.position.x}
                        y={badgeY + 3.5}
                        textAnchor="middle"
                        fill="#fcd34d"
                        fontSize="10"
                        fontWeight="600"
                      >
                        {goesUp ? '↑ UP' : '↓ DN'}
                      </text>
                    </g>
                  );
                }

                if (from.level !== viewLevel) return null;

                const isOneWay = edge.status === 'one_way' || !edge.bidirectional;
                return (
                  <g key={edge.id}>
                    <line
                      x1={from.position.x}
                      y1={from.position.y}
                      x2={to.position.x}
                      y2={to.position.y}
                      stroke={edge.status === 'one_way' ? '#f59e0b' : '#71717a'}
                      strokeWidth={edge.bidirectional ? 2.5 : 2}
                      strokeDasharray={edge.status === 'one_way' ? '6 4' : undefined}
                      markerEnd={isOneWay ? 'url(#arrow-oneway)' : undefined}
                    />
                  </g>
                );
              })}

              {/* Dashed Unexplored Exit Stubs */}
              {levelNodes.map((node) =>
                node.unexploredExits.map((dir) => {
                  const stub = stubOffset(dir);
                  const tx = node.position.x + stub.dx;
                  const ty = node.position.y + stub.dy;
                  return (
                    <g key={`stub-${node.id}-${dir}`} opacity={0.65}>
                      <line
                        x1={node.position.x}
                        y1={node.position.y}
                        x2={tx}
                        y2={ty}
                        stroke="#71717a"
                        strokeWidth={1.5}
                        strokeDasharray="3 4"
                      />
                      <circle cx={tx} cy={ty} r="9" fill="#18181b" stroke="#52525b" strokeWidth={1} />
                      <text
                        x={tx}
                        y={ty + 3}
                        textAnchor="middle"
                        fill="#a1a1aa"
                        fontSize="8.5"
                        fontWeight="600"
                      >
                        {stub.label}
                      </text>
                    </g>
                  );
                }),
              )}

              {/* Room Nodes on Active Floor */}
              {levelNodes.map((node) => {
                const x = node.position.x - NODE_W / 2;
                const y = node.position.y - NODE_H / 2;
                const isCurrent = node.id === mapGraph.currentNodeId;
                const isSelected = node.id === selectedNodeId;

                return (
                  <g
                    key={node.id}
                    className="cursor-pointer"
                    onMouseDown={(e) => {
                      if (e.button !== 0) return;
                      e.stopPropagation();
                      nodeDragRef.current = {
                        nodeId: node.id,
                        startX: e.clientX,
                        startY: e.clientY,
                        origX: node.position.x,
                        origY: node.position.y,
                        moved: false,
                      };
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!nodeDragRef.current?.moved) {
                        setSelectedNodeId(node.id);
                      }
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (node.id !== mapGraph.currentNodeId) {
                        onWalkToNode(node.id);
                      }
                    }}
                  >
                    {/* Current location subtle glow */}
                    {isCurrent && (
                      <rect
                        x={x - 4}
                        y={y - 4}
                        width={NODE_W + 8}
                        height={NODE_H + 8}
                        rx="13"
                        fill="none"
                        stroke="#f59e0b"
                        strokeOpacity="0.45"
                        strokeWidth={3}
                      />
                    )}

                    {/* Card Base */}
                    <rect
                      x={x}
                      y={y}
                      width={NODE_W}
                      height={NODE_H}
                      rx="10"
                      fill="#18181b"
                    />

                    {/* Phase 1 AI Artwork Thumbnail */}
                    {node.thumbnailUrl && (
                      <g clipPath={`url(#clip-${node.id})`}>
                        <image
                          href={node.thumbnailUrl}
                          x={x}
                          y={y}
                          width={NODE_W}
                          height={NODE_H}
                          preserveAspectRatio="xMidYMid slice"
                        />
                        <rect
                          x={x}
                          y={y}
                          width={NODE_W}
                          height={NODE_H}
                          fill="url(#node-vignette)"
                        />
                      </g>
                    )}

                    {/* Custom Marker Color Accent Bar */}
                    {node.markerColor && (
                      <rect
                        x={x + 8}
                        y={y + 3}
                        width={NODE_W - 16}
                        height={3}
                        rx="1.5"
                        fill={node.markerColor}
                      />
                    )}

                    {/* Card Border */}
                    <rect
                      x={x}
                      y={y}
                      width={NODE_W}
                      height={NODE_H}
                      rx="10"
                      fill="none"
                      stroke={isCurrent ? '#f59e0b' : isSelected ? '#e4e4e7' : '#3f3f46'}
                      strokeWidth={isCurrent ? 2.5 : isSelected ? 2 : 1.25}
                    />

                    {/* Current Player Beacon Dot */}
                    {isCurrent && (
                      <circle cx={x + 12} cy={y + 12} r="4.5" fill="#f59e0b" stroke="#09090b" strokeWidth={1.5} />
                    )}

                    {/* Dark Room Indicator */}
                    {node.isDark && (
                      <text x={x + NODE_W - 14} y={y + 16} textAnchor="middle" fill="#a1a1aa" fontSize="11">
                        ☾
                      </text>
                    )}

                    {/* Notes Indicator Dot */}
                    {node.userNotes.trim().length > 0 && (
                      <circle cx={x + NODE_W - 12} cy={y + NODE_H - 12} r="3.5" fill="#38bdf8" />
                    )}

                    {/* Room Title */}
                    <text
                      x={node.position.x}
                      y={node.thumbnailUrl ? y + NODE_H - 12 : node.position.y + 4}
                      textAnchor="middle"
                      fill="#fafafa"
                      fontFamily="Georgia, serif"
                      fontSize="12"
                      fontWeight="600"
                    >
                      {node.title.length > 21 ? `${node.title.slice(0, 20)}…` : node.title}
                    </text>
                  </g>
                );
              })}
            </g>
          </g>
        </svg>

        {/* Empty State Helper */}
        {allNodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <Compass className="h-8 w-8 text-zinc-700" />
            <p className="mt-2 text-xs text-zinc-400">Your map will draw itself as you explore.</p>
          </div>
        )}

        {/* Bottom-left Quick Hint */}
        <div className="pointer-events-none absolute bottom-2.5 left-3 rounded-md bg-zinc-950/80 px-2 py-1 text-[10px] text-zinc-500 backdrop-blur-sm">
          Drag background to pan · Drag rooms to arrange · Double-click a room to walk there
        </div>

        {/* Selected Room Inspector Popover */}
        {selectedNode && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute right-3 bottom-3 z-30 w-72 overflow-hidden rounded-xl border border-zinc-700/90 bg-zinc-950/95 shadow-2xl backdrop-blur-md"
          >
            {selectedNode.thumbnailUrl && (
              <div className="relative h-28 w-full overflow-hidden bg-zinc-900">
                <img
                  src={selectedNode.thumbnailUrl}
                  alt={selectedNode.title}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent" />
              </div>
            )}

            <div className="space-y-3 p-3.5 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="truncate font-serif text-sm font-semibold text-zinc-100">
                      {selectedNode.title}
                    </h3>
                    {selectedNode.isDark && <Moon className="h-3.5 w-3.5 text-zinc-400" />}
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    {formatFloorLabel(selectedNode.level)}
                    {selectedNode.id === mapGraph.currentNodeId ? ' · Current Location' : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedNodeId(null)}
                  className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {selectedNode.description && (
                <p className="line-clamp-3 text-[11px] leading-relaxed text-zinc-400">
                  {selectedNode.description}
                </p>
              )}

              {/* Click-to-Walk Action */}
              {selectedNode.id !== mapGraph.currentNodeId && (
                <div>
                  {selectedWalkPlan ? (
                    <button
                      type="button"
                      onClick={() => onWalkToNode(selectedNode.id)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
                    >
                      <Footprints className="h-3.5 w-3.5" />
                      Walk Here ({selectedWalkPlan.steps.length}{' '}
                      {selectedWalkPlan.steps.length === 1 ? 'step' : 'steps'})
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/70 px-2.5 py-1.5 text-[11px] text-zinc-500">
                      <Lock className="h-3 w-3" />
                      No known open path from current room
                    </div>
                  )}
                </div>
              )}

              {/* Editable Player Notes */}
              <div className="space-y-1">
                <label className="flex items-center gap-1 text-[11px] text-zinc-400">
                  <StickyNote className="h-3 w-3 text-sky-400" />
                  Room Notes
                </label>
                <textarea
                  rows={2}
                  value={selectedNode.userNotes}
                  onChange={(e) =>
                    persistUpdate((g) => updateMapNodeNotes(g, selectedNode.id, e.target.value))
                  }
                  placeholder="e.g., Need brass key for grating, troll guarding bridge..."
                  className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
                />
              </div>

              {/* Marker Swatches & Escape Hatches */}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-1.5">
                  {MARKER_COLORS.map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      onClick={() =>
                        persistUpdate((g) => setMapNodeColor(g, selectedNode.id, c.value))
                      }
                      className={`h-4 w-4 rounded-full border transition ${
                        selectedNode.markerColor === c.value
                          ? 'scale-110 border-white'
                          : 'border-zinc-700 opacity-75 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: c.swatch }}
                      title={`Marker: ${c.label}`}
                    />
                  ))}
                </div>

                <div className="flex items-center gap-1">
                  {selectedNode.id === mapGraph.currentNodeId && (
                    <button
                      type="button"
                      onClick={() => {
                        persistUpdate((g) => splitCurrentRoomAsMazeNode(g));
                      }}
                      className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800"
                      title="Split as a separate maze room with the same title"
                    >
                      <GitFork className="h-3 w-3" />
                      Split Maze
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      persistUpdate((g) => deleteMapNode(g, selectedNode.id));
                      setSelectedNodeId(null);
                    }}
                    className="rounded-md p-1 text-zinc-500 hover:bg-red-950 hover:text-red-300"
                    title="Remove room from map"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
