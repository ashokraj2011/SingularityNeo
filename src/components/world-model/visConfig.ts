export const worldModelVisOptions = {
  layout: {
    hierarchical: {
      enabled: false, // Turn off strict hierarchical to allow organic shapes around focus
    },
  },
  physics: {
    enabled: true,
    solver: 'forceAtlas2Based',
    forceAtlas2Based: {
      gravitationalConstant: -50,
      centralGravity: 0.01,
      springLength: 100,
      springConstant: 0.08,
    },
    stabilization: {
      iterations: 150,
    },
  },
  nodes: {
    shape: 'box',
    margin: { top: 10, right: 10, bottom: 10, left: 10 },
    borderWidth: 2,
    shadow: {
      enabled: true,
      color: 'rgba(0,0,0,0.05)',
      size: 10,
      x: 0,
      y: 5
    },
    font: {
      size: 14,
      face: 'Inter, system-ui, sans-serif',
      multi: 'html' // Enables <b> tags in labels
    }
  },
  edges: {
    width: 2,
    smooth: {
      enabled: true,
      type: 'curvedCW',
      roundness: 0.2
    },
    font: {
      size: 10,
      align: 'middle',
      background: '#fff'
    }
  },
  groups: {
    CapabilityNode: {
      color: { background: '#f3e8ff', border: '#a855f7', highlight: { background: '#e9d5ff', border: '#9333ea' } },
      font: { color: '#6b21a8' },
      shapeProperties: { borderRadius: 8 }
    },
    RepoNode: {
      color: { background: '#e0f2fe', border: '#38bdf8', highlight: { background: '#bae6fd', border: '#0284c7' } },
      font: { color: '#0369a1' },
      shapeProperties: { borderRadius: 8 }
    },
    ServiceNode: {
      color: { background: '#ccfbf1', border: '#14b8a6', highlight: { background: '#99f6e4', border: '#0d9488' } },
      font: { color: '#0f766e' },
      shapeProperties: { borderRadius: 8 }
    },
    MethodNode: {
      color: { background: '#fff7ed', border: '#f97316', highlight: { background: '#ffedd5', border: '#ea580c' } },
      font: { color: '#c2410c' },
      borderWidth: 3,
      shadow: { color: 'rgba(249, 115, 22, 0.4)', size: 20 }, // Glowing Orange Focus
      shapeProperties: { borderRadius: 8 }
    },
    DataNode: {
      color: { background: '#e0e7ff', border: '#6366f1', highlight: { background: '#c7d2fe', border: '#4f46e5' } },
      font: { color: '#4338ca' },
      shapeProperties: { borderRadius: 4 }
    },
    TestNode: {
      color: { background: '#dcfce7', border: '#22c55e', highlight: { background: '#bbf7d0', border: '#16a34a' } },
      font: { color: '#15803d' },
      shapeProperties: { borderRadius: 8 }
    },
    ApiNode: {
      color: { background: '#fef2f2', border: '#ef4444' },
      font: { color: '#b91c1c' },
      shapeProperties: { borderDashes: [5, 5], borderRadius: 8 }
    }
  }
};
