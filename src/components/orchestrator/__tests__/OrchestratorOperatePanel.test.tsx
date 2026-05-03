import React, { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorOperatePanel } from '../OrchestratorOperatePanel';

vi.mock('../../AgentKnowledgeLensPanel', () => ({
  default: () => <div>Agent knowledge panel</div>,
}));

vi.mock('../../CapabilityBriefingPanel', () => ({
  default: () => <div>Capability briefing panel</div>,
}));

vi.mock('../../ErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../InteractionTimeline', () => ({
  default: () => <div>Interaction timeline</div>,
}));

vi.mock('../../MarkdownContent', () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock('../OrchestratorCopilotTranscript', () => ({
  CopilotMessageBody: ({ content }: { content: string }) => <div>{content}</div>,
  CopilotThinkingIndicator: () => <div>Thinking…</div>,
}));

describe('OrchestratorOperatePanel', () => {
  it('renders the operate canvas and routes primary actions through callbacks', async () => {
    const user = userEvent.setup();
    const onOpenTaskList = vi.fn();
    const onOpenStageControl = vi.fn();
    const onOpenStageOwnership = vi.fn();

    render(
      <OrchestratorOperatePanel
        selectedStateSummary="Builder is preparing the implementation plan."
        selectedBlockerSummary="No blockers recorded."
        selectedNextActionSummary="Start implementation."
        readinessContract={{ allReady: true, summary: 'Everything is configured.' } as never}
        primaryReadinessGate={null}
        selectedTasks={[]}
        onOpenTaskList={onOpenTaskList}
        onOpenTask={vi.fn()}
        selectedAgent={null}
        selectedInteractionFeed={{} as never}
        onOpenArtifactFromTimeline={vi.fn()}
        onOpenRunFromTimeline={vi.fn()}
        onOpenTaskFromTimeline={vi.fn()}
        selectedAttentionReason=""
        selectedAttentionLabel="Needs action"
        selectedAttentionRequestedBy={undefined}
        selectedAttentionTimestamp={undefined}
        agentsById={new Map()}
        selectedCanGuideBlockedAgent={false}
        selectedOpenWait={null}
        requestChangesIsAvailable={false}
        onGuideAndRestart={vi.fn()}
        canGuideAndRestart={false}
        busyAction={null}
        actionError=""
        onApprovalReviewMouseDown={vi.fn()}
        onOpenApprovalReview={vi.fn()}
        onResolveWait={vi.fn()}
        canResolveSelectedWait={false}
        actionButtonLabel="Continue"
        selectedFailureReason=""
        selectedWorkItem={{
          id: 'WI-1',
          phase: 'DEVELOPMENT',
          status: 'ACTIVE',
          tags: [],
        } as never}
        canRestartWorkItems={false}
        onUseBlockerInGuidance={vi.fn()}
        resolutionNoteRef={createRef<HTMLTextAreaElement>()}
        resolutionNote=""
        onResolutionNoteChange={vi.fn()}
        resolutionPlaceholder="Add guidance"
        guidanceSuggestions={[]}
        onAppendGuidanceSuggestion={vi.fn()}
        resolutionIsRequired={false}
        selectedWorkflow={{ id: 'WF-1', steps: [] } as never}
        selectedCurrentStep={null}
        currentRun={null}
        currentRunStatusLabel={null}
        selectedSharedBranch={null}
        selectedExecutionRepository={null}
        selectedEffectiveExecutionContext={null}
        selectedActiveWriterLabel="No one has claimed write control"
        onInitializeExecutionContext={vi.fn()}
        canInitializeExecutionContext={false}
        onCreateSharedBranch={vi.fn()}
        canCreateSharedBranch={false}
        currentActorOwnsWriteControl={false}
        onToggleWriteControl={vi.fn()}
        canControlWorkItems={false}
        latestSelectedHandoff={null}
        onCreateHandoff={vi.fn()}
        onAcceptLatestHandoff={vi.fn()}
        selectedCompiledStepContext={null}
        workspaceTeamsById={new Map()}
        renderStructuredInputs={(_items, emptyLabel) => <div>{emptyLabel}</div>}
        renderArtifactChecklist={items => <div>{items.length} checklist items</div>}
        renderAgentArtifactExpectations={(_items, emptyLabel) => <div>{emptyLabel}</div>}
        selectedCompiledWorkItemPlan={null}
        selectedArtifacts={[]}
        selectedArtifact={null}
        onOpenArtifactsTab={vi.fn()}
        onSelectArtifactAndOpen={vi.fn()}
        selectedCurrentPhaseStakeholders={[]}
        selectedPhaseStakeholderAssignments={[]}
        getLifecyclePhaseLabelForPhase={() => 'Development'}
        formatPhaseStakeholderLine={stakeholder => stakeholder.name}
        selectedWorkItemTaskTypeLabel="Implementation"
        selectedWorkItemTaskTypeDescription="Implement the requested change."
        runtimeReady
        runtimeError=""
        selectedRequestedInputFields={[]}
        focusGuidanceComposer={vi.fn()}
        onOpenExecutionPolicyConfig={vi.fn()}
        hasMissingWorkspaceInput={false}
        waitRequiresApprovedWorkspace={false}
        hasApprovedWorkspaceConfigured={false}
        approvedWorkspaceRoots={[]}
        approvedWorkspaceDraft=""
        onApprovedWorkspaceDraftChange={vi.fn()}
        onApproveWorkspacePath={vi.fn()}
        activeCapabilityLocalDirectories={[]}
        approvedWorkspaceValidation={null}
        canEditCapability={false}
        selectedCodeDiffArtifactId={undefined}
        selectedCodeDiffArtifact={null}
        selectedCodeDiffRepositoryCount={0}
        selectedCodeDiffTouchedFileCount={0}
        onOpenDiffReview={vi.fn()}
        selectedContrarianReviewTone="neutral"
        selectedContrarianReview={null}
        selectedContrarianReviewIsReady={false}
        renderReviewList={(_items, emptyLabel) => <div>{emptyLabel}</div>}
        selectedCanTakeControl
        onOpenStageControl={onOpenStageControl}
        onOpenStageOwnership={onOpenStageOwnership}
        stageChatSuggestedPrompts={[]}
        onSelectStageChatPrompt={vi.fn()}
        stageChatThreadRef={createRef<HTMLDivElement>()}
        onStageChatScroll={vi.fn()}
        selectedStageChatMessages={[]}
        stageChatDraft=""
        isStageChatSending={false}
        stageChatError=""
        onOpenFullChat={vi.fn()}
        stageChatInput=""
        onStageChatInputChange={vi.fn()}
        onStageChatSend={event => event.preventDefault()}
        canWriteChat={false}
        selectedResetStep={null}
        selectedResetPhase="DEVELOPMENT"
        selectedResetAgentName={null}
        getPhaseMeta={() => ({ label: 'Development' })}
      />,
    );

    expect(screen.getByText('Readiness contract')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Take control' })[0]).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open tasks' }));
    expect(onOpenTaskList).toHaveBeenCalledTimes(1);

    await user.click(screen.getAllByRole('button', { name: 'Take control' })[0]);
    expect(onOpenStageControl).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Stage owner & uploads' }));
    expect(onOpenStageOwnership).toHaveBeenCalledTimes(1);
  });
});
