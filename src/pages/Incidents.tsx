import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Copy,
  GitBranch,
  Link2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import IncidentLinkBadge from '../components/IncidentLinkBadge';
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from '../components/EnterpriseUI';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import { hasPermission } from '../lib/accessControl';
import {
  correlateIncidentPackets,
  createIncidentRecord,
  deleteIncidentPacketLink,
  exportIncidentToTarget,
  fetchIncident,
  fetchIncidentPostmortemMarkdown,
  fetchIncidentAlibiMarkdown,
  listIncidentExportDeliveries,
  listIncidentExportTargetConfigs,
  listIncidentServiceCapabilityMaps,
  listIncidentSourceConfigs,
  listIncidents,
  requestIncidentGuardrailPromotion,
  updateIncidentExportTargetConfig,
  updateIncidentPacketLink,
  updateIncidentServiceCapabilityMap,
  updateIncidentSourceConfig,
} from '../lib/api';
import type {
  CapabilityIncident,
  IncidentCorrelationCandidate,
  IncidentExportDelivery,
  IncidentExportTarget,
  IncidentExportTargetConfig,
  IncidentServiceCapabilityMap,
  IncidentSource,
  IncidentSourceConfig,
} from '../types';

const severityOptions = ['SEV1', 'SEV2', 'SEV3', 'SEV4'] as const;
const sourceOptions: IncidentSource[] = ['pagerduty', 'servicenow', 'incident-io'];
const exportTargetOptions: IncidentExportTarget[] = ['datadog', 'servicenow'];

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

