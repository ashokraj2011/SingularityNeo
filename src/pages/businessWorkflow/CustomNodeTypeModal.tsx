import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  deleteBusinessCustomNodeType,
  listBusinessCustomNodeTypes,
  upsertBusinessCustomNodeType,
} from "../../lib/api";
import type {
  BusinessCustomNodeType,
  BusinessNodeBaseType,
  CustomNodeTypeFieldDef,
} from "../../contracts/businessWorkflow";
import { useToast } from "../../context/ToastContext";
import { cn } from "../../lib/utils";
import {
  CUSTOM_NODE_COLOR_PRESETS,
  CUSTOM_NODE_ICON_OPTIONS,
  isHexColor,
  resolveCustomNodeIcon,
} from "./customNodeIcons";

/**
 * Base-type cards. Hint text mirrors how the workgraph-studio designer
 * communicates which built-in executor handles each type at runtime.
 * Order is roughly: human work first, then control flow, then async,
 * then integration — matching the palette so the chooser feels familiar.
 */
const BASE_TYPE_OPTIONS: {
  value: BusinessNodeBaseType;
  label: string;
  hint: string;
}[] = [
  {
    value: "HUMAN_TASK",
    label: "Human Task",
    hint: "Creates a task assigned to a person.",
  },
  {
    value: "FORM_FILL",
    label: "Form Fill",
    hint: "Captures structured input via a form schema.",
  },
  {
    value: "APPROVAL",
    label: "Approval",
    hint: "Requires an explicit approve / reject decision.",
  },
  {
    value: "DECISION_GATE",
    label: "Decision Gate",
    hint: "Routes by AND/OR edge conditions.",
  },
  {
    value: "PARALLEL_FORK",
    label: "Parallel Fork",
    hint: "Activates all outgoing branches.",
  },
  {
    value: "PARALLEL_JOIN",
    label: "Parallel Join",
    hint: "Waits for all incoming branches.",
  },
  {
    value: "TIMER",
    label: "Timer",
    hint: "Pauses for a duration.",
  },
  {
    value: "NOTIFICATION",
    label: "Notification",
    hint: "Sends email / webhook / in-app.",
  },
  {
    value: "AGENT_TASK",
    label: "Agent Task",
    hint: "Delegates to a capability agent.",
  },
  {
    value: "TOOL_REQUEST",
    label: "Tool Request",
    hint: "Calls a registered tool / API.",
  },
  {
    value: "CALL_WORKFLOW",
    label: "Call Workflow",
    hint: "Spawns a child business workflow.",
  },
];

/** Convert a free-text label to the canonical UPPER_SNAKE_CASE key. */
const slugify = (raw: string) =>
  raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const emptyField = (): CustomNodeTypeFieldDef => ({
  key: "",
  label: "",
  placeholder: "",
  multiline: false,
});

type Draft = {
  name: string;
  label: string;
  description: string;
  baseType: BusinessNodeBaseType;
  color: string;
  icon: string;
  fields: CustomNodeTypeFieldDef[];
  isActive: boolean;
};

const defaultDraft = (): Draft => ({
  name: "",
  label: "",
  description: "",
  baseType: "HUMAN_TASK",
  color: "#38bdf8",
  icon: "Box",
  fields: [],
  isActive: true,
});

type Props = {
  capabilityId: string;
  open: boolean;
  onClose: () => void;
  /**
   * Notifies the studio that custom node types changed so it can
   * refresh its palette / inspector.
   */
  onChanged?: () => void;
};

