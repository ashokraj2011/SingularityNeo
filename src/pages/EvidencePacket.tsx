import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, FileText, Link2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import IncidentLinkBadge from '../components/IncidentLinkBadge';
import InteractionTimeline from '../components/InteractionTimeline';
import LinkIncidentDialog from '../components/LinkIncidentDialog';
import { EmptyState, PageHeader, SectionCard, StatusBadge } from '../components/EnterpriseUI';
import { useToast } from '../context/ToastContext';
import { fetchEvidencePacket } from '../lib/api';
import type { EvidencePacket } from '../types';

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

const EvidencePacketPage = () => {
  const navigate = useNavigate();
  const { bundleId = '' } = useParams();
  const { error: showError } = useToast();
  const [packet, setPacket] = useState<EvidencePacket | null>(null);
  const [loading, setLoading] = useState(true);
  const [isIncidentDialogOpen, setIsIncidentDialogOpen] = useState(false);

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
  }, [bundleId]);

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
        <div className="grid max-w-5xl gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4">
            <p className="form-kicker">Generated</p>
            <p className="mt-2 text-sm font-semibold text-on-surface">
              {formatTimestamp(packet.createdAt)}
            </p>
            <p className="mt-2 text-xs text-secondary">{packet.generatedBy}</p>
          </div>
          <div className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4">
            <p className="form-kicker">Readiness</p>
            <div className="mt-2 flex items-center gap-2">
              <StatusBadge
                tone={packet.payload.readinessContract.allReady ? 'success' : 'warning'}
              >
                {packet.payload.readinessContract.allReady ? 'All gates green' : 'Blocked'}
              </StatusBadge>
            </div>
            <p className="mt-2 text-xs text-secondary">
              {packet.payload.readinessContract.summary}
            </p>
          </div>
          <div className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4">
            <p className="form-kicker">Digest</p>
            <p className="mt-2 text-sm font-semibold text-on-surface">
              {packet.digestSha256.slice(0, 16)}...
            </p>
            <p className="mt-2 text-xs text-secondary">
              Content-addressed internal packet permalink
            </p>
            {packet.incidentLinks && packet.incidentLinks.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {packet.incidentLinks.map(link => (
                  <IncidentLinkBadge key={`${link.incidentId}:${link.packetBundleId}`} link={link} compact />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <SectionCard
          title="Capability briefing"
          description="The briefing snapshot frozen into this packet."
          icon={ShieldCheck}
        >
          <div className="space-y-3">
            <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
              <p className="text-sm font-semibold text-on-surface">
                {packet.payload.capabilityBriefing.title}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-secondary">
                {packet.payload.capabilityBriefing.purpose || packet.payload.capabilityBriefing.outcome}
              </p>
            </div>
            <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
              <p className="workspace-meta-label">Readiness gates</p>
              <div className="mt-3 space-y-2">
                {packet.payload.readinessContract.gates.map(gate => (
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
          </div>
        </SectionCard>

        <SectionCard
          title="Packet scope"
          description="The specific work item, run, evidence, and task projection captured in this packet."
          icon={FileText}
        >
          <div className="space-y-3">
            <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
              <p className="form-kicker">Work item</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                {packet.payload.workItem.title}
              </p>
              <p className="mt-2 text-xs text-secondary">
                {packet.workItemId} • {packet.payload.workItem.phase} • {packet.payload.workItem.status}
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
                <p className="form-kicker">Artifacts</p>
                <p className="mt-2 text-lg font-bold text-on-surface">
                  {packet.payload.artifacts.length}
                </p>
              </div>
              <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
                <p className="form-kicker">Tasks</p>
                <p className="mt-2 text-lg font-bold text-on-surface">
                  {packet.payload.tasks.length}
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
              <p className="form-kicker">Touched paths</p>
              {packet.touchedPaths && packet.touchedPaths.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {packet.touchedPaths.slice(0, 10).map(path => (
                    <StatusBadge key={path} tone="neutral">
                      {path}
                    </StatusBadge>
                  ))}
                  {packet.touchedPaths.length > 10 ? (
                    <StatusBadge tone="info">+{packet.touchedPaths.length - 10} more</StatusBadge>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2 text-xs text-secondary">
                  No workspace file mutations were captured for this packet.
                </p>
              )}
            </div>
            <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-danger" />
                <p className="form-kicker">Incident links</p>
              </div>
              {packet.incidentLinks && packet.incidentLinks.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {packet.incidentLinks.map(link => (
                    <button
                      key={`${link.incidentId}:${link.packetBundleId}`}
                      type="button"
                      onClick={() => navigate(`/incidents?incidentId=${encodeURIComponent(link.incidentId)}`)}
                      className="w-full rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-3 text-left transition hover:border-primary/30"
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
                <p className="mt-2 text-xs text-secondary">
                  This packet has not been linked to an incident yet.
                </p>
              )}
            </div>
            {packet.payload.explain ? (
              <div className="rounded-2xl border border-primary/15 bg-primary/5 px-4 py-4">
                <p className="form-kicker">Explain snapshot</p>
                <p className="mt-2 text-sm font-semibold text-primary">
                  {packet.payload.explain.summary.headline}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-secondary">
                  {packet.payload.explain.summary.blockingState}
                </p>
              </div>
            ) : null}
          </div>
        </SectionCard>
      </div>

      <InteractionTimeline
        feed={packet.payload.interactionFeed}
        maxItems={20}
        title="Packet timeline"
        emptyMessage="No interaction history was captured into this packet."
        onOpenArtifact={() => navigate('/ledger')}
        onOpenRun={() => navigate('/run-console')}
        onOpenTask={() => navigate('/tasks')}
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
    </div>
  );
};

export default EvidencePacketPage;
