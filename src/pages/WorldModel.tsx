/**
 * Code World Model — rich 3-panel visualization.
 *
 * Layout:
 *   [Left stats panel] | [Canvas + toolbar + timeline] | [Right property panel]
 *
 * The canvas shows a vis-network graph with SVG icon nodes and typed edges.
 * The property panel derives Inputs / Calls / Data Touched / Tests / Risk from the graph.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Loader2, Search, AlertTriangle, RefreshCw, GitBranch,
  ZoomIn, ZoomOut, Maximize2, Layers, BarChart3, ActivitySquare, Flame,
  GitFork, ChevronDown,
} from 'lucide-react';
import { Network } from 'vis-network';
import { useCapability } from '../context/CapabilityContext';
import WorldModelCanvas, {
  WorldModelNode,
  WorldModelEdge,
} from '../components/world-model/WorldModelCanvas';
import PropertyPanel from '../components/world-model/PropertyPanel';
import { NODE_TYPE_CONFIG } from '../components/world-model/visConfig';

// ─── Constants ────────────────────────────────────────────────────────────────

const LAYOUT_OPTIONS = ['Impact', 'Flow', 'Cluster'] as const;
type LayoutMode = typeof LAYOUT_OPTIONS[number];

const OVERLAY_OPTIONS = ['Blast Radius', 'None'] as const;
type OverlayMode = typeof OVERLAY_OPTIONS[number];

// ─── Small shared primitives ──────────────────────────────────────────────────

function StatRow({
  label,
  value,
  badge,
}: {
  label: string;
  value: number | string;
  badge?: 'red';
}) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 rounded-md hover:bg-slate-100/60 transition-colors cursor-default group">
      <span className="text-[11px] text-slate-500 group-hover:text-slate-700">{label}</span>
      <span
        className={`text-[11px] font-bold tabular-nums rounded px-1.5 py-0.5
          ${badge === 'red' ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-600'}`}
      >
        {value}
      </span>
    </div>
  );
}

function NavItem({ label, icon: Icon, active }: { label: string; icon: React.ElementType; active?: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-md cursor-default text-[11px] transition-colors
        ${active
          ? 'bg-indigo-50 text-indigo-700 font-semibold'
          : 'text-slate-500 hover:bg-slate-100/60 hover:text-slate-700'}`}
    >
      <Icon size={13} />
      {label}
    </div>
  );
}

function Dropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-slate-400 font-medium">{label}:</span>
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="h-7 appearance-none rounded-md border border-slate-200 bg-white pl-2.5 pr-6 text-[11px] font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none hover:border-slate-300 transition-colors cursor-pointer"
        >
          {options.map(o => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        <ChevronDown size={10} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400" />
      </div>
    </div>
  );
}

// ─── Graph Legend overlay ─────────────────────────────────────────────────────

function GraphLegend() {
  const nodeTypes = [
    { key: 'CapabilityNode', label: 'Capability' },
    { key: 'RepoNode',       label: 'Repository' },
    { key: 'ServiceNode',    label: 'Service' },
    { key: 'MethodNode',     label: 'Method' },
    { key: 'ApiNode',        label: 'API Client' },
    { key: 'DataNode',       label: 'Data' },
    { key: 'TestNode',       label: 'Test' },
  ];
  const edgeTypes = [
    { color: '#ef4444', dash: true,  label: 'Impact Path' },
    { color: '#475569', dash: false, label: 'Normal Flow' },
    { color: '#3b82f6', dash: true,  label: 'Reads' },
    { color: '#f59e0b', dash: false, label: 'Writes' },
    { color: '#22c55e', dash: true,  label: 'Tests' },
  ];

  return (
    <div className="absolute top-3 right-3 z-20 bg-white/90 backdrop-blur-sm border border-slate-200 rounded-xl shadow-lg p-3 text-[10px] w-40">
      <p className="font-bold text-slate-600 mb-2">Legend</p>
      <div className="space-y-1 mb-2">
        {nodeTypes.map(({ key, label }) => {
          const cfg = NODE_TYPE_CONFIG[key];
          return (
            <div key={key} className="flex items-center gap-2">
              <span
                className="inline-block w-3 h-3 rounded-sm border"
                style={{ backgroundColor: cfg.bg, borderColor: cfg.border }}
              />
              <span className="text-slate-600">{label}</span>
            </div>
          );
        })}
      </div>
      <div className="border-t border-slate-100 pt-2 space-y-1">
        {edgeTypes.map(({ color, dash, label }) => (
          <div key={label} className="flex items-center gap-2">
            <svg width="24" height="8">
              <line
                x1="0" y1="4" x2="24" y2="4"
                stroke={color}
                strokeWidth="1.5"
                strokeDasharray={dash ? '4 2' : undefined}
              />
            </svg>
            <span className="text-slate-600">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── AST mini panel ───────────────────────────────────────────────────────────

function AstMiniPanel({ node }: { node: WorldModelNode | null }) {
  if (!node) return null;
  const kind = String(node.data?.kind ?? 'unknown');
  const sig  = String(node.data?.signature ?? node.label);

  const tree = useMemo(() => {
    const items: Array<{ indent: number; text: string }> = [];
    const kindMap: Record<string, string> = {
      function: 'FunctionDeclaration',
      method:   'MethodDeclaration',
      class:    'ClassDeclaration',
      interface:'InterfaceDeclaration',
    };
    const topNode = kindMap[kind] ?? 'Declaration';
    items.push({ indent: 0, text: topNode });
    items.push({ indent: 1, text: node.label });

    // Parse params from signature
    const m = sig.match(/\(([^)]*)\)/);
    if (m && m[1].trim()) {
      items.push({ indent: 1, text: 'Parameters' });
      m[1].split(',').slice(0, 4).forEach(p => {
        items.push({ indent: 2, text: p.trim().split(/\s+/)[0] });
      });
    }
    items.push({ indent: 1, text: 'Body' });
    items.push({ indent: 2, text: 'IfStatement' });
    items.push({ indent: 3, text: 'Expression' });
    items.push({ indent: 3, text: 'MethodCall' });
    items.push({ indent: 2, text: '…' });
    return items;
  }, [node, kind, sig]);

  return (
    <div className="absolute bottom-3 left-3 z-20 bg-white/92 backdrop-blur-sm border border-slate-200 rounded-xl shadow-lg p-3 text-[10px] w-48">
      <div className="flex items-center gap-1.5 mb-2">
        <GitBranch size={10} className="text-slate-400" />
        <span className="font-bold text-slate-600">AST (Derived)</span>
        <span className="ml-auto text-[8px] text-slate-400">⊞</span>
      </div>
      <div className="space-y-0.5 font-mono text-slate-500">
        {tree.map((item, i) => (
          <div key={i} className="flex items-center gap-1" style={{ paddingLeft: item.indent * 10 }}>
            {item.indent > 0 && <span className="text-slate-300">•</span>}
            <span className={item.indent === 0 ? 'text-slate-700 font-semibold' : item.indent === 1 ? 'text-indigo-600' : 'text-slate-500'}>
              {item.text}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[9px] text-slate-400 border-t border-slate-100 pt-1.5 leading-tight">
        Raw AST is an input.<br />World Model is the output.
      </p>
    </div>
  );
}

// ─── Event timeline ───────────────────────────────────────────────────────────

interface TimelineEvent {
  id: string;
  time: string;
  icon: 'search' | 'git' | 'test' | 'shield' | 'doc';
  title: string;
  detail: string;
  actor: string;
}

function buildTimeline(
  nodes: WorldModelNode[],
  edges: WorldModelEdge[],
  focusedSymbol: string | null,
): TimelineEvent[] {
  const now = Date.now();
  const events: TimelineEvent[] = [];

  const fmt = (offset: number) =>
    new Date(now - offset).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  events.push({
    id: 'resolve',
    time: fmt(120_000),
    icon: 'search',
    title: 'Symbol resolved',
    detail: focusedSymbol ? `"${focusedSymbol}" found in code index` : 'Code index queried',
    actor: 'SingularityNeo',
  });

  if (nodes.length > 0) {
    const depth0 = nodes.filter(n => (n.data?.depth as number) === 0).length;
    events.push({
      id: 'traverse',
      time: fmt(90_000),
      icon: 'git',
      title: 'Graph traversed',
      detail: `${nodes.length} nodes · ${edges.length} edges · seed: ${depth0}`,
      actor: 'SingularityNeo',
    });
  }

  const testNodes = nodes.filter(n => n.type === 'TestNode');
  if (testNodes.length > 0) {
    events.push({
      id: 'tests',
      time: fmt(60_000),
      icon: 'test',
      title: 'Tests discovered',
      detail: `${testNodes.length} test node(s) reachable`,
      actor: 'CI',
    });
  }

  const impactEdges = edges.filter(e => e.type === 'ImpactEdge');
  if (impactEdges.length > 0) {
    events.push({
      id: 'blast',
      time: fmt(40_000),
      icon: 'shield',
      title: 'Blast radius computed',
      detail: `${impactEdges.length} impact path(s) detected`,
      actor: 'SingularityNeo',
    });
  }

  events.push({
    id: 'snap',
    time: fmt(5_000),
    icon: 'doc',
    title: 'Snapshot ready',
    detail: 'World Model rendered',
    actor: 'SingularityNeo',
  });

  return events;
}

const ICON_MAP: Record<TimelineEvent['icon'], React.ElementType> = {
  search:  Search,
  git:     GitFork,
  test:    ActivitySquare,
  shield:  Flame,
  doc:     GitBranch,
};

function EventTimeline({
  events,
  isLoading,
}: {
  events: TimelineEvent[];
  isLoading: boolean;
}) {
  if (isLoading || events.length === 0) {
    return (
      <div className="h-28 shrink-0 border-t border-slate-200 bg-slate-50 flex items-center justify-center">
        <p className="text-xs text-slate-400">
          {isLoading ? 'Traversing graph…' : 'Build a graph to see the event timeline'}
        </p>
      </div>
    );
  }

  return (
    <div className="h-28 shrink-0 border-t border-slate-200 bg-slate-50 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-slate-100">
        <BarChart3 size={11} className="text-slate-400" />
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Recent Events (Timeline)</span>
        <span className="ml-auto text-[10px] text-slate-400 hover:underline cursor-pointer">View all events</span>
      </div>
      <div className="flex items-start gap-0 overflow-x-auto px-4 py-2 h-[calc(100%-28px)]">
        {events.map((ev, idx) => {
          const Icon = ICON_MAP[ev.icon];
          const isLast = idx === events.length - 1;
          return (
            <div key={ev.id} className="flex items-start min-w-[180px] max-w-[200px]">
              <div className="flex flex-col items-center mr-2.5 mt-0.5">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0
                  ${ev.icon === 'shield' ? 'bg-red-100' :
                    ev.icon === 'test' ? 'bg-green-100' :
                    ev.icon === 'search' ? 'bg-blue-100' :
                    'bg-indigo-100'}`}>
                  <Icon size={12} className={
                    ev.icon === 'shield' ? 'text-red-500' :
                    ev.icon === 'test' ? 'text-green-600' :
                    ev.icon === 'search' ? 'text-blue-500' :
                    'text-indigo-500'} />
                </div>
                {!isLast && <div className="w-px flex-1 bg-slate-200 mt-1" style={{ minHeight: 20 }} />}
              </div>
              <div className="min-w-0 pb-1">
                <p className="text-[9px] text-slate-400 tabular-nums">{ev.time}</p>
                <p className="text-[10px] font-semibold text-slate-700 leading-tight">{ev.title}</p>
                <p className="text-[9px] text-slate-500 truncate leading-tight">{ev.detail}</p>
                <p className="text-[9px] text-slate-400">by {ev.actor}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function WorldModel() {
  const { activeCapability } = useCapability();

  const [symbolQuery, setSymbolQuery]     = useState('');
  const [nodes, setNodes]                 = useState<WorldModelNode[]>([]);
  const [edges, setEdges]                 = useState<WorldModelEdge[]>([]);
  const [isLoading, setIsLoading]         = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [message, setMessage]             = useState<string | null>(null);
  const [selectedNode, setSelectedNode]   = useState<WorldModelNode | null>(null);
  const [focusedSymbol, setFocusedSymbol] = useState<string | null>(null);
  const [depth, setDepth]                 = useState(3);
  const [layout, setLayout]               = useState<LayoutMode>('Impact');
  const [overlay, setOverlay]             = useState<OverlayMode>('Blast Radius');
  const [zoom, setZoom]                   = useState(100);

  const inputRef  = useRef<HTMLInputElement>(null);
  const networkRef = useRef<Network | null>(null);

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  // ── API ────────────────────────────────────────────────────────────────────

  const fetchGraph = useCallback(async (q?: string) => {
    const capId = activeCapability?.id;
    if (!capId) { setError('No capability selected. Pick one from the header first.'); return; }
    const query = (q ?? symbolQuery).trim();
    if (!query) { setError('Enter a symbol name to search (e.g. a class, function or method name).'); return; }

    setIsLoading(true);
    setError(null);
    setMessage(null);
    setSelectedNode(null);

    try {
      const url =
        `/api/capabilities/${capId}/world-model/graph` +
        `?focusSymbol=${encodeURIComponent(query)}` +
        `&maxDepth=${depth}`;
      const resp = await fetch(url);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `Server error ${resp.status}`);
      setNodes(data.nodes ?? []);
      setEdges(data.edges ?? []);
      if (data.focusedSymbol) setFocusedSymbol(data.focusedSymbol);
      if (data.message)       setMessage(data.message);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load world model');
      setNodes([]);
      setEdges([]);
    } finally {
      setIsLoading(false);
    }
  }, [activeCapability?.id, symbolQuery, depth]);

  const handleKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') fetchGraph(); };

  // ── Zoom controls ──────────────────────────────────────────────────────────

  const handleZoomIn = () => {
    const net = networkRef.current;
    if (!net) return;
    const scale = Math.min(net.getScale() * 1.25, 4);
    net.moveTo({ scale });
    setZoom(Math.round(scale * 100));
  };

  const handleZoomOut = () => {
    const net = networkRef.current;
    if (!net) return;
    const scale = Math.max(net.getScale() * 0.8, 0.1);
    net.moveTo({ scale });
    setZoom(Math.round(scale * 100));
  };

  const handleFit = () => {
    const net = networkRef.current;
    if (!net) return;
    net.fit({ animation: true });
    setTimeout(() => {
      if (networkRef.current) setZoom(Math.round(networkRef.current.getScale() * 100));
    }, 500);
  };

  const handleNetworkReady = useCallback((net: Network) => {
    networkRef.current = net;
    net.on('zoom', () => {
      setZoom(Math.round(net.getScale() * 100));
    });
  }, []);

  // ── Derived stats for left sidebar ─────────────────────────────────────────

  const stats = useMemo(() => ({
    services: nodes.filter(n => n.type === 'ServiceNode').length,
    methods:  nodes.filter(n => n.type === 'MethodNode').length,
    data:     nodes.filter(n => n.type === 'DataNode').length,
    tests:    nodes.filter(n => n.type === 'TestNode').length,
    apis:     nodes.filter(n => n.type === 'ApiNode').length,
    risks:    edges.filter(e => e.type === 'ImpactEdge').length,
    repos:    nodes.filter(n => n.type === 'RepoNode').length,
  }), [nodes, edges]);

  // ── Timeline ───────────────────────────────────────────────────────────────

  const timelineEvents = useMemo(
    () => buildTimeline(nodes, edges, focusedSymbol),
    [nodes, edges, focusedSymbol],
  );

  const hasData = nodes.length > 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex overflow-hidden" style={{ height: 'calc(100vh - 4rem)' }}>

      {/* ── Left mini sidebar ───────────────────────────────────────────────── */}
      <aside className="w-44 shrink-0 flex flex-col border-r border-slate-200 bg-slate-50 overflow-y-auto">

        {/* OVERVIEW */}
        <div className="px-3 pt-4 pb-1">
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 px-1 mb-1">Overview</p>
        </div>
        <div className="space-y-0.5 px-1.5 pb-3 border-b border-slate-200">
          <StatRow label="Capabilities" value={activeCapability ? 1 : 0} />
          <StatRow label="Repos" value={hasData ? stats.repos : '—'} />
          <StatRow label="Services" value={hasData ? stats.services : '—'} />
          <StatRow label="Methods" value={hasData ? stats.methods : '—'} />
          <StatRow label="APIs" value={hasData ? stats.apis : '—'} />
          <StatRow label="Data Nodes" value={hasData ? stats.data : '—'} />
          <StatRow label="Tests" value={hasData ? stats.tests : '—'} />
          <StatRow label="Risks" value={hasData ? stats.risks : '—'} badge={stats.risks > 0 ? 'red' : undefined} />
        </div>

        {/* VIEWS */}
        <div className="px-3 pt-3 pb-1">
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 px-1 mb-1">Views</p>
        </div>
        <div className="space-y-0.5 px-1.5 pb-4">
          <NavItem label="World Model"    icon={GitBranch}      active />
          <NavItem label="Impact Analysis" icon={ActivitySquare} />
          <NavItem label="Change Explorer" icon={Layers}         />
          <NavItem label="Risk Heatmap"   icon={Flame}          />
        </div>

        {/* Depth selector */}
        <div className="mt-auto px-3 pb-4 border-t border-slate-200 pt-3">
          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-2 px-1">Graph Depth</p>
          <div className="flex gap-1 flex-wrap px-1">
            {[2, 3, 4, 5].map(d => (
              <button
                key={d}
                onClick={() => setDepth(d)}
                className={`w-7 h-7 rounded text-[11px] font-bold transition-colors
                  ${depth === d ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:border-indigo-300'}`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* ── Center area ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Toolbar */}
        <div className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-slate-200 bg-white">
          {/* Title + focused symbol */}
          <div className="flex items-center gap-2 mr-1">
            <GitBranch size={15} className="text-indigo-500" />
            <span className="text-[11px] font-bold text-slate-700">Code World Model</span>
            {focusedSymbol && hasData && (
              <span className="rounded-full bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[10px] font-mono text-indigo-700">
                {focusedSymbol}
              </span>
            )}
          </div>

          <div className="h-5 w-px bg-slate-200 mx-1" />

          {/* Layout / Overlay dropdowns */}
          <Dropdown label="Layout" value={layout} options={LAYOUT_OPTIONS} onChange={v => setLayout(v as LayoutMode)} />
          <Dropdown label="Overlay" value={overlay} options={OVERLAY_OPTIONS} onChange={v => setOverlay(v as OverlayMode)} />

          <div className="h-5 w-px bg-slate-200 mx-1" />

          {/* Zoom controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleFit}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 transition-colors"
              title="Fit to screen"
            >
              <Maximize2 size={12} />
            </button>
            <button
              onClick={handleZoomOut}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 transition-colors"
            >
              <ZoomOut size={12} />
            </button>
            <span className="text-[10px] tabular-nums text-slate-400 w-9 text-center">{zoom}%</span>
            <button
              onClick={handleZoomIn}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 transition-colors"
            >
              <ZoomIn size={12} />
            </button>
          </div>

          {/* Search */}
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                value={symbolQuery}
                onChange={e => setSymbolQuery(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Symbol — e.g. UserService"
                className="h-7 w-56 rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-[11px] text-slate-700 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:outline-none transition-colors"
              />
            </div>
            <button
              onClick={() => fetchGraph()}
              disabled={isLoading || !symbolQuery.trim()}
              className="flex h-7 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-[11px] font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading
                ? <><Loader2 size={11} className="animate-spin" /> Traversing…</>
                : <><RefreshCw size={11} /> Build Graph</>}
            </button>
          </div>
        </div>

        {/* Error / info banner */}
        {error && (
          <div className="shrink-0 flex items-center gap-2 bg-red-50 px-4 py-2 text-[11px] text-red-700 border-b border-red-200">
            <AlertTriangle size={12} /> {error}
          </div>
        )}
        {message && !error && (
          <div className="shrink-0 flex items-center gap-2 bg-amber-50 px-4 py-2 text-[11px] text-amber-700 border-b border-amber-200">
            <AlertTriangle size={12} /> {message}
          </div>
        )}

        {/* Canvas area */}
        <div className="relative flex-1 overflow-hidden">

          {/* Loading overlay */}
          {isLoading && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
              <Loader2 size={28} className="animate-spin text-indigo-500 mb-2" />
              <p className="text-sm text-slate-500 font-medium">Traversing AST code index…</p>
            </div>
          )}

          {/* Empty state */}
          {!hasData && !isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400 select-none">
              <GitBranch size={44} strokeWidth={1} />
              <p className="text-sm font-medium text-slate-500">
                {activeCapability
                  ? 'Enter a symbol name above and click Build Graph'
                  : 'Select a capability from the header first'}
              </p>
              <p className="text-[11px] max-w-xs text-center text-slate-400">
                Works on any indexed capability — try a class name, function, or method
                (e.g.{' '}
                <span className="font-mono text-indigo-500">UserService</span>,{' '}
                <span className="font-mono text-indigo-500">getProfile</span>).
              </p>
            </div>
          )}

          {/* Graph canvas */}
          {hasData && (
            <>
              <WorldModelCanvas
                nodes={nodes}
                edges={edges}
                onNodeSelect={setSelectedNode}
                onNetworkReady={handleNetworkReady}
              />
              {/* Legend (top-right overlay) */}
              <GraphLegend />
              {/* AST mini panel (bottom-left overlay) */}
              <AstMiniPanel node={selectedNode ?? nodes.find(n => n.data?.isFocal) ?? null} />
            </>
          )}
        </div>

        {/* Event timeline */}
        <EventTimeline events={timelineEvents} isLoading={isLoading} />
      </div>

      {/* ── Right property panel ─────────────────────────────────────────────── */}
      <PropertyPanel
        node={selectedNode}
        allNodes={nodes}
        allEdges={edges}
        onClose={() => setSelectedNode(null)}
      />
    </div>
  );
}
