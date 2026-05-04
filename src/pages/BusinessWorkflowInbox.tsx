import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Clock, Hand, Loader2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useCapability } from "../context/CapabilityContext";
import { useToast } from "../context/ToastContext";
import {
  claimBusinessTask,
  completeBusinessTask,
  decideBusinessApproval,
  fetchBusinessApproval,
  listBusinessTasks,
} from "../lib/api";
import type {
  ApprovalStatus,
  BusinessApproval,
  BusinessTask,
} from "../contracts/businessWorkflow";
import { cn } from "../lib/utils";

const PRIORITY_TONE: Record<string, string> = {
  LOW: "bg-gray-100 text-gray-700",
  NORMAL: "bg-sky-100 text-sky-800",
  HIGH: "bg-amber-100 text-amber-800",
  URGENT: "bg-rose-100 text-rose-800",
};

const STATUS_TONE: Record<string, string> = {
  OPEN: "bg-emerald-100 text-emerald-800",
  CLAIMED: "bg-violet-100 text-violet-800",
  IN_PROGRESS: "bg-violet-100 text-violet-800",
};

const TaskCard = ({
  task,
  isApproval,
  approval,
  onClaim,
  onComplete,
  onDecide,
}: {
  task: BusinessTask;
  isApproval: boolean;
  approval: BusinessApproval | null;
  onClaim: () => void;
  onComplete: (formData: Record<string, unknown>) => void;
  onDecide: (
    decision: ApprovalStatus,
    notes?: string,
    conditions?: string,
  ) => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [formText, setFormText] = useState("");
  const [decisionNotes, setDecisionNotes] = useState("");
  const [decisionConditions, setDecisionConditions] = useState("");
  const claimed = task.status === "CLAIMED" || task.status === "IN_PROGRESS";

  const renderForm = () => {
    if (!task.formSchema) return null;
    return (
      <label className="mt-2 block text-xs">
        <span className="mb-1 block text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
          Form data (JSON)
        </span>
        <textarea
          value={formText}
          onChange={(e) => setFormText(e.target.value)}
          rows={4}
          className="w-full rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 font-mono text-[0.7rem]"
          placeholder={JSON.stringify(task.formSchema, null, 2)}
        />
      </label>
    );
  };

  const renderApprovalControls = () => (
    <div className="mt-2 space-y-2 rounded-lg border border-outline-variant/30 bg-surface-container-low p-2">
      <input
        type="text"
        placeholder="Conditions (for APPROVED_WITH_CONDITIONS)"
        value={decisionConditions}
        onChange={(e) => setDecisionConditions(e.target.value)}
        className="w-full rounded border border-outline-variant/40 bg-white px-2 py-1 text-xs"
      />
      <textarea
        placeholder="Decision notes (optional)"
        value={decisionNotes}
        onChange={(e) => setDecisionNotes(e.target.value)}
        rows={2}
        className="w-full rounded border border-outline-variant/40 bg-white px-2 py-1 text-xs"
      />
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => onDecide("APPROVED", decisionNotes, undefined)}
          className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[0.65rem] font-semibold text-white hover:bg-emerald-700"
        >
          <Check size={10} /> Approve
        </button>
        <button
          type="button"
          onClick={() =>
            onDecide("APPROVED_WITH_CONDITIONS", decisionNotes, decisionConditions)
          }
          className="inline-flex items-center gap-1 rounded bg-emerald-500 px-2 py-1 text-[0.65rem] font-semibold text-white hover:bg-emerald-600"
        >
          Approve w/ conditions
        </button>
        <button
          type="button"
          onClick={() => onDecide("REJECTED", decisionNotes)}
          className="inline-flex items-center gap-1 rounded bg-rose-600 px-2 py-1 text-[0.65rem] font-semibold text-white hover:bg-rose-700"
        >
          <X size={10} /> Reject
        </button>
        <button
          type="button"
          onClick={() => onDecide("NEEDS_MORE_INFORMATION", decisionNotes)}
          className="rounded bg-amber-500 px-2 py-1 text-[0.65rem] font-semibold text-white hover:bg-amber-600"
        >
          Needs info
        </button>
        <button
          type="button"
          onClick={() => onDecide("DEFERRED", decisionNotes)}
          className="rounded bg-gray-500 px-2 py-1 text-[0.65rem] font-semibold text-white hover:bg-gray-600"
        >
          Defer
        </button>
      </div>
    </div>
  );

  return (
    <div className="rounded-xl border border-outline-variant/40 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate text-sm font-semibold text-on-surface">
            {task.title}
          </p>
          {task.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-secondary">
              {task.description}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[0.62rem] text-outline">
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 font-semibold uppercase",
                PRIORITY_TONE[task.priority] || PRIORITY_TONE.NORMAL,
              )}
            >
              {task.priority}
            </span>
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 font-semibold uppercase",
                STATUS_TONE[task.status] || "bg-gray-100 text-gray-700",
              )}
            >
              {task.status}
            </span>
            {isApproval && (
              <span className="rounded-full bg-violet-100 px-1.5 py-0.5 font-semibold text-violet-800">
                APPROVAL
              </span>
            )}
            {task.dueAt && (
              <span className="inline-flex items-center gap-1">
                <Clock size={9} /> due {new Date(task.dueAt).toLocaleString()}
              </span>
            )}
            <span className="font-mono">{task.id}</span>
          </div>
        </button>
        <div className="flex shrink-0 flex-col gap-1">
          {!claimed && task.status === "OPEN" && (
            <button
              type="button"
              onClick={onClaim}
              className="inline-flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/5 px-2 py-1 text-[0.65rem] font-semibold text-primary hover:bg-primary/10"
            >
              <Hand size={10} /> Claim
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-2 border-t border-outline-variant/30 pt-2">
          {isApproval ? (
            renderApprovalControls()
          ) : (
            <>
              {renderForm()}
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    let parsed: Record<string, unknown> = {};
                    if (formText.trim()) {
                      try {
                        parsed = JSON.parse(formText);
                      } catch {
                        parsed = { raw: formText };
                      }
                    }
                    onComplete(parsed);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                  disabled={!claimed}
                  title={claimed ? "Mark task complete" : "Claim first"}
                >
                  <Check size={12} /> Complete
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

const BusinessWorkflowInbox = () => {
  const navigate = useNavigate();
  const { activeCapability } = useCapability();
  const { error: toastError, success } = useToast();

  const [tasks, setTasks] = useState<BusinessTask[]>([]);
  const [approvals, setApprovals] = useState<Map<string, BusinessApproval>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listBusinessTasks(activeCapability.id, "OPEN_OR_CLAIMED");
      setTasks(list);
    } catch (err) {
      toastError(
        "Could not load tasks",
        err instanceof Error ? err.message : "",
      );
    } finally {
      setLoading(false);
    }
  }, [activeCapability.id, toastError]);

  useEffect(() => {
    void load();
    // Light polling so the inbox reflects new tasks created by advancing
    // workflows without forcing a manual refresh.
    const handle = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(handle);
  }, [load]);

  const handleClaim = async (task: BusinessTask) => {
    try {
      const updated = await claimBusinessTask(activeCapability.id, task.id);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      toastError("Claim failed", err instanceof Error ? err.message : "");
    }
  };

  const handleComplete = async (
    task: BusinessTask,
    formData: Record<string, unknown>,
  ) => {
    try {
      await completeBusinessTask(activeCapability.id, task.id, {
        formData,
        output: formData,
      });
      success("Task completed", `${task.title} done.`);
      await load();
    } catch (err) {
      toastError("Complete failed", err instanceof Error ? err.message : "");
    }
  };

  const handleDecide = async (
    task: BusinessTask,
    decision: ApprovalStatus,
    notes?: string,
    conditions?: string,
  ) => {
    // Approval rows live in `business_approvals`. Find the approval id
    // by walking the recently-fetched approvals map; if missing, hit
    // the API to find one with matching nodeId+instanceId. V1 uses a
    // shortcut: the approval API is keyed by approvalId, so we look up
    // by the convention that a task row for an APPROVAL node carries
    // approval info via its node id. For simplicity we search for the
    // single open approval matching the task's node — fallback to a
    // direct fetch.
    try {
      // Find the approval id from cached map.
      let approvalId: string | undefined;
      approvals.forEach((a) => {
        if (a.instanceId === task.instanceId && a.nodeId === task.nodeId)
          approvalId = a.id;
      });
      if (!approvalId) {
        // Best-effort: V1 cannot list approvals from a known endpoint
        // (no list-approvals route shipped); rely on the task ID being
        // structurally similar to the approval id (they aren't — punt).
        toastError(
          "Approval not loaded",
          "Open the workflow's instance view to act on this approval (or contact admin).",
        );
        return;
      }
      const approval = await decideBusinessApproval(
        activeCapability.id,
        approvalId,
        { decision, notes, conditions },
      );
      setApprovals((prev) => new Map(prev).set(approval.id, approval));
      success("Decided", `Approval ${decision}.`);
      await load();
    } catch (err) {
      toastError("Decide failed", err instanceof Error ? err.message : "");
    }
  };

  // Backfill: when tasks load, we don't have a list-approvals endpoint
  // in V1. The TaskCard shows approval controls only for tasks whose
  // node is an APPROVAL, but in V1 we represent approvals via tasks too —
  // approvals are NOT in the task list (they're in business_approvals).
  // For V1 the inbox shows TASKS only. Approval list = future.
  const enriched = useMemo(
    () =>
      tasks.map((t) => ({
        task: t,
        isApproval: false,
        approval: null as BusinessApproval | null,
      })),
    [tasks],
  );

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate("/studio/business-workflows")}
          className="rounded-lg border border-outline-variant/40 p-1.5 text-secondary hover:text-primary"
          title="Back to designer"
        >
          <ArrowLeft size={14} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-on-surface">My Tasks</h1>
          <p className="mt-0.5 text-sm text-secondary">
            Open business-workflow tasks for {activeCapability.name}.
            Approvals are surfaced via instance views (V1).
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

      {loading ? (
        <div className="flex items-center gap-2 text-secondary">
          <Loader2 size={14} className="animate-spin" /> Loading...
        </div>
      ) : enriched.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-outline-variant/40 bg-surface-container-low p-10 text-center">
          <p className="text-sm font-semibold text-on-surface">
            No open tasks
          </p>
          <p className="text-xs text-secondary">
            Tasks land here when a HUMAN_TASK or FORM_FILL node activates
            in any running business-workflow instance.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {enriched.map(({ task, isApproval, approval }) => (
            <TaskCard
              key={task.id}
              task={task}
              isApproval={isApproval}
              approval={approval}
              onClaim={() => void handleClaim(task)}
              onComplete={(formData) => void handleComplete(task, formData)}
              onDecide={(decision, notes, conditions) =>
                void handleDecide(task, decision, notes, conditions)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default BusinessWorkflowInbox;
