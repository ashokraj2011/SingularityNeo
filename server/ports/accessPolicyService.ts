import type { ActorContext, PermissionAction } from '../../src/contracts/access';
import type { Capability } from '../../src/contracts/capability';

export interface AccessPolicyDecision {
  allowed: boolean;
  reason?: string;
}

export interface AccessPolicyService {
  can(actor: ActorContext | null | undefined, capability: Capability, action: PermissionAction): Promise<AccessPolicyDecision>;
}
