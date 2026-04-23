/**
 * BlastRadius — Shadow Execution Mode: shows what would break if a proposed
 * file change is deployed, visualised as a dependency radar with impact
 * classification (CRITICAL / WARNING / SAFE).
 *
 * Route: /blast-radius
 */
import React, { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Bot,
  Database,
  GitBranchPlus,
  MonitorDot,
  ScanEye,
  Search,
  Shield,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from '../components/EnterpriseUI';
import {
  fetchBlastRadius,
  fetchBlastRadiusSymbolGraph,
  type BlastImpactLevel,
  type BlastNode,
  type BlastRadiusResult,
  type BlastRadiusSymbolGraph,
} from '../lib/api';
import { useCapability } from '../context/CapabilityContext';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const IMPACT_TONE: Record<BlastImpactLevel, React.ComponentProps<typeof StatusBadge>['tone']> = {
  CRITICAL: 'danger',
  WARNING: 'warning',
  SAFE: 'success',
};

const LINE_COLORS: Record<BlastImpactLevel, string> = {
  CRITICAL: '#f43f5e',
  WARNING: '#f59e0b',
  SAFE:     '#10b981',
};

const STAT_TONE: Record<BlastImpactLevel, React.ComponentProps<typeof StatTile>['tone']> = {
  CRITICAL: 'danger',
  WARNING: 'warning',
  SAFE: 'success',
};

/** Distribute nodes in a rough circle around a center point. */
const positionNodes = (
  nodes: BlastNode[],
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): Array<BlastNode & { x: number; y: number }> => {
  if (!nodes.length) return [];
  return nodes.map((node, i) => {
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    return { ...node, x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// RadarCanvas — SVG-based impact map (intentionally dark visualization)
// ─────────────────────────────────────────────────────────────────────────────

const RadarCanvas = ({
  result,
  onNodeClick,
}: {
  result: BlastRadiusResult;
  onNodeClick: (node: BlastNode) => void;
}) => {
  const W = 580;
  const H = 460;
  const cx = W / 2;
  const cy = H / 2;
  const positioned = positionNodes(result.nodes, cx, cy, W * 0.38, H * 0.38);

  return (
    <div
      className="relative overflow-hidden rounded-xl bg-slate-950"
      style={{ height: H, boxShadow: 'inset 0 0 60px rgba(0,0,0,0.6)' }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height="100%"
        className="absolute inset-0"
        aria-label="Blast radius dependency map"
      >
        {/* Radar rings */}
        {[0.25, 0.5, 0.75].map(r => (
          <circle
            key={r}
            cx={cx}
            cy={cy}
            r={Math.min(W, H) * r * 0.48}
            fill="none"
            stroke="rgba(255,255,255,0.05)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        ))}

        {/* Connector lines */}
        {positioned.map(node => (
          <line
            key={`line-${node.id}`}
            x1={cx} y1={cy} x2={node.x} y2={node.y}
            stroke={LINE_COLORS[node.impactLevel]}
            strokeWidth={1.5}
            strokeDasharray={node.impactLevel === 'CRITICAL' ? '4 4' : '4 8'}
            opacity={0.6}
          />
        ))}

        {/* Center node */}
        <g transform={`translate(${cx},${cy})`}>
          <circle r={28} fill="#38bdf8" />
          <Database size={18} x={-9} y={-9} color="#fff" />
        </g>
        <text
          x={cx} y={cy + 44}
          textAnchor="middle"
          fill="#94a3b8"
          fontSize={10}
          fontFamily="ui-monospace,monospace"
        >
          {result.targetFile.split('/').slice(-1)[0]}
        </text>

        {/* Dependent nodes */}
        {positioned.map(node => (
          <g
            key={node.id}
            transform={`translate(${node.x},${node.y})`}
            className="cursor-pointer"
            onClick={() => onNodeClick(node)}
            role="button"
            aria-label={`${node.label} — ${node.impactLevel}`}
          >
            <circle r={22} fill="#0f172a" stroke={LINE_COLORS[node.impactLevel]} strokeWidth={2} />
            <MonitorDot size={14} x={-7} y={-7} color={LINE_COLORS[node.impactLevel]} />
            <text y={34} textAnchor="middle" fill="#f1f5f9" fontSize={9} fontWeight={600} fontFamily="ui-sans-serif,system-ui">
              {node.label.length > 20 ? `${node.label.slice(0, 18)}…` : node.label}
            </text>
            <text y={45} textAnchor="middle" fill={LINE_COLORS[node.impactLevel]} fontSize={8} fontFamily="ui-monospace,monospace">
              {node.impactLevel}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Analysis panel
// ─────────────────────────────────────────────────────────────────────────────

const AnalysisPanel = ({
  result,
  selectedNode,
  onSpawnAgents,
}: {
  result: BlastRadiusResult;
  selectedNode: BlastNode | null;
  onSpawnAgents: () => void;
}) => (
  <div className="flex flex-col gap-5">
    {/* Stats */}
    <div className="grid grid-cols-2 gap-3">
      <StatTile label="Total dependents" value={result.totalDependents} icon={Activity} tone="info" />
      <StatTile label="Critical" value={result.criticalCount} icon={AlertTriangle} tone={result.criticalCount > 0 ? 'danger' : 'neutral'} />
    </div>

    {/* Impact vectors */}
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-widest text-secondary">Impact Vectors</p>
      {result.nodes.slice(0, 5).map(node => (
        <div
          key={node.id}
          className="rounded-lg border border-outline-variant/40 bg-surface-container-low p-3"
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold text-on-surface">{node.label}</span>
            <StatusBadge tone={IMPACT_TONE[node.impactLevel]}>{node.impactLevel}</StatusBadge>
          </div>
          <p className="border-l-2 pl-2 text-xs text-secondary" style={{ borderColor: LINE_COLORS[node.impactLevel] }}>
            {node.reason.slice(0, 110)}{node.reason.length > 110 ? '…' : ''}
          </p>
        </div>
      ))}
      {result.nodes.length > 5 ? (
        <p className="text-xs text-secondary">+{result.nodes.length - 5} more dependents…</p>
      ) : null}
    </div>

    {/* Selected node */}
    {selectedNode ? (
      <div className="rounded-lg border border-outline-variant/40 bg-surface-container-low p-4">
        <p className="mb-1 text-xs font-bold uppercase tracking-widest text-secondary">Selected Node</p>
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-on-surface">{selectedNode.label}</p>
          <StatusBadge tone={IMPACT_TONE[selectedNode.impactLevel]}>{selectedNode.impactLevel}</StatusBadge>
        </div>
        <p className="mt-1 font-mono text-xs text-secondary">{selectedNode.filePath}</p>
        <p className="mt-2 text-xs text-secondary">{selectedNode.reason}</p>
        <p className="mt-1 text-[0.65rem] text-secondary/60">Coupling: {selectedNode.couplingKind.replace(/_/g, ' ')}</p>
      </div>
    ) : null}

    {/* Architect recommendation */}
    <div className="rounded-lg border border-outline-variant/40 bg-surface-container-low p-4">
      <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-secondary">
        <Bot size={13} /> Architect Recommendation
      </p>
      {result.criticalCount > 0 ? (
        <p className="text-sm text-secondary">
          Release blocked — {result.criticalCount} downstream cascading failure{result.criticalCount === 1 ? '' : 's'} detected.
          Spawn migration sub-tickets to safely update breaking dependents before deploying.
        </p>
      ) : result.warningCount > 0 ? (
        <p className="text-sm text-secondary">
          No critical breakages, but {result.warningCount} dependent{result.warningCount === 1 ? '' : 's'} may need
          API contract updates. Review before merging.
        </p>
      ) : (
        <p className="text-sm text-secondary">
          No downstream breakages detected. This change appears safe to proceed.
        </p>
      )}
      {result.criticalCount + result.warningCount > 0 ? (
        <button
          className="enterprise-button mt-3 w-full justify-center bg-primary text-on-primary hover:bg-primary/90"
          onClick={onSpawnAgents}
        >
          <GitBranchPlus size={15} /> Spawn Migration Agents
        </button>
      ) : null}
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function BlastRadius() {
  const { activeCapability } = useCapability();
  const [filePath, setFilePath] = useState('');
  const [result, setResult] = useState<BlastRadiusResult | null>(null);
  const [symbolGraph, setSymbolGraph] = useState<BlastRadiusSymbolGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<BlastNode | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const capabilityId = activeCapability?.id ?? '';

  const runSimulation = useCallback(async () => {
    const path = filePath.trim();
    if (!path || !capabilityId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setSymbolGraph(null);
    setSelectedNode(null);
    try {
      const [data, graph] = await Promise.all([
        fetchBlastRadius(capabilityId, path),
        fetchBlastRadiusSymbolGraph(capabilityId, { filePath: path, maxDepth: 3, maxNodes: 48 }),
      ]);
      setResult(data);
      setSymbolGraph(graph);
    } catch (err: any) {
      setError(err?.message ?? 'Simulation failed');
    } finally {
      setLoading(false);
    }
  }, [filePath, capabilityId]);

  const handleSpawnAgents = () => {
    navigate('/');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Blast Radius"
        title="Shadow Execution Map"
        description="Enter a file path to simulate what would break across this capability's dependency graph if the file were modified or removed. Impact is classified as CRITICAL, WARNING, or SAFE."
      >
        <StatusBadge tone="info">ARCHITECT_AGENT // DRY RUN</StatusBadge>
      </PageHeader>

      {/* Search */}
      <SectionCard
        title="File Simulation"
        description="Enter a source file path relative to the repo root to compute its blast radius."
        icon={ScanEye}
      >
        <div className="flex gap-3">
          <input
            ref={inputRef}
            value={filePath}
            onChange={e => setFilePath(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runSimulation()}
            placeholder="e.g. src/auth/token.ts"
            className="flex-1 rounded-lg border border-outline-variant/50 bg-white px-4 py-2.5 font-mono text-sm text-on-surface placeholder-secondary/50 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/10"
          />
          <button
            onClick={runSimulation}
            disabled={loading || !filePath.trim() || !capabilityId}
            className="enterprise-button bg-primary text-on-primary hover:bg-primary/90 disabled:opacity-40"
          >
            <Search size={15} />
            {loading ? 'Analysing…' : 'Simulate'}
          </button>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
      </SectionCard>

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-outline-variant border-t-primary" />
        </div>
      ) : null}

      {/* Empty state */}
      {!result && !loading ? (
        <EmptyState
          title="No simulation run yet"
          description="Enter a file path above and click Simulate to see the blast radius."
          icon={Shield}
        />
      ) : null}

      {/* Results */}
      {result ? (
        <>
          {/* Summary badges */}
          <div className="flex flex-wrap gap-3">
            {(['CRITICAL', 'WARNING', 'SAFE'] as BlastImpactLevel[]).map(level => {
              const count = level === 'CRITICAL' ? result.criticalCount : level === 'WARNING' ? result.warningCount : result.safeCount;
              return (
                <StatTile
                  key={level}
                  label={level}
                  value={count}
                  tone={STAT_TONE[level]}
                  className="min-w-[120px]"
                />
              );
            })}
          </div>

          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            {/* Radar */}
            <SectionCard
              title={`Dependency Map — ${result.targetFile}`}
              description={`${result.totalDependents} dependent${result.totalDependents === 1 ? '' : 's'} identified. Click a node for details.`}
              icon={ScanEye}
              contentClassName="p-0"
            >
              <RadarCanvas result={result} onNodeClick={setSelectedNode} />
            </SectionCard>

            {/* Analysis panel */}
            <SectionCard
              title="Impact Analysis"
              description="Breakdown of affected files and architect guidance."
              icon={Activity}
            >
              <AnalysisPanel
                result={result}
                selectedNode={selectedNode}
                onSpawnAgents={handleSpawnAgents}
              />
            </SectionCard>
          </div>

          <SectionCard
            title="Native Symbol Edge Graph"
            description="Recursive SQL traversal over materialized code-symbol edges. Seeds come from the indexed top-level symbols in the selected file."
            icon={Database}
          >
            {!symbolGraph || symbolGraph.nodes.length === 0 ? (
              <EmptyState
                title="No symbol graph available"
                description="Refresh the code index for this capability to materialize containment edges, then rerun the simulation."
                icon={Database}
              />
            ) : (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <StatTile
                    label="Seed symbols"
                    value={symbolGraph.seedSymbolIds.length}
                    tone="info"
                  />
                  <StatTile
                    label="Connected symbols"
                    value={symbolGraph.totalNodes}
                    tone="brand"
                  />
                  <StatTile
                    label="Max depth"
                    value={symbolGraph.maxDepth}
                    tone="neutral"
                  />
                </div>

                <div className="overflow-x-auto rounded-2xl border border-outline-variant/40">
                  <table className="min-w-full divide-y divide-outline-variant/20 text-sm">
                    <thead className="bg-surface-container-low text-left text-[0.68rem] font-bold uppercase tracking-[0.16em] text-secondary">
                      <tr>
                        <th className="px-4 py-3">Relation</th>
                        <th className="px-4 py-3 text-right">Depth</th>
                        <th className="px-4 py-3">Symbol</th>
                        <th className="px-4 py-3">Kind</th>
                        <th className="px-4 py-3">File</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/10 bg-white">
                      {symbolGraph.nodes.map(node => (
                        <tr key={node.symbolId}>
                          <td className="px-4 py-3">
                            <StatusBadge
                              tone={
                                node.relation === 'SEED'
                                  ? 'info'
                                  : node.relation === 'ANCESTOR'
                                    ? 'warning'
                                    : 'success'
                              }
                            >
                              {node.relation}
                            </StatusBadge>
                          </td>
                          <td className="px-4 py-3 text-right font-mono">{node.depth}</td>
                          <td className="px-4 py-3 align-top">
                            <div className="font-semibold text-on-surface">
                              {node.qualifiedSymbolName || node.symbolName}
                            </div>
                            <code className="text-[0.72rem] text-secondary">{node.symbolId}</code>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge tone="neutral">{node.kind}</StatusBadge>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-secondary">
                            {node.filePath}:{node.sliceStartLine}-{node.sliceEndLine}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}
