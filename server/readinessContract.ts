import { buildReadinessContractFromSignals } from '../src/lib/readinessContract';
import type { Capability, CapabilityWorkspace, ReadinessContract } from '../src/types';
import {
  isDesktopExecutionRuntime,
  getCapabilityExecutionOwnership,
  listDesktopExecutorRegistrations,
} from './executionOwnership';

type ExecutionOwnership = Awaited<ReturnType<typeof getCapabilityExecutionOwnership>>;
type DesktopExecutors = Awaited<ReturnType<typeof listDesktopExecutorRegistrations>>;

const hasEligibleDesktopExecutor = (
  capabilityId: string,
  registrations: DesktopExecutors,
) =>
  registrations.some(
    registration =>
      registration.heartbeatStatus === 'FRESH' &&
      (registration.approvedWorkspaceRoots?.[capabilityId] || []).length > 0,
  );

export const buildCapabilityReadinessContract = ({
  capability,
  workspace,
  executionOwnership,
  desktopExecutors,
  generatedAt = new Date().toISOString(),
}: {
  capability: Capability;
  workspace: CapabilityWorkspace;
  executionOwnership: ExecutionOwnership;
  desktopExecutors: DesktopExecutors;
  generatedAt?: string;
}): ReadinessContract => {
  const hasFreshOwner = executionOwnership?.heartbeatStatus === 'FRESH';
  const hasEligibleExecutor = hasEligibleDesktopExecutor(capability.id, desktopExecutors);

  return buildReadinessContractFromSignals({
    capability,
    workspace,
    generatedAt,
    executionRuntimeReady: isDesktopExecutionRuntime() && (hasFreshOwner || hasEligibleExecutor),
    executionRuntimeSummary: hasFreshOwner
      ? `${executionOwnership?.actorDisplayName || 'A desktop executor'} currently owns execution for this capability.`
      : hasEligibleExecutor
      ? 'A desktop executor with an approved local workspace root is online and can claim this capability.'
      : isDesktopExecutionRuntime()
      ? 'No eligible desktop executor is currently online for this capability.'
      : 'Desktop-owned execution mode is not active on the control plane.',
  });
};
