import type {
  AgentLearningStatus,
  Capability,
  CapabilityAgent,
  CapabilityWorkspace,
  GoldenPathProgress,
  WorkspaceRole,
  WorkItem,
} from '../types';
import { CAPABILITIES } from '../constants';
import type { RuntimeStatus } from './api';
import type { EnterpriseTone } from './enterprise';
import { selectPrimaryCopilotAgentId } from './agentProfiles';
import {
  hasMeaningfulExecutionCommandTemplate,
  isWorkspacePathInsideApprovedRoot,
} from './executionConfig';

export type CapabilityReadinessStatus =
  | 'READY'
  | 'NEEDS_SETUP'
  | 'IN_PROGRESS'
  | 'NEEDS_ATTENTION';

export interface CapabilityReadinessItem {
  id: string;
  label: string;
  description: string;
  status: CapabilityReadinessStatus;
  actionLabel: string;
  path: string;
  isBlocking?: boolean;
  blockingReason?: string;
  nextRequiredAction?: string;
}

export interface CapabilityNextAction {
  id: string;
  title: string;
  description: string;
  actionLabel: string;
  path: string;
  tone: EnterpriseTone;
}

export interface UserFacingRuntimeHealth {
  label: string;
  description: string;
  tone: EnterpriseTone;
  actionLabel: string;
  path: string;
}

export interface UserFacingAgentHealth {
  label: string;
  description: string;
  tone: EnterpriseTone;
}

export type CapabilityTrustLevel =
  | 'DECLARED'
  | 'CONNECTED'
  | 'GROUNDED'
  | 'OPERABLE'
  | 'PROVEN';

export type CapabilityProofStatus =
  | 'READY'
  | 'IN_PROGRESS'
  | 'ACTION_NEEDED'
  | 'LOCKED';

export interface CapabilityProofMilestone {
  id: string;
  level: CapabilityTrustLevel;
  label: string;
  description: string;
  status: CapabilityProofStatus;
  proofSignal: string;
  actionLabel: string;
  path: string;
}

export interface CapabilityOutcomeContract {
  businessOutcome?: string;
  successMetrics: string[];
  definitionOfDone?: string;
  requiredEvidenceKinds: string[];
  operatingPolicySummary?: string;
  serviceBoundary: string[];
}

export type AdvancedToolId =
  | 'architecture'
  | 'identity'
  | 'access'
  | 'databases'
  | 'memory'
  | 'tool-access'
  | 'run-console'
  | 'evals'
  | 'skills'
  | 'artifact-designer'
  | 'tasks'
  | 'studio';

export type AdvancedToolAudience =
  | 'ALL'
  | 'OPERATORS'
  | 'BUILDERS'
  | 'ADMINS'
  | 'ARCHITECTS';

export type AdvancedToolExposureMode = 'ALWAYS' | 'WHEN_RELEVANT' | 'ON_DEMAND';

export interface AdvancedToolDescriptor {
  id: AdvancedToolId;
  label: string;
  shortName: string;
  path: string;
  description: string;
  audience: AdvancedToolAudience;
  exposureMode: AdvancedToolExposureMode;
  contextTriggers: string[];
}

export interface CapabilityExperienceModel {
  readinessItems: CapabilityReadinessItem[];
  blockingReadinessItems: CapabilityReadinessItem[];
  canStartDelivery: boolean;
  readinessScore: number;
  trustLevel: CapabilityTrustLevel;
  trustLabel: string;
  trustDescription: string;
  proofItems: CapabilityProofMilestone[];
  goldenPathProgress: GoldenPathProgress;
  outcomeContract: CapabilityOutcomeContract;
  nextAction: CapabilityNextAction;
  runtimeHealth: UserFacingRuntimeHealth;
  ownerAgent: CapabilityAgent | null;
  primaryCopilotAgent: CapabilityAgent | null;
  activeWorkCount: number;
  blockerCount: number;
  approvalCount: number;
  completedWorkCount: number;
  latestOutputCount: number;
}

