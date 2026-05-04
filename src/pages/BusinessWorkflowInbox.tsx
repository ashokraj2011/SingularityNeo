import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Flag,
  Hand,
  Inbox,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useCapability } from "../context/CapabilityContext";
import { useToast } from "../context/ToastContext";
import {
  claimBusinessTask,
  completeBusinessTask,
  decideBusinessApproval,
  fetchBusinessInstance,
  fetchBusinessWorkflow,
  listBusinessApprovals,
  listBusinessTasks,
} from "../lib/api";
import { getCurrentWorkspaceUser } from "../lib/workspaceOrganization";
import type {
  ApprovalStatus,
  BusinessApproval,
  BusinessNode,
  BusinessTask,
  BusinessWorkflowEvent,
  TaskPriority,
} from "../contracts/businessWorkflow";
import { cn } from "../lib/utils";
import { SlaChip } from "./businessWorkflow/runtime/components/SlaChip";
import { PriorityBadge } from "./businessWorkflow/runtime/components/PriorityBadge";
import { DocumentsCountChip } from "./businessWorkflow/runtime/components/DocumentsCountChip";
import { ReassignPopover } from "./businessWorkflow/runtime/ReassignPopover";
import { SendBackPanel } from "./businessWorkflow/runtime/SendBackPanel";
import { TaskCompletionDialog } from "./businessWorkflow/runtime/TaskCompletionDialog";

/**
 * Tabbed inbox.
 *
 * Tabs:
 *   My tasks    → claimed by me OR DIRECT_USER assigned to me OR
 *                 ROLE_BASED matching one of my workspace roles
 *   Team queue  → TEAM_QUEUE assigned to a team I'm a member of
 *   Approvals   → PENDING approvals (filtered to those I can act on
 *                 by the same rules as tasks)
 *   Ad-hoc      → tasks with is_ad_hoc=true (I created them or they
 *                 were assigned to me)
 *
 * Each row carries SLA chip + priority badge + Claim / Complete /
 * Send-back / Reassign actions (matches the dashboard's
 * ActiveTasksPanel exactly so the operator's muscle memory works in
 * both places).
 *
 * Polling: 8s. Pauses when document.hidden.
 */

type Tab = "my" | "team" | "approvals" | "adhoc";

const POLL_MS = 8000;

