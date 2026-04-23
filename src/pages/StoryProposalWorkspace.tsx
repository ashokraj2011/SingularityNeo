import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ClipboardList,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { EmptyState, PageHeader, SectionCard, StatTile, StatusBadge } from '../components/EnterpriseUI';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import { hasPermission } from '../lib/accessControl';
import {
  createStoryProposalBatch,
  fetchStoryProposalBatch,
  listStoryProposalBatches,
  promoteStoryProposalBatch,
  regenerateStoryProposalBatch,
  updateStoryProposalItem,
} from '../lib/api';
import { formatTimestamp } from '../lib/orchestrator/support';
import {
  DEFAULT_WORK_ITEM_TASK_TYPE,
  WORK_ITEM_TASK_TYPE_OPTIONS,
  getWorkItemTaskTypeDescription,
} from '../lib/workItemTaskTypes';
import { cn } from '../lib/utils';
import type {
  StoryProposalBatch,
  StoryProposalBatchSummary,
  StoryProposalItem,
  StoryTShirtSize,
} from '../types';

type ItemDraft = {
  title: string;
  description: string;
  businessOutcome: string;
  acceptanceCriteriaText: string;
  dependenciesText: string;
  risksText: string;
  recommendedWorkflowId: string;
  recommendedTaskType: NonNullable<StoryProposalItem['recommendedTaskType']>;
  storyPoints: string;
  tShirtSize: StoryTShirtSize | '';
  sizingConfidence: NonNullable<StoryProposalItem['sizingConfidence']>;
  sizingRationale: string;
  implementationNotes: string;
  tagsText: string;
};

const listToText = (items?: string[]) => (items || []).join('\n');
const csvToList = (value: string) =>
  value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
const textToList = (value: string) =>
  value
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean);

const proposalStatusTone: Record<StoryProposalBatchSummary['status'], React.ComponentProps<typeof StatusBadge>['tone']> = {
  DRAFT: 'neutral',
  REVIEW_READY: 'info',
  APPROVED: 'success',
  PARTIALLY_APPROVED: 'warning',
  DISCARDED: 'danger',
};

const reviewStateTone: Record<StoryProposalItem['reviewState'], React.ComponentProps<typeof StatusBadge>['tone']> = {
  PROPOSED: 'neutral',
  EDITED: 'info',
  APPROVED: 'success',
  REJECTED: 'danger',
  PROMOTED: 'brand',
};

const draftFromItem = (item: StoryProposalItem): ItemDraft => ({
  title: item.title,
  description: item.description,
  businessOutcome: item.businessOutcome || '',
  acceptanceCriteriaText: listToText(item.acceptanceCriteria),
  dependenciesText: listToText(item.dependencies),
  risksText: listToText(item.risks),
  recommendedWorkflowId: item.recommendedWorkflowId,
  recommendedTaskType: item.recommendedTaskType || DEFAULT_WORK_ITEM_TASK_TYPE,
  storyPoints: item.storyPoints ? String(item.storyPoints) : '',
  tShirtSize: item.tShirtSize || '',
  sizingConfidence: item.sizingConfidence || 'MEDIUM',
  sizingRationale: item.sizingRationale || '',
  implementationNotes: item.implementationNotes || '',
  tagsText: (item.tags || []).join(', '),
});