export const ADVANCED_TOOL_DESCRIPTORS: AdvancedToolDescriptor[] = [
  {
    id: 'architecture',
    label: 'Architecture',
    shortName: 'Arch',
    path: '/architecture',
    description: 'Review the capability hierarchy, published contracts, dependency graph, and ALM rollups.',
    audience: 'ARCHITECTS',
    exposureMode: 'WHEN_RELEVANT',
    contextTriggers: ['COLLECTION_CAPABILITY', 'HAS_ARCHITECTURE_CONTEXT'],
  },
  {
    id: 'identity',
    label: 'Login',
    shortName: 'Login',
    path: '/login',
    description: 'Switch the active workspace operator and review the roles bound to this session.',
    audience: 'ALL',
    exposureMode: 'ALWAYS',
    contextTriggers: [],
  },
  {
    id: 'access',
    label: 'Users & Access',
    shortName: 'Access',
    path: '/access',
    description: 'Manage workspace users, teams, capability grants, inherited rollups, and access audit history.',
    audience: 'ADMINS',
    exposureMode: 'WHEN_RELEVANT',
    contextTriggers: ['HAS_MULTIUSER_CONTEXT'],
  },
  {
    id: 'databases',
    label: 'Database Setup',
    shortName: 'DB',
    path: '/workspace/databases',
    description: 'Initialize the workspace database and inspect shared platform foundations.',
    audience: 'ADMINS',
    exposureMode: 'WHEN_RELEVANT',
    contextTriggers: ['NEEDS_DATABASE_SETUP'],
  },
  {
    id: 'memory',
    label: 'Memory Explorer',
    shortName: 'Memory',
    path: '/memory',
    description: 'Inspect learned sources, retrieval grounding, and memory provenance.',
    audience: 'BUILDERS',
    exposureMode: 'WHEN_RELEVANT',
    contextTriggers: ['HAS_LEARNING_ACTIVITY'],
  },
  {
    id: 'tool-access',
    label: 'Rule Engine',
    shortName: 'Rules',
    path: '/tool-access',
    description: 'Review workflow rules, step-level tool access, approvals, and execution boundaries for this capability.',
    audience: 'BUILDERS',
    exposureMode: 'WHEN_RELEVANT',
    contextTriggers: ['HAS_WORKFLOW'],
  },
  {
    id: 'run-console',
    label: 'Run Console',
    shortName: 'Runs',
    path: '/run-console',
    description: 'Open runtime telemetry, traces, policy decisions, and live run events.',
    audience: 'OPERATORS',
    exposureMode: 'WHEN_RELEVANT',
    contextTriggers: ['HAS_WORK_ACTIVITY'],
  },
  {
    id: 'evals',
    label: 'Eval Center',
    shortName: 'Evals',
    path: '/evals',
    description: 'Review structured quality checks for agents and workflows.',
    audience: 'BUILDERS',
    exposureMode: 'WHEN_RELEVANT',
    contextTriggers: ['HAS_AGENT_ROSTER'],
  },
  {
    id: 'skills',
    label: 'Skill Library',
    shortName: 'Skills',
    path: '/skills',
    description: 'Manage reusable capability skills and specialist behaviors.',
    audience: 'BUILDERS',
    exposureMode: 'ON_DEMAND',
    contextTriggers: ['HAS_AGENT_ROSTER'],
  },
  {
    id: 'artifact-designer',
    label: 'Artifact Designer',
    shortName: 'Artifacts',
    path: '/artifact-designer',
    description: 'Edit reusable artifact templates and handoff structures.',
    audience: 'BUILDERS',
    exposureMode: 'ON_DEMAND',
    contextTriggers: ['HAS_WORKFLOW'],
  },
  {
    id: 'tasks',
    label: 'Tasks',
    shortName: 'Tasks',
    path: '/tasks',
    description: 'Inspect lower-level workflow-managed task records.',
    audience: 'OPERATORS',
    exposureMode: 'WHEN_RELEVANT',
    contextTriggers: ['HAS_TASK_ACTIVITY'],
  },
  {
    id: 'studio',
    label: 'Studio',
    shortName: 'Studio',
    path: '/studio',
    description: 'Open specialist authoring and skill composition tools.',
    audience: 'BUILDERS',
    exposureMode: 'ON_DEMAND',
    contextTriggers: ['HAS_AGENT_ROSTER'],
  },
];

const hasText = (value?: string) => Boolean(value?.trim());

const hasCapabilityOwner = (capability: Capability) =>
  hasText(capability.ownerTeam) ||
  capability.stakeholders.length > 0 ||
  capability.teamNames.length > 0;

const hasWorkspaceSource = (capability: Capability) =>
  capability.localDirectories.length > 0 ||
  Boolean(capability.executionConfig.defaultWorkspacePath) ||
  capability.executionConfig.allowedWorkspacePaths.length > 0;

const demoModeEnabled =
  String((import.meta as any).env?.VITE_ENABLE_DEMO_MODE || '').toLowerCase() === 'true';

const seededCapabilityIds = new Set(CAPABILITIES.map(capability => capability.id));

const hasConnectorSetup = (capability: Capability) =>
  capability.gitRepositories.length > 0 ||
  hasText(capability.jiraBoardLink) ||
  hasText(capability.confluenceLink) ||
  hasText(capability.documentationNotes);

const hasCommandTemplates = (capability: Capability) =>
  hasMeaningfulExecutionCommandTemplate(capability.executionConfig.commandTemplates);

const hasDeploymentTargetSetup = (capability: Capability) => {
  if (capability.executionConfig.deploymentTargets.length === 0) {
    return false;
  }

  const commandTemplateIds = new Set(
    capability.executionConfig.commandTemplates.map(template => template.id),
  );
  const approvedPaths = [
    capability.executionConfig.defaultWorkspacePath,
    ...capability.executionConfig.allowedWorkspacePaths,
    ...capability.localDirectories,
  ].filter(Boolean) as string[];

  return capability.executionConfig.deploymentTargets.every(
    target =>
      target.id &&
      target.label &&
      commandTemplateIds.has(target.commandTemplateId) &&
      (!target.workspacePath ||
        isWorkspacePathInsideApprovedRoot(target.workspacePath, approvedPaths)),
  );
};

const hasMinimalCapabilityContract = (capability: Capability) =>
  hasText(capability.description) &&
  hasCapabilityOwner(capability) &&
  hasText(capability.businessOutcome) &&
  capability.successMetrics.some(metric => metric.trim()) &&
  capability.requiredEvidenceKinds.some(kind => kind.trim()) &&
  hasText(capability.definitionOfDone);

const roleSet = (workspaceRoles: WorkspaceRole[]) => new Set(workspaceRoles || []);

const matchesAdvancedToolAudience = (
  tool: AdvancedToolDescriptor,
  workspaceRoles: WorkspaceRole[],
) => {
  const roles = roleSet(workspaceRoles);

  switch (tool.audience) {
    case 'ADMINS':
      return roles.has('WORKSPACE_ADMIN') || roles.has('PORTFOLIO_OWNER') || roles.has('TEAM_LEAD');
    case 'ARCHITECTS':
      return roles.has('WORKSPACE_ADMIN') || roles.has('PORTFOLIO_OWNER') || roles.has('TEAM_LEAD');
    case 'OPERATORS':
      return !roles.has('VIEWER');
    case 'BUILDERS':
      return !roles.has('VIEWER') && !roles.has('AUDITOR');
    default:
      return true;
  }
};

