import type {
  Capability,
  CapabilityLifecycle,
  CapabilityLifecyclePhase,
  CapabilityWorkspace,
  RetiredCapabilityLifecyclePhase,
  Workflow,
  WorkflowPhaseId,
} from '../types';

export const SYSTEM_BACKLOG_PHASE_ID = 'BACKLOG' as const;
export const SYSTEM_DONE_PHASE_ID = 'DONE' as const;

export const SYSTEM_PHASE_IDS = [
  SYSTEM_BACKLOG_PHASE_ID,
  SYSTEM_DONE_PHASE_ID,
] as const;

const DEFAULT_VISIBLE_PHASES: CapabilityLifecyclePhase[] = [
  { id: 'ANALYSIS', label: 'Analysis' },
  { id: 'DESIGN', label: 'Design' },
  { id: 'DEVELOPMENT', label: 'Development' },
  { id: 'QA', label: 'QA' },
  { id: 'GOVERNANCE', label: 'Governance' },
  { id: 'RELEASE', label: 'Release' },
];

export const BROKERAGE_VISIBLE_PHASES: CapabilityLifecyclePhase[] = [
  {
    id: 'INCEPTION',
    label: 'Inception',
    description: 'Define intent, scope, and early proof-of-concept direction.',
  },
  {
    id: 'ELABORATION',
    label: 'Elaboration',
    description: 'Shape the solution, architecture, and readiness for build.',
  },
  {
    id: 'CONSTRUCTION',
    label: 'Construction',
    description: 'Build, validate, and harden the delivery candidate.',
  },
  {
    id: 'DELIVERY',
    label: 'Delivery',
    description: 'Deploy, operate, and stabilize the released outcome.',
  },
];

