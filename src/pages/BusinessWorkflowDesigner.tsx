import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Inbox, Loader2, Plus, Workflow as WorkflowIcon } from "lucide-react";
import { useCapability } from "../context/CapabilityContext";
import { useToast } from "../context/ToastContext";
import {
  archiveBusinessWorkflow,
  createBusinessWorkflow,
  fetchBusinessWorkflows,
  startBusinessWorkflowInstance,
} from "../lib/api";
import type { BusinessWorkflowTemplate } from "../contracts/businessWorkflow";
import { BusinessWorkflowStudio } from "./businessWorkflow/BusinessWorkflowStudio";
import { cn } from "../lib/utils";

const TemplateRow = ({
  template,
  onOpen,
  onStart,
  onArchive,
}: {
  template: BusinessWorkflowTemplate;
  onOpen: () => void;
  onStart: () => void;
  onArchive: () => void;
}) => (
  <div className="flex items-start justify-between gap-3 rounded-xl border border-outline-variant/40 bg-white px-4 py-3 hover:border-primary/40">
    <button
      type="button"
      onClick={onOpen}
      className="min-w-0 flex-1 text-left"
    >
      <p className="truncate text-sm font-semibold text-on-surface">
        {template.name}
      </p>
      {template.description && (
        <p className="mt-0.5 line-clamp-2 text-xs text-secondary">
          {template.description}
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[0.62rem] text-outline">
        <span className="rounded bg-surface-container-low px-1.5 py-0.5 font-mono">
          {template.id}
        </span>
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 font-semibold uppercase tracking-wider",
            template.status === "PUBLISHED"
              ? "bg-emerald-100 text-emerald-800"
              : template.status === "ARCHIVED"
                ? "bg-gray-200 text-gray-700"
                : "bg-amber-100 text-amber-800",
          )}
        >
          {template.status}
        </span>
        {template.currentVersion > 0 && (
          <span>v{template.currentVersion}</span>
        )}
        <span>{template.draftNodes.length} nodes</span>
        <span>{template.draftEdges.length} edges</span>
      </div>
    </button>
    <div className="flex flex-col gap-1">
      {template.currentVersion > 0 && (
        <button
          type="button"
          onClick={onStart}
          className="rounded-lg border border-outline-variant/40 bg-white px-2 py-1 text-[0.65rem] font-semibold text-primary hover:bg-primary/5"
        >
          Start instance
        </button>
      )}
      <button
        type="button"
        onClick={onArchive}
        className="rounded-lg border border-outline-variant/40 bg-white px-2 py-1 text-[0.65rem] text-secondary hover:bg-surface-container"
      >
        Archive
      </button>
    </div>
  </div>
);

const ListView = ({
  onOpen,
}: {
  onOpen: (templateId: string) => void;
}) => {
  const { activeCapability } = useCapability();
  const { error: toastError, success } = useToast();
  const [templates, setTemplates] = useState<BusinessWorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchBusinessWorkflows(activeCapability.id);
      setTemplates(list);
    } catch (err) {
      toastError(
        "Could not load business workflows",
        err instanceof Error ? err.message : "",
      );
    } finally {
      setLoading(false);
    }
  }, [activeCapability.id, toastError]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const created = await createBusinessWorkflow(activeCapability.id, {
        name: newName.trim(),
      });
      setTemplates((prev) => [created, ...prev]);
      setNewName("");
      setShowNew(false);
      onOpen(created.id);
    } catch (err) {
      toastError(
        "Create failed",
        err instanceof Error ? err.message : "",
      );
    } finally {
      setCreating(false);
    }
  };

  const handleStart = async (template: BusinessWorkflowTemplate) => {
    try {
      const instance = await startBusinessWorkflowInstance(
        activeCapability.id,
        template.id,
      );
      success(
        "Instance started",
        `Instance ${instance.id} is running. Open the inbox to see tasks.`,
      );
    } catch (err) {
      toastError(
        "Start failed",
        err instanceof Error ? err.message : "",
      );
    }
  };

  const handleArchive = async (template: BusinessWorkflowTemplate) => {
    try {
      await archiveBusinessWorkflow(activeCapability.id, template.id);
      setTemplates((prev) => prev.filter((t) => t.id !== template.id));
      success("Archived", `${template.name} is archived.`);
    } catch (err) {
      toastError(
        "Archive failed",
        err instanceof Error ? err.message : "",
      );
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-on-surface">
            Business Workflows
          </h1>
          <p className="mt-0.5 text-sm text-secondary">
            Human-driven workflows for {activeCapability.name}. Hybrid steps
            can delegate to capability agents.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate("/studio/business-workflows/inbox")}
            className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/40 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-surface-container"
          >
            <Inbox size={13} /> My Tasks
          </button>
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            <Plus size={13} /> New workflow
          </button>
        </div>
      </div>

      {showNew && (
        <div className="rounded-xl border border-outline-variant/40 bg-white p-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            placeholder="Workflow name"
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
              if (e.key === "Escape") {
                setShowNew(false);
                setNewName("");
              }
            }}
            className="w-full rounded-lg border border-outline-variant/40 px-2 py-1.5 text-sm"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowNew(false);
                setNewName("");
              }}
              className="rounded-lg border border-outline-variant/40 px-3 py-1.5 text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              className={cn(
                "rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground",
                (!newName.trim() || creating) && "cursor-not-allowed opacity-60",
              )}
            >
              {creating ? <Loader2 size={12} className="animate-spin" /> : "Create"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-secondary">
          <Loader2 size={14} className="animate-spin" /> Loading...
        </div>
      ) : templates.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-outline-variant/40 bg-surface-container-low p-10 text-center">
          <WorkflowIcon size={36} className="text-primary opacity-40" />
          <div>
            <p className="text-sm font-semibold text-on-surface">
              No business workflows yet
            </p>
            <p className="mt-1 text-xs text-secondary">
              Click "New workflow" to design an approval chain, expense
              review, contract sign-off, or any other human-driven process.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map((tpl) => (
            <TemplateRow
              key={tpl.id}
              template={tpl}
              onOpen={() => onOpen(tpl.id)}
              onStart={() => void handleStart(tpl)}
              onArchive={() => void handleArchive(tpl)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const BusinessWorkflowDesigner = () => {
  const params = useParams();
  const templateId = params.templateId;
  const navigate = useNavigate();

  if (templateId) {
    return <BusinessWorkflowStudio templateId={templateId} />;
  }

  return <ListView onOpen={(id) => navigate(`/studio/business-workflows/${id}`)} />;
};

export default BusinessWorkflowDesigner;
