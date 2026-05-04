import { useMemo, useState } from "react";
import { Loader2, Paperclip, Play, Settings2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  startBusinessWorkflowInstance,
  fetchBusinessWorkflow,
} from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { useToast } from "../../../context/ToastContext";
import type {
  BusinessDocument,
  BusinessNode,
} from "../../../contracts/businessWorkflow";
import { interpretFormSchema } from "../../../lib/businessFormSchema";
import { DocumentsPanel } from "./DocumentsPanel";

/**
 * Launch dialog opened from the Studio's "Start instance" button.
 *
 * Renders the START node's `config.formSchema` as the launch form.
 * Whatever the operator types becomes the instance's initial
 * `context` (via the `contextOverrides` param to startBusinessInstance).
 *
 * Form schema shapes we support, in priority order:
 *   1. Structured: { fields: [{ key, label, placeholder?, multiline?, defaultValue? }] }
 *      → real fields (matches the CustomNodeTypeFieldDef shape used
 *        elsewhere). This is what the StudioInspector emits when you
 *        configure a START node.
 *   2. Object map of key → label (e.g. { employeeName: "Employee", … })
 *      → one input per key, label is the value.
 *   3. Anything else / null → JSON textarea so the operator can type
 *      arbitrary context. We don't BLOCK on missing schema — START
 *      can be parameter-less.
 */
type Props = {
  open: boolean;
  capabilityId: string;
  templateId: string;
  templateName: string;
  /** Pre-fetched START node (config.formSchema is the launch form).
   *  When undefined, dialog fetches the latest version on open. */
  startNode?: BusinessNode;
  onClose: () => void;
};

// Schema interpretation lives in lib/businessFormSchema so the
// launch dialog and the task-completion dialog stay aligned. See
// `interpretFormSchema` for the supported shapes.

