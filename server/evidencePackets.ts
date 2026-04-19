import { createHash } from 'node:crypto';
import path from 'node:path';
import { buildCapabilityInteractionFeed } from '../src/lib/interactionFeed';
import type {
  ActorContext,
  AttestationAiAttribution,
  Artifact,
  EvidencePacket,
  EvidencePacketSummary,
} from '../src/types';
import { getLatestRunForWorkItem, getWorkflowRunDetail, listWorkflowRunEvents } from './execution/repository';
import { getCompletedWorkOrderEvidence } from './ledger';
import { getCapabilityBundle, getWorkspaceSettings, replaceCapabilityWorkspaceContentRecord } from './repository';
import { buildWorkItemExplainDetail } from './workItemExplain';
import { summarizeCapabilityConnectorContext } from './connectors';
import { query } from './db';
import { signAttestation } from './governance/signer';
import { getIncidentLinksForPacket } from './incidents/repository';

// Slice A: attestation protocol version. Bump only when the signed payload
// shape changes (e.g. we add a new field into the signing envelope). Legacy
// rows with NULL signature are treated as `ATTESTATION_VERSION = 1, unsigned`.
const ATTESTATION_VERSION = 1;

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

const parseAiAttributionColumn = (
  value: unknown,
): AttestationAiAttribution | undefined => {
  if (!value) return undefined;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as AttestationAiAttribution) : undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof value === 'object') {
    return value as AttestationAiAttribution;
  }
  return undefined;
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
  // Slice A — attestation chain envelope. For legacy rows these columns are
  // NULL / unset and we fall back to the v1 defaults so older callers keep
  // working without branching.
  attestationVersion:
    typeof row.attestation_version === 'number'
      ? row.attestation_version
      : row.attestation_version !== null && row.attestation_version !== undefined
        ? Number(row.attestation_version)
        : ATTESTATION_VERSION,
  prevBundleId: row.prev_bundle_id || null,
  chainRootBundleId: row.chain_root_bundle_id || row.bundle_id,
  signature: row.signature || null,
  signingKeyId: row.signing_key_id || null,
  signingAlgo: row.signing_algo || null,
  isAiAssisted:
    row.is_ai_assisted === false || row.is_ai_assisted === 'f' || row.is_ai_assisted === 'false'
      ? false
      : true,
  aiAttribution: parseAiAttributionColumn(row.ai_attribution),
  payload: row.payload || {},
});

/**
 * Slice A helper — given a work item, find the most recently-created prior
 * attestation for the same work_item_id so we can link the new one as the
 * next entry in the chain. Called inside the same transaction as the insert
 * below; since bundle_id is content-derived, re-sealing identical content
 * resolves to the same bundle_id and we skip chain extension via ON CONFLICT.
 */
