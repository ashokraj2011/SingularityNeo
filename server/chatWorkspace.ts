import {
  getCapabilityBoardPhaseIds,
  getLifecyclePhaseLabel,
} from '../src/lib/capabilityLifecycle';
import type {
  Capability,
  CapabilityAgent,
  CapabilityWorkspace,
  CompiledArtifactChecklistItem,
  CompiledRequiredInputField,
  CompiledStepContext,
  CompiledWorkItemPlan,
  WorkItem,
  WorkItemPhase,
  WorkflowRunDetail,
} from '../src/types';
import { getWorkflowRunDetail } from './execution/repository';
import {
  approveWorkflowRun,
  cancelWorkflowRun,
  moveWorkItemToPhaseControl,
  provideWorkflowRunInput,
  requestChangesWorkflowRun,
  resolveWorkflowRunConflict,
  restartWorkflowRun,
  startWorkflowExecution,
} from './execution/service';
import { buildWorkItemExplainDetail } from './workItemExplain';
import { detectCapabilityWorkspaceProfile } from './workspaceProfile';

type CapabilityBundle = {
  capability: Capability;
  workspace: CapabilityWorkspace;
};

type ChatWorkspaceActionType =
  | 'STATUS'
  | 'MOVE_PHASE'
  | 'APPROVE'
  | 'REQUEST_CHANGES'
  | 'PROVIDE_INPUT'
  | 'RESOLVE_CONFLICT'
  | 'GUIDE_AGENT'
  | 'UNBLOCK'
  | 'START'
  | 'RESTART'
  | 'CANCEL';

type ParsedChatWorkspaceAction = {
  type: ChatWorkspaceActionType;
  workItemId?: string;
  runId?: string;
  targetPhase?: WorkItemPhase;
  note?: string;
};

export type ChatWorkspaceActionResult = {
  handled: boolean;
  changedState?: boolean;
  wakeWorker?: boolean;
  content?: string;
};

const normalizeText = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const formatWorkItemHeading = (workItem: WorkItem) =>
  `${workItem.id} - ${workItem.title}`;

const isExecutionAgent = (agent: Partial<CapabilityAgent>) => {
  const templateKey = String(agent.standardTemplateKey || '')
    .trim()
    .toUpperCase();
  const combinedLabel = `${agent.name || ''} ${agent.role || ''}`.toLowerCase();

  return (
    templateKey === 'EXECUTION-OPS' ||
    combinedLabel.includes('execution agent')
  );
};

const extractId = (message: string, prefix: 'WI' | 'RUN') =>
  message.match(new RegExp(`\\b${prefix}-[A-Z0-9-]+\\b`, 'i'))?.[0]?.toUpperCase();

const extractQuotedTitle = (message: string) =>
  message.match(/"([^"]+)"|'([^']+)'/)?.slice(1).find(Boolean)?.trim();

const extractNote = (message: string) => {
  const colonIndex = message.indexOf(':');
  if (colonIndex >= 0) {
    return message.slice(colonIndex + 1).trim();
  }

  const becauseMatch = message.match(/\b(?:because|note|details?)\b(.+)$/i);
  return becauseMatch?.[1]?.trim();
};

const findWorkItemMatches = (
  bundle: CapabilityBundle,
  message: string,
) => {
  const explicitId = extractId(message, 'WI');
  if (explicitId) {
    return bundle.workspace.workItems.filter(item => item.id.toUpperCase() === explicitId);
  }

  const quotedTitle = extractQuotedTitle(message)?.toLowerCase();
  if (quotedTitle) {
    return bundle.workspace.workItems.filter(item =>
      item.title.toLowerCase().includes(quotedTitle),
    );
  }

  const normalized = normalizeText(message);
  return bundle.workspace.workItems.filter(item => {
    const title = normalizeText(item.title);
    return title.length > 3 && normalized.includes(title);
  });
};

const getAttentionWorkItems = (bundle: CapabilityBundle) =>
  bundle.workspace.workItems.filter(
    item =>
      item.status === 'BLOCKED' ||
      item.status === 'PENDING_APPROVAL' ||
      Boolean(item.activeRunId),
  );

const findWorkItemByRunId = (
  bundle: CapabilityBundle,
  runId: string,
) =>
  bundle.workspace.workItems.find(
    item => item.activeRunId === runId || item.lastRunId === runId,
  );

const resolveTargetWorkItem = (
  bundle: CapabilityBundle,
  message: string,
): {
  workItem?: WorkItem;
  ambiguous?: WorkItem[];
} => {
  const matches = findWorkItemMatches(bundle, message);
  if (matches.length === 1) {
    return { workItem: matches[0] };
  }
  if (matches.length > 1) {
    return { ambiguous: matches };
  }

  const attentionItems = getAttentionWorkItems(bundle);
  if (attentionItems.length === 1) {
    return { workItem: attentionItems[0] };
  }

  return {};
};

const getOpenWait = (detail?: WorkflowRunDetail | null) =>
  detail?.waits.find(wait => wait.status === 'OPEN');

const asCompiledStepContext = (value: unknown): CompiledStepContext | undefined =>
  value && typeof value === 'object' ? (value as CompiledStepContext) : undefined;

