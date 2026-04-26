import { Request, Response, Router } from 'express';
import {
  readBlastRadiusSymbolGraph,
  searchCodeSymbols,
  getSymbolAstContext,
} from '../codeIndex/query';
import type { BlastRadiusSymbolGraphNode } from '../../src/types';

/**
 * Heuristics to assign semantic typed nodes from raw AST data.
 */
const determineNodeType = (node: BlastRadiusSymbolGraphNode): string => {
  const name = (node.symbolName || '').toLowerCase();
  const fp   = (node.filePath   || '').toLowerCase();

  if (fp.includes('.test.') || fp.includes('.spec.')) return 'TestNode';
  if (fp.includes('/api/')  || name.includes('client') || name.includes('api') || name.includes('fetch')) return 'ApiNode';
  if (fp.includes('service') || name.includes('service') || name.includes('manager') || name.includes('provider')) return 'ServiceNode';
  if (fp.includes('repo') || name.includes('repo') || name.includes('store') || name.includes('dao')) return 'RepoNode';
  if (name.includes('context') || name.includes('state') || name.includes('model') || name.includes('entity') || node.kind === 'interface') return 'DataNode';
  if (['function', 'method'].includes(node.kind)) return 'MethodNode';
  return 'CapabilityNode';
};

// ─── GET /world-model/graph ───────────────────────────────────────────────────

const getWorldModelGraph = async (req: Request, res: Response) => {
  try {
    const { capabilityId } = req.params;
    const { focusSymbol, maxDepth = '3' } = req.query;

    if (!focusSymbol || typeof focusSymbol !== 'string' || !focusSymbol.trim()) {
      return res.status(400).json({ error: 'focusSymbol query parameter is required (symbol name or qualified name)' });
    }

    // ── Step 1: Resolve symbol name → symbolId ───────────────────────────────
    const symbolMatches = await searchCodeSymbols(capabilityId, focusSymbol.trim(), {
      limit: 5,
    });

    let symbolId: string | undefined;
    let filePath:  string | undefined;

    if (symbolMatches.length > 0) {
      const exact = symbolMatches.find(
        s =>
          s.symbolName.toLowerCase() === focusSymbol.trim().toLowerCase() ||
          s.qualifiedSymbolName?.toLowerCase() === focusSymbol.trim().toLowerCase(),
      );
      const chosen = exact ?? symbolMatches[0];
      symbolId = chosen.symbolId;
      filePath = chosen.filePath;
    }

    if (!symbolId) {
      return res.json({
        nodes: [],
        edges: [],
        message: `No symbol found matching "${focusSymbol}". Try another name.`,
      });
    }

    // ── Step 2: Walk the symbol graph ────────────────────────────────────────
    const depth    = Math.min(Math.max(parseInt(String(maxDepth), 10) || 3, 1), 5);
    const rawGraph = await readBlastRadiusSymbolGraph(capabilityId, {
      symbolId,
      filePath,
      maxDepth: depth,
      maxNodes: 60,
    });

    if (!rawGraph || rawGraph.nodes.length === 0) {
      return res.json({
        nodes: [],
        edges: [],
        message: `Symbol "${focusSymbol}" was found but has no connected graph (no edges indexed yet).`,
      });
    }

    // ── Step 3: Shape response — include ALL structural fields in data ─────────
    const nodes = rawGraph.nodes.map(n => ({
      id:    n.symbolId,
      label: n.symbolName,
      type:  determineNodeType(n),
      data: {
        // Core identity
        filePath:          n.filePath,
        kind:              n.kind,
        signature:         n.signature,
        qualifiedName:     n.qualifiedSymbolName,
        language:          n.language,
        // Graph position
        isFocal:           n.relation === 'SEED',
        depth:             n.depth,
        relation:          n.relation,
        repositoryLabel:   n.repositoryLabel,
        // Structural (containment) — needed for AST panel
        containerSymbolId: n.containerSymbolId,
        parentSymbol:      n.parentSymbol,
        startLine:         n.startLine,
        endLine:           n.endLine,
        sliceStartLine:    n.sliceStartLine,
        sliceEndLine:      n.sliceEndLine,
      },
    }));

    const edges = rawGraph.edges.map(e => ({
      id:    `${e.fromSymbolId}-${e.toSymbolId}`,
      from:  e.fromSymbolId,
      to:    e.toSymbolId,
      label: (e.edgeKind as string) === 'CALLS' ? 'calls' : e.edgeKind.toLowerCase(),
      type:  rawGraph.seedSymbolIds.includes(e.fromSymbolId) ? 'ImpactEdge' : 'NormalEdge',
    }));

    return res.json({ nodes, edges, focusedSymbol: symbolMatches[0]?.symbolName });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal error building world model';
    console.error('[world-model] graph error:', error);
    return res.status(500).json({ error: msg });
  }
};

// ─── GET /world-model/ast-context/:symbolId ───────────────────────────────────

const getAstContext = async (req: Request, res: Response) => {
  try {
    const { capabilityId, symbolId } = req.params;
    if (!symbolId?.trim()) {
      return res.status(400).json({ error: 'symbolId is required' });
    }
    const context = await getSymbolAstContext(capabilityId, symbolId);
    return res.json(context);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal error fetching AST context';
    console.error('[world-model] ast-context error:', error);
    return res.status(500).json({ error: msg });
  }
};

// ─── Router registration ───────────────────────────────────────────────────────

export const registerWorldModelRoutes = (router: Router) => {
  router.get('/api/capabilities/:capabilityId/world-model/graph', getWorldModelGraph);
  router.get('/api/capabilities/:capabilityId/world-model/ast-context/:symbolId', getAstContext);
};
