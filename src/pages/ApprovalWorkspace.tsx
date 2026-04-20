import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  FileCode,
  FileText,
  GitBranch,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import ArtifactPreview from '../components/ArtifactPreview';
import InteractionTimeline from '../components/InteractionTimeline';
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from '../components/EnterpriseUI';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import { hasPermission } from '../lib/accessControl';
import { formatEnumLabel, getStatusTone } from '../lib/enterprise';
import { compactMarkdownPreview } from '../lib/markdown';
import {
  approveCapabilityWorkflowRun,
  fetchApprovalWorkspaceContext,
  refreshApprovalWorkspacePacket,
  requestCapabilityWorkflowRunChanges,
  sendBackApprovalForClarification,
} from '../lib/api';
import {
  describeApprovalTarget,
  formatTimestamp,
  getArtifactDocumentBody,
  matchesArtifactWorkbenchFilter,
  type ArtifactWorkbenchFilter,
} from '../lib/orchestrator/support';
import { cn } from '../lib/utils';
import type {
  ApprovalAssignment,
  ApprovalDecision,
  ApprovalWorkspaceContext,
  Artifact,
} from '../types';

const artifactFilterOptions: Array<{
  value: ArtifactWorkbenchFilter;
  label: string;
}> = [
  { value: 'ALL', label: 'All' },
  { value: 'INPUTS', label: 'Inputs' },
  { value: 'OUTPUTS', label: 'Outputs' },
  { value: 'DIFFS', label: 'Diffs' },
  { value: 'APPROVALS', label: 'Approvals' },
  { value: 'HANDOFFS', label: 'Handoffs' },
];

const applyContextDefaults = ({
  nextContext,
  setContext,
  setResolutionNote,
  setSelectedArtifactId,
  setSendBackTargetAgentId,
}: {
  nextContext: ApprovalWorkspaceContext;
  setContext: React.Dispatch<React.SetStateAction<ApprovalWorkspaceContext | null>>;
  setResolutionNote: React.Dispatch<React.SetStateAction<string>>;
  setSelectedArtifactId: React.Dispatch<React.SetStateAction<string>>;
  setSendBackTargetAgentId: React.Dispatch<React.SetStateAction<string>>;
}) => {
  setContext(nextContext);
  setResolutionNote(current => current || '');
  setSelectedArtifactId(current => {
    if (current && nextContext.artifacts.some(artifact => artifact.id === current)) {
      return current;
    }
    return nextContext.selectedArtifactId || nextContext.codeDiffArtifact?.id || nextContext.artifacts[0]?.id || '';
  });
  setSendBackTargetAgentId(current => current || nextContext.availableAgents[0]?.id || '');
};