export const CustomNodeTypeModal = ({
  capabilityId,
  open,
  onClose,
  onChanged,
}: Props) => {
  const { error: toastError, success } = useToast();
  const [types, setTypes] = useState<BusinessCustomNodeType[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(defaultDraft());
  /** True once the user manually edits the name field — disables the
   *  auto-derive-from-label sync so we don't clobber their override. */
  const [keyDirty, setKeyDirty] = useState(false);
  const [expandedTypeId, setExpandedTypeId] = useState<string | null>(null);

  const isCreating = editingId === "new";

  const resetDraft = useCallback(() => {
    setEditingId(null);
    setDraft(defaultDraft());
    setKeyDirty(false);
  }, []);

  const startNew = () => {
    setEditingId("new");
    setDraft(defaultDraft());
    setKeyDirty(false);
  };

  const startEdit = (t: BusinessCustomNodeType) => {
    setEditingId(t.id);
    setDraft({
      name: t.name,
      label: t.label,
      description: t.description ?? "",
      baseType: t.baseType,
      // Preserve legacy Tailwind classes as-is; new entries are hex.
      color: t.color || "#38bdf8",
      icon: t.icon || "Box",
      fields: t.fields.map((f) => ({ ...f })),
      isActive: t.isActive,
    });
    setKeyDirty(true); // editing — never auto-rewrite the locked key
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listBusinessCustomNodeTypes(capabilityId, {
        includeInactive: showInactive,
      });
      setTypes(list);
    } catch (err) {
      toastError(
        "Could not load custom node types",
        err instanceof Error ? err.message : "",
      );
    } finally {
      setLoading(false);
    }
  }, [capabilityId, showInactive, toastError]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const handleSave = async () => {
    const label = draft.label.trim();
    if (!label) {
      toastError("Missing label", "Display name is required.");
      return;
    }
    const name = slugify(draft.name || label);
    if (!name) {
      toastError(
        "Invalid key",
        "Internal key must contain at least one letter or digit.",
      );
      return;
    }
    setSaving(true);
    try {
      await upsertBusinessCustomNodeType(capabilityId, {
        id: isCreating ? undefined : editingId || undefined,
        name,
        baseType: draft.baseType,
        label,
        description: draft.description.trim() || undefined,
        color: draft.color || undefined,
        icon: draft.icon || undefined,
        fields: draft.fields
          .map((f) => ({
            ...f,
            key: f.key.trim(),
            label: f.label.trim(),
            placeholder: f.placeholder?.trim() || undefined,
          }))
          .filter((f) => f.key && f.label),
        isActive: draft.isActive,
      });
      success("Saved", `${label} stored.`);
      resetDraft();
      await load();
      onChanged?.();
    } catch (err) {
      toastError("Save failed", err instanceof Error ? err.message : "");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (t: BusinessCustomNodeType) => {
    if (
      !confirm(
        `Delete "${t.label}"? Existing instances that already reference it ` +
          `will continue to work, but it will no longer be available in ` +
          `the palette.`,
      )
    ) {
      return;
    }
    try {
      await deleteBusinessCustomNodeType(capabilityId, t.id);
      success("Deleted", `${t.label} removed.`);
      if (editingId === t.id) resetDraft();
      await load();
      onChanged?.();
    } catch (err) {
      toastError("Delete failed", err instanceof Error ? err.message : "");
    }
  };

  const PreviewIcon = useMemo(
    () => resolveCustomNodeIcon(draft.icon),
    [draft.icon],
  );

  const baseHint = useMemo(
    () => BASE_TYPE_OPTIONS.find((b) => b.value === draft.baseType)?.hint,
    [draft.baseType],
  );

  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleLabelChange = (next: string) => {
    setDraft((prev) => ({
      ...prev,
      label: next,
      // Auto-sync the internal key only while creating AND only until
      // the user manually overrides it. Once they edit `name`, we stop
      // touching it (keyDirty=true).
      name: !isCreating || keyDirty ? prev.name : slugify(next),
    }));
  };

  const handleNameChange = (next: string) => {
    // Force the canonical shape on every keystroke so the user can't
    // save an invalid key (e.g. lowercase, spaces, dashes).
    const cleaned = next.toUpperCase().replace(/[^A-Z0-9_]/g, "");
    setKeyDirty(true);
    setDraft((prev) => ({ ...prev, name: cleaned }));
  };

  if (!open) return null;

  const colorIsHex = isHexColor(draft.color);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-[1] flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl">
        {/* Header with live preview chip */}
        <header className="flex items-center gap-3 border-b border-outline-variant/30 px-5 py-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border"
            style={{
              backgroundColor: colorIsHex ? `${draft.color}1A` : undefined,
              borderColor: colorIsHex ? `${draft.color}40` : undefined,
            }}
          >
            <PreviewIcon
              size={20}
              style={{ color: colorIsHex ? draft.color : undefined }}
              className={cn(
                !colorIsHex && draft.color && draft.color.startsWith("bg-")
                  ? "text-white"
                  : "text-secondary",
              )}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
              Capability customisation
            </p>
            <h2 className="truncate text-base font-semibold text-on-surface">
              {editingId
                ? draft.label || "Untitled"
                : "Custom node types"}
            </h2>
            {editingId && (
              <p className="text-[0.7rem] text-outline">
                {BASE_TYPE_OPTIONS.find((b) => b.value === draft.baseType)
                  ?.label || draft.baseType}
                {!draft.isActive && " · INACTIVE"}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-outline-variant/40 p-1.5 text-secondary hover:text-primary"
          >
            <X size={14} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left: list */}
          <div className="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto border-r border-outline-variant/30 p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-on-surface">Existing</p>
              <button
                type="button"
                onClick={startNew}
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-2 py-1 text-[0.65rem] font-semibold text-primary-foreground hover:opacity-90"
              >
                <Plus size={11} /> New
              </button>
            </div>
            <label className="mb-1 inline-flex items-center gap-1.5 text-[0.65rem] text-outline">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="h-3 w-3"
              />
              Show inactive
            </label>
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-secondary">
                <Loader2 size={12} className="animate-spin" /> Loading…
              </div>
            ) : types.length === 0 ? (
              <p className="text-xs text-outline">
                No custom node types yet. Create one to wrap a base type
                with capability-specific fields (e.g. "Marketing Review"
                wrapping HUMAN_TASK with a "campaign" field).
              </p>
            ) : (
              <ul className="space-y-1.5">
                {types.map((t) => {
                  const TypeIcon = resolveCustomNodeIcon(t.icon);
                  const isHex = isHexColor(t.color);
                  const expanded = expandedTypeId === t.id;
                  return (
                    <li
                      key={t.id}
                      className={cn(
                        "rounded-lg border bg-white",
                        editingId === t.id
                          ? "border-primary ring-2 ring-primary/20"
                          : "border-outline-variant/40",
                      )}
                    >
                      <div className="flex items-start gap-2 px-2 py-2">
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border"
                          style={{
                            backgroundColor: isHex
                              ? `${t.color}18`
                              : undefined,
                            borderColor: isHex ? `${t.color}30` : undefined,
                          }}
                        >
                          <TypeIcon
                            size={14}
                            style={{
                              color: isHex ? t.color : undefined,
                            }}
                            className={cn(
                              !isHex &&
                                t.color &&
                                String(t.color).startsWith("bg-")
                                ? "text-white"
                                : "text-secondary",
                            )}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => startEdit(t)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p
                            className={cn(
                              "truncate text-xs font-semibold",
                              t.isActive
                                ? "text-on-surface"
                                : "text-outline line-through",
                            )}
                          >
                            {t.label}
                          </p>
                          <p className="truncate text-[0.6rem] font-mono text-outline">
                            {t.name}
                          </p>
                          <p className="text-[0.6rem] text-outline">
                            {t.baseType} · {t.fields.length} field
                            {t.fields.length === 1 ? "" : "s"}
                          </p>
                        </button>
                        <div className="flex flex-col items-end gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedTypeId(expanded ? null : t.id)
                            }
                            title="Preview fields"
                            className="rounded p-0.5 text-outline hover:text-on-surface"
                          >
                            {expanded ? (
                              <ChevronDown size={12} />
                            ) : (
                              <ChevronRight size={12} />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(t)}
                            className="rounded p-0.5 text-rose-500 hover:bg-rose-50"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                      {expanded && (
                        <div className="border-t border-outline-variant/30 px-2 py-1.5">
                          {t.description && (
                            <p className="mb-1 text-[0.65rem] text-outline">
                              {t.description}
                            </p>
                          )}
                          {t.fields.length === 0 ? (
                            <p className="text-[0.6rem] italic text-outline">
                              No custom fields.
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {t.fields.map((f, i) => (
                                <span
                                  key={i}
                                  className="rounded px-1.5 py-0.5 font-mono text-[0.6rem]"
                                  style={{
                                    backgroundColor: isHex
                                      ? `${t.color}15`
                                      : "rgb(241 245 249)",
                                    color: isHex ? t.color : undefined,
                                  }}
                                >
                                  {f.key}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Right: editor */}
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
            {editingId === null ? (
              <div className="rounded-xl border-2 border-dashed border-outline-variant/40 bg-surface-container p-8 text-center">
                <p className="mb-1 text-sm font-semibold text-on-surface">
                  Pick a type to edit, or create a new one.
                </p>
                <p className="text-xs text-outline">
                  Custom node types appear in the palette alongside
                  built-in types and route to the chosen base executor at
                  runtime.
                </p>
              </div>
            ) : (
              <>
                {/* Identity */}
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs">
                    <span className="mb-1 block text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
                      Display name
                    </span>
                    <input
                      type="text"
                      value={draft.label}
                      onChange={(e) => handleLabelChange(e.target.value)}
                      placeholder="e.g. Legal Review"
                      className="w-full rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 text-xs"
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="mb-1 block text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
                      Internal key (UPPER_SNAKE_CASE)
                    </span>
                    <input
                      type="text"
                      value={draft.name}
                      onChange={(e) => handleNameChange(e.target.value)}
                      placeholder="LEGAL_REVIEW"
                      readOnly={!isCreating}
                      className={cn(
                        "w-full rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 font-mono text-[0.7rem]",
                        !isCreating && "cursor-not-allowed bg-surface-container",
                      )}
                    />
                    {isCreating ? (
                      <p className="mt-0.5 text-[0.6rem] text-outline">
                        Auto-derived from name. Edit to override.
                      </p>
                    ) : (
                      <p className="mt-0.5 text-[0.6rem] text-outline">
                        Locked after creation — instances reference this key.
                      </p>
                    )}
                  </label>
                </div>

                <label className="block text-xs">
                  <span className="mb-1 block text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
                    Description (optional)
                  </span>
                  <textarea
                    value={draft.description}
                    onChange={(e) => setField("description", e.target.value)}
                    placeholder="What this node type does in a workflow…"
                    rows={2}
                    className="w-full resize-y rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 text-xs"
                  />
                </label>

                {/* Base type cards */}
                <div>
                  <p className="mb-1 text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
                    Base executor
                  </p>
                  <p className="mb-2 text-[0.65rem] text-outline">
                    Determines the runtime behaviour. Custom fields will
                    appear in the inspector when this node type is
                    selected.
                  </p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {BASE_TYPE_OPTIONS.map((b) => {
                      const selected = draft.baseType === b.value;
                      return (
                        <button
                          key={b.value}
                          type="button"
                          onClick={() => setField("baseType", b.value)}
                          className={cn(
                            "rounded-lg border p-2 text-left transition-colors",
                            selected
                              ? "border-primary bg-primary/5 text-primary"
                              : "border-outline-variant/40 bg-white text-on-surface hover:bg-surface-container",
                          )}
                        >
                          <p className="text-[0.7rem] font-semibold">
                            {b.label}
                          </p>
                          <p className="mt-0.5 text-[0.6rem] leading-snug text-outline">
                            {b.hint}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                  {baseHint && (
                    <p className="mt-1 text-[0.6rem] italic text-outline">
                      Selected: {baseHint}
                    </p>
                  )}
                </div>

                {/* Color + icon */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="mb-1 text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
                      Color
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {CUSTOM_NODE_COLOR_PRESETS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setField("color", c)}
                          title={c}
                          className={cn(
                            "h-6 w-6 rounded-md border-2 transition-transform",
                            draft.color === c
                              ? "border-on-surface scale-110"
                              : "border-transparent",
                          )}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                      <input
                        type="color"
                        value={colorIsHex ? draft.color : "#38bdf8"}
                        onChange={(e) => setField("color", e.target.value)}
                        title="Custom color"
                        className="h-6 w-6 cursor-pointer rounded-md border border-outline-variant/40 p-0"
                      />
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
                      Icon
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {CUSTOM_NODE_ICON_OPTIONS.map(({ name, Icon }) => {
                        const selected = draft.icon === name;
                        return (
                          <button
                            key={name}
                            type="button"
                            onClick={() => setField("icon", name)}
                            title={name}
                            className={cn(
                              "flex h-7 w-7 items-center justify-center rounded-md border transition-colors",
                              selected
                                ? "border-2"
                                : "border-outline-variant/40 bg-white hover:bg-surface-container",
                            )}
                            style={
                              selected && colorIsHex
                                ? {
                                    borderColor: draft.color,
                                    backgroundColor: `${draft.color}15`,
                                  }
                                : undefined
                            }
                          >
                            <Icon
                              size={13}
                              style={{
                                color:
                                  selected && colorIsHex
                                    ? draft.color
                                    : undefined,
                              }}
                              className={cn(
                                !(selected && colorIsHex) && "text-secondary",
                              )}
                            />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Custom fields */}
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <div>
                      <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
                        Custom fields
                      </p>
                      <p className="text-[0.6rem] text-outline">
                        Render in the inspector when this node type is
                        selected. Empty rows are dropped on save.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          fields: [...prev.fields, emptyField()],
                        }))
                      }
                      className="inline-flex items-center gap-1 rounded border border-outline-variant/40 bg-white px-2 py-1 text-[0.65rem] hover:bg-surface-container"
                    >
                      <Plus size={10} /> Add field
                    </button>
                  </div>
                  {draft.fields.length === 0 ? (
                    <div className="rounded-lg border-2 border-dashed border-outline-variant/40 bg-surface-container p-4 text-center text-[0.7rem] text-outline">
                      No custom fields yet — base executor's defaults will be
                      used.
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {draft.fields.map((f, i) => (
                        <div
                          key={i}
                          className="grid grid-cols-[8rem_1fr_1fr_auto_auto] items-end gap-1.5 rounded-lg border border-outline-variant/30 bg-white p-1.5"
                        >
                          <label className="block">
                            <span className="mb-0.5 block text-[0.55rem] font-semibold uppercase text-outline">
                              Key
                            </span>
                            <input
                              type="text"
                              value={f.key}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  fields: prev.fields.map((x, j) =>
                                    j === i
                                      ? { ...x, key: e.target.value }
                                      : x,
                                  ),
                                }))
                              }
                              placeholder={`field_${i + 1}`}
                              className="w-full rounded border border-outline-variant/40 bg-white px-1.5 py-1 font-mono text-[0.65rem]"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-0.5 block text-[0.55rem] font-semibold uppercase text-outline">
                              Label
                            </span>
                            <input
                              type="text"
                              value={f.label}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  fields: prev.fields.map((x, j) =>
                                    j === i
                                      ? { ...x, label: e.target.value }
                                      : x,
                                  ),
                                }))
                              }
                              placeholder="Field label"
                              className="w-full rounded border border-outline-variant/40 bg-white px-1.5 py-1 text-[0.65rem]"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-0.5 block text-[0.55rem] font-semibold uppercase text-outline">
                              Placeholder
                            </span>
                            <input
                              type="text"
                              value={f.placeholder ?? ""}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  fields: prev.fields.map((x, j) =>
                                    j === i
                                      ? { ...x, placeholder: e.target.value }
                                      : x,
                                  ),
                                }))
                              }
                              placeholder="Hint text…"
                              className="w-full rounded border border-outline-variant/40 bg-white px-1.5 py-1 text-[0.65rem]"
                            />
                          </label>
                          <label className="flex flex-col items-center gap-0.5 text-[0.55rem] text-outline">
                            <span className="font-semibold uppercase">
                              Multi
                            </span>
                            <input
                              type="checkbox"
                              checked={Boolean(f.multiline)}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  fields: prev.fields.map((x, j) =>
                                    j === i
                                      ? {
                                          ...x,
                                          multiline: e.target.checked,
                                        }
                                      : x,
                                  ),
                                }))
                              }
                              className="h-3.5 w-3.5"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              setDraft((prev) => ({
                                ...prev,
                                fields: prev.fields.filter((_, j) => j !== i),
                              }))
                            }
                            title="Remove field"
                            className="rounded p-1 text-rose-500 hover:bg-rose-50"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-outline-variant/30 pt-3">
                  <button
                    type="button"
                    onClick={() => setField("isActive", !draft.isActive)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[0.7rem] font-semibold",
                      draft.isActive
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-outline-variant/40 bg-surface-container text-outline",
                    )}
                    title={
                      draft.isActive
                        ? "Active — appears in the palette"
                        : "Inactive — hidden from the palette but still resolvable for existing instances"
                    }
                  >
                    {draft.isActive ? <Eye size={12} /> : <EyeOff size={12} />}
                    {draft.isActive ? "Active" : "Inactive"}
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={resetDraft}
                      className="rounded-lg border border-outline-variant/40 px-3 py-1.5 text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={saving || !draft.label.trim()}
                      className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                    >
                      {saving && (
                        <Loader2 size={12} className="animate-spin" />
                      )}
                      {isCreating ? "Create node type" : "Save changes"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
