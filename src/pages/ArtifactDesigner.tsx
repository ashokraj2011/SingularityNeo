import React, {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
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
import { useToast } from '../context/ToastContext';
import {
  Artifact,
  ArtifactTemplateSection,
  ArtifactTemplateSectionType,
  CapabilityWorkspace,
} from '../types';
import ArtifactPreview from '../components/ArtifactPreview';

const TEMPLATE_ROW_HEIGHT_PX = 76;
const TEMPLATE_ROW_OVERSCAN = 8;

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
  sections: ArtifactTemplateSection[];
};

const createArtifactId = () => `ART-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const createArtifactSectionId = () =>
  `ASEC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const splitDraftLines = (value: string) =>
  value
    .split(/\n|,/)
    .map(item => item.trim())
    .filter(Boolean);

const SECTION_TYPE_LABELS: Record<ArtifactTemplateSectionType, string> = {
  FREE_TEXT: 'Free text',
  DECISION_BOX: 'Decision box',
  CHANGE_LOG: 'Change log',
  LEARNING_RECORD: 'Learning record',
  CHECKLIST: 'Checklist',
  CUSTOM: 'Custom',
};

const createArtifactSection = (
  title = 'New Section',
  type: ArtifactTemplateSectionType = 'CUSTOM',
  required = false,
  content = '',
): ArtifactTemplateSection => ({
  id: createArtifactSectionId(),
  title,
  type,
  required,
  content,
});

const buildDefaultArtifactSections = (artifact?: Artifact): ArtifactTemplateSection[] => {
  if (artifact?.templateSections?.length) {
    return artifact.templateSections;
  }

  const decisions = (artifact?.decisions || []).join('\n');
  const changes = (artifact?.changes || []).join('\n');
  const learningInsights = (artifact?.learningInsights || []).join('\n');

  return [
    createArtifactSection('Title & Status', 'FREE_TEXT', true, artifact?.name || ''),
    createArtifactSection(
      'Context & Rationale',
      'FREE_TEXT',
      true,
      artifact?.description || '',
    ),
    createArtifactSection('Strategic Decisions', 'DECISION_BOX', true, decisions),
    createArtifactSection('System Changes', 'CHANGE_LOG', true, changes),
    createArtifactSection('Agent Learning Insights', 'LEARNING_RECORD', false, learningInsights),
  ];
};

const sectionsToDraftField = (
  sections: ArtifactTemplateSection[],
  type: ArtifactTemplateSectionType,
) =>
  sections
    .filter(section => section.type === type)
    .map(section => section.content || '')
    .filter(Boolean)
    .join('\n');

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
  sections: buildDefaultArtifactSections(artifact),
});

const getCreatedLabel = () =>
  new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

const DOCUMENTATION_STATUS_HELP: Record<
  NonNullable<Artifact['documentationStatus']>,
  string
> = {
  PENDING:
    'Pending means the artifact template exists, but its supporting documentation or final write-up is not confirmed yet. This is a manual tracking field today.',
  SYNCED:
    'Synced means the template is aligned with the latest documentation or published reference and is ready to reuse.',
  FAILED:
    'Failed means the documentation update or alignment is known to be broken and needs manual attention before teams rely on it.',
};

const ARTIFACT_ROLE_HELP: Record<NonNullable<Artifact['direction']>, string> = {
  INPUT:
    'Input to agent means this document is primarily consumed by the connected agent as starting context.',
  OUTPUT:
    'Output from agent means this document is primarily expected to be produced or published by the connected agent.',
};

const getArtifactRoleLabel = (direction: NonNullable<Artifact['direction']>) =>
  direction === 'INPUT' ? 'Input to agent' : 'Output from agent';

