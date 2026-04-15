import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Building2,
  FileJson,
  GitBranch,
  Layers,
  Link2,
  ShieldAlert,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, SectionCard, StatTile, StatusBadge } from '../components/EnterpriseUI';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import { fetchCapabilityAlmExport } from '../lib/api';

export default function Architecture() {
  const navigate = useNavigate();
  const { activeCapability, capabilities } = useCapability();
  const { error: showError } = useToast();
  const [almPreview, setAlmPreview] = useState('');

  const latestSnapshot = activeCapability.publishedSnapshots?.[0];
  const parentChain = activeCapability.hierarchyNode?.pathLabels || [activeCapability.name];
  const directChildren = capabilities.filter(
    capability => capability.parentCapabilityId === activeCapability.id,
  );
  const sharedCapabilities = (activeCapability.sharedCapabilities || [])
    .map(reference => {
      const capability = capabilities.find(item => item.id === reference.memberCapabilityId);
      return capability
        ? {
            ...capability,
            sharedLabel: reference.label,
          }
        : null;
    })
    .filter(Boolean) as Array<typeof activeCapability & { sharedLabel?: string }>;
  const inboundDependencies = capabilities.filter(capability =>
    (capability.dependencies || []).some(
      dependency => dependency.targetCapabilityId === activeCapability.id,
    ),
  );

  const stats = useMemo(
    () => [
      {
        label: 'Direct children',
        value: activeCapability.rollupSummary?.directChildCount || 0,
      },
      {
        label: 'Descendants',
        value: activeCapability.rollupSummary?.descendantCount || 0,
      },
      {
        label: 'Shared capabilities',
        value: activeCapability.rollupSummary?.sharedCapabilityCount || 0,
      },
      {
        label: 'Dependencies',
        value: activeCapability.rollupSummary?.dependencyCount || 0,
      },
      {
        label: 'Warnings',
        value: activeCapability.rollupSummary?.warnings.length || 0,
      },
    ],
    [activeCapability.rollupSummary],
  );

  const handlePreviewAlm = async () => {
    try {
      const payload = await fetchCapabilityAlmExport(activeCapability.id);
      setAlmPreview(JSON.stringify(payload, null, 2));
    } catch (error) {
      showError(
        'ALM preview failed',
        error instanceof Error ? error.message : 'Unable to build the ALM export.',
      );
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Architecture"
        context={activeCapability.id}
        title={activeCapability.name}
        description="Explore the hierarchy path, published contract lineage, dependency graph, and rollup warnings that make this capability useful to higher enterprise layers."
        actions={
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handlePreviewAlm()}
              className="enterprise-button enterprise-button-secondary"
            >
              <FileJson size={16} />
              Preview ALM export
            </button>
            <button
              type="button"
              onClick={() => navigate('/capabilities/metadata')}
              className="enterprise-button enterprise-button-brand-muted"
            >
              Edit metadata
            </button>
          </div>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map(item => (
          <StatTile key={item.label} label={item.label} value={item.value} tone="brand" />
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <SectionCard
            title="Hierarchy path"
            description="Single-parent architecture path from delivery node to higher planning layers."
            icon={Layers}
            tone="brand"
          >
            <div className="flex flex-wrap items-center gap-2">
              {parentChain.map((label, index) => (
                <React.Fragment key={`${label}-${index}`}>
                  <span className="rounded-full bg-primary/10 px-3 py-1.5 text-sm font-bold text-primary">
                    {label}
                  </span>
                  {index < parentChain.length - 1 ? (
                    <ArrowRight size={14} className="text-outline" />
                  ) : null}
                </React.Fragment>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <StatusBadge tone="info">
                {activeCapability.capabilityKind || 'DELIVERY'}
              </StatusBadge>
              {activeCapability.collectionKind ? (
                <StatusBadge tone="warning">{activeCapability.collectionKind}</StatusBadge>
              ) : null}
              {latestSnapshot ? (
                <StatusBadge tone="success">Published v{latestSnapshot.publishVersion}</StatusBadge>
              ) : (
                <StatusBadge tone="warning">Unpublished</StatusBadge>
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Published contract rollup"
            description="Parent and collection layers consume only published snapshots from child capabilities."
            icon={Building2}
            tone="brand"
          >
            {latestSnapshot ? (
              <div className="space-y-4">
                <div className="rounded-2xl bg-surface-container-low p-4">
                  <p className="text-sm font-bold text-on-surface">
                    Version {latestSnapshot.publishVersion}
                  </p>
                  <p className="mt-1 text-sm text-secondary">
                    Published by {latestSnapshot.publishedBy} on{' '}
                    {new Date(latestSnapshot.publishedAt).toLocaleString()}
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl bg-surface-container-low p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-outline">
                      Functional requirements
                    </p>
                    <p className="mt-2 text-lg font-extrabold text-primary">
                      {latestSnapshot.contract.functionalRequirements.length}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-surface-container-low p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-outline">
                      API contracts
                    </p>
                    <p className="mt-2 text-lg font-extrabold text-primary">
                      {latestSnapshot.contract.apiContracts.length}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                Publish a contract from Capability Metadata before this node can contribute stable
                rollups to parent layers.
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Dependency graph"
            description="Cross-capability dependencies live outside the hierarchy tree."
            icon={Link2}
            tone="default"
          >
            <div className="space-y-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-outline">
                  Outbound dependencies
                </p>
                <div className="mt-2 space-y-2">
                  {(activeCapability.dependencies || []).length > 0 ? (
                    (activeCapability.dependencies || []).map(dependency => (
                      <div
                        key={dependency.id}
                        className="rounded-2xl bg-surface-container-low p-4"
                      >
                        <div className="flex flex-wrap gap-2">
                          <StatusBadge tone="info">{dependency.dependencyKind}</StatusBadge>
                          <StatusBadge tone="warning">{dependency.criticality}</StatusBadge>
                          {dependency.versionConstraint ? (
                            <StatusBadge tone="neutral">
                              v{dependency.versionConstraint}
                            </StatusBadge>
                          ) : null}
                        </div>
                        <p className="mt-3 text-sm font-bold text-on-surface">
                          {dependency.targetCapabilityId}
                        </p>
                        <p className="mt-1 text-sm text-secondary">{dependency.description}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-secondary">No outbound dependencies declared yet.</p>
                  )}
                </div>
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-outline">
                  Inbound dependencies
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {inboundDependencies.length > 0 ? (
                    inboundDependencies.map(capability => (
                      <span
                        key={capability.id}
                        className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary"
                      >
                        {capability.name}
                      </span>
                    ))
                  ) : (
                    <p className="text-sm text-secondary">
                      No peer capabilities currently depend on this node.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </SectionCard>

          {almPreview ? (
            <SectionCard
              title="ALM payload"
              description="Structured export payload for external ALM or architecture systems."
              icon={FileJson}
              tone="default"
            >
              <pre className="max-h-[28rem] overflow-auto rounded-2xl bg-surface-container-low p-4 text-xs text-secondary">
                {almPreview}
              </pre>
            </SectionCard>
          ) : null}
        </div>

        <aside className="space-y-4 xl:sticky xl:top-28 xl:self-start">
          <SectionCard
            title="Direct children"
            description="Immediate architecture children and their publish health."
            icon={GitBranch}
            tone="brand"
          >
            <div className="space-y-3">
              {directChildren.length > 0 ? (
                directChildren.map(child => (
                  <div key={child.id} className="rounded-2xl bg-surface-container-low p-4">
                    <p className="text-sm font-bold text-on-surface">{child.name}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <StatusBadge tone="info">{child.capabilityKind || 'DELIVERY'}</StatusBadge>
                      {child.publishedSnapshots?.[0] ? (
                        <StatusBadge tone="success">
                          v{child.publishedSnapshots[0].publishVersion}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="warning">Unpublished</StatusBadge>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-secondary">
                  No direct children are attached to this capability yet.
                </p>
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Shared capabilities"
            description="Capabilities reused by this collection without changing their own direct parent."
            icon={Layers}
            tone="default"
          >
            <div className="space-y-3">
              {sharedCapabilities.length > 0 ? (
                sharedCapabilities.map(sharedCapability => (
                  <div
                    key={`shared-${sharedCapability.id}`}
                    className="rounded-2xl bg-surface-container-low p-4"
                  >
                    <p className="text-sm font-bold text-on-surface">
                      {sharedCapability.sharedLabel || sharedCapability.name}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <StatusBadge tone="info">
                        {sharedCapability.capabilityKind || 'DELIVERY'}
                      </StatusBadge>
                      {sharedCapability.publishedSnapshots?.[0] ? (
                        <StatusBadge tone="success">
                          v{sharedCapability.publishedSnapshots[0].publishVersion}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="warning">Unpublished</StatusBadge>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-secondary">
                  No shared capabilities are linked to this capability yet.
                </p>
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Rollup warnings"
            description="Signals that higher architecture layers should see immediately."
            icon={ShieldAlert}
            tone="muted"
          >
            <div className="space-y-3">
              {(activeCapability.rollupSummary?.warnings || []).length > 0 ? (
                activeCapability.rollupSummary?.warnings.map(warning => (
                  <div key={warning.id} className="rounded-2xl bg-surface-container-low p-4">
                    <p className="text-sm font-bold text-on-surface">{warning.kind}</p>
                    <p className="mt-1 text-sm text-secondary">{warning.message}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-secondary">
                  No hierarchy or publish warnings right now.
                </p>
              )}
            </div>
          </SectionCard>
        </aside>
      </div>
    </div>
  );
}
