import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Brain,
  CheckCircle2,
  Cpu,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SKILL_LIBRARY } from '../constants';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import { normalizeLearningUpdate, normalizeSkill } from '../lib/agentRuntime';
import { LearningUpdate, Skill } from '../types';
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from '../components/EnterpriseUI';

const createSkillId = (name: string) =>
  `SKL-${name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 18)}`;

const inferCategory = (value: string): Skill['category'] => {
  const normalized = value.toLowerCase();
  if (normalized.includes('security') || normalized.includes('vulnerability')) {
    return 'Security';
  }
  if (normalized.includes('compliance') || normalized.includes('audit') || normalized.includes('policy')) {
    return 'Compliance';
  }
  if (normalized.includes('autom') || normalized.includes('remediation') || normalized.includes('workflow')) {
    return 'Automation';
  }
  if (normalized.includes('data') || normalized.includes('schema') || normalized.includes('mapping')) {
    return 'Data';
  }
  return 'Analysis';
};

const buildLearningSkill = (update: LearningUpdate): Skill => {
  const normalizedUpdate = normalizeLearningUpdate(update);
  const source = (normalizedUpdate.skillUpdate || normalizedUpdate.insight).trim();
  const normalizedName = source
    .split(/[.!?]/)[0]
    .split(/\s+/)
    .slice(0, 5)
    .join(' ');

  const name = normalizedName.replace(/\b\w/g, char => char.toUpperCase()) || 'Learning Skill';

  return {
    id: createSkillId(name),
    name,
    description: normalizedUpdate.skillUpdate || normalizedUpdate.insight,
    category: inferCategory(
      `${normalizedUpdate.insight} ${normalizedUpdate.skillUpdate || ''}`,
    ),
    version: '1.0.0',
    contentMarkdown: `# ${name}\n\n${normalizedUpdate.skillUpdate || normalizedUpdate.insight}`,
    kind: 'LEARNING',
    origin: 'CAPABILITY',
  };
};

