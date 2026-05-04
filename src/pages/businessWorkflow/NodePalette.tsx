import {
  Bot,
  Check,
  Clock,
  FileText,
  GitFork,
  GitMerge,
  Hand,
  Mail,
  Play,
  Sparkles,
  Square,
  Split,
  Wrench,
  Workflow as WorkflowIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type {
  BusinessCustomNodeType,
  BusinessNodeBaseType,
} from "../../contracts/businessWorkflow";
import { isHexColor, resolveCustomNodeIcon } from "./customNodeIcons";

interface PaletteEntry {
  type: BusinessNodeBaseType;
  label: string;
  description: string;
  icon: LucideIcon;
  group: string;
  color: string; // tailwind background color class
}

const PALETTE: PaletteEntry[] = [
  // Tasks
  { type: "HUMAN_TASK", label: "Human Task", description: "Person does the work, marks complete", icon: Hand, group: "Tasks", color: "bg-emerald-500" },
  { type: "FORM_FILL", label: "Form Fill", description: "Capture structured input via form schema", icon: FileText, group: "Tasks", color: "bg-emerald-500" },
  { type: "APPROVAL", label: "Approval", description: "Reviewer approves / rejects / requests changes", icon: Check, group: "Tasks", color: "bg-violet-500" },
  // Boundary
  { type: "START", label: "Start", description: "Workflow entry point", icon: Play, group: "Boundary", color: "bg-sky-500" },
  { type: "END", label: "End", description: "Workflow completion", icon: Square, group: "Boundary", color: "bg-gray-500" },
  // Control flow
  { type: "DECISION_GATE", label: "Decision Gate", description: "Route by edge conditions (AND/OR)", icon: Split, group: "Control flow", color: "bg-amber-500" },
  { type: "PARALLEL_FORK", label: "Parallel Fork", description: "Activate all outgoing branches at once", icon: GitFork, group: "Control flow", color: "bg-amber-500" },
  { type: "PARALLEL_JOIN", label: "Parallel Join", description: "Wait for all incoming branches", icon: GitMerge, group: "Control flow", color: "bg-amber-500" },
  // Async / timing
  { type: "TIMER", label: "Timer", description: "Pause for a duration", icon: Clock, group: "Async", color: "bg-blue-500" },
  { type: "NOTIFICATION", label: "Notification", description: "Send email / webhook / in-app", icon: Mail, group: "Async", color: "bg-blue-500" },
  // Integration
  { type: "AGENT_TASK", label: "Agent Task", description: "Delegate to an existing capability agent", icon: Bot, group: "Integration", color: "bg-fuchsia-500" },
  { type: "TOOL_REQUEST", label: "Tool Request", description: "Invoke a registered tool (V1: stub)", icon: Wrench, group: "Integration", color: "bg-fuchsia-500" },
  { type: "CALL_WORKFLOW", label: "Call Workflow", description: "Spawn a child business workflow (V1: stub)", icon: WorkflowIcon, group: "Integration", color: "bg-fuchsia-500" },
];

export const PALETTE_BY_TYPE: Record<string, PaletteEntry> = PALETTE.reduce(
  (acc, entry) => {
    acc[entry.type] = entry;
    return acc;
  },
  {} as Record<string, PaletteEntry>,
);

const GROUPS = ["Tasks", "Boundary", "Control flow", "Async", "Integration"];

export const NodePalette = ({
  onAdd,
  customNodeTypes = [],
}: {
  /** Called with the literal `node.type` string to create. */
  onAdd: (type: string) => void;
  customNodeTypes?: BusinessCustomNodeType[];
}) => {
  return (
    <aside className="flex w-56 shrink-0 flex-col gap-3 overflow-y-auto border-r border-outline-variant/30 bg-surface-container-low p-3">
      <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
        Node Palette
      </p>
      {GROUPS.map((group) => {
        const items = PALETTE.filter((p) => p.group === group);
        return (
          <div key={group}>
            <p className="mb-1 text-[0.6rem] font-semibold uppercase text-outline">
              {group}
            </p>
            <div className="space-y-1">
              {items.map((entry) => {
                const Icon = entry.icon;
                return (
                  <button
                    key={entry.type}
                    type="button"
                    onClick={() => onAdd(entry.type)}
                    title={entry.description}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg border border-outline-variant/30 bg-white px-2 py-1.5 text-left text-xs text-on-surface hover:bg-surface-container",
                    )}
                  >
                    <span
                      className={cn(
                        "rounded p-1 text-white",
                        entry.color,
                      )}
                    >
                      <Icon size={12} />
                    </span>
                    <span className="font-medium">{entry.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {customNodeTypes.length > 0 && (
        <div>
          <p className="mb-1 flex items-center gap-1 text-[0.6rem] font-semibold uppercase text-outline">
            <Sparkles size={9} /> Custom (this capability)
          </p>
          <div className="space-y-1">
            {customNodeTypes.map((custom) => {
              const CustomIcon = resolveCustomNodeIcon(custom.icon);
              const hex = isHexColor(custom.color);
              return (
                <button
                  key={custom.id}
                  type="button"
                  onClick={() => onAdd(custom.name)}
                  title={
                    custom.description
                      ? `${custom.label} — ${custom.description}`
                      : `${custom.label} — wraps ${custom.baseType}`
                  }
                  className="flex w-full items-center gap-2 rounded-lg border border-outline-variant/30 bg-white px-2 py-1.5 text-left text-xs text-on-surface hover:bg-surface-container"
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded",
                      // Legacy entries stored a Tailwind class — keep
                      // rendering with the white-on-class look. New
                      // entries are hex; render via inline style.
                      !hex && (custom.color || "bg-fuchsia-500"),
                      !hex && "text-white",
                    )}
                    style={
                      hex
                        ? {
                            backgroundColor: `${custom.color}1A`,
                            border: `1px solid ${custom.color}40`,
                          }
                        : undefined
                    }
                  >
                    <CustomIcon
                      size={12}
                      style={{ color: hex ? custom.color : undefined }}
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {custom.label}
                  </span>
                  <span className="rounded bg-surface-container px-1 text-[0.55rem] uppercase text-outline">
                    {custom.baseType.split("_")[0]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
};
