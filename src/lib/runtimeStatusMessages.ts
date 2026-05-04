import type { RuntimeStatus } from './api/runtime';
import { getRuntimeStatusProviderIssue } from '../contracts/runtimeProviderDiagnostics';

export const getRuntimeStatusIssueMessage = (
  runtimeStatus?: RuntimeStatus | null,
) => {
  if (!runtimeStatus) {
    return null;
  }

  return getRuntimeStatusProviderIssue({
    configured: runtimeStatus.configured,
    providerKey: runtimeStatus.providerKey || null,
    availableProviders: runtimeStatus.availableProviders || [],
  });
};
