import type {
  Artifact,
  CapabilityWorkspace,
  ExecutionLog,
  LearningUpdate,
  WorkItem,
} from '../types';

const BOOTSTRAP_ARTIFACT_LIMIT = 24;
const BOOTSTRAP_TASK_LIMIT = 24;
const BOOTSTRAP_LOG_LIMIT = 24;
const BOOTSTRAP_LEARNING_LIMIT = 16;
const BOOTSTRAP_WORK_ITEM_LIMIT = 32;
const BOOTSTRAP_WORK_ITEM_HISTORY_LIMIT = 8;

const sortDescendingByTimestamp = <T>(
  items: T[],
  getTimestamp: (item: T) => string | undefined,
) =>
  items
    .slice()
    .sort((left, right) =>
      String(getTimestamp(right) || '').localeCompare(String(getTimestamp(left) || '')),
    );

const summarizeArtifactForBootstrap = (artifact: Artifact): Artifact => ({
  ...artifact,
  contentText: undefined,
  contentJson: undefined,
  templateSections: undefined,
  retrievalReferences: undefined,
});

const summarizeExecutionLogForBootstrap = (
  log: ExecutionLog,
): ExecutionLog => ({
  ...log,
  metadata: undefined,
});

const summarizeWorkItemForBootstrap = (workItem: WorkItem): WorkItem => ({
  ...workItem,
  history: (workItem.history || []).slice(-BOOTSTRAP_WORK_ITEM_HISTORY_LIMIT),
});

export const summarizeCapabilityWorkspaceForBootstrap = (
  workspace: CapabilityWorkspace,
): CapabilityWorkspace => ({
  ...workspace,
  artifacts: sortDescendingByTimestamp(
    workspace.artifacts || [],
    artifact => artifact.created,
  )
    .slice(0, BOOTSTRAP_ARTIFACT_LIMIT)
    .map(summarizeArtifactForBootstrap),
  tasks: sortDescendingByTimestamp(workspace.tasks || [], task => task.timestamp).slice(
    0,
    BOOTSTRAP_TASK_LIMIT,
  ),
  executionLogs: sortDescendingByTimestamp(
    workspace.executionLogs || [],
    log => log.timestamp,
  )
    .slice(0, BOOTSTRAP_LOG_LIMIT)
    .map(summarizeExecutionLogForBootstrap),
  learningUpdates: sortDescendingByTimestamp(
    workspace.learningUpdates || [],
    update => update.timestamp,
  ).slice(0, BOOTSTRAP_LEARNING_LIMIT) as LearningUpdate[],
  workItems: sortDescendingByTimestamp(
    workspace.workItems || [],
    workItem => workItem.history[workItem.history.length - 1]?.timestamp,
  )
    .slice(0, BOOTSTRAP_WORK_ITEM_LIMIT)
    .map(summarizeWorkItemForBootstrap),
  messages: [],
  interactionFeed: undefined,
});
