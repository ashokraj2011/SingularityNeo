import React from 'react';
import {
  AlertCircle,
  ArrowRight,
  LoaderCircle,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ModalShell } from '../EnterpriseUI';
import type { WorkItem, WorkItemPhase } from '../../lib/orchestrator/support';

type OrchestratorQuickActionDialogsProps = {
  phaseMoveRequest: { workItemId: string; targetPhase: WorkItemPhase } | null;
  phaseMoveItem: WorkItem | null;
  phaseMoveNote: string;
  setPhaseMoveNote: (value: string) => void;
  closePhaseMove: () => void;
  handleConfirmPhaseMove: () => Promise<void> | void;
  selectedWorkItem: WorkItem | null;
  isArchiveWorkItemOpen: boolean;
  archiveWorkItemNote: string;
  setArchiveWorkItemNote: (value: string) => void;
  closeArchive: () => void;
  handleArchiveWorkItem: () => Promise<void> | void;
  isRestoreWorkItemOpen: boolean;
  restoreWorkItemNote: string;
  setRestoreWorkItemNote: (value: string) => void;
  closeRestore: () => void;
  handleRestoreWorkItem: () => Promise<void> | void;
  isCancelWorkItemOpen: boolean;
  cancelWorkItemNote: string;
  setCancelWorkItemNote: (value: string) => void;
  closeCancel: () => void;
  handleCancelWorkItem: () => Promise<void> | void;
  actionError: string;
  busyAction: string | null;
  canControlWorkItems: boolean;
  currentActorDisplayName: string;
  getPhaseMeta: (phase?: WorkItemPhase) => { label: string; accent: string };
};

