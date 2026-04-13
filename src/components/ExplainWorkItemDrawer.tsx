import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Download,
  ExternalLink,
  FileText,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import MarkdownContent from './MarkdownContent';
import {
  fetchWorkItemExplainDetail,
  generateWorkItemReviewPacket,
  publishCapabilityArtifactToConfluence,
  syncCapabilityConfluenceConnector,
  syncCapabilityGithubConnector,
  syncCapabilityJiraConnector,
  transitionCapabilityJiraIssue,
} from '../lib/api';
import type {
  Capability,
  CapabilityConnectorContext,
  ReleaseReadinessStatus,
  ReviewPacketArtifactSummary,
  WorkItem,
  WorkItemExplainDetail,
} from '../types';
import { ModalShell, SectionCard, StatusBadge } from './EnterpriseUI';
import { cn } from '../lib/utils';
import { useToast } from '../context/ToastContext';

const getReadinessTone = (status: ReleaseReadinessStatus) => {
  if (status === 'READY') {
    return 'success' as const;
  }
  if (status === 'WAITING_APPROVAL') {
    return 'warning' as const;
  }
  if (status === 'BLOCKED') {
    return 'danger' as const;
  }
  return 'neutral' as const;
};

const formatTimestamp = (value?: string) => {
  if (!value) {
    return 'Not available';
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

const DiffList = ({
  title,
  items,
}: {
  title: string;
  items: string[];
}) => {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-outline">{title}</p>
      <div className="space-y-2">
        {items.map(item => (
          <div
            key={item}
            className="rounded-2xl border border-outline-variant/20 bg-white px-4 py-3 text-sm text-secondary"
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
};

export const ExplainWorkItemDrawer = ({
  capability,
  workItem,
  isOpen,
  onClose,
}: {
  capability: Capability;
  workItem?: WorkItem | null;
  isOpen: boolean;
  onClose: () => void;
}) => {
  const navigate = useNavigate();
  const { success, error: showError } = useToast();
  const [detail, setDetail] = useState<WorkItemExplainDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [isGeneratingPacket, setIsGeneratingPacket] = useState(false);
  const [reviewPacket, setReviewPacket] = useState<ReviewPacketArtifactSummary | undefined>();
  const [connectorContext, setConnectorContext] = useState<CapabilityConnectorContext | null>(
    null,
  );
  const [isSyncing, setIsSyncing] = useState<'github' | 'jira' | 'confluence' | ''>('');
  const [isPublishing, setIsPublishing] = useState(false);
  const [isTransitioningJira, setIsTransitioningJira] = useState(false);
  const workItemId = workItem?.id || '';

  const refreshExplainDetail = async () => {
    if (!workItemId) {
      return;
    }

    setIsLoading(true);
    setLoadError('');
    try {
      const nextDetail = await fetchWorkItemExplainDetail(capability.id, workItemId);
      setDetail(nextDetail);
      setReviewPacket(nextDetail.reviewPacket);
      setConnectorContext(nextDetail.connectors);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Unable to explain this work item right now.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !workItemId) {
      return;
    }

    let isActive = true;
    setIsLoading(true);
    setLoadError('');

    void fetchWorkItemExplainDetail(capability.id, workItemId)
      .then(nextDetail => {
        if (!isActive) {
          return;
        }
        setDetail(nextDetail);
        setReviewPacket(nextDetail.reviewPacket);
        setConnectorContext(nextDetail.connectors);
      })
      .catch(error => {
        if (!isActive) {
          return;
        }
        setLoadError(
          error instanceof Error ? error.message : 'Unable to explain this work item right now.',
        );
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [capability.id, isOpen, workItemId]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [isOpen, onClose]);

  const connectorRows = useMemo(
    () =>
      connectorContext
        ? [
            {
              id: 'github' as const,
              label: 'GitHub',
              status: connectorContext.github.status,
              message: connectorContext.github.message,
            },
            {
              id: 'jira' as const,
              label: 'Jira',
              status: connectorContext.jira.status,
              message: connectorContext.jira.message,
            },
            {
              id: 'confluence' as const,
              label: 'Confluence',
              status: connectorContext.confluence.status,
              message: connectorContext.confluence.message,
            },
          ]
        : [],
    [connectorContext],
  );

  if (!isOpen || !workItem) {
    return null;
  }

  const handleGeneratePacket = async () => {
    setIsGeneratingPacket(true);
    try {
      const packet = await generateWorkItemReviewPacket(capability.id, workItem.id);
      setReviewPacket(packet);
      success(
        'Review packet generated',
        `${workItem.title} now has a durable review packet artifact ready to preview or download.`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to generate the review packet.';
      showError('Review packet failed', message);
    } finally {
      setIsGeneratingPacket(false);
    }
  };

  const handleSyncConnector = async (target: 'github' | 'jira' | 'confluence') => {
    setIsSyncing(target);
    try {
      if (target === 'github') {
        const github = await syncCapabilityGithubConnector(capability.id);
        setConnectorContext(current =>
          current
            ? {
                ...current,
                github,
              }
            : null,
        );
      } else if (target === 'jira') {
        const jira = await syncCapabilityJiraConnector(capability.id);
        setConnectorContext(current =>
          current
            ? {
                ...current,
                jira,
              }
            : null,
        );
      } else {
        const confluence = await syncCapabilityConfluenceConnector(capability.id);
        setConnectorContext(current =>
          current
            ? {
                ...current,
                confluence,
              }
            : null,
        );
      }
      const nextDetail = await fetchWorkItemExplainDetail(capability.id, workItem.id);
      setDetail(nextDetail);
      setReviewPacket(nextDetail.reviewPacket);
      setConnectorContext(current => current || nextDetail.connectors);
      success(
        `${target.charAt(0).toUpperCase()}${target.slice(1)} synced`,
        `The latest ${target} connector context is now attached to this capability view.`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `Unable to sync ${target} right now.`;
      showError(`${target} sync failed`, message);
    } finally {
      setIsSyncing('');
    }
  };

  const handlePublishToConfluence = async () => {
    if (!reviewPacket) {
      return;
    }

    setIsPublishing(true);
    try {
      const result = await publishCapabilityArtifactToConfluence(capability.id, {
        artifactId: reviewPacket.artifactId,
        title: reviewPacket.name,
      });
      success(
        'Published to Confluence',
        result.url ? `Published successfully: ${result.url}` : result.message,
      );
      if (result.url) {
        window.open(result.url, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to publish to Confluence.';
      showError('Confluence publish failed', message);
    } finally {
      setIsPublishing(false);
    }
  };

  const handleTransitionJira = async () => {
    const issueKey = connectorContext?.jira.issues[0]?.key;
    if (!issueKey) {
      showError('Jira transition unavailable', 'Sync Jira or link a Jira issue first.');
      return;
    }

    const transitionId = window.prompt(`Enter the Jira transition id for ${issueKey}.`);
    if (!transitionId) {
      return;
    }

    setIsTransitioningJira(true);
    try {
      const result = await transitionCapabilityJiraIssue(capability.id, {
        issueKey,
        transitionId,
      });
      success('Jira issue transitioned', result.message);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to transition the Jira issue.';
      showError('Jira transition failed', message);
    } finally {
      setIsTransitioningJira(false);
    }
  };

  return (
    <div className="workspace-modal-backdrop z-[95] bg-slate-950/45">
      <ModalShell
        eyebrow="Explain this work item"
        title={workItem.title}
        description="A deterministic operator briefing built from flight recorder, evidence, waits, and policy state."
        className="max-h-[88vh] max-w-6xl overflow-hidden"
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshExplainDetail()}
              className="enterprise-button enterprise-button-secondary"
            >
              <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button type="button" onClick={onClose} className="workspace-list-action">
              <X size={16} />
            </button>
          </div>
        }
      >
        <div className="grid min-h-0 gap-5 px-1 pb-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
          <div className="space-y-5 pr-1">
            {isLoading ? (
              <div className="rounded-3xl border border-outline-variant/20 bg-surface-container-low px-5 py-10 text-sm text-secondary">
                Building the operator explanation from audit evidence, flight recorder, and current gates.
              </div>
            ) : loadError ? (
              <div className="rounded-3xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
                {loadError}
              </div>
            ) : detail ? (
              <>
                <SectionCard
                  title="Current state"
                  description="Plain-language summary of what happened, what is blocking it, and what should happen next."
                  icon={ShieldCheck}
                  tone="brand"
                >
                  <div className="rounded-3xl border border-primary/15 bg-primary/5 px-5 py-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={getReadinessTone(detail.releaseReadiness.status)}>
                        {detail.releaseReadiness.status}
                      </StatusBadge>
                      <StatusBadge tone="brand">
                        {detail.flightRecorder.verdict}
                      </StatusBadge>
                    </div>
                    <h3 className="mt-4 text-xl font-extrabold tracking-tight text-primary">
                      {detail.summary.headline}
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-secondary">
                      {detail.summary.blockingState}
                    </p>
                    <p className="mt-4 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-on-surface">
                      Next: {detail.summary.nextAction}
                    </p>
                  </div>
                </SectionCard>

                <SectionCard
                  title="What changed since last attempt?"
                  description="Latest attempt compared against the previous one."
                  icon={RefreshCw}
                >
                  <div className="rounded-3xl border border-outline-variant/20 bg-surface-container-low px-5 py-5">
                    <p className="text-sm font-semibold text-on-surface">
                      {detail.attemptDiff.summary}
                    </p>
                    {detail.attemptDiff.statusDelta ? (
                      <p className="mt-3 text-sm text-secondary">{detail.attemptDiff.statusDelta}</p>
                    ) : null}
                    {detail.attemptDiff.terminalOutcomeDelta ? (
                      <p className="mt-2 text-sm text-secondary">
                        {detail.attemptDiff.terminalOutcomeDelta}
                      </p>
                    ) : null}
                  </div>
                  {!detail.attemptDiff.hasPreviousAttempt ? (
                    <div className="rounded-3xl border border-outline-variant/20 bg-white px-5 py-4 text-sm text-secondary">
                      Once a retry exists, this view will highlight new evidence, changed gates, and safer decision context between attempts.
                    </div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      <DiffList title="Step progress" items={detail.attemptDiff.stepProgressDelta} />
                      <DiffList title="Gates" items={detail.attemptDiff.waitDelta} />
                      <DiffList title="Policy" items={detail.attemptDiff.policyDelta} />
                      <DiffList title="Evidence" items={detail.attemptDiff.evidenceDelta} />
                      <DiffList title="Handoffs" items={detail.attemptDiff.handoffDelta} />
                      <DiffList title="Tools and human action" items={[...detail.attemptDiff.toolDelta, ...detail.attemptDiff.humanDelta]} />
                    </div>
                  )}
                </SectionCard>

                <SectionCard
                  title="Human gates, policy, and evidence"
                  description="The current approval, conflict, and audit state behind the work item."
                  icon={FileText}
                >
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-outline">
                        Human gates
                      </p>
                      <div className="mt-3 space-y-2">
                        {detail.humanGates.length > 0 ? (
                          detail.humanGates.map(gate => (
                            <div
                              key={gate.waitId}
                              className="rounded-2xl border border-outline-variant/20 bg-white px-4 py-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <StatusBadge tone={gate.status === 'OPEN' ? 'warning' : 'success'}>
                                  {gate.status}
                                </StatusBadge>
                                <StatusBadge tone="neutral">{gate.type}</StatusBadge>
                              </div>
                              <p className="mt-2 text-sm font-semibold text-on-surface">
                                {gate.message}
                              </p>
                              <p className="mt-1 text-xs text-secondary">
                                Requested by {gate.requestedByName || gate.requestedBy} • {formatTimestamp(gate.createdAt)}
                              </p>
                            </div>
                          ))
                        ) : (
                          <p className="rounded-2xl border border-outline-variant/20 bg-white px-4 py-3 text-sm text-secondary">
                            No human gates are attached right now.
                          </p>
                        )}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-outline">
                        Policy decisions
                      </p>
                      <div className="mt-3 space-y-2">
                        {detail.policyDecisions.length > 0 ? (
                          detail.policyDecisions.map(policy => (
                            <div
                              key={policy.id}
                              className="rounded-2xl border border-outline-variant/20 bg-white px-4 py-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <StatusBadge
                                  tone={
                                    policy.decision === 'ALLOW'
                                      ? 'success'
                                      : policy.decision === 'DENY'
                                      ? 'danger'
                                      : 'warning'
                                  }
                                >
                                  {policy.decision}
                                </StatusBadge>
                                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-outline">
                                  {policy.actionType}
                                </span>
                              </div>
                              <p className="mt-2 text-sm text-secondary">{policy.reason}</p>
                            </div>
                          ))
                        ) : (
                          <p className="rounded-2xl border border-outline-variant/20 bg-white px-4 py-3 text-sm text-secondary">
                            No policy decisions are linked to this work item yet.
                          </p>
                        )}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-outline">
                        Evidence and handoffs
                      </p>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        {[...detail.artifacts, ...detail.handoffArtifacts].slice(0, 8).map(artifact => (
                          <div
                            key={artifact.artifactId}
                            className="rounded-2xl border border-outline-variant/20 bg-white px-4 py-3"
                          >
                            <p className="text-sm font-semibold text-on-surface">{artifact.name}</p>
                            <p className="mt-1 text-xs text-secondary">
                              {artifact.kind || 'ARTIFACT'} • {formatTimestamp(artifact.createdAt)}
                            </p>
                            {artifact.summary ? (
                              <p className="mt-2 text-xs leading-relaxed text-secondary">
                                {artifact.summary}
                              </p>
                            ) : null}
                          </div>
                        ))}
                        {detail.artifacts.length + detail.handoffArtifacts.length === 0 ? (
                          <p className="rounded-2xl border border-outline-variant/20 bg-white px-4 py-3 text-sm text-secondary md:col-span-2">
                            No evidence or handoff artifacts are attached yet.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </SectionCard>
              </>
            ) : null}
          </div>

          <div className="space-y-5">
            {detail ? (
              <>
                <SectionCard
                  title="Release readiness"
                  description="Weighted score across approvals, evidence, policy, QA, handoffs, and release authorization."
                  icon={ShieldCheck}
                >
                  <div className="rounded-3xl border border-outline-variant/20 bg-surface-container-low px-5 py-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-outline">
                          Status
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <StatusBadge tone={getReadinessTone(detail.releaseReadiness.status)}>
                            {detail.releaseReadiness.status}
                          </StatusBadge>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-outline">
                          Score
                        </p>
                        <p className="mt-2 text-3xl font-extrabold tracking-tight text-primary">
                          {detail.releaseReadiness.score}
                        </p>
                      </div>
                    </div>
                    <div className="mt-5 space-y-3">
                      {detail.releaseReadiness.dimensions
                        .filter(dimension => dimension.applicable)
                        .map(dimension => (
                          <div key={dimension.id} className="rounded-2xl border border-outline-variant/20 bg-white px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-semibold text-on-surface">
                                {dimension.label}
                              </p>
                              <StatusBadge tone={dimension.passed ? 'success' : 'warning'}>
                                {dimension.passed ? 'Pass' : 'Needs work'}
                              </StatusBadge>
                            </div>
                            <p className="mt-2 text-xs leading-relaxed text-secondary">
                              {dimension.reason}
                            </p>
                          </div>
                        ))}
                    </div>
                  </div>
                </SectionCard>

                <SectionCard
                  title="Review packet"
                  description="Generate or preview the audit-ready packet for PR review, CAB review, or release review."
                  icon={FileText}
                  action={
                    <button
                      type="button"
                      onClick={handleGeneratePacket}
                      disabled={isGeneratingPacket}
                      className="enterprise-button enterprise-button-secondary"
                    >
                      <FileText size={16} />
                      {isGeneratingPacket ? 'Generating…' : 'Generate review packet'}
                    </button>
                  }
                >
                  {reviewPacket ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold text-on-surface">{reviewPacket.name}</p>
                          <p className="mt-1 text-xs text-secondary">
                            Generated {formatTimestamp(reviewPacket.createdAt)}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            href={reviewPacket.downloadUrl}
                            className="enterprise-button enterprise-button-secondary"
                          >
                            <Download size={16} />
                            Download
                          </a>
                          <button
                            type="button"
                            onClick={handlePublishToConfluence}
                            disabled={isPublishing}
                            className="enterprise-button enterprise-button-secondary"
                          >
                            <ExternalLink size={16} />
                            {isPublishing ? 'Publishing…' : 'Publish to Confluence'}
                          </button>
                        </div>
                      </div>
                      <div className="max-h-[26rem] overflow-y-auto rounded-3xl border border-outline-variant/15 bg-white px-5 py-5">
                        <MarkdownContent content={reviewPacket.contentText} />
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-3xl border border-outline-variant/20 bg-surface-container-low px-4 py-4 text-sm text-secondary">
                      No review packet has been generated for this work item yet.
                    </div>
                  )}
                </SectionCard>

                <SectionCard
                  title="Connector utility"
                  description="Live context from linked GitHub, Jira, and Confluence sources."
                  icon={RefreshCw}
                >
                  <div className="space-y-3">
                    {connectorRows.map(row => (
                      <div
                        key={row.id}
                        className="rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-on-surface">{row.label}</p>
                              <StatusBadge
                                tone={
                                  row.status === 'READY'
                                    ? 'success'
                                    : row.status === 'ERROR'
                                    ? 'danger'
                                    : 'warning'
                                }
                              >
                                {row.status}
                              </StatusBadge>
                            </div>
                            <p className="mt-2 text-xs leading-relaxed text-secondary">
                              {row.message}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleSyncConnector(row.id)}
                            disabled={isSyncing === row.id}
                            className="enterprise-button enterprise-button-secondary"
                          >
                            <RefreshCw size={16} className={cn(isSyncing === row.id && 'animate-spin')} />
                            {isSyncing === row.id ? 'Syncing…' : `Sync ${row.label}`}
                          </button>
                        </div>
                        {row.id === 'github' && connectorContext?.github.repositories.length ? (
                          <div className="mt-3 space-y-2 text-xs text-secondary">
                            {connectorContext.github.repositories.map(repository => (
                              <div
                                key={`${repository.owner}/${repository.repo}`}
                                className="rounded-2xl bg-white px-3 py-2"
                              >
                                {repository.owner}/{repository.repo}
                                {repository.openPullRequestCount !== undefined
                                  ? ` • ${repository.openPullRequestCount} open PRs`
                                  : ''}
                                {repository.openIssueCount !== undefined
                                  ? ` • ${repository.openIssueCount} open issues`
                                  : ''}
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {row.id === 'jira' && connectorContext?.jira.issues.length ? (
                          <div className="mt-3 space-y-2">
                            {connectorContext.jira.issues.map(issue => (
                              <div
                                key={issue.key}
                                className="rounded-2xl bg-white px-3 py-2 text-xs text-secondary"
                              >
                                <p className="font-semibold text-on-surface">{issue.key}</p>
                                <p className="mt-1">{issue.title}</p>
                                <p className="mt-1">Status: {issue.status}</p>
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={() => void handleTransitionJira()}
                              disabled={isTransitioningJira}
                              className="enterprise-button enterprise-button-secondary"
                            >
                              <RefreshCw
                                size={16}
                                className={cn(isTransitioningJira && 'animate-spin')}
                              />
                              {isTransitioningJira ? 'Transitioning…' : 'Transition Jira issue'}
                            </button>
                          </div>
                        ) : null}
                        {row.id === 'confluence' && connectorContext?.confluence.pages.length ? (
                          <div className="mt-3 space-y-2 text-xs text-secondary">
                            {connectorContext.confluence.pages.map(page => (
                              <div
                                key={page.pageId || page.url}
                                className="rounded-2xl bg-white px-3 py-2"
                              >
                                <p className="font-semibold text-on-surface">
                                  {page.title || page.pageId || 'Confluence page'}
                                </p>
                                <p className="mt-1">
                                  {page.spaceKey ? `Space ${page.spaceKey}` : 'Linked page'}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard
                  title="Drill down"
                  description="Jump directly into the deeper execution or evidence surface."
                  icon={ArrowRight}
                >
                  <div className="grid gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        navigate('/orchestrator');
                      }}
                      className="enterprise-button enterprise-button-secondary justify-start"
                    >
                      <ArrowRight size={16} />
                      Open Work
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        navigate('/ledger');
                      }}
                      className="enterprise-button enterprise-button-secondary justify-start"
                    >
                      <ArrowRight size={16} />
                      Open Evidence
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        navigate('/run-console');
                      }}
                      className="enterprise-button enterprise-button-secondary justify-start"
                    >
                      <ArrowRight size={16} />
                      Open Run Console
                    </button>
                  </div>
                </SectionCard>
              </>
            ) : null}
          </div>
        </div>
      </ModalShell>
    </div>
  );
};
