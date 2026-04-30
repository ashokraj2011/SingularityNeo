import type { CapabilityAgent } from '../../src/contracts/capability';
import type { AgentLearningProfileDetail } from '../../src/contracts/learning';

export interface LearningRefreshRequest {
  capabilityId: string;
  agentId?: string;
  reason: string;
}

export interface LearningRefreshResult {
  queued: boolean;
  profile?: AgentLearningProfileDetail | null;
}

export interface LearningService {
  queueRefresh(request: LearningRefreshRequest): Promise<LearningRefreshResult>;
  getProfile(capabilityId: string, agent: CapabilityAgent): Promise<AgentLearningProfileDetail | null>;
}
