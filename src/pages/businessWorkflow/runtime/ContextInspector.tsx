import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "../../../lib/utils";
import { useToast } from "../../../context/ToastContext";
import {
  removeBusinessInstanceContextKeys,
  updateBusinessInstanceContext,
} from "../../../lib/api";

/**
 * Editable collapsible JSON tree of `instance.context`.
 *
 * Operators can drop new keys mid-flight (the workgraph-studio "params"
 * pattern) so downstream edge conditions can react to operator
 * decisions without rewiring the graph. Reserved keys (`__` prefix)
 * are never editable here — they belong to internal collections like
 * `__documents` (Slice 3).
 *
 * Strategy:
 *   - Top-level shallow merge only. Setting `foo.bar.baz` requires
 *     editing the whole `foo` object — kept simple to keep the API
 *     debuggable.
 *   - JSON value parser tries (in order): boolean / number / JSON /
 *     raw string. Operator can paste `{"a":1}` and get an object.
 *   - Every change emits CONTEXT_UPDATED on the timeline so the audit
 *     trail captures who set what.
 */
type Props = {
  capabilityId?: string;
  instanceId?: string;
  context: Record<string, unknown>;
  /** When false, hide the editor and render read-only (legacy callers
   *  who don't want to expose editing). */
  editable?: boolean;
  onChanged?: () => void;
  className?: string;
};

const parseValue = (raw: string): unknown => {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to raw string
    }
  }
  return raw;
};

export const ContextInspector = ({
  capabilityId,
  instanceId,
  context,
  editable = false,
  onChanged,
  className,
}: Props) => {
  const editableLive = editable && Boolean(capabilityId && instanceId);
  const userKeys = context
    ? Object.keys(context).filter((k) => !k.startsWith("__"))
    : [];

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {editableLive && capabilityId && instanceId && (
        <ContextComposer
          capabilityId={capabilityId}
          instanceId={instanceId}
          onChanged={onChanged}
        />
      )}
      {!context || userKeys.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-lg border-2 border-dashed border-outline-variant/40 bg-surface-container p-4 text-center">
          <Database size={14} className="text-outline" />
          <p className="text-[0.7rem] text-outline">
            Context is empty. Bindings on completed nodes (or operator
            additions above) will populate dotted paths here.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-outline-variant/30 bg-white p-2 font-mono text-[0.7rem]">
          <TopLevel
            context={context}
            capabilityId={capabilityId}
            instanceId={instanceId}
            editableLive={editableLive}
            onChanged={onChanged}
          />
        </div>
      )}
    </div>
  );
};

const ContextComposer = ({
  capabilityId,
  instanceId,
  onChanged,
}: {
  capabilityId: string;
  instanceId: string;
  onChanged?: () => void;
}) => {
  const { error: toastError, success } = useToast();
  const [key, setKey] = useState("");
  const [valueText, setValueText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const k = key.trim();
    if (!k) {
      toastError("Missing key", "Type a key name first.");
      return;
    }
    if (k.startsWith("__")) {
      toastError(
        "Reserved key",
        "Keys starting with `__` are managed internally — pick another name.",
      );
      return;
    }
    setSubmitting(true);
    try {
      await updateBusinessInstanceContext(capabilityId, instanceId, {
        [k]: parseValue(valueText),
      });
      success("Context updated", `${k} set.`);
      setKey("");
      setValueText("");
      onChanged?.();
    } catch (err) {
      toastError(
        "Update failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border border-outline-variant/40 bg-white p-1.5">
      <p className="mb-1 text-[0.6rem] font-semibold uppercase tracking-wider text-secondary">
        + Add / update key
      </p>
      <div className="flex flex-col gap-1.5">
        <input
          type="text"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="key (e.g. priorityOverride)"
          className="w-full rounded border border-outline-variant/40 bg-white px-1.5 py-1 font-mono text-[0.65rem]"
        />
        <div className="flex items-stretch gap-1">
          <input
            type="text"
            value={valueText}
            onChange={(e) => setValueText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder='value · "URGENT" · 42 · true · {"a":1}'
            className="min-w-0 flex-1 rounded border border-outline-variant/40 bg-white px-1.5 py-1 font-mono text-[0.65rem]"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || !key.trim()}
            className="inline-flex items-center gap-0.5 rounded bg-primary px-2 py-1 text-[0.65rem] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 size={9} className="animate-spin" />
            ) : (
              <Plus size={9} />
            )}
            Set
          </button>
        </div>
        <p className="text-[0.55rem] text-outline">
          Booleans, numbers, and JSON literals are auto-parsed. Anything
          else stored as a string. Cmd/Ctrl+Enter submits.
        </p>
      </div>
    </div>
  );
};

