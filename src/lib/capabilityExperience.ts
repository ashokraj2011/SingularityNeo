import type {
  AgentLearningStatus,
  Capability,
  CapabilityAgent,
  CapabilityWorkspace,
  GoldenPathProgress,
  ReadinessContract,
  WorkspaceRole,
  WorkItem,
} from '../types';
import { isWorkItemLiveExecution, isWorkItemStaged } from './workItemState';
import { CAPABILITIES } from '../constants';
import type { RuntimeStatus } from './api';
import type { EnterpriseTone } from './enterprise';
import { selectPrimaryCopilotAgentId } from './agentProfiles';
import {
  hasMeaningfulExecutionCommandTemplate,
  isWorkspacePathInsideApprovedRoot,
} from './executionConfig';
import { buildLocalReadinessContract } from './readinessContract';

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
  | 'operations'
  | 'token-intelligence'
  | 'desktop-connectors'
  | 'incidents'
  | 'mrm'
  | 'access'
  | 'databases'
  | 'memory'
  | 'tool-access'
  | 'run-console'
  | 'evals'
  | 'skills'
  | 'tools'
  | 'policies'
  | 'artifact-designer'
  | 'tasks'
  | 'studio'
  | 'governance-controls'
  | 'governance-exceptions'
  | 'governance-provenance'
  | 'governance-posture'
  | 'work-item-report'
  | 'sentinel'
  | 'blast-radius'
  | 'ast-explorer'
  | 'code-graph'
  | 'world-model'
  | 'business-workflows'
  | 'business-workflow-inbox';

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
  readinessContract: ReadinessContract;
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
    id: 'incidents',
    label: 'Incidents',
    shortName: 'Incidents',
    path: '/incidents',
    description: 'Link incidents to evidence packets, review candidate contributors, and prepare post-mortem attribution.',
    audience: 'OPERATORS',
    exposureMode: 'WHEN_RELEVANT',
    contextTriggers: ['HAS_WORKFLOW'],
  },
  {
    id: 'mrm',
    label: 'MRM',
    shortName: 'MRM',
    path: '/mrm',
    description: 'Review incident-attribution metrics, guardrail promotion requests, and model risk trends.',
    audience: 'ADMINS',
    exposureMode: 'WHEN_RELEVANT',
    contextTriggers: ['HAS_WORKFLOW'],
  },
  {
    id: 'operations',
    label: 'Operations',
    shortName: 'Ops',
    path: '/operations',
    description: 'Monitor desktop executor ownership, heartbeats, and queued execution routing.',
    audience: 'OPERATORS',
    exposureMode: 'WHEN_RELEVANT',
    contextTriggers: ['HAS_WORKFLOW'],
  },
  {
    id: 'token-intelligence',
    label: 'Token Intelligence',
    shortName: 'Tokens',
    path: '/token-intelligence',
    description: 'Review token usage, prompt receipts, budget policy, and model-adaptive routing recommendations.',
    audience: 'OPERATORS',
    exposureMode: 'WHEN_RELEVANT',
    contextTriggers: ['HAS_WORKFLOW'],
  },
  {
    id: 'desktop-connectors',
    label: 'Local Connectors',
    shortName: 'Connectors',
    path: '/desktop/connectors',
    description:
      'Configure and validate desktop-local tokens for GitHub, Jira, Confluence, Jenkins, Datadog, Splunk, and ServiceNow.',
    audience: 'OPERATORS',
    exposureMode: 'ALWAYS',
    contextTriggers: [],
  },
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
    exposureMode: 'ALWAYS',
    contextTriggers: [],
  },
  {
    id: 'tools',
    label: 'Tools',
    shortName: 'Tools',
    path: '/tools',
    description:
      'Capability-wide inventory of tool adapters — where each tool is used, recent invocations, and the latest policy verdict per tool.',
    audience: 'OPERATORS',
    exposureMode: 'ALWAYS',
    contextTriggers: [],
  },
  {
    id: 'policies',
    label: 'Policies',
    shortName: 'Policies',
    path: '/policies',
    description:
      'Runtime approval policies and governance control bindings scoped to this capability, with drill-through to the workflow steps they apply to.',
    audience: 'OPERATORS',
    exposureMode: 'ALWAYS',
    contextTriggers: [],
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
  {
    id: 'governance-controls',
    label: 'Governance Controls',
    shortName: 'Controls',
    path: '/governance/controls',
    description:
      'Review the NIST CSF 2.0, SOC 2 TSC, and ISO 27001 controls the platform claims to enforce, and the policies bound to each.',
    audience: 'ADMINS',
    exposureMode: 'ALWAYS',
    contextTriggers: [],
  },
  {
    id: 'governance-exceptions',
    label: 'Governance Exceptions',
    shortName: 'Exceptions',
    path: '/governance/exceptions',
    description:
      'Review, approve, and revoke time-bound deviations that waive policy approval gates for individual capabilities.',
    audience: 'ADMINS',
    exposureMode: 'ALWAYS',
    contextTriggers: [],
  },
  {
    id: 'governance-provenance',
    label: 'Prove the Negative',
    shortName: 'Provenance',
    path: '/governance/provenance',
    description:
      'Audit whether a path was touched by an AI (or a human) in a time window. Gaps in logging are surfaced rather than silently reported as "no".',
    audience: 'ADMINS',
    exposureMode: 'ALWAYS',
    contextTriggers: [],
  },
  {
    id: 'governance-posture',
    label: 'Posture Dashboard',
    shortName: 'Posture',
    path: '/governance/posture',
    description:
      'One-screen read over signer health, control coverage, active exceptions, and provenance integrity — the view auditors and operators open first.',
    audience: 'ADMINS',
    exposureMode: 'ALWAYS',
    contextTriggers: [],
  },
  {
    id: 'work-item-report',
    label: 'Work Item Report',
    shortName: 'WI Report',
    path: '/reports/work-items',
    description:
      'Per-work-item breakdown of AI cost, token usage, elapsed time, human interaction count, and agent autonomy percentage.',
    audience: 'OPERATORS',
    exposureMode: 'ALWAYS',
    contextTriggers: [],
  },
  {
    id: 'sentinel',
    label: 'Sentinel Mode',
    shortName: 'Sentinel',
    path: '/sentinel',
    description:
      'Zero-prompt autonomous security remediation. Sentinel intercepts CVE alerts, maps the vulnerability, patches it, signs it, and delivers a Release Passport for 1-click approval.',
    audience: 'OPERATORS',
    exposureMode: 'ALWAYS',
    contextTriggers: [],
  },
  {
    id: 'blast-radius',
    label: 'Blast Radius',
    shortName: 'Blast Radius',
    path: '/blast-radius',
    description:
      'Shadow execution dry-run that maps which capabilities and files would break if a proposed file change were deployed. Classifies dependents as CRITICAL, WARNING, or SAFE.',
    audience: 'ARCHITECTS',
    exposureMode: 'ALWAYS',
    contextTriggers: [],
  },
  {
    id: 'ast-explorer',
    label: 'AST Explorer',
    shortName: 'AST',
    path: '/ast-explorer',
    description:
      'Browse the local code index: API endpoints, interfaces, contracts, classes, and methods extracted from the capability repositories. Powered by the desktop base-clone AST.',
    audience: 'BUILDERS',
    exposureMode: 'WHEN_RELEVANT',
    contextTriggers: ['HAS_REPOSITORIES'],
  },
  {
    id: 'code-graph',
    label: 'Code Graph',
    shortName: 'Graph',
    path: '/code-graph',
    description:
      'Force-directed interactive graph of the capability codebase: file import topology, symbol containment hierarchy, and API endpoint detection. Switch between file-level and symbol-level views.',
    audience: 'BUILDERS',
    exposureMode: 'WHEN_RELEVANT',
    contextTriggers: ['HAS_REPOSITORIES'],
  },
  {
    id: 'world-model',
    label: 'World Model',
    shortName: 'World',
    path: '/world-model',
    description:
      'Semantic force-directed interactive graph of the capability world model: connects APIs, Services, Repositories, Data objects and impacted downstream workflows.',
    audience: 'BUILDERS',
    exposureMode: 'ALWAYS',
    contextTriggers: [],
  },
  {
    id: 'business-workflows',
    label: 'Business Workflows',
    shortName: 'Business WF',
    path: '/studio/business-workflows',
    description:
      'Design human-driven business workflows (approval chains, expense reviews, sign-offs, onboarding). Hybrid steps can delegate to capability agents.',
    audience: 'BUILDERS',
    exposureMode: 'ALWAYS',
    contextTriggers: [],
  },
  {
    id: 'business-workflow-inbox',
    label: 'Business Workflow Inbox',
    shortName: 'My Tasks',
    path: '/studio/business-workflows/inbox',
    description:
      'Open business-workflow tasks for the current operator: claim, complete with form data, decide approvals.',
    audience: 'OPERATORS',
    exposureMode: 'ALWAYS',
    contextTriggers: [],
  },
];

