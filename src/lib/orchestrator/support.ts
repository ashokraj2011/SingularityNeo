import type {
  ApprovalAssignment,
  ApprovalDecision,
  Artifact,
  CapabilityStakeholder,
  CompiledArtifactChecklistItem,
  CompiledRequiredInputField,
  CompiledStepContext,
  CompiledWorkItemPlan,
  ContrarianConflictReview,
  RunEvent,
  RunWait,
  WorkItem,
  WorkItemAttachmentUpload,
  WorkItemClaim,
  WorkItemExecutionContext,
  WorkItemHandoffPacket,
  WorkItemPhase,
  WorkItemPhaseStakeholderAssignment,
  WorkItemPresence,
  WorkItemTaskType,
  Workflow,
  WorkflowRun,
  WorkflowRunDetail,
} from '../../types';
import { readViewPreference } from '../viewPreferences';

export type OrchestratorView = 'board' | 'list';
export type DetailTab = 'operate' | 'artifacts' | 'attempts' | 'receipts' | 'segments';
export type WorkItemStatusFilter = 'ALL' | WorkItem['status'];
export type WorkItemPriorityFilter = 'ALL' | WorkItem['priority'];
export type ArtifactWorkbenchFilter =
  | 'ALL'
  | 'INPUTS'
  | 'OUTPUTS'
  | 'DIFFS'
  | 'APPROVALS'
  | 'HANDOFFS';

export type StageChatMessage = {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  deliveryState?: 'clean' | 'recovered' | 'interrupted';
  error?: string;
  traceId?: string;
  model?: string;
  sessionId?: string;
  sessionScope?: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  sessionScopeId?: string;
};

export type WorkNavigatorItem = {
  item: WorkItem;
  attentionLabel?: string;
  attentionReason?: string;
  currentStepName: string;
  agentName: string;
  ageLabel: string;
};

export type WorkNavigatorSection = {
  id: string;
  title: string;
  helper: string;
  items: WorkNavigatorItem[];
};

export type WorkbenchQueueView =
  | 'ALL_WORK'
  | 'MY_QUEUE'
  | 'TEAM_QUEUE'
  | 'ATTENTION'
  | 'PAUSED'
  | 'WATCHING'
  | 'ARCHIVE';

export type WorkbenchSelectionFocus = 'INPUT' | 'APPROVAL' | 'RESOLUTION';

export type {
  ApprovalAssignment,
  ApprovalDecision,
  Artifact,
  CapabilityStakeholder,
  CompiledArtifactChecklistItem,
  CompiledRequiredInputField,
  CompiledStepContext,
  CompiledWorkItemPlan,
  ContrarianConflictReview,
  RunEvent,
  RunWait,
  WorkItem,
  WorkItemAttachmentUpload,
  WorkItemClaim,
  WorkItemExecutionContext,
  WorkItemHandoffPacket,
  WorkItemPhase,
  WorkItemPhaseStakeholderAssignment,
  WorkItemPresence,
  WorkItemTaskType,
  Workflow,
  WorkflowRun,
  WorkflowRunDetail,
};

export const STORAGE_KEYS = {
  view: 'singularity.orchestrator.view',
  detailTab: 'singularity.orchestrator.detailTab',
  selected: 'singularity.orchestrator.selected',
  search: 'singularity.orchestrator.search',
  workflow: 'singularity.orchestrator.workflow',
  status: 'singularity.orchestrator.status',
  priority: 'singularity.orchestrator.priority',
  queueView: 'singularity.orchestrator.queueView',
  advanced: 'singularity.orchestrator.advanced.open',
} as const;

export const readSessionValue = <T extends string>(key: string, fallback: T): T =>
  readViewPreference(key, fallback, { storage: 'session' });