const matchesAdvancedToolTrigger = (
  trigger: string,
  capability: Capability,
  workspace: CapabilityWorkspace,
) => {
  switch (trigger) {
    case 'COLLECTION_CAPABILITY':
      return capability.capabilityKind === 'COLLECTION';
    case 'HAS_ARCHITECTURE_CONTEXT':
      return Boolean(
        capability.parentCapabilityId ||
          capability.sharedCapabilities?.length ||
          capability.dependencies.length ||
          capability.publishedSnapshots.length,
      );
    case 'HAS_MULTIUSER_CONTEXT':
      return Boolean(
        capability.phaseOwnershipRules?.length ||
          workspace.workflows.some(workflow =>
            workflow.steps.some(step => Boolean(step.ownershipRule)),
          ),
      );
    case 'NEEDS_DATABASE_SETUP':
      return workspace.workItems.length === 0 && workspace.workflows.length === 0;
    case 'HAS_LEARNING_ACTIVITY':
      return Boolean(
        workspace.learningUpdates.length ||
          workspace.agents.some(agent => (agent.learningProfile.sourceCount || 0) > 0),
      );
    case 'HAS_WORKFLOW':
      return workspace.workflows.length > 0;
    case 'HAS_WORK_ACTIVITY':
      return workspace.workItems.length > 0 || workspace.executionLogs.length > 0;
    case 'HAS_AGENT_ROSTER':
      return workspace.agents.length > 0;
    case 'HAS_TASK_ACTIVITY':
      return workspace.tasks.length > 0;
    default:
      return false;
  }
};

export const getVisibleAdvancedToolDescriptors = ({
  capability,
  workspace,
  workspaceRoles = [],
  includeOnDemand = false,
}: {
  capability: Capability;
  workspace: CapabilityWorkspace;
  workspaceRoles?: WorkspaceRole[];
  includeOnDemand?: boolean;
}) =>
  ADVANCED_TOOL_DESCRIPTORS.filter(tool => {
    if (!matchesAdvancedToolAudience(tool, workspaceRoles)) {
      return false;
    }

    if (tool.exposureMode === 'ALWAYS') {
      return true;
    }

    if (tool.exposureMode === 'ON_DEMAND') {
      return includeOnDemand;
    }

    return tool.contextTriggers.some(trigger =>
      matchesAdvancedToolTrigger(trigger, capability, workspace),
    );
  });

const getLearningStatuses = (agents: CapabilityAgent[]) =>
  agents.map(agent => agent.learningProfile.status);

export const getReadinessTone = (
  status: CapabilityReadinessStatus,
): EnterpriseTone => {
  switch (status) {
    case 'READY':
      return 'success';
    case 'IN_PROGRESS':
      return 'info';
    case 'NEEDS_ATTENTION':
      return 'warning';
    default:
      return 'neutral';
  }
};

export const getReadinessLabel = (status: CapabilityReadinessStatus) => {
  switch (status) {
    case 'READY':
      return 'Ready';
    case 'IN_PROGRESS':
      return 'In progress';
    case 'NEEDS_ATTENTION':
      return 'Needs attention';
    default:
      return 'Needs setup';
  }
};

export const getAgentHealth = (agent?: CapabilityAgent | null): UserFacingAgentHealth => {
  if (!agent) {
    return {
      label: 'Needs setup',
      description: 'Add an owner or specialist agent before using collaboration.',
      tone: 'neutral',
    };
  }

  switch (agent.learningProfile.status) {
    case 'READY':
      return {
        label: 'Ready to help',
        description:
          agent.learningProfile.summary || 'This collaborator has learned the capability context.',
        tone: 'success',
      };
    case 'LEARNING':
    case 'QUEUED':
      return {
        label: 'Learning',
        description: 'This collaborator is preparing its capability context.',
        tone: 'info',
      };
    case 'STALE':
      return {
        label: 'Needs refresh',
        description: 'Capability context changed. Refresh learning before critical work.',
        tone: 'warning',
      };
    case 'ERROR':
      return {
        label: 'Learning failed',
        description:
          agent.learningProfile.lastError ||
          'Learning could not finish. Check runtime setup, then refresh learning.',
        tone: 'danger',
      };
    default:
      return {
        label: 'Needs setup',
        description: 'Learning has not started for this collaborator yet.',
        tone: 'neutral',
      };
  }
};

export const getRuntimeHealth = (
  runtimeStatus?: RuntimeStatus | null,
): UserFacingRuntimeHealth => {
  if (!runtimeStatus) {
    return {
      label: 'Checking connection',
      description: 'Loading Copilot runtime ownership and connection status.',
      tone: 'info',
      actionLabel: 'Open run console',
      path: '/run-console',
    };
  }

  if (runtimeStatus.configured) {
    const runtimeOwnerLabel =
      runtimeStatus.runtimeOwner === 'DESKTOP'
        ? 'Desktop runtime'
        : 'Control-plane runtime';
    return {
      label: runtimeStatus.runtimeOwner === 'DESKTOP' ? 'Desktop connected' : 'Connected',
      description: runtimeStatus.githubIdentity?.login
        ? `${runtimeOwnerLabel} is connected as @${runtimeStatus.githubIdentity.login}.`
        : `${runtimeOwnerLabel} is available for agents and chat.`,
      tone: 'success',
      actionLabel: 'View runtime',
      path: '/run-console',
    };
  }

  return {
    label: runtimeStatus.lastRuntimeError ? 'Unavailable' : 'Needs Copilot setup',
    description:
      runtimeStatus.lastRuntimeError ||
      `Connect the ${runtimeStatus.runtimeOwner === 'DESKTOP' ? 'desktop' : 'runtime'} Copilot owner before starting agent work.`,
    tone: runtimeStatus.lastRuntimeError ? 'danger' : 'warning',
    actionLabel: 'Set up runtime',
    path: '/run-console',
  };
};

