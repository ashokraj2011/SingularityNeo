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

export interface WorkflowStep {
  id: string;
  agentId: string;
  action: string;
  inputArtifactId?: string;
  outputArtifactId?: string;
}

export interface Workflow {
  id: string;
  name: string;
  capabilityId: string;
  steps: WorkflowStep[];
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

export type WorkItemPhase = 'BACKLOG' | 'ANALYSIS' | 'EXECUTION' | 'REVIEW' | 'DONE';

export interface WorkItem {
  id: string;
  title: string;
  description: string;
  phase: WorkItemPhase;
  capabilityId: string;
  workflowId: string;
  currentStepId?: string;
  assignedAgentId?: string;
  status: 'ACTIVE' | 'BLOCKED' | 'PENDING_APPROVAL' | 'COMPLETED';
  priority: 'High' | 'Med' | 'Low';
  tags: string[];
  pendingRequest?: {
    type: 'APPROVAL' | 'INPUT';
    message: string;
    requestedBy: string;
    timestamp: string;
  };
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
