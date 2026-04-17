import React, { useEffect, useState } from 'react';
import { BarChart3, Download, RefreshCw, ShieldCheck, TrendingUp } from 'lucide-react';
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from '../components/EnterpriseUI';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import {
  exportModelRiskMonitoringToTarget,
  fetchModelRiskMonitoringExport,
  fetchModelRiskMonitoringSummary,
} from '../lib/api';
import { hasPermission } from '../lib/accessControl';
import type { ModelRiskMonitoringSummary } from '../types';

const percentage = (value: number) => `${(value * 100).toFixed(1)}%`;

const ModelRiskMonitoring = () => {
  const { activeCapability } = useCapability();
  const { success, error: showError } = useToast();
  const [summary, setSummary] = useState<ModelRiskMonitoringSummary | null>(null);
  const [windowDays, setWindowDays] = useState(90);
  const [isLoading, setIsLoading] = useState(true);

  const canRead = hasPermission(activeCapability.effectivePermissions, 'capability.read');

  const loadSummary = async () => {
    if (!canRead) {
      setSummary(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      setSummary(
        await fetchModelRiskMonitoringSummary({
          capabilityId: activeCapability.id,
          windowDays,
        }),
      );
    } catch (error) {
      showError(
        'Unable to load MRM summary',
        error instanceof Error ? error.message : 'Unable to load MRM summary.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadSummary();
  }, [activeCapability.id, windowDays]);

  const handleExport = async () => {
    try {
      const markdown = await fetchModelRiskMonitoringExport({
        capabilityId: activeCapability.id,
        windowDays,
        format: 'markdown',
      });
      await navigator.clipboard.writeText(markdown);
      success('MRM summary copied', 'The monitoring export is now in your clipboard.');
    } catch (error) {
      showError(
        'Unable to export MRM summary',
        error instanceof Error ? error.message : 'Unable to export MRM summary.',
      );
    }
  };

  const handleConnectorExport = async (target: 'datadog' | 'servicenow') => {
    try {
      await exportModelRiskMonitoringToTarget({
        target,
        capabilityId: activeCapability.id,
        windowDays,
      });
      success(
        'MRM export queued',
        `${target} will receive the latest monitoring summary shortly.`,
      );
    } catch (error) {
      showError(
        `Unable to export to ${target}`,
        error instanceof Error ? error.message : `Unable to export to ${target}.`,
      );
    }
  };

  if (!canRead) {
    return (
      <EmptyState
        title="MRM workspace unavailable"
        description="This operator does not have permission to review model risk metrics for the active capability."
        icon={ShieldCheck}
        className="min-h-[24rem]"
      />
    );
  }

  if (isLoading || !summary) {
    return (
      <div className="rounded-3xl border border-outline-variant/40 bg-white px-6 py-8 text-sm text-secondary">
        Loading model risk monitoring summary.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Model Risk Monitoring"
        context={activeCapability.id}
        title="MRM"
        description="Track incident-attribution trends, reviewer overrides, and guardrail promotion pressure for this capability."
        actions={
          <>
            <select
              value={String(windowDays)}
              onChange={event => setWindowDays(Number(event.target.value || 90))}
              className="input-field min-w-[9rem]"
            >
              <option value="30">Last 30 days</option>
              <option value="60">Last 60 days</option>
              <option value="90">Last 90 days</option>
            </select>
            <button
              type="button"
              onClick={() => void loadSummary()}
              className="enterprise-button enterprise-button-secondary"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void handleExport()}
              className="enterprise-button enterprise-button-primary"
            >
              <Download size={16} />
              Copy export
            </button>
            <button
              type="button"
              onClick={() => void handleConnectorExport('datadog')}
              className="enterprise-button enterprise-button-secondary"
            >
              Export Datadog
            </button>
            <button
              type="button"
              onClick={() => void handleConnectorExport('servicenow')}
              className="enterprise-button enterprise-button-secondary"
            >
              Export ServiceNow
            </button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-4">
        <StatTile
          label="Incidents"
          value={summary.totals.incidents}
          helper={`${summary.totals.confirmedContributors} confirmed AI contributors`}
          icon={BarChart3}
        />
        <StatTile
          label="AI Contribution Rate"
          value={percentage(summary.totals.incidentContributionRate)}
          helper={`${summary.totals.totalPackets} total packets in window`}
          icon={TrendingUp}
        />
        <StatTile
          label="MTTA"
          value={`${summary.totals.meanTimeToAttributionHours.toFixed(1)}h`}
          helper="Mean time to attribution for confirmed links"
          icon={ShieldCheck}
        />
        <StatTile
          label="Override Conversion"
          value={percentage(summary.totals.overrideToIncidentRate)}
          helper={`${summary.totals.incidentDerivedLearningCount} incident-derived learning updates`}
          icon={ShieldCheck}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard
          title="Provider trends"
          description="Confirmed and suspected incident-linked packets grouped by provider and model."
          icon={TrendingUp}
        >
          {summary.byProvider.length === 0 ? (
            <p className="text-sm text-secondary">
              No provider-level incident signals are available yet.
            </p>
          ) : (
            <div className="space-y-3">
              {summary.byProvider.map(item => (
                <div
                  key={`${item.providerKey}:${item.model}`}
                  className="rounded-[1.5rem] border border-outline-variant/30 bg-white px-4 py-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={item.confirmedContributors > 0 ? 'danger' : 'neutral'}>
                      {item.providerKey}
                    </StatusBadge>
                    <p className="text-sm font-semibold text-on-surface">{item.model}</p>
                  </div>
                  <p className="mt-2 text-xs text-secondary">
                    {item.confirmedContributors} confirmed · {item.suspectedContributors} suspected
                  </p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Severity distribution"
          description="How incident attribution looks across severity bands."
          icon={BarChart3}
        >
          <div className="space-y-3">
            {summary.bySeverity.map(item => (
              <div
                key={item.severity}
                className="rounded-[1.5rem] border border-outline-variant/30 bg-white px-4 py-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <StatusBadge tone={item.severity === 'SEV1' ? 'danger' : 'warning'}>
                    {item.severity}
                  </StatusBadge>
                  <p className="text-sm font-semibold text-on-surface">
                    {item.incidentCount} incidents
                  </p>
                </div>
                <p className="mt-2 text-xs text-secondary">
                  {item.confirmedContributors} confirmed contributors in this band
                </p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard
          title="Recent incidents"
          description="The latest incidents contributing to the current MRM rollup."
          icon={ShieldCheck}
        >
          {summary.recentIncidents.length === 0 ? (
            <p className="text-sm text-secondary">
              No incidents fall within this monitoring window yet.
            </p>
          ) : (
            <div className="space-y-3">
              {summary.recentIncidents.map(incident => (
                <div
                  key={incident.id}
                  className="rounded-[1.5rem] border border-outline-variant/30 bg-white px-4 py-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={incident.severity === 'SEV1' ? 'danger' : 'warning'}>
                      {incident.severity}
                    </StatusBadge>
                    <p className="text-sm font-semibold text-on-surface">{incident.title}</p>
                  </div>
                  <p className="mt-2 text-xs text-secondary">
                    {incident.id} · {incident.linkedPackets.filter(link => link.correlation === 'CONFIRMED').length} confirmed packets
                  </p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Guardrail promotions"
          description="Incident-derived guardrail promotion requests awaiting or carrying approval state."
          icon={ShieldCheck}
        >
          {summary.guardrailPromotions.length === 0 ? (
            <p className="text-sm text-secondary">
              No incident-derived guardrail promotion requests have been created yet.
            </p>
          ) : (
            <div className="space-y-3">
              {summary.guardrailPromotions.map(item => (
                <div
                  key={`${item.incidentId}:${item.packetBundleId}`}
                  className="rounded-[1.5rem] border border-outline-variant/30 bg-white px-4 py-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={item.status === 'APPROVED' ? 'success' : 'warning'}>
                      {item.status}
                    </StatusBadge>
                    <p className="text-sm font-semibold text-on-surface">{item.incidentId}</p>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-secondary">{item.concernText}</p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
};

export default ModelRiskMonitoring;