const getCapabilityBoundarySignals = (capability: Capability) =>
  [
    ...capability.applications,
    ...capability.apis,
    ...capability.databases,
    ...capability.gitRepositories,
    ...capability.localDirectories,
  ].filter(Boolean);

const buildOutcomeContract = (
  capability: Capability,
): CapabilityOutcomeContract => ({
  businessOutcome: capability.businessOutcome?.trim() || undefined,
  successMetrics: capability.successMetrics.filter(metric => metric.trim()),
  definitionOfDone: capability.definitionOfDone?.trim() || undefined,
  requiredEvidenceKinds: capability.requiredEvidenceKinds.filter(kind => kind.trim()),
  operatingPolicySummary: capability.operatingPolicySummary?.trim() || undefined,
  serviceBoundary: Array.from(new Set(getCapabilityBoundarySignals(capability))),
});

const buildProofItems = (
  capability: Capability,
  workspace: CapabilityWorkspace,
  runtimeStatus?: RuntimeStatus | null,
): CapabilityProofMilestone[] => {
  const activeWorkflows = workspace.workflows.filter(workflow => !workflow.archivedAt);
  const hasPublishedWorkflow = activeWorkflows.some(
    workflow => workflow.publishState === 'PUBLISHED' || workflow.publishState === 'VALIDATED',
  );
  const ownerAgent = workspace.agents.find(agent => agent.isOwner) || workspace.agents[0] || null;
  const learningStatuses = getLearningStatuses(workspace.agents);
  const sourceCount = workspace.agents.reduce(
    (total, agent) => total + (agent.learningProfile.sourceCount || 0),
    0,
  );
  const outputCount = workspace.artifacts.filter(artifact => artifact.direction !== 'INPUT').length;
  const completedWorkCount = workspace.workItems.filter(item => item.status === 'COMPLETED').length;
  const outcomeContract = buildOutcomeContract(capability);
  const hasBoundary = outcomeContract.serviceBoundary.length > 0;

  const milestoneStates = [
    {
      level: 'DECLARED' as const,
      label: 'Declared',
      description: 'Business purpose, owner, and success contract are defined.',
      ready:
        hasText(capability.description) &&
        (hasText(capability.domain) || hasText(capability.businessUnit)) &&
        hasCapabilityOwner(capability) &&
        hasText(capability.businessOutcome) &&
        outcomeContract.successMetrics.length > 0 &&
        hasBoundary,
      inProgress:
        hasText(capability.description) ||
        hasText(capability.businessOutcome) ||
        outcomeContract.successMetrics.length > 0,
      proofSignal: hasText(capability.businessOutcome)
        ? capability.businessOutcome!.trim()
        : 'Add a business outcome, success metrics, and service boundary.',
      actionLabel: 'Define business charter',
      path: '/capabilities/metadata',
    },
    {
      level: 'CONNECTED' as const,
      label: 'Connected',
      description: 'Real source systems and approved workspaces are linked to the capability.',
      ready: hasConnectorSetup(capability) && hasWorkspaceSource(capability),
      inProgress: hasConnectorSetup(capability) || hasWorkspaceSource(capability),
      proofSignal:
        hasConnectorSetup(capability) && hasWorkspaceSource(capability)
          ? `${capability.gitRepositories.length + capability.localDirectories.length} source locations and approved paths are linked.`
          : 'Link GitHub, Jira, Confluence, or approved local paths.',
      actionLabel: 'Connect sources',
      path: '/capabilities/metadata',
    },
    {
      level: 'GROUNDED' as const,
      label: 'Grounded',
      description: 'Collaborators have learned enough capability memory to help with confidence.',
      ready:
        Boolean(ownerAgent) &&
        learningStatuses.length > 0 &&
        learningStatuses.every(status => status === 'READY') &&
        sourceCount > 0,
      inProgress:
        Boolean(ownerAgent) &&
        (learningStatuses.some(status => ['QUEUED', 'LEARNING', 'STALE'].includes(status)) ||
          sourceCount > 0),
      proofSignal:
        sourceCount > 0
          ? `${sourceCount} learned source references are grounding the agents.`
          : 'Refresh learning so the agents can ground decisions in capability memory.',
      actionLabel: 'Review agent learning',
      path: '/team',
    },
    {
      level: 'OPERABLE' as const,
      label: 'Operable',
      description: 'Workflow, runtime, and meaningful execution commands are ready for real work.',
      ready:
        hasPublishedWorkflow &&
        runtimeStatus?.configured === true &&
        hasCommandTemplates(capability),
      inProgress:
        hasPublishedWorkflow ||
        runtimeStatus?.configured === true ||
        hasCommandTemplates(capability),
      proofSignal:
        hasPublishedWorkflow && runtimeStatus?.configured === true && hasCommandTemplates(capability)
          ? 'Published workflow, connected runtime, and real execution commands are available.'
          : 'Publish a workflow, connect the runtime, and replace generic command placeholders.',
      actionLabel: hasPublishedWorkflow ? 'Finish execution setup' : 'Prepare execution',
      path: hasPublishedWorkflow ? '/run-console' : '/designer',
    },
    {
      level: 'PROVEN' as const,
      label: 'Proven',
      description: 'A real work cycle has produced evidence that this capability can deliver.',
      ready: completedWorkCount > 0 && outputCount > 0,
      inProgress: workspace.workItems.length > 0 || workspace.artifacts.length > 0,
      proofSignal:
        completedWorkCount > 0 && outputCount > 0
          ? `${completedWorkCount} completed work item${completedWorkCount === 1 ? '' : 's'} produced ${outputCount} evidence output${outputCount === 1 ? '' : 's'}.`
          : 'Run one real work item through to evidence so this capability is proven.',
      actionLabel:
        workspace.workItems.length > 0 ? 'Review delivery evidence' : 'Run real work',
      path: workspace.workItems.length > 0 ? '/ledger' : '/?new=1',
    },
  ];

  let encounteredGap = false;

  return milestoneStates.map(item => {
    let status: CapabilityProofStatus;
    if (!encounteredGap && item.ready) {
      status = 'READY';
    } else if (!encounteredGap) {
      status = item.inProgress ? 'IN_PROGRESS' : 'ACTION_NEEDED';
      encounteredGap = true;
    } else {
      status = 'LOCKED';
    }

    return {
      id: item.level.toLowerCase(),
      level: item.level,
      label: item.label,
      description: item.description,
      status,
      proofSignal: item.proofSignal,
      actionLabel: item.actionLabel,
      path: item.path,
    };
  });
};