const asCompiledWorkItemPlan = (value: unknown): CompiledWorkItemPlan | undefined =>
  value && typeof value === 'object' ? (value as CompiledWorkItemPlan) : undefined;

const asCompiledInputFields = (value: unknown): CompiledRequiredInputField[] =>
  Array.isArray(value) ? (value as CompiledRequiredInputField[]) : [];

const formatChecklistSummary = (items: CompiledArtifactChecklistItem[] = []) =>
  items.length > 0
    ? items
        .map(item => `${item.label} (${item.direction.toLowerCase()} / ${item.status.toLowerCase()})`)
        .join('; ')
    : 'No explicit artifact checklist is attached to this step.';

const formatInputSummary = (items: CompiledRequiredInputField[] = []) =>
  items.length > 0
    ? items
        .map(
          item =>
            `${item.label} (${item.status.toLowerCase()}${item.valueSummary ? `: ${item.valueSummary}` : ''})`,
        )
        .join('; ')
    : 'No structured input contract is attached to this step.';

const buildSuggestedExecutionActions = ({
  bundle,
  workItem,
  runDetail,
  fallbackRunId,
  fallbackRunStatus,
  fallbackBlockingState,
}: {
  bundle: CapabilityBundle;
  workItem: WorkItem;
  runDetail?: WorkflowRunDetail | null;
  fallbackRunId?: string;
  fallbackRunStatus?: string;
  fallbackBlockingState?: string;
}) => {
  const suggestions: string[] = [];
  const runId =
    runDetail?.run.id || fallbackRunId || workItem.activeRunId || workItem.lastRunId;
  const openWait = getOpenWait(runDetail);

  if (openWait?.type === 'APPROVAL' && runId) {
    suggestions.push(`approve ${runId}: approve and continue`);
    suggestions.push(`request changes ${runId}: <what should change before continuation>`);
  } else if (openWait?.type === 'INPUT') {
    suggestions.push(`provide input for ${workItem.id}: <the missing detail>`);
  } else if (openWait?.type === 'CONFLICT_RESOLUTION') {
    suggestions.push(`resolve conflict for ${workItem.id}: <the authoritative decision>`);
  } else if (
    workItem.status === 'BLOCKED' ||
    fallbackRunStatus === 'FAILED' ||
    /blocked|failed|guidance/i.test(String(fallbackBlockingState || ''))
  ) {
    suggestions.push(
      `guide agent for ${workItem.id}: <the missing business or technical direction>`,
    );
    if (runId) {
      suggestions.push(`restart ${workItem.id}`);
    }
  } else if (runId && fallbackRunStatus === 'RUNNING') {
    suggestions.push(`show the live status of ${workItem.id}`);
    suggestions.push(`cancel ${runId}: <reason to stop this attempt>`);
  } else if (workItem.status === 'ACTIVE') {
    suggestions.push(`show the live status of ${workItem.id}`);
  }

  return Array.from(new Set(suggestions)).slice(0, 4);
};

const buildExecutionOverviewSummary = (bundle: CapabilityBundle) => {
  const workSummary = buildOverallStatusSummary(bundle);
  const attentionItems = getAttentionWorkItems(bundle).slice(0, 5);
  const detection = detectCapabilityWorkspaceProfile(bundle.capability);
  const workspaceSummary =
    detection.profile.stack !== 'GENERIC'
      ? `Workspace profile: ${detection.profile.summary}`
      : detection.normalizedPath
      ? `Workspace detection: ${detection.profile.summary}`
      : null;

  return [
    `Execution Agent view for ${bundle.capability.name}`,
    workspaceSummary,
    workSummary,
    attentionItems.length > 0 ? 'Suggested next chats:' : 'No urgent execution blockers are open right now.',
    ...attentionItems.slice(0, 3).flatMap(item => [
      `- Show the live status of ${item.id}.`,
      `- Explain what is needed to move "${item.title}" forward.`,
    ]),
  ]
    .filter(Boolean)
    .join('\n');
};