export default function StoryProposalWorkspace() {
  const navigate = useNavigate();
  const { capabilityId: routeCapabilityId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    activeCapability,
    capabilities,
    setActiveCapability,
    getCapabilityWorkspace,
    refreshCapabilityBundle,
  } = useCapability();
  const { success, error: showError } = useToast();
  const resolvedCapabilityId = routeCapabilityId || activeCapability.id;
  const [batches, setBatches] = useState<StoryProposalBatchSummary[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<StoryProposalBatch | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>({});
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [planningPrompt, setPlanningPrompt] = useState('');
  const workspace = getCapabilityWorkspace(resolvedCapabilityId);
  const workflows = workspace.workflows || [];
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(workflows[0]?.id || '');
  const selectedBatchId = searchParams.get('batch') || '';

  useEffect(() => {
    if (!routeCapabilityId || routeCapabilityId === activeCapability.id) {
      return;
    }
    const nextCapability = capabilities.find(item => item.id === routeCapabilityId);
    if (nextCapability) {
      setActiveCapability(nextCapability);
    }
  }, [activeCapability.id, capabilities, routeCapabilityId, setActiveCapability]);

  useEffect(() => {
    if (workflows.length === 0) {
      setSelectedWorkflowId('');
      return;
    }
    setSelectedWorkflowId(current =>
      workflows.some(workflow => workflow.id === current)
        ? current
        : workflows[0]?.id || '',
    );
  }, [workflows]);

  const canRead = hasPermission(activeCapability.effectivePermissions, 'capability.read');
  const canEdit = hasPermission(activeCapability.effectivePermissions, 'capability.edit');

  const applyBatch = useCallback((batch: StoryProposalBatch | null) => {
    setSelectedBatch(batch);
    setDrafts(
      Object.fromEntries(
        (batch?.items || []).map(item => [item.id, draftFromItem(item)]),
      ),
    );
  }, []);

  const loadBatches = useCallback(async () => {
    if (!resolvedCapabilityId) {
      return;
    }
    setLoadingList(true);
    try {
      const next = await listStoryProposalBatches(resolvedCapabilityId);
      setBatches(next);
      const preferredBatchId = selectedBatchId || next[0]?.id || '';
      if (preferredBatchId) {
        if (preferredBatchId !== selectedBatchId) {
          setSearchParams({ batch: preferredBatchId }, { replace: true });
        }
      } else {
        applyBatch(null);
      }
    } catch (error) {
      showError(
        'Unable to load story proposals',
        error instanceof Error ? error.message : 'Story proposal batches could not be loaded.',
      );
    } finally {
      setLoadingList(false);
    }
  }, [applyBatch, resolvedCapabilityId, selectedBatchId, setSearchParams, showError]);

  const loadBatchDetail = useCallback(async () => {
    if (!resolvedCapabilityId || !selectedBatchId) {
      applyBatch(null);
      return;
    }
    setLoadingDetail(true);
    try {
      applyBatch(await fetchStoryProposalBatch(resolvedCapabilityId, selectedBatchId));
    } catch (error) {
      showError(
        'Unable to load story proposal detail',
        error instanceof Error ? error.message : 'Story proposal detail could not be loaded.',
      );
    } finally {
      setLoadingDetail(false);
    }
  }, [applyBatch, resolvedCapabilityId, selectedBatchId, showError]);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  useEffect(() => {
    void loadBatchDetail();
  }, [loadBatchDetail]);

  const selectedPlanningArtifact = selectedBatch?.planningArtifacts?.[0] || null;
  const epic = selectedBatch?.items.find(item => item.itemType === 'EPIC') || null;
  const childStories = selectedBatch?.items.filter(item => item.itemType === 'STORY') || [];
  const pendingStories =
    childStories.filter(
      item => item.reviewState !== 'REJECTED' && item.reviewState !== 'PROMOTED',
    ) || [];
  const rejectedStoriesCount =
    childStories.filter(item => item.reviewState === 'REJECTED').length || 0;
  const queuedStoriesCount =
    childStories.filter(item => Boolean(item.promotedWorkItemId)).length || 0;

  const buildItemUpdatePayload = useCallback(
    (
      item: StoryProposalItem,
      reviewState?: StoryProposalItem['reviewState'],
    ): Partial<StoryProposalItem> => {
      const draft = drafts[item.id] || draftFromItem(item);
      return {
        title: draft.title,
        description: draft.description,
        businessOutcome: draft.businessOutcome || undefined,
        acceptanceCriteria: textToList(draft.acceptanceCriteriaText),
        dependencies: textToList(draft.dependenciesText),
        risks: textToList(draft.risksText),
        recommendedWorkflowId: draft.recommendedWorkflowId,
        recommendedTaskType: draft.recommendedTaskType,
        storyPoints: draft.storyPoints ? Number(draft.storyPoints) : undefined,
        tShirtSize: (draft.tShirtSize || undefined) as StoryProposalItem['tShirtSize'],
        sizingConfidence: draft.sizingConfidence,
        sizingRationale: draft.sizingRationale || undefined,
        implementationNotes: draft.implementationNotes || undefined,
        tags: csvToList(draft.tagsText),
        ...(reviewState ? { reviewState } : {}),
      };
    },
    [drafts],
  );

  const handleGenerate = useCallback(async () => {
    if (!resolvedCapabilityId || !selectedWorkflowId) {
      return;
    }
    setBusyAction('generate');
    try {
      const batch = await createStoryProposalBatch(resolvedCapabilityId, {
        workflowId: selectedWorkflowId,
        prompt: planningPrompt.trim() || undefined,
      });
      await loadBatches();
      setSearchParams({ batch: batch.id });
      success('Story plan generated', 'The Planning Agent created a draft proposal batch for review.');
    } catch (error) {
      showError(
        'Story generation failed',
        error instanceof Error ? error.message : 'Unable to generate the story proposal batch.',
      );
    } finally {
      setBusyAction('');
    }
  }, [
    resolvedCapabilityId,
    loadBatches,
    planningPrompt,
    selectedWorkflowId,
    setSearchParams,
    showError,
    success,
  ]);

  const handleRegenerate = useCallback(async () => {
    if (!resolvedCapabilityId || !selectedBatch) {
      return;
    }
    setBusyAction('regenerate');
    try {
      const batch = await regenerateStoryProposalBatch(resolvedCapabilityId, selectedBatch.id, {
        workflowId: selectedWorkflowId || selectedBatch.selectedWorkflowId,
        prompt: planningPrompt.trim() || selectedBatch.sourcePrompt || undefined,
      });
      applyBatch(batch);
      await loadBatches();
      success('Story plan regenerated', 'The proposal batch was rebuilt from the latest planning input.');
    } catch (error) {
      showError(
        'Unable to regenerate plan',
        error instanceof Error ? error.message : 'The story proposal batch could not be regenerated.',
      );
    } finally {
      setBusyAction('');
    }
  }, [
    applyBatch,
    resolvedCapabilityId,
    loadBatches,
    planningPrompt,
    selectedBatch,
    selectedWorkflowId,
    showError,
    success,
  ]);

  const handleDraftChange = useCallback(
    (itemId: string, field: keyof ItemDraft, value: string) => {
      setDrafts(current => ({
        ...current,
        [itemId]: {
          ...current[itemId],
          [field]: value,
        },
      }));
    },
    [],
  );

  const handleSaveItem = useCallback(
    async (item: StoryProposalItem) => {
      if (!resolvedCapabilityId || !selectedBatch) {
        return;
      }
      setBusyAction(`save-${item.id}`);
      try {
        const batch = await updateStoryProposalItem(
          resolvedCapabilityId,
          selectedBatch.id,
          item.id,
          buildItemUpdatePayload(item),
        );
        applyBatch(batch);
        await loadBatches();
        success('Story updated', `${item.title} was saved to the proposal batch.`);
      } catch (error) {
        showError(
          'Unable to save story',
          error instanceof Error ? error.message : 'The story proposal item could not be saved.',
        );
      } finally {
        setBusyAction('');
      }
    },
    [applyBatch, buildItemUpdatePayload, resolvedCapabilityId, loadBatches, selectedBatch, showError, success],
  );

  const handleSetReviewState = useCallback(
    async (
      item: StoryProposalItem,
      reviewState: StoryProposalItem['reviewState'],
    ) => {
      if (!resolvedCapabilityId || !selectedBatch) {
        return;
      }
      setBusyAction(`${reviewState}-${item.id}`);
      try {
        const batch = await updateStoryProposalItem(
          resolvedCapabilityId,
          selectedBatch.id,
          item.id,
          buildItemUpdatePayload(item, reviewState),
        );
        applyBatch(batch);
        await loadBatches();
        success(
          reviewState === 'APPROVED' ? 'Story approved' : 'Story rejected',
          `${item.title} is now marked as ${reviewState.toLowerCase()}.`,
        );
      } catch (error) {
        showError(
          'Unable to update review state',
          error instanceof Error ? error.message : 'The proposal decision could not be saved.',
        );
      } finally {
        setBusyAction('');
      }
    },
    [applyBatch, buildItemUpdatePayload, resolvedCapabilityId, loadBatches, selectedBatch, showError, success],
  );

  const handleQueueStory = useCallback(
    async (item: StoryProposalItem) => {
      if (!resolvedCapabilityId || !selectedBatch || item.itemType !== 'STORY') {
        return;
      }
      if (item.reviewState === 'PROMOTED' && item.promotedWorkItemId) {
        navigate('/work');
        return;
      }
      if (epic?.reviewState === 'REJECTED') {
        showError(
          'Epic review required',
          'The epic is currently rejected. Re-approve the epic before queuing child stories.',
        );
        return;
      }

      setBusyAction(`queue-${item.id}`);
      try {
        if (epic && epic.reviewState !== 'APPROVED' && epic.reviewState !== 'PROMOTED') {
          await updateStoryProposalItem(
            resolvedCapabilityId,
            selectedBatch.id,
            epic.id,
            { reviewState: 'APPROVED' },
          );
        }

        await updateStoryProposalItem(
          resolvedCapabilityId,
          selectedBatch.id,
          item.id,
          buildItemUpdatePayload(item, 'APPROVED'),
        );

        const result = await promoteStoryProposalBatch(resolvedCapabilityId, selectedBatch.id, {
          itemIds: [item.id],
        });
        applyBatch(result.batch);
        await Promise.all([loadBatches(), refreshCapabilityBundle(resolvedCapabilityId)]);
        success(
          'Story queued',
          `${item.title} is now a live work item in the work queue.`,
        );
      } catch (error) {
        showError(
          'Unable to queue story',
          error instanceof Error ? error.message : 'The story could not be converted into a queued work item.',
        );
      } finally {
        setBusyAction('');
      }
    },
    [
      applyBatch,
      buildItemUpdatePayload,
      epic,
      resolvedCapabilityId,
      loadBatches,
      navigate,
      refreshCapabilityBundle,
      selectedBatch,
      showError,
      success,
    ],
  );

  const handleQueuePlannedStories = useCallback(async () => {
    if (!resolvedCapabilityId || !selectedBatch) {
      return;
    }
    if (epic?.reviewState === 'REJECTED') {
      showError(
        'Epic review required',
        'The epic is currently rejected. Re-approve the epic before queuing child stories.',
      );
      return;
    }

    setBusyAction('queue-planned');
    try {
      if (epic && epic.reviewState !== 'APPROVED' && epic.reviewState !== 'PROMOTED') {
        await updateStoryProposalItem(resolvedCapabilityId, selectedBatch.id, epic.id, {
          reviewState: 'APPROVED',
        });
      }

      for (const story of pendingStories) {
        await updateStoryProposalItem(
          resolvedCapabilityId,
          selectedBatch.id,
          story.id,
          buildItemUpdatePayload(story, 'APPROVED'),
        );
      }

      const result = await promoteStoryProposalBatch(resolvedCapabilityId, selectedBatch.id, {
        itemIds: pendingStories.map(item => item.id),
      });
      applyBatch(result.batch);
      await Promise.all([loadBatches(), refreshCapabilityBundle(resolvedCapabilityId)]);
      success(
        'Stories queued',
        `Queued ${result.workItems.length} work item${result.workItems.length === 1 ? '' : 's'} into the live workbench.`,
      );
    } catch (error) {
      showError(
        'Unable to queue stories',
        error instanceof Error ? error.message : 'Planned stories could not be converted into live work items.',
      );
    } finally {
      setBusyAction('');
    }
    },
    [
      buildItemUpdatePayload,
      epic,
      resolvedCapabilityId,
      selectedBatch,
      pendingStories,
      applyBatch,
      loadBatches,
      refreshCapabilityBundle,
      showError,
      success,
    ],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Story Planning"
        context={resolvedCapabilityId}
        title={`${activeCapability.name} planning workspace`}
        description="Generate a draft epic plus child stories, refine the plan, and approve stories directly into the live work queue without crowding the inbox too early."
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => navigate('/capabilities/metadata')}
              className="enterprise-button enterprise-button-secondary"
            >
              <ArrowLeft size={16} />
              Back to capability
            </button>
            <button
              type="button"
              onClick={() => navigate('/work')}
              className="enterprise-button enterprise-button-secondary"
            >
              <ClipboardList size={16} />
              Open workbench
            </button>
          </div>
        }
      />

      {!canRead ? (
        <EmptyState
          title="Story planning is not available"
          description="This operator does not currently have permission to read capability planning batches."
          icon={Bot}
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-5">
            <SectionCard
              title="Generate a story batch"
              description="Use the capability contract as the baseline and optionally add initiative-specific planning context."
              icon={Sparkles}
              tone="brand"
            >
              <label className="space-y-2">
                <span className="field-label">Workflow</span>
                <select
                  value={selectedWorkflowId}
                  onChange={event => setSelectedWorkflowId(event.target.value)}
                  className="field-select"
                >
                  {workflows.map(workflow => (
                    <option key={workflow.id} value={workflow.id}>
                      {workflow.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2">
                <span className="field-label">Planning prompt</span>
                <textarea
                  value={planningPrompt}
                  onChange={event => setPlanningPrompt(event.target.value)}
                  placeholder="Optional. Example: Break the next release into implementable stories for the rule-evaluation engine, keeping reviewable slices and clear evidence expectations."
                  className="field-textarea h-32"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={!canEdit || busyAction !== ''}
                  className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busyAction === 'generate' ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <Sparkles size={16} />
                  )}
                  Generate stories
                </button>
                {selectedBatch ? (
                  <button
                    type="button"
                    onClick={handleRegenerate}
                    disabled={!canEdit || busyAction !== ''}
                    className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busyAction === 'regenerate' ? (
                      <LoaderCircle size={16} className="animate-spin" />
                    ) : (
                      <RefreshCw size={16} />
                    )}
                    Regenerate current batch
                  </button>
                ) : null}
              </div>
            </SectionCard>

            <SectionCard
              title="Recent batches"
              description="Stay in the proposal layer until the plan is reviewed and queued into live work."
              icon={ClipboardList}
            >
              {loadingList ? (
                <div className="flex items-center gap-2 text-sm text-secondary">
                  <LoaderCircle size={16} className="animate-spin" />
                  Loading batches...
                </div>
              ) : batches.length === 0 ? (
                <EmptyState
                  title="No story batches yet"
                  description="Generate the first planning batch from the capability contract."
                  icon={ClipboardList}
                  className="min-h-[12rem]"
                />
              ) : (
                <div className="space-y-3">
                  {batches.map(batch => (
                    <button
                      key={batch.id}
                      type="button"
                      onClick={() => setSearchParams({ batch: batch.id })}
                      className={cn(
                        'w-full rounded-[1.5rem] border px-4 py-4 text-left transition',
                        batch.id === selectedBatchId
                          ? 'border-primary/30 bg-primary/5'
                          : 'border-outline-variant/25 bg-surface-container-low/35 hover:border-primary/20',
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="form-kicker">{batch.id}</p>
                          <p className="mt-1 text-sm font-semibold text-on-surface">
                            {batch.title}
                          </p>
                        </div>
                        <StatusBadge tone={proposalStatusTone[batch.status]}>
                          {batch.status.replace(/_/g, ' ')}
                        </StatusBadge>
                      </div>
                      <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-secondary">
                        {batch.summary}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2 text-[0.7rem] text-secondary">
                        <span>{batch.itemCount} items</span>
                        <span>{Math.max(batch.itemCount - batch.promotedCount - batch.rejectedCount, 0)} pending</span>
                        <span>{batch.promotedCount} queued</span>
                        <span>{formatTimestamp(batch.updatedAt)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>

          <div className="space-y-5">
            {loadingDetail ? (
              <SectionCard
                title="Loading planning batch"
                description="Bringing the selected proposal batch into view."
                icon={LoaderCircle}
              >
                <div className="flex items-center gap-2 text-sm text-secondary">
                  <LoaderCircle size={16} className="animate-spin" />
                  Loading story proposal detail...
                </div>
              </SectionCard>
            ) : !selectedBatch ? (
              <EmptyState
                title="Choose or generate a planning batch"
                description="The planner view will appear here once a batch is selected."
                icon={ClipboardList}
                className="min-h-[32rem]"
              />
            ) : (
              <>
                <section className="grid gap-4 md:grid-cols-4">
                  <StatTile label="Status" value={selectedBatch.status.replace(/_/g, ' ')} tone={proposalStatusTone[selectedBatch.status]} />
                  <StatTile label="Stories" value={childStories.length} tone="brand" />
                  <StatTile label="Pending" value={pendingStories.length} tone="warning" />
                  <StatTile label="Rejected" value={rejectedStoriesCount} tone="danger" />
                  <StatTile label="Queued" value={queuedStoriesCount} tone="info" />
                </section>

                <SectionCard
                  title={selectedBatch.title}
                  description={selectedBatch.summary}
                  icon={Bot}
                  tone="brand"
                  action={
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge tone={proposalStatusTone[selectedBatch.status]}>
                        {selectedBatch.status.replace(/_/g, ' ')}
                      </StatusBadge>
                      <button
                        type="button"
                        onClick={handleQueuePlannedStories}
                        disabled={!canEdit || pendingStories.length === 0 || busyAction !== ''}
                        className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busyAction === 'queue-planned' ? (
                          <LoaderCircle size={16} className="animate-spin" />
                        ) : (
                          <CheckCircle2 size={16} />
                        )}
                        Approve & queue all stories
                      </button>
                    </div>
                  }
                >
                  <div className="grid gap-4 lg:grid-cols-3">
                    <div className="rounded-[1.5rem] border border-outline-variant/25 bg-surface-container-low/40 p-4">
                      <p className="form-kicker">Assumptions</p>
                      <ul className="mt-3 space-y-2 text-sm text-secondary">
                        {(selectedBatch.assumptions.length > 0
                          ? selectedBatch.assumptions
                          : ['No explicit assumptions were captured.']
                        ).map(item => (
                          <li key={item}>• {item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-[1.5rem] border border-outline-variant/25 bg-surface-container-low/40 p-4">
                      <p className="form-kicker">Dependencies</p>
                      <ul className="mt-3 space-y-2 text-sm text-secondary">
                        {(selectedBatch.dependencies.length > 0
                          ? selectedBatch.dependencies
                          : ['No explicit dependencies were captured.']
                        ).map(item => (
                          <li key={item}>• {item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-[1.5rem] border border-outline-variant/25 bg-surface-container-low/40 p-4">
                      <p className="form-kicker">Risks</p>
                      <ul className="mt-3 space-y-2 text-sm text-secondary">
                        {(selectedBatch.risks.length > 0
                          ? selectedBatch.risks
                          : ['No explicit risks were captured.']
                        ).map(item => (
                          <li key={item}>• {item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {selectedPlanningArtifact?.contentText ? (
                    <div className="rounded-[1.5rem] border border-outline-variant/25 bg-surface-container-low/35 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="form-kicker">Planning artifact</p>
                          <h3 className="mt-1 text-sm font-semibold text-on-surface">
                            {selectedPlanningArtifact.name}
                          </h3>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs text-secondary">
                          <span>{selectedBatch.generationMode.replace('_', ' ')}</span>
                          <span>{formatTimestamp(selectedPlanningArtifact.createdAt)}</span>
                        </div>
                      </div>
                      <pre className="custom-scrollbar mt-4 max-h-[18rem] overflow-auto rounded-[1rem] bg-white/80 p-4 text-xs leading-relaxed text-secondary whitespace-pre-wrap">
                        {selectedPlanningArtifact.contentText}
                      </pre>
                    </div>
                  ) : null}
                </SectionCard>

                {epic ? (
                  <SectionCard
                    title={`Epic · ${epic.title}`}
                    description={epic.description}
                    icon={ClipboardList}
                    tone="brand"
                  >
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge tone={reviewStateTone[epic.reviewState]}>
                        {epic.reviewState}
                      </StatusBadge>
                      {epic.storyPoints ? (
                        <StatusBadge tone="neutral">{epic.storyPoints} pts</StatusBadge>
                      ) : null}
                      {epic.tShirtSize ? (
                        <StatusBadge tone="neutral">{epic.tShirtSize}</StatusBadge>
                      ) : null}
                      {epic.promotedWorkItemId ? (
                        <StatusBadge tone="brand">Promoted · {epic.promotedWorkItemId}</StatusBadge>
                      ) : null}
                    </div>
                    <p className="text-sm leading-relaxed text-secondary">
                      {epic.businessOutcome || 'No explicit epic business outcome was captured.'}
                    </p>
                  </SectionCard>
                ) : null}

                <div className="space-y-4">
                  {childStories.map(item => {
                    const draft = drafts[item.id] || draftFromItem(item);
                    return (
                      <SectionCard
                        key={item.id}
                        title={draft.title || item.title}
                        description={item.promotedWorkItemId ? `Queued as ${item.promotedWorkItemId}` : `Proposal item ${item.id}`}
                        icon={item.reviewState === 'REJECTED' ? XCircle : CheckCircle2}
                        action={
                          <div className="flex flex-wrap gap-2">
                            <StatusBadge tone={reviewStateTone[item.reviewState]}>
                              {item.reviewState}
                            </StatusBadge>
                            {item.storyPoints ? (
                              <StatusBadge tone="neutral">{item.storyPoints} pts</StatusBadge>
                            ) : null}
                            {item.tShirtSize ? (
                              <StatusBadge tone="neutral">{item.tShirtSize}</StatusBadge>
                            ) : null}
                            {item.promotedWorkItemId ? (
                              <StatusBadge tone="brand">{item.promotedWorkItemId}</StatusBadge>
                            ) : null}
                          </div>
                        }
                      >
                        <div className="grid gap-4 md:grid-cols-2">
                          <label className="space-y-2 md:col-span-2">
                            <span className="field-label">Title</span>
                            <input
                              value={draft.title}
                              onChange={event => handleDraftChange(item.id, 'title', event.target.value)}
                              className="field-input"
                            />
                          </label>
                          <label className="space-y-2 md:col-span-2">
                            <span className="field-label">Description</span>
                            <textarea
                              value={draft.description}
                              onChange={event => handleDraftChange(item.id, 'description', event.target.value)}
                              className="field-textarea h-28"
                            />
                          </label>
                          <label className="space-y-2">
                            <span className="field-label">Workflow</span>
                            <select
                              value={draft.recommendedWorkflowId}
                              onChange={event =>
                                handleDraftChange(item.id, 'recommendedWorkflowId', event.target.value)
                              }
                              className="field-select"
                            >
                              {workflows.map(workflow => (
                                <option key={workflow.id} value={workflow.id}>
                                  {workflow.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="space-y-2">
                            <span className="field-label">Task type</span>
                            <select
                              value={draft.recommendedTaskType}
                              onChange={event =>
                                handleDraftChange(item.id, 'recommendedTaskType', event.target.value)
                              }
                              className="field-select"
                            >
                              {WORK_ITEM_TASK_TYPE_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <p className="text-xs text-secondary">
                              {getWorkItemTaskTypeDescription(draft.recommendedTaskType)}
                            </p>
                          </label>
                          <label className="space-y-2">
                            <span className="field-label">Story points</span>
                            <input
                              type="number"
                              min={1}
                              value={draft.storyPoints}
                              onChange={event => handleDraftChange(item.id, 'storyPoints', event.target.value)}
                              className="field-input"
                            />
                          </label>
                          <label className="space-y-2">
                            <span className="field-label">T-shirt size</span>
                            <select
                              value={draft.tShirtSize}
                              onChange={event => handleDraftChange(item.id, 'tShirtSize', event.target.value)}
                              className="field-select"
                            >
                              <option value="">Choose size</option>
                              {(['XS', 'S', 'M', 'L', 'XL'] as StoryTShirtSize[]).map(size => (
                                <option key={size} value={size}>
                                  {size}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="space-y-2">
                            <span className="field-label">Sizing confidence</span>
                            <select
                              value={draft.sizingConfidence}
                              onChange={event =>
                                handleDraftChange(item.id, 'sizingConfidence', event.target.value)
                              }
                              className="field-select"
                            >
                              <option value="LOW">Low</option>
                              <option value="MEDIUM">Medium</option>
                              <option value="HIGH">High</option>
                            </select>
                          </label>
                          <label className="space-y-2 md:col-span-2">
                            <span className="field-label">Business outcome</span>
                            <textarea
                              value={draft.businessOutcome}
                              onChange={event => handleDraftChange(item.id, 'businessOutcome', event.target.value)}
                              className="field-textarea h-24"
                            />
                          </label>
                          <label className="space-y-2">
                            <span className="field-label">Acceptance criteria</span>
                            <textarea
                              value={draft.acceptanceCriteriaText}
                              onChange={event =>
                                handleDraftChange(item.id, 'acceptanceCriteriaText', event.target.value)
                              }
                              className="field-textarea h-28"
                            />
                          </label>
                          <label className="space-y-2">
                            <span className="field-label">Tags</span>
                            <input
                              value={draft.tagsText}
                              onChange={event => handleDraftChange(item.id, 'tagsText', event.target.value)}
                              className="field-input"
                              placeholder="comma, separated, tags"
                            />
                          </label>
                          <label className="space-y-2">
                            <span className="field-label">Dependencies</span>
                            <textarea
                              value={draft.dependenciesText}
                              onChange={event =>
                                handleDraftChange(item.id, 'dependenciesText', event.target.value)
                              }
                              className="field-textarea h-24"
                            />
                          </label>
                          <label className="space-y-2">
                            <span className="field-label">Risks</span>
                            <textarea
                              value={draft.risksText}
                              onChange={event =>
                                handleDraftChange(item.id, 'risksText', event.target.value)
                              }
                              className="field-textarea h-24"
                            />
                          </label>
                          <label className="space-y-2 md:col-span-2">
                            <span className="field-label">Sizing rationale</span>
                            <textarea
                              value={draft.sizingRationale}
                              onChange={event =>
                                handleDraftChange(item.id, 'sizingRationale', event.target.value)
                              }
                              className="field-textarea h-20"
                            />
                          </label>
                          <label className="space-y-2 md:col-span-2">
                            <span className="field-label">Implementation notes</span>
                            <textarea
                              value={draft.implementationNotes}
                              onChange={event =>
                                handleDraftChange(item.id, 'implementationNotes', event.target.value)
                              }
                              className="field-textarea h-24"
                            />
                          </label>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleSaveItem(item)}
                            disabled={!canEdit || busyAction !== ''}
                            className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {busyAction === `save-${item.id}` ? (
                              <LoaderCircle size={16} className="animate-spin" />
                            ) : (
                              <RefreshCw size={16} />
                            )}
                            Save changes
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleQueueStory(item)}
                            disabled={!canEdit || item.reviewState === 'PROMOTED' || busyAction !== ''}
                            className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {busyAction === `queue-${item.id}` ? (
                              <LoaderCircle size={16} className="animate-spin" />
                            ) : (
                              <CheckCircle2 size={16} />
                            )}
                            {item.reviewState === 'PROMOTED'
                              ? 'Queued'
                              : item.reviewState === 'APPROVED'
                              ? 'Queue now'
                              : 'Approve & queue'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleSetReviewState(item, 'REJECTED')}
                            disabled={!canEdit || item.reviewState === 'PROMOTED' || busyAction !== ''}
                            className="enterprise-button enterprise-button-danger disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {busyAction === `REJECTED-${item.id}` ? (
                              <LoaderCircle size={16} className="animate-spin" />
                            ) : (
                              <XCircle size={16} />
                            )}
                            Reject
                          </button>
                        </div>
                      </SectionCard>
                    );
                  })}
                </div>

                <SectionCard
                  title="Decision trail"
                  description="Every proposal action is durable so the planning review stays auditable."
                  icon={Bot}
                >
                  {selectedBatch.decisions.length === 0 ? (
                    <p className="text-sm text-secondary">No decisions have been recorded yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {selectedBatch.decisions
                        .slice()
                        .reverse()
                        .slice(0, 8)
                        .map(decision => (
                          <div
                            key={decision.id}
                            className="rounded-[1.25rem] border border-outline-variant/20 bg-surface-container-low/35 px-4 py-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <StatusBadge tone="neutral">{decision.disposition}</StatusBadge>
                                <span className="text-sm font-semibold text-on-surface">
                                  {decision.actorDisplayName}
                                </span>
                              </div>
                              <span className="text-xs text-secondary">
                                {formatTimestamp(decision.createdAt)}
                              </span>
                            </div>
                            {decision.note ? (
                              <p className="mt-2 text-sm leading-relaxed text-secondary">
                                {decision.note}
                              </p>
                            ) : null}
                            {decision.fieldChanges.length > 0 ? (
                              <p className="mt-2 text-xs text-secondary">
                                Changed: {decision.fieldChanges.join(', ')}
                              </p>
                            ) : null}
                          </div>
                        ))}
                    </div>
                  )}
                </SectionCard>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
