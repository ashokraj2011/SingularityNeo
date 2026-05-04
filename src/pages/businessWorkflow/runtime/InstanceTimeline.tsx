import { useMemo, useState } from "react";
import {
  AlarmClockOff,
  ArrowRightLeft,
  Bell,
  CheckCircle2,
  CircleDot,
  Cpu,
  FileText,
  Flag,
  Play,
  PauseCircle,
  PlayCircle,
  RotateCcw,
  Sparkles,
  StickyNote,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../../lib/utils";
import type {
  BusinessWorkflowEvent,
  BusinessWorkflowEventType,
} from "../../../contracts/businessWorkflow";

/**
 * Visual metadata per event type.
 *
 * The icon + tone is reused on the canvas's per-node halo when the
 * dashboard syncs selection ("show me the events at this node"). One
 * map, one source of truth for what "TASK_SENT_BACK" looks like.
 */
const EVENT_META: Record<
  BusinessWorkflowEventType,
  { Icon: LucideIcon; tone: string; label: string }
> = {
  INSTANCE_STARTED: {
    Icon: Play,
    tone: "text-sky-700 bg-sky-50 ring-sky-200",
    label: "Instance started",
  },
  NODE_ACTIVATED: {
    Icon: CircleDot,
    tone: "text-emerald-700 bg-emerald-50 ring-emerald-200",
    label: "Node activated",
  },
  NODE_COMPLETED: {
    Icon: CheckCircle2,
    tone: "text-slate-700 bg-slate-50 ring-slate-200",
    label: "Node completed",
  },
  TASK_CLAIMED: {
    Icon: Flag,
    tone: "text-violet-700 bg-violet-50 ring-violet-200",
    label: "Task claimed",
  },
  TASK_COMPLETED: {
    Icon: CheckCircle2,
    tone: "text-slate-700 bg-slate-50 ring-slate-200",
    label: "Task completed",
  },
  APPROVAL_DECIDED: {
    Icon: CheckCircle2,
    tone: "text-indigo-700 bg-indigo-50 ring-indigo-200",
    label: "Approval decided",
  },
  INSTANCE_COMPLETED: {
    Icon: CheckCircle2,
    tone: "text-emerald-800 bg-emerald-100 ring-emerald-300",
    label: "Instance completed",
  },
  INSTANCE_CANCELLED: {
    Icon: XCircle,
    tone: "text-rose-700 bg-rose-50 ring-rose-200",
    label: "Instance cancelled",
  },
  AGENT_DELEGATED: {
    Icon: Cpu,
    tone: "text-fuchsia-700 bg-fuchsia-50 ring-fuchsia-200",
    label: "Agent delegated",
  },
  NOTIFICATION_SENT: {
    Icon: Bell,
    tone: "text-blue-700 bg-blue-50 ring-blue-200",
    label: "Notification sent",
  },
  TASK_SENT_BACK: {
    Icon: RotateCcw,
    tone: "text-amber-700 bg-amber-50 ring-amber-300",
    label: "Task sent back",
  },
  APPROVAL_SENT_BACK: {
    Icon: RotateCcw,
    tone: "text-amber-700 bg-amber-50 ring-amber-300",
    label: "Approval sent back",
  },
  TASK_REASSIGNED: {
    Icon: ArrowRightLeft,
    tone: "text-violet-700 bg-violet-50 ring-violet-200",
    label: "Task reassigned",
  },
  APPROVAL_REASSIGNED: {
    Icon: ArrowRightLeft,
    tone: "text-violet-700 bg-violet-50 ring-violet-200",
    label: "Approval reassigned",
  },
  AD_HOC_TASK_CREATED: {
    Icon: Sparkles,
    tone: "text-pink-700 bg-pink-50 ring-pink-200",
    label: "Ad-hoc task created",
  },
  INSTANCE_PAUSED: {
    Icon: PauseCircle,
    tone: "text-amber-700 bg-amber-50 ring-amber-300",
    label: "Instance paused",
  },
  INSTANCE_RESUMED: {
    Icon: PlayCircle,
    tone: "text-emerald-700 bg-emerald-50 ring-emerald-200",
    label: "Instance resumed",
  },
  INSTANCE_NOTE_ADDED: {
    Icon: StickyNote,
    tone: "text-slate-700 bg-slate-50 ring-slate-200",
    label: "Note",
  },
};

const formatRelative = (iso: string, now: number): string => {
  const ms = now - Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const s = Math.floor(ms / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};

/**
 * Vertical event stream. Filterable by event-type chips (toggling).
 * Click a row to "focus" it — emits onSelectEvent so the parent
 * dashboard can flash the corresponding canvas node.
 */
type Props = {
  events: readonly BusinessWorkflowEvent[];
  /** Filter to events for a single node (pinned by canvas selection). */
  filterNodeId?: string | null;
  /** Called when the user clicks a row — for canvas sync. */
  onSelectEvent?: (event: BusinessWorkflowEvent) => void;
  className?: string;
};

export const InstanceTimeline = ({
  events,
  filterNodeId,
  onSelectEvent,
  className,
}: Props) => {
  const [hiddenTypes, setHiddenTypes] = useState<Set<BusinessWorkflowEventType>>(
    new Set(),
  );
  const [now] = useState(() => Date.now());

  const allTypes = useMemo(() => {
    const set = new Set<BusinessWorkflowEventType>();
    for (const e of events) set.add(e.eventType);
    return Array.from(set).sort();
  }, [events]);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (hiddenTypes.has(e.eventType)) return false;
      if (filterNodeId && e.nodeId !== filterNodeId) return false;
      return true;
    });
  }, [events, hiddenTypes, filterNodeId]);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Filter chips */}
      {allTypes.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {allTypes.map((t) => {
            const meta = EVENT_META[t];
            const hidden = hiddenTypes.has(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() =>
                  setHiddenTypes((prev) => {
                    const next = new Set(prev);
                    if (next.has(t)) next.delete(t);
                    else next.add(t);
                    return next;
                  })
                }
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[0.55rem] font-semibold ring-1",
                  hidden
                    ? "text-outline ring-outline-variant/40 line-through"
                    : meta?.tone || "ring-outline-variant/40",
                )}
              >
                {meta?.label || t}
              </button>
            );
          })}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="rounded-lg border-2 border-dashed border-outline-variant/40 bg-surface-container p-3 text-center text-[0.7rem] text-outline">
          {filterNodeId
            ? "No events at this node yet."
            : "No events match the active filters."}
        </p>
      ) : (
        <ol className="relative space-y-1.5 border-l-2 border-outline-variant/20 pl-3">
          {filtered
            .slice()
            .reverse() // newest first
            .map((e) => {
              const meta = EVENT_META[e.eventType] || {
                Icon: FileText,
                tone: "text-slate-600 bg-slate-50 ring-slate-200",
                label: e.eventType,
              };
              return (
                <li
                  key={e.id}
                  className="relative -ml-1.5 cursor-pointer"
                  onClick={() => onSelectEvent?.(e)}
                >
                  <span
                    className={cn(
                      "absolute left-[-0.25rem] top-1.5 flex h-3 w-3 items-center justify-center rounded-full ring-2 ring-surface-container-low",
                      meta.tone,
                    )}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  </span>
                  <div className="ml-3 rounded-lg border border-outline-variant/30 bg-white p-2 hover:border-primary/40">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.55rem] font-semibold ring-1",
                          meta.tone,
                        )}
                      >
                        <meta.Icon size={9} />
                        {meta.label}
                      </span>
                      <span className="ml-auto text-[0.6rem] text-outline">
                        {formatRelative(e.occurredAt, now)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-[0.62rem]">
                      {e.actorId && (
                        <span className="text-on-surface">
                          <strong>{e.actorId}</strong>
                        </span>
                      )}
                      {e.nodeId && (
                        <span className="font-mono text-outline">
                          @ {e.nodeId}
                        </span>
                      )}
                    </div>
                    {renderPayloadPreview(e)}
                  </div>
                </li>
              );
            })}
        </ol>
      )}
    </div>
  );
};

