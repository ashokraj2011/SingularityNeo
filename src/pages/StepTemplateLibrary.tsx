/**
 * StepTemplateLibrary.tsx
 *
 * Route: /studio/step-templates
 *
 * Workspace-wide config screen for managing step templates (HUMAN_TASK /
 * AGENT_TASK). Templates appear as palette groups in the Workflow Studio
 * so operators can build reusable, pre-configured human or agent steps.
 *
 * Two tabs:
 *   • General Steps  — HUMAN_TASK templates
 *   • Agent Steps    — AGENT_TASK templates
 *
 * Each tab has a table + "Add template" modal + Edit / Delete actions.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Cpu,
  Hand,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import { useCapability } from '../context/CapabilityContext';
import {
  EmptyState,
  ModalShell,
  PageHeader,
  SectionCard,
  StatusBadge,
} from '../components/EnterpriseUI';
import type { HumanTaskConfig, AgentTaskConfig, StepTemplate } from '../types';

// ── Types ────────────────────────────────────────────────────────────────────

type TabKey = 'general' | 'agent';

interface TemplateFormState {
  label: string;
  description: string;
  icon: string;
  // HUMAN_TASK fields
  instructions: string;
  checklist: string;
  requiresDocumentUpload: boolean;
  slaHours: string;
  assigneeRole: string;
  // AGENT_TASK fields
  agentRef: string;
  parametersJson: string;
  timeoutMinutes: string;
}

const DEFAULT_FORM: TemplateFormState = {
  label: '',
  description: '',
  icon: '',
  instructions: '',
  checklist: '',
  requiresDocumentUpload: false,
  slaHours: '',
  assigneeRole: '',
  agentRef: '',
  parametersJson: '{}',
  timeoutMinutes: '',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

function buildDefaultConfig(
  nodeType: 'HUMAN_TASK' | 'AGENT_TASK',
  form: TemplateFormState,
): HumanTaskConfig | AgentTaskConfig {
  if (nodeType === 'HUMAN_TASK') {
    const config: HumanTaskConfig = {
      kind: 'HUMAN_TASK',
      instructions: form.instructions || 'Complete the assigned task.',
    };
    const items = form.checklist.split('\n').map(s => s.trim()).filter(Boolean);
    if (items.length) config.checklist = items;
    if (form.requiresDocumentUpload) config.requiresDocumentUpload = true;
    if (form.slaHours) config.slaHours = Number(form.slaHours);
    if (form.assigneeRole) config.assigneeRole = form.assigneeRole;
    return config;
  }
  let parameters: Record<string, unknown> = {};
  try { parameters = JSON.parse(form.parametersJson || '{}'); } catch { /* ignore */ }
  const config: AgentTaskConfig = { kind: 'AGENT_TASK' };
  if (form.agentRef) config.agentRef = form.agentRef;
  if (Object.keys(parameters).length) config.parameters = parameters;
  if (form.timeoutMinutes) config.timeoutMinutes = Number(form.timeoutMinutes);
  return config;
}

