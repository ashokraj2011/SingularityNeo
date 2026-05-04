import { useState } from "react";
import {
  Bell,
  ChevronDown,
  ChevronRight,
  Clock,
  Plus,
  Timer,
  Trash2,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type {
  BusinessAttachment,
  BusinessAttachmentTrigger,
  BusinessAttachmentType,
  BusinessNotificationChannel,
  BusinessTimerAction,
} from "../../contracts/businessWorkflow";

/**
 * Editor for the `config.attachments` Lego blocks on a node.
 *
 * Two attachment types:
 *
 *   TIMER         counts down `durationMinutes` from node activation
 *                 and fires an action (NOTIFY / ESCALATE / AUTO_COMPLETE).
 *                 V1 only emits an ATTACHED_TIMER_SCHEDULED audit event
 *                 — the V2.1 sweep job will actually fire pending
 *                 timers. Configuring them now means they're stored
 *                 and visible on the timeline; the day delivery ships,
 *                 every existing template inherits the behaviour.
 *
 *   NOTIFICATION  fires immediately on a lifecycle trigger
 *                 (ON_ACTIVATE / ON_COMPLETE / ON_OVERDUE). V1 emits
 *                 ATTACHED_NOTIFICATION_SENT with the recipients +
 *                 channel — same outbox-replay story as timers.
 *
 * The user-visible promise: "drop a timer or notification on ANY
 * step without rewiring the graph". So this editor lives in the node
 * inspector and is identical for every node type.
 */

type Props = {
  attachments: BusinessAttachment[];
  onChange: (next: BusinessAttachment[]) => void;
};

const TRIGGER_OPTIONS: BusinessAttachmentTrigger[] = [
  "ON_ACTIVATE",
  "ON_COMPLETE",
  "ON_OVERDUE",
];

const CHANNEL_OPTIONS: BusinessNotificationChannel[] = [
  "EMAIL",
  "WEBHOOK",
  "IN_APP",
];

const TIMER_ACTIONS: BusinessTimerAction[] = [
  "NOTIFY",
  "ESCALATE",
  "AUTO_COMPLETE",
];

const newAttachment = (type: BusinessAttachmentType): BusinessAttachment => ({
  id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  type,
  enabled: true,
  label: type === "TIMER" ? "New timer" : "New notification",
  ...(type === "TIMER"
    ? { durationMinutes: 30, onFire: "NOTIFY" as BusinessTimerAction }
    : {
        trigger: "ON_ACTIVATE" as BusinessAttachmentTrigger,
        channel: "IN_APP" as BusinessNotificationChannel,
        recipients: [],
        message: "",
      }),
});

export const BehaviorsEditor = ({ attachments, onChange }: Props) => {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());

  const update = (i: number, patch: Partial<BusinessAttachment>) => {
    onChange(attachments.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  };

  const remove = (i: number) =>
    onChange(attachments.filter((_, j) => j !== i));

  const toggleOpen = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="rounded-xl border border-outline-variant/40 bg-white p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
            Behaviors
          </p>
          <p className="text-[0.6rem] text-outline">
            Tiny Lego-blocks that fire on this node's lifecycle. Attach
            timers and notifications without wiring extra graph nodes.
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => onChange([...attachments, newAttachment("TIMER")])}
            className="inline-flex items-center gap-0.5 rounded border border-outline-variant/40 bg-white px-1.5 py-0.5 text-[0.6rem] hover:bg-surface-container"
            title="Attach a timer"
          >
            <Plus size={9} />
            <Timer size={9} /> Timer
          </button>
          <button
            type="button"
            onClick={() =>
              onChange([...attachments, newAttachment("NOTIFICATION")])
            }
            className="inline-flex items-center gap-0.5 rounded border border-outline-variant/40 bg-white px-1.5 py-0.5 text-[0.6rem] hover:bg-surface-container"
            title="Attach a notification"
          >
            <Plus size={9} />
            <Bell size={9} /> Notify
          </button>
        </div>
      </div>

      {attachments.length === 0 ? (
        <p className="rounded-lg border-2 border-dashed border-outline-variant/40 bg-surface-container p-2 text-center text-[0.6rem] text-outline">
          No behaviors attached. Add a timer or notification above.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {attachments.map((att, i) => {
            const open = openIds.has(att.id);
            const Icon = att.type === "TIMER" ? Timer : Bell;
            return (
              <li
                key={att.id}
                className={cn(
                  "rounded-lg border bg-white",
                  att.enabled
                    ? "border-outline-variant/40"
                    : "border-outline-variant/20 opacity-60",
                )}
              >
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => toggleOpen(att.id)}
                    className="text-outline hover:text-on-surface"
                  >
                    {open ? (
                      <ChevronDown size={11} />
                    ) : (
                      <ChevronRight size={11} />
                    )}
                  </button>
                  <Icon
                    size={11}
                    className={cn(
                      att.type === "TIMER"
                        ? "text-blue-600"
                        : "text-sky-600",
                    )}
                  />
                  <input
                    type="text"
                    value={att.label || ""}
                    onChange={(e) => update(i, { label: e.target.value })}
                    placeholder={
                      att.type === "TIMER" ? "Timer label" : "Notification label"
                    }
                    className="min-w-0 flex-1 border-0 bg-transparent text-[0.7rem] font-semibold outline-none"
                  />
                  <span className="rounded bg-surface-container px-1 text-[0.55rem] font-bold uppercase text-outline">
                    {att.type}
                  </span>
                  <label
                    className="inline-flex cursor-pointer items-center"
                    title={att.enabled ? "Enabled" : "Disabled"}
                  >
                    <input
                      type="checkbox"
                      checked={att.enabled}
                      onChange={(e) => update(i, { enabled: e.target.checked })}
                      className="h-3 w-3"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="rounded p-0.5 text-rose-500 hover:bg-rose-50"
                    title="Remove"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
                {open && (
                  <div className="space-y-1.5 border-t border-outline-variant/20 px-2 py-1.5">
                    {att.type === "TIMER" ? (
                      <TimerFields
                        att={att}
                        onChange={(p) => update(i, p)}
                      />
                    ) : (
                      <NotificationFields
                        att={att}
                        onChange={(p) => update(i, p)}
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

// ── Timer fields ─────────────────────────────────────────────────────────────

const TimerFields = ({
  att,
  onChange,
}: {
  att: BusinessAttachment;
  onChange: (patch: Partial<BusinessAttachment>) => void;
}) => (
  <>
    <div className="grid grid-cols-2 gap-1.5">
      <label className="block text-[0.65rem]">
        <span className="mb-0.5 block font-semibold uppercase text-outline">
          Duration (minutes)
        </span>
        <input
          type="number"
          min={1}
          value={att.durationMinutes ?? 30}
          onChange={(e) =>
            onChange({ durationMinutes: Number(e.target.value) || 0 })
          }
          className="w-full rounded border border-outline-variant/40 bg-white px-1.5 py-1 text-[0.65rem]"
        />
        <span className="mt-0.5 inline-flex items-center gap-0.5 text-[0.6rem] text-outline">
          <Clock size={9} />
          fires {att.durationMinutes || 0} min after activation
        </span>
      </label>
      <label className="block text-[0.65rem]">
        <span className="mb-0.5 block font-semibold uppercase text-outline">
          On fire
        </span>
        <select
          value={att.onFire || "NOTIFY"}
          onChange={(e) =>
            onChange({ onFire: e.target.value as BusinessTimerAction })
          }
          className="w-full rounded border border-outline-variant/40 bg-white px-1.5 py-1 text-[0.65rem]"
        >
          {TIMER_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
    </div>
    {att.onFire === "ESCALATE" && (
      <div className="grid grid-cols-2 gap-1.5">
        <label className="block text-[0.65rem]">
          <span className="mb-0.5 block font-semibold uppercase text-outline">
            Escalate to user
          </span>
          <input
            type="text"
            value={att.escalateToUserId || ""}
            onChange={(e) =>
              onChange({ escalateToUserId: e.target.value || undefined })
            }
            placeholder="user id"
            className="w-full rounded border border-outline-variant/40 bg-white px-1.5 py-1 text-[0.65rem]"
          />
        </label>
        <label className="block text-[0.65rem]">
          <span className="mb-0.5 block font-semibold uppercase text-outline">
            Or escalate to role
          </span>
          <input
            type="text"
            value={att.escalateToRole || ""}
            onChange={(e) =>
              onChange({ escalateToRole: e.target.value || undefined })
            }
            placeholder="ROLE_NAME"
            className="w-full rounded border border-outline-variant/40 bg-white px-1.5 py-1 text-[0.65rem]"
          />
        </label>
      </div>
    )}
    <p className="rounded bg-amber-50 p-1.5 text-[0.55rem] text-amber-800">
      ⏱ V1 records the schedule on the timeline. Auto-fire (delivery,
      auto-complete) is V2.1 — it needs a background sweep we haven't
      shipped yet.
    </p>
  </>
);

// ── Notification fields ──────────────────────────────────────────────────────

const NotificationFields = ({
  att,
  onChange,
}: {
  att: BusinessAttachment;
  onChange: (patch: Partial<BusinessAttachment>) => void;
}) => {
  const recipientsText = (att.recipients || []).join(", ");
  return (
    <>
      <div className="grid grid-cols-2 gap-1.5">
        <label className="block text-[0.65rem]">
          <span className="mb-0.5 block font-semibold uppercase text-outline">
            Trigger
          </span>
          <select
            value={att.trigger || "ON_ACTIVATE"}
            onChange={(e) =>
              onChange({
                trigger: e.target.value as BusinessAttachmentTrigger,
              })
            }
            className="w-full rounded border border-outline-variant/40 bg-white px-1.5 py-1 text-[0.65rem]"
          >
            {TRIGGER_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[0.65rem]">
          <span className="mb-0.5 block font-semibold uppercase text-outline">
            Channel
          </span>
          <select
            value={att.channel || "IN_APP"}
            onChange={(e) =>
              onChange({
                channel: e.target.value as BusinessNotificationChannel,
              })
            }
            className="w-full rounded border border-outline-variant/40 bg-white px-1.5 py-1 text-[0.65rem]"
          >
            {CHANNEL_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-[0.65rem]">
        <span className="mb-0.5 block font-semibold uppercase text-outline">
          Recipients (comma-separated)
        </span>
        <input
          type="text"
          value={recipientsText}
          onChange={(e) =>
            onChange({
              recipients: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="user-id, team-id, role:OPERATOR, email@host"
          className="w-full rounded border border-outline-variant/40 bg-white px-1.5 py-1 text-[0.65rem]"
        />
      </label>
      <label className="block text-[0.65rem]">
        <span className="mb-0.5 block font-semibold uppercase text-outline">
          Message
        </span>
        <textarea
          value={att.message || ""}
          onChange={(e) => onChange({ message: e.target.value })}
          rows={2}
          placeholder='e.g. "Approval is ready: ${context.employeeName}"'
          className="w-full resize-y rounded border border-outline-variant/40 bg-white px-1.5 py-1 text-[0.65rem]"
        />
      </label>
      <p className="rounded bg-sky-50 p-1.5 text-[0.55rem] text-sky-800">
        🔔 V1 records sent notifications on the timeline. Actual delivery
        (SMTP, webhook) is V2.1 — the events log is the durable outbox.
      </p>
    </>
  );
};
