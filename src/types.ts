export type Status = 'PENDING' | 'VERIFIED' | 'RUNNING' | 'STABLE' | 'ALERT' | 'BETA' | 'IN_PROGRESS' | 'ARCHIVED' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'URGENT';

export type SkillKind = 'GENERAL' | 'ROLE' | 'CUSTOM' | 'LEARNING';
export type SkillOrigin = 'FOUNDATION' | 'CAPABILITY';
export type AgentRoleStarterKey =
  | 'OWNER'
  | 'PLANNING'
  | 'BUSINESS-ANALYST'
  | 'ARCHITECT'
  | 'SOFTWARE-DEVELOPER'
  | 'QA'
  | 'DEVOPS'
  | 'VALIDATION'
  | 'EXECUTION-OPS'
  | 'CONTRARIAN-REVIEWER';

export interface AgentArtifactExpectation {
  artifactName: string;
  direction: 'INPUT' | 'OUTPUT';
  requiredByDefault: boolean;
  description?: string;
}

export interface AgentOperatingContract {
  description: string;
  primaryResponsibilities: string[];
  workingApproach: string[];
  preferredOutputs: string[];
  guardrails: string[];
  conflictResolution: string[];
  definitionOfDone: string;
  suggestedInputArtifacts: AgentArtifactExpectation[];
  expectedOutputArtifacts: AgentArtifactExpectation[];
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: 'Analysis' | 'Automation' | 'Security' | 'Compliance' | 'Data';
  version: string;
  contentMarkdown?: string;
  kind?: SkillKind;
  origin?: SkillOrigin;
  defaultTemplateKeys?: string[];
}

export interface CapabilityStakeholder {
  role: string;
  name: string;
  email: string;
  teamName?: string;
}

export interface WorkItemPhaseStakeholder {
  role: string;
  name: string;
  email: string;
  teamName?: string;
}

export interface WorkItemPhaseStakeholderAssignment {
  phaseId: WorkflowPhaseId;
  stakeholders: WorkItemPhaseStakeholder[];
}

export interface WorkItemAttachmentUpload {
  fileName: string;
  mimeType?: string;
  contentText: string;
  sizeBytes?: number;
}

export interface CapabilityMetadataEntry {
  key: string;
  value: string;
}

export type CapabilityDatabaseEngine =
  | 'POSTGRES'
  | 'MYSQL'
  | 'MARIADB'
  | 'SQLSERVER'
  | 'ORACLE'
  | 'SNOWFLAKE'
  | 'MONGODB'
  | 'REDIS'
  | 'OTHER';

export type CapabilityDatabaseAuthentication =
  | 'SECRET_REFERENCE'
  | 'USERNAME_PASSWORD'
  | 'IAM'
  | 'INTEGRATED'
  | 'NONE';

export type CapabilityDatabaseSslMode = 'DISABLE' | 'PREFER' | 'REQUIRE';

export interface CapabilityDatabaseConfig {
  id: string;
  label: string;
  engine: CapabilityDatabaseEngine;
  host: string;
  port?: number;
  databaseName: string;
  schema?: string;
  username?: string;
  authentication: CapabilityDatabaseAuthentication;
  secretReference?: string;
  sslMode?: CapabilityDatabaseSslMode;
  readOnly?: boolean;
  notes?: string;
}

export interface WorkspaceGithubConnectorSettings {
  enabled: boolean;
  baseUrl?: string;
  secretReference?: string;
  ownerHint?: string;
  notes?: string;
}

export interface WorkspaceJiraConnectorSettings {
  enabled: boolean;
  baseUrl?: string;
  email?: string;
  secretReference?: string;
  projectKey?: string;
  notes?: string;
}

export interface WorkspaceConfluenceConnectorSettings {
  enabled: boolean;
  baseUrl?: string;
  email?: string;
  secretReference?: string;
  spaceKey?: string;
  notes?: string;
}

export interface WorkspaceConnectorSettings {
  github: WorkspaceGithubConnectorSettings;
  jira: WorkspaceJiraConnectorSettings;
  confluence: WorkspaceConfluenceConnectorSettings;
}

export interface WorkspaceSettings {
  databaseConfigs: CapabilityDatabaseConfig[];
  connectors: WorkspaceConnectorSettings;
}