const getTrustLevel = (proofItems: CapabilityProofMilestone[]): CapabilityTrustLevel => {
  const highestReady = [...proofItems]
    .reverse()
    .find(item => item.status === 'READY');

  return highestReady?.level || 'DECLARED';
};

export const getTrustLevelLabel = (level: CapabilityTrustLevel) => {
  switch (level) {
    case 'PROVEN':
      return 'Proven';
    case 'OPERABLE':
      return 'Operable';
    case 'GROUNDED':
      return 'Grounded';
    case 'CONNECTED':
      return 'Connected';
    default:
      return 'Declared';
  }
};

export const getTrustLevelTone = (level: CapabilityTrustLevel): EnterpriseTone => {
  switch (level) {
    case 'PROVEN':
      return 'success';
    case 'OPERABLE':
    case 'GROUNDED':
      return 'brand';
    case 'CONNECTED':
      return 'info';
    default:
      return 'warning';
  }
};

export const getProofStatusLabel = (status: CapabilityProofStatus) => {
  switch (status) {
    case 'READY':
      return 'Ready';
    case 'IN_PROGRESS':
      return 'In progress';
    case 'LOCKED':
      return 'Locked';
    default:
      return 'Action needed';
  }
};

export const getProofStatusTone = (status: CapabilityProofStatus): EnterpriseTone => {
  switch (status) {
    case 'READY':
      return 'success';
    case 'IN_PROGRESS':
      return 'info';
    case 'LOCKED':
      return 'neutral';
    default:
      return 'warning';
  }
};

const getTrustDescription = (
  trustLevel: CapabilityTrustLevel,
  proofItems: CapabilityProofMilestone[],
) => {
  const nextGap = proofItems.find(item => item.status !== 'READY');
  if (!nextGap) {
    return 'This capability has crossed the full proof ladder and has evidence of real delivery.';
  }

  switch (trustLevel) {
    case 'PROVEN':
      return 'This capability has delivery proof and can be trusted as an operating unit.';
    case 'OPERABLE':
      return 'This capability can operate, but it still needs a completed work cycle to prove delivery.';
    case 'GROUNDED':
      return 'The team is grounded in context. Finish execution setup to make the capability operable.';
    case 'CONNECTED':
      return 'Sources and workspace links exist. Ground the agents before relying on outcomes.';
    default:
      return nextGap.proofSignal;
  }
};

