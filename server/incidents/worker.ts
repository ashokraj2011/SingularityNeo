import { randomUUID } from 'node:crypto';
import { correlateIncident } from './correlation';
import { deliverIncidentExport, deliverMrmExport } from './exports';
import {
  claimRunnableIncidentJobs,
  completeIncidentJob,
  failIncidentJob,
  releaseIncidentJobLease,
  renewIncidentJobLease,
} from './repository';

const LEASE_MS = 30_000;
const HEARTBEAT_MS = 10_000;
const POLL_MS = 2_000;
const CLAIM_BATCH_SIZE = 4;

const workerId = `incident-worker-${randomUUID()}`;

let started = false;
let timer: NodeJS.Timeout | null = null;

const schedule = (delay = POLL_MS) => {
  if (!started) {
    return;
  }
  if (timer) {
    clearTimeout(timer);
  }
  timer = setTimeout(() => {
    void tick();
  }, delay);
};

const processJob = async (
  job: Awaited<ReturnType<typeof claimRunnableIncidentJobs>>[number],
) => {
  const heartbeat = setInterval(() => {
    void renewIncidentJobLease({
      jobId: job.id,
      workerId,
      leaseMs: LEASE_MS,
    }).catch(() => undefined);
  }, HEARTBEAT_MS);

  try {
    if (job.type === 'CORRELATE' && job.incidentId) {
      await correlateIncident({
        incidentId: job.incidentId,
        actorUserId: String(job.payload.actorUserId || '').trim() || undefined,
        actorDisplayName: String(job.payload.actorDisplayName || '').trim() || undefined,
      });
    } else if (job.type === 'EXPORT_INCIDENT' && job.incidentId) {
      await deliverIncidentExport({
        target: String(job.payload.target || '').trim() as any,
        incidentId: job.incidentId,
        deliveryId: String(job.payload.deliveryId || '').trim(),
      });
    } else if (job.type === 'EXPORT_MRM') {
      await deliverMrmExport({
        target: String(job.payload.target || '').trim() as any,
        capabilityId: String(job.payload.capabilityId || '').trim() || undefined,
        windowDays:
          job.payload.windowDays === null || job.payload.windowDays === undefined
            ? undefined
            : Number(job.payload.windowDays),
        deliveryId: String(job.payload.deliveryId || '').trim(),
      });
    }
    await completeIncidentJob(job.id);
  } catch (error) {
    await failIncidentJob({
      jobId: job.id,
      errorMessage: error instanceof Error ? error.message : 'Incident job failed.',
    });
  } finally {
    clearInterval(heartbeat);
    await releaseIncidentJobLease(job.id).catch(() => undefined);
  }
};

const tick = async () => {
  if (!started) {
    return;
  }

  try {
    const jobs = await claimRunnableIncidentJobs({
      workerId,
      limit: CLAIM_BATCH_SIZE,
      leaseMs: LEASE_MS,
    });

    if (!jobs.length) {
      schedule();
      return;
    }

    for (const job of jobs) {
      await processJob(job);
    }
    schedule(100);
  } catch {
    schedule(POLL_MS);
  }
};

export const startIncidentWorker = () => {
  if (started) {
    return;
  }
  started = true;
  schedule(0);
};

export const wakeIncidentWorker = () => {
  schedule(0);
};
