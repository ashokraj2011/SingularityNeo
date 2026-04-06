export type Status = 'PENDING' | 'VERIFIED' | 'RUNNING' | 'STABLE' | 'ALERT' | 'BETA' | 'IN_PROGRESS' | 'ARCHIVED' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'URGENT';

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: 'Analysis' | 'Automation' | 'Security' | 'Compliance' | 'Data';
  version: string;
}

export interface CapabilityStakeholder {
  role: string;
  name: string;
  email: string;
  teamName?: string;
}

export interface CapabilityMetadataEntry {
  key: string;
  value: string;
}

export interface CapabilityExecutionCommandTemplate {
  id: string;
  label: string;
  description?: string;
  command: string[];
  workingDirectory?: string;
  requiresApproval?: boolean;
}

export interface CapabilityDeploymentTarget {
  id: string;
  label: string;
  description?: string;
  commandTemplateId: string;
  workspacePath?: string;
}

export interface CapabilityExecutionConfig {
  defaultWorkspacePath?: string;
  allowedWorkspacePaths: string[];
  commandTemplates: CapabilityExecutionCommandTemplate[];
  deploymentTargets: CapabilityDeploymentTarget[];
}

export interface Capability {
  id: string;
  name: string;
  description: string;
  domain?: string;
  parentCapabilityId?: string;
  businessUnit?: string;
  ownerTeam?: string;
  confluenceLink?: string;
  jiraBoardLink?: string;
  documentationNotes?: string;
  applications: string[];
  apis: string[];
  databases: string[];
  gitRepositories: string[];
  localDirectories: string[];
  teamNames: string[];
  stakeholders: CapabilityStakeholder[];
  additionalMetadata: CapabilityMetadataEntry[];
  executionConfig: CapabilityExecutionConfig;
  status: Status;
  specialAgentId?: string;
  skillLibrary: Skill[];
}

export interface AgentUsage {
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  lastRunAt?: string;
}

export interface AgentOutputRecord {
  id: string;
  title: string;
  summary: string;
  timestamp: string;
  status: 'completed' | 'pending';
  relatedTaskId?: string;
  artifactId?: string;
}

export interface CapabilityAgent {
  id: string;
  capabilityId: string;
  name: string;
  role: string;
  objective: string;
  systemPrompt: string;
  initializationStatus: 'NOT_STARTED' | 'READY';
  documentationSources: string[];
  inputArtifacts: string[];
  outputArtifacts: string[];
  isOwner?: boolean;
  isBuiltIn?: boolean;
  learningNotes?: string[];
  skillIds: string[];
  provider: 'GitHub Copilot API';
  model: string;
  tokenLimit: number;
  usage: AgentUsage;
  previousOutputs: AgentOutputRecord[];
}

export interface CapabilityChatMessage {
  id: string;
  capabilityId: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  agentId?: string;
  agentName?: string;
}

export interface WorkPackage {
  id: string;
  blueprint: string;
  capabilityId: string;
  status: Status;
  owner: {
    name: string;
    avatar?: string;
  };
}

export interface AgentTask {
  id: string;
  title: string;
  agent: string;
  capabilityId: string;
  workItemId?: string;
  workflowId?: string;
  workflowStepId?: string;
  managedByWorkflow?: boolean;
  taskType?: 'DELIVERY' | 'TEST' | 'APPROVAL' | 'GOVERNANCE';
  phase?: WorkItemPhase;
  priority: 'High' | 'Med' | 'Low';
  status: Status;
  timestamp: string;
  prompt?: string;
  executionNotes?: string;
  runId?: string;
  runStepId?: string;
  toolInvocationId?: string;
  linkedArtifacts?: { name: string; size: string; type: 'table' | 'scale' | 'file' }[];
  producedOutputs?: {
    name: string;
    status: 'completed' | 'pending';
    downloadUrl?: string;
    artifactId?: string;
    runId?: string;
    runStepId?: string;
  }[];
}

export interface Blueprint {
  id: string;
  title: string;
  capabilityId: string;
  description: string;
  version: string;
  activeIds: number;
  status: Status;
  type: string;
}