const buildReadinessItems = (
  capability: Capability,
  workspace: CapabilityWorkspace,
  runtimeStatus?: RuntimeStatus | null,
): CapabilityReadinessItem[] => {
  const activeWorkflows = workspace.workflows.filter(workflow => !workflow.archivedAt);
  const hasWorkflow = activeWorkflows.length > 0;
  const hasPublishedWorkflow = activeWorkflows.some(
    workflow => workflow.publishState === 'PUBLISHED' || workflow.publishState === 'VALIDATED',
  );
  const ownerAgent = workspace.agents.find(agent => agent.isOwner) || workspace.agents[0] || null;
  const learningStatuses = getLearningStatuses(workspace.agents);
  const hasLearningError = learningStatuses.includes('ERROR');
  const hasStaleLearning = learningStatuses.includes('STALE');
  const hasPendingLearning = learningStatuses.some(status =>
    ['QUEUED', 'LEARNING', 'NOT_STARTED'].includes(status),
  );
  const allAgentsReady =
    workspace.agents.length > 0 && learningStatuses.every(status => status === 'READY');
  const sourceCount = workspace.agents.reduce(
    (total, agent) => total + (agent.learningProfile.sourceCount || 0),
    0,
  );

  return [
    {
      id: 'metadata',
      label: 'Minimum capability contract',
      description: 'Owner, outcome, success metric, evidence expectation, and definition of done are explicitly defined.',
      status: hasMinimalCapabilityContract(capability) ? 'READY' : 'NEEDS_SETUP',
      actionLabel: 'Complete contract',
      path: '/capabilities/metadata',
      isBlocking: true,
      blockingReason:
        'Execution stays gated until the capability has an owner, business outcome, success metric, evidence requirement, and definition of done.',
      nextRequiredAction: 'Finish the minimum capability contract before starting workflow execution.',
    },
    {
      id: 'connectors',
      label: 'Connected source',
      description: 'At least one repo, ALM system, or source reference is linked to the capability.',
      status: hasConnectorSetup(capability) ? 'READY' : 'NEEDS_SETUP',
      actionLabel: 'Connect source',
      path: '/capabilities/metadata',
      isBlocking: true,
      blockingReason:
        'Heavy workflow should not start before the capability is grounded in a real source system.',
      nextRequiredAction: 'Add a repository, Jira board, Confluence page, or documentation source.',
    },
    {
      id: 'workspace',
      label: 'Workspace approval',
      description: 'Local paths are explicitly approved for agent execution.',
      status: hasWorkspaceSource(capability) ? 'READY' : 'NEEDS_SETUP',
      actionLabel: 'Approve paths',
      path: '/capabilities/metadata',
      isBlocking: true,
      blockingReason:
        'Copilot-backed work must stay inside an approved local workspace before execution can start.',
      nextRequiredAction: 'Approve at least one workspace path for this capability.',
    },
    {
      id: 'commands',
      label: 'Command templates',
      description: 'Build, test, docs, and deploy commands are named and constrained.',
      status: hasCommandTemplates(capability) ? 'READY' : 'NEEDS_SETUP',
      actionLabel: 'Configure commands',
      path: '/capabilities/metadata',
    },
    {
      id: 'deployment-targets',
      label: 'Deployment targets',
      description: 'Release targets reference approved commands and workspace paths.',
      status: hasDeploymentTargetSetup(capability) ? 'READY' : 'NEEDS_SETUP',
      actionLabel: 'Configure targets',
      path: '/capabilities/metadata',
    },
    {
      id: 'workspace-mode',
      label: 'Workspace mode',
      description: 'Real enterprise workspaces are separated from demo capability data.',
      status:
        demoModeEnabled && seededCapabilityIds.has(capability.id)
          ? 'NEEDS_ATTENTION'
          : 'READY',
      actionLabel: 'Create real capability',
      path: '/capabilities/metadata',
    },
    {
      id: 'workflow',
      label: 'Delivery workflow',
      description: 'A validated or published workflow is available for business work.',
      status: hasPublishedWorkflow ? 'READY' : hasWorkflow ? 'NEEDS_ATTENTION' : 'NEEDS_SETUP',
      actionLabel: hasWorkflow ? 'Publish workflow' : 'Create workflow',
      path: '/designer',
      isBlocking: true,
      blockingReason:
        'Execution stays blocked until the capability has a validated or published workflow.',
      nextRequiredAction: 'Publish or validate a workflow before starting the first run.',
    },
    {
      id: 'owner-agent',
      label: 'Owner collaborator',
      description: 'A capability owner agent is ready to coordinate team context.',
      status:
        ownerAgent?.initializationStatus === 'READY'
          ? 'READY'
          : ownerAgent
          ? 'IN_PROGRESS'
          : 'NEEDS_SETUP',
      actionLabel: 'Open agents',
      path: '/team',
    },
    {
      id: 'agent-learning',
      label: 'Collaborator learning',
      description: 'Agents have learned the capability context they need to help.',
      status: hasLearningError || hasStaleLearning
        ? 'NEEDS_ATTENTION'
        : allAgentsReady
        ? 'READY'
        : hasPendingLearning
        ? 'IN_PROGRESS'
        : 'NEEDS_SETUP',
      actionLabel: hasLearningError || hasStaleLearning ? 'Refresh learning' : 'Review agents',
      path: '/team',
    },
    {
      id: 'runtime',
      label: 'Copilot runtime',
      description: 'A runtime owner is connected for Copilot chat and workflow execution.',
      status: runtimeStatus?.configured
        ? 'READY'
        : runtimeStatus
        ? 'NEEDS_SETUP'
        : 'IN_PROGRESS',
      actionLabel: 'Check runtime',
      path: '/run-console',
      isBlocking: true,
      blockingReason:
        'Workflow execution cannot start until the Copilot runtime owner is connected.',
      nextRequiredAction: 'Connect the runtime owner and confirm execution is available.',
    },
    {
      id: 'memory',
      label: 'Capability memory',
      description: 'Memory has indexed useful sources for grounded collaboration.',
      status:
        sourceCount > 0 || workspace.learningUpdates.length > 0
          ? 'READY'
          : hasPendingLearning
          ? 'IN_PROGRESS'
          : 'NEEDS_SETUP',
      actionLabel: 'Refresh memory',
      path: '/memory',
    },
    {
      id: 'first-work',
      label: 'First work item',
      description: 'At least one work item exists to move through the workflow.',
      status: workspace.workItems.length > 0 ? 'READY' : hasWorkflow ? 'NEEDS_SETUP' : 'NEEDS_ATTENTION',
      actionLabel: 'Create work',
      path: '/?new=1',
    },
  ];
};

const getAttentionWorkItem = (workItems: WorkItem[]) =>
  workItems.find(item => item.status === 'BLOCKED') ||
  workItems.find(item => item.status === 'PENDING_APPROVAL') ||
  null;