const Incidents = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeCapability, currentActorContext } = useCapability();
  const { success, error: showError } = useToast();
  const [incidents, setIncidents] = useState<CapabilityIncident[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<CapabilityIncident | null>(null);
  const [candidateResults, setCandidateResults] = useState<IncidentCorrelationCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sources, setSources] = useState<IncidentSourceConfig[]>([]);
  const [serviceMaps, setServiceMaps] = useState<IncidentServiceCapabilityMap[]>([]);
  const [exportConfigs, setExportConfigs] = useState<IncidentExportTargetConfig[]>([]);
  const [exportDeliveries, setExportDeliveries] = useState<IncidentExportDelivery[]>([]);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftSeverity, setDraftSeverity] = useState<(typeof severityOptions)[number]>('SEV2');
  const [draftSummary, setDraftSummary] = useState('');
  const [draftServiceName, setDraftServiceName] = useState('');
  const [draftAffectedPaths, setDraftAffectedPaths] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const canRead = hasPermission(activeCapability.effectivePermissions, 'capability.read');
  const canEdit = hasPermission(activeCapability.effectivePermissions, 'capability.edit');
  const canManageWorkspace = Boolean(
    currentActorContext.workspaceRoles?.includes('WORKSPACE_ADMIN'),
  );
  const isIncidentCommander = Boolean(
    currentActorContext.workspaceRoles?.includes('INCIDENT_COMMANDER') ||
      currentActorContext.workspaceRoles?.includes('WORKSPACE_ADMIN'),
  );

  const selectedIncidentId = searchParams.get('incidentId') || '';

  const loadIncidents = async (preferredIncidentId?: string) => {
    if (!activeCapability.id || !canRead) {
      setIncidents([]);
      setSelectedIncident(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [nextIncidents, nextSources, nextServiceMaps, nextExportConfigs] = await Promise.all([
        listIncidents({ capabilityId: activeCapability.id }),
        canManageWorkspace ? listIncidentSourceConfigs() : Promise.resolve([]),
        canManageWorkspace ? listIncidentServiceCapabilityMaps() : Promise.resolve([]),
        canManageWorkspace ? listIncidentExportTargetConfigs() : Promise.resolve([]),
      ]);
      setIncidents(nextIncidents);
      setSources(nextSources);
      setServiceMaps(nextServiceMaps);
      setExportConfigs(nextExportConfigs);

      const incidentId = preferredIncidentId || selectedIncidentId || nextIncidents[0]?.id || '';
      if (incidentId) {
        const [detail, deliveries] = await Promise.all([
          fetchIncident(incidentId),
          listIncidentExportDeliveries({ incidentId, limit: 12 }),
        ]);
        setSelectedIncident(detail);
        setExportDeliveries(deliveries);
        setSearchParams(detail.id ? { incidentId: detail.id } : {});
      } else {
        setSelectedIncident(null);
        setExportDeliveries([]);
      }
    } catch (error) {
      showError(
        'Unable to load incidents',
        error instanceof Error ? error.message : 'Unable to load incidents.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadIncidents();
  }, [activeCapability.id]);

  const filteredIncidents = useMemo(() => {
    const query = selectedIncidentId.toLowerCase();
    if (!query) {
      return incidents;
    }
    return incidents.filter(
      incident =>
        incident.id.toLowerCase().includes(query) ||
        incident.title.toLowerCase().includes(query),
    );
  }, [incidents, selectedIncidentId]);

  const refreshSelectedIncident = async (incidentId = selectedIncident?.id) => {
    if (!incidentId) {
      return;
    }
    setIsRefreshing(true);
    try {
      const [detail, deliveries] = await Promise.all([
        fetchIncident(incidentId),
        listIncidentExportDeliveries({ incidentId, limit: 12 }),
      ]);
      setSelectedIncident(detail);
      setExportDeliveries(deliveries);
      setIncidents(current =>
        current.map(incident => (incident.id === detail.id ? detail : incident)),
      );
    } catch (error) {
      showError(
        'Unable to refresh incident',
        error instanceof Error ? error.message : 'Unable to refresh incident.',
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCreateIncident = async () => {
    if (!draftTitle.trim()) {
      showError('Add an incident title', 'Incident title is required.');
      return;
    }
    setIsSaving(true);
    try {
      const incident = await createIncidentRecord({
        capabilityId: activeCapability.id,
        title: draftTitle.trim(),
        severity: draftSeverity,
        summary: draftSummary.trim() || undefined,
        affectedServices: draftServiceName.trim() ? [draftServiceName.trim()] : undefined,
        affectedPaths: draftAffectedPaths
          .split(',')
          .map(item => item.trim())
          .filter(Boolean),
      });
      setDraftTitle('');
      setDraftSummary('');
      setDraftServiceName('');
      setDraftAffectedPaths('');
      success('Incident created', `${incident.title} is ready for packet attribution.`);
      await loadIncidents(incident.id);
    } catch (error) {
      showError(
        'Unable to create incident',
        error instanceof Error ? error.message : 'Unable to create incident.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleCorrelate = async () => {
    if (!selectedIncident) {
      return;
    }
    setIsRefreshing(true);
    try {
      const result = await correlateIncidentPackets(selectedIncident.id);
      setCandidateResults(result.candidates);
      await refreshSelectedIncident(selectedIncident.id);
      success(
        'Candidate packets ready',
        `${result.candidates.length} candidate packets were ranked for review.`,
      );
    } catch (error) {
      showError(
        'Unable to correlate incident',
        error instanceof Error ? error.message : 'Unable to correlate incident.',
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleLinkDisposition = async (
    bundleId: string,
    correlation: 'CONFIRMED' | 'SUSPECTED' | 'BLAST_RADIUS' | 'DISMISSED',
    correlationReasons: string[],
  ) => {
    if (!selectedIncident) {
      return;
    }
    setIsRefreshing(true);
    try {
      await updateIncidentPacketLink(selectedIncident.id, bundleId, {
        correlation,
        correlationReasons,
      });
      await refreshSelectedIncident(selectedIncident.id);
      success('Incident link updated', `Packet ${bundleId} is now marked ${correlation}.`);
    } catch (error) {
      showError(
        'Unable to update incident link',
        error instanceof Error ? error.message : 'Unable to update incident link.',
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDeleteLink = async (bundleId: string) => {
    if (!selectedIncident) {
      return;
    }
    setIsRefreshing(true);
    try {
      await deleteIncidentPacketLink(selectedIncident.id, bundleId);
      await refreshSelectedIncident(selectedIncident.id);
      success('Incident link removed', `Packet ${bundleId} is no longer attached to the incident.`);
    } catch (error) {
      showError(
        'Unable to remove incident link',
        error instanceof Error ? error.message : 'Unable to remove incident link.',
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCopyMarkdown = async () => {
    if (!selectedIncident) {
      return;
    }
    try {
      const markdown = await fetchIncidentPostmortemMarkdown(selectedIncident.id);
      await navigator.clipboard.writeText(markdown);
      success('Post-mortem copied', 'The AI attribution section is now in your clipboard.');
    } catch (error) {
      showError(
        'Unable to copy attribution',
        error instanceof Error ? error.message : 'Unable to export attribution markdown.',
      );
    }
  };

  const handleCopyAlibiMarkdown = async () => {
    if (!selectedIncident) {
      return;
    }
    try {
      const markdown = await fetchIncidentAlibiMarkdown(selectedIncident.id);
      await navigator.clipboard.writeText(markdown);
      success('Alibi report copied', 'The Proof of Innocence report is now in your clipboard.');
    } catch (error) {
      showError(
        'Unable to copy alibi report',
        error instanceof Error ? error.message : 'Unable to export alibi markdown.',
      );
    }
  };

  const handlePromotion = async (bundleId: string, concernText: string) => {
    if (!selectedIncident) {
      return;
    }
    try {
      await requestIncidentGuardrailPromotion(selectedIncident.id, bundleId, concernText);
      success(
        'Guardrail promotion requested',
        'The incident-derived concern now has a durable approval request.',
      );
    } catch (error) {
      showError(
        'Unable to request guardrail promotion',
        error instanceof Error ? error.message : 'Unable to request guardrail promotion.',
      );
    }
  };

  const handleQueueIncidentExport = async (target: IncidentExportTarget) => {
    if (!selectedIncident) {
      return;
    }
    try {
      await exportIncidentToTarget(selectedIncident.id, target);
      success(
        'Incident export queued',
        `${target} will receive the latest attribution packet shortly.`,
      );
      await refreshSelectedIncident(selectedIncident.id);
    } catch (error) {
      showError(
        `Unable to export to ${target}`,
        error instanceof Error ? error.message : `Unable to export to ${target}.`,
      );
    }
  };

  const handleSaveSourceConfig = async (source: IncidentSource, config: IncidentSourceConfig) => {
    try {
      const updated = await updateIncidentSourceConfig(source, config);
      setSources(current => current.map(item => (item.source === source ? updated : item)));
      success('Source config saved', `${source} webhook settings were updated.`);
    } catch (error) {
      showError(
        'Unable to save source config',
        error instanceof Error ? error.message : 'Unable to save source config.',
      );
    }
  };

  const handleSaveExportConfig = async (
    target: IncidentExportTarget,
    config: IncidentExportTargetConfig,
  ) => {
    try {
      const updated = await updateIncidentExportTargetConfig(target, config);
      setExportConfigs(current => {
        const next = current.filter(item => item.target !== target);
        return [...next, updated].sort((left, right) => left.target.localeCompare(right.target));
      });
      success('Export connector saved', `${target} export settings are now ready to use.`);
    } catch (error) {
      showError(
        'Unable to save export connector',
        error instanceof Error ? error.message : 'Unable to save export connector.',
      );
    }
  };

  const handleSaveServiceMap = async (mapping: IncidentServiceCapabilityMap) => {
    try {
      const updated = await updateIncidentServiceCapabilityMap(mapping.serviceName, {
        capabilityId: mapping.capabilityId,
        defaultAffectedPaths: mapping.defaultAffectedPaths,
        ownerEmail: mapping.ownerEmail,
      });
      setServiceMaps(current => {
        const next = current.filter(item => item.serviceName !== updated.serviceName);
        return [...next, updated].sort((left, right) => left.serviceName.localeCompare(right.serviceName));
      });
      success('Service map saved', `${updated.serviceName} now routes into ${updated.capabilityId}.`);
    } catch (error) {
      showError(
        'Unable to save service map',
        error instanceof Error ? error.message : 'Unable to save service map.',
      );
    }
  };

  if (!canRead) {
    return (
      <EmptyState
        title="Incident workspace unavailable"
        description="This operator does not have capability visibility for incident attribution."
        icon={AlertTriangle}
        className="min-h-[24rem]"
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Incident Attribution"
        context={activeCapability.id}
        title="Incidents"
        description="Review incident-linked evidence packets, correlation candidates, post-mortem attribution, and the service mappings behind webhook routing."
        actions={
          <>
            <button
              type="button"
              onClick={() => void loadIncidents(selectedIncident?.id)}
              className="enterprise-button enterprise-button-secondary"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
            {selectedIncident ? (
              <button
                type="button"
                onClick={() => void handleCopyMarkdown()}
                className="enterprise-button enterprise-button-secondary"
              >
                <Copy size={16} />
                Copy post-mortem
              </button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <SectionCard
          title="Incident inbox"
          description="Create manual incidents, then select one to review attribution links and correlation candidates."
          icon={AlertTriangle}
        >
          <div className="space-y-4">
            {canEdit ? (
              <div className="rounded-[1.75rem] border border-outline-variant/35 bg-surface-container-low/30 p-4">
                <p className="form-kicker">Create manual incident</p>
                <input
                  value={draftTitle}
                  onChange={event => setDraftTitle(event.target.value)}
                  className="input-field mt-3"
                  placeholder="Production incident title"
                />
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <select
                    value={draftSeverity}
                    onChange={event =>
                      setDraftSeverity(event.target.value as (typeof severityOptions)[number])
                    }
                    className="input-field"
                  >
                    {severityOptions.map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <input
                    value={draftServiceName}
                    onChange={event => setDraftServiceName(event.target.value)}
                    className="input-field"
                    placeholder="Affected service"
                  />
                </div>
                <textarea
                  value={draftSummary}
                  onChange={event => setDraftSummary(event.target.value)}
                  className="input-field mt-3 min-h-[6rem]"
                  placeholder="Summary for post-mortem context"
                />
                <input
                  value={draftAffectedPaths}
                  onChange={event => setDraftAffectedPaths(event.target.value)}
                  className="input-field mt-3"
                  placeholder="Affected path globs, comma separated"
                />
                <button
                  type="button"
                  onClick={() => void handleCreateIncident()}
                  disabled={isSaving}
                  className="enterprise-button enterprise-button-primary mt-3"
                >
                  Create incident
                </button>
              </div>
            ) : null}

            <div className="rounded-[1.75rem] border border-outline-variant/35 bg-white p-3">
              <div className="flex items-center gap-2 px-2 text-secondary">
                <Search size={15} />
                <p className="text-sm font-medium">Recent incidents</p>
              </div>
              {isLoading ? (
                <p className="px-2 py-6 text-sm text-secondary">Loading incidents…</p>
              ) : filteredIncidents.length === 0 ? (
                <p className="px-2 py-6 text-sm text-secondary">
                  No incidents are recorded for this capability yet.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {filteredIncidents.map(incident => (
                    <button
                      key={incident.id}
                      type="button"
                      onClick={() => {
                        setSelectedIncident(incident);
                        setSearchParams({ incidentId: incident.id });
                        void refreshSelectedIncident(incident.id);
                      }}
                      className={`w-full rounded-[1.5rem] border px-4 py-4 text-left transition ${
                        selectedIncident?.id === incident.id
                          ? 'border-primary/30 bg-primary/5'
                          : 'border-outline-variant/35 bg-surface-container-low/20 hover:border-primary/20'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone={incident.severity === 'SEV1' ? 'danger' : 'warning'}>
                          {incident.severity}
                        </StatusBadge>
                        <StatusBadge tone="neutral">{incident.status}</StatusBadge>
                      </div>
                      <p className="mt-3 text-sm font-semibold text-on-surface">{incident.title}</p>
                      <p className="mt-2 text-xs text-secondary">
                        {incident.id} · {formatTimestamp(incident.detectedAt)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title={selectedIncident ? selectedIncident.title : 'Incident detail'}
          description="Run correlation, review candidate packets, confirm contributors, and prepare post-mortem output."
          icon={Sparkles}
        >
          {!selectedIncident ? (
            <EmptyState
              title="Select an incident"
              description="Choose an incident from the inbox to review linked packets and correlation candidates."
              icon={AlertTriangle}
              className="min-h-[20rem]"
            />
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4 rounded-[1.75rem] border border-outline-variant/35 bg-white p-5">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={selectedIncident.severity === 'SEV1' ? 'danger' : 'warning'}>
                      {selectedIncident.severity}
                    </StatusBadge>
                    <StatusBadge tone="neutral">{selectedIncident.status}</StatusBadge>
                  </div>
                  <p className="mt-3 text-xl font-semibold text-on-surface">
                    {selectedIncident.title}
                  </p>
                  <p className="mt-2 text-sm text-secondary">
                    {selectedIncident.id} · detected {formatTimestamp(selectedIncident.detectedAt)}
                  </p>
                  {selectedIncident.summary ? (
                    <p className="mt-3 text-sm leading-relaxed text-secondary">
                      {selectedIncident.summary}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => void handleCorrelate()}
                      disabled={isRefreshing}
                      className="enterprise-button enterprise-button-primary"
                    >
                      <Sparkles size={16} />
                      Find AI contributions
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleCopyMarkdown()}
                    className="enterprise-button enterprise-button-secondary"
                  >
                    <Copy size={16} />
                    Copy AI attribution
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopyAlibiMarkdown()}
                    className="enterprise-button enterprise-button-secondary"
                  >
                    <ShieldCheck size={16} />
                    Generate Alibi Report
                  </button>
                  {canEdit ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleQueueIncidentExport('datadog')}
                        className="enterprise-button enterprise-button-secondary"
                      >
                        Export to Datadog
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleQueueIncidentExport('servicenow')}
                        className="enterprise-button enterprise-button-secondary"
                      >
                        Export to ServiceNow
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-[1.75rem] border border-outline-variant/35 bg-surface-container-low/25 p-4">
                  <p className="form-kicker">Affected services</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(selectedIncident.affectedServices.length > 0
                      ? selectedIncident.affectedServices
                      : ['No service scope recorded yet']).map(item => (
                      <StatusBadge key={item} tone="neutral">
                        {item}
                      </StatusBadge>
                    ))}
                  </div>
                </div>
                <div className="rounded-[1.75rem] border border-outline-variant/35 bg-surface-container-low/25 p-4">
                  <p className="form-kicker">Affected paths</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(selectedIncident.affectedPaths.length > 0
                      ? selectedIncident.affectedPaths
                      : ['No path scope recorded yet']).map(item => (
                      <StatusBadge key={item} tone="neutral">
                        {item}
                      </StatusBadge>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-[1.75rem] border border-outline-variant/35 bg-white p-5">
                <div className="flex items-center gap-2">
                  <Link2 size={16} className="text-primary" />
                  <p className="text-lg font-semibold text-on-surface">Linked packets</p>
                </div>
                {selectedIncident.linkedPackets.length === 0 ? (
                  <p className="mt-3 text-sm text-secondary">
                    No evidence packets are linked yet. Run correlation or link a packet from the packet page.
                  </p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {selectedIncident.linkedPackets.map(link => (
                      <div
                        key={`${link.incidentId}:${link.packetBundleId}`}
                        className="rounded-[1.5rem] border border-outline-variant/30 bg-surface-container-low/25 p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <IncidentLinkBadge link={link} />
                              <button
                                type="button"
                                onClick={() => navigate(`/e/${encodeURIComponent(link.packetBundleId)}`)}
                                className="text-sm font-semibold text-primary transition hover:underline"
                              >
                                {link.packetTitle || link.packetBundleId}
                              </button>
                            </div>
                            <p className="mt-2 text-xs leading-relaxed text-secondary">
                              {link.correlationReasons.join(' ') || 'No correlation reasons recorded yet.'}
                            </p>
                          </div>
                          {canEdit ? (
                            <div className="flex flex-wrap gap-2">
                              {isIncidentCommander ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleLinkDisposition(
                                        link.packetBundleId,
                                        'CONFIRMED',
                                        link.correlationReasons.length > 0
                                          ? link.correlationReasons
                                          : ['Marked as a confirmed incident contributor by the incident commander.'],
                                      )
                                    }
                                    className="enterprise-button enterprise-button-secondary"
                                  >
                                    Confirm
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleLinkDisposition(
                                        link.packetBundleId,
                                        'BLAST_RADIUS',
                                        ['Marked as blast radius rather than a confirmed contributor.'],
                                      )
                                    }
                                    className="enterprise-button enterprise-button-secondary"
                                  >
                                    Blast radius
                                  </button>
                                </>
                              ) : null}
                              <button
                                type="button"
                                onClick={() =>
                                  void handleLinkDisposition(
                                    link.packetBundleId,
                                    'DISMISSED',
                                    ['Dismissed during incident review.'],
                                  )
                                }
                                className="enterprise-button enterprise-button-secondary"
                              >
                                Dismiss
                              </button>
                              {isIncidentCommander ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handlePromotion(
                                      link.packetBundleId,
                                      link.correlationReasons[0] || 'Promote the reviewer concern into a hard guardrail.',
                                    )
                                  }
                                  className="enterprise-button enterprise-button-secondary"
                                >
                                  <ShieldCheck size={14} />
                                  Promote guardrail
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => void handleDeleteLink(link.packetBundleId)}
                                className="enterprise-button enterprise-button-secondary"
                              >
                                Remove
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-[1.75rem] border border-outline-variant/35 bg-white p-5">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={16} className="text-primary" />
                  <p className="text-lg font-semibold text-on-surface">Recent exports</p>
                </div>
                {exportDeliveries.length === 0 ? (
                  <p className="mt-3 text-sm text-secondary">
                    No outbound exports have been queued for this incident yet.
                  </p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {exportDeliveries.map(delivery => (
                      <div
                        key={delivery.id}
                        className="rounded-[1.5rem] border border-outline-variant/30 bg-surface-container-low/25 p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge
                                tone={
                                  delivery.status === 'DELIVERED'
                                    ? 'success'
                                    : delivery.status === 'FAILED'
                                      ? 'danger'
                                      : 'warning'
                                }
                              >
                                {delivery.status}
                              </StatusBadge>
                              <StatusBadge tone="neutral">{delivery.target}</StatusBadge>
                            </div>
                            <p className="mt-2 text-xs text-secondary">
                              {formatTimestamp(delivery.exportedAt || delivery.createdAt)}
                              {delivery.externalReference
                                ? ` · external ref ${delivery.externalReference}`
                                : ''}
                            </p>
                            {delivery.responsePreview ? (
                              <p className="mt-2 text-xs text-secondary">{delivery.responsePreview}</p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-[1.75rem] border border-outline-variant/35 bg-white p-5">
                <div className="flex items-center gap-2">
                  <GitBranch size={16} className="text-primary" />
                  <p className="text-lg font-semibold text-on-surface">Correlation candidates</p>
                </div>
                {candidateResults.length === 0 ? (
                  <p className="mt-3 text-sm text-secondary">
                    Run correlation to rank recent evidence packets that overlap this incident’s scope.
                  </p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {candidateResults.map(candidate => (
                      <div
                        key={candidate.packet.bundleId}
                        className="rounded-[1.5rem] border border-outline-variant/30 bg-surface-container-low/25 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge tone={candidate.score >= 0.75 ? 'danger' : 'warning'}>
                                {(candidate.score * 100).toFixed(1)}%
                              </StatusBadge>
                              <button
                                type="button"
                                onClick={() =>
                                  navigate(`/e/${encodeURIComponent(candidate.packet.bundleId)}`)
                                }
                                className="text-sm font-semibold text-primary transition hover:underline"
                              >
                                {candidate.packet.title}
                              </button>
                            </div>
                            <p className="mt-2 text-xs text-secondary">
                              {candidate.matchedPaths.join(', ') || 'No direct path matches recorded.'}
                            </p>
                            <ul className="mt-3 space-y-1 text-xs text-secondary">
                              {candidate.reasons.map(reason => (
                                <li key={reason}>• {reason}</li>
                              ))}
                            </ul>
                          </div>
                          {canEdit ? (
                            <div className="flex flex-wrap gap-2">
                              {isIncidentCommander ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleLinkDisposition(
                                      candidate.packet.bundleId,
                                      'CONFIRMED',
                                      candidate.reasons,
                                    )
                                  }
                                  className="enterprise-button enterprise-button-secondary"
                                >
                                  Confirm
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() =>
                                  void handleLinkDisposition(
                                    candidate.packet.bundleId,
                                    'SUSPECTED',
                                    candidate.reasons,
                                  )
                                }
                                className="enterprise-button enterprise-button-secondary"
                              >
                                Mark suspected
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void handleLinkDisposition(
                                    candidate.packet.bundleId,
                                    'DISMISSED',
                                    ['Dismissed after correlation review.'],
                                  )
                                }
                                className="enterprise-button enterprise-button-secondary"
                              >
                                Dismiss
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      {canManageWorkspace ? (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-2">
          <SectionCard
            title="Incident source config"
            description="Provider secrets and rate limits stay isolated from the normal connector settings."
            icon={ShieldCheck}
          >
            <div className="space-y-4">
              {sourceOptions.map(source => {
                const config =
                  sources.find(item => item.source === source) || {
                    source,
                    enabled: false,
                    authType: 'HMAC_SHA256' as const,
                    rateLimitPerMinute: 60,
                    settings: {},
                  };
                return (
                  <div
                    key={source}
                    className="rounded-[1.5rem] border border-outline-variant/30 bg-white p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-on-surface">{source}</p>
                      <label className="inline-flex items-center gap-2 text-xs text-secondary">
                        <input
                          type="checkbox"
                          checked={config.enabled}
                          onChange={event =>
                            setSources(current => {
                              const next = current.filter(item => item.source !== source);
                              return [
                                ...next,
                                { ...config, enabled: event.target.checked },
                              ];
                            })
                          }
                        />
                        Enabled
                      </label>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <input
                        value={config.secretReference || ''}
                        onChange={event =>
                          setSources(current => {
                            const next = current.filter(item => item.source !== source);
                            return [
                              ...next,
                              { ...config, secretReference: event.target.value },
                            ];
                          })
                        }
                        className="input-field"
                        placeholder="Secret reference"
                      />
                      <input
                        value={String(config.rateLimitPerMinute || 60)}
                        onChange={event =>
                          setSources(current => {
                            const next = current.filter(item => item.source !== source);
                            return [
                              ...next,
                              {
                                ...config,
                                rateLimitPerMinute: Number(event.target.value || 60),
                              },
                            ];
                          })
                        }
                        className="input-field"
                        placeholder="Rate limit / minute"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSaveSourceConfig(source, config)}
                      className="enterprise-button enterprise-button-secondary mt-3"
                    >
                      Save source config
                    </button>
                  </div>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard
            title="Service to capability map"
            description="Map external service names to capability scope and default affected path globs."
            icon={GitBranch}
          >
            <div className="space-y-4">
              {[...serviceMaps, { serviceName: '', capabilityId: activeCapability.id, defaultAffectedPaths: [], ownerEmail: '' }].map(
                (mapping, index) => (
                  <div
                    key={`${mapping.serviceName || 'new'}-${index}`}
                    className="rounded-[1.5rem] border border-outline-variant/30 bg-white p-4"
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      <input
                        value={mapping.serviceName}
                        onChange={event =>
                          setServiceMaps(current => {
                            const next = [...current];
                            if (index < current.length) {
                              next[index] = { ...mapping, serviceName: event.target.value };
                              return next;
                            }
                            return [
                              ...current,
                              { ...mapping, serviceName: event.target.value },
                            ];
                          })
                        }
                        className="input-field"
                        placeholder="Service name"
                      />
                      <input
                        value={mapping.ownerEmail || ''}
                        onChange={event =>
                          setServiceMaps(current => {
                            const next = [...current];
                            if (index < current.length) {
                              next[index] = { ...mapping, ownerEmail: event.target.value };
                              return next;
                            }
                            return [
                              ...current,
                              { ...mapping, ownerEmail: event.target.value },
                            ];
                          })
                        }
                        className="input-field"
                        placeholder="Owner email"
                      />
                    </div>
                    <input
                      value={mapping.defaultAffectedPaths.join(', ')}
                      onChange={event =>
                        setServiceMaps(current => {
                          const next = [...current];
                          const updated = {
                            ...mapping,
                            defaultAffectedPaths: event.target.value
                              .split(',')
                              .map(item => item.trim())
                              .filter(Boolean),
                          };
                          if (index < current.length) {
                            next[index] = updated;
                            return next;
                          }
                          return [...current, updated];
                        })
                      }
                      className="input-field mt-3"
                      placeholder="src/service/**, src/api/**"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSaveServiceMap(mapping)}
                      disabled={!mapping.serviceName.trim()}
                      className="enterprise-button enterprise-button-secondary mt-3"
                    >
                      Save service map
                    </button>
                  </div>
                ),
              )}
            </div>
          </SectionCard>
          </div>

          <SectionCard
            title="Export connectors"
            description="Configure Datadog and ServiceNow as downstream sinks for incident attribution and MRM exports."
            icon={Link2}
          >
            <div className="grid gap-6 xl:grid-cols-2">
              {exportTargetOptions.map(target => {
                const config =
                  exportConfigs.find(item => item.target === target) || {
                    target,
                    enabled: false,
                    authType: target === 'servicenow' ? ('BASIC' as const) : ('API_KEY' as const),
                    settings: {},
                  };
                const tags = Array.isArray(config.settings?.tags)
                  ? (config.settings?.tags as unknown[]).map(value => String(value || '')).join(', ')
                  : '';
                return (
                  <div
                    key={target}
                    className="rounded-[1.5rem] border border-outline-variant/30 bg-white p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold capitalize text-on-surface">{target}</p>
                      <label className="inline-flex items-center gap-2 text-xs text-secondary">
                        <input
                          type="checkbox"
                          checked={config.enabled}
                          onChange={event =>
                            setExportConfigs(current => {
                              const next = current.filter(item => item.target !== target);
                              return [...next, { ...config, enabled: event.target.checked }];
                            })
                          }
                        />
                        Enabled
                      </label>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <input
                        value={config.baseUrl || ''}
                        onChange={event =>
                          setExportConfigs(current => {
                            const next = current.filter(item => item.target !== target);
                            return [...next, { ...config, baseUrl: event.target.value }];
                          })
                        }
                        className="input-field"
                        placeholder={target === 'datadog' ? 'https://api.datadoghq.com' : 'https://instance.service-now.com'}
                      />
                      <input
                        value={config.secretReference || ''}
                        onChange={event =>
                          setExportConfigs(current => {
                            const next = current.filter(item => item.target !== target);
                            return [...next, { ...config, secretReference: event.target.value }];
                          })
                        }
                        className="input-field"
                        placeholder={target === 'datadog' ? 'API key secret reference' : 'Password secret reference'}
                      />
                    </div>

                    {target === 'servicenow' ? (
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <input
                          value={config.basicUsername || ''}
                          onChange={event =>
                            setExportConfigs(current => {
                              const next = current.filter(item => item.target !== target);
                              return [...next, { ...config, basicUsername: event.target.value }];
                            })
                          }
                          className="input-field"
                          placeholder="Basic username"
                        />
                        <input
                          value={String(config.settings?.incidentTableName || '')}
                          onChange={event =>
                            setExportConfigs(current => {
                              const next = current.filter(item => item.target !== target);
                              return [
                                ...next,
                                {
                                  ...config,
                                  settings: {
                                    ...(config.settings || {}),
                                    incidentTableName: event.target.value,
                                  },
                                },
                              ];
                            })
                          }
                          className="input-field"
                          placeholder="Incident table"
                        />
                        <input
                          value={String(config.settings?.mrmTableName || '')}
                          onChange={event =>
                            setExportConfigs(current => {
                              const next = current.filter(item => item.target !== target);
                              return [
                                ...next,
                                {
                                  ...config,
                                  settings: {
                                    ...(config.settings || {}),
                                    mrmTableName: event.target.value,
                                  },
                                },
                              ];
                            })
                          }
                          className="input-field"
                          placeholder="MRM table"
                        />
                      </div>
                    ) : (
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <input
                          value={String(config.settings?.appKeyReference || '')}
                          onChange={event =>
                            setExportConfigs(current => {
                              const next = current.filter(item => item.target !== target);
                              return [
                                ...next,
                                {
                                  ...config,
                                  settings: {
                                    ...(config.settings || {}),
                                    appKeyReference: event.target.value,
                                  },
                                },
                              ];
                            })
                          }
                          className="input-field"
                          placeholder="App key secret reference"
                        />
                        <input
                          value={String(config.settings?.metricNamespace || '')}
                          onChange={event =>
                            setExportConfigs(current => {
                              const next = current.filter(item => item.target !== target);
                              return [
                                ...next,
                                {
                                  ...config,
                                  settings: {
                                    ...(config.settings || {}),
                                    metricNamespace: event.target.value,
                                  },
                                },
                              ];
                            })
                          }
                          className="input-field"
                          placeholder="Metric namespace"
                        />
                        <input
                          value={tags}
                          onChange={event =>
                            setExportConfigs(current => {
                              const next = current.filter(item => item.target !== target);
                              return [
                                ...next,
                                {
                                  ...config,
                                  settings: {
                                    ...(config.settings || {}),
                                    tags: event.target.value
                                      .split(',')
                                      .map(item => item.trim())
                                      .filter(Boolean),
                                  },
                                },
                              ];
                            })
                          }
                          className="input-field"
                          placeholder="tag1, tag2"
                        />
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => void handleSaveExportConfig(target, config)}
                      className="enterprise-button enterprise-button-secondary mt-3"
                    >
                      Save export connector
                    </button>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        </div>
      ) : null}
    </div>
  );
};

export default Incidents;