export const OrchestratorQuickActionDialogs = ({
  phaseMoveRequest,
  phaseMoveItem,
  phaseMoveNote,
  setPhaseMoveNote,
  closePhaseMove,
  handleConfirmPhaseMove,
  selectedWorkItem,
  isArchiveWorkItemOpen,
  archiveWorkItemNote,
  setArchiveWorkItemNote,
  closeArchive,
  handleArchiveWorkItem,
  isRestoreWorkItemOpen,
  restoreWorkItemNote,
  setRestoreWorkItemNote,
  closeRestore,
  handleRestoreWorkItem,
  isCancelWorkItemOpen,
  cancelWorkItemNote,
  setCancelWorkItemNote,
  closeCancel,
  handleCancelWorkItem,
  actionError,
  busyAction,
  canControlWorkItems,
  currentActorDisplayName,
  getPhaseMeta,
}: OrchestratorQuickActionDialogsProps) => {
  const navigate = useNavigate();

  return (
    <>
      {phaseMoveRequest && phaseMoveItem && (
        <div className="desktop-content-modal-overlay">
          <button
            type="button"
            aria-label="Close phase change dialog"
            onClick={closePhaseMove}
            className="desktop-content-modal-backdrop"
          />
          <ModalShell
            title={`Move phase · ${phaseMoveItem.title}`}
            eyebrow="Phase Change"
            description="Moving a work item will cancel any in-flight run first, then place the story back onto the selected lifecycle phase."
            className="relative z-[1] w-full max-w-2xl"
            actions={
              <button
                type="button"
                onClick={closePhaseMove}
                className="workspace-list-action"
              >
                <X size={14} />
              </button>
            }
          >
            <div className="space-y-4">
              <div className="workspace-meta-card border-amber-200 bg-amber-50 text-amber-900">
                <p className="text-sm font-semibold">Safety check</p>
                <p className="mt-1 text-sm leading-relaxed">
                  This will cancel the current run (if any) before moving from{' '}
                  <span className="font-semibold">
                    {getPhaseMeta(phaseMoveItem.phase).label}
                  </span>{' '}
                  to{' '}
                  <span className="font-semibold">
                    {getPhaseMeta(phaseMoveRequest.targetPhase).label}
                  </span>
                  .
                </p>
              </div>

              <label className="block space-y-2">
                <span className="field-label">Move note (optional)</span>
                <textarea
                  value={phaseMoveNote}
                  onChange={event => setPhaseMoveNote(event.target.value)}
                  placeholder="Why are we changing phases?"
                  className="field-textarea bg-white"
                />
              </label>

              {actionError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                  {actionError}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closePhaseMove}
                  className="enterprise-button enterprise-button-secondary"
                >
                  Keep current phase
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmPhaseMove()}
                  disabled={busyAction !== null || !canControlWorkItems}
                  className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busyAction === `move-${phaseMoveItem.id}` ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <ArrowRight size={16} />
                  )}
                  Move phase
                </button>
              </div>
            </div>
          </ModalShell>
        </div>
      )}

      {isArchiveWorkItemOpen && selectedWorkItem && selectedWorkItem.status !== 'ARCHIVED' && (
        <div className="desktop-content-modal-overlay z-[93]">
          <button
            type="button"
            aria-label="Close archive work item dialog"
            onClick={closeArchive}
            className="desktop-content-modal-backdrop"
          />
          <ModalShell
            title={`Delete work item · ${selectedWorkItem.title}`}
            eyebrow="Archive Work Item"
            description="Deleting here is a soft delete: we move the work item into Archive and roll back its runs, logs, uploads, evidence packets, and copilot thread. Restore brings it back at the workflow entry step."
            className="relative z-[1] w-full max-w-2xl"
            actions={
              <button
                type="button"
                onClick={closeArchive}
                className="workspace-list-action"
              >
                <X size={14} />
              </button>
            }
          >
            <div className="space-y-4">
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-900">
                This will remove runs, logs, uploaded files, evidence packets, and chat history tied to this work item. Restore brings the work item back, but it starts fresh from the workflow entry step.
              </div>

              {!canControlWorkItems ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
                  <div className="flex items-start gap-3">
                    <AlertCircle size={18} className="mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold">Read-only operator</p>
                      <p className="mt-1 text-sm leading-relaxed">
                        {currentActorDisplayName} does not have{' '}
                        <span className="font-mono">workitem.control</span>. Switch Current
                        Operator in the top bar, or use Login to choose a role that can
                        delete work items.
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            closeArchive();
                            navigate('/login');
                          }}
                          className="enterprise-button enterprise-button-secondary"
                        >
                          <ArrowRight size={16} />
                          Switch operator
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <label className="block space-y-2">
                <span className="field-label">Delete note (optional)</span>
                <textarea
                  value={archiveWorkItemNote}
                  onChange={event => setArchiveWorkItemNote(event.target.value)}
                  placeholder="Why are we deleting (archiving) this work item?"
                  className="field-textarea bg-white"
                />
              </label>

              {actionError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                  {actionError}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeArchive}
                  className="enterprise-button enterprise-button-secondary"
                >
                  Keep work item
                </button>
                <button
                  type="button"
                  onClick={() => void handleArchiveWorkItem()}
                  disabled={busyAction !== null || !canControlWorkItems}
                  className="enterprise-button enterprise-button-danger disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busyAction === 'archiveWorkItem' ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <Trash2 size={16} />
                  )}
                  Delete and archive
                </button>
              </div>
            </div>
          </ModalShell>
        </div>
      )}

      {isRestoreWorkItemOpen && selectedWorkItem && selectedWorkItem.status === 'ARCHIVED' && (
        <div className="desktop-content-modal-overlay z-[93]">
          <button
            type="button"
            aria-label="Close restore work item dialog"
            onClick={closeRestore}
            className="desktop-content-modal-backdrop"
          />
          <ModalShell
            title={`Restore work item · ${selectedWorkItem.title}`}
            eyebrow="Restore From Archive"
            description="Restoring brings the work item back to its initial phase so you can restart execution."
            className="relative z-[1] w-full max-w-2xl"
            actions={
              <button
                type="button"
                onClick={closeRestore}
                className="workspace-list-action"
              >
                <X size={14} />
              </button>
            }
          >
            <div className="space-y-4">
              {!canControlWorkItems ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
                  <div className="flex items-start gap-3">
                    <AlertCircle size={18} className="mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold">Read-only operator</p>
                      <p className="mt-1 text-sm leading-relaxed">
                        {currentActorDisplayName} does not have{' '}
                        <span className="font-mono">workitem.control</span>. Switch Current
                        Operator in the top bar, or use Login to choose a role that can
                        restore work items.
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            closeRestore();
                            navigate('/login');
                          }}
                          className="enterprise-button enterprise-button-secondary"
                        >
                          <ArrowRight size={16} />
                          Switch operator
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <label className="block space-y-2">
                <span className="field-label">Restore note (optional)</span>
                <textarea
                  value={restoreWorkItemNote}
                  onChange={event => setRestoreWorkItemNote(event.target.value)}
                  placeholder="Any context for why we are restoring?"
                  className="field-textarea bg-white"
                />
              </label>

              {actionError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                  {actionError}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeRestore}
                  className="enterprise-button enterprise-button-secondary"
                >
                  Keep archived
                </button>
                <button
                  type="button"
                  onClick={() => void handleRestoreWorkItem()}
                  disabled={busyAction !== null || !canControlWorkItems}
                  className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busyAction === 'restoreWorkItem' ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <RefreshCw size={16} />
                  )}
                  Restore work item
                </button>
              </div>
            </div>
          </ModalShell>
        </div>
      )}

      {isCancelWorkItemOpen && selectedWorkItem ? (
        <div className="desktop-content-modal-overlay z-[93]">
          <button
            type="button"
            aria-label="Close cancel work item dialog"
            onClick={closeCancel}
            className="desktop-content-modal-backdrop"
          />
          <ModalShell
            title={`Cancel work item · ${selectedWorkItem.title}`}
            eyebrow="Cancel Work Item"
            description="Cancel rolls the work item back to the first executable step in the workflow and clears runs, logs, uploads, evidence packets, and copilot thread so you can start fresh."
            className="relative z-[1] w-full max-w-2xl"
            actions={
              <button
                type="button"
                onClick={closeCancel}
                className="workspace-list-action"
              >
                <X size={14} />
              </button>
            }
          >
            <div className="space-y-4">
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-900">
                This will wipe attempts, uploaded files, evidence packets, and chat history for this work item. The title and description stay, and the work item returns to the first workflow step after cancel.
              </div>

              {!canControlWorkItems ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
                  <div className="flex items-start gap-3">
                    <AlertCircle size={18} className="mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold">Read-only operator</p>
                      <p className="mt-1 text-sm leading-relaxed">
                        {currentActorDisplayName} does not have{' '}
                        <span className="font-mono">workitem.control</span>. Switch Current
                        Operator in the top bar, or use Login to choose a role that can
                        cancel work items.
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            closeCancel();
                            navigate('/login');
                          }}
                          className="enterprise-button enterprise-button-secondary"
                        >
                          <ArrowRight size={16} />
                          Switch operator
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <label className="block space-y-2">
                <span className="field-label">Cancel note (optional)</span>
                <textarea
                  value={cancelWorkItemNote}
                  onChange={event => setCancelWorkItemNote(event.target.value)}
                  placeholder="Why are we cancelling this work item?"
                  className="field-textarea bg-white"
                />
              </label>

              {actionError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                  {actionError}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeCancel}
                  className="enterprise-button enterprise-button-secondary"
                >
                  Keep work item
                </button>
                <button
                  type="button"
                  onClick={() => void handleCancelWorkItem()}
                  disabled={busyAction !== null || !canControlWorkItems}
                  className="enterprise-button enterprise-button-danger disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busyAction === 'cancelWorkItem' ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <X size={16} />
                  )}
                  Cancel work item
                </button>
              </div>
            </div>
          </ModalShell>
        </div>
      ) : null}
    </>
  );
};
