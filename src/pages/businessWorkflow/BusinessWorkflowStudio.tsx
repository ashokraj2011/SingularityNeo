import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  History,
  Loader2,
  Save,
  Send,
  Sparkles,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useCapability } from "../../context/CapabilityContext";
import { useToast } from "../../context/ToastContext";
import {
  fetchBusinessWorkflow,
  listBusinessCustomNodeTypes,
  publishBusinessWorkflow,
  saveBusinessWorkflow,
} from "../../lib/api";
import {
  addEdge as addEdgeFn,
  addNode as addNodeFn,
  moveNode,
  newBusinessEdge,
  newBusinessNode,
  removeEdge,
  removeNode,
  updateEdge,
  updateNode,
  validateGraph,
} from "../../lib/businessWorkflowGraph";
import type {
  BusinessCustomNodeType,
  BusinessEdge,
  BusinessNode,
  BusinessNodeBaseType,
  BusinessWorkflowTemplate,
  BusinessWorkflowVersion,
} from "../../contracts/businessWorkflow";
import { Canvas } from "./Canvas";
import { NodePalette } from "./NodePalette";
import { NodeInspector } from "./NodeInspector";
import { EdgeInspector } from "./EdgeInspector";
import { CustomNodeTypeModal } from "./CustomNodeTypeModal";
import { cn } from "../../lib/utils";

type Selection =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  | null;

type Props = {
  templateId: string;
};