const renderPayloadPreview = (
  e: BusinessWorkflowEvent,
): React.ReactNode | null => {
  const p = e.payload || {};
  // Per-event-type payload preview — bare-text summaries that read
  // naturally without a JSON tree.
  switch (e.eventType) {
    case "INSTANCE_NOTE_ADDED":
      return typeof p.body === "string" && p.body ? (
        <p className="mt-1 whitespace-pre-wrap text-[0.7rem] text-on-surface">
          {p.body as string}
        </p>
      ) : null;
    case "TASK_SENT_BACK":
    case "APPROVAL_SENT_BACK":
      return (
        <p className="mt-1 text-[0.62rem] text-amber-800">
          → {String(p.targetNodeId || "?")}
          {p.reason ? ` · ${p.reason}` : ""}
        </p>
      );
    case "TASK_REASSIGNED":
    case "APPROVAL_REASSIGNED":
      return (
        <p className="mt-1 text-[0.62rem] text-violet-700">
          {summariseAssignment(p)}
          {p.reason ? ` · ${p.reason}` : ""}
        </p>
      );
    case "AD_HOC_TASK_CREATED":
      return (
        <p className="mt-1 text-[0.62rem] text-pink-700">
          "{String(p.title || "Untitled")}"
          {p.blocking ? " · blocking" : ""}
        </p>
      );
    case "APPROVAL_DECIDED":
      return (
        <p className="mt-1 text-[0.62rem] text-indigo-700">
          {String(p.decision || "?")}
          {p.notes ? ` · ${String(p.notes)}` : ""}
        </p>
      );
    case "INSTANCE_PAUSED":
    case "INSTANCE_CANCELLED":
      return p.reason ? (
        <p className="mt-1 text-[0.62rem] text-amber-800">
          {String(p.reason)}
        </p>
      ) : null;
    default:
      return null;
  }
};

const summariseAssignment = (p: Record<string, unknown>): string => {
  if (typeof p.assignedUserId === "string")
    return `→ user ${p.assignedUserId}`;
  if (typeof p.assignedTeamId === "string")
    return `→ team ${p.assignedTeamId}`;
  if (typeof p.assignedRole === "string") return `→ role ${p.assignedRole}`;
  if (typeof p.assignedSkill === "string")
    return `→ skill ${p.assignedSkill}`;
  return "→ reassigned";
};

// Suppress unused-import warning on AlarmClockOff (kept reserved for
// future "SLA breach" event type)
void AlarmClockOff;
