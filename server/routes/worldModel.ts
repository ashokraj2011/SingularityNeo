import { Request, Response, Router } from 'express';
import { readBlastRadiusSymbolGraph } from '../codeIndex/query';
import type { BlastRadiusSymbolGraphNode } from '../../src/types';

/**
 * Heuristics to assign semantic typed nodes from raw AST data.
 * Used for Vis.js Graph Rendering.
 */
const determineNodeType = (node: BlastRadiusSymbolGraphNode) => {
  const name = (node.symbolName || '').toLowerCase();
  const filePath = (node.filePath || '').toLowerCase();

  if (filePath.includes('.test.') || filePath.includes('.spec.')) {
    return 'TestNode';
  }
  
  if (
    filePath.includes('/api/') || 
    name.includes('client') || 
    name.includes('api') || 
    name.includes('fetch')
  ) {
    return 'ApiNode';
  }

  if (
    filePath.includes('service') || 
    name.includes('service') || 
    name.includes('manager') || 
    name.includes('provider')
  ) {
    return 'ServiceNode';
  }

  if (
    filePath.includes('repo') || 
    name.includes('repo') || 
    name.includes('store') || 
    name.includes('dao')
  ) {
    return 'RepoNode';
  }

  if (
    name.includes('context') || 
    name.includes('state') || 
    name.includes('model') || 
    name.includes('entity') || 
    node.kind === 'interface'
  ) {
    return 'DataNode';
  }

  if (['function', 'method'].includes(node.kind)) {
    return 'MethodNode';
  }

  return 'CapabilityNode';
};

const getWorldModelGraph = async (req: Request, res: Response) => {
  try {
    const { capabilityId } = req.params;
    const { focusSymbolId, maxDepth = '3' } = req.query;

    if (!focusSymbolId || typeof focusSymbolId !== 'string') {
      return res.status(400).json({ error: 'focusSymbolId string query required' });
    }

    const rawGraph = await readBlastRadiusSymbolGraph(capabilityId, {
      symbolId: focusSymbolId,
      maxDepth: parseInt(String(maxDepth), 10) || 3,
      maxNodes: 50,
    });

    if (!rawGraph || rawGraph.nodes.length === 0) {
      return res.json({ nodes: [], edges: [] });
    }

    const nodes = rawGraph.nodes.map((n) => {
      const type = determineNodeType(n);
      return {
        id: n.symbolId,
        label: n.symbolName,
        type, 
        data: {
          filePath: n.filePath,
          kind: n.kind,
          signature: n.signature,
          isFocal: n.relation === 'SEED',
          riskScore: 'High',
          isAiModified: Math.random() > 0.5,
          requiresApproval: Math.random() > 0.8
        }
      };
    });

    const edges = rawGraph.edges.map((e) => {
      const isImpact = rawGraph.seedSymbolIds.includes(e.fromSymbolId);
      return {
        id: `${e.fromSymbolId}-${e.toSymbolId}-${Math.random()}`,
        from: e.fromSymbolId,
        to: e.toSymbolId,
        label: (e.edgeKind as string) === 'CALLS' ? 'calls' : e.edgeKind.toLowerCase(),
        type: isImpact ? 'ImpactEdge' : 'NormalEdge',
      };
    });

    return res.json({ nodes, edges });
  } catch (error: any) {
    console.error('World Model API Error:', error);
    return res.status(500).json({ error: error.message || 'Internal error building world model' });
  }
};

export const registerWorldModelRoutes = (router: Router) => {
  router.get('/api/capabilities/:capabilityId/world-model/graph', getWorldModelGraph);
};