const buildWorkItemStatusSummary = async (
  bundle: CapabilityBundle,
  workItem: WorkItem,
) => {
  let runDetail: WorkflowRunDetail | null = null;
  const runId = workItem.activeRunId || workItem.lastRunId;
  if (runId) {
    try {
      runDetail = await getWorkflowRunDetail(bundle.capability.id, runId);
    } catch {
      runDetail = null;
    }
  }

  const openWait = getOpenWait(runDetail);
  const currentStep = workItem.currentStepId
    ? bundle.workspace.workflows
        .find(workflow => workflow.id === workItem.workflowId)
        ?.steps.find(step => step.id === workItem.currentStepId)
    : undefined;
  try {
    const explain = await buildWorkItemExplainDetail(bundle.capability.id, workItem.id);
    const suggestions = buildSuggestedExecutionActions({
      bundle,
      workItem,
      runDetail,
      fallbackRunId: explain.latestRun?.id,
      fallbackRunStatus: explain.latestRun?.status,
      fallbackBlockingState: explain.summary.blockingState,
    });
    const approvedRoots = [
      bundle.capability.executionConfig.defaultWorkspacePath,
      ...bundle.capability.executionConfig.allowedWorkspacePaths,
    ]
      .filter(Boolean)
      .slice(0, 3);
    const repositories = bundle.capability.gitRepositories.slice(0, 3);
    const databases = (bundle.capability.databaseConfigs || [])
      .map(config => `${config.label} (${config.engine})`)
      .slice(0, 3);
    const detection = detectCapabilityWorkspaceProfile(bundle.capability);

    return [
      `Execution view: ${formatWorkItemHeading(workItem)}`,
      explain.summary.headline,
      detection.profile.stack !== 'GENERIC'
        ? `Workspace profile: ${detection.profile.summary}`
        : null,
      detection.evidenceFiles.length > 0
        ? `Workspace evidence: ${detection.evidenceFiles.join(', ')}`
        : null,
      detection.recommendedCommandTemplates.length > 0
        ? `Suggested execution commands: ${detection.recommendedCommandTemplates
            .map(template => `${template.id} => ${template.command.join(' ')}`)
            .join('; ')}`
        : null,
      `Phase: ${getLifecyclePhaseLabel(bundle.capability, workItem.phase)}`,
      `Status: ${workItem.status}`,
      currentStep ? `Current step: ${currentStep.name}` : null,
      workItem.assignedAgentId ? `Assigned agent: ${workItem.assignedAgentId}` : null,
      explain.latestRun
        ? `Latest run: ${explain.latestRun.id} (${explain.latestRun.status})`
        : runDetail
        ? `Latest run: ${runDetail.run.id} (${runDetail.run.status})`
        : null,
      openWait
        ? `Open wait: ${openWait.type} - ${openWait.message}`
        : explain.summary.blockingState
        ? `Why it matters: ${explain.summary.blockingState}`
        : workItem.pendingRequest
        ? `Pending request: ${workItem.pendingRequest.type} - ${workItem.pendingRequest.message}`
        : null,
      explain.latestRun?.terminalOutcome
        ? `Latest outcome: ${explain.latestRun.terminalOutcome}`
        : null,
      `Next action: ${explain.summary.nextAction}`,
      `Release readiness: ${explain.releaseReadiness.status} (${explain.releaseReadiness.score}%)`,
      explain.attemptDiff.summary
        ? `What changed since last attempt: ${explain.attemptDiff.summary}`
        : null,
      repositories.length > 0 ? `Repositories: ${repositories.join(', ')}` : null,
      approvedRoots.length > 0 ? `Approved workspaces: ${approvedRoots.join(', ')}` : null,
      databases.length > 0 ? `Databases: ${databases.join(', ')}` : null,
      workItem.history.length > 0
        ? `Latest history: ${
            workItem.history[workItem.history.length - 1]?.detail ||
            workItem.history[workItem.history.length - 1]?.action
          }`
        : null,
      suggestions.length > 0 ? 'Suggested chat options:' : null,
      ...suggestions.map(item => `- ${item}`),
    ]
      .filter(Boolean)
      .join('\n');
  } catch {
    return [
      `Work item: ${formatWorkItemHeading(workItem)}`,
      `Phase: ${getLifecyclePhaseLabel(bundle.capability, workItem.phase)}`,
      `Status: ${workItem.status}`,
      currentStep ? `Current step: ${currentStep.name}` : null,
      workItem.assignedAgentId ? `Assigned agent: ${workItem.assignedAgentId}` : null,
      runDetail ? `Run: ${runDetail.run.id} (${runDetail.run.status})` : null,
      openWait
        ? `Open wait: ${openWait.type} - ${openWait.message}`
        : workItem.pendingRequest
        ? `Pending request: ${workItem.pendingRequest.type} - ${workItem.pendingRequest.message}`
        : null,
      workItem.blocker
        ? `Blocker: ${workItem.blocker.type} - ${workItem.blocker.message}`
        : null,
      workItem.history.length > 0
        ? `Latest history: ${
            workItem.history[workItem.history.length - 1]?.detail ||
            workItem.history[workItem.history.length - 1]?.action
          }`
        : null,
    ]
      .filter(Boolean)
      .join('\n');
  }
};

