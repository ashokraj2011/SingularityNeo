import { useRef, useEffect } from "react";
import {
  Bot,
  CheckCircle2,
  FileCode,
  FileText,
  Info,
  Loader2,
  MessageSquare,
  Shield,
  Terminal,
  XCircle,
} from "lucide-react";
import { cn } from "../../lib/utils";
import MarkdownContent from "../../components/MarkdownContent";
import type {
  CapabilityChatMessage,
  LedgerArtifactRecord,
  RunWait,
  ToolInvocation,
  WorkflowRunDetail,
  WorkflowRunStep,
} from "../../types";
import {
  type CockpitTimelineItem,
  type TimelineFilter,
  itemMatchesFilter,
  normalizeTimeline,
  TIMELINE_FILTER_LABELS,
} from "./types";

type Props = {
  runDetail: WorkflowRunDetail | null;
  ledgerArtifacts: LedgerArtifactRecord[];
  messages: CapabilityChatMessage[];
  streamedDraft: string;
  isStreaming: boolean;
  filter: TimelineFilter;
  workItemId: string | null;
  onFilterChange: (f: TimelineFilter) => void;
  onSelectArtifact: (id: string) => void;
  onOpenApproval: () => void;
  /**
   * Open the "View context" drawer for a chat message. Passed the
   * agent message's traceId; the drawer fetches by trace and renders
   * the assembled prompt that produced the response.
   */
  onViewMessageContext?: (message: CapabilityChatMessage) => void;
};

// ── Individual event cards ────────────────────────────────────────────────────

const StepCard = ({ step }: { step: WorkflowRunStep }) => (
  <div className="flex items-start gap-3 rounded-xl border border-outline-variant/25 bg-surface-container-low px-4 py-3">
    <div className="mt-0.5 rounded-lg bg-sky-500/10 p-1.5">
      <Bot size={13} className="text-sky-600 dark:text-sky-400" />
    </div>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold text-primary">{step.name}</p>
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase",
            step.status === "COMPLETED"
              ? "bg-emerald-500/10 text-emerald-600"
              : step.status === "FAILED"
              ? "bg-rose-500/10 text-rose-600"
              : step.status === "RUNNING"
              ? "bg-sky-500/10 text-sky-600"
              : "bg-surface-container text-secondary",
          )}
        >
          {step.status}
        </span>
        {step.stepType && (
          <span className="rounded-full bg-primary/5 px-1.5 py-0.5 text-[0.6rem] text-secondary">
            {step.stepType.replace(/_/g, " ")}
          </span>
        )}
      </div>
      {step.outputSummary && (
        <p className="mt-1.5 text-xs leading-relaxed text-secondary">
          {step.outputSummary}
        </p>
      )}
      {step.startedAt && (
        <p className="mt-1 text-[0.62rem] text-outline">
          {new Date(step.startedAt).toLocaleTimeString()}
          {step.completedAt
            ? ` → ${new Date(step.completedAt).toLocaleTimeString()}`
            : ""}
        </p>
      )}
    </div>
  </div>
);

const ToolCard = ({
  tool,
}: {
  tool: ToolInvocation;
}) => (
  <div className="flex items-start gap-3 rounded-xl border border-outline-variant/25 bg-surface-container-low px-4 py-3">
    <div className="mt-0.5 rounded-lg bg-violet-500/10 p-1.5">
      <Terminal size={13} className="text-violet-600 dark:text-violet-400" />
    </div>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-mono text-xs font-semibold text-primary">{tool.toolId}</p>
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase",
            tool.status === "COMPLETED"
              ? "bg-emerald-500/10 text-emerald-600"
              : tool.status === "FAILED"
              ? "bg-rose-500/10 text-rose-600"
              : "bg-surface-container text-secondary",
          )}
        >
          {tool.status}
        </span>
        {tool.latencyMs && (
          <span className="text-[0.6rem] text-outline">{tool.latencyMs}ms</span>
        )}
      </div>
      {tool.resultSummary && (
        <p className="mt-1.5 text-xs leading-relaxed text-secondary">
          {tool.resultSummary}
        </p>
      )}
      {tool.workingDirectory && (
        <p className="mt-1 font-mono text-[0.6rem] text-outline opacity-70">
          wd: {tool.workingDirectory}
        </p>
      )}
      {(tool.exitCode !== undefined && tool.exitCode !== null) && (
        <p
          className={cn(
            "mt-1 font-mono text-[0.6rem]",
            tool.exitCode === 0 ? "text-emerald-600" : "text-rose-600",
          )}
        >
          exit {tool.exitCode}
          {tool.stderrPreview ? ` · ${tool.stderrPreview.slice(0, 80)}` : ""}
        </p>
      )}
    </div>
  </div>
);

