import { query } from './db';
import { getAuthorizedAppState } from './access';
import { getTelemetrySummary } from './telemetry';
import type {
  AccessAuditEvent,
  ActorContext,
  ApprovalDecision,
  ApprovalInboxEntry,
  AuditReportSnapshot,
  Capability,
  CapabilityHealthSnapshot,
  CollectionRollupSnapshot,
  ExecutiveSummarySnapshot,
  OperationsDashboardSnapshot,
  ReportExportPayload,
  ReportFilter,
  ReportWorkItemSummary,
  TeamQueueSnapshot,
  WorkItem,
} from '../src/types';
import { canReadCapabilityLiveDetail } from '../src/lib/accessControl';

const hoursSince = (value?: string) => {
  if (!value) {
    return 0;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }
  return Math.max(0, (Date.now() - parsed.getTime()) / 36e5);
};

const workItemLastUpdatedAt = (workItem: WorkItem) =>
  workItem.history[workItem.history.length - 1]?.timestamp;

const toWorkItemSummary = (
  capability: Capability,
  workItem: WorkItem,
): ReportWorkItemSummary => ({
  capabilityId: capability.id,
  capabilityName: capability.name,
  workItemId: workItem.id,
  title: workItem.title,
  phase: workItem.phase,
  status: workItem.status,
  priority: workItem.priority,
  phaseOwnerTeamId: workItem.phaseOwnerTeamId,
  claimOwnerUserId: workItem.claimOwnerUserId,
  activeWriterUserId: workItem.executionContext?.activeWriterUserId,
  blockedAgeHours:
    workItem.status === 'BLOCKED' ? hoursSince(workItemLastUpdatedAt(workItem)) : undefined,
  lastUpdatedAt: workItemLastUpdatedAt(workItem),
});

const mapApprovalDecision = (row: Record<string, any>): ApprovalDecision => ({
  id: row.id,
  capabilityId: row.capability_id,
  runId: row.run_id,
  waitId: row.wait_id,
  assignmentId: row.assignment_id || undefined,
  disposition: row.disposition,
  actorUserId: row.actor_user_id || undefined,
  actorDisplayName: row.actor_display_name,
  actorTeamIds: Array.isArray(row.actor_team_ids) ? row.actor_team_ids : [],
  comment: row.comment || undefined,
  createdAt: row.created_at?.toISOString?.() || row.created_at,
});

const fetchApprovalInboxEntries = async ({
  capabilityIds,
  assignedUserId,
  assignedTeamIds,
}: {
  capabilityIds: string[];
  assignedUserId?: string;
  assignedTeamIds?: string[];
}): Promise<ApprovalInboxEntry[]> => {
  if (capabilityIds.length === 0) {
    return [];
  }
  const result = await query<Record<string, any>>(
    `
      SELECT
        assignments.*,
        runs.work_item_id,
        work_items.title AS work_item_title,
        capabilities.name AS capability_name
      FROM capability_approval_assignments AS assignments
      JOIN capability_workflow_runs AS runs
        ON runs.capability_id = assignments.capability_id
       AND runs.id = assignments.run_id
      LEFT JOIN capability_work_items AS work_items
        ON work_items.capability_id = runs.capability_id
       AND work_items.id = runs.work_item_id
      JOIN capabilities
        ON capabilities.id = assignments.capability_id
      WHERE assignments.capability_id = ANY($1::text[])
        AND assignments.status = 'PENDING'
    `,
    [capabilityIds],
  );

  return result.rows
    .filter(row => {
      if (assignedUserId && row.assigned_user_id === assignedUserId) {
        return true;
      }
      if (
        assignedTeamIds?.length &&
        row.assigned_team_id &&
        assignedTeamIds.includes(row.assigned_team_id)
      ) {
        return true;
      }
      return !assignedUserId && !assignedTeamIds?.length;
    })
    .map(row => ({
      capabilityId: row.capability_id,
      capabilityName: row.capability_name,
      workItemId: row.work_item_id || undefined,
      workItemTitle: row.work_item_title || undefined,
      runId: row.run_id,
      waitId: row.wait_id,
      assignmentId: row.id,
      phase: row.phase || undefined,
      stepName: row.step_name || undefined,
      targetType: row.target_type,
      assignedUserId: row.assigned_user_id || undefined,
      assignedTeamId: row.assigned_team_id || undefined,
      dueAt: row.due_at?.toISOString?.() || row.due_at || undefined,
      status: row.status,
      ageHours: hoursSince(row.created_at?.toISOString?.() || row.created_at),
    }));
};

