import React from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, FileCode2, ScrollText, Sparkles } from 'lucide-react';
import { formatEnumLabel, getStatusTone } from '../../lib/enterprise';
import { AdvancedDisclosure } from '../WorkspaceUI';
import {
  type RunEvent,
  type RunWait,
  type Workflow,
  type WorkflowRun,
  type WorkflowRunDetail,
  formatTimestamp,
} from '../../lib/orchestrator/support';
import type { CapabilityAgent } from '../../types';
import { StatusBadge } from '../EnterpriseUI';

const PASSPORT_ELIGIBLE: ReadonlySet<string> = new Set([
  'WAITING_APPROVAL',
  'COMPLETED',
  'FAILED',
]);

type Props = {
  capabilityId: string;
  currentRun: WorkflowRun | null;
  selectedOpenWait: RunWait | null;
  previousRunSummary: string | null;
  attemptComparisonLines: string[];
  selectedWorkflow: Workflow | null;
  selectedRunSteps: WorkflowRunDetail['steps'];
  getPhaseMeta: (phase: Workflow['steps'][number]['phase']) => { label: string };
  selectedRunEvents: RunEvent[];
  selectedRunDetail: WorkflowRunDetail | null;
  selectedRunHistory: WorkflowRun[];
  recentRunActivity: RunEvent[];
  agentsById: Map<string, CapabilityAgent>;
  getRunEventTone: (event: RunEvent) => React.ComponentProps<typeof StatusBadge>['tone'];
  getRunEventLabel: (event: RunEvent) => string;
  /** Concatenated LLM token-delta text for the current run (Fix 4 streaming). */
  liveStreamingText: string;
  /** Deduplicated file paths written during the current run (Fix 4 file changes). */
  recentlyChangedFiles: string[];
};

