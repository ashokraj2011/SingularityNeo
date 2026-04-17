import { getExternalIdentity, listSegregationOfDutiesPolicies } from './repository';
import type { WorkspaceUser } from '../../src/types';

export const resolveSsoIdentity = async (ssoProvider: string, ssoSubjectId: string): Promise<string | null> => {
  const link = await getExternalIdentity(ssoProvider, ssoSubjectId);
  return link ? link.userId : null;
};

export const enforceSegregationOfDuties = async ({
  action,
  submitterUserId,
  actorUserId,
  capabilityId,
}: {
  action: string;
  submitterUserId?: string;
  actorUserId: string;
  capabilityId?: string;
}) => {
  // We only care if they are strictly defined
  if (!submitterUserId || !actorUserId) {
    return;
  }

  const policies = await listSegregationOfDutiesPolicies();
  
  for (const policy of policies) {
    if (policy.restrictedAction === action) {
      if (policy.preventSelfApproval && submitterUserId === actorUserId) {
        throw new Error(
          `Segregation of Duties Policy Violation: Self-approval is blocked by policy "${policy.policyName}". Maker and Checker distinct identity is required.`
        );
      }
      
      // Future: expand to check if mapping actually holds these roles 
      // i.e., "Does actorUserId have policy.checkerRole configured via directory?"
    }
  }
};