export interface WorkspaceDatabaseBootstrapConfig {
  host: string;
  port: number;
  databaseName: string;
  user: string;
  adminDatabaseName?: string;
  password?: string;
}

export interface WorkspaceDatabaseBootstrapProfile
  extends WorkspaceDatabaseBootstrapConfig {
  id: string;
  label: string;
  lastUsedAt: string;
}

export interface WorkspaceDatabaseBootstrapProfileSnapshot {
  activeProfileId?: string;
  profiles: WorkspaceDatabaseBootstrapProfile[];
}

export interface WorkspaceDatabaseRuntimeInfo {
  host: string;
  port: number;
  databaseName: string;
  user: string;
  adminDatabaseName?: string;
  passwordConfigured: boolean;
  pgvectorAvailable: boolean;
  lastConnectionError?: string;
}

export interface WorkspaceDatabaseBootstrapStatus {
  runtime: WorkspaceDatabaseRuntimeInfo;
  adminReachable: boolean;
  databaseExists: boolean;
  databaseReachable: boolean;
  schemaInitialized: boolean;
  foundationsInitialized: boolean;
  ready: boolean;
  lastError?: string;
}

export interface WorkspaceAgentTemplate {
  id: string;
  key: string;
  roleStarterKey: AgentRoleStarterKey;
  name: string;
  role: string;
  objective: string;
  systemPrompt: string;
  contract: AgentOperatingContract;
  inputArtifacts: string[];
  outputArtifacts: string[];
  defaultSkillIds: string[];
  preferredToolIds: ToolAdapterId[];
}

export interface WorkspaceEvalCaseTemplate {
  id: string;
  name: string;
  description: string;
  input: Record<string, any>;
  expected: Record<string, any>;
}

export interface WorkspaceEvalSuiteTemplate {
  id: string;
  name: string;
  description: string;
  agentRole: string;
  evalType: 'STRUCTURED_OUTPUT' | 'RETRIEVAL' | 'WORKFLOW';
  enabled: boolean;
  cases: WorkspaceEvalCaseTemplate[];
}

export interface WorkspaceWorkflowTemplate {
  id: string;
  templateId: string;
  name: string;
  summary?: string;
  workflowType?: 'SDLC' | 'Operational' | 'Governance' | 'Custom';
  scope: 'GLOBAL';
  schemaVersion?: number;
  entryNodeId?: string;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
  steps: WorkflowStep[];
  publishState?: WorkflowPublishState;
}

export interface WorkspaceArtifactTemplate {
  id: string;
  name: string;
  type: string;
  direction: 'INPUT' | 'OUTPUT';
  agentLabel: string;
  description: string;
  inputs: string[];
  template: string;
  sourceWorkflow: boolean;
}

export interface WorkspaceToolTemplate {
  id: string;
  toolId: ToolAdapterId;
  label: string;
  description: string;
  category:
    | 'Workspace'
    | 'Search'
    | 'Git'
    | 'Build'
    | 'Test'
    | 'Docs'
    | 'Deploy';
  requiresApproval: boolean;
}

export interface WorkspaceFoundationCatalog {
  agentTemplates: WorkspaceAgentTemplate[];
  workflowTemplates: WorkspaceWorkflowTemplate[];
  evalSuiteTemplates: WorkspaceEvalSuiteTemplate[];
  skillTemplates: Skill[];
  artifactTemplates: WorkspaceArtifactTemplate[];
  toolTemplates: WorkspaceToolTemplate[];
  initializedAt?: string;
}

export interface WorkspaceFoundationSummary {
  initialized: boolean;
  lastInitializedAt?: string;
  agentTemplateCount: number;
  workflowTemplateCount: number;
  evalSuiteTemplateCount: number;
  skillTemplateCount: number;
  artifactTemplateCount: number;
  toolTemplateCount: number;
  totalTemplateCount: number;
}

export interface WorkspaceCatalogSnapshot {
  databaseRuntime: WorkspaceDatabaseRuntimeInfo;
  foundations: WorkspaceFoundationCatalog;
  summary: WorkspaceFoundationSummary;
}

