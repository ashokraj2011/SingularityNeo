import type { ProviderKey, RuntimeTransportMode } from '../../src/contracts/runtime';

export interface LlmGatewayMessage {
  role: 'developer' | 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmGatewayRequest {
  providerKey?: ProviderKey;
  model?: string;
  messages: LlmGatewayMessage[];
  capabilityId?: string;
  agentId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface LlmGatewayUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
}

export interface LlmGatewayResponse {
  content: string;
  model: string;
  providerKey?: ProviderKey;
  transportMode?: RuntimeTransportMode;
  responseId?: string | null;
  createdAt?: string;
  usage?: LlmGatewayUsage;
}

export interface LlmGateway {
  invoke(request: LlmGatewayRequest): Promise<LlmGatewayResponse>;
}