export const buildWorkItemStageControlBriefing = async ({
  bundle,
  workItemId,
}: {
  bundle: CapabilityBundle;
  workItemId: string;
}) => {
  const workItem = bundle.workspace.workItems.find(item => item.id === workItemId);
  if (!workItem) {
    throw new Error(`Work item ${workItemId} was not found.`);
  }

  const workflow = bundle.workspace.workflows.find(item => item.id === workItem.workflowId);
  const runId = workItem.activeRunId || workItem.lastRunId;
  let runDetail: WorkflowRunDetail | null = null;

  if (runId) {
    try {
      runDetail = await getWorkflowRunDetail(bundle.capability.id, runId);
    } catch {
      runDetail = null;
    }
  }

  const openWait = getOpenWait(runDetail);
  const currentStep = runDetail?.run.currentStepId
    ? workflow?.steps.find(step => step.id === runDetail?.run.currentStepId)
    : workItem.currentStepId
    ? workflow?.steps.find(step => step.id === workItem.currentStepId)
    : undefined;
  const currentRunStep =
    runDetail?.steps.find(
      step =>
        step.workflowStepId === runDetail.run.currentStepId ||
        step.workflowNodeId === runDetail.run.currentNodeId,
    ) || null;
  const compiledStepContext =
    asCompiledStepContext(currentRunStep?.metadata?.compiledStepContext) ||
    asCompiledStepContext(openWait?.payload?.compiledStepContext);
  const compiledWorkItemPlan =
    asCompiledWorkItemPlan(currentRunStep?.metadata?.compiledWorkItemPlan) ||
    asCompiledWorkItemPlan(openWait?.payload?.compiledWorkItemPlan);
  const requestedInputFields = asCompiledInputFields(openWait?.payload?.requestedInputFields);
  const explain = await buildWorkItemExplainDetail(bundle.capability.id, workItem.id);
  const agentId =
    runDetail?.run.assignedAgentId || currentStep?.agentId || workItem.assignedAgentId;
  const approvedRoots = [
    bundle.capability.executionConfig.defaultWorkspacePath,
    ...bundle.capability.executionConfig.allowedWorkspacePaths,
  ].filter(Boolean);

  return [
    `Stage control context for ${formatWorkItemHeading(workItem)}`,
    explain.summary.headline,
    `Phase: ${getLifecyclePhaseLabel(bundle.capability, workItem.phase)}`,
    `Status: ${workItem.status}`,
    currentStep ? `Current step: ${currentStep.name}` : 'Current step: Awaiting orchestration',
    agentId ? `Assigned stage agent: ${agentId}` : null,
    runDetail ? `Run: ${runDetail.run.id} (${runDetail.run.status})` : null,
    openWait ? `Open wait: ${openWait.type} - ${openWait.message}` : null,
    compiledWorkItemPlan ? `Work plan: ${compiledWorkItemPlan.planSummary}` : null,
    compiledStepContext?.objective
      ? `Stage objective: ${compiledStepContext.objective}`
      : currentStep?.action
      ? `Stage objective: ${currentStep.action}`
      : null,
    compiledStepContext?.description
      ? `Stage guidance: ${compiledStepContext.description}`
      : currentStep?.description
      ? `Stage guidance: ${currentStep.description}`
      : null,
    compiledStepContext
      ? `Required inputs: ${formatInputSummary(compiledStepContext.requiredInputs)}`
      : requestedInputFields.length > 0
      ? `Requested inputs: ${formatInputSummary(requestedInputFields)}`
      : null,
    compiledStepContext
      ? `Artifact checklist: ${formatChecklistSummary(compiledStepContext.artifactChecklist)}`
      : null,
    compiledStepContext?.completionChecklist?.length
      ? `Completion checklist: ${compiledStepContext.completionChecklist.join('; ')}`
      : null,
    compiledStepContext?.nextActions?.length
      ? `Next allowed actions: ${compiledStepContext.nextActions.join('; ')}`
      : null,
    approvedRoots.length > 0 ? `Approved workspaces: ${approvedRoots.join(', ')}` : null,
    `Release readiness: ${explain.releaseReadiness.status} (${explain.releaseReadiness.score}%)`,
    `Operator goal: help the user understand and complete only the current stage. Stay focused on this work item and current step, and produce concrete stage-ready guidance.`,
  ]
    .filter(Boolean)
    .join('\n');
};

const buildAmbiguousTargetMessage = (matches: WorkItem[]) =>
  [
    'I found more than one matching work item. Tell me which one to act on using the exact work item id.',
    ...matches.slice(0, 5).map(item => `- ${formatWorkItemHeading(item)} (${item.status})`),
  ].join('\n');

const resolvePhaseFromMessage = (
  capability: Capability,
  message: string,
): WorkItemPhase | undefined => {
  const normalized = normalizeText(message);
  const candidates = getCapabilityBoardPhaseIds(capability).map(phaseId => ({
    id: phaseId,
    label: normalizeText(getLifecyclePhaseLabel(capability, phaseId)),
  }));

  for (const candidate of candidates) {
    const normalizedId = normalizeText(candidate.id);
    if (
      normalized.includes(` to ${candidate.label}`) ||
      normalized.includes(` as ${candidate.label}`) ||
      normalized.endsWith(` ${candidate.label}`) ||
      normalized.includes(` to ${normalizedId}`) ||
      normalized.includes(` as ${normalizedId}`) ||
      normalized.endsWith(` ${normalizedId}`)
    ) {
      return candidate.id;
    }
  }

  if (/\b(done|complete|completed)\b/.test(normalized)) {
    return 'DONE';
  }
  if (/\bbacklog\b/.test(normalized)) {
    return 'BACKLOG';
  }

  return undefined;
};

