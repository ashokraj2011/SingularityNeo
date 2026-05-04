import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Loader2,
  PauseCircle,
  PlayCircle,
  PlusCircle,
  Sparkles,
  StickyNote,
  XCircle,
} from "lucide-react";
import { useCapability } from "../../../context/CapabilityContext";
import { useToast } from "../../../context/ToastContext";
import { cn } from "../../../lib/utils";
import {
  cancelBusinessWorkflowInstance,
  fetchBusinessInstance,
  fetchBusinessInstanceEvents,
  fetchBusinessWorkflow,
  listBusinessApprovals,
  listBusinessCustomNodeTypes,
  listBusinessTasks,
  pauseBusinessInstance,
  resumeBusinessInstance,
} from "../../../lib/api";
import { CanvasReadOnly } from "./CanvasReadOnly";
import { InstanceTimeline } from "./InstanceTimeline";
import { ActiveTasksPanel } from "./ActiveTasksPanel";
import { ContextInspector } from "./ContextInspector";
import { NotesPanel } from "./NotesPanel";
import { AdHocTaskDialog } from "./AdHocTaskDialog";
import type {
  BusinessApproval,
  BusinessCustomNodeType,
  BusinessNode,
  BusinessTask,
  BusinessWorkflowEvent,
  BusinessWorkflowInstance,
  BusinessWorkflowVersion,
} from "../../../contracts/businessWorkflow";

/**
 * Instance Dashboard — the V2 centerpiece.
 *
 * Layout:
 *   ┌─ Status bar (template, version, runtime, status pill, actions)
 *   ├─ Body
 *   │  ├─ Left/center: CanvasReadOnly (live graph)
 *   │  └─ Right rail: tabbed (Tasks · Timeline · Context · Notes)
 *
 * Polling strategy:
 *   - Tasks + approvals + instance: refetched every 4s (cheap rows)
 *   - Events: incremental ?since=<lastId> every 4s — typical payload
 *     is empty bytes
 *   - Pause polling when the document is hidden
 *
 * Sync state between canvas and timeline:
 *   `selectedNodeId` lives on this page. Click a node → timeline
 *   filters to that node's events. Click an event → canvas selects
 *   the matching node (and the timeline keeps showing that filter).
 */

type Tab = "tasks" | "timeline" | "context" | "notes";

const POLL_MS = 4000;

