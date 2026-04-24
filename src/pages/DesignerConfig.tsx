/**
 * DesignerConfig.tsx
 *
 * Route: /studio/designer-config
 *
 * Configuration screen for the Workflow Designer / Studio. Covers:
 *   1. Step type labels & descriptions — rename any node type for this capability
 *   2. Palette group visibility — hide/show palette sections
 *   3. Workflow defaults — require description, default phase, auto-layout
 *   4. Canvas preferences — grid, zoom, snap, node-ID display
 *   5. Custom metadata fields — define extra properties on every workflow
 *   6. Step naming conventions — prefix/suffix templates for auto-generated names
 *
 * All settings persist in localStorage under
 * `wf-designer-config-{capabilityId}` so they are per-capability and
 * survive page reloads without any backend changes.
 *
 * WorkflowStudio reads this config via `loadDesignerConfig(capabilityId)`.
 */
import React, { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Info,
  Plus,
  RefreshCcw,
  Save,
  Settings,
  Trash2,
  Type,
} from 'lucide-react';
import { useCapability } from '../context/CapabilityContext';
import {
  EmptyState,
  FormSection,
  PageHeader,
  SectionCard,
  StatusBadge,
} from '../components/EnterpriseUI';
import type { WorkflowNodeType } from '../types';

// ── Config shape ──────────────────────────────────────────────────────────────

export interface DesignerNodeLabelOverride {
  label: string;
  description: string;
}

export interface DesignerCustomMetadataField {
  id: string;
  name: string;
  fieldType: 'text' | 'number' | 'date' | 'boolean' | 'select';
  options?: string;   // CSV for select type
  required: boolean;
  defaultValue: string;
  placeholder: string;
  appliesTo: 'workflow' | 'node' | 'both';
}

export interface DesignerConfig {
  /** Per-node-type label/description overrides */
  nodeLabels: Partial<Record<WorkflowNodeType, DesignerNodeLabelOverride>>;
  /** Palette group titles mapped to their visibility */
  paletteGroupVisibility: Record<string, boolean>;
  /** Workflow-level creation defaults */
  workflowDefaults: {
    requireDescription: boolean;
    autoLayoutOnCreate: boolean;
    defaultPublishState: 'DRAFT' | 'VALIDATED';
    defaultStepPhase: string;
  };
  /** Canvas visual / interaction preferences */
  canvasPreferences: {
    snapToGrid: boolean;
    gridSize: 10 | 20 | 40;
    defaultZoom: number;
    showNodeIds: boolean;
    showMiniMap: boolean;
  };
  /** Custom metadata fields added to workflow/node properties */
  customMetadataFields: DesignerCustomMetadataField[];
  /** Auto-naming patterns for dropped nodes */
  namingConventions: {
    prefixByNodeType: Partial<Record<WorkflowNodeType, string>>;
    useTitleCase: boolean;
    includeIndex: boolean;
  };
}

export const DEFAULT_DESIGNER_CONFIG: DesignerConfig = {
  nodeLabels: {},
  paletteGroupVisibility: {
    Delivery: true,
    Routing: true,
    Controls: true,
    Signals: true,
    Compositions: true,
    'General Steps': true,
    'Agent Steps': true,
  },
  workflowDefaults: {
    requireDescription: false,
    autoLayoutOnCreate: false,
    defaultPublishState: 'DRAFT',
    defaultStepPhase: 'DEVELOPMENT',
  },
  canvasPreferences: {
    snapToGrid: false,
    gridSize: 20,
    defaultZoom: 1,
    showNodeIds: false,
    showMiniMap: true,
  },
  customMetadataFields: [],
  namingConventions: {
    prefixByNodeType: {},
    useTitleCase: true,
    includeIndex: true,
  },
};

// ── Persistence helpers ────────────────────────────────────────────────────────

const configKey = (capabilityId: string) =>
  `wf-designer-config-${capabilityId}`;