export const OrchestratorAttemptsPanel = ({
  capabilityId,
  currentRun,
  selectedOpenWait,
  previousRunSummary,
  attemptComparisonLines,
  selectedWorkflow,
  selectedRunSteps,
  getPhaseMeta,
  selectedRunEvents,
  selectedRunDetail,
  selectedRunHistory,
  recentRunActivity,
  agentsById,
  getRunEventTone,
  getRunEventLabel,
  liveStreamingText,
  recentlyChangedFiles,
}: Props) => (
  <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="workspace-meta-card">
        <p className="workspace-meta-label">Attempt</p>
        <p className="workspace-meta-value">{currentRun ? currentRun.attemptNumber : 0}</p>
        <p className="mt-1 text-xs text-secondary">
          {currentRun ? formatEnumLabel(currentRun.status) : 'No active run'}
        </p>
      </div>
      <div className="workspace-meta-card">
        <p className="workspace-meta-label">Wait state</p>
        <p className="workspace-meta-value">
          {selectedOpenWait ? formatEnumLabel(selectedOpenWait.type) : 'No open waits'}
        </p>
        <p className="mt-1 text-xs text-secondary">
          {selectedOpenWait
            ? `Opened ${formatTimestamp(selectedOpenWait.createdAt)}`
            : 'Execution is not paused on approval, delegated human work, input, or conflict resolution.'}
        </p>
      </div>
    </div>

    {currentRun && PASSPORT_ELIGIBLE.has(currentRun.status) ? (
      <Link
        to={`/passport/${capabilityId}/${currentRun.id}`}
        className="flex w-full items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
      >
        <span className="flex items-center gap-2">
          <ScrollText size={15} />
          Release Passport
        </span>
        <span className="font-mono text-xs font-normal text-emerald-500">
          {currentRun.status === 'WAITING_APPROVAL' ? 'Awaiting approval' : currentRun.status === 'COMPLETED' ? 'Ready' : 'Review required'}
        </span>
      </Link>
    ) : null}

    <div className="workspace-meta-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="workspace-meta-label">What changed since last attempt?</p>
          <p className="mt-2 text-sm leading-relaxed text-secondary">
            Compare the current run with the previous attempt before restarting or approving.
          </p>
        </div>
        <StatusBadge tone={previousRunSummary ? 'info' : 'neutral'}>
          {previousRunSummary ? 'Comparison ready' : 'First attempt'}
        </StatusBadge>
      </div>

      {attemptComparisonLines.length > 0 ? (
        <ul className="mt-4 space-y-2 text-sm leading-relaxed text-secondary">
          {attemptComparisonLines.map(line => (
            <li key={line} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm leading-relaxed text-secondary">
          {previousRunSummary
            ? 'No major delta was detected yet between the latest two attempts.'
            : 'This work item has only one attempt so far.'}
        </p>
      )}
    </div>

    <div className="space-y-3">
      {(selectedWorkflow?.steps || []).map(step => {
        const runStep =
          selectedRunSteps.find(current => current.workflowStepId === step.id) || null;

        return (
          <div key={step.id} className="orchestrator-step-row">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-on-surface">{step.name}</p>
                <StatusBadge tone={getStatusTone(step.phase)}>
                  {getPhaseMeta(step.phase).label}
                </StatusBadge>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-secondary">{step.action}</p>
              <p className="mt-2 text-xs text-secondary">
                {agentsById.get(step.agentId)?.name || step.agentId} ·{' '}
                {formatEnumLabel(step.stepType)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <StatusBadge tone={getStatusTone(runStep?.status || 'PENDING')}>
                {runStep?.status || 'PENDING'}
              </StatusBadge>
              <span className="text-xs text-secondary">
                {runStep ? `${runStep.attemptCount} attempts` : 'Not started'}
              </span>
              {selectedWorkflow ? (
                <Link
                  to={`/designer?workflowId=${encodeURIComponent(selectedWorkflow.id)}&stepId=${encodeURIComponent(step.id)}`}
                  className="flex items-center gap-1 text-[0.68rem] text-primary hover:underline"
                  title="Open this step in the Workflow Designer"
                >
                  <ExternalLink size={11} />
                  Designer
                </Link>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>

    <AdvancedDisclosure
      title="Advanced execution details"
      description="Run events, tool activity, and worker milestones for deeper operator inspection."
      storageKey="singularity.orchestrator.progress.advanced.open"
      badge={<StatusBadge tone="info">{recentRunActivity.length} updates</StatusBadge>}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="workspace-meta-card">
          <p className="workspace-meta-label">Run events</p>
          <p className="workspace-meta-value">{selectedRunEvents.length}</p>
        </div>
        <div className="workspace-meta-card">
          <p className="workspace-meta-label">Tool actions</p>
          <p className="workspace-meta-value">
            {selectedRunDetail?.toolInvocations.length || 0}
          </p>
        </div>
        <div className="workspace-meta-card">
          <p className="workspace-meta-label">History</p>
          <p className="workspace-meta-value">{selectedRunHistory.length} runs</p>
        </div>
      </div>

      {/* ── Real-time LLM reasoning stream ──────────────────── */}
      {liveStreamingText.length > 0 ? (
        <div className="mt-4 workspace-meta-card">
          <div className="flex items-start gap-2">
            <Sparkles size={14} className="mt-0.5 shrink-0 text-primary" />
            <p className="workspace-meta-label">Live reasoning stream</p>
          </div>
          <p className="mt-2 rounded-xl bg-surface-variant/40 px-3 py-2 font-mono text-[0.72rem] leading-relaxed text-on-surface">
            {/* Show the most recent 600 characters so the card doesn't balloon. */}
            {liveStreamingText.length > 600
              ? `…${liveStreamingText.slice(-600)}`
              : liveStreamingText}
          </p>
        </div>
      ) : null}

      {/* ── Files changed this run ───────────────────────────── */}
      {recentlyChangedFiles.length > 0 ? (
        <div className="mt-4 workspace-meta-card">
          <div className="flex items-start gap-2">
            <FileCode2 size={14} className="mt-0.5 shrink-0 text-primary" />
            <p className="workspace-meta-label">Files changed this run</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {recentlyChangedFiles.map(filePath => (
              <span
                key={filePath}
                className="rounded-full border border-outline-variant/40 bg-white px-3 py-1 font-mono text-[0.7rem] text-on-surface"
                title={filePath}
              >
                {filePath.includes('/') ? filePath.split('/').pop() : filePath}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[0.68rem] text-secondary">
            {recentlyChangedFiles.length} file{recentlyChangedFiles.length !== 1 ? 's' : ''} written ·{' '}
            hover a pill to see the full path
          </p>
        </div>
      ) : null}

      <div className="mt-4 workspace-meta-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="workspace-meta-label">Live agent activity</p>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              Safe execution milestones from the backend worker. This shows visible orchestration
              progress, not private model reasoning.
            </p>
          </div>
          <StatusBadge tone="info">{recentRunActivity.length} recent updates</StatusBadge>
        </div>

        <div className="mt-4 space-y-3">
          {recentRunActivity.length === 0 ? (
            <div className="rounded-2xl border border-outline-variant/35 bg-white px-4 py-4 text-sm text-secondary">
              No live activity is recorded yet for this run.
            </div>
          ) : (
            recentRunActivity.map(event => (
              <div
                key={event.id}
                className="rounded-2xl border border-outline-variant/35 bg-white px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-on-surface">{event.message}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-secondary">
                      <span>{formatTimestamp(event.timestamp)}</span>
                      {typeof event.details?.toolId === 'string' ? (
                        <span>Tool: {formatEnumLabel(event.details.toolId)}</span>
                      ) : null}
                      {typeof event.details?.model === 'string' ? (
                        <span>Model: {event.details.model}</span>
                      ) : null}
                      {typeof event.details?.retrievalCount === 'number' ? (
                        <span>{event.details.retrievalCount} references</span>
                      ) : null}
                      {typeof event.details?.waitType === 'string' ? (
                        <span>Wait: {formatEnumLabel(event.details.waitType)}</span>
                      ) : null}
                    </div>
                  </div>
                  <StatusBadge tone={getRunEventTone(event)}>{getRunEventLabel(event)}</StatusBadge>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </AdvancedDisclosure>
  </div>
);
