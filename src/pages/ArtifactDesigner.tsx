import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileText, 
  Plus, 
  Search, 
  Filter, 
  MoreVertical, 
  ChevronRight, 
  Cpu, 
  User, 
  ShieldCheck, 
  Layers, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  Compass, 
  Terminal,
  ArrowRight,
  Share2,
  Database,
  BookOpen,
  Settings2,
  Lock,
  History
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useCapability } from '../context/CapabilityContext';
import { Artifact } from '../types';

type ArtifactDraft = {
  name: string;
  type: string;
  version: string;
  description: string;
  connectedAgentId: string;
  template: string;
  documentationStatus: NonNullable<Artifact['documentationStatus']>;
  direction: NonNullable<Artifact['direction']>;
  governanceRules: string;
  decisions: string;
  changes: string;
  learningInsights: string;
};

const createArtifactId = () => `ART-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const splitDraftLines = (value: string) =>
  value
    .split(/\n|,/)
    .map(item => item.trim())
    .filter(Boolean);

const buildArtifactDraft = (artifact?: Artifact, fallbackAgentId = ''): ArtifactDraft => ({
  name: artifact?.name || '',
  type: artifact?.type || 'Technical',
  version: artifact?.version || 'v1.0.0',
  description: artifact?.description || '',
  connectedAgentId: artifact?.connectedAgentId || artifact?.agent || fallbackAgentId,
  template: artifact?.template || '',
  documentationStatus: artifact?.documentationStatus || 'PENDING',
  direction: artifact?.direction || 'OUTPUT',
  governanceRules: (artifact?.governanceRules || []).join('\n'),
  decisions: (artifact?.decisions || []).join('\n'),
  changes: (artifact?.changes || []).join('\n'),
  learningInsights: (artifact?.learningInsights || []).join('\n'),
});

const getCreatedLabel = () =>
  new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

const ArtifactDesigner = () => {
  const {
    activeCapability,
    getCapabilityWorkspace,
    setCapabilityWorkspaceContent,
    updateCapabilityAgent,
  } = useCapability();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'definition' | 'sections' | 'governance'>('definition');
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [artifactDraft, setArtifactDraft] = useState<ArtifactDraft>(() =>
    buildArtifactDraft(undefined, workspace.agents[0]?.id || ''),
  );

  const filteredArtifacts = useMemo(() => {
    return workspace.artifacts.filter(artifact =>
      artifact.name.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [workspace.artifacts, searchQuery]);

  const selectedArtifact = useMemo(() => {
    return filteredArtifacts.find(a => a.id === selectedArtifactId) || filteredArtifacts[0];
  }, [filteredArtifacts, selectedArtifactId]);

  useEffect(() => {
    if (isCreatingNew) {
      return;
    }

    if (!selectedArtifact && filteredArtifacts[0]) {
      setSelectedArtifactId(filteredArtifacts[0].id);
      return;
    }

    if (selectedArtifact && filteredArtifacts.some(artifact => artifact.id === selectedArtifact.id)) {
      return;
    }

    if (filteredArtifacts[0]) {
      setSelectedArtifactId(filteredArtifacts[0].id);
    }
  }, [filteredArtifacts, isCreatingNew, selectedArtifact]);

  useEffect(() => {
    if (!selectedArtifact || isCreatingNew) {
      return;
    }

    setArtifactDraft(buildArtifactDraft(selectedArtifact, workspace.agents[0]?.id || ''));
  }, [isCreatingNew, selectedArtifact, workspace.agents]);

  const handleCreateTemplate = () => {
    setIsCreatingNew(true);
    setSelectedArtifactId('');
    setArtifactDraft(buildArtifactDraft(undefined, workspace.agents[0]?.id || ''));
    setActiveTab('definition');
  };

  const handleSelectArtifact = (artifactId: string) => {
    setIsCreatingNew(false);
    setSelectedArtifactId(artifactId);
  };

  const handleSaveTemplate = () => {
    if (!artifactDraft.name.trim()) {
      return;
    }

    const producerAgent =
      workspace.agents.find(agent => agent.id === artifactDraft.connectedAgentId) || workspace.agents[0];
    const nextArtifact: Artifact = {
      id: isCreatingNew ? createArtifactId() : selectedArtifact?.id || createArtifactId(),
      name: artifactDraft.name.trim(),
      capabilityId: activeCapability.id,
      type: artifactDraft.type.trim(),
      version: artifactDraft.version.trim() || 'v1.0.0',
      agent: producerAgent?.name || artifactDraft.connectedAgentId || 'Capability Agent',
      created: isCreatingNew ? getCreatedLabel() : selectedArtifact?.created || getCreatedLabel(),
      template: artifactDraft.template.trim() || undefined,
      documentationStatus: artifactDraft.documentationStatus,
      description: artifactDraft.description.trim() || undefined,
      direction: artifactDraft.direction,
      connectedAgentId: artifactDraft.connectedAgentId || undefined,
      sourceWorkflowId: selectedArtifact?.sourceWorkflowId,
      decisions: splitDraftLines(artifactDraft.decisions),
      changes: splitDraftLines(artifactDraft.changes),
      learningInsights: splitDraftLines(artifactDraft.learningInsights),
      governanceRules: splitDraftLines(artifactDraft.governanceRules),
      isLearningArtifact: selectedArtifact?.isLearningArtifact,
      isMasterArtifact: selectedArtifact?.isMasterArtifact,
    };

    const nextArtifacts = isCreatingNew
      ? [...workspace.artifacts, nextArtifact]
      : workspace.artifacts.map(artifact =>
          artifact.id === selectedArtifact?.id ? nextArtifact : artifact,
        );

    const previousArtifact = isCreatingNew
      ? null
      : workspace.artifacts.find(artifact => artifact.id === selectedArtifact?.id) || null;
    const previousAgentId = previousArtifact?.connectedAgentId;
    if (previousAgentId) {
      const previousAgent = workspace.agents.find(agent => agent.id === previousAgentId);
      if (previousAgent) {
        updateCapabilityAgent(activeCapability.id, previousAgentId, {
          inputArtifacts: previousAgent.inputArtifacts.filter(
            artifactName => artifactName !== previousArtifact?.name,
          ),
          outputArtifacts: previousAgent.outputArtifacts.filter(
            artifactName => artifactName !== previousArtifact?.name,
          ),
        });
      }
    }

    if (producerAgent) {
      const inputArtifacts =
        artifactDraft.direction === 'INPUT'
          ? Array.from(new Set([...(producerAgent.inputArtifacts || []), nextArtifact.name]))
          : producerAgent.inputArtifacts.filter(artifactName => artifactName !== nextArtifact.name);
      const outputArtifacts =
        artifactDraft.direction === 'OUTPUT'
          ? Array.from(new Set([...(producerAgent.outputArtifacts || []), nextArtifact.name]))
          : producerAgent.outputArtifacts.filter(artifactName => artifactName !== nextArtifact.name);

      updateCapabilityAgent(activeCapability.id, producerAgent.id, {
        inputArtifacts,
        outputArtifacts,
      });
    }

    setCapabilityWorkspaceContent(activeCapability.id, {
      artifacts: nextArtifacts,
    });
    setIsCreatingNew(false);
    setSelectedArtifactId(nextArtifact.id);
  };

  if (!selectedArtifact && !isCreatingNew) {
    return (
      <div className="flex min-h-[calc(100vh-160px)] items-center justify-center rounded-[2rem] border border-dashed border-outline-variant/20 bg-white p-10 text-center">
        <div className="max-w-md space-y-3">
          <h2 className="text-xl font-extrabold text-primary">No artifacts available yet</h2>
          <p className="text-sm leading-relaxed text-secondary">
            Artifacts are governed through capability workflows and agent input/output contracts. Once a capability starts producing or receiving artifacts, they will appear here for review and editing.
          </p>
        </div>
      </div>
    );
  }

  const artifactPreview = selectedArtifact || {
    id: 'DRAFT',
    name: artifactDraft.name || 'New Artifact',
    capabilityId: activeCapability.id,
    type: artifactDraft.type,
    version: artifactDraft.version,
    agent: artifactDraft.connectedAgentId || 'Capability Agent',
    created: getCreatedLabel(),
  };

  return (
    <div className="flex flex-col h-[calc(100vh-160px)] gap-6">
      <header className="flex justify-between items-center">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[0.625rem] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded uppercase tracking-widest">Governance & Design</span>
            <span className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">{activeCapability.id}</span>
          </div>
          <h1 className="text-2xl font-extrabold text-on-surface tracking-tight">Artifact Template Designer</h1>
        </div>
        <div className="flex gap-3">
          <button className="px-4 py-2 bg-white border border-outline-variant/10 rounded-xl text-xs font-bold text-secondary hover:bg-surface-container-low transition-all flex items-center gap-2">
            <History size={14} />
            Version History
          </button>
        </div>
      </header>

      <div className="flex-1 flex gap-8 min-h-0">
        {/* Left Sidebar: Template Library */}
        <div className="w-80 flex flex-col gap-4">
          <div className="bg-white rounded-3xl border border-outline-variant/15 shadow-sm flex flex-col overflow-hidden">
            <div className="p-4 border-b border-outline-variant/10">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search templates..."
                  className="w-full bg-surface-container-low border border-outline-variant/10 rounded-xl pl-10 pr-4 py-2 text-xs focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
              {filteredArtifacts.map((art) => (
                <button 
                  key={art.id} 
                  onClick={() => handleSelectArtifact(art.id)}
                  className={cn(
                    "w-full text-left p-3 rounded-xl transition-all group flex flex-col gap-1 border",
                    !isCreatingNew && selectedArtifactId === art.id
                      ? "bg-primary/5 border-primary/20 shadow-sm" 
                      : "bg-transparent border-transparent hover:bg-surface-container-low"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText size={14} className={!isCreatingNew && selectedArtifactId === art.id ? "text-primary" : "text-slate-400"} />
                      <span className={cn(
                        "text-xs font-bold transition-colors",
                        !isCreatingNew && selectedArtifactId === art.id ? "text-primary" : "text-on-surface"
                      )}>
                        {art.name}
                      </span>
                    </div>
                    {art.isMasterArtifact && (
                      <span className="text-[0.5rem] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded uppercase tracking-widest">Master</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between pl-6">
                    <span className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">{art.type}</span>
                    <span className="text-[0.625rem] text-slate-300">{art.version}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="p-6 bg-primary/5 rounded-3xl border border-primary/10">
            <h4 className="text-[0.625rem] font-bold text-primary uppercase tracking-widest mb-2">Design Tip</h4>
            <p className="text-[0.6875rem] text-secondary leading-relaxed">
              Artifacts are the "contracts" between agents. Ensure your templates include all necessary context for the next agent in the sequence to succeed.
            </p>
          </div>
        </div>

        {/* Main Canvas: Designer */}
        <div className="flex-1 flex flex-col bg-white rounded-3xl border border-outline-variant/15 shadow-sm overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-outline-variant/10 px-6">
            {(['definition', 'sections', 'governance'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "px-6 py-4 text-xs font-bold uppercase tracking-widest transition-all border-b-2",
                  activeTab === tab 
                    ? "text-primary border-primary" 
                    : "text-secondary border-transparent hover:text-primary"
                )}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
            <AnimatePresence mode="wait">
              {activeTab === 'definition' && (
                <motion.div
                  key="definition"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-8"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary border border-primary/10 shadow-sm">
                        <FileText size={32} />
                      </div>
                      <div>
                        <h2 className="text-xl font-extrabold text-on-surface tracking-tight">{artifactPreview.name}</h2>
                        <p className="text-sm text-secondary font-medium">Core template metadata and agent contracts.</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button className="p-2 bg-surface-container-low rounded-lg text-secondary hover:text-primary transition-all">
                        <Share2 size={18} />
                      </button>
                      <button className="p-2 bg-surface-container-low rounded-lg text-secondary hover:text-primary transition-all">
                        <Settings2 size={18} />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-6">
                    <div className="space-y-2">
                      <label className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">Template Name</label>
                      <input 
                        type="text" 
                        value={artifactDraft.name}
                        onChange={event => setArtifactDraft(prev => ({ ...prev, name: event.target.value }))}
                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">Category</label>
                      <select
                        value={artifactDraft.type}
                        onChange={event => setArtifactDraft(prev => ({ ...prev, type: event.target.value }))}
                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-primary/20 outline-none transition-all appearance-none"
                      >
                        <option>Technical</option>
                        <option>Business</option>
                        <option>Security</option>
                        <option>Governance</option>
                        <option>Data</option>
                        <option>Analysis</option>
                        <option>Compliance</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">Version</label>
                      <input 
                        type="text" 
                        value={artifactDraft.version}
                        onChange={event => setArtifactDraft(prev => ({ ...prev, version: event.target.value }))}
                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">Description</label>
                    <textarea 
                      value={artifactDraft.description}
                      onChange={event => setArtifactDraft(prev => ({ ...prev, description: event.target.value }))}
                      placeholder={artifactPreview.isMasterArtifact 
                        ? "Consolidated governance record documenting all strategic decisions, system changes, and agent learning insights across the delivery lifecycle."
                        : `Standardized artifact for ${artifactPreview.name} generated during the ${artifactPreview.type} phase.`}
                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl px-4 py-3 text-sm text-secondary leading-relaxed h-24 resize-none focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-6">
                    <div className="space-y-2">
                      <label className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">Template Key</label>
                      <input
                        type="text"
                        value={artifactDraft.template}
                        onChange={event => setArtifactDraft(prev => ({ ...prev, template: event.target.value }))}
                        placeholder="e.g. API_CONTRACT_V1"
                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">Direction</label>
                      <select
                        value={artifactDraft.direction}
                        onChange={event =>
                          setArtifactDraft(prev => ({
                            ...prev,
                            direction: event.target.value as NonNullable<Artifact['direction']>,
                          }))
                        }
                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-primary/20 outline-none transition-all appearance-none"
                      >
                        <option value="INPUT">INPUT</option>
                        <option value="OUTPUT">OUTPUT</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">Documentation Status</label>
                      <select
                        value={artifactDraft.documentationStatus}
                        onChange={event =>
                          setArtifactDraft(prev => ({
                            ...prev,
                            documentationStatus: event.target.value as NonNullable<Artifact['documentationStatus']>,
                          }))
                        }
                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-primary/20 outline-none transition-all appearance-none"
                      >
                        <option value="PENDING">PENDING</option>
                        <option value="SYNCED">SYNCED</option>
                        <option value="FAILED">FAILED</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-8">
                    <section className="space-y-4">
                      <h3 className="text-sm font-bold text-on-surface flex items-center gap-2 uppercase tracking-widest">
                        <Cpu size={16} className="text-primary" />
                        Producers (Agents)
                      </h3>
                      <div className="p-4 bg-surface-container-low rounded-2xl border border-outline-variant/10 space-y-3">
                        <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-outline-variant/5">
                          <div className="flex items-center gap-2">
                            <Cpu size={14} className="text-primary" />
                            <span className="text-xs font-bold">
                              {workspace.agents.find(agent => agent.id === artifactDraft.connectedAgentId)?.name ||
                                artifactDraft.connectedAgentId ||
                                artifactPreview.agent}
                            </span>
                          </div>
                          <span className="text-[0.5rem] font-bold text-success uppercase tracking-widest">Primary</span>
                        </div>
                        <select
                          value={artifactDraft.connectedAgentId}
                          onChange={event =>
                            setArtifactDraft(prev => ({
                              ...prev,
                              connectedAgentId: event.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-dashed border-outline-variant/30 bg-white px-3 py-2 text-[0.625rem] font-bold text-slate-500 outline-none transition-all focus:ring-2 focus:ring-primary/20"
                        >
                          {workspace.agents.map(agent => (
                            <option key={agent.id} value={agent.id}>
                              {agent.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </section>

                    <section className="space-y-4">
                      <h3 className="text-sm font-bold text-on-surface flex items-center gap-2 uppercase tracking-widest">
                        <User size={16} className="text-secondary" />
                        Consumers (Stakeholders)
                      </h3>
                      <div className="p-4 bg-surface-container-low rounded-2xl border border-outline-variant/10 space-y-2">
                        {['Governance Board', 'Audit Team', 'Master Agent'].map(consumer => (
                          <div key={consumer} className="flex items-center justify-between p-2 bg-white rounded-lg border border-outline-variant/5">
                            <span className="text-xs font-bold text-secondary">{consumer}</span>
                            <X size={12} className="text-slate-300 cursor-pointer hover:text-error" />
                          </div>
                        ))}
                        <button className="w-full py-2 border border-dashed border-outline-variant/30 rounded-lg text-[0.625rem] font-bold text-slate-400 hover:text-primary hover:border-primary/30 transition-all">
                          + Add Consumer
                        </button>
                      </div>
                    </section>
                  </div>
                </motion.div>
              )}

              {activeTab === 'sections' && (
                <motion.div
                  key="sections"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-6"
                >
                  <div className="flex justify-between items-center mb-6">
                    <div>
                      <h2 className="text-xl font-extrabold text-on-surface tracking-tight">Artifact Structure</h2>
                      <p className="text-sm text-secondary font-medium">Define the data blocks and validation rules for this artifact.</p>
                    </div>
                    <button className="px-4 py-2 bg-primary text-white text-xs font-bold rounded-xl flex items-center gap-2">
                      <Plus size={14} /> Add Section
                    </button>
                  </div>

                  <div className="space-y-3">
                    {[
                      { title: 'Title & Status', type: 'Free Text', req: true, icon: FileText },
                      { title: 'Context & Rationale', type: 'Free Text', req: true, icon: Compass },
                      { title: 'Strategic Decisions', type: 'Decision Box', req: true, icon: ShieldCheck, data: splitDraftLines(artifactDraft.decisions) },
                      { title: 'System Changes', type: 'Change Log', req: true, icon: History, data: splitDraftLines(artifactDraft.changes) },
                      { title: 'Agent Learning Insights', type: 'Learning Record', req: false, icon: Sparkles, data: splitDraftLines(artifactDraft.learningInsights) },
                    ].map((section, i) => (
                      <div key={i} className="flex items-center gap-4 p-4 bg-surface-container-low rounded-2xl border border-outline-variant/5 group hover:border-primary/20 transition-all">
                        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-outline group-hover:text-primary transition-colors shadow-sm">
                          <section.icon size={20} />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="text-sm font-bold text-on-surface">{section.title}</p>
                            {section.req && <span className="text-[0.5rem] font-bold text-primary uppercase tracking-widest bg-primary/5 px-1.5 py-0.5 rounded border border-primary/10">Required</span>}
                          </div>
                          <p className="text-[0.625rem] text-secondary font-medium uppercase tracking-tighter">{section.type}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button className="p-2 text-slate-300 hover:text-primary transition-colors">
                            <Settings2 size={16} />
                          </button>
                          <button className="p-2 text-slate-300 hover:text-error transition-colors">
                            <X size={16} />
                          </button>
                          <div className="p-2 text-slate-300 cursor-grab active:cursor-grabbing">
                            <MoreVertical size={16} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-4 pt-4">
                    <textarea
                      value={artifactDraft.decisions}
                      onChange={event => setArtifactDraft(prev => ({ ...prev, decisions: event.target.value }))}
                      placeholder="Strategic decisions, one per line"
                      className="h-28 w-full resize-none rounded-2xl border border-outline-variant/20 bg-white px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                    />
                    <textarea
                      value={artifactDraft.changes}
                      onChange={event => setArtifactDraft(prev => ({ ...prev, changes: event.target.value }))}
                      placeholder="System changes, one per line"
                      className="h-28 w-full resize-none rounded-2xl border border-outline-variant/20 bg-white px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                    />
                    <textarea
                      value={artifactDraft.learningInsights}
                      onChange={event => setArtifactDraft(prev => ({ ...prev, learningInsights: event.target.value }))}
                      placeholder="Learning insights, one per line"
                      className="h-28 w-full resize-none rounded-2xl border border-outline-variant/20 bg-white px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </motion.div>
              )}

              {activeTab === 'governance' && (
                <motion.div
                  key="governance"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-8"
                >
                  <div className="flex justify-between items-center mb-6">
                    <div>
                      <h2 className="text-xl font-extrabold text-on-surface tracking-tight">Governance Rules</h2>
                      <p className="text-sm text-secondary font-medium">Policy-as-code for artifact validation and hand-off.</p>
                    </div>
                    <button className="px-4 py-2 bg-tertiary text-white text-xs font-bold rounded-xl flex items-center gap-2">
                      <Lock size={14} /> Add Policy
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-8">
                    <section className="space-y-4">
                      <h3 className="text-sm font-bold text-on-surface flex items-center gap-2 uppercase tracking-widest">
                        <ShieldCheck size={16} className="text-success" />
                        Validation Rules
                      </h3>
                      <div className="space-y-3">
                        {splitDraftLines(artifactDraft.governanceRules).map((rule, i) => (
                          <div key={i} className="p-4 bg-surface-container-low rounded-xl border border-outline-variant/10 flex gap-3">
                            <CheckCircle2 size={16} className="text-success shrink-0 mt-0.5" />
                            <p className="text-xs text-secondary font-medium leading-relaxed">{rule}</p>
                          </div>
                        )) || (
                          <div className="p-8 text-center border-2 border-dashed border-outline-variant/20 rounded-2xl">
                            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">No custom rules defined</p>
                          </div>
                        )}
                        <button className="w-full py-3 border-2 border-dashed border-outline-variant/30 rounded-xl text-[0.625rem] font-bold text-slate-400 hover:text-primary hover:border-primary/30 transition-all">
                          + Define New Validation Rule
                        </button>
                        <textarea
                          value={artifactDraft.governanceRules}
                          onChange={event => setArtifactDraft(prev => ({ ...prev, governanceRules: event.target.value }))}
                          placeholder="Governance and validation rules, one per line"
                          className="h-32 w-full resize-none rounded-2xl border border-outline-variant/20 bg-white px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                        />
                      </div>
                    </section>

                    <section className="space-y-4">
                      <h3 className="text-sm font-bold text-on-surface flex items-center gap-2 uppercase tracking-widest">
                        <BookOpen size={16} className="text-indigo-500" />
                        Hand-off Handlers
                      </h3>
                      <div className="space-y-3">
                        <div className="p-4 bg-surface-container-low rounded-xl border border-outline-variant/10 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-indigo-500 rounded-lg flex items-center justify-center text-white">
                              <BookOpen size={20} />
                            </div>
                            <div>
                              <p className="text-xs font-bold text-on-surface">Confluence Sync</p>
                              <p className="text-[0.625rem] text-secondary">Auto-sync enabled</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-success rounded-full" />
                            <span className="text-[0.625rem] font-bold text-success uppercase">Active</span>
                          </div>
                        </div>
                        <div className="p-4 bg-surface-container-low rounded-xl border border-outline-variant/10 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center text-white">
                              <Share2 size={20} />
                            </div>
                            <div>
                              <p className="text-xs font-bold text-on-surface">Jira Integration</p>
                              <p className="text-[0.625rem] text-secondary">Update task on completion</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-success rounded-full" />
                            <span className="text-[0.625rem] font-bold text-success uppercase">Active</span>
                          </div>
                        </div>
                      </div>
                    </section>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer Actions */}
          <div className="p-6 border-t border-outline-variant/10 bg-surface-container-lowest flex justify-between items-center">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-success rounded-full" />
                <span className="text-[0.625rem] font-bold text-secondary uppercase tracking-widest">Template Validated</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-primary rounded-full" />
                <span className="text-[0.625rem] font-bold text-secondary uppercase tracking-widest">Governance Approved</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button className="px-6 py-2 text-sm font-bold text-secondary hover:bg-surface-container-low rounded-xl transition-all">
                Discard Changes
              </button>
              <button
                onClick={handleSaveTemplate}
                className="px-8 py-2 bg-primary text-white text-sm font-bold rounded-xl shadow-lg shadow-primary/20 hover:brightness-110 transition-all"
              >
                Save Template
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ArtifactDesigner;

const Sparkles = ({ size, className }: { size?: number; className?: string }) => (
  <svg 
    width={size || 24} 
    height={size || 24} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    <path d="M5 3v4" />
    <path d="M19 17v4" />
    <path d="M3 5h4" />
    <path d="M17 19h4" />
  </svg>
);
