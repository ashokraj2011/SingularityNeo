/**
 * Phase C UI — the agent-as-git-author control surface.
 *
 * Self-contained: give it a (capabilityId, workItem) and it takes over
 * fetching the session state, letting the operator:
 *
 *   - Start / re-use a session branch (creates a `agent/wi-<id>-<slug>`
 *     branch on GitHub and a row in `agent_branch_sessions`).
 *   - Commit the most recent CODE_PATCH artifact on the work item to
 *     that branch (calls `commitAgentSessionPatch` which runs the
 *     in-memory patch application server-side + pushes blobs/tree/commit).
 *   - Open a draft pull request from the session branch.
 *   - Close the session when the work is done.
 *
 * This component lives inside `OrchestratorOperatePanel` but deliberately
 * doesn't thread props through the top-level Orchestrator.tsx — it fetches
 * the snapshot itself via `fetchWorkItemAgentGitSnapshot` so Phase C
 * stays additive. The callers only need to render `<AgentGitSessionCard />`
 * with the props listed below.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ExternalLink,
  GitBranch,
  GitCommit,
  GitPullRequest,
  LoaderCircle,
  RefreshCw,
  Rocket,
  XCircle,
} from 'lucide-react';
import {
  closeAgentSession,
  commitAgentSessionPatch,
  fetchWorkItemAgentGitSnapshot,
  openAgentSessionPullRequest,
  startAgentBranchSession,
} from '../../lib/api';
import type {
  AgentBranchCommitResult,
  AgentBranchSession,
  AgentPullRequest,
  WorkItem,
} from '../../types';
import { StatusBadge } from '../EnterpriseUI';

type ActionKey =
  | 'start'
  | 'commit'
  | 'openPr'
  | 'close'
  | 'refresh'
  | null;

interface Props {
  capabilityId: string;
  workItem: Pick<WorkItem, 'id' | 'title' | 'capabilityId'>;
  /** Optional hint shown when there's no linked repo on the capability. */
  hasRepository: boolean;
}

const toneForStatus: Record<AgentBranchSession['status'], 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  ACTIVE: 'success',
  REVIEWING: 'info',
  CLOSED: 'neutral',
  FAILED: 'danger',
};

const toneForPrState: Record<AgentPullRequest['state'], 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  OPEN: 'info',
  MERGED: 'success',
  CLOSED: 'neutral',
};

const formatShortSha = (sha: string | null | undefined): string =>
  sha ? sha.slice(0, 7) : '—';

