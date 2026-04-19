import React from 'react';
import { X } from 'lucide-react';
import ArtifactPreview from '../ArtifactPreview';
import { type Artifact } from '../../lib/orchestrator/support';
import { ModalShell, StatusBadge } from '../EnterpriseUI';

type Props = {
  selectedCodeDiffArtifact: Artifact | null;
  selectedCodeDiffDocument: string;
  summary: string;
  repositoryCount: number;
  touchedFileCount: number | string;
  onClose: () => void;
};

export const OrchestratorDiffReviewModal = ({
  selectedCodeDiffArtifact,
  selectedCodeDiffDocument,
  summary,
  repositoryCount,
  touchedFileCount,
  onClose,
}: Props) => (
  <div className="desktop-content-modal-overlay px-4 py-16">
    <button
      type="button"
      aria-label="Close diff review"
      onClick={onClose}
      className="desktop-content-modal-backdrop"
    />
    <ModalShell
      title={selectedCodeDiffArtifact?.name || 'Code diff review'}
      description="Review the generated patch in a dedicated surface before approving or sending the work back for changes."
      eyebrow="Diff Review"
      className="relative z-[1] max-w-6xl"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {selectedCodeDiffArtifact ? (
            <StatusBadge tone="info">
              {selectedCodeDiffArtifact.contentFormat || 'TEXT'}
            </StatusBadge>
          ) : null}
          <button type="button" onClick={onClose} className="workspace-list-action">
            <X size={14} />
          </button>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="workspace-meta-card">
            <p className="workspace-meta-label">Summary</p>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              {summary || 'The diff summary is not available yet.'}
            </p>
          </div>
          <div className="workspace-meta-card">
            <p className="workspace-meta-label">Review facts</p>
            <div className="mt-3 space-y-2 text-sm text-secondary">
              <p>
                Repositories: <strong className="text-on-surface">{repositoryCount || 1}</strong>
              </p>
              <p>
                Touched files:{' '}
                <strong className="text-on-surface">
                  {touchedFileCount || 'Tracked in diff'}
                </strong>
              </p>
              <p>
                Wait state: <strong className="text-on-surface">Approval required</strong>
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-outline-variant/35 bg-slate-950 px-5 py-4 text-slate-100 shadow-[0_24px_80px_rgba(12,23,39,0.24)]">
          {selectedCodeDiffArtifact ? (
            <div className="max-h-[70vh] overflow-auto pr-2">
              <ArtifactPreview
                content={selectedCodeDiffDocument}
                format={selectedCodeDiffArtifact.contentFormat}
                emptyLabel="The code diff artifact is still being prepared."
              />
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-slate-200/80">
              The diff artifact is not available in the current snapshot yet.
            </p>
          )}
        </div>
      </div>
    </ModalShell>
  </div>
);