export const formatTimestamp = (value?: string | Date): string => {
  if (!value) {
    return 'Not yet';
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value instanceof Date ? value.toISOString() : value;
  }

  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const formatRelativeTime = (value?: string) => {
  if (!value) {
    return 'Unknown';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  const diff = Date.now() - parsed.getTime();
  const minutes = Math.max(1, Math.floor(diff / (1000 * 60)));

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

export const getPriorityTone = (priority: WorkItem['priority']) => {
  if (priority === 'High') {
    return 'danger' as const;
  }
  if (priority === 'Med') {
    return 'warning' as const;
  }
  return 'neutral' as const;
};

export const getCurrentWorkflowStep = (
  workflow: Workflow | null,
  runDetail: WorkflowRunDetail | null,
  workItem: WorkItem | null,
) => {
  if (!workflow) {
    return null;
  }

  const runRecord = runDetail?.run || null;
  const runSteps = Array.isArray(runDetail?.steps) ? runDetail.steps : [];

  if (runRecord?.currentStepId) {
    return workflow.steps.find(step => step.id === runRecord.currentStepId) || null;
  }

  if (workItem?.currentStepId) {
    return workflow.steps.find(step => step.id === workItem.currentStepId) || null;
  }

  const lastCompletedRunStep = runSteps
    .filter(step => step.status === 'COMPLETED')
    .slice(-1)[0];

  if (lastCompletedRunStep) {
    return (
      workflow.steps.find(step => step.id === lastCompletedRunStep.workflowStepId) || null
    );
  }

  return workItem?.phase === 'DONE' ? workflow.steps[workflow.steps.length - 1] || null : null;
};

export const getSelectedRunWait = (runDetail: WorkflowRunDetail | null) =>
  (Array.isArray(runDetail?.waits) ? [...runDetail.waits] : [])
    .reverse()
    .find(wait => wait.status === 'OPEN') || null;

export const normalizeMarkdownishText = (value?: string) => {
  const normalized = String(value || '').replace(/\r\n/g, '\n');
  if (!normalized.trim()) {
    return '';
  }

  return normalized
    .split('\n')
    .map(line =>
      line
        .replace(/^\s*•\s*/, '- ')
        .replace(/^\s*(\d+)\)\s+/, '$1. ')
        .trimEnd(),
    )
    .join('\n')
    .trim();
};

export const describeApprovalTarget = (
  assignment: ApprovalAssignment,
  {
    usersById,
    teamsById,
  }: {
    usersById: Map<string, { name: string }>;
    teamsById: Map<string, { name: string }>;
  },
) => {
  if (assignment.targetType === 'USER') {
    return usersById.get(assignment.targetId)?.name || assignment.targetId;
  }
  if (assignment.targetType === 'TEAM') {
    return teamsById.get(assignment.targetId)?.name || assignment.targetId;
  }
  return assignment.targetId;
};

export const matchesArtifactWorkbenchFilter = (
  artifact: Artifact,
  filter: ArtifactWorkbenchFilter,
) => {
  if (filter === 'ALL') {
    return true;
  }

  if (filter === 'INPUTS') {
    return artifact.direction === 'INPUT' || artifact.artifactKind === 'INPUT_NOTE';
  }

  if (filter === 'OUTPUTS') {
    return artifact.direction !== 'INPUT';
  }

  if (filter === 'DIFFS') {
    return artifact.artifactKind === 'CODE_DIFF';
  }

  if (filter === 'APPROVALS') {
    return (
      artifact.artifactKind === 'APPROVAL_RECORD' ||
      artifact.artifactKind === 'CONFLICT_RESOLUTION' ||
      artifact.artifactKind === 'CONTRARIAN_REVIEW'
    );
  }

  if (filter === 'HANDOFFS') {
    return artifact.artifactKind === 'HANDOFF_PACKET';
  }

  return true;
};

export const getArtifactDocumentBody = (artifact: Artifact | null): string => {
  if (!artifact) {
    return '';
  }

  if (artifact.contentFormat === 'JSON' && artifact.contentJson) {
    try {
      return JSON.stringify(artifact.contentJson, null, 2);
    } catch {
      return '[This JSON artifact could not be rendered safely in the preview.]';
    }
  }

  const fallback =
    artifact.contentText ??
    artifact.summary ??
    artifact.description ??
    `${artifact.type} · ${artifact.version}`;

  return typeof fallback === 'string' ? fallback : String(fallback);
};

export const buildApprovalWorkspacePath = ({
  capabilityId,
  runId,
  waitId,
}: {
  capabilityId: string;
  runId: string;
  waitId: string;
}) =>
  `/work/approvals/${encodeURIComponent(capabilityId)}/${encodeURIComponent(runId)}/${encodeURIComponent(waitId)}`;

/**
 * Build a diagnostic message for an empty / silent chat-stream result.
 *
 * The default "agent did not return a response" string leaves operators
 * with no idea whether the LLM never received the request, hit a quota,
 * returned an empty completion, or got aborted. Use the stream-result
 * accumulator flags (sawDelta / sawComplete / sawError, termination,
 * retryAfterMs) to differentiate.
 *
 * Categories distinguished:
 *   - sawDelta=false, sawComplete=false, sawError=false →
 *     transport delivered no events → likely runtime / network
 *   - sawError=true with no error message → server emitted an error event
 *     but did not provide text → check Run Console
 *   - termination==='empty' → LLM accepted the request but returned no
 *     tokens → likely model/quota/token issue
 *   - termination==='interrupted' → user navigated / aborted before
 *     content arrived → retry
 *   - retryAfterMs > 0 → throttled
 */
export const explainEmptyChatStream = (result: {
  termination: "complete" | "recovered" | "interrupted" | "empty";
  error?: string;
  retryAfterMs?: number;
  sawDelta: boolean;
  sawComplete: boolean;
  sawError: boolean;
}): string => {
  if (result.error?.trim()) {
    return result.error.trim();
  }
  if (!result.sawDelta && !result.sawComplete && !result.sawError) {
    return "Agent runtime did not deliver any response — check the Run Console for runtime status, provider configuration, and the active model.";
  }
  if (result.sawError) {
    return "Agent runtime emitted an error event with no message — open the Run Console for details.";
  }
  if (result.termination === "empty") {
    return "Agent runtime accepted the request but returned an empty completion. This usually means a model/quota issue, an unavailable model, or an expired token. Open the Run Console.";
  }
  if (result.termination === "interrupted") {
    return "The agent stream was interrupted before any content arrived — please try again.";
  }
  if (result.retryAfterMs && result.retryAfterMs > 0) {
    return `Agent runtime is throttled — retry after ~${Math.ceil(result.retryAfterMs / 1000)}s.`;
  }
  return "The agent did not return a response.";
};