function formFromTemplate(t: StepTemplate): TemplateFormState {
  const cfg = t.defaultConfig;
  if (cfg.kind === 'HUMAN_TASK') {
    return {
      ...DEFAULT_FORM,
      label: t.label,
      description: t.description ?? '',
      icon: t.icon ?? '',
      instructions: cfg.instructions ?? '',
      checklist: (cfg.checklist ?? []).join('\n'),
      requiresDocumentUpload: cfg.requiresDocumentUpload ?? false,
      slaHours: cfg.slaHours !== undefined ? String(cfg.slaHours) : '',
      assigneeRole: cfg.assigneeRole ?? '',
    };
  }
  return {
    ...DEFAULT_FORM,
    label: t.label,
    description: t.description ?? '',
    icon: t.icon ?? '',
    agentRef: cfg.agentRef ?? '',
    parametersJson: cfg.parameters ? JSON.stringify(cfg.parameters, null, 2) : '{}',
    timeoutMinutes: cfg.timeoutMinutes !== undefined ? String(cfg.timeoutMinutes) : '',
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function StepTemplateLibrary() {
  const { activeCapability } = useCapability();

  const [tab, setTab] = useState<TabKey>('general');
  const [templates, setTemplates] = useState<StepTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateFormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();

  // Deletion
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadTemplates = () => {
    setLoading(true);
    setError(undefined);
    apiFetch<StepTemplate[]>(
      `/api/step-templates?capabilityId=${encodeURIComponent(activeCapability.id)}&workspaceId=default`,
    )
      .then(setTemplates)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load templates.'))
      .finally(() => setLoading(false));
  };

  useEffect(loadTemplates, [activeCapability.id]);

  const generalTemplates = useMemo(() => templates.filter(t => t.nodeType === 'HUMAN_TASK'), [templates]);
  const agentTemplates = useMemo(() => templates.filter(t => t.nodeType === 'AGENT_TASK'), [templates]);

  const currentNodeType: 'HUMAN_TASK' | 'AGENT_TASK' = tab === 'general' ? 'HUMAN_TASK' : 'AGENT_TASK';

  const openCreate = () => {
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setSaveError(undefined);
    setIsModalOpen(true);
  };

  const openEdit = (t: StepTemplate) => {
    setEditingId(t.id);
    setForm(formFromTemplate(t));
    setSaveError(undefined);
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.label.trim()) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      const payload = {
        workspaceId: 'default',
        capabilityId: activeCapability.id,
        nodeType: currentNodeType,
        label: form.label.trim(),
        description: form.description.trim() || undefined,
        icon: form.icon.trim() || undefined,
        defaultConfig: buildDefaultConfig(currentNodeType, form),
      };
      if (editingId) {
        const updated = await apiFetch<StepTemplate>(`/api/step-templates/${encodeURIComponent(editingId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        setTemplates(prev => prev.map(t => t.id === editingId ? updated : t));
      } else {
        const created = await apiFetch<StepTemplate>('/api/step-templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        setTemplates(prev => [...prev, created]);
      }
      setIsModalOpen(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save template.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this step template? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      await apiFetch(`/api/step-templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setTemplates(prev => prev.filter(t => t.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete template.');
    } finally {
      setDeletingId(null);
    }
  };

  const TemplateTable = ({ rows }: { rows: StepTemplate[] }) => {
    if (loading) return <p className="py-8 text-center text-sm text-secondary">Loading…</p>;
    if (error) return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
    );
    if (rows.length === 0) return (
      <EmptyState
        icon={tab === 'general' ? Hand : Cpu}
        title={tab === 'general' ? 'No general steps yet' : 'No agent steps yet'}
        description={
          tab === 'general'
            ? 'Create human task templates that operators can drag onto any workflow canvas as pre-configured steps.'
            : 'Create agent task templates to pre-configure agent steps with agent ref, parameters, and timeout.'
        }
        action={
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-all hover:brightness-110"
          >
            <Plus size={16} />
            Add template
          </button>
        }
      />
    );

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-outline-variant/30 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
              <th className="py-3 pr-4">Label</th>
              <th className="py-3 pr-4">Description</th>
              {tab === 'general' && <th className="py-3 pr-4">SLA (hrs)</th>}
              {tab === 'general' && <th className="py-3 pr-4">Assignee role</th>}
              {tab === 'agent' && <th className="py-3 pr-4">Agent ref</th>}
              {tab === 'agent' && <th className="py-3 pr-4">Timeout (min)</th>}
              <th className="py-3 pr-4">Updated</th>
              <th className="py-3 pr-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(t => {
              const cfg = t.defaultConfig;
              return (
                <tr key={t.id} className="border-b border-outline-variant/15 align-top">
                  <td className="py-4 pr-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold text-on-surface">{t.label}</span>
                      <StatusBadge tone={t.nodeType === 'HUMAN_TASK' ? 'warning' : 'info'}>
                        {t.nodeType === 'HUMAN_TASK' ? 'Human Task' : 'Agent Task'}
                      </StatusBadge>
                    </div>
                  </td>
                  <td className="py-4 pr-4 text-xs text-secondary">{t.description || '—'}</td>
                  {tab === 'general' && (
                    <td className="py-4 pr-4 text-xs text-secondary">
                      {cfg.kind === 'HUMAN_TASK' ? (cfg.slaHours ?? '—') : '—'}
                    </td>
                  )}
                  {tab === 'general' && (
                    <td className="py-4 pr-4 text-xs text-secondary">
                      {cfg.kind === 'HUMAN_TASK' ? (cfg.assigneeRole || '—') : '—'}
                    </td>
                  )}
                  {tab === 'agent' && (
                    <td className="py-4 pr-4 font-mono text-xs text-secondary">
                      {cfg.kind === 'AGENT_TASK' ? (cfg.agentRef || '—') : '—'}
                    </td>
                  )}
                  {tab === 'agent' && (
                    <td className="py-4 pr-4 text-xs text-secondary">
                      {cfg.kind === 'AGENT_TASK' ? (cfg.timeoutMinutes ?? '—') : '—'}
                    </td>
                  )}
                  <td className="py-4 pr-4 text-xs text-outline">
                    {new Date(t.updatedAt).toLocaleDateString()}
                  </td>
                  <td className="py-4 pr-4 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(t)}
                        className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/30 px-2 py-1 text-xs font-semibold text-secondary transition-colors hover:border-primary/40 hover:text-primary"
                      >
                        <Pencil size={11} />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(t.id)}
                        disabled={deletingId === t.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                      >
                        <Trash2 size={11} />
                        {deletingId === t.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Configuration"
        context={activeCapability.id}
        title="Step Template Library"
        description="Manage reusable step templates for human tasks and agent tasks. Templates appear as configurable palette groups inside the Workflow Studio, making it easy for operators to drag pre-configured steps onto any workflow canvas."
        actions={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={loadTemplates}
              className="inline-flex items-center gap-2 rounded-2xl border border-outline-variant/40 bg-white px-3 py-2 text-sm font-semibold text-secondary transition-colors hover:text-on-surface"
            >
              <RefreshCcw size={14} />
              Refresh
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:brightness-110"
            >
              <Plus size={16} />
              Add template
            </button>
          </div>
        }
      />

      {/* Tab bar */}
      <div className="flex gap-2 rounded-2xl border border-outline-variant/20 bg-surface-container-low p-1">
        <button
          type="button"
          onClick={() => setTab('general')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-colors ${
            tab === 'general' ? 'bg-white text-primary shadow-sm' : 'text-secondary hover:text-on-surface'
          }`}
        >
          <Hand size={14} />
          General Steps
          <span className="rounded-full bg-outline-variant/20 px-1.5 py-0.5 text-[0.625rem] font-semibold">
            {generalTemplates.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setTab('agent')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-colors ${
            tab === 'agent' ? 'bg-white text-primary shadow-sm' : 'text-secondary hover:text-on-surface'
          }`}
        >
          <Cpu size={14} />
          Agent Steps
          <span className="rounded-full bg-outline-variant/20 px-1.5 py-0.5 text-[0.625rem] font-semibold">
            {agentTemplates.length}
          </span>
        </button>
      </div>

      {tab === 'general' && (
        <SectionCard
          title="General step templates (Human Tasks)"
          description="Human task templates for document uploads, checklists, form completions, verifications, and reviews. Dragging one onto the canvas pre-populates its instructions and SLA."
          icon={Hand}
          action={
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-2xl bg-primary/10 px-3 py-2 text-xs font-bold text-primary transition-colors hover:bg-primary/20"
            >
              <Plus size={13} />
              Add
            </button>
          }
        >
          <TemplateTable rows={generalTemplates} />
        </SectionCard>
      )}

      {tab === 'agent' && (
        <SectionCard
          title="Agent step templates"
          description="Agent task templates pre-configured with an agent reference, input parameters, and timeout. Let any workflow canvas operator add an agent step without knowing agent internals."
          icon={Cpu}
          action={
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-2xl bg-primary/10 px-3 py-2 text-xs font-bold text-primary transition-colors hover:bg-primary/20"
            >
              <Plus size={13} />
              Add
            </button>
          }
        >
          <TemplateTable rows={agentTemplates} />
        </SectionCard>
      )}

      {/* ── Create / Edit modal ────────────────────────────────────────────── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-slate-950/40 px-4 py-16 backdrop-blur-sm">
          <div className="w-full max-w-xl">
            <ModalShell
              eyebrow={currentNodeType === 'HUMAN_TASK' ? 'General Steps' : 'Agent Steps'}
              title={editingId ? 'Edit step template' : 'New step template'}
              description={
                currentNodeType === 'HUMAN_TASK'
                  ? 'Configure a reusable human task step. These fields pre-populate the node when dragged onto the canvas.'
                  : 'Configure a reusable agent task step. The agent ref and parameters pre-populate the node when dragged onto the canvas.'
              }
              actions={
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-full p-1.5 text-secondary transition-colors hover:bg-outline-variant/20 hover:text-on-surface"
                >
                  ✕
                </button>
              }
            >
              <form onSubmit={handleSave} className="space-y-5">
                {/* Common fields */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="form-kicker">Label *</span>
                    <input
                      required
                      value={form.label}
                      onChange={e => setForm(p => ({ ...p, label: e.target.value }))}
                      className="enterprise-input"
                      placeholder="e.g. Finance sign-off"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="form-kicker">Icon (Lucide name)</span>
                    <input
                      value={form.icon}
                      onChange={e => setForm(p => ({ ...p, icon: e.target.value }))}
                      className="enterprise-input"
                      placeholder="e.g. FileCheck"
                    />
                  </label>
                </div>
                <label className="space-y-1.5 block">
                  <span className="form-kicker">Description</span>
                  <textarea
                    value={form.description}
                    onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    className="enterprise-input min-h-[3.5rem]"
                    placeholder="Brief description shown in the palette tooltip"
                    rows={2}
                  />
                </label>

                {currentNodeType === 'HUMAN_TASK' && (
                  <>
                    <label className="space-y-1.5 block">
                      <span className="form-kicker">Instructions</span>
                      <textarea
                        value={form.instructions}
                        onChange={e => setForm(p => ({ ...p, instructions: e.target.value }))}
                        className="enterprise-input min-h-[5rem]"
                        placeholder="Step-by-step instructions for the human assignee…"
                        rows={3}
                      />
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="form-kicker">Checklist items (one per line)</span>
                      <textarea
                        value={form.checklist}
                        onChange={e => setForm(p => ({ ...p, checklist: e.target.value }))}
                        className="enterprise-input min-h-[4rem]"
                        placeholder="Review the attached invoice&#10;Verify vendor details&#10;Approve or reject"
                        rows={3}
                      />
                    </label>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="space-y-1.5">
                        <span className="form-kicker">SLA hours</span>
                        <input
                          type="number"
                          min={1}
                          value={form.slaHours}
                          onChange={e => setForm(p => ({ ...p, slaHours: e.target.value }))}
                          className="enterprise-input"
                          placeholder="24"
                        />
                      </label>
                      <label className="space-y-1.5">
                        <span className="form-kicker">Default assignee role</span>
                        <input
                          value={form.assigneeRole}
                          onChange={e => setForm(p => ({ ...p, assigneeRole: e.target.value }))}
                          className="enterprise-input"
                          placeholder="Finance Manager"
                        />
                      </label>
                    </div>
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={form.requiresDocumentUpload}
                        onChange={e => setForm(p => ({ ...p, requiresDocumentUpload: e.target.checked }))}
                        className="h-4 w-4 rounded"
                      />
                      <span className="text-sm font-semibold text-on-surface">
                        Requires document upload
                      </span>
                    </label>
                  </>
                )}

                {currentNodeType === 'AGENT_TASK' && (
                  <>
                    <label className="space-y-1.5 block">
                      <span className="form-kicker">Agent reference</span>
                      <input
                        value={form.agentRef}
                        onChange={e => setForm(p => ({ ...p, agentRef: e.target.value }))}
                        className="enterprise-input font-mono"
                        placeholder="my-agent-id or agent://namespace/id"
                      />
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="form-kicker">Default parameters (JSON)</span>
                      <textarea
                        value={form.parametersJson}
                        onChange={e => setForm(p => ({ ...p, parametersJson: e.target.value }))}
                        className="enterprise-input min-h-[6rem] font-mono text-xs"
                        rows={5}
                        spellCheck={false}
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="form-kicker">Timeout (minutes)</span>
                      <input
                        type="number"
                        min={1}
                        value={form.timeoutMinutes}
                        onChange={e => setForm(p => ({ ...p, timeoutMinutes: e.target.value }))}
                        className="enterprise-input"
                        placeholder="30"
                      />
                    </label>
                  </>
                )}

                {saveError && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    {saveError}
                  </div>
                )}

                <div className="flex justify-end gap-3 border-t border-outline-variant/20 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    disabled={saving}
                    className="rounded-2xl border border-outline-variant/40 px-4 py-2 text-sm font-semibold text-secondary transition-colors hover:border-outline-variant/80 hover:text-on-surface"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!form.label.trim() || saving}
                    className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-2 text-sm font-bold text-white shadow-sm transition-all hover:brightness-110 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create template'}
                  </button>
                </div>
              </form>
            </ModalShell>
          </div>
        </div>
      )}
    </div>
  );
}
