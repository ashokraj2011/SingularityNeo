import React, { useMemo } from 'react';
import {
  X, ChevronRight, Flame, Bot, ShieldAlert, CheckCircle,
  Database, ArrowRightLeft, Code2, FlaskConical, FileText, GitCommit,
} from 'lucide-react';

export interface WorldModelNode {
  id: string;
  label: string;
  type: string;
  data: Record<string, unknown>;
}

export interface WorldModelEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  type: 'ImpactEdge' | 'NormalEdge';
}

interface Props {
  node: WorldModelNode | null;
  allNodes: WorldModelNode[];
  allEdges: WorldModelEdge[];
  onClose: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseParameters(signature: string): string[] {
  if (!signature) return [];
  const m = signature.match(/\(([^)]*)\)/);
  if (!m || !m[1].trim()) return [];
  return m[1]
    .split(',')
    .map(p => {
      const parts = p.trim().split(/\s+/);
      // Java: "TypeName varName" → return TypeName
      // TypeScript: "varName: TypeName" → return TypeName
      if (parts.length >= 2 && parts[1].startsWith(':')) return parts.slice(1).join(' ').replace(/^:\s*/, '');
      return parts[0];
    })
    .filter(Boolean);
}

function getDerivedRisk(
  node: WorldModelNode,
  edges: WorldModelEdge[],
): 'High' | 'Medium' | 'Low' {
  const impactCount = edges.filter(
    e => (e.from === node.id || e.to === node.id) && e.type === 'ImpactEdge',
  ).length;
  if (impactCount >= 3 || node.type === 'ApiNode') return 'High';
  if (impactCount >= 1) return 'Medium';
  return 'Low';
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Section({
  icon,
  label,
  children,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <div className="py-3.5 border-b border-slate-100 last:border-0">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
          {icon}
          {label}
        </div>
        {badge}
      </div>
      {children}
    </div>
  );
}

function Tag({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-block text-[10px] font-mono bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 ${className}`}>
      {children}
    </span>
  );
}

function ChevronRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between group cursor-default">
      <span className="text-xs text-slate-600">{children}</span>
      <ChevronRight size={12} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PropertyPanel({ node, allNodes, allEdges, onClose }: Props) {
  const derived = useMemo(() => {
    if (!node) return null;

    const sig = String(node.data?.signature ?? '');
    const inputs = parseParameters(sig);

    const outCalls = allEdges
      .filter(e => e.from === node.id && e.label === 'calls')
      .map(e => allNodes.find(n => n.id === e.to)?.label ?? e.to)
      .slice(0, 6);

    const reads = allEdges
      .filter(e => e.from === node.id && e.label === 'reads')
      .map(e => allNodes.find(n => n.id === e.to)?.label ?? e.to);

    const writes = allEdges
      .filter(e => e.from === node.id && e.label === 'writes')
      .map(e => allNodes.find(n => n.id === e.to)?.label ?? e.to);

    // All test-type nodes reachable in the graph
    const tests = allNodes.filter(n => n.type === 'TestNode').slice(0, 4);

    const risk = getDerivedRisk(node, allEdges);

    const impactTargets = allEdges
      .filter(e => e.from === node.id && e.type === 'ImpactEdge')
      .map(e => allNodes.find(n => n.id === e.to)?.label ?? e.to);

    const filePath = String(node.data?.filePath ?? '');
    const fileShort = filePath.split('/').pop() ?? filePath;
    const kind = String(node.data?.kind ?? '');
    const depth = node.data?.depth as number | undefined;
    const repositoryLabel = String(node.data?.repositoryLabel ?? '');

    return { inputs, outCalls, reads, writes, tests, risk, impactTargets, filePath, fileShort, kind, depth, repositoryLabel, sig };
  }, [node, allNodes, allEdges]);

  // ── Empty state ──────────────────────────────────────────────────────────────
  if (!node || !derived) {
    return (
      <aside className="w-80 shrink-0 flex flex-col items-center justify-center gap-3 border-l border-slate-200 bg-white text-slate-400 select-none">
        <ArrowRightLeft size={32} strokeWidth={1.2} />
        <p className="text-sm text-center px-6">
          Click any node in the graph to inspect its properties and relationships.
        </p>
      </aside>
    );
  }

  const riskColor =
    derived.risk === 'High' ? 'text-red-600 bg-red-50' :
    derived.risk === 'Medium' ? 'text-amber-700 bg-amber-50' :
    'text-green-700 bg-green-50';

  const typeName = node.type.replace('Node', '');

  return (
    <aside className="w-80 shrink-0 flex flex-col border-l border-slate-200 bg-white overflow-hidden">
      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-3 border-b border-slate-100 sticky top-0 bg-white z-10">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">{typeName}</p>
            <h2 className="text-sm font-bold text-slate-800 font-mono break-all leading-tight">{node.label}</h2>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {derived.risk === 'High' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-600 border border-red-200">
              <Flame size={10} /> High Risk
            </span>
          )}
          {node.data?.isFocal && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-600 border border-purple-200">
              <Bot size={10} /> Focal Symbol
            </span>
          )}
          {derived.impactTargets.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
              <ShieldAlert size={10} /> Approval Required
            </span>
          )}
        </div>
      </div>

      {/* ── Scrollable body ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-1">

        {/* Inputs (parameters) */}
        {derived.inputs.length > 0 && (
          <Section icon={<Code2 size={11} />} label="Inputs">
            <div className="space-y-1">
              {derived.inputs.map((p, i) => (
                <ChevronRow key={i}>
                  <span className="font-mono">{p}</span>
                </ChevronRow>
              ))}
            </div>
          </Section>
        )}

        {/* Calls */}
        {derived.outCalls.length > 0 && (
          <Section icon={<ArrowRightLeft size={11} />} label="Calls">
            <div className="space-y-1">
              {derived.outCalls.map((c, i) => (
                <ChevronRow key={i}>
                  <span className="font-mono">{c}</span>
                </ChevronRow>
              ))}
            </div>
          </Section>
        )}

        {/* Data touched */}
        {(derived.reads.length > 0 || derived.writes.length > 0) && (
          <Section icon={<Database size={11} />} label="Data touched">
            <div className="space-y-1">
              {derived.reads.map((r, i) => (
                <div key={`r${i}`} className="flex items-center gap-1.5 text-xs">
                  <span className="text-[9px] font-bold text-blue-600 bg-blue-50 rounded px-1 py-0.5">Reads</span>
                  <span className="font-mono text-slate-600">{r}</span>
                </div>
              ))}
              {derived.writes.map((w, i) => (
                <div key={`w${i}`} className="flex items-center gap-1.5 text-xs">
                  <span className="text-[9px] font-bold text-amber-700 bg-amber-50 rounded px-1 py-0.5">Writes</span>
                  <span className="font-mono text-slate-600">{w}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Tests */}
        <Section
          icon={<FlaskConical size={11} />}
          label="Tests"
          badge={
            derived.tests.length > 0
              ? <span className="text-[9px] font-bold text-green-700 bg-green-100 rounded px-1.5 py-0.5">{derived.tests.length} found</span>
              : undefined
          }
        >
          {derived.tests.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No test nodes in the graph</p>
          ) : (
            <div className="space-y-1">
              {derived.tests.map((t, i) => (
                <ChevronRow key={i}>
                  <span className="font-mono">{t.label}</span>
                </ChevronRow>
              ))}
            </div>
          )}
        </Section>

        {/* Risk */}
        <Section icon={<Flame size={11} />} label="Risk">
          <div className={`inline-flex items-center gap-1 text-[10px] font-bold rounded px-2 py-0.5 mb-1.5 ${riskColor}`}>
            {derived.risk}
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            {derived.risk === 'High'
              ? `Changes to ${node.label} may alter downstream behaviour. Impact on ${derived.impactTargets.length} dependent node(s).`
              : derived.risk === 'Medium'
              ? `Moderate downstream impact detected. Verify dependent callers before releasing.`
              : `No significant blast radius detected for this symbol at the current traversal depth.`}
          </p>
        </Section>

        {/* AST / Code info */}
        <Section icon={<Code2 size={11} />} label="AST Info">
          <div className="space-y-1 text-xs text-slate-600">
            {derived.kind && (
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 w-12 shrink-0">Kind</span>
                <Tag>{derived.kind}</Tag>
              </div>
            )}
            {derived.depth !== undefined && (
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 w-12 shrink-0">Depth</span>
                <Tag>{derived.depth}</Tag>
              </div>
            )}
            {derived.repositoryLabel && (
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 w-12 shrink-0">Repo</span>
                <span className="font-mono truncate">{derived.repositoryLabel}</span>
              </div>
            )}
            {derived.fileShort && (
              <div className="flex items-center gap-1.5" title={derived.filePath}>
                <span className="text-slate-400 w-12 shrink-0">File</span>
                <span className="font-mono truncate text-[10px]">{derived.fileShort}</span>
              </div>
            )}
          </div>
          {derived.sig && (
            <div className="mt-2 px-2 py-1.5 bg-slate-50 border border-slate-100 rounded text-[10px] font-mono text-slate-600 break-all leading-relaxed">
              {derived.sig}
            </div>
          )}
        </Section>

        {/* Recent AI change */}
        <Section icon={<GitCommit size={11} />} label="Recent Change">
          <div className="text-xs text-slate-500 leading-relaxed">
            <span className="inline-flex items-center gap-1 text-[9px] font-bold text-purple-600 bg-purple-50 rounded px-1.5 py-0.5 mb-1.5">
              <Bot size={9} /> AI Modified
            </span>
            <p>Symbol was indexed during the last code-graph traversal. Check your VCS diff for recent modifications to <span className="font-mono text-slate-700">{derived.fileShort}</span>.</p>
          </div>
        </Section>

        {/* Evidence */}
        <Section icon={<FileText size={11} />} label="Evidence">
          <p className="text-[10px] text-slate-400 mb-1">Evidence packet auto-generated on graph load</p>
          <span className="inline-flex items-center gap-1 text-xs text-indigo-600 font-bold bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
            <ShieldAlert size={10} className="text-amber-600" /> Approval Required
          </span>
        </Section>

      </div>
    </aside>
  );
}