export default function SkillLibrary() {
  const navigate = useNavigate();
  const {
    activeCapability,
    getCapabilityWorkspace,
    addCapabilitySkill,
    removeCapabilitySkill,
  } = useCapability();
  const { success } = useToast();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const [draft, setDraft] = useState({
    name: '',
    description: '',
    contentMarkdown: '',
    category: 'Analysis' as Skill['category'],
    version: '1.0.0',
    kind: 'CUSTOM' as NonNullable<Skill['kind']>,
  });

  const capabilitySkills = useMemo(
    () => activeCapability.skillLibrary.map(skill => normalizeSkill(skill)),
    [activeCapability.skillLibrary],
  );
  const capabilitySkillIds = useMemo(
    () => new Set(capabilitySkills.map(skill => skill.id)),
    [capabilitySkills],
  );
  const sharedCatalog = useMemo(
    () => SKILL_LIBRARY.filter(skill => !capabilitySkillIds.has(skill.id)),
    [capabilitySkillIds],
  );
  const skillCoverage = useMemo(
    () =>
      capabilitySkills.map(skill => ({
        skill,
        attachedAgents: workspace.agents.filter(agent => agent.skillIds.includes(skill.id)),
      })),
    [capabilitySkills, workspace.agents],
  );
  const learningSuggestions = useMemo(
    () =>
      workspace.learningUpdates
        .map(update => ({
          update,
          skill: buildLearningSkill(update),
        }))
        .filter(({ skill }) => !capabilitySkillIds.has(skill.id)),
    [capabilitySkillIds, workspace.learningUpdates],
  );

  const totalSkillAttachments = workspace.agents.reduce(
    (count, agent) => count + agent.skillIds.length,
    0,
  );
  const canCreate = Boolean(draft.name.trim() && draft.description.trim());

  const setField = (field: keyof typeof draft, value: string) => {
    setDraft(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleCreateSkill = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreate) {
      return;
    }

    const skillName = draft.name.trim();
    addCapabilitySkill(activeCapability.id, {
      id: createSkillId(draft.name),
      name: skillName,
      description: draft.description.trim(),
      contentMarkdown:
        draft.contentMarkdown.trim() || `# ${skillName}\n\n${draft.description.trim()}`,
      category: draft.category,
      version: draft.version.trim() || '1.0.0',
      kind: draft.kind,
      origin: 'CAPABILITY',
    });
    success('Skill added', `${skillName} is now available in this capability.`);

    setDraft({
      name: '',
      description: '',
      contentMarkdown: '',
      category: 'Analysis',
      version: '1.0.0',
      kind: 'CUSTOM',
    });
  };

  const handleRemoveSkill = (skill: Skill) => {
    removeCapabilitySkill(activeCapability.id, skill.id);
    success('Skill removed', `${skill.name} was removed from this capability.`);
  };

  const handleAddCatalogSkill = (skill: Skill) => {
    addCapabilitySkill(activeCapability.id, skill);
    success('Skill added', `${skill.name} was added to ${activeCapability.name}.`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Skill Library"
        context={activeCapability.id}
        title={`${activeCapability.name} Skill Library`}
        description="Curate reusable skills for this capability, import from the shared catalog, and promote learning updates so agents keep improving inside the same context boundary."
        actions={
          <>
            <button
              onClick={() => navigate('/team')}
              className="enterprise-button enterprise-button-secondary"
            >
              <Cpu size={16} />
              Manage Agents
            </button>
            <button
              onClick={() => navigate('/tasks')}
              className="enterprise-button bg-primary text-on-primary hover:bg-primary/90"
            >
              <ArrowRight size={16} />
              View Execution Learning
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label="Capability Skills"    value={capabilitySkills.length}    icon={BookOpen}  tone="brand"    />
        <StatTile label="Shared Catalog"       value={sharedCatalog.length}       icon={Sparkles}  tone="info"     />
        <StatTile label="Agent Attachments"    value={totalSkillAttachments}      icon={Cpu}       tone="neutral"  />
        <StatTile label="Learning Suggestions" value={learningSuggestions.length} icon={Brain}     tone="success"  />
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-8">
          <SectionCard
            title="Capability Skill Library"
            description={`Skills explicitly curated for ${activeCapability.name}.`}
            icon={BookOpen}
            action={<StatusBadge tone="brand">{capabilitySkills.length} skills</StatusBadge>}
          >
            <div className="grid gap-4 md:grid-cols-2">
              {skillCoverage.map(({ skill, attachedAgents }) => (
                <article
                  key={skill.id}
                  className="rounded-3xl border border-outline-variant/15 bg-surface-container-low p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-on-surface">{skill.name}</p>
                      <p className="mt-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                        {skill.category} • {skill.kind || 'CUSTOM'} • {skill.origin || 'CAPABILITY'} • v{skill.version}
                      </p>
                    </div>
                    {skill.origin === 'CAPABILITY' ? (
                      <button
                        onClick={() => handleRemoveSkill(skill)}
                        className="rounded-full p-2 text-slate-400 transition-colors hover:bg-white hover:text-error"
                        aria-label={`Remove ${skill.name}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    ) : (
                      <span className="rounded-full bg-primary/5 px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-primary">
                        Shared default
                      </span>
                    )}
                  </div>

                  <p className="mt-4 text-sm leading-relaxed text-secondary">
                    {skill.description}
                  </p>
                  {skill.contentMarkdown?.trim() ? (
                    <pre className="mt-4 overflow-hidden rounded-2xl bg-slate-950/95 p-4 text-xs leading-6 text-slate-100">
                      {skill.contentMarkdown.slice(0, 500)}
                      {skill.contentMarkdown.length > 500 ? '\n…' : ''}
                    </pre>
                  ) : null}

                  <div className="mt-5 rounded-2xl bg-white p-4">
                    <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                      Attached Agents
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {attachedAgents.length > 0 ? (
                        attachedAgents.map(agent => (
                          <span
                            key={agent.id}
                            className="rounded-full bg-primary/5 px-3 py-1.5 text-xs font-bold text-primary"
                          >
                            {agent.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-secondary">
                          Not attached to any capability agent yet.
                        </span>
                      )}
                    </div>
                  </div>
                </article>
              ))}

              {capabilitySkills.length === 0 && (
                <div className="md:col-span-2 rounded-3xl border border-dashed border-outline-variant/20 bg-surface-container-low p-10 text-center">
                  <p className="text-lg font-bold text-primary">No capability-owned skills yet</p>
                  <p className="mt-2 text-sm text-secondary">
                    Add custom skills, import from the shared catalog, or promote
                    learning updates from execution into this capability library.
                  </p>
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Learning-Derived Skills"
            description="Convert execution learning into reusable skills for the capability team."
            icon={Brain}
          >
            <div className="space-y-4">
              {learningSuggestions.map(({ update, skill }) => (
                <div
                  key={update.id}
                  className="rounded-3xl border border-outline-variant/15 bg-surface-container-low p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-on-surface">{skill.name}</p>
                      <p className="mt-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                        Suggested from {update.agentId}
                      </p>
                    </div>
                    <button
                      onClick={() => handleAddCatalogSkill(skill)}
                      className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-[0.6875rem] font-bold text-white transition-all hover:brightness-110"
                    >
                      <Wand2 size={14} />
                      Apply
                    </button>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-secondary">
                    {skill.description}
                  </p>
                </div>
              ))}

              {learningSuggestions.length === 0 && (
                <EmptyState
                  title="No suggestions yet"
                  description="No unapplied learning-derived skill suggestions are waiting right now."
                />
              )}
            </div>
          </SectionCard>
        </div>

        <div className="space-y-8">
          <SectionCard
            title="Create Custom Skill"
            description="Add a capability-specific skill that only belongs to this workspace."
            icon={Plus}
          >
            <form onSubmit={handleCreateSkill} className="space-y-4">
              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                  Skill Name
                </span>
                <input
                  value={draft.name}
                  onChange={event => setField('name', event.target.value)}
                  placeholder="Settlement exception triage"
                  className="w-full rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                  Description
                </span>
                <textarea
                  value={draft.description}
                  onChange={event => setField('description', event.target.value)}
                  placeholder="What the skill does, what inputs it expects, and what outcomes it improves."
                  className="h-28 w-full rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                    Category
                  </span>
                  <select
                    value={draft.category}
                    onChange={event =>
                      setField('category', event.target.value as Skill['category'])
                    }
                    className="w-full rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
                  >
                    {['Analysis', 'Automation', 'Security', 'Compliance', 'Data'].map(category => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                    Version
                  </span>
                  <input
                    value={draft.version}
                    onChange={event => setField('version', event.target.value)}
                    className="w-full rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
                  />
                </label>
              </div>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                  Skill Content
                </span>
                <textarea
                  value={draft.contentMarkdown}
                  onChange={event => setField('contentMarkdown', event.target.value)}
                  placeholder="Detailed instructions, guardrails, output shape, and conflict handling for this skill."
                  className="h-44 w-full rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                  Skill Kind
                </span>
                <select
                  value={draft.kind}
                  onChange={event => setField('kind', event.target.value as NonNullable<Skill['kind']>)}
                  className="w-full rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
                >
                  {['CUSTOM', 'GENERAL', 'ROLE', 'LEARNING'].map(kind => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="submit"
                disabled={!canCreate}
                className="enterprise-button w-full justify-center bg-primary text-on-primary hover:bg-primary/90 disabled:opacity-40"
              >
                <Plus size={16} />
                Add to Capability Skill Library
              </button>
            </form>
          </SectionCard>

          <SectionCard
            title="Shared Skill Catalog"
            description="Import reusable shared skills into this capability when they fit."
            icon={Sparkles}
          >
            <div className="space-y-4">
              {sharedCatalog.map(skill => (
                <div
                  key={skill.id}
                  className="rounded-3xl border border-outline-variant/15 bg-surface-container-low p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-on-surface">{skill.name}</p>
                      <p className="mt-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                        {skill.category} • {skill.kind || 'CUSTOM'} • {skill.origin || 'FOUNDATION'} • v{skill.version}
                      </p>
                    </div>
                    <button
                      onClick={() => handleAddCatalogSkill(skill)}
                      className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-white px-3 py-1.5 text-[0.6875rem] font-bold text-primary transition-all hover:bg-primary/5"
                    >
                      <CheckCircle2 size={14} />
                      Import
                    </button>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-secondary">
                    {skill.description}
                  </p>
                  {skill.contentMarkdown?.trim() ? (
                    <pre className="mt-4 overflow-hidden rounded-2xl bg-slate-950/95 p-4 text-xs leading-6 text-slate-100">
                      {skill.contentMarkdown.slice(0, 360)}
                      {skill.contentMarkdown.length > 360 ? '\n…' : ''}
                    </pre>
                  ) : null}
                </div>
              ))}

              {sharedCatalog.length === 0 && (
                <EmptyState
                  title="All shared skills imported"
                  description="Every shared skill is already available inside this capability library."
                  icon={CheckCircle2}
                />
              )}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
