/**
 * CodeGraph — interactive force-directed graph of the capability's code structure.
 *
 * Three graph modes:
 *   File Graph   – files as nodes, import relationships as edges (force sim)
 *   Symbol Graph – classes / functions / interfaces as nodes, containment edges (force sim)
 *   Flow         – hierarchical/topological layout showing architectural data flow
 *
 * Route: /code-graph
 */
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Code2,
  FileCode,
  GitBranch,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { EmptyState, PageHeader, StatTile } from '../components/EnterpriseUI';
import { fetchCodeGraph } from '../lib/api';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import type {
  ArchLayer,
  CapabilityCodeGraph,
  CodeGraphEdge,
  CodeGraphFileNode,
  CodeGraphNodeKind,
  CodeGraphSymbolNode,
} from '../types';

// ─── Simulation types ─────────────────────────────────────────────────────────

type SimNode = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed: boolean;
  // display
  label: string;
  kind: CodeGraphNodeKind;
  isEndpoint: boolean;
  isExported: boolean;
  filePath: string;
  line?: number;
  signature?: string;
  symbolCount?: number;
  language?: string;
  qualifiedName?: string;
  radius: number;
  layer?: ArchLayer;
  httpMethod?: string;
};

type SimEdge = CodeGraphEdge & { srcNode?: SimNode; tgtNode?: SimNode };

// ─── Visual constants ─────────────────────────────────────────────────────────

const NODE_COLORS: Record<string, { stroke: string; fill: string; text: string }> = {
  file:      { stroke: '#64748b', fill: '#1e293b', text: '#cbd5e1' },
  class:     { stroke: '#3b82f6', fill: '#172554', text: '#93c5fd' },
  interface: { stroke: '#22d3ee', fill: '#083344', text: '#67e8f9' },
  function:  { stroke: '#4ade80', fill: '#052e16', text: '#86efac' },
  method:    { stroke: '#a78bfa', fill: '#2e1065', text: '#c4b5fd' },
  endpoint:  { stroke: '#fb923c', fill: '#431407', text: '#fdba74' },
  enum:      { stroke: '#fbbf24', fill: '#422006', text: '#fde68a' },
  type:      { stroke: '#2dd4bf', fill: '#042f2e', text: '#5eead4' },
  variable:  { stroke: '#94a3b8', fill: '#1e293b', text: '#cbd5e1' },
  property:  { stroke: '#94a3b8', fill: '#1e293b', text: '#cbd5e1' },
};

const EDGE_COLORS: Record<string, string> = {
  imports:  '#38bdf8',
  contains: '#818cf8',
};

const HTTP_METHOD_COLORS: Record<string, string> = {
  GET:    '#4ade80',
  POST:   '#60a5fa',
  PUT:    '#fbbf24',
  PATCH:  '#34d399',
  DELETE: '#f87171',
};

const nodeRadius = (kind: CodeGraphNodeKind): number => {
  switch (kind) {
    case 'file':      return 0; // files are rects, radius controls collision only
    case 'class':     return 22;
    case 'endpoint':  return 24;
    case 'interface': return 18;
    case 'function':  return 16;
    case 'method':    return 12;
    case 'enum':      return 14;
    case 'type':      return 13;
    default:          return 10;
  }
};

const nodeCollisionRadius = (kind: CodeGraphNodeKind): number =>
  kind === 'file' ? 58 : nodeRadius(kind) + 14;

// ─── Flow layout constants ────────────────────────────────────────────────────

const FLOW_Y_SPACING = 220;
const FLOW_X_SPACING = 180;

function computeFlowPositions(nodes: SimNode[], edges: SimEdge[]): void {
  if (nodes.length === 0) return;

  // Build dependency graph (A imports B → A depends on B)
  const outEdges = new Map<string, string[]>();
  const inDegree  = new Map<string, number>();
  for (const n of nodes) { outEdges.set(n.id, []); inDegree.set(n.id, 0); }
  for (const e of edges) {
    outEdges.get(e.from)?.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }

  // BFS topological sort (Kahn's algorithm)
  const levels = new Map<string, number>();
  const queue  = nodes.filter(n => (inDegree.get(n.id) ?? 0) === 0).map(n => n.id);
  for (const id of queue) levels.set(id, 0);

  let qi = 0;
  while (qi < queue.length) {
    const id  = queue[qi++];
    const lv  = levels.get(id) ?? 0;
    for (const dep of (outEdges.get(id) ?? [])) {
      const next = lv + 1;
      if ((levels.get(dep) ?? -1) < next) {
        levels.set(dep, next);
        queue.push(dep);
      }
    }
  }
  // Assign orphans a level based on inDegree
  for (const n of nodes) {
    if (!levels.has(n.id)) levels.set(n.id, Math.min(5, inDegree.get(n.id) ?? 0));
  }

  // Group by level
  const byLevel = new Map<number, SimNode[]>();
  for (const n of nodes) {
    const l = levels.get(n.id) ?? 0;
    const arr = byLevel.get(l) ?? []; arr.push(n); byLevel.set(l, arr);
  }

  // Position
  const levelKeys = Array.from(byLevel.keys());
  const maxLevel = levelKeys.length > 0 ? Math.max(...levelKeys) : 0;
  const midY = (maxLevel * FLOW_Y_SPACING) / 2;
  for (const [level, levelNodes] of byLevel.entries()) {
    const y = level * FLOW_Y_SPACING - midY;
    const totalW = (levelNodes.length - 1) * FLOW_X_SPACING;
    levelNodes.forEach((n, i) => {
      n.x = i * FLOW_X_SPACING - totalW / 2;
      n.y = y;
      n.vx = 0; n.vy = 0;
    });
  }
}

