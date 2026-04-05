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
  Sparkles,
  User,
  X
} from 'lucide-react';
import { BLUEPRINTS } from '../constants';
import { cn } from '../lib/utils';
import { useCapability } from '../context/CapabilityContext';
import { WorkItemPhase, Workflow, WorkflowHandoffProtocol, WorkflowStep } from '../types';
import {
  createStandardCapabilityWorkflow,
  SDLC_BOARD_PHASES,
} from '../lib/standardWorkflow';

const createWorkflowId = () => `WF-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const createWorkflowStepId = () => `STEP-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const createHandoffProtocolId = () =>
  `HANDOFF-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

const parseLines = (value: string) =>
  value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

const getWorkflowProtocols = (workflow: Workflow): WorkflowHandoffProtocol[] => {
  if (workflow.handoffProtocols?.length) {
    return workflow.handoffProtocols;
  }

  return workflow.steps
    .filter(step => step.handoffToAgentId || step.handoffToPhase)
    .map(step => ({
      id: step.handoffProtocolId || `HANDOFF-${workflow.id}-${step.id}`,
      name: step.handoffLabel || `${step.name} Hand-off`,
      sourceStepId: step.id,
      targetAgentId: step.handoffToAgentId,
      targetPhase: step.handoffToPhase,
      description:
        step.description ||
        `Protocol for moving delivery context forward from ${step.name}.`,
      rules:
        step.exitCriteria?.length
          ? step.exitCriteria
          : [
              'Validate the step output before handing work forward.',
              'Capture assumptions and unresolved risks in the hand-off notes.',
              'Publish the hand-off summary to the capability documentation trail.',
            ],
      validationRequired: true,
      autoDocumentation: true,
    }));
};

const Designer = () => {
  const { activeCapability, getCapabilityWorkspace, setCapabilityWorkspaceContent } = useCapability();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const [view, setView] = useState<'blueprints' | 'workflows'>('workflows');
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [isWorkflowModalOpen, setIsWorkflowModalOpen] = useState(false);
  const [isStepModalOpen, setIsStepModalOpen] = useState(false);
  const [isProtocolModalOpen, setIsProtocolModalOpen] = useState(false);
  const [workflowDraft, setWorkflowDraft] = useState({
    name: '',
    workflowType: 'SDLC' as NonNullable<Workflow['workflowType']>,
    scope: 'CAPABILITY' as NonNullable<Workflow['scope']>,
    summary: '',
  });
  const [stepDraft, setStepDraft] = useState({
    name: '',
    phase: 'ANALYSIS' as WorkItemPhase,
    stepType: 'DELIVERY' as WorkflowStep['stepType'],
    agentId: workspace.agents[0]?.id || '',
    action: '',
    description: '',
    inputArtifactId: workspace.artifacts[0]?.id || '',
    outputArtifactId: workspace.artifacts[0]?.id || '',
    handoffToAgentId: '',
    handoffToPhase: 'DESIGN' as WorkItemPhase,
    governanceGate: '',
    approverRoles: '',
    exitCriteria: '',
    templatePath: '/out/steps/custom-step-template.md',
  });
  const [protocolDraft, setProtocolDraft] = useState({
    id: '',
    sourceStepId: '',
    name: '',
    description: '',
    targetAgentId: '',
    targetPhase: 'DESIGN' as WorkItemPhase,
    rules: '',
    validationRequired: true,
    autoDocumentation: true,
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

  const selectedWorkflowProtocols = useMemo(
    () => (selectedWorkflow ? getWorkflowProtocols(selectedWorkflow) : []),
    [selectedWorkflow],
  );

  const selectedStep = useMemo(
    () =>
      selectedWorkflow?.steps.find(step => step.id === selectedStepId) ||
      selectedWorkflow?.steps[0] ||
      null,
    [selectedStepId, selectedWorkflow],
  );

  const selectedProtocol = useMemo(() => {
    if (!selectedWorkflow || !selectedStep) {
      return null;
    }

    return (
      selectedWorkflowProtocols.find(
        protocol =>
          protocol.id === selectedStep.handoffProtocolId ||
          protocol.sourceStepId === selectedStep.id,
      ) || null
    );
  }, [selectedStep, selectedWorkflow, selectedWorkflowProtocols]);

  useEffect(() => {
    if (filteredWorkflows.length === 0) {
      setSelectedWorkflow(null);
      return;
    }

    setSelectedWorkflow(current =>
      current && filteredWorkflows.some(workflow => workflow.id === current.id) ? current : filteredWorkflows[0],
    );
  }, [filteredWorkflows]);

  useEffect(() => {
    if (!selectedWorkflow?.steps.length) {
      setSelectedStepId(null);
      return;
    }

    setSelectedStepId(current =>
      current && selectedWorkflow.steps.some(step => step.id === current)
        ? current
        : selectedWorkflow.steps[0].id,
    );
  }, [selectedWorkflow]);

  const updateSelectedWorkflow = (buildNextWorkflow: (workflow: Workflow) => Workflow) => {
    if (!selectedWorkflow) {
      return null;
    }

    let nextSelectedWorkflow: Workflow | null = null;
    const nextWorkflows = workspace.workflows.map(workflow => {
      if (workflow.id !== selectedWorkflow.id) {
        return workflow;
      }

      nextSelectedWorkflow = buildNextWorkflow(workflow);
      return nextSelectedWorkflow;
    });

    if (!nextSelectedWorkflow) {
      return null;
    }

    setCapabilityWorkspaceContent(activeCapability.id, {
      workflows: nextWorkflows,
    });
    setSelectedWorkflow(nextSelectedWorkflow);
    return nextSelectedWorkflow;
  };

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

  const handleCreateStandardWorkflow = () => {
    const standardWorkflow = createStandardCapabilityWorkflow(activeCapability);
    if (workspace.workflows.some(workflow => workflow.id === standardWorkflow.id)) {
      setSelectedWorkflow(
        workspace.workflows.find(workflow => workflow.id === standardWorkflow.id) || standardWorkflow,
      );
      setIsWorkflowModalOpen(false);
      setView('workflows');
      return;
    }

    setCapabilityWorkspaceContent(activeCapability.id, {
      workflows: [...workspace.workflows, standardWorkflow],
    });
    setSelectedWorkflow(standardWorkflow);
    setIsWorkflowModalOpen(false);
    setView('workflows');
  };

  const handleAddStep = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedWorkflow || !stepDraft.agentId || !stepDraft.action.trim() || !stepDraft.name.trim()) {
      return;
    }

    const nextStepId = createWorkflowStepId();
    updateSelectedWorkflow(workflow => ({
      ...workflow,
      status: workflow.status === 'STABLE' ? workflow.status : 'IN_PROGRESS',
      steps: [
        ...workflow.steps,
        {
          id: nextStepId,
          name: stepDraft.name.trim(),
          phase: stepDraft.phase,
          stepType: stepDraft.stepType,
          agentId: stepDraft.agentId,
          action: stepDraft.action.trim(),
          description: stepDraft.description.trim() || undefined,
          inputArtifactId: stepDraft.inputArtifactId || undefined,
          outputArtifactId: stepDraft.outputArtifactId || undefined,
          handoffToAgentId: stepDraft.handoffToAgentId || undefined,
          handoffToPhase: stepDraft.handoffToAgentId ? stepDraft.handoffToPhase : undefined,
          handoffLabel: stepDraft.handoffToAgentId
            ? `${stepDraft.name.trim()} hand-off`
            : undefined,
          governanceGate:
            stepDraft.stepType === 'GOVERNANCE_GATE'
              ? stepDraft.governanceGate.trim() || stepDraft.name.trim()
              : undefined,
          approverRoles:
            stepDraft.stepType !== 'DELIVERY'
              ? stepDraft.approverRoles
                  .split(',')
                  .map(role => role.trim())
                  .filter(Boolean)
              : undefined,
          exitCriteria: parseLines(stepDraft.exitCriteria),
          templatePath: stepDraft.templatePath.trim() || undefined,
        },
      ],
    }));
    setSelectedStepId(nextStepId);
    setStepDraft({
      name: '',
      phase: 'ANALYSIS',
      stepType: 'DELIVERY',
      agentId: workspace.agents[0]?.id || '',
      action: '',
      description: '',
      inputArtifactId: workspace.artifacts[0]?.id || '',
      outputArtifactId: workspace.artifacts[0]?.id || '',
      handoffToAgentId: '',
      handoffToPhase: 'DESIGN',
      governanceGate: '',
      approverRoles: '',
      exitCriteria: '',
      templatePath: '/out/steps/custom-step-template.md',
    });
    setIsStepModalOpen(false);
  };

  const openProtocolModal = (mode: 'create' | 'edit') => {
    const fallbackStep = selectedStep || selectedWorkflow?.steps[0];
    if (!selectedWorkflow || !fallbackStep) {
      return;
    }

    const protocol =
      mode === 'edit'
        ? selectedWorkflowProtocols.find(
            item =>
              item.id === fallbackStep.handoffProtocolId ||
              item.sourceStepId === fallbackStep.id,
          ) || null
        : null;

    setProtocolDraft({
      id: protocol?.id || '',
      sourceStepId: protocol?.sourceStepId || fallbackStep.id,
      name: protocol?.name || fallbackStep.handoffLabel || `${fallbackStep.name} Hand-off`,
      description: protocol?.description || fallbackStep.description || '',
      targetAgentId:
        protocol?.targetAgentId || fallbackStep.handoffToAgentId || '',
      targetPhase:
        protocol?.targetPhase || fallbackStep.handoffToPhase || fallbackStep.phase,
      rules: (protocol?.rules || fallbackStep.exitCriteria || []).join('\n'),
      validationRequired: protocol?.validationRequired ?? true,
      autoDocumentation: protocol?.autoDocumentation ?? true,
    });
    setIsProtocolModalOpen(true);
  };

  const handleSaveProtocol = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedWorkflow || !protocolDraft.sourceStepId || !protocolDraft.name.trim()) {
      return;
    }

    const protocolId =
      protocolDraft.id ||
      selectedStep?.handoffProtocolId ||
      createHandoffProtocolId();
    const nextProtocol: WorkflowHandoffProtocol = {
      id: protocolId,
      sourceStepId: protocolDraft.sourceStepId,
      name: protocolDraft.name.trim(),
      description: protocolDraft.description.trim() || undefined,
      targetAgentId: protocolDraft.targetAgentId || undefined,
      targetPhase: protocolDraft.targetPhase,
      rules: parseLines(protocolDraft.rules),
      validationRequired: protocolDraft.validationRequired,
      autoDocumentation: protocolDraft.autoDocumentation,
    };

    const currentProtocols = getWorkflowProtocols(selectedWorkflow);
    const nextProtocols = currentProtocols.some(protocol => protocol.id === protocolId)
      ? currentProtocols.map(protocol => (protocol.id === protocolId ? nextProtocol : protocol))
      : [...currentProtocols, nextProtocol];

    updateSelectedWorkflow(workflow => ({
      ...workflow,
      handoffProtocols: nextProtocols,
      steps: workflow.steps.map(step => {
        if (step.id === protocolDraft.sourceStepId) {
          return {
            ...step,
            handoffProtocolId: protocolId,
            handoffLabel: nextProtocol.name,
            handoffToAgentId: nextProtocol.targetAgentId,
            handoffToPhase: nextProtocol.targetPhase,
          };
        }

        if (step.handoffProtocolId === protocolId) {
          return {
            ...step,
            handoffProtocolId: undefined,
          };
        }

        return step;
      }),
    }));

    setSelectedStepId(protocolDraft.sourceStepId);
    setIsProtocolModalOpen(false);
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
                  <p className="text-[0.625rem] text-secondary">
                    {wf.steps.length} SDLC steps
                  </p>
                  <p className="mt-2 text-[0.625rem] leading-relaxed text-secondary">
                    {wf.summary || 'Workflow template ready for story orchestration.'}
                  </p>
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
                        Visualizing SDLC hand-offs, governance gates, and human approval stages.
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
                        <div
                          className="flex cursor-pointer flex-col items-center gap-6 group"
                          onClick={() => setSelectedStepId(step.id)}
                        >
                          {/* Agent Node */}
                          <motion.div 
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.1 }}
                            className={cn(
                              "relative w-48 rounded-2xl border bg-surface-container-low p-4 shadow-sm transition-all group-hover:border-primary/40",
                              selectedStep?.id === step.id
                                ? "border-primary shadow-lg shadow-primary/10 ring-2 ring-primary/10"
                                : "border-primary/10"
                            )}
                          >
                            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-white text-[0.625rem] font-bold px-2 py-0.5 rounded uppercase tracking-widest shadow-sm">
                              Agent
                            </div>
                            <div className="flex items-center gap-3 mb-3 mt-1">
                            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                              <Cpu size={16} />
                            </div>
                              <div className="min-w-0">
                                <p className="truncate text-xs font-bold text-primary">{step.name}</p>
                                <p className="truncate text-[0.625rem] font-bold uppercase tracking-[0.16em] text-outline">
                                  {workspace.agents.find(agent => agent.id === step.agentId)?.name || step.agentId}
                                </p>
                              </div>
                            </div>
                            <div className="p-2 bg-white rounded-lg border border-outline-variant/10">
                              <p className="text-[0.6875rem] font-bold text-on-surface mb-1">Action</p>
                              <p className="text-[0.625rem] text-secondary leading-tight">{step.action}</p>
                              <div className="mt-2 flex flex-wrap gap-1">
                                <span className="rounded-full bg-slate-100 px-2 py-1 text-[0.5rem] font-bold uppercase tracking-[0.16em] text-slate-600">
                                  {step.phase}
                                </span>
                                <span className={cn(
                                  "rounded-full px-2 py-1 text-[0.5rem] font-bold uppercase tracking-[0.16em]",
                                  step.stepType === 'DELIVERY'
                                    ? 'bg-primary/10 text-primary'
                                    : step.stepType === 'GOVERNANCE_GATE'
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-fuchsia-100 text-fuchsia-700'
                                )}>
                                  {step.stepType.replace('_', ' ')}
                                </span>
                              </div>
                              {step.handoffToAgentId && (
                                <p className="mt-2 text-[0.5625rem] font-bold uppercase tracking-[0.16em] text-outline">
                                  {step.handoffLabel || 'Hand-off'} to {workspace.agents.find(agent => agent.id === step.handoffToAgentId)?.name || step.handoffToAgentId}
                                  {step.handoffToPhase ? ` • ${step.handoffToPhase}` : ''}
                                </p>
                              )}
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
                    {selectedStep && (
                      <div className="rounded-full bg-white px-3 py-2 text-[0.625rem] font-bold uppercase tracking-[0.16em] text-outline shadow-sm">
                        Selected Step: {selectedStep.name}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => openProtocolModal(selectedProtocol ? 'edit' : 'create')}
                    disabled={!selectedStep}
                    className="flex items-center gap-2 text-xs font-bold text-primary transition-all hover:underline disabled:cursor-not-allowed disabled:text-outline"
                  >
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
                      <p className="text-xs font-bold text-on-surface mb-2">
                        Protocol:{' '}
                        {selectedProtocol?.name || selectedStep?.handoffLabel || 'No hand-off protocol defined'}
                      </p>
                      <p className="text-[0.6875rem] text-secondary leading-relaxed mb-4">
                        {selectedProtocol?.description ||
                          (selectedStep
                            ? `Define the rules that move output from ${selectedStep.name} into the next SDLC stage.`
                            : 'Select a step to define how artifacts, approvals, and evidence move forward.')}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <span
                          className={cn(
                            "px-2 py-1 text-[0.625rem] font-bold rounded",
                            selectedProtocol?.validationRequired
                              ? "bg-primary/10 text-primary"
                              : "bg-slate-100 text-slate-500"
                          )}
                        >
                          {selectedProtocol?.validationRequired
                            ? 'Validation Required'
                            : 'Validation Optional'}
                        </span>
                        <span
                          className={cn(
                            "px-2 py-1 text-[0.625rem] font-bold rounded",
                            selectedProtocol?.autoDocumentation
                              ? "bg-tertiary/10 text-tertiary"
                              : "bg-slate-100 text-slate-500"
                          )}
                        >
                          {selectedProtocol?.autoDocumentation
                            ? 'Auto-Doc Enabled'
                            : 'Manual Documentation'}
                        </span>
                        {selectedProtocol?.targetPhase && (
                          <span className="px-2 py-1 rounded bg-slate-100 text-slate-600 text-[0.625rem] font-bold">
                            Next Phase: {selectedProtocol.targetPhase}
                          </span>
                        )}
                      </div>
                      <div className="mt-4 space-y-2">
                        {(selectedProtocol?.rules || []).length > 0 ? (
                          selectedProtocol?.rules.map(rule => (
                            <div
                              key={rule}
                              className="rounded-xl border border-outline-variant/10 bg-white px-3 py-2 text-[0.6875rem] text-secondary"
                            >
                              {rule}
                            </div>
                          ))
                        ) : (
                          <div className="rounded-xl border border-dashed border-outline-variant/20 bg-white px-3 py-4 text-[0.6875rem] text-outline">
                            No hand-off rules configured for this step yet.
                          </div>
                        )}
                      </div>
                    </div>
                    {selectedWorkflowProtocols.length > 0 && (
                      <div className="space-y-2">
                        {selectedWorkflowProtocols.map(protocol => (
                          <button
                            key={protocol.id}
                            onClick={() => setSelectedStepId(protocol.sourceStepId)}
                            className={cn(
                              "flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left transition-all",
                              selectedProtocol?.id === protocol.id
                                ? "border-primary/30 bg-primary/5"
                                : "border-outline-variant/10 bg-white hover:bg-surface-container-low"
                            )}
                          >
                            <div>
                              <p className="text-xs font-bold text-on-surface">{protocol.name}</p>
                              <p className="mt-1 text-[0.625rem] font-bold uppercase tracking-[0.16em] text-outline">
                                {selectedWorkflow.steps.find(step => step.id === protocol.sourceStepId)?.name || 'Step'}
                              </p>
                            </div>
                            <ArrowUpRight size={14} className="text-outline" />
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => openProtocolModal(selectedProtocol ? 'edit' : 'create')}
                      disabled={!selectedStep}
                      className="w-full py-3 border-2 border-dashed border-outline-variant text-outline text-xs font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-surface-container-low transition-all disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Plus size={16} /> {selectedProtocol ? 'Edit Hand-off Protocol' : 'Define New Hand-off Protocol'}
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
              <div className="mt-6 flex items-center justify-center gap-3">
                <button
                  onClick={handleCreateStandardWorkflow}
                  className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-all hover:brightness-110"
                >
                  <Sparkles size={18} />
                  Load Standard SDLC Flow
                </button>
                <button
                  onClick={() => setIsWorkflowModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-outline-variant/20 bg-white px-5 py-3 text-sm font-bold text-secondary transition-all hover:bg-surface-container-low"
                >
                  <Plus size={18} />
                  Create Workflow
                </button>
              </div>
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
                <div className="rounded-3xl border border-primary/10 bg-primary/5 p-5 md:col-span-2">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-primary">Standard Template</p>
                      <p className="mt-2 text-sm leading-relaxed text-secondary">
                        Load the enterprise SDLC template with business analysis, architecture, development, QA, governance gate, human approval, and release hand-offs.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleCreateStandardWorkflow}
                      className="rounded-2xl bg-primary px-4 py-2.5 text-xs font-bold uppercase tracking-[0.18em] text-white shadow-lg shadow-primary/20 transition-all hover:brightness-110"
                    >
                      Use Standard
                    </button>
                  </div>
                </div>

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
                <div className="space-y-2 md:col-span-2">
                  <label className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Step name</label>
                  <input
                    required
                    value={stepDraft.name}
                    onChange={event => setStepDraft(prev => ({ ...prev, name: event.target.value }))}
                    placeholder="e.g. Governance Gate"
                    className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">SDLC phase</label>
                  <select
                    value={stepDraft.phase}
                    onChange={event =>
                      setStepDraft(prev => ({
                        ...prev,
                        phase: event.target.value as WorkItemPhase,
                      }))
                    }
                    className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  >
                    {SDLC_BOARD_PHASES.filter(phase => phase !== 'BACKLOG' && phase !== 'DONE').map(phase => (
                      <option key={phase} value={phase}>
                        {phase}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Step type</label>
                  <select
                    value={stepDraft.stepType}
                    onChange={event =>
                      setStepDraft(prev => ({
                        ...prev,
                        stepType: event.target.value as WorkflowStep['stepType'],
                      }))
                    }
                    className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="DELIVERY">Delivery</option>
                    <option value="GOVERNANCE_GATE">Governance Gate</option>
                    <option value="HUMAN_APPROVAL">Human Approval</option>
                  </select>
                </div>

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
                  <label className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Description</label>
                  <textarea
                    value={stepDraft.description}
                    onChange={event => setStepDraft(prev => ({ ...prev, description: event.target.value }))}
                    placeholder="Describe the purpose of this step and what must happen before the story can move forward."
                    className="h-24 w-full resize-none rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
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

                <div className="space-y-2">
                  <label className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Hand-off agent</label>
                  <select
                    value={stepDraft.handoffToAgentId}
                    onChange={event => setStepDraft(prev => ({ ...prev, handoffToAgentId: event.target.value }))}
                    className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">No hand-off</option>
                    {workspace.agents.map(agent => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Hand-off phase</label>
                  <select
                    value={stepDraft.handoffToPhase}
                    onChange={event =>
                      setStepDraft(prev => ({
                        ...prev,
                        handoffToPhase: event.target.value as WorkItemPhase,
                      }))
                    }
                    className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  >
                    {SDLC_BOARD_PHASES.filter(phase => phase !== 'BACKLOG').map(phase => (
                      <option key={phase} value={phase}>
                        {phase}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <label className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Exit criteria</label>
                  <textarea
                    value={stepDraft.exitCriteria}
                    onChange={event => setStepDraft(prev => ({ ...prev, exitCriteria: event.target.value }))}
                    placeholder={'Acceptance criteria verified\nEvidence attached\nReady for hand-off'}
                    className="h-24 w-full resize-none rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                {stepDraft.stepType !== 'DELIVERY' && (
                  <>
                    <div className="space-y-2">
                      <label className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Gate name</label>
                      <input
                        value={stepDraft.governanceGate}
                        onChange={event => setStepDraft(prev => ({ ...prev, governanceGate: event.target.value }))}
                        placeholder="e.g. Release Governance Gate"
                        className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Approver roles</label>
                      <input
                        value={stepDraft.approverRoles}
                        onChange={event => setStepDraft(prev => ({ ...prev, approverRoles: event.target.value }))}
                        placeholder="Development Manager, Team Lead"
                        className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                  </>
                )}

                <div className="space-y-2 md:col-span-2">
                  <label className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Template path</label>
                  <input
                    value={stepDraft.templatePath}
                    onChange={event => setStepDraft(prev => ({ ...prev, templatePath: event.target.value }))}
                    placeholder="/out/steps/custom-step-template.md"
                    className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  />
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
        {isProtocolModalOpen && selectedWorkflow && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsProtocolModalOpen(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-md"
            />
            <motion.form
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.98 }}
              onSubmit={handleSaveProtocol}
              className="relative w-full max-w-3xl rounded-[2rem] border border-outline-variant/15 bg-white p-8 shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[0.625rem] font-bold uppercase tracking-[0.2em] text-primary">
                    Hand-off protocol
                  </p>
                  <h3 className="mt-2 text-2xl font-extrabold text-primary">
                    Configure workflow transfer rules
                  </h3>
                  <p className="mt-2 text-sm text-secondary">
                    Define how artifacts, approvals, and execution context move between agents and SDLC phases.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsProtocolModalOpen(false)}
                  className="rounded-full p-2 text-slate-400 transition-colors hover:bg-surface-container-low hover:text-primary"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="mt-8 grid gap-5 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Source step</span>
                  <select
                    value={protocolDraft.sourceStepId}
                    onChange={event =>
                      setProtocolDraft(prev => ({ ...prev, sourceStepId: event.target.value }))
                    }
                    className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  >
                    {selectedWorkflow.steps.map(step => (
                      <option key={step.id} value={step.id}>
                        {step.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Target phase</span>
                  <select
                    value={protocolDraft.targetPhase}
                    onChange={event =>
                      setProtocolDraft(prev => ({
                        ...prev,
                        targetPhase: event.target.value as WorkItemPhase,
                      }))
                    }
                    className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  >
                    {SDLC_BOARD_PHASES.filter(phase => phase !== 'BACKLOG').map(phase => (
                      <option key={phase} value={phase}>
                        {phase}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-2 md:col-span-2">
                  <span className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Protocol name</span>
                  <input
                    required
                    value={protocolDraft.name}
                    onChange={event =>
                      setProtocolDraft(prev => ({ ...prev, name: event.target.value }))
                    }
                    placeholder="e.g. Secure QA evidence hand-off"
                    className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Target agent</span>
                  <select
                    value={protocolDraft.targetAgentId}
                    onChange={event =>
                      setProtocolDraft(prev => ({ ...prev, targetAgentId: event.target.value }))
                    }
                    className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">No target agent</option>
                    {workspace.agents.map(agent => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Description</span>
                  <input
                    value={protocolDraft.description}
                    onChange={event =>
                      setProtocolDraft(prev => ({ ...prev, description: event.target.value }))
                    }
                    placeholder="What this hand-off validates and why it matters."
                    className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  />
                </label>

                <label className="space-y-2 md:col-span-2">
                  <span className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Rules</span>
                  <textarea
                    value={protocolDraft.rules}
                    onChange={event =>
                      setProtocolDraft(prev => ({ ...prev, rules: event.target.value }))
                    }
                    placeholder={'Validate source artifacts\nAttach evidence and unresolved risks\nPublish hand-off summary'}
                    className="h-28 w-full resize-none rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  />
                </label>

                <label className="flex items-center gap-3 rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3">
                  <input
                    type="checkbox"
                    checked={protocolDraft.validationRequired}
                    onChange={event =>
                      setProtocolDraft(prev => ({
                        ...prev,
                        validationRequired: event.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-outline-variant"
                  />
                  <div>
                    <p className="text-sm font-bold text-on-surface">Require validation</p>
                    <p className="text-[0.6875rem] text-secondary">
                      Keep the hand-off gated until artifacts and criteria are validated.
                    </p>
                  </div>
                </label>

                <label className="flex items-center gap-3 rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3">
                  <input
                    type="checkbox"
                    checked={protocolDraft.autoDocumentation}
                    onChange={event =>
                      setProtocolDraft(prev => ({
                        ...prev,
                        autoDocumentation: event.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-outline-variant"
                  />
                  <div>
                    <p className="text-sm font-bold text-on-surface">Auto-document hand-off</p>
                    <p className="text-[0.6875rem] text-secondary">
                      Publish the protocol summary and evidence trail automatically.
                    </p>
                  </div>
                </label>
              </div>

              <div className="mt-8 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsProtocolModalOpen(false)}
                  className="flex-1 rounded-2xl border border-outline-variant/20 px-5 py-3 text-sm font-bold text-secondary transition-all hover:bg-surface-container-low"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-all hover:brightness-110"
                >
                  Save Protocol
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
