import { useMemo, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { cn } from "../../lib/utils";
import type { Workflow, WorkItem } from "../../types";

interface NewWorkItemFormProps {
  workflows: Workflow[];
  capabilityName?: string;
  isSubmitting: boolean;
  error?: string | null;
  onSubmit: (payload: {
    title: string;
    description?: string;
    workflowId: string;
    priority: WorkItem["priority"];
    tags: string[];
  }) => void;
  onCancel: () => void;
}

const PRIORITY_OPTIONS: WorkItem["priority"][] = ["High", "Med", "Low"];

export const NewWorkItemForm = ({
  workflows,
  capabilityName,
  isSubmitting,
  error,
  onSubmit,
  onCancel,
}: NewWorkItemFormProps) => {
  const eligibleWorkflows = useMemo(
    () => workflows.filter((workflow) => Array.isArray(workflow.steps) && workflow.steps.length > 0),
    [workflows],
  );

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [workflowId, setWorkflowId] = useState<string>(
    eligibleWorkflows[0]?.id || "",
  );
  const [priority, setPriority] = useState<WorkItem["priority"]>("Med");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  const canSubmit = title.trim().length > 0 && workflowId && !isSubmitting;

  const addTag = () => {
    const cleaned = tagInput.trim();
    if (!cleaned || tags.includes(cleaned)) {
      setTagInput("");
      return;
    }
    setTags((current) => [...current, cleaned]);
    setTagInput("");
  };

  const removeTag = (target: string) => {
    setTags((current) => current.filter((tag) => tag !== target));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      title: title.trim(),
      description: description.trim() || undefined,
      workflowId,
      priority,
      tags,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-primary">Start a new work item</p>
          {capabilityName ? (
            <p className="text-[0.7rem] uppercase tracking-[0.14em] text-outline">
              in {capabilityName}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-outline-variant/40 p-1 text-secondary hover:bg-surface-container-low"
          aria-label="Cancel"
        >
          <X size={14} />
        </button>
      </div>

      {eligibleWorkflows.length === 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          This capability has no workflows with stages defined. Add one in the
          Workflow Designer first.
        </div>
      ) : null}

      <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
        Title
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          maxLength={120}
          className="rounded-lg border border-outline-variant/50 bg-surface-container-low px-3 py-2 text-sm text-primary focus:border-primary focus:outline-none"
          placeholder="e.g. Onboard ACME Corp"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
        Description (optional)
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          maxLength={400}
          className="rounded-lg border border-outline-variant/50 bg-surface-container-low px-3 py-2 text-sm text-primary focus:border-primary focus:outline-none"
          placeholder="Short context the agents will read on every stage"
        />
      </label>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
          Workflow template
          <select
            value={workflowId}
            onChange={(event) => setWorkflowId(event.target.value)}
            disabled={eligibleWorkflows.length === 0}
            className="rounded-lg border border-outline-variant/50 bg-surface-container-low px-3 py-2 text-sm text-primary focus:border-primary focus:outline-none"
          >
            {eligibleWorkflows.map((workflow) => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.name} ({workflow.steps.length} stages)
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
          Priority
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as WorkItem["priority"])}
            className="rounded-lg border border-outline-variant/50 bg-surface-container-low px-3 py-2 text-sm text-primary focus:border-primary focus:outline-none"
          >
            {PRIORITY_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
        Tags
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-outline-variant/50 bg-surface-container-low p-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[0.7rem] text-primary"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="opacity-70 hover:opacity-100"
                aria-label={`Remove tag ${tag}`}
              >
                <X size={10} />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={tagInput}
            onChange={(event) => setTagInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                addTag();
              }
            }}
            onBlur={addTag}
            className="flex-1 min-w-[8rem] bg-transparent text-sm text-primary focus:outline-none"
            placeholder="Press Enter to add"
          />
        </div>
      </label>

      {error ? (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-outline-variant/40 px-3 py-1.5 text-xs text-secondary hover:bg-surface-container-low"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm",
            !canSubmit && "cursor-not-allowed opacity-60",
          )}
        >
          {isSubmitting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Plus size={12} />
          )}
          Create &amp; start
        </button>
      </div>
    </form>
  );
};
