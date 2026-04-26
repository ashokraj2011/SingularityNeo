import React, { useEffect, useRef } from 'react';
import { Network } from 'vis-network';
import { DataSet } from 'vis-data';
import { worldModelVisOptions } from './visConfig';

interface WorldModelNode {
  id: string;
  label: string;
  type: string;
  data: any;
}

interface WorldModelEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  type: 'ImpactEdge' | 'NormalEdge';
}

interface WorldModelCanvasProps {
  nodes: WorldModelNode[];
  edges: WorldModelEdge[];
  onNodeSelect: (node: WorldModelNode | null) => void;
}

export default function WorldModelCanvas({ nodes, edges, onNodeSelect }: WorldModelCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Convert API nodes to vis.js nodes
    const visNodes = new DataSet(nodes.map(n => ({
      id: n.id,
      label: `<b>${n.type.replace('Node', '')}</b>\n${n.label}`, // Bold prefix using vis HTML mode
      group: n.type,
      // Store the raw payload back so we can retrieve it on click
      _rawNode: n 
    })));

    // Convert API edges to vis.js edges
    const visEdges = new DataSet(edges.map(e => ({
      id: e.id,
      from: e.from,
      to: e.to,
      label: e.label,
      arrows: 'to',
      // Style impact edges with red dashed lines
      color: e.type === 'ImpactEdge' ? '#ef4444' : '#94a3b8',
      dashes: e.type === 'ImpactEdge' ? [5, 5] : false,
      width: e.type === 'ImpactEdge' ? 3 : 2
    })));

    const network = new Network(containerRef.current, { nodes: visNodes, edges: visEdges }, worldModelVisOptions);
    networkRef.current = network;

    // Turn off physics once settled so nodes stop jumping around
    network.on('stabilizationIterationsDone', () => {
      network.setOptions({ physics: { enabled: false } });
    });

    network.on('selectNode', (params) => {
      if (params.nodes.length > 0) {
        const selectedId = params.nodes[0];
        const fullNode = nodes.find(n => n.id === selectedId) || null;
        onNodeSelect(fullNode);
      } else {
        onNodeSelect(null);
      }
    });

    network.on('deselectNode', () => {
      onNodeSelect(null);
    });

    return () => {
      network.destroy();
    };
  }, [nodes, edges, onNodeSelect]);

  return (
    <div 
      ref={containerRef} 
      className="h-full w-full bg-slate-50 relative"
      style={{
        backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 0)',
        backgroundSize: '24px 24px'
      }}
    />
  );
}
