import type {
  TelemetryMetricSample,
  TelemetrySpan,
  TelemetrySummary,
  WorkflowRun,
} from '../src/types';
import { query } from './db';
import {
  executionRuntimeRpc,
  isRemoteExecutionClient,
} from './execution/runtimeClient';

const createId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

export const createTraceId = () =>
  Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join('');

export const createSpanId = () =>
  Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join('');

const asIso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : String(value || '');

const spanFromRow = (row: Record<string, any>): TelemetrySpan => ({
  id: row.id,
  capabilityId: row.capability_id,
  traceId: row.trace_id,
  parentSpanId: row.parent_span_id || undefined,
  entityType: row.entity_type,
  entityId: row.entity_id || undefined,
  name: row.name,
  status: row.status,
  model: row.model || undefined,
  costUsd:
    typeof row.cost_usd === 'number'
      ? row.cost_usd
      : row.cost_usd
      ? Number(row.cost_usd)
      : undefined,
  tokenUsage: row.token_usage || undefined,
  attributes: row.attributes || undefined,
  startedAt: asIso(row.started_at),
  endedAt: row.ended_at ? asIso(row.ended_at) : undefined,
  durationMs: typeof row.duration_ms === 'number' ? row.duration_ms : undefined,
});

const metricFromRow = (row: Record<string, any>): TelemetryMetricSample => ({
  id: row.id,
  capabilityId: row.capability_id,
  traceId: row.trace_id || undefined,
  scopeType: row.scope_type,
  scopeId: row.scope_id,
  metricName: row.metric_name,
  metricValue: Number(row.metric_value || 0),
  unit: row.unit,
  tags: row.tags || undefined,
  recordedAt: asIso(row.recorded_at),
});

export const startTelemetrySpan = async ({
  capabilityId,
  traceId,
  parentSpanId,
  entityType,
  entityId,
  name,
  status = 'RUNNING',
  model,
  attributes,
  startedAt,
}: Omit<
  TelemetrySpan,
  'id' | 'endedAt' | 'durationMs' | 'costUsd' | 'tokenUsage' | 'startedAt'
> & {
  startedAt?: string;
}) => {
  if (isRemoteExecutionClient()) {
    return executionRuntimeRpc<TelemetrySpan>('startTelemetrySpan', {
      capabilityId,
      traceId,
      parentSpanId,
      entityType,
      entityId,
      name,
      status,
      model,
      attributes,
      startedAt,
    });
  }

  const result = await query(
    `
      INSERT INTO capability_trace_spans (
        capability_id,
        id,
        trace_id,
        parent_span_id,
        entity_type,
        entity_id,
        name,
        status,
        model,
        attributes,
        started_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `,
    [
      capabilityId,
      createSpanId(),
      traceId,
      parentSpanId || null,
      entityType,
      entityId || null,
      name,
      status,
      model || null,
      attributes || {},
      startedAt || new Date().toISOString(),
    ],
  );

  return spanFromRow(result.rows[0]);
};

export const finishTelemetrySpan = async ({
  capabilityId,
  spanId,
  status,
  costUsd,
  tokenUsage,
  attributes,
  endedAt,
}: {
  capabilityId: string;
  spanId: string;
  status: TelemetrySpan['status'];
  costUsd?: number;
  tokenUsage?: TelemetrySpan['tokenUsage'];
  attributes?: Record<string, any>;
  endedAt?: string;
}) => {
  if (isRemoteExecutionClient()) {
    return executionRuntimeRpc<TelemetrySpan>('finishTelemetrySpan', {
      capabilityId,
      spanId,
      status,
      costUsd,
      tokenUsage,
      attributes,
      endedAt,
    });
  }

  const result = await query(
    `
      UPDATE capability_trace_spans
      SET
        status = $3,
        cost_usd = COALESCE($4, cost_usd),
        token_usage = COALESCE($5, token_usage),
        attributes = CASE
          WHEN $6::jsonb IS NULL THEN attributes
          ELSE COALESCE(attributes, '{}'::jsonb) || $6::jsonb
        END,
        ended_at = $7,
        duration_ms = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ($7::timestamptz - started_at)) * 1000))::integer
      WHERE capability_id = $1 AND id = $2
      RETURNING *
    `,
    [
      capabilityId,
      spanId,
      status,
      costUsd ?? null,
      tokenUsage || null,
      attributes || null,
      endedAt || new Date().toISOString(),
    ],
  );

  if (!result.rowCount) {
    throw new Error(`Telemetry span ${spanId} was not found.`);
  }

  return spanFromRow(result.rows[0]);
};

export const recordMetricSample = async (
  sample: Omit<TelemetryMetricSample, 'id' | 'recordedAt'> & {
    id?: string;
    recordedAt?: string;
  },
) => {
  if (isRemoteExecutionClient()) {
    return executionRuntimeRpc<TelemetryMetricSample>('recordMetricSample', {
      sample,
    });
  }

  const result = await query(
    `
      INSERT INTO capability_metric_samples (
        capability_id,
        id,
        trace_id,
        scope_type,
        scope_id,
        metric_name,
        metric_value,
        unit,
        tags,
        recorded_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `,
    [
      sample.capabilityId,
      sample.id || createId('METRIC'),
      sample.traceId || null,
      sample.scopeType,
      sample.scopeId,
      sample.metricName,
      sample.metricValue,
      sample.unit,
      sample.tags || {},
      sample.recordedAt || new Date().toISOString(),
    ],
  );

  return metricFromRow(result.rows[0]);
};

