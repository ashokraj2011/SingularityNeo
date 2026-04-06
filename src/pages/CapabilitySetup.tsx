import React, { useMemo, useState, useTransition } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Briefcase,
  CheckCircle2,
  Layers,
  Link2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import { getDefaultExecutionConfig } from '../lib/executionConfig';
import { Capability } from '../types';

const slugify = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);

export default function CapabilitySetup() {
  const navigate = useNavigate();
  const { capabilities, createCapability } = useCapability();
  const { success } = useToast();
  const [isSaving, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: '',
    domain: '',
    parentCapabilityId: '',
    businessUnit: '',
    description: '',
    gitRepositories: '',
  });

  const ownerAgentId = useMemo(() => {
    const suffix = slugify(form.name || 'CAPABILITY');
    return `AGENT-${suffix}-OWNER`;
  }, [form.name]);

  const canCreate = Boolean(
    form.name.trim() &&
      form.domain.trim() &&
      form.businessUnit.trim() &&
      form.description.trim(),
  );

  const setField = (field: keyof typeof form, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleCreate = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreate) {
      return;
    }

    const capability: Capability = {
      id: `CAP-${Math.random().toString().slice(2, 5)}`,
      name: form.name.trim(),
      domain: form.domain.trim(),
      parentCapabilityId: form.parentCapabilityId || undefined,
      businessUnit: form.businessUnit.trim(),
      description: form.description.trim(),
      applications: [],
      apis: [],
      databases: [],
      gitRepositories: form.gitRepositories
        .split(/\n|,/)
        .map(item => item.trim())
        .filter(Boolean),
      localDirectories: [],
      teamNames: [],
      stakeholders: [],
      additionalMetadata: [],
      executionConfig: getDefaultExecutionConfig({
        localDirectories: [],
      }),
      status: 'PENDING',
      specialAgentId: ownerAgentId,
      skillLibrary: [],
    };

    startTransition(() => {
      createCapability(capability);
      success(
        'Capability created',
        `${capability.name} is ready for metadata and team setup.`,
      );
      navigate('/capabilities/metadata');
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-6">
        <div className="max-w-3xl">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 rounded-full border border-outline-variant/20 px-3 py-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-secondary transition-all hover:bg-white"
          >
            <ArrowLeft size={14} />
            Back
          </button>
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-primary">Create Capability</h1>
          <p className="mt-2 text-sm leading-relaxed text-secondary">
            Creating a capability now seeds a single team owner called the Capability Owning Agent. After this step, we configure metadata, build the team, and let every downstream chat, workflow, and artifact inherit this capability context.
          </p>
        </div>
        <div className="rounded-3xl border border-primary/10 bg-primary/5 p-5 shadow-sm">
          <p className="text-[0.625rem] font-bold uppercase tracking-[0.25em] text-primary">Auto-created owner</p>
          <div className="mt-4 flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-primary shadow-sm">
              <Bot size={20} />
            </div>
            <div>
              <p className="text-sm font-bold text-on-surface">Capability Owning Agent</p>
              <p className="mt-1 text-xs leading-relaxed text-secondary">
                Team owner for this capability. Other agents, chats, and learning stay scoped under this owner and its capability context.
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-2xl bg-white px-4 py-3">
            <p className="text-[0.625rem] font-bold uppercase tracking-[0.2em] text-outline">Owner agent id</p>
            <p className="mt-1 text-sm font-bold text-primary">{ownerAgentId}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <motion.form
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={handleCreate}
          className="rounded-[2rem] border border-outline-variant/15 bg-white p-8 shadow-sm"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Layers size={24} />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-primary">Capability root context</h2>
              <p className="text-sm text-secondary">Capture the minimum identity for the new capability. Richer metadata comes immediately after creation.</p>
            </div>
          </div>

          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">Capability name</span>
              <input
                value={form.name}
                onChange={event => setField('name', event.target.value)}
                placeholder="Payments Command Center"
                className="w-full rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm font-medium outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
              />
            </label>

            <label className="space-y-2">
              <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">Domain</span>
              <input
                value={form.domain}
                onChange={event => setField('domain', event.target.value)}
                placeholder="Payments"
                className="w-full rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm font-medium outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
              />
            </label>

            <label className="space-y-2">
              <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">Parent capability</span>
              <select
                value={form.parentCapabilityId}
                onChange={event => setField('parentCapabilityId', event.target.value)}
                className="w-full rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm font-medium outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
              >
                <option value="">Standalone capability</option>
                {capabilities.map(capability => (
                  <option key={capability.id} value={capability.id}>
                    {capability.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">Business unit</span>
              <input
                value={form.businessUnit}
                onChange={event => setField('businessUnit', event.target.value)}
                placeholder="Digital Platforms"
                className="w-full rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm font-medium outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
              />
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">Initial description</span>
              <textarea
                value={form.description}
                onChange={event => setField('description', event.target.value)}
                placeholder="Describe the business scope and why this capability exists. We will enrich the rest of the metadata on the next screen."
                className="h-28 w-full rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm leading-relaxed outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
              />
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">Git repositories</span>
              <textarea
                value={form.gitRepositories}
                onChange={event => setField('gitRepositories', event.target.value)}
                placeholder={'ssh://git.example.com/payments/payments-core.git\nssh://git.example.com/payments/payment-gateway.git'}
                className="h-28 w-full rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm leading-relaxed outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
              />
            </label>
          </div>

          <div className="mt-8 flex items-center justify-between border-t border-outline-variant/10 pt-6">
            <div className="flex items-center gap-3 text-xs text-secondary">
              <Link2 size={14} className="text-primary" />
              Metadata, team, and chat will be capability-owned after this step.
            </div>
            <button
              type="submit"
              disabled={!canCreate || isSaving}
              className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSaving ? 'Creating...' : 'Create capability'}
              <ArrowRight size={16} />
            </button>
          </div>
        </motion.form>

        <aside className="space-y-4">
          <div className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
            <p className="text-[0.625rem] font-bold uppercase tracking-[0.25em] text-outline">What happens next</p>
            <div className="mt-4 space-y-3">
              {[
                'Capability is created and switched into the active context.',
                'A single Capability Owning Agent is created as the team owner.',
                'The next screen is used to configure capability metadata.',
                'The Team screen is where additional agents are added.',
              ].map(item => (
                <div key={item} className="flex items-start gap-3 rounded-2xl bg-surface-container-low px-4 py-3">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-primary" />
                  <p className="text-sm leading-relaxed text-secondary">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-primary/10 bg-primary p-6 text-white shadow-xl shadow-primary/10">
            <div className="flex items-center gap-2">
              <Briefcase size={18} />
              <p className="text-sm font-bold">Capability-owned workspace</p>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-primary-fixed-dim">
              Switching capability now switches the active owner agent, team roster, metadata, and chat history together.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
