import type { Capability, CapabilityAgent } from '../../src/contracts/capability';
import type { WorkItem } from '../../src/contracts/workflow';

export interface ContextAssemblerRequest {
  capability: Capability;
  agent: CapabilityAgent;
  message: string;
  workItem?: WorkItem;
  runId?: string;
  workflowStepId?: string;
}

export interface ContextAssemblerResponse {
  conversationHistory?: string;
  liveWorkContext?: string;
  verifiedCodeEvidence?: string;
  advisoryMemory?: string;
}

export interface ContextAssembler {
  assemble(request: ContextAssemblerRequest): Promise<ContextAssemblerResponse>;
}
