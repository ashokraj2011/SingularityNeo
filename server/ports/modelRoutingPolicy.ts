import type { ModelRoutingRecommendation } from '../../src/contracts/policy';
import type { ProviderKey } from '../../src/contracts/runtime';

export interface ModelRoutingRequest {
  capabilityId?: string;
  selectedProviderKey?: ProviderKey | null;
  selectedModel?: string | null;
  phase?: string | null;
  toolId?: string | null;
  intent?: string | null;
  writeMode?: boolean;
  requiresApproval?: boolean;
  governanceState?: string | null;
}

export interface ModelRoutingPolicy {
  recommend(request: ModelRoutingRequest): Promise<ModelRoutingRecommendation>;
}
