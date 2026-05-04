import { ArrowDown, Equal, ArrowUp, AlertTriangle } from "lucide-react";
import { cn } from "../../../../lib/utils";
import type { TaskPriority } from "../../../../contracts/businessWorkflow";

/**
 * Tiny priority pill. Used in the inbox, the dashboard task list, and
 * the active-tasks side panel. Visual matches a typical priority
 * iconography: down arrow for LOW, equal for NORMAL, up for HIGH,
 * warning triangle for URGENT.
 */
export const PriorityBadge = ({
  priority,
  size = "sm",
  withLabel = true,
  className,
}: {
  priority: TaskPriority;
  size?: "xs" | "sm";
  withLabel?: boolean;
  className?: string;
}) => {
  const map: Record<
    TaskPriority,
    {
      label: string;
      tone: string;
      Icon: typeof ArrowDown;
    }
  > = {
    LOW: {
      label: "Low",
      tone: "bg-slate-100 text-slate-600 ring-slate-300",
      Icon: ArrowDown,
    },
    NORMAL: {
      label: "Normal",
      tone: "bg-sky-50 text-sky-700 ring-sky-200",
      Icon: Equal,
    },
    HIGH: {
      label: "High",
      tone: "bg-orange-100 text-orange-700 ring-orange-300",
      Icon: ArrowUp,
    },
    URGENT: {
      label: "Urgent",
      tone: "bg-rose-100 text-rose-700 ring-rose-300 animate-pulse",
      Icon: AlertTriangle,
    },
  };
  const entry = map[priority] ?? map.NORMAL;
  const iconSize = size === "xs" ? 9 : 11;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full ring-1 font-semibold",
        size === "xs"
          ? "text-[0.55rem] px-1.5 py-0.5"
          : "text-[0.62rem] px-1.5 py-0.5",
        entry.tone,
        className,
      )}
      title={`${entry.label} priority`}
    >
      <entry.Icon size={iconSize} />
      {withLabel && entry.label}
    </span>
  );
};