const buildDraftPreviewMarkdown = ({
  artifactDraft,
  agentName,
}: {
  artifactDraft: ArtifactDraft;
  agentName?: string;
}) => {
  const lines = [
    `# ${artifactDraft.name.trim() || 'Untitled Artifact'}`,
    '',
    `- Category: ${artifactDraft.type || 'Unspecified'}`,
    `- Version: ${artifactDraft.version || 'v1.0.0'}`,
    `- Artifact role: ${getArtifactRoleLabel(artifactDraft.direction)}`,
    `- Connected agent: ${agentName || artifactDraft.connectedAgentId || 'Unassigned'}`,
    `- Documentation status: ${artifactDraft.documentationStatus}`,
  ];

  if (artifactDraft.description.trim()) {
    lines.push('', '## Description', '', artifactDraft.description.trim());
  }

  if (artifactDraft.template.trim()) {
    lines.push('', '## Template Key', '', artifactDraft.template.trim());
  }

  if (artifactDraft.sections.length > 0) {
    lines.push('', '## Template Sections');
    artifactDraft.sections.forEach(section => {
      lines.push(
        '',
        `### ${section.title || 'Untitled Section'}`,
        '',
        `- Type: ${SECTION_TYPE_LABELS[section.type]}`,
        `- Required: ${section.required ? 'Yes' : 'No'}`,
      );

      if (section.content?.trim()) {
        lines.push('', section.content.trim());
      }
    });
  }

  const governanceRules = splitDraftLines(artifactDraft.governanceRules);
  if (governanceRules.length > 0) {
    lines.push('', '## Governance Rules', '', ...governanceRules.map(item => `- ${item}`));
  }

  return lines.join('\n').trim();
};

const buildDerivedArtifacts = (workspace: CapabilityWorkspace) => {
  const artifactsById = new Map(workspace.artifacts.map(artifact => [artifact.id, artifact]));
  const derived = new Map<string, Artifact>();

  workspace.tasks.forEach(task => {
    (task.producedOutputs || []).forEach((output, index) => {
      const artifactId = output.artifactId || `${task.id}-OUTPUT-${index + 1}`;
      if (artifactsById.has(artifactId) || derived.has(artifactId)) {
        return;
      }

      derived.set(artifactId, {
        id: artifactId,
        name: output.name,
        capabilityId: task.capabilityId,
        type:
          task.taskType === 'TEST'
            ? 'Test Evidence'
            : task.taskType === 'GOVERNANCE'
            ? 'Governance Evidence'
            : 'Execution Output',
        version: task.phase ? `${task.phase.toLowerCase()}-output` : 'workflow-output',
        agent: task.agent,
        created: task.timestamp,
        description: task.executionNotes,
        direction: 'OUTPUT',
        connectedAgentId: task.agent,
        sourceWorkflowId: task.workflowId,
        runId: task.runId,
        runStepId: task.runStepId,
        toolInvocationId: task.toolInvocationId,
        summary: task.executionNotes,
      });
    });
  });

  workspace.executionLogs.forEach(log => {
    const outputTitle =
      typeof log.metadata?.outputTitle === 'string' ? log.metadata.outputTitle : undefined;
    const outputSummary =
      typeof log.metadata?.outputSummary === 'string'
        ? log.metadata.outputSummary
        : undefined;
    const artifactId =
      typeof log.metadata?.artifactId === 'string' ? log.metadata.artifactId : undefined;

    if (!outputTitle && !outputSummary) {
      return;
    }

    const derivedId = artifactId || `${log.id}-OUTPUT`;
    if (artifactsById.has(derivedId) || derived.has(derivedId)) {
      return;
    }

    derived.set(derivedId, {
      id: derivedId,
      name: outputTitle || 'Workflow Output',
      capabilityId: log.capabilityId,
      type: 'Execution Output',
      version: 'runtime-output',
      agent: log.agentId,
      created: log.timestamp,
      description: outputSummary || log.message,
      direction: 'OUTPUT',
      connectedAgentId: log.agentId,
      runId: log.runId,
      runStepId: log.runStepId,
      toolInvocationId: log.toolInvocationId,
      summary: outputSummary || log.message,
    });
  });

  return Array.from(derived.values()).sort((left, right) =>
    String(right.created).localeCompare(String(left.created)),
  );
};

