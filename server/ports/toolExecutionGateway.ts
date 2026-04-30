import type { Capability, CapabilityAgent } from '../../src/contracts/capability';
import type { ToolAdapterId } from '../../src/contracts';

export interface ToolExecutionRequest {
  toolId: ToolAdapterId;
  capability: Capability;
  agent?: CapabilityAgent;
  args: Record<string, unknown>;
  runtimeLane: 'chat' | 'execution' | 'swarm' | 'assistant-dock';
}

export interface ToolExecutionResponse {
  ok: boolean;
  output: string;
  metadata?: Record<string, unknown>;
}

export interface ToolExecutionGateway {
  execute(request: ToolExecutionRequest): Promise<ToolExecutionResponse>;
}
