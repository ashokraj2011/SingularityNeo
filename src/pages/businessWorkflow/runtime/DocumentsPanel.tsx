import { useState } from "react";
import {
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Plus,
  Trash2,
} from "lucide-react";
import { useToast } from "../../../context/ToastContext";
import {
  attachBusinessInstanceDocument,
  removeBusinessInstanceDocument,
} from "../../../lib/api";
import { cn } from "../../../lib/utils";
import type { BusinessDocument } from "../../../contracts/businessWorkflow";

/**
 * Reusable list-and-attach component for instance documents.
 *
 * Two modes:
 *
 *   - "live"    bound to an instance — Add/Remove call the REST API
 *               and the instance's context refreshes via onChanged.
 *   - "draft"   no instance yet — used by the launch dialog before
 *               the operator clicks Launch. Maintains a local list
 *               that the parent reads out + bakes into
 *               context.__documents on submit.
 *
 * V1 supports URL-only attachments — no upload backend wired here.
 * The URL field accepts a Confluence link, Drive link, signed S3 URL,
 * etc. Once a real upload pipeline ships (V2.1), the new "Upload"
 * button just swaps in here without changing the model.
 */
type LiveProps = {
  mode: "live";
  capabilityId: string;
  instanceId: string;
  documents: BusinessDocument[];
  onChanged?: () => void;
  /** Hide the composer (e.g. when the instance is terminal). */
  readOnly?: boolean;
  className?: string;
};

type DraftProps = {
  mode: "draft";
  documents: BusinessDocument[];
  onAdd: (doc: BusinessDocument) => void;
  onRemove: (id: string) => void;
  className?: string;
};

type Props = LiveProps | DraftProps;

const iconForMime = (mime?: string) => {
  if (!mime) return FileText;
  if (mime.startsWith("image/")) return ImageIcon;
  return FileText;
};

const formatBytes = (n: number | undefined): string => {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

/** Build a synthesized BusinessDocument when the parent is in draft
 *  mode and doesn't yet have an actor / id from the server. */
const draftDoc = (
  name: string,
  url: string,
  mimeType?: string,
  description?: string,
  sizeBytes?: number,
): BusinessDocument => ({
  id: `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  name,
  url,
  mimeType,
  description,
  sizeBytes,
  uploadedBy: "you",
  uploadedAt: new Date().toISOString(),
});

export const DocumentsPanel = (props: Props) => {
  const { error: toastError, success } = useToast();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const isReadOnly = props.mode === "live" && props.readOnly;

  const handleAdd = async () => {
    const n = name.trim();
    const u = url.trim();
    if (!n || !u) {
      toastError(
        "Need name + URL",
        "Both fields are required to attach a document.",
      );
      return;
    }
    if (props.mode === "live") {
      setSubmitting(true);
      try {
        await attachBusinessInstanceDocument(
          props.capabilityId,
          props.instanceId,
          {
            name: n,
            url: u,
            description: description.trim() || undefined,
          },
        );
        success("Attached", n);
        setName("");
        setUrl("");
        setDescription("");
        props.onChanged?.();
      } catch (err) {
        toastError(
          "Attach failed",
          err instanceof Error ? err.message : "Unknown error",
        );
      } finally {
        setSubmitting(false);
      }
    } else {
      props.onAdd(draftDoc(n, u, undefined, description.trim() || undefined));
      setName("");
      setUrl("");
      setDescription("");
    }
  };

  const handleRemove = async (id: string, displayName: string) => {
    if (props.mode === "live") {
      if (!confirm(`Remove "${displayName}" from this instance?`)) return;
      setBusyId(id);
      try {
        await removeBusinessInstanceDocument(
          props.capabilityId,
          props.instanceId,
          id,
        );
        success("Removed", displayName);
        props.onChanged?.();
      } catch (err) {
        toastError(
          "Remove failed",
          err instanceof Error ? err.message : "Unknown error",
        );
      } finally {
        setBusyId(null);
      }
    } else {
      props.onRemove(id);
    }
  };

  return (
    <div className={cn("flex flex-col gap-2", props.className)}>
      {!isReadOnly && (
        <div className="rounded-lg border border-outline-variant/40 bg-white p-2">
          <p className="mb-1 text-[0.6rem] font-semibold uppercase tracking-wider text-secondary">
            Attach a document
          </p>
          <div className="flex flex-col gap-1.5">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='Display name (e.g. "Vendor invoice")'
              className="w-full rounded border border-outline-variant/40 bg-white px-1.5 py-1 text-[0.7rem]"
            />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://… (Confluence, Drive, S3 link, etc.)"
              className="w-full rounded border border-outline-variant/40 bg-white px-1.5 py-1 text-[0.7rem]"
            />
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Why this is relevant (optional)"
              className="w-full rounded border border-outline-variant/40 bg-white px-1.5 py-1 text-[0.7rem]"
            />
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={submitting || !name.trim() || !url.trim()}
              className="inline-flex items-center justify-center gap-1 rounded bg-primary px-2 py-1 text-[0.65rem] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <Plus size={10} />
              )}
              Attach
            </button>
            <p className="text-[0.55rem] text-outline">
              V1 stores a link only. Documents flow into every task on
              this instance via <code>context.__documents</code> — the
              assignee sees them automatically.
            </p>
          </div>
        </div>
      )}

      {props.documents.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-lg border-2 border-dashed border-outline-variant/40 bg-surface-container p-3 text-center">
          <Paperclip size={14} className="text-outline" />
          <p className="text-[0.7rem] text-outline">
            No documents attached.
            {!isReadOnly && " Add one above so every task has it."}
          </p>
        </div>
      ) : (
        <ul className="space-y-1">
          {props.documents.map((doc) => {
            const Icon = iconForMime(doc.mimeType);
            const busy = busyId === doc.id;
            return (
              <li
                key={doc.id}
                className="group flex items-start gap-2 rounded-lg border border-outline-variant/30 bg-white p-2"
              >
                <Icon
                  size={14}
                  className="mt-0.5 shrink-0 text-secondary"
                />
                <div className="min-w-0 flex-1">
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 truncate text-[0.7rem] font-semibold text-primary hover:underline"
                  >
                    <span className="truncate">{doc.name}</span>
                    <ExternalLink size={9} className="shrink-0 opacity-70" />
                  </a>
                  {doc.description && (
                    <p className="mt-0.5 line-clamp-2 text-[0.62rem] text-outline">
                      {doc.description}
                    </p>
                  )}
                  <p className="mt-0.5 text-[0.55rem] text-outline">
                    {doc.mimeType && <span>{doc.mimeType} · </span>}
                    {doc.sizeBytes != null && (
                      <span>{formatBytes(doc.sizeBytes)} · </span>
                    )}
                    by <strong>{doc.uploadedBy}</strong> ·{" "}
                    {new Date(doc.uploadedAt).toLocaleString()}
                  </p>
                </div>
                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={() => void handleRemove(doc.id, doc.name)}
                    disabled={busy}
                    className="invisible rounded p-0.5 text-rose-500 hover:bg-rose-50 group-hover:visible disabled:visible"
                    title="Remove"
                  >
                    {busy ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : (
                      <Trash2 size={10} />
                    )}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