export const InstanceDashboard = () => {
  const { templateId, instanceId } = useParams<{
    templateId: string;
    instanceId: string;
  }>();
  const navigate = useNavigate();
  const { activeCapability } = useCapability();
  const { error: toastError, success } = useToast();

  const [instance, setInstance] = useState<BusinessWorkflowInstance | null>(null);
  const [events, setEvents] = useState<BusinessWorkflowEvent[]>([]);
  const [tasks, setTasks] = useState<BusinessTask[]>([]);
  const [approvals, setApprovals] = useState<BusinessApproval[]>([]);
  const [version, setVersion] = useState<BusinessWorkflowVersion | null>(null);
  const [templateName, setTemplateName] = useState<string>("");
  const [customNodeTypes, setCustomNodeTypes] = useState<
    BusinessCustomNodeType[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("tasks");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showAdHoc, setShowAdHoc] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Track the last event id we've consumed so the next poll only
   *  asks for newer events. */
  const lastEventIdRef = useRef<string | null>(null);

  const capabilityId = activeCapability.id;

  // Initial fetch
  useEffect(() => {
    if (!instanceId || !templateId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [instWithEvents, tpl, customs] = await Promise.all([
          fetchBusinessInstance(capabilityId, instanceId),
          fetchBusinessWorkflow(capabilityId, templateId),
          listBusinessCustomNodeTypes(capabilityId, { includeInactive: true }),
        ]);
        if (cancelled) return;
        setInstance(instWithEvents.instance);
        setEvents(instWithEvents.events);
        lastEventIdRef.current =
          instWithEvents.events[instWithEvents.events.length - 1]?.id || null;
        setTemplateName(tpl.template.name);
        const v = tpl.versions.find(
          (x) => x.version === instWithEvents.instance.templateVersion,
        );
        setVersion(v || tpl.versions[0] || null);
        setCustomNodeTypes(customs);
        // Then load tasks + approvals scoped to this instance — the
        // list endpoints don't filter by instance so we filter
        // client-side, which is fine for the row counts we expect.
        const [allTasks, allApprovals] = await Promise.all([
          listBusinessTasks(capabilityId, "OPEN_OR_CLAIMED"),
          listBusinessApprovals(capabilityId, "PENDING_OR_INFO_REQUESTED"),
        ]);
        if (cancelled) return;
        setTasks(allTasks.filter((t) => t.instanceId === instanceId));
        setApprovals(allApprovals.filter((a) => a.instanceId === instanceId));
      } catch (err) {
        toastError(
          "Couldn't load instance",
          err instanceof Error ? err.message : "Unknown error",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [capabilityId, instanceId, templateId, toastError]);

  // Polling — pauses when the tab is hidden
  useEffect(() => {
    if (!instanceId || loading) return;
    let cancelled = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        // 1) Incremental events
        const since = lastEventIdRef.current || undefined;
        const newEvents = await fetchBusinessInstanceEvents(
          capabilityId,
          instanceId,
          since,
        );
        if (!cancelled && newEvents.length > 0) {
          setEvents((prev) => [...prev, ...newEvents]);
          lastEventIdRef.current = newEvents[newEvents.length - 1].id;
        }
        // 2) Refresh instance + active tasks + approvals
        const [instWithEvents, allTasks, allApprovals] = await Promise.all([
          fetchBusinessInstance(capabilityId, instanceId),
          listBusinessTasks(capabilityId, "OPEN_OR_CLAIMED"),
          listBusinessApprovals(capabilityId, "PENDING_OR_INFO_REQUESTED"),
        ]);
        if (cancelled) return;
        setInstance(instWithEvents.instance);
        setTasks(allTasks.filter((t) => t.instanceId === instanceId));
        setApprovals(allApprovals.filter((a) => a.instanceId === instanceId));
      } catch {
        // Polling error: silent — next tick will retry.
      }
    };
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [capabilityId, instanceId, loading]);

  const refresh = useCallback(async () => {
    if (!instanceId) return;
    try {
      const [instWithEvents, allTasks, allApprovals] = await Promise.all([
        fetchBusinessInstance(capabilityId, instanceId),
        listBusinessTasks(capabilityId, "OPEN_OR_CLAIMED"),
        listBusinessApprovals(capabilityId, "PENDING_OR_INFO_REQUESTED"),
      ]);
      setInstance(instWithEvents.instance);
      setEvents(instWithEvents.events);
      lastEventIdRef.current =
        instWithEvents.events[instWithEvents.events.length - 1]?.id || null;
      setTasks(allTasks.filter((t) => t.instanceId === instanceId));
      setApprovals(allApprovals.filter((a) => a.instanceId === instanceId));
    } catch (err) {
      toastError(
        "Refresh failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    }
  }, [capabilityId, instanceId, toastError]);

  const handlePause = async () => {
    if (!instanceId) return;
    setBusy(true);
    try {
      await pauseBusinessInstance(capabilityId, instanceId);
      success("Paused", "Tasks won't accept claims/completions until resumed.");
      await refresh();
    } catch (err) {
      toastError(
        "Pause failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleResume = async () => {
    if (!instanceId) return;
    setBusy(true);
    try {
      await resumeBusinessInstance(capabilityId, instanceId);
      success("Resumed", "Workflow is RUNNING again.");
      await refresh();
    } catch (err) {
      toastError(
        "Resume failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!instanceId) return;
    if (!confirm("Cancel this instance? Open tasks and approvals will be closed.")) {
      return;
    }
    setBusy(true);
    try {
      await cancelBusinessWorkflowInstance(capabilityId, instanceId);
      success("Cancelled", "Instance and all open tasks are now closed.");
      await refresh();
    } catch (err) {
      toastError(
        "Cancel failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setBusy(false);
    }
  };

  const startedAtMs = useMemo(
    () => (instance?.startedAt ? Date.parse(instance.startedAt) : 0),
    [instance?.startedAt],
  );
  const elapsed = useMemo(() => {
    if (!startedAtMs) return "";
    const ms = (instance?.completedAt
      ? Date.parse(instance.completedAt)
      : Date.now()) - startedAtMs;
    if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
    if (ms < 86_400_000)
      return `${Math.floor(ms / 3_600_000)}h ${Math.floor(
        (ms % 3_600_000) / 60_000,
      )}m`;
    return `${Math.floor(ms / 86_400_000)}d`;
  }, [startedAtMs, instance?.completedAt]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-secondary">
        <Loader2 size={14} className="mr-2 animate-spin" />
        Loading instance…
      </div>
    );
  }
  if (!instance || !version) {
    return (
      <div className="p-8 text-center text-sm text-outline">
        Instance not found.
      </div>
    );
  }

  const versionNodes: readonly BusinessNode[] = version.nodes;
  const isTerminal =
    instance.status === "COMPLETED" ||
    instance.status === "CANCELLED" ||
    instance.status === "FAILED";

  const statusTone =
    instance.status === "RUNNING"
      ? "bg-emerald-100 text-emerald-800 ring-emerald-300"
      : instance.status === "PAUSED"
        ? "bg-amber-100 text-amber-800 ring-amber-300 animate-pulse"
        : instance.status === "COMPLETED"
          ? "bg-slate-200 text-slate-700 ring-slate-300"
          : instance.status === "CANCELLED"
            ? "bg-rose-100 text-rose-700 ring-rose-300"
            : "bg-orange-100 text-orange-800 ring-orange-300";

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Status bar */}
      <header className="flex flex-wrap items-center gap-2 border-b border-outline-variant/30 bg-surface-container-low px-4 py-2">
        <button
          type="button"
          onClick={() =>
            navigate(
              `/studio/business-workflows/${encodeURIComponent(
                instance.templateId,
              )}`,
            )
          }
          className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/40 bg-white px-2 py-1 text-[0.7rem] hover:bg-surface-container"
        >
          <ArrowLeft size={11} /> Studio
        </button>
        <div className="min-w-0">
          <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
            Instance · v{instance.templateVersion}
          </p>
          <h1 className="truncate text-sm font-semibold text-on-surface">
            {templateName} <span className="text-outline">·</span>{" "}
            <span className="font-mono text-[0.65rem] text-outline">
              {instance.id}
            </span>
          </h1>
        </div>
        <span
          className={cn(
            "ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase ring-1",
            statusTone,
          )}
        >
          {instance.status}
        </span>
        <span className="text-[0.65rem] text-outline">
          started {new Date(instance.startedAt).toLocaleString()} ·{" "}
          <strong>{instance.startedBy}</strong> · runtime {elapsed}
        </span>

        <div className="ml-auto flex items-center gap-1">
          {!isTerminal && (
            <>
              <button
                type="button"
                onClick={() => setShowAdHoc(true)}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg border border-pink-300 bg-pink-50 px-2 py-1 text-[0.7rem] font-semibold text-pink-700 hover:bg-pink-100 disabled:opacity-60"
                title="Inject an unplanned task on this instance"
              >
                <PlusCircle size={11} /> Ad-hoc
              </button>
              {instance.status === "RUNNING" ? (
                <button
                  type="button"
                  onClick={() => void handlePause()}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[0.7rem] font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-60"
                >
                  <PauseCircle size={11} /> Pause
                </button>
              ) : instance.status === "PAUSED" ? (
                <button
                  type="button"
                  onClick={() => void handleResume()}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-[0.7rem] font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                >
                  <PlayCircle size={11} /> Resume
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void handleCancel()}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-2 py-1 text-[0.7rem] font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
              >
                <XCircle size={11} /> Cancel
              </button>
            </>
          )}
        </div>
      </header>

      {instance.status === "PAUSED" && instance.pausedReason && (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-1 text-[0.7rem] text-amber-800">
          ⏸ Paused: {instance.pausedReason}
          {instance.pausedBy ? ` · by ${instance.pausedBy}` : ""}
        </div>
      )}

      {/* Body: canvas left + right rail */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <CanvasReadOnly
          instance={instance}
          nodes={versionNodes}
          edges={version.edges}
          events={events}
          customNodeTypes={customNodeTypes}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          className="flex-1"
        />

        <aside className="flex w-80 shrink-0 flex-col border-l border-outline-variant/30 bg-surface-container-low">
          {/* Tab strip */}
          <div className="flex shrink-0 border-b border-outline-variant/30 bg-white">
            {(
              [
                { id: "tasks", label: "Tasks", count: tasks.filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED" && t.status !== "SENT_BACK").length + approvals.filter((a) => a.status === "PENDING").length },
                { id: "timeline", label: "Timeline", count: events.length },
                { id: "context", label: "Context" },
                { id: "notes", label: "Notes", count: events.filter((e) => e.eventType === "INSTANCE_NOTE_ADDED").length },
              ] as { id: Tab; label: string; count?: number }[]
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex-1 border-b-2 px-2 py-1.5 text-[0.7rem] font-semibold",
                  tab === t.id
                    ? "border-primary text-primary"
                    : "border-transparent text-secondary hover:text-on-surface",
                )}
              >
                {t.label}
                {t.count != null && t.count > 0 && (
                  <span className="ml-1 rounded-full bg-surface-container px-1 text-[0.55rem] text-outline">
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab body */}
          <div className="flex-1 overflow-y-auto p-2.5">
            {tab === "tasks" && (
              <ActiveTasksPanel
                capabilityId={capabilityId}
                tasks={tasks}
                approvals={approvals}
                templateNodes={versionNodes}
                events={events}
                onChanged={() => void refresh()}
              />
            )}
            {tab === "timeline" && (
              <>
                {selectedNodeId && (
                  <div className="mb-2 flex items-center justify-between rounded-lg bg-primary/10 px-2 py-1 text-[0.65rem]">
                    <span className="text-primary">
                      Filter: <strong>{selectedNodeId}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedNodeId(null)}
                      className="rounded p-0.5 text-primary hover:bg-primary/20"
                    >
                      Clear
                    </button>
                  </div>
                )}
                <InstanceTimeline
                  events={events}
                  filterNodeId={selectedNodeId}
                  onSelectEvent={(e) => {
                    if (e.nodeId) setSelectedNodeId(e.nodeId);
                  }}
                />
              </>
            )}
            {tab === "context" && (
              <ContextInspector
                capabilityId={capabilityId}
                instanceId={instance.id}
                context={instance.context}
                editable={
                  instance.status === "RUNNING" || instance.status === "PAUSED"
                }
                onChanged={() => void refresh()}
              />
            )}
            {tab === "notes" && (
              <NotesPanel
                capabilityId={capabilityId}
                instanceId={instance.id}
                events={events}
                onAdded={() => void refresh()}
              />
            )}
          </div>

          {/* INSTANCE_COMPLETED celebration — small, dismissible by
              navigating away. Shows once per visit. */}
          {instance.status === "COMPLETED" && (
            <div className="border-t border-emerald-200 bg-emerald-50 p-2 text-center text-[0.7rem]">
              <Sparkles size={11} className="mr-1 inline-block text-emerald-600" />
              <strong className="text-emerald-800">
                Instance completed
              </strong>{" "}
              <span className="text-emerald-700">in {elapsed}</span>
            </div>
          )}
        </aside>
      </div>

      {showAdHoc && instanceId && (
        <AdHocTaskDialog
          open
          capabilityId={capabilityId}
          instanceId={instanceId}
          onClose={() => setShowAdHoc(false)}
          onCreated={() => {
            setShowAdHoc(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
};

// suppress unused-import warning on StickyNote (reserved for future
// "Note from operator" inline indicator on the canvas)
void StickyNote;

export default InstanceDashboard;
