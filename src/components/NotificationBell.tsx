import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCheck,
  Info,
  Loader2,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  acknowledgeAllNotifications,
  acknowledgeNotification,
  fetchBusinessInstance,
  listNotifications,
  type InAppNotification,
} from "../lib/api";
import { cn } from "../lib/utils";

/**
 * Top-bar bell.
 *
 * Polls /api/notifications?unread=true every 15s. Each query is one
 * indexed seek (notifications has an idx on
 * (user_id, acknowledged, created_at DESC)) so the cost is fine.
 *
 * Bell PULSES (animate-bounce 1.2s) whenever the unread count rises
 * 0 → positive — gives the operator a moment of "oh, new alert"
 * without being noisy if they already have unread.
 *
 * Click → dropdown listing recent unread. Each row:
 *   - severity-tinted icon
 *   - message + relative time
 *   - "go to instance" affordance (acks + navigates).
 *
 * Footer: "Mark all read" button.
 *
 * SSE / push streaming is V2.2 — current 15s polling is good enough.
 */

const POLL_MS = 15_000;

const SEVERITY_META: Record<
  string,
  { Icon: typeof Bell; tone: string }
> = {
  INFO: { Icon: Info, tone: "text-sky-700 bg-sky-50" },
  WARNING: { Icon: AlertTriangle, tone: "text-amber-700 bg-amber-50" },
  ERROR: { Icon: XCircle, tone: "text-rose-700 bg-rose-50" },
  CRITICAL: { Icon: XCircle, tone: "text-rose-800 bg-rose-100" },
  SUCCESS: { Icon: Check, tone: "text-emerald-700 bg-emerald-50" },
};

const formatRelative = (iso: string, now: number): string => {
  const ms = now - Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const s = Math.floor(ms / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
};

export const NotificationBell = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<InAppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [marking, setMarking] = useState(false);
  const lastUnreadCountRef = useRef(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await listNotifications({ unread: true, limit: 50 });
      setItems(list);
      // Pulse on rising-edge from 0 — gives a visual ping without
      // looping forever when the count just stays positive.
      if (list.length > lastUnreadCountRef.current && lastUnreadCountRef.current === 0) {
        setPulse(true);
        setTimeout(() => setPulse(false), 1200);
      }
      lastUnreadCountRef.current = list.length;
    } catch {
      // Silent — next tick will retry. The bell shouldn't error-toast.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Dismiss the dropdown on outside-click (we use ref so a click
  // INSIDE the dropdown doesn't close it).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const handleRowClick = async (n: InAppNotification) => {
    setOpen(false);
    // Optimistically mark read in the local list so the UI feels
    // snappy; the server side ack runs in the background.
    setItems((prev) => prev.filter((x) => x.id !== n.id));
    void acknowledgeNotification(n.id).catch(() => {
      // If the ack fails, the next poll will re-add the row —
      // self-healing.
    });
    if (n.businessInstanceId) {
      // We don't carry templateId on the notification row. Resolve
      // it once and navigate.
      try {
        const cap = n.capabilityId || "";
        if (cap) {
          const data = await fetchBusinessInstance(cap, n.businessInstanceId);
          navigate(
            `/studio/business-workflows/${encodeURIComponent(
              data.instance.templateId,
            )}/instances/${encodeURIComponent(n.businessInstanceId)}`,
          );
        }
      } catch {
        // No-op — we already ack'd.
      }
    } else if (n.runId) {
      // Agent-workflow path. We don't deep-link automatically; the
      // existing run console URL pattern lives elsewhere — leave
      // this as a TODO for V2.2.
    }
  };

  const handleAckAll = async () => {
    if (items.length === 0) return;
    setMarking(true);
    try {
      await acknowledgeAllNotifications();
      setItems([]);
      lastUnreadCountRef.current = 0;
    } catch {
      // Silent — next poll repopulates.
    } finally {
      setMarking(false);
    }
  };

  const count = items.length;

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-outline-variant/60 bg-surface-container-low text-on-surface transition hover:border-primary/40",
          pulse && "animate-bounce",
        )}
        title={count > 0 ? `${count} unread` : "No new alerts"}
        aria-label={count > 0 ? `${count} unread notifications` : "Notifications"}
      >
        <Bell size={16} />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[0.55rem] font-bold leading-none text-white ring-2 ring-surface">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-[80] mt-2 flex max-h-[28rem] w-[22rem] flex-col overflow-hidden rounded-xl border border-outline-variant/40 bg-surface shadow-2xl">
          <header className="flex items-center justify-between border-b border-outline-variant/30 px-3 py-2">
            <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
              Notifications
            </p>
            {count > 0 && (
              <button
                type="button"
                onClick={() => void handleAckAll()}
                disabled={marking}
                className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/40 bg-white px-2 py-0.5 text-[0.65rem] font-semibold hover:bg-surface-container disabled:opacity-60"
              >
                {marking ? (
                  <Loader2 size={9} className="animate-spin" />
                ) : (
                  <CheckCheck size={9} />
                )}
                Mark all read
              </button>
            )}
          </header>

          <div className="flex-1 overflow-y-auto">
            {count === 0 ? (
              <div className="flex flex-col items-center gap-1 p-6 text-center">
                <Sparkles size={16} className="text-outline" />
                <p className="text-xs text-on-surface">All caught up.</p>
                <p className="text-[0.6rem] text-outline">
                  New alerts and reminders show here. Polled every 15s.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-outline-variant/20">
                {items.map((n) => {
                  const meta = SEVERITY_META[n.severity] || SEVERITY_META.INFO;
                  const Icon = meta.Icon;
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => void handleRowClick(n)}
                        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-surface-container"
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                            meta.tone,
                          )}
                        >
                          <Icon size={11} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[0.7rem] font-semibold text-on-surface">
                            {n.message}
                          </span>
                          <span className="mt-0.5 inline-flex items-center gap-1 text-[0.6rem] text-outline">
                            <span>{formatRelative(n.createdAt, Date.now())}</span>
                            {n.businessInstanceId && (
                              <span className="rounded bg-primary/10 px-1 text-[0.55rem] font-semibold text-primary">
                                instance
                              </span>
                            )}
                            {n.severity !== "INFO" && (
                              <span className="font-mono uppercase">
                                {n.severity}
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