const TopLevel = ({
  context,
  capabilityId,
  instanceId,
  editableLive,
  onChanged,
}: {
  context: Record<string, unknown>;
  capabilityId?: string;
  instanceId?: string;
  editableLive: boolean;
  onChanged?: () => void;
}) => {
  const { error: toastError, success } = useToast();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const userKeys = Object.keys(context).filter((k) => !k.startsWith("__"));

  const remove = async (key: string) => {
    if (!editableLive || !capabilityId || !instanceId) return;
    if (!confirm(`Remove "${key}" from instance context?`)) return;
    setBusyKey(key);
    try {
      await removeBusinessInstanceContextKeys(capabilityId, instanceId, [key]);
      success("Removed", `${key} unset.`);
      onChanged?.();
    } catch (err) {
      toastError(
        "Remove failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <>
      {userKeys.map((k) => {
        const path = k;
        return (
          <div key={k} className="group flex items-start gap-1 leading-snug">
            <span className="min-w-0 flex-1">
              <span className="text-violet-700" title={`Path: ${path}`}>
                {k}
              </span>
              <span className="text-outline">: </span>
              <Tree value={context[k]} initialPath={path} depth={0} />
            </span>
            {editableLive && (
              <button
                type="button"
                onClick={() => void remove(k)}
                disabled={busyKey === k}
                className="invisible rounded p-0.5 text-rose-500 hover:bg-rose-50 group-hover:visible disabled:visible"
                title={`Remove ${k}`}
              >
                {busyKey === k ? (
                  <Loader2 size={9} className="animate-spin" />
                ) : (
                  <Trash2 size={9} />
                )}
              </button>
            )}
          </div>
        );
      })}
    </>
  );
};

const Tree = ({
  value,
  initialPath,
  depth,
}: {
  value: unknown;
  initialPath: string;
  depth: number;
}) => {
  if (value == null) {
    return <span className="text-rose-600">null</span>;
  }
  if (typeof value === "string") {
    return <span className="text-emerald-700">"{value}"</span>;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return <span className="text-sky-700">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    return <ArrayNode arr={value} initialPath={initialPath} depth={depth} />;
  }
  if (typeof value === "object") {
    return (
      <ObjectNode
        obj={value as Record<string, unknown>}
        initialPath={initialPath}
        depth={depth}
      />
    );
  }
  return <span className="text-outline">{String(value)}</span>;
};

const ObjectNode = ({
  obj,
  initialPath,
  depth,
}: {
  obj: Record<string, unknown>;
  initialPath: string;
  depth: number;
}) => {
  const keys = Object.keys(obj);
  const [expanded, setExpanded] = useState(depth < 1);
  if (keys.length === 0) return <span className="text-outline">{"{}"}</span>;
  return (
    <span>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center align-middle text-outline hover:text-on-surface"
      >
        {expanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
      </button>
      {expanded ? (
        <div className="ml-3 border-l border-outline-variant/30 pl-2">
          {keys.map((k) => {
            const path = initialPath ? `${initialPath}.${k}` : k;
            return (
              <div key={k} className="leading-snug">
                <span
                  className="text-violet-700"
                  title={`Path: ${path}`}
                >
                  {k}
                </span>
                <span className="text-outline">: </span>
                <Tree value={obj[k]} initialPath={path} depth={depth + 1} />
              </div>
            );
          })}
        </div>
      ) : (
        <span className="text-outline">
          {" {"}
          {keys.length} key{keys.length === 1 ? "" : "s"}
          {"}"}
        </span>
      )}
    </span>
  );
};

const ArrayNode = ({
  arr,
  initialPath,
  depth,
}: {
  arr: unknown[];
  initialPath: string;
  depth: number;
}) => {
  const [expanded, setExpanded] = useState(depth < 1);
  if (arr.length === 0) return <span className="text-outline">[]</span>;
  return (
    <span>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center align-middle text-outline hover:text-on-surface"
      >
        {expanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
      </button>
      {expanded ? (
        <div className="ml-3 border-l border-outline-variant/30 pl-2">
          {arr.map((v, i) => {
            const path = `${initialPath}[${i}]`;
            return (
              <div key={i} className="leading-snug">
                <span className="text-outline">[{i}]</span>
                <span className="text-outline">: </span>
                <Tree value={v} initialPath={path} depth={depth + 1} />
              </div>
            );
          })}
        </div>
      ) : (
        <span className="text-outline">
          {" ["}
          {arr.length} item{arr.length === 1 ? "" : "s"}
          {"]"}
        </span>
      )}
    </span>
  );
};