const fetchLatestFailedRuns = async (capabilityIds: string[]) => {
  if (capabilityIds.length === 0) {
    return new Map<string, string>();
  }
  const result = await query<Record<string, any>>(
    `
      SELECT DISTINCT ON (capability_id, work_item_id)
        capability_id,
        work_item_id,
        status
      FROM capability_workflow_runs
      WHERE capability_id = ANY($1::text[])
      ORDER BY capability_id, work_item_id, attempt_number DESC, created_at DESC
    `,
    [capabilityIds],
  );

  return new Map(
    result.rows.map(row => [
      `${row.capability_id}:${row.work_item_id}`,
      String(row.status || ''),
    ]),
  );
};

export const buildOperationsDashboardSnapshot = async (
  actor?: ActorContext | null,
): Promise<OperationsDashboardSnapshot> => {
  const state = await getAuthorizedAppState(actor);
  const actorUserId = actor?.userId || state.workspaceOrganization.currentUserId;
  const actorTeamIds = actor?.teamIds || [];
  const visibleWorkspaces = state.capabilityWorkspaces.filter(workspace => {
    const capability = state.capabilities.find(item => item.id === workspace.capabilityId);
    return canReadCapabilityLiveDetail(capability?.effectivePermissions);
  });
  const capabilityById = new Map(state.capabilities.map(capability => [capability.id, capability]));
  const capabilityIds = visibleWorkspaces.map(workspace => workspace.capabilityId);
  const [approvalInbox, latestRunStatuses] = await Promise.all([
    fetchApprovalInboxEntries({
      capabilityIds,
      assignedUserId: actorUserId,
      assignedTeamIds: actorTeamIds,
    }),
    fetchLatestFailedRuns(capabilityIds),
  ]);

  const allWork = visibleWorkspaces.flatMap(workspace => {
    const capability = capabilityById.get(workspace.capabilityId);
    if (!capability) {
      return [];
    }
    return workspace.workItems.map(workItem => ({ capability, workItem }));
  });

  const myWork = allWork
    .filter(
      ({ workItem }) =>
        (actorUserId && workItem.claimOwnerUserId === actorUserId) ||
        (workItem.phaseOwnerTeamId && actorTeamIds.includes(workItem.phaseOwnerTeamId)),
    )
    .map(({ capability, workItem }) => toWorkItemSummary(capability, workItem));
  const teamWork = allWork
    .filter(
      ({ workItem }) =>
        workItem.phaseOwnerTeamId && actorTeamIds.includes(workItem.phaseOwnerTeamId),
    )
    .map(({ capability, workItem }) => toWorkItemSummary(capability, workItem));
  const watching = allWork
    .filter(
      ({ workItem }) =>
        actorUserId && workItem.watchedByUserIds?.includes(actorUserId),
    )
    .map(({ capability, workItem }) => toWorkItemSummary(capability, workItem));
  const restartNeeded = allWork
    .filter(
      ({ capability, workItem }) =>
        latestRunStatuses.get(`${capability.id}:${workItem.id}`) === 'FAILED',
    )
    .map(({ capability, workItem }) => toWorkItemSummary(capability, workItem));
  const activeWriterConflicts = allWork.filter(
    ({ workItem }) =>
      Boolean(
        workItem.claimOwnerUserId &&
          workItem.executionContext?.activeWriterUserId &&
          workItem.claimOwnerUserId !== workItem.executionContext.activeWriterUserId,
      ),
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    actorUserId,
    actorDisplayName: actor?.displayName || 'Workspace Operator',
    myWork,
    teamWork,
    watching,
    restartNeeded,
    approvalInbox,
    blockedCount: myWork.filter(item => item.status === 'BLOCKED').length,
    pendingApprovalCount: approvalInbox.length,
    activeWriterConflicts,
  };
};