const buildNextAction = (
  proofItems: CapabilityProofMilestone[],
  readinessItems: CapabilityReadinessItem[],
  workspace: CapabilityWorkspace,
): CapabilityNextAction => {
  const attentionItem = getAttentionWorkItem(workspace.workItems);
  if (attentionItem?.status === 'BLOCKED') {
    return {
      id: `blocked-${attentionItem.id}`,
      title: `Unblock ${attentionItem.title}`,
      description:
        attentionItem.blocker?.message ||
        'A work item needs a decision or input before it can continue.',
      actionLabel: 'Open work item',
      path: `/?selected=${encodeURIComponent(attentionItem.id)}`,
      tone: 'warning',
    };
  }

  if (attentionItem?.status === 'PENDING_APPROVAL') {
    return {
      id: `approval-${attentionItem.id}`,
      title: `Review ${attentionItem.title}`,
      description:
        attentionItem.pendingRequest?.message ||
        'A work item is waiting for business approval.',
      actionLabel: 'Review approval',
      path: `/?selected=${encodeURIComponent(attentionItem.id)}`,
      tone: 'warning',
    };
  }

  const blockingItem =
    readinessItems.find(item => item.isBlocking && item.status === 'NEEDS_ATTENTION') ||
    readinessItems.find(item => item.isBlocking && item.status === 'NEEDS_SETUP') ||
    readinessItems.find(item => item.isBlocking && item.status === 'IN_PROGRESS');

  if (blockingItem) {
    return {
      id: `blocking-${blockingItem.id}`,
      title: `Clear ${blockingItem.label.toLowerCase()}`,
      description:
        blockingItem.nextRequiredAction || blockingItem.blockingReason || blockingItem.description,
      actionLabel: blockingItem.actionLabel,
      path: blockingItem.path,
      tone: blockingItem.status === 'NEEDS_ATTENTION' ? 'warning' : 'brand',
    };
  }

  const proofGap = proofItems.find(
    item => item.status === 'ACTION_NEEDED' || item.status === 'IN_PROGRESS',
  );

  if (proofGap) {
    return {
      id: `proof-${proofGap.id}`,
      title:
        proofGap.status === 'IN_PROGRESS'
          ? `${proofGap.label} is underway`
          : proofGap.level === 'PROVEN'
          ? 'Prove delivery with real work'
          : `Build ${proofGap.label.toLowerCase()} trust`,
      description: proofGap.proofSignal,
      actionLabel: proofGap.actionLabel,
      path: proofGap.path,
      tone: proofGap.status === 'ACTION_NEEDED' ? 'warning' : 'brand',
    };
  }

  const setupItem =
    readinessItems.find(item => item.status === 'NEEDS_ATTENTION') ||
    readinessItems.find(item => item.status === 'NEEDS_SETUP') ||
    readinessItems.find(item => item.status === 'IN_PROGRESS');

  if (setupItem) {
    return {
      id: `readiness-${setupItem.id}`,
      title: setupItem.id === 'first-work'
        ? 'Start first work item'
        : setupItem.status === 'IN_PROGRESS'
        ? `${setupItem.label} is in progress`
        : `Finish ${setupItem.label.toLowerCase()}`,
      description: setupItem.description,
      actionLabel: setupItem.actionLabel,
      path: setupItem.path,
      tone: setupItem.status === 'NEEDS_ATTENTION' ? 'warning' : 'brand',
    };
  }

  const activeItem = workspace.workItems.find(item => item.status === 'ACTIVE');
  if (activeItem) {
    return {
      id: `continue-${activeItem.id}`,
      title: `Continue ${activeItem.title}`,
      description: 'Review the current step and keep delivery moving.',
      actionLabel: 'Open work',
      path: `/?selected=${encodeURIComponent(activeItem.id)}`,
      tone: 'brand',
    };
  }

  const completedItem = workspace.workItems.find(item => item.status === 'COMPLETED');
  if (completedItem) {
    return {
      id: `evidence-${completedItem.id}`,
      title: 'Review delivered evidence',
      description: 'Completed work is available for artifact and evidence review.',
      actionLabel: 'Open evidence',
      path: '/ledger',
      tone: 'success',
    };
  }

  return {
    id: 'new-work',
    title: 'Start the next work item',
    description: 'This capability is ready. Create a work item to begin delivery.',
    actionLabel: 'Create work',
    path: '/?new=1',
    tone: 'brand',
  };
};

const getBlockingReadinessItems = (readinessItems: CapabilityReadinessItem[]) =>
  readinessItems.filter(
    item => item.isBlocking && item.status !== 'READY',
  );