export interface WorkspaceDatabaseBootstrapResult {
  status: WorkspaceDatabaseBootstrapStatus;
  catalogSnapshot: WorkspaceCatalogSnapshot;
  profileSnapshot?: WorkspaceDatabaseBootstrapProfileSnapshot;
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

export interface CapabilityOnboardingDraft {
  name: string;
  domain: string;
  parentCapabilityId: string;
  businessUnit: string;
  ownerTeam: string;
  description: string;
  businessOutcome: string;
  successMetrics: string[];
  definitionOfDone: string;
  requiredEvidenceKinds: string[];
  operatingPolicySummary: string;
  githubRepositories: string[];
  jiraBoardLink: string;
  confluenceLink: string;
  documentationNotes: string;
  localDirectories: string[];
  defaultWorkspacePath: string;
  allowedWorkspacePaths: string[];
  commandTemplates: CapabilityExecutionCommandTemplate[];
  deploymentTargets: CapabilityDeploymentTarget[];
}

export interface ConnectorValidationItem {
  connector: 'GITHUB' | 'JIRA' | 'CONFLUENCE';
  value: string;
  valid: boolean;
  message: string;
}

export interface ConnectorValidationResult {
  valid: boolean;
  items: ConnectorValidationItem[];
}

export interface WorkspacePathValidationResult {
  path: string;
  normalizedPath?: string;
  valid: boolean;
  exists: boolean;
  isDirectory: boolean;
  readable: boolean;
  message: string;
}

export interface CommandTemplateValidationResult {
  templateId: string;
  valid: boolean;
  issues: string[];
  message: string;
}

export interface DeploymentTargetValidationResult {
  targetId: string;
  valid: boolean;
  issues: string[];
  message: string;
}

export type WorkspaceStackKind = 'NODE' | 'PYTHON' | 'JAVA' | 'GENERIC';

export type WorkspaceBuildTool =
  | 'NPM'
  | 'PNPM'
  | 'YARN'
  | 'UV'
  | 'POETRY'
  | 'PIP'
  | 'PIPENV'
  | 'MAVEN'
  | 'GRADLE'
  | 'UNKNOWN';

export type WorkspaceDetectionConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface WorkspaceStackProfile {
  stack: WorkspaceStackKind;
  buildTool: WorkspaceBuildTool;
  confidence: WorkspaceDetectionConfidence;
  workspacePath?: string;
  summary: string;
}

export interface WorkspaceCommandRecommendation
  extends CapabilityExecutionCommandTemplate {
  rationale?: string;
}

export interface WorkspaceDetectionResult {
  requestedPaths: string[];
  normalizedPath?: string;
  profile: WorkspaceStackProfile;
  evidenceFiles: string[];
  recommendedCommandTemplates: WorkspaceCommandRecommendation[];
  recommendedDeploymentTargets: CapabilityDeploymentTarget[];
}

export type WorkflowPhaseId = string;

export type SystemPhaseId = 'BACKLOG' | 'DONE';

export interface CapabilityLifecyclePhase {
  id: WorkflowPhaseId;
  label: string;
  description?: string;
}

export interface RetiredCapabilityLifecyclePhase
  extends CapabilityLifecyclePhase {
  retiredAt: string;
}

export interface CapabilityLifecycle {
  version: number;
  phases: CapabilityLifecyclePhase[];
  retiredPhases: RetiredCapabilityLifecyclePhase[];
}

export type CapabilitySystemRole = 'FOUNDATION';

export interface Capability {
  id: string;
  name: string;
  description: string;
  domain?: string;
  parentCapabilityId?: string;
  businessUnit?: string;
  ownerTeam?: string;
  businessOutcome?: string;
  successMetrics: string[];
  definitionOfDone?: string;
  requiredEvidenceKinds: string[];
  operatingPolicySummary?: string;
  confluenceLink?: string;
  jiraBoardLink?: string;
  documentationNotes?: string;
  applications: string[];
  apis: string[];
  databases: string[];
  databaseConfigs?: CapabilityDatabaseConfig[];
  gitRepositories: string[];
  localDirectories: string[];
  teamNames: string[];
  stakeholders: CapabilityStakeholder[];
  additionalMetadata: CapabilityMetadataEntry[];
  lifecycle: CapabilityLifecycle;
  executionConfig: CapabilityExecutionConfig;
  status: Status;
  specialAgentId?: string;
  isSystemCapability?: boolean;
  systemCapabilityRole?: CapabilitySystemRole;
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

export type AgentLearningStatus =
  | 'NOT_STARTED'
  | 'QUEUED'
  | 'LEARNING'
  | 'READY'
  | 'STALE'
  | 'ERROR';

export type AgentSessionScope = 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';

export interface AgentLearningProfile {
  status: AgentLearningStatus;
  summary: string;
  highlights: string[];
  contextBlock: string;
  sourceDocumentIds: string[];
  sourceArtifactIds: string[];
  sourceCount: number;
  refreshedAt?: string;
  lastRequestedAt?: string;
  lastError?: string;
}

export interface AgentSessionSummary {
  sessionId: string;
  scope: AgentSessionScope;
  scopeId?: string;
  lastUsedAt: string;
  model: string;
  requestCount: number;
  totalTokens: number;
}

export interface CopilotSessionMonitorEntry {
  sessionId: string;
  agentId?: string;
  agentName: string;
  scope: AgentSessionScope;
  scopeId?: string;
  lastUsedAt: string;
  createdAt?: string;
  model: string;
  requestCount: number;
  totalTokens: number;
  live: boolean;
  resumable: boolean;
  state: 'ACTIVE' | 'STORED';
}

export interface CopilotSessionMonitorSnapshot {
  capabilityId: string;
  runtime: {
    configured: boolean;
    provider: string;
    runtimeAccessMode?: 'copilot-session' | 'headless-cli' | 'http-fallback' | 'unconfigured';
    httpFallbackEnabled?: boolean;
    tokenSource: string | null;
    defaultModel: string;
    githubIdentity?: {
      login: string;
      name?: string;
    } | null;
    activeManagedSessions: number;
  };
  summary: {
    activeSessionCount: number;
    storedSessionCount: number;
    resumableSessionCount: number;
    totalTokens: number;
    generalChatCount: number;
    workItemCount: number;
    taskCount: number;
  };
  sessions: CopilotSessionMonitorEntry[];
}

export interface AgentLearningProfileDetail {
  capabilityId: string;
  agentId: string;
  profile: AgentLearningProfile;
  documents: MemoryDocument[];
  sessions: AgentSessionSummary[];
}

export interface CapabilityAgent {
  id: string;
  capabilityId: string;
  name: string;
  role: string;
  roleStarterKey?: AgentRoleStarterKey;
  objective: string;
  systemPrompt: string;
  contract: AgentOperatingContract;
  initializationStatus: 'NOT_STARTED' | 'READY';
  documentationSources: string[];
  inputArtifacts: string[];
  outputArtifacts: string[];
  isOwner?: boolean;
  isBuiltIn?: boolean;
  standardTemplateKey?: string;
  learningNotes?: string[];
  skillIds: string[];
  preferredToolIds?: ToolAdapterId[];
  provider: 'GitHub Copilot SDK' | 'GitHub Copilot API';
  model: string;
  tokenLimit: number;
  usage: AgentUsage;
  previousOutputs: AgentOutputRecord[];
  learningProfile: AgentLearningProfile;
  sessionSummaries: AgentSessionSummary[];
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
  | 'CODE_DIFF'
  | 'HANDOFF_PACKET'
  | 'APPROVAL_RECORD'
  | 'INPUT_NOTE'
  | 'STAGE_CONTROL_NOTE'
  | 'CONFLICT_RESOLUTION'
  | 'CONTRARIAN_REVIEW'
  | 'EXECUTION_PLAN'
  | 'REVIEW_PACKET'
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

export type WorkItemPhase = WorkflowPhaseId;

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

export type WorkflowNodeType =
  | 'START'
  | 'DELIVERY'
  | 'EVENT'
  | 'ALERT'
  | 'GOVERNANCE_GATE'
  | 'HUMAN_APPROVAL'
  | 'DECISION'
  | 'PARALLEL_SPLIT'
  | 'PARALLEL_JOIN'
  | 'RELEASE'
  | 'END'
  | 'EXTRACT'
  | 'TRANSFORM'
  | 'LOAD'
  | 'FILTER';

export interface WorkflowNodeEtlConfig {
  subType?: string;
  connectionId?: string;
  sourceTable?: string;
  sourceQuery?: string;
  targetTable?: string;
  writeMode?: 'APPEND' | 'OVERWRITE' | 'UPSERT';
  filterExpression?: string;
  mappingRules?: string;
  joinType?: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';
  joinKey?: string;
  aggregateFunction?: string;
  schemaHint?: string;
}

export type WorkflowEventTrigger = 'ON_ENTER' | 'ON_SUCCESS' | 'ON_FAILURE';

export interface WorkflowEventConfig {
  eventName?: string;
  eventSource?: string;
  trigger?: WorkflowEventTrigger;
  payloadTemplate?: string;
}

export type WorkflowAlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface WorkflowAlertConfig {
  severity?: WorkflowAlertSeverity;
  channel?: string;
  notifyRoles?: string[];
  messageTemplate?: string;
  requiresAcknowledgement?: boolean;
}

export type WorkflowPublishState = 'DRAFT' | 'VALIDATED' | 'PUBLISHED';

export type WorkflowEdgeConditionType =
  | 'DEFAULT'
  | 'SUCCESS'
  | 'FAILURE'
  | 'APPROVED'
  | 'REJECTED'
  | 'PARALLEL'
  | 'CUSTOM';

export interface WorkflowGraphLayout {
  x: number;
  y: number;
}

export interface WorkflowArtifactContract {
  requiredInputs?: string[];
  expectedOutputs?: string[];
  notes?: string;
}

export type RequiredInputFieldSource =
  | 'WORK_ITEM'
  | 'CAPABILITY'
  | 'WORKSPACE'
  | 'HANDOFF'
  | 'ARTIFACT'
  | 'HUMAN_INPUT'
  | 'RUNTIME';

export type RequiredInputFieldKind =
  | 'TEXT'
  | 'MARKDOWN'
  | 'PATH'
  | 'ARTIFACT'
  | 'CONTEXT';

export interface RequiredInputField {
  id: string;
  label: string;
  description?: string;
  required: boolean;
  source: RequiredInputFieldSource;
  kind: RequiredInputFieldKind;
  valueHint?: string;
}

export interface CompiledRequiredInputField extends RequiredInputField {
  status: 'READY' | 'MISSING';
  valueSummary?: string;
}

export interface CompiledArtifactChecklistItem {
  id: string;
  label: string;
  direction: 'INPUT' | 'OUTPUT';
  status: 'READY' | 'EXPECTED';
  description?: string;
}

export interface ExecutionBoundary {
  allowedToolIds: ToolAdapterId[];
  workspaceMode: 'NONE' | 'READ_ONLY' | 'APPROVED_WRITE';
  requiresHumanApproval: boolean;
  escalationTriggers: string[];
}

export interface CompiledStepContext {
  compiledAt: string;
  stepId: string;
  stepName: string;
  phase: WorkItemPhase;
  stepType: WorkflowStepType;
  objective: string;
  description?: string;
  executionNotes?: string;
  preferredWorkspacePath?: string;
  executionBoundary: ExecutionBoundary;
  requiredInputs: CompiledRequiredInputField[];
  missingInputs: CompiledRequiredInputField[];
  artifactChecklist: CompiledArtifactChecklistItem[];
  agentSuggestedInputs: AgentArtifactExpectation[];
  agentExpectedOutputs: AgentArtifactExpectation[];
  completionChecklist: string[];
  memoryBoundary: string[];
  nextActions: string[];
  handoffContext?: string;
  resolvedWaitContext?: string;
}

export interface CompiledWorkItemPlanStepSummary {
  stepId: string;
  name: string;
  phase: WorkItemPhase;
  stepType: WorkflowStepType;
  agentId: string;
}

export interface CompiledWorkItemPlan {
  compiledAt: string;
  workItemId: string;
  workflowId: string;
  workflowName: string;
  currentPhase: WorkItemPhase;
  currentStepId: string;
  currentStepName: string;
  lifecyclePhases: WorkItemPhase[];
  planSummary: string;
  stepSequence: CompiledWorkItemPlanStepSummary[];
  currentStep: CompiledStepContext;
}

export interface WorkflowNode {
  id: string;
  name: string;
  type: WorkflowNodeType;
  phase: WorkItemPhase;
  layout: WorkflowGraphLayout;
  agentId?: string;
  action?: string;
  description?: string;
  inputArtifactId?: string;
  outputArtifactId?: string;
  governanceGate?: string;
  approverRoles?: string[];
  exitCriteria?: string[];
  templatePath?: string;
  allowedToolIds?: ToolAdapterId[];
  preferredWorkspacePath?: string;
  executionNotes?: string;
  etlConfig?: WorkflowNodeEtlConfig;
  eventConfig?: WorkflowEventConfig;
  alertConfig?: WorkflowAlertConfig;
  artifactContract?: WorkflowArtifactContract;
  requiredInputs?: RequiredInputField[];
  completionGates?: string[];
  executionBoundary?: Partial<ExecutionBoundary>;
}

export interface WorkflowEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  label?: string;
  conditionType: WorkflowEdgeConditionType;
  handoffProtocolId?: string;
  artifactContract?: WorkflowArtifactContract;
  branchKey?: string;
}

export interface WorkflowHandoffProtocol {
  id: string;
  name: string;
  sourceStepId: string;
  sourceNodeId?: string;
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
  artifactContract?: WorkflowArtifactContract;
  requiredInputs?: RequiredInputField[];
  completionGates?: string[];
  executionBoundary?: Partial<ExecutionBoundary>;
}

export interface Workflow {
  id: string;
  name: string;
  capabilityId: string;
  templateId?: string;
  schemaVersion?: number;
  entryNodeId?: string;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
  steps: WorkflowStep[];
  handoffProtocols?: WorkflowHandoffProtocol[];
  publishState?: WorkflowPublishState;
  status: Status;
  workflowType?: 'SDLC' | 'Operational' | 'Governance' | 'Custom';
  scope?: 'CAPABILITY' | 'GLOBAL';
  summary?: string;
  archivedAt?: string;
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
  triggerType?:
    | 'INITIALIZATION'
    | 'REQUEST_CHANGES'
    | 'GUIDANCE'
    | 'STAGE_CONTROL'
    | 'CONFLICT_RESOLUTION'
    | 'MANUAL_REFRESH'
    | 'SKILL_CHANGE';
  relatedWorkItemId?: string;
  relatedRunId?: string;
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

export type WorkItemTaskType =
  | 'GENERAL'
  | 'STRATEGIC_INITIATIVE'
  | 'NEW_BUSINESS_CASE'
  | 'FEATURE_ENHANCEMENT'
  | 'PRODUCTION_ISSUE'
  | 'BUGFIX'
  | 'SECURITY_FINDING'
  | 'REHYDRATION';

export interface WorkItem {
  id: string;
  title: string;
  description: string;
  taskType?: WorkItemTaskType;
  phaseStakeholders?: WorkItemPhaseStakeholderAssignment[];
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

export type ContrarianReviewStatus = 'PENDING' | 'READY' | 'ERROR';

export type ContrarianReviewSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type ContrarianReviewRecommendation =
  | 'CONTINUE'
  | 'REVISE_RESOLUTION'
  | 'ESCALATE'
  | 'STOP';

export interface ContrarianConflictReview {
  status: ContrarianReviewStatus;
  reviewerAgentId: string;
  generatedAt: string;
  severity: ContrarianReviewSeverity;
  recommendation: ContrarianReviewRecommendation;
  summary: string;
  challengedAssumptions: string[];
  risks: string[];
  missingEvidence: string[];
  alternativePaths: string[];
  suggestedResolution?: string;
  sourceArtifactIds: string[];
  sourceDocumentIds: string[];
  lastError?: string;
}

export type RunWaitPayload = {
  stepName?: string;
  postStepApproval?: boolean;
  completionSummary?: string;
  generatedArtifactIds?: string[];
  codeDiffArtifactId?: string;
  codeDiffSummary?: string;
  requestedInputFields?: CompiledRequiredInputField[];
  compiledStepContext?: CompiledStepContext;
  compiledWorkItemPlan?: CompiledWorkItemPlan;
  contrarianReview?: ContrarianConflictReview;
} & Record<string, any>;

export interface WorkflowRun {
  id: string;
  capabilityId: string;
  workItemId: string;
  workflowId: string;
  status: WorkflowRunStatus;
  attemptNumber: number;
  workflowSnapshot: Workflow;
  currentNodeId?: string;
  currentStepId?: string;
  currentPhase?: WorkItemPhase;
  assignedAgentId?: string;
  branchState?: WorkflowRunBranchState;
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
  workflowNodeId: string;
  workflowStepId?: string;
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

export interface WorkflowRunBranchState {
  pendingNodeIds: string[];
  completedNodeIds: string[];
  activeNodeIds: string[];
  joinState?: Record<
    string,
    {
      waitingOnNodeIds: string[];
      completedInboundNodeIds: string[];
    }
  >;
  visitCount?: number;
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
  payload?: RunWaitPayload;
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

export type FlightRecorderVerdict =
  | 'ALLOWED'
  | 'NEEDS_APPROVAL'
  | 'DENIED'
  | 'INCOMPLETE';

export type FlightRecorderEventType =
  | 'RUN_STARTED'
  | 'RUN_COMPLETED'
  | 'RUN_FAILED'
  | 'STEP_COMPLETED'
  | 'WAIT_OPENED'
  | 'WAIT_RESOLVED'
  | 'APPROVAL_CAPTURED'
  | 'CONFLICT_RESOLVED'
  | 'CONTRARIAN_REVIEW'
  | 'POLICY_DECISION'
  | 'TOOL_COMPLETED'
  | 'TOOL_FAILED'
  | 'ARTIFACT_CREATED'
  | 'HANDOFF_CREATED'
  | 'RELEASE_VERDICT';

export interface FlightRecorderEvent {
  id: string;
  capabilityId: string;
  workItemId?: string;
  workItemTitle?: string;
  runId?: string;
  runStepId?: string;
  artifactId?: string;
  waitId?: string;
  policyDecisionId?: string;
  toolInvocationId?: string;
  traceId?: string;
  timestamp: string;
  type: FlightRecorderEventType;
  title: string;
  description: string;
  actorId?: string;
  actorName?: string;
  phase?: WorkItemPhase;
  verdict?: FlightRecorderVerdict;
  severity?: 'INFO' | 'WARN' | 'ERROR';
}

export interface FlightRecorderPolicySummary {
  id: string;
  runId?: string;
  runStepId?: string;
  toolInvocationId?: string;
  actionType: PolicyActionType;
  targetId?: string;
  decision: PolicyDecisionResult;
  reason: string;
  requestedByAgentId?: string;
  requestedByName?: string;
  createdAt: string;
}

export interface FlightRecorderHumanGateSummary {
  waitId: string;
  runId: string;
  runStepId: string;
  type: RunWaitType;
  status: RunWaitStatus;
  message: string;
  requestedBy: string;
  requestedByName?: string;
  resolvedBy?: string;
  resolvedByName?: string;
  resolution?: string;
  contrarianReview?: ContrarianConflictReview;
  createdAt: string;
  resolvedAt?: string;
}

export interface FlightRecorderArtifactSummary {
  artifactId: string;
  name: string;
  kind?: ArtifactKind;
  summary?: string;
  workItemId?: string;
  runId?: string;
  runStepId?: string;
  phase?: WorkItemPhase;
  agentId?: string;
  agentName?: string;
  createdAt: string;
}

export interface WorkItemFlightRecorderDetail {
  capabilityId: string;
  generatedAt: string;
  workItem: WorkItem;
  verdict: FlightRecorderVerdict;
  verdictReason: string;
  latestRun?: WorkflowRun;
  runHistory: WorkflowRun[];
  humanGates: FlightRecorderHumanGateSummary[];
  policyDecisions: FlightRecorderPolicySummary[];
  artifacts: FlightRecorderArtifactSummary[];
  handoffArtifacts: FlightRecorderArtifactSummary[];
  toolInvocations: ToolInvocation[];
  events: FlightRecorderEvent[];
  telemetry: {
    traceIds: string[];
    toolInvocationCount: number;
    failedToolInvocationCount: number;
    totalToolLatencyMs: number;
    totalToolCostUsd: number;
    runConsolePath: string;
  };
}

export interface CapabilityFlightRecorderSnapshot {
  capabilityId: string;
  generatedAt: string;
  verdict: FlightRecorderVerdict;
  verdictReason: string;
  summary: {
    completedWorkCount: number;
    openHumanGateCount: number;
    policyDecisionCount: number;
    evidenceArtifactCount: number;
    handoffPacketCount: number;
  };
  events: FlightRecorderEvent[];
  workItems: WorkItemFlightRecorderDetail[];
}

export type ReleaseReadinessStatus =
  | 'READY'
  | 'WAITING_APPROVAL'
  | 'BLOCKED'
  | 'INCOMPLETE';

export interface ReleaseReadinessDimension {
  id:
    | 'evidence_complete'
    | 'approvals_resolved'
    | 'no_denied_policy'
    | 'qa_complete'
    | 'handoff_complete'
    | 'deployment_authorized';
  label: string;
  weight: number;
  applicable: boolean;
  passed: boolean;
  reason: string;
}

export interface ReleaseReadiness {
  status: ReleaseReadinessStatus;
  score: number;
  dimensions: ReleaseReadinessDimension[];
  blockingReasons: string[];
}

export interface WorkItemAttemptDiff {
  hasPreviousAttempt: boolean;
  currentAttemptNumber?: number;
  previousAttemptNumber?: number;
  summary: string;
  statusDelta?: string;
  terminalOutcomeDelta?: string;
  stepProgressDelta: string[];
  waitDelta: string[];
  policyDelta: string[];
  evidenceDelta: string[];
  handoffDelta: string[];
  toolDelta: string[];
  humanDelta: string[];
}

export interface ReviewPacketArtifactSummary {
  artifactId: string;
  name: string;
  createdAt: string;
  fileName: string;
  contentText: string;
  downloadUrl: string;
}

export interface StageControlContinueResponse {
  action:
    | 'APPROVED_WAIT'
    | 'PROVIDED_INPUT'
    | 'RESOLVED_CONFLICT'
    | 'RESTARTED'
    | 'CANCELLED_AND_RESTARTED'
    | 'STARTED';
  summary: string;
  artifactId?: string;
  run: WorkflowRun;
}

export type ConnectorSyncStatus = 'READY' | 'NEEDS_CONFIGURATION' | 'ERROR';

export interface GithubConnectorRepositoryContext {
  url: string;
  owner: string;
  repo: string;
  description?: string;
  defaultBranch?: string;
  openIssueCount?: number;
  openPullRequestCount?: number;
}

export interface GithubConnectorPullRequestContext {
  number: number;
  title: string;
  state: string;
  url: string;
}

export interface GithubConnectorIssueContext {
  number: number;
  title: string;
  state: string;
  url: string;
}

export interface GithubConnectorSyncResult {
  provider: 'GITHUB';
  status: ConnectorSyncStatus;
  message: string;
  syncedAt: string;
  repositories: GithubConnectorRepositoryContext[];
  pullRequests: GithubConnectorPullRequestContext[];
  issues: GithubConnectorIssueContext[];
}

export interface JiraConnectorIssueContext {
  key: string;
  title: string;
  status: string;
  url?: string;
}

export interface JiraConnectorSyncResult {
  provider: 'JIRA';
  status: ConnectorSyncStatus;
  message: string;
  syncedAt: string;
  boardUrl?: string;
  issues: JiraConnectorIssueContext[];
}

export interface ConfluenceConnectorPageContext {
  pageId?: string;
  title?: string;
  url: string;
  spaceKey?: string;
}

export interface ConfluenceConnectorSyncResult {
  provider: 'CONFLUENCE';
  status: ConnectorSyncStatus;
  message: string;
  syncedAt: string;
  pages: ConfluenceConnectorPageContext[];
}

export interface CapabilityConnectorContext {
  capabilityId: string;
  github: GithubConnectorSyncResult;
  jira: JiraConnectorSyncResult;
  confluence: ConfluenceConnectorSyncResult;
}

export interface WorkItemExplainDetail {
  capabilityId: string;
  generatedAt: string;
  workItem: WorkItem;
  summary: {
    headline: string;
    blockingState: string;
    nextAction: string;
    latestRunStatus?: WorkflowRunStatus;
  };
  releaseReadiness: ReleaseReadiness;
  attemptDiff: WorkItemAttemptDiff;
  latestRun?: WorkflowRun;
  previousRun?: WorkflowRun;
  flightRecorder: {
    verdict: FlightRecorderVerdict;
    verdictReason: string;
  };
  evidence: {
    artifactCount: number;
    handoffCount: number;
    phaseCount: number;
    latestCompletedAt?: string;
  };
  humanGates: FlightRecorderHumanGateSummary[];
  policyDecisions: FlightRecorderPolicySummary[];
  artifacts: FlightRecorderArtifactSummary[];
  handoffArtifacts: FlightRecorderArtifactSummary[];
  telemetry: WorkItemFlightRecorderDetail['telemetry'];
  connectors: CapabilityConnectorContext;
  reviewPacket?: ReviewPacketArtifactSummary;
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
  sessionMode?: 'resume' | 'fresh';
  sessionId?: string;
  sessionScope?: AgentSessionScope;
  sessionScopeId?: string;
  isNewSession?: boolean;
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
  retryAfterMs?: number;
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