const hasText = (value?: string) => Boolean(value?.trim());

const hasCapabilityOwner = (capability: Capability) =>
  hasText(capability.ownerTeam) ||
  capability.stakeholders.length > 0 ||
  capability.teamNames.length > 0;

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
  hasCapabilityOwner(capability);

const hasBusinessOutcomeContext = (capability: Capability) =>
  hasText(capability.businessOutcome) ||
  capability.successMetrics.some(metric => metric.trim()) ||
  capability.requiredEvidenceKinds.some(kind => kind.trim()) ||
  hasText(capability.definitionOfDone) ||
  hasText(capability.operatingPolicySummary);

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
    case 'HAS_REPOSITORIES':
      return (capability.repositories?.length ?? 0) > 0 ||
        (capability.gitRepositories?.length ?? 0) > 0;
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
      description: 'Loading execution runtime ownership and provider connection status.',
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

  if (runtimeStatus.executionRuntimeOwner === 'DESKTOP') {
    return {
      label: 'Desktop-owned execution',
      description:
        'Queued work can wait for a claimed desktop executor even when this browser session does not own the active runtime lane.',
      tone: 'info',
      actionLabel: 'Open work cockpit',
      path: '/orchestrator',
    };
  }

  return {
    label: runtimeStatus.lastRuntimeError ? 'Unavailable' : 'Needs runtime setup',
    description:
      runtimeStatus.lastRuntimeError ||
      `Connect the ${runtimeStatus.runtimeOwner === 'DESKTOP' ? 'desktop' : 'runtime'} execution owner before starting governed agent work.`,
    tone: runtimeStatus.lastRuntimeError ? 'danger' : 'warning',
    actionLabel: 'Set up runtime',
    path: '/run-console',
  };
};