export const buildTeamQueueSnapshot = async ({
  actor,
  teamId,
}: {
  actor?: ActorContext | null;
  teamId: string;
}): Promise<TeamQueueSnapshot> => {
  const state = await getAuthorizedAppState(actor);
  const capabilityById = new Map(state.capabilities.map(capability => [capability.id, capability]));
  const visibleWorkspaces = state.capabilityWorkspaces.filter(workspace => {
    const capability = capabilityById.get(workspace.capabilityId);
    return canReadCapabilityLiveDetail(capability?.effectivePermissions);
  });
  const approvalInbox = await fetchApprovalInboxEntries({
    capabilityIds: visibleWorkspaces.map(workspace => workspace.capabilityId),
    assignedTeamIds: [teamId],
  });
  const queue = visibleWorkspaces.flatMap(workspace => {
    const capability = capabilityById.get(workspace.capabilityId);
    if (!capability) {
      return [];
    }
    return workspace.workItems
      .filter(workItem => workItem.phaseOwnerTeamId === teamId)
      .map(workItem => toWorkItemSummary(capability, workItem));
  });
  const handoffResult = await query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM capability_work_item_handoff_packets
      WHERE to_team_id = $1
        AND accepted_at IS NULL
    `,
    [teamId],
  ).catch(() => ({ rows: [{ count: '0' }] }));
  const team = state.workspaceOrganization.teams.find(item => item.id === teamId);

  return {
    generatedAt: new Date().toISOString(),
    teamId,
    teamName: team?.name || teamId,
    queue,
    approvalInbox,
    blockedCount: queue.filter(item => item.status === 'BLOCKED').length,
    pendingApprovalCount: approvalInbox.length,
    handoffWaitingCount: Number(handoffResult.rows[0]?.count || 0),
    activeWriterConflicts: queue.filter(
      item =>
        Boolean(
          item.claimOwnerUserId &&
            item.activeWriterUserId &&
            item.claimOwnerUserId !== item.activeWriterUserId,
        ),
    ).length,
    slaRiskCount: queue.filter(item => (item.blockedAgeHours || 0) >= 8).length,
  };
};

export const buildCapabilityHealthSnapshot = async ({
  actor,
  capabilityId,
}: {
  actor?: ActorContext | null;
  capabilityId: string;
}): Promise<CapabilityHealthSnapshot> => {
  const state = await getAuthorizedAppState(actor);
  const capability = state.capabilities.find(item => item.id === capabilityId);
  const workspace = state.capabilityWorkspaces.find(item => item.capabilityId === capabilityId);
  if (!capability || !workspace) {
    throw new Error(`Capability ${capabilityId} was not found.`);
  }
  const liveDetail = canReadCapabilityLiveDetail(capability.effectivePermissions);
  const telemetry = liveDetail
    ? await getTelemetrySummary(capabilityId).catch(() => ({
        totalRuns: 0,
        activeRuns: 0,
        waitingRuns: 0,
        failedRuns: 0,
        totalCostUsd: 0,
        totalTokens: 0,
        averageLatencyMs: 0,
        recentSpans: [],
        recentMetrics: [],
        policyDecisionCount: 0,
        memoryDocumentCount: 0,
        capabilityId,
      }))
    : {
        totalRuns: 0,
        activeRuns: 0,
        waitingRuns: 0,
        failedRuns: 0,
        totalCostUsd: 0,
        totalTokens: 0,
        averageLatencyMs: 0,
      };
  const requiredEvidence = capability.requiredEvidenceKinds || [];
  const deliveredEvidence = new Set(
    workspace.artifacts.map(artifact => artifact.artifactKind || artifact.type).filter(Boolean),
  );
  const latestSnapshot = capability.publishedSnapshots?.[0];
  const latestPublishedAt = latestSnapshot?.publishedAt;
  const publishFreshness = !latestSnapshot
    ? 'MISSING'
    : hoursSince(latestPublishedAt) > 24 * 30
    ? 'STALE'
    : 'FRESH';

  return {
    generatedAt: new Date().toISOString(),
    capabilityId,
    capabilityName: capability.name,
    visibilityScope: capability.effectivePermissions?.visibilityScope || 'NONE',
    activeWorkCount: workspace.workItems.filter(item => item.status !== 'COMPLETED').length,
    blockedCount: workspace.workItems.filter(item => item.status === 'BLOCKED').length,
    pendingApprovalCount: workspace.workItems.filter(
      item => item.status === 'PENDING_APPROVAL',
    ).length,
    completedWorkCount: workspace.workItems.filter(item => item.status === 'COMPLETED').length,
    outputArtifactCount: workspace.artifacts.filter(artifact => artifact.direction !== 'INPUT')
      .length,
    evidenceCompleteness:
      requiredEvidence.length === 0
        ? 1
        : requiredEvidence.filter(kind => deliveredEvidence.has(kind)).length /
          requiredEvidence.length,
    totalRuns: telemetry.totalRuns,
    failedRuns: telemetry.failedRuns,
    waitingRuns: telemetry.waitingRuns,
    activeRuns: telemetry.activeRuns,
    totalCostUsd: telemetry.totalCostUsd,
    totalTokens: telemetry.totalTokens,
    averageLatencyMs: telemetry.averageLatencyMs,
    publishFreshness,
    latestPublishedVersion: latestSnapshot?.publishVersion,
    latestPublishedAt,
    dependencyCount: (capability.dependencies || []).length,
    criticalDependencyCount: (capability.dependencies || []).filter(
      dependency => dependency.criticality === 'HIGH' || dependency.criticality === 'CRITICAL',
    ).length,
    unresolvedVersionMismatchCount: capability.rollupSummary?.versionMismatchCount || 0,
  };
};

export const buildCollectionRollupSnapshot = async ({
  actor,
  capabilityId,
}: {
  actor?: ActorContext | null;
  capabilityId: string;
}): Promise<CollectionRollupSnapshot> => {
  const state = await getAuthorizedAppState(actor);
  const capability = state.capabilities.find(item => item.id === capabilityId);
  if (!capability) {
    throw new Error(`Capability ${capabilityId} was not found.`);
  }

  return {
    generatedAt: new Date().toISOString(),
    capabilityId,
    capabilityName: capability.name,
    visibilityScope: capability.effectivePermissions?.visibilityScope || 'NONE',
    directChildren: capability.rollupSummary?.directChildren || [],
    sharedCapabilities: capability.rollupSummary?.sharedCapabilities || [],
    rollupSummary:
      capability.rollupSummary || {
        capabilityId,
        directChildCount: 0,
        sharedCapabilityCount: 0,
        descendantCount: 0,
        dependencyCount: 0,
        latestPublishedVersion: capability.publishedSnapshots?.[0]?.publishVersion,
        latestPublishedAt: capability.publishedSnapshots?.[0]?.publishedAt,
        missingPublishCount: 0,
        stalePublishCount: 0,
        unresolvedDependencyCount: 0,
        versionMismatchCount: 0,
        directChildren: [],
        sharedCapabilities: [],
        warnings: [],
        dependencyHeatmap: [],
        functionalRequirementCount: 0,
        nonFunctionalRequirementCount: 0,
        apiContractCount: 0,
        softwareVersionCount: 0,
      },
  };
};

export const buildExecutiveSummarySnapshot = async (
  actor?: ActorContext | null,
): Promise<ExecutiveSummarySnapshot> => {
  const state = await getAuthorizedAppState(actor);
  const visibleCapabilities = state.capabilities;
  const visibleCapabilityIds = visibleCapabilities.map(capability => capability.id);
  const aggregate = visibleCapabilities.reduce(
    (summary, capability) => {
      const workspace = state.capabilityWorkspaces.find(
        item => item.capabilityId === capability.id,
      );
      if (!workspace) {
        return summary;
      }
      summary.activeWorkCount += workspace.workItems.filter(
        item => item.status !== 'COMPLETED',
      ).length;
      summary.blockedCount += workspace.workItems.filter(
        item => item.status === 'BLOCKED',
      ).length;
      summary.pendingApprovalCount += workspace.workItems.filter(
        item => item.status === 'PENDING_APPROVAL',
      ).length;
      summary.completedWorkCount += workspace.workItems.filter(
        item => item.status === 'COMPLETED',
      ).length;
      return summary;
    },
    {
      activeWorkCount: 0,
      blockedCount: 0,
      pendingApprovalCount: 0,
      completedWorkCount: 0,
    },
  );
  const runTotals = visibleCapabilityIds.length
    ? await query<{
        total_runs: string;
        failed_runs: string;
        waiting_runs: string;
        total_cost: string | null;
      }>(
        `
          SELECT
            COUNT(*)::text AS total_runs,
            COUNT(*) FILTER (WHERE status = 'FAILED')::text AS failed_runs,
            COUNT(*) FILTER (WHERE status IN ('WAITING_APPROVAL', 'WAITING_INPUT', 'WAITING_CONFLICT'))::text AS waiting_runs,
            (
              SELECT SUM(metric_value)
              FROM capability_metric_samples
              WHERE capability_id = ANY($1::text[])
                AND metric_name = 'cost'
            )::text AS total_cost
          FROM capability_workflow_runs
          WHERE capability_id = ANY($1::text[])
        `,
        [visibleCapabilityIds],
      )
    : { rows: [] };
  const row = runTotals.rows[0] || {
    total_runs: '0',
    failed_runs: '0',
    waiting_runs: '0',
    total_cost: '0',
  };

  return {
    generatedAt: new Date().toISOString(),
    visibleCapabilityCount: visibleCapabilities.length,
    ...aggregate,
    totalRuns: Number(row.total_runs || 0),
    failedRuns: Number(row.failed_runs || 0),
    waitingRuns: Number(row.waiting_runs || 0),
    totalCostUsd: Number(row.total_cost || 0),
  };
};

export const buildAuditReportSnapshot = async (
  actor?: ActorContext | null,
): Promise<AuditReportSnapshot> => {
  const state = await getAuthorizedAppState(actor);
  const capabilityIds = state.capabilities.map(capability => capability.id);
  const decisionRows = capabilityIds.length
    ? await query<Record<string, any>>(
        `
          SELECT *
          FROM capability_approval_decisions
          WHERE capability_id = ANY($1::text[])
          ORDER BY created_at DESC, id DESC
          LIMIT 200
        `,
        [capabilityIds],
      )
    : { rows: [] };
  const capabilityNameById = new Map(
    state.capabilities.map(capability => [capability.id, capability.name]),
  );
  const controlEvents = state.capabilityWorkspaces.flatMap(workspace =>
    workspace.workItems.flatMap(workItem =>
      workItem.history
        .filter(entry =>
          /claimed|control|guid|handoff|write/i.test(
            `${entry.action} ${entry.detail}`,
          ),
        )
        .map(entry => ({
          capabilityId: workspace.capabilityId,
          capabilityName:
            capabilityNameById.get(workspace.capabilityId) || workspace.capabilityId,
          workItemId: workItem.id,
          workItemTitle: workItem.title,
          actor: entry.actor,
          action: entry.action,
          timestamp: entry.timestamp,
          detail: entry.detail,
        })),
    ),
  );

  return {
    generatedAt: new Date().toISOString(),
    accessEvents: state.workspaceOrganization.accessAuditEvents as AccessAuditEvent[],
    approvalDecisions: decisionRows.rows.map(mapApprovalDecision),
    controlEvents: controlEvents.slice(0, 200),
    contractPublications: state.capabilities
      .flatMap(capability => capability.publishedSnapshots || [])
      .slice(0, 200),
  };
};

export const buildReportExportPayload = ({
  reportType,
  payload,
  filters,
}: {
  reportType: ReportExportPayload['reportType'];
  payload: ReportExportPayload['payload'];
  filters?: ReportFilter;
}): ReportExportPayload => ({
  reportType,
  generatedAt: new Date().toISOString(),
  filters,
  payload,
});
