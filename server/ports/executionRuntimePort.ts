import type { ActorContext } from '../../src/contracts/access';
import type { Capability, CapabilityAgent } from '../../src/contracts/capability';
import type { WorkflowStep, WorkItem } from '../../src/contracts/workflow';

export interface ExecutionRuntimeDispatchRequest {
  capability: Capability;
  workItem: WorkItem;
  step?: WorkflowStep;
  agent?: CapabilityAgent;
  actor?: ActorContext | null;
}

export interface ExecutionRuntimeDispatchResult {
  accepted: boolean;
  executorId?: string;
  transport?: 'desktop' | 'server';
  message?: string;
}

export interface ExecutionRuntimePort {
  dispatch(request: ExecutionRuntimeDispatchRequest): Promise<ExecutionRuntimeDispatchResult>;
}