export type ArtifactKind =
  | 'PHASE_OUTPUT'
  | 'HANDOFF_PACKET'
  | 'APPROVAL_RECORD'
  | 'INPUT_NOTE'
  | 'CONFLICT_RESOLUTION'
  | 'EXECUTION_SUMMARY';

export type ArtifactContentFormat = 'TEXT' | 'MARKDOWN' | 'JSON';

export interface Artifact {
  id: string;
  name: string;
  capabilityId: string;
  type: string;
  inputs?: string[];
  version: string;
  agent: string;
  created: string;
  template?: string;
  documentationStatus?: 'PENDING' | 'SYNCED' | 'FAILED';
  isLearningArtifact?: boolean;
  isMasterArtifact?: boolean;
  decisions?: string[];
  changes?: string[];
  learningInsights?: string[];
  governanceRules?: string[];
  description?: string;
  direction?: 'INPUT' | 'OUTPUT';
  connectedAgentId?: string;
  sourceWorkflowId?: string;
  runId?: string;
  runStepId?: string;
  toolInvocationId?: string;
  summary?: string;
  artifactKind?: ArtifactKind;
  phase?: WorkItemPhase;
  workItemId?: string;
  sourceRunId?: string;
  sourceRunStepId?: string;
  sourceWaitId?: string;
  handoffFromAgentId?: string;
  handoffToAgentId?: string;
  contentFormat?: ArtifactContentFormat;
  mimeType?: string;
  fileName?: string;
  contentText?: string;
  contentJson?: Record<string, any> | any[];
  downloadable?: boolean;
  traceId?: string;
  latencyMs?: number;
  costUsd?: number;
  policyDecisionId?: string;
  retrievalReferences?: MemoryReference[];
}

export type WorkItemPhase =
  | 'BACKLOG'
  | 'ANALYSIS'
  | 'DESIGN'
  | 'DEVELOPMENT'
  | 'QA'
  | 'GOVERNANCE'
  | 'RELEASE'
  | 'DONE';

export type WorkflowStepType = 'DELIVERY' | 'GOVERNANCE_GATE' | 'HUMAN_APPROVAL';

export type ToolAdapterId =
  | 'workspace_list'
  | 'workspace_read'
  | 'workspace_search'
  | 'git_status'
  | 'workspace_write'
  | 'run_build'
  | 'run_test'
  | 'run_docs'
  | 'run_deploy';

export interface WorkflowHandoffProtocol {
  id: string;
  name: string;
  sourceStepId: string;
  targetAgentId?: string;
  targetPhase?: WorkItemPhase;
  description?: string;
  rules: string[];
  validationRequired: boolean;
  autoDocumentation: boolean;
}

export interface WorkflowStep {
  id: string;
  name: string;
  phase: WorkItemPhase;
  stepType: WorkflowStepType;
  agentId: string;
  action: string;
  description?: string;
  inputArtifactId?: string;
  outputArtifactId?: string;
  handoffToAgentId?: string;
  handoffToPhase?: WorkItemPhase;
  handoffLabel?: string;
  handoffProtocolId?: string;
  governanceGate?: string;
  approverRoles?: string[];
  exitCriteria?: string[];
  templatePath?: string;
  allowedToolIds?: ToolAdapterId[];
  preferredWorkspacePath?: string;
  executionNotes?: string;
}

export interface Workflow {
  id: string;
  name: string;
  capabilityId: string;
  steps: WorkflowStep[];
  handoffProtocols?: WorkflowHandoffProtocol[];
  status: Status;
  workflowType?: 'SDLC' | 'Operational' | 'Governance' | 'Custom';
  scope?: 'CAPABILITY' | 'GLOBAL';
  summary?: string;
}

export interface ExecutionLog {
  id: string;
  taskId: string;
  capabilityId: string;
  agentId: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  runId?: string;
  runStepId?: string;
  toolInvocationId?: string;
  traceId?: string;
  latencyMs?: number;
  costUsd?: number;
  metadata?: Record<string, any>;
}

