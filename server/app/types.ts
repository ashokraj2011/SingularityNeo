import type {
  Capability,
  CapabilityAgent,
  CapabilityContractDraft,
  CapabilityDependency,
  CapabilityRepository,
  CapabilityWorkspace,
  WorkItem,
} from '../../src/contracts';
import type { ChatHistoryMessage } from '../githubModels';

export type AppCapabilityBundle = {
  capability: Capability;
  workspace: CapabilityWorkspace;
};

export type ChatRequestBody = {
  capability?: Capability;
  agent?: CapabilityAgent;
  history?: ChatHistoryMessage[];
  message?: string;
  sessionMode?: 'resume' | 'fresh';
  sessionScope?: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  sessionScopeId?: string;
  contextMode?: 'GENERAL' | 'WORK_ITEM_STAGE';
  workItemId?: string;
  runId?: string;
  workflowStepId?: string;
};

export type CodeWorkspaceStatus = {
  path: string;
  exists: boolean;
  isGitRepository: boolean;
  currentBranch: string | null;
  pendingChanges: number;
  lastCommit: string | null;
  error?: string;
};

export type CapabilityCreateDependencies =
  CapabilityDependency[] | undefined;

export type CapabilityCreateContractDraft =
  Partial<CapabilityContractDraft> | undefined;

export type AppWorkItemContext = WorkItem | undefined;
export type AppCapabilityRepository = CapabilityRepository;
