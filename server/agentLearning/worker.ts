import { randomUUID } from 'node:crypto';
import {
  claimRunnableLearningJobs,
  releaseAgentLearningJobLease,
  renewAgentLearningJobLease,
} from './repository';
import { processAgentLearningJob, recordPipelineError } from './service';

const LEASE_MS = 30_000;
const HEARTBEAT_MS = 10_000;
const POLL_MS = 1_500;
const CLAIM_BATCH_SIZE = 3;

// Slice 3 — the governance exception expiry sweep piggy-backs on this
// worker tick so we don't stand up a second runner. 15-minute cadence
// matches the plan; the sweep is cheap (one indexed UPDATE + N event
// inserts) so skipping an occasional tick doesn't introduce real lag.
const EXCEPTION_EXPIRY_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

const workerId = `agent-learning-${randomUUID()}`;

let started = false;
let pollTimer: NodeJS.Timeout | null = null;
let wakeRequested = false;
let lastExceptionExpirySweepAt = 0;

const schedulePoll = (delay = POLL_MS) => {
  if (!started) {
    return;
  }

  if (pollTimer) {
    clearTimeout(pollTimer);
  }

  pollTimer = setTimeout(() => {
    void tickWorker();
  }, delay);
};

const processJobWithHeartbeat = async (job: Awaited<ReturnType<typeof claimRunnableLearningJobs>>[number]) => {
  // Slice D — lease-renew + lease-release failures previously got silently
  // swallowed. We keep the best-effort semantics (heartbeat hiccups must
  // not crash the worker) but surface them via PIPELINE_ERROR so operators
  // spot a stalled lease before it turns into a retry storm.
  const heartbeat = setInterval(() => {
    void renewAgentLearningJobLease({
      capabilityId: job.capabilityId,
      jobId: job.id,
      workerId,
      leaseMs: LEASE_MS,
    }).catch(error =>
      recordPipelineError({
        capabilityId: job.capabilityId,
        agentId: job.agentId,
        stage: 'lease-renew',
        error,
      }),
    );
  }, HEARTBEAT_MS);

  try {
    await processAgentLearningJob(job);
  } finally {
    clearInterval(heartbeat);
    await releaseAgentLearningJobLease({
      capabilityId: job.capabilityId,
      jobId: job.id,
    }).catch(error =>
      recordPipelineError({
        capabilityId: job.capabilityId,
        agentId: job.agentId,
        stage: 'lease-release',
        error,
      }),
    );
  }
};

const runExceptionExpirySweepIfDue = async () => {
  const now = Date.now();
  if (now - lastExceptionExpirySweepAt < EXCEPTION_EXPIRY_SWEEP_INTERVAL_MS) {
    return;
  }
  lastExceptionExpirySweepAt = now;
  try {
    // Dynamic import keeps the governance module off the cold path for
    // tests / scripts that import this worker module but don't provision
    // the governance schema.
    const { expireDueExceptions } = await import('../governance/exceptions');
    const expired = await expireDueExceptions();
    if (expired > 0) {
      console.info(`[governance.exceptions] expired ${expired} exception(s) on sweep`);
    }
  } catch (error) {
    // Best-effort maintenance; a sweep failure must not crash the tick.
    console.warn(
      `[governance.exceptions] expiry sweep failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

const tickWorker = async () => {
  if (!started) {
    return;
  }

  if (wakeRequested) {
    wakeRequested = false;
  }

  // Governance exception expiry runs before job claim so a stale APPROVED
  // exception never influences policy decisions within the same tick that
  // the claim transaction would race against. Rate-limited internally.
  await runExceptionExpirySweepIfDue();

  try {
    const claimed = await claimRunnableLearningJobs({
      workerId,
      limit: CLAIM_BATCH_SIZE,
      leaseMs: LEASE_MS,
    });

    if (!claimed.length) {
      schedulePoll();
      return;
    }

    for (const job of claimed) {
      await processJobWithHeartbeat(job);
    }

    schedulePoll(100);
  } catch (error) {
    // Slice D — the outer tick failure is load-bearing (if the query itself
    // fails, logging via a metric is best effort). We log to stderr instead
    // of recordPipelineError because there's no (capability, agent) scope
    // available at this level.
    console.error(
      `[learning.worker] tick failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    schedulePoll(POLL_MS);
  }
};

export const wakeAgentLearningWorker = () => {
  wakeRequested = true;
  schedulePoll(0);
};

export const startAgentLearningWorker = () => {
  if (started) {
    return;
  }

  started = true;
  schedulePoll(0);
};