export interface LearningUpdate {
  id: string;
  capabilityId: string;
  agentId: string;
  sourceLogIds: string[];
  insight: string;
  skillUpdate?: string;
  timestamp: string;
}

export type WorkItemStatus = 'ACTIVE' | 'BLOCKED' | 'PENDING_APPROVAL' | 'COMPLETED';

export interface WorkItemPendingRequest {
  type: 'APPROVAL' | 'INPUT' | 'CONFLICT_RESOLUTION';
  message: string;
  requestedBy: string;
  timestamp: string;
}

export interface WorkItemBlocker {
  type: 'CONFLICT_RESOLUTION' | 'HUMAN_INPUT' | 'APPROVAL';
  message: string;
  requestedBy: string;
  timestamp: string;
  status: 'OPEN' | 'RESOLVED';
  resolution?: string;
}

export interface WorkItemHistoryEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  detail: string;
  phase?: WorkItemPhase;
  status?: WorkItemStatus;
}

export interface WorkItem {
  id: string;
  title: string;
  description: string;
  phase: WorkItemPhase;
  capabilityId: string;
  workflowId: string;
  currentStepId?: string;
  assignedAgentId?: string;
  status: WorkItemStatus;
  priority: 'High' | 'Med' | 'Low';
  tags: string[];
  pendingRequest?: WorkItemPendingRequest;
  blocker?: WorkItemBlocker;
  activeRunId?: string;
  lastRunId?: string;
  history: WorkItemHistoryEntry[];
}

export type WorkflowRunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING_APPROVAL'
  | 'WAITING_INPUT'
  | 'WAITING_CONFLICT'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type WorkflowRunStepStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'WAITING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type ToolInvocationStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type RunWaitType = 'APPROVAL' | 'INPUT' | 'CONFLICT_RESOLUTION';

export type RunWaitStatus = 'OPEN' | 'RESOLVED' | 'CANCELLED';

