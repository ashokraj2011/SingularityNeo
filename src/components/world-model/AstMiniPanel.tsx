/**
 * AstMiniPanel — floating bottom-left overlay on the World Model canvas.
 *
 * Shows the REAL structural context of the selected (or focal) symbol,
 * fetched from /api/capabilities/:capId/world-model/ast-context/:symbolId.
 *
 * Structure:
 *   [parent class / module]
 *     ↳ [focal symbol]  ← highlighted
 *       ↳ children[]    ← if focal is a class / module
 *   Siblings[]          ← other members of the same parent
 */
import React, { useEffect, useState } from 'react';
import { GitBranch, Loader2, ChevronRight } from 'lucide-react';

export interface AstSymbolEntry {
  symbolId: string;
  symbolName: string;
  kind: string;
  signature: string;
  startLine: number;
  endLine: number;
}

export interface SymbolAstContext {
  parent: { symbolId: string; symbolName: string; kind: string } | null;
  children: AstSymbolEntry[];
  siblings: AstSymbolEntry[];
}

interface Props {
  capabilityId: string | undefined;
  symbolId: string | undefined;
  symbolName: string | undefined;
  kind: string | undefined;
}

const KIND_ICON: Record<string, string> = {
  class:        '◈',
  interface:    '◇',
  function:     'ƒ',
  method:       '⚙',
  property:     '●',
  variable:     '●',
  type:         '⊛',
  enum:         '≡',
  constructor:  '✦',
};

function kindIcon(k: string): string {
  return KIND_ICON[k?.toLowerCase()] ?? '·';
}

function kindLabel(k: string): string {
  return k
    ? k.charAt(0).toUpperCase() + k.slice(1).toLowerCase() + 'Declaration'
    : 'Declaration';
}

function Row({
  icon,
  name,
  line,
  focal = false,
  muted = false,
  indent = 0,
}: {
  icon: string;
  name: string;
  line?: number;
  focal?: boolean;
  muted?: boolean;
  indent?: number;
}) {
  const displayName = name.length > 22 ? name.slice(0, 20) + '…' : name;
  return (
    <div
      className={`flex items-center gap-1 leading-tight rounded px-1 py-0.5
        ${focal ? 'bg-indigo-50 text-indigo-700 font-bold' : ''}
        ${muted ? 'text-slate-400' : 'text-slate-600'}`}
      style={{ paddingLeft: indent * 10 + 4 }}
    >
      <span className="text-[11px] shrink-0 w-3 text-center">{icon}</span>
      <span className={`text-[10px] font-mono truncate ${focal ? 'text-indigo-700' : ''}`}>{displayName}</span>
      {line !== undefined && line > 0 && (
        <span className="ml-auto text-[9px] text-slate-300 tabular-nums shrink-0">L{line}</span>
      )}
    </div>
  );
}

export default function AstMiniPanel({ capabilityId, symbolId, symbolName, kind }: Props) {
  const [ctx, setCtx]         = useState<SymbolAstContext | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!capabilityId || !symbolId) {
      setCtx(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/capabilities/${capabilityId}/world-model/ast-context/${encodeURIComponent(symbolId)}`)
      .then(r => r.json())
      .then(data => {
        if (!cancelled) {
          setCtx(data as SymbolAstContext);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [capabilityId, symbolId]);

  if (!symbolId || !symbolName) return null;

  const hasRealData = ctx && (ctx.parent || ctx.children.length > 0 || ctx.siblings.length > 0);

  return (
    <div className="absolute bottom-3 left-3 z-20 bg-white/95 backdrop-blur-sm border border-slate-200 rounded-xl shadow-lg p-3 w-56 max-h-72 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2 shrink-0">
        <GitBranch size={10} className="text-slate-400" />
        <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">AST Context</span>
        {loading && <Loader2 size={9} className="animate-spin text-slate-400 ml-auto" />}
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto space-y-0.5 min-h-0">

        {/* Parent */}
        {ctx?.parent && (
          <Row
            icon={kindIcon(ctx.parent.kind)}
            name={ctx.parent.symbolName}
            muted
            indent={0}
          />
        )}

        {/* Focal symbol */}
        <Row
          icon={kindIcon(kind ?? '')}
          name={symbolName}
          focal
          indent={ctx?.parent ? 1 : 0}
        />

        {/* Children (if focal is a class/module) */}
        {hasRealData && ctx!.children.length > 0 && (
          <>
            <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider px-1 pt-1">
              Contains ({ctx!.children.length})
            </div>
            {ctx!.children.slice(0, 12).map(c => (
              <Row
                key={c.symbolId}
                icon={kindIcon(c.kind)}
                name={c.symbolName}
                line={c.startLine}
                indent={ctx?.parent ? 2 : 1}
              />
            ))}
            {ctx!.children.length > 12 && (
              <div className="text-[9px] text-slate-400 px-3">+ {ctx!.children.length - 12} more…</div>
            )}
          </>
        )}

        {/* Siblings (if focal is a method/property) */}
        {hasRealData && ctx!.siblings.length > 0 && ctx!.children.length === 0 && (
          <>
            <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider px-1 pt-1">
              Siblings ({ctx!.siblings.length})
            </div>
            {ctx!.siblings.slice(0, 10).map(s => (
              <Row
                key={s.symbolId}
                icon={kindIcon(s.kind)}
                name={s.symbolName}
                line={s.startLine}
                muted
                indent={ctx?.parent ? 1 : 0}
              />
            ))}
            {ctx!.siblings.length > 10 && (
              <div className="text-[9px] text-slate-400 px-3">+ {ctx!.siblings.length - 10} more…</div>
            )}
          </>
        )}

        {/* Loading / empty */}
        {loading && !ctx && (
          <p className="text-[10px] text-slate-400 italic px-1 py-2">Loading AST context…</p>
        )}
        {!loading && !hasRealData && ctx && (
          <div className="px-1 py-1 space-y-0.5">
            <Row icon={kindIcon(kind ?? '')} name={kindLabel(kind ?? '')} muted indent={0} />
            <Row icon={kindIcon(kind ?? '')} name={symbolName} focal indent={1} />
            <Row icon="·" name="Body" muted indent={2} />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-2 pt-1.5 border-t border-slate-100 shrink-0">
        <p className="text-[9px] text-slate-400 leading-tight">
          Raw AST is an input.<br />World Model is the output.
        </p>
      </div>
    </div>
  );
}