const ApprovalWorkspace = () => {
  const { capabilityId = '', runId = '', waitId = '' } = useParams();
  const navigate = useNavigate();
  const {
    activeCapability,
    capabilities,
    setActiveCapability,
    refreshCapabilityBundle,
    workspaceOrganization,
    currentActorContext,
  } = useCapability();
  const { success, error: showError } = useToast();
  const [context, setContext] = useState<ApprovalWorkspaceContext | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [artifactFilter, setArtifactFilter] = useState<ArtifactWorkbenchFilter>('ALL');
  const [selectedArtifactId, setSelectedArtifactId] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [sendBackTargetAgentId, setSendBackTargetAgentId] = useState('');
  const [sendBackSummary, setSendBackSummary] = useState('');
  const [sendBackQuestions, setSendBackQuestions] = useState('');
  const [sendBackNote, setSendBackNote] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const previewRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!capabilityId || capabilityId === activeCapability.id) {
      return;
    }
    const nextCapability = capabilities.find(item => item.id === capabilityId);
    if (nextCapability) {
      setActiveCapability(nextCapability);
    }
  }, [activeCapability.id, capabilities, capabilityId, setActiveCapability]);

  const canRead = hasPermission(activeCapability.effectivePermissions, 'workitem.read');
  const canReadArtifacts = hasPermission(activeCapability.effectivePermissions, 'artifact.read');
  const canDecideApprovals = hasPermission(activeCapability.effectivePermissions, 'approval.decide');

  const usersById = useMemo(
    () => new Map(workspaceOrganization.users.map(user => [user.id, { name: user.name }])),
    [workspaceOrganization.users],
  );
  const teamsById = useMemo(
    () => new Map(workspaceOrganization.teams.map(team => [team.id, { name: team.name }])),
    [workspaceOrganization.teams],
  );

  const loadWorkspaceContext = useCallback(async () => {
    if (!capabilityId || !runId || !waitId) {
      setLoadError('The approval workspace route is missing capability, run, or wait ids.');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError('');
    try {
      const nextContext = await fetchApprovalWorkspaceContext(capabilityId, runId, waitId);
      applyContextDefaults({
        nextContext,
        setContext,
        setResolutionNote,
        setSelectedArtifactId,
        setSendBackTargetAgentId,
      });
      try {
        const refreshedPacket = await refreshApprovalWorkspacePacket(capabilityId, runId, waitId);
        setContext(current =>
          current
            ? {
                ...current,
                structuredPacket: refreshedPacket,
              }
            : current,
        );
      } catch (error) {
        showError(
          'Approval packet refresh failed',
          error instanceof Error ? error.message : 'Unable to refresh the approval packet.',
        );
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load the approval workspace.');
    } finally {
      setIsLoading(false);
    }
  }, [capabilityId, runId, showError, waitId]);

  useEffect(() => {
    void loadWorkspaceContext();
  }, [loadWorkspaceContext]);

  const handleRefreshPacket = useCallback(async () => {
    if (!capabilityId || !runId || !waitId) {
      return;
    }
    setBusyAction('refresh');
    try {
      const refreshedPacket = await refreshApprovalWorkspacePacket(capabilityId, runId, waitId);
      setContext(current =>
        current
          ? {
              ...current,
              structuredPacket: refreshedPacket,
            }
          : current,
      );
      success('Approval packet refreshed', 'The review packet has been rebuilt from the latest evidence.');
    } catch (error) {
      showError(
        'Unable to refresh packet',
        error instanceof Error ? error.message : 'Unable to refresh the approval packet.',
      );
    } finally {
      setBusyAction('');
    }
  }, [capabilityId, runId, showError, success, waitId]);

  const filteredArtifacts = useMemo(
    () =>
      (context?.artifacts || []).filter(artifact =>
        matchesArtifactWorkbenchFilter(artifact, artifactFilter),
      ),
    [artifactFilter, context?.artifacts],
  );

  useEffect(() => {
    if (!filteredArtifacts.length) {
      return;
    }
    if (!filteredArtifacts.some(artifact => artifact.id === selectedArtifactId)) {
      setSelectedArtifactId(filteredArtifacts[0]?.id || '');
    }
  }, [filteredArtifacts, selectedArtifactId]);

  const selectedArtifact =
    filteredArtifacts.find(artifact => artifact.id === selectedArtifactId) ||
    context?.artifacts.find(artifact => artifact.id === selectedArtifactId) ||
    context?.artifacts[0] ||
    null;
  const selectedArtifactDocument = useMemo(
    () => getArtifactDocumentBody(selectedArtifact),
    [selectedArtifact],
  );

  const approvalAssignments = context?.approvalWait.approvalAssignments || [];
  const approvalDecisions = context?.approvalWait.approvalDecisions || [];
  const approvalDecisionByAssignmentId = useMemo(() => {
    const next = new Map<string, ApprovalDecision>();
    approvalDecisions.forEach(decision => {
      if (decision.assignmentId) {
        next.set(decision.assignmentId, decision);
      }
    });
    return next;
  }, [approvalDecisions]);
  const unassignedApprovalDecisions = useMemo(
    () =>
      approvalDecisions.filter(
        decision => !decision.assignmentId || !approvalAssignments.some(assignment => assignment.id === decision.assignmentId),
      ),
    [approvalAssignments, approvalDecisions],
  );

  const selectedAgentLabel =
    context?.availableAgents.find(agent => agent.id === sendBackTargetAgentId)?.name || 'selected agent';

  const handleSelectArtifact = (artifactId: string) => {
    setSelectedArtifactId(artifactId);
  };

  const handleOpenDiffArtifact = () => {
    if (!context?.codeDiffArtifact?.id) {
      return;
    }
    setArtifactFilter('DIFFS');
    setSelectedArtifactId(context.codeDiffArtifact.id);
    window.requestAnimationFrame(() => {
      if (typeof previewRef.current?.scrollIntoView === 'function') {
        previewRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  };

  const handleApprove = async () => {
    if (!context || !canDecideApprovals) {
      return;
    }
    setBusyAction('approve');
    try {
      await approveCapabilityWorkflowRun(context.capabilityId, context.runId, {
        resolution: resolutionNote.trim() || 'Approved from the approval workspace.',
        resolvedBy: currentActorContext.displayName || 'Workspace Operator',
      });
      await refreshCapabilityBundle(context.capabilityId);
      success('Approval recorded', 'The workflow can continue from this approval gate.');
      navigate(`/work?selected=${encodeURIComponent(context.workItem.id)}`);
    } catch (error) {
      showError(
        'Approval failed',
        error instanceof Error ? error.message : 'Unable to approve the current gate.',
      );
    } finally {
      setBusyAction('');
    }
  };

  const handleRequestChanges = async () => {
    if (!context || !canDecideApprovals) {
      return;
    }
    setBusyAction('requestChanges');
    try {
      await requestCapabilityWorkflowRunChanges(context.capabilityId, context.runId, {
        resolution: resolutionNote.trim() || 'Changes requested before continuation.',
        resolvedBy: currentActorContext.displayName || 'Workspace Operator',
      });
      await refreshCapabilityBundle(context.capabilityId);
      success('Changes requested', 'The gate has been sent back with a durable review decision.');
      navigate(`/work?selected=${encodeURIComponent(context.workItem.id)}`);
    } catch (error) {
      showError(
        'Request changes failed',
        error instanceof Error ? error.message : 'Unable to request changes on this gate.',
      );
    } finally {
      setBusyAction('');
    }
  };

  const handleSendBack = async () => {
    if (!context || !canDecideApprovals) {
      return;
    }
    const clarificationQuestions = sendBackQuestions
      .split(/\r?\n/)
      .map(item => item.trim())
      .filter(Boolean);
    if (!sendBackTargetAgentId) {
      showError('Choose an agent', 'Select the agent who should respond to the clarification loop.');
      return;
    }
    if (!sendBackSummary.trim()) {
      showError('Add a disagreement summary', 'Explain what the approver disagrees with before sending the gate back.');
      return;
    }
    if (clarificationQuestions.length === 0) {
      showError(
        'Add clarification questions',
        'Add at least one requested change or clarification question.',
      );
      return;
    }

    setBusyAction('sendBack');
    try {
      const nextContext = await sendBackApprovalForClarification(
        context.capabilityId,
        context.runId,
        context.waitId,
        {
          targetAgentId: sendBackTargetAgentId,
          summary: sendBackSummary.trim(),
          clarificationQuestions,
          note: sendBackNote.trim() || undefined,
        },
      );
      applyContextDefaults({
        nextContext,
        setContext,
        setResolutionNote,
        setSelectedArtifactId,
        setSendBackTargetAgentId,
      });
      setSendBackSummary('');
      setSendBackQuestions('');
      setSendBackNote('');
      await refreshCapabilityBundle(context.capabilityId);
      success(
        'Clarification loop opened',
        `${selectedAgentLabel} was asked to respond inside the same approval gate.`,
      );
    } catch (error) {
      showError(
        'Unable to send back for clarification',
        error instanceof Error ? error.message : 'Unable to open the clarification loop.',
      );
    } finally {
      setBusyAction('');
    }
  };

  if (!canRead || !canReadArtifacts) {
    return (
      <EmptyState
        title="Approval workspace unavailable"
        description="This operator does not have permission to read approval evidence for this capability."
        icon={ShieldCheck}
        action={
          <button
            type="button"
            onClick={() => navigate('/work')}
            className="enterprise-button enterprise-button-primary"
          >
            Back to Work
          </button>
        }
        className="min-h-[60vh]"
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-outline-variant/40 bg-white px-5 py-4 text-sm text-secondary">
          <LoaderCircle size={16} className="animate-spin" />
          Preparing the approval workspace...
        </div>
      </div>
    );
  }

  if (loadError || !context) {
    return (
      <EmptyState
        title="Approval workspace could not load"
        description={loadError || 'The approval workspace could not be prepared for this wait.'}
        icon={AlertTriangle}
        action={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadWorkspaceContext()}
              className="enterprise-button enterprise-button-secondary"
            >
              <RefreshCw size={16} />
              Retry
            </button>
            <button
              type="button"
              onClick={() => navigate('/work')}
              className="enterprise-button enterprise-button-primary"
            >
              Back to Work
            </button>
          </div>
        }
        className="min-h-[60vh]"
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Approval Workspace"
        context={context.waitId}
        title={context.workItem.title}
        description="Review the full governed decision packet here: gate context, assignments, artifacts, diff, mined interaction history, and clarification routing stay together in one durable workspace."
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => navigate(`/work?selected=${encodeURIComponent(context.workItem.id)}`)}
              className="enterprise-button enterprise-button-secondary"
            >
              <ArrowLeft size={16} />
              Back to Work
            </button>
            <button
              type="button"
              onClick={() => void handleRefreshPacket()}
              disabled={busyAction !== ''}
              className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyAction === 'refresh' ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              Refresh packet
            </button>
          </div>
        }
      >
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="warning">Approval required</StatusBadge>
          <StatusBadge tone={getStatusTone(context.run.status)}>
            {formatEnumLabel(context.run.status)}
          </StatusBadge>
          <StatusBadge tone="info">{context.currentPhaseLabel}</StatusBadge>
          <StatusBadge tone="neutral">{context.currentStepName}</StatusBadge>
          <StatusBadge tone="brand">{context.runId}</StatusBadge>
        </div>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(24rem,1.05fr)]">
        <div className="space-y-6">
          <SectionCard
            title="Gate summary"
            description="This is the durable approval context for the selected run step."
            icon={ShieldCheck}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low px-4 py-4">
                <p className="form-kicker">Approval request</p>
                <p className="mt-2 text-sm leading-relaxed text-on-surface">
                  {context.approvalWait.message}
                </p>
              </div>
              <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low px-4 py-4">
                <p className="form-kicker">Review facts</p>
                <div className="mt-3 space-y-2 text-sm text-secondary">
                  <p>
                    Requested by:{' '}
                    <strong className="text-on-surface">{context.requestedByLabel || 'System'}</strong>
                  </p>
                  <p>
                    Requested at:{' '}
                    <strong className="text-on-surface">{formatTimestamp(context.requestedAt)}</strong>
                  </p>
                  <p>
                    Documents attached:{' '}
                    <strong className="text-on-surface">{context.artifacts.length}</strong>
                  </p>
                  <p>
                    Diff artifact:{' '}
                    <strong className="text-on-surface">
                      {context.codeDiffArtifact ? 'Attached' : 'Not attached'}
                    </strong>
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="form-kicker">Approval coverage</p>
                  <p className="mt-2 text-sm leading-relaxed text-secondary">
                    Assigned approvers and recorded decisions remain part of the audit record for this gate.
                  </p>
                </div>
                <StatusBadge tone="info">
                  {approvalAssignments.length} assignment{approvalAssignments.length === 1 ? '' : 's'}
                </StatusBadge>
              </div>

              {approvalAssignments.length === 0 ? (
                <p className="mt-4 text-sm leading-relaxed text-secondary">
                  No explicit approval assignments were created for this gate. Fallback routing still applies, but this gate should ideally be reviewed from the named approval policy.
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  {approvalAssignments.map((assignment: ApprovalAssignment) => {
                    const linkedDecision = approvalDecisionByAssignmentId.get(assignment.id);
                    return (
                      <div
                        key={assignment.id}
                        className="rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-on-surface">
                              {describeApprovalTarget(assignment, {
                                usersById,
                                teamsById,
                              })}
                            </p>
                            <p className="mt-1 text-xs text-secondary">
                              {formatEnumLabel(assignment.targetType)}
                              {assignment.dueAt ? ` · Due ${formatTimestamp(assignment.dueAt)}` : ''}
                            </p>
                          </div>
                          <StatusBadge tone={getStatusTone(assignment.status)}>
                            {formatEnumLabel(assignment.status)}
                          </StatusBadge>
                        </div>
                        {linkedDecision ? (
                          <p className="mt-2 text-xs leading-relaxed text-secondary">
                            {linkedDecision.actorDisplayName} recorded{' '}
                            <strong className="text-on-surface">
                              {formatEnumLabel(linkedDecision.disposition)}
                            </strong>
                            {linkedDecision.comment
                              ? ` · ${compactMarkdownPreview(linkedDecision.comment, 140)}`
                              : ''}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}

              {unassignedApprovalDecisions.length > 0 ? (
                <div className="mt-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-3">
                  <p className="form-kicker">Unlinked recorded decisions</p>
                  <div className="mt-3 space-y-2">
                    {unassignedApprovalDecisions.map((decision: ApprovalDecision) => (
                      <p key={decision.id} className="text-xs leading-relaxed text-secondary">
                        {decision.actorDisplayName} ·{' '}
                        <strong className="text-on-surface">
                          {formatEnumLabel(decision.disposition)}
                        </strong>
                        {decision.comment ? ` · ${compactMarkdownPreview(decision.comment, 140)}` : ''}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard
            title="Structured approval packet"
            description="Deterministic evidence is always shown. AI synthesis stays additive and refreshable."
            icon={MessageSquareText}
            action={
              context.codeDiffArtifact ? (
                <button
                  type="button"
                  onClick={handleOpenDiffArtifact}
                  className="enterprise-button enterprise-button-secondary"
                >
                  <ExternalLink size={16} />
                  Open diff artifact
                </button>
              ) : null
            }
          >
            {context.structuredPacket ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="form-kicker">AI synthesis</p>
                      <p className="mt-2 text-sm font-semibold text-on-surface">
                        {context.structuredPacket.aiSummary.summary || 'AI synthesis is not available yet.'}
                      </p>
                      <p className="mt-2 text-xs leading-relaxed text-secondary">
                        {context.structuredPacket.aiSummary.generatedAt
                          ? `Generated ${formatTimestamp(context.structuredPacket.aiSummary.generatedAt)}${context.structuredPacket.aiSummary.model ? ` · ${context.structuredPacket.aiSummary.model}` : ''}`
                          : 'The deterministic packet remains the source of truth if synthesis is unavailable.'}
                      </p>
                    </div>
                    <StatusBadge
                      tone={
                        context.structuredPacket.aiSummary.status === 'READY'
                          ? 'success'
                          : context.structuredPacket.aiSummary.status === 'ERROR'
                          ? 'warning'
                          : 'neutral'
                      }
                    >
                      {formatEnumLabel(context.structuredPacket.aiSummary.status)}
                    </StatusBadge>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-outline-variant/30 bg-white px-4 py-3">
                      <p className="form-kicker">Top risks</p>
                      <ul className="mt-3 space-y-2 text-sm text-secondary">
                        {(context.structuredPacket.aiSummary.topRisks.length > 0
                          ? context.structuredPacket.aiSummary.topRisks
                          : ['No AI risk summary is available yet.']
                        ).map(item => (
                          <li key={item} className="leading-relaxed">{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-2xl border border-outline-variant/30 bg-white px-4 py-3">
                      <p className="form-kicker">Missing evidence</p>
                      <ul className="mt-3 space-y-2 text-sm text-secondary">
                        {(context.structuredPacket.aiSummary.missingEvidence.length > 0
                          ? context.structuredPacket.aiSummary.missingEvidence
                          : ['No missing-evidence callouts were generated.']
                        ).map(item => (
                          <li key={item} className="leading-relaxed">{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-2xl border border-outline-variant/30 bg-white px-4 py-3">
                      <p className="form-kicker">Disagreements</p>
                      <ul className="mt-3 space-y-2 text-sm text-secondary">
                        {(context.structuredPacket.aiSummary.disagreements.length > 0
                          ? context.structuredPacket.aiSummary.disagreements
                          : ['No disagreement hotspots were identified.']
                        ).map(item => (
                          <li key={item} className="leading-relaxed">{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-2xl border border-outline-variant/30 bg-white px-4 py-3">
                      <p className="form-kicker">Suggested clarifications</p>
                      <ul className="mt-3 space-y-2 text-sm text-secondary">
                        {(context.structuredPacket.aiSummary.suggestedClarifications.length > 0
                          ? context.structuredPacket.aiSummary.suggestedClarifications
                          : ['No suggested clarifications were generated.']
                        ).map(item => (
                          <li key={item} className="leading-relaxed">{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
                    <p className="form-kicker">Deterministic summary</p>
                    <p className="mt-2 text-sm leading-relaxed text-on-surface">
                      {context.structuredPacket.deterministic.approvalSummary}
                    </p>
                    <div className="mt-4 space-y-4 text-sm text-secondary">
                      <div>
                        <p className="font-semibold text-on-surface">Key events</p>
                        <ul className="mt-2 space-y-2">
                          {context.structuredPacket.deterministic.keyEvents.map(item => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="font-semibold text-on-surface">Key claims</p>
                        <ul className="mt-2 space-y-2">
                          {context.structuredPacket.deterministic.keyClaims.map(item => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
                    <p className="form-kicker">Evidence and open questions</p>
                    <div className="mt-4 space-y-4 text-sm text-secondary">
                      <div>
                        <p className="font-semibold text-on-surface">Evidence highlights</p>
                        <ul className="mt-2 space-y-2">
                          {context.structuredPacket.deterministic.evidenceHighlights.map(item => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="font-semibold text-on-surface">Open questions</p>
                        <ul className="mt-2 space-y-2">
                          {(context.structuredPacket.deterministic.openQuestions.length > 0
                            ? context.structuredPacket.deterministic.openQuestions
                            : ['No open questions were mined from the current evidence.']
                          ).map(item => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="font-semibold text-on-surface">Unresolved concerns</p>
                        <ul className="mt-2 space-y-2">
                          {(context.structuredPacket.deterministic.unresolvedConcerns.length > 0
                            ? context.structuredPacket.deterministic.unresolvedConcerns
                            : ['No unresolved concerns were recorded yet.']
                          ).map(item => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>

                {context.structuredPacket.deterministic.chatExcerpts.length > 0 ? (
                  <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
                    <p className="form-kicker">Approval-relevant excerpts</p>
                    <div className="mt-4 space-y-3">
                      {context.structuredPacket.deterministic.chatExcerpts.map(excerpt => (
                        <div
                          key={excerpt.id}
                          className="rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-on-surface">{excerpt.title}</p>
                            <span className="text-xs text-secondary">
                              {formatTimestamp(excerpt.timestamp)}
                            </span>
                          </div>
                          <p className="mt-2 text-sm leading-relaxed text-secondary">
                            {excerpt.excerpt}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
                  <p className="form-kicker">Packet markdown</p>
                  <div className="mt-4">
                    <ArtifactPreview
                      content={context.structuredPacket.contentText}
                      format="MARKDOWN"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low px-4 py-4 text-sm text-secondary">
                The approval packet has not been generated yet. Refresh the packet to rebuild it from the latest run evidence.
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Clarification loop"
            description="Send the gate back to any capability agent without creating a separate run."
            icon={Send}
          >
            <div className="flex flex-wrap gap-2">
              <StatusBadge
                tone={
                  context.clarificationStatus === 'RESPONDED'
                    ? 'success'
                    : context.clarificationStatus === 'FAILED'
                    ? 'warning'
                    : context.clarificationStatus === 'WAITING_FOR_AGENT'
                    ? 'brand'
                    : 'neutral'
                }
              >
                {formatEnumLabel(context.clarificationStatus)}
              </StatusBadge>
              <StatusBadge tone="info">
                {context.clarificationRequests.length} request
                {context.clarificationRequests.length === 1 ? '' : 's'}
              </StatusBadge>
            </div>

            {(context.clarificationRequests.length > 0 || context.clarificationResponses.length > 0) ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
                  <p className="form-kicker">Requests</p>
                  <div className="mt-4 space-y-3">
                    {context.clarificationRequests.map(request => (
                      <div
                        key={request.id}
                        className="rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-on-surface">
                              {request.targetAgentName || request.targetAgentId}
                            </p>
                            <p className="mt-1 text-xs text-secondary">
                              {request.requestedBy} · {formatTimestamp(request.requestedAt)}
                            </p>
                          </div>
                          <StatusBadge
                            tone={
                              request.status === 'RESPONDED'
                                ? 'success'
                                : request.status === 'FAILED'
                                ? 'warning'
                                : 'brand'
                            }
                          >
                            {formatEnumLabel(request.status)}
                          </StatusBadge>
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-secondary">
                          {request.summary}
                        </p>
                        {request.clarificationQuestions.length > 0 ? (
                          <ul className="mt-3 space-y-2 text-sm text-secondary">
                            {request.clarificationQuestions.map(question => (
                              <li key={question}>{question}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
                  <p className="form-kicker">Responses</p>
                  <div className="mt-4 space-y-3">
                    {context.clarificationResponses.map(response => (
                      <div
                        key={response.id}
                        className="rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-on-surface">
                            {response.agentName || response.agentId}
                          </p>
                          <span className="text-xs text-secondary">
                            {formatTimestamp(response.createdAt)}
                          </span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-secondary">
                          {response.error || compactMarkdownPreview(response.content, 320)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <label className="space-y-2">
                <span className="form-kicker">Target agent</span>
                <select
                  value={sendBackTargetAgentId}
                  onChange={event => setSendBackTargetAgentId(event.target.value)}
                  className="field-input"
                >
                  {context.availableAgents.map(agent => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} · {agent.role}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <span className="form-kicker">Disagreement summary</span>
                <textarea
                  value={sendBackSummary}
                  onChange={event => setSendBackSummary(event.target.value)}
                  placeholder="Explain what the reviewer disagrees with and what must change."
                  className="field-textarea h-28"
                />
              </label>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <label className="space-y-2">
                <span className="form-kicker">Clarification questions</span>
                <textarea
                  value={sendBackQuestions}
                  onChange={event => setSendBackQuestions(event.target.value)}
                  placeholder={'One requested change or question per line.\nExample: Show why the fallback branch is safe under retry conditions.'}
                  className="field-textarea h-36"
                />
              </label>

              <label className="space-y-2">
                <span className="form-kicker">Reviewer note</span>
                <textarea
                  value={sendBackNote}
                  onChange={event => setSendBackNote(event.target.value)}
                  placeholder="Optional reviewer note that should stay attached to the clarification loop."
                  className="field-textarea h-36"
                />
              </label>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={handleSendBack}
                disabled={!canDecideApprovals || busyAction !== ''}
                className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyAction === 'sendBack' ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <Send size={16} />
                )}
                Send back to {selectedAgentLabel}
              </button>
            </div>
          </SectionCard>

          <SectionCard
            title="Decision"
            description="Capture the gate resolution and either approve or request changes."
            icon={ShieldCheck}
          >
            <textarea
              value={resolutionNote}
              onChange={event => setResolutionNote(event.target.value)}
              placeholder="Record sign-off conditions, risks accepted, or the exact changes required before continuation."
              className="field-textarea h-32"
            />
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={handleRequestChanges}
                disabled={!canDecideApprovals || busyAction !== ''}
                className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyAction === 'requestChanges' ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <RefreshCw size={16} />
                )}
                Request changes
              </button>
              <button
                type="button"
                onClick={handleApprove}
                disabled={!canDecideApprovals || busyAction !== ''}
                className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyAction === 'approve' ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <ShieldCheck size={16} />
                )}
                Approve and continue
              </button>
            </div>
          </SectionCard>

          <SectionCard
            title="Interaction timeline"
            description="Approval-relevant chat, task, wait, and artifact events stay visible in one place."
            icon={MessageSquareText}
          >
            <InteractionTimeline
              feed={context.interactionFeed}
              maxItems={12}
              emptyMessage="No linked interaction context is available for this approval yet."
              onOpenArtifact={artifactId => handleSelectArtifact(artifactId)}
              onOpenRun={() =>
                navigate(`/work?selected=${encodeURIComponent(context.workItem.id)}`)
              }
              onOpenTask={taskId =>
                navigate(`/tasks?taskId=${encodeURIComponent(taskId)}`)
              }
            />
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard
            title="Review artifacts"
            description="The artifact rail keeps the packet, diff, handoffs, and supporting evidence in one scannable list."
            icon={FileText}
          >
            <div className="flex flex-wrap gap-2">
              {artifactFilterOptions.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setArtifactFilter(option.value)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                    artifactFilter === option.value
                      ? 'border-primary/30 bg-primary text-white'
                      : 'border-outline-variant/30 bg-surface-container-low text-secondary hover:border-primary/20 hover:text-primary',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {context.codeDiffArtifact ? (
              <button
                type="button"
                onClick={handleOpenDiffArtifact}
                className="enterprise-button enterprise-button-secondary"
              >
                <GitBranch size={16} />
                Open code diff artifact
              </button>
            ) : null}

            {filteredArtifacts.length === 0 ? (
              <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low px-4 py-4 text-sm text-secondary">
                No documents match the selected filter for this gate yet.
              </div>
            ) : (
              <div className="max-h-[40rem] space-y-2 overflow-y-auto pr-1">
                {filteredArtifacts.map((artifact: Artifact) => (
                  <button
                    key={artifact.id}
                    type="button"
                    onClick={() => handleSelectArtifact(artifact.id)}
                    className={cn(
                      'flex w-full items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition',
                      selectedArtifact?.id === artifact.id
                        ? 'border-primary/25 bg-primary/5'
                        : 'border-outline-variant/35 bg-white hover:border-primary/20 hover:bg-surface-container-low',
                    )}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="mt-0.5 rounded-2xl bg-primary/10 p-2 text-primary">
                        {artifact.artifactKind === 'CODE_DIFF' ? (
                          <GitBranch size={16} />
                        ) : artifact.contentFormat === 'MARKDOWN' ||
                          artifact.contentFormat === 'TEXT' ? (
                          <FileText size={16} />
                        ) : (
                          <FileCode size={16} />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-on-surface">
                            {artifact.name}
                          </p>
                          <StatusBadge tone="brand">{artifact.direction || 'OUTPUT'}</StatusBadge>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-secondary">
                          {compactMarkdownPreview(
                            artifact.summary || artifact.description || `${artifact.type} · ${artifact.version}`,
                            140,
                          )}
                        </p>
                      </div>
                    </div>
                    <span className="text-[0.72rem] font-medium text-secondary">
                      {formatTimestamp(artifact.created)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Document preview"
            description="Select any artifact from the review rail to inspect its full body."
            icon={selectedArtifact?.artifactKind === 'CODE_DIFF' ? GitBranch : FileText}
          >
            <div ref={previewRef} className="space-y-4">
              <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-on-surface">
                      {selectedArtifact?.name || 'No document selected'}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-secondary">
                      {selectedArtifact
                        ? compactMarkdownPreview(
                            selectedArtifact.summary ||
                              selectedArtifact.description ||
                              `${selectedArtifact.type} · ${selectedArtifact.version}`,
                            180,
                          )
                        : 'Select a document from the review rail to inspect it here.'}
                    </p>
                  </div>
                  {selectedArtifact ? (
                    <StatusBadge tone="info">
                      {selectedArtifact.contentFormat || 'TEXT'}
                    </StatusBadge>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-outline-variant/35 bg-white px-5 py-4">
                {selectedArtifactDocument ? (
                  <ArtifactPreview
                    content={selectedArtifactDocument}
                    format={selectedArtifact?.contentFormat}
                    artifactKind={selectedArtifact?.artifactKind}
                    jsonValue={selectedArtifact?.contentJson}
                  />
                ) : (
                  <p className="text-sm leading-relaxed text-secondary">
                    The selected document does not have previewable text content yet.
                  </p>
                )}
              </div>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
};

export default ApprovalWorkspace;