const BusinessWorkflowInbox = () => {
  const navigate = useNavigate();
  const { activeCapability, workspaceOrganization } = useCapability();
  const { error: toastError, success } = useToast();

  const me = useMemo(
    () => getCurrentWorkspaceUser(workspaceOrganization),
    [workspaceOrganization],
  );
  const myTeamIds = useMemo(() => new Set(me?.teamIds || []), [me]);
  const myRoles = useMemo(() => new Set(me?.workspaceRoles || []), [me]);

  const [tasks, setTasks] = useState<BusinessTask[]>([]);
  const [approvals, setApprovals] = useState<BusinessApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("my");

  // For send-back we need the pinned-version nodes + events of the
  // affected instance. Cache per-instance lookups so we don't re-fetch
  // on every popover open.
  const [instanceLookup, setInstanceLookup] = useState<
    Record<
      string,
      {
        nodes: readonly BusinessNode[];
        events: readonly BusinessWorkflowEvent[];
      }
    >
  >({});

  const [reassignTarget, setReassignTarget] = useState<
    | { kind: "task"; task: BusinessTask }
    | { kind: "approval"; approval: BusinessApproval }
    | null
  >(null);
  const [sendBackTarget, setSendBackTarget] = useState<
    | { kind: "task"; task: BusinessTask }
    | { kind: "approval"; approval: BusinessApproval }
    | null
  >(null);
  const [completeTarget, setCompleteTarget] = useState<BusinessTask | null>(
    null,
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  const capabilityId = activeCapability.id;

  const load = useCallback(async () => {
    try {
      const [t, a] = await Promise.all([
        listBusinessTasks(capabilityId, "OPEN_OR_CLAIMED"),
        listBusinessApprovals(capabilityId, "PENDING_OR_INFO_REQUESTED"),
      ]);
      setTasks(t);
      setApprovals(a);
    } catch (err) {
      toastError(
        "Could not load inbox",
        err instanceof Error ? err.message : "",
      );
    }
  }, [capabilityId, toastError]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void load().finally(() => {
      if (!cancelled) setLoading(false);
    });
    const id = setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [load]);

  /** Resolve nodes+events for a given instance (cached).
   *
   *  For send-back the panel needs both: the events log to derive
   *  "where can I rewind to" (previously-completed nodes) AND the
   *  pinned version's nodes so we can render labels. We fetch both
   *  and cache by instanceId so opening the popover twice is cheap. */
  const ensureInstanceData = useCallback(
    async (instanceId: string) => {
      if (instanceLookup[instanceId]) return instanceLookup[instanceId];
      try {
        const inst = await fetchBusinessInstance(capabilityId, instanceId);
        const tpl = await fetchBusinessWorkflow(
          capabilityId,
          inst.instance.templateId,
        );
        const version = tpl.versions.find(
          (v) => v.version === inst.instance.templateVersion,
        );
        const data = {
          nodes: (version?.nodes || []) as readonly BusinessNode[],
          events: inst.events,
        };
        setInstanceLookup((prev) => ({ ...prev, [instanceId]: data }));
        return data;
      } catch {
        return { nodes: [], events: [] };
      }
    },
    [capabilityId, instanceLookup],
  );

  // ── Tab filtering ────────────────────────────────────────────────────────

  const tasksMatchingMe = (t: BusinessTask): boolean => {
    if (t.claimedBy && me?.id && t.claimedBy === me.id) return true;
    if (t.assignmentMode === "DIRECT_USER" && t.assignedUserId === me?.id)
      return true;
    if (t.assignmentMode === "ROLE_BASED" && t.assignedRole) {
      // Role names in workspace roles are uppercase; assignedRole is a
      // free string but conventionally also uppercase.
      if (myRoles.has(t.assignedRole as never)) return true;
    }
    return false;
  };

  const tasksMatchingMyTeam = (t: BusinessTask): boolean => {
    if (t.assignmentMode !== "TEAM_QUEUE") return false;
    if (!t.assignedTeamId) return false;
    return myTeamIds.has(t.assignedTeamId);
  };

  const approvalsMatchingMe = (a: BusinessApproval): boolean => {
    if (a.assignedUserId && a.assignedUserId === me?.id) return true;
    if (a.assignedRole && myRoles.has(a.assignedRole as never)) return true;
    if (a.assignedTeamId && myTeamIds.has(a.assignedTeamId)) return true;
    return false;
  };

  const myTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          !t.isAdHoc &&
          tasksMatchingMe(t) &&
          (t.status === "OPEN" ||
            t.status === "CLAIMED" ||
            t.status === "IN_PROGRESS"),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, me, myRoles],
  );

  const teamTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          !t.isAdHoc &&
          tasksMatchingMyTeam(t) &&
          (t.status === "OPEN" || t.status === "CLAIMED"),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, myTeamIds],
  );

  const myApprovals = useMemo(
    () => approvals.filter(approvalsMatchingMe),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [approvals, me, myRoles, myTeamIds],
  );

  const adHocTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.isAdHoc &&
          (tasksMatchingMe(t) || (me?.id && t.createdBy === me.id)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, me, myRoles],
  );

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleClaim = async (t: BusinessTask) => {
    setBusyId(t.id);
    try {
      await claimBusinessTask(capabilityId, t.id);
      success("Claimed", t.title);
      await load();
    } catch (err) {
      toastError(
        "Claim failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleComplete = async (t: BusinessTask) => {
    // Schemaless tasks (no formSchema, no send-back history) submit
    // empty in one click — fast path. Anything else opens the
    // form-fill dialog. Same UX as the dashboard's ActiveTasksPanel.
    if (t.formSchema || t.sentBackFromNodeId) {
      setCompleteTarget(t);
      return;
    }
    setBusyId(t.id);
    try {
      await completeBusinessTask(capabilityId, t.id, {});
      success("Completed", t.title);
      await load();
    } catch (err) {
      toastError(
        "Complete failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleDecide = async (a: BusinessApproval, decision: ApprovalStatus) => {
    setBusyId(a.id);
    try {
      await decideBusinessApproval(capabilityId, a.id, { decision });
      success("Decided", `${decision} on approval at ${a.nodeId}`);
      await load();
    } catch (err) {
      toastError(
        "Decide failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setBusyId(null);
    }
  };

  const openSendBack = async (
    target:
      | { kind: "task"; task: BusinessTask }
      | { kind: "approval"; approval: BusinessApproval },
  ) => {
    const instanceId =
      target.kind === "task"
        ? target.task.instanceId
        : target.approval.instanceId;
    await ensureInstanceData(instanceId);
    setSendBackTarget(target);
  };

  // ── Render helpers ───────────────────────────────────────────────────────

  const renderTaskRow = (t: BusinessTask) => {
    const busy = busyId === t.id;
    const claimed = t.status === "CLAIMED" || t.status === "IN_PROGRESS";
    return (
      <li
        key={t.id}
        className={cn(
          "rounded-xl border bg-white p-3",
          t.isAdHoc
            ? "border-pink-300 bg-pink-50/40"
            : "border-outline-variant/40",
        )}
      >
        <div className="flex items-start gap-2">
          <Hand size={14} className="mt-0.5 shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-on-surface">
              {t.title}
            </p>
            {t.description && (
              <p className="mt-0.5 line-clamp-2 text-[0.7rem] text-secondary">
                {t.description}
              </p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <SlaChip dueAt={t.dueAt} size="xs" />
              <PriorityBadge priority={t.priority as TaskPriority} size="xs" />
              <DocumentsCountChip count={t.documentsCount} />
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase ring-1",
                  t.status === "OPEN"
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-300"
                    : t.status === "CLAIMED" || t.status === "IN_PROGRESS"
                      ? "bg-violet-50 text-violet-700 ring-violet-300"
                      : "bg-slate-100 text-slate-600 ring-slate-300",
                )}
              >
                {t.status}
              </span>
              {t.isAdHoc && (
                <span className="rounded-full bg-pink-100 px-1.5 py-0.5 text-[0.55rem] font-semibold text-pink-700 ring-1 ring-pink-300">
                  ad-hoc{t.adHocBlocking ? " · blocking" : ""}
                </span>
              )}
              {t.sentBackFromNodeId && (
                <span
                  className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[0.55rem] font-semibold text-amber-800 ring-1 ring-amber-300"
                  title={t.sentBackReason || "Sent back"}
                >
                  sent back
                </span>
              )}
              {t.claimedBy && (
                <span className="text-[0.62rem] text-outline">
                  claimed by <strong>{t.claimedBy}</strong>
                </span>
              )}
              <Link
                to={`/studio/business-workflows/${encodeURIComponent("")}/instances/${encodeURIComponent(t.instanceId)}`}
                onClick={(e) => {
                  // We don't know the templateId here without another
                  // fetch; deep-link to instance via :templateId-less
                  // path — InstanceDashboard's URL needs templateId so
                  // we resolve via fetchBusinessInstance first.
                  e.preventDefault();
                  fetchBusinessInstance(capabilityId, t.instanceId)
                    .then((data) => {
                      navigate(
                        `/studio/business-workflows/${encodeURIComponent(
                          data.instance.templateId,
                        )}/instances/${encodeURIComponent(t.instanceId)}`,
                      );
                    })
                    .catch(() => {
                      toastError("Could not open instance", "");
                    });
                }}
                className="ml-auto text-[0.6rem] text-primary hover:underline"
              >
                View instance →
              </Link>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {t.status === "OPEN" && (
                <button
                  type="button"
                  onClick={() => void handleClaim(t)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/40 bg-white px-2 py-1 text-[0.65rem] font-semibold hover:bg-surface-container disabled:opacity-60"
                >
                  {busy ? (
                    <Loader2 size={9} className="animate-spin" />
                  ) : (
                    <Flag size={10} />
                  )}
                  Claim
                </button>
              )}
              {(claimed || t.status === "OPEN") && (
                <button
                  type="button"
                  onClick={() => void handleComplete(t)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-lg bg-primary px-2 py-1 text-[0.65rem] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
                >
                  {busy ? (
                    <Loader2 size={9} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={10} />
                  )}
                  Complete
                </button>
              )}
              {!t.isAdHoc && (
                <button
                  type="button"
                  onClick={() => void openSendBack({ kind: "task", task: t })}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[0.65rem] font-semibold text-amber-800 hover:bg-amber-100"
                >
                  <RotateCcw size={10} /> Send back
                </button>
              )}
              <button
                type="button"
                onClick={() => setReassignTarget({ kind: "task", task: t })}
                className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/40 bg-white px-2 py-1 text-[0.65rem] font-semibold hover:bg-surface-container"
              >
                <UserPlus size={10} /> Reassign
              </button>
            </div>
          </div>
        </div>
      </li>
    );
  };

  const renderApprovalRow = (a: BusinessApproval) => {
    const busy = busyId === a.id;
    return (
      <li
        key={a.id}
        className="rounded-xl border border-indigo-300 bg-indigo-50/40 p-3"
      >
        <div className="flex items-start gap-2">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-indigo-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-on-surface">
              Approval at <span className="font-mono">{a.nodeId}</span>
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.62rem] text-outline">
              <SlaChip dueAt={a.dueAt} size="xs" />
              {a.assignedUserId && <span>→ user {a.assignedUserId}</span>}
              {a.assignedTeamId && <span>→ team {a.assignedTeamId}</span>}
              {a.assignedRole && <span>→ role {a.assignedRole}</span>}
              <span className="font-mono">instance {a.instanceId}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => void handleDecide(a, "APPROVED")}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-[0.65rem] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 size={9} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={10} />
                )}
                Approve
              </button>
              <button
                type="button"
                onClick={() => void handleDecide(a, "REJECTED")}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-2 py-1 text-[0.65rem] font-semibold text-rose-700 hover:bg-rose-100"
              >
                <XCircle size={10} /> Reject
              </button>
              <button
                type="button"
                onClick={() =>
                  void openSendBack({ kind: "approval", approval: a })
                }
                className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[0.65rem] font-semibold text-amber-800 hover:bg-amber-100"
              >
                <RotateCcw size={10} /> Send back
              </button>
              <button
                type="button"
                onClick={() =>
                  setReassignTarget({ kind: "approval", approval: a })
                }
                className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/40 bg-white px-2 py-1 text-[0.65rem] font-semibold hover:bg-surface-container"
              >
                <UserPlus size={10} /> Reassign
              </button>
            </div>
          </div>
        </div>
      </li>
    );
  };

  // ── Layout ───────────────────────────────────────────────────────────────

  const tabs: { id: Tab; label: string; Icon: typeof Hand; count: number }[] = [
    { id: "my", label: "My tasks", Icon: Hand, count: myTasks.length },
    { id: "team", label: "Team queue", Icon: Users, count: teamTasks.length },
    {
      id: "approvals",
      label: "Approvals",
      Icon: ShieldCheck,
      count: myApprovals.length,
    },
    {
      id: "adhoc",
      label: "Ad-hoc",
      Icon: Sparkles,
      count: adHocTasks.length,
    },
  ];

  const visibleRows =
    tab === "my"
      ? myTasks
      : tab === "team"
        ? teamTasks
        : tab === "adhoc"
          ? adHocTasks
          : [];
  const visibleApprovals = tab === "approvals" ? myApprovals : [];

  const sendBackInstanceId =
    sendBackTarget?.kind === "task"
      ? sendBackTarget.task.instanceId
      : sendBackTarget?.kind === "approval"
        ? sendBackTarget.approval.instanceId
        : null;
  const sendBackData = sendBackInstanceId
    ? instanceLookup[sendBackInstanceId]
    : undefined;

  return (
    <div className="flex h-full flex-col gap-3 p-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate("/studio/business-workflows")}
          className="rounded-lg border border-outline-variant/40 p-1.5 text-secondary hover:text-primary"
          title="Back to designer"
        >
          <ArrowLeft size={14} />
        </button>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-on-surface">Inbox</h1>
          <p className="mt-0.5 text-xs text-secondary">
            Business-workflow tasks &amp; approvals for{" "}
            <strong>{activeCapability.name}</strong>.
            {me ? (
              <>
                {" "}
                Showing as <strong>{me.name}</strong>.
              </>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto rounded-lg border border-outline-variant/40 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-surface-container"
        >
          Refresh
        </button>
      </div>

      {/* Tab strip */}
      <div className="flex flex-wrap gap-1 border-b border-outline-variant/30">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "inline-flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-xs font-semibold",
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-secondary hover:text-on-surface",
            )}
          >
            <t.Icon size={12} />
            {t.label}
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[0.55rem]",
                tab === t.id
                  ? "bg-primary/15 text-primary"
                  : "bg-surface-container text-outline",
              )}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex items-center gap-2 text-secondary">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : visibleRows.length === 0 && visibleApprovals.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-outline-variant/40 bg-surface-container-low p-10 text-center">
          <Inbox size={20} className="text-outline" />
          <p className="text-sm font-semibold text-on-surface">
            Nothing in this tab.
          </p>
          <p className="text-xs text-secondary">
            {tab === "my" &&
              "Tasks claimed by you, or directly assigned to your user/role, land here."}
            {tab === "team" &&
              "Tasks queued to a team you're a member of land here."}
            {tab === "approvals" &&
              "Pending approvals for your user, role, or team land here."}
            {tab === "adhoc" &&
              "Ad-hoc tasks you created or own land here."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2 overflow-y-auto">
          {visibleRows.map(renderTaskRow)}
          {visibleApprovals.map(renderApprovalRow)}
        </ul>
      )}

      {reassignTarget && (
        <ReassignPopover
          open
          capabilityId={capabilityId}
          target={reassignTarget}
          onClose={() => setReassignTarget(null)}
          onReassigned={() => {
            setReassignTarget(null);
            void load();
          }}
        />
      )}
      {sendBackTarget && sendBackData && (
        <SendBackPanel
          open
          capabilityId={capabilityId}
          target={sendBackTarget}
          templateNodes={sendBackData.nodes}
          events={sendBackData.events}
          onClose={() => setSendBackTarget(null)}
          onSent={() => {
            setSendBackTarget(null);
            void load();
          }}
        />
      )}
      {completeTarget && (
        <TaskCompletionDialog
          open
          capabilityId={capabilityId}
          task={completeTarget}
          onClose={() => setCompleteTarget(null)}
          onCompleted={() => {
            setCompleteTarget(null);
            void load();
          }}
        />
      )}
    </div>
  );
};

export default BusinessWorkflowInbox;
