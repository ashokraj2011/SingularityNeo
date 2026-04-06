import React, { useEffect, useMemo, useState, useTransition } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Bot,
  Building2,
  Database,
  FolderCode,
  GitBranch,
  Layers,
  Link2,
  Plus,
  Save,
  Trash2,
  Users,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCapability } from '../context/CapabilityContext';
import { cn } from '../lib/utils';
import {
  CapabilityDeploymentTarget,
  CapabilityExecutionCommandTemplate,
  CapabilityMetadataEntry,
  CapabilityStakeholder,
} from '../types';
import {
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from '../components/EnterpriseUI';

const listToText = (items: string[]) => items.join('\n');

const textToList = (value: string) =>
  value
    .split(/\n|,/)
    .map(item => item.trim())
    .filter(Boolean);

const formatJson = (value: unknown) => JSON.stringify(value, null, 2);

const parseJsonArray = <T,>(value: string, fallback: T[]): T[] => {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
};

const defaultStakeholderRoles = [
  'Development Manager',
  'Squad Leader',
  'Team Lead',
];

const createStakeholder = (role = 'Stakeholder'): CapabilityStakeholder => ({
  role,
  name: '',
  email: '',
  teamName: '',
});

const createMetadataEntry = (): CapabilityMetadataEntry => ({
  key: '',
  value: '',
});

const hasStakeholderContent = (stakeholder: CapabilityStakeholder) =>
  Boolean(
    stakeholder.name.trim() ||
      stakeholder.email.trim() ||
      stakeholder.teamName?.trim(),
  );

const hasMetadataEntryContent = (entry: CapabilityMetadataEntry) =>
  Boolean(entry.key.trim() || entry.value.trim());

const normalizeStakeholders = (stakeholders: CapabilityStakeholder[]) => {
  const existing = [...stakeholders];
  const normalized = defaultStakeholderRoles.map(role => {
    const matchIndex = existing.findIndex(
      stakeholder => stakeholder.role.trim().toLowerCase() === role.toLowerCase(),
    );

    if (matchIndex === -1) {
      return createStakeholder(role);
    }

    const [match] = existing.splice(matchIndex, 1);
    return {
      role,
      name: match.name || '',
      email: match.email || '',
      teamName: match.teamName || '',
    };
  });

  return [
    ...normalized,
    ...existing.filter(hasStakeholderContent).map(stakeholder => ({
      role: stakeholder.role || 'Stakeholder',
      name: stakeholder.name || '',
      email: stakeholder.email || '',
      teamName: stakeholder.teamName || '',
    })),
  ];
};

export default function CapabilityMetadata() {
  const navigate = useNavigate();
  const {
    activeCapability,
    capabilities,
    getCapabilityWorkspace,
    updateCapabilityMetadata,
  } = useCapability();
  const [isSaving, startTransition] = useTransition();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const ownerAgent = workspace.agents.find(agent => agent.isOwner) || workspace.agents[0];
  const siblingCapabilities = capabilities.filter(
    capability => capability.id !== activeCapability.id,
  );
  const parentCapability =
    capabilities.find(
      capability => capability.id === activeCapability.parentCapabilityId,
    ) || null;
  const subCapabilities = capabilities.filter(
    capability => capability.parentCapabilityId === activeCapability.id,
  );

  const [form, setForm] = useState({
    name: activeCapability.name,
    domain: activeCapability.domain || '',
    parentCapabilityId: activeCapability.parentCapabilityId || '',
    businessUnit: activeCapability.businessUnit || '',
    ownerTeam: activeCapability.ownerTeam || '',
    description: activeCapability.description,
    confluenceLink: activeCapability.confluenceLink || '',
    jiraBoardLink: activeCapability.jiraBoardLink || '',
    documentationNotes: activeCapability.documentationNotes || '',
    applications: listToText(activeCapability.applications),
    apis: listToText(activeCapability.apis),
    databases: listToText(activeCapability.databases),
    gitRepositories: listToText(activeCapability.gitRepositories),
    localDirectories: listToText(activeCapability.localDirectories),
    defaultWorkspacePath:
      activeCapability.executionConfig.defaultWorkspacePath || '',
    allowedWorkspacePaths: listToText(
      activeCapability.executionConfig.allowedWorkspacePaths,
    ),
    commandTemplates: formatJson(activeCapability.executionConfig.commandTemplates),
    deploymentTargets: formatJson(activeCapability.executionConfig.deploymentTargets),
    teamNames: listToText(activeCapability.teamNames),
    stakeholders: normalizeStakeholders(activeCapability.stakeholders),
    additionalMetadata:
      activeCapability.additionalMetadata.length > 0
        ? activeCapability.additionalMetadata
        : [createMetadataEntry()],
  });

  useEffect(() => {
    setForm({
      name: activeCapability.name,
      domain: activeCapability.domain || '',
      parentCapabilityId: activeCapability.parentCapabilityId || '',
      businessUnit: activeCapability.businessUnit || '',
      ownerTeam: activeCapability.ownerTeam || '',
      description: activeCapability.description,
      confluenceLink: activeCapability.confluenceLink || '',
      jiraBoardLink: activeCapability.jiraBoardLink || '',
      documentationNotes: activeCapability.documentationNotes || '',
      applications: listToText(activeCapability.applications),
      apis: listToText(activeCapability.apis),
      databases: listToText(activeCapability.databases),
      gitRepositories: listToText(activeCapability.gitRepositories),
      localDirectories: listToText(activeCapability.localDirectories),
      defaultWorkspacePath:
        activeCapability.executionConfig.defaultWorkspacePath || '',
      allowedWorkspacePaths: listToText(
        activeCapability.executionConfig.allowedWorkspacePaths,
      ),
      commandTemplates: formatJson(
        activeCapability.executionConfig.commandTemplates,
      ),
      deploymentTargets: formatJson(
        activeCapability.executionConfig.deploymentTargets,
      ),
      teamNames: listToText(activeCapability.teamNames),
      stakeholders: normalizeStakeholders(activeCapability.stakeholders),
      additionalMetadata:
        activeCapability.additionalMetadata.length > 0
          ? activeCapability.additionalMetadata
          : [createMetadataEntry()],
    });
  }, [activeCapability]);

  const canSave = Boolean(
    form.name.trim() &&
      form.domain.trim() &&
      form.businessUnit.trim() &&
      form.description.trim(),
  );

  const filteredStakeholders = useMemo(
    () => form.stakeholders.filter(hasStakeholderContent),
    [form.stakeholders],
  );
  const filteredMetadataEntries = useMemo(
    () => form.additionalMetadata.filter(hasMetadataEntryContent),
    [form.additionalMetadata],
  );
  const capabilityLifecycleLabel =
    activeCapability.status === 'ARCHIVED' ? 'Inactive' : 'Active';

  const metadataSummary = useMemo(
    () => [
      { label: 'Teams', value: textToList(form.teamNames).length },
      { label: 'Stakeholders', value: filteredStakeholders.length },
      { label: 'Git Repos', value: textToList(form.gitRepositories).length },
      { label: 'Local Dirs', value: textToList(form.localDirectories).length },
      { label: 'Sub-Capabilities', value: subCapabilities.length },
      { label: 'Team Agents', value: workspace.agents.length },
    ],
    [
      filteredStakeholders.length,
      form.gitRepositories,
      form.localDirectories,
      form.teamNames,
      subCapabilities.length,
      workspace.agents.length,
    ],
  );

  const setField = (field: keyof typeof form, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const updateStakeholder = (
    index: number,
    field: keyof CapabilityStakeholder,
    value: string,
  ) => {
    setForm(prev => ({
      ...prev,
      stakeholders: prev.stakeholders.map((stakeholder, stakeholderIndex) =>
        stakeholderIndex === index
          ? { ...stakeholder, [field]: value }
          : stakeholder,
      ),
    }));
  };

  const addStakeholder = () => {
    setForm(prev => ({
      ...prev,
      stakeholders: [...prev.stakeholders, createStakeholder()],
    }));
  };

  const removeStakeholder = (index: number) => {
    setForm(prev => ({
      ...prev,
      stakeholders: prev.stakeholders.filter(
        (_stakeholder, stakeholderIndex) => stakeholderIndex !== index,
      ),
    }));
  };

  const updateMetadataEntry = (
    index: number,
    field: keyof CapabilityMetadataEntry,
    value: string,
  ) => {
    setForm(prev => ({
      ...prev,
      additionalMetadata: prev.additionalMetadata.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry,
      ),
    }));
  };

  const addMetadataEntry = () => {
    setForm(prev => ({
      ...prev,
      additionalMetadata: [...prev.additionalMetadata, createMetadataEntry()],
    }));
  };

  const removeMetadataEntry = (index: number) => {
    setForm(prev => ({
      ...prev,
      additionalMetadata: prev.additionalMetadata.filter(
        (_entry, entryIndex) => entryIndex !== index,
      ),
    }));
  };

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) {
      return;
    }

    startTransition(() => {
      updateCapabilityMetadata(activeCapability.id, {
        name: form.name.trim(),
        domain: form.domain.trim(),
        parentCapabilityId: form.parentCapabilityId || undefined,
        businessUnit: form.businessUnit.trim(),
        ownerTeam: form.ownerTeam.trim() || undefined,
        description: form.description.trim(),
        confluenceLink: form.confluenceLink.trim() || undefined,
        jiraBoardLink: form.jiraBoardLink.trim() || undefined,
        documentationNotes: form.documentationNotes.trim() || undefined,
        applications: textToList(form.applications),
        apis: textToList(form.apis),
        databases: textToList(form.databases),
        gitRepositories: textToList(form.gitRepositories),
        localDirectories: textToList(form.localDirectories),
        executionConfig: {
          defaultWorkspacePath: form.defaultWorkspacePath.trim() || undefined,
          allowedWorkspacePaths: textToList(form.allowedWorkspacePaths),
          commandTemplates: parseJsonArray<CapabilityExecutionCommandTemplate>(
            form.commandTemplates,
            activeCapability.executionConfig.commandTemplates,
          ),
          deploymentTargets: parseJsonArray<CapabilityDeploymentTarget>(
            form.deploymentTargets,
            activeCapability.executionConfig.deploymentTargets,
          ),
        },
        teamNames: textToList(form.teamNames),
        stakeholders: filteredStakeholders,
        additionalMetadata: filteredMetadataEntries,
      });
    });
  };

  const handleStatusToggle = () => {
    const nextStatus = activeCapability.status === 'ARCHIVED' ? 'STABLE' : 'ARCHIVED';
    const confirmed = window.confirm(
      `${
        nextStatus === 'ARCHIVED' ? 'Make inactive' : 'Reactivate'
      } ${activeCapability.name}?`,
    );

    if (!confirmed) {
      return;
    }

    updateCapabilityMetadata(activeCapability.id, {
      status: nextStatus,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Capability Metadata"
        context={activeCapability.id}
        title={activeCapability.name}
        description="Configure the capability contract, hierarchy, leadership contacts, code repositories, execution boundaries, and inherited metadata for downstream teams and workflows."
        actions={
          <SectionCard
            title={ownerAgent?.name || 'Capability Owning Agent'}
            description="Team owner and default context anchor for this capability workspace."
            icon={Bot}
            tone="brand"
            className="min-w-[22rem] p-4"
            contentClassName="space-y-2"
          >
            <StatusBadge tone="brand">{ownerAgent?.id || 'Owner Agent'}</StatusBadge>
          </SectionCard>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {metadataSummary.map(item => (
          <StatTile
            key={item.label}
            label={item.label}
            value={item.value}
            tone="brand"
            className="xl:col-span-1"
          />
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <motion.form
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={handleSave}
          className="section-card"
        >
          <div className="grid gap-8">
            <section className="grid gap-5 md:grid-cols-2">
              <div className="md:col-span-2 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Layers size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-extrabold text-primary">
                    Core capability context
                  </h2>
                  <p className="text-sm text-secondary">
                    These values define the boundary and hierarchy for this
                    capability.
                  </p>
                </div>
              </div>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Capability name
                </span>
                <input
                  value={form.name}
                  onChange={event => setField('name', event.target.value)}
                  className="field-input"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Domain
                </span>
                <input
                  value={form.domain}
                  onChange={event => setField('domain', event.target.value)}
                  className="field-input"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Business unit
                </span>
                <input
                  value={form.businessUnit}
                  onChange={event => setField('businessUnit', event.target.value)}
                  className="field-input"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Parent capability
                </span>
                <select
                  value={form.parentCapabilityId}
                  onChange={event =>
                    setField('parentCapabilityId', event.target.value)
                  }
                  className="field-select"
                >
                  <option value="">Standalone capability</option>
                  {siblingCapabilities.map(capability => (
                    <option key={capability.id} value={capability.id}>
                      {capability.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Owner team
                </span>
                <input
                  value={form.ownerTeam}
                  onChange={event => setField('ownerTeam', event.target.value)}
                  placeholder="Capability Strategy Office"
                  className="field-input"
                />
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Description
                </span>
                <textarea
                  value={form.description}
                  onChange={event => setField('description', event.target.value)}
                  className="field-textarea h-28"
                />
              </label>
            </section>

            <section className="grid gap-5 md:grid-cols-2">
              <div className="md:col-span-2 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Link2 size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-extrabold text-primary">
                    Documentation and delivery links
                  </h2>
                  <p className="text-sm text-secondary">
                    Shared reference inputs for owner and team agents.
                  </p>
                </div>
              </div>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Confluence link
                </span>
                <input
                  value={form.confluenceLink}
                  onChange={event => setField('confluenceLink', event.target.value)}
                  placeholder="https://confluence.example.com/display/..."
                  className="field-input"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Jira board
                </span>
                <input
                  value={form.jiraBoardLink}
                  onChange={event => setField('jiraBoardLink', event.target.value)}
                  placeholder="https://jira.example.com/boards/..."
                  className="field-input"
                />
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Documentation notes
                </span>
                <textarea
                  value={form.documentationNotes}
                  onChange={event =>
                    setField('documentationNotes', event.target.value)
                  }
                  placeholder="Runbooks, architecture constraints, terminology, onboarding notes, governance rules."
                  className="field-textarea h-28"
                />
              </label>
            </section>

            <section className="grid gap-5 md:grid-cols-3">
              <div className="md:col-span-3 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Building2 size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-extrabold text-primary">
                    Platform and delivery footprint
                  </h2>
                  <p className="text-sm text-secondary">
                    Capture the systems, repositories, local code paths, and
                    delivery teams that belong to this capability.
                  </p>
                </div>
              </div>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Applications
                </span>
                <textarea
                  value={form.applications}
                  onChange={event => setField('applications', event.target.value)}
                  placeholder={'CoreLedger\nCustomerPortal'}
                  className="field-textarea h-32"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  APIs and services
                </span>
                <textarea
                  value={form.apis}
                  onChange={event => setField('apis', event.target.value)}
                  placeholder={'AccountAPI\nTransactionService'}
                  className="field-textarea h-32"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Databases
                </span>
                <textarea
                  value={form.databases}
                  onChange={event => setField('databases', event.target.value)}
                  placeholder={'Retail_DB_01\nUser_Auth_DB'}
                  className="field-textarea h-32"
                />
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Git repositories
                </span>
                <textarea
                  value={form.gitRepositories}
                  onChange={event =>
                    setField('gitRepositories', event.target.value)
                  }
                  placeholder={
                    'ssh://git.example.com/payments/payments-core.git\nssh://git.example.com/payments/payment-gateway.git'
                  }
                  className="field-textarea h-32"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Associated teams
                </span>
                <textarea
                  value={form.teamNames}
                  onChange={event => setField('teamNames', event.target.value)}
                  placeholder={'Core Banking Architecture\nRetail Platform Delivery'}
                  className="field-textarea h-32"
                />
              </label>

              <label className="space-y-2 md:col-span-3">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Local code directories
                </span>
                <textarea
                  value={form.localDirectories}
                  onChange={event =>
                    setField('localDirectories', event.target.value)
                  }
                  placeholder={
                    '/Users/ashokraj/Documents/payments-core\n/Users/ashokraj/Documents/payment-gateway'
                  }
                  className="field-textarea h-28"
                />
              </label>
            </section>

            <section className="grid gap-5 md:grid-cols-2">
              <div className="md:col-span-2 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <FolderCode size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-extrabold text-primary">
                    Execution policy
                  </h2>
                  <p className="text-sm text-secondary">
                    Backend execution uses these workspace limits, named command
                    templates, and deployment targets.
                  </p>
                </div>
              </div>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Default workspace path
                </span>
                <input
                  value={form.defaultWorkspacePath}
                  onChange={event =>
                    setField('defaultWorkspacePath', event.target.value)
                  }
                  placeholder="/Users/ashokraj/Documents/agentGoogle"
                  className="field-input"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Allowed workspace paths
                </span>
                <textarea
                  value={form.allowedWorkspacePaths}
                  onChange={event =>
                    setField('allowedWorkspacePaths', event.target.value)
                  }
                  placeholder={'/Users/ashokraj/Documents/agentGoogle\n/Users/ashokraj/Documents/other-repo'}
                  className="field-textarea h-28"
                />
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Command templates (JSON array)
                </span>
                <textarea
                  value={form.commandTemplates}
                  onChange={event => setField('commandTemplates', event.target.value)}
                  className="field-textarea h-48 font-mono text-xs"
                />
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Deployment targets (JSON array)
                </span>
                <textarea
                  value={form.deploymentTargets}
                  onChange={event =>
                    setField('deploymentTargets', event.target.value)
                  }
                  className="field-textarea h-40 font-mono text-xs"
                />
              </label>
            </section>

            <section className="grid gap-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Users size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-extrabold text-primary">
                      Leadership and stakeholders
                    </h2>
                    <p className="text-sm text-secondary">
                      Keep named contacts, team names, and email addresses for
                      this capability.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={addStakeholder}
                  className="inline-flex items-center gap-2 rounded-2xl border border-primary/15 bg-primary/5 px-4 py-2.5 text-sm font-bold text-primary transition-all hover:bg-primary/10"
                >
                  <Plus size={16} />
                  Add stakeholder
                </button>
              </div>

              <div className="space-y-3">
                {form.stakeholders.map((stakeholder, index) => {
                  const isDefaultRole = index < defaultStakeholderRoles.length;

                  return (
                    <div
                      key={`${stakeholder.role}-${index}`}
                      className="grid gap-3 rounded-3xl border border-outline-variant/15 bg-surface-container-low p-4 md:grid-cols-[1.1fr_1fr_1fr_auto]"
                    >
                      <input
                        value={stakeholder.role}
                        onChange={event =>
                          updateStakeholder(index, 'role', event.target.value)
                        }
                        placeholder="Role"
                        className="field-input bg-white"
                      />
                      <input
                        value={stakeholder.name}
                        onChange={event =>
                          updateStakeholder(index, 'name', event.target.value)
                        }
                        placeholder="Name"
                        className="field-input bg-white"
                      />
                      <input
                        value={stakeholder.email}
                        onChange={event =>
                          updateStakeholder(index, 'email', event.target.value)
                        }
                        placeholder="email@example.com"
                        className="field-input bg-white"
                      />
                      <div className="flex gap-2">
                        <input
                          value={stakeholder.teamName || ''}
                          onChange={event =>
                            updateStakeholder(
                              index,
                              'teamName',
                              event.target.value,
                            )
                          }
                          placeholder="Team name"
                          className="field-input min-w-0 flex-1 bg-white"
                        />
                        {!isDefaultRole && (
                          <button
                            type="button"
                            onClick={() => removeStakeholder(index)}
                            className="rounded-2xl border border-outline-variant/15 bg-white px-3 text-secondary transition-all hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="grid gap-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Database size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-extrabold text-primary">
                      Additional metadata
                    </h2>
                    <p className="text-sm text-secondary">
                      Free-form key/value pairs for anything else that should be
                      tracked at capability level.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={addMetadataEntry}
                  className="inline-flex items-center gap-2 rounded-2xl border border-primary/15 bg-primary/5 px-4 py-2.5 text-sm font-bold text-primary transition-all hover:bg-primary/10"
                >
                  <Plus size={16} />
                  Add key/value
                </button>
              </div>

              <div className="space-y-3">
                {form.additionalMetadata.map((entry, index) => (
                  <div
                    key={`${entry.key}-${index}`}
                    className="grid gap-3 rounded-3xl border border-outline-variant/15 bg-surface-container-low p-4 md:grid-cols-[1fr_1.2fr_auto]"
                  >
                    <input
                      value={entry.key}
                      onChange={event =>
                        updateMetadataEntry(index, 'key', event.target.value)
                      }
                      placeholder="Metadata key"
                      className="field-input bg-white"
                    />
                    <input
                      value={entry.value}
                      onChange={event =>
                        updateMetadataEntry(index, 'value', event.target.value)
                      }
                      placeholder="Metadata value"
                      className="field-input bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => removeMetadataEntry(index)}
                      className="rounded-2xl border border-outline-variant/15 bg-white px-3 text-secondary transition-all hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="mt-8 flex items-center justify-between border-t border-outline-variant/10 pt-6">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="rounded-2xl border border-outline-variant/15 px-4 py-2.5 text-sm font-bold text-secondary transition-all hover:bg-surface-container-low"
            >
              Back to dashboard
            </button>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={!canSave || isSaving}
                className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Save size={16} />
                {isSaving ? 'Saving...' : 'Save metadata'}
              </button>
              <button
                type="button"
                onClick={() => navigate('/team')}
                className="inline-flex items-center gap-2 rounded-2xl border border-primary/15 bg-primary/5 px-5 py-3 text-sm font-bold text-primary transition-all hover:bg-primary/10"
              >
                Team setup
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </motion.form>

        <aside className="space-y-4 xl:sticky xl:top-28 xl:self-start">
          <SectionCard
            title="Capability status"
            description="Use this to keep a capability active for day-to-day delivery or move it to an inactive state without deleting its history."
            tone={activeCapability.status === 'ARCHIVED' ? 'muted' : 'brand'}
          >
            <div className="flex items-center justify-between gap-3">
              <StatusBadge
                tone={activeCapability.status === 'ARCHIVED' ? 'warning' : 'success'}
              >
                {capabilityLifecycleLabel}
              </StatusBadge>
              <button
                type="button"
                onClick={handleStatusToggle}
                className={cn(
                  'enterprise-button',
                  activeCapability.status === 'ARCHIVED'
                    ? 'enterprise-button-brand-muted'
                    : 'enterprise-button-secondary',
                )}
              >
                {activeCapability.status === 'ARCHIVED'
                  ? 'Reactivate capability'
                  : 'Make inactive'}
              </button>
            </div>
          </SectionCard>

          <div className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
            <p className="text-[0.625rem] font-bold uppercase tracking-[0.25em] text-outline">
              Capability summary
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {metadataSummary.map(item => (
                <div
                  key={item.label}
                  className="rounded-2xl bg-surface-container-low p-4 text-center"
                >
                  <p className="text-2xl font-extrabold text-primary">
                    {item.value}
                  </p>
                  <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-secondary">
                    {item.label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <Layers size={16} className="text-primary" />
              <p className="text-sm font-bold text-on-surface">
                Capability hierarchy
              </p>
            </div>
            <div className="mt-4 space-y-4">
              <div>
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                  Parent capability
                </p>
                <p className="mt-2 text-sm font-medium text-on-surface">
                  {parentCapability?.name || 'Standalone capability'}
                </p>
              </div>
              <div>
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                  Sub-capabilities
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {subCapabilities.length > 0 ? (
                    subCapabilities.map(capability => (
                      <span
                        key={capability.id}
                        className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary"
                      >
                        {capability.name}
                      </span>
                    ))
                  ) : (
                    <p className="text-sm text-secondary">
                      No sub-capabilities are attached yet.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <GitBranch size={16} className="text-primary" />
              <p className="text-sm font-bold text-on-surface">Code context</p>
            </div>
            <div className="mt-4 space-y-4 text-sm text-secondary">
              <div className="rounded-2xl bg-surface-container-low p-4">
                <p className="font-bold text-on-surface">
                  {textToList(form.gitRepositories).length} repositories linked
                </p>
                <p className="mt-1">
                  Capability-owned repos should map to the systems and workflows
                  above.
                </p>
              </div>
              <div className="rounded-2xl bg-surface-container-low p-4">
                <div className="flex items-center gap-2">
                  <FolderCode size={16} className="text-primary" />
                  <p className="font-bold text-on-surface">
                    Local directories power branch work
                  </p>
                </div>
                <p className="mt-2">
                  The Studio view can inspect these directories and create Git
                  branches, but only for paths registered under this capability.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-primary/10 bg-primary p-6 text-white shadow-xl shadow-primary/10">
            <div className="flex items-center gap-2">
              <WorkflowIcon size={18} />
              <p className="text-sm font-bold">Next capability-owned spaces</p>
            </div>
            <div className="mt-4 space-y-3">
              <button
                onClick={() => navigate('/team')}
                className="flex w-full items-center justify-between rounded-2xl bg-white/10 px-4 py-3 text-left transition-all hover:bg-white/15"
              >
                <span className="text-sm font-bold">Build the team</span>
                <ArrowRight size={16} />
              </button>
              <button
                onClick={() => navigate('/chat')}
                className="flex w-full items-center justify-between rounded-2xl bg-white/10 px-4 py-3 text-left transition-all hover:bg-white/15"
              >
                <span className="text-sm font-bold">Open capability chat</span>
                <ArrowRight size={16} />
              </button>
              <button
                onClick={() => navigate('/studio')}
                className="flex w-full items-center justify-between rounded-2xl bg-white/10 px-4 py-3 text-left transition-all hover:bg-white/15"
              >
                <span className="text-sm font-bold">Inspect code workspaces</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