const WaitCard = ({
  wait,
  onOpenApproval,
}: {
  wait: RunWait;
  onOpenApproval: () => void;
}) => {
  const isApproval = wait.type === "APPROVAL";
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3",
        isApproval
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-outline-variant/30 bg-surface-container-low",
      )}
    >
      <div
        className={cn(
          "mt-0.5 rounded-lg p-1.5",
          isApproval ? "bg-amber-500/15" : "bg-surface-container",
        )}
      >
        <Shield
          size={13}
          className={
            isApproval
              ? "text-amber-600 dark:text-amber-400"
              : "text-secondary"
          }
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold text-primary">
            {wait.type.replace(/_/g, " ")}
          </p>
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase",
              wait.status === "OPEN"
                ? "bg-amber-500/10 text-amber-600"
                : "bg-emerald-500/10 text-emerald-600",
            )}
          >
            {wait.status}
          </span>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-secondary">
          {wait.message}
        </p>
        {wait.requestedBy && (
          <p className="mt-1 text-[0.62rem] text-outline">
            Requested by {wait.requestedBy} ·{" "}
            {new Date(wait.createdAt).toLocaleString()}
          </p>
        )}
        {isApproval && wait.status === "OPEN" && (
          <button
            type="button"
            onClick={onOpenApproval}
            className="mt-2 inline-flex items-center gap-1 rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-700"
          >
            <Shield size={10} /> Review &amp; Approve
          </button>
        )}
      </div>
    </div>
  );
};

const ArtifactCard = ({
  record,
  onSelect,
}: {
  record: LedgerArtifactRecord;
  onSelect: () => void;
}) => {
  const { artifact } = record;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-start gap-3 rounded-xl border border-outline-variant/25 bg-surface-container-low px-4 py-3 text-left hover:bg-primary/5"
    >
      <div className="mt-0.5 rounded-lg bg-primary/10 p-1.5">
        {artifact.contentFormat === "MARKDOWN" || artifact.contentFormat === "TEXT" ? (
          <FileText size={13} className="text-primary" />
        ) : (
          <FileCode size={13} className="text-primary" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold text-primary">{artifact.name}</p>
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[0.6rem] font-semibold text-primary">
            {artifact.direction ?? "OUTPUT"}
          </span>
        </div>
        {(artifact.summary || artifact.description) && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-secondary">
            {artifact.summary || artifact.description}
          </p>
        )}
        <p className="mt-1 text-[0.62rem] text-outline">
          {record.sourceAgentName ?? "agent"} · {artifact.type}
        </p>
      </div>
    </button>
  );
};

const MessageCard = ({
  message,
  onViewContext,
}: {
  message: CapabilityChatMessage;
  onViewContext?: (message: CapabilityChatMessage) => void;
}) => {
  const isUser = message.role === "user";
  // Only agent turns have a context envelope to view (the user turn IS
  // the input). Show the info icon when we have a callback AND a
  // traceId we can look up.
  const canViewContext = !isUser && Boolean(onViewContext && message.traceId);
  return (
    <div
      className={cn(
        "flex items-start gap-3",
        isUser ? "flex-row-reverse" : "",
      )}
    >
      <div
        className={cn(
          "mt-0.5 shrink-0 rounded-lg p-1.5",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-surface-container-high",
        )}
      >
        {isUser ? (
          <MessageSquare size={13} />
        ) : (
          <Bot size={13} className="text-primary" />
        )}
      </div>
      <div
        className={cn(
          "max-w-[80%] rounded-xl px-4 py-3",
          isUser
            ? "bg-primary/10"
            : "border border-outline-variant/25 bg-surface-container-low",
        )}
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-outline">
            {isUser ? "You" : (message.agentName ?? "Agent")}
            {message.timestamp ? ` · ${message.timestamp}` : ""}
          </p>
          {canViewContext && (
            <button
              type="button"
              onClick={() => onViewContext?.(message)}
              title="View the context envelope sent to the model"
              className="shrink-0 rounded p-0.5 text-outline hover:bg-primary/10 hover:text-primary"
            >
              <Info size={12} />
            </button>
          )}
        </div>
        <div className="text-xs leading-relaxed text-primary">
          <MarkdownContent content={message.content} />
        </div>
      </div>
    </div>
  );
};