export interface WorkflowRun {
  id: string;
  capabilityId: string;
  workItemId: string;
  workflowId: string;
  status: WorkflowRunStatus;
  attemptNumber: number;
  workflowSnapshot: Workflow;
  currentStepId?: string;
  currentPhase?: WorkItemPhase;
  assignedAgentId?: string;
  pauseReason?: RunWaitType;
  currentWaitId?: string;
  terminalOutcome?: string;
  restartFromPhase?: WorkItemPhase;
  traceId?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRunStep {
  id: string;
  capabilityId: string;
  runId: string;
  workflowStepId: string;
  stepIndex: number;
  phase: WorkItemPhase;
  name: string;
  stepType: WorkflowStepType;
  agentId: string;
  status: WorkflowRunStepStatus;
  attemptCount: number;
  spanId?: string;
  evidenceSummary?: string;
  outputSummary?: string;
  waitId?: string;
  lastToolInvocationId?: string;
  retrievalReferences?: MemoryReference[];
  startedAt?: string;
  completedAt?: string;
  metadata?: Record<string, any>;
}

export interface ToolInvocation {
  id: string;
  capabilityId: string;
  runId: string;
  runStepId: string;
  traceId?: string;
  spanId?: string;
  toolId: ToolAdapterId;
  status: ToolInvocationStatus;
  request: Record<string, any>;
  resultSummary?: string;
  workingDirectory?: string;
  exitCode?: number;
  stdoutPreview?: string;
  stderrPreview?: string;
  retryable: boolean;
  sandboxProfile?: string;
  policyDecisionId?: string;
  latencyMs?: number;
  costUsd?: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface RunEvent {
  id: string;
  capabilityId: string;
  runId: string;
  workItemId: string;
  traceId?: string;
  spanId?: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  type: string;
  message: string;
  runStepId?: string;
  toolInvocationId?: string;
  details?: Record<string, any>;
}

export interface RunWait {
  id: string;
  capabilityId: string;
  runId: string;
  runStepId: string;
  traceId?: string;
  spanId?: string;
  type: RunWaitType;
  status: RunWaitStatus;
  message: string;
  requestedBy: string;
  resolution?: string;
  resolvedBy?: string;
  payload?: Record<string, any>;
  createdAt: string;
  resolvedAt?: string;
}

export interface WorkflowRunDetail {
  run: WorkflowRun;
  steps: WorkflowRunStep[];
  waits: RunWait[];
  toolInvocations: ToolInvocation[];
}

export interface LedgerArtifactRecord {
  artifact: Artifact;
  workItemTitle?: string;
  runStatus?: WorkflowRunStatus;
  stepName?: string;
  stepType?: WorkflowStepType;
  runAttempt?: number;
  sourceAgentName?: string;
  targetAgentName?: string;
}

export interface HumanInteractionRecord {
  id: string;
  capabilityId: string;
  workItemId?: string;
  workItemTitle?: string;
  runId: string;
  runStepId: string;
  waitId: string;
  phase?: WorkItemPhase;
  stepName?: string;
  interactionType: RunWaitType;
  status: RunWaitStatus;
  message: string;
  requestedBy: string;
  requestedByName?: string;
  createdAt: string;
  resolution?: string;
  resolvedBy?: string;
  resolvedByName?: string;
  resolvedAt?: string;
  artifactId?: string;
}

export interface PhaseEvidenceGroup {
  phase: WorkItemPhase;
  label: string;
  stepName?: string;
  stepType?: WorkflowStepType;
  artifacts: LedgerArtifactRecord[];
  handoffArtifacts: LedgerArtifactRecord[];
  toolInvocations: ToolInvocation[];
  logs: ExecutionLog[];
  events: RunEvent[];
  interactions: HumanInteractionRecord[];
}

export interface CompletedWorkOrderSummary {
  workItem: WorkItem;
  latestCompletedRun?: WorkflowRun;
  supersededRuns: WorkflowRun[];
  artifactCount: number;
  handoffCount: number;
  interactionCount: number;
  eventCount: number;
  logCount: number;
  completedAt?: string;
}

export interface CompletedWorkOrderDetail {
  workItem: WorkItem;
  workflow?: Workflow;
  latestCompletedRun?: WorkflowRun;
  runHistory: WorkflowRun[];
  latestRunDetail?: WorkflowRunDetail;
  artifacts: LedgerArtifactRecord[];
  humanInteractions: HumanInteractionRecord[];
  phaseGroups: PhaseEvidenceGroup[];
  events: RunEvent[];
  logs: ExecutionLog[];
}

export interface ArtifactContentResponse {
  artifact: Artifact;
  contentFormat: ArtifactContentFormat;
  mimeType: string;
  fileName: string;
  contentText?: string;
  contentJson?: Record<string, any> | any[];
}

export type TelemetrySpanKind =
  | 'HTTP'
  | 'CHAT'
  | 'RUN'
  | 'STEP'
  | 'TOOL'
  | 'MEMORY'
  | 'POLICY'
  | 'EVAL';

export type TelemetrySpanStatus = 'OK' | 'ERROR' | 'WAITING' | 'RUNNING';

export interface TelemetrySpan {
  id: string;
  capabilityId: string;
  traceId: string;
  parentSpanId?: string;
  entityType: TelemetrySpanKind;
  entityId?: string;
  name: string;
  status: TelemetrySpanStatus;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  model?: string;
  costUsd?: number;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  attributes?: Record<string, any>;
}

export interface TelemetryMetricSample {
  id: string;
  capabilityId: string;
  traceId?: string;
  scopeType: 'CAPABILITY' | 'AGENT' | 'RUN' | 'STEP' | 'TOOL' | 'CHAT' | 'EVAL';
  scopeId: string;
  metricName: string;
  metricValue: number;
  unit: 'ms' | 'usd' | 'tokens' | 'count' | 'ratio';
  tags?: Record<string, string>;
  recordedAt: string;
}

export interface TelemetrySummary {
  capabilityId: string;
  totalRuns: number;
  activeRuns: number;
  waitingRuns: number;
  failedRuns: number;
  totalCostUsd: number;
  totalTokens: number;
  averageLatencyMs: number;
  policyDecisionCount: number;
  memoryDocumentCount: number;
  recentSpans: TelemetrySpan[];
  recentMetrics: TelemetryMetricSample[];
}

export type PolicyActionType =
  | 'workspace_write'
  | 'git_branch'
  | 'run_build'
  | 'run_test'
  | 'run_docs'
  | 'run_deploy'
  | 'destructive_git'
  | 'custom';

export type PolicyDecisionResult = 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';

export interface PolicyDecision {
  id: string;
  capabilityId: string;
  traceId?: string;
  runId?: string;
  runStepId?: string;
  toolInvocationId?: string;
  actionType: PolicyActionType;
  targetId?: string;
  decision: PolicyDecisionResult;
  reason: string;
  requestedByAgentId?: string;
  createdAt: string;
}

export type MemorySourceType =
  | 'CAPABILITY_METADATA'
  | 'CHAT_SESSION'
  | 'WORK_ITEM'
  | 'ARTIFACT'
  | 'HANDOFF'
  | 'HUMAN_INTERACTION'
  | 'REPOSITORY_FILE';

export type MemoryStoreTier = 'WORKING' | 'SESSION' | 'LONG_TERM';

export interface MemoryReference {
  documentId: string;
  chunkId: string;
  title: string;
  sourceType: MemorySourceType;
  tier: MemoryStoreTier;
  score?: number;
}

export interface MemoryDocument {
  id: string;
  capabilityId: string;
  title: string;
  sourceType: MemorySourceType;
  tier: MemoryStoreTier;
  sourceId?: string;
  sourceUri?: string;
  freshness?: 'HOT' | 'WARM' | 'COLD';
  metadata?: Record<string, any>;
  contentPreview: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryChunk {
  id: string;
  capabilityId: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  tokenEstimate: number;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface MemorySearchResult {
  reference: MemoryReference;
  document: MemoryDocument;
  chunk: MemoryChunk;
}

export interface EvalSuite {
  id: string;
  capabilityId: string;
  name: string;
  description: string;
  agentRole: string;
  evalType: 'STRUCTURED_OUTPUT' | 'RETRIEVAL' | 'WORKFLOW';
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EvalCase {
  id: string;
  capabilityId: string;
  suiteId: string;
  name: string;
  description: string;
  input: Record<string, any>;
  expected: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface EvalRunCaseResult {
  id: string;
  capabilityId: string;
  evalRunId: string;
  evalCaseId: string;
  status: 'PASSED' | 'FAILED' | 'WARN';
  score: number;
  summary: string;
  details?: Record<string, any>;
  createdAt: string;
}

export interface EvalRun {
  id: string;
  capabilityId: string;
  suiteId: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  traceId?: string;
  judgeModel?: string;
  score?: number;
  summary?: string;
  createdAt: string;
  completedAt?: string;
}

export interface EvalRunDetail {
  run: EvalRun;
  suite: EvalSuite;
  cases: EvalCase[];
  results: EvalRunCaseResult[];
}

export interface RunConsoleSnapshot {
  capabilityId: string;
  telemetry: TelemetrySummary;
  activeRuns: WorkflowRun[];
  recentRuns: WorkflowRun[];
  recentEvents: RunEvent[];
  recentPolicyDecisions: PolicyDecision[];
}

export interface ChatStreamEvent {
  type:
    | 'start'
    | 'memory'
    | 'delta'
    | 'complete'
    | 'error';
  content?: string;
  createdAt?: string;
  model?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  traceId?: string;
  memoryReferences?: MemoryReference[];
  error?: string;
}

export interface CapabilityWorkspace {
  capabilityId: string;
  agents: CapabilityAgent[];
  workflows: Workflow[];
  artifacts: Artifact[];
  tasks: AgentTask[];
  executionLogs: ExecutionLog[];
  learningUpdates: LearningUpdate[];
  workItems: WorkItem[];
  messages: CapabilityChatMessage[];
  activeChatAgentId?: string;
  createdAt: string;
}
