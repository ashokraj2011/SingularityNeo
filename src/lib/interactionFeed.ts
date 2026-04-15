import type {
  ApprovalDecision,
  Capability,
  CapabilityChatMessage,
  CapabilityInteractionFeed,
  CapabilityInteractionRecord,
  CapabilityWorkspace,
  RunEvent,
  ToolInvocation,
  WorkflowRunDetail,
} from '../types';

const truncate = (value: string, limit = 220) => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
};

const toTimestamp = (value?: string) => {
  if (!value) {
    return 0;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const decisionToRecord = ({
  capabilityId,
  decision,
  runId,
  runStepId,
  workItemId,
}: {
  capabilityId: string;
  decision: ApprovalDecision;
  runId: string;
  runStepId: string;
  workItemId?: string;
}): CapabilityInteractionRecord => ({
  id: `approval-${decision.id}`,
  capabilityId,
  interactionType: 'APPROVAL',
  timestamp: decision.createdAt,
  title: decision.disposition === 'APPROVE' ? 'Approval granted' : 'Changes requested',
  summary: truncate(
    decision.comment ||
      `${decision.actorDisplayName} recorded ${decision.disposition.toLowerCase()} for this gate.`,
  ),
  level: decision.disposition === 'APPROVE' ? 'SUCCESS' : 'WARN',
  actorLabel: decision.actorDisplayName,
  runId,
  runStepId,
  workItemId,
});

const mapChatMessage = (message: CapabilityChatMessage): CapabilityInteractionRecord => ({
  id: `chat-${message.id}`,
  capabilityId: message.capabilityId,
  interactionType: 'CHAT',
  timestamp: message.timestamp,
  title: message.role === 'agent' ? `${message.agentName || 'Agent'} replied` : 'Operator message',
  summary: truncate(message.content, 240),
  level: message.role === 'agent' ? 'SUCCESS' : 'NEUTRAL',
  actorLabel: message.role === 'agent' ? message.agentName || 'Agent' : 'Operator',
  agentId: message.agentId,
  agentName: message.agentName,
  workItemId: message.workItemId,
  runId: message.runId,
  workflowStepId: message.workflowStepId,
  traceId: message.traceId,
  sessionId: message.sessionId,
  sessionScope: message.sessionScope,
  sessionScopeId: message.sessionScopeId,
  metadata: {
    model: message.model,
  },
});

const mapExecutionLog = (log: CapabilityWorkspace['executionLogs'][number]): CapabilityInteractionRecord => ({
  id: `log-${log.id}`,
  capabilityId: log.capabilityId,
  interactionType: 'RUN_EVENT',
  timestamp: log.timestamp,
  title: log.message,
  summary: truncate(
    String(
      log.metadata?.outputSummary ||
        log.metadata?.stderrPreview ||
        log.metadata?.stdoutPreview ||
        log.metadata?.resultSummary ||
        log.message,
    ),
    240,
  ),
  level:
    log.level === 'ERROR'
      ? 'ERROR'
      : log.level === 'WARN'
      ? 'WARN'
      : log.metadata?.requestType === 'CHAT'
      ? 'SUCCESS'
      : 'INFO',
  actorLabel: log.agentId ? 'Execution engine' : undefined,
  agentId: log.agentId,
  runId: log.runId,
  runStepId: log.runStepId,
  traceId: log.traceId,
  metadata: log.metadata,
});

const mapRunEvent = (event: RunEvent): CapabilityInteractionRecord => ({
  id: `event-${event.id}`,
  capabilityId: event.capabilityId,
  interactionType: 'RUN_EVENT',
  timestamp: event.timestamp,
  title: event.message,
  summary: truncate(
    String(
      event.details?.summary ||
        event.details?.reasoning ||
        event.details?.stepName ||
        event.type,
    ),
    220,
  ),
  level:
    event.level === 'ERROR'
      ? 'ERROR'
      : event.level === 'WARN'
      ? 'WARN'
      : 'INFO',
  runId: event.runId,
  runStepId: event.runStepId,
  workItemId: event.workItemId,
  traceId: event.traceId,
  metadata: event.details,
});

const mapToolInvocation = ({
  toolInvocation,
  workItemId,
}: {
  toolInvocation: ToolInvocation;
  workItemId?: string;
}): CapabilityInteractionRecord => ({
  id: `tool-${toolInvocation.id}`,
  capabilityId: toolInvocation.capabilityId,
  interactionType: 'TOOL',
  timestamp:
    toolInvocation.completedAt ||
    toolInvocation.startedAt ||
    toolInvocation.createdAt,
  title: `${toolInvocation.toolId.replace(/_/g, ' ')} ${toolInvocation.status.toLowerCase()}`,
  summary: truncate(
    toolInvocation.resultSummary ||
      toolInvocation.stderrPreview ||
      toolInvocation.stdoutPreview ||
      JSON.stringify(toolInvocation.request),
    240,
  ),
  level:
    toolInvocation.status === 'FAILED'
      ? 'ERROR'
      : toolInvocation.status === 'CANCELLED'
      ? 'WARN'
      : 'SUCCESS',
  workItemId,
  runId: toolInvocation.runId,
  runStepId: toolInvocation.runStepId,
  traceId: toolInvocation.traceId,
  toolId: toolInvocation.toolId,
  metadata: {
    status: toolInvocation.status,
    latencyMs: toolInvocation.latencyMs,
    workingDirectory: toolInvocation.workingDirectory,
  },
});

export const buildCapabilityInteractionFeed = ({
  capability,
  workspace,
  workItemId,
  runDetail,
  runEvents = [],
  extraChatMessages = [],
  agentId,
}: {
  capability: Capability;
  workspace: CapabilityWorkspace;
  workItemId?: string;
  runDetail?: WorkflowRunDetail | null;
  runEvents?: RunEvent[];
  extraChatMessages?: CapabilityChatMessage[];
  agentId?: string;
}): CapabilityInteractionFeed => {
  const relatedTaskIds = new Set(
    workspace.tasks
      .filter(task => !workItemId || task.workItemId === workItemId || task.id === workItemId)
      .map(task => task.id),
  );
  if (workItemId) {
    relatedTaskIds.add(workItemId);
  }

  const relevantMessages = [...workspace.messages, ...extraChatMessages].filter(message => {
    if (workItemId) {
      return (
        message.workItemId === workItemId ||
        (message.sessionScope === 'WORK_ITEM' && message.sessionScopeId === workItemId)
      );
    }
    if (agentId && message.agentId) {
      return message.agentId === agentId;
    }
    return true;
  });

  const relevantLogs = workspace.executionLogs.filter(log => {
    if (runDetail?.run?.id && log.runId === runDetail.run.id) {
      return true;
    }
    if (workItemId && relatedTaskIds.has(log.taskId)) {
      return true;
    }
    return !workItemId && (!agentId || log.agentId === agentId);
  });

  const relevantLearning = workspace.learningUpdates.filter(update => {
    if (agentId && update.agentId !== agentId) {
      return false;
    }
    if (workItemId) {
      return (
        update.relatedWorkItemId === workItemId ||
        update.sourceLogIds.some(logId => relevantLogs.some(log => log.id === logId))
      );
    }
    return true;
  });

  const waitRecords = (runDetail?.waits || []).flatMap(wait => {
    const records: CapabilityInteractionRecord[] = [
      {
        id: `wait-${wait.id}`,
        capabilityId: wait.capabilityId,
        interactionType: 'WAIT',
        timestamp: wait.createdAt,
        title: `${wait.type.replace(/_/g, ' ')} gate`,
        summary: truncate(wait.message, 220),
        level: wait.status === 'OPEN' ? 'WARN' : 'SUCCESS',
        actorLabel: wait.requestedBy,
        workItemId,
        runId: wait.runId,
        runStepId: wait.runStepId,
        traceId: wait.traceId,
        metadata: {
          status: wait.status,
          resolution: wait.resolution,
        },
      },
    ];

    return records.concat(
      (wait.approvalDecisions || []).map(decision =>
        decisionToRecord({
          capabilityId: capability.id,
          decision,
          runId: wait.runId,
          runStepId: wait.runStepId,
          workItemId,
        }),
      ),
    );
  });

  const records = [
    ...relevantMessages.map(mapChatMessage),
    ...relevantLogs.map(mapExecutionLog),
    ...runEvents
      .filter(event => !workItemId || event.workItemId === workItemId)
      .map(mapRunEvent),
    ...(runDetail?.toolInvocations || []).map(toolInvocation =>
      mapToolInvocation({
        toolInvocation,
        workItemId,
      }),
    ),
    ...waitRecords,
    ...relevantLearning.map(update => ({
      id: `learning-${update.id}`,
      capabilityId: update.capabilityId,
      interactionType: 'LEARNING' as const,
      timestamp: update.timestamp,
      title: update.triggerType
        ? `${update.triggerType.replace(/_/g, ' ')} learning update`
        : 'Learning update',
      summary: truncate(update.insight, 220),
      level: 'INFO' as const,
      actorLabel: 'Learning loop',
      agentId: update.agentId,
      workItemId: update.relatedWorkItemId,
      runId: update.relatedRunId,
      metadata: {
        triggerType: update.triggerType,
        sourceLogIds: update.sourceLogIds,
      },
    })),
  ]
    .slice()
    .sort((left, right) => toTimestamp(right.timestamp) - toTimestamp(left.timestamp));

  return {
    capabilityId: capability.id,
    scope: workItemId ? 'WORK_ITEM' : 'CAPABILITY',
    scopeId: workItemId,
    generatedAt: new Date().toISOString(),
    records,
    summary: {
      totalCount: records.length,
      chatCount: records.filter(record => record.interactionType === 'CHAT').length,
      toolCount: records.filter(record => record.interactionType === 'TOOL').length,
      waitCount: records.filter(record => record.interactionType === 'WAIT').length,
      approvalCount: records.filter(record => record.interactionType === 'APPROVAL').length,
      learningCount: records.filter(record => record.interactionType === 'LEARNING').length,
    },
  };
};