const parseWorkspaceAction = (
  bundle: CapabilityBundle,
  message: string,
): ParsedChatWorkspaceAction | null => {
  const normalized = normalizeText(message);
  const note = extractNote(message);
  const workItemId = extractId(message, 'WI');
  const runId = extractId(message, 'RUN');
  const targetPhase = resolvePhaseFromMessage(bundle.capability, message);
  const hasExplicitTarget = Boolean(workItemId || runId || extractQuotedTitle(message));
  const mentionsDeliveryObject =
    hasExplicitTarget ||
    /\b(work item|run|execution|phase|approval|input|conflict|blocked|stuck|waiting|failed)\b/.test(
      normalized,
    );
  const asksForExecutionStatus =
    /\b(status|progress|what needs attention|what is blocked|what is stuck|show work|delivery summary)\b/.test(
      normalized,
    ) ||
    (
      mentionsDeliveryObject &&
      (
        /\b(what happened|explain|next step|next action|option|options|suggested action|suggested actions)\b/.test(
          normalized,
        ) ||
        (/\bwhy\b/.test(normalized) && /\b(blocked|waiting|stuck|failed)\b/.test(normalized))
      )
    );

  if (asksForExecutionStatus) {
    return { type: 'STATUS', workItemId, runId };
  }

  if (/\brequest changes|reject|send back\b/.test(normalized)) {
    return { type: 'REQUEST_CHANGES', workItemId, runId, note };
  }

  if (/\bapprove\b|\bapprove and continue\b|\bgo ahead\b|\ballow it\b/.test(normalized)) {
    return { type: 'APPROVE', workItemId, runId, note };
  }

  if (/\bprovide input\b|\bhere is the input\b|\binput\b/.test(normalized)) {
    return { type: 'PROVIDE_INPUT', workItemId, runId, note };
  }

  if (/\bresolve conflict\b|\bsettle conflict\b/.test(normalized)) {
    return { type: 'RESOLVE_CONFLICT', workItemId, runId, note };
  }

  if (/\bguide (the )?agent\b|\bgive guidance\b|\bcoach\b/.test(normalized)) {
    return { type: 'GUIDE_AGENT', workItemId, runId, note, targetPhase };
  }

  if (/\bunblock\b|\bcontinue it\b|\bmove it forward\b/.test(normalized)) {
    return { type: 'UNBLOCK', workItemId, runId, note };
  }

  if (/\breset progress\b/.test(normalized) || /\brestart\b/.test(normalized)) {
    return { type: 'RESTART', workItemId, runId, targetPhase };
  }

  if (/\bcancel\b|\bstop run\b|\bstop execution\b/.test(normalized)) {
    return { type: 'CANCEL', workItemId, runId, note };
  }

  if (
    (/\bstart\b|\brun\b/.test(normalized)) &&
    !/\bstatus\b/.test(normalized) &&
    mentionsDeliveryObject
  ) {
    return { type: 'START', workItemId, runId };
  }

  if (
    targetPhase &&
    /\bmove\b|\bset\b|\bchange\b|\bmark\b/.test(normalized) &&
    mentionsDeliveryObject
  ) {
    return { type: 'MOVE_PHASE', workItemId, targetPhase, note };
  }

  return null;
};

const resolveActionTarget = (
  bundle: CapabilityBundle,
  action: ParsedChatWorkspaceAction,
  message: string,
) => {
  if (action.runId) {
    const workItem = findWorkItemByRunId(bundle, action.runId);
    if (workItem) {
      return { workItem };
    }
  }

  if (action.workItemId) {
    const workItem = bundle.workspace.workItems.find(item => item.id === action.workItemId);
    return workItem ? { workItem } : { missing: `I could not find work item ${action.workItemId}.` };
  }

  const resolved = resolveTargetWorkItem(bundle, message);
  if (resolved.ambiguous?.length) {
    return { ambiguous: resolved.ambiguous };
  }
  if (resolved.workItem) {
    return { workItem: resolved.workItem };
  }
  return { missing: 'Tell me which work item to use by id, for example WI-ABC123.' };
};

const resolveRunForAction = async (
  capabilityId: string,
  workItem?: WorkItem,
  explicitRunId?: string,
) => {
  const runId = explicitRunId || workItem?.activeRunId || workItem?.lastRunId;
  if (!runId) {
    return null;
  }

  return getWorkflowRunDetail(capabilityId, runId);
};

const buildOverallStatusSummary = (bundle: CapabilityBundle) => {
  const counts = {
    active: bundle.workspace.workItems.filter(item => item.status === 'ACTIVE').length,
    blocked: bundle.workspace.workItems.filter(item => item.status === 'BLOCKED').length,
    approvals: bundle.workspace.workItems.filter(item => item.status === 'PENDING_APPROVAL').length,
    completed: bundle.workspace.workItems.filter(item => item.status === 'COMPLETED').length,
  };

  const items = bundle.workspace.workItems
    .slice()
    .sort((left, right) => left.title.localeCompare(right.title))
    .slice(0, 8)
    .map(
      item =>
        `- ${formatWorkItemHeading(item)} | ${getLifecyclePhaseLabel(bundle.capability, item.phase)} | ${item.status}${
          item.pendingRequest ? ` | waiting ${item.pendingRequest.type.toLowerCase()}` : ''
        }${item.blocker ? ` | blocker ${item.blocker.type.toLowerCase()}` : ''}`,
    );

  return [
    `Capability: ${bundle.capability.name}`,
    `Work summary: ${counts.active} active, ${counts.blocked} blocked, ${counts.approvals} pending approval, ${counts.completed} completed.`,
    items.length > 0 ? 'Current work items:' : 'There are no work items yet.',
    ...items,
  ].join('\n');
};

