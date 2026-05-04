import { Bell, Timer } from "lucide-react";
import { cn } from "../../lib/utils";
import type { BusinessAttachment } from "../../contracts/businessWorkflow";

/**
 * Tiny ⏱ / 🔔 indicators rendered on a node card when attachments
 * are present. Appears in BOTH the designer canvas and the read-only
 * instance dashboard canvas — same component, same look — so an
 * operator sees the same vocabulary in both surfaces.
 *
 * Renders only counts > 0; disabled attachments are not counted.
 */
export const AttachmentBadges = ({
  attachments,
  className,
}: {
  attachments?: BusinessAttachment[];
  className?: string;
}) => {
  if (!attachments || attachments.length === 0) return null;
  let timers = 0;
  let notifications = 0;
  for (const a of attachments) {
    if (!a.enabled) continue;
    if (a.type === "TIMER") timers++;
    else if (a.type === "NOTIFICATION") notifications++;
  }
  if (timers === 0 && notifications === 0) return null;

  return (
    <span
      className={cn(
        "pointer-events-none absolute bottom-1 left-1 z-[1] inline-flex items-center gap-0.5 rounded-full bg-white/95 px-1 py-0.5 ring-1 ring-outline-variant/40",
        className,
      )}
      title={[
        timers > 0 ? `${timers} timer${timers === 1 ? "" : "s"}` : null,
        notifications > 0
          ? `${notifications} notification${notifications === 1 ? "" : "s"}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      {timers > 0 && (
        <span className="inline-flex items-center text-[0.55rem] font-bold text-blue-700">
          <Timer size={9} />
          {timers}
        </span>
      )}
      {notifications > 0 && (
        <span className="inline-flex items-center text-[0.55rem] font-bold text-sky-700">
          <Bell size={9} />
          {notifications}
        </span>
      )}
    </span>
  );
};
