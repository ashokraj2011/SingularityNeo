import { useRef, useState, useCallback } from "react";
import { Loader2, Send, Slash } from "lucide-react";
import { cn } from "../../lib/utils";
import type { CockpitStatus, RightPanelMode } from "./types";

type Props = {
  status: CockpitStatus;
  hasWorkItem: boolean;
  onSend: (message: string) => void;
  onCommand: (cmd: string) => void;
  onPanelSwitch: (mode: RightPanelMode) => void;
};

// Slash commands available in the bar
const SLASH_COMMANDS: { cmd: string; label: string; panel?: RightPanelMode }[] =
  [
    { cmd: "/approve", label: "Open approval review", panel: "APPROVAL" },
    { cmd: "/artifact", label: "Browse artifacts", panel: "ARTIFACT" },
    { cmd: "/guidance", label: "Send agent guidance", panel: "GUIDANCE" },
    { cmd: "/now", label: "Show current state", panel: "NOW" },
    { cmd: "/refresh", label: "Refresh work item" },
  ];

export const CockpitCommandBar = ({
  status,
  hasWorkItem,
  onSend,
  onCommand,
  onPanelSwitch,
}: Props) => {
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isStreaming = status === "STREAMING";
  const isSubmitting = status === "SUBMITTING";
  const isDisabled = !hasWorkItem || isStreaming || isSubmitting;

  const startsWithSlash = input.startsWith("/");
  const slashMatches = startsWithSlash
    ? SLASH_COMMANDS.filter((s) =>
        s.cmd.startsWith(input.split(" ")[0].toLowerCase()),
      )
    : [];

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isDisabled) return;

    if (trimmed.startsWith("/")) {
      const cmd = trimmed.split(" ")[0].toLowerCase();
      const match = SLASH_COMMANDS.find((s) => s.cmd === cmd);
      if (match?.panel) {
        onPanelSwitch(match.panel);
      } else {
        onCommand(trimmed);
      }
    } else {
      onSend(trimmed);
    }
    setInput("");
    setShowSuggestions(false);
  }, [input, isDisabled, onCommand, onPanelSwitch, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setInput(v);
    setShowSuggestions(v.startsWith("/") && v.length > 0);
  };

  const applySuggestion = (cmd: string) => {
    setInput(cmd + " ");
    setShowSuggestions(false);
    textareaRef.current?.focus();
  };

  return (
    <div className="relative shrink-0 border-t border-outline-variant/30 bg-surface-container-low px-4 py-3">
      {/* Slash command suggestions */}
      {showSuggestions && slashMatches.length > 0 && (
        <div className="absolute bottom-full left-4 right-4 mb-1 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-high shadow-lg">
          {slashMatches.map((s) => (
            <button
              key={s.cmd}
              type="button"
              onClick={() => applySuggestion(s.cmd)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-xs hover:bg-primary/10"
            >
              <span className="w-24 shrink-0 font-mono font-semibold text-primary">
                {s.cmd}
              </span>
              <span className="text-secondary">{s.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Slash hint */}
        <button
          type="button"
          onClick={() => {
            setInput("/");
            setShowSuggestions(true);
            textareaRef.current?.focus();
          }}
          title="Slash commands"
          className="mb-1.5 shrink-0 text-secondary opacity-50 hover:opacity-100"
        >
          <Slash size={14} />
        </button>

        {/* Input */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => input.startsWith("/") && setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder={
            !hasWorkItem
              ? "Select a work item to start…"
              : isStreaming
              ? "Agent is responding…"
              : "Chat with the agent · /approve · /guidance · Shift+Enter for newline"
          }
          disabled={isDisabled}
          rows={2}
          className={cn(
            "flex-1 resize-none rounded-xl border border-outline-variant/40 bg-white/80 px-3 py-2 text-sm text-primary placeholder-secondary/50 focus:border-primary focus:outline-none dark:bg-surface-container",
            isDisabled && "cursor-not-allowed opacity-60",
          )}
        />

        {/* Send */}
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim() || isDisabled}
          className={cn(
            "mb-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-xs font-semibold text-primary-foreground",
            (!input.trim() || isDisabled) && "cursor-not-allowed opacity-60",
          )}
        >
          {isStreaming ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Send size={13} />
          )}
          {isStreaming ? "…" : "Send"}
        </button>
      </div>

      {/* Status hint */}
      {isStreaming && (
        <p className="mt-1 flex items-center gap-1 text-[0.65rem] text-secondary opacity-70">
          <Loader2 size={9} className="animate-spin" /> Agent responding…
        </p>
      )}
    </div>
  );
};