// ─── Node shape renderer ──────────────────────────────────────────────────────

const HEXAGON_POINTS = (r: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');

const DIAMOND_POINTS = (r: number) =>
  `0,${-r} ${r},0 0,${r} ${-r},0`;

interface NodeShapeProps {
  node: SimNode;
  selected: boolean;
  hovered: boolean;
  onClick: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
}

const NodeShape: React.FC<NodeShapeProps> = React.memo(
  ({ node, selected, hovered, onClick, onMouseDown }) => {
    const colors = NODE_COLORS[node.kind] ?? NODE_COLORS.variable;
    const r = nodeRadius(node.kind);
    const highlight = selected || hovered;
    const strokeWidth = highlight ? 2.5 : 1.5;
    const strokeColor = highlight ? '#f8fafc' : colors.stroke;
    const glowFilter = selected ? 'url(#node-glow)' : undefined;

    const shape = (() => {
      if (node.kind === 'file') {
        return (
          <rect
            x={-52} y={-14}
            width={104} height={28}
            rx={5} ry={5}
            fill={node.isEndpoint ? '#431407' : colors.fill}
            stroke={node.isEndpoint ? '#fb923c' : strokeColor}
            strokeWidth={strokeWidth}
            filter={glowFilter}
          />
        );
      }
      if (node.kind === 'interface' || node.kind === 'type') {
        return (
          <polygon
            points={DIAMOND_POINTS(r + (highlight ? 2 : 0))}
            fill={colors.fill}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            filter={glowFilter}
          />
        );
      }
      if (node.kind === 'enum' || node.kind === 'endpoint') {
        return (
          <polygon
            points={HEXAGON_POINTS(r + (highlight ? 2 : 0))}
            fill={colors.fill}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            filter={glowFilter}
          />
        );
      }
      return (
        <circle
          r={r + (highlight ? 2 : 0)}
          fill={colors.fill}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          filter={glowFilter}
        />
      );
    })();

    const maxLabelLen = node.kind === 'file' ? 16 : 14;
    const rawLabel = node.label.replace(/\.(ts|tsx|js|jsx|java|py|go|rs)$/, '');
    const label = rawLabel.length > maxLabelLen
      ? `${rawLabel.slice(0, maxLabelLen - 1)}…`
      : rawLabel;
    const labelY = node.kind === 'file' ? 4 : r + 14;
    const fontSize = node.kind === 'file' ? 10 : r > 18 ? 10 : 9;

    return (
      <g
        transform={`translate(${node.x.toFixed(2)},${node.y.toFixed(2)})`}
        style={{ cursor: 'pointer' }}
        onClick={onClick}
        onMouseDown={onMouseDown}
      >
        {shape}
        {/* Label */}
        <text
          y={labelY}
          textAnchor="middle"
          fontSize={fontSize}
          fill={colors.text}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
          fontFamily="ui-monospace, monospace"
        >
          {label}
        </text>
        {/* HTTP method badge for endpoints */}
        {node.httpMethod && (
          <text
            x={node.kind === 'file' ? 54 : r + 2}
            y={-10}
            fontSize={7}
            fontWeight="bold"
            fill={HTTP_METHOD_COLORS[node.httpMethod] ?? '#fb923c'}
            fontFamily="ui-monospace, monospace"
            style={{ pointerEvents: 'none' }}
          >
            {node.httpMethod}
          </text>
        )}
        {/* Endpoint lightning icon indicator */}
        {node.isEndpoint && node.kind !== 'endpoint' && !node.httpMethod && (
          <text
            x={r + 4} y={-r + 4}
            fontSize={9}
            fill="#fb923c"
            style={{ pointerEvents: 'none' }}
          >
            ⚡
          </text>
        )}
      </g>
    );
  },
);

// ─── Force simulation ─────────────────────────────────────────────────────────

const REPULSION = 4800;
const SPRING_STRENGTH = 0.04;
const SPRING_REST_IMPORTS = 200;
const SPRING_REST_CONTAINS = 90;
const CENTER_STRENGTH = 0.0018;
const DAMPING = 0.82;
const ALPHA_DECAY = 0.97;
const ALPHA_MIN = 0.002;

function stepForces(
  nodes: SimNode[],
  edges: SimEdge[],
  alpha: number,
  nodeMap: Map<string, SimNode>,
) {
  // Repulsion (O(n²) — fast for ≤300 nodes)
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (a.fixed && b.fixed) continue;
      const dx = b.x - a.x || 0.01;
      const dy = b.y - a.y || 0.01;
      const d2 = dx * dx + dy * dy;
      const d = Math.sqrt(d2) || 0.01;
      const minDist = nodeCollisionRadius(a.kind) + nodeCollisionRadius(b.kind);
      const force = d < minDist
        ? (REPULSION * 2) / (d2 + 1)
        : REPULSION / (d2 + 1);
      const fx = (dx / d) * force * alpha;
      const fy = (dy / d) * force * alpha;
      if (!a.fixed) { a.vx -= fx; a.vy -= fy; }
      if (!b.fixed) { b.vx += fx; b.vy += fy; }
    }
  }

  // Spring forces along edges
  for (const edge of edges) {
    const src = nodeMap.get(edge.from);
    const tgt = nodeMap.get(edge.to);
    if (!src || !tgt) continue;
    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const rest = edge.kind === 'contains' ? SPRING_REST_CONTAINS : SPRING_REST_IMPORTS;
    const f = (d - rest) * SPRING_STRENGTH * alpha;
    const fx = (dx / d) * f;
    const fy = (dy / d) * f;
    if (!src.fixed) { src.vx += fx; src.vy += fy; }
    if (!tgt.fixed) { tgt.vx -= fx; tgt.vy -= fy; }
  }

  // Gravity toward center + apply velocities
  for (const n of nodes) {
    if (n.fixed) continue;
    n.vx = (n.vx - n.x * CENTER_STRENGTH) * DAMPING;
    n.vy = (n.vy - n.y * CENTER_STRENGTH) * DAMPING;
    n.x += n.vx;
    n.y += n.vy;
  }
}