const AgentGitSessionCard: React.FC<Props> = ({
  capabilityId,
  workItem,
  hasRepository,
}) => {
  const [sessions, setSessions] = useState<AgentBranchSession[]>([]);
  const [pullRequests, setPullRequests] = useState<AgentPullRequest[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState<ActionKey>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [lastCommit, setLastCommit] = useState<AgentBranchCommitResult | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const snapshot = await fetchWorkItemAgentGitSnapshot(
        capabilityId,
        workItem.id,
      );
      setSessions(snapshot.sessions);
      setPullRequests(snapshot.pullRequests);
    } catch (error) {
      setLoadError((error as Error).message || 'Failed to load agent-git state.');
    } finally {
      setLoading(false);
    }
  }, [capabilityId, workItem.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The session we'd act on: the most recent ACTIVE/REVIEWING/FAILED one.
  const activeSession = useMemo<AgentBranchSession | null>(() => {
    for (const session of sessions) {
      if (session.status !== 'CLOSED') return session;
    }
    return null;
  }, [sessions]);

  const prsForActiveSession = useMemo<AgentPullRequest[]>(() => {
    if (!activeSession) return [];
    return pullRequests.filter(pr => pr.sessionId === activeSession.id);
  }, [activeSession, pullRequests]);

  const wrapAction = useCallback(
    async (key: Exclude<ActionKey, null>, work: () => Promise<string | void>) => {
      setActionKey(key);
      setActionMessage(null);
      try {
        const message = await work();
        if (typeof message === 'string' && message.length) {
          setActionMessage(message);
        }
        await refresh();
      } catch (error) {
        setActionMessage((error as Error).message || 'Action failed.');
      } finally {
        setActionKey(null);
      }
    },
    [refresh],
  );

  const handleStart = useCallback(() => {
    void wrapAction('start', async () => {
      const result = await startAgentBranchSession(capabilityId, workItem.id);
      return result.reused
        ? `Re-using existing session on branch ${result.session.branchName}.`
        : `Started session on new branch ${result.session.branchName}.`;
    });
  }, [capabilityId, workItem.id, wrapAction]);

  const handleCommit = useCallback(() => {
    if (!activeSession) return;
    void wrapAction('commit', async () => {
      const result = await commitAgentSessionPatch(
        capabilityId,
        activeSession.id,
      );
      setLastCommit(result);
      return `Committed ${result.filesCommittedCount} file${result.filesCommittedCount === 1 ? '' : 's'} (skipped ${result.filesSkippedCount}).`;
    });
  }, [activeSession, capabilityId, wrapAction]);

  const handleOpenPr = useCallback(() => {
    if (!activeSession) return;
    void wrapAction('openPr', async () => {
      const result = await openAgentSessionPullRequest(
        capabilityId,
        activeSession.id,
        { draft: true },
      );
      return `Opened draft PR #${result.pullRequest.prNumber}.`;
    });
  }, [activeSession, capabilityId, wrapAction]);

  const handleClose = useCallback(() => {
    if (!activeSession) return;
    void wrapAction('close', async () => {
      await closeAgentSession(capabilityId, activeSession.id);
      return 'Session closed.';
    });
  }, [activeSession, capabilityId, wrapAction]);

  const handleRefresh = useCallback(() => {
    void wrapAction('refresh', async () => refresh().then(() => undefined));
  }, [refresh, wrapAction]);

  const disableEverything = actionKey !== null || !hasRepository;

  return (
    <section className="rounded-2xl border border-outline-variant/35 bg-white/90 px-4 py-3 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="workspace-meta-label flex items-center gap-1.5">
            <GitBranch size={14} />
            Agent git session
          </p>
          <p className="mt-1 text-xs text-secondary">
            The agent commits CODE_PATCH artifacts to its own branch, then
            opens a PR when the work item is ready for review.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={actionKey !== null}
          className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
          title="Refresh session state"
        >
          {actionKey === 'refresh' || loading ? (
            <LoaderCircle size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          Refresh
        </button>
      </header>

      {!hasRepository ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Link a primary GitHub repository on the capability before starting
          an agent session.
        </p>
      ) : null}

      {loadError ? (
        <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
          {loadError}
        </p>
      ) : null}

      {/* Session summary */}
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-[0.2em] text-outline">Branch</p>
          <p className="mt-1 truncate font-mono text-xs text-on-surface">
            {activeSession?.branchName || '—'}
          </p>
        </div>
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-[0.2em] text-outline">Head</p>
          <p className="mt-1 flex items-center gap-1.5 font-mono text-xs text-on-surface">
            <GitCommit size={12} />
            {formatShortSha(activeSession?.headSha || null)}
            <span className="text-outline">· {activeSession?.commitsCount ?? 0} commit{activeSession?.commitsCount === 1 ? '' : 's'}</span>
          </p>
        </div>
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-[0.2em] text-outline">Status</p>
          <p className="mt-1">
            {activeSession ? (
              <StatusBadge tone={toneForStatus[activeSession.status]}>
                {activeSession.status}
              </StatusBadge>
            ) : (
              <StatusBadge tone="neutral">Not started</StatusBadge>
            )}
          </p>
        </div>
      </div>

      {/* PR summary */}
      {prsForActiveSession.length ? (
        <ul className="mt-3 space-y-1.5">
          {prsForActiveSession.map(pr => (
            <li
              key={pr.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-outline-variant/30 bg-white px-3 py-2 text-xs"
            >
              <div className="flex items-center gap-2">
                <GitPullRequest size={14} className="text-primary" />
                <span className="font-semibold text-on-surface">
                  #{pr.prNumber}
                </span>
                <span className="truncate text-secondary">{pr.title}</span>
                {pr.isDraft ? (
                  <StatusBadge tone="neutral">Draft</StatusBadge>
                ) : null}
                <StatusBadge tone={toneForPrState[pr.state]}>{pr.state}</StatusBadge>
              </div>
              {pr.htmlUrl ? (
                <a
                  href={pr.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-primary hover:underline"
                >
                  <ExternalLink size={12} />
                  Open on GitHub
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Action buttons */}
      <div className="mt-3 flex flex-wrap gap-2">
        {!activeSession ? (
          <button
            type="button"
            onClick={handleStart}
            disabled={disableEverything}
            className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            {actionKey === 'start' ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <Rocket size={14} />
            )}
            Start session
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handleCommit}
              disabled={disableEverything || activeSession.status === 'CLOSED'}
              className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
              title="Commit the most recent CODE_PATCH artifact to this session branch."
            >
              {actionKey === 'commit' ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <GitCommit size={14} />
              )}
              Commit latest patch
            </button>
            <button
              type="button"
              onClick={handleOpenPr}
              disabled={
                disableEverything ||
                !activeSession.headSha ||
                activeSession.status === 'CLOSED'
              }
              className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
              title={
                activeSession.headSha
                  ? 'Open a draft PR from this session branch.'
                  : 'Commit at least one patch before opening a PR.'
              }
            >
              {actionKey === 'openPr' ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <GitPullRequest size={14} />
              )}
              Open PR
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={disableEverything || activeSession.status === 'CLOSED'}
              className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
              title="Stop accepting further commits on this session."
            >
              {actionKey === 'close' ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <XCircle size={14} />
              )}
              Close session
            </button>
          </>
        )}
      </div>

      {actionMessage ? (
        <p className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          {actionMessage}
        </p>
      ) : null}

      {/* Per-file result rail from the most recent commit */}
      {lastCommit && lastCommit.files.length ? (
        <div className="mt-3 rounded-xl border border-outline-variant/30 bg-surface-container-low px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-[0.2em] text-outline">
            Last commit · {formatShortSha(lastCommit.commitSha)}
          </p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {lastCommit.files.slice(0, 12).map(file => (
              <li
                key={file.path}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate font-mono text-on-surface">{file.path}</span>
                <StatusBadge
                  tone={
                    file.applied
                      ? file.status === 'DELETED'
                        ? 'warning'
                        : 'success'
                      : 'danger'
                  }
                >
                  {file.status}
                </StatusBadge>
              </li>
            ))}
            {lastCommit.files.length > 12 ? (
              <li className="text-outline">
                + {lastCommit.files.length - 12} more…
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </section>
  );
};

export default AgentGitSessionCard;