export const InstanceLaunchDialog = ({
  open,
  capabilityId,
  templateId,
  templateName,
  startNode: startNodeProp,
  onClose,
}: Props) => {
  const { error: toastError, success } = useToast();
  const navigate = useNavigate();
  const [startNode, setStartNode] = useState<BusinessNode | undefined>(
    startNodeProp,
  );
  const [loadingStart, setLoadingStart] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [structured, setStructured] = useState<Record<string, string>>({});
  const [rawJson, setRawJson] = useState("{}");
  /** Two tabs in the body: Inputs and Documents. Documents bake into
   *  context.__documents at submit time so the assignee on every
   *  task sees them. */
  const [tab, setTab] = useState<"inputs" | "documents">("inputs");
  const [draftDocuments, setDraftDocuments] = useState<BusinessDocument[]>([]);

  // On first open, if the parent didn't pass a startNode, fetch the
  // template and find it in the latest published version. We do this
  // lazily so the dialog stays cheap when never opened.
  useMemo(() => {
    if (!open || startNode) return;
    let cancelled = false;
    (async () => {
      setLoadingStart(true);
      try {
        const tpl = await fetchBusinessWorkflow(capabilityId, templateId);
        const latest = tpl.versions[0];
        if (!latest) {
          toastError(
            "No published version",
            "Publish the template before starting an instance.",
          );
          onClose();
          return;
        }
        if (cancelled) return;
        const sn = latest.nodes.find((n) => n.type === "START");
        setStartNode(sn);
      } catch (err) {
        if (cancelled) return;
        toastError(
          "Couldn't load template",
          err instanceof Error ? err.message : "Unknown error",
        );
        onClose();
      } finally {
        if (!cancelled) setLoadingStart(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const interp = useMemo(
    () => interpretFormSchema(startNode?.config?.formSchema),
    [startNode],
  );

  const handleLaunch = async () => {
    let context: Record<string, unknown> = {};
    if (interp.kind === "structured") {
      // Apply defaults for fields the operator left blank — saves them
      // re-typing the placeholder.
      for (const f of interp.fields) {
        const v = structured[f.key];
        context[f.key] = v != null && v !== "" ? v : f.defaultValue || "";
      }
    } else {
      try {
        context = rawJson.trim() ? JSON.parse(rawJson) : {};
        if (typeof context !== "object" || Array.isArray(context)) {
          throw new Error("JSON must be an object.");
        }
      } catch (err) {
        toastError(
          "Invalid JSON",
          err instanceof Error ? err.message : "Could not parse",
        );
        return;
      }
    }
    // Bake any draft documents into context.__documents so the
    // first task already sees them.
    if (draftDocuments.length > 0) {
      context = {
        ...context,
        __documents: draftDocuments.map((d, i) => ({
          // Replace the synthetic draft id with a stable launch-time id
          // so timeline events can reference it.
          id: `bdoc-launch-${i}-${Date.now().toString(36)}`,
          name: d.name,
          url: d.url,
          mimeType: d.mimeType,
          sizeBytes: d.sizeBytes,
          description: d.description,
          // Server doesn't see the live operator name here; it's filled
          // by the route's resolveActor on subsequent attaches. For
          // launch-time docs the operator is the instance's startedBy.
          uploadedBy: "operator",
          uploadedAt: new Date().toISOString(),
        })),
      };
    }
    setSubmitting(true);
    try {
      const instance = await startBusinessWorkflowInstance(
        capabilityId,
        templateId,
        context,
      );
      success("Instance started", `Tracking ${instance.id}.`);
      onClose();
      navigate(
        `/studio/business-workflows/${encodeURIComponent(
          templateId,
        )}/instances/${encodeURIComponent(instance.id)}`,
      );
    } catch (err) {
      toastError(
        "Could not start instance",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-[1] flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl">
        <header className="flex items-center justify-between border-b border-outline-variant/30 px-5 py-3">
          <div className="min-w-0">
            <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
              Launch instance
            </p>
            <h2 className="truncate text-base font-semibold text-on-surface">
              {templateName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-outline-variant/40 p-1.5 text-secondary hover:text-primary"
          >
            <X size={14} />
          </button>
        </header>

        {/* Tab strip — Inputs vs Documents.
            Documents are an instance-level concern; they're bundled
            into the launch context but kept on a separate tab so the
            input form doesn't get cluttered. */}
        <div className="flex shrink-0 border-b border-outline-variant/30 bg-white">
          <button
            type="button"
            onClick={() => setTab("inputs")}
            className={cn(
              "flex-1 border-b-2 px-3 py-1.5 text-xs font-semibold inline-flex items-center justify-center gap-1.5",
              tab === "inputs"
                ? "border-primary text-primary"
                : "border-transparent text-secondary hover:text-on-surface",
            )}
          >
            <Settings2 size={11} /> Inputs
          </button>
          <button
            type="button"
            onClick={() => setTab("documents")}
            className={cn(
              "flex-1 border-b-2 px-3 py-1.5 text-xs font-semibold inline-flex items-center justify-center gap-1.5",
              tab === "documents"
                ? "border-primary text-primary"
                : "border-transparent text-secondary hover:text-on-surface",
            )}
          >
            <Paperclip size={11} /> Documents
            {draftDocuments.length > 0 && (
              <span className="rounded-full bg-primary/15 px-1.5 text-[0.55rem] text-primary">
                {draftDocuments.length}
              </span>
            )}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === "documents" ? (
            <div className="flex flex-col gap-2">
              <p className="text-[0.7rem] text-outline">
                Documents attached here are bundled into the instance's
                context as <code>__documents</code> and visible to every
                task assignee — no extra wiring per node.
              </p>
              <DocumentsPanel
                mode="draft"
                documents={draftDocuments}
                onAdd={(doc) =>
                  setDraftDocuments((prev) => [...prev, doc])
                }
                onRemove={(id) =>
                  setDraftDocuments((prev) =>
                    prev.filter((d) => d.id !== id),
                  )
                }
              />
            </div>
          ) : loadingStart ? (
            <div className="flex items-center gap-2 text-xs text-secondary">
              <Loader2 size={12} className="animate-spin" /> Loading template…
            </div>
          ) : interp.kind === "structured" ? (
            <div className="flex flex-col gap-3">
              <p className="text-[0.7rem] text-outline">
                Fill in the inputs the workflow needs to start. These flow
                into the instance context and can be referenced in edge
                conditions like <code>params.employeeName</code>.
              </p>
              {interp.fields.map((f) => (
                <label key={f.key} className="block text-xs">
                  <span className="mb-1 block text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
                    {f.label}
                  </span>
                  {f.multiline ? (
                    <textarea
                      value={structured[f.key] ?? f.defaultValue ?? ""}
                      onChange={(e) =>
                        setStructured((prev) => ({
                          ...prev,
                          [f.key]: e.target.value,
                        }))
                      }
                      placeholder={f.placeholder}
                      rows={3}
                      className="w-full resize-y rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 text-xs"
                    />
                  ) : (
                    <input
                      type="text"
                      value={structured[f.key] ?? f.defaultValue ?? ""}
                      onChange={(e) =>
                        setStructured((prev) => ({
                          ...prev,
                          [f.key]: e.target.value,
                        }))
                      }
                      placeholder={f.placeholder}
                      className="w-full rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 text-xs"
                    />
                  )}
                  <p className="mt-0.5 font-mono text-[0.55rem] text-outline">
                    params.{f.key}
                  </p>
                </label>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-[0.7rem] text-outline">
                {startNode?.config?.formSchema
                  ? "Provide initial context as JSON (this template's START node uses an unstructured schema)."
                  : "This template's START node has no input schema. Add custom JSON if your workflow expects context, otherwise launch with empty {}."}
              </p>
              <textarea
                value={rawJson}
                onChange={(e) => setRawJson(e.target.value)}
                rows={8}
                spellCheck={false}
                className="w-full resize-y rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 font-mono text-[0.7rem]"
              />
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-outline-variant/30 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-outline-variant/40 px-3 py-1.5 text-xs"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleLaunch()}
            disabled={submitting || loadingStart}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90",
              (submitting || loadingStart) && "opacity-60 cursor-not-allowed",
            )}
          >
            {submitting ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Play size={12} />
            )}
            Launch
          </button>
        </footer>
      </div>
    </div>
  );
};
