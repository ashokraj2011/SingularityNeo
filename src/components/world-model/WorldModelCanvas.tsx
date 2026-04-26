import React, { useEffect, useRef } from 'react';
import { Network } from 'vis-network';
import { DataSet } from 'vis-data';
import { EDGE_STYLES, NODE_TYPE_CONFIG, WORLD_MODEL_VIS_OPTIONS } from './visConfig';

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
  nodes: WorldModelNode[];
  edges: WorldModelEdge[];
  onNodeSelect: (node: WorldModelNode | null) => void;
  onNetworkReady?: (net: Network) => void;
}

// ─── SVG node image generator ─────────────────────────────────────────────────

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function makeNodeImage(
  type: string,
  name: string,
  isFocal: boolean,
): { uri: string; width: number; height: number } {
  const cfg = NODE_TYPE_CONFIG[type] ?? NODE_TYPE_CONFIG['CapabilityNode'];
  const W = isFocal ? 212 : 170;
  const H = isFocal ? 76 : 62;
  const MAX_CHARS = isFocal ? 23 : 18;
  const displayName = name.length > MAX_CHARS ? name.slice(0, MAX_CHARS - 1) + '…' : name;
  const borderW = isFocal ? 3 : 2;
  const circleR = isFocal ? 18 : 15;
  const cx = isFocal ? 28 : 24;
  const cy = H / 2;
  const textX = cx + circleR + 10;
  const typeY = cy - 8;
  const nameY = cy + 10;
  const nameFontSize = isFocal ? 14 : 13;
  const iconFontSize = isFocal ? 15 : 13;

  const glowDefs = isFocal
    ? `<defs><filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="2.5" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
       </filter></defs>`
    : '';

  const glowAttr = isFocal ? ' filter="url(#glow)"' : '';

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`,
    glowDefs,
    `<rect width="${W}" height="${H}" rx="9" fill="${cfg.bg}" stroke="${cfg.border}" stroke-width="${borderW}"${glowAttr}/>`,
    `<circle cx="${cx}" cy="${cy}" r="${circleR}" fill="${cfg.iconBg}" opacity="0.88"/>`,
    `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="${iconFontSize}" fill="white" font-family="sans-serif">${esc(cfg.icon)}</text>`,
    `<text x="${textX}" y="${typeY}" font-size="9" fill="${cfg.typeColor}" font-family="sans-serif" font-weight="600" letter-spacing="0.6">${esc(cfg.typeLabel)}</text>`,
    `<text x="${textX}" y="${nameY}" font-size="${nameFontSize}" fill="${cfg.nameColor}" font-family="sans-serif" font-weight="700">${esc(displayName)}</text>`,
    `</svg>`,
  ].join('');

  return { uri: `data:image/svg+xml,${encodeURIComponent(svg)}`, width: W, height: H };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WorldModelCanvas({ nodes, edges, onNodeSelect, onNetworkReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const netRef = useRef<Network | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Build vis DataSets
    const visNodes = new DataSet(
      nodes.map(n => {
        const isFocal = !!(n.data as Record<string, unknown>)?.isFocal;
        const { uri, width, height } = makeNodeImage(n.type, n.label, isFocal);
        const cfg = NODE_TYPE_CONFIG[n.type] ?? NODE_TYPE_CONFIG['CapabilityNode'];
        return {
          id: n.id,
          label: '',       // label baked into SVG image
          image: uri,
          width,
          height,
          borderWidth: isFocal ? 3 : 2,
          color: {
            border: cfg.border,
            highlight: { border: '#0ea5e9', background: 'transparent' },
            hover:     { border: cfg.iconBg, background: 'transparent' },
          },
          title: `${n.type.replace('Node', '')} · ${n.label}`,
          _rawNode: n,     // stash for retrieval on click
        };
      }),
    );

    const visEdges = new DataSet(
      edges.map(e => {
        const isImpact = e.type === 'ImpactEdge';
        const style = isImpact ? EDGE_STYLES.impact : (EDGE_STYLES[e.label] ?? EDGE_STYLES.default);
        return {
          id: e.id,
          from: e.from,
          to: e.to,
          label: e.label,
          color: { color: style.color, highlight: style.color, hover: style.color },
          dashes: style.dashes,
          width: style.width,
          arrows: { to: { enabled: true, scaleFactor: 0.55 } },
          selectionWidth: 0,
        };
      }),
    );

    const net = new Network(
      containerRef.current,
      { nodes: visNodes, edges: visEdges },
      WORLD_MODEL_VIS_OPTIONS,
    );
    netRef.current = net;
    if (onNetworkReady) onNetworkReady(net);

    net.on('stabilizationIterationsDone', () => {
      net.setOptions({ physics: { enabled: false } });
    });

    net.on('selectNode', params => {
      if (params.nodes.length > 0) {
        const id = params.nodes[0];
        const raw = nodes.find(n => n.id === id) ?? null;
        onNodeSelect(raw);
      }
    });

    net.on('deselectNode', () => onNodeSelect(null));

    return () => {
      net.destroy();
      netRef.current = null;
    };
  }, [nodes, edges, onNodeSelect, onNetworkReady]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage: 'radial-gradient(#e2e8f0 1.5px, transparent 0)',
        backgroundSize: '28px 28px',
      }}
    />
  );
}
