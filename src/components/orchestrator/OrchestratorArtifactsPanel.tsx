import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Copy, ExternalLink, FileCode, FileText } from 'lucide-react';
import ArtifactPreview from '../ArtifactPreview';
import { compactMarkdownPreview } from '../../lib/markdown';
import { formatEnumLabel, getStatusTone } from '../../lib/enterprise';
import { cn } from '../../lib/utils';
import {
  type AgentTask,
  type Artifact,
  type ExecutionLog,
} from '../../types';
import {
  type ArtifactWorkbenchFilter,
  formatRelativeTime,
  formatTimestamp,
} from '../../lib/orchestrator/support';
import { StatusBadge } from '../EnterpriseUI';

type Props = {
  filteredArtifacts: Artifact[];
  artifactFilter: ArtifactWorkbenchFilter;
  onArtifactFilterChange: (next: ArtifactWorkbenchFilter) => void;
  selectedArtifact: Artifact | null;
  latestArtifactDocument: string;
  onSelectArtifact: (artifactId: string) => void;
  selectedTasks: AgentTask[];
  selectedLogs: ExecutionLog[];
  onOpenRunConsole: () => void;
  onOpenLedger: () => void;
  onOpenWorkflowDesigner: () => void;
};

export const OrchestratorArtifactsPanel = ({
  filteredArtifacts,
  artifactFilter,
  onArtifactFilterChange,
  selectedArtifact,
  latestArtifactDocument,
  onSelectArtifact,
  selectedTasks,
  selectedLogs,
  onOpenRunConsole,
  onOpenLedger,
  onOpenWorkflowDesigner,
}: Props) => {
  const [tasksOpen, setTasksOpen] = useState(true);
  const [logsOpen, setLogsOpen] = useState(true);

  return (
  <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="workspace-meta-card">
        <p className="workspace-meta-label">Artifacts</p>
        <p className="workspace-meta-value">{filteredArtifacts.length}</p>
        <p className="mt-1 text-xs text-secondary">Captured for the latest run</p>
      </div>
      <div className="workspace-meta-card">
        <p className="workspace-meta-label">Evidence tasks</p>
        <p className="workspace-meta-value">{selectedTasks.length}</p>
        <p className="mt-1 text-xs text-secondary">
          Workflow-managed execution tasks linked to this work item
        </p>
      </div>
      <div className="workspace-meta-card">
        <p className="workspace-meta-label">Latest activity</p>
        <p className="workspace-meta-value">
          {selectedLogs.length > 0
            ? formatRelativeTime(selectedLogs[selectedLogs.length - 1]?.timestamp)
            : 'No logs yet'}
        </p>
        <p className="mt-1 text-xs text-secondary">
          {selectedLogs.length > 0
            ? selectedLogs[selectedLogs.length - 1]?.message
            : 'Execution output will appear here after the run advances.'}
        </p>
      </div>
    </div>

    <div className="orchestrator-artifact-browser">
      <div className="workspace-meta-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="workspace-meta-label">Run artifacts</p>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              Browse every document created for this work item without leaving Work.
            </p>
          </div>
          <StatusBadge tone="info">{filteredArtifacts.length} items</StatusBadge>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {([
            ['ALL', 'All'],
            ['INPUTS', 'Inputs'],
            ['OUTPUTS', 'Outputs'],
            ['DIFFS', 'Diffs'],
            ['APPROVALS', 'Approvals'],
            ['HANDOFFS', 'Handoffs'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onArtifactFilterChange(value)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                artifactFilter === value
                  ? 'border-primary/30 bg-primary text-white'
                  : 'border-outline-variant/30 bg-surface-container-low text-secondary hover:border-primary/20 hover:text-primary',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {filteredArtifacts.length === 0 ? (
          <div className="mt-4 rounded-3xl border border-outline-variant/35 bg-surface-container-low px-4 py-4 text-sm text-secondary">
            No artifacts match the selected filter for this run yet.
          </div>
        ) : (
          <div className="orchestrator-artifact-list">
            {filteredArtifacts.map(artifact => (
              <button
                key={artifact.id}
                type="button"
                onClick={() => onSelectArtifact(artifact.id)}
                className={cn(
                  'orchestrator-artifact-list-item',
                  selectedArtifact?.id === artifact.id &&
                    'orchestrator-artifact-list-item-active',
                )}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="mt-0.5 rounded-2xl bg-primary/10 p-2 text-primary">
                    {artifact.contentFormat === 'MARKDOWN' || artifact.contentFormat === 'TEXT' ? (
                      <FileText size={16} />
                    ) : (
                      <FileCode size={16} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-on-surface">
                        {artifact.name}
                      </p>
                      <StatusBadge tone="brand">{artifact.direction || 'OUTPUT'}</StatusBadge>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-secondary">
                      {compactMarkdownPreview(
                        artifact.summary ||
                          artifact.description ||
                          `${artifact.type} · ${artifact.version}`,
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
      </div>

      <div className="workspace-meta-card orchestrator-preview-panel">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="workspace-meta-label">Artifact preview</p>
            <div className="mt-2 flex items-center gap-2">
              <p className="text-sm font-semibold text-on-surface">
                {selectedArtifact?.name || 'No document selected'}
              </p>
              {selectedArtifact ? (
                <button
                  type="button"
                  title="Copy artifact name"
                  onClick={() => {
                    navigator.clipboard.writeText(selectedArtifact.name).catch(() => {
                      // Clipboard API unavailable (insecure context or permission denied) — silent fail
                    });
                  }}
                  className="rounded-lg p-1 text-secondary transition-colors hover:bg-surface-container hover:text-on-surface"
                >
                  <Copy size={13} />
                </button>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-secondary">
              {selectedArtifact
                ? compactMarkdownPreview(
                    selectedArtifact.summary ||
                      selectedArtifact.description ||
                      `${selectedArtifact.type} · ${selectedArtifact.version}`,
                    160,
                  )
                : 'Select an artifact to inspect its body and summary.'}
            </p>
          </div>
          {selectedArtifact ? (
            <StatusBadge tone="info">{selectedArtifact.contentFormat || 'TEXT'}</StatusBadge>
          ) : null}
        </div>

        <div className="mt-4 rounded-2xl border border-outline-variant/35 bg-white px-5 py-4">
          {latestArtifactDocument ? (
            <ArtifactPreview
              format={selectedArtifact?.contentFormat}
              content={latestArtifactDocument}
            />
          ) : (
            <p className="text-sm leading-relaxed text-secondary">
              The selected artifact does not have a previewable text body yet.
            </p>
          )}
        </div>
      </div>
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      {/* ── Workflow-managed tasks (collapsible) ─────────────────────────── */}
      <div className="workspace-meta-card">
        <button
          type="button"
          onClick={() => setTasksOpen(o => !o)}
          className="flex w-full items-center justify-between gap-2 text-left"
          aria-expanded={tasksOpen}
        >
          <p className="workspace-meta-label">Workflow-managed tasks</p>
          {tasksOpen ? (
            <ChevronUp size={15} className="shrink-0 text-secondary" />
          ) : (
            <ChevronDown size={15} className="shrink-0 text-secondary" />
          )}
        </button>

        {tasksOpen && (
          selectedTasks.length === 0 ? (
            <p className="mt-3 text-sm leading-relaxed text-secondary">
              No workflow-managed tasks are linked to this work item yet.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {selectedTasks.map(task => (
                <div key={task.id} className="orchestrator-step-row">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-on-surface">{task.title}</p>
                    <p className="mt-1 text-xs text-secondary">
                      {task.agent} · {formatEnumLabel(task.status)}
                    </p>
                  </div>
                  <StatusBadge tone={getStatusTone(task.status)}>
                    {formatEnumLabel(task.status)}
                  </StatusBadge>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* ── Recent execution output (collapsible) ────────────────────────── */}
      <div className="workspace-meta-card">
        <button
          type="button"
          onClick={() => setLogsOpen(o => !o)}
          className="flex w-full items-center justify-between gap-2 text-left"
          aria-expanded={logsOpen}
        >
          <p className="workspace-meta-label">Recent execution output</p>
          {logsOpen ? (
            <ChevronUp size={15} className="shrink-0 text-secondary" />
          ) : (
            <ChevronDown size={15} className="shrink-0 text-secondary" />
          )}
        </button>

        {logsOpen && (
          selectedLogs.length === 0 ? (
            <p className="mt-3 text-sm leading-relaxed text-secondary">
              Execution logs will appear here once the step advances.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {selectedLogs.slice(-5).reverse().map(log => (
                <div key={log.id} className="orchestrator-step-row">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-on-surface">{log.message}</p>
                    <p className="mt-1 text-xs text-secondary">
                      {formatTimestamp(log.timestamp)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>

    <div className="workspace-meta-card">
      <p className="workspace-meta-label">Advanced drill-downs</p>
      <div className="orchestrator-link-grid">
        <button
          type="button"
          onClick={onOpenRunConsole}
          className="enterprise-button enterprise-button-secondary justify-between"
        >
          <span>Run Console telemetry</span>
          <ExternalLink size={16} />
        </button>
        <button
          type="button"
          onClick={onOpenLedger}
          className="enterprise-button enterprise-button-secondary justify-between"
        >
          <span>Evidence Ledger</span>
          <ExternalLink size={16} />
        </button>
        <button
          type="button"
          onClick={onOpenWorkflowDesigner}
          className="enterprise-button enterprise-button-secondary justify-between"
        >
          <span>Workflow Designer</span>
          <ExternalLink size={16} />
        </button>
      </div>
    </div>
  </div>
  );
};
