import { useCallback, useEffect, useState } from 'react';
import {
  claimCapabilityExecution,
  fetchRuntimeStatus,
  releaseCapabilityExecution,
  type RuntimeStatus,
} from '../../lib/api';
import { getRuntimeStatusIssueMessage } from '../../lib/runtimeStatusMessages';

type UseOrchestratorRuntimeArgs = {
  activeCapabilityId: string;
  activeCapabilityName: string;
  canClaimExecution: boolean;
  refreshCapabilityBundle: (capabilityId: string) => Promise<unknown>;
  showError: (title: string, description?: string) => void;
  success: (title: string, description?: string) => void;
};

export const useOrchestratorRuntime = ({
  activeCapabilityId,
  activeCapabilityName,
  canClaimExecution,
  refreshCapabilityBundle,
  showError,
  success,
}: UseOrchestratorRuntimeArgs) => {
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [runtimeError, setRuntimeError] = useState('');
  const [executionClaimBusy, setExecutionClaimBusy] = useState(false);

  const loadRuntime = useCallback(async () => {
    try {
      const status = await fetchRuntimeStatus();
      setRuntimeStatus(status);
      setRuntimeError(getRuntimeStatusIssueMessage(status) || '');
      return status;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to load runtime configuration.';
      setRuntimeError(message);
      throw error;
    }
  }, []);

  useEffect(() => {
    void loadRuntime().catch(() => undefined);
  }, [activeCapabilityId, loadRuntime]);

  const handleClaimDesktopExecution = useCallback(
    async (forceTakeover = false) => {
      if (!canClaimExecution) {
        showError(
          'Access restricted',
          'This operator cannot claim desktop execution for the selected capability.',
        );
        return false;
      }

      setExecutionClaimBusy(true);
      try {
        const result = await claimCapabilityExecution({
          capabilityId: activeCapabilityId,
          forceTakeover,
        });
        await Promise.all([
          refreshCapabilityBundle(activeCapabilityId),
          loadRuntime().catch(() => undefined),
        ]);
        success(
          forceTakeover ? 'Desktop execution taken over' : 'Desktop execution claimed',
          `${result.ownership.actorDisplayName} now owns automated execution for ${activeCapabilityName}.`,
        );
        return true;
      } catch (error) {
        showError(
          'Claim failed',
          error instanceof Error ? error.message : 'Failed to claim desktop execution.',
        );
        return false;
      } finally {
        setExecutionClaimBusy(false);
      }
    },
    [
      activeCapabilityId,
      activeCapabilityName,
      canClaimExecution,
      loadRuntime,
      refreshCapabilityBundle,
      showError,
      success,
    ],
  );

  const handleReleaseDesktopExecution = useCallback(async () => {
    if (!canClaimExecution) {
      showError(
        'Access restricted',
        'This operator cannot release desktop execution for the selected capability.',
      );
      return false;
    }

    setExecutionClaimBusy(true);
    try {
      await releaseCapabilityExecution({
        capabilityId: activeCapabilityId,
      });
      await Promise.all([
        refreshCapabilityBundle(activeCapabilityId),
        loadRuntime().catch(() => undefined),
      ]);
      success(
        'Desktop execution released',
        `${activeCapabilityName} is now waiting for a desktop executor to claim it.`,
      );
      return true;
    } catch (error) {
      showError(
        'Release failed',
        error instanceof Error ? error.message : 'Failed to release desktop execution.',
      );
      return false;
    } finally {
      setExecutionClaimBusy(false);
    }
  }, [
    activeCapabilityId,
    activeCapabilityName,
    canClaimExecution,
    loadRuntime,
    refreshCapabilityBundle,
    showError,
    success,
  ]);

  return {
    runtimeStatus,
    runtimeError,
    executionClaimBusy,
    loadRuntime,
    handleClaimDesktopExecution,
    handleReleaseDesktopExecution,
  };
};