const hasExecutionPath = (runtimeStatus?: RuntimeStatus | null) =>
  Boolean(
    runtimeStatus &&
      (runtimeStatus.configured || runtimeStatus.executionRuntimeOwner === 'DESKTOP'),
  );

const hasDesktopWorkspaceAuthority = (runtimeStatus?: RuntimeStatus | null) =>
  Boolean(
    runtimeStatus?.workingDirectory?.trim() ||
      runtimeStatus?.workingDirectorySource === 'mapping' ||
      runtimeStatus?.workingDirectorySource === 'env' ||
      runtimeStatus?.workingDirectorySource === 'project-root',
  );

const getDesktopWorkspaceReadiness = (
  runtimeStatus?: RuntimeStatus | null,
): Pick<
  CapabilityReadinessItem,
  'description' | 'status' | 'blockingReason' | 'nextRequiredAction'
> => {
  if (hasDesktopWorkspaceAuthority(runtimeStatus)) {
    const source = runtimeStatus?.workingDirectorySource;
    const sourceLabel =
      source === 'mapping'
        ? 'a Desktop Workspaces mapping'
        : source === 'env'
        ? 'SINGULARITY_WORKING_DIRECTORY'
        : source === 'project-root'
        ? 'the desktop project root fallback'
        : 'desktop runtime state';
    return {
      description: `Execution will use ${sourceLabel} for this operator on this desktop.`,
      status: 'READY',
      blockingReason: undefined,
      nextRequiredAction: undefined,
    };
  }

  if (!runtimeStatus) {
    return {
      description:
        'Workspace authority is resolved from the current operator on the current desktop.',
      status: 'IN_PROGRESS',
      blockingReason:
        'Execution needs a desktop-user workspace mapping or SINGULARITY_WORKING_DIRECTORY before local tools can run.',
      nextRequiredAction:
        'Open Operations and save a Desktop Workspaces mapping for this operator on this desktop.',
    };
  }

  return {
    description:
      'No desktop-user workspace mapping or working directory fallback is available yet.',
    status: 'NEEDS_SETUP',
    blockingReason:
      'Local execution paths are desktop-user scoped and are not approved from capability metadata.',
    nextRequiredAction:
      'Open Desktop Workspaces and save a working directory for this operator on this desktop.',
  };
};

