import { Paperclip } from "lucide-react";
import { cn } from "../../../../lib/utils";

/**
 * Compact "📎 3 docs" pill rendered on task rows in the inbox + the
 * dashboard's ActiveTasksPanel. The count is server-computed by
 * listBusinessTasks (joins jsonb_array_length over the instance's
 * context.__documents) so no per-row fetch from the renderer.
 *
 * Hidden when count is zero — operators see this ONLY when there's
 * something they'd want to click into.
 */
export const DocumentsCountChip = ({
  count,
  size = "xs",
  className,
}: {
  count: number | undefined;
  size?: "xs" | "sm";
  className?: string;
}) => {
  if (!count || count <= 0) return null;
  return (
    <span
      title={`${count} document${count === 1 ? "" : "s"} attached to this instance`}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full bg-sky-50 font-semibold text-sky-700 ring-1 ring-sky-200",
        size === "xs"
          ? "text-[0.55rem] px-1.5 py-0.5"
          : "text-[0.62rem] px-2 py-0.5",
        className,
      )}
    >
      <Paperclip size={size === "xs" ? 9 : 11} />
      {count}
    </span>
  );
};
