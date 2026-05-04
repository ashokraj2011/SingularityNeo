import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";
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

const BASE_TYPES: BusinessNodeBaseType[] = [
  "HUMAN_TASK",
  "FORM_FILL",
  "APPROVAL",
  "DECISION_GATE",
  "PARALLEL_FORK",
  "PARALLEL_JOIN",
  "TIMER",
  "NOTIFICATION",
  "AGENT_TASK",
  "TOOL_REQUEST",
  "CALL_WORKFLOW",
];

const slugify = (raw: string) =>
  raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

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

  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftBaseType, setDraftBaseType] =
    useState<BusinessNodeBaseType>("HUMAN_TASK");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftColor, setDraftColor] = useState("");
  const [draftIcon, setDraftIcon] = useState("");
  const [draftFields, setDraftFields] = useState<CustomNodeTypeFieldDef[]>([]);

  const resetDraft = useCallback(() => {
    setEditingId(null);
    setDraftName("");
    setDraftBaseType("HUMAN_TASK");
    setDraftLabel("");
    setDraftColor("");
    setDraftIcon("");
    setDraftFields([]);
  }, []);

  const startNew = () => {
    resetDraft();
    setEditingId("new");
  };

  const startEdit = (t: BusinessCustomNodeType) => {
    setEditingId(t.id);
    setDraftName(t.name);
    setDraftBaseType(t.baseType);
    setDraftLabel(t.label);
    setDraftColor(t.color || "");
    setDraftIcon(t.icon || "");
    setDraftFields(t.fields);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listBusinessCustomNodeTypes(capabilityId);
      setTypes(list);
    } catch (err) {
      toastError(
        "Could not load custom node types",
        err instanceof Error ? err.message : "",
      );
    } finally {
      setLoading(false);
    }
  }, [capabilityId, toastError]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const handleSave = async () => {
    if (!draftLabel.trim() || !draftBaseType) {
      toastError("Missing fields", "Label and base type are required.");
      return;
    }
    const name = slugify(draftName.trim() || draftLabel);
    if (!name) {
      toastError("Invalid name", "Could not derive a valid name.");
      return;
    }
    setSaving(true);
    try {
      await upsertBusinessCustomNodeType(capabilityId, {
        id: editingId === "new" ? undefined : editingId || undefined,
        name,
        baseType: draftBaseType,
        label: draftLabel.trim(),
        color: draftColor.trim() || undefined,
        icon: draftIcon.trim() || undefined,
        fields: draftFields,
      });
      success("Saved", `${draftLabel} stored.`);
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
    if (!confirm(`Delete custom node type "${t.label}"?`)) return;
    try {
      await deleteBusinessCustomNodeType(capabilityId, t.id);
      success("Deleted", `${t.label} removed.`);
      await load();
      onChanged?.();
    } catch (err) {
      toastError("Delete failed", err instanceof Error ? err.message : "");
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-[1] flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl">
        <header className="flex items-center justify-between border-b border-outline-variant/30 px-5 py-3">
          <div>
            <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
              Capability customisation
            </p>
            <h2 className="text-base font-semibold text-on-surface">
              Custom node types
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

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left: list */}
          <div className="flex w-1/2 flex-col gap-2 overflow-y-auto border-r border-outline-variant/30 p-4">
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
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-secondary">
                <Loader2 size={12} className="animate-spin" /> Loading...
              </div>
            ) : types.length === 0 ? (
              <p className="text-xs text-outline">
                No custom node types yet. Create one to wrap a base type
                with capability-specific fields (e.g. "Marketing Review"
                wrapping HUMAN_TASK with a "campaign" field).
              </p>
            ) : (
              <ul className="space-y-1">
                {types.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-start justify-between gap-2 rounded-lg border border-outline-variant/40 bg-white px-3 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => startEdit(t)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-xs font-semibold text-on-surface">
                        {t.label}
                      </p>
                      <p className="text-[0.62rem] text-outline">
                        {t.name} · base: {t.baseType} · {t.fields.length} field
                        {t.fields.length === 1 ? "" : "s"}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(t)}
                      className="rounded p-1 text-rose-500 hover:bg-rose-50"
                    >
                      <Trash2 size={11} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Right: editor */}
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
            {editingId === null ? (
              <p className="text-xs text-outline">
                Select a type on the left to edit, or click "New".
              </p>
            ) : (
              <>
                <div>
                  <label className="block text-xs">
                    <span className="mb-1 block text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
                      Label
                    </span>
                    <input
                      type="text"
                      value={draftLabel}
                      onChange={(e) => setDraftLabel(e.target.value)}
                      placeholder='e.g. "Marketing Review"'
                      className="w-full rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 text-xs"
                    />
                  </label>
                </div>
                <div>
                  <label className="block text-xs">
                    <span className="mb-1 block text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
                      Name (slug)
                    </span>
                    <input
                      type="text"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      placeholder="auto-derived from label if empty"
                      className="w-full rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 font-mono text-[0.7rem]"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs">
                    <span className="mb-1 block text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
                      Base type
                    </span>
                    <select
                      value={draftBaseType}
                      onChange={(e) =>
                        setDraftBaseType(e.target.value as BusinessNodeBaseType)
                      }
                      className="w-full rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 text-xs"
                    >
                      {BASE_TYPES.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs">
                    <span className="mb-1 block text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
                      Color (Tailwind class, optional)
                    </span>
                    <input
                      type="text"
                      value={draftColor}
                      onChange={(e) => setDraftColor(e.target.value)}
                      placeholder="bg-emerald-500"
                      className="w-full rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 text-xs"
                    />
                  </label>
                </div>
                <label className="block text-xs">
                  <span className="mb-1 block text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
                    Lucide icon name (optional)
                  </span>
                  <input
                    type="text"
                    value={draftIcon}
                    onChange={(e) => setDraftIcon(e.target.value)}
                    placeholder="Megaphone, Briefcase, ShieldCheck, ..."
                    className="w-full rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 text-xs"
                  />
                </label>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
                      Custom fields
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setDraftFields((prev) => [
                          ...prev,
                          { key: "", label: "" },
                        ])
                      }
                      className="inline-flex items-center gap-1 rounded border border-outline-variant/40 bg-white px-2 py-0.5 text-[0.62rem]"
                    >
                      <Plus size={9} /> Add field
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {draftFields.map((f, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-1 rounded-lg border border-outline-variant/30 bg-white p-1.5"
                      >
                        <input
                          type="text"
                          value={f.key}
                          onChange={(e) =>
                            setDraftFields((prev) =>
                              prev.map((x, j) =>
                                j === i ? { ...x, key: e.target.value } : x,
                              ),
                            )
                          }
                          placeholder="key"
                          className="w-24 rounded border border-outline-variant/40 px-1.5 py-1 text-[0.65rem] font-mono"
                        />
                        <input
                          type="text"
                          value={f.label}
                          onChange={(e) =>
                            setDraftFields((prev) =>
                              prev.map((x, j) =>
                                j === i ? { ...x, label: e.target.value } : x,
                              ),
                            )
                          }
                          placeholder="Label"
                          className="min-w-0 flex-1 rounded border border-outline-variant/40 px-1.5 py-1 text-[0.65rem]"
                        />
                        <label className="flex items-center gap-1 text-[0.6rem]">
                          <input
                            type="checkbox"
                            checked={Boolean(f.multiline)}
                            onChange={(e) =>
                              setDraftFields((prev) =>
                                prev.map((x, j) =>
                                  j === i
                                    ? { ...x, multiline: e.target.checked }
                                    : x,
                                ),
                              )
                            }
                          />
                          multi
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            setDraftFields((prev) =>
                              prev.filter((_, j) => j !== i),
                            )
                          }
                          className="rounded p-0.5 text-rose-500 hover:bg-rose-50"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-2 flex justify-end gap-2 border-t border-outline-variant/30 pt-3">
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
                    disabled={saving || !draftLabel.trim()}
                    className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                  >
                    {saving && <Loader2 size={12} className="animate-spin" />}
                    Save
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