const getCapabilityBoundarySignals = (capability: Capability) =>
  [
    ...capability.applications,
    ...capability.apis,
    ...capability.databases,
    ...capability.gitRepositories,
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
  const sourceReferenceCount = Array.from(
    new Set(
      [
        ...outcomeContract.serviceBoundary,
        capability.jiraBoardLink,
        capability.confluenceLink,
        capability.documentationNotes,
      ].filter(Boolean),
    ),
  ).length;

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
        : 'Optional: add a business outcome, success metrics, and service boundary.',
      actionLabel: 'Define business charter',
      path: '/capabilities/metadata',
    },
    {
      level: 'CONNECTED' as const,
      label: 'Connected',
      description: 'Real source systems, repositories, or service boundaries are linked to the capability.',
      ready: hasConnectorSetup(capability) || hasBoundary,
      inProgress: hasConnectorSetup(capability) || hasBoundary,
      proofSignal:
        hasConnectorSetup(capability) || hasBoundary
          ? `${sourceReferenceCount} source or service boundary reference${sourceReferenceCount === 1 ? '' : 's'} linked. Desktop execution paths are configured separately per operator.`
          : 'Link GitHub, Jira, Confluence, documentation, or a service boundary.',
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
        hasExecutionPath(runtimeStatus) &&
        hasCommandTemplates(capability),
      inProgress:
        hasPublishedWorkflow ||
        hasExecutionPath(runtimeStatus) ||
        hasCommandTemplates(capability),
      proofSignal:
        hasPublishedWorkflow && hasExecutionPath(runtimeStatus) && hasCommandTemplates(capability)
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
      return 'Source-system links exist. Ground the agents before relying on outcomes.';
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
  const desktopWorkspaceReadiness = getDesktopWorkspaceReadiness(runtimeStatus);

  return [
    {
      id: 'metadata',
      label: 'Capability business context',
      description: 'Owner and description anchor the capability. Outcome, evidence, and policy notes are optional context for business readers.',
      status: hasMinimalCapabilityContract(capability)
        ? hasBusinessOutcomeContext(capability)
          ? 'READY'
          : 'IN_PROGRESS'
        : 'NEEDS_SETUP',
      actionLabel: 'Open metadata',
      path: '/capabilities/metadata',
      isBlocking: !hasMinimalCapabilityContract(capability),
      blockingReason:
        'Owner and description are recommended context. Missing ownership no longer blocks execution.',
      nextRequiredAction: hasMinimalCapabilityContract(capability)
        ? 'Optionally add business outcome, success metrics, required evidence, or an operating policy summary.'
        : 'Add a capability owner and a short description before starting workflow execution.',
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
      label: 'Desktop workspace',
      description: desktopWorkspaceReadiness.description,
      status: desktopWorkspaceReadiness.status,
      actionLabel: 'Open Desktop Workspaces',
      path: '/operations#desktop-workspaces',
      isBlocking: true,
      blockingReason: desktopWorkspaceReadiness.blockingReason,
      nextRequiredAction: desktopWorkspaceReadiness.nextRequiredAction,
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
      label: 'Execution runtime',
      description: 'A runtime owner is connected for governed chat and workflow execution.',
      status: hasExecutionPath(runtimeStatus)
        ? 'READY'
        : runtimeStatus
        ? 'NEEDS_SETUP'
        : 'IN_PROGRESS',
      actionLabel: 'Check runtime',
      path: '/run-console',
      isBlocking: runtimeStatus?.executionRuntimeOwner !== 'DESKTOP',
      blockingReason:
        'Workflow execution cannot start until the active runtime owner is connected.',
      nextRequiredAction:
        runtimeStatus?.executionRuntimeOwner === 'DESKTOP'
          ? 'Claim a desktop executor so queued runs can start automatically.'
          : 'Connect the runtime owner and confirm execution is available.',
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

  const activeItem = workspace.workItems.find(item => isWorkItemLiveExecution(item));
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

  const stagedItem = workspace.workItems.find(item => isWorkItemStaged(item));
  if (stagedItem) {
    return {
      id: `start-${stagedItem.id}`,
      title: `Start ${stagedItem.title}`,
      description: 'This work item is staged and ready to begin execution.',
      actionLabel: 'Open work',
      path: `/?selected=${encodeURIComponent(stagedItem.id)}`,
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
      label: 'Save desktop workspace',
      description:
        readinessById.get('workspace')?.description ||
        'Save an operator/desktop working directory mapping.',
      path: readinessById.get('workspace')?.path || '/operations#desktop-workspaces',
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
  const readinessContract =
    workspace.readinessContract ||
    buildLocalReadinessContract({
      capability,
      workspace,
      runtimeStatus,
    });
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
    readinessContract,
    readinessItems,
    blockingReadinessItems,
    canStartDelivery: readinessContract.allReady,
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
    activeWorkCount: workspace.workItems.filter(
      item => item.status === 'ACTIVE' || isWorkItemStaged(item),
    ).length,
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
    case 'WAITING_HUMAN_TASK':
      return 'Waiting for human task';
    case 'WAITING_INPUT':
      return 'Waiting for input';
    case 'RUNNING':
      return 'Running';
    case 'ACTIVE':
      return 'Active';
    case 'STAGED':
      return 'Staged';
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
    case 'LEARNING_NOTE':
      return 'Learning note';
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