export const loadDesignerConfig = (capabilityId: string): DesignerConfig => {
  try {
    const raw = localStorage.getItem(configKey(capabilityId));
    if (!raw) return DEFAULT_DESIGNER_CONFIG;
    return { ...DEFAULT_DESIGNER_CONFIG, ...JSON.parse(raw) } as DesignerConfig;
  } catch {
    return DEFAULT_DESIGNER_CONFIG;
  }
};

export const saveDesignerConfig = (capabilityId: string, config: DesignerConfig): void => {
  try {
    localStorage.setItem(configKey(capabilityId), JSON.stringify(config));
  } catch { /* localStorage not available */ }
};

// ── Node type catalog ─────────────────────────────────────────────────────────

interface NodeTypeMeta {
  type: WorkflowNodeType;
  defaultLabel: string;
  defaultDescription: string;
  group: string;
}

const NODE_TYPE_CATALOG: NodeTypeMeta[] = [
  // Controls group
  { type: 'HUMAN_APPROVAL', defaultLabel: 'Human Approval', defaultDescription: 'Pause for human sign-off, clarification, or unblock.', group: 'Controls' },
  { type: 'HUMAN_TASK', defaultLabel: 'Human Task', defaultDescription: 'A human-owned task: upload documents, verify items, fill a form, or review a checklist.', group: 'Controls' },
  { type: 'GOVERNANCE_GATE', defaultLabel: 'Governance Gate', defaultDescription: 'Pause for risk, control, or compliance checks.', group: 'Controls' },
  // Delivery group
  { type: 'DELIVERY', defaultLabel: 'Delivery Step', defaultDescription: 'Agent-owned work inside a delivery phase.', group: 'Delivery' },
  { type: 'RELEASE', defaultLabel: 'Release Step', defaultDescription: 'Complete release or deployment work.', group: 'Delivery' },
  { type: 'AGENT_TASK', defaultLabel: 'Agent Task', defaultDescription: 'A configurable agent step with custom parameters and timeout.', group: 'Delivery' },
  // Routing group
  { type: 'DECISION', defaultLabel: 'Decision', defaultDescription: 'Route the work item based on review or execution outcome.', group: 'Routing' },
  { type: 'PARALLEL_SPLIT', defaultLabel: 'Parallel Split', defaultDescription: 'Send work to multiple agents or tracks in parallel.', group: 'Routing' },
  { type: 'PARALLEL_JOIN', defaultLabel: 'Parallel Join', defaultDescription: 'Wait for parallel tracks and consolidate evidence.', group: 'Routing' },
  // Signals group
  { type: 'EVENT', defaultLabel: 'Event', defaultDescription: 'Emit a workflow event or signal for downstream systems.', group: 'Signals' },
  { type: 'ALERT', defaultLabel: 'Alert', defaultDescription: 'Raise an operational alert with severity, routing, and acknowledgement rules.', group: 'Signals' },
  // Compositions group
  { type: 'SUB_WORKFLOW', defaultLabel: 'Sub-Workflow', defaultDescription: 'Embed and run an existing published workflow as a single composable step.', group: 'Compositions' },
  // Boundary
  { type: 'END', defaultLabel: 'End', defaultDescription: 'Close the workflow path and mark the run complete.', group: 'Controls' },
];

const PALETTE_GROUPS = ['Delivery', 'Routing', 'Controls', 'Signals', 'Compositions', 'General Steps', 'Agent Steps'];

// ── Sub-components ────────────────────────────────────────────────────────────

const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
  <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 transition hover:border-outline-variant/40">
    <span className="text-sm font-medium text-on-surface">{label}</span>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-outline-variant/40'}`}
    >
      <span
        className={`inline-block h-4 w-4 translate-x-0.5 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`}
      />
    </button>
  </label>
);

// ── Main component ────────────────────────────────────────────────────────────

