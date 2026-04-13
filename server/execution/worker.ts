import {
  claimRunnableRuns,
  getWorkflowRunDetail,
  releaseRunLease,
  renewRunLease,
  updateWorkflowRun,
} from './repository';
import { processWorkflowRun, reconcileWorkflowRunFailure } from './service';
import {
  GitHubProviderRateLimitError,
  isGitHubProviderRateLimitError,
} from '../githubModels';

const LEASE_MS = 30000;
const HEARTBEAT_MS = 10000;
const POLL_MS = 1500;
const CLAIM_BATCH_SIZE = 2;

const workerId = `exec-worker-${process.pid}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

let pollTimer: NodeJS.Timeout | null = null;
let wakeTimer: NodeJS.Timeout | null = null;
let processing = false;

const clampRetryDelayMs = (value?: number) => Math.min(Math.max(value || 30_000, 5_000), 120_000);

const isBootstrapSchemaGapError = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = 'code' in error ? String((error as { code?: unknown }).code || '') : '';
  const message =
    'message' in error ? String((error as { message?: unknown }).message || '') : '';

  return (
    code === '42P01' ||
    message.includes('relation "capability_workflow_runs" does not exist')
  );
};

const runOnce = async () => {
  if (processing) {
    return;
  }

  processing = true;
  try {
    try {
      const claimedRuns = await claimRunnableRuns({
        workerId,
        limit: CLAIM_BATCH_SIZE,
        leaseMs: LEASE_MS,
      });

      await Promise.all(
        claimedRuns.map(async run => {
          const heartbeat = setInterval(() => {
            void renewRunLease({
              capabilityId: run.capabilityId,
              runId: run.id,
              workerId,
              leaseMs: LEASE_MS,
            }).catch(() => undefined);
          }, HEARTBEAT_MS);

          try {
            const detail = await getWorkflowRunDetail(run.capabilityId, run.id);
            await processWorkflowRun(detail);
          } catch (error) {
            if (isGitHubProviderRateLimitError(error)) {
              const retryAfterMs = clampRetryDelayMs(
                error instanceof GitHubProviderRateLimitError ? error.retryAfterMs : undefined,
              );
              const retryAt = new Date(Date.now() + retryAfterMs).toISOString();

              await updateWorkflowRun({
                ...run,
                status: 'RUNNING',
                terminalOutcome: undefined,
                completedAt: undefined,
                leaseOwner: undefined,
                leaseExpiresAt: retryAt,
              }).catch(() => undefined);

              console.warn(
                `Workflow run ${run.id} hit a provider rate limit. Retrying after ${retryAt}.`,
                error,
              );
              return;
            }

            const message =
              error instanceof Error
                ? error.message
                : 'Workflow execution failed unexpectedly.';
            await reconcileWorkflowRunFailure({
              capabilityId: run.capabilityId,
              runId: run.id,
              message,
            }).catch(() => undefined);
            console.error(`Workflow run ${run.id} failed.`, error);
          } finally {
            clearInterval(heartbeat);
          }
        }),
      );
    } catch (error) {
      if (isBootstrapSchemaGapError(error)) {
        console.warn(
          'Execution worker is waiting for workflow tables to exist before polling runs.',
        );
        return;
      }

      throw error;
    }
  } finally {
    processing = false;
  }
};

export const wakeExecutionWorker = () => {
  if (wakeTimer) {
    clearTimeout(wakeTimer);
  }

  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    void runOnce();
  }, 10);
};

export const startExecutionWorker = () => {
  if (!pollTimer) {
    pollTimer = setInterval(() => {
      void runOnce();
    }, POLL_MS);
  }

  wakeExecutionWorker();
};
