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
  linkedArtifacts?: { name: string; size: string; type: 'table' | 'scale' | 'file' }[];
  producedOutputs?: { name: string; status: 'completed' | 'pending'; downloadUrl?: string }[];
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
  history: WorkItemHistoryEntry[];
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