const ArtifactDesigner = () => {
  const {
    activeCapability,
    getCapabilityWorkspace,
    setCapabilityWorkspaceContent,
    updateCapabilityAgent,
  } = useCapability();
  const { success } = useToast();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [activeTab, setActiveTab] = useState<'definition' | 'sections' | 'governance'>('definition');
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [isSelecting, startTransition] = useTransition();

  const listRef = useRef<HTMLDivElement | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef(0);
  const [listViewportHeight, setListViewportHeight] = useState(520);
  const [listScrollTop, setListScrollTop] = useState(0);
  const [artifactDraft, setArtifactDraft] = useState<ArtifactDraft>(() =>
    buildArtifactDraft(undefined, workspace.agents[0]?.id || ''),
  );

  const allArtifacts = useMemo(
    () => [...workspace.artifacts, ...buildDerivedArtifacts(workspace)],
    [workspace],
  );

  const filteredArtifacts = useMemo(() => {
    const normalizedQuery = deferredSearchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return allArtifacts;
    }

    return allArtifacts.filter(artifact =>
      artifact.name.toLowerCase().includes(normalizedQuery),
    );
  }, [allArtifacts, deferredSearchQuery]);

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
    startTransition(() => {
      setIsCreatingNew(false);
      setSelectedArtifactId(artifactId);
    });
  };

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    const update = () => setListViewportHeight(el.clientHeight || 520);
    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    // When filtering changes, reset scroll to avoid empty windows when the previous
    // scroll position is past the end of the new result set.
    el.scrollTop = 0;
    pendingScrollTopRef.current = 0;
    setListScrollTop(0);
  }, [activeCapability.id, deferredSearchQuery]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) {
        window.cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  const handleListScroll = (event: React.UIEvent<HTMLDivElement>) => {
    pendingScrollTopRef.current = event.currentTarget.scrollTop;
    if (scrollRafRef.current != null) return;

    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      setListScrollTop(pendingScrollTopRef.current);
    });
  };

  const { startIndex, totalHeight, visibleArtifacts } = useMemo(() => {
    const total = filteredArtifacts.length;
    const safeViewport =
      Number.isFinite(listViewportHeight) && listViewportHeight > 0 ? listViewportHeight : 520;

    const computedStart = Math.max(
      0,
      Math.floor(listScrollTop / TEMPLATE_ROW_HEIGHT_PX) - TEMPLATE_ROW_OVERSCAN,
    );
    const computedEnd = Math.min(
      total,
      Math.ceil((listScrollTop + safeViewport) / TEMPLATE_ROW_HEIGHT_PX) + TEMPLATE_ROW_OVERSCAN,
    );

    return {
      startIndex: computedStart,
      totalHeight: total * TEMPLATE_ROW_HEIGHT_PX,
      visibleArtifacts: filteredArtifacts.slice(computedStart, computedEnd),
    };
  }, [filteredArtifacts, listScrollTop, listViewportHeight]);

  const handleAddSection = () => {
    setArtifactDraft(current => ({
      ...current,
      sections: [...current.sections, createArtifactSection()],
    }));
  };

  const handleSectionChange = (
    sectionId: string,
    updates: Partial<ArtifactTemplateSection>,
  ) => {
    setArtifactDraft(current => ({
      ...current,
      sections: current.sections.map(section =>
        section.id === sectionId ? { ...section, ...updates } : section,
      ),
    }));
  };

  const handleRemoveSection = (sectionId: string) => {
    setArtifactDraft(current => ({
      ...current,
      sections: current.sections.filter(section => section.id !== sectionId),
    }));
  };

  const handleSaveTemplate = async () => {
    if (!artifactDraft.name.trim()) {
      return;
    }
    try {
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
      templateSections: artifactDraft.sections.map(section => ({
        id: section.id,
        title: section.title.trim() || 'Untitled Section',
        type: section.type,
        required: Boolean(section.required),
        content: section.content?.trim() || undefined,
      })),
      documentationStatus: artifactDraft.documentationStatus,
      description: artifactDraft.description.trim() || undefined,
      direction: artifactDraft.direction,
      connectedAgentId: artifactDraft.connectedAgentId || undefined,
      sourceWorkflowId: selectedArtifact?.sourceWorkflowId,
      decisions: splitDraftLines(
        sectionsToDraftField(artifactDraft.sections, 'DECISION_BOX') || artifactDraft.decisions,
      ),
      changes: splitDraftLines(
        sectionsToDraftField(artifactDraft.sections, 'CHANGE_LOG') || artifactDraft.changes,
      ),
      learningInsights: splitDraftLines(
        sectionsToDraftField(artifactDraft.sections, 'LEARNING_RECORD') ||
          artifactDraft.learningInsights,
      ),
      governanceRules: splitDraftLines(artifactDraft.governanceRules),
      isLearningArtifact: selectedArtifact?.isLearningArtifact,
      isMasterArtifact: selectedArtifact?.isMasterArtifact,
    };

      const existingPersistedArtifact = workspace.artifacts.find(
        artifact => artifact.id === selectedArtifact?.id,
      );
      const nextArtifacts = isCreatingNew
        ? [...workspace.artifacts, nextArtifact]
        : existingPersistedArtifact
        ? workspace.artifacts.map(artifact =>
            artifact.id === existingPersistedArtifact.id ? nextArtifact : artifact,
          )
        : [...workspace.artifacts, nextArtifact];

      const previousArtifact = isCreatingNew
        ? null
        : workspace.artifacts.find(artifact => artifact.id === selectedArtifact?.id) || null;
      const previousAgentId = previousArtifact?.connectedAgentId;
      if (previousAgentId) {
        const previousAgent = workspace.agents.find(agent => agent.id === previousAgentId);
        if (previousAgent) {
          await updateCapabilityAgent(activeCapability.id, previousAgentId, {
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

        await updateCapabilityAgent(activeCapability.id, producerAgent.id, {
          inputArtifacts,
          outputArtifacts,
        });
      }

      await setCapabilityWorkspaceContent(activeCapability.id, {
        artifacts: nextArtifacts,
      });
      setIsCreatingNew(false);
      setSelectedArtifactId(nextArtifact.id);
      success(
        isCreatingNew ? 'Artifact created' : 'Artifact updated',
        `${nextArtifact.name} is now saved in the capability ledger.`,
      );
    } catch (error) {
      // Context mutation paths already emit failure toasts.
      console.warn('Artifact save failed.', error);
    }
  };

  if (!selectedArtifact && !isCreatingNew) {
    return (
      <div className="flex min-h-[calc(100vh-160px)] items-center justify-center rounded-[2rem] border border-dashed border-outline-variant/20 bg-white p-10 text-center">
        <div className="max-w-md space-y-3">
          <h2 className="text-xl font-extrabold text-primary">
            {allArtifacts.length === 0
              ? 'No artifacts available yet'
              : 'No artifacts match this search'}
          </h2>
          <p className="text-sm leading-relaxed text-secondary">
            {allArtifacts.length === 0
              ? 'Artifacts are governed through capability workflows and agent input/output contracts. Workflow-produced outputs will now appear here even before they are formally curated.'
              : 'Try clearing the search or selecting a different workflow output to continue reviewing the artifact contract.'}
          </p>
          {allArtifacts.length === 0 && (
            <button
              onClick={handleCreateTemplate}
              className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-white transition-all hover:brightness-110"
            >
              <Plus size={16} />
              Start artifact draft
            </button>
          )}
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
  const connectedAgentName =
    workspace.agents.find(agent => agent.id === artifactDraft.connectedAgentId)?.name ||
    artifactDraft.connectedAgentId ||
    artifactPreview.agent;
  const artifactDocumentPreview = selectedArtifact?.contentJson
    ? {
        format: 'JSON',
        // Render JSON on-demand inside <ArtifactPreview /> to keep the workbench responsive
        // when artifacts contain very large payloads.
        jsonValue: selectedArtifact.contentJson,
        content: '',
      }
    : selectedArtifact?.contentText?.trim()
    ? {
        format: selectedArtifact.contentFormat || 'TEXT',
        content: selectedArtifact.contentText,
        jsonValue: undefined,
      }
    : {
        format: 'MARKDOWN',
        content: buildDraftPreviewMarkdown({
          artifactDraft,
          agentName: connectedAgentName,
        }),
        jsonValue: undefined,
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
          <p className="mt-1 text-sm text-secondary">
            Review governed artifacts and workflow-produced outputs, then curate them into durable capability artifacts.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleCreateTemplate}
            className="px-4 py-2 bg-primary text-white rounded-xl text-xs font-bold hover:brightness-110 transition-all flex items-center gap-2"
          >
            <Plus size={14} />
            Curate Artifact
          </button>
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
            {isCreatingNew && (
              <div className="px-4 pt-3">
                <button
                  type="button"
                  onClick={() => setIsCreatingNew(true)}
                  className="w-full rounded-xl border border-primary/20 bg-primary/5 p-3 text-left transition-all"
                >
                  <div className="flex items-center gap-2">
                    <Plus size={14} className="text-primary" />
                    <span className="text-xs font-bold text-primary">Artifact Draft</span>
                  </div>
                  <p className="mt-1 pl-6 text-[0.625rem] text-secondary">
                    Curating a durable artifact from workflow or agent output.
                  </p>
                </button>
              </div>
            )}
            <div
              ref={listRef}
              onScroll={handleListScroll}
              className="flex-1 overflow-y-auto p-2 custom-scrollbar"
            >
              {filteredArtifacts.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-[0.6875rem] font-bold uppercase tracking-widest text-slate-400">
                    No templates match your search
                  </p>
                </div>
              ) : (
                <div className="relative" style={{ height: totalHeight }}>
                  {visibleArtifacts.map((art, localIndex) => {
                    const index = startIndex + localIndex;
                    const isSelected = !isCreatingNew && selectedArtifactId === art.id;

                    return (
                      <div
                        key={art.id}
                        className="absolute left-0 right-0"
                        style={{
                          top: index * TEMPLATE_ROW_HEIGHT_PX,
                          height: TEMPLATE_ROW_HEIGHT_PX,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => handleSelectArtifact(art.id)}
                          className={cn(
                            "w-full h-full text-left p-3 rounded-xl transition-all group flex flex-col gap-1 border",
                            isSelected
                              ? "bg-primary/5 border-primary/20 shadow-sm"
                              : "bg-transparent border-transparent hover:bg-surface-container-low",
                          )}
                          aria-busy={isSelecting && isSelected ? true : undefined}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                              <FileText size={14} className={isSelected ? "text-primary" : "text-slate-400"} />
                              <span
                                className={cn(
                                  "text-xs font-bold transition-colors truncate",
                                  isSelected ? "text-primary" : "text-on-surface",
                                )}
                              >
                                {art.name}
                              </span>
                            </div>
                            {art.isMasterArtifact && (
                              <span className="text-[0.5rem] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded uppercase tracking-widest">
                                Master
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between pl-6">
                            <span className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest truncate">
                              {art.type}
                            </span>
                            <span className="text-[0.625rem] text-slate-300">{art.version}</span>
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
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
                      <label className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">Artifact Role</label>
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
                        <option value="INPUT">Input to agent</option>
                        <option value="OUTPUT">Output from agent</option>
                      </select>
                      <p className="text-xs leading-relaxed text-secondary">
                        {ARTIFACT_ROLE_HELP[artifactDraft.direction]}
                      </p>
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
                      <p className="text-xs leading-relaxed text-secondary">
                        {DOCUMENTATION_STATUS_HELP[artifactDraft.documentationStatus]}
                      </p>
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

                  <section className="space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-sm font-bold text-on-surface flex items-center gap-2 uppercase tracking-widest">
                          <BookOpen size={16} className="text-primary" />
                          Document Preview
                        </h3>
                        <p className="mt-1 text-sm text-secondary">
                          Preview the saved document when content exists, or a live generated preview from the current draft while you edit.
                        </p>
                      </div>
                      <div className="rounded-full bg-primary/5 px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.16em] text-primary">
                        {artifactDocumentPreview.format}
                      </div>
                    </div>
                    <div className="rounded-3xl border border-outline-variant/15 bg-surface-container-low px-5 py-5">
	                      <ArtifactPreview
	                        format={artifactDocumentPreview.format}
	                        content={artifactDocumentPreview.content}
	                        jsonValue={artifactDocumentPreview.jsonValue}
	                        emptyLabel="This artifact does not have previewable content yet."
	                      />
                    </div>
                  </section>
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
                    <button
                      type="button"
                      onClick={handleAddSection}
                      className="px-4 py-2 bg-primary text-white text-xs font-bold rounded-xl flex items-center gap-2"
                    >
                      <Plus size={14} /> Add Section
                    </button>
                  </div>

                  <div className="space-y-3">
                    {artifactDraft.sections.map(section => (
                      <div
                        key={section.id}
                        className="space-y-4 rounded-2xl border border-outline-variant/10 bg-surface-container-low p-4 transition-all hover:border-primary/20"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-outline shadow-sm">
                              {section.type === 'DECISION_BOX' ? (
                                <ShieldCheck size={18} />
                              ) : section.type === 'CHANGE_LOG' ? (
                                <History size={18} />
                              ) : section.type === 'LEARNING_RECORD' ? (
                                <Sparkles size={18} />
                              ) : section.type === 'CHECKLIST' ? (
                                <CheckCircle2 size={18} />
                              ) : section.type === 'FREE_TEXT' ? (
                                <Compass size={18} />
                              ) : (
                                <FileText size={18} />
                              )}
                            </div>
                            <div>
                              <p className="text-sm font-bold text-on-surface">
                                {section.title || 'Untitled Section'}
                              </p>
                              <p className="text-[0.625rem] font-medium uppercase tracking-tighter text-secondary">
                                {SECTION_TYPE_LABELS[section.type]}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveSection(section.id)}
                            className="rounded-lg p-2 text-slate-300 transition-colors hover:text-error"
                            aria-label={`Remove ${section.title || 'section'}`}
                          >
                            <X size={16} />
                          </button>
                        </div>

                        <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_auto]">
                          <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                            <span>Section Title</span>
                            <input
                              value={section.title}
                              onChange={event =>
                                handleSectionChange(section.id, { title: event.target.value })
                              }
                              className="enterprise-input"
                            />
                          </label>
                          <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                            <span>Section Type</span>
                            <select
                              value={section.type}
                              onChange={event =>
                                handleSectionChange(section.id, {
                                  type: event.target.value as ArtifactTemplateSectionType,
                                })
                              }
                              className="enterprise-input"
                            >
                              {Object.entries(SECTION_TYPE_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex items-end gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                            <input
                              type="checkbox"
                              checked={section.required}
                              onChange={event =>
                                handleSectionChange(section.id, { required: event.target.checked })
                              }
                              className="h-4 w-4 rounded border-outline-variant/40"
                            />
                            <span className="pb-1">Required</span>
                          </label>
                        </div>

                        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                          <span>Section Content</span>
                          <textarea
                            rows={section.type === 'FREE_TEXT' ? 5 : 4}
                            value={section.content || ''}
                            onChange={event =>
                              handleSectionChange(section.id, { content: event.target.value })
                            }
                            placeholder="Describe what this section should contain or provide starter content."
                            className="enterprise-input min-h-[8rem]"
                          />
                        </label>
                      </div>
                    ))}
                  </div>

                  {artifactDraft.sections.length === 0 ? (
                    <div className="rounded-2xl border-2 border-dashed border-outline-variant/20 px-6 py-10 text-center">
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                        No sections yet
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-secondary">
                        Add a section to define the structure and expected content for this artifact template.
                      </p>
                    </div>
                  ) : null}
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
              <button
                onClick={() => {
                  if (selectedArtifact && !isCreatingNew) {
                    setArtifactDraft(
                      buildArtifactDraft(selectedArtifact, workspace.agents[0]?.id || ''),
                    );
                  } else {
                    setIsCreatingNew(false);
                    setArtifactDraft(
                      buildArtifactDraft(undefined, workspace.agents[0]?.id || ''),
                    );
                  }
                }}
                className="px-6 py-2 text-sm font-bold text-secondary hover:bg-surface-container-low rounded-xl transition-all"
              >
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