// ─── Info panel ───────────────────────────────────────────────────────────────

interface InfoPanelProps {
  node: SimNode | null;
  graphMode: GraphMode;
}

const InfoPanel: React.FC<InfoPanelProps> = ({ node, graphMode }) => {
  if (!node) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center">
        <p className="text-xs text-on-surface-variant/60">
          Click a node to inspect it
        </p>
      </div>
    );
  }
  const colors = NODE_COLORS[node.kind] ?? NODE_COLORS.variable;
  const kindLabel =
    node.kind.charAt(0).toUpperCase() + node.kind.slice(1);
  const pathParts = node.filePath.split('/');
  const shortPath = pathParts.slice(-3).join('/');
  return (
    <div className="flex flex-col gap-3 p-4 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 font-medium text-[10px]"
          style={{ background: colors.fill, color: colors.text, border: `1px solid ${colors.stroke}` }}
        >
          {kindLabel}
        </span>
        {node.httpMethod && (
          <span
            className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold"
            style={{ color: HTTP_METHOD_COLORS[node.httpMethod] ?? '#fb923c', background: '#1e293b' }}
          >
            {node.httpMethod}
          </span>
        )}
        {node.isEndpoint && (
          <span className="text-[10px] text-amber-400">⚡ endpoint</span>
        )}
        {node.isExported && (
          <span className="text-[10px] text-slate-400">exported</span>
        )}
        {node.layer && node.layer !== 'other' && (
          <span className="text-[10px] text-slate-500 capitalize">{node.layer}</span>
        )}
      </div>

      <div>
        <p className="font-semibold text-on-surface" style={{ fontFamily: 'ui-monospace, monospace' }}>
          {node.qualifiedName || node.label}
        </p>
      </div>

      <div className="rounded bg-surface-container-low p-2">
        <p className="mb-1 text-[9px] uppercase tracking-wider text-on-surface-variant/60">
          Location
        </p>
        <p
          className="break-all font-mono text-[10px] text-on-surface-variant"
          title={node.filePath}
        >
          {shortPath}
          {node.line ? `:${node.line}` : ''}
        </p>
      </div>

      {node.signature && (
        <div className="rounded bg-surface-container-low p-2">
          <p className="mb-1 text-[9px] uppercase tracking-wider text-on-surface-variant/60">
            Signature
          </p>
          <pre
            className="whitespace-pre-wrap break-all font-mono text-[10px] text-on-surface-variant"
            style={{ maxHeight: 120, overflowY: 'auto' }}
          >
            {node.signature}
          </pre>
        </div>
      )}

      {node.symbolCount !== undefined && (
        <div className="rounded bg-surface-container-low p-2">
          <p className="text-[10px] text-on-surface-variant">
            {node.symbolCount} symbol{node.symbolCount !== 1 ? 's' : ''}
          </p>
        </div>
      )}

      {node.language && (
        <div>
          <span className="rounded bg-surface-container-low px-1.5 py-0.5 font-mono text-[10px] text-on-surface-variant">
            {node.language}
          </span>
        </div>
      )}

      {graphMode === 'flow' && node.layer && (
        <div className="rounded bg-surface-container-low p-2">
          <p className="mb-1 text-[9px] uppercase tracking-wider text-on-surface-variant/60">
            Architectural Layer
          </p>
          <p className="text-[10px] capitalize text-on-surface-variant">{node.layer}</p>
        </div>
      )}
    </div>
  );
};