export const recordUsageMetrics = async ({
  capabilityId,
  traceId,
  scopeType,
  scopeId,
  latencyMs,
  totalTokens,
  costUsd,
  tags,
}: {
  capabilityId: string;
  traceId?: string;
  scopeType: TelemetryMetricSample['scopeType'];
  scopeId: string;
  latencyMs?: number;
  totalTokens?: number;
  costUsd?: number;
  tags?: Record<string, string>;
}) => {
  if (isRemoteExecutionClient()) {
    await executionRuntimeRpc<void>('recordUsageMetrics', {
      capabilityId,
      traceId,
      scopeType,
      scopeId,
      latencyMs,
      totalTokens,
      costUsd,
      tags,
    });
    return;
  }

  const metrics: Promise<unknown>[] = [];
  if (typeof latencyMs === 'number') {
    metrics.push(
      recordMetricSample({
        capabilityId,
        traceId,
        scopeType,
        scopeId,
        metricName: 'latency',
        metricValue: latencyMs,
        unit: 'ms',
        tags,
      }),
    );
  }
  if (typeof totalTokens === 'number') {
    metrics.push(
      recordMetricSample({
        capabilityId,
        traceId,
        scopeType,
        scopeId,
        metricName: 'tokens',
        metricValue: totalTokens,
        unit: 'tokens',
        tags,
      }),
    );
  }
  if (typeof costUsd === 'number') {
    metrics.push(
      recordMetricSample({
        capabilityId,
        traceId,
        scopeType,
        scopeId,
        metricName: 'cost',
        metricValue: costUsd,
        unit: 'usd',
        tags,
      }),
    );
  }

  await Promise.all(metrics);
};

export const listTelemetrySpans = async (
  capabilityId: string,
  limit = 80,
) => {
  const result = await query(
    `
      SELECT *
      FROM capability_trace_spans
      WHERE capability_id = $1
      ORDER BY started_at DESC, id DESC
      LIMIT $2
    `,
    [capabilityId, limit],
  );

  return result.rows.map(spanFromRow);
};

export const listTelemetryMetrics = async (
  capabilityId: string,
  limit = 120,
) => {
  const result = await query(
    `
      SELECT *
      FROM capability_metric_samples
      WHERE capability_id = $1
      ORDER BY recorded_at DESC, id DESC
      LIMIT $2
    `,
    [capabilityId, limit],
  );

  return result.rows.map(metricFromRow);
};

export const getTelemetrySummary = async (
  capabilityId: string,
): Promise<TelemetrySummary> => {
  const [runStats, metricStats, spanRows, metricRows, policyStats, memoryStats] =
    await Promise.all([
      query<{
        total_runs: string;
        active_runs: string;
        waiting_runs: string;
        failed_runs: string;
      }>(
        `
          SELECT
            COUNT(*)::text AS total_runs,
            COUNT(*) FILTER (WHERE status IN ('QUEUED', 'RUNNING'))::text AS active_runs,
            COUNT(*) FILTER (WHERE status IN ('WAITING_APPROVAL', 'WAITING_INPUT', 'WAITING_CONFLICT'))::text AS waiting_runs,
            COUNT(*) FILTER (WHERE status = 'FAILED')::text AS failed_runs
          FROM capability_workflow_runs
          WHERE capability_id = $1
        `,
        [capabilityId],
      ),
      query<{ total_cost: string | null; total_tokens: string | null; avg_latency: string | null }>(
        `
          SELECT
            SUM(metric_value) FILTER (WHERE metric_name = 'cost')::text AS total_cost,
            SUM(metric_value) FILTER (WHERE metric_name = 'tokens')::text AS total_tokens,
            AVG(metric_value) FILTER (WHERE metric_name = 'latency')::text AS avg_latency
          FROM capability_metric_samples
          WHERE capability_id = $1
        `,
        [capabilityId],
      ),
      listTelemetrySpans(capabilityId, 24),
      listTelemetryMetrics(capabilityId, 24),
      query<{ count: string }>(
        `
          SELECT COUNT(*)::text AS count
          FROM capability_policy_decisions
          WHERE capability_id = $1
        `,
        [capabilityId],
      ),
      query<{ count: string }>(
        `
          SELECT COUNT(*)::text AS count
          FROM capability_memory_documents
          WHERE capability_id = $1
        `,
        [capabilityId],
      ),
    ]);

  const runRow = runStats.rows[0] || {
    total_runs: '0',
    active_runs: '0',
    waiting_runs: '0',
    failed_runs: '0',
  };
  const metricRow = metricStats.rows[0] || {
    total_cost: '0',
    total_tokens: '0',
    avg_latency: '0',
  };

  return {
    capabilityId,
    totalRuns: Number(runRow.total_runs || 0),
    activeRuns: Number(runRow.active_runs || 0),
    waitingRuns: Number(runRow.waiting_runs || 0),
    failedRuns: Number(runRow.failed_runs || 0),
    totalCostUsd: Number(metricRow.total_cost || 0),
    totalTokens: Number(metricRow.total_tokens || 0),
    averageLatencyMs: Number(metricRow.avg_latency || 0),
    policyDecisionCount: Number(policyStats.rows[0]?.count || 0),
    memoryDocumentCount: Number(memoryStats.rows[0]?.count || 0),
    recentSpans: spanRows,
    recentMetrics: metricRows,
  };
};

export const buildRunConsoleSnapshot = async (
  capabilityId: string,
  recentRuns: WorkflowRun[],
  recentEvents: any[],
  recentPolicyDecisions: any[],
) => ({
  capabilityId,
  telemetry: await getTelemetrySummary(capabilityId),
  activeRuns: recentRuns.filter(run =>
    ['QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_INPUT', 'WAITING_CONFLICT'].includes(
      run.status,
    ),
  ),
  recentRuns: recentRuns.slice(0, 12),
  recentEvents,
  recentPolicyDecisions,
});
