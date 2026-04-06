import {
  claimRunnableRuns,
  getWorkflowRunDetail,
  releaseRunLease,
  renewRunLease,
  updateWorkflowRun,
} from './repository';
import { processWorkflowRun } from './service';

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

const runOnce = async () => {
  if (processing) {
    return;
  }

  processing = true;
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
          const message =
            error instanceof Error
              ? error.message
              : 'Workflow execution failed unexpectedly.';
          await updateWorkflowRun({
            ...run,
            status: 'FAILED',
            terminalOutcome: message,
            completedAt: new Date().toISOString(),
            leaseOwner: undefined,
            leaseExpiresAt: undefined,
          }).catch(() => undefined);
          await releaseRunLease({
            capabilityId: run.capabilityId,
            runId: run.id,
          }).catch(() => undefined);
          console.error(`Workflow run ${run.id} failed.`, error);
        } finally {
          clearInterval(heartbeat);
        }
      }),
    );
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