// ─── Legend ───────────────────────────────────────────────────────────────────

interface LegendEntry {
  kind: CodeGraphNodeKind;
  label: string;
  show: boolean;
  toggle: () => void;
}

const LegendBar: React.FC<{ entries: LegendEntry[] }> = ({ entries }) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
    {entries.map(entry => {
      const c = NODE_COLORS[entry.kind] ?? NODE_COLORS.variable;
      return (
        <button
          key={entry.kind}
          onClick={entry.toggle}
          className={cn(
            'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] transition-opacity',
            entry.show ? 'opacity-100' : 'opacity-30',
          )}
          style={{ background: c.fill, color: c.text, border: `1px solid ${c.stroke}` }}
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: c.stroke }} />
          {entry.label}
        </button>
      );
    })}
  </div>
);

// ─── Flow layer bands ─────────────────────────────────────────────────────────

const FLOW_LAYER_LABELS: Array<{ label: string; y: number; color: string }> = [
  { label: 'Entry Points', y: 0, color: '#fb923c33' },
  { label: 'Controllers',  y: 1, color: '#3b82f633' },
  { label: 'Services',     y: 2, color: '#a78bfa33' },
  { label: 'Data Layer',   y: 3, color: '#22d3ee33' },
  { label: 'Foundational', y: 4, color: '#4ade8033' },
];

// ─── Main page ────────────────────────────────────────────────────────────────

type GraphMode = 'file' | 'symbol' | 'flow';

