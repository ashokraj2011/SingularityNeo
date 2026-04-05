import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, 
  History, 
  GitBranch, 
  MoreVertical, 
  Compass, 
  PenTool, 
  Code,
  Settings2,
  ChevronDown,
  Plus,
  Table,
  Filter,
  ArrowRight, 
  Cpu, 
  Terminal, 
  ShieldCheck,
  ArrowUpRight,
  Workflow as WorkflowIcon,
  Layers,
  FileText,
  Share2,
  Database,
  CheckCircle2,
  AlertCircle,
  BookOpen,
  User,
  X
} from 'lucide-react';
import { BLUEPRINTS } from '../constants';
import { cn } from '../lib/utils';
import { useCapability } from '../context/CapabilityContext';
import { Workflow } from '../types';

const createWorkflowId = () => `WF-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const createWorkflowStepId = () => `STEP-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

const Designer = () => {
  const { activeCapability, getCapabilityWorkspace, setCapabilityWorkspaceContent } = useCapability();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const [view, setView] = useState<'blueprints' | 'workflows'>('workflows');
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [isWorkflowModalOpen, setIsWorkflowModalOpen] = useState(false);
  const [isStepModalOpen, setIsStepModalOpen] = useState(false);
  const [workflowDraft, setWorkflowDraft] = useState({
    name: '',
    workflowType: 'SDLC' as NonNullable<Workflow['workflowType']>,
    scope: 'CAPABILITY' as NonNullable<Workflow['scope']>,
    summary: '',
  });
  const [stepDraft, setStepDraft] = useState({
    agentId: workspace.agents[0]?.id || '',
    action: '',
    inputArtifactId: workspace.artifacts[0]?.id || '',
    outputArtifactId: workspace.artifacts[0]?.id || '',
  });

  const filteredBlueprints = useMemo(() => {
    return BLUEPRINTS.filter(bp => bp.capabilityId === activeCapability.id);
  }, [activeCapability]);

  const filteredWorkflows = useMemo(() => {
    return workspace.workflows;
  }, [workspace.workflows]);

  const visibleArtifacts = useMemo(() => {
    return workspace.artifacts;
  }, [workspace.artifacts]);

  useEffect(() => {
    if (filteredWorkflows.length === 0) {
      setSelectedWorkflow(null);
      return;
    }

    setSelectedWorkflow(current =>
      current && filteredWorkflows.some(workflow => workflow.id === current.id) ? current : filteredWorkflows[0],
    );
  }, [filteredWorkflows]);

  const handleCreateWorkflow = (event: React.FormEvent) => {
    event.preventDefault();
    if (!workflowDraft.name.trim()) {
      return;
    }

    const newWorkflow: Workflow = {
      id: createWorkflowId(),
      name: workflowDraft.name.trim(),
      capabilityId: activeCapability.id,
      steps: [],
      status: 'PENDING',
      workflowType: workflowDraft.workflowType,
      scope: workflowDraft.scope,
      summary: workflowDraft.summary.trim(),
    };

    setCapabilityWorkspaceContent(activeCapability.id, {
      workflows: [...workspace.workflows, newWorkflow],
    });
    setSelectedWorkflow(newWorkflow);
    setWorkflowDraft({
      name: '',
      workflowType: 'SDLC',
      scope: 'CAPABILITY',
      summary: '',
    });
    setIsWorkflowModalOpen(false);
    setView('workflows');
  };

  const handleAddStep = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedWorkflow || !stepDraft.agentId || !stepDraft.action.trim()) {
      return;
    }

    const nextWorkflows = workspace.workflows.map(workflow =>
      workflow.id === selectedWorkflow.id
        ? {
            ...workflow,
            status: workflow.status === 'STABLE' ? workflow.status : 'IN_PROGRESS',
            steps: [
              ...workflow.steps,
              {
                id: createWorkflowStepId(),
                agentId: stepDraft.agentId,
                action: stepDraft.action.trim(),
                inputArtifactId: stepDraft.inputArtifactId || undefined,
                outputArtifactId: stepDraft.outputArtifactId || undefined,
              },
            ],
          }
        : workflow,
    );

    setCapabilityWorkspaceContent(activeCapability.id, {
      workflows: nextWorkflows,
    });
    setStepDraft({
      agentId: workspace.agents[0]?.id || '',
      action: '',
      inputArtifactId: workspace.artifacts[0]?.id || '',
      outputArtifactId: workspace.artifacts[0]?.id || '',
    });
    setIsStepModalOpen(false);
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[0.625rem] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded uppercase tracking-widest">Capability Context</span>
            <span className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">{activeCapability.id}</span>
          </div>
          <h1 className="text-3xl font-extrabold text-primary tracking-tight mb-1">{activeCapability.name} Designer</h1>
          <p className="text-secondary text-sm font-medium">Design strategic workflows and artifact hand-off protocols for {activeCapability.name}.</p>
        </div>
        <div className="flex bg-surface-container-low p-1 rounded-xl">
          <button 
            onClick={() => setView('blueprints')}
            className={cn(
              "px-4 py-2 text-xs font-bold rounded-lg transition-all",
              view === 'blueprints' ? "bg-white text-primary shadow-sm" : "text-secondary hover:bg-white/50"
            )}
          >
            Blueprint Catalog
          </button>
          <button 
            onClick={() => setView('workflows')}
            className={cn(
              "px-4 py-2 text-xs font-bold rounded-lg transition-all",
              view === 'workflows' ? "bg-white text-primary shadow-sm" : "text-secondary hover:bg-white/50"
            )}
          >
            Workflow Canvas
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-8">
        {/* Left Column: Library List */}
        <div className="col-span-3 flex flex-col gap-4">
          <div className="flex items-center justify-between px-2">
            <span className="text-[0.6875rem] font-bold uppercase text-outline tracking-widest">
              {view === 'blueprints' ? 'Saved Blueprints' : 'Active Workflows'}
            </span>
            <Filter size={18} className="text-outline cursor-pointer" />
          </div>
          
          <div className="space-y-3">
            {view === 'blueprints' ? (
              filteredBlueprints.map((bp) => (
                <div 
                  key={bp.id} 
                  className="p-4 rounded-xl bg-white ghost-border ambient-shadow hover:bg-surface-container-low transition-all group cursor-pointer"
                >
                  <div className="flex items-start justify-between mb-3">
                    <span className="px-2 py-1 text-[0.625rem] font-bold rounded-full bg-primary/10 text-primary">{bp.type}</span>
                    <MoreVertical size={16} className="text-outline group-hover:text-primary" />
                  </div>
                  <h3 className="font-bold text-sm text-primary mb-1">{bp.title}</h3>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1">
                      <GitBranch size={12} className="text-outline" />
                      <span className="text-[0.6875rem] font-medium text-secondary">{bp.activeIds} Outputs</span>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              filteredWorkflows.map((wf) => (
                <div 
                  key={wf.id} 
                  onClick={() => setSelectedWorkflow(wf)}
                  className={cn(
                    "p-4 rounded-xl transition-all group cursor-pointer border",
                    selectedWorkflow?.id === wf.id 
                      ? "bg-primary/5 border-primary/20 shadow-sm" 
                      : "bg-white border-outline-variant/10 hover:bg-surface-container-low"
                  )}
                >
                  <div className="flex items-start justify-between mb-2">
                    <WorkflowIcon size={18} className={selectedWorkflow?.id === wf.id ? "text-primary" : "text-outline"} />
                    <div className="flex flex-col items-end gap-1">
                      <span className={cn(
                        "px-2 py-0.5 text-[0.625rem] font-bold rounded-full",
                        wf.status === 'STABLE' ? "bg-success/10 text-success" : "bg-primary/10 text-primary"
                      )}>
                        {wf.status}
                      </span>
                      <span className={cn(
                        "px-2 py-0.5 text-[0.625rem] font-bold rounded-full uppercase tracking-widest",
                        (wf.scope || 'CAPABILITY') === 'GLOBAL'
                          ? "bg-amber-100 text-amber-700"
                          : "bg-slate-100 text-slate-600"
                      )}>
                        {(wf.scope || 'CAPABILITY') === 'GLOBAL' ? 'Global' : 'Capability'}
                      </span>
                    </div>
                  </div>
                  <h3 className="font-bold text-sm text-primary mb-1">{wf.name}</h3>
                  <p className="text-[0.625rem] text-secondary">{wf.steps.length} Agent Steps</p>
                </div>
              ))
            )}
            
            <button
              onClick={() =>
                view === 'workflows' ? setIsWorkflowModalOpen(true) : undefined
              }
              className="w-full py-3 border-2 border-dashed border-outline-variant text-outline text-xs font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-surface-container-low transition-all"
            >
              <Plus size={16} /> New {view === 'blueprints' ? 'Blueprint' : 'Workflow'}
            </button>
          </div>
        </div>

        {/* Right Column: Canvas */}
        <div className="col-span-9">
          {view === 'workflows' && selectedWorkflow ? (
            <div className="space-y-8">
              <div className="bg-white rounded-3xl border border-outline-variant/15 shadow-sm p-8">
                <div className="flex justify-between items-center mb-12">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center text-white shadow-lg shadow-primary/20">
                      <WorkflowIcon size={24} />
                    </div>
                    <div>
                      <h2 className="text-xl font-extrabold text-primary tracking-tight">{selectedWorkflow.name}</h2>
                      <p className="text-xs text-secondary font-medium">
                        Visualizing agent hand-offs and artifact lifecycle.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className="rounded-full bg-primary/10 px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-primary">
                          {selectedWorkflow.workflowType || 'Workflow'}
                        </span>
                        <span className={cn(
                          "rounded-full px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em]",
                          (selectedWorkflow.scope || 'CAPABILITY') === 'GLOBAL'
                            ? "bg-amber-100 text-amber-700"
                            : "bg-slate-100 text-slate-600"
                        )}>
                          {(selectedWorkflow.scope || 'CAPABILITY') === 'GLOBAL'
                            ? 'Global Scope'
                            : 'Capability Scope'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button className="px-4 py-2 text-xs font-bold text-secondary hover:bg-surface-container-low rounded-xl transition-all">Export JSON</button>
                    <button
                      onClick={() => setIsStepModalOpen(true)}
                      disabled={workspace.agents.length === 0}
                      className="px-6 py-2.5 bg-primary text-white text-sm font-bold rounded-xl hover:shadow-lg transition-all flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Plus size={18} /> Add Step
                    </button>
                  </div>
                </div>

                <div className="relative flex items-center justify-between gap-4 overflow-x-auto pb-12 pt-4 px-4 custom-scrollbar">
                  {selectedWorkflow.steps.map((step, index) => {
                    const outputArtifact = visibleArtifacts.find(a => a.id === step.outputArtifactId);
                    return (
                      <React.Fragment key={step.id}>
                        <div className="flex flex-col items-center gap-6 group">
                          {/* Agent Node */}
                          <motion.div 
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.1 }}
                            className="w-48 p-4 bg-surface-container-low rounded-2xl border border-primary/10 shadow-sm relative group-hover:border-primary/40 transition-all"
                          >
                            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-white text-[0.625rem] font-bold px-2 py-0.5 rounded uppercase tracking-widest shadow-sm">
                              Agent
                            </div>
                            <div className="flex items-center gap-3 mb-3 mt-1">
                              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                                <Cpu size={16} />
                              </div>
                              <span className="text-xs font-bold text-primary truncate">{step.agentId}</span>
                            </div>
                            <div className="p-2 bg-white rounded-lg border border-outline-variant/10">
                              <p className="text-[0.6875rem] font-bold text-on-surface mb-1">Action</p>
                              <p className="text-[0.625rem] text-secondary leading-tight">{step.action}</p>
                            </div>
                          </motion.div>

                          {/* Artifact Node (Hand-off) */}
                          {outputArtifact && (
                            <motion.div 
                              initial={{ opacity: 0, scale: 0.9 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ delay: index * 0.1 + 0.2 }}
                              className={cn(
                                "w-40 p-3 bg-white rounded-xl border shadow-sm relative",
                                outputArtifact.isMasterArtifact ? "border-primary/40 ring-2 ring-primary/5" : "border-tertiary/20"
                              )}
                            >
                              <div className="absolute -right-2 -top-2">
                                {outputArtifact.documentationStatus === 'SYNCED' ? (
                                  <div className="bg-success text-white p-1 rounded-full shadow-sm" title="Synced to Confluence">
                                    <CheckCircle2 size={12} />
                                  </div>
                                ) : (
                                  <div className="bg-warning text-white p-1 rounded-full shadow-sm" title="Documentation Pending">
                                    <AlertCircle size={12} />
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mb-2">
                                <FileText size={14} className={outputArtifact.isMasterArtifact ? "text-primary" : "text-tertiary"} />
                                <span className={cn(
                                  "text-[0.625rem] font-bold uppercase tracking-widest",
                                  outputArtifact.isMasterArtifact ? "text-primary" : "text-tertiary"
                                )}>
                                  {outputArtifact.isMasterArtifact ? 'Master Artifact' : 'Artifact'}
                                </span>
                              </div>
                              <p className="text-[0.6875rem] font-bold text-on-surface truncate mb-1">{outputArtifact.name}</p>
                              <div className="flex items-center justify-between">
                                <span className="text-[0.5rem] font-bold text-slate-400 uppercase">{outputArtifact.type}</span>
                                <Share2 size={12} className="text-slate-400 cursor-pointer hover:text-primary" />
                              </div>
                            </motion.div>
                          )}
                        </div>
                        {index < selectedWorkflow.steps.length - 1 && (
                          <div className="flex-1 min-w-[60px] h-px bg-gradient-to-r from-primary/20 to-tertiary/20 relative">
                            <ArrowRight size={16} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-primary/40" />
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>

                <div className="mt-12 p-6 bg-surface-container-low rounded-2xl border border-outline-variant/10 flex items-center justify-between">
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-success rounded-full" />
                      <span className="text-xs font-bold text-secondary uppercase tracking-widest">Documentation Synced</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-warning rounded-full" />
                      <span className="text-xs font-bold text-secondary uppercase tracking-widest">Pending Confluence Update</span>
                    </div>
                  </div>
                  <button className="flex items-center gap-2 text-xs font-bold text-primary hover:underline">
                    <Database size={14} /> Configure Hand-off Rules
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-8">
                <section className="bg-white rounded-3xl border border-outline-variant/15 shadow-sm p-6">
                  <h3 className="text-lg font-bold text-primary mb-4 flex items-center gap-2">
                    <Layers size={20} />
                    Artifact Hand-off Designer
                  </h3>
                  <div className="space-y-4">
                    <div className="p-4 bg-surface-container-low rounded-xl border border-outline-variant/10">
                      <p className="text-xs font-bold text-on-surface mb-2">Protocol: Secure Data Exchange</p>
                      <p className="text-[0.6875rem] text-secondary leading-relaxed mb-4">Ensures artifacts are encrypted and validated before being passed to the next agent in the sequence.</p>
                      <div className="flex gap-2">
                        <span className="px-2 py-1 bg-primary/10 text-primary text-[0.625rem] font-bold rounded">Validation Required</span>
                        <span className="px-2 py-1 bg-tertiary/10 text-tertiary text-[0.625rem] font-bold rounded">Auto-Doc Enabled</span>
                      </div>
                    </div>
                    <button className="w-full py-3 border-2 border-dashed border-outline-variant text-outline text-xs font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-surface-container-low transition-all">
                      <Plus size={16} /> Define New Hand-off Protocol
                    </button>
                  </div>
                </section>

                <section className="bg-white rounded-3xl border border-outline-variant/15 shadow-sm p-6">
                  <h3 className="text-lg font-bold text-primary mb-4 flex items-center gap-2">
                    <FileText size={20} />
                    Documentation Automation
                  </h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-surface-container-low rounded-xl border border-outline-variant/10">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-500 rounded-lg flex items-center justify-center text-white">
                          <BookOpen size={20} />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-on-surface">Confluence Sync</p>
                          <p className="text-[0.625rem] text-secondary">Last sync: 2h ago</p>
                        </div>
                      </div>
                      <button className="text-[0.625rem] font-bold text-primary uppercase tracking-widest">Settings</button>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-surface-container-low rounded-xl border border-outline-variant/10">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center text-white">
                          <Share2 size={20} />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-on-surface">Jira Integration</p>
                          <p className="text-[0.625rem] text-secondary">Status: Connected</p>
                        </div>
                      </div>
                      <button className="text-[0.625rem] font-bold text-primary uppercase tracking-widest">Settings</button>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          ) : view === 'workflows' ? (
            <div className="col-span-2 rounded-[2rem] border border-dashed border-outline-variant/20 bg-white p-16 text-center">
              <WorkflowIcon size={48} className="mx-auto mb-5 text-outline" />
              <h3 className="text-2xl font-extrabold text-primary">No workflows yet</h3>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-secondary">
                Start by defining an SDLC or operational workflow for {activeCapability.name}. Every step you add here becomes part of the active capability workspace and will be reused by tasks and orchestration.
              </p>
              <button
                onClick={() => setIsWorkflowModalOpen(true)}
                className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-all hover:brightness-110"
              >
                <Plus size={18} />
                Create Workflow
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-8">
              {/* Existing Blueprint Canvas logic or placeholder */}
              <div className="col-span-2 py-24 text-center glass-panel border-dashed">
                <Compass size={48} className="mx-auto text-outline mb-4 opacity-20" />
                <h3 className="text-xl font-bold text-primary mb-2">Blueprint Designer</h3>
                <p className="text-sm text-secondary max-w-md mx-auto">Select a blueprint from the library to begin orchestrating strategic delivery patterns.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {isWorkflowModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsWorkflowModalOpen(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-md"
            />
            <motion.form
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.98 }}
              onSubmit={handleCreateWorkflow}
              className="relative w-full max-w-2xl rounded-[2rem] border border-outline-variant/15 bg-white p-8 shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[0.625rem] font-bold uppercase tracking-[0.2em] text-primary">New workflow</p>
                  <h3 className="mt-2 text-2xl font-extrabold text-primary">Create a capability workflow</h3>
                  <p className="mt-2 text-sm text-secondary">
                    This workflow will live under {activeCapability.name} and drive downstream work items and artifact hand-offs.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsWorkflowModalOpen(false)}
                  className="rounded-full p-2 text-slate-400 transition-colors hover:bg-surface-container-low hover:text-primary"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="mt-8 grid gap-5 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <label className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Workflow name</label>
                  <input
                    required
                    value={workflowDraft.name}
                    onChange={event => setWorkflowDraft(prev => ({ ...prev, name: event.target.value }))}
                    placeholder="e.g. SDLC change lifecycle"
                    className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Workflow type</label>
                  <select
                    value={workflowDraft.workflowType}
                    onChange={event =>
                      setWorkflowDraft(prev => ({
                        ...prev,
                        workflowType: event.target.value as NonNullable<Workflow['workflowType']>,
                      }))
                    }
                    className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="SDLC">SDLC</option>
                    <option value="Operational">Operational</option>
                    <option value="Governance">Governance</option>
                    <option value="Custom">Custom</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Workflow scope</label>
                  <select
                    value={workflowDraft.scope}
                    onChange={event =>
                      setWorkflowDraft(prev => ({
                        ...prev,
                        scope: event.target.value as NonNullable<Workflow['scope']>,
                      }))
                    }
                    className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="CAPABILITY">Capability Local</option>
                    <option value="GLOBAL">Global</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Initial state</label>
                  <div className="flex h-[50px] items-center rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 text-sm font-bold text-primary">
                    PENDING
                  </div>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <label className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Summary</label>
                  <textarea
                    value={workflowDraft.summary}
                    onChange={event => setWorkflowDraft(prev => ({ ...prev, summary: event.target.value }))}
                    placeholder="Describe the lifecycle and the outcome this workflow should manage."
                    className="h-28 w-full resize-none rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div className="mt-8 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsWorkflowModalOpen(false)}
                  className="flex-1 rounded-2xl border border-outline-variant/20 px-5 py-3 text-sm font-bold text-secondary transition-all hover:bg-surface-container-low"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-all hover:brightness-110"
                >
                  Save Workflow
                </button>
              </div>
            </motion.form>
          </div>
        )}
        {isStepModalOpen && selectedWorkflow && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsStepModalOpen(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-md"
            />
            <motion.form
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.98 }}
              onSubmit={handleAddStep}
              className="relative w-full max-w-2xl rounded-[2rem] border border-outline-variant/15 bg-white p-8 shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[0.625rem] font-bold uppercase tracking-[0.2em] text-primary">Workflow step</p>
                  <h3 className="mt-2 text-2xl font-extrabold text-primary">Add a hand-off step</h3>
                  <p className="mt-2 text-sm text-secondary">
                    Connect an agent, action, and input/output artifact so this capability workflow can drive execution.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsStepModalOpen(false)}
                  className="rounded-full p-2 text-slate-400 transition-colors hover:bg-surface-container-low hover:text-primary"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="mt-8 grid gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Agent</label>
                  <select
                    value={stepDraft.agentId}
                    onChange={event => setStepDraft(prev => ({ ...prev, agentId: event.target.value }))}
                    className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  >
                    {workspace.agents.map(agent => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Output artifact</label>
                  <select
                    value={stepDraft.outputArtifactId}
                    onChange={event => setStepDraft(prev => ({ ...prev, outputArtifactId: event.target.value }))}
                    className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">No artifact</option>
                    {visibleArtifacts.map(artifact => (
                      <option key={artifact.id} value={artifact.id}>
                        {artifact.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <label className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Action</label>
                  <input
                    required
                    value={stepDraft.action}
                    onChange={event => setStepDraft(prev => ({ ...prev, action: event.target.value }))}
                    placeholder="e.g. Review documentation and produce test strategy"
                    className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <label className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Input artifact</label>
                  <select
                    value={stepDraft.inputArtifactId}
                    onChange={event => setStepDraft(prev => ({ ...prev, inputArtifactId: event.target.value }))}
                    className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">No artifact</option>
                    {visibleArtifacts.map(artifact => (
                      <option key={artifact.id} value={artifact.id}>
                        {artifact.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-8 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsStepModalOpen(false)}
                  className="flex-1 rounded-2xl border border-outline-variant/20 px-5 py-3 text-sm font-bold text-secondary transition-all hover:bg-surface-container-low"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-all hover:brightness-110"
                >
                  Add Step
                </button>
              </div>
            </motion.form>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Designer;
