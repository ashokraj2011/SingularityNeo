// ─── Edge visual styles keyed by edge label ──────────────────────────────────

export interface EdgeStyle {
  color: string;
  dashes: boolean | number[];
  width: number;
}

export const EDGE_STYLES: Record<string, EdgeStyle> = {
  calls:       { color: '#475569', dashes: false,    width: 2   },
  contains:    { color: '#94a3b8', dashes: false,    width: 1.5 },
  reads:       { color: '#3b82f6', dashes: [6, 3],   width: 1.5 },
  writes:      { color: '#f59e0b', dashes: false,    width: 2   },
  tests:       { color: '#22c55e', dashes: [3, 3],   width: 2   },
  delivers:    { color: '#94a3b8', dashes: false,    width: 1.5 },
  triggers:    { color: '#8b5cf6', dashes: false,    width: 1.5 },
  'used by':   { color: '#6b7280', dashes: [2, 4],   width: 1.5 },
  implements:  { color: '#06b6d4', dashes: false,    width: 1.5 },
  extends:     { color: '#f97316', dashes: false,    width: 1.5 },
  imports:     { color: '#cbd5e1', dashes: [1, 3],   width: 1   },
  // Impact path override
  impact:      { color: '#ef4444', dashes: [8, 4],   width: 2.5 },
  // Fallback
  default:     { color: '#94a3b8', dashes: false,    width: 1.5 },
};

// ─── Node type visual config ─────────────────────────────────────────────────

export interface NodeTypeConfig {
  bg: string;
  border: string;
  iconBg: string;
  typeColor: string;
  nameColor: string;
  typeLabel: string;
  icon: string; // Unicode glyph — must be SVG-text-safe (no < > & unescaped)
}

export const NODE_TYPE_CONFIG: Record<string, NodeTypeConfig> = {
  CapabilityNode: {
    bg: '#f5f3ff', border: '#8b5cf6', iconBg: '#7c3aed',
    typeColor: '#6d28d9', nameColor: '#3b0764',
    typeLabel: 'CAPABILITY', icon: '⬡', // ⬡
  },
  ServiceNode: {
    bg: '#f0fdfa', border: '#14b8a6', iconBg: '#0d9488',
    typeColor: '#0d9488', nameColor: '#134e4a',
    typeLabel: 'SERVICE', icon: '⚙', // ⚙
  },
  RepoNode: {
    bg: '#eff6ff', border: '#3b82f6', iconBg: '#2563eb',
    typeColor: '#1d4ed8', nameColor: '#1e3a8a',
    typeLabel: 'REPO', icon: '▣', // ▣
  },
  MethodNode: {
    bg: '#fffbeb', border: '#f59e0b', iconBg: '#d97706',
    typeColor: '#b45309', nameColor: '#451a03',
    typeLabel: 'METHOD', icon: 'ƒ', // ƒ
  },
  ApiNode: {
    bg: '#ecfdf5', border: '#10b981', iconBg: '#059669',
    typeColor: '#047857', nameColor: '#064e3b',
    typeLabel: 'API', icon: '☁', // ☁
  },
  DataNode: {
    bg: '#eef2ff', border: '#6366f1', iconBg: '#4f46e5',
    typeColor: '#4338ca', nameColor: '#1e1b4b',
    typeLabel: 'DATA', icon: '⬢', // ⬢
  },
  TestNode: {
    bg: '#f0fdf4', border: '#22c55e', iconBg: '#16a34a',
    typeColor: '#15803d', nameColor: '#052e16',
    typeLabel: 'TEST', icon: '✓', // ✓
  },
};

// ─── Vis-network base options ────────────────────────────────────────────────

export const WORLD_MODEL_VIS_OPTIONS = {
  physics: {
    enabled: true,
    solver: 'forceAtlas2Based',
    forceAtlas2Based: {
      gravitationalConstant: -80,
      centralGravity: 0.015,
      springLength: 170,
      springConstant: 0.06,
      damping: 0.4,
    },
    stabilization: { iterations: 200, updateInterval: 25 },
  },
  nodes: {
    shape: 'image',
    shapeProperties: {
      useBorderWithImage: true,
      interpolation: false,
    },
    borderWidth: 2,
    borderWidthSelected: 4,
    color: {
      highlight: { border: '#0ea5e9', background: 'transparent' },
    },
  },
  edges: {
    arrows: { to: { enabled: true, scaleFactor: 0.55 } },
    smooth: { enabled: true, type: 'curvedCW', roundness: 0.15 },
    font: {
      size: 9,
      align: 'middle',
      background: 'rgba(255,255,255,0.85)',
      color: '#64748b',
    },
  },
  interaction: {
    hover: true,
    tooltipDelay: 150,
    navigationButtons: false,
    keyboard: false,
    multiselect: false,
  },
};
