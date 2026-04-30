import type {
  ModelRoutingRecommendation,
  ProviderKey,
  TokenManagementCapabilitySnapshot,
  TokenManagementPolicy,
  TokenManagementRecommendation,
  TokenManagementSummary,
  TokenOptimizationReceipt,
  TokenPromptEstimateResponse,
} from '../../types';
import { jsonHeaders, requestJson } from './shared';

export const fetchTokenManagementSummary = async (): Promise<TokenManagementSummary> =>
  requestJson<TokenManagementSummary>('/api/token-management/summary');

export const fetchTokenManagementCapability = async (
  capabilityId: string,
): Promise<TokenManagementCapabilitySnapshot> =>
  requestJson<TokenManagementCapabilitySnapshot>(
    `/api/token-management/capabilities/${encodeURIComponent(capabilityId)}`,
  );

export const updateTokenManagementPolicy = async (
  capabilityId: string,
  policy: TokenManagementPolicy,
): Promise<TokenManagementCapabilitySnapshot> =>
  requestJson<TokenManagementCapabilitySnapshot>(
    `/api/token-management/capabilities/${encodeURIComponent(capabilityId)}/policy`,
    {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ policy }),
    },
  );

export const recommendTokenManagementModel = async (payload: {
  capabilityId: string;
  selectedProviderKey?: ProviderKey | null;
  selectedModel?: string | null;
  phase?: string | null;
  toolId?: string | null;
  intent?: string | null;
  writeMode?: boolean;
  requiresApproval?: boolean;
  governanceState?: string | null;
  complexityTier?: ModelRoutingRecommendation['complexityTier'];
}): Promise<ModelRoutingRecommendation> =>
  requestJson<ModelRoutingRecommendation>('/api/token-management/recommend-model', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });

export const estimateTokenPrompt = async (payload: {
  capabilityId?: string;
  prompt: string;
  providerKey?: ProviderKey | null;
  model?: string | null;
  kind?: 'prose' | 'code' | 'json';
}): Promise<TokenPromptEstimateResponse> =>
  requestJson<TokenPromptEstimateResponse>('/api/token-management/estimate-prompt', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });

export const fetchTokenOptimizationReceipts = async (
  params: { capabilityId?: string; limit?: number } = {},
): Promise<TokenOptimizationReceipt[]> => {
  const query = new URLSearchParams();
  if (params.capabilityId) query.set('capabilityId', params.capabilityId);
  if (params.limit) query.set('limit', String(params.limit));
  const suffix = query.toString();
  return requestJson<TokenOptimizationReceipt[]>(
    `/api/token-management/receipts${suffix ? `?${suffix}` : ''}`,
  );
};

export const fetchTokenManagementRecommendations = async (
  params: { capabilityId?: string } = {},
): Promise<TokenManagementRecommendation[]> => {
  const query = new URLSearchParams();
  if (params.capabilityId) query.set('capabilityId', params.capabilityId);
  const suffix = query.toString();
  return requestJson<TokenManagementRecommendation[]>(
    `/api/token-management/recommendations${suffix ? `?${suffix}` : ''}`,
  );
};