export default function DesignerConfig() {
  const { activeCapability } = useCapability();
  const [config, setConfig] = useState<DesignerConfig>(() =>
    loadDesignerConfig(activeCapability.id),
  );
  const [saved, setSaved] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    Controls: true,
    Delivery: true,
    Routing: false,
    Signals: false,
    Compositions: false,
  });

  // Active section tab
  type Section = 'labels' | 'palette' | 'defaults' | 'canvas' | 'metadata' | 'naming';
  const [section, setSection] = useState<Section>('labels');

  // New metadata field form state
  const [newField, setNewField] = useState<Omit<DesignerCustomMetadataField, 'id'>>({
    name: '',
    fieldType: 'text',
    options: '',
    required: false,
    defaultValue: '',
    placeholder: '',
    appliesTo: 'workflow',
  });

  // Reload config if capability changes
  useEffect(() => {
    setConfig(loadDesignerConfig(activeCapability.id));
    setSaved(false);
  }, [activeCapability.id]);

  const handleSave = () => {
    saveDesignerConfig(activeCapability.id, config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = () => {
    if (!window.confirm('Reset all designer settings to defaults for this capability?')) return;
    setConfig(DEFAULT_DESIGNER_CONFIG);
    saveDesignerConfig(activeCapability.id, DEFAULT_DESIGNER_CONFIG);
    setSaved(false);
  };

  const updateNodeLabel = (type: WorkflowNodeType, field: 'label' | 'description', value: string) => {
    setConfig(prev => {
      const existing = prev.nodeLabels[type];
      const meta = NODE_TYPE_CATALOG.find(n => n.type === type)!;
      return {
        ...prev,
        nodeLabels: {
          ...prev.nodeLabels,
          [type]: {
            label: field === 'label' ? value : (existing?.label ?? meta.defaultLabel),
            description: field === 'description' ? value : (existing?.description ?? meta.defaultDescription),
          },
        },
      };
    });
  };

  const clearNodeLabelOverride = (type: WorkflowNodeType) => {
    setConfig(prev => {
      const next = { ...prev.nodeLabels };
      delete next[type];
      return { ...prev, nodeLabels: next };
    });
  };

  const addMetadataField = () => {
    if (!newField.name.trim()) return;
    const field: DesignerCustomMetadataField = {
      ...newField,
      id: `field-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: newField.name.trim(),
    };
    setConfig(prev => ({ ...prev, customMetadataFields: [...prev.customMetadataFields, field] }));
    setNewField({ name: '', fieldType: 'text', options: '', required: false, defaultValue: '', placeholder: '', appliesTo: 'workflow' });
  };

  const removeMetadataField = (id: string) => {
    setConfig(prev => ({ ...prev, customMetadataFields: prev.customMetadataFields.filter(f => f.id !== id) }));
  };

  const SECTIONS: Array<{ id: Section; label: string }> = [
    { id: 'labels', label: 'Step Labels' },
    { id: 'palette', label: 'Palette Groups' },
    { id: 'defaults', label: 'Workflow Defaults' },
    { id: 'canvas', label: 'Canvas' },
    { id: 'metadata', label: 'Metadata Fields' },
    { id: 'naming', label: 'Naming' },
  ];

  const nodesByGroup = NODE_TYPE_CATALOG.reduce<Record<string, NodeTypeMeta[]>>((acc, meta) => {
    if (!acc[meta.group]) acc[meta.group] = [];
    acc[meta.group].push(meta);
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Studio"
        context={activeCapability.id}
        title="Designer Configuration"
        description="Customise the Workflow Studio for this capability — rename step types to match your business language, configure canvas behaviour, control which palette groups are visible, and define custom metadata fields that appear on every workflow."
        actions={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-2 rounded-2xl border border-outline-variant/40 px-3 py-2 text-sm font-semibold text-secondary transition-colors hover:border-outline-variant/80 hover:text-on-surface"
            >
              <RefreshCcw size={14} />
              Reset defaults
            </button>
            <button
              type="button"
              onClick={handleSave}
              className={`inline-flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:brightness-110 ${saved ? 'bg-emerald-600' : 'bg-primary'}`}
            >
              {saved ? <Check size={15} /> : <Save size={15} />}
              {saved ? 'Saved!' : 'Save settings'}
            </button>
          </div>
        }
      />

      {/* Section nav */}
      <div className="flex flex-wrap gap-2 rounded-2xl border border-outline-variant/20 bg-surface-container-low p-1">
        {SECTIONS.map(s => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition-colors ${
              section === s.id ? 'bg-white text-primary shadow-sm' : 'text-secondary hover:text-on-surface'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* ── 1. Step Type Labels ──────────────────────────────────────────── */}
      {section === 'labels' && (
        <SectionCard
          title="Step type labels & descriptions"
          description="Override the default display name and description for each step type. These names appear in the palette, node headers, inspector panels, and the type dropdown. Leave blank to use the system default."
          icon={Type}
        >
          <div className="space-y-4">
            {Object.entries(nodesByGroup).map(([group, nodes]) => (
              <div key={group}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-xl bg-surface-container-low px-4 py-2.5 text-left text-sm font-bold text-on-surface transition hover:bg-outline-variant/10"
                  onClick={() => setExpandedGroups(p => ({ ...p, [group]: !p[group] }))}
                >
                  <span className="flex items-center gap-2">
                    <Settings size={13} className="text-outline" />
                    {group}
                    <span className="text-xs font-normal text-outline">({nodes.length} types)</span>
                  </span>
                  {expandedGroups[group] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>

                {expandedGroups[group] && (
                  <div className="mt-2 space-y-3 rounded-2xl border border-outline-variant/20 p-4">
                    {nodes.map(meta => {
                      const override = config.nodeLabels[meta.type];
                      const hasOverride = Boolean(override);
                      return (
                        <div key={meta.type} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                          <div className="space-y-1">
                            <label className="form-kicker flex items-center gap-1.5">
                              Label
                              {hasOverride && (
                                <StatusBadge tone="brand">custom</StatusBadge>
                              )}
                            </label>
                            <div className="flex items-center gap-1.5">
                              <input
                                placeholder={meta.defaultLabel}
                                value={override?.label ?? ''}
                                onChange={e => updateNodeLabel(meta.type, 'label', e.target.value)}
                                className="enterprise-input text-sm"
                              />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="form-kicker">Description</label>
                            <input
                              placeholder={meta.defaultDescription}
                              value={override?.description ?? ''}
                              onChange={e => updateNodeLabel(meta.type, 'description', e.target.value)}
                              className="enterprise-input text-sm"
                            />
                          </div>
                          <div className="flex items-end pb-0.5">
                            <button
                              type="button"
                              onClick={() => clearNodeLabelOverride(meta.type)}
                              disabled={!hasOverride}
                              title="Clear override — revert to system default"
                              className="rounded-lg border border-outline-variant/30 p-2 text-secondary transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-30"
                            >
                              <RefreshCcw size={13} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-2xl border border-info/20 bg-info/5 p-3 text-xs text-secondary">
            <Info size={13} className="mt-0.5 shrink-0 text-info" />
            <span>Changes take effect in the Studio after saving. Open a new tab or refresh to see updated labels in the palette and node inspector.</span>
          </div>
        </SectionCard>
      )}

      {/* ── 2. Palette Groups ────────────────────────────────────────────── */}
      {section === 'palette' && (
        <SectionCard
          title="Palette group visibility"
          description="Control which step groups appear in the designer's left palette. Hiding a group doesn't disable its node types — they remain accessible via the node type dropdown in any existing node."
          icon={GripVertical}
        >
          <div className="space-y-2">
            {PALETTE_GROUPS.map(group => (
              <Toggle
                key={group}
                label={group}
                checked={config.paletteGroupVisibility[group] ?? true}
                onChange={visible =>
                  setConfig(prev => ({
                    ...prev,
                    paletteGroupVisibility: { ...prev.paletteGroupVisibility, [group]: visible },
                  }))
                }
              />
            ))}
          </div>
          <p className="mt-4 text-xs text-secondary">
            "General Steps" and "Agent Steps" groups only appear when workspace step templates have been created in the{' '}
            <a href="/studio/step-templates" className="font-semibold text-primary hover:underline">Step Template Library</a>.
          </p>
        </SectionCard>
      )}

      {/* ── 3. Workflow Defaults ─────────────────────────────────────────── */}
      {section === 'defaults' && (
        <SectionCard
          title="Workflow creation defaults"
          description="Settings applied whenever a new workflow is created in this capability."
          icon={Settings}
        >
          <div className="space-y-3">
            <Toggle
              label="Require workflow description before saving"
              checked={config.workflowDefaults.requireDescription}
              onChange={v =>
                setConfig(prev => ({
                  ...prev,
                  workflowDefaults: { ...prev.workflowDefaults, requireDescription: v },
                }))
              }
            />
            <Toggle
              label="Auto-layout graph after workflow creation"
              checked={config.workflowDefaults.autoLayoutOnCreate}
              onChange={v =>
                setConfig(prev => ({
                  ...prev,
                  workflowDefaults: { ...prev.workflowDefaults, autoLayoutOnCreate: v },
                }))
              }
            />

            <div className="grid gap-4 pt-2 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="form-kicker">Default publish state for new workflows</span>
                <select
                  value={config.workflowDefaults.defaultPublishState}
                  onChange={e =>
                    setConfig(prev => ({
                      ...prev,
                      workflowDefaults: {
                        ...prev.workflowDefaults,
                        defaultPublishState: e.target.value as 'DRAFT' | 'VALIDATED',
                      },
                    }))
                  }
                  className="enterprise-input"
                >
                  <option value="DRAFT">Draft</option>
                  <option value="VALIDATED">Validated</option>
                </select>
              </label>

              <label className="space-y-1.5">
                <span className="form-kicker">Default phase for new nodes</span>
                <select
                  value={config.workflowDefaults.defaultStepPhase}
                  onChange={e =>
                    setConfig(prev => ({
                      ...prev,
                      workflowDefaults: { ...prev.workflowDefaults, defaultStepPhase: e.target.value },
                    }))
                  }
                  className="enterprise-input"
                >
                  {['ANALYSIS', 'DESIGN', 'DEVELOPMENT', 'QA', 'GOVERNANCE', 'RELEASE'].map(p => (
                    <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </SectionCard>
      )}

      {/* ── 4. Canvas Preferences ────────────────────────────────────────── */}
      {section === 'canvas' && (
        <SectionCard
          title="Canvas preferences"
          description="Visual and interaction settings for the workflow canvas."
          icon={Settings}
        >
          <div className="space-y-3">
            <Toggle
              label="Snap nodes to grid"
              checked={config.canvasPreferences.snapToGrid}
              onChange={v =>
                setConfig(prev => ({
                  ...prev,
                  canvasPreferences: { ...prev.canvasPreferences, snapToGrid: v },
                }))
              }
            />
            <Toggle
              label="Show node IDs on canvas"
              checked={config.canvasPreferences.showNodeIds}
              onChange={v =>
                setConfig(prev => ({
                  ...prev,
                  canvasPreferences: { ...prev.canvasPreferences, showNodeIds: v },
                }))
              }
            />
            <Toggle
              label="Show mini-map"
              checked={config.canvasPreferences.showMiniMap}
              onChange={v =>
                setConfig(prev => ({
                  ...prev,
                  canvasPreferences: { ...prev.canvasPreferences, showMiniMap: v },
                }))
              }
            />

            <div className="grid gap-4 pt-2 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="form-kicker">Grid size (px)</span>
                <select
                  value={config.canvasPreferences.gridSize}
                  onChange={e =>
                    setConfig(prev => ({
                      ...prev,
                      canvasPreferences: {
                        ...prev.canvasPreferences,
                        gridSize: Number(e.target.value) as 10 | 20 | 40,
                      },
                    }))
                  }
                  className="enterprise-input"
                >
                  <option value={10}>10 px — Fine</option>
                  <option value={20}>20 px — Standard</option>
                  <option value={40}>40 px — Coarse</option>
                </select>
              </label>

              <label className="space-y-1.5">
                <span className="form-kicker">
                  Default zoom ({Math.round(config.canvasPreferences.defaultZoom * 100)}%)
                </span>
                <input
                  type="range"
                  min={50}
                  max={150}
                  step={10}
                  value={Math.round(config.canvasPreferences.defaultZoom * 100)}
                  onChange={e =>
                    setConfig(prev => ({
                      ...prev,
                      canvasPreferences: {
                        ...prev.canvasPreferences,
                        defaultZoom: Number(e.target.value) / 100,
                      },
                    }))
                  }
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-[0.6875rem] text-outline">
                  <span>50%</span><span>100%</span><span>150%</span>
                </div>
              </label>
            </div>
          </div>
        </SectionCard>
      )}

      {/* ── 5. Custom Metadata Fields ─────────────────────────────────────── */}
      {section === 'metadata' && (
        <div className="space-y-6">
          <SectionCard
            title="Custom metadata fields"
            description="Define extra properties that appear in the workflow's Overview tab and optionally on individual nodes. Use these for business owner, compliance reference IDs, review dates, or any domain-specific attributes your team needs to track."
            icon={Plus}
          >
            {config.customMetadataFields.length === 0 ? (
              <EmptyState
                icon={Plus}
                title="No custom metadata fields"
                description="Add fields below to extend workflow and node metadata with your own properties."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-outline-variant/30 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                      <th className="py-3 pr-4">Field name</th>
                      <th className="py-3 pr-4">Type</th>
                      <th className="py-3 pr-4">Applies to</th>
                      <th className="py-3 pr-4">Required</th>
                      <th className="py-3 pr-4">Default</th>
                      <th className="py-3 pr-4 text-right">Remove</th>
                    </tr>
                  </thead>
                  <tbody>
                    {config.customMetadataFields.map(field => (
                      <tr key={field.id} className="border-b border-outline-variant/15 align-middle">
                        <td className="py-3 pr-4 font-semibold text-on-surface">{field.name}</td>
                        <td className="py-3 pr-4">
                          <StatusBadge tone="info">{field.fieldType}</StatusBadge>
                        </td>
                        <td className="py-3 pr-4 capitalize text-secondary">{field.appliesTo}</td>
                        <td className="py-3 pr-4">
                          {field.required ? (
                            <StatusBadge tone="warning">required</StatusBadge>
                          ) : (
                            <StatusBadge tone="neutral">optional</StatusBadge>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-xs text-secondary">{field.defaultValue || '—'}</td>
                        <td className="py-3 pr-4 text-right">
                          <button
                            type="button"
                            onClick={() => removeMetadataField(field.id)}
                            className="rounded-lg border border-red-200 p-1.5 text-red-600 transition-colors hover:bg-red-50"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Add a metadata field"
            description="Configure and add a new custom field. It will appear in the Overview section of the Advanced Node Details modal and on the workflow property panel."
            icon={Plus}
          >
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="form-kicker">Field name *</span>
                  <input
                    value={newField.name}
                    onChange={e => setNewField(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Business Owner"
                    className="enterprise-input"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="form-kicker">Field type</span>
                  <select
                    value={newField.fieldType}
                    onChange={e => setNewField(p => ({ ...p, fieldType: e.target.value as DesignerCustomMetadataField['fieldType'] }))}
                    className="enterprise-input"
                  >
                    <option value="text">Text (free-form)</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                    <option value="boolean">Boolean (checkbox)</option>
                    <option value="select">Select (dropdown)</option>
                  </select>
                </label>
              </div>

              {newField.fieldType === 'select' && (
                <label className="space-y-1.5 block">
                  <span className="form-kicker">Options (comma-separated)</span>
                  <input
                    value={newField.options}
                    onChange={e => setNewField(p => ({ ...p, options: e.target.value }))}
                    placeholder="Option A, Option B, Option C"
                    className="enterprise-input"
                  />
                </label>
              )}

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="space-y-1.5">
                  <span className="form-kicker">Applies to</span>
                  <select
                    value={newField.appliesTo}
                    onChange={e => setNewField(p => ({ ...p, appliesTo: e.target.value as 'workflow' | 'node' | 'both' }))}
                    className="enterprise-input"
                  >
                    <option value="workflow">Workflow only</option>
                    <option value="node">Nodes only</option>
                    <option value="both">Both</option>
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="form-kicker">Placeholder</span>
                  <input
                    value={newField.placeholder}
                    onChange={e => setNewField(p => ({ ...p, placeholder: e.target.value }))}
                    placeholder="e.g. owner@company.com"
                    className="enterprise-input"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="form-kicker">Default value</span>
                  <input
                    value={newField.defaultValue}
                    onChange={e => setNewField(p => ({ ...p, defaultValue: e.target.value }))}
                    className="enterprise-input"
                  />
                </label>
              </div>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={newField.required}
                  onChange={e => setNewField(p => ({ ...p, required: e.target.checked }))}
                  className="h-4 w-4 rounded"
                />
                <span className="text-sm font-semibold text-on-surface">Required field</span>
              </label>

              <button
                type="button"
                onClick={addMetadataField}
                disabled={!newField.name.trim()}
                className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:brightness-110 disabled:opacity-50"
              >
                <Plus size={15} />
                Add field
              </button>
            </div>
          </SectionCard>
        </div>
      )}

      {/* ── 6. Naming Conventions ────────────────────────────────────────── */}
      {section === 'naming' && (
        <SectionCard
          title="Step naming conventions"
          description="Configure how step names are auto-generated when a node is dropped onto the canvas. Prefixes help operators immediately understand what kind of step a node represents without opening the inspector."
          icon={Type}
        >
          <div className="space-y-4">
            <Toggle
              label="Use title case for auto-generated names"
              checked={config.namingConventions.useTitleCase}
              onChange={v =>
                setConfig(prev => ({
                  ...prev,
                  namingConventions: { ...prev.namingConventions, useTitleCase: v },
                }))
              }
            />
            <Toggle
              label="Append index number to auto-generated names (e.g. 'Review Task 2')"
              checked={config.namingConventions.includeIndex}
              onChange={v =>
                setConfig(prev => ({
                  ...prev,
                  namingConventions: { ...prev.namingConventions, includeIndex: v },
                }))
              }
            />

            <div className="mt-2 rounded-2xl border border-outline-variant/20 p-4">
              <p className="mb-3 text-sm font-semibold text-on-surface">Per-step-type prefix</p>
              <p className="mb-4 text-xs text-secondary">
                Add a prefix that will be prepended to the auto-generated name for each step type. Leave blank for no prefix.
                Example: prefix "BIZ-" on Human Approval → new nodes named "BIZ-Human Approval".
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {NODE_TYPE_CATALOG.filter(m => !['END'].includes(m.type)).map(meta => {
                  const override = config.nodeLabels[meta.type];
                  const displayLabel = override?.label || meta.defaultLabel;
                  return (
                    <label key={meta.type} className="space-y-1">
                      <span className="form-kicker truncate">{displayLabel}</span>
                      <input
                        value={config.namingConventions.prefixByNodeType[meta.type] ?? ''}
                        onChange={e =>
                          setConfig(prev => ({
                            ...prev,
                            namingConventions: {
                              ...prev.namingConventions,
                              prefixByNodeType: {
                                ...prev.namingConventions.prefixByNodeType,
                                [meta.type]: e.target.value,
                              },
                            },
                          }))
                        }
                        placeholder="No prefix"
                        className="enterprise-input text-sm"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Sticky save bar */}
      <div className="sticky bottom-4 z-10 flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          className={`inline-flex items-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold text-white shadow-lg transition-all hover:brightness-110 ${saved ? 'bg-emerald-600 shadow-emerald-200' : 'bg-primary shadow-primary/20'}`}
        >
          {saved ? <Check size={16} /> : <Save size={16} />}
          {saved ? 'Settings saved!' : 'Save settings'}
        </button>
      </div>
    </div>
  );
}
