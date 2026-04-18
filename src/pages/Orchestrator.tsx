import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  ArrowRight,
  Bot,
  Clock3,
  ExternalLink,
  FileCode,
  FileText,
  LayoutGrid,
  List,
  LoaderCircle,
  MessageSquareText,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Square,
  Trash2,
  User,
  Workflow as WorkflowIcon,
  X,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AgentKnowledgeLensPanel from '../components/AgentKnowledgeLensPanel';
import ArtifactPreview from '../components/ArtifactPreview';
import CapabilityBriefingPanel from '../components/CapabilityBriefingPanel';
import ErrorBoundary from '../components/ErrorBoundary';
import { ExplainWorkItemDrawer } from '../components/ExplainWorkItemDrawer';
import InteractionTimeline from '../components/InteractionTimeline';
import MarkdownContent from '../components/MarkdownContent';
import StageControlModal from '../components/StageControlModal';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import { formatEnumLabel, getStatusTone } from '../lib/enterprise';
import { buildCapabilityExperience } from '../lib/capabilityExperience';
import {
  canReadCapabilityLiveDetail,
  hasPermission,
} from '../lib/accessControl';
import { compactMarkdownPreview } from '../lib/markdown';
import { createApiEventSource } from '../lib/desktop';
import { readViewPreference, writeViewPreference } from '../lib/viewPreferences';
import {
  appendCapabilityMessageRecord,
  approveCapabilityWorkflowRun,
  acceptCapabilityWorkItemHandoff,
  archiveCapabilityWorkItem,
  cancelCapabilityWorkItem,
  cancelCapabilityWorkflowRun,
  clearCapabilityMessageHistoryRecord,
  claimCapabilityWorkItemControl,
  claimCapabilityWorkItemWriteControl,
  createCapabilityWorkItemHandoff,
  createCapabilityWorkItem,
  createEvidencePacketForWorkItem,
  createCapabilityWorkItemSharedBranch,
  fetchCapabilityWorkItemCollaboration,
  fetchCapabilityWorkItemExecutionContext,
  fetchCapabilityWorkflowRun,
  fetchCapabilityWorkflowRunEvents,
  fetchRuntimeStatus,
  initializeCapabilityWorkItemExecutionContext,
  listCapabilityWorkflowRuns,
  moveCapabilityWorkItem,
  claimCapabilityExecution,
  pauseCapabilityWorkflowRun,
  provideCapabilityWorkflowRunInput,
  releaseCapabilityExecution,
  resumeCapabilityWorkflowRun,
  restoreCapabilityWorkItem,
  validateOnboardingWorkspacePath,
  releaseCapabilityWorkItemControl,
  releaseCapabilityWorkItemWriteControl,
  requestCapabilityWorkflowRunChanges,
  resolveCapabilityWorkflowRunConflict,
  restartCapabilityWorkflowRun,
  startCapabilityWorkflowRun,
  streamCapabilityChat,
  uploadCapabilityWorkItemFiles,
  type RuntimeStatus,
  updateCapabilityWorkItemPresence,
} from '../lib/api';
import {
  getCapabilityBoardPhaseIds,
  getCapabilityVisibleLifecyclePhases,
  getLifecyclePhaseLabel,
} from '../lib/capabilityLifecycle';
import {
  createEmptyWorkItemPhaseStakeholder,
  formatWorkItemPhaseStakeholderLine,
  getWorkItemPhaseStakeholders,
  normalizeWorkItemPhaseStakeholders,
} from '../lib/workItemStakeholders';
import {
  DEFAULT_WORK_ITEM_TASK_TYPE,
  getWorkItemTaskTypeDescription,
  getWorkItemTaskTypeEntryPhase,
  getWorkItemTaskTypeLabel,
  resolveWorkItemEntryStep,
  WORK_ITEM_TASK_TYPE_OPTIONS,
} from '../lib/workItemTaskTypes';
import { buildAgentKnowledgeLens } from '../lib/agentKnowledge';
import { buildCapabilityInteractionFeed } from '../lib/interactionFeed';
import { parseCopilotTranscriptBlocks } from '../lib/copilotTranscript';
import { normalizeCompiledStepContext } from '../lib/workflowRuntime';
import { cn } from '../lib/utils';
import type {
  AgentArtifactExpectation,
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
  WorkspacePathValidationResult,
  Workflow,
  WorkflowRun,
  WorkflowRunDetail,
} from '../types';
import { BoardColumn, EmptyState, ModalShell, StatusBadge } from '../components/EnterpriseUI';
import { AdvancedDisclosure } from '../components/WorkspaceUI';

const PHASE_ACCENTS = [
  'bg-sky-100 text-sky-700',
  'bg-indigo-100 text-indigo-700',
  'bg-primary/10 text-primary',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-fuchsia-100 text-fuchsia-700',
  'bg-cyan-100 text-cyan-700',
  'bg-orange-100 text-orange-700',
] as const;

const RUN_STATUS_META: Record<
  WorkflowRun['status'],
  { label: string; accent: string }
> = {
  QUEUED: { label: 'Queued', accent: 'bg-slate-100 text-slate-700' },
  RUNNING: { label: 'Running', accent: 'bg-primary/10 text-primary' },
  PAUSED: { label: 'Paused', accent: 'bg-slate-200 text-slate-700' },
  WAITING_APPROVAL: { label: 'Waiting Approval', accent: 'bg-amber-100 text-amber-700' },
  WAITING_INPUT: { label: 'Waiting Input', accent: 'bg-orange-100 text-orange-700' },
  WAITING_CONFLICT: { label: 'Waiting Conflict', accent: 'bg-red-100 text-red-700' },
  COMPLETED: { label: 'Completed', accent: 'bg-emerald-100 text-emerald-700' },
  FAILED: { label: 'Failed', accent: 'bg-red-100 text-red-700' },
  CANCELLED: { label: 'Cancelled', accent: 'bg-slate-200 text-slate-700' },
};

const WORK_ITEM_STATUS_META: Record<
  WorkItem['status'],
  { label: string; accent: string }
> = {
  ACTIVE: { label: 'Active', accent: 'bg-primary/10 text-primary' },
  BLOCKED: { label: 'Blocked', accent: 'bg-red-100 text-red-700' },
  PAUSED: { label: 'Paused', accent: 'bg-slate-200 text-slate-700' },
  PENDING_APPROVAL: { label: 'Pending Approval', accent: 'bg-amber-100 text-amber-700' },
  COMPLETED: { label: 'Completed', accent: 'bg-emerald-100 text-emerald-700' },
  CANCELLED: { label: 'Cancelled', accent: 'bg-slate-200 text-slate-700' },
  ARCHIVED: { label: 'Archived', accent: 'bg-slate-100 text-slate-700' },
};

const ACTIVE_RUN_STATUSES: WorkflowRun['status'][] = [
  'QUEUED',
  'RUNNING',
  'PAUSED',
  'WAITING_APPROVAL',
  'WAITING_INPUT',
  'WAITING_CONFLICT',
];

const LIVE_EXECUTION_RUN_STATUSES: WorkflowRun['status'][] = ['QUEUED', 'RUNNING'];

const toDraftPhaseStakeholder = (
  stakeholder?: CapabilityStakeholder,
) => ({
  role: stakeholder?.role || 'Stakeholder',
  name: stakeholder?.name || '',
  email: stakeholder?.email || '',
  teamName: stakeholder?.teamName || '',
});

const MAX_WORK_ITEM_ATTACHMENT_BYTES = 300_000;

const formatAttachmentSizeLabel = (sizeBytes?: number): string => {
  if (typeof sizeBytes !== 'number' || Number.isNaN(sizeBytes) || sizeBytes <= 0) {
    return '';
  }

  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (sizeBytes >= 1024) {
    return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  }

  return `${sizeBytes} B`;
};

const renderAttachmentIcon = (attachment: WorkItemAttachmentUpload) => {
  const fileName = attachment.fileName.toLowerCase();
  const mimeType = (attachment.mimeType || '').toLowerCase();
  const isCodeLike =
    mimeType.includes('json') ||
    mimeType.includes('javascript') ||
    mimeType.includes('typescript') ||
    mimeType.includes('xml') ||
    mimeType.includes('yaml') ||
    mimeType.includes('x-sh') ||
    /\.(json|js|jsx|ts|tsx|py|java|kt|kts|go|rb|php|cs|cpp|c|h|sql|yaml|yml|xml|sh|mdx?)$/.test(
      fileName,
    );

  if (isCodeLike) {
    return <FileCode size={18} className="text-primary" />;
  }

  return <FileText size={18} className="text-primary" />;
};

type OrchestratorView = 'board' | 'list';
type DetailTab = 'operate' | 'artifacts' | 'attempts';
type WorkItemStatusFilter = 'ALL' | WorkItem['status'];
type WorkItemPriorityFilter = 'ALL' | WorkItem['priority'];
type ArtifactWorkbenchFilter =
  | 'ALL'
  | 'INPUTS'
  | 'OUTPUTS'
  | 'DIFFS'
  | 'APPROVALS'
  | 'HANDOFFS';
type StageChatMessage = {
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
type WorkNavigatorItem = {
  item: WorkItem;
  attentionLabel?: string;
  attentionReason?: string;
  currentStepName: string;
  agentName: string;
  ageLabel: string;
};
type WorkNavigatorSection = {
  id: string;
  title: string;
  helper: string;
  items: WorkNavigatorItem[];
};
type WorkbenchQueueView =
  | 'ALL_WORK'
  | 'MY_QUEUE'
  | 'TEAM_QUEUE'
  | 'ATTENTION'
  | 'PAUSED'
  | 'WATCHING'
  | 'ARCHIVE';
type WorkbenchSelectionFocus = 'INPUT' | 'APPROVAL' | 'RESOLUTION';

const STORAGE_KEYS = {
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

const readSessionValue = <T extends string>(key: string, fallback: T): T => {
  return readViewPreference(key, fallback, { storage: 'session' });
};

const formatTimestamp = (value?: string | Date): string => {
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

const formatRelativeTime = (value?: string) => {
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

const getPriorityTone = (priority: WorkItem['priority']) => {
  if (priority === 'High') {
    return 'danger' as const;
  }
  if (priority === 'Med') {
    return 'warning' as const;
  }
  return 'neutral' as const;
};

const getCurrentWorkflowStep = (
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

const getSelectedRunWait = (runDetail: WorkflowRunDetail | null) =>
  (Array.isArray(runDetail?.waits) ? [...runDetail.waits] : [])
    .reverse()
    .find(wait => wait.status === 'OPEN') || null;

const normalizeMarkdownishText = (value?: string) => {
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

const CopilotMessageBody = ({
  content,
  tone,
}: {
  content: string;
  tone: 'agent' | 'user' | 'draft';
}) => {
  const blocks = parseCopilotTranscriptBlocks(content);
  const textTone =
    tone === 'user'
      ? 'text-white'
      : tone === 'draft'
      ? 'text-slate-800'
      : 'text-on-surface';
  const metaTone =
    tone === 'user'
      ? 'text-white/75'
      : tone === 'draft'
      ? 'text-slate-500'
      : 'text-secondary';
  const panelTone =
    tone === 'user'
      ? 'border-white/15 bg-white/10 text-white'
      : tone === 'draft'
      ? 'border-slate-200 bg-slate-50/90 text-slate-900'
      : 'border-slate-200 bg-slate-50/85 text-slate-900';
  const codeTone =
    tone === 'user'
      ? 'border-white/10 bg-slate-950/35 text-white'
      : 'border-slate-200 bg-white text-slate-900';

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-3">
      {blocks.map((block, index) => {
        if (block.type === 'text') {
          return (
            <p
              key={`${block.type}-${index}`}
              className={cn('whitespace-pre-wrap text-sm leading-6', textTone)}
            >
              {block.text}
            </p>
          );
        }

        if (block.type === 'system') {
          return (
            <div
              key={`${block.type}-${index}`}
              className={cn(
                'rounded-2xl border px-3 py-2 text-xs leading-6',
                tone === 'user'
                  ? 'border-white/15 bg-slate-950/25 text-white/90'
                  : 'border-slate-200 bg-white/85 text-slate-700',
              )}
            >
              <span className="font-semibold uppercase tracking-[0.14em]">System</span>
              <span className="ml-2">{block.text}</span>
            </div>
          );
        }

        return (
          <div
            key={`${block.type}-${index}`}
            className={cn('rounded-2xl border px-3 py-3 shadow-sm', panelTone)}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span
                className={cn(
                  'text-[0.68rem] font-semibold uppercase tracking-[0.16em]',
                  metaTone,
                )}
              >
                Tool call
              </span>
              <span className={cn('text-sm font-semibold', textTone)}>
                {block.toolName || 'Tool'}
              </span>
            </div>
            {block.parameters.length > 0 ? (
              <div className="mt-3 space-y-2">
                {block.parameters.map(parameter => (
                  <div key={`${parameter.name}-${parameter.value.slice(0, 24)}`}>
                    <p
                      className={cn(
                        'text-[0.68rem] font-semibold uppercase tracking-[0.14em]',
                        metaTone,
                      )}
                    >
                      {parameter.name}
                    </p>
                    <pre
                      className={cn(
                        'mt-1 whitespace-pre-wrap break-all rounded-2xl border px-3 py-2 text-xs leading-6',
                        codeTone,
                      )}
                    >
                      {parameter.value}
                    </pre>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

const getAttentionReason = ({
  blocker,
  pendingRequest,
  wait,
}: {
  blocker?: WorkItem['blocker'];
  pendingRequest?: WorkItem['pendingRequest'];
  wait?: RunWait | null;
}) => blocker?.message || wait?.message || pendingRequest?.message || '';

const getAttentionLabel = ({
  blocker,
  pendingRequest,
  wait,
}: {
  blocker?: WorkItem['blocker'];
  pendingRequest?: WorkItem['pendingRequest'];
  wait?: RunWait | null;
}) => {
  if (blocker?.status === 'OPEN') {
    return blocker.type === 'HUMAN_INPUT'
      ? 'Waiting for human input'
      : 'Waiting for conflict resolution';
  }

  if (wait?.type === 'APPROVAL' || pendingRequest?.type === 'APPROVAL') {
    return 'Waiting for approval';
  }

  if (wait?.type === 'INPUT' || pendingRequest?.type === 'INPUT') {
    return 'Waiting for input';
  }

  if (
    wait?.type === 'CONFLICT_RESOLUTION' ||
    pendingRequest?.type === 'CONFLICT_RESOLUTION'
  ) {
    return 'Waiting for conflict resolution';
  }

  return 'Action required';
};

const getAttentionCallToAction = ({
  blocker,
  pendingRequest,
  wait,
}: {
  blocker?: WorkItem['blocker'];
  pendingRequest?: WorkItem['pendingRequest'];
  wait?: RunWait | null;
}) => {
  if (wait?.type === 'APPROVAL' || pendingRequest?.type === 'APPROVAL') {
    return 'Review approval';
  }

  if (wait?.type === 'INPUT' || pendingRequest?.type === 'INPUT') {
    return 'Provide input';
  }

  if (
    blocker?.type === 'HUMAN_INPUT' ||
    wait?.type === 'CONFLICT_RESOLUTION' ||
    pendingRequest?.type === 'CONFLICT_RESOLUTION'
  ) {
    return 'Resolve now';
  }

  return 'Open controls';
};

const getWorkItemAttentionTimestamp = (item: WorkItem) =>
  item.blocker?.timestamp || item.pendingRequest?.timestamp || item.history.slice(-1)[0]?.timestamp;

const buildBlockedGuidanceSeed = (reason: string) =>
  `Blocking reason from agent:\n- ${reason}\n\nGuidance for the next attempt:\n- `;

const describeApprovalTarget = (
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

const getRunEventTone = (event: RunEvent) => {
  if (event.level === 'ERROR' || event.type === 'STEP_FAILED' || event.type === 'TOOL_FAILED') {
    return 'danger' as const;
  }

  if (event.type === 'STEP_WAITING') {
    return 'warning' as const;
  }

  if (event.type === 'STEP_COMPLETED' || event.type === 'TOOL_COMPLETED') {
    return 'success' as const;
  }

  if (event.type === 'STEP_PROGRESS' || event.type === 'TOOL_STARTED') {
    return 'info' as const;
  }

  return getStatusTone(event.level);
};

const getRunEventLabel = (event: RunEvent) => {
  const stage =
    typeof event.details?.stage === 'string' ? event.details.stage : event.type;
  return formatEnumLabel(stage);
};

const getContrarianReview = (
  wait?: RunWait | null,
): ContrarianConflictReview | undefined => {
  const review = wait?.payload?.contrarianReview;
  return review && typeof review === 'object' ? review : undefined;
};

const buildGuidanceSuggestions = ({
  workItem,
  wait,
  requestedInputFields,
}: {
  workItem?: WorkItem | null;
  wait?: RunWait | null;
  requestedInputFields: CompiledRequiredInputField[];
}) => {
  const suggestions = new Set<string>();

  requestedInputFields.forEach(field => {
    suggestions.add(`Provide ${field.label.toLowerCase()} with concrete values and constraints.`);
  });

  if (wait?.type === 'APPROVAL') {
    suggestions.add('State the conditions the agent must satisfy before continuing.');
  }

  if (wait?.type === 'INPUT') {
    suggestions.add('Give the exact missing business or technical detail instead of a general instruction.');
  }

  if (wait?.type === 'CONFLICT_RESOLUTION') {
    suggestions.add('Choose the final path and explain the tradeoff the agent should honor.');
  }

  if (workItem?.status === 'BLOCKED' && !wait) {
    suggestions.add('Explain what changed since the failed attempt and what the agent should do differently on retry.');
    suggestions.add('Reference approved paths, commands, constraints, or acceptance criteria the agent should follow.');
  }

  return Array.from(suggestions).slice(0, 3);
};

const getContrarianReviewTone = (review?: ContrarianConflictReview) => {
  if (!review) {
    return 'neutral' as const;
  }

  if (review.status === 'ERROR' || review.severity === 'CRITICAL') {
    return 'danger' as const;
  }

  if (review.status === 'PENDING' || review.severity === 'HIGH') {
    return 'warning' as const;
  }

  if (review.severity === 'LOW' && review.recommendation === 'CONTINUE') {
    return 'success' as const;
  }

  return 'info' as const;
};

const asCompiledStepContext = (value: unknown): CompiledStepContext | undefined =>
  value && typeof value === 'object'
    ? normalizeCompiledStepContext(value as Partial<CompiledStepContext>)
    : undefined;

const asCompiledWorkItemPlan = (value: unknown): CompiledWorkItemPlan | undefined =>
  value && typeof value === 'object' ? (value as CompiledWorkItemPlan) : undefined;

const asCompiledInputFields = (
  value: unknown,
): CompiledRequiredInputField[] =>
  Array.isArray(value) ? (value as CompiledRequiredInputField[]) : [];

const isConflictAttention = (item: WorkItem) =>
  item.blocker?.type === 'CONFLICT_RESOLUTION' ||
  item.pendingRequest?.type === 'CONFLICT_RESOLUTION';

const renderReviewList = (items: string[], emptyLabel: string) =>
  items.length > 0 ? (
    <ul className="mt-2 space-y-1 text-xs leading-relaxed text-secondary">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex gap-2">
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  ) : (
    <p className="mt-2 text-xs leading-relaxed text-secondary">{emptyLabel}</p>
  );

const renderStructuredInputs = (
  items: CompiledRequiredInputField[],
  emptyLabel: string,
) =>
  items.length > 0 ? (
    <div className="mt-3 space-y-2">
      {items.map(item => (
        <div
          key={item.id}
          className="rounded-2xl border border-outline-variant/30 bg-white/85 px-3 py-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-on-surface">{item.label}</p>
            <StatusBadge tone={item.status === 'READY' ? 'success' : 'warning'}>
              {item.status === 'READY' ? 'Ready' : 'Missing'}
            </StatusBadge>
          </div>
          {item.description ? (
            <p className="mt-1 text-xs leading-relaxed text-secondary">{item.description}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.72rem] text-secondary">
            <span>Source: {formatEnumLabel(item.source)}</span>
            <span>Type: {formatEnumLabel(item.kind)}</span>
            {item.valueSummary ? <span>Current: {item.valueSummary}</span> : null}
          </div>
        </div>
      ))}
    </div>
  ) : (
    <p className="mt-3 text-xs leading-relaxed text-secondary">{emptyLabel}</p>
  );

const renderArtifactChecklist = (items: CompiledArtifactChecklistItem[]) =>
  items.length > 0 ? (
    <div className="mt-3 space-y-2">
      {items.map(item => (
        <div
          key={item.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-outline-variant/30 bg-white/85 px-3 py-3"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold text-on-surface">{item.label}</p>
            {item.description ? (
              <p className="mt-1 text-xs leading-relaxed text-secondary">
                {item.description}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge tone={item.direction === 'INPUT' ? 'info' : 'neutral'}>
              {item.direction}
            </StatusBadge>
            <StatusBadge tone={item.status === 'READY' ? 'success' : 'warning'}>
              {item.status === 'READY' ? 'Ready' : 'Expected'}
            </StatusBadge>
          </div>
        </div>
      ))}
    </div>
  ) : (
    <p className="mt-3 text-xs leading-relaxed text-secondary">
      This step does not declare an artifact checklist yet.
    </p>
  );

const renderAgentArtifactExpectations = (
  items: AgentArtifactExpectation[],
  emptyLabel: string,
  tone: 'neutral' | 'brand',
) =>
  items.length > 0 ? (
    <div className="mt-3 flex flex-wrap gap-2">
      {items.map(item => (
        <StatusBadge key={`${item.direction}:${item.artifactName}`} tone={tone}>
          {item.artifactName}
        </StatusBadge>
      ))}
    </div>
  ) : (
    <p className="mt-3 text-xs leading-relaxed text-secondary">{emptyLabel}</p>
  );

const matchesArtifactWorkbenchFilter = (
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

const getArtifactDocumentBody = (artifact: Artifact | null): string => {
  if (!artifact) {
    return '';
  }

  if (artifact.contentFormat === 'JSON' && artifact.contentJson) {
    try {
      return JSON.stringify(artifact.contentJson, null, 2);
    } catch {
      return '[This JSON artifact could not be rendered safely in the approval preview.]';
    }
  }

  const fallback =
    artifact.contentText ??
    artifact.summary ??
    artifact.description ??
    `${artifact.type} · ${artifact.version}`;

  return typeof fallback === 'string' ? fallback : String(fallback);
};

const getLatestRunFailureReason = ({
  run,
  runSteps,
  runEvents,
}: {
  run?: WorkflowRun | null;
  runSteps?: WorkflowRunDetail['steps'];
  runEvents?: RunEvent[];
}) => {
  const failedStep = [...(runSteps || [])]
    .reverse()
    .find(step => step.status === 'FAILED');
  const failedEvent = [...(runEvents || [])]
    .reverse()
    .find(event => event.level === 'ERROR' || event.type === 'STEP_FAILED');

  return (
    failedStep?.outputSummary ||
    failedStep?.evidenceSummary ||
    (typeof failedStep?.metadata?.lastError === 'string'
      ? failedStep.metadata.lastError
      : undefined) ||
    run?.terminalOutcome ||
    failedEvent?.message ||
    ''
  );
};

const Orchestrator = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    activeCapability,
    currentActorContext,
    getCapabilityWorkspace,
    refreshCapabilityBundle,
    updateCapabilityMetadata,
    setActiveChatAgent,
    workspaceOrganization,
  } = useCapability();
  const { error: showError, success } = useToast();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const permissionSet = activeCapability.effectivePermissions;
  const canReadLiveDetail = canReadCapabilityLiveDetail(permissionSet);
  const canEditCapability = hasPermission(permissionSet, 'capability.edit');
  const canCreateWorkItems = hasPermission(permissionSet, 'workitem.create');
  const canClaimExecution = hasPermission(permissionSet, 'capability.execution.claim');
  const canControlWorkItems = hasPermission(permissionSet, 'workitem.control');
  const canRestartWorkItems = hasPermission(permissionSet, 'workitem.restart');
  const canDecideApprovals = hasPermission(permissionSet, 'approval.decide');
  const canReadChat = hasPermission(permissionSet, 'chat.read');
  const canWriteChat = hasPermission(permissionSet, 'chat.write');
  const lifecycleBoardPhases = useMemo(
    () => getCapabilityBoardPhaseIds(activeCapability),
    [activeCapability],
  );
  const phaseMeta = useMemo(() => {
    const visiblePhaseIds = lifecycleBoardPhases.filter(
      phase => phase !== 'BACKLOG' && phase !== 'DONE',
    );
    const meta = new Map<WorkItemPhase, { label: string; accent: string }>();
    meta.set('BACKLOG', {
      label: getLifecyclePhaseLabel(activeCapability, 'BACKLOG'),
      accent: 'bg-slate-100 text-slate-700',
    });
    meta.set('DONE', {
      label: getLifecyclePhaseLabel(activeCapability, 'DONE'),
      accent: 'bg-surface-container-high text-secondary',
    });
    visiblePhaseIds.forEach((phase, index) => {
      meta.set(phase, {
        label: getLifecyclePhaseLabel(activeCapability, phase),
        accent: PHASE_ACCENTS[index % PHASE_ACCENTS.length],
      });
    });
    return meta;
  }, [activeCapability, lifecycleBoardPhases]);
  const getPhaseMeta = useCallback(
    (phase?: WorkItemPhase) =>
      phaseMeta.get(phase || '') || {
        label: getLifecyclePhaseLabel(activeCapability, phase),
        accent: 'bg-surface-container-high text-secondary',
      },
    [activeCapability, phaseMeta],
  );

  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(() => {
    const stored = readSessionValue(STORAGE_KEYS.selected, '');
    return stored || null;
  });
  const [isCreateSheetOpen, setIsCreateSheetOpen] = useState(false);
  const [view, setView] = useState<OrchestratorView>(() =>
    readSessionValue(STORAGE_KEYS.view, 'list'),
  );
  const [detailTab, setDetailTab] = useState<DetailTab>(() => {
    const stored = readSessionValue(STORAGE_KEYS.detailTab, 'operate') as string;
    if (stored === 'overview' || stored === 'control') {
      return 'operate';
    }
    if (stored === 'progress') {
      return 'attempts';
    }
    if (stored === 'outputs') {
      return 'artifacts';
    }
    return stored as DetailTab;
  });
  const [searchQuery, setSearchQuery] = useState<string>(() =>
    readSessionValue(STORAGE_KEYS.search, ''),
  );
  const [workflowFilter, setWorkflowFilter] = useState<string>(() =>
    readSessionValue(STORAGE_KEYS.workflow, 'ALL'),
  );
  const [statusFilter, setStatusFilter] = useState<WorkItemStatusFilter>(() =>
    readSessionValue(STORAGE_KEYS.status, 'ALL') as WorkItemStatusFilter,
  );
  const [priorityFilter, setPriorityFilter] = useState<WorkItemPriorityFilter>(() =>
    readSessionValue(STORAGE_KEYS.priority, 'ALL') as WorkItemPriorityFilter,
  );
  const [workItemOverrides, setWorkItemOverrides] = useState<Record<string, WorkItem>>({});
  const [queueView, setQueueView] = useState<WorkbenchQueueView>(() =>
    readSessionValue(STORAGE_KEYS.queueView, 'MY_QUEUE') as WorkbenchQueueView,
  );
  const [draggedWorkItemId, setDraggedWorkItemId] = useState<string | null>(null);
  const [dragOverPhase, setDragOverPhase] = useState<WorkItemPhase | null>(null);
  const [phaseRailPreviewPhase, setPhaseRailPreviewPhase] = useState<WorkItemPhase | null>(null);
  const [isPhaseRailDragging, setIsPhaseRailDragging] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [runtimeError, setRuntimeError] = useState('');
  const [executionClaimBusy, setExecutionClaimBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [approvedWorkspaceDraft, setApprovedWorkspaceDraft] = useState('');
  const [approvedWorkspaceValidation, setApprovedWorkspaceValidation] =
    useState<WorkspacePathValidationResult | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [selectedRunDetail, setSelectedRunDetail] = useState<WorkflowRunDetail | null>(null);
  const [selectedRunEvents, setSelectedRunEvents] = useState<RunEvent[]>([]);
  const [selectedRunHistory, setSelectedRunHistory] = useState<WorkflowRun[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [selectedApprovalArtifactId, setSelectedApprovalArtifactId] = useState<string | null>(
    null,
  );
  const [resolutionNote, setResolutionNote] = useState('');
  const [isCancelWorkItemOpen, setIsCancelWorkItemOpen] = useState(false);
  const [cancelWorkItemNote, setCancelWorkItemNote] = useState('');
  const [isArchiveWorkItemOpen, setIsArchiveWorkItemOpen] = useState(false);
  const [archiveWorkItemNote, setArchiveWorkItemNote] = useState('');
  const [isRestoreWorkItemOpen, setIsRestoreWorkItemOpen] = useState(false);
  const [restoreWorkItemNote, setRestoreWorkItemNote] = useState('');
  const [phaseMoveRequest, setPhaseMoveRequest] = useState<{
    workItemId: string;
    targetPhase: WorkItemPhase;
  } | null>(null);
  const [phaseMoveNote, setPhaseMoveNote] = useState('');
  const [isDiffReviewOpen, setIsDiffReviewOpen] = useState(false);
  const [isApprovalReviewOpen, setIsApprovalReviewOpen] = useState(false);
  const [isApprovalReviewHydrated, setIsApprovalReviewHydrated] = useState(false);
  const [approvalReviewWaitSnapshot, setApprovalReviewWaitSnapshot] = useState<RunWait | null>(
    null,
  );
  const [selectedClaims, setSelectedClaims] = useState<WorkItemClaim[]>([]);
  const [selectedPresence, setSelectedPresence] = useState<WorkItemPresence[]>([]);
  const [selectedExecutionContext, setSelectedExecutionContext] =
    useState<WorkItemExecutionContext | null>(null);
  const [selectedHandoffs, setSelectedHandoffs] = useState<WorkItemHandoffPacket[]>([]);
  const [isExplainOpen, setIsExplainOpen] = useState(false);
  const [isStageControlOpen, setIsStageControlOpen] = useState(false);
  const [artifactFilter, setArtifactFilter] = useState<ArtifactWorkbenchFilter>('ALL');
  const [approvalArtifactFilter, setApprovalArtifactFilter] =
    useState<ArtifactWorkbenchFilter>('ALL');
  const [stageChatInput, setStageChatInput] = useState('');
  const [stageChatDraft, setStageChatDraft] = useState('');
  const [stageChatError, setStageChatError] = useState('');
  const [isStageChatSending, setIsStageChatSending] = useState(false);
  const [stageChatByScope, setStageChatByScope] = useState<Record<string, StageChatMessage[]>>(
    {},
  );
  const stageChatThreadRef = useRef<HTMLDivElement | null>(null);
  const stageChatStickToBottomRef = useRef(true);
  const stageChatRequestRef = useRef(0);
  const autoOpenedApprovalWaitIdsRef = useRef<Set<string>>(new Set());

  const [dockInput, setDockInput] = useState('');
  const [dockDraft, setDockDraft] = useState('');
  const [dockError, setDockError] = useState('');
  const [isDockSending, setIsDockSending] = useState(false);
  const [dockUploads, setDockUploads] = useState<
    Array<{
      id: string;
      file: File;
      previewUrl?: string;
      kind: 'image' | 'file';
    }>
  >([]);
  const dockUploadsRef = useRef(dockUploads);
  const dockThreadRef = useRef<HTMLDivElement | null>(null);
  const dockTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const phaseRailTrackRef = useRef<HTMLDivElement | null>(null);
  const dockStickToBottomRef = useRef(true);
  const dockRequestRef = useRef(0);
  const selectionFocusRef = useRef<WorkbenchSelectionFocus | null>(null);
  const resolutionNoteRef = useRef<HTMLTextAreaElement | null>(null);
  const [draftWorkItem, setDraftWorkItem] = useState({
    title: '',
    description: '',
    workflowId: workspace.workflows[0]?.id || '',
    taskType: DEFAULT_WORK_ITEM_TASK_TYPE as WorkItemTaskType,
    phaseStakeholders: [] as WorkItemPhaseStakeholderAssignment[],
    attachments: [] as WorkItemAttachmentUpload[],
    priority: 'Med' as WorkItem['priority'],
    tags: '',
  });

  useEffect(() => {
    dockUploadsRef.current = dockUploads;
  }, [dockUploads]);

  useEffect(() => {
    return () => {
      dockUploadsRef.current.forEach(item => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
    };
  }, []);

  const focusDockComposer = useCallback(() => {
    window.requestAnimationFrame(() => {
      dockTextareaRef.current?.focus();
    });
  }, []);

  const workflowsById = useMemo(
    () => new Map(workspace.workflows.map(workflow => [workflow.id, workflow])),
    [workspace.workflows],
  );
  const agentsById = useMemo(
    () => new Map(workspace.agents.map(agent => [agent.id, agent])),
    [workspace.agents],
  );
  const workItems = useMemo(() => {
    const nextById = new Map(workspace.workItems.map(item => [item.id, item]));
    Object.values(workItemOverrides).forEach(item => {
      nextById.set(item.id, item);
    });
    return Array.from(nextById.values());
  }, [workspace.workItems, workItemOverrides]);
  const visibleLifecyclePhases = useMemo(
    () => getCapabilityVisibleLifecyclePhases(activeCapability.lifecycle),
    [activeCapability.lifecycle],
  );
  const visibleLifecyclePhaseIds = useMemo(
    () => new Set(visibleLifecyclePhases.map(phase => phase.id)),
    [visibleLifecyclePhases],
  );

  const loadRuntime = useCallback(async () => {
    try {
      const status = await fetchRuntimeStatus();
      setRuntimeStatus(status);
      setRuntimeError('');
    } catch (error) {
      setRuntimeError(
        error instanceof Error ? error.message : 'Unable to load runtime configuration.',
      );
    }
  }, []);

  const focusGuidanceComposer = useCallback(() => {
    setDetailTab('operate');
    window.requestAnimationFrame(() => {
      resolutionNoteRef.current?.focus();
      resolutionNoteRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    });
  }, []);

  const loadSelectedRunData = useCallback(
    async (workItemId: string) => {
      const runs = await listCapabilityWorkflowRuns(activeCapability.id, workItemId);
      setSelectedRunHistory(runs);

      const latestRun = runs[0];
      if (!latestRun) {
        setSelectedRunDetail(null);
        setSelectedRunEvents([]);
        return;
      }

      const [detail, events] = await Promise.all([
        fetchCapabilityWorkflowRun(activeCapability.id, latestRun.id),
        fetchCapabilityWorkflowRunEvents(activeCapability.id, latestRun.id),
      ]);
      setSelectedRunDetail(detail);
      setSelectedRunEvents(events);
    },
    [activeCapability.id],
  );

  const refreshSelection = useCallback(
    async (workItemId?: string | null) => {
      await refreshCapabilityBundle(activeCapability.id);
      if (workItemId) {
        await loadSelectedRunData(workItemId);
      }
    },
    [activeCapability.id, loadSelectedRunData, refreshCapabilityBundle],
  );

  const selectWorkItem = useCallback(
    (
      workItemId: string,
      options?: {
        focusBoard?: boolean;
        openControl?: boolean;
        focus?: WorkbenchSelectionFocus;
      },
    ) => {
      stageChatRequestRef.current += 1;
      if (options?.focus) {
        selectionFocusRef.current = options.focus;
      }
      setSelectedWorkItemId(workItemId);
      setActionError('');
      setResolutionNote('');
      setIsStageChatSending(false);
      setStageChatDraft('');
      setStageChatError('');
      if (options?.openControl) {
        setDetailTab('operate');
      }
      if (options?.focusBoard) {
        setView('board');
        window.setTimeout(() => {
          const element = document.getElementById(`orchestrator-item-${workItemId}`);
          element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 80);
      }
    },
    [],
  );

  const clearSelectedWorkItem = useCallback(
    (options?: { focusBoard?: boolean }) => {
      stageChatRequestRef.current += 1;
      setSelectedWorkItemId(null);
      setSelectedRunDetail(null);
      setSelectedRunEvents([]);
      setSelectedRunHistory([]);
      setSelectedArtifactId(null);
      setResolutionNote('');
      setActionError('');
      setIsExplainOpen(false);
      setIsStageControlOpen(false);
      setIsDiffReviewOpen(false);
      setIsApprovalReviewOpen(false);
      setIsApprovalReviewHydrated(false);
      setApprovalReviewWaitSnapshot(null);
      setStageChatInput('');
      setStageChatDraft('');
      setStageChatError('');
      setIsStageChatSending(false);
      if (options?.focusBoard) {
        window.setTimeout(() => {
          const element = document.getElementById('orchestrator-flow-map');
          element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 80);
      }
    },
    [],
  );

  useEffect(() => {
    void refreshCapabilityBundle(activeCapability.id);
    void loadRuntime();
  }, [activeCapability.id, loadRuntime, refreshCapabilityBundle]);

  useEffect(() => {
    const preferred =
      activeCapability.executionConfig.defaultWorkspacePath ||
      activeCapability.executionConfig.allowedWorkspacePaths[0] ||
      activeCapability.localDirectories[0] ||
      '';
    setApprovedWorkspaceDraft(preferred);
    setApprovedWorkspaceValidation(null);
  }, [activeCapability.id]);

  useEffect(() => {
    if (
      draftWorkItem.workflowId &&
      workspace.workflows.some(workflow => workflow.id === draftWorkItem.workflowId)
    ) {
      return;
    }
    setDraftWorkItem(current => ({
      ...current,
      workflowId: workspace.workflows[0]?.id || '',
    }));
  }, [draftWorkItem.workflowId, workspace.workflows]);

  useEffect(() => {
    if (!selectedWorkItemId || workItems.some(item => item.id === selectedWorkItemId)) {
      return;
    }
    setSelectedWorkItemId(null);
    setSelectedRunDetail(null);
    setSelectedRunEvents([]);
    setSelectedRunHistory([]);
    setSelectedArtifactId(null);
  }, [selectedWorkItemId, workItems]);

  useEffect(() => {
    if (!selectedWorkItemId) {
      setSelectedRunDetail(null);
      setSelectedRunEvents([]);
      setSelectedRunHistory([]);
      setSelectedArtifactId(null);
      setSelectedApprovalArtifactId(null);
      setSelectedClaims([]);
      setSelectedPresence([]);
      setSelectedExecutionContext(null);
      setSelectedHandoffs([]);
      setResolutionNote('');
      setIsDiffReviewOpen(false);
      setIsApprovalReviewOpen(false);
      setIsApprovalReviewHydrated(false);
      setApprovalReviewWaitSnapshot(null);
      setStageChatInput('');
      setStageChatDraft('');
      setStageChatError('');
      return;
    }

    stageChatStickToBottomRef.current = true;
    void loadSelectedRunData(selectedWorkItemId).catch(error => {
      setActionError(
        error instanceof Error ? error.message : 'Failed to load workflow run details.',
      );
    });
  }, [loadSelectedRunData, selectedWorkItemId]);

  useEffect(() => {
    setWorkItemOverrides(current => {
      let changed = false;
      const next: Record<string, WorkItem> = { ...current };
      const serverItemsById = new Map(workspace.workItems.map(item => [item.id, item]));

      Object.entries(current).forEach(([workItemId, override]) => {
        const serverItem = serverItemsById.get(workItemId);
        if (
          serverItem &&
          serverItem.recordVersion >= override.recordVersion &&
          serverItem.status === override.status &&
          serverItem.phase === override.phase
        ) {
          delete next[workItemId];
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [workspace.workItems]);

  useEffect(() => {
    if (!selectedWorkItemId || !currentActorContext.userId) {
      return;
    }

    let isMounted = true;
    void Promise.all([
      updateCapabilityWorkItemPresence(activeCapability.id, selectedWorkItemId, {
        viewContext: 'WORKBENCH',
      }).catch(() => null),
      fetchCapabilityWorkItemCollaboration(activeCapability.id, selectedWorkItemId),
      fetchCapabilityWorkItemExecutionContext(activeCapability.id, selectedWorkItemId).catch(
        () => ({ context: null, handoffs: [] }),
      ),
    ])
      .then(([, collaboration, executionContext]) => {
        if (!isMounted) {
          return;
        }
        setSelectedClaims(collaboration.claims);
        setSelectedPresence(collaboration.presence);
        setSelectedExecutionContext(executionContext.context);
        setSelectedHandoffs(executionContext.handoffs);
      })
      .catch(error => {
        if (!isMounted) {
          return;
        }
        console.warn('Failed to load work item collaboration state.', error);
      });

    return () => {
      isMounted = false;
    };
  }, [activeCapability.id, currentActorContext.userId, selectedWorkItemId]);

  useEffect(() => {
    const selectedRunStreamId =
      selectedRunDetail?.run?.id || selectedRunHistory[0]?.id || null;
    const selectedRunStreamStatus =
      selectedRunDetail?.run?.status || selectedRunHistory[0]?.status || null;

    if (
      !selectedRunStreamId ||
      !selectedRunStreamStatus ||
      !LIVE_EXECUTION_RUN_STATUSES.includes(selectedRunStreamStatus)
    ) {
      return;
    }

    let isMounted = true;
    const eventSource = createApiEventSource(
      `/api/capabilities/${encodeURIComponent(activeCapability.id)}/runs/${encodeURIComponent(selectedRunStreamId)}/stream`,
    );

    const syncRunHistory = (nextRun: WorkflowRun) => {
      setSelectedRunHistory(current => {
        const existingIndex = current.findIndex(run => run.id === nextRun.id);
        if (existingIndex === -1) {
          return [nextRun, ...current];
        }
        return current.map(run => (run.id === nextRun.id ? nextRun : run));
      });
    };

    eventSource.addEventListener('snapshot', event => {
      if (!isMounted) {
        return;
      }
      const payload = JSON.parse((event as MessageEvent).data) as {
        detail: WorkflowRunDetail;
        events: RunEvent[];
      };
      setSelectedRunDetail(payload.detail);
      setSelectedRunEvents(payload.events);
      syncRunHistory(payload.detail.run);
    });

    eventSource.addEventListener('heartbeat', event => {
      if (!isMounted) {
        return;
      }
      const payload = JSON.parse((event as MessageEvent).data) as {
        detail: WorkflowRunDetail;
      };
      setSelectedRunDetail(payload.detail);
      syncRunHistory(payload.detail.run);
    });

    eventSource.addEventListener('event', event => {
      if (!isMounted) {
        return;
      }
      const payload = JSON.parse((event as MessageEvent).data) as RunEvent;
      setSelectedRunEvents(current =>
        current.some(item => item.id === payload.id) ? current : [...current, payload],
      );
    });

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      isMounted = false;
      eventSource.close();
    };
  }, [
    activeCapability.id,
    selectedRunDetail?.run?.id,
    selectedRunDetail?.run?.status,
    selectedRunHistory,
  ]);

  useEffect(() => {
    const nextSearchParams = new URLSearchParams(searchParams);
    let shouldReplace = false;

    if (searchParams.get('new') === '1') {
      setIsCreateSheetOpen(true);
      nextSearchParams.delete('new');
      shouldReplace = true;
    }

    const selectedId = searchParams.get('selected');
    if (selectedId && workItems.some(item => item.id === selectedId)) {
      setSelectedWorkItemId(selectedId);
      nextSearchParams.delete('selected');
      shouldReplace = true;
    }

    if (shouldReplace) {
      setSearchParams(nextSearchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, workItems]);

  useEffect(() => {
    const hasLiveExecution = workItems.some(item => item.status === 'ACTIVE');
    const selectedWorkItemHasLiveExecution = Boolean(
      (selectedWorkItemId &&
        workItems.some(
          item => item.id === selectedWorkItemId && item.status === 'ACTIVE',
        )) ||
        (selectedRunDetail?.run?.status &&
          LIVE_EXECUTION_RUN_STATUSES.includes(selectedRunDetail.run.status)) ||
        (selectedRunHistory[0] &&
          LIVE_EXECUTION_RUN_STATUSES.includes(selectedRunHistory[0].status)),
    );

    if (!hasLiveExecution && !selectedWorkItemHasLiveExecution) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshSelection(selectedWorkItemHasLiveExecution ? selectedWorkItemId : undefined);
    }, 3000);

    return () => window.clearInterval(timer);
  }, [
    refreshSelection,
    selectedRunDetail?.run,
    selectedRunHistory,
    selectedWorkItemId,
    workItems,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    writeViewPreference(STORAGE_KEYS.view, view, { storage: 'session' });
  }, [view]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    writeViewPreference(STORAGE_KEYS.detailTab, detailTab, { storage: 'session' });
  }, [detailTab]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    writeViewPreference(STORAGE_KEYS.selected, selectedWorkItemId || '', {
      storage: 'session',
    });
  }, [selectedWorkItemId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    writeViewPreference(STORAGE_KEYS.search, searchQuery, { storage: 'session' });
  }, [searchQuery]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    writeViewPreference(STORAGE_KEYS.workflow, workflowFilter, { storage: 'session' });
  }, [workflowFilter]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    writeViewPreference(STORAGE_KEYS.status, statusFilter, { storage: 'session' });
  }, [statusFilter]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    writeViewPreference(STORAGE_KEYS.priority, priorityFilter, { storage: 'session' });
  }, [priorityFilter]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    writeViewPreference(STORAGE_KEYS.queueView, queueView, { storage: 'session' });
  }, [queueView]);

  const filteredWorkItems = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const actorUserId = currentActorContext.userId;
    const actorTeamIds = currentActorContext.teamIds;

    return workItems.filter(item => {
      const workflow = workflowsById.get(item.workflowId) || null;
      const currentStep = getCurrentWorkflowStep(workflow, null, item);
      const agentName = item.assignedAgentId
        ? agentsById.get(item.assignedAgentId)?.name || item.assignedAgentId
        : '';

      const matchesQuery =
        normalizedQuery.length === 0 ||
        item.title.toLowerCase().includes(normalizedQuery) ||
        item.id.toLowerCase().includes(normalizedQuery) ||
        item.description.toLowerCase().includes(normalizedQuery) ||
        workflow?.name.toLowerCase().includes(normalizedQuery) ||
        currentStep?.name.toLowerCase().includes(normalizedQuery) ||
        agentName.toLowerCase().includes(normalizedQuery) ||
        item.tags.some(tag => tag.toLowerCase().includes(normalizedQuery));

      const matchesWorkflow =
        workflowFilter === 'ALL' || item.workflowId === workflowFilter;
      const matchesStatus = statusFilter === 'ALL' || item.status === statusFilter;
      const matchesPriority =
        priorityFilter === 'ALL' || item.priority === priorityFilter;
      const matchesQueueView =
        queueView === 'ALL_WORK'
          ? true
          : queueView === 'MY_QUEUE'
          ? Boolean(actorUserId) &&
            (item.claimOwnerUserId === actorUserId ||
              (item.phaseOwnerTeamId
                ? actorTeamIds.includes(item.phaseOwnerTeamId)
                : true))
          : queueView === 'TEAM_QUEUE'
          ? Boolean(item.phaseOwnerTeamId && actorTeamIds.includes(item.phaseOwnerTeamId))
          : queueView === 'ATTENTION'
          ? item.status !== 'PAUSED' &&
            (item.status === 'BLOCKED' ||
              item.status === 'PENDING_APPROVAL' ||
              Boolean(item.pendingRequest))
          : queueView === 'PAUSED'
          ? item.status === 'PAUSED'
          : queueView === 'ARCHIVE'
          ? item.status === 'ARCHIVED'
          : Boolean(actorUserId && item.watchedByUserIds?.includes(actorUserId));

      const hideArchivedByDefault =
        item.status === 'ARCHIVED' && queueView !== 'ARCHIVE' && statusFilter === 'ALL';
      const hideBacklogByDefault =
        item.phase === 'BACKLOG' && queueView !== 'ALL_WORK' && statusFilter === 'ALL';

      return (
        matchesQuery &&
        matchesWorkflow &&
        matchesStatus &&
        matchesPriority &&
        matchesQueueView &&
        !hideArchivedByDefault &&
        !hideBacklogByDefault
      );
    });
  }, [
    currentActorContext.teamIds,
    currentActorContext.userId,
    agentsById,
    priorityFilter,
    queueView,
    searchQuery,
    statusFilter,
    workflowFilter,
    workItems,
    workflowsById,
  ]);

  const attentionItems = useMemo(
    () =>
      filteredWorkItems
        .filter(
          item =>
            item.status !== 'PAUSED' &&
            item.status !== 'ARCHIVED' &&
            (item.blocker?.status === 'OPEN' ||
              Boolean(item.pendingRequest) ||
              item.status === 'BLOCKED' ||
              item.status === 'PENDING_APPROVAL'),
        )
        .map(item => {
          const workflow = workflowsById.get(item.workflowId) || null;
          const currentStep = getCurrentWorkflowStep(workflow, null, item);
          const agentId = item.assignedAgentId || currentStep?.agentId;
          const attentionReason =
            getAttentionReason({
              blocker: item.blocker,
              pendingRequest: item.pendingRequest,
            }) || 'This work item needs operator attention.';
          const attentionLabel = getAttentionLabel({
            blocker: item.blocker,
            pendingRequest: item.pendingRequest,
          });
          return {
            item,
            workflow,
            currentStep,
            agentId,
            attentionReason,
            attentionLabel,
            attentionTimestamp: getWorkItemAttentionTimestamp(item),
            hasConflictReview: isConflictAttention(item),
            callToAction: getAttentionCallToAction({
              blocker: item.blocker,
              pendingRequest: item.pendingRequest,
            }),
          };
        })
        .sort((left, right) => {
          const leftTime = left.attentionTimestamp
            ? new Date(left.attentionTimestamp).getTime()
            : 0;
          const rightTime = right.attentionTimestamp
            ? new Date(right.attentionTimestamp).getTime()
            : 0;
          return rightTime - leftTime;
        }),
    [filteredWorkItems, workflowsById],
  );

  const activeBoardPhases = useMemo(
    () => lifecycleBoardPhases.filter(phase => phase !== 'DONE'),
    [lifecycleBoardPhases],
  );

  const groupedItems = useMemo(
    () =>
      activeBoardPhases.map(phase => ({
        phase,
        items: filteredWorkItems.filter(
          item =>
            item.phase === phase &&
            item.status !== 'COMPLETED' &&
            item.status !== 'CANCELLED' &&
            item.status !== 'ARCHIVED',
        ),
      })),
    [activeBoardPhases, filteredWorkItems],
  );

  const completedItems = useMemo(
    () =>
      filteredWorkItems
        .filter(
          item =>
            item.status !== 'ARCHIVED' &&
            (item.phase === 'DONE' ||
              item.status === 'COMPLETED' ||
              item.status === 'CANCELLED'),
        )
        .slice()
        .sort((left, right) => {
          const leftTime = new Date(left.history[left.history.length - 1]?.timestamp || 0).getTime();
          const rightTime = new Date(right.history[right.history.length - 1]?.timestamp || 0).getTime();
          return rightTime - leftTime;
        }),
    [filteredWorkItems],
  );

  const stats = useMemo(
    () => ({
      active: workItems.filter(item => item.status === 'ACTIVE').length,
      blocked: workItems.filter(item => item.status === 'BLOCKED').length,
      approvals: workItems.filter(item => item.status === 'PENDING_APPROVAL').length,
      running: workItems.filter(item => Boolean(item.activeRunId)).length,
    }),
    [workItems],
  );

  const buildNavigatorItem = useCallback(
    (item: WorkItem): WorkNavigatorItem => {
      const workflow = workflowsById.get(item.workflowId) || null;
      const currentStep = getCurrentWorkflowStep(workflow, null, item);
      const agentId = item.assignedAgentId || currentStep?.agentId;
      return {
        item,
        attentionLabel:
          item.blocker?.status === 'OPEN' || item.pendingRequest
            ? getAttentionLabel({
                blocker: item.blocker,
                pendingRequest: item.pendingRequest,
              })
            : undefined,
        attentionReason:
          item.blocker?.status === 'OPEN' || item.pendingRequest
            ? getAttentionReason({
                blocker: item.blocker,
                pendingRequest: item.pendingRequest,
              })
            : undefined,
        currentStepName: currentStep?.name || 'Awaiting orchestration',
        agentName: agentsById.get(agentId || '')?.name || agentId || 'Unassigned',
        ageLabel: formatRelativeTime(item.history[item.history.length - 1]?.timestamp),
      };
    },
    [agentsById, workflowsById],
  );

  const navigatorSections = useMemo<WorkNavigatorSection[]>(
    () => [
      {
        id: 'attention',
        title: 'Needs attention',
        helper: 'Approvals, blockers, and waits that need operator action now.',
        items: attentionItems.slice(0, 6).map(entry => buildNavigatorItem(entry.item)),
      },
      {
        id: 'active',
        title: 'Active work',
        helper: 'Current in-flight items across the capability.',
        items: filteredWorkItems
          .filter(item => item.status !== 'ARCHIVED')
          .filter(item => item.status !== 'COMPLETED' && item.phase !== 'DONE')
          .filter(item => item.status !== 'CANCELLED')
          .filter(item => item.status !== 'PAUSED')
          .slice(0, 12)
          .map(buildNavigatorItem),
      },
      {
        id: 'paused',
        title: 'Paused',
        helper: 'Items intentionally paused. Resume them when you are ready to re-enter the flow.',
        items: filteredWorkItems
          .filter(item => item.status === 'PAUSED')
          .slice(0, 12)
          .map(buildNavigatorItem),
      },
      {
        id: 'completed',
        title: 'Completed',
        helper: 'Recently finished work kept nearby for review and traceability.',
        items: completedItems.slice(0, 8).map(buildNavigatorItem),
      },
      {
        id: 'archive',
        title: 'Archive',
        helper: 'Soft-deleted items kept out of the active queues. Restore them to restart from intake.',
        items: filteredWorkItems
          .filter(item => item.status === 'ARCHIVED')
          .slice(0, 12)
          .map(buildNavigatorItem),
      },
    ],
    [attentionItems, buildNavigatorItem, completedItems, filteredWorkItems],
  );

  const selectedWorkItem =
    workItems.find(item => item.id === selectedWorkItemId) || null;
  const phaseMoveItem = phaseMoveRequest
    ? workItems.find(item => item.id === phaseMoveRequest.workItemId) || null
    : null;
  const selectedWorkflow = selectedWorkItem
    ? workflowsById.get(selectedWorkItem.workflowId) || null
    : null;
  const selectedRunRecord = selectedRunDetail?.run || null;

  useEffect(() => {
    setPhaseRailPreviewPhase(null);
    setIsPhaseRailDragging(false);
  }, [selectedWorkItemId, selectedWorkItem?.phase, view]);

  const selectedRunSteps = useMemo(
    () => (Array.isArray(selectedRunDetail?.steps) ? selectedRunDetail.steps : []),
    [selectedRunDetail?.steps],
  );
  const selectedCurrentStep = getCurrentWorkflowStep(
    selectedWorkflow,
    selectedRunDetail,
    selectedWorkItem,
  );
  const selectedRunStep =
    selectedRunSteps.find(
      step =>
        step.workflowStepId === selectedRunRecord?.currentStepId ||
        step.workflowNodeId === selectedRunRecord?.currentNodeId,
    ) || null;
  const selectedOpenWait = getSelectedRunWait(selectedRunDetail);
  const selectedCompiledStepContext =
    asCompiledStepContext(selectedRunStep?.metadata?.compiledStepContext) ||
    asCompiledStepContext(selectedOpenWait?.payload?.compiledStepContext);
  const selectedCompiledWorkItemPlan =
    asCompiledWorkItemPlan(selectedRunStep?.metadata?.compiledWorkItemPlan) ||
    asCompiledWorkItemPlan(selectedOpenWait?.payload?.compiledWorkItemPlan);
  const selectedRequestedInputFields = asCompiledInputFields(
    selectedOpenWait?.payload?.requestedInputFields,
  );
  const approvedWorkspaceRoots = useMemo(
    () =>
      Array.from(
        new Set(
          [
            activeCapability.executionConfig.defaultWorkspacePath,
            ...(activeCapability.executionConfig.allowedWorkspacePaths || []),
            ...(activeCapability.localDirectories || []),
          ]
            .map(value => String(value || '').trim())
            .filter(Boolean),
        ),
      ),
    [
      activeCapability.executionConfig.defaultWorkspacePath,
      activeCapability.executionConfig.allowedWorkspacePaths,
      activeCapability.localDirectories,
    ],
  );
  const hasApprovedWorkspaceConfigured = approvedWorkspaceRoots.length > 0;
  const waitRequiresApprovedWorkspace = selectedRequestedInputFields.some(
    field => field.id === 'approved-workspace',
  );
  const waitOnlyRequestsApprovedWorkspace = Boolean(
    waitRequiresApprovedWorkspace &&
      selectedRequestedInputFields.length > 0 &&
      selectedRequestedInputFields.every(field => field.id === 'approved-workspace'),
  );

  const preferredApprovedWorkspaceRoot = useMemo(() => {
    const fallback = approvedWorkspaceRoots[0] || '';
    const configuredDefault = String(activeCapability.executionConfig.defaultWorkspacePath || '').trim();
    return configuredDefault || fallback;
  }, [activeCapability.executionConfig.defaultWorkspacePath, approvedWorkspaceRoots]);

  useEffect(() => {
    if (!waitRequiresApprovedWorkspace) {
      return;
    }

    if (approvedWorkspaceDraft.trim()) {
      return;
    }

    if (preferredApprovedWorkspaceRoot) {
      setApprovedWorkspaceDraft(preferredApprovedWorkspaceRoot);
    }
  }, [approvedWorkspaceDraft, preferredApprovedWorkspaceRoot, selectedWorkItemId, waitRequiresApprovedWorkspace]);

  useEffect(() => {
    const focus = selectionFocusRef.current;
    if (!focus || detailTab !== 'operate') {
      return;
    }

    const targetId =
      focus === 'INPUT' && waitRequiresApprovedWorkspace && !hasApprovedWorkspaceConfigured
        ? 'orchestrator-structured-input'
        : 'orchestrator-guidance';
    const element = document.getElementById(targetId);
    if (!element) {
      return;
    }

    selectionFocusRef.current = null;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (targetId === 'orchestrator-guidance' && (focus === 'RESOLUTION' || focus === 'INPUT')) {
      window.requestAnimationFrame(() => {
        resolutionNoteRef.current?.focus();
      });
    }
  }, [
    detailTab,
    hasApprovedWorkspaceConfigured,
    selectedOpenWait?.type,
    selectedWorkItemId,
    waitRequiresApprovedWorkspace,
  ]);
  const selectedCodeDiffArtifactId =
    typeof selectedOpenWait?.payload?.codeDiffArtifactId === 'string'
      ? selectedOpenWait.payload.codeDiffArtifactId
      : undefined;
  const selectedContrarianReview =
    selectedOpenWait?.type === 'CONFLICT_RESOLUTION'
      ? getContrarianReview(selectedOpenWait)
      : undefined;
  const selectedContrarianReviewTone =
    getContrarianReviewTone(selectedContrarianReview);
  const selectedContrarianReviewIsReady =
    selectedContrarianReview?.status === 'READY';
  const selectedAgentId =
    selectedRunRecord?.assignedAgentId ||
    selectedCurrentStep?.agentId ||
    selectedWorkItem?.assignedAgentId;
  const selectedAgent = selectedAgentId ? agentsById.get(selectedAgentId) || null : null;
  const selectedAttentionReason = selectedWorkItem
    ? getAttentionReason({
        blocker: selectedWorkItem.blocker,
        pendingRequest: selectedWorkItem.pendingRequest,
        wait: selectedOpenWait,
      }) || (selectedWorkItem.status === 'BLOCKED'
        ? 'This work item is blocked and needs operator action before orchestration can continue.'
        : '')
    : '';
  const selectedAttentionLabel = selectedWorkItem
    ? getAttentionLabel({
        blocker: selectedWorkItem.blocker,
        pendingRequest: selectedWorkItem.pendingRequest,
        wait: selectedOpenWait,
      })
    : 'Action required';
  const selectedAttentionRequestedBy =
    selectedWorkItem?.blocker?.requestedBy ||
    selectedOpenWait?.requestedBy ||
    selectedWorkItem?.pendingRequest?.requestedBy ||
    selectedAgent?.id;
  const selectedAttentionTimestamp =
    selectedWorkItem?.blocker?.timestamp ||
    selectedOpenWait?.createdAt ||
    selectedWorkItem?.pendingRequest?.timestamp ||
    selectedWorkItem?.history.slice(-1)[0]?.timestamp;
  const selectedResetStep = selectedWorkflow?.steps[0] || null;
  const selectedResetPhase = selectedResetStep?.phase || 'BACKLOG';
  const selectedResetAgent = selectedResetStep?.agentId
    ? agentsById.get(selectedResetStep.agentId) || null
    : null;
  const workspaceUsersById = useMemo(
    () => new Map(workspaceOrganization.users.map(user => [user.id, user])),
    [workspaceOrganization.users],
  );
  const workspaceTeamsById = useMemo(
    () => new Map(workspaceOrganization.teams.map(team => [team.id, team])),
    [workspaceOrganization.teams],
  );
  const selectedPhaseOwnerTeam =
    (selectedWorkItem?.phaseOwnerTeamId
      ? workspaceTeamsById.get(selectedWorkItem.phaseOwnerTeamId)
      : null) || null;
  const selectedClaimOwner =
    (selectedWorkItem?.claimOwnerUserId
      ? workspaceUsersById.get(selectedWorkItem.claimOwnerUserId)
      : null) || null;
  const selectedEffectiveExecutionContext =
    selectedExecutionContext || selectedWorkItem?.executionContext || null;
  const selectedSharedBranch = selectedEffectiveExecutionContext?.branch || null;
  const selectedExecutionRepository =
    activeCapability.repositories?.find(
      repository =>
        repository.id ===
        (selectedEffectiveExecutionContext?.primaryRepositoryId ||
          selectedSharedBranch?.repositoryId),
    ) || null;
  const selectedActiveWriter =
    (selectedEffectiveExecutionContext?.activeWriterUserId
      ? workspaceUsersById.get(selectedEffectiveExecutionContext.activeWriterUserId)
      : null) || null;
  const latestSelectedHandoff = selectedHandoffs[0] || null;
  const selectedPresenceUsers = selectedPresence
    .map(entry => workspaceUsersById.get(entry.userId) || null)
    .filter(Boolean) as NonNullable<typeof selectedClaimOwner>[];

  const currentRun = selectedRunRecord || selectedRunHistory[0] || null;
  const currentRunId =
    currentRun?.id || selectedWorkItem?.activeRunId || selectedRunHistory[0]?.id || null;
  const currentRunIsActive = Boolean(
    currentRun && ACTIVE_RUN_STATUSES.includes(currentRun.status),
  );
  const runtimeReady = Boolean(
    runtimeStatus &&
      (runtimeStatus.runtimeOwner === 'DESKTOP'
        ? runtimeStatus.configured
        : runtimeStatus.executionRuntimeOwner === 'DESKTOP' || runtimeStatus.configured) &&
      !runtimeError,
  );
  const capabilityExperience = useMemo(
    () =>
      buildCapabilityExperience({
        capability: activeCapability,
        workspace,
        runtimeStatus,
      }),
    [activeCapability, runtimeStatus, workspace],
  );
  const readinessContract = capabilityExperience.readinessContract;
  const primaryReadinessGate =
    readinessContract.gates.find(gate => !gate.satisfied) || null;
  const deliveryBlockingItem = capabilityExperience.blockingReadinessItems[0] || null;
  const primaryCopilotAgent =
    capabilityExperience.primaryCopilotAgent ||
    (workspace.primaryCopilotAgentId
      ? agentsById.get(workspace.primaryCopilotAgentId) || null
      : null) ||
    selectedAgent ||
    null;
  const executionOwnership = workspace.executionOwnership || null;
  const currentDesktopOwnsExecution = Boolean(
    executionOwnership?.executorId &&
      runtimeStatus?.executorId &&
      executionOwnership.executorId === runtimeStatus.executorId,
  );
  const executionOwnerLabel = executionOwnership
    ? `${executionOwnership.actorDisplayName}${
        currentDesktopOwnsExecution ? ' (this desktop)' : ''
      }`
    : 'No desktop owner';
  const executionDispatchLabel =
    workspace.executionDispatchState === 'ASSIGNED'
      ? 'Desktop assigned'
      : workspace.executionDispatchState === 'WAITING_FOR_EXECUTOR'
      ? 'Waiting for desktop'
      : workspace.executionDispatchState === 'STALE_EXECUTOR'
      ? 'Desktop disconnected'
      : 'Unassigned';
  const selectedCanTakeControl = Boolean(
    selectedWorkItem &&
      selectedWorkItem.status !== 'ARCHIVED' &&
      selectedAgent &&
      runtimeReady &&
      canControlWorkItems,
  );
  const selectedCanGuideBlockedAgent = Boolean(
    selectedWorkItem &&
      selectedWorkItem.status === 'BLOCKED' &&
      !selectedOpenWait &&
      !currentRunIsActive &&
      runtimeReady &&
      canRestartWorkItems,
  );
  const guidanceSuggestions = buildGuidanceSuggestions({
    workItem: selectedWorkItem,
    wait: selectedOpenWait,
    requestedInputFields: selectedRequestedInputFields,
  });

  const canStartExecution =
    Boolean(selectedWorkItem) &&
    selectedWorkItem?.status !== 'ARCHIVED' &&
    selectedWorkItem?.status !== 'COMPLETED' &&
    selectedWorkItem?.status !== 'CANCELLED' &&
    !selectedWorkItem?.activeRunId &&
    selectedWorkItem?.phase !== 'DONE' &&
    capabilityExperience.canStartDelivery &&
    runtimeReady &&
    canControlWorkItems;
  const currentActorOwnsSelectedWorkItem = Boolean(
    selectedWorkItem &&
      currentActorContext.userId &&
      (selectedWorkItem.claimOwnerUserId === currentActorContext.userId ||
        (selectedWorkItem.phaseOwnerTeamId &&
          currentActorContext.teamIds.includes(selectedWorkItem.phaseOwnerTeamId))),
  );
  const currentActorOwnsWriteControl = Boolean(
    currentActorContext.userId &&
      selectedEffectiveExecutionContext?.activeWriterUserId === currentActorContext.userId,
  );
  const canInitializeExecutionContext =
    Boolean(selectedWorkItem) && selectedWorkItem?.status !== 'ARCHIVED' && canControlWorkItems;
  const canCreateSharedBranch = Boolean(
    selectedWorkItem &&
      selectedExecutionRepository?.localRootHint &&
      selectedEffectiveExecutionContext?.branch &&
      canControlWorkItems,
  );

  const canRestartFromPhase =
    Boolean(selectedWorkItem && currentRunId) &&
    selectedWorkItem?.status !== 'ARCHIVED' &&
    selectedWorkItem?.status !== 'COMPLETED' &&
    selectedWorkItem?.status !== 'CANCELLED' &&
    selectedWorkItem?.phase !== 'DONE' &&
    capabilityExperience.canStartDelivery &&
    runtimeReady &&
    canRestartWorkItems;
  const canResetAndRestart =
    Boolean(selectedWorkItem) &&
    selectedWorkItem?.status !== 'ARCHIVED' &&
    selectedWorkItem?.status !== 'COMPLETED' &&
    selectedWorkItem?.status !== 'CANCELLED' &&
    capabilityExperience.canStartDelivery &&
    runtimeReady &&
    canRestartWorkItems;
  const codeDiffReviewRequiresResponse = Boolean(
    selectedOpenWait?.type === 'APPROVAL' && selectedCodeDiffArtifactId,
  );

  const actionButtonLabel =
    selectedOpenWait?.type === 'APPROVAL'
      ? 'Approve and continue'
      : selectedOpenWait?.type === 'INPUT'
      ? 'Submit details and unblock'
      : selectedOpenWait?.type === 'CONFLICT_RESOLUTION'
        ? 'Resolve conflict and unblock'
        : 'Continue';

  const resolutionPlaceholder =
    selectedOpenWait?.type === 'APPROVAL' && selectedCodeDiffArtifactId
      ? 'Guide the developer with code review notes, implementation conditions, or sign-off guidance before continuing.'
      : selectedOpenWait?.type === 'APPROVAL'
      ? 'Add approval notes, release conditions, or sign-off details.'
      : selectedOpenWait?.type === 'INPUT'
        ? 'Guide the agent with the missing business, technical, or governance details needed to unblock this work item.'
        : selectedOpenWait?.type === 'CONFLICT_RESOLUTION'
          ? 'Guide the agent with the final conflict decision and any implementation constraints.'
          : selectedCanGuideBlockedAgent
            ? 'Guide the next attempt. Explain what changed, what the agent should do differently, and any constraints it must respect.'
            : 'Approval note, human input, restart note, or cancellation reason.';
  const dockComposerLabel = selectedOpenWait
    ? 'Resolve wait mode'
    : selectedCanGuideBlockedAgent
    ? 'Guide blocked execution'
    : canStartExecution
    ? 'Start and guide execution'
    : 'Ask copilot';
  const dockComposerPlaceholder = selectedOpenWait
    ? selectedOpenWait.type === 'APPROVAL'
      ? 'Approval decisions now happen in the review window. Use this dock to ask the agent follow-up questions or capture context before you open the approval review.'
      : resolutionPlaceholder
    : selectedCanGuideBlockedAgent
    ? 'Explain what changed, what the next attempt should do differently, and any constraints it must respect.'
    : canStartExecution
    ? 'Add optional kickoff guidance, file hints, or execution constraints before starting the workflow.'
    : 'Ask the copilot about this work item, upload context, or steer the next step.';
  const dockPrimaryActionLabel = selectedOpenWait
    ? selectedOpenWait.type === 'APPROVAL'
      ? 'Open approval review'
      : actionButtonLabel
    : selectedCanGuideBlockedAgent
    ? 'Guide and restart'
    : canStartExecution
    ? 'Start execution'
    : 'Send';
  const dockInterventionMode =
    selectedOpenWait?.type === 'INPUT' ||
    selectedOpenWait?.type === 'CONFLICT_RESOLUTION' ||
    selectedCanGuideBlockedAgent;
  const dockAllowsChatOnly = !dockInterventionMode;

  const resolutionIsRequired =
    selectedOpenWait?.type === 'INPUT' ||
    selectedOpenWait?.type === 'CONFLICT_RESOLUTION';
  const requestChangesIsAvailable = codeDiffReviewRequiresResponse;
  const canResolveSelectedWait =
    Boolean(selectedOpenWait) &&
    (selectedOpenWait?.type === 'APPROVAL' ? canDecideApprovals : canControlWorkItems) &&
    (!resolutionIsRequired || Boolean(resolutionNote.trim()));
  const hasMissingWorkspaceInput = selectedRequestedInputFields.some(
    field => field.source === 'WORKSPACE' && field.status === 'MISSING',
  ) && !hasApprovedWorkspaceConfigured;
  const canRequestChanges =
    requestChangesIsAvailable && Boolean(resolutionNote.trim()) && canDecideApprovals;
  const canGuideAndRestart =
    selectedCanGuideBlockedAgent && Boolean(resolutionNote.trim()) && canRestartWorkItems;

  const requirePermission = (allowed: boolean, summary: string) => {
    if (allowed) {
      return true;
    }
    showError('Access restricted', summary);
    return false;
  };

  const stepOrder = useMemo(
    () =>
      new Map(
        (selectedWorkflow?.steps || []).map((step, index) => [step.id, index] as const),
      ),
    [selectedWorkflow],
  );

  const selectedTasks = useMemo(() => {
    if (!selectedWorkItem) {
      return [];
    }

    return workspace.tasks
      .filter(task => task.workItemId === selectedWorkItem.id)
      .slice()
      .sort(
        (left, right) =>
          (stepOrder.get(left.workflowStepId || '') ?? Number.MAX_SAFE_INTEGER) -
          (stepOrder.get(right.workflowStepId || '') ?? Number.MAX_SAFE_INTEGER),
      );
  }, [selectedWorkItem, stepOrder, workspace.tasks]);

  const selectedRunStepIds = useMemo(
    () => new Set(selectedRunSteps.map(step => step.id)),
    [selectedRunSteps],
  );

  const selectedArtifacts = useMemo(() => {
    if (!selectedWorkItem) {
      return [];
    }

    if (!selectedRunDetail) {
      return workspace.artifacts
        .filter(artifact => artifact.workItemId === selectedWorkItem.id)
        .slice()
        .sort(
          (left, right) =>
            new Date(right.created).getTime() - new Date(left.created).getTime(),
        );
    }

    return workspace.artifacts
      .filter(
        artifact =>
          artifact.runId === selectedRunRecord?.id ||
          artifact.sourceRunId === selectedRunRecord?.id ||
          artifact.workItemId === selectedWorkItem.id ||
          (artifact.runStepId && selectedRunStepIds.has(artifact.runStepId)),
      )
      .slice()
      .sort(
        (left, right) =>
          new Date(right.created).getTime() - new Date(left.created).getTime(),
      );
  }, [selectedRunDetail, selectedRunRecord?.id, selectedRunStepIds, selectedWorkItem, workspace.artifacts]);
  const selectedRunIds = useMemo(
    () =>
      new Set(
        [selectedRunRecord?.id, ...selectedRunHistory.map(run => run.id)].filter(
          Boolean,
        ) as string[],
      ),
    [selectedRunHistory, selectedRunRecord?.id],
  );
  const selectedWorkItemArtifacts = useMemo(() => {
    if (!selectedWorkItem) {
      return [];
    }

    return workspace.artifacts
      .filter(artifact => {
        if (artifact.workItemId === selectedWorkItem.id) {
          return true;
        }

        if (
          artifact.runId &&
          selectedRunIds.has(artifact.runId)
        ) {
          return true;
        }

        if (
          artifact.sourceRunId &&
          selectedRunIds.has(artifact.sourceRunId)
        ) {
          return true;
        }

        return false;
      })
      .slice()
      .sort(
        (left, right) =>
          new Date(right.created).getTime() - new Date(left.created).getTime(),
      );
  }, [selectedRunIds, selectedWorkItem, workspace.artifacts]);
  const filteredArtifacts = useMemo(
    () => selectedArtifacts.filter(artifact => matchesArtifactWorkbenchFilter(artifact, artifactFilter)),
    [artifactFilter, selectedArtifacts],
  );
  const filteredApprovalArtifacts = useMemo(
    () =>
      selectedWorkItemArtifacts.filter(artifact =>
        matchesArtifactWorkbenchFilter(artifact, approvalArtifactFilter),
      ),
    [approvalArtifactFilter, selectedWorkItemArtifacts],
  );
  const selectedArtifact = useMemo(
    () =>
      (selectedArtifactId
        ? filteredArtifacts.find(artifact => artifact.id === selectedArtifactId)
        : null) || filteredArtifacts[0] || null,
    [filteredArtifacts, selectedArtifactId],
  );
  const selectedApprovalArtifact = useMemo(
    () => {
      if (isApprovalReviewOpen && !selectedApprovalArtifactId) {
        return null;
      }

      return (
        (selectedApprovalArtifactId
          ? filteredApprovalArtifacts.find(artifact => artifact.id === selectedApprovalArtifactId)
          : null) ||
        filteredApprovalArtifacts.find(artifact => artifact.id === selectedCodeDiffArtifactId) ||
        filteredApprovalArtifacts[0] ||
        null
      );
    },
    [
      filteredApprovalArtifacts,
      isApprovalReviewOpen,
      selectedApprovalArtifactId,
      selectedCodeDiffArtifactId,
    ],
  );
  const selectedCodeDiffArtifact = useMemo<Artifact | null>(() => {
    if (!selectedCodeDiffArtifactId) {
      return null;
    }

    return (
      workspace.artifacts.find(artifact => artifact.id === selectedCodeDiffArtifactId) ||
      null
    );
  }, [selectedCodeDiffArtifactId, workspace.artifacts]);
  const selectedCodeDiffDocument = useMemo(() => {
    if (!selectedCodeDiffArtifact) {
      return '';
    }

    return (
      getArtifactDocumentBody(selectedCodeDiffArtifact) ||
      selectedOpenWait?.payload?.codeDiffSummary ||
      ''
    );
  }, [selectedCodeDiffArtifact, selectedOpenWait]);
  const selectedCodeDiffRepositories = useMemo(() => {
    const repositories = (
      selectedCodeDiffArtifact?.contentJson as
        | { repositories?: Array<{ touchedFiles?: string[] }> }
        | undefined
    )?.repositories;
    return Array.isArray(repositories) ? repositories : [];
  }, [selectedCodeDiffArtifact]);
  const selectedCodeDiffRepositoryCount = selectedCodeDiffRepositories.length;
  const selectedCodeDiffTouchedFileCount = selectedCodeDiffRepositories.reduce(
    (count, repository) => count + (repository.touchedFiles?.length || 0),
    0,
  );
  const selectedHasCodeDiffApproval =
    selectedOpenWait?.type === 'APPROVAL' && Boolean(selectedCodeDiffArtifactId);
  const approvalReviewWait =
    selectedOpenWait?.type === 'APPROVAL' ? selectedOpenWait : approvalReviewWaitSnapshot;
  const approvalAssignments = approvalReviewWait?.approvalAssignments || [];
  const approvalDecisions = approvalReviewWait?.approvalDecisions || [];
  const approvalDecisionByAssignmentId = useMemo(
    () =>
      new Map(
        approvalDecisions
          .filter((decision): decision is ApprovalDecision & { assignmentId: string } =>
            Boolean(decision.assignmentId),
          )
          .map(decision => [decision.assignmentId, decision]),
      ),
    [approvalDecisions],
  );
  const unassignedApprovalDecisions = useMemo(
    () => approvalDecisions.filter(decision => !decision.assignmentId),
    [approvalDecisions],
  );

  useEffect(() => {
    if (selectedHasCodeDiffApproval) {
      return;
    }
    setIsDiffReviewOpen(false);
  }, [selectedHasCodeDiffApproval]);

  useEffect(() => {
    if (selectedOpenWait?.type === 'APPROVAL') {
      setApprovalReviewWaitSnapshot(selectedOpenWait);
      return;
    }

    if (!isApprovalReviewOpen) {
      setApprovalReviewWaitSnapshot(null);
    }
  }, [isApprovalReviewOpen, selectedOpenWait]);

  useEffect(() => {
    if (filteredArtifacts.length === 0) {
      setSelectedArtifactId(null);
      return;
    }

    if (
      !selectedArtifactId ||
      !filteredArtifacts.some(artifact => artifact.id === selectedArtifactId)
    ) {
      setSelectedArtifactId(filteredArtifacts[0].id);
    }
  }, [filteredArtifacts, selectedArtifactId]);

  useEffect(() => {
    if (filteredApprovalArtifacts.length === 0) {
      setSelectedApprovalArtifactId(null);
      return;
    }

    if (isApprovalReviewOpen && !selectedApprovalArtifactId) {
      return;
    }

    if (
      selectedCodeDiffArtifactId &&
      filteredApprovalArtifacts.some(artifact => artifact.id === selectedCodeDiffArtifactId)
    ) {
      setSelectedApprovalArtifactId(current =>
        current === selectedCodeDiffArtifactId ? current : selectedCodeDiffArtifactId,
      );
      return;
    }

    if (
      !selectedApprovalArtifactId ||
      !filteredApprovalArtifacts.some(artifact => artifact.id === selectedApprovalArtifactId)
    ) {
      setSelectedApprovalArtifactId(filteredApprovalArtifacts[0].id);
    }
  }, [
    filteredApprovalArtifacts,
    isApprovalReviewOpen,
    selectedApprovalArtifactId,
    selectedCodeDiffArtifactId,
  ]);

  const selectedLogs = useMemo(() => {
    if (!selectedWorkItem) {
      return [];
    }

    const relatedTaskIds = new Set<string>([
      selectedWorkItem.id,
      ...selectedTasks.map(task => task.id),
    ]);

    return workspace.executionLogs
      .filter(log => {
        if (selectedRunRecord && log.runId === selectedRunRecord.id) {
          return true;
        }
        return relatedTaskIds.has(log.taskId);
      })
      .slice()
      .sort(
        (left, right) =>
          new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
      );
  }, [selectedRunRecord, selectedTasks, selectedWorkItem, workspace.executionLogs]);

  const recentRunActivity = useMemo(
    () => selectedRunEvents.slice(-8).reverse(),
    [selectedRunEvents],
  );

  const latestArtifact = selectedArtifact || null;
  const latestArtifactDocument = useMemo(() => {
    return getArtifactDocumentBody(selectedArtifact);
  }, [selectedArtifact]);
  const selectedApprovalArtifactDocument = useMemo(
    () => getArtifactDocumentBody(selectedApprovalArtifact),
    [selectedApprovalArtifact],
  );
  const stageChatScopeKey = selectedWorkItem && selectedAgent
    ? `${selectedWorkItem.id}:${selectedAgent.id}:${selectedCurrentStep?.id || 'stage'}`
    : null;
  const selectedStageChatMessages = stageChatScopeKey
    ? stageChatByScope[stageChatScopeKey] || []
    : [];
  const selectedStageChatTimelineMessages = useMemo(
    () =>
      selectedWorkItem && selectedAgent
        ? selectedStageChatMessages.map(message => ({
            id: message.id,
            capabilityId: activeCapability.id,
            role: message.role,
            content: message.content,
            timestamp: message.timestamp,
            agentId: message.role === 'agent' ? selectedAgent.id : undefined,
            agentName: message.role === 'agent' ? selectedAgent.name : undefined,
            traceId: message.traceId,
            model: message.model,
            sessionId: message.sessionId,
            sessionScope: message.sessionScope || 'WORK_ITEM',
            sessionScopeId: message.sessionScopeId || selectedWorkItem.id,
            workItemId: selectedWorkItem.id,
            runId: currentRun?.id,
            workflowStepId: selectedCurrentStep?.id,
          }))
        : [],
    [
      activeCapability.id,
      currentRun?.id,
      selectedAgent,
      selectedCurrentStep?.id,
      selectedStageChatMessages,
      selectedWorkItem,
    ],
  );

  useEffect(() => {
    stageChatRequestRef.current += 1;
    setStageChatDraft('');
    setStageChatError('');
    setIsStageChatSending(false);
  }, [stageChatScopeKey]);

  const stageChatSuggestedPrompts = useMemo(() => {
    if (!selectedWorkItem || !selectedCurrentStep) {
      return [];
    }

    const prompts = [
      `Explain the current status of ${selectedWorkItem.id} in simple terms.`,
      `What exact files or artifacts do you expect to touch in ${selectedCurrentStep.name}?`,
      `What is blocking ${selectedWorkItem.id}, and what do you need from me to continue?`,
    ];

    if (selectedAttentionReason) {
      prompts.unshift(
        `Use this blocker context and tell me the safest next move: ${selectedAttentionReason}`,
      );
    }

    return prompts.slice(0, 3);
  }, [selectedAttentionReason, selectedCurrentStep, selectedWorkItem]);
  const selectedAgentKnowledgeLens = useMemo(
    () =>
      selectedAgent
        ? buildAgentKnowledgeLens({
            capability: activeCapability,
            workspace,
            agent: selectedAgent,
            workItemId: selectedWorkItem?.id,
          })
        : null,
    [activeCapability, selectedAgent, selectedWorkItem?.id, workspace],
  );
  const selectedInteractionFeed = useMemo(
    () =>
      buildCapabilityInteractionFeed({
        capability: activeCapability,
        workspace,
        workItemId: selectedWorkItem?.id,
        runDetail: selectedRunDetail,
        runEvents: selectedRunEvents,
        extraChatMessages: selectedStageChatTimelineMessages,
        agentId: selectedAgent?.id,
      }),
    [
      activeCapability,
      selectedAgent?.id,
      selectedRunDetail,
      selectedRunEvents,
      selectedStageChatTimelineMessages,
      selectedWorkItem?.id,
      workspace,
    ],
  );
  const handleOpenArtifactFromTimeline = useCallback((artifactId: string) => {
    setDetailTab('artifacts');
    setSelectedArtifactId(artifactId);
  }, []);
  const handleOpenRunFromTimeline = useCallback(
    async (runId: string) => {
      try {
        const [detail, events] = await Promise.all([
          fetchCapabilityWorkflowRun(activeCapability.id, runId),
          fetchCapabilityWorkflowRunEvents(activeCapability.id, runId),
        ]);
        setSelectedRunDetail(detail);
        setSelectedRunEvents(events);
        setDetailTab('attempts');
      } catch (error) {
        showError(
          'Unable to open run',
          error instanceof Error ? error.message : 'Unable to load the selected run right now.',
        );
      }
    },
    [activeCapability.id, showError],
  );
  const handleOpenTaskFromTimeline = useCallback(
    (taskId: string) => {
      navigate(`/tasks?taskId=${encodeURIComponent(taskId)}`);
    },
    [navigate],
  );
  const handleCreateEvidencePacket = useCallback(async () => {
    if (!selectedWorkItem) {
      return;
    }

    await withAction(
      'evidencePacket',
      async () => {
        const packet = await createEvidencePacketForWorkItem(
          activeCapability.id,
          selectedWorkItem.id,
        );
        await refreshCapabilityBundle(activeCapability.id);
        navigate(`/e/${encodeURIComponent(packet.bundleId)}`);
      },
      {
        title: 'Evidence packet created',
        description:
          'A durable evidence packet was generated from the current work item context and opened in the packet viewer.',
      },
    );
  }, [activeCapability.id, navigate, refreshCapabilityBundle, selectedWorkItem]);
  const handleClearDockChat = useCallback(async () => {
    if (!selectedWorkItem) {
      return;
    }

    const shouldClear = window.confirm(
      `Clear the copilot thread for ${selectedWorkItem.id}? This also resets the saved work-item chat session so the next turn starts cleanly.`,
    );
    if (!shouldClear) {
      return;
    }

    await withAction(
      'clearDockChat',
      async () => {
        await clearCapabilityMessageHistoryRecord(activeCapability.id, {
          workItemId: selectedWorkItem.id,
        });
        await refreshCapabilityBundle(activeCapability.id);
        setDockInput('');
        setDockUploads([]);
        setDockDraft('');
        setDockError('');
      },
      {
        title: 'Work-item chat cleared',
        description:
          'The copilot dock thread was cleared and the saved work-item session was reset.',
      },
    );
  }, [activeCapability.id, refreshCapabilityBundle, selectedWorkItem, withAction]);
  const selectedStateSummary = useMemo(() => {
    if (!selectedWorkItem) {
      return 'Select a work item to see the current delivery state.';
    }

    if (currentRun) {
      return `${RUN_STATUS_META[currentRun.status].label} in ${
        selectedCurrentStep?.name || getPhaseMeta(selectedWorkItem.phase).label
      } with ${selectedAgent?.name || 'the assigned agent'} working this stage.`;
    }

    if (selectedWorkItem.status === 'COMPLETED' || selectedWorkItem.phase === 'DONE') {
      return 'This work item has completed and is ready for evidence review.';
    }

    return 'This work item is staged but execution has not started yet.';
  }, [currentRun, getPhaseMeta, selectedAgent?.name, selectedCurrentStep?.name, selectedWorkItem]);
  const selectedFailureReason = useMemo(
    () =>
      getLatestRunFailureReason({
        run: currentRun,
        runSteps: selectedRunSteps,
        runEvents: selectedRunEvents,
      }),
    [currentRun, selectedRunEvents, selectedRunSteps],
  );
  const selectedBlockerSummary =
    selectedAttentionReason ||
    selectedFailureReason ||
    'No blocker is open right now. You can inspect context, review artifacts, or continue execution.';
  const selectedNextActionSummary = useMemo(() => {
    if (!selectedWorkItem) {
      return 'Choose a work item to see the recommended next action.';
    }

    if (selectedOpenWait?.type === 'APPROVAL') {
      return 'Review the approval request and continue once the output meets the required conditions.';
    }
    if (selectedOpenWait?.type === 'INPUT') {
      return 'Provide the missing structured input so the engine can continue this stage.';
    }
    if (selectedOpenWait?.type === 'CONFLICT_RESOLUTION') {
      return 'Resolve the conflict and give the final decision the agent must honor.';
    }
    if (selectedCanGuideBlockedAgent) {
      return 'Guide the agent with what changed, then restart the blocked step from this page.';
    }
    if (canStartExecution) {
      return 'Start execution when the work item is ready to move into active delivery.';
    }
    if (currentRunIsActive) {
      return 'Monitor the stage, answer agent questions inline, or wait for the next operator gate.';
    }
    if (selectedWorkItem.status === 'COMPLETED' || selectedWorkItem.phase === 'DONE') {
      return 'Review artifacts, explainability, and completion evidence for this finished item.';
    }
    return 'Use the workbench to inspect context, talk to the agent, or restart the latest attempt.';
  }, [
    canStartExecution,
    currentRunIsActive,
    selectedCanGuideBlockedAgent,
    selectedOpenWait,
    selectedWorkItem,
  ]);
  const latestRunSummary = selectedRunHistory[0] || null;
  const previousRunSummary = selectedRunHistory[1] || null;
  const attemptComparisonLines = useMemo(() => {
    if (!latestRunSummary || !previousRunSummary) {
      return [];
    }

    const lines: string[] = [];

    if (latestRunSummary.status !== previousRunSummary.status) {
      lines.push(
        `Status changed from ${RUN_STATUS_META[previousRunSummary.status].label} to ${RUN_STATUS_META[latestRunSummary.status].label}.`,
      );
    }

    if (latestRunSummary.currentPhase !== previousRunSummary.currentPhase) {
      lines.push(
        `The latest attempt is now in ${getPhaseMeta(latestRunSummary.currentPhase).label} instead of ${getPhaseMeta(previousRunSummary.currentPhase).label}.`,
      );
    }

    if (latestRunSummary.terminalOutcome && latestRunSummary.terminalOutcome !== previousRunSummary.terminalOutcome) {
      lines.push(`Latest outcome note: ${latestRunSummary.terminalOutcome}`);
    }

    if (selectedArtifacts.length > 0) {
      lines.push(`${selectedArtifacts.length} artifacts are attached to the latest attempt.`);
    }

    if (selectedOpenWait) {
      lines.push(`The current attempt is paused on ${formatEnumLabel(selectedOpenWait.type)}.`);
    }

    return lines.slice(0, 4);
  }, [
    getPhaseMeta,
    latestRunSummary,
    previousRunSummary,
    selectedArtifacts.length,
    selectedOpenWait,
  ]);

  useEffect(() => {
    const thread = stageChatThreadRef.current;
    if (!thread) {
      return;
    }

    if (!stageChatStickToBottomRef.current && !isStageChatSending && !stageChatDraft) {
      return;
    }

    thread.scrollTop = thread.scrollHeight;
  }, [isStageChatSending, selectedStageChatMessages, stageChatDraft]);

  useEffect(() => {
    if (view !== 'list') {
      return;
    }

    const thread = dockThreadRef.current;
    if (!thread) {
      return;
    }

    if (!dockStickToBottomRef.current && !isDockSending && !dockDraft) {
      return;
    }

    thread.scrollTop = thread.scrollHeight;
  }, [dockDraft, isDockSending, selectedWorkItemId, view, workspace.messages]);

  const draftWorkflow = workflowsById.get(draftWorkItem.workflowId) || null;
  const draftFirstStep = draftWorkflow
    ? resolveWorkItemEntryStep(draftWorkflow, draftWorkItem.taskType, activeCapability.lifecycle) ||
      draftWorkflow.steps[0]
    : null;
  const draftFirstAgent = draftFirstStep
    ? agentsById.get(draftFirstStep.agentId) || null
    : null;
  const draftTaskTypeEntryPhase = getWorkItemTaskTypeEntryPhase(draftWorkItem.taskType);
  const draftPhaseStakeholderAssignments = useMemo(
    () =>
      normalizeWorkItemPhaseStakeholders(
        draftWorkItem.phaseStakeholders,
        activeCapability.lifecycle,
      ),
    [activeCapability.lifecycle, draftWorkItem.phaseStakeholders],
  );
  const selectedPhaseStakeholderAssignments = useMemo(
    () =>
      normalizeWorkItemPhaseStakeholders(
        selectedWorkItem?.phaseStakeholders,
        activeCapability.lifecycle,
      ),
    [activeCapability.lifecycle, selectedWorkItem?.phaseStakeholders],
  );
  const selectedCurrentPhaseStakeholders = useMemo(
    () => getWorkItemPhaseStakeholders(selectedWorkItem, selectedWorkItem?.phase),
    [selectedWorkItem],
  );

  const sanitizeDraftPhaseStakeholderAssignments = useCallback(
    (assignments: WorkItemPhaseStakeholderAssignment[]) => {
      const seen = new Set<string>();

      return assignments
        .map(assignment => {
          const phaseId = String(assignment.phaseId || '').trim().toUpperCase();
          if (!phaseId || seen.has(phaseId) || !visibleLifecyclePhaseIds.has(phaseId)) {
            return null;
          }
          seen.add(phaseId);
          return {
            phaseId,
            stakeholders: assignment.stakeholders.map(stakeholder => ({
              role: stakeholder.role || 'Stakeholder',
              name: stakeholder.name || '',
              email: stakeholder.email || '',
              teamName: stakeholder.teamName || '',
            })),
          } satisfies WorkItemPhaseStakeholderAssignment;
        })
        .filter(Boolean) as WorkItemPhaseStakeholderAssignment[];
    },
    [visibleLifecyclePhaseIds],
  );

  const getDraftPhaseStakeholders = useCallback(
    (phaseId: string) =>
      draftWorkItem.phaseStakeholders.find(assignment => assignment.phaseId === phaseId)
        ?.stakeholders || [],
    [draftWorkItem.phaseStakeholders],
  );

  const updateDraftPhaseStakeholders = useCallback(
    (
      phaseId: string,
      mutator: (
        current: ReturnType<typeof getWorkItemPhaseStakeholders>,
      ) => ReturnType<typeof getWorkItemPhaseStakeholders>,
    ) => {
      setDraftWorkItem(current => {
        const existing = sanitizeDraftPhaseStakeholderAssignments(current.phaseStakeholders);
        const currentStakeholders =
          existing.find(assignment => assignment.phaseId === phaseId)?.stakeholders || [];
        const nextStakeholders = mutator(currentStakeholders);
        const nextAssignments = [
          ...existing.filter(assignment => assignment.phaseId !== phaseId),
          ...(nextStakeholders.length > 0
            ? [{ phaseId, stakeholders: nextStakeholders }]
            : []),
        ];

        return {
          ...current,
          phaseStakeholders: sanitizeDraftPhaseStakeholderAssignments(nextAssignments),
        };
      });
    },
    [sanitizeDraftPhaseStakeholderAssignments],
  );

  const addDraftPhaseStakeholder = useCallback(
    (phaseId: string, seededStakeholder?: CapabilityStakeholder) => {
      updateDraftPhaseStakeholders(phaseId, currentStakeholders => [
        ...currentStakeholders,
        seededStakeholder
          ? toDraftPhaseStakeholder(seededStakeholder)
          : createEmptyWorkItemPhaseStakeholder(),
      ]);
    },
    [updateDraftPhaseStakeholders],
  );

  const updateDraftPhaseStakeholderField = useCallback(
    (
      phaseId: string,
      index: number,
      field: 'role' | 'name' | 'email' | 'teamName',
      value: string,
    ) => {
      updateDraftPhaseStakeholders(phaseId, currentStakeholders =>
        currentStakeholders.map((stakeholder, stakeholderIndex) =>
          stakeholderIndex === index ? { ...stakeholder, [field]: value } : stakeholder,
        ),
      );
    },
    [updateDraftPhaseStakeholders],
  );

  const removeDraftPhaseStakeholder = useCallback(
    (phaseId: string, index: number) => {
      updateDraftPhaseStakeholders(phaseId, currentStakeholders =>
        currentStakeholders.filter((_, stakeholderIndex) => stakeholderIndex !== index),
      );
    },
    [updateDraftPhaseStakeholders],
  );

  const applyCapabilityStakeholdersToPhase = useCallback(
    (phaseId: string) => {
      if (activeCapability.stakeholders.length === 0) {
        addDraftPhaseStakeholder(phaseId);
        return;
      }

      updateDraftPhaseStakeholders(
        phaseId,
        () => activeCapability.stakeholders.map(stakeholder => toDraftPhaseStakeholder(stakeholder)),
      );
    },
    [activeCapability.stakeholders, addDraftPhaseStakeholder, updateDraftPhaseStakeholders],
  );

  const handleDraftAttachmentUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) {
        return;
      }

      const uploadedFiles = await Promise.all(
        Array.from(files).map(async file => {
          const rawText = await file.text();
          const trimmed = rawText.trim();
          if (!trimmed) {
            return null;
          }

          const truncated =
            trimmed.length > MAX_WORK_ITEM_ATTACHMENT_BYTES
              ? `${trimmed.slice(0, MAX_WORK_ITEM_ATTACHMENT_BYTES)}\n\n[Truncated after ${MAX_WORK_ITEM_ATTACHMENT_BYTES} characters for work-item staging.]`
              : trimmed;

          return {
            fileName: file.name,
            mimeType: file.type || 'text/plain',
            contentText: truncated,
            sizeBytes: file.size,
          } satisfies WorkItemAttachmentUpload;
        }),
      );

      const nextFiles = uploadedFiles.filter(Boolean) as WorkItemAttachmentUpload[];
      if (nextFiles.length === 0) {
        return;
      }

      setDraftWorkItem(current => ({
        ...current,
        attachments: [...current.attachments, ...nextFiles],
      }));
    },
    [],
  );

  const removeDraftAttachment = useCallback((index: number) => {
    setDraftWorkItem(current => ({
      ...current,
      attachments: current.attachments.filter((_, attachmentIndex) => attachmentIndex !== index),
    }));
  }, []);

  const addDockUploadFiles = useCallback((files: FileList | File[] | null) => {
    if (!files) {
      return;
    }

    const incoming = Array.from(files);
    if (incoming.length === 0) {
      return;
    }

    const MAX_FILES = 5;
    const MAX_FILE_BYTES = 10 * 1024 * 1024;

    setDockUploads(current => {
      const availableSlots = Math.max(0, MAX_FILES - current.length);
      if (availableSlots === 0) {
        showError('Upload limit reached', `Only ${MAX_FILES} files can be attached at once.`);
        return current;
      }

      const next = [...current];
      incoming.slice(0, availableSlots).forEach(file => {
        if (file.size > MAX_FILE_BYTES) {
          showError('File too large', `${file.name} exceeds 10MB and was skipped.`);
          return;
        }

        const id = `dock-upload-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        const isImage = file.type.startsWith('image/');
        const previewUrl = isImage ? URL.createObjectURL(file) : undefined;

        next.push({
          id,
          file,
          previewUrl,
          kind: isImage ? 'image' : 'file',
        });
      });

      return next;
    });
  }, [showError]);

  const removeDockUpload = useCallback((id: string) => {
    setDockUploads(current => {
      const target = current.find(item => item.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter(item => item.id !== id);
    });
  }, []);

  const clearDockUploads = useCallback(() => {
    setDockUploads(current => {
      current.forEach(item => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
      return [];
    });
  }, []);

  useEffect(() => {
    setDraftWorkItem(current => ({
      ...current,
      phaseStakeholders: sanitizeDraftPhaseStakeholderAssignments(
        current.phaseStakeholders,
      ),
    }));
  }, [sanitizeDraftPhaseStakeholderAssignments]);

  async function withAction(
    label: string,
    action: () => Promise<void>,
    successMessage?: { title: string; description?: string },
  ) {
    setBusyAction(label);
    setActionError('');
    try {
      await action();
      if (successMessage) {
        success(successMessage.title, successMessage.description);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'The orchestration action failed.';
      setActionError(message);
      showError('Action failed', message);
    } finally {
      setBusyAction(null);
    }
  }

	  const handleApproveWorkspacePath = async (options?: { unblock?: boolean }) => {
	    const requestedPath = approvedWorkspaceDraft.trim();
	    if (!requestedPath) {
	      showError(
	        'Workspace path required',
	        'Paste a local directory path to approve it for this capability.',
	      );
	      return;
	    }

	    if (
	      options?.unblock &&
	      !requirePermission(
        canControlWorkItems,
        'This operator cannot unblock workflow waits for the selected run.',
      )
    ) {
      return;
    }

    await withAction(
      'approveWorkspacePath',
      async () => {
        const validation = await validateOnboardingWorkspacePath({ path: requestedPath });
        setApprovedWorkspaceValidation(validation);

        if (!validation.valid || !validation.normalizedPath) {
          throw new Error(validation.message || 'Workspace path could not be validated.');
	        }

	        const normalizedPath = validation.normalizedPath;
	        const alreadyApproved = approvedWorkspaceRoots.some(root => {
	          if (!root) {
	            return false;
	          }
	          if (normalizedPath === root) {
	            return true;
	          }
	          return normalizedPath.startsWith(`${root}/`);
	        });

	        if (!alreadyApproved) {
	          if (
	            !requirePermission(
	              canEditCapability,
	              'This operator cannot update capability execution policy. Switch Current Operator to a role with capability edit rights (for example Workspace Operator).',
	            )
	          ) {
	            throw new Error('Permission required to approve additional workspace paths.');
	          }

	          const nextAllowedPaths = Array.from(
	            new Set([
	              ...(activeCapability.executionConfig.allowedWorkspacePaths || []),
	              normalizedPath,
	            ]),
	          );
	          const nextDefaultWorkspacePath =
	            activeCapability.executionConfig.defaultWorkspacePath?.trim() ||
	            normalizedPath;

	          await updateCapabilityMetadata(activeCapability.id, {
	            executionConfig: {
	              ...activeCapability.executionConfig,
	              defaultWorkspacePath: nextDefaultWorkspacePath,
	              allowedWorkspacePaths: nextAllowedPaths,
	            },
	          });
	        }

	        setApprovedWorkspaceDraft(normalizedPath);
	        setResolutionNote(current =>
	          current.trim() ? current : `Approved workspace path: ${normalizedPath}`,
	        );

        if (options?.unblock && currentRun && selectedOpenWait?.type === 'INPUT' && selectedWorkItem) {
          await provideCapabilityWorkflowRunInput(activeCapability.id, currentRun.id, {
            resolution: `Approved workspace path: ${normalizedPath}`,
            resolvedBy: currentActorContext.displayName,
          });
          setResolutionNote('');
          await refreshSelection(selectedWorkItem.id);
          return;
        }

        await refreshCapabilityBundle(activeCapability.id);
      },
      {
        title: options?.unblock ? 'Workspace path approved and run resumed' : 'Workspace path approved',
        description: `${requestedPath} is now available for tool execution inside ${activeCapability.name}.`,
      },
    );
  };

  const handleClaimControl = async () => {
    if (
      !selectedWorkItem ||
      !requirePermission(canControlWorkItems, 'This operator cannot claim work-item control.')
    ) {
      return;
    }

    await withAction(
      'claimControl',
      async () => {
        const result = await claimCapabilityWorkItemControl(
          activeCapability.id,
          selectedWorkItem.id,
        );
        setSelectedClaims(current =>
          [result.claim, ...current.filter(claim => claim.userId !== result.claim.userId)].slice(0, 5),
        );
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: 'Operator control claimed',
        description: `${currentActorContext.displayName} now holds active control for ${selectedWorkItem.title}.`,
      },
    );
  };

  const handleReleaseControl = async () => {
    if (
      !selectedWorkItem ||
      !requirePermission(canControlWorkItems, 'This operator cannot release work-item control.')
    ) {
      return;
    }

    await withAction(
      'releaseControl',
      async () => {
        await releaseCapabilityWorkItemControl(activeCapability.id, selectedWorkItem.id);
        setSelectedClaims([]);
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: 'Operator control released',
        description: `${selectedWorkItem.title} is available for another team member to take over.`,
      },
    );
  };

  const handleClaimDesktopExecution = async (forceTakeover = false) => {
    if (
      !requirePermission(
        canClaimExecution,
        'This operator cannot claim desktop execution for the selected capability.',
      )
    ) {
      return;
    }

    setExecutionClaimBusy(true);
    try {
      const result = await claimCapabilityExecution({
        capabilityId: activeCapability.id,
        forceTakeover,
      });
      await refreshCapabilityBundle(activeCapability.id);
      success(
        forceTakeover ? 'Desktop execution taken over' : 'Desktop execution claimed',
        `${result.ownership.actorDisplayName} now owns automated execution for ${activeCapability.name}.`,
      );
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to claim desktop execution.');
    } finally {
      setExecutionClaimBusy(false);
    }
  };

  const handleReleaseDesktopExecution = async () => {
    if (
      !requirePermission(
        canClaimExecution,
        'This operator cannot release desktop execution for the selected capability.',
      )
    ) {
      return;
    }

    setExecutionClaimBusy(true);
    try {
      await releaseCapabilityExecution({
        capabilityId: activeCapability.id,
      });
      await refreshCapabilityBundle(activeCapability.id);
      success(
        'Desktop execution released',
        `${activeCapability.name} is now waiting for a desktop executor to claim it.`,
      );
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to release desktop execution.');
    } finally {
      setExecutionClaimBusy(false);
    }
  };

  const handleInitializeExecutionContext = async () => {
    if (
      !selectedWorkItem ||
      !requirePermission(
        canControlWorkItems,
        'This operator cannot initialize execution context for the selected work item.',
      )
    ) {
      return;
    }

    await withAction(
      'initExecutionContext',
      async () => {
        const context = await initializeCapabilityWorkItemExecutionContext(
          activeCapability.id,
          selectedWorkItem.id,
        );
        setSelectedExecutionContext(context);
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: 'Execution context prepared',
        description: `${selectedWorkItem.title} now has a shared repository and branch context.`,
      },
    );
  };

  const handleCreateSharedBranch = async () => {
    if (
      !selectedWorkItem ||
      !requirePermission(
        canControlWorkItems,
        'This operator cannot create or reopen the shared work-item branch.',
      )
    ) {
      return;
    }

    await withAction(
      'createSharedBranch',
      async () => {
        const result = await createCapabilityWorkItemSharedBranch(
          activeCapability.id,
          selectedWorkItem.id,
        );
        setSelectedExecutionContext(result.context);
        if (currentActorContext.userId) {
          setSelectedPresence(current =>
            current.some(entry => entry.userId === currentActorContext.userId)
              ? current
              : [
                  {
                    capabilityId: activeCapability.id,
                    workItemId: selectedWorkItem.id,
                    userId: currentActorContext.userId,
                    teamId: currentActorContext.teamIds[0],
                    viewContext: 'WORKBENCH',
                    lastSeenAt: new Date().toISOString(),
                  },
                  ...current,
                ],
          );
        }
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: 'Shared branch ready',
        description: `${selectedWorkItem.title} can now be worked from the shared branch ${
          selectedSharedBranch?.sharedBranch || 'context'
        }.`,
      },
    );
  };

  const handleClaimWriteControl = async () => {
    if (
      !selectedWorkItem ||
      !requirePermission(canControlWorkItems, 'This operator cannot claim write control.')
    ) {
      return;
    }

    await withAction(
      'claimWriteControl',
      async () => {
        const result = await claimCapabilityWorkItemWriteControl(
          activeCapability.id,
          selectedWorkItem.id,
        );
        setSelectedExecutionContext(result.context);
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: 'Write control claimed',
        description: `${currentActorContext.displayName} is now the active writer for ${selectedWorkItem.title}.`,
      },
    );
  };

  const handleReleaseWriteControl = async () => {
    if (
      !selectedWorkItem ||
      !requirePermission(canControlWorkItems, 'This operator cannot release write control.')
    ) {
      return;
    }

    await withAction(
      'releaseWriteControl',
      async () => {
        await releaseCapabilityWorkItemWriteControl(
          activeCapability.id,
          selectedWorkItem.id,
        );
        setSelectedExecutionContext(current =>
          current
            ? {
                ...current,
                activeWriterUserId: undefined,
                claimExpiresAt: undefined,
              }
            : current,
        );
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: 'Write control released',
        description: `${selectedWorkItem.title} is ready for another stakeholder to take over the shared branch.`,
      },
    );
  };

  const handleCreateHandoff = async () => {
    if (
      !selectedWorkItem ||
      !resolutionNote.trim() ||
      !requirePermission(canControlWorkItems, 'This operator cannot capture a handoff packet.')
    ) {
      return;
    }

    await withAction(
      'createHandoff',
      async () => {
        const packet = await createCapabilityWorkItemHandoff(
          activeCapability.id,
          selectedWorkItem.id,
          {
            fromUserId: currentActorContext.userId,
            toUserId: undefined,
            fromTeamId: currentActorContext.teamIds[0],
            toTeamId: selectedWorkItem.phaseOwnerTeamId,
            summary: resolutionNote.trim(),
            openQuestions: [],
            blockingDependencies: [],
            recommendedNextStep: selectedNextActionSummary,
            artifactIds: selectedWorkItemArtifacts.slice(0, 5).map(artifact => artifact.id),
            traceIds: selectedRunRecord?.traceId ? [selectedRunRecord.traceId] : [],
          },
        );
        setSelectedHandoffs(current => [packet, ...current]);
        setResolutionNote('');
      },
      {
        title: 'Handoff packet captured',
        description: `The shared branch context and next steps are now attached to ${selectedWorkItem.title}.`,
      },
    );
  };

  const handleAcceptLatestHandoff = async () => {
    if (
      !selectedWorkItem ||
      !latestSelectedHandoff ||
      !requirePermission(canControlWorkItems, 'This operator cannot accept the latest handoff.')
    ) {
      return;
    }

    await withAction(
      'acceptHandoff',
      async () => {
        const result = await acceptCapabilityWorkItemHandoff(
          activeCapability.id,
          selectedWorkItem.id,
          latestSelectedHandoff.id,
        );
        setSelectedExecutionContext(result.context);
        setSelectedHandoffs(current =>
          current.map(packet =>
            packet.id === result.packet.id ? result.packet : packet,
          ),
        );
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: 'Handoff accepted',
        description: `${currentActorContext.displayName} accepted the latest shared-branch handoff for ${selectedWorkItem.title}.`,
      },
    );
  };

  const handleCreateWorkItem = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !draftWorkItem.title.trim() ||
      !draftWorkItem.workflowId ||
      !requirePermission(canCreateWorkItems, 'This operator cannot create work items.')
    ) {
      return;
    }

    await withAction(
      'create',
      async () => {
        const nextItem = await createCapabilityWorkItem(activeCapability.id, {
          title: draftWorkItem.title.trim(),
          description: draftWorkItem.description.trim() || undefined,
          workflowId: draftWorkItem.workflowId,
          taskType: draftWorkItem.taskType,
          phaseStakeholders: draftPhaseStakeholderAssignments,
          attachments: draftWorkItem.attachments,
          priority: draftWorkItem.priority,
          tags: draftWorkItem.tags
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean),
        });

        await refreshSelection(nextItem.id);
        setSelectedWorkItemId(nextItem.id);
        setIsCreateSheetOpen(false);
        setDetailTab('operate');
        setDraftWorkItem({
          title: '',
          description: '',
          workflowId: workspace.workflows[0]?.id || '',
          taskType: DEFAULT_WORK_ITEM_TASK_TYPE,
          phaseStakeholders: [],
          attachments: [],
          priority: 'Med',
          tags: '',
        });
      },
      {
        title: 'Work item created',
        description: `${draftWorkItem.title.trim()} is now staged in ${activeCapability.name}.`,
      },
    );
  };

  const handleStartExecution = async () => {
    if (
      !selectedWorkItem ||
      !requirePermission(canControlWorkItems, 'This operator cannot start workflow execution.')
    ) {
      return;
    }

    if (deliveryBlockingItem) {
      setActionError(
        deliveryBlockingItem.nextRequiredAction ||
          deliveryBlockingItem.blockingReason ||
          deliveryBlockingItem.description,
      );
      return;
    }

    await withAction(
      'start',
      async () => {
        await startCapabilityWorkflowRun(activeCapability.id, selectedWorkItem.id);
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: 'Execution started',
        description: `${selectedWorkItem.title} is now running through the workflow.`,
      },
    );
  };

  const handleRestartExecution = async () => {
    if (
      !selectedWorkItem ||
      !requirePermission(canRestartWorkItems, 'This operator cannot restart workflow execution.')
    ) {
      return;
    }

    const restartRunId = currentRunId;
    if (!restartRunId) {
      return;
    }

    if (deliveryBlockingItem) {
      setActionError(
        deliveryBlockingItem.nextRequiredAction ||
          deliveryBlockingItem.blockingReason ||
          deliveryBlockingItem.description,
      );
      return;
    }

    await withAction(
      'restart',
      async () => {
        let restartRun = currentRun;
        if (!restartRun || restartRun.id !== restartRunId) {
          const detail = await fetchCapabilityWorkflowRun(activeCapability.id, restartRunId);
          restartRun = detail.run;
          setSelectedRunDetail(detail);
        }

        if (restartRun && ACTIVE_RUN_STATUSES.includes(restartRun.status)) {
          await cancelCapabilityWorkflowRun(activeCapability.id, restartRun.id, {
            note: `Run cancelled so ${selectedWorkItem.title} can restart from ${getPhaseMeta(selectedWorkItem.phase).label}.`,
          });
        }

        await restartCapabilityWorkflowRun(activeCapability.id, restartRunId, {
          restartFromPhase: selectedWorkItem.phase,
        });
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: 'Phase restarted',
        description: `${selectedWorkItem.title} restarted from ${getPhaseMeta(selectedWorkItem.phase).label}.`,
      },
    );
  };

  const handleResetAndRestart = async () => {
    if (
      !selectedWorkItem ||
      !requirePermission(
        canRestartWorkItems,
        'This operator cannot reset and restart the selected work item.',
      )
    ) {
      return;
    }

    if (deliveryBlockingItem) {
      setActionError(
        deliveryBlockingItem.nextRequiredAction ||
          deliveryBlockingItem.blockingReason ||
          deliveryBlockingItem.description,
      );
      return;
    }

    const resetPhase = selectedResetPhase;
    const resetPhaseLabel = getPhaseMeta(resetPhase).label;

    await withAction(
      'reset',
      async () => {
        if (currentRun && currentRunIsActive) {
          await cancelCapabilityWorkflowRun(activeCapability.id, currentRun.id, {
            note:
              resolutionNote.trim() ||
              `Run cancelled so ${selectedWorkItem.title} can be reset to ${resetPhaseLabel} and restarted.`,
          });
        }

        if (selectedWorkItem.phase !== resetPhase) {
          await moveCapabilityWorkItem(activeCapability.id, selectedWorkItem.id, {
            targetPhase: resetPhase,
            note: `Work item reset to ${resetPhaseLabel} before restart.`,
          });
        }

        if (currentRun) {
          await restartCapabilityWorkflowRun(activeCapability.id, currentRun.id, {
            restartFromPhase: resetPhase,
          });
        } else {
          await startCapabilityWorkflowRun(activeCapability.id, selectedWorkItem.id, {
            restartFromPhase: resetPhase,
          });
        }

        setResolutionNote('');
        setDetailTab('attempts');
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: 'Progress reset and restarted',
        description: `${selectedWorkItem.title} was reset to ${resetPhaseLabel} and relaunched from the beginning of the workflow path.`,
      },
    );
  };

  const handleResolveWait = async () => {
    if (!currentRun || !selectedOpenWait || !selectedWorkItem) {
      return;
    }

    if (
      selectedOpenWait.type === 'INPUT' &&
      waitRequiresApprovedWorkspace &&
      !hasApprovedWorkspaceConfigured
    ) {
      selectionFocusRef.current = 'INPUT';
      setDetailTab('operate');
      showError(
        'Approved workspace required',
        'This run cannot continue until at least one approved workspace path is configured for the active capability.',
      );
      return;
    }

    if (
      !requirePermission(
        selectedOpenWait.type === 'APPROVAL' ? canDecideApprovals : canControlWorkItems,
        selectedOpenWait.type === 'APPROVAL'
          ? 'This operator cannot decide approval waits for the selected run.'
          : 'This operator cannot resolve workflow waits for the selected run.',
      )
    ) {
      return;
    }

	    const trimmedResolutionNote = resolutionNote.trim();
	    const fallbackResolution =
	      waitOnlyRequestsApprovedWorkspace && preferredApprovedWorkspaceRoot
	        ? `Approved workspace path: ${preferredApprovedWorkspaceRoot}`
	        : actionButtonLabel;
	    const resolution = trimmedResolutionNote || fallbackResolution;

    await withAction(
      'resolve',
      async () => {
        if (selectedOpenWait.type === 'APPROVAL') {
          await approveCapabilityWorkflowRun(activeCapability.id, currentRun.id, {
            resolution,
            resolvedBy: currentActorContext.displayName,
          });
          setIsDiffReviewOpen(false);
          setIsApprovalReviewOpen(false);
          setIsApprovalReviewHydrated(false);
        } else if (selectedOpenWait.type === 'INPUT') {
          await provideCapabilityWorkflowRunInput(activeCapability.id, currentRun.id, {
            resolution,
            resolvedBy: currentActorContext.displayName,
          });
        } else {
          await resolveCapabilityWorkflowRunConflict(activeCapability.id, currentRun.id, {
            resolution,
            resolvedBy: currentActorContext.displayName,
          });
        }

        setResolutionNote('');
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title:
          selectedOpenWait.type === 'APPROVAL'
            ? 'Approval submitted'
            : selectedOpenWait.type === 'INPUT'
              ? 'Input submitted'
              : 'Conflict resolved',
        description: `${selectedWorkItem.title} was updated and can continue through the workflow.`,
      },
    );
  };

  const uploadDockFilesIfNeeded = async (): Promise<Artifact[]> => {
    if (!selectedWorkItem || dockUploads.length === 0) {
      return [];
    }

    const uploadedArtifacts = await uploadCapabilityWorkItemFiles(
      activeCapability.id,
      selectedWorkItem.id,
      dockUploads.map(item => item.file),
    );

    clearDockUploads();

    if (uploadedArtifacts.length > 0) {
      success(
        'Files uploaded',
        `${uploadedArtifacts.length} file${uploadedArtifacts.length === 1 ? '' : 's'} attached to ${selectedWorkItem.id}.`,
      );
    }

    await refreshCapabilityBundle(activeCapability.id);
    return uploadedArtifacts;
  };

  const handleDockResolveWait = async () => {
    if (!currentRun || !selectedOpenWait || !selectedWorkItem) {
      return;
    }

    if (selectedOpenWait.type === 'APPROVAL') {
      handleOpenApprovalReview();
      return;
    }

    if (
      selectedOpenWait.type === 'INPUT' &&
      waitRequiresApprovedWorkspace &&
      !hasApprovedWorkspaceConfigured
    ) {
      showError(
        'Approved workspace required',
        'Approve at least one workspace path before submitting input for this wait.',
      );
      return;
    }

	    const trimmedDockInput = dockInput.trim();
	    const fallbackApprovedWorkspaceRoot =
	      approvedWorkspaceDraft.trim() || preferredApprovedWorkspaceRoot;
	    const fallbackResolution =
	      waitOnlyRequestsApprovedWorkspace && fallbackApprovedWorkspaceRoot
	        ? `Approved workspace path: ${fallbackApprovedWorkspaceRoot}`
	        : actionButtonLabel;
	    const resolution = trimmedDockInput || fallbackResolution;
	    const resolutionRequired =
	      selectedOpenWait.type === 'INPUT' || selectedOpenWait.type === 'CONFLICT_RESOLUTION';

    if (resolutionRequired && !dockInput.trim() && !waitOnlyRequestsApprovedWorkspace) {
      setActionError('Add the missing details before unblocking this workflow stage.');
      return;
    }

    await withAction(
      'dockResolveWait',
      async () => {
        await uploadDockFilesIfNeeded();

        if (selectedOpenWait.type === 'APPROVAL') {
          await approveCapabilityWorkflowRun(activeCapability.id, currentRun.id, {
            resolution,
            resolvedBy: currentActorContext.displayName,
          });
          setIsDiffReviewOpen(false);
          setIsApprovalReviewOpen(false);
          setIsApprovalReviewHydrated(false);
        } else if (selectedOpenWait.type === 'INPUT') {
          await provideCapabilityWorkflowRunInput(activeCapability.id, currentRun.id, {
            resolution,
            resolvedBy: currentActorContext.displayName,
          });
        } else {
          await resolveCapabilityWorkflowRunConflict(activeCapability.id, currentRun.id, {
            resolution,
            resolvedBy: currentActorContext.displayName,
          });
        }

        setDockInput('');
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title:
          selectedOpenWait.type === 'APPROVAL'
            ? 'Approval submitted'
            : selectedOpenWait.type === 'INPUT'
              ? 'Input submitted'
              : 'Conflict resolved',
        description: `${selectedWorkItem.title} can continue through the workflow.`,
      },
    );
  };

  const handleDockStartExecution = async () => {
    if (
      !selectedWorkItem ||
      !canStartExecution ||
      !requirePermission(
        canControlWorkItems,
        'This operator cannot start workflow execution from the dock.',
      )
    ) {
      return;
    }

    if (deliveryBlockingItem) {
      const message =
        deliveryBlockingItem.nextRequiredAction ||
        deliveryBlockingItem.blockingReason ||
        deliveryBlockingItem.description;
      setDockError(message);
      setActionError(message);
      return;
    }

    const guidance = dockInput.trim() || undefined;

    await withAction(
      'dockStartExecution',
      async () => {
        await uploadDockFilesIfNeeded();
        await startCapabilityWorkflowRun(activeCapability.id, selectedWorkItem.id, {
          guidance,
          guidedBy: currentActorContext.displayName,
        });
        setDockInput('');
        setDockError('');
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: 'Execution started from dock',
        description: guidance
          ? `${selectedWorkItem.title} started with your kickoff guidance attached to the run.`
          : `${selectedWorkItem.title} is now running through the workflow from the dock.`,
      },
    );
  };

  const handleDockGuideAndRestart = async () => {
    if (
      !selectedWorkItem ||
      !selectedCanGuideBlockedAgent ||
      !requirePermission(
        canRestartWorkItems,
        'This operator cannot guide and restart blocked work from the dock.',
      )
    ) {
      return;
    }

    const guidance = dockInput.trim();
    if (!guidance) {
      const message = 'Add clear operator guidance before restarting the blocked work item.';
      setDockError(message);
      setActionError(message);
      return;
    }

    await withAction(
      'dockGuideRestart',
      async () => {
        await uploadDockFilesIfNeeded();

        if (currentRun) {
          await restartCapabilityWorkflowRun(activeCapability.id, currentRun.id, {
            restartFromPhase: selectedWorkItem.phase,
            guidance,
            guidedBy: currentActorContext.displayName,
          });
        } else {
          await startCapabilityWorkflowRun(activeCapability.id, selectedWorkItem.id, {
            restartFromPhase: selectedWorkItem.phase,
            guidance,
            guidedBy: currentActorContext.displayName,
          });
        }

        setDockInput('');
        setDockError('');
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: 'Blocked work restarted from dock',
        description: `${selectedWorkItem.title} restarted from ${getPhaseMeta(selectedWorkItem.phase).label} with your guidance attached to the next attempt.`,
      },
    );
  };

  const handleDockAskAgent = async () => {
    if (!selectedWorkItem) {
      return;
    }

    if (selectedOpenWait?.type === 'INPUT' || selectedOpenWait?.type === 'CONFLICT_RESOLUTION') {
      await handleDockResolveWait();
      return;
    }

    if (selectedCanGuideBlockedAgent) {
      await handleDockGuideAndRestart();
      return;
    }

    const requestedMessage = dockInput.trim();
    if (!requestedMessage && dockUploads.length === 0) {
      return;
    }

    if (
      !requirePermission(
        canWriteChat,
        'This operator cannot send chat messages for the selected capability.',
      )
    ) {
      return;
    }

    if (!runtimeReady) {
      setDockError(
        runtimeError ||
          'Runtime is not configured yet. Fix the Copilot connection before sending chat.',
      );
      return;
    }

    const agentForChat =
      selectedAgent ||
      (workspace.primaryCopilotAgentId
        ? agentsById.get(workspace.primaryCopilotAgentId) || null
        : null) ||
      (workspace.activeChatAgentId
        ? agentsById.get(workspace.activeChatAgentId) || null
        : null) ||
      workspace.agents.find(agent => agent.isOwner) ||
      workspace.agents[0] ||
      null;

    if (!agentForChat) {
      setDockError('No chat agent is available for this capability.');
      return;
    }

    const userMessageId = `${Date.now()}-dock-user`;
    const userTimestamp = formatTimestamp();

    setDockError('');
    setDockDraft('');
    setIsDockSending(true);

    const requestToken = ++dockRequestRef.current;

    try {
      const uploadedArtifacts =
        dockUploads.length > 0 ? await uploadDockFilesIfNeeded() : [];

      const attachmentLine =
        uploadedArtifacts.length > 0
          ? `\n\nAttachments:\n${uploadedArtifacts
              .map(artifact => `- ${artifact.fileName || artifact.name} (${artifact.id})`)
              .join('\n')}`
          : '';
      const messageContent =
        requestedMessage ||
        (uploadedArtifacts.length > 0
          ? `Uploaded ${uploadedArtifacts.length} file${uploadedArtifacts.length === 1 ? '' : 's'} for ${selectedWorkItem.id}.${attachmentLine}`
          : '');

      const threadHistory = workspace.messages
        .filter(message => message.workItemId === selectedWorkItem.id)
        .slice(-10);
      const historyForRequest = [
        ...threadHistory,
        {
          id: userMessageId,
          capabilityId: activeCapability.id,
          role: 'user' as const,
          content: messageContent,
          timestamp: userTimestamp,
          workItemId: selectedWorkItem.id,
          runId: currentRun?.id,
          workflowStepId: selectedCurrentStep?.id,
        },
      ];

      await appendCapabilityMessageRecord(activeCapability.id, {
        id: userMessageId,
        role: 'user',
        content: messageContent,
        timestamp: userTimestamp,
        sessionScope: 'WORK_ITEM',
        sessionScopeId: selectedWorkItem.id,
        workItemId: selectedWorkItem.id,
        runId: currentRun?.id,
        workflowStepId: selectedCurrentStep?.id,
      });

      const streamResult = await streamCapabilityChat(
        {
          capability: activeCapability,
          agent: agentForChat,
          history: historyForRequest,
          message: messageContent,
          sessionScope: 'WORK_ITEM',
          sessionScopeId: selectedWorkItem.id,
          contextMode: 'WORK_ITEM_STAGE',
          workItemId: selectedWorkItem.id,
          runId: currentRun?.id,
          workflowStepId: selectedCurrentStep?.id,
        },
        {
          onEvent: streamEvent => {
            if (dockRequestRef.current !== requestToken) {
              return;
            }

            if (streamEvent.type === 'delta' && streamEvent.content) {
              setDockDraft(current => current + streamEvent.content);
            }

            if (streamEvent.type === 'error' && streamEvent.error) {
              setDockError(streamEvent.error);
            }
          },
        },
      );

      if (dockRequestRef.current !== requestToken) {
        return;
      }

      const assistantContent =
        streamResult.completeEvent?.content || streamResult.draftContent;

      if (!assistantContent.trim()) {
        throw new Error(streamResult.error || 'The agent did not return a response.');
      }

      await appendCapabilityMessageRecord(activeCapability.id, {
        id: `${Date.now()}-dock-agent`,
        role: 'agent',
        content: assistantContent,
        timestamp: formatTimestamp(
          streamResult.completeEvent?.createdAt
            ? new Date(streamResult.completeEvent.createdAt)
            : new Date(),
        ),
        agentId: agentForChat.id,
        agentName: agentForChat.name,
        traceId: streamResult.completeEvent?.traceId,
        model: streamResult.completeEvent?.model || agentForChat.model,
        sessionId: streamResult.completeEvent?.sessionId,
        sessionScope: streamResult.completeEvent?.sessionScope,
        sessionScopeId: streamResult.completeEvent?.sessionScopeId,
        workItemId: selectedWorkItem.id,
        runId: currentRun?.id,
        workflowStepId: selectedCurrentStep?.id,
      });

      setDockDraft('');
      setDockInput('');
      await refreshCapabilityBundle(activeCapability.id);
    } catch (error) {
      if (dockRequestRef.current !== requestToken) {
        return;
      }

      setDockDraft('');
      setDockError(
        error instanceof Error
          ? error.message
          : 'The agent could not complete this request.',
      );
    } finally {
      if (dockRequestRef.current === requestToken) {
        setIsDockSending(false);
      }
    }
  };

  const handleRequestChanges = async () => {
    if (
      !currentRun ||
      !selectedWorkItem ||
      !selectedHasCodeDiffApproval ||
      !requirePermission(canDecideApprovals, 'This operator cannot request changes on approvals.')
    ) {
      return;
    }

    const resolution = resolutionNote.trim();
    if (!resolution) {
      setActionError('Add review notes before requesting changes from the developer step.');
      return;
    }

    await withAction(
      'requestChanges',
      async () => {
        await requestCapabilityWorkflowRunChanges(activeCapability.id, currentRun.id, {
          resolution,
          resolvedBy: currentActorContext.displayName,
        });
        setResolutionNote('');
        setIsDiffReviewOpen(false);
        setIsApprovalReviewOpen(false);
        setIsApprovalReviewHydrated(false);
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: 'Changes requested',
        description: `${selectedWorkItem.title} was sent back to the developer step with your review notes.`,
      },
    );
  };

  const handleGuideAndRestart = async () => {
    if (
      !selectedWorkItem ||
      !selectedCanGuideBlockedAgent ||
      !requirePermission(
        canRestartWorkItems,
        'This operator cannot guide and restart blocked work items.',
      )
    ) {
      return;
    }

    const guidance = resolutionNote.trim();
    if (!guidance) {
      setActionError('Add clear operator guidance before restarting the blocked work item.');
      return;
    }

    await withAction(
      'guideRestart',
      async () => {
        if (currentRun) {
          await restartCapabilityWorkflowRun(activeCapability.id, currentRun.id, {
            restartFromPhase: selectedWorkItem.phase,
            guidance,
            guidedBy: currentActorContext.displayName,
          });
        } else {
          await startCapabilityWorkflowRun(activeCapability.id, selectedWorkItem.id, {
            restartFromPhase: selectedWorkItem.phase,
            guidance,
            guidedBy: currentActorContext.displayName,
          });
        }

        setResolutionNote('');
        setDetailTab('attempts');
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: 'Agent guided and restarted',
        description: `${selectedWorkItem.title} restarted from ${getPhaseMeta(selectedWorkItem.phase).label} with your guidance attached to the next attempt.`,
      },
    );
  };

  const handleCancelRun = async () => {
    if (
      !currentRun ||
      !selectedWorkItem ||
      !requirePermission(canControlWorkItems, 'This operator cannot cancel active runs.')
    ) {
      return;
    }

    await withAction(
      'cancel',
      async () => {
        await cancelCapabilityWorkflowRun(activeCapability.id, currentRun.id, {
          note: resolutionNote.trim() || 'Run cancelled from the control plane.',
        });
        setResolutionNote('');
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: 'Execution cancelled',
        description: `${selectedWorkItem.title} was stopped from the control plane.`,
      },
    );
  };

  const handlePauseRunById = async ({
    runId,
    workItemId,
    workItemTitle,
  }: {
    runId: string;
    workItemId?: string;
    workItemTitle?: string;
  }) => {
    if (!requirePermission(canControlWorkItems, 'This operator cannot pause runs.')) {
      return;
    }

    await withAction(
      `pause-${workItemId || runId}`,
      async () => {
        await pauseCapabilityWorkflowRun(activeCapability.id, runId, {
          note: resolutionNote.trim() || 'Execution paused from the inbox.',
        });
        setResolutionNote('');
        await refreshSelection(workItemId === selectedWorkItemId ? workItemId : undefined);
      },
      {
        title: 'Execution paused',
        description: workItemTitle ? `${workItemTitle} is paused.` : undefined,
      },
    );
  };

  const handleResumeRunById = async ({
    runId,
    workItemId,
    workItemTitle,
  }: {
    runId: string;
    workItemId?: string;
    workItemTitle?: string;
  }) => {
    if (!requirePermission(canControlWorkItems, 'This operator cannot resume runs.')) {
      return;
    }

    await withAction(
      `resume-${workItemId || runId}`,
      async () => {
        await resumeCapabilityWorkflowRun(activeCapability.id, runId, {
          note: resolutionNote.trim() || 'Execution resumed from the inbox.',
        });
        setResolutionNote('');
        await refreshSelection(workItemId === selectedWorkItemId ? workItemId : undefined);
      },
      {
        title: 'Execution resumed',
        description: workItemTitle ? `${workItemTitle} re-entered the queue.` : undefined,
      },
    );
  };

  const handleCancelWorkItem = async () => {
    if (
      !selectedWorkItem ||
      selectedWorkItem.status === 'COMPLETED' ||
      selectedWorkItem.status === 'CANCELLED' ||
      selectedWorkItem.status === 'ARCHIVED' ||
      !requirePermission(
        canControlWorkItems,
        'This operator cannot cancel work items in this capability.',
      )
    ) {
      return;
    }

    const note =
      cancelWorkItemNote.trim() ||
      resolutionNote.trim() ||
      'Work item reset to the initial state from the control plane.';
    const nextVisibleWorkItemId =
      filteredWorkItems.find(item => item.id !== selectedWorkItem.id && item.phase !== 'BACKLOG')
        ?.id || null;

    await withAction(
      'cancelWorkItem',
      async () => {
        const nextWorkItem = await cancelCapabilityWorkItem(activeCapability.id, selectedWorkItem.id, {
          note,
        });
        setWorkItemOverrides(current => ({
          ...current,
          [nextWorkItem.id]: nextWorkItem,
        }));
        setCancelWorkItemNote('');
        setResolutionNote('');
        setIsCancelWorkItemOpen(false);
        setQueueView('MY_QUEUE');
        if (nextVisibleWorkItemId) {
          setSelectedWorkItemId(nextVisibleWorkItemId);
        } else {
          clearSelectedWorkItem();
        }
        await refreshSelection(nextWorkItem.id).catch(() => undefined);
      },
      {
        title: 'Work item reset',
        description: `${selectedWorkItem.title} was reset to the initial state and is ready to start again.`,
      },
    );
  };

  const handleArchiveWorkItem = async () => {
    if (
      !selectedWorkItem ||
      selectedWorkItem.status === 'ARCHIVED' ||
      !requirePermission(
        canControlWorkItems,
        'This operator cannot delete (archive) work items in this capability.',
      )
    ) {
      return;
    }

    const note =
      archiveWorkItemNote.trim() ||
      resolutionNote.trim() ||
      'Work item archived from the control plane.';
    const nextVisibleWorkItemId =
      filteredWorkItems.find(item => item.id !== selectedWorkItem.id && item.status !== 'ARCHIVED')
        ?.id || null;

    await withAction(
      'archiveWorkItem',
      async () => {
        const nextWorkItem = await archiveCapabilityWorkItem(
          activeCapability.id,
          selectedWorkItem.id,
          { note },
        );
        setWorkItemOverrides(current => ({
          ...current,
          [nextWorkItem.id]: nextWorkItem,
        }));
        setArchiveWorkItemNote('');
        setResolutionNote('');
        setIsArchiveWorkItemOpen(false);
        if (nextVisibleWorkItemId) {
          setSelectedWorkItemId(nextVisibleWorkItemId);
        } else {
          clearSelectedWorkItem();
        }
        await refreshSelection(nextWorkItem.id).catch(() => undefined);
      },
      {
        title: 'Work item archived',
        description: `${selectedWorkItem.title} moved to the Archive and its run history was cleaned up.`,
      },
    );
  };

  const handleRestoreWorkItem = async () => {
    if (
      !selectedWorkItem ||
      selectedWorkItem.status !== 'ARCHIVED' ||
      !requirePermission(
        canControlWorkItems,
        'This operator cannot restore archived work items in this capability.',
      )
    ) {
      return;
    }

    const note =
      restoreWorkItemNote.trim() ||
      resolutionNote.trim() ||
      'Work item restored from the archive.';

    await withAction(
      'restoreWorkItem',
      async () => {
        const nextWorkItem = await restoreCapabilityWorkItem(
          activeCapability.id,
          selectedWorkItem.id,
          { note },
        );
        setWorkItemOverrides(current => ({
          ...current,
          [nextWorkItem.id]: nextWorkItem,
        }));
        setRestoreWorkItemNote('');
        setResolutionNote('');
        setIsRestoreWorkItemOpen(false);
        setQueueView('MY_QUEUE');
        await refreshSelection(nextWorkItem.id).catch(() => undefined);
      },
      {
        title: 'Work item restored',
        description: `${selectedWorkItem.title} was restored to its initial phase so execution can restart.`,
      },
    );
  };

  const handleMoveWorkItem = async (
    workItemId: string,
    targetPhase: WorkItemPhase,
    options?: { cancelRunIfPresent?: boolean; note?: string },
  ) => {
    const item = workItems.find(current => current.id === workItemId);
    if (
      !item ||
      item.phase === targetPhase ||
      !requirePermission(canControlWorkItems, 'This operator cannot move work items across phases.')
    ) {
      return;
    }

    await withAction(
      `move-${workItemId}`,
      async () => {
        await moveCapabilityWorkItem(activeCapability.id, workItemId, {
          targetPhase,
          cancelRunIfPresent: options?.cancelRunIfPresent,
          note:
            options?.note ||
            `Story moved to ${getPhaseMeta(targetPhase).label} from the orchestration board.`,
        });
        await refreshSelection(selectedWorkItemId === workItemId ? workItemId : undefined);
      },
      {
        title: 'Work item moved',
        description: `${item.title} moved to ${getPhaseMeta(targetPhase).label}.`,
      },
    );
  };

  const handleConfirmPhaseMove = async () => {
    if (
      !phaseMoveRequest ||
      !requirePermission(canControlWorkItems, 'This operator cannot move work items across phases.')
    ) {
      return;
    }

    const item = workItems.find(current => current.id === phaseMoveRequest.workItemId);
    if (!item) {
      setPhaseMoveRequest(null);
      setPhaseMoveNote('');
      return;
    }

    if (item.phase === phaseMoveRequest.targetPhase) {
      setPhaseMoveRequest(null);
      setPhaseMoveNote('');
      return;
    }

    const targetLabel = getPhaseMeta(phaseMoveRequest.targetPhase).label;
    const note =
      phaseMoveNote.trim() || `Phase changed to ${targetLabel} from the phase rail.`;

    await withAction(
      `move-${item.id}`,
      async () => {
        await moveCapabilityWorkItem(activeCapability.id, item.id, {
          targetPhase: phaseMoveRequest.targetPhase,
          cancelRunIfPresent: true,
          note,
        });
        setPhaseMoveRequest(null);
        setPhaseMoveNote('');
        await refreshSelection(selectedWorkItemId === item.id ? item.id : undefined);
      },
      {
        title: 'Work item moved',
        description: `${item.title} moved to ${targetLabel}.`,
      },
    );
  };

  const handleRefresh = async () => {
    await withAction('refresh', async () => {
      await Promise.all([refreshSelection(selectedWorkItemId), loadRuntime()]);
    });
  };

  const openPhaseMoveDialog = (
    workItemId: string,
    targetPhase: WorkItemPhase,
  ) => {
    const item = workItems.find(current => current.id === workItemId);
    if (
      !item ||
      item.phase === targetPhase ||
      !requirePermission(canControlWorkItems, 'This operator cannot move work items across phases.') ||
      busyAction !== null
    ) {
      return;
    }

    setActionError('');
    setPhaseMoveNote('');
    if (selectedWorkItem?.id !== workItemId) {
      selectWorkItem(workItemId);
    }
    setPhaseMoveRequest({
      workItemId,
      targetPhase,
    });
  };

  const handleStageControlRefresh = async () => {
    if (!selectedWorkItem) {
      return;
    }

    setDetailTab('attempts');
    await refreshSelection(selectedWorkItem.id);
  };

  const updateStageChatMessages = useCallback(
    (scopeKey: string, updater: (current: StageChatMessage[]) => StageChatMessage[]) => {
      setStageChatByScope(current => ({
        ...current,
        [scopeKey]: updater(current[scopeKey] || []),
      }));
    },
    [],
  );

  const handleOpenFullChat = async () => {
    if (
      !selectedAgent ||
      !requirePermission(canReadChat, 'This operator cannot open the full chat workspace.')
    ) {
      return;
    }

    try {
      await setActiveChatAgent(activeCapability.id, selectedAgent.id);
      navigate('/chat');
    } catch (error) {
      showError(
        'Unable to open chat',
        error instanceof Error ? error.message : 'Unable to switch the active chat agent.',
      );
    }
  };

  const handleOpenApprovalReview = useCallback(() => {
    if (selectedOpenWait?.type !== 'APPROVAL' || !selectedWorkItem) {
      return;
    }

    setApprovalReviewWaitSnapshot(selectedOpenWait);
    setApprovalArtifactFilter('ALL');
    setSelectedApprovalArtifactId(null);
    setIsApprovalReviewHydrated(false);
    setIsApprovalReviewOpen(true);
  }, [
    selectedOpenWait,
    selectedWorkItem,
  ]);

  const handleApprovalReviewMouseDown = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      handleOpenApprovalReview();
    },
    [handleOpenApprovalReview],
  );

  useEffect(() => {
    if (!isApprovalReviewOpen) {
      setIsApprovalReviewHydrated(false);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setIsApprovalReviewHydrated(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isApprovalReviewOpen]);

  useEffect(() => {
    if (selectedOpenWait?.type !== 'APPROVAL' || !selectedWorkItem) {
      return;
    }

    setApprovalReviewWaitSnapshot(selectedOpenWait);

    if (autoOpenedApprovalWaitIdsRef.current.has(selectedOpenWait.id)) {
      return;
    }

    autoOpenedApprovalWaitIdsRef.current.add(selectedOpenWait.id);
    setApprovalArtifactFilter('ALL');
    setSelectedApprovalArtifactId(null);
    setIsApprovalReviewHydrated(false);
    setIsApprovalReviewOpen(true);
  }, [selectedOpenWait, selectedWorkItem]);

  const handleStageChatSend = async (event?: React.FormEvent) => {
    event?.preventDefault();

    if (
      !selectedAgent ||
      !selectedWorkItem ||
      !stageChatScopeKey ||
      !runtimeReady ||
      isStageChatSending ||
      !requirePermission(canWriteChat, 'This operator cannot send chat guidance from the workbench.')
    ) {
      return;
    }

    const nextMessage = stageChatInput.trim();
    if (!nextMessage) {
      return;
    }

    const userMessage: StageChatMessage = {
      id: `${Date.now()}-stage-user`,
      role: 'user',
      content: nextMessage,
      timestamp: formatTimestamp(),
    };

    const history = [
      ...selectedStageChatMessages,
      userMessage,
    ].map(message => ({
      id: message.id,
      capabilityId: activeCapability.id,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      ...(message.role === 'agent'
        ? {
            agentId: selectedAgent.id,
            agentName: selectedAgent.name,
            traceId: message.traceId,
            model: message.model,
            sessionId: message.sessionId,
            sessionScope: message.sessionScope,
            sessionScopeId: message.sessionScopeId,
            workItemId: selectedWorkItem.id,
            runId: currentRun?.id,
            workflowStepId: selectedCurrentStep?.id,
          }
        : {
            sessionScope: 'WORK_ITEM' as const,
            sessionScopeId: selectedWorkItem.id,
            workItemId: selectedWorkItem.id,
            runId: currentRun?.id,
            workflowStepId: selectedCurrentStep?.id,
          }),
    }));

    updateStageChatMessages(stageChatScopeKey, current => [...current, userMessage]);
    setStageChatInput('');
    setStageChatDraft('');
    setStageChatError('');
    setIsStageChatSending(true);
    const requestToken = ++stageChatRequestRef.current;

    try {
      await setActiveChatAgent(activeCapability.id, selectedAgent.id);
      const streamResult = await streamCapabilityChat(
        {
          capability: activeCapability,
          agent: selectedAgent,
          history,
          message: nextMessage,
          sessionMode: 'resume',
          sessionScope: 'WORK_ITEM',
          sessionScopeId: selectedWorkItem.id,
          contextMode: 'WORK_ITEM_STAGE',
          workItemId: selectedWorkItem.id,
          runId: currentRun?.id,
          workflowStepId: selectedCurrentStep?.id,
        },
        {
          onEvent: streamEvent => {
            if (stageChatRequestRef.current !== requestToken) {
              return;
            }

            if (streamEvent.type === 'delta' && streamEvent.content) {
              setStageChatDraft(current => current + streamEvent.content);
            }

            if (streamEvent.type === 'error' && streamEvent.error) {
              setStageChatError(streamEvent.error);
            }
          },
        },
      );

      if (stageChatRequestRef.current !== requestToken) {
        return;
      }

      const assistantContent =
        streamResult.completeEvent?.content || streamResult.draftContent;

      if (!assistantContent.trim()) {
        throw new Error(
          streamResult.error || 'The stage agent did not return a response.',
        );
      }

      updateStageChatMessages(stageChatScopeKey, current => [
        ...current,
        {
          id: `${Date.now()}-stage-agent`,
          role: 'agent',
          content: assistantContent,
          timestamp: formatTimestamp(
            streamResult.completeEvent?.createdAt
              ? new Date(streamResult.completeEvent.createdAt)
              : new Date(),
          ),
          deliveryState:
            streamResult.termination === 'complete'
              ? 'clean'
              : streamResult.termination === 'recovered'
              ? 'recovered'
              : 'interrupted',
          error: streamResult.error,
          traceId: streamResult.completeEvent?.traceId,
          model: streamResult.completeEvent?.model || selectedAgent.model,
          sessionId: streamResult.completeEvent?.sessionId,
          sessionScope: streamResult.completeEvent?.sessionScope,
          sessionScopeId: streamResult.completeEvent?.sessionScopeId,
        },
      ]);
      setStageChatDraft('');
      await refreshCapabilityBundle(activeCapability.id);
    } catch (error) {
      if (stageChatRequestRef.current !== requestToken) {
        return;
      }

      const nextError =
        error instanceof Error
          ? error.message
          : 'The stage agent could not complete this request.';
      setStageChatDraft('');
      setStageChatError(nextError);
    } finally {
      if (stageChatRequestRef.current === requestToken) {
        setIsStageChatSending(false);
      }
    }
  };

  if (view === 'list') {
    const handleDockFieldChipClick = (label: string) => {
      setDockInput(prev => {
        const trimmed = prev.trimEnd();
        const next = trimmed ? `${trimmed}\n` : '';
        return `${next}- ${label}: `;
      });
      focusDockComposer();
    };

    const attentionById = new Map(attentionItems.map(entry => [entry.item.id, entry]));
    const remainingItems = filteredWorkItems
      .filter(item => !attentionById.has(item.id))
      .slice()
      .sort((left, right) => {
        const leftTime = new Date(
          getWorkItemAttentionTimestamp(left) ||
            left.history[left.history.length - 1]?.timestamp ||
            0,
        ).getTime();
        const rightTime = new Date(
          getWorkItemAttentionTimestamp(right) ||
            right.history[right.history.length - 1]?.timestamp ||
            0,
        ).getTime();
        return rightTime - leftTime;
      });

    const inboxEntries = [
      ...attentionItems.map(entry => ({
        item: entry.item,
        meta: buildNavigatorItem(entry.item),
        attention: entry,
      })),
      ...remainingItems.map(item => ({
        item,
        meta: buildNavigatorItem(item),
        attention: null as (typeof attentionItems)[number] | null,
      })),
    ];

    const dockMessages = selectedWorkItem
      ? workspace.messages.filter(message => message.workItemId === selectedWorkItem.id)
      : [];

    const dockMissingFields = selectedRequestedInputFields.filter(
      field => field.status !== 'READY',
    );

    const dockResolutionRequired =
      selectedOpenWait?.type === 'INPUT' || selectedOpenWait?.type === 'CONFLICT_RESOLUTION';

    const dockCanResolveWait = Boolean(
      selectedOpenWait &&
        selectedWorkItem?.status !== 'PAUSED' &&
        currentRun?.status !== 'PAUSED' &&
        (selectedOpenWait.type === 'APPROVAL' ? canDecideApprovals : canControlWorkItems) &&
        (!dockResolutionRequired || Boolean(dockInput.trim()) || waitOnlyRequestsApprovedWorkspace) &&
        !(
          selectedOpenWait.type === 'INPUT' &&
          waitRequiresApprovedWorkspace &&
          !hasApprovedWorkspaceConfigured
        ),
    );

    const phaseRailCurrentIndex = selectedWorkItem
      ? lifecycleBoardPhases.indexOf(selectedWorkItem.phase)
      : -1;
    const phaseRailTargetPhase =
      selectedWorkItem &&
      phaseRailPreviewPhase &&
      lifecycleBoardPhases.includes(phaseRailPreviewPhase)
        ? phaseRailPreviewPhase
        : selectedWorkItem?.phase || null;
    const phaseRailTargetIndex =
      phaseRailTargetPhase !== null
        ? lifecycleBoardPhases.indexOf(phaseRailTargetPhase)
        : -1;
    const phaseRailInsetPx = 16;
    const phaseRailCanInteract = Boolean(
      selectedWorkItem && canControlWorkItems && busyAction === null,
    );
    const phaseRailPreviewingMove = Boolean(
      selectedWorkItem &&
        phaseRailTargetPhase &&
        phaseRailTargetPhase !== selectedWorkItem.phase,
    );

    const resolvePhaseFromClientX = (clientX: number): WorkItemPhase | null => {
      const track = phaseRailTrackRef.current;
      if (!track || lifecycleBoardPhases.length === 0) {
        return null;
      }

      if (lifecycleBoardPhases.length === 1) {
        return lifecycleBoardPhases[0] || null;
      }

      const bounds = track.getBoundingClientRect();
      if (!bounds.width) {
        return selectedWorkItem?.phase || null;
      }

      const railStart = bounds.left + phaseRailInsetPx;
      const railEnd = bounds.right - phaseRailInsetPx;
      const usableWidth = Math.max(1, railEnd - railStart);
      const clampedClientX = Math.min(railEnd, Math.max(railStart, clientX));
      const ratio = Math.min(1, Math.max(0, (clampedClientX - railStart) / usableWidth));
      const nextIndex = Math.round(ratio * (lifecycleBoardPhases.length - 1));
      return lifecycleBoardPhases[nextIndex] || null;
    };

    const previewPhaseFromClientX = (clientX: number) => {
      const nextPhase = resolvePhaseFromClientX(clientX);
      if (nextPhase) {
        setPhaseRailPreviewPhase(nextPhase);
      }
      return nextPhase;
    };

    const phaseRailMeasureForIndex = (index: number) => {
      if (lifecycleBoardPhases.length <= 1) {
        return { ratio: 0, cssValue: `${phaseRailInsetPx}px` };
      }

      const ratio = Math.min(
        1,
        Math.max(0, index / (lifecycleBoardPhases.length - 1)),
      );
      const offsetPx = (1 - ratio * 2) * phaseRailInsetPx;
      return {
        ratio,
        cssValue: `calc(${(ratio * 100).toFixed(4)}% + ${offsetPx.toFixed(2)}px)`,
      };
    };

    const commitPhaseRailPreview = (targetPhase?: WorkItemPhase | null) => {
      setIsPhaseRailDragging(false);
      const nextPhase = targetPhase || phaseRailPreviewPhase || selectedWorkItem?.phase || null;
      setPhaseRailPreviewPhase(null);
      if (!selectedWorkItem || !nextPhase || nextPhase === selectedWorkItem.phase) {
        return;
      }
      openPhaseMoveDialog(selectedWorkItem.id, nextPhase);
    };

    const handlePhaseRailPointerDown = (
      event: React.PointerEvent<HTMLDivElement | HTMLButtonElement>,
    ) => {
      if (!phaseRailCanInteract || !selectedWorkItem) {
        return;
      }

      if ((event.target as HTMLElement).closest('[data-phase-station-button="true"]')) {
        return;
      }

      event.preventDefault();
      setIsPhaseRailDragging(true);
      const initialPhase = previewPhaseFromClientX(event.clientX);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        previewPhaseFromClientX(moveEvent.clientX);
      };

      const completeDrag = (pointerEvent?: PointerEvent) => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', handlePointerCancel);
        commitPhaseRailPreview(
          pointerEvent ? previewPhaseFromClientX(pointerEvent.clientX) : initialPhase,
        );
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        completeDrag(upEvent);
      };

      const handlePointerCancel = () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', handlePointerCancel);
        setIsPhaseRailDragging(false);
        setPhaseRailPreviewPhase(null);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerCancel);
    };

    return (
      <div className="orchestrator-page-shell space-y-4">
        <section className="orchestrator-commandbar">
          <div className="orchestrator-commandbar-main">
            <div className="orchestrator-commandbar-heading">
              <div className="orchestrator-commandbar-copy">
                <p className="form-kicker">Work Inbox</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <h1 className="text-[1.75rem] font-bold tracking-tight text-on-surface">
                    {activeCapability.name} Inbox
                  </h1>
                  <StatusBadge
                    tone={
                      capabilityExperience.canStartDelivery
                        ? runtimeReady
                          ? 'success'
                          : 'danger'
                        : 'warning'
                    }
                  >
                    {capabilityExperience.canStartDelivery
                      ? runtimeReady
                        ? 'Execution ready'
                        : 'Needs setup'
                      : 'Delivery gated'}
                  </StatusBadge>
                  <StatusBadge tone="neutral">Inbox view</StatusBadge>
                </div>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-secondary">
                  Pick a work item, answer pending requests, and keep delivery moving with the Copilot Dock.
                </p>
              </div>

              <div className="orchestrator-commandbar-controls">
                <div className="orchestrator-toolbar-row orchestrator-toolbar-row-secondary">
                  <div className="orchestrator-view-toggle" aria-label="Choose orchestrator view">
                    <button
                      type="button"
                      onClick={() => setView('list')}
                      className="orchestrator-view-toggle-button orchestrator-view-toggle-button-active"
                    >
                      <List size={16} />
                      Inbox
                    </button>
                    <button
                      type="button"
                      onClick={() => setView('board')}
                      className="orchestrator-view-toggle-button"
                    >
                      <LayoutGrid size={16} />
                      Board
                    </button>
                  </div>

                  <div className="orchestrator-commandbar-actions">
                    <button
                      type="button"
                      onClick={() => void handleRefresh()}
                      disabled={busyAction === 'refresh'}
                      className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <RefreshCw
                        size={16}
                        className={busyAction === 'refresh' ? 'animate-spin' : ''}
                      />
                      Refresh
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCreateSheetOpen(true)}
                      disabled={!canCreateWorkItems}
                      className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Plus size={16} />
                      New Work Item
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="orchestrator-commandbar-footnote">
              <span className="orchestrator-commandbar-footnote-copy">
                Showing {filteredWorkItems.length} of {workItems.length} work items
              </span>
              <span className="orchestrator-commandbar-footnote-copy">
                {queueView === 'MY_QUEUE'
                  ? `${currentActorContext.displayName}'s queue`
                  : queueView === 'ALL_WORK'
                  ? 'All work items'
                  : queueView === 'TEAM_QUEUE'
                  ? 'Current team queue'
                  : queueView === 'ATTENTION'
                  ? 'Attention queue'
                  : queueView === 'PAUSED'
                  ? 'Paused queue'
                  : queueView === 'ARCHIVE'
                  ? 'Archive'
                  : 'Watching queue'}
              </span>
              <span className="orchestrator-commandbar-footnote-copy">
                {runtimeError ? 'Agent connection needs attention' : 'Inbox mode is optimized for stakeholder unblocking'}
              </span>
            </div>
          </div>
        </section>

        <section className="workspace-surface overflow-hidden p-0">
          <div className="border-b border-outline-variant/25 bg-white/70 px-5 pb-4 pt-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="form-kicker">Workflow</p>
                <h2 className="mt-1 text-lg font-bold text-on-surface">Lifecycle rail</h2>
                <p className="mt-2 max-w-4xl text-sm leading-relaxed text-secondary">
                  {selectedWorkItem ? (
                    <>
                      {selectedWorkflow?.name || 'Workflow'} ·{' '}
                      <span className="font-semibold text-on-surface">{selectedWorkItem.id}</span>{' '}
                      {selectedWorkItem.title}
                    </>
                  ) : (
                    'Select a work item to preview its lifecycle and move phases safely.'
                  )}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {selectedWorkItem ? (
                  <>
                    <StatusBadge tone={getStatusTone(selectedWorkItem.status)}>
                      {WORK_ITEM_STATUS_META[selectedWorkItem.status].label}
                    </StatusBadge>
                    <StatusBadge tone="neutral">
                      Current · {getPhaseMeta(selectedWorkItem.phase).label}
                    </StatusBadge>
                    {phaseRailPreviewingMove && phaseRailTargetPhase ? (
                      <StatusBadge tone="brand">
                        Preview · {getPhaseMeta(phaseRailTargetPhase).label}
                      </StatusBadge>
                    ) : null}
                  </>
                ) : (
                  <StatusBadge tone="neutral">No selection</StatusBadge>
                )}
              </div>
            </div>
          </div>

          <div className="orchestrator-phase-rail-shell px-5 pb-5 pt-4">
            <div
              ref={phaseRailTrackRef}
              className="orchestrator-phase-rail-track"
              onPointerDown={handlePhaseRailPointerDown}
            >
              <div className="orchestrator-phase-rail-progress" />
              {selectedWorkItem ? (
                <div
                  className="orchestrator-phase-rail-progress-current"
                  style={{ width: phaseRailMeasureForIndex(phaseRailCurrentIndex).cssValue }}
                />
              ) : null}
              {selectedWorkItem ? (
                <div
                  className={cn(
                    'orchestrator-phase-rail-progress-preview',
                    phaseRailPreviewingMove && 'orchestrator-phase-rail-progress-preview-active',
                  )}
                  style={{ width: phaseRailMeasureForIndex(phaseRailTargetIndex).cssValue }}
                />
              ) : null}

              <div className="orchestrator-phase-rail-stations">
                {lifecycleBoardPhases.map((phase, index) => {
                  const isCurrent = Boolean(selectedWorkItem && phase === selectedWorkItem.phase);
                  const isPreview = Boolean(selectedWorkItem && phase === phaseRailTargetPhase);
                  const isReached =
                    selectedWorkItem &&
                    phaseRailTargetIndex >= 0 &&
                    index <= phaseRailTargetIndex;
                  const phaseRailPosition = phaseRailMeasureForIndex(index);
                  const label = getPhaseMeta(phase).label;
                  const canMove = Boolean(
                    selectedWorkItem &&
                      canControlWorkItems &&
                      busyAction === null &&
                      !isCurrent,
                  );

                  return (
                    <button
                      key={phase}
                      type="button"
                      data-phase-station-button="true"
                      aria-disabled={!canMove}
                      onPointerDown={event => {
                        event.stopPropagation();
                      }}
                      onClick={() => {
                        if (!selectedWorkItem || !canMove) {
                          return;
                        }
                        openPhaseMoveDialog(selectedWorkItem.id, phase);
                      }}
                      className={cn(
                        'orchestrator-phase-station',
                        isCurrent && 'orchestrator-phase-station-active',
                        isPreview && 'orchestrator-phase-station-preview',
                        isReached && !isPreview && 'orchestrator-phase-station-reached',
                        !canMove && !isCurrent && 'cursor-default opacity-70',
                      )}
                      style={{ left: phaseRailPosition.cssValue }}
                      aria-label={`Move to ${label}`}
                      title={canMove ? `Move to ${label}` : label}
                    >
                      <span className="orchestrator-phase-station-dot" />
                      <span className="orchestrator-phase-station-label">{label}</span>
                    </button>
                  );
                })}
              </div>

              {selectedWorkItem && phaseRailTargetIndex >= 0 ? (
                <button
                  type="button"
                  aria-label={`Lifecycle rail handle at ${getPhaseMeta(
                    phaseRailTargetPhase || selectedWorkItem.phase,
                  ).label}`}
                  disabled={!phaseRailCanInteract}
                  onPointerDown={handlePhaseRailPointerDown}
                  onKeyDown={event => {
                    if (!phaseRailCanInteract || !selectedWorkItem) {
                      return;
                    }

                    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                      event.preventDefault();
                      const direction = event.key === 'ArrowLeft' ? -1 : 1;
                      const nextIndex = Math.min(
                        lifecycleBoardPhases.length - 1,
                        Math.max(0, phaseRailTargetIndex + direction),
                      );
                      setPhaseRailPreviewPhase(lifecycleBoardPhases[nextIndex] || null);
                      return;
                    }

                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      commitPhaseRailPreview();
                    }
                  }}
                  className={cn(
                    'orchestrator-phase-slider-handle',
                    phaseRailCanInteract && 'orchestrator-phase-slider-handle-interactive',
                    isPhaseRailDragging && 'orchestrator-phase-slider-handle-dragging',
                  )}
                  style={{ left: phaseRailMeasureForIndex(phaseRailTargetIndex).cssValue }}
                >
                  <span className="sr-only">Drag to preview a new lifecycle phase</span>
                  <span className="orchestrator-phase-slider-handle-core" />
                </button>
              ) : null}
            </div>

            {!canControlWorkItems ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs leading-relaxed text-secondary">
                <p>
                  You have read-only visibility here. Switch Current Operator to someone with `workitem.control` to pause, cancel, or move phases.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="enterprise-button enterprise-button-secondary px-3 py-2 text-[0.68rem]"
                >
                  <ArrowRight size={14} />
                  Switch operator
                </button>
              </div>
            ) : (
              <p className="mt-4 text-xs leading-relaxed text-secondary">
                Drag the rail handle to preview a phase, or click any phase station to move with confirmation. In-flight runs are cancelled safely before the move.
              </p>
            )}
          </div>
        </section>

        {!canReadLiveDetail ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            This operator currently has rollup-only visibility for this capability. Live work items,
            execution traces, and control actions are intentionally hidden until direct capability access is granted.
          </div>
        ) : null}

        <div className="orchestrator-list-workspace">
          <div className="orchestrator-list-top-grid">
            <aside className="workspace-surface overflow-hidden p-0">
            <div className="border-b border-outline-variant/25 px-4 pb-4 pt-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="form-kicker">Inbox</p>
                  <h2 className="mt-1 text-lg font-bold text-on-surface">Needs action</h2>
                  <p className="mt-1 text-sm text-secondary">
                    Search, filter, and pick a work item to unblock.
                  </p>
                </div>
                <StatusBadge tone="info">{filteredWorkItems.length} items</StatusBadge>
              </div>

              <label className="mt-4 relative block">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-outline"
                />
                <input
                  value={searchQuery}
                  onChange={event => setSearchQuery(event.target.value)}
                  placeholder="Search by id, title, tag, or agent"
                  className="enterprise-input w-full pl-11"
                />
              </label>

              <div className="mt-4">
                <div className="orchestrator-view-toggle" aria-label="Choose work queue">
                  {[
                    ['ALL_WORK', 'All'],
                    ['MY_QUEUE', 'Mine'],
                    ['TEAM_QUEUE', 'Team'],
                    ['ATTENTION', 'Approvals'],
                    ['PAUSED', 'Paused'],
                    ['WATCHING', 'Watching'],
                    ['ARCHIVE', 'Archive'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setQueueView(value as WorkbenchQueueView)}
                      className={cn(
                        'orchestrator-view-toggle-button',
                        queueView === value && 'orchestrator-view-toggle-button-active',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 grid gap-2">
                <select
                  value={workflowFilter}
                  onChange={event => setWorkflowFilter(event.target.value)}
                  className="field-select"
                >
                  <option value="ALL">All workflows</option>
                  {workspace.workflows.map(workflow => (
                    <option key={workflow.id} value={workflow.id}>
                      {workflow.name}
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={event => setStatusFilter(event.target.value as WorkItemStatusFilter)}
                  className="field-select"
                >
                  <option value="ALL">All statuses</option>
	                  <option value="ACTIVE">Active</option>
	                  <option value="BLOCKED">Blocked</option>
                    <option value="PAUSED">Paused</option>
	                  <option value="PENDING_APPROVAL">Pending approval</option>
	                  <option value="COMPLETED">Completed</option>
	                  <option value="CANCELLED">Cancelled</option>
                    <option value="ARCHIVED">Archived</option>
	                </select>
                <select
                  value={priorityFilter}
                  onChange={event => setPriorityFilter(event.target.value as WorkItemPriorityFilter)}
                  className="field-select"
                >
                  <option value="ALL">All priorities</option>
                  <option value="High">High</option>
                  <option value="Med">Med</option>
                  <option value="Low">Low</option>
                </select>
              </div>
            </div>

            <div className="custom-scrollbar max-h-[28rem] overflow-y-auto px-4 py-4 xl:max-h-[31rem]">
              {inboxEntries.length === 0 ? (
                <EmptyState
                  title="Nothing in the inbox"
                  description="Adjust the queue view or filters to bring items back into view."
                  icon={WorkflowIcon}
                  className="min-h-[18rem]"
                />
              ) : (
                <div className="space-y-3">
                  {inboxEntries.map(entry => {
                    const attention = entry.attention;
                    const cta =
                      attention?.callToAction ||
                      (!entry.item.activeRunId &&
                      entry.item.phase !== 'DONE' &&
                      entry.item.status !== 'COMPLETED'
                        ? 'Start'
                        : 'View');

                    return (
                      <div
                        key={entry.item.id}
                        onClick={() => {
                          selectWorkItem(entry.item.id);
                          if (attention?.callToAction) {
                            focusDockComposer();
                          }
                        }}
                        draggable={canControlWorkItems}
                        onDragStart={event => {
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', entry.item.id);
                          event.dataTransfer.setData(
                            'application/x-singularity-work-item',
                            entry.item.id,
                          );
                        }}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            selectWorkItem(entry.item.id);
                            if (attention?.callToAction) {
                              focusDockComposer();
                            }
                          }
                        }}
                        className={cn(
                          'orchestrator-navigator-item',
                          selectedWorkItemId === entry.item.id && 'orchestrator-navigator-item-active',
                          canControlWorkItems && 'cursor-grab',
                        )}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="form-kicker">{entry.item.id}</p>
                            <p className="mt-1 line-clamp-2 text-sm font-semibold text-on-surface">
                              {entry.item.title}
                            </p>
                          </div>
                          <StatusBadge tone={attention ? 'warning' : 'neutral'}>{cta}</StatusBadge>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <StatusBadge tone="neutral">{getPhaseMeta(entry.item.phase).label}</StatusBadge>
                          <StatusBadge tone={getStatusTone(entry.item.status)}>
                            {WORK_ITEM_STATUS_META[entry.item.status].label}
                          </StatusBadge>
                          {attention?.attentionLabel ? (
                            <StatusBadge tone="warning">{attention.attentionLabel}</StatusBadge>
                          ) : null}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {entry.item.activeRunId && entry.item.status !== 'PAUSED' ? (
                            <button
                              type="button"
                              onClick={event => {
                                event.stopPropagation();
                                void handlePauseRunById({
                                  runId: entry.item.activeRunId || '',
                                  workItemId: entry.item.id,
                                  workItemTitle: entry.item.title,
                                });
                              }}
                              disabled={busyAction !== null}
                              className="enterprise-button enterprise-button-secondary px-3 py-2 text-[0.68rem] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {busyAction === `pause-${entry.item.id}` ? (
                                <LoaderCircle size={14} className="animate-spin" />
                              ) : (
                                <Pause size={14} />
                              )}
                              Pause
                            </button>
                          ) : null}
                          {entry.item.activeRunId && entry.item.status === 'PAUSED' ? (
                            <button
                              type="button"
                              onClick={event => {
                                event.stopPropagation();
                                void handleResumeRunById({
                                  runId: entry.item.activeRunId || '',
                                  workItemId: entry.item.id,
                                  workItemTitle: entry.item.title,
                                });
                              }}
                              disabled={busyAction !== null}
                              className="enterprise-button enterprise-button-primary px-3 py-2 text-[0.68rem] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {busyAction === `resume-${entry.item.id}` ? (
                                <LoaderCircle size={14} className="animate-spin" />
                              ) : (
                                <Play size={14} />
                              )}
                              Resume
                            </button>
                          ) : null}
                          {entry.item.status === 'ARCHIVED' ? (
                            <button
                              type="button"
                              onClick={event => {
                                event.stopPropagation();
                                selectWorkItem(entry.item.id);
                                setActionError('');
                                setRestoreWorkItemNote('');
                                setIsRestoreWorkItemOpen(true);
                              }}
                              disabled={busyAction !== null}
                              className="enterprise-button enterprise-button-primary px-3 py-2 text-[0.68rem] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <RefreshCw size={14} />
                              Restore
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={event => {
                                event.stopPropagation();
                                selectWorkItem(entry.item.id);
                                setActionError('');
                                setArchiveWorkItemNote('');
                                setIsArchiveWorkItemOpen(true);
                              }}
                              disabled={busyAction !== null}
                              className={cn(
                                'enterprise-button enterprise-button-secondary px-3 py-2 text-[0.68rem] disabled:cursor-not-allowed disabled:opacity-40',
                                'border-red-200 text-red-700 hover:bg-red-50',
                              )}
                            >
                              <Trash2 size={14} />
                              Delete
                            </button>
                          )}
                          {entry.item.status !== 'COMPLETED' &&
                          entry.item.status !== 'CANCELLED' &&
                          entry.item.status !== 'ARCHIVED' ? (
                            <button
                              type="button"
                              onClick={event => {
                                event.stopPropagation();
                                selectWorkItem(entry.item.id);
                                setActionError('');
                                setCancelWorkItemNote('');
                                setIsCancelWorkItemOpen(true);
                              }}
                              disabled={busyAction !== null}
                              className="enterprise-button enterprise-button-danger px-3 py-2 text-[0.68rem] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <X size={14} />
                              Cancel
                            </button>
                          ) : null}
                        </div>
                        <div className="mt-3 space-y-1 text-xs leading-relaxed text-secondary">
                          <p>{entry.meta.currentStepName}</p>
                          <p>{entry.meta.agentName}</p>
                          <p>{entry.meta.ageLabel}</p>
                        </div>
                        {attention?.attentionReason ? (
                          <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-secondary">
                            {compactMarkdownPreview(
                              normalizeMarkdownishText(attention.attentionReason),
                              180,
                            )}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>

          <section className="workspace-surface overflow-hidden p-0">
            {!selectedWorkItem ? (
              <EmptyState
                title="Select a work item"
                description="Choose an item from the inbox to see the current state, controls, and next action."
                icon={WorkflowIcon}
                className="h-full min-h-[28rem]"
              />
            ) : (
              <div className="flex h-full flex-col">
                <div className="border-b border-outline-variant/25 px-5 pb-4 pt-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="form-kicker">{selectedWorkItem.id}</p>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge tone={getStatusTone(selectedWorkItem.phase)}>
                        {getPhaseMeta(selectedWorkItem.phase).label}
                      </StatusBadge>
                      <StatusBadge tone={getStatusTone(selectedWorkItem.status)}>
                        {WORK_ITEM_STATUS_META[selectedWorkItem.status].label}
                      </StatusBadge>
                      {currentRun && (
                        <StatusBadge tone={getStatusTone(currentRun.status)}>
                          {RUN_STATUS_META[currentRun.status].label}
                        </StatusBadge>
                      )}
                    </div>
                  </div>

                  <h2 className="mt-4 text-xl font-bold tracking-tight text-on-surface">
                    {selectedWorkItem.title}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-secondary">
                    {selectedWorkItem.description || 'No description was captured for this work item.'}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {canStartExecution ? (
                      <button
                        type="button"
                        onClick={() => void handleStartExecution()}
                        disabled={busyAction !== null}
                        className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busyAction === 'start' ? (
                          <LoaderCircle size={16} className="animate-spin" />
                        ) : (
                          <Play size={16} />
                        )}
                        Start execution
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setIsExplainOpen(true)}
                      className="enterprise-button enterprise-button-secondary"
                    >
                      Explain
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCreateEvidencePacket()}
                      disabled={!selectedWorkItem || busyAction !== null}
                      className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {busyAction === 'evidencePacket' ? (
                        <LoaderCircle size={16} className="animate-spin" />
                      ) : (
                        <FileText size={16} />
                      )}
                      Evidence packet
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleOpenFullChat()}
                      disabled={!selectedAgent || !canReadChat}
                      className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <MessageSquareText size={16} />
                      Open full chat
                    </button>
                    {currentRunIsActive && currentRun && currentRun.status !== 'PAUSED' ? (
                      <button
                        type="button"
                        onClick={() =>
                          void handlePauseRunById({
                            runId: currentRun.id,
                            workItemId: selectedWorkItem.id,
                            workItemTitle: selectedWorkItem.title,
                          })
                        }
                        disabled={!canControlWorkItems || busyAction !== null}
                        className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busyAction === `pause-${selectedWorkItem.id}` ? (
                          <LoaderCircle size={16} className="animate-spin" />
                        ) : (
                          <Pause size={16} />
                        )}
                        Pause
                      </button>
                    ) : null}
                    {currentRun && currentRun.status === 'PAUSED' ? (
                      <button
                        type="button"
                        onClick={() =>
                          void handleResumeRunById({
                            runId: currentRun.id,
                            workItemId: selectedWorkItem.id,
                            workItemTitle: selectedWorkItem.title,
                          })
                        }
                        disabled={!canControlWorkItems || busyAction !== null}
                        className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busyAction === `resume-${selectedWorkItem.id}` ? (
                          <LoaderCircle size={16} className="animate-spin" />
                        ) : (
                          <Play size={16} />
                        )}
                        Resume
                      </button>
                    ) : null}
                    {selectedWorkItem.status === 'ARCHIVED' ? (
                      <button
                        type="button"
                        onClick={() => {
                          setActionError('');
                          setRestoreWorkItemNote('');
                          setIsRestoreWorkItemOpen(true);
                        }}
                        disabled={busyAction !== null}
                        className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <RefreshCw size={16} />
                        Restore
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setActionError('');
                            setArchiveWorkItemNote('');
                            setIsArchiveWorkItemOpen(true);
                          }}
                          disabled={busyAction !== null}
                          className={cn(
                            'enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40',
                            'border-red-200 text-red-700 hover:bg-red-50',
                          )}
                        >
                          <Trash2 size={16} />
                          Delete
                        </button>
	                      <button
	                        type="button"
	                        onClick={() => {
	                          setActionError('');
	                          setCancelWorkItemNote('');
	                          setIsCancelWorkItemOpen(true);
	                        }}
	                        disabled={
	                          busyAction !== null ||
	                          selectedWorkItem.status === 'COMPLETED' ||
	                          selectedWorkItem.status === 'CANCELLED'
	                        }
	                        className="enterprise-button enterprise-button-danger disabled:cursor-not-allowed disabled:opacity-40"
	                      >
                          <X size={16} />
                          Cancel work item
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="custom-scrollbar flex-1 overflow-y-auto px-5 py-4">
                  {actionError ? (
                    <div className="workspace-inline-alert workspace-inline-alert-danger">
                      <AlertCircle size={18} className="mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold">Action failed</p>
                        <p className="mt-1 text-sm leading-relaxed">{actionError}</p>
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="workspace-meta-card">
                      <p className="workspace-meta-label">What’s next</p>
                      <p className="mt-2 text-sm font-semibold text-on-surface">
                        {selectedAttentionLabel}
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-secondary">
                        {selectedNextActionSummary}
                      </p>
                    </div>
                    <div className="workspace-meta-card">
                      <p className="workspace-meta-label">Current step</p>
                      <p className="mt-2 text-sm font-semibold text-on-surface">
                        {selectedCurrentStep?.name || 'Awaiting orchestration'}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-secondary">
                        Agent: {selectedAgent?.name || selectedAgent?.id || 'Unassigned'}
                      </p>
                      {selectedAttentionTimestamp ? (
                        <p className="mt-2 text-xs text-secondary">
                          Updated {formatTimestamp(selectedAttentionTimestamp)}
                        </p>
                      ) : null}
                    </div>
                    <div className="workspace-meta-card">
                      <p className="workspace-meta-label">Current state</p>
                      <p className="mt-2 text-sm leading-relaxed text-on-surface">
                        {selectedStateSummary}
                      </p>
                    </div>
                    <div className="workspace-meta-card">
                      <p className="workspace-meta-label">What is blocked</p>
                      <p className="mt-2 text-sm leading-relaxed text-on-surface">
                        {selectedBlockerSummary}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

          <section className="workspace-surface flex min-h-0 flex-col overflow-hidden p-0">
            <div className="border-b border-outline-variant/25 px-5 pb-4 pt-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="form-kicker">Capability Copilot</p>
                  <h2 className="mt-1 text-lg font-bold text-on-surface">Operate from one dock</h2>
                  <p className="mt-1 text-sm leading-relaxed text-secondary">
                    Upload evidence, ask questions, and resolve pending requests without switching screens.
                  </p>
                  {primaryCopilotAgent ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StatusBadge tone="brand">{primaryCopilotAgent.name}</StatusBadge>
                      <StatusBadge tone="neutral">
                        {selectedAgent?.id === primaryCopilotAgent.id
                          ? 'Primary copilot active'
                          : `Routing with ${selectedAgent?.name || primaryCopilotAgent.role}`}
                      </StatusBadge>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone="neutral">
                    {dockMessages.length} message{dockMessages.length === 1 ? '' : 's'}
                  </StatusBadge>
                  <button
                    type="button"
                    onClick={() => void handleClearDockChat()}
                    disabled={!selectedWorkItem || dockMessages.length === 0 || busyAction !== null}
                    className="enterprise-button enterprise-button-secondary border-red-200 px-3 py-2 text-[0.72rem] text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 size={14} />
                    Clear chat
                  </button>
                </div>
              </div>
            </div>

            <div className="orchestrator-copilot-dock-body">
              <div className="orchestrator-copilot-dock-status custom-scrollbar">
                {!selectedWorkItem ? (
                  <div className="workspace-meta-card">
                    Select a work item to see pending requests and start a focused copilot thread.
                  </div>
                ) : (
                  <>
                    {!currentRun && deliveryBlockingItem ? (
                      <div className="workspace-meta-card border-amber-200/80 bg-amber-50/60">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="workspace-meta-label">Execution blocked</p>
                            <p className="mt-2 text-sm font-semibold text-on-surface">
                              {deliveryBlockingItem.label}
                            </p>
                            <p className="mt-1 text-xs leading-relaxed text-secondary">
                              {deliveryBlockingItem.nextRequiredAction ||
                                deliveryBlockingItem.blockingReason ||
                                deliveryBlockingItem.description}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => navigate(deliveryBlockingItem.path)}
                            className="enterprise-button enterprise-button-secondary px-3 py-2 text-[0.68rem]"
                          >
                            <ArrowRight size={14} />
                            {deliveryBlockingItem.actionLabel}
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {!currentRun && !deliveryBlockingItem && canStartExecution ? (
                      <div className="workspace-meta-card border-emerald-200/70 bg-emerald-50/55">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="workspace-meta-label">Execution ready</p>
                            <p className="mt-2 text-sm font-semibold text-on-surface">
                              This work item can start from the dock
                            </p>
                            <p className="mt-1 text-xs leading-relaxed text-secondary">
                              Add optional kickoff guidance below, upload context if needed, then start execution to generate real workflow artifacts, waits, and approvals.
                            </p>
                          </div>
                          <StatusBadge tone="success">{executionDispatchLabel}</StatusBadge>
                        </div>
                      </div>
                    ) : null}

                    {selectedWorkItem && currentRun && canRestartFromPhase ? (
                      <div className="workspace-meta-card border-primary/20 bg-primary/5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="workspace-meta-label">Current phase</p>
                            <p className="mt-2 text-sm font-semibold text-on-surface">
                              {getPhaseMeta(selectedWorkItem.phase).label}
                            </p>
                            <p className="mt-1 text-xs leading-relaxed text-secondary">
                              Restart this phase if you want to rerun the current stage from a clean attempt.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleRestartExecution()}
                            disabled={busyAction !== null}
                            className="enterprise-button enterprise-button-secondary px-3 py-2 text-[0.68rem] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {busyAction === 'restart' ? (
                              <LoaderCircle size={14} className="animate-spin" />
                            ) : (
                              <RefreshCw size={14} />
                            )}
                            Restart {getPhaseMeta(selectedWorkItem.phase).label}
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {!currentRun && selectedCanGuideBlockedAgent ? (
                      <div className="workspace-meta-card border-primary/20 bg-primary/5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="workspace-meta-label">Blocked execution</p>
                            <p className="mt-2 text-sm font-semibold text-on-surface">
                              Restart from this dock with explicit guidance
                            </p>
                            <p className="mt-1 text-xs leading-relaxed text-secondary">
                              Explain what changed and what the next attempt should do differently, then restart directly from the composer below.
                            </p>
                          </div>
                          <StatusBadge tone="brand">Restart-ready</StatusBadge>
                        </div>
                      </div>
                    ) : null}

                    {selectedWorkItem.status === 'PAUSED' && currentRun?.status === 'PAUSED' ? (
                      <div className="workspace-meta-card border-slate-200 bg-slate-50/60">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="workspace-meta-label">Paused</p>
                            <p className="mt-2 text-sm font-semibold text-on-surface">
                              Execution is paused
                            </p>
                            <p className="mt-1 text-xs leading-relaxed text-secondary">
                              Resume to continue, or resolve pending requests from this dock.
                            </p>
                          </div>
                          {currentRun ? (
                            <button
                              type="button"
                              onClick={() =>
                                void handleResumeRunById({
                                  runId: currentRun.id,
                                  workItemId: selectedWorkItem.id,
                                  workItemTitle: selectedWorkItem.title,
                                })
                              }
                              disabled={!canControlWorkItems || busyAction !== null}
                              className="enterprise-button enterprise-button-primary px-3 py-2 text-[0.68rem] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {busyAction === `resume-${selectedWorkItem.id}` ? (
                                <LoaderCircle size={14} className="animate-spin" />
                              ) : (
                                <Play size={14} />
                              )}
                              Resume
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {selectedOpenWait ? (
                      <div className="workspace-meta-card border-amber-200/80 bg-amber-50/50">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="workspace-meta-label">Pending request</p>
                            <p className="mt-2 text-sm font-semibold text-on-surface">
                              {selectedAttentionLabel}
                            </p>
                          </div>
                          <StatusBadge tone="warning">
                            {formatEnumLabel(selectedOpenWait.type)}
                          </StatusBadge>
                        </div>
                        <div className="mt-3 rounded-2xl border border-outline-variant/25 bg-white/85 px-4 py-3">
                          <MarkdownContent
                            content={normalizeMarkdownishText(selectedOpenWait.message)}
                          />
                        </div>

                        {dockMissingFields.length > 0 ? (
                          <div className="mt-4">
                            <p className="text-xs leading-relaxed text-secondary">
                              Click a chip to add it to your response.
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {dockMissingFields.map(field => (
                                <button
                                  key={field.id}
                                  type="button"
                                  onClick={() => handleDockFieldChipClick(field.label)}
                                  className="rounded-full border border-outline-variant/30 bg-white/85 px-3 py-1 text-xs font-semibold text-on-surface"
                                >
                                  {field.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {waitRequiresApprovedWorkspace ? (
                          <div className="mt-4 rounded-2xl border border-outline-variant/25 bg-white/85 px-4 py-3">
                            <p className="workspace-meta-label">Approved workspace path</p>
                            {hasApprovedWorkspaceConfigured ? (
                              <>
                                <p className="mt-2 text-xs leading-relaxed text-secondary">
                                  Configured roots:
                                </p>
                                <ul className="mt-2 space-y-1 text-xs leading-relaxed text-secondary">
                                  {approvedWorkspaceRoots.slice(0, 4).map(root => (
                                    <li key={root} className="font-mono text-[0.72rem]">
                                      {root}
                                    </li>
                                  ))}
                                </ul>
                              </>
                            ) : (
                              <p className="mt-2 text-xs leading-relaxed text-secondary">
                                No approved workspace paths are configured yet.
                              </p>
                            )}

                            <p className="mt-3 text-xs leading-relaxed text-secondary">
                              {hasApprovedWorkspaceConfigured
                                ? 'Add another path if this work item needs a different codebase.'
                                : 'Add a local directory path that tools are allowed to read and write.'}
                            </p>
                            <input
                              value={approvedWorkspaceDraft}
                              onChange={event => {
                                setApprovedWorkspaceDraft(event.target.value);
                                setApprovedWorkspaceValidation(null);
                              }}
                              placeholder="/Users/you/projects/my-repo"
                              className="mt-3 field-input font-mono text-[0.8rem]"
                            />
                            <div className="mt-3 flex flex-wrap gap-2">
                              {selectedExecutionRepository?.localRootHint ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setApprovedWorkspaceDraft(
                                      selectedExecutionRepository.localRootHint || '',
                                    );
                                    setApprovedWorkspaceValidation(null);
                                    focusDockComposer();
                                  }}
                                  className="enterprise-button enterprise-button-secondary"
                                >
                                  Use repo root hint
                                </button>
                              ) : null}
                              {approvedWorkspaceRoots.slice(0, 2).map(root => (
                                <button
                                  key={root}
                                  type="button"
                                  onClick={() => {
                                    setApprovedWorkspaceDraft(root);
                                    setApprovedWorkspaceValidation(null);
                                    focusDockComposer();
                                  }}
                                  className="enterprise-button enterprise-button-secondary"
                                >
                                  {root}
                                </button>
                              ))}
                              {activeCapability.localDirectories.slice(0, 2).map(root => (
                                <button
                                  key={root}
                                  type="button"
                                  onClick={() => {
                                    setApprovedWorkspaceDraft(root);
                                    setApprovedWorkspaceValidation(null);
                                    focusDockComposer();
                                  }}
                                  className="enterprise-button enterprise-button-secondary"
                                >
                                  {root}
                                </button>
                              ))}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void handleApproveWorkspacePath({ unblock: true })}
                                disabled={busyAction !== null}
                                className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {busyAction === 'approveWorkspacePath' ? (
                                  <LoaderCircle size={16} className="animate-spin" />
                                ) : (
                                  <ShieldCheck size={16} />
                                )}
                                Approve and continue
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleApproveWorkspacePath()}
                                disabled={busyAction !== null}
                                className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Approve only
                              </button>
                            </div>
                            {approvedWorkspaceValidation ? (
                              <p
                                className={cn(
                                  'mt-2 text-xs font-medium',
                                  approvedWorkspaceValidation.valid
                                    ? 'text-emerald-700'
                                    : 'text-amber-800',
                                )}
                              >
                                {approvedWorkspaceValidation.message}
                              </p>
                            ) : null}
                            {!canEditCapability ? (
                              <p className="mt-2 text-xs font-medium text-amber-800">
                                Approving new paths requires capability edit access. Switch Current Operator to a workspace admin if needed.
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="workspace-meta-card">
                        No open approval, input, or conflict wait is attached to the selected work item right now.
                      </div>
                    )}
                  </>
                )}
              </div>

              <div
                ref={dockThreadRef}
                className="orchestrator-stage-chat-thread orchestrator-stage-chat-thread-dock custom-scrollbar"
                onScroll={event => {
                  const target = event.currentTarget;
                  const distanceFromBottom =
                    target.scrollHeight - target.scrollTop - target.clientHeight;
                  dockStickToBottomRef.current = distanceFromBottom < 48;
                }}
              >
                {dockMessages.length === 0 && !dockDraft ? (
                  <div className="orchestrator-stage-chat-empty">
                    This work item does not have a copilot thread yet. Ask a question or upload evidence to start one.
                  </div>
                ) : (
                  <>
                    {dockMessages.map(message => (
                      <div
                        key={message.id}
                        className={cn(
                          'orchestrator-stage-chat-message',
                          message.role === 'user'
                            ? 'orchestrator-stage-chat-message-user'
                            : 'orchestrator-stage-chat-message-agent',
                        )}
                      >
                        <div className="orchestrator-stage-chat-message-meta">
                          <span>
                            {message.role === 'user'
                              ? currentActorContext.displayName
                              : message.agentName || message.agentId || 'Agent'}
                          </span>
                          <span>{message.timestamp}</span>
                        </div>
                        <CopilotMessageBody
                          content={message.content}
                          tone={message.role === 'user' ? 'user' : 'agent'}
                        />
                      </div>
                    ))}
                    {dockDraft ? (
                      <div className="orchestrator-stage-chat-message orchestrator-stage-chat-message-agent">
                        <div className="orchestrator-stage-chat-message-meta">
                          <span>{selectedAgent?.name || 'Agent'}</span>
                          <span>Streaming</span>
                        </div>
                        <CopilotMessageBody content={dockDraft} tone="draft" />
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              {dockError ? (
                <div className="workspace-inline-alert workspace-inline-alert-danger mx-5 mt-4">
                  <AlertCircle size={18} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">Copilot dock error</p>
                    <p className="mt-1 text-sm leading-relaxed">{dockError}</p>
                  </div>
                </div>
              ) : null}

              <div
                className="orchestrator-copilot-dock-composer"
                onDragOver={event => event.preventDefault()}
                onDrop={event => {
                  event.preventDefault();
                  addDockUploadFiles(event.dataTransfer.files);
                }}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-secondary">
                  {dockComposerLabel}
                </p>
                <textarea
                  ref={dockTextareaRef}
                  value={dockInput}
                  onChange={event => setDockInput(event.target.value)}
                  placeholder={dockComposerPlaceholder}
                  className="mt-3 min-h-[6.5rem] w-full resize-none rounded-2xl border border-outline-variant/35 bg-surface-container-low/35 px-4 py-3 text-sm leading-6 text-on-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] focus:border-primary/40 focus:outline-none"
                />
                {selectedOpenWait &&
                dockResolutionRequired &&
                !dockInput.trim() &&
                !waitOnlyRequestsApprovedWorkspace ? (
                  <p className="mt-2 text-xs leading-relaxed text-secondary">
                    Add a short response above to enable "{actionButtonLabel}".
                  </p>
                ) : null}
                {selectedCanGuideBlockedAgent && !dockInput.trim() ? (
                  <p className="mt-2 text-xs leading-relaxed text-secondary">
                    Add a restart note above so the next attempt knows exactly what changed.
                  </p>
                ) : null}
                {dockInterventionMode ? (
                  <p className="mt-2 text-xs leading-relaxed text-secondary">
                    The text in this composer is applied to unblock the workflow, not sent as a separate chat turn.
                  </p>
                ) : null}

                {dockUploads.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {dockUploads.map(upload => (
                      <div
                        key={upload.id}
                        className="flex items-center gap-2 rounded-2xl border border-outline-variant/30 bg-white px-3 py-2 text-xs font-semibold text-on-surface"
                      >
                        {upload.kind === 'image' && upload.previewUrl ? (
                          <img
                            src={upload.previewUrl}
                            alt={upload.file.name}
                            className="h-10 w-10 rounded-xl object-cover"
                          />
                        ) : (
                          <FileText size={14} className="text-secondary" />
                        )}
                        <span className="max-w-[10rem] truncate">{upload.file.name}</span>
                        <span className="text-secondary">
                          {formatAttachmentSizeLabel(upload.file.size)}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeDockUpload(upload.id)}
                          className="workspace-list-action"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <label className="enterprise-button enterprise-button-secondary cursor-pointer">
                    <Plus size={14} />
                    Upload files
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={event => {
                        addDockUploadFiles(event.target.files);
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>

                  <div className="flex flex-wrap items-center gap-2">
                    {selectedOpenWait ? (
                      <>
                        {dockAllowsChatOnly ? (
                          <button
                            type="button"
                            onClick={() => void handleDockAskAgent()}
                            disabled={isDockSending || !canWriteChat}
                            className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {isDockSending ? (
                              <RefreshCw size={16} className="animate-spin" />
                            ) : (
                              <Send size={16} />
                            )}
                            Ask agent
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void handleDockResolveWait()}
                          disabled={busyAction !== null || !dockCanResolveWait}
                          className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {busyAction === 'dockResolveWait' ? (
                            <LoaderCircle size={16} className="animate-spin" />
                          ) : selectedOpenWait?.type === 'APPROVAL' ? (
                            <ShieldCheck size={16} />
                          ) : (
                            <ArrowRight size={16} />
                          )}
                          {dockPrimaryActionLabel}
                        </button>
                      </>
                    ) : selectedCanGuideBlockedAgent ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleDockGuideAndRestart()}
                          disabled={busyAction !== null || !dockInput.trim()}
                          className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {busyAction === 'dockGuideRestart' ? (
                            <LoaderCircle size={16} className="animate-spin" />
                          ) : (
                            <ArrowRight size={16} />
                          )}
                          {dockPrimaryActionLabel}
                        </button>
                      </>
                    ) : canStartExecution ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleDockAskAgent()}
                          disabled={isDockSending || !canWriteChat}
                          className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {isDockSending ? (
                            <RefreshCw size={16} className="animate-spin" />
                          ) : (
                            <Send size={16} />
                          )}
                          Ask copilot
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDockStartExecution()}
                          disabled={busyAction !== null || !canStartExecution}
                          className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {busyAction === 'dockStartExecution' ? (
                            <LoaderCircle size={16} className="animate-spin" />
                          ) : (
                            <Play size={16} />
                          )}
                          {dockPrimaryActionLabel}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleDockAskAgent()}
                        disabled={isDockSending || !canWriteChat}
                        className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {isDockSending ? (
                          <RefreshCw size={16} className="animate-spin" />
                        ) : (
                          <Send size={16} />
                        )}
                        Send
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {isCreateSheetOpen && (
          <div className="fixed inset-0 z-[90]">
            <button
              type="button"
              aria-label="Close create work item sheet"
              onClick={() => setIsCreateSheetOpen(false)}
              className="absolute inset-0 bg-slate-950/35"
            />
            <motion.aside
              initial={{ opacity: 0, x: 48 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 48 }}
              className="orchestrator-quick-sheet"
            >
              <div className="orchestrator-quick-sheet-header">
                <div>
                  <p className="form-kicker">Quick Create</p>
                  <h2 className="mt-1 text-xl font-bold text-on-surface">Stage new work</h2>
                  <p className="mt-2 text-sm leading-relaxed text-secondary">
                    Keep creation lightweight, pick the workflow, and let the execution engine own progression.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreateSheetOpen(false)}
                  className="workspace-list-action"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5">
                {workspace.workflows.length === 0 ? (
                  <EmptyState
                    title="No workflow is available"
                    description="Create or restore a workflow before staging new work into orchestration."
                    icon={WorkflowIcon}
                    className="min-h-[20rem]"
                  />
                ) : (
                  <form
                    id="orchestrator-create-work-item"
                    onSubmit={handleCreateWorkItem}
                    className="grid gap-5"
                  >
                    <label className="space-y-2">
                      <span className="field-label">Work item title</span>
                      <input
                        value={draftWorkItem.title}
                        onChange={event =>
                          setDraftWorkItem(prev => ({ ...prev, title: event.target.value }))
                        }
                        placeholder="Implement expression parser"
                        className="field-input"
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="field-label">Workflow</span>
                      <select
                        value={draftWorkItem.workflowId}
                        onChange={event =>
                          setDraftWorkItem(prev => ({
                            ...prev,
                            workflowId: event.target.value,
                          }))
                        }
                        className="field-select"
                      >
                        {workspace.workflows.map(workflow => (
                          <option key={workflow.id} value={workflow.id}>
                            {workflow.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-2">
                      <span className="field-label">Description</span>
                      <textarea
                        value={draftWorkItem.description}
                        onChange={event =>
                          setDraftWorkItem(prev => ({ ...prev, description: event.target.value }))
                        }
                        placeholder="Summarize what success looks like..."
                        className="field-input min-h-[7rem]"
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="field-label">Upload supporting docs (text only)</span>
                      <div className="flex flex-wrap gap-2">
                        <label className="enterprise-button enterprise-button-secondary cursor-pointer">
                          <Plus size={14} />
                          Upload files
                          <input
                            type="file"
                            multiple
                            className="hidden"
                            onChange={event => {
                              void handleDraftAttachmentUpload(event.target.files);
                              event.currentTarget.value = '';
                            }}
                          />
                        </label>
                        {draftWorkItem.attachments.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setDraftWorkItem(prev => ({ ...prev, attachments: [] }))}
                            className="enterprise-button enterprise-button-secondary"
                          >
                            Clear
                          </button>
                        ) : null}
                      </div>
                      {draftWorkItem.attachments.length > 0 ? (
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          {draftWorkItem.attachments.map((attachment, index) => (
                            <div
                              key={`${attachment.fileName}-${index}`}
                              className="flex items-center justify-between gap-3 rounded-[1.25rem] border border-outline-variant/20 bg-surface-container-low/35 px-4 py-3"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-on-surface">
                                  {attachment.fileName}
                                </p>
                                <p className="mt-1 truncate text-xs leading-relaxed text-secondary">
                                  {[attachment.mimeType || 'text/plain', formatAttachmentSizeLabel(attachment.sizeBytes)]
                                    .filter(Boolean)
                                    .join(' • ')}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeDraftAttachment(index)}
                                className="workspace-list-action shrink-0"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-xs leading-relaxed text-secondary">
                          No files uploaded yet.
                        </p>
                      )}
                    </label>
                  </form>
                )}
              </div>

              {workspace.workflows.length > 0 && (
                <div className="orchestrator-quick-sheet-footer">
                  <div className="flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setIsCreateSheetOpen(false)}
                      className="enterprise-button enterprise-button-secondary"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      form="orchestrator-create-work-item"
                      disabled={busyAction !== null || !canCreateWorkItems}
                      className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {busyAction === 'create' ? (
                        <LoaderCircle size={16} className="animate-spin" />
                      ) : (
                        <Plus size={16} />
                      )}
                      Create work item
                    </button>
                  </div>
                </div>
              )}
            </motion.aside>
          </div>
        )}

        {selectedWorkItem ? (
          <ErrorBoundary
            resetKey={`${selectedWorkItem.id}:${selectedAgent?.id || 'none'}:${selectedCurrentStep?.id || 'stage'}:${isStageControlOpen ? 'open' : 'closed'}`}
            title="Stage control could not render"
            description="The takeover window hit an unexpected UI problem. The workbench is still available."
          >
            <StageControlModal
              isOpen={isStageControlOpen}
              capability={activeCapability}
              workItem={selectedWorkItem}
              agent={selectedAgent}
              currentRun={currentRun}
              currentStep={selectedCurrentStep}
              openWait={selectedOpenWait}
              compiledStepContext={selectedCompiledStepContext}
              failureReason={selectedFailureReason || undefined}
              runtimeReady={runtimeReady}
              runtimeError={runtimeError}
              onClose={() => setIsStageControlOpen(false)}
              onRefresh={handleStageControlRefresh}
            />
          </ErrorBoundary>
        ) : null}

        <ExplainWorkItemDrawer
          capability={activeCapability}
          workItem={selectedWorkItem}
          isOpen={isExplainOpen}
          onClose={() => setIsExplainOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="orchestrator-page-shell space-y-4">
      <section className="orchestrator-commandbar">
        <div className="orchestrator-commandbar-main">
          <div className="orchestrator-commandbar-heading">
            <div className="orchestrator-commandbar-copy">
              <p className="form-kicker">Work</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h1 className="text-[1.75rem] font-bold tracking-tight text-on-surface">
                  {activeCapability.name} Work
                </h1>
                <StatusBadge
                  tone={
                    capabilityExperience.canStartDelivery
                      ? runtimeReady
                        ? 'success'
                        : 'danger'
                      : 'warning'
                  }
                >
                  {capabilityExperience.canStartDelivery
                    ? runtimeReady
                      ? 'Execution ready'
                      : 'Needs setup'
                    : 'Delivery gated'}
                </StatusBadge>
                <StatusBadge tone="neutral">
                  {view === 'board' ? 'Board view' : 'List view'}
                </StatusBadge>
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-secondary">
                Stage work, clear approvals and blockers, restart when needed, and keep delivery
                moving from one focused board.
              </p>
            </div>

            <div className="orchestrator-commandbar-kpis">
              {[
                { label: 'Active', value: stats.active, tone: 'brand' as const },
                { label: 'Blocked', value: stats.blocked, tone: 'danger' as const },
                { label: 'Pending Approval', value: stats.approvals, tone: 'warning' as const },
                { label: 'Running', value: stats.running, tone: 'info' as const },
              ].map(chip => (
                <div key={chip.label} className="orchestrator-kpi-chip">
                  <StatusBadge tone={chip.tone}>{chip.label}</StatusBadge>
                  <span className="text-sm font-semibold text-on-surface">{chip.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="orchestrator-commandbar-controls">
            <div className="orchestrator-toolbar-row orchestrator-toolbar-row-primary">
              <label className="orchestrator-search-shell">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-outline"
                />
                <input
                  value={searchQuery}
                  onChange={event => setSearchQuery(event.target.value)}
                  placeholder="Search work item, workflow, step, tag, or agent"
                  className="enterprise-input pl-11"
                />
              </label>

              <div className="orchestrator-view-toggle" aria-label="Choose orchestrator view">
                <button
                  type="button"
                  onClick={() => setView('board')}
                  className="orchestrator-view-toggle-button orchestrator-view-toggle-button-active"
                >
                  <LayoutGrid size={16} />
                  Board
                </button>
                <button
                  type="button"
                  onClick={() => setView('list')}
                  className="orchestrator-view-toggle-button"
                >
                  <List size={16} />
                  Inbox
                </button>
              </div>
            </div>

            <div className="orchestrator-toolbar-row orchestrator-toolbar-row-secondary">
              <div className="orchestrator-filter-strip">
                <div className="orchestrator-view-toggle" aria-label="Choose work queue">
	                  {[
	                    ['ALL_WORK', 'All work'],
	                    ['MY_QUEUE', 'My queue'],
	                    ['TEAM_QUEUE', 'Team queue'],
	                    ['ATTENTION', 'Needs approval'],
	                    ['PAUSED', 'Paused'],
	                    ['WATCHING', 'Watching'],
                      ['ARCHIVE', 'Archive'],
	                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setQueueView(value as WorkbenchQueueView)}
                      className={cn(
                        'orchestrator-view-toggle-button',
                        queueView === value && 'orchestrator-view-toggle-button-active',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <select
                  value={workflowFilter}
                  onChange={event => setWorkflowFilter(event.target.value)}
                  className="field-select"
                >
                  <option value="ALL">All workflows</option>
                  {workspace.workflows.map(workflow => (
                    <option key={workflow.id} value={workflow.id}>
                      {workflow.name}
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={event =>
                    setStatusFilter(event.target.value as WorkItemStatusFilter)
                  }
                  className="field-select"
                >
	                  <option value="ALL">All statuses</option>
		                  <option value="ACTIVE">Active</option>
		                  <option value="BLOCKED">Blocked</option>
                    <option value="PAUSED">Paused</option>
		                  <option value="PENDING_APPROVAL">Pending approval</option>
		                  <option value="COMPLETED">Completed</option>
		                  <option value="CANCELLED">Cancelled</option>
                      <option value="ARCHIVED">Archived</option>
		                </select>
                <select
                  value={priorityFilter}
                  onChange={event =>
                    setPriorityFilter(event.target.value as WorkItemPriorityFilter)
                  }
                  className="field-select"
                >
                  <option value="ALL">All priorities</option>
                  <option value="High">High</option>
                  <option value="Med">Med</option>
                  <option value="Low">Low</option>
                </select>
              </div>

              <div className="orchestrator-commandbar-actions">
                <button
                  type="button"
                  onClick={() => void handleRefresh()}
                  disabled={busyAction === 'refresh'}
                  className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCw
                    size={16}
                    className={busyAction === 'refresh' ? 'animate-spin' : ''}
                  />
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreateSheetOpen(true)}
                  disabled={!canCreateWorkItems}
                  className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus size={16} />
                  New Work Item
                </button>
              </div>
            </div>

            <div className="orchestrator-commandbar-footnote">
              <span className="orchestrator-commandbar-footnote-copy">
                Showing {filteredWorkItems.length} of {workItems.length} work items
              </span>
              <span className="orchestrator-commandbar-footnote-copy">
                {queueView === 'MY_QUEUE'
                  ? `${currentActorContext.displayName}'s queue`
                  : queueView === 'ALL_WORK'
                  ? 'All work items'
                  : queueView === 'TEAM_QUEUE'
                  ? 'Current team queue'
                  : queueView === 'ATTENTION'
                  ? 'Attention queue'
                  : queueView === 'PAUSED'
                  ? 'Paused queue'
                  : 'Watching queue'}
              </span>
              <span className="orchestrator-commandbar-footnote-copy">
                {runtimeError
                  ? 'Agent connection needs attention'
                  : 'Advanced execution details are collapsed below'}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]">
        <div className="workspace-surface space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="form-kicker">Capability cockpit</p>
              <h2 className="mt-1 text-lg font-bold text-on-surface">
                One operating loop for work, waits, evidence, and learning
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-secondary">
                Work is the primary cockpit. Home summarizes, while Chat, Agents, and Evidence stay available as companion drills when you need to go deeper.
              </p>
            </div>
            <StatusBadge tone={capabilityExperience.canStartDelivery ? 'success' : 'warning'}>
              {capabilityExperience.canStartDelivery ? 'Delivery gate clear' : 'Delivery gated'}
            </StatusBadge>
          </div>

          {deliveryBlockingItem ? (
            <div className="workspace-inline-alert workspace-inline-alert-warning">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{deliveryBlockingItem.label}</p>
                <p className="mt-1 text-sm leading-relaxed">
                  {deliveryBlockingItem.nextRequiredAction ||
                    deliveryBlockingItem.blockingReason ||
                    deliveryBlockingItem.description}
                </p>
                <button
                  type="button"
                  onClick={() => navigate(deliveryBlockingItem.path)}
                  className="enterprise-button enterprise-button-secondary mt-3"
                >
                  <ArrowRight size={16} />
                  {deliveryBlockingItem.actionLabel}
                </button>
              </div>
            </div>
          ) : (
            <div className="workspace-meta-card border-emerald-200 bg-emerald-50/50">
              <p className="workspace-meta-label">Next move</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                {capabilityExperience.nextAction.title}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-secondary">
                {capabilityExperience.nextAction.description}
              </p>
            </div>
          )}

          <div className="rounded-[1.5rem] border border-outline-variant/25 bg-surface-container-low/45 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="workspace-meta-label">Golden path</p>
                <p className="mt-2 text-sm leading-relaxed text-secondary">
                  {capabilityExperience.goldenPathProgress.summary}
                </p>
              </div>
              <StatusBadge tone="brand">
                {capabilityExperience.goldenPathProgress.percentComplete}% complete
              </StatusBadge>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              {capabilityExperience.goldenPathProgress.steps.map(step => (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => navigate(step.path)}
                  className={cn(
                    'rounded-2xl border px-3 py-3 text-left transition',
                    step.status === 'COMPLETE'
                      ? 'border-emerald-200 bg-emerald-50/70'
                      : step.status === 'CURRENT'
                      ? 'border-primary/20 bg-primary/8'
                      : 'border-outline-variant/30 bg-white/80 hover:border-primary/20',
                  )}
                >
                  <p className="text-[0.68rem] font-bold uppercase tracking-[0.16em] text-secondary">
                    {step.status === 'COMPLETE'
                      ? 'Complete'
                      : step.status === 'CURRENT'
                      ? 'Current'
                      : 'Up next'}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-on-surface">{step.label}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="workspace-surface space-y-4">
          <div>
            <p className="form-kicker">Capability copilot</p>
            <h2 className="mt-1 text-lg font-bold text-on-surface">
              {primaryCopilotAgent?.name || 'Capability Copilot'}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-secondary">
              One user-facing copilot routes work to specialists and keeps the live operating story grounded in workflow state, evidence, and learning.
            </p>
          </div>

          <div className="workspace-meta-card border-outline-variant/50">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="workspace-meta-label">Desktop execution owner</p>
                <p className="mt-2 text-sm font-semibold text-on-surface">{executionOwnerLabel}</p>
                <p className="mt-2 text-xs leading-relaxed text-secondary">
                  {workspace.executionDispatchState === 'ASSIGNED'
                    ? `Automation is routed through ${executionOwnerLabel}.`
                    : workspace.executionQueueReason === 'EXECUTOR_DISCONNECTED'
                    ? 'The previous desktop owner disconnected. Queued runs will resume after a desktop takes ownership again.'
                    : workspace.executionQueueReason === 'EXECUTOR_RELEASED'
                    ? 'Execution was released and queued work is waiting for a new desktop owner.'
                    : 'Queued runs stay visible until an eligible desktop claims this capability.'}
                </p>
              </div>
              <StatusBadge
                tone={
                  workspace.executionDispatchState === 'ASSIGNED'
                    ? 'success'
                    : workspace.executionDispatchState === 'STALE_EXECUTOR'
                    ? 'warning'
                    : 'neutral'
                }
              >
                {executionDispatchLabel}
              </StatusBadge>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {!currentDesktopOwnsExecution ? (
                <button
                  type="button"
                  onClick={() =>
                    void handleClaimDesktopExecution(
                      Boolean(
                        executionOwnership &&
                          executionOwnership.executorId !== runtimeStatus?.executorId,
                      ),
                    )
                  }
                  disabled={!canClaimExecution || executionClaimBusy || !runtimeStatus?.executorId}
                  className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Bot size={16} />
                  {executionOwnership &&
                  executionOwnership.executorId !== runtimeStatus?.executorId
                    ? 'Take over desktop execution'
                    : 'Claim desktop execution'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleReleaseDesktopExecution()}
                  disabled={!canClaimExecution || executionClaimBusy}
                  className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Square size={16} />
                  Release desktop execution
                </button>
              )}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="workspace-meta-card">
              <p className="workspace-meta-label">Primary role</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                {primaryCopilotAgent?.role || 'Unavailable'}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-secondary">
                {primaryCopilotAgent?.rolePolicy?.summary ||
                  'This copilot will interpret live work state and coordinate specialist responses.'}
              </p>
            </div>
            <div className="workspace-meta-card">
              <p className="workspace-meta-label">Current specialist</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                {selectedAgent?.name || primaryCopilotAgent?.name || 'None selected'}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-secondary">
                {selectedAgent?.qualityBar?.label
                  ? `${selectedAgent.qualityBar.label}: ${selectedAgent.qualityBar.summary}`
                  : 'Select a work item to see which specialist is currently active.'}
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <button
              type="button"
              onClick={() => void handleOpenFullChat()}
              disabled={!primaryCopilotAgent || !canReadChat}
              className="rounded-2xl border border-outline-variant/40 bg-surface-container-low px-4 py-4 text-left transition hover:border-primary/20 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <p className="text-sm font-semibold text-on-surface">Open companion chat</p>
              <p className="mt-1 text-xs leading-relaxed text-secondary">
                Deep-dive into the full capability conversation when the cockpit thread is not enough.
              </p>
            </button>
            <button
              type="button"
              onClick={() => navigate('/team')}
              className="rounded-2xl border border-outline-variant/40 bg-surface-container-low px-4 py-4 text-left transition hover:border-primary/20 hover:bg-white"
            >
              <p className="text-sm font-semibold text-on-surface">Inspect specialists</p>
              <p className="mt-1 text-xs leading-relaxed text-secondary">
                Review the specialist roster, learning state, and operating contracts behind the copilot.
              </p>
            </button>
          </div>
        </div>
      </section>

      {!canReadLiveDetail ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This operator currently has rollup-only visibility for this capability. Live work items,
          execution traces, and control actions are intentionally hidden until direct capability
          access is granted.
        </div>
      ) : null}

      <AdvancedDisclosure
        title="Advanced execution details"
        description="Runtime readiness, run-event counts, and telemetry links for operators who need deeper inspection."
        storageKey={STORAGE_KEYS.advanced}
        badge={
          <StatusBadge tone={runtimeReady ? 'success' : 'warning'}>
            {runtimeReady ? 'Connected' : 'Needs attention'}
          </StatusBadge>
        }
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="workspace-meta-card">
            <p className="workspace-meta-label">Agent connection</p>
            <p className="workspace-meta-value">
              {runtimeReady ? 'Ready' : 'Needs setup'}
            </p>
            <p className="mt-1 text-xs text-secondary">
              {runtimeError || 'Agents can start or resume workflow execution.'}
            </p>
          </div>
          <div className="workspace-meta-card">
            <p className="workspace-meta-label">Selected run events</p>
            <p className="workspace-meta-value">{selectedRunEvents.length}</p>
            <p className="mt-1 text-xs text-secondary">
              Detailed run events remain available in Run Console.
            </p>
          </div>
          <div className="workspace-meta-card">
            <p className="workspace-meta-label">Run history</p>
            <p className="workspace-meta-value">{selectedRunHistory.length} runs</p>
            <p className="mt-1 text-xs text-secondary">
              Attempts for the currently selected work item.
            </p>
          </div>
        </div>
      </AdvancedDisclosure>

      <section className="workspace-surface orchestrator-attention-shell">
        <div className="orchestrator-surface-header">
          <div>
            <p className="form-kicker">Top Action Queue</p>
            <h2 className="mt-1 text-lg font-bold text-on-surface">Needs Attention</h2>
            <p className="mt-1 text-sm text-secondary">
              Blockers, approvals, missing input, and conflict resolutions stay here so triage
              happens before the board gets crowded with urgency.
            </p>
          </div>
          <StatusBadge tone={attentionItems.length > 0 ? 'warning' : 'success'}>
            {attentionItems.length > 0
              ? `${attentionItems.length} items waiting`
              : 'All clear'}
          </StatusBadge>
        </div>

        {attentionItems.length === 0 ? (
          <div className="orchestrator-attention-empty">
            No approvals, blockers, or missing-input requests are waiting right now.
          </div>
        ) : (
          <div className="orchestrator-attention-row">
	            {attentionItems.map(attention => (
	              <button
	                key={attention.item.id}
	                type="button"
	                onClick={() => {
	                  const focus: WorkbenchSelectionFocus | undefined =
	                    attention.item.pendingRequest?.type === 'INPUT'
	                      ? 'INPUT'
	                      : attention.item.pendingRequest?.type === 'APPROVAL'
	                        ? 'APPROVAL'
	                        : attention.item.blocker?.type
	                              ? 'RESOLUTION'
	                              : undefined;
	                  selectWorkItem(attention.item.id, {
	                    openControl: true,
	                    focus,
	                  });
	                }}
	                className={cn(
	                  'orchestrator-attention-card min-w-[18rem] text-left',
	                  selectedWorkItemId === attention.item.id &&
	                    'orchestrator-attention-card-active',
	                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="form-kicker">{attention.item.id}</p>
                    <h3 className="mt-1 line-clamp-2 text-sm font-semibold text-on-surface">
                      {attention.item.title}
                    </h3>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge tone="warning">{attention.attentionLabel}</StatusBadge>
                    {attention.hasConflictReview && (
                      <StatusBadge tone="danger" className="tracking-[0.12em]">
                        Contrarian pass
                      </StatusBadge>
                    )}
                  </div>
                </div>
                <div className="mt-3 space-y-2 text-sm text-secondary">
                  <p className="line-clamp-2">{attention.attentionReason}</p>
                  <div className="orchestrator-attention-meta">
                    <span>{getPhaseMeta(attention.item.phase).label}</span>
                    <span>
                      {agentsById.get(attention.agentId || '')?.name ||
                        attention.agentId ||
                        'System'}
                    </span>
                    <span>{formatRelativeTime(attention.attentionTimestamp)}</span>
                  </div>
                </div>
                <div className="orchestrator-attention-cta">
                  <span>{attention.callToAction}</span>
                  <ArrowRight size={14} />
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="orchestrator-workspace-grid">
        <section
          id="orchestrator-flow-map"
          className="workspace-surface orchestrator-board-shell"
        >
          <div className="orchestrator-surface-header">
            <div>
              <p className="form-kicker">Phase Board</p>
              <h2 className="mt-1 text-lg font-bold text-on-surface">
                {view === 'board' ? 'Execution lanes' : 'Operational list'}
              </h2>
              <p className="mt-1 text-sm text-secondary">
                {view === 'board'
                  ? 'Use the lane map below as the flow view after you finish operating the selected work item above.'
                  : 'Use the operational table below for broader triage once the focused workbench is set.'}
              </p>
            </div>
            <div className="orchestrator-board-meta">
              {workspace.workflows.slice(0, 3).map(workflow => (
                <span key={workflow.id}>
                  <StatusBadge tone="neutral">{workflow.name}</StatusBadge>
                </span>
              ))}
            </div>
          </div>

          {view === 'board' ? (
            <div className="space-y-6">
              <div className="orchestrator-board-grid">
                {groupedItems.map(({ phase, items }) => (
                  <BoardColumn
                    key={phase}
                    title={getPhaseMeta(phase).label}
                    count={items.length}
                    active={dragOverPhase === phase}
                    className="orchestrator-phase-column transition-all"
                  >
                    <div
                      onDragOver={event => {
                        event.preventDefault();
                        setDragOverPhase(phase);
                      }}
                      onDragLeave={() =>
                        setDragOverPhase(current => (current === phase ? null : current))
                      }
                      onDrop={event => {
                        event.preventDefault();
                        setDragOverPhase(null);
                        const droppedId =
                          event.dataTransfer.getData('text/plain') || draggedWorkItemId;
                        setDraggedWorkItemId(null);
                        if (droppedId) {
                          void handleMoveWorkItem(droppedId, phase);
                        }
                      }}
                      className="orchestrator-phase-body"
                    >
                      {items.map(item => {
                        const workflow = workflowsById.get(item.workflowId) || null;
                        const currentStep = getCurrentWorkflowStep(workflow, null, item);
                        const agentId = item.assignedAgentId || currentStep?.agentId;
                        const attentionLabel =
                          item.blocker?.status === 'OPEN' || item.pendingRequest
                            ? getAttentionLabel({
                                blocker: item.blocker,
                                pendingRequest: item.pendingRequest,
                              })
                            : '';
                        const attentionReason = getAttentionReason({
                          blocker: item.blocker,
                          pendingRequest: item.pendingRequest,
                        });
                        const hasConflictReview = isConflictAttention(item);

                        return (
                          <motion.button
                            key={item.id}
                            id={`orchestrator-item-${item.id}`}
                            layout
                            draggable
                            onDragStart={event => {
                              setDraggedWorkItemId(item.id);
                              if ('dataTransfer' in event && event.dataTransfer) {
                                const dataTransfer = event.dataTransfer as DataTransfer;
                                dataTransfer.setData('text/plain', item.id);
                              }
                            }}
                            onDragEnd={() => {
                              setDraggedWorkItemId(null);
                              setDragOverPhase(null);
                            }}
                            onClick={() => selectWorkItem(item.id)}
                            className={cn(
                              'orchestrator-board-card',
                              selectedWorkItemId === item.id &&
                                'orchestrator-board-card-active',
                            )}
                          >
                            <div className="orchestrator-board-card-top">
                              <div className="min-w-0">
                                <p className="form-kicker">{item.id}</p>
                                <h3 className="mt-1 line-clamp-2 text-sm font-semibold text-on-surface">
                                  {item.title}
                                </h3>
                              </div>
                              <StatusBadge tone={getPriorityTone(item.priority)}>
                                {item.priority}
                              </StatusBadge>
                            </div>

                            <div className="orchestrator-board-card-status">
                              <StatusBadge tone={getStatusTone(item.status)}>
                                {WORK_ITEM_STATUS_META[item.status].label}
                              </StatusBadge>
                              {item.taskType && item.taskType !== DEFAULT_WORK_ITEM_TASK_TYPE && (
                                <StatusBadge tone="neutral">
                                  {getWorkItemTaskTypeLabel(item.taskType)}
                                </StatusBadge>
                              )}
                              {item.activeRunId && <StatusBadge tone="brand">Running</StatusBadge>}
                              {hasConflictReview && (
                                <StatusBadge tone="danger">Contrarian pass</StatusBadge>
                              )}
                            </div>

                            <div className="orchestrator-board-card-body">
                              <div className="orchestrator-board-card-step">
                                <p className="form-kicker">Current Step</p>
                                <p className="mt-1 text-xs font-semibold text-on-surface">
                                  {currentStep?.name || 'Awaiting orchestration'}
                                </p>
                              </div>
                              <div className="orchestrator-board-card-footer">
                                <span className="truncate">
                                  {agentsById.get(agentId || '')?.name || agentId || 'Unassigned'}
                                </span>
                              </div>
                              {attentionLabel && (
                                <div className="orchestrator-board-card-attention">
                                  <div className="flex items-center gap-2 font-bold uppercase tracking-[0.16em]">
                                    <AlertCircle size={14} />
                                    <span>{attentionLabel}</span>
                                  </div>
                                  <p className="mt-1 line-clamp-2 normal-case tracking-normal font-medium">
                                    {attentionReason}
                                  </p>
                                </div>
                              )}
                            </div>
                          </motion.button>
                        );
                      })}

                      {items.length === 0 && (
                        <EmptyState
                          title={`No work in ${getPhaseMeta(phase).label}`}
                          description="Drop a work item here to re-stage it or keep the phase clear while execution moves forward."
                          icon={WorkflowIcon}
                          className="min-h-[10rem]"
                        />
                      )}
                    </div>
                  </BoardColumn>
                ))}
              </div>

              <div className="workspace-meta-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="workspace-meta-label">Completed work</p>
                    <p className="mt-1 text-sm font-semibold text-on-surface">
                      Finished items are tracked below the active lanes
                    </p>
                  </div>
                  <StatusBadge tone="success">{completedItems.length} done</StatusBadge>
                </div>

                {completedItems.length > 0 ? (
                  <div className="mt-4 overflow-x-auto">
                    <div className="data-table-shell min-w-[48rem]">
                      <div className="data-table-header grid grid-cols-[1.7fr_0.9fr_0.95fr_1.1fr_1fr_1fr] gap-3">
                        <span>Work Item</span>
                        <span>Workflow</span>
                        <span>Completed In</span>
                        <span>Last Step</span>
                        <span>Owner</span>
                        <span>Last Update</span>
                      </div>
                      {completedItems.map(item => {
                        const workflow = workflowsById.get(item.workflowId) || null;
                        const currentStep = getCurrentWorkflowStep(workflow, null, item);
                        const agentId = item.assignedAgentId || currentStep?.agentId;
                        const lastHistoryEntry = item.history[item.history.length - 1];

                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => selectWorkItem(item.id)}
                            className={cn(
                              'orchestrator-list-row',
                              selectedWorkItemId === item.id && 'orchestrator-list-row-active',
                            )}
                          >
                            <div>
                              <p className="font-semibold text-on-surface">{item.title}</p>
                              <p className="mt-1 text-xs text-secondary">{item.id}</p>
                            </div>
                            <span>{workflow?.name || 'Workflow missing'}</span>
                            <div>
                              <StatusBadge tone="success">
                                {getPhaseMeta(item.phase).label}
                              </StatusBadge>
                            </div>
                            <span>{currentStep?.name || 'Completed'}</span>
                            <span>{agentsById.get(agentId || '')?.name || agentId || 'Unassigned'}</span>
                            <span>{formatTimestamp(lastHistoryEntry?.timestamp)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-sm leading-relaxed text-secondary">
                    Completed work will collect here instead of stretching the phase board.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="data-table-shell">
              <div className="data-table-header grid grid-cols-[1.6fr_0.85fr_0.9fr_0.95fr_1fr_1.05fr] gap-3">
                <span>Work Item</span>
                <span>Phase</span>
                <span>Status</span>
                <span>Priority</span>
                <span>Current Step</span>
                <span>Active Agent</span>
              </div>
              {filteredWorkItems.map(item => {
                const workflow = workflowsById.get(item.workflowId) || null;
                const currentStep = getCurrentWorkflowStep(workflow, null, item);
                const agentId = item.assignedAgentId || currentStep?.agentId;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectWorkItem(item.id)}
                    className={cn(
                      'orchestrator-list-row',
                      selectedWorkItemId === item.id && 'orchestrator-list-row-active',
                    )}
                  >
                    <div>
                      <p className="font-semibold text-on-surface">{item.title}</p>
                      <p className="mt-1 text-xs text-secondary">{item.id}</p>
                    </div>
                    <span>{getPhaseMeta(item.phase).label}</span>
                    <div>
                      <StatusBadge tone={getStatusTone(item.status)}>
                        {formatEnumLabel(item.status)}
                      </StatusBadge>
                    </div>
                    <div>
                      <StatusBadge tone={getPriorityTone(item.priority)}>
                        {item.priority}
                      </StatusBadge>
                    </div>
                    <span>{currentStep?.name || 'Awaiting orchestration'}</span>
                    <span>{agentsById.get(agentId || '')?.name || agentId || 'Unassigned'}</span>
                  </button>
                );
              })}
              {filteredWorkItems.length === 0 && (
                <EmptyState
                  title="No work items match the current filters"
                  description="Adjust the search or filters to bring items back into the operational list."
                  icon={WorkflowIcon}
                  className="min-h-[18rem]"
                />
              )}
            </div>
          )}
        </section>

        <aside className="orchestrator-detail-rail">
          <div className="workspace-surface orchestrator-detail-panel">
            <div className="orchestrator-workbench-grid">
              <aside className="orchestrator-navigator-rail">
                <div className="orchestrator-navigator-shell">
                  <div className="orchestrator-navigator-header">
                    <div>
                      <p className="form-kicker">Workbench</p>
                      <h2 className="mt-1 text-lg font-bold text-on-surface">
                        Work navigator
                      </h2>
                      <p className="mt-1 text-sm text-secondary">
                        Move through urgent, active, and completed work without losing the focused operator workspace.
                      </p>
                    </div>
                    <StatusBadge tone="info">{filteredWorkItems.length} items</StatusBadge>
                  </div>

                  <div className="orchestrator-navigator-groups">
                    {navigatorSections.map(section => (
                      <section key={section.id} className="orchestrator-navigator-group">
                        <div className="orchestrator-navigator-group-header">
                          <div>
                            <p className="text-sm font-semibold text-on-surface">
                              {section.title}
                            </p>
                            <p className="mt-1 text-xs leading-relaxed text-secondary">
                              {section.helper}
                            </p>
                          </div>
                          <StatusBadge tone="neutral">{section.items.length}</StatusBadge>
                        </div>

                        {section.items.length === 0 ? (
                          <div className="orchestrator-navigator-empty">
                            Nothing to show in this section right now.
                          </div>
                        ) : (
                          <div className="orchestrator-navigator-list">
                            {section.items.map(entry => (
                              <button
                                key={entry.item.id}
                                type="button"
                                onClick={() => selectWorkItem(entry.item.id)}
                                className={cn(
                                  'orchestrator-navigator-item',
                                  selectedWorkItemId === entry.item.id &&
                                    'orchestrator-navigator-item-active',
                                )}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="form-kicker">{entry.item.id}</p>
                                    <p className="mt-1 line-clamp-2 text-sm font-semibold text-on-surface">
                                      {entry.item.title}
                                    </p>
                                  </div>
                                  <StatusBadge tone={getStatusTone(entry.item.status)}>
                                    {WORK_ITEM_STATUS_META[entry.item.status].label}
                                  </StatusBadge>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <StatusBadge tone="neutral">
                                    {getPhaseMeta(entry.item.phase).label}
                                  </StatusBadge>
                                  {entry.attentionLabel ? (
                                    <StatusBadge tone="warning">{entry.attentionLabel}</StatusBadge>
                                  ) : null}
                                </div>
                                <div className="mt-3 space-y-1 text-xs leading-relaxed text-secondary">
                                  <p>{entry.currentStepName}</p>
                                  <p>{entry.agentName}</p>
                                  <p>{entry.ageLabel}</p>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </section>
                    ))}
                  </div>
                </div>
              </aside>

              <div className="orchestrator-workbench-canvas">
                {!selectedWorkItem ? (
                  <EmptyState
                    title="Select a work item"
                    description="Choose a story from the navigator, attention strip, or flow map to open the focused delivery workbench."
                    icon={WorkflowIcon}
                    className="h-full min-h-[45rem]"
                  />
                ) : (
                  <div className="flex h-full flex-col">
                <div className="orchestrator-detail-header">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="form-kicker">{selectedWorkItem.id}</p>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge tone={getStatusTone(selectedWorkItem.phase)}>
                        {getPhaseMeta(selectedWorkItem.phase).label}
                      </StatusBadge>
                      <StatusBadge tone="neutral">
                        {getWorkItemTaskTypeLabel(selectedWorkItem.taskType)}
                      </StatusBadge>
                      <StatusBadge tone={getStatusTone(selectedWorkItem.status)}>
                        {WORK_ITEM_STATUS_META[selectedWorkItem.status].label}
                      </StatusBadge>
                      {currentRun && (
                        <StatusBadge tone={getStatusTone(currentRun.status)}>
                          {RUN_STATUS_META[currentRun.status].label}
                        </StatusBadge>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 min-w-0">
                    <h2 className="text-xl font-bold tracking-tight text-on-surface">
                      {selectedWorkItem.title}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-secondary">
                      {selectedWorkItem.description ||
                        'No description was captured when this work item was staged into execution.'}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-secondary">
                      {selectedPhaseOwnerTeam && (
                        <span className="rounded-full bg-surface-container px-3 py-1">
                          Phase owner team: {selectedPhaseOwnerTeam.name}
                        </span>
                      )}
                      {selectedClaimOwner && (
                        <span className="rounded-full bg-surface-container px-3 py-1">
                          Active operator: {selectedClaimOwner.name}
                        </span>
                      )}
                      {selectedPresenceUsers.length > 0 && (
                        <span className="rounded-full bg-surface-container px-3 py-1">
                          Watching: {selectedPresenceUsers.map(user => user.name).join(', ')}
                        </span>
                      )}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => clearSelectedWorkItem({ focusBoard: true })}
                        className="enterprise-button enterprise-button-secondary"
                      >
                        <ArrowRight size={16} className="rotate-180" />
                        Back to flow map
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsExplainOpen(true)}
                        className="enterprise-button enterprise-button-secondary"
                      >
                        Explain
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCreateEvidencePacket()}
                        disabled={!selectedWorkItem || busyAction !== null}
                        className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busyAction === 'evidencePacket' ? (
                          <LoaderCircle size={16} className="animate-spin" />
                        ) : (
                          <FileText size={16} />
                        )}
                        Evidence packet
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleOpenFullChat()}
                        disabled={!selectedAgent || !canReadChat}
                        className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <MessageSquareText size={16} />
                        Open full chat
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsStageControlOpen(true)}
                        disabled={!selectedCanTakeControl}
                        className="enterprise-button enterprise-button-brand-muted disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <MessageSquareText size={16} />
                        Take control
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void (currentActorOwnsSelectedWorkItem
                            ? handleReleaseControl()
                            : handleClaimControl())
                        }
                        disabled={!canControlWorkItems}
                        className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <User size={16} />
                        {currentActorOwnsSelectedWorkItem ? 'Release control' : 'Claim control'}
                      </button>
                    </div>

                    <div className="mt-4 rounded-[1.5rem] border border-outline-variant/25 bg-surface-container-low/60 px-4 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="workspace-meta-label">Top controls</p>
                          <p className="mt-2 text-sm leading-relaxed text-secondary">
                            Keep the primary run actions close to the title so you can start,
                            restart, review approvals, or guide blocked work without hunting
                            through the page.
                          </p>
                        </div>
                        {selectedCanGuideBlockedAgent ? (
                          <StatusBadge tone="warning">Blocked work needs guidance</StatusBadge>
                        ) : selectedOpenWait?.type === 'APPROVAL' ? (
                          <StatusBadge tone="warning">Approval review waiting</StatusBadge>
                        ) : null}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {selectedOpenWait?.type === 'APPROVAL' && (
                          <button
                            type="button"
                            onMouseDown={handleApprovalReviewMouseDown}
                            onClick={handleOpenApprovalReview}
                            className="enterprise-button enterprise-button-primary"
                          >
                            <ShieldCheck size={16} />
                            Review approval gate
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => void handleStartExecution()}
                          disabled={!canStartExecution || busyAction !== null}
                          className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {busyAction === 'start' ? (
                            <LoaderCircle size={16} className="animate-spin" />
                          ) : (
                            <Play size={16} />
                          )}
                          {selectedRunHistory.length > 0
                            ? 'Start current phase'
                            : 'Start execution'}
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleRestartExecution()}
                          disabled={!canRestartFromPhase || busyAction !== null}
                          className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {busyAction === 'restart' ? (
                            <LoaderCircle size={16} className="animate-spin" />
                          ) : (
                            <RefreshCw size={16} />
                          )}
                          Restart {selectedWorkItem ? getPhaseMeta(selectedWorkItem.phase).label : 'phase'}
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleResetAndRestart()}
                          disabled={!canResetAndRestart || busyAction !== null}
                          className="enterprise-button enterprise-button-brand-muted disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {busyAction === 'reset' ? (
                            <LoaderCircle size={16} className="animate-spin" />
                          ) : (
                            <RefreshCw size={16} />
                          )}
                          Reset and restart
                        </button>

                        {selectedCanGuideBlockedAgent && (
                          <button
                            type="button"
                            onClick={focusGuidanceComposer}
                            className="enterprise-button enterprise-button-brand-muted"
                          >
                            <ArrowRight size={16} />
                            Guide blocked agent
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => void handleCancelRun()}
                          disabled={!currentRunIsActive || busyAction !== null}
                          className="enterprise-button enterprise-button-danger disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {busyAction === 'cancel' ? (
                            <LoaderCircle size={16} className="animate-spin" />
                          ) : (
                            <Square size={16} />
                          )}
                          Cancel run
                        </button>

                        {selectedWorkItem.status === 'ARCHIVED' ? (
                          <button
                            type="button"
                            onClick={() => {
                              setActionError('');
                              setRestoreWorkItemNote('');
                              setIsRestoreWorkItemOpen(true);
                            }}
                            disabled={busyAction !== null}
                            className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <RefreshCw size={16} />
                            Restore
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setActionError('');
                                setArchiveWorkItemNote('');
                                setIsArchiveWorkItemOpen(true);
                              }}
                              disabled={busyAction !== null}
                              className={cn(
                                'enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40',
                                'border-red-200 text-red-700 hover:bg-red-50',
                              )}
                            >
                              <Trash2 size={16} />
                              Delete
                            </button>
	                          <button
	                            type="button"
	                            onClick={() => {
	                              setActionError('');
	                              setCancelWorkItemNote('');
	                              setIsCancelWorkItemOpen(true);
	                            }}
	                            disabled={
	                              busyAction !== null ||
	                              selectedWorkItem.status === 'COMPLETED' ||
	                              selectedWorkItem.status === 'CANCELLED'
	                            }
	                            className="enterprise-button enterprise-button-danger disabled:cursor-not-allowed disabled:opacity-40"
	                          >
                              <X size={16} />
                              Cancel work item
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="orchestrator-detail-tabs">
                    {([
                      ['operate', 'Operate'],
                      ['artifacts', 'Artifacts'],
                      ['attempts', 'Attempts'],
                    ] as const).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setDetailTab(id)}
                        className={cn(
                          'workspace-tab-button',
                          detailTab === id && 'workspace-tab-button-active',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="orchestrator-detail-body">
                {detailTab === 'operate' && (
                  <div className="space-y-4">
                    <div className="grid gap-3 lg:grid-cols-3">
                      <div className="workspace-meta-card">
                        <p className="workspace-meta-label">What is happening</p>
                        <p className="mt-2 text-sm leading-relaxed text-on-surface">
                          {selectedStateSummary}
                        </p>
                      </div>
                      <div className="workspace-meta-card">
                        <p className="workspace-meta-label">What is blocked</p>
                        <p className="mt-2 text-sm leading-relaxed text-on-surface">
                          {selectedBlockerSummary}
                        </p>
                      </div>
                      <div className="workspace-meta-card">
                        <p className="workspace-meta-label">What is next</p>
                        <p className="mt-2 text-sm leading-relaxed text-on-surface">
                          {selectedNextActionSummary}
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                      <CapabilityBriefingPanel
                        briefing={workspace.briefing}
                        compact
                        title="Capability brain"
                      />
                      {selectedAgentKnowledgeLens ? (
                        <AgentKnowledgeLensPanel
                          lens={selectedAgentKnowledgeLens}
                          compact
                          title="What this agent knows now"
                        />
                      ) : null}
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                      <div className="workspace-meta-card">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="workspace-meta-label">Readiness contract</p>
                            <p className="mt-2 text-sm leading-relaxed text-secondary">
                              Starts and restarts are now gated by six hard readiness checks.
                            </p>
                          </div>
                          <StatusBadge tone={readinessContract.allReady ? 'success' : 'warning'}>
                            {readinessContract.allReady ? 'Ready to start' : 'Execution gated'}
                          </StatusBadge>
                        </div>
                        <p className="mt-3 text-sm font-semibold text-on-surface">
                          {readinessContract.summary}
                        </p>
                        {primaryReadinessGate ? (
                          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                            <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-800">
                              Blocking gate
                            </p>
                            <p className="mt-2 text-sm font-semibold text-amber-950">
                              {primaryReadinessGate.label}
                            </p>
                            <p className="mt-2 text-xs leading-relaxed text-amber-800">
                              {primaryReadinessGate.blockingReason ||
                                primaryReadinessGate.nextRequiredAction ||
                                primaryReadinessGate.summary}
                            </p>
                          </div>
                        ) : null}
                      </div>

                      <div className="workspace-meta-card">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="workspace-meta-label">Task projection</p>
                            <p className="mt-2 text-sm leading-relaxed text-secondary">
                              Lower-level workflow task records stay visible here so you can keep
                              operating from Work.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => navigate('/tasks')}
                            className="enterprise-button enterprise-button-secondary"
                          >
                            Open tasks
                          </button>
                        </div>
                        {selectedTasks.length === 0 ? (
                          <p className="mt-3 text-sm leading-relaxed text-secondary">
                            No workflow-managed tasks are linked to this work item yet.
                          </p>
                        ) : (
                          <div className="mt-4 space-y-2">
                            {selectedTasks.slice(0, 3).map(task => (
                              <button
                                key={task.id}
                                type="button"
                                onClick={() =>
                                  navigate(`/tasks?taskId=${encodeURIComponent(task.id)}`)
                                }
                                className="w-full rounded-2xl border border-outline-variant/25 bg-white px-4 py-3 text-left transition hover:border-primary/20 hover:bg-primary/5"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-sm font-semibold text-on-surface">
                                    {task.title}
                                  </p>
                                  <StatusBadge tone={getStatusTone(task.status)}>
                                    {task.status}
                                  </StatusBadge>
                                </div>
                                <p className="mt-2 text-xs leading-relaxed text-secondary">
                                  {task.workflowStepId || 'Workflow task'} • {task.agent}
                                </p>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {selectedAgent ? (
                      <div className="grid gap-3 xl:grid-cols-3">
                        <div className="workspace-meta-card">
                          <p className="workspace-meta-label">Tool policy</p>
                          <p className="mt-2 text-sm font-semibold text-on-surface">
                            {selectedAgent.rolePolicy?.summary || 'Use approved tools only.'}
                          </p>
                          <p className="mt-2 text-xs leading-relaxed text-secondary">
                            {(selectedAgent.rolePolicy?.allowedToolIds || selectedAgent.preferredToolIds || [])
                              .slice(0, 4)
                              .join(', ') || 'No preferred tools recorded'}
                          </p>
                        </div>
                        <div className="workspace-meta-card">
                          <p className="workspace-meta-label">Memory scope</p>
                          <p className="mt-2 text-sm font-semibold text-on-surface">
                            {selectedAgent.memoryScope?.summary || 'Capability context and current work state.'}
                          </p>
                          <p className="mt-2 text-xs leading-relaxed text-secondary">
                            {selectedAgent.memoryScope?.scopeLabels.join(' • ') || 'Capability briefing • Work item context'}
                          </p>
                        </div>
                        <div className="workspace-meta-card">
                          <p className="workspace-meta-label">Quality bar</p>
                          <p className="mt-2 text-sm font-semibold text-on-surface">
                            {selectedAgent.qualityBar?.label || 'Execution quality'}
                          </p>
                          <p className="mt-2 text-xs leading-relaxed text-secondary">
                            {selectedAgent.evalProfile?.summary || selectedAgent.qualityBar?.summary || 'The specialist should leave usable evidence and clear next steps.'}
                          </p>
                        </div>
                      </div>
                    ) : null}

                    <InteractionTimeline
                      feed={selectedInteractionFeed}
                      maxItems={12}
                      title="Attempt story"
                      emptyMessage="This work item has not produced a linked interaction story yet."
                      onOpenArtifact={handleOpenArtifactFromTimeline}
                      onOpenRun={runId => void handleOpenRunFromTimeline(runId)}
                      onOpenTask={handleOpenTaskFromTimeline}
                    />

                    {selectedAttentionReason && (
                      <div className="workspace-inline-alert workspace-inline-alert-warning">
                        <AlertCircle size={18} className="mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em]">
                            {selectedAttentionLabel}
                          </p>
                          <p className="mt-2 text-sm font-semibold leading-relaxed">
                            {selectedAttentionReason}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                            <span>
                              Requested by:{' '}
                              <strong>
                                {agentsById.get(selectedAttentionRequestedBy || '')?.name ||
                                  selectedAttentionRequestedBy ||
                                  'System'}
                              </strong>
                            </span>
                            <span>
                              Since: <strong>{formatTimestamp(selectedAttentionTimestamp)}</strong>
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

	                    {(selectedCanGuideBlockedAgent || selectedOpenWait || requestChangesIsAvailable) && (
	                      <div
	                        id="orchestrator-guidance"
	                        className="workspace-meta-card border-outline-variant/30 bg-white/90"
	                      >
	                        <div className="flex flex-wrap items-start justify-between gap-3">
	                          <div>
	                            <p className="workspace-meta-label">Agent guidance</p>
	                            <p className="mt-2 text-sm leading-relaxed text-secondary">
                              {selectedOpenWait
                                ? 'Use this note to guide the agent before the run continues. Approval, human input, and conflict decisions all carry this guidance forward.'
                                : selectedCanGuideBlockedAgent
                                  ? 'The item is blocked. Add what changed and how the agent should retry, then restart from the current phase.'
                                  : 'Use this note field for approvals, human input, restart notes, or cancellation reasons.'}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {selectedCanGuideBlockedAgent ? (
                              <button
                                type="button"
                                onClick={() => void handleGuideAndRestart()}
                                disabled={!canGuideAndRestart || busyAction !== null}
                                className="enterprise-button enterprise-button-brand-muted disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {busyAction === 'guideRestart' ? (
                                  <LoaderCircle size={16} className="animate-spin" />
                                ) : (
                                  <ArrowRight size={16} />
                                )}
                                Guide agent and restart
                              </button>
                            ) : null}
                            {selectedOpenWait?.type === 'APPROVAL' ? (
                              <button
                                type="button"
                                onMouseDown={handleApprovalReviewMouseDown}
                                onClick={handleOpenApprovalReview}
                                className="enterprise-button enterprise-button-secondary"
                              >
                                <ShieldCheck size={16} />
                                Open approval review
                              </button>
                            ) : null}
                            {selectedOpenWait && selectedOpenWait.type !== 'APPROVAL' ? (
                              <button
                                type="button"
                                onClick={() => void handleResolveWait()}
                                disabled={!canResolveSelectedWait || busyAction !== null}
                                className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {busyAction === 'resolve' ? (
                                  <LoaderCircle size={16} className="animate-spin" />
                                ) : (
                                  <ShieldCheck size={16} />
                                )}
                                {actionButtonLabel}
                              </button>
                            ) : null}
                          </div>
                        </div>
                        {selectedFailureReason &&
                        selectedWorkItem?.status === 'BLOCKED' &&
                        !selectedOpenWait ? (
                          <div className="mt-3 rounded-2xl border border-red-200/80 bg-red-50/60 px-4 py-3">
                            <p className="workspace-meta-label">Latest failure from engine</p>
                            <p className="mt-2 text-sm leading-relaxed text-on-surface">
                              {selectedFailureReason}
                            </p>
                          </div>
                        ) : null}
                        {selectedCanGuideBlockedAgent && selectedAttentionReason && (
                          <div className="mt-3 rounded-2xl border border-amber-200/80 bg-amber-50/60 px-4 py-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="workspace-meta-label">Current blocker from agent</p>
                                <p className="mt-2 text-sm leading-relaxed text-on-surface">
                                  {selectedAttentionReason}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setResolutionNote(current =>
                                    current.trim()
                                      ? `${buildBlockedGuidanceSeed(selectedAttentionReason)}${current.trim()}`
                                      : buildBlockedGuidanceSeed(selectedAttentionReason),
                                  )
                                }
                                disabled={!canRestartWorkItems}
                                className="enterprise-button enterprise-button-secondary"
                              >
                                <ArrowRight size={14} />
                                Use blocker in guidance
                              </button>
                            </div>
                          </div>
                        )}
                        <textarea
                          ref={resolutionNoteRef}
                          value={resolutionNote}
                          onChange={event => setResolutionNote(event.target.value)}
                          placeholder={resolutionPlaceholder}
                          className="field-textarea mt-3 h-28 bg-white"
                        />
                        {guidanceSuggestions.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {guidanceSuggestions.map(suggestion => (
                              <button
                                key={suggestion}
                                type="button"
                                onClick={() =>
                                  setResolutionNote(current =>
                                    current.trim()
                                      ? `${current.trim()}\n- ${suggestion}`
                                      : `- ${suggestion}`,
                                  )
                                }
                                className="rounded-full border border-outline-variant/30 bg-surface-container-low px-3 py-1.5 text-xs font-medium text-secondary transition-colors hover:border-primary/20 hover:text-primary"
                              >
                                {suggestion}
                              </button>
                            ))}
                          </div>
                        )}
                        {requestChangesIsAvailable && (
                          <p className="mt-2 text-xs text-secondary">
                            Review notes entered here also carry into the approval review window.
                          </p>
                        )}
                        {selectedCanGuideBlockedAgent && !resolutionNote.trim() && (
                          <p className="mt-2 text-xs font-medium text-amber-700">
                            Add operator guidance above before restarting the blocked work item.
                          </p>
                        )}
                        {resolutionIsRequired && !resolutionNote.trim() && selectedOpenWait && (
                          <p className="mt-2 text-xs font-medium text-amber-700">
                            Add the missing detail above to unblock this work item and continue execution.
                          </p>
                        )}
                        {requestChangesIsAvailable && !resolutionNote.trim() && (
                          <p className="mt-2 text-xs font-medium text-amber-700">
                            Requesting changes requires review notes.
                          </p>
                        )}
                      </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="workspace-meta-card">
                        <p className="workspace-meta-label">Workflow</p>
                        <p className="workspace-meta-value">
                          {selectedWorkflow?.name || 'Workflow missing'}
                        </p>
                        <p className="mt-1 text-xs text-secondary">
                          {selectedWorkflow?.steps.length || 0} steps staged across SDLC lanes
                        </p>
                      </div>
                      <div className="workspace-meta-card">
                        <p className="workspace-meta-label">Current Step</p>
                        <p className="workspace-meta-value">
                          {selectedCurrentStep?.name || 'Awaiting orchestration'}
                        </p>
                        <p className="mt-1 text-xs text-secondary">
                          {selectedCurrentStep?.stepType
                            ? formatEnumLabel(selectedCurrentStep.stepType)
                            : 'Not assigned yet'}
                        </p>
                      </div>
                      <div className="workspace-meta-card">
                        <p className="workspace-meta-label">Active Agent</p>
                        <p className="workspace-meta-value">
                          {selectedAgent?.name || 'Unassigned'}
                        </p>
                        <p className="mt-1 text-xs text-secondary">
                          {selectedAgent?.role || 'No agent has been activated for this step yet.'}
                        </p>
                      </div>
                      <div className="workspace-meta-card">
                        <p className="workspace-meta-label">Current Run</p>
                        <p className="workspace-meta-value">
                          {currentRun
                            ? `Attempt ${currentRun.attemptNumber}`
                            : 'No run started yet'}
                        </p>
                        <p className="mt-1 text-xs text-secondary">
                          {currentRun
                            ? `Started ${formatTimestamp(currentRun.startedAt || currentRun.createdAt)}`
                            : 'Stage the item and start execution to create a durable run.'}
                        </p>
                      </div>
                    </div>

                    {selectedWorkItem && (
                      <div className="workspace-meta-card">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="workspace-meta-label">Shared branch collaboration</p>
                            <p className="mt-2 text-sm font-semibold text-on-surface">
                              {selectedSharedBranch?.sharedBranch ||
                                'No shared branch has been prepared for this work item yet.'}
                            </p>
                            <p className="mt-2 text-sm leading-relaxed text-secondary">
                              {selectedExecutionRepository
                                ? `${selectedExecutionRepository.label} · base ${
                                    selectedSharedBranch?.baseBranch ||
                                    selectedExecutionRepository.defaultBranch
                                  }${selectedExecutionRepository.localRootHint ? ` · ${selectedExecutionRepository.localRootHint}` : ''}`
                                : 'Execution defaults now belong to the work item, not the capability-wide local workspace.'}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void handleInitializeExecutionContext()}
                              disabled={!canInitializeExecutionContext || busyAction !== null}
                              className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {busyAction === 'initExecutionContext' ? (
                                <LoaderCircle size={16} className="animate-spin" />
                              ) : (
                                <WorkflowIcon size={16} />
                              )}
                              {selectedEffectiveExecutionContext ? 'Refresh context' : 'Initialize context'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleCreateSharedBranch()}
                              disabled={!canCreateSharedBranch || busyAction !== null}
                              className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {busyAction === 'createSharedBranch' ? (
                                <LoaderCircle size={16} className="animate-spin" />
                              ) : (
                                <ArrowRight size={16} />
                              )}
                              {selectedSharedBranch?.status === 'ACTIVE'
                                ? 'Re-open branch'
                                : 'Create shared branch'}
                            </button>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          <div className="rounded-2xl border border-outline-variant/30 bg-white/85 px-4 py-3">
                            <p className="workspace-meta-label">Primary repository</p>
                            <p className="mt-2 text-sm font-semibold text-on-surface">
                              {selectedExecutionRepository?.label || 'Not attached'}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-outline-variant/30 bg-white/85 px-4 py-3">
                            <p className="workspace-meta-label">Active writer</p>
                            <p className="mt-2 text-sm font-semibold text-on-surface">
                              {selectedActiveWriter?.name ||
                                selectedEffectiveExecutionContext?.activeWriterUserId ||
                                'No one has claimed write control'}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-outline-variant/30 bg-white/85 px-4 py-3">
                            <p className="workspace-meta-label">Writer claim</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  void (currentActorOwnsWriteControl
                                    ? handleReleaseWriteControl()
                                    : handleClaimWriteControl())
                                }
                                disabled={busyAction !== null || !canControlWorkItems}
                                className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {busyAction === 'claimWriteControl' ||
                                busyAction === 'releaseWriteControl' ? (
                                  <LoaderCircle size={14} className="animate-spin" />
                                ) : (
                                  <User size={14} />
                                )}
                                {currentActorOwnsWriteControl
                                  ? 'Release write control'
                                  : 'Take write control'}
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-[1.1fr_0.9fr]">
                          <div className="rounded-2xl border border-outline-variant/30 bg-white/85 px-4 py-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="workspace-meta-label">Latest handoff</p>
                                <p className="mt-2 text-sm leading-relaxed text-secondary">
                                  {latestSelectedHandoff?.summary ||
                                    'Capture a handoff packet when another stakeholder needs to continue this same shared branch.'}
                                </p>
                              </div>
                              {latestSelectedHandoff?.acceptedAt ? (
                                <StatusBadge tone="success">Accepted</StatusBadge>
                              ) : latestSelectedHandoff ? (
                                <StatusBadge tone="warning">Pending acceptance</StatusBadge>
                              ) : (
                                <StatusBadge tone="neutral">No packet</StatusBadge>
                              )}
                            </div>
                            {latestSelectedHandoff?.recommendedNextStep ? (
                              <p className="mt-3 text-xs leading-relaxed text-secondary">
                                Next: {latestSelectedHandoff.recommendedNextStep}
                              </p>
                            ) : null}
                          </div>
                          <div className="rounded-2xl border border-outline-variant/30 bg-white/85 px-4 py-3">
                            <p className="workspace-meta-label">Handoff actions</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void handleCreateHandoff()}
                                disabled={!resolutionNote.trim() || busyAction !== null || !canControlWorkItems}
                                className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {busyAction === 'createHandoff' ? (
                                  <LoaderCircle size={14} className="animate-spin" />
                                ) : (
                                  <Send size={14} />
                                )}
                                Capture handoff
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleAcceptLatestHandoff()}
                                disabled={!latestSelectedHandoff || busyAction !== null || !canControlWorkItems}
                                className="enterprise-button enterprise-button-brand-muted disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {busyAction === 'acceptHandoff' ? (
                                  <LoaderCircle size={14} className="animate-spin" />
                                ) : (
                                  <ShieldCheck size={14} />
                                )}
                                Accept latest handoff
                              </button>
                            </div>
                            <p className="mt-3 text-xs leading-relaxed text-secondary">
                              Use the guidance note above as the handoff summary so the next stakeholder inherits the branch context, artifacts, and next step clearly.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedCompiledStepContext && (
                      <div className="grid gap-3">
                        <div className="workspace-meta-card">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="workspace-meta-label">Current step contract</p>
                              <p className="mt-2 text-sm font-semibold text-on-surface">
                                {selectedCompiledStepContext.objective}
                              </p>
                              <p className="mt-2 text-sm leading-relaxed text-secondary">
                                {selectedCompiledStepContext.description ||
                                  selectedCompiledStepContext.executionNotes ||
                                  'The engine compiled this step into a bounded execution contract.'}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <StatusBadge
                                tone={
                                  selectedCompiledStepContext.executionBoundary
                                    .workspaceMode === 'APPROVED_WRITE'
                                    ? 'warning'
                                    : selectedCompiledStepContext.executionBoundary
                                        .workspaceMode === 'READ_ONLY'
                                    ? 'info'
                                    : 'neutral'
                                }
                              >
                                {selectedCompiledStepContext.executionBoundary.workspaceMode.replace(
                                  /_/g,
                                  ' ',
                                )}
                              </StatusBadge>
                              <StatusBadge
                                tone={
                                  selectedCompiledStepContext.executionBoundary
                                    .requiresHumanApproval
                                    ? 'warning'
                                    : 'success'
                                }
                              >
                                {selectedCompiledStepContext.executionBoundary
                                  .requiresHumanApproval
                                  ? 'Approval-aware'
                                  : 'Engine-managed'}
                              </StatusBadge>
                            </div>
                          </div>

                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-2xl border border-outline-variant/30 bg-white/85 px-4 py-3">
                              <p className="workspace-meta-label">Allowed tools</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {selectedCompiledStepContext.executionBoundary.allowedToolIds
                                  .length > 0 ? (
                                  selectedCompiledStepContext.executionBoundary.allowedToolIds.map(
                                    toolId => (
                                      <StatusBadge key={toolId} tone="info">
                                        {formatEnumLabel(toolId)}
                                      </StatusBadge>
                                    ),
                                  )
                                ) : (
                                  <span className="text-sm text-secondary">
                                    No tools for this step
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="rounded-2xl border border-outline-variant/30 bg-white/85 px-4 py-3">
                              <p className="workspace-meta-label">Next allowed actions</p>
                              <ul className="mt-2 space-y-1 text-xs leading-relaxed text-secondary">
                                {selectedCompiledStepContext.nextActions.map(action => (
                                  <li key={action} className="flex gap-2">
                                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                                    <span>{action}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>

                          {selectedCompiledStepContext.ownership && (
                            <div className="mt-3 grid gap-3 sm:grid-cols-3">
                              <div className="rounded-2xl border border-outline-variant/30 bg-white/85 px-4 py-3">
                                <p className="workspace-meta-label">Primary owner</p>
                                <p className="mt-2 text-sm font-semibold text-on-surface">
                                  {selectedCompiledStepContext.ownership.stepOwnerTeamId ||
                                  selectedCompiledStepContext.ownership.phaseOwnerTeamId
                                    ? workspaceTeamsById.get(
                                        selectedCompiledStepContext.ownership.stepOwnerTeamId ||
                                          selectedCompiledStepContext.ownership.phaseOwnerTeamId ||
                                          '',
                                      )?.name ||
                                      selectedCompiledStepContext.ownership.stepOwnerTeamId ||
                                      selectedCompiledStepContext.ownership.phaseOwnerTeamId
                                    : 'Phase default'}
                                </p>
                                <p className="mt-1 text-xs text-secondary">
                                  Current queue routing follows this team unless an operator claim is active.
                                </p>
                              </div>
                              <div className="rounded-2xl border border-outline-variant/30 bg-white/85 px-4 py-3">
                                <p className="workspace-meta-label">Approval routing</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {selectedCompiledStepContext.ownership.approvalTeamIds.length > 0 ? (
                                    selectedCompiledStepContext.ownership.approvalTeamIds.map(
                                      teamId => (
                                        <StatusBadge key={teamId} tone="warning">
                                          {workspaceTeamsById.get(teamId)?.name || teamId}
                                        </StatusBadge>
                                      ),
                                    )
                                  ) : (
                                    <span className="text-sm text-secondary">
                                      No explicit approval team override
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="rounded-2xl border border-outline-variant/30 bg-white/85 px-4 py-3">
                                <p className="workspace-meta-label">Escalation / handoff</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {selectedCompiledStepContext.ownership.escalationTeamIds.length > 0 ? (
                                    selectedCompiledStepContext.ownership.escalationTeamIds.map(
                                      teamId => (
                                        <StatusBadge key={teamId} tone="danger">
                                          {workspaceTeamsById.get(teamId)?.name || teamId}
                                        </StatusBadge>
                                      ),
                                    )
                                  ) : (
                                    <StatusBadge tone="neutral">No escalation teams</StatusBadge>
                                  )}
                                  {selectedCompiledStepContext.ownership.requireHandoffAcceptance ? (
                                    <StatusBadge tone="info">Handoff acceptance required</StatusBadge>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="workspace-meta-card">
                            <div className="flex items-center justify-between gap-3">
                              <p className="workspace-meta-label">Required inputs</p>
                              <StatusBadge
                                tone={
                                  selectedCompiledStepContext.missingInputs.length > 0
                                    ? 'warning'
                                    : 'success'
                                }
                              >
                                {selectedCompiledStepContext.missingInputs.length > 0
                                  ? `${selectedCompiledStepContext.missingInputs.length} missing`
                                  : 'Ready'}
                              </StatusBadge>
                            </div>
                            {renderStructuredInputs(
                              selectedCompiledStepContext.requiredInputs,
                              'No structured inputs are declared for this step.',
                            )}
                          </div>

                          <div className="workspace-meta-card">
                            <p className="workspace-meta-label">Artifact checklist</p>
                            {renderArtifactChecklist(
                              selectedCompiledStepContext.artifactChecklist,
                            )}
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="workspace-meta-card">
                            <p className="workspace-meta-label">Agent suggested inputs</p>
                            <p className="mt-2 text-xs leading-relaxed text-secondary">
                              Advisory defaults from the assigned agent contract. These do not
                              block execution unless the workflow step explicitly requires them.
                            </p>
                            {renderAgentArtifactExpectations(
                              selectedCompiledStepContext.agentSuggestedInputs,
                              'No advisory input suggestions are attached to this agent.',
                              'neutral',
                            )}
                          </div>

                          <div className="workspace-meta-card">
                            <p className="workspace-meta-label">Agent expected outputs</p>
                            <p className="mt-2 text-xs leading-relaxed text-secondary">
                              Default outputs the assigned agent is shaped to produce. Workflow
                              artifact contracts still remain the execution source of truth.
                            </p>
                            {renderAgentArtifactExpectations(
                              selectedCompiledStepContext.agentExpectedOutputs,
                              'No default output expectations are attached to this agent.',
                              'brand',
                            )}
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="workspace-meta-card">
                            <p className="workspace-meta-label">Completion checklist</p>
                            {selectedCompiledStepContext.completionChecklist.length > 0 ? (
                              <ul className="mt-3 space-y-1 text-xs leading-relaxed text-secondary">
                                {selectedCompiledStepContext.completionChecklist.map(item => (
                                  <li key={item} className="flex gap-2">
                                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                                    <span>{item}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="mt-3 text-xs leading-relaxed text-secondary">
                                This step does not define an explicit completion checklist yet.
                              </p>
                            )}
                          </div>

                          <div className="workspace-meta-card">
                            <p className="workspace-meta-label">Memory boundary</p>
                            {selectedCompiledStepContext.memoryBoundary.length > 0 ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {selectedCompiledStepContext.memoryBoundary.map(item => (
                                  <StatusBadge key={item} tone="neutral">
                                    {item}
                                  </StatusBadge>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-3 text-xs leading-relaxed text-secondary">
                                The engine will rely on retrieved capability memory and current
                                step context.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedCompiledWorkItemPlan && (
                      <div className="workspace-meta-card">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="workspace-meta-label">Compiled work plan</p>
                            <p className="mt-2 text-sm leading-relaxed text-secondary">
                              {selectedCompiledWorkItemPlan.planSummary}
                            </p>
                          </div>
                          <StatusBadge tone="info">
                            {selectedCompiledWorkItemPlan.stepSequence.length} steps
                          </StatusBadge>
                        </div>
                      </div>
                    )}

                    <div className="workspace-meta-card">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="workspace-meta-label">Recent artifacts</p>
                          <p className="mt-2 text-sm leading-relaxed text-secondary">
                            Keep the latest working documents close while you operate the step.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setDetailTab('artifacts')}
                          className="enterprise-button enterprise-button-secondary"
                        >
                          Open artifacts
                        </button>
                      </div>

                      {selectedArtifacts.length === 0 ? (
                        <p className="mt-3 text-sm leading-relaxed text-secondary">
                          No run artifacts are attached to this work item yet.
                        </p>
                      ) : (
                        <div className="mt-4 grid gap-3 lg:grid-cols-3">
                          {selectedArtifacts.slice(0, 3).map(artifact => (
                            <button
                              key={artifact.id}
                              type="button"
                              onClick={() => {
                                setSelectedArtifactId(artifact.id);
                                setDetailTab('artifacts');
                              }}
                              className={cn(
                                'rounded-[1.35rem] border border-outline-variant/30 bg-white px-4 py-4 text-left transition-colors hover:border-primary/30 hover:bg-primary/5',
                                selectedArtifact?.id === artifact.id &&
                                  'border-primary/35 bg-primary/5',
                              )}
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-on-surface">
                                  {artifact.name}
                                </p>
                                <StatusBadge tone="brand">
                                  {artifact.direction || 'OUTPUT'}
                                </StatusBadge>
                              </div>
                              <p className="mt-2 text-xs leading-relaxed text-secondary">
                                {compactMarkdownPreview(
                                  artifact.summary ||
                                    artifact.description ||
                                    `${artifact.type} · ${artifact.version}`,
                                  150,
                                )}
                              </p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="workspace-meta-card">
                      <p className="workspace-meta-label">Tags and routing</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <StatusBadge tone="neutral">
                          {getWorkItemTaskTypeLabel(selectedWorkItem.taskType)}
                        </StatusBadge>
                        {selectedWorkItem.tags.map(tag => (
                          <span key={tag}>
                            <StatusBadge tone="neutral">{tag}</StatusBadge>
                          </span>
                        ))}
                        {selectedWorkItem.tags.length === 0 && (
                          <span className="text-sm text-secondary">
                            No extra tags were attached to this work item.
                          </span>
                        )}
                      </div>
                      <p className="mt-3 text-xs leading-relaxed text-secondary">
                        {getWorkItemTaskTypeDescription(selectedWorkItem.taskType)}
                      </p>
                    </div>

                    <div className="workspace-meta-card">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="workspace-meta-label">Phase stakeholders & sign-off</p>
                          <p className="mt-2 text-sm leading-relaxed text-secondary">
                            These stakeholders are carried into phase-specific human documents and
                            sign-off records for this work item.
                          </p>
                        </div>
                        <StatusBadge tone={selectedCurrentPhaseStakeholders.length > 0 ? 'info' : 'neutral'}>
                          {selectedPhaseStakeholderAssignments.length > 0
                            ? `${selectedPhaseStakeholderAssignments.length} phases configured`
                            : 'No phase stakeholders'}
                        </StatusBadge>
                      </div>

                      <div className="mt-4 rounded-[1.25rem] border border-outline-variant/30 bg-white/80 px-4 py-3">
                        <p className="workspace-meta-label">
                          Current phase · {getLifecyclePhaseLabel(activeCapability, selectedWorkItem.phase)}
                        </p>
                        {selectedCurrentPhaseStakeholders.length > 0 ? (
                          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-secondary">
                            {selectedCurrentPhaseStakeholders.map((stakeholder, index) => (
                              <li
                                key={`${selectedWorkItem.phase}-${stakeholder.email || stakeholder.name}-${index}`}
                                className="flex gap-2"
                              >
                                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                                <span>{formatWorkItemPhaseStakeholderLine(stakeholder)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-3 text-xs leading-relaxed text-secondary">
                            No specific stakeholders were assigned for the current phase.
                          </p>
                        )}
                      </div>

                      {selectedPhaseStakeholderAssignments.length > 0 && (
                        <div className="mt-4 grid gap-3">
                          {selectedPhaseStakeholderAssignments.map(assignment => (
                            <div
                              key={assignment.phaseId}
                              className="rounded-[1.25rem] border border-outline-variant/20 bg-surface-container-low/35 px-4 py-3"
                            >
                              <p className="text-sm font-semibold text-on-surface">
                                {getLifecyclePhaseLabel(activeCapability, assignment.phaseId)}
                              </p>
                              <ul className="mt-2 space-y-1 text-xs leading-relaxed text-secondary">
                                {assignment.stakeholders.map((stakeholder, index) => (
                                  <li
                                    key={`${assignment.phaseId}-${stakeholder.email || stakeholder.name}-${index}`}
                                  >
                                    {formatWorkItemPhaseStakeholderLine(stakeholder)}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {detailTab === 'operate' && (
                  <div className="space-y-4">
                    {!runtimeReady && (
                      <div className="workspace-inline-alert workspace-inline-alert-warning">
                        <AlertCircle size={18} className="mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm font-semibold">Agent connection is not ready</p>
                          <p className="mt-1 text-sm leading-relaxed">
                            {runtimeError ||
                              'Configure the agent connection before starting or restarting execution.'}
                          </p>
                        </div>
                      </div>
                    )}

                    {actionError && (
                      <div className="workspace-inline-alert workspace-inline-alert-danger">
                        <AlertCircle size={18} className="mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm font-semibold">Action failed</p>
                          <p className="mt-1 text-sm leading-relaxed">{actionError}</p>
                        </div>
                      </div>
                    )}

	                    {selectedOpenWait && (
	                      <div className="workspace-inline-alert workspace-inline-alert-warning">
	                        <Clock3 size={18} className="mt-0.5 shrink-0" />
	                        <div>
	                          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em]">
	                            Waiting for {formatEnumLabel(selectedOpenWait.type)}
	                          </p>
	                          <div className="mt-2 rounded-2xl border border-outline-variant/25 bg-white/90 px-4 py-3">
	                            <MarkdownContent
	                              content={normalizeMarkdownishText(selectedOpenWait.message)}
	                            />
	                          </div>
	                        </div>
	                      </div>
	                    )}

	                    {selectedOpenWait?.type === 'INPUT' && (
	                      <div
	                        id="orchestrator-structured-input"
	                        className="workspace-meta-card border-amber-200/80 bg-amber-50/50"
	                      >
	                        <div className="flex flex-wrap items-start justify-between gap-3">
	                          <div>
	                            <p className="workspace-meta-label">Structured input request</p>
	                            <p className="mt-2 text-sm font-semibold text-on-surface">
	                              Fill the exact gaps the engine detected for this step
	                            </p>
	                          </div>
	                          <StatusBadge tone="warning">
	                            {selectedRequestedInputFields.length || 1} inputs
	                          </StatusBadge>
	                        </div>
	                        <div className="mt-4 flex flex-wrap gap-2">
	                          <button
	                            type="button"
	                            onClick={focusGuidanceComposer}
	                            className="enterprise-button enterprise-button-secondary"
	                          >
	                            Open input note
	                          </button>
	                          {hasMissingWorkspaceInput ? (
	                            <button
	                              type="button"
	                              onClick={() =>
	                                navigate('/capabilities/metadata#execution-policy')
	                              }
	                              className="enterprise-button enterprise-button-primary"
	                            >
	                              Configure workspace paths
	                            </button>
	                          ) : null}
	                        </div>

	                          {waitRequiresApprovedWorkspace ? (
	                            <div className="mt-4 rounded-2xl border border-outline-variant/25 bg-white/85 px-4 py-3">
	                              <p className="workspace-meta-label">Approved workspace path</p>
	                              {hasApprovedWorkspaceConfigured ? (
	                                <>
	                                  <p className="mt-2 text-xs leading-relaxed text-secondary">
	                                    Configured roots for this capability:
	                                  </p>
	                                  <ul className="mt-2 space-y-1 text-xs leading-relaxed text-secondary">
	                                    {approvedWorkspaceRoots.slice(0, 4).map(root => (
	                                      <li key={root} className="font-mono text-[0.72rem]">
	                                        {root}
	                                      </li>
	                                    ))}
	                                  </ul>
	                                  {approvedWorkspaceRoots.length > 4 ? (
	                                    <p className="mt-2 text-xs text-secondary">
	                                      +{approvedWorkspaceRoots.length - 4} more
	                                    </p>
	                                  ) : null}
	                                </>
	                              ) : (
	                                <p className="mt-2 text-xs leading-relaxed text-secondary">
	                                  No approved workspace paths are configured yet.
	                                </p>
	                              )}

	                              <p className="mt-3 text-xs leading-relaxed text-secondary">
	                                {hasApprovedWorkspaceConfigured
	                                  ? 'Add another local directory path if this work item needs a different codebase.'
	                                  : 'Add a readable local directory so the engine can safely run workspace tools.'}
	                              </p>
	                              <div className="mt-3 flex flex-wrap items-center gap-2">
	                                <input
	                                  value={approvedWorkspaceDraft}
	                                  onChange={event => {
	                                    setApprovedWorkspaceDraft(event.target.value);
	                                    setApprovedWorkspaceValidation(null);
	                                  }}
	                                  placeholder="/path/to/your/repo"
	                                  className="field-input min-w-[16rem] flex-1 bg-white"
	                                />
	                                <button
	                                  type="button"
	                                  onClick={() => void handleApproveWorkspacePath({ unblock: true })}
	                                  disabled={busyAction !== null}
	                                  className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
	                                >
	                                  {busyAction === 'approveWorkspacePath' ? (
	                                    <LoaderCircle size={16} className="animate-spin" />
	                                  ) : (
	                                    <ShieldCheck size={16} />
	                                  )}
	                                  Approve and continue
	                                </button>
	                                <button
	                                  type="button"
	                                  onClick={() => void handleApproveWorkspacePath()}
	                                  disabled={busyAction !== null}
	                                  className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
	                                >
	                                  Approve only
	                                </button>
	                              </div>
	                              <div className="mt-3 flex flex-wrap gap-2">
	                                {selectedExecutionRepository?.localRootHint ? (
	                                  <button
	                                    type="button"
	                                    onClick={() => {
	                                      setApprovedWorkspaceDraft(selectedExecutionRepository.localRootHint || '');
	                                      setApprovedWorkspaceValidation(null);
	                                    }}
	                                    className="enterprise-button enterprise-button-secondary"
	                                  >
	                                    Use repo root hint
	                                  </button>
	                                ) : null}
	                                {approvedWorkspaceRoots.slice(0, 2).map(root => (
	                                  <button
	                                    key={root}
	                                    type="button"
	                                    onClick={() => {
	                                      setApprovedWorkspaceDraft(root);
	                                      setApprovedWorkspaceValidation(null);
	                                    }}
	                                    className="enterprise-button enterprise-button-secondary"
	                                  >
	                                    {root}
	                                  </button>
	                                ))}
	                                {activeCapability.localDirectories.slice(0, 2).map(root => (
	                                  <button
	                                    key={root}
	                                    type="button"
	                                    onClick={() => {
	                                      setApprovedWorkspaceDraft(root);
	                                      setApprovedWorkspaceValidation(null);
	                                    }}
	                                    className="enterprise-button enterprise-button-secondary"
	                                  >
	                                    {root}
	                                  </button>
	                                ))}
	                              </div>
	                              {approvedWorkspaceValidation ? (
	                                <p
	                                  className={cn(
	                                    'mt-2 text-xs font-medium',
	                                    approvedWorkspaceValidation.valid
	                                      ? 'text-emerald-700'
	                                      : 'text-amber-800',
	                                  )}
	                                >
	                                  {approvedWorkspaceValidation.message}
	                                </p>
	                              ) : null}
	                              {!canEditCapability ? (
	                                <p className="mt-2 text-xs font-medium text-amber-800">
	                                  Approving new paths requires capability edit access. Switch Current Operator (top right) to a workspace admin if needed.
	                                </p>
	                              ) : null}
	                            </div>
	                          ) : null}
	
	                        {renderStructuredInputs(
	                          selectedRequestedInputFields,
	                          'The step is waiting for operator input, but no structured field list was attached to this wait.',
                        )}
                      </div>
                    )}

                    {selectedOpenWait?.type === 'APPROVAL' && selectedCodeDiffArtifactId && (
                      <div className="workspace-meta-card border-primary/15 bg-primary/5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="workspace-meta-label">Code Diff Review</p>
                            <p className="mt-2 text-sm font-semibold text-on-surface">
                              Review developer changes before approving continuation
                            </p>
                          </div>
                          <StatusBadge tone="info">Diff attached</StatusBadge>
                        </div>

                        <p className="mt-3 text-sm leading-relaxed text-secondary">
                          {selectedCodeDiffArtifact?.summary ||
                            selectedOpenWait.payload?.codeDiffSummary ||
                            'This approval gate includes a code diff generated from the developer step.'}
                        </p>

                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          <div className="rounded-2xl border border-outline-variant/25 bg-white/90 px-4 py-3">
                            <p className="workspace-meta-label">Repositories</p>
                            <p className="mt-2 text-sm font-semibold text-on-surface">
                              {selectedCodeDiffRepositoryCount || 1}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-outline-variant/25 bg-white/90 px-4 py-3">
                            <p className="workspace-meta-label">Touched files</p>
                            <p className="mt-2 text-sm font-semibold text-on-surface">
                              {selectedCodeDiffTouchedFileCount || 'Tracked in diff'}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-outline-variant/25 bg-white/90 px-4 py-3">
                            <p className="workspace-meta-label">Review surface</p>
                            <button
                              type="button"
                              onClick={() => setIsDiffReviewOpen(true)}
                              className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-primary"
                            >
                              Open full diff review
                              <ExternalLink size={14} />
                            </button>
                          </div>
                        </div>

                        {!selectedCodeDiffArtifact && (
                          <p className="mt-4 text-sm leading-relaxed text-secondary">
                            The approval is waiting on a stored code diff artifact, but it
                            is not loaded in the current workspace snapshot yet.
                          </p>
                        )}
                      </div>
                    )}

                    {selectedOpenWait?.type === 'CONFLICT_RESOLUTION' && (
                      <div className="workspace-meta-card border-red-200/70 bg-red-50/55">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="workspace-meta-label">
                              Contrarian Review
                            </p>
                            <p className="mt-2 text-sm font-semibold text-on-surface">
                              Advisory adversarial pass before continuation
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <StatusBadge tone={selectedContrarianReviewTone}>
                              {selectedContrarianReview
                                ? selectedContrarianReview.status === 'READY'
                                  ? 'Review ready'
                                  : selectedContrarianReview.status === 'PENDING'
                                    ? 'Review pending'
                                    : 'Review unavailable'
                                : 'Review unavailable'}
                            </StatusBadge>
                            {selectedContrarianReview && (
                              <StatusBadge tone={selectedContrarianReviewTone}>
                                {selectedContrarianReview.severity}
                              </StatusBadge>
                            )}
                          </div>
                        </div>

                        {!selectedContrarianReview && (
                          <p className="mt-3 text-sm leading-relaxed text-secondary">
                            No contrarian payload is attached to this wait yet. You can
                            still resolve the conflict manually.
                          </p>
                        )}

                        {selectedContrarianReview?.status === 'PENDING' && (
                          <p className="mt-3 text-sm leading-relaxed text-secondary">
                            The Contrarian Reviewer is challenging the assumptions behind
                            this conflict wait. The operator decision remains available
                            while the advisory pass completes.
                          </p>
                        )}

                        {selectedContrarianReview?.status === 'ERROR' && (
                          <div className="mt-3 rounded-2xl border border-red-200 bg-white/80 px-4 py-3">
                            <p className="text-sm font-semibold text-red-800">
                              Review unavailable
                            </p>
                            <p className="mt-1 text-sm leading-relaxed text-secondary">
                              {selectedContrarianReview.lastError ||
                                selectedContrarianReview.summary}
                            </p>
                          </div>
                        )}

                        {selectedContrarianReviewIsReady && selectedContrarianReview && (
                          <div className="mt-4 space-y-4">
                            <p className="text-sm leading-relaxed text-on-surface">
                              {selectedContrarianReview.summary}
                            </p>

                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="rounded-2xl border border-outline-variant/25 bg-white/80 px-4 py-3">
                                <p className="workspace-meta-label">Recommendation</p>
                                <p className="mt-2 text-sm font-semibold text-on-surface">
                                  {formatEnumLabel(
                                    selectedContrarianReview.recommendation,
                                  )}
                                </p>
                              </div>
                              <div className="rounded-2xl border border-outline-variant/25 bg-white/80 px-4 py-3">
                                <p className="workspace-meta-label">Sources</p>
                                <p className="mt-2 text-sm font-semibold text-on-surface">
                                  {selectedContrarianReview.sourceDocumentIds?.length || 0}{' '}
                                  documents
                                </p>
                              </div>
                            </div>

                            {selectedContrarianReview.suggestedResolution && (
                              <button
                                type="button"
                                onClick={() =>
                                  setResolutionNote(
                                    selectedContrarianReview.suggestedResolution || '',
                                  )
                                }
                                className="enterprise-button enterprise-button-secondary"
                              >
                                <ShieldCheck size={16} />
                                Use suggested resolution
                              </button>
                            )}

                            <div className="grid gap-3 lg:grid-cols-2">
                              <div className="rounded-2xl border border-outline-variant/25 bg-white/80 px-4 py-3">
                                <p className="workspace-meta-label">
                                  Challenged assumptions
                                </p>
                                {renderReviewList(
                                  selectedContrarianReview.challengedAssumptions || [],
                                  'No assumptions were challenged.',
                                )}
                              </div>
                              <div className="rounded-2xl border border-outline-variant/25 bg-white/80 px-4 py-3">
                                <p className="workspace-meta-label">Risks</p>
                                {renderReviewList(
                                  selectedContrarianReview.risks || [],
                                  'No major risks were flagged.',
                                )}
                              </div>
                              <div className="rounded-2xl border border-outline-variant/25 bg-white/80 px-4 py-3">
                                <p className="workspace-meta-label">
                                  Missing evidence
                                </p>
                                {renderReviewList(
                                  selectedContrarianReview.missingEvidence || [],
                                  'No missing evidence was identified.',
                                )}
                              </div>
                              <div className="rounded-2xl border border-outline-variant/25 bg-white/80 px-4 py-3">
                                <p className="workspace-meta-label">
                                  Alternative paths
                                </p>
                                {renderReviewList(
                                  selectedContrarianReview.alternativePaths || [],
                                  'No alternative path was proposed.',
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="workspace-meta-card">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="workspace-meta-label">Direct stage control</p>
                          <p className="mt-2 text-sm leading-relaxed text-secondary">
                            Open a focused Codex-style work window for this stage, chat directly with the assigned agent, and continue the workflow once you are satisfied with the stage guidance or output direction.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setIsStageControlOpen(true)}
                          disabled={!selectedCanTakeControl}
                          className="enterprise-button enterprise-button-brand-muted disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <MessageSquareText size={16} />
                          Take control
                        </button>
                      </div>
                      {!selectedAgent && (
                        <p className="mt-3 text-xs text-secondary">
                          This work item does not currently have a resolved stage agent to chat with.
                        </p>
                      )}
                      {selectedAgent && (
                        <p className="mt-3 text-xs text-secondary">
                          Direct control will stay scoped to <strong>{selectedAgent.name}</strong> and the current work item stage.
                        </p>
                      )}
                    </div>

                    <ErrorBoundary
                      resetKey={`${selectedWorkItem.id}:${selectedAgent?.id || 'none'}:${selectedCurrentStep?.id || 'stage'}:${detailTab}`}
                      title="Direct agent chat could not render"
                      description="The inline stage chat hit an unexpected UI problem. The rest of the workbench stays available, and you can still use Full Chat or Take control while we keep this route stable."
                    >
                      <div className="workspace-meta-card orchestrator-stage-chat-card">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="workspace-meta-label">Direct agent chat</p>
                            <p className="mt-2 text-sm leading-relaxed text-secondary">
                              Work with the current stage agent right here, ask what it plans to do,
                              clarify blockers, or steer the next attempt before you continue.
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void handleOpenFullChat()}
                              disabled={!selectedAgent}
                              className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Full Chat
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsStageControlOpen(true)}
                              disabled={!selectedCanTakeControl}
                              className="enterprise-button enterprise-button-brand-muted disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Take control
                            </button>
                          </div>
                        </div>

                        {!runtimeReady ? (
                          <p className="mt-4 text-sm leading-relaxed text-secondary">
                            Agent chat will unlock once the runtime connection is ready.
                          </p>
                        ) : !selectedAgent ? (
                          <p className="mt-4 text-sm leading-relaxed text-secondary">
                            This step does not have an assigned agent to chat with yet.
                          </p>
                        ) : (
                          <>
                            {stageChatSuggestedPrompts.length > 0 && (
                              <div className="mt-4 flex flex-wrap gap-2">
                                {stageChatSuggestedPrompts.map(prompt => (
                                  <button
                                    key={prompt}
                                    type="button"
                                    onClick={() => setStageChatInput(prompt)}
                                    className="rounded-full border border-outline-variant/30 bg-surface-container-low px-3 py-1.5 text-xs font-medium text-secondary transition-colors hover:border-primary/20 hover:text-primary"
                                  >
                                    {prompt}
                                  </button>
                                ))}
                              </div>
                            )}

                            <div
                              ref={stageChatThreadRef}
                              className="orchestrator-stage-chat-thread"
                              onScroll={event => {
                                const target = event.currentTarget;
                                const distanceFromBottom =
                                  target.scrollHeight - target.scrollTop - target.clientHeight;
                                stageChatStickToBottomRef.current = distanceFromBottom < 48;
                              }}
                            >
                              {selectedStageChatMessages.length === 0 && !stageChatDraft ? (
                                <div className="orchestrator-stage-chat-empty">
                                  Ask <strong>{selectedAgent.name}</strong> what is happening in{' '}
                                  <strong>{selectedCurrentStep?.name || 'this stage'}</strong>, what
                                  it needs, or which files and artifacts it plans to change.
                                </div>
                              ) : (
                                <>
                                  {selectedStageChatMessages.map(message => (
                                    <div
                                      key={message.id}
                                      className={cn(
                                        'orchestrator-stage-chat-message',
                                        message.role === 'user'
                                          ? 'orchestrator-stage-chat-message-user'
                                          : 'orchestrator-stage-chat-message-agent',
                                      )}
                                    >
                                      <div className="orchestrator-stage-chat-message-meta">
                                        <span className="inline-flex items-center gap-2">
                                          {message.role === 'user' ? (
                                            <User size={14} />
                                          ) : (
                                            <Bot size={14} />
                                          )}
                                          {message.role === 'user' ? 'You' : selectedAgent.name}
                                        </span>
                                        <span>{message.timestamp}</span>
                                      </div>
                                      <CopilotMessageBody
                                        content={message.content}
                                        tone={message.role === 'user' ? 'user' : 'agent'}
                                      />
                                      {message.deliveryState &&
                                      message.deliveryState !== 'clean' ? (
                                        <p className="mt-2 text-xs text-secondary">
                                          {message.deliveryState === 'recovered'
                                            ? 'Recovered draft'
                                            : 'Partial response'}
                                          {message.error ? ` · ${message.error}` : ''}
                                        </p>
                                      ) : null}
                                    </div>
                                  ))}
                                  {stageChatDraft && (
                                    <div className="orchestrator-stage-chat-message orchestrator-stage-chat-message-agent">
                                      <div className="orchestrator-stage-chat-message-meta">
                                        <span className="inline-flex items-center gap-2">
                                          <Bot size={14} />
                                          {selectedAgent.name}
                                        </span>
                                        <span>Typing…</span>
                                      </div>
                                      <CopilotMessageBody content={stageChatDraft} tone="draft" />
                                    </div>
                                  )}
                                </>
                              )}
                            </div>

                            {stageChatError && (
                              <div className="mt-4 rounded-2xl border border-red-200/70 bg-red-50/70 px-4 py-3 text-sm text-red-900">
                                {stageChatError}
                              </div>
                            )}

                            <form
                              onSubmit={handleStageChatSend}
                              className="mt-4 space-y-3"
                            >
                              <textarea
                                value={stageChatInput}
                                onChange={event => setStageChatInput(event.target.value)}
                                placeholder={`Ask ${selectedAgent.name} about this stage, blockers, files, artifacts, or next steps.`}
                                className="field-textarea h-28 bg-white"
                              />
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <p className="text-xs leading-relaxed text-secondary">
                                  Scoped to <strong>{selectedWorkItem.id}</strong> and{' '}
                                  <strong>{selectedCurrentStep?.name || 'the active stage'}</strong>.
                                </p>
                                <button
                                  type="submit"
                                  disabled={!stageChatInput.trim() || isStageChatSending || !canWriteChat}
                                  className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  {isStageChatSending ? (
                                    <RefreshCw size={16} className="animate-spin" />
                                  ) : (
                                    <Send size={16} />
                                  )}
                                  Send to agent
                                </button>
                              </div>
                            </form>
                          </>
                        )}
                      </div>
                    </ErrorBoundary>

                    <div className="workspace-meta-card">
                      <p className="workspace-meta-label">Reset target</p>
                      <p className="workspace-meta-value">
                        {selectedResetStep?.name || 'Workflow start'}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-secondary">
                        Reset moves the work item back to{' '}
                        <strong>{getPhaseMeta(selectedResetPhase).label}</strong>
                        {selectedResetAgent
                          ? ` and restarts with ${selectedResetAgent.name}.`
                          : selectedResetStep?.agentId
                            ? ` and restarts with ${selectedResetStep.agentId}.`
                            : '.'}
                      </p>
                    </div>
                  </div>
                )}

                {detailTab === 'attempts' && (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="workspace-meta-card">
                        <p className="workspace-meta-label">Attempt</p>
                        <p className="workspace-meta-value">
                          {currentRun ? currentRun.attemptNumber : 0}
                        </p>
                        <p className="mt-1 text-xs text-secondary">
                          {currentRun ? RUN_STATUS_META[currentRun.status].label : 'No active run'}
                        </p>
                      </div>
                      <div className="workspace-meta-card">
                        <p className="workspace-meta-label">Wait state</p>
                        <p className="workspace-meta-value">
                          {selectedOpenWait
                            ? formatEnumLabel(selectedOpenWait.type)
                            : 'No open waits'}
                        </p>
                        <p className="mt-1 text-xs text-secondary">
                          {selectedOpenWait
                            ? `Opened ${formatTimestamp(selectedOpenWait.createdAt)}`
                            : 'Execution is not paused on approval, input, or conflict resolution.'}
                        </p>
                      </div>
                    </div>

                    <div className="workspace-meta-card">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="workspace-meta-label">What changed since last attempt?</p>
                          <p className="mt-2 text-sm leading-relaxed text-secondary">
                            Compare the current run with the previous attempt before restarting or approving.
                          </p>
                        </div>
                        <StatusBadge tone={previousRunSummary ? 'info' : 'neutral'}>
                          {previousRunSummary ? 'Comparison ready' : 'First attempt'}
                        </StatusBadge>
                      </div>

                      {attemptComparisonLines.length > 0 ? (
                        <ul className="mt-4 space-y-2 text-sm leading-relaxed text-secondary">
                          {attemptComparisonLines.map(line => (
                            <li key={line} className="flex gap-2">
                              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                              <span>{line}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-4 text-sm leading-relaxed text-secondary">
                          {previousRunSummary
                            ? 'No major delta was detected yet between the latest two attempts.'
                            : 'This work item has only one attempt so far.'}
                        </p>
                      )}
                    </div>

                    <div className="space-y-3">
                      {(selectedWorkflow?.steps || []).map(step => {
                        const runStep =
                          selectedRunSteps.find(
                            current => current.workflowStepId === step.id,
                          ) || null;

                        return (
                          <div key={step.id} className="orchestrator-step-row">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-on-surface">
                                  {step.name}
                                </p>
                                <StatusBadge tone={getStatusTone(step.phase)}>
                                  {getPhaseMeta(step.phase).label}
                                </StatusBadge>
                              </div>
                              <p className="mt-1 text-xs leading-relaxed text-secondary">
                                {step.action}
                              </p>
                              <p className="mt-2 text-xs text-secondary">
                                {agentsById.get(step.agentId)?.name || step.agentId} ·{' '}
                                {formatEnumLabel(step.stepType)}
                              </p>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <StatusBadge tone={getStatusTone(runStep?.status || 'PENDING')}>
                                {runStep?.status || 'PENDING'}
                              </StatusBadge>
                              <span className="text-xs text-secondary">
                                {runStep ? `${runStep.attemptCount} attempts` : 'Not started'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <AdvancedDisclosure
                      title="Advanced execution details"
                      description="Run events, tool activity, and worker milestones for deeper operator inspection."
                      storageKey="singularity.orchestrator.progress.advanced.open"
                      badge={
                        <StatusBadge tone="info">
                          {recentRunActivity.length} updates
                        </StatusBadge>
                      }
                    >
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="workspace-meta-card">
                          <p className="workspace-meta-label">Run events</p>
                          <p className="workspace-meta-value">{selectedRunEvents.length}</p>
                        </div>
                        <div className="workspace-meta-card">
                          <p className="workspace-meta-label">Tool actions</p>
                          <p className="workspace-meta-value">
                            {selectedRunDetail?.toolInvocations.length || 0}
                          </p>
                        </div>
                        <div className="workspace-meta-card">
                          <p className="workspace-meta-label">History</p>
                          <p className="workspace-meta-value">{selectedRunHistory.length} runs</p>
                        </div>
                      </div>

                      <div className="mt-4 workspace-meta-card">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="workspace-meta-label">Live agent activity</p>
                            <p className="mt-2 text-sm leading-relaxed text-secondary">
                              Safe execution milestones from the backend worker. This shows visible
                              orchestration progress, not private model reasoning.
                            </p>
                          </div>
                          <StatusBadge tone="info">
                            {recentRunActivity.length} recent updates
                          </StatusBadge>
                        </div>

                        <div className="mt-4 space-y-3">
                          {recentRunActivity.length === 0 ? (
                            <div className="rounded-2xl border border-outline-variant/35 bg-white px-4 py-4 text-sm text-secondary">
                              No live activity is recorded yet for this run.
                            </div>
                          ) : (
                            recentRunActivity.map(event => (
                              <div
                                key={event.id}
                                className="rounded-2xl border border-outline-variant/35 bg-white px-4 py-3"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-on-surface">
                                      {event.message}
                                    </p>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-secondary">
                                      <span>{formatTimestamp(event.timestamp)}</span>
                                      {typeof event.details?.toolId === 'string' ? (
                                        <span>Tool: {formatEnumLabel(event.details.toolId)}</span>
                                      ) : null}
                                      {typeof event.details?.model === 'string' ? (
                                        <span>Model: {event.details.model}</span>
                                      ) : null}
                                      {typeof event.details?.retrievalCount === 'number' ? (
                                        <span>
                                          {event.details.retrievalCount} references
                                        </span>
                                      ) : null}
                                      {typeof event.details?.waitType === 'string' ? (
                                        <span>
                                          Wait: {formatEnumLabel(event.details.waitType)}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                  <StatusBadge tone={getRunEventTone(event)}>
                                    {getRunEventLabel(event)}
                                  </StatusBadge>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </AdvancedDisclosure>
                  </div>
                )}

                {detailTab === 'artifacts' && (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="workspace-meta-card">
                        <p className="workspace-meta-label">Artifacts</p>
                        <p className="workspace-meta-value">{filteredArtifacts.length}</p>
                        <p className="mt-1 text-xs text-secondary">Captured for the latest run</p>
                      </div>
                      <div className="workspace-meta-card">
                        <p className="workspace-meta-label">Evidence tasks</p>
                        <p className="workspace-meta-value">{selectedTasks.length}</p>
                        <p className="mt-1 text-xs text-secondary">
                          Workflow-managed execution tasks linked to this work item
                        </p>
                      </div>
                      <div className="workspace-meta-card">
                        <p className="workspace-meta-label">Latest activity</p>
                        <p className="workspace-meta-value">
                          {selectedLogs.length > 0
                            ? formatRelativeTime(selectedLogs[selectedLogs.length - 1]?.timestamp)
                            : 'No logs yet'}
                        </p>
                        <p className="mt-1 text-xs text-secondary">
                          {selectedLogs.length > 0
                            ? selectedLogs[selectedLogs.length - 1]?.message
                            : 'Execution output will appear here after the run advances.'}
                        </p>
                      </div>
                    </div>

                    <div className="orchestrator-artifact-browser">
                      <div className="workspace-meta-card">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="workspace-meta-label">Run artifacts</p>
                            <p className="mt-2 text-sm leading-relaxed text-secondary">
                              Browse every document created for this work item without leaving
                              Work.
                            </p>
                          </div>
                          <StatusBadge tone="info">{filteredArtifacts.length} items</StatusBadge>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {([
                            ['ALL', 'All'],
                            ['INPUTS', 'Inputs'],
                            ['OUTPUTS', 'Outputs'],
                            ['DIFFS', 'Diffs'],
                            ['APPROVALS', 'Approvals'],
                            ['HANDOFFS', 'Handoffs'],
                          ] as const).map(([value, label]) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setArtifactFilter(value)}
                              className={cn(
                                'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                                artifactFilter === value
                                  ? 'border-primary/30 bg-primary text-white'
                                  : 'border-outline-variant/30 bg-surface-container-low text-secondary hover:border-primary/20 hover:text-primary',
                              )}
                            >
                              {label}
                            </button>
                          ))}
                        </div>

                        {filteredArtifacts.length === 0 ? (
                          <div className="mt-4 rounded-3xl border border-outline-variant/35 bg-surface-container-low px-4 py-4 text-sm text-secondary">
                            No artifacts match the selected filter for this run yet.
                          </div>
                        ) : (
                          <div className="orchestrator-artifact-list">
                            {filteredArtifacts.map(artifact => (
                              <button
                                key={artifact.id}
                                type="button"
                                onClick={() => setSelectedArtifactId(artifact.id)}
                                className={cn(
                                  'orchestrator-artifact-list-item',
                                  selectedArtifact?.id === artifact.id &&
                                    'orchestrator-artifact-list-item-active',
                                )}
                              >
                                <div className="flex min-w-0 items-start gap-3">
                                  <div className="mt-0.5 rounded-2xl bg-primary/10 p-2 text-primary">
                                    {artifact.contentFormat === 'MARKDOWN' ||
                                    artifact.contentFormat === 'TEXT' ? (
                                      <FileText size={16} />
                                    ) : (
                                      <FileCode size={16} />
                                    )}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="truncate text-sm font-semibold text-on-surface">
                                        {artifact.name}
                                      </p>
                                      <StatusBadge tone="brand">
                                        {artifact.direction || 'OUTPUT'}
                                      </StatusBadge>
                                    </div>
                                    <p className="mt-1 text-xs leading-relaxed text-secondary">
                                      {compactMarkdownPreview(
                                        artifact.summary ||
                                          artifact.description ||
                                          `${artifact.type} · ${artifact.version}`,
                                        140,
                                      )}
                                    </p>
                                  </div>
                                </div>
                                <span className="text-[0.72rem] font-medium text-secondary">
                                  {formatTimestamp(artifact.created)}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="workspace-meta-card orchestrator-preview-panel">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="workspace-meta-label">Artifact preview</p>
                            <p className="mt-2 text-sm font-semibold text-on-surface">
                              {selectedArtifact?.name || 'No document selected'}
                            </p>
                            <p className="mt-1 text-xs text-secondary">
                              {selectedArtifact
                                ? compactMarkdownPreview(
                                    selectedArtifact.summary ||
                                      selectedArtifact.description ||
                                      `${selectedArtifact.type} · ${selectedArtifact.version}`,
                                    160,
                                  )
                                : 'Select an artifact to inspect its body and summary.'}
                            </p>
                          </div>
                          {selectedArtifact ? (
                            <StatusBadge tone="info">
                              {selectedArtifact.contentFormat || 'TEXT'}
                            </StatusBadge>
                          ) : null}
                        </div>

                        <div className="mt-4 rounded-2xl border border-outline-variant/35 bg-white px-5 py-4">
                          {latestArtifactDocument ? (
                            <ArtifactPreview
                              format={selectedArtifact?.contentFormat}
                              content={latestArtifactDocument}
                            />
                          ) : (
                            <p className="text-sm leading-relaxed text-secondary">
                              The selected artifact does not have a previewable text body yet.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="workspace-meta-card">
                        <p className="workspace-meta-label">Workflow-managed tasks</p>
                        {selectedTasks.length === 0 ? (
                          <p className="mt-3 text-sm leading-relaxed text-secondary">
                            No workflow-managed tasks are linked to this work item yet.
                          </p>
                        ) : (
                          <div className="mt-3 space-y-3">
                            {selectedTasks.map(task => (
                              <div key={task.id} className="orchestrator-step-row">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-semibold text-on-surface">
                                    {task.title}
                                  </p>
                                  <p className="mt-1 text-xs text-secondary">
                                    {task.agent} · {formatEnumLabel(task.status)}
                                  </p>
                                </div>
                                <StatusBadge tone={getStatusTone(task.status)}>
                                  {formatEnumLabel(task.status)}
                                </StatusBadge>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="workspace-meta-card">
                        <p className="workspace-meta-label">Recent execution output</p>
                        {selectedLogs.length === 0 ? (
                          <p className="mt-3 text-sm leading-relaxed text-secondary">
                            Execution logs will appear here once the step advances.
                          </p>
                        ) : (
                          <div className="mt-3 space-y-3">
                            {selectedLogs.slice(-5).reverse().map(log => (
                              <div key={log.id} className="orchestrator-step-row">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-semibold text-on-surface">
                                    {log.message}
                                  </p>
                                  <p className="mt-1 text-xs text-secondary">
                                    {formatTimestamp(log.timestamp)}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="workspace-meta-card">
                      <p className="workspace-meta-label">Advanced drill-downs</p>
                      <div className="orchestrator-link-grid">
                        <button
                          type="button"
                          onClick={() => navigate('/run-console')}
                          className="enterprise-button enterprise-button-secondary justify-between"
                        >
                          <span>Run Console telemetry</span>
                          <ExternalLink size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate('/ledger')}
                          className="enterprise-button enterprise-button-secondary justify-between"
                        >
                          <span>Evidence Ledger</span>
                          <ExternalLink size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate('/designer')}
                          className="enterprise-button enterprise-button-secondary justify-between"
                        >
                          <span>Workflow Designer</span>
                          <ExternalLink size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              </div>
            )}
          </div>
          </div>
          </div>
        </aside>
      </div>

      {isApprovalReviewOpen && selectedWorkItem && approvalReviewWait?.type === 'APPROVAL' && (
        <div className="fixed inset-0 z-[91] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-10 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close approval review"
            onClick={() => {
              setIsApprovalReviewOpen(false);
              setIsApprovalReviewHydrated(false);
              if (selectedOpenWait?.type !== 'APPROVAL') {
                setApprovalReviewWaitSnapshot(null);
              }
            }}
            className="absolute inset-0"
          />
          <ModalShell
            title={`Approval review · ${selectedWorkItem.title}`}
            description="Review the full approval context here: the work-item artifacts, attempt story, approval routing, and your final decision all live in this screen."
            eyebrow="Human Approval Gate"
            className="relative z-[1] max-w-7xl"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="warning">Approval required</StatusBadge>
                <button
                  type="button"
                  onClick={() => {
                    setIsApprovalReviewOpen(false);
                    setIsApprovalReviewHydrated(false);
                    if (selectedOpenWait?.type !== 'APPROVAL') {
                      setApprovalReviewWaitSnapshot(null);
                    }
                  }}
                  className="workspace-list-action"
                >
                  <X size={14} />
                </button>
              </div>
            }
          >
            <ErrorBoundary
              resetKey={`${selectedWorkItem.id}:${approvalReviewWait.id}:${selectedApprovalArtifact?.id || 'none'}`}
              title="Approval review could not render"
              description="One of the approval documents could not be previewed safely. The route stays intact, and you can close this window or try a different document."
            >
              {!isApprovalReviewHydrated ? (
                <div className="flex min-h-[18rem] items-center justify-center">
                  <div className="flex items-center gap-3 rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-3 text-sm text-secondary">
                    <LoaderCircle size={16} className="animate-spin" />
                    Preparing approval documents...
                  </div>
                </div>
              ) : (
              <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,24rem)_minmax(0,1fr)]">
                <div className="space-y-4">
                  <div className="workspace-meta-card">
                    <p className="workspace-meta-label">Approval summary</p>
                    <p className="mt-2 text-sm leading-relaxed text-secondary">
                      {approvalReviewWait.message}
                    </p>
                  </div>
                  <div className="workspace-meta-card">
                    <p className="workspace-meta-label">Current context</p>
                    <div className="mt-3 space-y-2 text-sm text-secondary">
                      <p>
                        Phase:{' '}
                        <strong className="text-on-surface">
                          {getPhaseMeta(selectedWorkItem.phase).label}
                        </strong>
                      </p>
                      <p>
                        Step:{' '}
                        <strong className="text-on-surface">
                          {selectedCurrentStep?.name || 'Awaiting orchestration'}
                        </strong>
                      </p>
                      <p>
                        Run:{' '}
                        <strong className="text-on-surface">
                          {currentRun?.id || selectedWorkItem.activeRunId || 'Not attached'}
                        </strong>
                      </p>
                      <p>
                        All approval decisions for this gate must be recorded from this review
                        window.
                      </p>
                    </div>
                  </div>
                  <div className="workspace-meta-card">
                    <p className="workspace-meta-label">Review facts</p>
                    <div className="mt-3 space-y-2 text-sm text-secondary">
                      <p>
                        Requested by:{' '}
                        <strong className="text-on-surface">
                          {agentsById.get(selectedAttentionRequestedBy || '')?.name ||
                            selectedAttentionRequestedBy ||
                            'System'}
                        </strong>
                      </p>
                      <p>
                        Since:{' '}
                        <strong className="text-on-surface">
                          {formatTimestamp(selectedAttentionTimestamp)}
                        </strong>
                      </p>
                      <p>
                        Documents so far:{' '}
                        <strong className="text-on-surface">
                          {selectedWorkItemArtifacts.length}
                        </strong>
                      </p>
                      <p>
                        Code diff attached:{' '}
                        <strong className="text-on-surface">
                          {selectedHasCodeDiffApproval ? 'Yes' : 'No'}
                        </strong>
                      </p>
                    </div>
                  </div>
                  <div className="workspace-meta-card">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="workspace-meta-label">Approval coverage</p>
                        <p className="mt-2 text-sm leading-relaxed text-secondary">
                          These assignments are the durable approval records for this gate.
                        </p>
                      </div>
                      <StatusBadge tone="info">
                        {approvalAssignments.length} assignment
                        {approvalAssignments.length === 1 ? '' : 's'}
                      </StatusBadge>
                    </div>
                    {approvalAssignments.length === 0 ? (
                      <p className="mt-3 text-sm leading-relaxed text-secondary">
                        No explicit approval assignments were created for this gate. The phase owner team or legacy approver roles will act as the fallback routing.
                      </p>
                    ) : (
                      <div className="mt-4 space-y-3">
                        {approvalAssignments.map(assignment => {
                          const linkedDecision = approvalDecisionByAssignmentId.get(assignment.id);
                          return (
                            <div
                              key={assignment.id}
                              className="rounded-2xl border border-outline-variant/25 bg-white px-4 py-3"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold text-on-surface">
                                    {describeApprovalTarget(assignment, {
                                      usersById: workspaceUsersById,
                                      teamsById: workspaceTeamsById,
                                    })}
                                  </p>
                                  <p className="mt-1 text-xs text-secondary">
                                    {formatEnumLabel(assignment.targetType)}
                                    {assignment.dueAt
                                      ? ` · Due ${formatTimestamp(assignment.dueAt)}`
                                      : ''}
                                  </p>
                                </div>
                                <StatusBadge tone={getStatusTone(assignment.status)}>
                                  {formatEnumLabel(assignment.status)}
                                </StatusBadge>
                              </div>
                              {linkedDecision ? (
                                <p className="mt-2 text-xs leading-relaxed text-secondary">
                                  {linkedDecision.actorDisplayName} recorded{' '}
                                  <strong className="text-on-surface">
                                    {formatEnumLabel(linkedDecision.disposition)}
                                  </strong>
                                  {linkedDecision.comment
                                    ? ` · ${compactMarkdownPreview(linkedDecision.comment, 120)}`
                                    : ''}
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {unassignedApprovalDecisions.length > 0 ? (
                      <div className="mt-4 rounded-2xl border border-outline-variant/25 bg-white px-4 py-3">
                        <p className="workspace-meta-label">Recorded decisions without assignment link</p>
                        <div className="mt-3 space-y-2">
                          {unassignedApprovalDecisions.map(decision => (
                            <p key={decision.id} className="text-xs leading-relaxed text-secondary">
                              {decision.actorDisplayName} ·{' '}
                              <strong className="text-on-surface">
                                {formatEnumLabel(decision.disposition)}
                              </strong>
                              {decision.comment
                                ? ` · ${compactMarkdownPreview(decision.comment, 140)}`
                                : ''}
                            </p>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <InteractionTimeline
                    feed={selectedInteractionFeed}
                    maxItems={6}
                    title="Context story"
                    emptyMessage="No linked interaction context is available for this approval yet."
                    onOpenArtifact={handleOpenArtifactFromTimeline}
                    onOpenRun={runId => void handleOpenRunFromTimeline(runId)}
                    onOpenTask={handleOpenTaskFromTimeline}
                  />
                  {selectedHasCodeDiffApproval && (
                    <button
                      type="button"
                      onClick={() => setIsDiffReviewOpen(true)}
                      className="enterprise-button enterprise-button-secondary w-full justify-between"
                    >
                      <span>Open code diff review</span>
                      <ExternalLink size={16} />
                    </button>
                  )}
                </div>

                <div className="workspace-meta-card">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="workspace-meta-label">Documents so far</p>
                      <p className="mt-2 text-sm leading-relaxed text-secondary">
                        Inputs, outputs, handoffs, approvals, and diffs attached to this work item.
                      </p>
                    </div>
                    <StatusBadge tone="info">
                      {filteredApprovalArtifacts.length} items
                    </StatusBadge>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {([
                      ['ALL', 'All'],
                      ['INPUTS', 'Inputs'],
                      ['OUTPUTS', 'Outputs'],
                      ['DIFFS', 'Diffs'],
                      ['APPROVALS', 'Approvals'],
                      ['HANDOFFS', 'Handoffs'],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setApprovalArtifactFilter(value)}
                        className={cn(
                          'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                          approvalArtifactFilter === value
                            ? 'border-primary/30 bg-primary text-white'
                            : 'border-outline-variant/30 bg-surface-container-low text-secondary hover:border-primary/20 hover:text-primary',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {filteredApprovalArtifacts.length === 0 ? (
                    <div className="mt-4 rounded-3xl border border-outline-variant/35 bg-surface-container-low px-4 py-4 text-sm text-secondary">
                      No documents match the selected filter yet for this approval review.
                    </div>
                  ) : (
                    <div className="orchestrator-artifact-list max-h-[65vh] overflow-y-auto pr-1">
                      {filteredApprovalArtifacts.map(artifact => (
                        <button
                          key={artifact.id}
                          type="button"
                          onClick={() => setSelectedApprovalArtifactId(artifact.id)}
                          className={cn(
                            'orchestrator-artifact-list-item',
                            selectedApprovalArtifact?.id === artifact.id &&
                              'orchestrator-artifact-list-item-active',
                          )}
                        >
                          <div className="flex min-w-0 items-start gap-3">
                            <div className="mt-0.5 rounded-2xl bg-primary/10 p-2 text-primary">
                              {artifact.contentFormat === 'MARKDOWN' ||
                              artifact.contentFormat === 'TEXT' ? (
                                <FileText size={16} />
                              ) : (
                                <FileCode size={16} />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate text-sm font-semibold text-on-surface">
                                  {artifact.name}
                                </p>
                                <StatusBadge tone="brand">
                                  {artifact.direction || 'OUTPUT'}
                                </StatusBadge>
                              </div>
                              <p className="mt-1 text-xs leading-relaxed text-secondary">
                                {compactMarkdownPreview(
                                  artifact.summary ||
                                    artifact.description ||
                                    `${artifact.type} · ${artifact.version}`,
                                  120,
                                )}
                              </p>
                            </div>
                          </div>
                          <span className="text-[0.72rem] font-medium text-secondary">
                            {formatTimestamp(artifact.created)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="workspace-meta-card orchestrator-preview-panel">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="workspace-meta-label">Document preview</p>
                      <p className="mt-2 text-sm font-semibold text-on-surface">
                        {selectedApprovalArtifact?.name || 'No document selected'}
                      </p>
                      <p className="mt-1 text-xs text-secondary">
                        {selectedApprovalArtifact
                          ? compactMarkdownPreview(
                              selectedApprovalArtifact.summary ||
                                selectedApprovalArtifact.description ||
                                `${selectedApprovalArtifact.type} · ${selectedApprovalArtifact.version}`,
                              160,
                            )
                          : 'Select a document to inspect the approval packet body.'}
                      </p>
                    </div>
                    {selectedApprovalArtifact ? (
                      <StatusBadge tone="info">
                        {selectedApprovalArtifact.contentFormat || 'TEXT'}
                      </StatusBadge>
                    ) : null}
                  </div>

                  <div className="mt-4 rounded-2xl border border-outline-variant/35 bg-white px-5 py-4">
                    {selectedApprovalArtifactDocument ? (
                      <div className="max-h-[42vh] overflow-y-auto pr-1">
                        <ArtifactPreview
                          format={selectedApprovalArtifact?.contentFormat}
                          content={selectedApprovalArtifactDocument}
                        />
                      </div>
                    ) : (
                      <p className="text-sm leading-relaxed text-secondary">
                        The selected document does not have a previewable text body yet.
                      </p>
                    )}
                  </div>

                  <div className="mt-4 rounded-2xl border border-outline-variant/25 bg-surface-container-low px-4 py-4">
                    <p className="workspace-meta-label">Approval / change note</p>
                    <p className="mt-2 text-sm leading-relaxed text-secondary">
                      Capture sign-off conditions, review comments, or the exact changes you want before the workflow continues.
                    </p>
                    <textarea
                      value={resolutionNote}
                      onChange={event => setResolutionNote(event.target.value)}
                      placeholder={resolutionPlaceholder}
                      className="field-textarea mt-3 h-28 bg-white"
                    />
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      {requestChangesIsAvailable && (
                        <button
                          type="button"
                          onClick={() => void handleRequestChanges()}
                          disabled={!canRequestChanges || busyAction !== null}
                          className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {busyAction === 'requestChanges' ? (
                            <LoaderCircle size={16} className="animate-spin" />
                          ) : (
                            <RefreshCw size={16} />
                          )}
                          Request changes
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleResolveWait()}
                        disabled={!canResolveSelectedWait || busyAction !== null}
                        className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busyAction === 'resolve' ? (
                          <LoaderCircle size={16} className="animate-spin" />
                        ) : (
                          <ShieldCheck size={16} />
                        )}
                        {actionButtonLabel}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              )}
            </ErrorBoundary>
          </ModalShell>
        </div>
      )}

      {isDiffReviewOpen && selectedHasCodeDiffApproval && (
        <div className="fixed inset-0 z-[92] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-16 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close diff review"
            onClick={() => setIsDiffReviewOpen(false)}
            className="absolute inset-0"
          />
          <ModalShell
            title={selectedCodeDiffArtifact?.name || 'Code diff review'}
            description="Review the generated patch in a dedicated surface before approving or sending the work back for changes."
            eyebrow="Diff Review"
            className="relative z-[1] max-w-6xl"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                {selectedCodeDiffArtifact ? (
                  <StatusBadge tone="info">
                    {selectedCodeDiffArtifact.contentFormat || 'TEXT'}
                  </StatusBadge>
                ) : null}
                <button
                  type="button"
                  onClick={() => setIsDiffReviewOpen(false)}
                  className="workspace-list-action"
                >
                  <X size={14} />
                </button>
              </div>
            }
          >
            <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
              <div className="space-y-4">
                <div className="workspace-meta-card">
                  <p className="workspace-meta-label">Summary</p>
                  <p className="mt-2 text-sm leading-relaxed text-secondary">
                    {selectedCodeDiffArtifact?.summary ||
                      selectedOpenWait?.payload?.codeDiffSummary ||
                      'The diff summary is not available yet.'}
                  </p>
                </div>
                <div className="workspace-meta-card">
                  <p className="workspace-meta-label">Review facts</p>
                  <div className="mt-3 space-y-2 text-sm text-secondary">
                    <p>
                      Repositories:{' '}
                      <strong className="text-on-surface">
                        {selectedCodeDiffRepositoryCount || 1}
                      </strong>
                    </p>
                    <p>
                      Touched files:{' '}
                      <strong className="text-on-surface">
                        {selectedCodeDiffTouchedFileCount || 'Tracked in diff'}
                      </strong>
                    </p>
                    <p>
                      Wait state:{' '}
                      <strong className="text-on-surface">Approval required</strong>
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-outline-variant/35 bg-slate-950 px-5 py-4 text-slate-100 shadow-[0_24px_80px_rgba(12,23,39,0.24)]">
                {selectedCodeDiffArtifact ? (
                  <div className="max-h-[70vh] overflow-auto pr-2">
                    <ArtifactPreview
                      content={selectedCodeDiffDocument}
                      format={selectedCodeDiffArtifact.contentFormat}
                      emptyLabel="The code diff artifact is still being prepared."
                    />
                  </div>
                ) : (
                  <p className="text-sm leading-relaxed text-slate-200/80">
                    The diff artifact is not available in the current snapshot yet.
                  </p>
                )}
              </div>
            </div>
          </ModalShell>
        </div>
      )}

      {isCreateSheetOpen && (
        <div className="fixed inset-0 z-[90]">
          <button
            type="button"
            aria-label="Close create work item sheet"
            onClick={() => setIsCreateSheetOpen(false)}
            className="absolute inset-0 bg-slate-950/35"
          />
          <motion.aside
            initial={{ opacity: 0, x: 48 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 48 }}
            className="orchestrator-quick-sheet"
          >
            <div className="orchestrator-quick-sheet-header">
              <div>
                <p className="form-kicker">Quick Create</p>
                <h2 className="mt-1 text-xl font-bold text-on-surface">Stage new work</h2>
                <p className="mt-2 text-sm leading-relaxed text-secondary">
                  Keep creation lightweight, pick the workflow, and let the execution engine own
                  progression, waits, and durable output.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateSheetOpen(false)}
                className="workspace-list-action"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {workspace.workflows.length === 0 ? (
                <EmptyState
                  title="No workflow is available"
                  description="Create or restore a workflow before staging new work into orchestration."
                  icon={WorkflowIcon}
                  className="min-h-[20rem]"
                />
              ) : (
                <form
                  id="orchestrator-create-work-item"
                  onSubmit={handleCreateWorkItem}
                  className="grid gap-5"
                >
                  <label className="space-y-2">
                    <span className="field-label">Work item title</span>
                    <input
                      value={draftWorkItem.title}
                      onChange={event =>
                        setDraftWorkItem(prev => ({ ...prev, title: event.target.value }))
                      }
                      placeholder="Implement expression parser"
                      className="field-input"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="field-label">Workflow</span>
                    <select
                      value={draftWorkItem.workflowId}
                      onChange={event =>
                        setDraftWorkItem(prev => ({
                          ...prev,
                          workflowId: event.target.value,
                        }))
                      }
                      className="field-select"
                    >
                      {workspace.workflows.map(workflow => (
                        <option key={workflow.id} value={workflow.id}>
                          {workflow.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-2">
                    <span className="field-label">Task type</span>
                    <select
                      value={draftWorkItem.taskType}
                      onChange={event =>
                        setDraftWorkItem(prev => ({
                          ...prev,
                          taskType: event.target.value as WorkItemTaskType,
                        }))
                      }
                      className="field-select"
                    >
                      {WORK_ITEM_TASK_TYPE_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs leading-relaxed text-secondary">
                      {getWorkItemTaskTypeDescription(draftWorkItem.taskType)}
                    </p>
                  </label>

                  <div className="workspace-meta-card orchestrator-quick-sheet-summary">
                    <p className="workspace-meta-label">Workflow launch summary</p>
                    <p className="workspace-meta-value">
                      {draftWorkflow?.name || 'Select a workflow'}
                    </p>
                    <div className="mt-3 grid gap-2 text-sm text-secondary">
                      <p>
                        Entry point:{' '}
                        <strong className="text-on-surface">
                          {getWorkItemTaskTypeLabel(draftWorkItem.taskType)}
                        </strong>
                      </p>
                      <p>
                        Routed phase:{' '}
                        <strong className="text-on-surface">
                          {draftFirstStep
                            ? getPhaseMeta(draftFirstStep.phase).label
                            : draftTaskTypeEntryPhase
                            ? getPhaseMeta(draftTaskTypeEntryPhase).label
                            : 'Not defined'}
                        </strong>
                      </p>
                      <p>
                        Entry agent:{' '}
                        <strong className="text-on-surface">
                          {draftFirstAgent?.name ||
                            (draftFirstStep ? draftFirstStep.agentId : 'Unassigned')}
                        </strong>
                      </p>
                      <p>
                        Steps:{' '}
                        <strong className="text-on-surface">
                          {draftWorkflow?.steps.length || 0}
                        </strong>
                      </p>
                      <p>
                        Phase sign-off:{' '}
                        <strong className="text-on-surface">
                          {draftPhaseStakeholderAssignments.length > 0
                            ? `${draftPhaseStakeholderAssignments.length} phases configured`
                            : 'No phase stakeholders yet'}
                        </strong>
                      </p>
                      <p>
                        Input files:{' '}
                        <strong className="text-on-surface">
                          {draftWorkItem.attachments.length > 0
                            ? `${draftWorkItem.attachments.length} attached`
                            : 'No files attached'}
                        </strong>
                      </p>
                      {draftTaskTypeEntryPhase &&
                        draftFirstStep?.phase !== draftTaskTypeEntryPhase && (
                          <p>
                            Routing note:{' '}
                            <strong className="text-on-surface">
                              This workflow does not define a separate{' '}
                              {getPhaseMeta(draftTaskTypeEntryPhase).label} entry step, so it will
                              use the workflow default.
                            </strong>
                          </p>
                        )}
                    </div>
                  </div>

                  <label className="space-y-2">
                    <span className="field-label">Priority</span>
                    <select
                      value={draftWorkItem.priority}
                      onChange={event =>
                        setDraftWorkItem(prev => ({
                          ...prev,
                          priority: event.target.value as WorkItem['priority'],
                        }))
                      }
                      className="field-select"
                    >
                      <option value="High">High</option>
                      <option value="Med">Med</option>
                      <option value="Low">Low</option>
                    </select>
                  </label>

                  <label className="space-y-2">
                    <span className="field-label">Description</span>
                    <textarea
                      value={draftWorkItem.description}
                      onChange={event =>
                        setDraftWorkItem(prev => ({
                          ...prev,
                          description: event.target.value,
                        }))
                      }
                      placeholder="Add scope, acceptance criteria, or decision context."
                      className="field-textarea h-28"
                    />
                  </label>

                  <div className="workspace-meta-card">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="workspace-meta-label">Phase stakeholders & sign-off</p>
                        <p className="mt-2 text-sm leading-relaxed text-secondary">
                          Add the stakeholders who should be represented in each phase. Human
                          interaction and sign-off documents for that phase will carry these names
                          and email ids.
                        </p>
                      </div>
                      {activeCapability.stakeholders.length > 0 && (
                        <StatusBadge tone="info">
                          {activeCapability.stakeholders.length} capability stakeholders available
                        </StatusBadge>
                      )}
                    </div>

                    <div className="mt-4 grid gap-4">
                      {visibleLifecyclePhases.map(phase => {
                        const phaseStakeholders = getDraftPhaseStakeholders(phase.id);

                        return (
                          <div
                            key={phase.id}
                            className="rounded-[1.5rem] border border-outline-variant/30 bg-white/80 px-4 py-4"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-on-surface">
                                  {phase.label}
                                </p>
                                <p className="mt-1 text-xs leading-relaxed text-secondary">
                                  {phase.description ||
                                    'Stakeholders listed here will appear in phase-specific sign-off records.'}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {activeCapability.stakeholders.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => applyCapabilityStakeholdersToPhase(phase.id)}
                                    className="enterprise-button enterprise-button-secondary px-3 py-2 text-[0.68rem]"
                                  >
                                    Use capability stakeholders
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => addDraftPhaseStakeholder(phase.id)}
                                  className="enterprise-button enterprise-button-secondary px-3 py-2 text-[0.68rem]"
                                >
                                  <Plus size={14} />
                                  Add stakeholder
                                </button>
                              </div>
                            </div>

                            {phaseStakeholders.length > 0 ? (
                              <div className="mt-4 space-y-3">
                                {phaseStakeholders.map((stakeholder, index) => (
                                  <div
                                    key={`${phase.id}-${index}`}
                                    className="rounded-[1.25rem] border border-outline-variant/25 bg-surface-container-low/40 p-3"
                                  >
                                    <div className="grid gap-3 md:grid-cols-2">
                                      <input
                                        value={stakeholder.role}
                                        onChange={event =>
                                          updateDraftPhaseStakeholderField(
                                            phase.id,
                                            index,
                                            'role',
                                            event.target.value,
                                          )
                                        }
                                        placeholder="Role"
                                        className="field-input"
                                      />
                                      <input
                                        value={stakeholder.name}
                                        onChange={event =>
                                          updateDraftPhaseStakeholderField(
                                            phase.id,
                                            index,
                                            'name',
                                            event.target.value,
                                          )
                                        }
                                        placeholder="Stakeholder name"
                                        className="field-input"
                                      />
                                      <input
                                        value={stakeholder.email}
                                        onChange={event =>
                                          updateDraftPhaseStakeholderField(
                                            phase.id,
                                            index,
                                            'email',
                                            event.target.value,
                                          )
                                        }
                                        placeholder="name@company.com"
                                        className="field-input"
                                      />
                                      <div className="flex gap-2">
                                        <input
                                          value={stakeholder.teamName || ''}
                                          onChange={event =>
                                            updateDraftPhaseStakeholderField(
                                              phase.id,
                                              index,
                                              'teamName',
                                              event.target.value,
                                            )
                                          }
                                          placeholder="Team"
                                          className="field-input"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => removeDraftPhaseStakeholder(phase.id, index)}
                                          className="workspace-list-action shrink-0 self-center"
                                        >
                                          <X size={14} />
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-4 text-xs leading-relaxed text-secondary">
                                No phase stakeholders assigned yet.
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="workspace-meta-card">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="workspace-meta-label">Supporting files for the agent</p>
                        <p className="mt-2 text-sm leading-relaxed text-secondary">
                          Upload text-based files like requirements, design notes, samples, or
                          decision docs. They will be stored as work-item input artifacts and
                          included in agent context for this work item.
                        </p>
                      </div>
                      <label className="enterprise-button enterprise-button-secondary cursor-pointer px-3 py-2 text-[0.68rem]">
                        <Plus size={14} />
                        Upload files
                        <input
                          type="file"
                          multiple
                          className="hidden"
                          onChange={event => {
                            void handleDraftAttachmentUpload(event.target.files);
                            event.currentTarget.value = '';
                          }}
                        />
                      </label>
                    </div>

                    {draftWorkItem.attachments.length > 0 ? (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {draftWorkItem.attachments.map((attachment, index) => (
                          <div
                            key={`${attachment.fileName}-${index}`}
                            className="flex items-center justify-between gap-3 rounded-[1.25rem] border border-outline-variant/20 bg-surface-container-low/35 px-4 py-3"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                                {renderAttachmentIcon(attachment)}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-on-surface">
                                  {attachment.fileName}
                                </p>
                                <p className="mt-1 truncate text-xs leading-relaxed text-secondary">
                                  {[attachment.mimeType || 'text/plain', formatAttachmentSizeLabel(attachment.sizeBytes)]
                                    .filter(Boolean)
                                    .join(' • ')}
                                </p>
                                <p className="mt-1 text-[0.68rem] uppercase tracking-[0.2em] text-secondary/80">
                                  Stored on create
                                </p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeDraftAttachment(index)}
                              className="workspace-list-action shrink-0"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-4 text-xs leading-relaxed text-secondary">
                        No files uploaded yet.
                      </p>
                    )}
                  </div>

                  <label className="space-y-2">
                    <span className="field-label">Tags</span>
                    <input
                      value={draftWorkItem.tags}
                      onChange={event =>
                        setDraftWorkItem(prev => ({ ...prev, tags: event.target.value }))
                      }
                      placeholder="parser, math, compiler"
                      className="field-input"
                    />
                  </label>
                </form>
              )}
            </div>

            {workspace.workflows.length > 0 && (
              <div className="orchestrator-quick-sheet-footer">
                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsCreateSheetOpen(false)}
                    className="enterprise-button enterprise-button-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    form="orchestrator-create-work-item"
                    disabled={busyAction !== null || !canCreateWorkItems}
                    className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busyAction === 'create' ? (
                      <LoaderCircle size={16} className="animate-spin" />
                    ) : (
                      <Plus size={16} />
                    )}
                    Create work item
                  </button>
                </div>
              </div>
            )}
          </motion.aside>
        </div>
      )}

      {phaseMoveRequest && phaseMoveItem && (
        <div className="fixed inset-0 z-[92] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-12 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close phase change dialog"
            onClick={() => {
              setPhaseMoveRequest(null);
              setPhaseMoveNote('');
            }}
            className="absolute inset-0"
          />
          <ModalShell
            title={`Move phase · ${phaseMoveItem.title}`}
            eyebrow="Phase Change"
            description="Moving a work item will cancel any in-flight run first, then place the story back onto the selected lifecycle phase."
            className="relative z-[1] w-full max-w-2xl"
            actions={
              <button
                type="button"
                onClick={() => {
                  setPhaseMoveRequest(null);
                  setPhaseMoveNote('');
                }}
                className="workspace-list-action"
              >
                <X size={14} />
              </button>
            }
          >
            <div className="space-y-4">
              <div className="workspace-meta-card border-amber-200 bg-amber-50 text-amber-900">
                <p className="text-sm font-semibold">Safety check</p>
                <p className="mt-1 text-sm leading-relaxed">
                  This will cancel the current run (if any) before moving from{' '}
                  <span className="font-semibold">
                    {getPhaseMeta(phaseMoveItem.phase).label}
                  </span>{' '}
                  to{' '}
                  <span className="font-semibold">
                    {getPhaseMeta(phaseMoveRequest.targetPhase).label}
                  </span>
                  .
                </p>
              </div>

              <label className="block space-y-2">
                <span className="field-label">Move note (optional)</span>
                <textarea
                  value={phaseMoveNote}
                  onChange={event => setPhaseMoveNote(event.target.value)}
                  placeholder="Why are we changing phases?"
                  className="field-textarea bg-white"
                />
              </label>

              {actionError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                  {actionError}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setPhaseMoveRequest(null);
                    setPhaseMoveNote('');
                  }}
                  className="enterprise-button enterprise-button-secondary"
                >
                  Keep current phase
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmPhaseMove()}
                  disabled={busyAction !== null || !canControlWorkItems}
                  className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busyAction === `move-${phaseMoveItem.id}` ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <ArrowRight size={16} />
                  )}
                  Move phase
                </button>
              </div>
            </div>
          </ModalShell>
        </div>
      )}

      {isArchiveWorkItemOpen && selectedWorkItem && selectedWorkItem.status !== 'ARCHIVED' && (
        <div className="fixed inset-0 z-[93] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-12 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close archive work item dialog"
            onClick={() => setIsArchiveWorkItemOpen(false)}
            className="absolute inset-0"
          />
          <ModalShell
            title={`Delete work item · ${selectedWorkItem.title}`}
            eyebrow="Archive Work Item"
            description="Deleting here is a soft delete: we archive the work item and purge its run history, artifacts, and copilot thread so the workspace stays fast. You can restore from Archive to restart from the initial phase."
            className="relative z-[1] w-full max-w-2xl"
            actions={
              <button
                type="button"
                onClick={() => setIsArchiveWorkItemOpen(false)}
                className="workspace-list-action"
              >
                <X size={14} />
              </button>
            }
          >
            <div className="space-y-4">
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-900">
                This will remove runs, logs, uploaded files, and chat history tied to this work item. Restore brings the work item back, but it starts fresh.
              </div>

              {!canControlWorkItems ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
                  <div className="flex items-start gap-3">
                    <AlertCircle size={18} className="mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold">Read-only operator</p>
                      <p className="mt-1 text-sm leading-relaxed">
                        {currentActorContext.displayName} does not have{' '}
                        <span className="font-mono">workitem.control</span>. Switch Current
                        Operator in the top bar, or use Login to choose a role that can
                        delete work items.
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setIsArchiveWorkItemOpen(false);
                            navigate('/login');
                          }}
                          className="enterprise-button enterprise-button-secondary"
                        >
                          <ArrowRight size={16} />
                          Switch operator
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <label className="block space-y-2">
                <span className="field-label">Delete note (optional)</span>
                <textarea
                  value={archiveWorkItemNote}
                  onChange={event => setArchiveWorkItemNote(event.target.value)}
                  placeholder="Why are we deleting (archiving) this work item?"
                  className="field-textarea bg-white"
                />
              </label>

              {actionError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                  {actionError}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsArchiveWorkItemOpen(false)}
                  className="enterprise-button enterprise-button-secondary"
                >
                  Keep work item
                </button>
                <button
                  type="button"
                  onClick={() => void handleArchiveWorkItem()}
                  disabled={busyAction !== null || !canControlWorkItems}
                  className="enterprise-button enterprise-button-danger disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busyAction === 'archiveWorkItem' ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <Trash2 size={16} />
                  )}
                  Delete and archive
                </button>
              </div>
            </div>
          </ModalShell>
        </div>
      )}

      {isRestoreWorkItemOpen && selectedWorkItem && selectedWorkItem.status === 'ARCHIVED' && (
        <div className="fixed inset-0 z-[93] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-12 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close restore work item dialog"
            onClick={() => setIsRestoreWorkItemOpen(false)}
            className="absolute inset-0"
          />
          <ModalShell
            title={`Restore work item · ${selectedWorkItem.title}`}
            eyebrow="Restore From Archive"
            description="Restoring brings the work item back to its initial phase so you can restart execution."
            className="relative z-[1] w-full max-w-2xl"
            actions={
              <button
                type="button"
                onClick={() => setIsRestoreWorkItemOpen(false)}
                className="workspace-list-action"
              >
                <X size={14} />
              </button>
            }
          >
            <div className="space-y-4">
              {!canControlWorkItems ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
                  <div className="flex items-start gap-3">
                    <AlertCircle size={18} className="mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold">Read-only operator</p>
                      <p className="mt-1 text-sm leading-relaxed">
                        {currentActorContext.displayName} does not have{' '}
                        <span className="font-mono">workitem.control</span>. Switch Current
                        Operator in the top bar, or use Login to choose a role that can
                        restore work items.
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setIsRestoreWorkItemOpen(false);
                            navigate('/login');
                          }}
                          className="enterprise-button enterprise-button-secondary"
                        >
                          <ArrowRight size={16} />
                          Switch operator
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <label className="block space-y-2">
                <span className="field-label">Restore note (optional)</span>
                <textarea
                  value={restoreWorkItemNote}
                  onChange={event => setRestoreWorkItemNote(event.target.value)}
                  placeholder="Any context for why we are restoring?"
                  className="field-textarea bg-white"
                />
              </label>

              {actionError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                  {actionError}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsRestoreWorkItemOpen(false)}
                  className="enterprise-button enterprise-button-secondary"
                >
                  Keep archived
                </button>
                <button
                  type="button"
                  onClick={() => void handleRestoreWorkItem()}
                  disabled={busyAction !== null || !canControlWorkItems}
                  className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busyAction === 'restoreWorkItem' ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <RefreshCw size={16} />
                  )}
                  Restore work item
                </button>
              </div>
            </div>
          </ModalShell>
        </div>
      )}

      {isCancelWorkItemOpen && selectedWorkItem && (
        <div className="fixed inset-0 z-[93] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-12 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close cancel work item dialog"
            onClick={() => setIsCancelWorkItemOpen(false)}
            className="absolute inset-0"
          />
          <ModalShell
            title={`Cancel work item · ${selectedWorkItem.title}`}
            eyebrow="Cancel Work Item"
            description="Cancel returns the work item to the initial state (Backlog) and clears runs, logs, uploads, and copilot thread so you can start fresh."
            className="relative z-[1] w-full max-w-2xl"
            actions={
              <button
                type="button"
                onClick={() => setIsCancelWorkItemOpen(false)}
                className="workspace-list-action"
              >
                <X size={14} />
              </button>
            }
          >
	            <div className="space-y-4">
	              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-900">
	                This will wipe attempts, uploaded files, and chat history for this work item. The title and description stay, and you can restart the workflow after cancel.
	              </div>

	              {!canControlWorkItems ? (
	                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
	                  <div className="flex items-start gap-3">
	                    <AlertCircle size={18} className="mt-0.5 shrink-0" />
	                    <div>
	                      <p className="text-sm font-semibold">Read-only operator</p>
	                      <p className="mt-1 text-sm leading-relaxed">
	                        {currentActorContext.displayName} does not have{' '}
	                        <span className="font-mono">workitem.control</span>. Switch Current
	                        Operator in the top bar, or use Login to choose a role that can
	                        cancel work items.
	                      </p>
	                      <div className="mt-3 flex flex-wrap items-center gap-2">
	                        <button
	                          type="button"
	                          onClick={() => {
	                            setIsCancelWorkItemOpen(false);
	                            navigate('/login');
	                          }}
	                          className="enterprise-button enterprise-button-secondary"
	                        >
	                          <ArrowRight size={16} />
	                          Switch operator
	                        </button>
	                      </div>
	                    </div>
	                  </div>
	                </div>
	              ) : null}

                <label className="block space-y-2">
                  <span className="field-label">Cancel note (optional)</span>
	                <textarea
	                  value={cancelWorkItemNote}
                  onChange={event => setCancelWorkItemNote(event.target.value)}
                  placeholder="Why are we cancelling this work item?"
                  className="field-textarea bg-white"
                />
              </label>

              {actionError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                  {actionError}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsCancelWorkItemOpen(false)}
                  className="enterprise-button enterprise-button-secondary"
                >
                  Keep work item
                </button>
                <button
                  type="button"
                  onClick={() => void handleCancelWorkItem()}
                  disabled={busyAction !== null || !canControlWorkItems}
                  className="enterprise-button enterprise-button-danger disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busyAction === 'cancelWorkItem' ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <X size={16} />
                  )}
                  Cancel work item
                </button>
              </div>
            </div>
          </ModalShell>
        </div>
      )}

      {selectedWorkItem && (
        <ErrorBoundary
          resetKey={`${selectedWorkItem.id}:${selectedAgent?.id || 'none'}:${selectedCurrentStep?.id || 'stage'}:${isStageControlOpen ? 'open' : 'closed'}`}
          title="Stage control could not render"
          description="The takeover window hit an unexpected UI problem. The workbench is still available, and you can reopen stage control or use Full Chat while we keep the route alive."
        >
          <StageControlModal
            isOpen={isStageControlOpen}
            capability={activeCapability}
            workItem={selectedWorkItem}
            agent={selectedAgent}
            currentRun={currentRun}
            currentStep={selectedCurrentStep}
            openWait={selectedOpenWait}
            compiledStepContext={selectedCompiledStepContext}
            failureReason={selectedFailureReason || undefined}
            runtimeReady={runtimeReady}
            runtimeError={runtimeError}
            onClose={() => setIsStageControlOpen(false)}
            onRefresh={handleStageControlRefresh}
          />
        </ErrorBoundary>
      )}

      <ExplainWorkItemDrawer
        capability={activeCapability}
        workItem={selectedWorkItem}
        isOpen={isExplainOpen}
        onClose={() => setIsExplainOpen(false)}
      />
    </div>
  );
};

export default Orchestrator;