export const BusinessWorkflowStudio = ({ templateId }: Props) => {
  const navigate = useNavigate();
  const { activeCapability, getCapabilityWorkspace } = useCapability();
  const { error: toastError, success } = useToast();

  const [template, setTemplate] = useState<BusinessWorkflowTemplate | null>(null);
  const [versions, setVersions] = useState<BusinessWorkflowVersion[]>([]);
  const [nodes, setNodes] = useState<BusinessNode[]>([]);
  const [edges, setEdges] = useState<BusinessEdge[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [name, setName] = useState("");
  const [customNodeTypes, setCustomNodeTypes] = useState<
    BusinessCustomNodeType[]
  >([]);
  const [showCustomTypesModal, setShowCustomTypesModal] = useState(false);

  const workspace = getCapabilityWorkspace(activeCapability.id);
  const capabilityAgents = workspace.agents;

  const refreshCustomNodeTypes = useCallback(async () => {
    try {
      const list = await listBusinessCustomNodeTypes(activeCapability.id);
      setCustomNodeTypes(list);
    } catch {
      // Non-fatal — palette just won't include custom types.
    }
  }, [activeCapability.id]);

  useEffect(() => {
    void refreshCustomNodeTypes();
  }, [refreshCustomNodeTypes]);

  const issues = useMemo(() => validateGraph({ nodes, edges }), [nodes, edges]);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchBusinessWorkflow(activeCapability.id, templateId)
      .then((result) => {
        if (cancelled) return;
        setTemplate(result.template);
        setVersions(result.versions);
        setName(result.template.name);
        setNodes(result.template.draftNodes);
        setEdges(result.template.draftEdges);
      })
      .catch((err) => {
        if (cancelled) return;
        toastError(
          "Could not load workflow",
          err instanceof Error ? err.message : "Unknown error",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeCapability.id, templateId, toastError]);

  const selectedNode = useMemo(
    () =>
      selection?.kind === "node"
        ? nodes.find((n) => n.id === selection.id) || null
        : null,
    [selection, nodes],
  );

  const selectedEdge = useMemo(
    () =>
      selection?.kind === "edge"
        ? edges.find((e) => e.id === selection.id) || null
        : null,
    [selection, edges],
  );

  const handleEdgePatch = useCallback(
    (patch: Partial<BusinessEdge>) => {
      if (selection?.kind !== "edge") return;
      setEdges((prev) => updateEdge(prev, selection.id, patch));
    },
    [selection],
  );

  const handleAddNode = useCallback(
    (type: string) => {
      // For custom node types, use the registered label; for base types
      // the palette label suffices.
      const custom = customNodeTypes.find((t) => t.name === type);
      const node = newBusinessNode(
        type,
        {
          x: 240 + Math.round(Math.random() * 240),
          y: 200 + Math.round(Math.random() * 200),
        },
        custom?.label,
      );
      setNodes((prev) => addNodeFn(prev, node));
      setSelection({ kind: "node", id: node.id });
    },
    [customNodeTypes],
  );

  const handleMoveNode = useCallback(
    (nodeId: string, position: { x: number; y: number }) => {
      setNodes((prev) => moveNode(prev, nodeId, position));
    },
    [],
  );

  const handleConnect = useCallback(
    (sourceNodeId: string, targetNodeId: string) => {
      // Disallow duplicates / self
      if (sourceNodeId === targetNodeId) return;
      setEdges((prev) => {
        if (
          prev.some(
            (e) =>
              e.sourceNodeId === sourceNodeId &&
              e.targetNodeId === targetNodeId,
          )
        ) {
          return prev;
        }
        return addEdgeFn(prev, newBusinessEdge(sourceNodeId, targetNodeId));
      });
    },
    [],
  );

  const handleNodePatch = useCallback(
    (patch: Partial<BusinessNode>) => {
      if (selection?.kind !== "node") return;
      setNodes((prev) => updateNode(prev, selection.id, patch));
    },
    [selection],
  );

  const handleDeleteSelection = useCallback(() => {
    if (!selection) return;
    if (selection.kind === "node") {
      const result = removeNode(nodes, edges, selection.id);
      setNodes(result.nodes);
      setEdges(result.edges);
    } else {
      setEdges(removeEdge(edges, selection.id));
    }
    setSelection(null);
  }, [edges, nodes, selection]);

  const handleSave = useCallback(async () => {
    if (!template) return;
    setSaving(true);
    try {
      const updated = await saveBusinessWorkflow(
        activeCapability.id,
        template.id,
        {
          name: name.trim() || template.name,
          draftNodes: nodes,
          draftEdges: edges,
        },
      );
      setTemplate(updated);
      success("Saved", "Draft saved.");
    } catch (err) {
      toastError(
        "Save failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setSaving(false);
    }
  }, [activeCapability.id, edges, name, nodes, success, template, toastError]);

  const handlePublish = useCallback(async () => {
    if (!template) return;
    if (issues.length > 0) {
      // Surface the actual validation reasons so the user can self-fix
      // instead of being stuck staring at "Fix 1 issue first."
      toastError(
        "Cannot publish",
        issues.slice(0, 3).join(" · ") +
          (issues.length > 3 ? ` (+${issues.length - 3} more)` : ""),
      );
      return;
    }
    setPublishing(true);
    try {
      // Save draft first so the published snapshot reflects the latest edits.
      await saveBusinessWorkflow(activeCapability.id, template.id, {
        name: name.trim() || template.name,
        draftNodes: nodes,
        draftEdges: edges,
      });
      const version = await publishBusinessWorkflow(
        activeCapability.id,
        template.id,
      );
      setVersions((prev) => [version, ...prev]);
      setTemplate((prev) =>
        prev
          ? {
              ...prev,
              currentVersion: version.version,
              status: "PUBLISHED",
            }
          : prev,
      );
      success("Published", `Version ${version.version} is live.`);
    } catch (err) {
      toastError(
        "Publish failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setPublishing(false);
    }
  }, [
    activeCapability.id,
    edges,
    issues.length,
    name,
    nodes,
    success,
    template,
    toastError,
  ]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={20} className="animate-spin text-primary" />
      </div>
    );
  }

  if (!template) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <p className="text-sm text-secondary">Workflow not found.</p>
        <button
          type="button"
          onClick={() => navigate("/studio/business-workflows")}
          className="rounded-lg border border-outline-variant/40 px-3 py-1.5 text-xs"
        >
          Back to list
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top toolbar */}
      <header className="flex shrink-0 items-center gap-3 border-b border-outline-variant/30 bg-surface px-4 py-2.5">
        <button
          type="button"
          onClick={() => navigate("/studio/business-workflows")}
          className="rounded-lg border border-outline-variant/40 p-1.5 text-secondary hover:text-primary"
          title="Back"
        >
          <ArrowLeft size={14} />
        </button>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-outline-variant/40 bg-white px-2 py-1 text-sm font-semibold"
        />
        <span className="rounded-full bg-surface-container px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-secondary">
          {template.status} · v{template.currentVersion}
        </span>
        {issues.length > 0 && (
          <span
            title={issues.join("\n")}
            className="rounded-full bg-amber-100 px-2 py-0.5 text-[0.62rem] font-semibold text-amber-800"
          >
            {issues.length} issue{issues.length === 1 ? "" : "s"}
          </span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={cn(
            "inline-flex items-center gap-1 rounded-lg border border-outline-variant/40 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-surface-container",
            saving && "opacity-60",
          )}
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          Save Draft
        </button>
        <button
          type="button"
          onClick={handlePublish}
          disabled={publishing || issues.length > 0}
          className={cn(
            "inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90",
            (publishing || issues.length > 0) && "cursor-not-allowed opacity-60",
          )}
          title={issues.length > 0 ? "Resolve issues first" : "Publish a new version"}
        >
          {publishing ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Send size={12} />
          )}
          Publish
        </button>
        {versions.length > 0 && (
          <span
            title={`Versions: ${versions.map((v) => `v${v.version} @ ${new Date(v.publishedAt).toLocaleString()}`).join("\n")}`}
            className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/40 bg-white px-2 py-1 text-[0.65rem] text-secondary"
          >
            <History size={10} />
            {versions.length} versions
          </span>
        )}
        <button
          type="button"
          onClick={() => setShowCustomTypesModal(true)}
          className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 text-[0.7rem] font-semibold text-on-surface hover:bg-surface-container"
          title="Manage capability-specific node types (e.g. 'Marketing Review')"
        >
          <Sparkles size={11} />
          Custom Types ({customNodeTypes.length})
        </button>
      </header>

      {/* 3-pane body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <NodePalette
          onAdd={handleAddNode}
          customNodeTypes={customNodeTypes}
        />
        <Canvas
          nodes={nodes}
          edges={edges}
          selection={selection}
          onSelect={setSelection}
          onMoveNode={handleMoveNode}
          onConnect={handleConnect}
          onDeleteSelection={handleDeleteSelection}
          customNodeTypes={customNodeTypes}
        />
        {selectedNode ? (
          <NodeInspector
            node={selectedNode}
            capabilityAgents={capabilityAgents}
            onChange={handleNodePatch}
            onDelete={handleDeleteSelection}
          />
        ) : selectedEdge ? (
          <EdgeInspector
            edge={selectedEdge}
            sourceLabel={
              nodes.find((n) => n.id === selectedEdge.sourceNodeId)?.label ||
              selectedEdge.sourceNodeId
            }
            targetLabel={
              nodes.find((n) => n.id === selectedEdge.targetNodeId)?.label ||
              selectedEdge.targetNodeId
            }
            onChange={handleEdgePatch}
            onDelete={handleDeleteSelection}
          />
        ) : (
          <aside className="flex w-80 shrink-0 flex-col gap-3 border-l border-outline-variant/30 bg-surface-container-low p-4">
            <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
              Inspector
            </p>
            <p className="text-xs text-outline">
              Select a node to edit its config — or click an edge to add an
              AND/OR routing condition.
            </p>
            <div className="rounded-lg border border-sky-200 bg-sky-50 p-2 text-[0.7rem] text-sky-900">
              <p className="font-semibold">Wiring tips</p>
              <ul className="mt-1 list-disc pl-4 space-y-0.5">
                <li>
                  <strong>Drag</strong> the right-edge → handle to another
                  node.
                </li>
                <li>
                  Or <strong>click</strong> the → handle, then click any
                  target node.
                </li>
                <li>Esc cancels. Delete/Backspace removes selection.</li>
              </ul>
            </div>
            {issues.length > 0 ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-[0.7rem] text-amber-800">
                <p className="font-semibold">Validation</p>
                <ul className="mt-1 list-disc pl-4">
                  {issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1.5 text-[0.7rem] text-emerald-800">
                <Check size={11} />
                Graph looks good
              </div>
            )}
          </aside>
        )}
      </div>

      <CustomNodeTypeModal
        capabilityId={activeCapability.id}
        open={showCustomTypesModal}
        onClose={() => setShowCustomTypesModal(false)}
        onChanged={() => void refreshCustomNodeTypes()}
      />
    </div>
  );
};