export default function CodeGraph() {
  const { activeCapability } = useCapability();
  const { error: toastError } = useToast();
  const capabilityId = activeCapability?.id;

  const [graphData, setGraphData] = useState<CapabilityCodeGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [graphMode, setGraphMode] = useState<GraphMode>('file');

  // Simulation state (mutated in RAF loop — not React state)
  const nodesRef = useRef<SimNode[]>([]);
  const nodeMapRef = useRef<Map<string, SimNode>>(new Map());
  const edgesRef = useRef<SimEdge[]>([]);
  const alphaRef = useRef(1.0);
  const rafRef = useRef(0);

  // React state for rendering (updated every RAF frame)
  const [renderTick, setRenderTick] = useState(0);

  // Interaction state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [isDraggingBg, setIsDraggingBg] = useState(false);
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const [infoPanelOpen, setInfoPanelOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Kind visibility filters
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());

  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number; nodeStartX?: number; nodeStartY?: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Load graph data ──────────────────────────────────────────────────────────

  const loadGraph = useCallback(async () => {
    if (!capabilityId) return;
    setLoading(true);
    try {
      const data = await fetchCodeGraph(capabilityId, {
        maxFiles: 120,
        maxSymbols: 280,
      });
      setGraphData(data);
    } catch (err) {
      toastError(
        'Failed to load code graph',
        err instanceof Error ? err.message : 'Unknown error',
      );
    } finally {
      setLoading(false);
    }
  }, [capabilityId, toastError]);

  useEffect(() => {
    if (capabilityId) loadGraph();
  }, [capabilityId, loadGraph]);

  // ── Build simulation nodes/edges when data or mode changes ──────────────────

  useEffect(() => {
    if (!graphData) return;
    cancelAnimationFrame(rafRef.current);

    const rawNodes: SimNode[] = [];

    if (graphMode === 'file' || graphMode === 'flow') {
      for (const fn of graphData.fileNodes) {
        if (hiddenKinds.has('file')) continue;
        const existing = nodeMapRef.current.get(fn.id);
        rawNodes.push({
          id: fn.id,
          x: existing?.x ?? (Math.random() - 0.5) * 600,
          y: existing?.y ?? (Math.random() - 0.5) * 600,
          vx: 0, vy: 0,
          fixed: existing?.fixed ?? false,
          label: fn.label,
          kind: fn.isEndpoint ? 'endpoint' : 'file',
          isEndpoint: fn.isEndpoint,
          isExported: true,
          filePath: fn.filePath,
          signature: undefined,
          symbolCount: fn.symbolCount,
          language: fn.language,
          qualifiedName: fn.filePath,
          radius: nodeCollisionRadius('file'),
          layer: fn.layer,
        });
      }
    } else {
      for (const sn of graphData.symbolNodes) {
        if (hiddenKinds.has(sn.kind)) continue;
        const existing = nodeMapRef.current.get(sn.id);
        rawNodes.push({
          id: sn.id,
          x: existing?.x ?? (Math.random() - 0.5) * 600,
          y: existing?.y ?? (Math.random() - 0.5) * 600,
          vx: 0, vy: 0,
          fixed: existing?.fixed ?? false,
          label: sn.label,
          kind: sn.kind,
          isEndpoint: sn.isEndpoint,
          isExported: sn.isExported,
          filePath: sn.filePath,
          line: sn.startLine,
          signature: sn.signature,
          language: sn.language,
          qualifiedName: sn.qualifiedName,
          radius: nodeCollisionRadius(sn.kind),
          httpMethod: sn.httpMethod,
        });
      }
    }

    const newNodeMap = new Map(rawNodes.map(n => [n.id, n]));
    const edgeSource = graphMode === 'symbol' ? graphData.symbolEdges : graphData.fileEdges;
    const rawEdges: SimEdge[] = edgeSource
      .filter(e => newNodeMap.has(e.from) && newNodeMap.has(e.to))
      .map(e => ({
        ...e,
        srcNode: newNodeMap.get(e.from),
        tgtNode: newNodeMap.get(e.to),
      }));

    nodesRef.current = rawNodes;
    nodeMapRef.current = newNodeMap;
    edgesRef.current = rawEdges;

    // Reset pan/zoom to center
    setPanX(0);
    setPanY(0);
    setZoom(0.9);
    setSelectedId(null);

    if (graphMode === 'flow') {
      // Compute fixed topological layout — no simulation needed
      computeFlowPositions(rawNodes, rawEdges);
      // Mark all nodes fixed so they don't move
      for (const n of rawNodes) n.fixed = true;
      alphaRef.current = 0;
      setRenderTick(t => t + 1);
      return;
    }

    alphaRef.current = 1.0;

    // Start simulation loop
    const animate = () => {
      const alpha = alphaRef.current;
      if (alpha > ALPHA_MIN) {
        stepForces(nodesRef.current, edgesRef.current, alpha, nodeMapRef.current);
        stepForces(nodesRef.current, edgesRef.current, alpha * ALPHA_DECAY, nodeMapRef.current);
        alphaRef.current = alpha * ALPHA_DECAY * ALPHA_DECAY;
        setRenderTick(t => t + 1);
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setRenderTick(t => t + 1); // final render
      }
    };
    rafRef.current = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData, graphMode, hiddenKinds.size]);

  // ── SVG coordinate helpers ───────────────────────────────────────────────────

  const getSvgRect = () => svgRef.current?.getBoundingClientRect();

  // ── Mouse interactions ────────────────────────────────────────────────────────

  const handleSvgWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = getSvgRect();
    if (!rect) return;
    const svgX = e.clientX - rect.left;
    const svgY = e.clientY - rect.top;
    const factor = e.deltaY > 0 ? 0.88 : 1.14;
    const newZoom = Math.max(0.08, Math.min(8, zoom * factor));
    const gx = (svgX - panX) / zoom;
    const gy = (svgY - panY) / zoom;
    setPanX(svgX - gx * newZoom);
    setPanY(svgY - gy * newZoom);
    setZoom(newZoom);
  };

  const handleSvgMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDraggingBg(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX, panY };
  };

  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const node = nodeMapRef.current.get(nodeId);
    if (!node) return;
    setDragNodeId(nodeId);
    dragStart.current = {
      x: e.clientX, y: e.clientY,
      panX, panY,
      nodeStartX: node.x,
      nodeStartY: node.y,
    };
    node.fixed = true;
    cancelAnimationFrame(rafRef.current);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;

    if (dragNodeId) {
      const node = nodeMapRef.current.get(dragNodeId);
      if (node) {
        node.x = (dragStart.current.nodeStartX ?? node.x) + dx / zoom;
        node.y = (dragStart.current.nodeStartY ?? node.y) + dy / zoom;
        node.vx = 0;
        node.vy = 0;
        setRenderTick(t => t + 1);
      }
    } else if (isDraggingBg) {
      setPanX(dragStart.current.panX + dx);
      setPanY(dragStart.current.panY + dy);
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (dragNodeId) {
      const node = nodeMapRef.current.get(dragNodeId);
      if (node && graphMode !== 'flow') node.fixed = false;
      setDragNodeId(null);
      if (graphMode !== 'flow') {
        alphaRef.current = Math.max(alphaRef.current, 0.3);
        const animate = () => {
          if (alphaRef.current > ALPHA_MIN) {
            stepForces(nodesRef.current, edgesRef.current, alphaRef.current, nodeMapRef.current);
            alphaRef.current *= ALPHA_DECAY;
            setRenderTick(t => t + 1);
            rafRef.current = requestAnimationFrame(animate);
          }
        };
        rafRef.current = requestAnimationFrame(animate);
      }
    }
    setIsDraggingBg(false);
    dragStart.current = null;
  };

  const handleNodeClick = (nodeId: string) => {
    setSelectedId(prev => (prev === nodeId ? null : nodeId));
    setInfoPanelOpen(true);
  };

  // ── Derived state ─────────────────────────────────────────────────────────────

  const nodes = nodesRef.current;
  const edges = edgesRef.current;
  const selectedNode = selectedId ? (nodeMapRef.current.get(selectedId) ?? null) : null;

  const allKinds: CodeGraphNodeKind[] = (graphMode === 'file' || graphMode === 'flow')
    ? ['file', 'endpoint']
    : ['class', 'interface', 'function', 'method', 'enum', 'type', 'endpoint', 'variable', 'property'];

  const legendEntries: LegendEntry[] = allKinds.map(kind => ({
    kind,
    label: kind,
    show: !hiddenKinds.has(kind),
    toggle: () =>
      setHiddenKinds(prev => {
        const next = new Set(prev);
        if (next.has(kind)) next.delete(kind);
        else next.add(kind);
        return next;
      }),
  }));

  const stats = graphData
    ? [
        { label: 'Files', value: graphData.fileNodes.length },
        { label: 'Symbols', value: graphData.symbolNodes.length },
        { label: 'Import edges', value: graphData.fileEdges.length },
        { label: 'Contain edges', value: graphData.symbolEdges.length },
      ]
    : [];

  const simActive = alphaRef.current > ALPHA_MIN && graphMode !== 'flow';
  const hasNoFileEdges = graphData !== null && graphData.fileEdges.length === 0 && graphMode === 'file';

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex flex-col',
        isFullscreen
          ? 'fixed inset-0 z-50 bg-[#0a0f1e]'
          : 'min-h-[calc(100vh-4rem)]',
      )}
    >
      {/* Page header */}
      <PageHeader
        eyebrow="Code Intelligence"
        title="Code Graph"
        description="Interactive map of your codebase — files, symbols, imports, and data flow."
        actions={
          <div className="flex items-center gap-2">
            {/* Mode toggle */}
            <div className="flex rounded-lg border border-outline-variant/40 bg-surface-container-low overflow-hidden text-xs">
              <button
                onClick={() => setGraphMode('file')}
                className={cn(
                  'px-3 py-1.5 transition-colors',
                  graphMode === 'file'
                    ? 'bg-primary text-on-primary'
                    : 'text-on-surface-variant hover:bg-surface-container',
                )}
              >
                <span className="flex items-center gap-1"><FileCode size={12} /> Files</span>
              </button>
              <button
                onClick={() => setGraphMode('symbol')}
                className={cn(
                  'px-3 py-1.5 transition-colors',
                  graphMode === 'symbol'
                    ? 'bg-primary text-on-primary'
                    : 'text-on-surface-variant hover:bg-surface-container',
                )}
              >
                <span className="flex items-center gap-1"><Code2 size={12} /> Symbols</span>
              </button>
              <button
                onClick={() => setGraphMode('flow')}
                className={cn(
                  'px-3 py-1.5 transition-colors',
                  graphMode === 'flow'
                    ? 'bg-primary text-on-primary'
                    : 'text-on-surface-variant hover:bg-surface-container',
                )}
              >
                <span className="flex items-center gap-1"><GitBranch size={12} /> Flow</span>
              </button>
            </div>

            <button
              onClick={loadGraph}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg border border-outline-variant/40 bg-surface-container-low px-3 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container transition-colors disabled:opacity-50"
            >
              {loading
                ? <Loader2 size={13} className="animate-spin" />
                : <RefreshCw size={13} />}
              Refresh
            </button>

            <button
              onClick={() => setIsFullscreen(f => !f)}
              className="flex items-center gap-1 rounded-lg border border-outline-variant/40 bg-surface-container-low px-2.5 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container transition-colors"
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          </div>
        }
      />

      {/* Stats row */}
      {graphData && (
        <div className="grid grid-cols-4 gap-3 px-6 pb-3">
          {stats.map(s => (
            <StatTile key={s.label} label={s.label} value={String(s.value)} />
          ))}
        </div>
      )}

      {/* No-edges diagnostic banner */}
      {hasNoFileEdges && (
        <div className="mx-6 mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-400">
          No import data in index — run a code index refresh or switch to Symbol / Flow view.
        </div>
      )}

      {/* Legend */}
      {graphData && (
        <div className="border-b border-outline-variant/20 bg-surface-container/30">
          <LegendBar entries={legendEntries} />
        </div>
      )}

      {/* Main graph area */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Graph canvas */}
        <div
          className="flex-1 overflow-hidden"
          style={{ background: '#0f172a' }}
        >
          {loading && !graphData && (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-slate-400">
                <Loader2 size={32} className="animate-spin" />
                <p className="text-sm">Building code graph…</p>
              </div>
            </div>
          )}

          {!loading && !graphData && (
            <EmptyState
              title="No capability selected"
              description="Select a capability from the header to visualize its code graph."
              icon={Search}
            />
          )}

          {graphData && nodes.length === 0 && (
            <EmptyState
              title="No indexed symbols"
              description="Run a code index refresh to populate the graph."
              icon={Code2}
            />
          )}

          {graphData && nodes.length > 0 && (
            <svg
              ref={svgRef}
              className="h-full w-full"
              style={{ cursor: isDraggingBg ? 'grabbing' : dragNodeId ? 'grabbing' : 'grab' }}
              onWheel={handleSvgWheel}
              onMouseDown={handleSvgMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <defs>
                {/* Grid pattern */}
                <pattern id="cg-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" strokeWidth="0.5" />
                </pattern>
                {/* Node glow filter */}
                <filter id="node-glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
                {/* Arrowhead markers */}
                <marker
                  id="arrow-imports"
                  markerWidth="6" markerHeight="6"
                  refX="5" refY="3"
                  orient="auto" markerUnits="strokeWidth"
                >
                  <path d="M 0 1 L 5 3 L 0 5 Z" fill="#38bdf8" opacity="0.9" />
                </marker>
                <marker
                  id="arrow-contains"
                  markerWidth="6" markerHeight="6"
                  refX="5" refY="3"
                  orient="auto" markerUnits="strokeWidth"
                >
                  <path d="M 0 1 L 5 3 L 0 5 Z" fill="#818cf8" opacity="0.9" />
                </marker>
              </defs>

              {/* Background grid (fixed — not inside transform group) */}
              <rect width="100%" height="100%" fill="url(#cg-grid)" />

              {/* Viewport group — pan + zoom applied here */}
              <g
                transform={`translate(${panX + (svgRef.current?.clientWidth ?? 800) / 2},${panY + (svgRef.current?.clientHeight ?? 600) / 2}) scale(${zoom})`}
              >
                {/* Flow mode: layer band backgrounds */}
                {graphMode === 'flow' && (() => {
                  const canvasW = (svgRef.current?.clientWidth ?? 800) / zoom + 400;
                  return FLOW_LAYER_LABELS.map(layer => {
                    const yCenter = layer.y * FLOW_Y_SPACING - (4 * FLOW_Y_SPACING) / 2;
                    return (
                      <g key={layer.label}>
                        <rect
                          x={-canvasW / 2}
                          y={yCenter - FLOW_Y_SPACING / 2}
                          width={canvasW}
                          height={FLOW_Y_SPACING}
                          fill={layer.color}
                          rx={4}
                        />
                        <text
                          x={-canvasW / 2 + 12}
                          y={yCenter - FLOW_Y_SPACING / 2 + 16}
                          fontSize={10}
                          fill="#94a3b8"
                          fontFamily="ui-monospace, monospace"
                          style={{ pointerEvents: 'none', userSelect: 'none' }}
                        >
                          {layer.label}
                        </text>
                      </g>
                    );
                  });
                })()}

                {/* Edges */}
                {edges.map(edge => {
                  const src = nodeMapRef.current.get(edge.from);
                  const tgt = nodeMapRef.current.get(edge.to);
                  if (!src || !tgt) return null;
                  const color = EDGE_COLORS[edge.kind] ?? '#475569';

                  if (graphMode === 'flow') {
                    const sx = src.x, sy = src.y;
                    const tx = tgt.x, ty = tgt.y;
                    const mx = (sx + tx) / 2;
                    const my = (sy + ty) / 2 + 40;
                    return (
                      <path
                        key={edge.id}
                        d={`M ${sx.toFixed(2)} ${sy.toFixed(2)} Q ${mx.toFixed(2)} ${my.toFixed(2)} ${tx.toFixed(2)} ${ty.toFixed(2)}`}
                        fill="none"
                        stroke={color}
                        strokeWidth={Math.max(1.5, 2 / zoom)}
                        strokeOpacity={0.8}
                        markerEnd={`url(#arrow-${edge.kind})`}
                      />
                    );
                  }

                  const isDashed = edge.kind === 'imports';
                  return (
                    <line
                      key={edge.id}
                      x1={src.x.toFixed(2)}
                      y1={src.y.toFixed(2)}
                      x2={tgt.x.toFixed(2)}
                      y2={tgt.y.toFixed(2)}
                      stroke={color}
                      strokeWidth={Math.max(1.5, 2 / zoom)}
                      strokeOpacity={0.8}
                      strokeDasharray={isDashed ? `${4 / zoom},${3 / zoom}` : undefined}
                      markerEnd={`url(#arrow-${edge.kind})`}
                    />
                  );
                })}

                {/* Nodes */}
                {nodes.map(node => (
                  <NodeShape
                    key={node.id}
                    node={node}
                    selected={node.id === selectedId}
                    hovered={node.id === hoveredId}
                    onClick={() => handleNodeClick(node.id)}
                    onMouseDown={e => handleNodeMouseDown(e, node.id)}
                  />
                ))}
              </g>

              {/* Zoom controls (top-right of canvas) */}
              <g transform={`translate(${(svgRef.current?.clientWidth ?? 800) - 44}, 12)`}>
                {[
                  {
                    label: '+',
                    title: 'Zoom in',
                    onClick: () => {
                      const w = svgRef.current?.clientWidth ?? 800;
                      const h = svgRef.current?.clientHeight ?? 600;
                      const nz = Math.min(8, zoom * 1.3);
                      const cx = w / 2, cy = h / 2;
                      const gx = (cx - panX) / zoom;
                      const gy = (cy - panY) / zoom;
                      setPanX(cx - gx * nz);
                      setPanY(cy - gy * nz);
                      setZoom(nz);
                    },
                  },
                  {
                    label: '−',
                    title: 'Zoom out',
                    onClick: () => {
                      const w = svgRef.current?.clientWidth ?? 800;
                      const h = svgRef.current?.clientHeight ?? 600;
                      const nz = Math.max(0.08, zoom * 0.77);
                      const cx = w / 2, cy = h / 2;
                      const gx = (cx - panX) / zoom;
                      const gy = (cy - panY) / zoom;
                      setPanX(cx - gx * nz);
                      setPanY(cy - gy * nz);
                      setZoom(nz);
                    },
                  },
                  {
                    label: '⌂',
                    title: 'Reset view',
                    onClick: () => { setZoom(0.9); setPanX(0); setPanY(0); },
                  },
                ].map((btn, i) => (
                  <g key={btn.label}>
                    <rect
                      width={32} height={32}
                      rx={6}
                      fill="#1e293b"
                      stroke="#334155"
                      strokeWidth={1}
                      y={i * 38}
                      style={{ cursor: 'pointer' }}
                      onClick={e => { e.stopPropagation(); btn.onClick(); }}
                    />
                    <text
                      x={16} y={i * 38 + 21}
                      textAnchor="middle"
                      fontSize={14}
                      fill="#94a3b8"
                      style={{ cursor: 'pointer', userSelect: 'none' }}
                      onClick={e => { e.stopPropagation(); btn.onClick(); }}
                    >
                      {btn.label}
                    </text>
                  </g>
                ))}
              </g>

              {/* Simulation status indicator */}
              {simActive && (
                <g transform="translate(12,12)">
                  <rect width={88} height={22} rx={4} fill="#1e293b" stroke="#334155" strokeWidth={1} />
                  <circle cx={12} cy={11} r={4} fill="#4ade80">
                    <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" />
                  </circle>
                  <text x={22} y={15} fontSize={10} fill="#94a3b8" fontFamily="ui-monospace, monospace">
                    Settling…
                  </text>
                </g>
              )}

              {/* Node count badge */}
              {!simActive && (
                <g transform="translate(12,12)">
                  <rect width={130} height={22} rx={4} fill="#1e293b" stroke="#334155" strokeWidth={1} />
                  <text x={8} y={15} fontSize={10} fill="#94a3b8" fontFamily="ui-monospace, monospace">
                    {nodes.length} nodes · {edges.length} edges
                    {graphMode === 'flow' ? ' · flow' : ''}
                  </text>
                </g>
              )}
            </svg>
          )}
        </div>

        {/* Info panel */}
        <div
          className={cn(
            'flex flex-col border-l border-outline-variant/20 bg-surface-container transition-all duration-200',
            infoPanelOpen ? 'w-64' : 'w-0 overflow-hidden',
          )}
        >
          <div className="flex items-center justify-between border-b border-outline-variant/20 px-3 py-2">
            <span className="text-xs font-medium text-on-surface-variant">Node Detail</span>
            <button
              onClick={() => setInfoPanelOpen(o => !o)}
              className="text-on-surface-variant/60 hover:text-on-surface-variant transition-colors"
            >
              <Minimize2 size={12} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <InfoPanel node={selectedNode} graphMode={graphMode} />
          </div>
        </div>

        {/* Info panel toggle button (when panel is closed) */}
        {!infoPanelOpen && selectedNode && (
          <button
            onClick={() => setInfoPanelOpen(true)}
            className="absolute right-2 top-2 rounded-lg border border-outline-variant/40 bg-surface-container px-2 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container-high transition-colors"
          >
            <Code2 size={12} />
          </button>
        )}
      </div>

      {/* Edge legend at bottom */}
      {graphData && (
        <div className="flex items-center gap-4 border-t border-outline-variant/20 bg-surface-container/30 px-4 py-1.5 text-[10px] text-on-surface-variant/60">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-px w-6 border-t-2 border-dashed" style={{ borderColor: EDGE_COLORS.imports }} />
            imports
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-px w-6 border-t-2" style={{ borderColor: EDGE_COLORS.contains }} />
            contains
          </span>
          {graphMode === 'flow' && (
            <span className="text-[10px] text-slate-500">
              Top = entry points · Bottom = foundational layers
            </span>
          )}
          <span className="ml-auto">
            Scroll to zoom · Drag to pan · Click for details
          </span>
        </div>
      )}
    </div>
  );
}