const buildCapabilityMetadataSummary = (bundle: CapabilityBundle) => {
  const { capability, workspace } = bundle;
  const workflowNames = workspace.workflows
    .slice(0, 3)
    .map(workflow => workflow.name)
    .filter(Boolean);
  const approvedRoots = [
    capability.executionConfig.defaultWorkspacePath,
    ...capability.executionConfig.allowedWorkspacePaths,
  ]
    .filter(Boolean)
    .slice(0, 3);
  const repositories = capability.gitRepositories.slice(0, 3);
  const databases = (capability.databaseConfigs || [])
    .map(config => `${config.label} (${config.engine})`)
    .slice(0, 3);

  return [
    `Capability metadata: ${capability.name}${capability.domain ? ` | ${capability.domain}` : ''}`,
    capability.businessOutcome ? `Business outcome: ${capability.businessOutcome}` : null,
    capability.ownerTeam ? `Owner team: ${capability.ownerTeam}` : null,
    workflowNames.length > 0 ? `Workflows: ${workflowNames.join(', ')}` : null,
    repositories.length > 0 ? `Repositories: ${repositories.join(', ')}` : null,
    approvedRoots.length > 0 ? `Approved workspaces: ${approvedRoots.join(', ')}` : null,
    databases.length > 0 ? `Databases: ${databases.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');
};

export const buildLiveWorkspaceBriefing = (bundle: CapabilityBundle) => {
  const workSummary = buildOverallStatusSummary(bundle);
  const highlightedItems = getAttentionWorkItems(bundle)
    .slice(0, 5)
    .map(
      item =>
        `${item.id} | ${item.title} | ${getLifecyclePhaseLabel(bundle.capability, item.phase)} | ${item.status}`,
    );

  return [
    'Live capability context:',
    buildCapabilityMetadataSummary(bundle),
    '',
    'Live delivery context:',
    workSummary,
    highlightedItems.length > 0
      ? `Attention items: ${highlightedItems.join('; ')}`
      : 'Attention items: none right now.',
    'If the user asks to change work state and the intent is ambiguous, ask for the exact work item id before proceeding.',
  ].join('\n\n');
};

export const maybeHandleCapabilityChatAction = async ({
  bundle,
  agent,
  message,
}: {
  bundle: CapabilityBundle;
  agent: Partial<CapabilityAgent>;
  message: string;
}): Promise<ChatWorkspaceActionResult> => {
  const normalizedMessage = normalizeText(message);
  let action = parseWorkspaceAction(bundle, message);
  if (!action) {
    if (isExecutionAgent(agent)) {
      const resolved = resolveTargetWorkItem(bundle, message);
      const looksLikeSkipGuidance =
        /\bskip\b/.test(normalizedMessage) &&
        /\b(build|test|docs|validation|step|it|this)\b/.test(normalizedMessage);
      if (looksLikeSkipGuidance && resolved.workItem) {
        action = {
          type: 'GUIDE_AGENT',
          workItemId: resolved.workItem.id,
          note: message.trim(),
        };
      }
    }
  }

  if (!action) {
    if (isExecutionAgent(agent)) {
      const resolved = resolveTargetWorkItem(bundle, message);
      if (resolved.ambiguous?.length) {
        return {
          handled: true,
          content: buildAmbiguousTargetMessage(resolved.ambiguous),
        };
      }
      if (resolved.workItem) {
        return {
          handled: true,
          content: await buildWorkItemStatusSummary(bundle, resolved.workItem),
        };
      }

      if (/\b(status|progress|blocked|stuck|run|execution|approval|input|conflict|attention|overview|summary)\b/.test(normalizedMessage)) {
        return {
          handled: true,
          content: buildExecutionOverviewSummary(bundle),
        };
      }
    }

    return { handled: false };
  }

  if (action.type === 'STATUS' && !action.workItemId && !action.runId) {
    return {
      handled: true,
      content: isExecutionAgent(agent)
        ? buildExecutionOverviewSummary(bundle)
        : buildOverallStatusSummary(bundle),
    };
  }

  const target = resolveActionTarget(bundle, action, message);
  if (target.ambiguous?.length) {
    return {
      handled: true,
      content: buildAmbiguousTargetMessage(target.ambiguous),
    };
  }
  if (target.missing) {
    return {
      handled: true,
      content: target.missing,
    };
  }

  const workItem = target.workItem;
  if (!workItem) {
    return {
      handled: true,
      content: 'I could not resolve the target work item for that request.',
    };
  }

  if (action.type === 'STATUS') {
    return {
      handled: true,
      content: await buildWorkItemStatusSummary(bundle, workItem),
    };
  }

  const resolutionActor = `${agent.name || agent.role || 'Capability Owner'} via chat`;

  if (action.type === 'MOVE_PHASE') {
    if (!action.targetPhase) {
      return {
        handled: true,
        content: 'Tell me which phase to move the work item to, for example "move WI-123 to Development".',
      };
    }

    const moved = await moveWorkItemToPhaseControl({
      capabilityId: bundle.capability.id,
      workItemId: workItem.id,
      targetPhase: action.targetPhase,
      note:
        action.note ||
        `Moved through chat by ${agent.name || agent.role || 'the active agent'}.`,
    });

    return {
      handled: true,
      changedState: true,
      content: [
        `Moved ${formatWorkItemHeading(moved)} to ${getLifecyclePhaseLabel(bundle.capability, moved.phase)}.`,
        `Status is now ${moved.status}.`,
      ].join('\n'),
    };
  }

  if (action.type === 'START') {
    const detail = await startWorkflowExecution({
      capabilityId: bundle.capability.id,
      workItemId: workItem.id,
      guidance: action.note,
      guidedBy: resolutionActor,
    });
    return {
      handled: true,
      changedState: true,
      wakeWorker: true,
      content: [
        `Started ${formatWorkItemHeading(workItem)}.`,
        `Run ${detail.run.id} is now ${detail.run.status} in ${getLifecyclePhaseLabel(bundle.capability, detail.run.currentPhase)}.`,
      ].join('\n'),
    };
  }

  const runDetail = await resolveRunForAction(
    bundle.capability.id,
    workItem,
    action.runId,
  );

  if (!runDetail) {
    if (
      (action.type === 'GUIDE_AGENT' || action.type === 'UNBLOCK') &&
      workItem.status === 'BLOCKED' &&
      action.note?.trim()
    ) {
      const detail = await startWorkflowExecution({
        capabilityId: bundle.capability.id,
        workItemId: workItem.id,
        restartFromPhase: action.targetPhase || workItem.phase,
        guidance: action.note,
        guidedBy: resolutionActor,
      });
      return {
        handled: true,
        changedState: true,
        wakeWorker: true,
        content: `Guided ${formatWorkItemHeading(workItem)} into a fresh run. Run ${detail.run.id} is now ${detail.run.status}.`,
      };
    }

    return {
      handled: true,
      content: `I could not find an active run for ${formatWorkItemHeading(workItem)}.`,
    };
  }

  if (action.type === 'RESTART') {
    const detail = await restartWorkflowRun({
      capabilityId: bundle.capability.id,
      runId: runDetail.run.id,
      restartFromPhase: action.targetPhase || workItem.phase,
      guidance: action.note,
      guidedBy: resolutionActor,
    });
    return {
      handled: true,
      changedState: true,
      wakeWorker: true,
      content: [
        `Restarted ${formatWorkItemHeading(workItem)} from ${getLifecyclePhaseLabel(bundle.capability, detail.run.currentPhase || workItem.phase)}.`,
        `New run ${detail.run.id} is ${detail.run.status}.`,
      ].join('\n'),
    };
  }

  if (action.type === 'GUIDE_AGENT') {
    if (!action.note?.trim()) {
      return {
        handled: true,
        content: `Add the guidance after a colon, for example: guide agent for ${workItem.id}: use the approved workspace path /repo/app and keep the API surface unchanged`,
      };
    }

    const openWait = getOpenWait(runDetail);
    if (openWait?.type === 'INPUT') {
      const detail = await provideWorkflowRunInput({
        capabilityId: bundle.capability.id,
        runId: runDetail.run.id,
        resolution: action.note,
        resolvedBy: resolutionActor,
      });
      return {
        handled: true,
        changedState: true,
        wakeWorker: true,
        content: `Guidance submitted for ${formatWorkItemHeading(workItem)}. Run ${detail.run.id} is now ${detail.run.status}.`,
      };
    }

    if (openWait?.type === 'CONFLICT_RESOLUTION') {
      const detail = await resolveWorkflowRunConflict({
        capabilityId: bundle.capability.id,
        runId: runDetail.run.id,
        resolution: action.note,
        resolvedBy: resolutionActor,
      });
      return {
        handled: true,
        changedState: true,
        wakeWorker: true,
        content: `Conflict guidance submitted for ${formatWorkItemHeading(workItem)}. Run ${detail.run.id} is now ${detail.run.status}.`,
      };
    }

    const detail = await restartWorkflowRun({
      capabilityId: bundle.capability.id,
      runId: runDetail.run.id,
      restartFromPhase: action.targetPhase || workItem.phase,
      guidance: action.note,
      guidedBy: resolutionActor,
    });
    return {
      handled: true,
      changedState: true,
      wakeWorker: true,
      content: [
        `Guided ${formatWorkItemHeading(workItem)} with fresh operator context.`,
        `Run ${detail.run.id} restarted from ${getLifecyclePhaseLabel(bundle.capability, detail.run.currentPhase || workItem.phase)}.`,
      ].join('\n'),
    };
  }

  if (action.type === 'CANCEL') {
    const detail = await cancelWorkflowRun({
      capabilityId: bundle.capability.id,
      runId: runDetail.run.id,
      note:
        action.note ||
        `Cancelled through chat by ${agent.name || agent.role || 'the active agent'}.`,
    });
    return {
      handled: true,
      changedState: true,
      content: [
        `Cancelled run ${detail.run.id} for ${formatWorkItemHeading(workItem)}.`,
        `Run status is now ${detail.run.status}.`,
      ].join('\n'),
    };
  }

  const openWait = getOpenWait(runDetail);
  if (!openWait) {
    if (
      action.type === 'UNBLOCK' &&
      workItem.status === 'BLOCKED' &&
      action.note?.trim()
    ) {
      const detail = await restartWorkflowRun({
        capabilityId: bundle.capability.id,
        runId: runDetail.run.id,
        restartFromPhase: action.targetPhase || workItem.phase,
        guidance: action.note,
        guidedBy: resolutionActor,
      });
      return {
        handled: true,
        changedState: true,
        wakeWorker: true,
        content: `Unblocked ${formatWorkItemHeading(workItem)} with new operator guidance. Run ${detail.run.id} is now ${detail.run.status}.`,
      };
    }

    return {
      handled: true,
      content:
        action.type === 'UNBLOCK' && workItem.status === 'BLOCKED'
          ? `${formatWorkItemHeading(workItem)} is blocked without an open wait. Add guidance after a colon, for example: unblock ${workItem.id}: use the approved workspace path /repo/app and retry from the current phase`
          : `${formatWorkItemHeading(workItem)} does not currently have an open wait to resolve.`,
    };
  }

  if (action.type === 'APPROVE') {
    const detail = await approveWorkflowRun({
      capabilityId: bundle.capability.id,
      runId: runDetail.run.id,
      resolution: action.note || 'Approved for continuation from chat.',
      resolvedBy: resolutionActor,
    });
    return {
      handled: true,
      changedState: true,
      wakeWorker: true,
      content: [
        `Approved ${formatWorkItemHeading(workItem)}.`,
        `Run ${detail.run.id} is now ${detail.run.status}.`,
      ].join('\n'),
    };
  }

  if (action.type === 'REQUEST_CHANGES') {
    const detail = await requestChangesWorkflowRun({
      capabilityId: bundle.capability.id,
      runId: runDetail.run.id,
      resolution: action.note || 'Changes requested from chat before continuation.',
      resolvedBy: resolutionActor,
    });
    return {
      handled: true,
      changedState: true,
      wakeWorker: true,
      content: [
        `Requested changes for ${formatWorkItemHeading(workItem)}.`,
        `Run ${detail.run.id} remains in motion for a revised attempt.`,
      ].join('\n'),
    };
  }

  if (action.type === 'PROVIDE_INPUT') {
    if (!action.note?.trim()) {
      const requestedFields = openWait.payload?.requestedInputFields
        ?.map(field => field.label)
        .filter(Boolean);
      return {
        handled: true,
        content: requestedFields?.length
          ? `This item is waiting for input. Reply with the exact input after a colon, for example: provide input for ${workItem.id}: ${requestedFields.join(', ')}`
          : `This item is waiting for input. Reply with the input after a colon, for example: provide input for ${workItem.id}: approved workspace path is /repo/app`,
      };
    }

    const detail = await provideWorkflowRunInput({
      capabilityId: bundle.capability.id,
      runId: runDetail.run.id,
      resolution: action.note,
      resolvedBy: resolutionActor,
    });
    return {
      handled: true,
      changedState: true,
      wakeWorker: true,
      content: [
        `Provided input for ${formatWorkItemHeading(workItem)}.`,
        `Run ${detail.run.id} is now ${detail.run.status}.`,
      ].join('\n'),
    };
  }

  if (action.type === 'RESOLVE_CONFLICT') {
    if (!action.note?.trim()) {
      return {
        handled: true,
        content: `This item is waiting on conflict resolution. Reply with the resolution after a colon, for example: resolve conflict for ${workItem.id}: proceed with the simpler API shape`,
      };
    }

    const detail = await resolveWorkflowRunConflict({
      capabilityId: bundle.capability.id,
      runId: runDetail.run.id,
      resolution: action.note,
      resolvedBy: resolutionActor,
    });
    return {
      handled: true,
      changedState: true,
      wakeWorker: true,
      content: [
        `Resolved the conflict for ${formatWorkItemHeading(workItem)}.`,
        `Run ${detail.run.id} is now ${detail.run.status}.`,
      ].join('\n'),
    };
  }

  if (action.type === 'UNBLOCK') {
    if (openWait.type === 'APPROVAL') {
      const detail = await approveWorkflowRun({
        capabilityId: bundle.capability.id,
        runId: runDetail.run.id,
        resolution: action.note || 'Approved through chat to unblock the work item.',
        resolvedBy: resolutionActor,
      });
      return {
        handled: true,
        changedState: true,
        wakeWorker: true,
        content: `Unblocked ${formatWorkItemHeading(workItem)} by approving the open wait. Run ${detail.run.id} is now ${detail.run.status}.`,
      };
    }

    if (openWait.type === 'INPUT') {
      if (!action.note?.trim()) {
        return {
          handled: true,
          content: `This item is waiting for input. Add the input after a colon, for example: unblock ${workItem.id}: the approved repository path is /repo/app`,
        };
      }

      const detail = await provideWorkflowRunInput({
        capabilityId: bundle.capability.id,
        runId: runDetail.run.id,
        resolution: action.note,
        resolvedBy: resolutionActor,
      });
      return {
        handled: true,
        changedState: true,
        wakeWorker: true,
        content: `Unblocked ${formatWorkItemHeading(workItem)} by providing the requested input. Run ${detail.run.id} is now ${detail.run.status}.`,
      };
    }

    if (!action.note?.trim()) {
      return {
        handled: true,
        content: `This item is waiting on conflict resolution. Add the resolution after a colon, for example: unblock ${workItem.id}: use the safer staged rollout`,
      };
    }

    const detail = await resolveWorkflowRunConflict({
      capabilityId: bundle.capability.id,
      runId: runDetail.run.id,
      resolution: action.note,
      resolvedBy: resolutionActor,
    });
    return {
      handled: true,
      changedState: true,
      wakeWorker: true,
      content: `Unblocked ${formatWorkItemHeading(workItem)} by resolving the conflict. Run ${detail.run.id} is now ${detail.run.status}.`,
    };
  }

  return {
    handled: false,
  };
};
