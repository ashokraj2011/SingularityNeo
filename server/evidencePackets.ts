import { createHash } from 'node:crypto';
import path from 'node:path';
import type { ActorContext, Artifact, EvidencePacket, EvidencePacketSummary } from '../src/types';
import { getLatestRunForWorkItem, getWorkflowRunDetail, listWorkflowRunEvents } from './execution/repository';
import { buildCapabilityInteractionFeedSnapshot } from './interactionFeed';
import { getCompletedWorkOrderEvidence } from './ledger';
import { getCapabilityBundle, replaceCapabilityWorkspaceContentRecord } from './repository';
import { buildWorkItemExplainDetail } from './workItemExplain';
import { buildCapabilityConnectorContext } from './connectors';
import { query } from './db';
import { getIncidentLinksForPacket } from './incidents/repository';

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`;
  }

  if (typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort((left, right) => left.localeCompare(right))
      .map(
        key =>
          `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }

  return JSON.stringify(value);
};

const evidencePacketFromRow = (row: Record<string, any>): EvidencePacket => ({
  bundleId: row.bundle_id,
  capabilityId: row.capability_id,
  workItemId: row.work_item_id,
  runId: row.run_id || undefined,
  title: row.title,
  summary: row.summary,
  digestSha256: row.digest_sha256,
  generatedBy: row.generated_by_actor_display_name,
  createdAt:
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ''),
  touchedPaths: Array.isArray(row.touched_paths) ? row.touched_paths.map(String) : [],
  payload: row.payload || {},
});

const looksAbsolutePath = (value: string) =>
  path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value);

const normalizeSlashes = (value: string) =>
  value
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .trim();

const normalizeWorkspaceRoot = (value: string) => {
  const normalized = normalizeSlashes(value).replace(/\/+$/, '');
  if (!normalized) {
    return normalized;
  }
  return looksAbsolutePath(normalized) ? normalized : normalizeSlashes(path.resolve(normalized));
};

