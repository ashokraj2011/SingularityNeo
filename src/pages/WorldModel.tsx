/**
 * Code World Model — symbol-centric AST graph.
 *
 * Type a symbol name → the server searches the code index by name,
 * resolves the symbolId, then walks the CONTAINS/CALLS edge graph up
 * to N hops and returns a vis.js-compatible node/edge payload.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Network, Loader2, Search, AlertTriangle, RefreshCw, GitBranch } from 'lucide-react';
import { useCapability } from '../context/CapabilityContext';
import WorldModelCanvas from '../components/world-model/WorldModelCanvas';
import PropertyPanel from '../components/world-model/PropertyPanel';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorldModelNode {
  id: string;
  label: string;
  type: string;
  data: Record<string, unknown>;
}

interface WorldModelEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  type: 'ImpactEdge' | 'NormalEdge';
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WorldModel() {
  const { activeCapability } = useCapability();

  const [symbolQuery, setSymbolQuery] = useState('');
  const [nodes, setNodes]             = useState<WorldModelNode[]>([]);
  const [edges, setEdges]             = useState<WorldModelEdge[]>([]);
  const [isLoading, setIsLoading]     = useState(false);
  const [message, setMessage]         = useState<string | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<WorldModelNode | null>(null);
  const [depth, setDepth]             = useState(3);
  const [focusedSymbol, setFocusedSymbol] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const fetchGraph = useCallback(async (query?: string) => {
    const capId = activeCapability?.id;
    if (!capId) {
      setError('No capability selected. Pick one from the header first.');
      return;
    }
    const q = (query ?? symbolQuery).trim();
    if (!q) {
      setError('Enter a symbol name to search (e.g. a class, function or method name).');
      return;
    }
    setIsLoading(true);
    setError(null);
    setMessage(null);
    setSelectedNode(null);

    try {
      const url = `/api/capabilities/${capId}/world-model/graph`
        + `?focusSymbol=${encodeURIComponent(q)}`
        + `&maxDepth=${depth}`;
      const resp = await fetch(url);
      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.error || `Server error ${resp.status}`);
      }

      setNodes(data.nodes || []);
      setEdges(data.edges || []);
      if (data.focusedSymbol) setFocusedSymbol(data.focusedSymbol);
      if (data.message) setMessage(data.message);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load world model');
      setNodes([]);
      setEdges([]);
    } finally {
      setIsLoading(false);
    }
  }, [activeCapability?.id, symbolQuery, depth]);

  // Auto-load nothing on mount — wait for user to type
  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') fetchGraph();
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const hasData = nodes.length > 0;

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 4rem)' }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-6 py-3 bg-surface-container border-b border-outline-variant/30 shrink-0">
        <div className="flex items-center gap-2">
          <GitBranch size={18} className="text-primary" />
          <span className="text-sm font-semibold text-on-surface">Code World Model</span>
          {focusedSymbol && hasData && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-mono text-primary">
              {focusedSymbol}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Depth selector */}
          <div className="flex items-center gap-1 text-xs text-on-surface-variant">
            <span>Depth:</span>
            {[2, 3, 4, 5].map(d => (
              <button
                key={d}
                onClick={() => setDepth(d)}
                className={`w-6 h-6 rounded text-[11px] font-bold transition-colors ${
                  depth === d
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
                }`}
              >
                {d}
              </button>
            ))}
          </div>

          {/* Search input */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
            <input
              ref={inputRef}
              type="text"
              value={symbolQuery}
              onChange={e => setSymbolQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Symbol name — e.g. UserService"
              className="h-8 w-72 rounded-lg border border-outline-variant/40 bg-surface pl-8 pr-3 text-xs text-on-surface placeholder:text-on-surface-variant/50 focus:border-primary focus:outline-none"
            />
          </div>

          <button
            onClick={() => fetchGraph()}
            disabled={isLoading || !symbolQuery.trim()}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-on-primary shadow disabled:cursor-not-allowed disabled:opacity-50 hover:brightness-110 transition-all"
          >
            {isLoading
              ? <><Loader2 size={12} className="animate-spin" /> Traversing…</>
              : <><RefreshCw size={12} /> Build Graph</>
            }
          </button>
        </div>
      </div>

      {/* ── Error / info banner ─────────────────────────────────────────── */}
      {error && (
        <div className="shrink-0 flex items-center gap-2 bg-red-50 px-5 py-2 text-xs text-red-700 border-b border-red-200">
          <AlertTriangle size={13} />
          {error}
        </div>
      )}
      {message && !error && (
        <div className="shrink-0 flex items-center gap-2 bg-amber-50 px-5 py-2 text-xs text-amber-700 border-b border-amber-200">
          <AlertTriangle size={13} />
          {message}
        </div>
      )}

      {/* ── Main area ───────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Canvas */}
        <div className="relative flex-1" style={{ minHeight: 0 }}>
          {isLoading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-surface-container/70 backdrop-blur-sm">
              <Loader2 size={32} className="animate-spin text-primary mb-3" />
              <p className="text-sm text-on-surface-variant">Traversing AST code index…</p>
            </div>
          )}

          {!hasData && !isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-on-surface-variant/60 select-none">
              <Network size={48} strokeWidth={1} />
              <p className="text-sm font-medium">
                {activeCapability
                  ? 'Enter a symbol name above and click Build Graph'
                  : 'Select a capability from the header first'}
              </p>
              <p className="text-xs max-w-xs text-center text-on-surface-variant/40">
                Works on any indexed capability — try a class name, function, or method
                (e.g. <span className="font-mono">UserService</span>, <span className="font-mono">getProfile</span>).
              </p>
            </div>
          )}

          {hasData && (
            // vis-network needs an explicit pixel height — give it the
            // computed height of its wrapper via a 100% × 100% absolute fill.
            <div className="absolute inset-0">
              <WorldModelCanvas
                nodes={nodes}
                edges={edges}
                onNodeSelect={setSelectedNode}
              />
            </div>
          )}
        </div>

        {/* Property panel */}
        <PropertyPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
      </div>

      {/* ── Footer stats ────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-4 border-t border-outline-variant/20 bg-surface-container/30 px-5 py-1.5 text-[10px] text-on-surface-variant/60">
        {hasData ? (
          <>
            <span>{nodes.length} nodes</span>
            <span>·</span>
            <span>{edges.length} edges</span>
            <span>·</span>
            <span>depth {depth}</span>
            <span className="ml-auto">Click a node to inspect · Scroll to zoom · Drag to pan</span>
          </>
        ) : (
          <span>Powered by the capability code index</span>
        )}
      </div>
    </div>
  );
}