const lookupPriorChain = async (
  workItemId: string,
): Promise<{ prevBundleId: string | null; chainRootBundleId: string | null }> => {
  const result = await query(
    `
      SELECT bundle_id, chain_root_bundle_id
      FROM capability_evidence_packets
      WHERE work_item_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [workItemId],
  );
  if (result.rows.length === 0) {
    return { prevBundleId: null, chainRootBundleId: null };
  }
  const prior = result.rows[0] as { bundle_id: string; chain_root_bundle_id: string | null };
  return {
    prevBundleId: prior.bundle_id,
    chainRootBundleId: prior.chain_root_bundle_id || prior.bundle_id,
  };
};

/**
 * Slice A helper — distill AI attribution from the run detail / run events
 * that feed the packet. Stored verbatim in ai_attribution JSONB so auditors
 * can ask "which agent and which tool invocations produced this attestation"
 * without re-joining historical run tables (runs may be pruned later).
 */
const deriveAiAttribution = (
  latestRun: Awaited<ReturnType<typeof getLatestRunForWorkItem>>,
  runDetail: EvidencePacket['payload']['runDetail'],
): AttestationAiAttribution | undefined => {
  const assignedAgentId = latestRun?.assignedAgentId || undefined;
  const stepAgentIdsSet = new Set<string>();
  const toolInvocationIdsSet = new Set<string>();
  if (runDetail) {
    for (const step of runDetail.steps || []) {
      const stepAgentId = (step as { agentId?: string | null }).agentId;
      if (stepAgentId) stepAgentIdsSet.add(stepAgentId);
    }
    for (const tool of runDetail.toolInvocations || []) {
      const toolId = (tool as { id?: string | null }).id;
      if (toolId) toolInvocationIdsSet.add(toolId);
    }
  }
  if (
    !assignedAgentId &&
    stepAgentIdsSet.size === 0 &&
    toolInvocationIdsSet.size === 0
  ) {
    return undefined;
  }
  return {
    ...(assignedAgentId ? { assignedAgentId } : {}),
    ...(stepAgentIdsSet.size > 0 ? { stepAgentIds: Array.from(stepAgentIdsSet).sort() } : {}),
    ...(toolInvocationIdsSet.size > 0
      ? { toolInvocationIds: Array.from(toolInvocationIdsSet).sort() }
      : {}),
  };
};

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

const DISPLAY_INTERACTION_LIMIT = 40;
const DISPLAY_RUN_EVENT_LIMIT = 30;
const DISPLAY_ARTIFACT_LIMIT = 18;
const DISPLAY_TASK_LIMIT = 18;
const PACKET_INTERACTION_LIMIT = 80;
const PACKET_RUN_EVENT_LIMIT = 40;
const PACKET_ARTIFACT_LIMIT = 24;
const PACKET_TASK_LIMIT = 24;
const PACKET_RUN_STEP_LIMIT = 10;
const PACKET_WAIT_LIMIT = 8;
const PACKET_TOOL_INVOCATION_LIMIT = 16;
const PACKET_HUMAN_GATE_LIMIT = 8;
const PACKET_POLICY_DECISION_LIMIT = 8;
const PACKET_RUN_HISTORY_LIMIT = 12;
const PACKET_PHASE_GROUP_LIMIT = 8;
const PACKET_HUMAN_INTERACTION_LIMIT = 16;
const PACKET_EVENT_LIMIT = 40;
const PACKET_LOG_LIMIT = 30;
const PACKET_EXPLAIN_TIMEOUT_MS = 3000;
const PACKET_EVIDENCE_TIMEOUT_MS = 3000;

const stripArtifactPayload = (artifact: Artifact): Artifact => ({
  ...artifact,
  contentText: undefined,
  contentJson: undefined,
});

const withTimeBudget = async <T>(
  task: Promise<T>,
  timeoutMs: number,
  fallback?: T,
): Promise<T | undefined> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      task,
      new Promise<T | undefined>(resolve => {
        timeoutHandle = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

const trimRunDetailForPacket = (
  runDetail?: EvidencePacket['payload']['runDetail'],
): EvidencePacket['payload']['runDetail'] =>
  runDetail
    ? {
        ...runDetail,
        steps: runDetail.steps.slice(0, PACKET_RUN_STEP_LIMIT),
        waits: runDetail.waits.slice(0, PACKET_WAIT_LIMIT),
        toolInvocations: runDetail.toolInvocations.slice(0, PACKET_TOOL_INVOCATION_LIMIT),
      }
    : undefined;

const trimExplainForPacket = (
  explain?: EvidencePacket['payload']['explain'],
): EvidencePacket['payload']['explain'] =>
  explain
    ? {
        ...explain,
        humanGates: explain.humanGates.slice(0, PACKET_HUMAN_GATE_LIMIT),
        policyDecisions: explain.policyDecisions.slice(0, PACKET_POLICY_DECISION_LIMIT),
        artifacts: explain.artifacts.slice(0, PACKET_ARTIFACT_LIMIT),
        handoffArtifacts: explain.handoffArtifacts.slice(0, PACKET_ARTIFACT_LIMIT),
      }
    : undefined;

const trimEvidenceForPacket = (
  evidence?: EvidencePacket['payload']['evidence'],
): EvidencePacket['payload']['evidence'] =>
  evidence
    ? {
        ...evidence,
        runHistory: evidence.runHistory.slice(0, PACKET_RUN_HISTORY_LIMIT),
        artifacts: evidence.artifacts.slice(0, PACKET_ARTIFACT_LIMIT),
        humanInteractions: evidence.humanInteractions.slice(0, PACKET_HUMAN_INTERACTION_LIMIT),
        phaseGroups: evidence.phaseGroups.slice(0, PACKET_PHASE_GROUP_LIMIT),
        events: evidence.events.slice(0, PACKET_EVENT_LIMIT),
        logs: evidence.logs.slice(0, PACKET_LOG_LIMIT),
        latestRunDetail: trimRunDetailForPacket(evidence.latestRunDetail),
      }
    : undefined;

const trimInteractionFeedForPacket = (
  feed: EvidencePacket['payload']['interactionFeed'],
): EvidencePacket['payload']['interactionFeed'] => ({
  ...feed,
  records: feed.records.slice(0, PACKET_INTERACTION_LIMIT),
  summary: {
    ...feed.summary,
    totalCount: Math.min(feed.summary.totalCount, PACKET_INTERACTION_LIMIT),
  },
});

const trimPayloadForPersistence = (
  payload: EvidencePacket['payload'],
): EvidencePacket['payload'] => ({
  ...payload,
  interactionFeed: trimInteractionFeedForPacket(payload.interactionFeed),
  runDetail: trimRunDetailForPacket(payload.runDetail),
  runEvents: payload.runEvents.slice(0, PACKET_RUN_EVENT_LIMIT),
  artifacts: payload.artifacts.slice(0, PACKET_ARTIFACT_LIMIT).map(stripArtifactPayload),
  tasks: payload.tasks.slice(0, PACKET_TASK_LIMIT),
  explain: trimExplainForPacket(payload.explain),
  evidence: trimEvidenceForPacket(payload.evidence),
});

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
  const [runDetail, runEvents, workspaceSettings] = await Promise.all([
    latestRun ? getWorkflowRunDetail(capabilityId, latestRun.id) : Promise.resolve(undefined),
    latestRun ? listWorkflowRunEvents(capabilityId, latestRun.id) : Promise.resolve([]),
    getWorkspaceSettings().catch(() => undefined),
  ]);

  const interactionFeed = buildCapabilityInteractionFeed({
    capability: bundle.capability,
    workspace: bundle.workspace,
    workItemId,
    runDetail: runDetail || null,
    runEvents,
  });
  const connectors = workspaceSettings
    ? summarizeCapabilityConnectorContext(bundle.capability, workspaceSettings.connectors)
    : undefined;
  const [explain, evidence] = await Promise.all([
    withTimeBudget(
      buildWorkItemExplainDetail(capabilityId, workItemId).catch(() => undefined),
      PACKET_EXPLAIN_TIMEOUT_MS,
    ),
    withTimeBudget(
      getCompletedWorkOrderEvidence(capabilityId, workItemId).catch(() => undefined),
      PACKET_EVIDENCE_TIMEOUT_MS,
    ),
  ]);

  const payload = trimPayloadForPersistence({
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
  });

  const digestSha256 = createHash('sha256').update(stableStringify(payload)).digest('hex');
  const bundleId = `EVD-${digestSha256.slice(0, 24).toUpperCase()}`;
  const title = ensureEvidencePacketTitle(workItem.title);
  const summary =
    explain?.summary.headline ||
    interactionFeed.records[0]?.summary ||
    `Evidence packet for ${workItem.title}`;
  const touchedPaths = collectTouchedPaths(runEvents, collectWorkspaceRoots(bundle));

  // Slice A — chain linkage + Ed25519 signature envelope. For a new work
  // item we self-root (chain_root = bundle_id); otherwise the new packet
  // points at the most recent prior packet for the same work item. When
  // content is identical to an existing packet (same digest → same
  // bundle_id) the INSERT becomes an UPSERT and we intentionally do NOT
  // overwrite chain/signature columns — the original seal remains
  // authoritative.
  const priorChain = await lookupPriorChain(workItemId);
  const chainRootBundleId = priorChain.chainRootBundleId ?? bundleId;
  const aiAttribution = deriveAiAttribution(latestRun, runDetail);
  const { signature, signingKeyId, signingAlgo } = signAttestation({
    digestSha256,
    prevBundleId: priorChain.prevBundleId,
    chainRootBundleId,
    attestationVersion: ATTESTATION_VERSION,
  });

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
        attestation_version,
        prev_bundle_id,
        chain_root_bundle_id,
        signature,
        signing_key_id,
        signing_algo,
        is_ai_assisted,
        ai_attribution,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW())
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
      ATTESTATION_VERSION,
      priorChain.prevBundleId,
      chainRootBundleId,
      signature,
      signingKeyId,
      signingAlgo,
      true,
      aiAttribution ? JSON.stringify(aiAttribution) : null,
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
    touchedPaths: packet.touchedPaths,
    attestationVersion: packet.attestationVersion,
    prevBundleId: packet.prevBundleId,
    chainRootBundleId: packet.chainRootBundleId,
    signature: packet.signature,
    signingKeyId: packet.signingKeyId,
    signingAlgo: packet.signingAlgo,
    isAiAssisted: packet.isAiAssisted,
    aiAttribution: packet.aiAttribution,
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

export const formatEvidencePacketForDisplay = (packet: EvidencePacket): EvidencePacket => ({
  ...packet,
  payload: {
    ...packet.payload,
    interactionFeed: {
      ...packet.payload.interactionFeed,
      records: packet.payload.interactionFeed.records.slice(0, DISPLAY_INTERACTION_LIMIT),
      summary: {
        ...packet.payload.interactionFeed.summary,
        totalCount: packet.payload.interactionFeed.records.length,
      },
    },
    runEvents: packet.payload.runEvents.slice(0, DISPLAY_RUN_EVENT_LIMIT),
    artifacts: packet.payload.artifacts
      .slice(0, DISPLAY_ARTIFACT_LIMIT)
      .map(stripArtifactPayload),
    tasks: packet.payload.tasks.slice(0, DISPLAY_TASK_LIMIT),
  },
});

const toSummary = (packet: EvidencePacket): EvidencePacketSummary => ({
  bundleId: packet.bundleId,
  capabilityId: packet.capabilityId,
  workItemId: packet.workItemId,
  title: packet.title,
  digestSha256: packet.digestSha256,
  createdAt: packet.createdAt,
  generatedBy: packet.generatedBy,
  runId: packet.runId,
  summary: packet.summary,
  touchedPaths: packet.touchedPaths,
  attestationVersion: packet.attestationVersion,
  prevBundleId: packet.prevBundleId,
  chainRootBundleId: packet.chainRootBundleId,
  signature: packet.signature,
  signingKeyId: packet.signingKeyId,
  signingAlgo: packet.signingAlgo,
  isAiAssisted: packet.isAiAssisted,
  aiAttribution: packet.aiAttribution,
});

/**
 * Slice A — ordered chain (root first) for the work item owning `bundleId`.
 * Returns null if the bundle is not found. The chain is derived from
 * chain_root_bundle_id (stable across the work item's lifetime) and sorted
 * by created_at ascending so root is first and the leaf is last.
 */
export const getAttestationChain = async (
  bundleId: string,
): Promise<{
  rootBundleId: string;
  workItemId: string;
  entries: EvidencePacketSummary[];
} | null> => {
  const anchor = await query(
    `
      SELECT chain_root_bundle_id, work_item_id, bundle_id
      FROM capability_evidence_packets
      WHERE bundle_id = $1
    `,
    [bundleId],
  );
  if (!anchor.rowCount) {
    return null;
  }
  const row = anchor.rows[0] as {
    chain_root_bundle_id: string | null;
    work_item_id: string;
    bundle_id: string;
  };
  const rootBundleId = row.chain_root_bundle_id || row.bundle_id;
  const chain = await query(
    `
      SELECT *
      FROM capability_evidence_packets
      WHERE chain_root_bundle_id = $1
      ORDER BY created_at ASC
    `,
    [rootBundleId],
  );
  return {
    rootBundleId,
    workItemId: row.work_item_id,
    entries: chain.rows.map(evidencePacketFromRow).map(toSummary),
  };
};

/**
 * Slice A — verify a packet's signature and that its chain is intact. Intact
 * means every prev_bundle_id in the chain resolves to a persisted row and
 * the chain terminates at chain_root_bundle_id with no gaps. digestMatches
 * recomputes the digest over the stored payload to catch tampering.
 */
export type EvidencePacketVerification = {
  bundleId: string;
  capabilityId: string;
  workItemId: string;
  signatureValid: boolean;
  digestMatches: boolean;
  chainIntact: boolean;
  chainDepth: number;
  chainRootBundleId: string;
  signingKeyId: string | null;
  signingAlgo: string | null;
  attestationVersion: number;
  reason?: string;
};

export const verifyEvidencePacket = async (
  bundleId: string,
): Promise<EvidencePacketVerification | null> => {
  const { verifyAttestationSignature } = await import('./governance/signer');
  const rowResult = await query(
    `SELECT * FROM capability_evidence_packets WHERE bundle_id = $1`,
    [bundleId],
  );
  if (!rowResult.rowCount) return null;
  const packet = evidencePacketFromRow(rowResult.rows[0]);

  const recomputedDigestSha256 = createHash('sha256')
    .update(stableStringify(packet.payload))
    .digest('hex');

  const verifyResult = verifyAttestationSignature({
    digestSha256: packet.digestSha256,
    prevBundleId: packet.prevBundleId ?? null,
    chainRootBundleId: packet.chainRootBundleId ?? packet.bundleId,
    attestationVersion: packet.attestationVersion ?? ATTESTATION_VERSION,
    signature: packet.signature ?? null,
    signingKeyId: packet.signingKeyId ?? null,
    recomputedDigestSha256,
  });

  // Walk the chain backwards from this packet via prev_bundle_id; chain is
  // intact if every prev pointer resolves and we land on chain_root_bundle_id
  // with prev=null.
  const visited = new Set<string>();
  let cursor = packet;
  let chainIntact = true;
  let chainReason: string | undefined;
  let chainDepth = 0;
  while (cursor.prevBundleId) {
    if (visited.has(cursor.prevBundleId)) {
      chainIntact = false;
      chainReason = 'chain_cycle_detected';
      break;
    }
    visited.add(cursor.prevBundleId);
    const prior = await query(
      `SELECT * FROM capability_evidence_packets WHERE bundle_id = $1`,
      [cursor.prevBundleId],
    );
    if (!prior.rowCount) {
      chainIntact = false;
      chainReason = 'missing_prev_bundle';
      break;
    }
    cursor = evidencePacketFromRow(prior.rows[0]);
    chainDepth += 1;
  }
  if (chainIntact && cursor.bundleId !== (packet.chainRootBundleId ?? packet.bundleId)) {
    chainIntact = false;
    chainReason = 'chain_root_mismatch';
  }

  return {
    bundleId: packet.bundleId,
    capabilityId: packet.capabilityId,
    workItemId: packet.workItemId,
    signatureValid: verifyResult.signatureValid,
    digestMatches: verifyResult.digestMatches,
    chainIntact,
    chainDepth,
    chainRootBundleId: packet.chainRootBundleId ?? packet.bundleId,
    signingKeyId: packet.signingKeyId ?? null,
    signingAlgo: packet.signingAlgo ?? null,
    attestationVersion: packet.attestationVersion ?? ATTESTATION_VERSION,
    reason: chainReason || verifyResult.reason,
  };
};
