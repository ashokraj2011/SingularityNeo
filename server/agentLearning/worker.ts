import { randomUUID } from 'node:crypto';
import {
  claimRunnableLearningJobs,
  releaseAgentLearningJobLease,
  renewAgentLearningJobLease,
} from './repository';
import { processAgentLearningJob } from './service';

const LEASE_MS = 30_000;
const HEARTBEAT_MS = 10_000;
const POLL_MS = 1_500;
const CLAIM_BATCH_SIZE = 3;

const workerId = `agent-learning-${randomUUID()}`;

let started = false;
let pollTimer: NodeJS.Timeout | null = null;
let wakeRequested = false;

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
  const heartbeat = setInterval(() => {
    void renewAgentLearningJobLease({
      capabilityId: job.capabilityId,
      jobId: job.id,
      workerId,
      leaseMs: LEASE_MS,
    }).catch(() => undefined);
  }, HEARTBEAT_MS);

  try {
    await processAgentLearningJob(job);
  } finally {
    clearInterval(heartbeat);
    await releaseAgentLearningJobLease({
      capabilityId: job.capabilityId,
      jobId: job.id,
    }).catch(() => undefined);
  }
};

const tickWorker = async () => {
  if (!started) {
    return;
  }

  if (wakeRequested) {
    wakeRequested = false;
  }

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
  } catch {
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
