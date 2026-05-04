import { useEffect, useState } from "react";
import { Clock, AlarmClock } from "lucide-react";
import { cn } from "../../../../lib/utils";
import { formatSla } from "../../../../lib/businessWorkflowRuntime";

/**
 * Live-ticking SLA chip.
 *
 * Why a self-contained ticker? The chip on a 50-row inbox + dashboard
 * task list would otherwise force a parent re-render every second.
 * The chip owns its own setInterval so the surrounding tree stays
 * still — the chip is the only thing that repaints.
 *
 * Three tones:
 *   ok       gray pill, "2h 14m left"
 *   warn     amber, "<1h left"
 *   overdue  red + pulsing, "3h overdue"
 *   none     muted, "no SLA"
 */
export const SlaChip = ({
  dueAt,
  size = "sm",
  className,
}: {
  dueAt?: string | null;
  size?: "xs" | "sm" | "md";
  className?: string;
}) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!dueAt) return; // no SLA → no need to tick
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [dueAt]);

  const sla = formatSla(dueAt, now);
  const Icon = sla.tone === "overdue" ? AlarmClock : Clock;

  const sizing =
    size === "xs"
      ? "text-[0.55rem] px-1.5 py-0.5 gap-0.5"
      : size === "md"
        ? "text-xs px-2 py-1 gap-1"
        : "text-[0.65rem] px-1.5 py-0.5 gap-1";

  const tone =
    sla.tone === "overdue"
      ? "bg-rose-100 text-rose-700 ring-1 ring-rose-300 animate-pulse"
      : sla.tone === "warn"
        ? "bg-amber-100 text-amber-800 ring-1 ring-amber-300"
        : sla.tone === "ok"
          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
          : "bg-surface-container text-outline ring-1 ring-outline-variant/40";

  const iconSize = size === "xs" ? 9 : size === "md" ? 13 : 11;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold",
        sizing,
        tone,
        className,
      )}
      title={
        dueAt
          ? `Due ${new Date(dueAt).toLocaleString()}`
          : "No SLA configured for this node"
      }
    >
      <Icon size={iconSize} />
      {sla.label}
    </span>
  );
};
