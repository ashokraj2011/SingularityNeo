/**
 * WorkflowRunPreflightDialog.tsx
 *
 * Shown before starting a workflow run that contains one or more HUMAN_APPROVAL
 * or HUMAN_TASK nodes.  Collects an assignee email per human node so the server
 * can store them with the approval-assignments row and surface them in the
 * attention queue.
 *
 * Usage:
 *   <WorkflowRunPreflightDialog
 *     humanNodes={[...]}
 *     onConfirm={(assignments) => startRun(assignments)}
 *     onCancel={() => setOpen(false)}
 *   />
 */
import React, { useState } from 'react';
import { Mail, User, X } from 'lucide-react';
import { ModalShell } from '../EnterpriseUI';
import type { HumanStepAssignment } from '../../types';

export interface PreflightHumanNode {
  nodeId: string;
  nodeLabel: string;
  nodeType: 'HUMAN_APPROVAL' | 'HUMAN_TASK';
}

interface WorkflowRunPreflightDialogProps {
  workflowName: string;
  humanNodes: PreflightHumanNode[];
  onConfirm: (assignments: HumanStepAssignment[]) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function WorkflowRunPreflightDialog({
  workflowName,
  humanNodes,
  onConfirm,
  onCancel,
  isSubmitting = false,
}: WorkflowRunPreflightDialogProps) {
  const [emails, setEmails] = useState<Record<string, string>>(
    Object.fromEntries(humanNodes.map(n => [n.nodeId, ''])),
  );
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const isValid = humanNodes.every(n => EMAIL_RE.test(emails[n.nodeId] ?? ''));

  const handleBlur = (nodeId: string) => {
    setTouched(prev => ({ ...prev, [nodeId]: true }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    const assignments: HumanStepAssignment[] = humanNodes.map(n => ({
      nodeId: n.nodeId,
      nodeLabel: n.nodeLabel,
      nodeType: n.nodeType,
      assigneeEmail: emails[n.nodeId] ?? '',
    }));
    onConfirm(assignments);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg">
        <ModalShell
          eyebrow={workflowName}
          title="Assign human steps"
          description="This workflow contains human task or approval nodes. Please enter an assignee email for each node so the right person is notified when their step is ready."
          actions={
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full p-1.5 text-secondary transition-colors hover:bg-outline-variant/20 hover:text-on-surface"
              aria-label="Cancel"
            >
              <X size={18} />
            </button>
          }
        >
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            {humanNodes.map(node => {
              const email = emails[node.nodeId] ?? '';
              const isNodeValid = EMAIL_RE.test(email);
              const showError = touched[node.nodeId] && !isNodeValid;

              return (
                <div key={node.nodeId} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                        node.nodeType === 'HUMAN_APPROVAL'
                          ? 'bg-fuchsia-100 text-fuchsia-600'
                          : 'bg-rose-100 text-rose-600'
                      }`}
                    >
                      <User size={14} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-on-surface">
                        {node.nodeLabel}
                      </p>
                      <p className="text-[0.6875rem] text-secondary">
                        {node.nodeType === 'HUMAN_APPROVAL' ? 'Human Approval' : 'Human Task'}
                      </p>
                    </div>
                  </div>

                  <div className="relative">
                    <Mail
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-outline"
                    />
                    <input
                      type="email"
                      placeholder="assignee@example.com"
                      value={email}
                      onChange={e =>
                        setEmails(prev => ({ ...prev, [node.nodeId]: e.target.value }))
                      }
                      onBlur={() => handleBlur(node.nodeId)}
                      className={`enterprise-input pl-8 ${showError ? 'border-red-400 focus:ring-red-400/30' : ''}`}
                      required
                    />
                  </div>

                  {showError && (
                    <p className="text-xs text-red-600">Please enter a valid email address.</p>
                  )}
                </div>
              );
            })}

            <div className="flex items-center justify-end gap-3 border-t border-outline-variant/20 pt-4">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-2xl border border-outline-variant/40 px-4 py-2 text-sm font-semibold text-secondary transition-colors hover:border-outline-variant/80 hover:text-on-surface"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!isValid || isSubmitting}
                className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-2 text-sm font-bold text-white shadow-sm transition-all hover:brightness-110 disabled:opacity-50"
              >
                {isSubmitting ? 'Starting…' : 'Start Run'}
              </button>
            </div>
          </form>
        </ModalShell>
      </div>
    </div>
  );
}
