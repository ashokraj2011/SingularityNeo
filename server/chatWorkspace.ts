import {
  getCapabilityBoardPhaseIds,
  getLifecyclePhaseLabel,
} from '../src/lib/capabilityLifecycle';
import type {
  Capability,
  CapabilityAgent,
  CapabilityWorkspace,
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
    /\b(work item|workflow|run|execution|phase|approval|input|conflict|blocked|stuck)\b/.test(
      normalized,
    );

  if (
    /\b(status|progress|what needs attention|what is blocked|what is stuck|show work|delivery summary)\b/.test(
      normalized,
    )
  ) {
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
  const action = parseWorkspaceAction(bundle, message);
  if (!action) {
    return { handled: false };
  }

  if (action.type === 'STATUS' && !action.workItemId && !action.runId) {
    return {
      handled: true,
      content: buildOverallStatusSummary(bundle),
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
    return {
      handled: true,
      content: `${formatWorkItemHeading(workItem)} does not currently have an open wait to resolve.`,
    };
  }

  const resolutionActor = `${agent.name || agent.role || 'Capability Owner'} via chat`;

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
