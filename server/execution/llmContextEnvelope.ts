import type {
  LlmContextEnvelope,
  Workflow,
  WorkflowRunStep,
  WorkflowStep,
  WorkItem,
} from '../../src/types';

type ToolTranscriptTurn = {
  role: string;
  content: string;
};

export const buildRecentWorkItemConversationText = ({
  messages,
  workItemId,
  runId,
}: {
  messages: Array<{
    workItemId?: string;
    runId?: string;
    role?: string;
    agentName?: string;
    content?: string;
  }>;
  workItemId: string;
  runId?: string | null;
}) =>
  messages
    .filter(
      message =>
        message.workItemId === workItemId || (runId ? message.runId === runId : false),
    )
    .slice(-6)
    .map(message => {
      const speaker =
        message.role === 'user'
          ? 'Operator'
          : message.agentName || message.role || 'Agent';
      const content = String(message.content || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 220);
      return `- ${speaker}: ${content}`;
    })
    .filter(Boolean)
    .join('\n');

export const buildToolTranscriptText = (toolHistory?: ToolTranscriptTurn[]) =>
  toolHistory?.length
    ? `Prior tool loop transcript:\n${toolHistory
        .map(item => `${String(item.role || '').toUpperCase()}: ${String(item.content || '').trim()}`)
        .join('\n\n')}`
    : '';

export const buildExecutionLlmContinuitySections = ({
  mode,
  workItem,
  workflow,
  step,
  runStep,
  recentConversationText,
  sessionMemoryPrompt,
  toolHistory,
  handoffContext,
  resolvedWaitContext,
  operatorGuidanceContext,
}: {
  mode:
    | 'workflow-step'
    | 'delegated-subtask'
    | 'repair'
    | 'conflict-review';
  workItem: Pick<WorkItem, 'id' | 'title' | 'description' | 'phase'>;
  workflow: Pick<Workflow, 'name'>;
  step: Pick<WorkflowStep, 'name' | 'phase' | 'action' | 'description'>;
  runStep?: Pick<WorkflowRunStep, 'attemptCount'> | null;
  recentConversationText?: string;
  sessionMemoryPrompt?: string;
  toolHistory?: ToolTranscriptTurn[];
  handoffContext?: string;
  resolvedWaitContext?: string;
  operatorGuidanceContext?: string;
}) => {
  const conversationText = recentConversationText
    ? `Recent operator and stage conversation:\n${recentConversationText}`
    : '';
  const sessionMemoryText = sessionMemoryPrompt?.trim()
    ? sessionMemoryPrompt.trim()
    : '';
  const toolTranscriptText = buildToolTranscriptText(toolHistory);
  const handoffText = `Workflow hand-off context from prior completed steps:\n${
    handoffContext || 'None'
  }`;
  const resolvedWaitText = `Resolved human input/conflict context for this step:\n${
    resolvedWaitContext || 'None'
  }`;
  const operatorGuidanceText = `Explicit operator guidance and override context:\n${
    operatorGuidanceContext || 'None'
  }`;
  const envelopeText = [
    `Execution continuity envelope (${mode}):`,
    `Work item: ${workItem.title} (${workItem.id})`,
    `Workflow: ${workflow.name}`,
    `Step: ${step.name} (${step.phase})`,
    `Step objective: ${step.action}`,
    runStep ? `Current step attempt: ${runStep.attemptCount}` : null,
    conversationText || null,
    sessionMemoryText || null,
    toolTranscriptText || null,
    handoffText,
    resolvedWaitText,
    operatorGuidanceText,
  ]
    .filter(Boolean)
    .join('\n\n');

  const envelope: LlmContextEnvelope = {
    rawMessage: '',
    effectiveMessage: '',
    conversationHistory: conversationText || undefined,
    sessionMemorySummary: sessionMemoryText || undefined,
    liveContext: undefined,
    toolTranscript: toolTranscriptText || undefined,
    verifiedCodeEvidence: undefined,
    advisoryMemory: undefined,
    contextEnvelopeSource: 'shared-execution-envelope',
  };

  return {
    conversationText,
    sessionMemoryText,
    toolTranscriptText,
    handoffText,
    resolvedWaitText,
    operatorGuidanceText,
    envelopeText,
    envelope,
    executionContextHydrated: Boolean(
      recentConversationText ||
        sessionMemoryText ||
        toolHistory?.length ||
        handoffContext ||
        resolvedWaitContext ||
        operatorGuidanceContext,
    ),
    contextEnvelopeSource: 'shared-execution-envelope' as const,
  };
};
