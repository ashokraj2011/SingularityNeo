/**
 * AstExplorer — browse the local AST from the desktop base-clone repos.
 *
 * Shows all symbols extracted from the capability's linked repositories,
 * grouped by kind: API endpoints (classes/methods), interfaces/contracts,
 * functions, types, enums, and variables.
 *
 * Route: /ast-explorer
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Book,
  Box,
  ChevronDown,
  ChevronRight,
  Code2,
  Database,
  FileCode,
  Filter,
  Folder,
  FunctionSquare,
  GitBranch,
  Hash,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Server,
  Terminal,
  TreePine,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
  Toolbar,
} from '../components/EnterpriseUI';
import {
  fetchLocalAstSnapshot,
  refreshLocalAst,
} from '../lib/api';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import type {
  CapabilityCodeSymbol,
  CapabilityCodeSymbolKind,
  LocalAstSnapshot,
} from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Constants & helpers
// ─────────────────────────────────────────────────────────────────────────────

type EnterpriseToneSubset = 'info' | 'success' | 'warning' | 'neutral' | 'danger';

const KIND_META: Record<
  CapabilityCodeSymbolKind,
  { label: string; plural: string; Icon: LucideIcon; tone: EnterpriseToneSubset }
> = {
  class:     { label: 'Class',     plural: 'Classes',    Icon: Server,         tone: 'info' },
  interface: { label: 'Interface', plural: 'Interfaces', Icon: Layers,         tone: 'success' },
  type:      { label: 'Type',      plural: 'Types',      Icon: Hash,           tone: 'neutral' },
  function:  { label: 'Function',  plural: 'Functions',  Icon: FunctionSquare, tone: 'warning' },
  method:    { label: 'Method',    plural: 'Methods',    Icon: Zap,            tone: 'warning' },
  enum:      { label: 'Enum',      plural: 'Enums',      Icon: Book,           tone: 'neutral' },
  variable:  { label: 'Variable',  plural: 'Variables',  Icon: Box,            tone: 'neutral' },
  property:  { label: 'Property',  plural: 'Properties', Icon: GitBranch,      tone: 'neutral' },
};

const ALL_KINDS = Object.keys(KIND_META) as CapabilityCodeSymbolKind[];

// Symbols likely representing HTTP route handlers / API endpoints.
const API_SIGNAL_PATTERNS = [
  /Controller$/i,
  /Router$/i,
  /Handler$/i,
  /Route/i,
  /app\.(get|post|put|patch|delete|use)\b/i,
  /@(Get|Post|Put|Patch|Delete|RequestMapping)/,
];

const isApiSymbol = (s: CapabilityCodeSymbol) => {
  const name = s.qualifiedSymbolName || s.symbolName;
  return API_SIGNAL_PATTERNS.some(p => p.test(name)) ||
    API_SIGNAL_PATTERNS.some(p => p.test(s.signature || ''));
};

const formatTimestamp = (value?: string | null) => {
  if (!value) return 'Pending';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const shortPath = (filePath: string) => {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts.slice(-3).join('/');
};

// ─────────────────────────────────────────────────────────────────────────────
// Symbol row
// ─────────────────────────────────────────────────────────────────────────────

const SymbolRow = ({
  symbol,
  isExpanded,
  onToggle,
}: {
  symbol: CapabilityCodeSymbol;
  isExpanded: boolean;
  onToggle: () => void;
}) => {
  const meta = KIND_META[symbol.kind] ?? KIND_META.variable;
  const { Icon } = meta;
  const name = symbol.qualifiedSymbolName || symbol.symbolName;
  const hasSignature = Boolean(symbol.signature?.trim());

  return (
    <div className="border-b border-outline-variant/20 last:border-0">
      <button
        type="button"
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-container-low/60 transition-colors"
        onClick={onToggle}
      >
        <span className="mt-0.5 shrink-0 text-primary/70">
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-mono text-xs font-semibold text-on-surface">
              {name}
            </span>
            <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
            {symbol.isExported && (
              <StatusBadge tone="success">exported</StatusBadge>
            )}
            {isApiSymbol(symbol) && (
              <StatusBadge tone="info">API</StatusBadge>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-on-surface-variant">
            <Folder size={10} className="shrink-0" />
            <span className="truncate font-mono">{shortPath(symbol.filePath)}</span>
            <span className="text-on-surface-variant/50">
              :{symbol.sliceStartLine ?? symbol.startLine}–{symbol.sliceEndLine ?? symbol.endLine}
            </span>
          </div>
        </div>
        <span className="ml-auto shrink-0 text-on-surface-variant">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      {isExpanded && (
        <div className="border-t border-outline-variant/20 bg-surface-container-low/40 px-6 py-3 text-xs">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="font-medium text-on-surface-variant">Symbol</dt>
            <dd className="font-mono text-on-surface">{name}</dd>
            <dt className="font-medium text-on-surface-variant">Kind</dt>
            <dd className="font-mono text-on-surface">{symbol.kind}</dd>
            <dt className="font-medium text-on-surface-variant">Language</dt>
            <dd className="font-mono text-on-surface">{symbol.language || '—'}</dd>
            <dt className="font-medium text-on-surface-variant">File</dt>
            <dd className="font-mono break-all text-on-surface">{symbol.filePath}</dd>
            <dt className="font-medium text-on-surface-variant">Lines</dt>
            <dd className="font-mono text-on-surface">
              {symbol.sliceStartLine ?? symbol.startLine}–{symbol.sliceEndLine ?? symbol.endLine}
            </dd>
            {hasSignature && (
              <>
                <dt className="font-medium text-on-surface-variant">Signature</dt>
                <dd className="break-all font-mono text-on-surface">{symbol.signature}</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Kind section (collapsible group)
// ─────────────────────────────────────────────────────────────────────────────

const KindSection = ({
  kind,
  symbols,
}: {
  kind: CapabilityCodeSymbolKind;
  symbols: CapabilityCodeSymbol[];
}) => {
  const meta = KIND_META[kind];
  const { Icon } = meta;
  const [isOpen, setIsOpen] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="section-card overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-surface-container-low/50 transition-colors"
        onClick={() => setIsOpen(v => !v)}
      >
        <Icon size={16} className="text-primary/80 shrink-0" />
        <span className="flex-1 text-sm font-semibold text-on-surface">
          {meta.plural}
        </span>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {symbols.length}
        </span>
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {isOpen && (
        <div className="border-t border-outline-variant/30">
          {symbols.map(symbol => (
            <SymbolRow
              key={symbol.symbolId}
              symbol={symbol}
              isExpanded={expandedIds.has(symbol.symbolId)}
              onToggle={() => toggle(symbol.symbolId)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// API Endpoints section
// ─────────────────────────────────────────────────────────────────────────────

const ApiEndpointsSection = ({ symbols }: { symbols: CapabilityCodeSymbol[] }) => {
  const apiSymbols = useMemo(() => symbols.filter(isApiSymbol), [symbols]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (apiSymbols.length === 0) return null;

  return (
    <div className="section-card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-outline-variant/30 px-5 py-4">
        <Terminal size={16} className="shrink-0 text-info" />
        <span className="flex-1 text-sm font-semibold text-on-surface">API Endpoints & Route Handlers</span>
        <span className="rounded-full bg-info/10 px-2 py-0.5 text-xs font-medium text-info">
          {apiSymbols.length}
        </span>
      </div>
      {apiSymbols.map(symbol => (
        <SymbolRow
          key={symbol.symbolId}
          symbol={symbol}
          isExpanded={expandedIds.has(symbol.symbolId)}
          onToggle={() => toggle(symbol.symbolId)}
        />
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Repository card
// ─────────────────────────────────────────────────────────────────────────────

const RepoCard = ({
  repo,
}: {
  repo: LocalAstSnapshot['repositories'][number];
}) => (
  <div className="flex items-start gap-3 rounded-xl border border-outline-variant/30 bg-surface-container-low/60 px-4 py-3">
    <FileCode size={16} className="mt-0.5 shrink-0 text-primary/70" />
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-on-surface truncate">
          {repo.repositoryLabel || repo.repositoryId}
        </span>
        {repo.isPrimary && <StatusBadge tone="info">primary</StatusBadge>}
      </div>
      <div className="mt-1 text-xs text-on-surface-variant">
        <span className="font-mono">{repo.symbolCount.toLocaleString()}</span> symbols
        {' · '}indexed {formatTimestamp(repo.builtAt)}
      </div>
      <div className="mt-0.5 truncate font-mono text-[10px] text-on-surface-variant/60">
        {repo.checkoutPath}
      </div>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

const AstExplorer = () => {
  const { activeCapability } = useCapability();
  const { success, error: showError } = useToast();

  const [snapshot, setSnapshot] = useState<LocalAstSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<CapabilityCodeSymbolKind | ''>('');
  const [fileFilter, setFileFilter] = useState('');

  const loadSnapshot = useCallback(async (force = false) => {
    if (!activeCapability?.id) return;
    setLoading(true);
    setLoadError('');
    try {
      const data = await fetchLocalAstSnapshot(activeCapability.id, { force, limit: 3000 });
      setSnapshot(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load AST snapshot.');
    } finally {
      setLoading(false);
    }
  }, [activeCapability?.id]);

  useEffect(() => {
    void loadSnapshot(false);
  }, [loadSnapshot]);

  const handleRefresh = async () => {
    if (!activeCapability?.id || refreshing) return;
    setRefreshing(true);
    try {
      await refreshLocalAst(activeCapability.id);
      await loadSnapshot(true);
      success('AST re-indexed from local clone.');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Refresh failed.');
    } finally {
      setRefreshing(false);
    }
  };

  // Filtered symbols
  const filteredSymbols = useMemo(() => {
    if (!snapshot?.symbols) return [];
    let syms = snapshot.symbols;

    if (kindFilter) {
      syms = syms.filter(s => s.kind === kindFilter);
    }

    if (fileFilter.trim()) {
      const lc = fileFilter.trim().toLowerCase();
      syms = syms.filter(s => s.filePath.toLowerCase().includes(lc));
    }

    if (searchQuery.trim()) {
      const lc = searchQuery.trim().toLowerCase();
      syms = syms.filter(s =>
        (s.qualifiedSymbolName || s.symbolName).toLowerCase().includes(lc) ||
        (s.signature ?? '').toLowerCase().includes(lc)
      );
    }

    return syms;
  }, [snapshot, kindFilter, fileFilter, searchQuery]);

  // Group by kind for section rendering
  const symbolsByKind = useMemo(() => {
    const map = new Map<CapabilityCodeSymbolKind, CapabilityCodeSymbol[]>();
    for (const kind of ALL_KINDS) map.set(kind, []);
    for (const sym of filteredSymbols) {
      const arr = map.get(sym.kind);
      if (arr) arr.push(sym);
    }
    return map;
  }, [filteredSymbols]);

  // Stat counts (unfiltered)
  const stats = useMemo(() => {
    if (!snapshot?.symbols) return null;
    const all = snapshot.symbols;
    return {
      total: all.length,
      classes: all.filter(s => s.kind === 'class').length,
      interfaces: all.filter(s => s.kind === 'interface').length,
      functions: all.filter(s => s.kind === 'function' || s.kind === 'method').length,
      api: all.filter(isApiSymbol).length,
      repos: snapshot.repositories.length,
    };
  }, [snapshot]);

  const hasFilters = Boolean(kindFilter || fileFilter.trim() || searchQuery.trim());
  const isNoClones = snapshot?.baseCloneCount === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Developer"
        title="AST Explorer"
        description={
          activeCapability
            ? `${activeCapability.name} — local code index from desktop base clones`
            : 'Select a capability to browse its code index'
        }
        actions={
          <div className="flex items-center gap-2">
            {snapshot?.builtAt && (
              <span className="text-xs text-on-surface-variant">
                Indexed {formatTimestamp(snapshot.builtAt)}
              </span>
            )}
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={refreshing || loading}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {refreshing ? 'Re-indexing…' : 'Refresh AST'}
            </button>
          </div>
        }
      />

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Total Symbols" value={stats.total.toLocaleString()} tone="neutral" />
          <StatTile label="API Endpoints" value={stats.api.toLocaleString()} tone="info" />
          <StatTile label="Classes" value={stats.classes.toLocaleString()} tone="info" />
          <StatTile label="Interfaces" value={stats.interfaces.toLocaleString()} tone="success" />
          <StatTile label="Functions / Methods" value={stats.functions.toLocaleString()} tone="warning" />
          <StatTile label="Repositories" value={stats.repos.toLocaleString()} tone="neutral" />
        </div>
      )}

      {/* Repository summary */}
      {snapshot && snapshot.repositories.length > 0 && (
        <SectionCard
          title="Repositories"
          description="Base-clone repos synced at desktop claim time"
          icon={Database}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {snapshot.repositories.map(repo => (
              <RepoCard key={repo.repositoryId} repo={repo} />
            ))}
          </div>
        </SectionCard>
      )}

      {/* Filters */}
      <Toolbar>
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
            <input
              type="text"
              placeholder="Search symbols…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="input-base w-full pl-9 text-sm"
            />
          </div>

          <div className="relative">
            <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
            <select
              value={kindFilter}
              onChange={e => setKindFilter(e.target.value as CapabilityCodeSymbolKind | '')}
              className="input-base appearance-none pl-9 pr-8 text-sm"
            >
              <option value="">All kinds</option>
              {ALL_KINDS.map(k => (
                <option key={k} value={k}>{KIND_META[k].label}</option>
              ))}
            </select>
          </div>

          <div className="relative flex-1 min-w-36">
            <Folder size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
            <input
              type="text"
              placeholder="Filter by file path…"
              value={fileFilter}
              onChange={e => setFileFilter(e.target.value)}
              className="input-base w-full pl-9 text-sm"
            />
          </div>

          {hasFilters && (
            <button
              type="button"
              onClick={() => { setSearchQuery(''); setKindFilter(''); setFileFilter(''); }}
              className="btn-ghost text-xs text-on-surface-variant"
            >
              Clear filters
            </button>
          )}
        </div>
        {filteredSymbols.length > 0 && (
          <span className="text-xs text-on-surface-variant">
            {filteredSymbols.length.toLocaleString()} symbol{filteredSymbols.length !== 1 ? 's' : ''}
            {hasFilters ? ' matching' : ''}
          </span>
        )}
      </Toolbar>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center gap-3 rounded-2xl border border-outline-variant/30 bg-surface-container-low/40 py-16">
          <Loader2 size={20} className="animate-spin text-primary" />
          <span className="text-sm text-on-surface-variant">Building AST index from local clone…</span>
        </div>
      )}

      {/* Error */}
      {loadError && !loading && (
        <EmptyState
          icon={Code2}
          title="Could not load AST"
          description={loadError}
          action={
            <button type="button" onClick={() => void loadSnapshot(false)} className="btn-primary text-sm">
              Retry
            </button>
          }
        />
      )}

      {/* No clones */}
      {isNoClones && !loading && (
        <EmptyState
          icon={TreePine}
          title="No local clone available"
          description={
            snapshot?.message ??
            'The desktop base-clone repos have not been synced yet. Claim a task on this capability or trigger a repo-sync from Operations.'
          }
        />
      )}

      {/* Symbol groups */}
      {!loading && !loadError && snapshot && snapshot.baseCloneCount > 0 && (
        <div className="space-y-4">
          {/* API endpoints — pinned at top */}
          {!kindFilter && <ApiEndpointsSection symbols={filteredSymbols} />}

          {/* Per-kind sections */}
          {ALL_KINDS.filter(k => !kindFilter || kindFilter === k).map(kind => {
            const syms = symbolsByKind.get(kind) ?? [];
            if (syms.length === 0) return null;
            return <KindSection key={kind} kind={kind} symbols={syms} />;
          })}

          {filteredSymbols.length === 0 && hasFilters && (
            <EmptyState
              icon={Search}
              title="No symbols match"
              description="Try adjusting your search or filters."
            />
          )}
        </div>
      )}
    </div>
  );
};

export default AstExplorer;