const createPhaseLabelFromId = (phaseId?: string) =>
  String(phaseId || '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, character => character.toUpperCase());

const normalizePhaseId = (value?: string) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const clonePhase = (
  phase: CapabilityLifecyclePhase,
): CapabilityLifecyclePhase => ({
  id: phase.id,
  label: phase.label,
  description: phase.description,
});

const cloneRetiredPhase = (
  phase: RetiredCapabilityLifecyclePhase,
): RetiredCapabilityLifecyclePhase => ({
  id: phase.id,
  label: phase.label,
  description: phase.description,
  retiredAt: phase.retiredAt,
});

export const createDefaultCapabilityLifecycle = (): CapabilityLifecycle => ({
  version: 1,
  phases: DEFAULT_VISIBLE_PHASES.map(clonePhase),
  retiredPhases: [],
});

export const createBrokerageCapabilityLifecycle = (): CapabilityLifecycle => ({
  version: 1,
  phases: BROKERAGE_VISIBLE_PHASES.map(clonePhase),
  retiredPhases: [],
});

export const isSystemPhaseId = (
  phaseId?: string | null,
): phaseId is (typeof SYSTEM_PHASE_IDS)[number] =>
  phaseId === SYSTEM_BACKLOG_PHASE_ID || phaseId === SYSTEM_DONE_PHASE_ID;

export const isVisibleLifecyclePhaseId = (
  lifecycle: CapabilityLifecycle,
  phaseId?: string | null,
) =>
  Boolean(
    phaseId && lifecycle.phases.some(phase => phase.id === phaseId),
  );

export const normalizeCapabilityLifecycle = (
  lifecycle?: Partial<CapabilityLifecycle> | null,
): CapabilityLifecycle => {
  const sourcePhases = Array.isArray(lifecycle?.phases)
    ? lifecycle?.phases
    : DEFAULT_VISIBLE_PHASES;
  const seenIds = new Set<string>();
  const normalizedPhases = sourcePhases
    .map(phase => {
      const phaseId = normalizePhaseId(phase?.id || phase?.label);
      if (!phaseId || isSystemPhaseId(phaseId) || seenIds.has(phaseId)) {
        return null;
      }
      seenIds.add(phaseId);
      return {
        id: phaseId,
        label: String(phase?.label || createPhaseLabelFromId(phaseId)).trim(),
        description: phase?.description?.trim() || undefined,
      } satisfies CapabilityLifecyclePhase;
    })
    .filter(Boolean) as CapabilityLifecyclePhase[];

  const safePhases =
    normalizedPhases.length > 0
      ? normalizedPhases
      : DEFAULT_VISIBLE_PHASES.map(clonePhase);
  const retiredSeenIds = new Set<string>(safePhases.map(phase => phase.id));
  const retiredPhases = (Array.isArray(lifecycle?.retiredPhases)
    ? lifecycle?.retiredPhases
    : []
  )
    .map(phase => {
      const phaseId = normalizePhaseId(phase?.id || phase?.label);
      if (!phaseId || isSystemPhaseId(phaseId) || retiredSeenIds.has(phaseId)) {
        return null;
      }
      retiredSeenIds.add(phaseId);
      return {
        id: phaseId,
        label: String(phase?.label || createPhaseLabelFromId(phaseId)).trim(),
        description: phase?.description?.trim() || undefined,
        retiredAt:
          phase?.retiredAt || new Date().toISOString(),
      } satisfies RetiredCapabilityLifecyclePhase;
    })
    .filter(Boolean) as RetiredCapabilityLifecyclePhase[];

  return {
    version: Number(lifecycle?.version || 1),
    phases: safePhases,
    retiredPhases,
    taskTypeEntryPhases: lifecycle?.taskTypeEntryPhases ?? undefined,
  };
};

export const ensureCapabilityLifecycle = <
  T extends {
    lifecycle?: CapabilityLifecycle | null;
  },
>(
  capability: T,
): T & { lifecycle: CapabilityLifecycle } => ({
  ...capability,
  lifecycle: normalizeCapabilityLifecycle(capability.lifecycle),
});

const resolveLifecycle = (
  source?: CapabilityLifecycle | Pick<Capability, 'lifecycle'> | null,
) => {
  if (!source) {
    return normalizeCapabilityLifecycle();
  }

  return normalizeCapabilityLifecycle(
    'lifecycle' in source ? source.lifecycle : source,
  );
};

export const getCapabilityVisibleLifecyclePhases = (
  source?: CapabilityLifecycle | Pick<Capability, 'lifecycle'> | null,
) => resolveLifecycle(source).phases.map(clonePhase);

export const getCapabilityRetiredLifecyclePhases = (
  source?: CapabilityLifecycle | Pick<Capability, 'lifecycle'> | null,
) => resolveLifecycle(source).retiredPhases.map(cloneRetiredPhase);

export const getCapabilityBoardPhaseIds = (
  source?: CapabilityLifecycle | Pick<Capability, 'lifecycle'> | null,
): WorkflowPhaseId[] => [
  SYSTEM_BACKLOG_PHASE_ID,
  ...getCapabilityVisibleLifecyclePhases(source).map(phase => phase.id),
  SYSTEM_DONE_PHASE_ID,
];

export const getCapabilityGraphPhaseIds = (
  source?: CapabilityLifecycle | Pick<Capability, 'lifecycle'> | null,
): WorkflowPhaseId[] =>
  getCapabilityVisibleLifecyclePhases(source).map(phase => phase.id);

export const getLifecyclePhaseDefinition = (
  source: CapabilityLifecycle | Pick<Capability, 'lifecycle'> | null | undefined,
  phaseId?: string | null,
) => {
  if (!phaseId) {
    return undefined;
  }
  const lifecycle = resolveLifecycle(source);
  return (
    lifecycle.phases.find(phase => phase.id === phaseId) ||
    lifecycle.retiredPhases.find(phase => phase.id === phaseId)
  );
};

export const getLifecyclePhaseLabel = (
  source: CapabilityLifecycle | Pick<Capability, 'lifecycle'> | null | undefined,
  phaseId?: string | null,
) => {
  if (!phaseId) {
    return 'Unscoped';
  }
  if (phaseId === SYSTEM_BACKLOG_PHASE_ID) {
    return 'Backlog';
  }
  if (phaseId === SYSTEM_DONE_PHASE_ID) {
    return 'Done';
  }

  return (
    getLifecyclePhaseDefinition(source, phaseId)?.label ||
    createPhaseLabelFromId(phaseId)
  );
};

export const getDefaultLifecycleStartPhaseId = (
  source?: CapabilityLifecycle | Pick<Capability, 'lifecycle'> | null,
) => getCapabilityVisibleLifecyclePhases(source)[0]?.id || DEFAULT_VISIBLE_PHASES[0].id;

export const getDefaultLifecycleEndPhaseId = (
  source?: CapabilityLifecycle | Pick<Capability, 'lifecycle'> | null,
) => {
  const phases = getCapabilityVisibleLifecyclePhases(source);
  return phases[phases.length - 1]?.id || DEFAULT_VISIBLE_PHASES[DEFAULT_VISIBLE_PHASES.length - 1].id;
};

export const createLifecyclePhase = (
  label: string,
  existingIds: string[] = [],
): CapabilityLifecyclePhase => {
  const baseId = normalizePhaseId(label) || `PHASE_${existingIds.length + 1}`;
  const existing = new Set(existingIds.map(normalizePhaseId));
  let nextId = baseId;
  let counter = 2;
  while (existing.has(nextId) || isSystemPhaseId(nextId)) {
    nextId = `${baseId}_${counter}`;
    counter += 1;
  }

  return {
    id: nextId,
    label: label.trim() || createPhaseLabelFromId(nextId),
  };
};

export const isValidCapabilityPhase = (
  source: CapabilityLifecycle | Pick<Capability, 'lifecycle'> | null | undefined,
  phaseId?: string | null,
) =>
  Boolean(
    phaseId &&
      (isSystemPhaseId(phaseId) ||
        getCapabilityVisibleLifecyclePhases(source).some(phase => phase.id === phaseId) ||
        getCapabilityRetiredLifecyclePhases(source).some(phase => phase.id === phaseId)),
  );

export const renameLifecyclePhase = (
  lifecycle: CapabilityLifecycle,
  phaseId: string,
  label: string,
): CapabilityLifecycle => ({
  ...lifecycle,
  phases: lifecycle.phases.map(phase =>
    phase.id === phaseId
      ? {
          ...phase,
          label: label.trim() || phase.label,
        }
      : phase,
  ),
});

export const moveLifecyclePhase = (
  lifecycle: CapabilityLifecycle,
  phaseId: string,
  direction: 'up' | 'down',
): CapabilityLifecycle => {
  const currentIndex = lifecycle.phases.findIndex(phase => phase.id === phaseId);
  if (currentIndex === -1) {
    return lifecycle;
  }

  const nextIndex =
    direction === 'up'
      ? Math.max(currentIndex - 1, 0)
      : Math.min(currentIndex + 1, lifecycle.phases.length - 1);
  if (nextIndex === currentIndex) {
    return lifecycle;
  }

  const nextPhases = [...lifecycle.phases];
  const [movedPhase] = nextPhases.splice(currentIndex, 1);
  nextPhases.splice(nextIndex, 0, movedPhase);
  return {
    ...lifecycle,
    phases: nextPhases,
  };
};

export const retireLifecyclePhase = (
  lifecycle: CapabilityLifecycle,
  phaseId: string,
): CapabilityLifecycle => {
  const phase = lifecycle.phases.find(candidate => candidate.id === phaseId);
  if (!phase) {
    return lifecycle;
  }

  return {
    ...lifecycle,
    phases: lifecycle.phases.filter(candidate => candidate.id !== phaseId),
    retiredPhases: [
      ...lifecycle.retiredPhases.filter(candidate => candidate.id !== phaseId),
      {
        ...phase,
        retiredAt: new Date().toISOString(),
      },
    ],
  };
};

export const remapWorkflowPhaseReferences = (
  workflows: Workflow[],
  fromPhaseId: string,
  toPhaseId: string,
): Workflow[] =>
  workflows.map(workflow => ({
    ...workflow,
    nodes: (workflow.nodes || []).map(node =>
      node.phase === fromPhaseId ? { ...node, phase: toPhaseId } : node,
    ),
    steps: workflow.steps.map(step => ({
      ...step,
      phase: step.phase === fromPhaseId ? toPhaseId : step.phase,
      handoffToPhase:
        step.handoffToPhase === fromPhaseId ? toPhaseId : step.handoffToPhase,
    })),
    handoffProtocols: (workflow.handoffProtocols || []).map(protocol => ({
      ...protocol,
      targetPhase:
        protocol.targetPhase === fromPhaseId ? toPhaseId : protocol.targetPhase,
    })),
  }));

export const getLifecyclePhaseUsage = (
  workspace: Pick<CapabilityWorkspace, 'workItems' | 'tasks'>,
  workflows: Workflow[],
  phaseId: string,
) => {
  const workflowNodeCount = workflows.reduce(
    (count, workflow) =>
      count + (workflow.nodes || []).filter(node => node.phase === phaseId).length,
    0,
  );
  const workflowStepCount = workflows.reduce(
    (count, workflow) =>
      count + workflow.steps.filter(step => step.phase === phaseId).length,
    0,
  );
  const handoffTargetCount = workflows.reduce(
    (count, workflow) =>
      count +
      workflow.steps.filter(step => step.handoffToPhase === phaseId).length +
      (workflow.handoffProtocols || []).filter(protocol => protocol.targetPhase === phaseId)
        .length,
    0,
  );
  const activeWorkItemCount = workspace.workItems.filter(
    item => item.phase === phaseId && item.status !== 'COMPLETED',
  ).length;
  const pendingTaskCount = workspace.tasks.filter(
    task => task.phase === phaseId && task.status !== 'COMPLETED',
  ).length;

  return {
    workflowNodeCount,
    workflowStepCount,
    handoffTargetCount,
    activeWorkItemCount,
    pendingTaskCount,
  };
};