const buildGoldenPathProgress = ({
  readinessItems,
  proofItems,
}: {
  readinessItems: CapabilityReadinessItem[];
  proofItems: CapabilityProofMilestone[];
}): GoldenPathProgress => {
  const readinessById = new Map(readinessItems.map(item => [item.id, item]));
  const proofByLevel = new Map(proofItems.map(item => [item.level, item]));

  const rawSteps = [
    {
      id: 'contract',
      label: 'Define the capability contract',
      description: readinessById.get('metadata')?.description || 'Define owner, outcome, and done criteria.',
      path: '/capabilities/metadata',
      complete: readinessById.get('metadata')?.status === 'READY',
    },
    {
      id: 'source',
      label: 'Connect a real source',
      description: readinessById.get('connectors')?.description || 'Connect repo or ALM systems.',
      path: '/capabilities/metadata',
      complete: readinessById.get('connectors')?.status === 'READY',
    },
    {
      id: 'workspace',
      label: 'Approve a workspace',
      description: readinessById.get('workspace')?.description || 'Approve an execution workspace.',
      path: '/capabilities/metadata',
      complete: readinessById.get('workspace')?.status === 'READY',
    },
    {
      id: 'workflow',
      label: 'Publish the workflow',
      description: readinessById.get('workflow')?.description || 'Validate or publish a workflow.',
      path: '/designer',
      complete: readinessById.get('workflow')?.status === 'READY',
    },
    {
      id: 'first-work',
      label: 'Stage the first work item',
      description: readinessById.get('first-work')?.description || 'Create the first work item.',
      path: '/?new=1',
      complete: readinessById.get('first-work')?.status === 'READY',
    },
    {
      id: 'evidence',
      label: 'Produce first evidence',
      description:
        proofByLevel.get('PROVEN')?.proofSignal ||
        'Run one work item through to delivery evidence.',
      path: '/ledger',
      complete: proofByLevel.get('PROVEN')?.status === 'READY',
    },
  ];

  let currentAssigned = false;
  const steps = rawSteps.map(step => {
    if (step.complete) {
      return { ...step, status: 'COMPLETE' as const };
    }

    if (!currentAssigned) {
      currentAssigned = true;
      return { ...step, status: 'CURRENT' as const };
    }

    return { ...step, status: 'BLOCKED' as const };
  });

  const completedCount = steps.filter(step => step.status === 'COMPLETE').length;
  const currentStep = steps.find(step => step.status === 'CURRENT');

  return {
    completedCount,
    totalCount: steps.length,
    percentComplete: Math.round((completedCount / steps.length) * 100),
    currentStepId: currentStep?.id,
    summary: currentStep
      ? `${currentStep.label} is the next move in the golden path.`
      : 'The golden path is complete and the capability has evidence of delivery.',
    steps,
  };
};

export const buildCapabilityExperience = ({
  capability,
  workspace,
  runtimeStatus,
}: {
  capability: Capability;
  workspace: CapabilityWorkspace;
  runtimeStatus?: RuntimeStatus | null;
}): CapabilityExperienceModel => {
  const readinessItems = buildReadinessItems(capability, workspace, runtimeStatus);
  const blockingReadinessItems = getBlockingReadinessItems(readinessItems);
  const readyCount = readinessItems.filter(item => item.status === 'READY').length;
  const ownerAgent = workspace.agents.find(agent => agent.isOwner) || workspace.agents[0] || null;
  const primaryCopilotAgent =
    workspace.agents.find(agent => agent.id === selectPrimaryCopilotAgentId(workspace.agents)) ||
    ownerAgent;
  const proofItems = buildProofItems(capability, workspace, runtimeStatus);
  const trustLevel = getTrustLevel(proofItems);
  const goldenPathProgress = buildGoldenPathProgress({
    readinessItems,
    proofItems,
  });

  return {
    readinessItems,
    blockingReadinessItems,
    canStartDelivery: blockingReadinessItems.length === 0,
    readinessScore: Math.round((readyCount / readinessItems.length) * 100),
    trustLevel,
    trustLabel: getTrustLevelLabel(trustLevel),
    trustDescription: getTrustDescription(trustLevel, proofItems),
    proofItems,
    goldenPathProgress,
    outcomeContract: buildOutcomeContract(capability),
    nextAction: buildNextAction(proofItems, readinessItems, workspace),
    runtimeHealth: getRuntimeHealth(runtimeStatus),
    ownerAgent,
    primaryCopilotAgent,
    activeWorkCount: workspace.workItems.filter(item => item.status === 'ACTIVE').length,
    blockerCount: workspace.workItems.filter(item => item.status === 'BLOCKED').length,
    approvalCount: workspace.workItems.filter(item => item.status === 'PENDING_APPROVAL').length,
    completedWorkCount: workspace.workItems.filter(item => item.status === 'COMPLETED').length,
    latestOutputCount: workspace.artifacts.filter(artifact => artifact.direction !== 'INPUT').length,
  };
};

export const getBusinessWorkStatusLabel = (status: string) => {
  switch (status) {
    case 'BLOCKED':
    case 'WAITING_CONFLICT':
      return 'Blocked';
    case 'PENDING_APPROVAL':
    case 'WAITING_APPROVAL':
      return 'Waiting for approval';
    case 'WAITING_INPUT':
      return 'Waiting for input';
    case 'RUNNING':
    case 'ACTIVE':
    case 'PROCESSING':
      return 'Running';
    case 'COMPLETED':
      return 'Completed';
    case 'FAILED':
      return 'Failed';
    default:
      return status
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, character => character.toUpperCase());
  }
};

export const getBusinessEvidenceLabel = (value?: string) => {
  if (!value) {
    return 'Evidence';
  }

  switch (value) {
    case 'CODE_DIFF':
      return 'Code diff';
    case 'APPROVAL_RECORD':
      return 'Approval record';
    case 'INPUT_NOTE':
      return 'Input note';
    case 'CONFLICT_RESOLUTION':
      return 'Conflict resolution';
    case 'CONTRARIAN_REVIEW':
      return 'Contrarian review';
    case 'EXECUTION_PLAN':
      return 'Execution plan';
    case 'HANDOFF':
    case 'HANDOFF_PACKET':
      return 'Handoff packet';
    case 'RUN_SUMMARY':
      return 'Run summary';
    default:
      return value
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, character => character.toUpperCase());
  }
};

export const getLearningStatusLabel = (status: AgentLearningStatus) => {
  switch (status) {
    case 'READY':
      return 'Ready to help';
    case 'LEARNING':
    case 'QUEUED':
      return 'Learning';
    case 'STALE':
      return 'Needs refresh';
    case 'ERROR':
      return 'Learning failed';
    default:
      return 'Needs setup';
  }
};