// ── Main timeline component ───────────────────────────────────────────────────

const FILTERS: TimelineFilter[] = [
  "ALL",
  "CHAT",
  "AGENTS",
  "TOOLS",
  "ARTIFACTS",
  "APPROVALS",
  "ERRORS",
];

export const CockpitTimeline = ({
  runDetail,
  ledgerArtifacts,
  messages,
  streamedDraft,
  isStreaming,
  filter,
  workItemId,
  onFilterChange,
  onSelectArtifact,
  onOpenApproval,
  onViewMessageContext,
}: Props) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  const workItemRecords = workItemId
    ? ledgerArtifacts.filter((r) => r.artifact.workItemId === workItemId)
    : ledgerArtifacts;

  const items: CockpitTimelineItem[] = normalizeTimeline(
    runDetail?.steps ?? [],
    runDetail?.waits ?? [],
    runDetail?.toolInvocations ?? [],
    workItemRecords,
    messages,
  );

  const filtered = items.filter((item) => itemMatchesFilter(item, filter));

  // Auto-scroll on new messages / streaming
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamedDraft]);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* ── Filter chips ───────────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-outline-variant/30 bg-surface-container-low px-4 py-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => onFilterChange(f)}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[0.68rem] font-semibold transition-colors",
              filter === f
                ? "bg-primary text-primary-foreground"
                : "border border-outline-variant/40 text-secondary hover:border-primary/30 hover:text-primary",
            )}
          >
            {TIMELINE_FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      {/* ── Scrollable event list ──────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {filtered.length === 0 && !isStreaming ? (
          <div className="flex min-h-[12rem] flex-col items-center justify-center text-center">
            <p className="text-sm text-secondary opacity-60">
              {filter === "ALL"
                ? "No events yet. Start the workflow to see activity here."
                : `No ${TIMELINE_FILTER_LABELS[filter].toLowerCase()} events yet.`}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filtered.map((item) => {
              switch (item.kind) {
                case "STEP":
                  return <StepCard key={`step-${item.step.id}`} step={item.step} />;
                case "TOOL":
                  return <ToolCard key={`tool-${item.tool.id}`} tool={item.tool} />;
                case "WAIT":
                  return (
                    <WaitCard
                      key={`wait-${item.wait.id}`}
                      wait={item.wait}
                      onOpenApproval={onOpenApproval}
                    />
                  );
                case "ARTIFACT":
                  return (
                    <ArtifactCard
                      key={`artifact-${item.record.artifact.id}`}
                      record={item.record}
                      onSelect={() => onSelectArtifact(item.record.artifact.id)}
                    />
                  );
                case "MESSAGE":
                  return (
                    <MessageCard
                      key={`msg-${item.message.id}`}
                      message={item.message}
                      onViewContext={onViewMessageContext}
                    />
                  );
              }
            })}

            {/* Streaming draft */}
            {isStreaming && streamedDraft && (
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0 rounded-lg bg-surface-container-high p-1.5">
                  <Bot size={13} className="text-primary" />
                </div>
                <div className="max-w-[80%] rounded-xl border border-outline-variant/25 bg-surface-container-low px-4 py-3">
                  <p className="mb-1 flex items-center gap-1 text-[0.65rem] font-semibold uppercase tracking-wide text-outline">
                    <Loader2 size={9} className="animate-spin" /> Agent responding…
                  </p>
                  <div className="text-xs leading-relaxed text-primary">
                    <MarkdownContent content={streamedDraft} />
                  </div>
                </div>
              </div>
            )}

            {/* Streaming spinner with no content yet */}
            {isStreaming && !streamedDraft && (
              <div className="flex items-center gap-2 text-xs text-secondary">
                <Loader2 size={12} className="animate-spin text-primary" />
                Agent thinking…
              </div>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
