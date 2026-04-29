import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  FileText,
  GitBranch,
  Link2,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Workflow,
  X,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import ArtifactPreview from '../components/ArtifactPreview';
import IncidentLinkBadge from '../components/IncidentLinkBadge';
import InteractionTimeline from '../components/InteractionTimeline';
import LinkIncidentDialog from '../components/LinkIncidentDialog';
import { ToolInvocationPolicyBadge } from '../components/ToolInvocationPolicyBadge';
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from '../components/EnterpriseUI';
import { useToast } from '../context/ToastContext';
import {
  fetchAttestationChain,
  fetchEvidencePacket,
  verifyEvidencePacket,
} from '../lib/api';
import { getWorkItemTaskTypeLabel } from '../lib/workItemTaskTypes';
import type {
  Artifact,
  AttestationChain,
  CapabilityBriefing,
  EvidencePacket,
  EvidencePacketVerification,
  RunEvent,
} from '../types';

const formatTimestamp = (value?: string) => {
  if (!value) {
    return 'Unknown';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const compactHash = (value: string, size = 16) =>
  value.length <= size ? value : `${value.slice(0, size)}...`;

const clampList = (items: string[] | undefined, limit: number) =>
  Array.from(new Set((items || []).map(item => String(item || '').trim()).filter(Boolean))).slice(
    0,
    limit,
  );

const connectorTone = (status?: string) => {
  switch (status) {
    case 'READY':
      return 'success' as const;
    case 'ERROR':
      return 'danger' as const;
    case 'NEEDS_CONFIGURATION':
      return 'warning' as const;
    default:
      return 'neutral' as const;
  }
};

const runStatusTone = (status?: string) => {
  switch (status) {
    case 'COMPLETED':
      return 'success' as const;
    case 'FAILED':
    case 'CANCELLED':
      return 'danger' as const;
    case 'WAITING_APPROVAL':
    case 'WAITING_HUMAN_TASK':
    case 'WAITING_INPUT':
    case 'WAITING_CONFLICT':
      return 'warning' as const;
    case 'RUNNING':
      return 'brand' as const;
    default:
      return 'neutral' as const;
  }
};

const readinessTone = (status?: string) => {
  switch (status) {
    case 'READY':
      return 'success' as const;
    case 'WAITING_APPROVAL':
      return 'warning' as const;
    case 'BLOCKED':
      return 'danger' as const;
    default:
      return 'neutral' as const;
  }
};

const eventTone = (level?: RunEvent['level']) => {
  switch (level) {
    case 'ERROR':
      return 'danger' as const;
    case 'WARN':
      return 'warning' as const;
    default:
      return 'neutral' as const;
  }
};

const artifactTone = (artifact: Artifact) => {
  if (artifact.artifactKind === 'EVIDENCE_PACKET') {
    return 'info' as const;
  }
  if (artifact.artifactKind === 'APPROVAL_RECORD' || artifact.artifactKind === 'REVIEW_PACKET') {
    return 'warning' as const;
  }
  if (artifact.artifactKind === 'CODE_DIFF' || artifact.artifactKind === 'PHASE_OUTPUT') {
    return 'brand' as const;
  }
  return 'neutral' as const;
};

/**
 * Slice 1 — Signed Change Attestations. Summarizes a packet's verification
 * state into a compact chip band the operator can scan at a glance:
 *   Signed        — signature_valid=true, signed with a known key
 *   Unsigned      — no signature present (legacy packet or signer off)
 *   Tampered      — signature present but signature_valid=false OR digest_matches=false
 *   Chain intact  — prev_bundle_id walk reached chain_root cleanly
 *   Chain broken  — walk hit a missing prev or cycle
 * Clicking any chip opens the verify drawer for the full detail.
 */
const AttestationChipBand = ({
  verification,
  loading,
  onOpenDrawer,
}: {
  verification: EvidencePacketVerification | null;
  loading: boolean;
  onOpenDrawer: () => void;
}) => {
  if (loading && !verification) {
    return (
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone="neutral">Checking attestation...</StatusBadge>
      </div>
    );
  }
  if (!verification) {
    return (
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone="neutral">Verification unavailable</StatusBadge>
      </div>
    );
  }
  const isSigned = Boolean(verification.signingKeyId);
  const isTampered =
    (isSigned && !verification.signatureValid) || !verification.digestMatches;
  let signatureTone: 'success' | 'warning' | 'danger' | 'neutral';
  let signatureLabel: string;
  if (isTampered) {
    signatureTone = 'danger';
    signatureLabel = verification.signatureValid
      ? 'Digest mismatch'
      : 'Signature invalid';
  } else if (isSigned) {
    signatureTone = 'success';
    signatureLabel = `Signed · ${verification.signingKeyId}`;
  } else {
    signatureTone = 'warning';
    signatureLabel = 'Unsigned (legacy)';
  }
  const chainTone = verification.chainIntact ? 'success' : 'danger';
  const chainLabel = verification.chainIntact
    ? `Chain v${verification.attestationVersion} intact · depth ${verification.chainDepth}`
    : `Chain broken · ${verification.reason || 'gap'}`;
  return (
    <button
      type="button"
      onClick={onOpenDrawer}
      className="group flex flex-wrap items-center gap-2 rounded-full border border-transparent text-left transition hover:border-outline-variant/60 hover:bg-surface-container-low focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 px-1 py-0.5"
      aria-label="Open attestation verification drawer"
    >
      <StatusBadge tone={signatureTone}>{signatureLabel}</StatusBadge>
      <StatusBadge tone={chainTone}>{chainLabel}</StatusBadge>
      <span className="text-[0.68rem] font-medium uppercase tracking-wide text-secondary group-hover:text-on-surface">
        Verify ↗
      </span>
    </button>
  );
};

/**
 * Slice 1 — drawer surfacing the full signed-attestation audit: per-link
 * signature/digest/chain state for the whole work-item chain, with the
 * verify reason code surfaced verbatim so operators can hand the output
 * to an auditor without additional translation.
 */
const AttestationVerifyDrawer = ({
  open,
  onClose,
  verification,
  chain,
  chainLoading,
  verificationLoading,
  onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  verification: EvidencePacketVerification | null;
  chain: AttestationChain | null;
  chainLoading: boolean;
  verificationLoading: boolean;
  onRefresh: () => void;
}) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-scrim/40"
      role="dialog"
      aria-modal="true"
      aria-label="Attestation verification"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-xl flex-col overflow-hidden bg-white shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-outline-variant/40 px-6 py-4">
          <div>
            <p className="form-kicker">Signed Change Attestation</p>
            <h2 className="text-lg font-semibold text-on-surface">Verify packet &amp; chain</h2>
            <p className="mt-1 text-xs leading-relaxed text-secondary">
              Recomputes the packet digest, validates the Ed25519 signature against the
              registered public key, and walks prev_bundle_id back to the chain root.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-secondary hover:bg-surface-container-low hover:text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            aria-label="Close verification drawer"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {verification ? (
            <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low px-4 py-3 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="workspace-meta-label">Signature</p>
                  <StatusBadge
                    tone={
                      verification.signingKeyId
                        ? verification.signatureValid
                          ? 'success'
                          : 'danger'
                        : 'warning'
                    }
                  >
                    {verification.signingKeyId
                      ? verification.signatureValid
                        ? 'valid'
                        : 'invalid'
                      : 'unsigned'}
                  </StatusBadge>
                </div>
                <div>
                  <p className="workspace-meta-label">Digest</p>
                  <StatusBadge tone={verification.digestMatches ? 'success' : 'danger'}>
                    {verification.digestMatches ? 'matches' : 'mismatch'}
                  </StatusBadge>
                </div>
                <div>
                  <p className="workspace-meta-label">Chain</p>
                  <StatusBadge tone={verification.chainIntact ? 'success' : 'danger'}>
                    {verification.chainIntact ? `intact · depth ${verification.chainDepth}` : 'broken'}
                  </StatusBadge>
                </div>
                <div>
                  <p className="workspace-meta-label">Attestation version</p>
                  <p className="mt-1 text-sm font-semibold text-on-surface">
                    v{verification.attestationVersion}
                  </p>
                </div>
              </div>
              {verification.reason ? (
                <p className="text-xs leading-relaxed text-secondary">
                  Reason: <span className="font-mono">{verification.reason}</span>
                </p>
              ) : null}
              <div className="text-xs leading-relaxed text-secondary">
                <p>
                  <span className="workspace-meta-label">Chain root:</span>{' '}
                  <span className="font-mono">{verification.chainRootBundleId}</span>
                </p>
                {verification.signingKeyId ? (
                  <p>
                    <span className="workspace-meta-label">Signed by:</span>{' '}
                    <span className="font-mono">{verification.signingKeyId}</span>
                    {verification.signingAlgo ? (
                      <span className="ml-2 text-[0.7rem] uppercase tracking-wide text-secondary">
                        {verification.signingAlgo}
                      </span>
                    ) : null}
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low px-4 py-3 text-sm text-secondary">
              {verificationLoading ? 'Verifying...' : 'Verification unavailable.'}
            </div>
          )}

          <div className="rounded-2xl border border-outline-variant/40 bg-white">
            <div className="flex items-center justify-between border-b border-outline-variant/40 px-4 py-3">
              <div>
                <p className="workspace-meta-label">Attestation chain</p>
                <p className="mt-1 text-xs leading-relaxed text-secondary">
                  Root-first ordering — every earlier link must be present for
                  this packet's chain to count as intact.
                </p>
              </div>
              <button
                type="button"
                onClick={onRefresh}
                className="enterprise-button enterprise-button-secondary"
              >
                <RefreshCw size={14} />
                Refresh
              </button>
            </div>
            {chainLoading && !chain ? (
              <div className="px-4 py-3 text-sm text-secondary">Loading chain...</div>
            ) : chain && chain.entries.length > 0 ? (
              <ol className="divide-y divide-outline-variant/40">
                {chain.entries.map((entry, index) => (
                  <li key={entry.bundleId} className="flex items-start gap-3 px-4 py-3">
                    <span className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[0.7rem] font-semibold text-primary">
                      {index + 1}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-on-surface">
                        {entry.title || entry.bundleId}
                      </p>
                      <p className="mt-0.5 text-[0.7rem] font-mono text-secondary">
                        {entry.bundleId}
                      </p>
                      <p className="mt-1 text-xs text-secondary">
                        {formatTimestamp(entry.createdAt)} · v{entry.attestationVersion ?? 1}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {entry.signingKeyId ? (
                          <StatusBadge tone="success">
                            <ShieldCheck size={12} />
                            <span className="ml-1">Signed</span>
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone="warning">
                            <ShieldOff size={12} />
                            <span className="ml-1">Unsigned</span>
                          </StatusBadge>
                        )}
                        {entry.isAiAssisted ? (
                          <StatusBadge tone="info">AI assisted</StatusBadge>
                        ) : (
                          <StatusBadge tone="neutral">Human</StatusBadge>
                        )}
                        {entry.bundleId === chain.rootBundleId ? (
                          <StatusBadge tone="neutral">Root</StatusBadge>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="px-4 py-3 text-sm text-secondary">
                No chain entries are available.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const BriefingDigest = ({
  briefing,
  sections,
}: {
  briefing: CapabilityBriefing;
  sections: Array<{ label: string; items: string[] }>;
}) => (
  <div className="space-y-3">
    <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
      <p className="text-sm font-semibold text-on-surface">{briefing.title}</p>
      <p className="mt-2 text-sm leading-relaxed text-secondary">
        {briefing.purpose || briefing.outcome}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {briefing.ownerTeam ? (
          <StatusBadge tone="neutral">Owner team: {briefing.ownerTeam}</StatusBadge>
        ) : null}
        {briefing.definitionOfDone ? (
          <StatusBadge tone="info">Definition of done captured</StatusBadge>
        ) : null}
      </div>
    </div>

    {sections.map(section => (
      <div
        key={section.label}
        className="rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-3"
      >
        <p className="workspace-meta-label">{section.label}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {section.items.map(item => (
            <StatusBadge key={`${section.label}:${item}`} tone="neutral">
              {item}
            </StatusBadge>
          ))}
        </div>
      </div>
    ))}
  </div>
);

const EvidencePacketPage = () => {
  const navigate = useNavigate();
  const { bundleId = '' } = useParams();
  const { error: showError } = useToast();
  const [packet, setPacket] = useState<EvidencePacket | null>(null);
  const [loading, setLoading] = useState(true);
  const [isIncidentDialogOpen, setIsIncidentDialogOpen] = useState(false);

  // Slice 1 — Signed Change Attestations. Auto-verify on load so operators
  // see the signed/unsigned/chain-intact state immediately; the drawer pulls
  // the full chain on demand.
  const [verification, setVerification] = useState<EvidencePacketVerification | null>(null);
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [isVerifyDrawerOpen, setIsVerifyDrawerOpen] = useState(false);
  const [attestationChain, setAttestationChain] = useState<AttestationChain | null>(null);
  const [chainLoading, setChainLoading] = useState(false);

  const loadVerification = async () => {
    if (!bundleId) return;
    setVerificationLoading(true);
    try {
      setVerification(await verifyEvidencePacket(bundleId));
    } catch (error) {
      setVerification(null);
      // Don't surface a toast for every packet — the chip will render as
      // "Verification unavailable" and the drawer can be opened for detail.
      console.error('Packet verification failed:', error);
    } finally {
      setVerificationLoading(false);
    }
  };

  const loadPacket = async () => {
    if (!bundleId) {
      setPacket(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      setPacket(await fetchEvidencePacket(bundleId));
    } catch (error) {
      setPacket(null);
      showError(
        'Evidence packet unavailable',
        error instanceof Error ? error.message : 'Unable to open this evidence packet.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPacket();
    void loadVerification();
  }, [bundleId]);

  useEffect(() => {
    if (!isVerifyDrawerOpen || !bundleId) return;
    if (attestationChain) return;
    setChainLoading(true);
    fetchAttestationChain(bundleId)
      .then(chain => setAttestationChain(chain))
      .catch(error => {
        console.error('Attestation chain load failed:', error);
      })
      .finally(() => setChainLoading(false));
  }, [isVerifyDrawerOpen, bundleId, attestationChain]);

  const topTouchedPaths = useMemo(() => packet?.touchedPaths?.slice(0, 12) || [], [packet]);
  const hiddenTouchedPathCount = Math.max(
    0,
    (packet?.touchedPaths?.length || 0) - topTouchedPaths.length,
  );

  const packetArtifacts = useMemo(() => packet?.payload.artifacts.slice(0, 10) || [], [packet]);
  const hiddenArtifactCount = Math.max(
    0,
    (packet?.payload.artifacts.length || 0) - packetArtifacts.length,
  );

  const packetTasks = useMemo(() => packet?.payload.tasks.slice(0, 8) || [], [packet]);
  const hiddenTaskCount = Math.max(0, (packet?.payload.tasks.length || 0) - packetTasks.length);

  const packetRunEvents = useMemo(
    () =>
      (packet?.payload.runEvents || [])
        .slice()
        .sort(
          (left, right) =>
            new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
        )
        .slice(0, 8),
    [packet],
  );
  const hiddenRunEventCount = Math.max(
    0,
    (packet?.payload.runEvents.length || 0) - packetRunEvents.length,
  );

  const recentSteps = useMemo(
    () =>
      (packet?.payload.runDetail?.steps || [])
        .slice()
        .sort((left, right) => right.stepIndex - left.stepIndex)
        .slice(0, 5),
    [packet],
  );

  const recentWaits = useMemo(
    () =>
      (packet?.payload.runDetail?.waits || [])
        .slice()
        .sort(
          (left, right) =>
            new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
        )
        .slice(0, 4),
    [packet],
  );

  const humanGates = useMemo(() => packet?.payload.explain?.humanGates.slice(0, 4) || [], [packet]);
  const policyDecisions = useMemo(
    () => packet?.payload.explain?.policyDecisions.slice(0, 4) || [],
    [packet],
  );
  const allPolicyDecisions = useMemo(
    () => packet?.payload.explain?.policyDecisions || [],
    [packet],
  );
  const recentToolInvocations = useMemo(
    () => (packet?.payload.runDetail?.toolInvocations || []).slice(0, 4),
    [packet],
  );

  const briefingDigestSections = useMemo(() => {
    if (!packet) {
      return [];
    }

    const briefing = packet.payload.capabilityBriefing;
    return [
      { label: 'Stakeholders', items: clampList(briefing.stakeholderSummary, 5) },
      { label: 'Linked systems', items: clampList(briefing.linkedSystems, 5) },
      { label: 'Repositories', items: clampList(briefing.repoSummary, 4) },
      { label: 'Constraints', items: clampList(briefing.activeConstraints, 4) },
      { label: 'Evidence priorities', items: clampList(briefing.evidencePriorities, 4) },
    ].filter(section => section.items.length > 0);
  }, [packet]);

  const briefingSections = useMemo(
    () => packet?.payload.capabilityBriefing.sections.slice(0, 4) || [],
    [packet],
  );

  const connectorCards = useMemo(() => {
    const connectors = packet?.payload.connectors;
    if (!connectors) {
      return [];
    }

    return [
      {
        key: 'github',
        label: 'GitHub',
        status: connectors.github.status,
        message: connectors.github.message,
        extra:
          connectors.github.repositories.length > 0
            ? `${connectors.github.repositories.length} repositories`
            : 'No repository context captured',
      },
      {
        key: 'jira',
        label: 'Jira',
        status: connectors.jira.status,
        message: connectors.jira.message,
        extra:
          connectors.jira.issues.length > 0
            ? `${connectors.jira.issues.length} linked issues`
            : 'No Jira issues captured',
      },
      {
        key: 'confluence',
        label: 'Confluence',
        status: connectors.confluence.status,
        message: connectors.confluence.message,
        extra:
          connectors.confluence.pages.length > 0
            ? `${connectors.confluence.pages.length} linked pages`
            : 'No Confluence pages captured',
      },
    ];
  }, [packet]);

  const packetNarrative = useMemo(() => {
    if (!packet) {
      return '';
    }

    const explain = packet.payload.explain;
    const releaseReadiness = explain?.releaseReadiness;
    const latestRun = packet.payload.latestRun;

    return [
      `# ${packet.title}`,
      '',
      packet.summary,
      '',
      '## Decision Context',
      '',
      `- Capability: ${packet.capabilityId}`,
      `- Work item: ${packet.workItemId}`,
      `- Workflow: ${packet.payload.workflow?.name || 'Not captured'}`,
      latestRun ? `- Run: ${latestRun.id} (${latestRun.status})` : '- Run: Not captured',
      `- Generated by: ${packet.generatedBy}`,
      `- Created at: ${formatTimestamp(packet.createdAt)}`,
      `- Digest: ${packet.digestSha256}`,
      '',
      '## Evidence Included',
      '',
      `- Interaction records: ${packet.payload.interactionFeed.summary.totalCount}`,
      `- Run events: ${packet.payload.runEvents.length}`,
      `- Artifacts: ${packet.payload.artifacts.length}`,
      `- Tasks: ${packet.payload.tasks.length}`,
      packet.touchedPaths?.length
        ? `- Touched paths: ${packet.touchedPaths.slice(0, 8).join(', ')}`
        : '- Touched paths: none captured',
      '',
      '## Operational Snapshot',
      '',
      explain?.summary.headline ? `- Summary: ${explain.summary.headline}` : null,
      explain?.summary.blockingState ? `- Blocking state: ${explain.summary.blockingState}` : null,
      explain?.summary.nextAction ? `- Next action: ${explain.summary.nextAction}` : null,
      releaseReadiness
        ? `- Release readiness: ${releaseReadiness.status} (${releaseReadiness.score}%)`
        : null,
    ]
      .filter(Boolean)
      .join('\n');
  }, [packet]);

  if (loading) {
    return (
      <div className="rounded-3xl border border-outline-variant/40 bg-white px-6 py-8 text-sm text-secondary">
        Loading evidence packet.
      </div>
    );
  }

  if (!packet) {
    return (
      <EmptyState
        title="Evidence packet unavailable"
        description="The requested packet could not be loaded or you may not have permission to read it."
        icon={FileText}
        className="min-h-[24rem]"
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Evidence Packet"
        context={packet.bundleId}
        title={packet.title}
        description={packet.summary}
        actions={
          <>
            <button
              type="button"
              onClick={() => void loadPacket()}
              className="enterprise-button enterprise-button-secondary"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setIsIncidentDialogOpen(true)}
              className="enterprise-button enterprise-button-secondary"
            >
              <Link2 size={16} />
              Link incident
            </button>
            <button
              type="button"
              onClick={() =>
                navigate(`/work?selected=${encodeURIComponent(packet.workItemId)}`)
              }
              className="enterprise-button enterprise-button-primary"
            >
              <ArrowRight size={16} />
              Open work item
            </button>
          </>
        }
      >
        <div className="grid max-w-6xl gap-3 md:grid-cols-4">
          <StatTile
            label="Generated"
            value={formatTimestamp(packet.createdAt)}
            helper={packet.generatedBy}
            tone="neutral"
          />
          <StatTile
            label="Run status"
            value={packet.payload.latestRun?.status || 'Not captured'}
            helper={packet.payload.workflow?.name || 'Workflow snapshot'}
            tone={runStatusTone(packet.payload.latestRun?.status)}
          />
          <StatTile
            label="Readiness"
            value={
              packet.payload.explain?.releaseReadiness.status ||
              (packet.payload.readinessContract.allReady ? 'READY' : 'BLOCKED')
            }
            helper={
              packet.payload.explain?.summary.blockingState ||
              packet.payload.readinessContract.summary
            }
            tone={readinessTone(packet.payload.explain?.releaseReadiness.status)}
          />
          <StatTile
            label="Digest"
            value={compactHash(packet.digestSha256)}
            helper="Content-addressed internal packet reference"
            tone="info"
          />
        </div>
        <div className="mt-4">
          <AttestationChipBand
            verification={verification}
            loading={verificationLoading}
            onOpenDrawer={() => setIsVerifyDrawerOpen(true)}
          />
        </div>
        {packet.incidentLinks && packet.incidentLinks.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {packet.incidentLinks.map(link => (
              <IncidentLinkBadge
                key={`${link.incidentId}:${link.packetBundleId}`}
                link={link}
                compact
              />
            ))}
          </div>
        ) : null}
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <SectionCard
          title="Packet memo"
          description="A formatted evidence memo with the review scope, evidence counts, and operational status captured in this packet."
          icon={FileText}
        >
          <div className="rounded-2xl border border-outline-variant/40 bg-white px-5 py-4">
            <ArtifactPreview format="MARKDOWN" content={packetNarrative} maxLines={72} />
          </div>
        </SectionCard>

        <SectionCard
          title="Packet composition"
          description="What this packet contains, how much was captured, and which supporting systems were brought into the snapshot."
          icon={Sparkles}
        >
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
                <p className="form-kicker">Interaction feed</p>
                <p className="mt-2 text-lg font-bold text-on-surface">
                  {packet.payload.interactionFeed.summary.totalCount}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-secondary">
                  {packet.payload.interactionFeed.summary.chatCount} chat,{' '}
                  {packet.payload.interactionFeed.summary.toolCount} tool,{' '}
                  {packet.payload.interactionFeed.summary.approvalCount} approval
                </p>
              </div>
              <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
                <p className="form-kicker">Captured evidence</p>
                <p className="mt-2 text-lg font-bold text-on-surface">
                  {packet.payload.artifacts.length + packet.payload.tasks.length}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-secondary">
                  {packet.payload.artifacts.length} artifacts and {packet.payload.tasks.length} tasks
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
              <p className="workspace-meta-label">Connectors captured</p>
              {connectorCards.length === 0 ? (
                <p className="mt-2 text-sm leading-relaxed text-secondary">
                  No connector context was stored in this packet snapshot.
                </p>
              ) : (
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  {connectorCards.map(connector => (
                    <div
                      key={connector.key}
                      className="rounded-2xl border border-outline-variant/25 bg-surface-container-low px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-on-surface">{connector.label}</p>
                        <StatusBadge tone={connectorTone(connector.status)}>
                          {connector.status}
                        </StatusBadge>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-secondary">
                        {connector.message}
                      </p>
                      <p className="mt-2 text-[0.72rem] text-secondary">{connector.extra}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
              <p className="workspace-meta-label">Touched paths</p>
              {topTouchedPaths.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {topTouchedPaths.map(path => (
                    <StatusBadge key={path} tone="neutral">
                      {path}
                    </StatusBadge>
                  ))}
                  {hiddenTouchedPathCount > 0 ? (
                    <StatusBadge tone="info">+{hiddenTouchedPathCount} more</StatusBadge>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2 text-xs text-secondary">
                  No workspace file mutations were captured for this packet.
                </p>
              )}
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <SectionCard
          title="Work and run context"
          description="The delivery object under review, the most recent run, and the last execution steps and waits captured into the packet."
          icon={Workflow}
        >
          <div className="space-y-3">
            <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
              <p className="form-kicker">Work item</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                {packet.payload.workItem.title}
              </p>
              <p className="mt-2 text-xs text-secondary">
                {packet.workItemId} • {packet.payload.workItem.phase} •{' '}
                {packet.payload.workItem.status}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusBadge tone="neutral">
                  {getWorkItemTaskTypeLabel(packet.payload.workItem.taskType)}
                </StatusBadge>
                {packet.payload.latestRun ? (
                  <StatusBadge tone={runStatusTone(packet.payload.latestRun.status)}>
                    {packet.payload.latestRun.status}
                  </StatusBadge>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
              <p className="form-kicker">Run snapshot</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-secondary">Workflow</p>
                  <p className="mt-1 text-sm font-semibold text-on-surface">
                    {packet.payload.workflow?.name || 'Not captured'}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-secondary">Latest run</p>
                  <p className="mt-1 text-sm font-semibold text-on-surface">
                    {packet.payload.latestRun?.id || 'Not captured'}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-secondary">Run status</p>
                  <p className="mt-1 text-sm font-semibold text-on-surface">
                    {packet.payload.latestRun?.status || 'Not captured'}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-secondary">
                    Current phase
                  </p>
                  <p className="mt-1 text-sm font-semibold text-on-surface">
                    {packet.payload.latestRun?.currentPhase || packet.payload.workItem.phase}
                  </p>
                </div>
              </div>
            </div>

            {recentSteps.length > 0 ? (
              <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
                <p className="workspace-meta-label">Recent execution steps</p>
                <div className="mt-3 space-y-3">
                  {recentSteps.map(step => (
                    <div
                      key={step.id}
                      className="rounded-2xl border border-outline-variant/25 bg-surface-container-low px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-on-surface">{step.name}</p>
                        <StatusBadge tone={runStatusTone(step.status)}>{step.status}</StatusBadge>
                        <StatusBadge tone="neutral">{step.phase}</StatusBadge>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-secondary">
                        {step.outputSummary ||
                          step.evidenceSummary ||
                          'No step summary was captured for this execution step.'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {recentWaits.length > 0 ? (
              <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
                <p className="workspace-meta-label">Recent waits</p>
                <div className="mt-3 space-y-3">
                  {recentWaits.map(wait => (
                    <div
                      key={wait.id}
                      className="rounded-2xl border border-outline-variant/25 bg-surface-container-low px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone={wait.status === 'OPEN' ? 'warning' : 'success'}>
                          {wait.status}
                        </StatusBadge>
                        <StatusBadge tone="neutral">{wait.type}</StatusBadge>
                        <p className="text-sm font-semibold text-on-surface">{wait.message}</p>
                      </div>
                      <p className="mt-2 text-[0.72rem] text-secondary">
                        Requested by {wait.requestedBy} • {formatTimestamp(wait.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard
          title="Governance and decision context"
          description="Readiness gates, explain output, human approvals, and policy decisions captured alongside the packet."
          icon={ShieldCheck}
        >
          <div className="space-y-3">
            <div className="rounded-2xl border border-primary/15 bg-primary/5 px-4 py-4">
              <p className="form-kicker">Explain snapshot</p>
              <p className="mt-2 text-sm font-semibold text-primary">
                {packet.payload.explain?.summary.headline || 'Explain summary unavailable'}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-secondary">
                {packet.payload.explain?.summary.blockingState ||
                  packet.payload.readinessContract.summary}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {packet.payload.explain?.releaseReadiness ? (
                  <StatusBadge
                    tone={readinessTone(packet.payload.explain.releaseReadiness.status)}
                  >
                    {packet.payload.explain.releaseReadiness.status}
                  </StatusBadge>
                ) : null}
                {packet.payload.explain?.summary.nextAction ? (
                  <StatusBadge tone="info">
                    Next: {packet.payload.explain.summary.nextAction}
                  </StatusBadge>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
              <p className="workspace-meta-label">Readiness gates</p>
              <div className="mt-3 space-y-2">
                {packet.payload.readinessContract.gates.slice(0, 6).map(gate => (
                  <div
                    key={gate.id}
                    className="rounded-2xl border border-outline-variant/25 bg-surface-container-low px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-on-surface">{gate.label}</p>
                      <StatusBadge tone={gate.satisfied ? 'success' : 'warning'}>
                        {gate.satisfied ? 'Ready' : 'Blocked'}
                      </StatusBadge>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-secondary">
                      {gate.satisfied ? gate.summary : gate.blockingReason || gate.summary}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {humanGates.length > 0 ? (
              <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
                <p className="workspace-meta-label">Human gates</p>
                <div className="mt-3 space-y-3">
                  {humanGates.map(gate => (
                    <div
                      key={gate.waitId}
                      className="rounded-2xl border border-outline-variant/25 bg-surface-container-low px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone={gate.status === 'OPEN' ? 'warning' : 'success'}>
                          {gate.status}
                        </StatusBadge>
                        <StatusBadge tone="neutral">{gate.type}</StatusBadge>
                        <p className="text-sm font-semibold text-on-surface">{gate.message}</p>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-secondary">
                        Requested by {gate.requestedByName || gate.requestedBy}
                        {gate.resolvedByName ? ` • Resolved by ${gate.resolvedByName}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {policyDecisions.length > 0 ? (
              <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
                <p className="workspace-meta-label">Policy decisions</p>
                <div className="mt-3 space-y-3">
                  {policyDecisions.map(decision => (
                    <div
                      key={decision.id}
                      className="rounded-2xl border border-outline-variant/25 bg-surface-container-low px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge
                          tone={
                            decision.decision === 'ALLOW'
                              ? 'success'
                              : decision.decision === 'REQUIRE_APPROVAL'
                                ? 'warning'
                                : 'danger'
                          }
                        >
                          {decision.decision}
                        </StatusBadge>
                        <p className="text-sm font-semibold text-on-surface">
                          {decision.actionType}
                        </p>
                        {decision.toolInvocationId ? (
                          <code
                            className="rounded bg-white px-1.5 py-0.5 text-[10px] font-mono text-secondary"
                            title={`Tool invocation ${decision.toolInvocationId}`}
                          >
                            tool:{decision.toolInvocationId.slice(0, 8)}
                          </code>
                        ) : null}
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-secondary">
                        {decision.reason}
                      </p>
                      {decision.targetId ? (
                        <p className="mt-1 text-[11px] text-secondary/80">
                          <span className="font-semibold uppercase tracking-[0.12em] text-outline">
                            Target:{' '}
                          </span>
                          <code className="font-mono">{decision.targetId}</code>
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {recentToolInvocations.length > 0 ? (
              <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
                <p className="workspace-meta-label">Tool invocations</p>
                <div className="mt-3 space-y-3">
                  {recentToolInvocations.map(tool => (
                    <div
                      key={tool.id}
                      className="rounded-2xl border border-outline-variant/25 bg-surface-container-low px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-on-surface">{tool.toolId}</p>
                        <ToolInvocationPolicyBadge
                          toolInvocationId={tool.id}
                          policyDecisions={allPolicyDecisions}
                        />
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-secondary">
                        {tool.resultSummary || 'Tool invocation recorded.'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <SectionCard
          title="Capability briefing snapshot"
          description="A concise briefing digest frozen into the packet so review context stays stable even if the live capability changes later."
          icon={ShieldCheck}
        >
          <BriefingDigest
            briefing={packet.payload.capabilityBriefing}
            sections={briefingDigestSections}
          />
          {briefingSections.length > 0 ? (
            <div className="mt-4 space-y-3">
              {briefingSections.map(section => (
                <div
                  key={section.id}
                  className="rounded-2xl border border-outline-variant/25 bg-surface-container-low px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-on-surface">{section.label}</p>
                    {section.tone ? (
                      <StatusBadge tone={section.tone}>{section.tone}</StatusBadge>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-secondary">
                    {section.summary}
                  </p>
                  {section.items.length > 0 ? (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-relaxed text-secondary">
                      {section.items.slice(0, 4).map(item => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </SectionCard>

        <SectionCard
          title="Evidence history snapshot"
          description="Completed run history and human interaction evidence captured with this packet for later replay and audit."
          icon={Clock3}
        >
          {!packet.payload.evidence ? (
            <p className="text-sm leading-relaxed text-secondary">
              No completed-work evidence ledger snapshot was available when this packet was created.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
                  <p className="form-kicker">Run history</p>
                  <p className="mt-2 text-lg font-bold text-on-surface">
                    {packet.payload.evidence.runHistory.length}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-secondary">
                    Latest completed run:{' '}
                    {packet.payload.evidence.latestCompletedRun?.id || 'Not captured'}
                  </p>
                </div>
                <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
                  <p className="form-kicker">Human interactions</p>
                  <p className="mt-2 text-lg font-bold text-on-surface">
                    {packet.payload.evidence.humanInteractions.length}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-secondary">
                    Phase evidence groups: {packet.payload.evidence.phaseGroups.length}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
                <p className="workspace-meta-label">Phase groups</p>
                {packet.payload.evidence.phaseGroups.length === 0 ? (
                  <p className="mt-2 text-sm leading-relaxed text-secondary">
                    No grouped phase evidence was captured in this snapshot.
                  </p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {packet.payload.evidence.phaseGroups.slice(0, 5).map(group => (
                      <div
                        key={group.phase}
                        className="rounded-2xl border border-outline-variant/25 bg-surface-container-low px-4 py-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone="neutral">{group.phase}</StatusBadge>
                          <p className="text-sm font-semibold text-on-surface">
                            {group.stepName || group.label}
                          </p>
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-secondary">
                          {group.artifacts.length + group.handoffArtifacts.length} artifacts •{' '}
                          {group.interactions.length} interactions • {group.events.length} events
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <SectionCard
          title="Artifacts captured"
          description="A bounded, review-friendly artifact list so the evidence packet stays responsive while still showing the most relevant packet contents."
          icon={FileText}
        >
          {packetArtifacts.length === 0 ? (
            <p className="text-sm leading-relaxed text-secondary">
              No artifacts were captured in this packet snapshot.
            </p>
          ) : (
            <div className="space-y-3">
              {packetArtifacts.map(artifact => (
                <div
                  key={artifact.id}
                  className="rounded-2xl border border-outline-variant/30 bg-white px-4 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-on-surface">{artifact.name}</p>
                      <p className="mt-1 text-xs leading-relaxed text-secondary">
                        {artifact.summary ||
                          artifact.description ||
                          `${artifact.type} · ${artifact.version}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {artifact.artifactKind ? (
                        <StatusBadge tone={artifactTone(artifact)}>
                          {artifact.artifactKind}
                        </StatusBadge>
                      ) : null}
                      {artifact.direction ? (
                        <StatusBadge tone="neutral">{artifact.direction}</StatusBadge>
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-2 text-[0.72rem] text-secondary">
                    {formatTimestamp(artifact.created)}
                  </p>
                </div>
              ))}
              {hiddenArtifactCount > 0 ? (
                <p className="text-xs text-secondary">
                  {hiddenArtifactCount} more artifacts are stored in the packet but omitted from this
                  page view to keep it responsive.
                </p>
              ) : null}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Tasks and run highlights"
          description="Recent tasks and run events captured alongside the evidence so a reviewer can understand how the packet was produced."
          icon={ListChecks}
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-outline-variant/30 bg-white px-4 py-4">
              <p className="workspace-meta-label">Linked tasks</p>
              {packetTasks.length === 0 ? (
                <p className="mt-2 text-sm leading-relaxed text-secondary">
                  No agent tasks were included in this packet snapshot.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {packetTasks.map(task => (
                    <div
                      key={task.id}
                      className="rounded-2xl border border-outline-variant/25 bg-surface-container-low px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-on-surface">{task.title}</p>
                        <StatusBadge tone="neutral">{task.status}</StatusBadge>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-secondary">
                        {task.executionNotes || task.prompt || 'No task summary was captured.'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {hiddenTaskCount > 0 ? (
                <p className="mt-3 text-xs text-secondary">
                  {hiddenTaskCount} additional tasks are stored in the packet but not rendered here.
                </p>
              ) : null}
            </div>

            <div className="rounded-2xl border border-outline-variant/30 bg-white px-4 py-4">
              <div className="flex items-center gap-2">
                <GitBranch size={16} className="text-secondary" />
                <p className="workspace-meta-label">Recent run events</p>
              </div>
              {packetRunEvents.length === 0 ? (
                <p className="mt-2 text-sm leading-relaxed text-secondary">
                  No run events were captured in this packet snapshot.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {packetRunEvents.map(event => (
                    <div
                      key={event.id}
                      className="rounded-2xl border border-outline-variant/25 bg-surface-container-low px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-on-surface">{event.type}</p>
                        <StatusBadge tone={eventTone(event.level)}>{event.level}</StatusBadge>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-secondary">
                        {event.message}
                      </p>
                      <p className="mt-2 text-[0.72rem] text-secondary">
                        {formatTimestamp(event.timestamp)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {hiddenRunEventCount > 0 ? (
                <p className="mt-3 text-xs text-secondary">
                  {hiddenRunEventCount} additional run events are stored in the packet but not
                  rendered here.
                </p>
              ) : null}
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Incident links"
        description="Any incidents correlated to this packet, along with the reasons captured when the packet was linked."
        icon={AlertTriangle}
      >
        {packet.incidentLinks && packet.incidentLinks.length > 0 ? (
          <div className="space-y-3">
            {packet.incidentLinks.map(link => (
              <button
                key={`${link.incidentId}:${link.packetBundleId}`}
                type="button"
                onClick={() =>
                  navigate(`/incidents?incidentId=${encodeURIComponent(link.incidentId)}`)
                }
                className="w-full rounded-2xl border border-outline-variant/30 bg-white px-4 py-3 text-left transition hover:border-primary/30"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <IncidentLinkBadge link={link} compact />
                  <p className="text-sm font-semibold text-on-surface">{link.incidentId}</p>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-secondary">
                  {link.correlationReasons.join(' ') || 'No correlation notes recorded yet.'}
                </p>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-secondary">
            This packet has not been linked to an incident yet.
          </p>
        )}
      </SectionCard>

      <InteractionTimeline
        feed={packet.payload.interactionFeed}
        maxItems={10}
        title="Packet timeline"
        emptyMessage="No interaction history was captured into this packet."
        onOpenArtifact={artifactId =>
          navigate(`/ledger${artifactId ? `?artifactId=${encodeURIComponent(artifactId)}` : ''}`)
        }
        onOpenRun={runId =>
          navigate(`/run-console${runId ? `?runId=${encodeURIComponent(runId)}` : ''}`)
        }
        onOpenTask={taskId =>
          navigate(`/tasks${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''}`)
        }
      />

      <LinkIncidentDialog
        capabilityId={packet.capabilityId}
        packetBundleId={packet.bundleId}
        open={isIncidentDialogOpen}
        onClose={() => setIsIncidentDialogOpen(false)}
        onLinked={() => {
          void loadPacket();
        }}
      />

      <AttestationVerifyDrawer
        open={isVerifyDrawerOpen}
        onClose={() => setIsVerifyDrawerOpen(false)}
        verification={verification}
        chain={attestationChain}
        chainLoading={chainLoading}
        verificationLoading={verificationLoading}
        onRefresh={() => {
          setAttestationChain(null);
          void loadVerification();
        }}
      />
    </div>
  );
};

export default EvidencePacketPage;