const toRelativeTouchedPath = (rawPath: string, workspaceRoots: string[]) => {
  const trimmed = String(rawPath || '').trim();
  if (!trimmed) {
    return undefined;
  }

  const normalizedPath = normalizeSlashes(trimmed);
  if (!looksAbsolutePath(normalizedPath)) {
    return normalizedPath.replace(/^\.\//, '').replace(/^\/+/, '') || undefined;
  }

  const matchedRoot = workspaceRoots
    .map(normalizeWorkspaceRoot)
    .find(root => normalizedPath === root || normalizedPath.startsWith(`${root}/`));

  if (!matchedRoot) {
    return normalizedPath.replace(/^\/+/, '') || undefined;
  }

  const relativePath = normalizeSlashes(path.posix.relative(matchedRoot, normalizedPath));
  return relativePath === '' || relativePath === '.'
    ? undefined
    : relativePath.replace(/^\.\//, '') || undefined;
};

const collectWorkspaceRoots = (bundle: Awaited<ReturnType<typeof getCapabilityBundle>>) =>
  Array.from(
    new Set(
      [
        bundle.capability.executionConfig.defaultWorkspacePath,
        ...(bundle.capability.executionConfig.allowedWorkspacePaths || []),
        ...(bundle.capability.localDirectories || []),
        ...((bundle.capability.repositories || []).map(repository => repository.localRootHint) || []),
      ]
        .map(value => String(value || '').trim())
        .filter(Boolean),
    ),
  );

export const collectTouchedPaths = (
  runEvents: EvidencePacket['payload']['runEvents'],
  workspaceRoots: string[] = [],
) =>
  Array.from(
    new Set(
      runEvents.flatMap(event => {
        const details = event.details || {};
        const rawValues = Array.isArray(details.touchedPaths)
          ? details.touchedPaths
          : typeof details.path === 'string'
            ? [details.path]
            : [];
        return rawValues
          .map(value => toRelativeTouchedPath(String(value || ''), workspaceRoots))
          .filter((value): value is string => Boolean(value));
      }),
    ),
  ).sort((left, right) => left.localeCompare(right));

const ensureEvidencePacketTitle = (workItemTitle: string) =>
  `${workItemTitle} Evidence Packet`;

const createEvidenceArtifactId = (bundleId: string) =>
  `ART-EVD-${bundleId.replace(/^EVD-/, '').slice(0, 18)}`;

const buildEvidencePacketArtifact = ({
  packet,
  workItemTitle,
  workflowId,
  assignedAgentId,
  phase,
  traceId,
}: {
  packet: EvidencePacket;
  workItemTitle: string;
  workflowId: string;
  assignedAgentId?: string;
  phase: string;
  traceId?: string;
}): Artifact => ({
  id: createEvidenceArtifactId(packet.bundleId),
  name: packet.title,
  capabilityId: packet.capabilityId,
  type: 'Evidence Packet',
  version: `packet-${packet.digestSha256.slice(0, 8)}`,
  agent: 'SYSTEM',
  created: packet.createdAt,
  direction: 'OUTPUT',
  connectedAgentId: assignedAgentId,
  sourceWorkflowId: workflowId,
  runId: packet.runId,
  summary: packet.summary,
  artifactKind: 'EVIDENCE_PACKET',
  phase: phase as Artifact['phase'],
  workItemId: packet.workItemId,
  sourceRunId: packet.runId,
  contentFormat: 'MARKDOWN',
  mimeType: 'text/markdown',
  fileName: `${workItemTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'work-item'}-evidence-packet.md`,
  contentText: [
    `# ${packet.title}`,
    '',
    packet.summary,
    '',
    `- Work item: ${packet.workItemId}`,
    packet.runId ? `- Run: ${packet.runId}` : null,
    `- Digest: ${packet.digestSha256}`,
    `- Packet permalink: /e/${packet.bundleId}`,
    packet.generatedBy ? `- Generated by: ${packet.generatedBy}` : null,
    packet.touchedPaths.length > 0
      ? `- Touched paths: ${packet.touchedPaths.slice(0, 10).join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n'),
  downloadable: true,
  traceId,
  contentJson: {
    bundleId: packet.bundleId,
    digestSha256: packet.digestSha256,
    permalink: `/e/${packet.bundleId}`,
    touchedPaths: packet.touchedPaths,
  },
});

export const createEvidencePacketForWorkItem = async ({
  capabilityId,
  workItemId,
  actor,
}: {
  capabilityId: string;
  workItemId: string;
  actor?: ActorContext | null;
}): Promise<EvidencePacketSummary> => {
  const bundle = await getCapabilityBundle(capabilityId);
  const workItem = bundle.workspace.workItems.find(item => item.id === workItemId);
  if (!workItem) {
    throw new Error(`Work item ${workItemId} was not found.`);
  }

  const latestRun = await getLatestRunForWorkItem(capabilityId, workItemId);
  const [runDetail, runEvents, interactionFeed, explain, connectors, evidence] = await Promise.all([
    latestRun ? getWorkflowRunDetail(capabilityId, latestRun.id) : Promise.resolve(undefined),
    latestRun ? listWorkflowRunEvents(capabilityId, latestRun.id) : Promise.resolve([]),
    buildCapabilityInteractionFeedSnapshot({ capabilityId, workItemId }),
    buildWorkItemExplainDetail(capabilityId, workItemId).catch(() => undefined),
    buildCapabilityConnectorContext(capabilityId).catch(() => undefined),
    getCompletedWorkOrderEvidence(capabilityId, workItemId).catch(() => undefined),
  ]);

  const payload: EvidencePacket['payload'] = {
    capabilityBriefing: bundle.workspace.briefing,
    readinessContract:
      bundle.workspace.readinessContract || {
        capabilityId,
        generatedAt: new Date().toISOString(),
        allReady: false,
        summary: 'Readiness contract was unavailable when this evidence packet was generated.',
        gates: [],
      },
    interactionFeed,
    workItem,
    latestRun: latestRun || undefined,
    workflow: bundle.workspace.workflows.find(workflow => workflow.id === workItem.workflowId),
    runDetail,
    runEvents,
    artifacts: bundle.workspace.artifacts.filter(
      artifact =>
        artifact.workItemId === workItemId ||
        (latestRun?.id ? artifact.runId === latestRun.id : false),
    ),
    tasks: bundle.workspace.tasks.filter(task => task.workItemId === workItemId),
    explain,
    connectors,
    evidence,
  };

  const digestSha256 = createHash('sha256').update(stableStringify(payload)).digest('hex');
  const bundleId = `EVD-${digestSha256.slice(0, 24).toUpperCase()}`;
  const title = ensureEvidencePacketTitle(workItem.title);
  const summary =
    explain?.summary.headline ||
    interactionFeed.records[0]?.summary ||
    `Evidence packet for ${workItem.title}`;
  const touchedPaths = collectTouchedPaths(runEvents, collectWorkspaceRoots(bundle));

  const result = await query(
    `
      INSERT INTO capability_evidence_packets (
        bundle_id,
        capability_id,
        work_item_id,
        run_id,
        title,
        summary,
        digest_sha256,
        payload,
        generated_by_actor_user_id,
        generated_by_actor_display_name,
        touched_paths,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
      ON CONFLICT (bundle_id) DO UPDATE SET
        touched_paths = EXCLUDED.touched_paths,
        updated_at = NOW()
      RETURNING *
    `,
    [
      bundleId,
      capabilityId,
      workItemId,
      latestRun?.id || null,
      title,
      summary,
      digestSha256,
      JSON.stringify(payload),
      actor?.userId || null,
      actor?.displayName || 'Workspace Operator',
      touchedPaths,
    ],
  );

  const packet = evidencePacketFromRow(result.rows[0]);
  const artifact = buildEvidencePacketArtifact({
    packet,
    workItemTitle: workItem.title,
    workflowId: workItem.workflowId,
    assignedAgentId: workItem.assignedAgentId,
    phase: workItem.phase,
    traceId: latestRun?.traceId,
  });
  const nextArtifacts = [
    ...bundle.workspace.artifacts.filter(existing => existing.id !== artifact.id),
    artifact,
  ].sort((left, right) => new Date(left.created).getTime() - new Date(right.created).getTime());

  await replaceCapabilityWorkspaceContentRecord(capabilityId, {
    artifacts: nextArtifacts,
  });

  return {
    bundleId: packet.bundleId,
    capabilityId: packet.capabilityId,
    workItemId: packet.workItemId,
    title: packet.title,
    digestSha256: packet.digestSha256,
    createdAt: packet.createdAt,
    generatedBy: packet.generatedBy,
    runId: packet.runId,
    summary: packet.summary,
  };
};

export const getEvidencePacket = async (bundleId: string): Promise<EvidencePacket | null> => {
  const result = await query(
    `
      SELECT *
      FROM capability_evidence_packets
      WHERE bundle_id = $1
      LIMIT 1
    `,
    [bundleId],
  );

  if (!result.rowCount) {
    return null;
  }

  const packet = evidencePacketFromRow(result.rows[0]);
  return {
    ...packet,
    incidentLinks: await getIncidentLinksForPacket(bundleId),
  };
};
