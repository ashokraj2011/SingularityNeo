import { useMemo, useState } from "react";
import {
  AlignLeft,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Code,
  Eye,
  Hash,
  List,
  Plus,
  Sparkles,
  Trash2,
  Type,
} from "lucide-react";
import { cn } from "../../lib/utils";
import {
  interpretFormSchema,
  resolveFieldType,
  type FormFieldType,
  type StructuredFormField,
} from "../../lib/businessFormSchema";
import type { FormSchema } from "../../contracts/businessWorkflow";
import { StructuredFormFieldInput } from "./runtime/components/StructuredFormFieldInput";

/**
 * Visual builder for a node's `formSchema`.
 *
 * Replaces the raw JSON textarea in NodeInspector with a card-based
 * editor business operators can drive without knowing JSON. Round-
 * trips through the same `interpretFormSchema` parser the launch +
 * task-completion dialogs use, so what you build is exactly what
 * the assignee sees.
 *
 * Three modes via tabs:
 *
 *   Build    field cards: type pill, label, key (auto-derived from
 *            label, overridable), placeholder, default, required,
 *            help text. Up/down to reorder, trash to remove.
 *
 *   Preview  renders the form exactly as the launch dialog or the
 *            task-completion dialog will render it. Live state:
 *            type → see the placeholder shift, toggle multiline →
 *            preview updates.
 *
 *   JSON     escape hatch for power users / pasting in legacy
 *            schemas. Round-trips back through the parser, so a
 *            valid edit there shows up in Build the next time you
 *            switch tabs.
 *
 * The schema is stored on the wire as `{ fields: StructuredFormField[] }`
 * — same shape every other surface of the runtime already accepts.
 */

const FIELD_TYPES: {
  value: FormFieldType;
  label: string;
  Icon: typeof Type;
  helpText: string;
}[] = [
  { value: "text", label: "Short text", Icon: Type, helpText: "Single-line input." },
  {
    value: "longtext",
    label: "Long text",
    Icon: AlignLeft,
    helpText: "Multi-line textarea — for descriptions, decision notes.",
  },
  { value: "number", label: "Number", Icon: Hash, helpText: "Numeric input. Stored as a string but the input enforces digits." },
  { value: "date", label: "Date", Icon: Calendar, helpText: "ISO date (YYYY-MM-DD)." },
  {
    value: "boolean",
    label: "Yes / No",
    Icon: Check,
    helpText: 'Checkbox. Stored as "yes" / "no" so edge conditions read naturally.',
  },
  {
    value: "choice",
    label: "Choice",
    Icon: List,
    helpText: "Dropdown of operator-defined options.",
  },
];

const slugifyKey = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const newField = (existing: StructuredFormField[]): StructuredFormField => {
  // Generate a unique key like field_1 / field_2 if no label is set
  // yet. Operators usually retype the label first, which auto-bumps
  // the key.
  const usedKeys = new Set(existing.map((f) => f.key));
  let n = existing.length + 1;
  let candidate = `field_${n}`;
  while (usedKeys.has(candidate)) {
    n += 1;
    candidate = `field_${n}`;
  }
  return {
    key: candidate,
    label: "",
    type: "text",
  };
};

type Tab = "build" | "preview" | "json";

type Props = {
  value: FormSchema | null | undefined;
  onChange: (next: FormSchema | null) => void;
  /** When true the builder displays a more compact "design-time"
   *  preview hint at the top. */
  surface?: "task" | "launch";
};

export const FormSchemaBuilder = ({ value, onChange, surface = "task" }: Props) => {
  const interpreted = useMemo(() => interpretFormSchema(value ?? null), [value]);
  const fields: StructuredFormField[] =
    interpreted.kind === "structured" ? interpreted.fields : [];

  const [tab, setTab] = useState<Tab>("build");
  // Preview-state lives in this component so changes feel live.
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});

  const updateFields = (next: StructuredFormField[]) => {
    if (next.length === 0) {
      onChange(null);
      return;
    }
    onChange({ fields: next as unknown as Record<string, unknown>[] } as FormSchema);
  };

  const updateField = (
    index: number,
    patch: Partial<StructuredFormField>,
  ) => {
    const next = [...fields];
    next[index] = { ...next[index], ...patch };
    updateFields(next);
  };

  const addField = () => updateFields([...fields, newField(fields)]);
  const removeField = (index: number) =>
    updateFields(fields.filter((_, i) => i !== index));
  const moveField = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    updateFields(next);
  };

  return (
    <div className="rounded-xl border border-outline-variant/40 bg-white">
      {/* Header + tabs */}
      <div className="flex items-center justify-between border-b border-outline-variant/30 px-2.5 py-2">
        <div>
          <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
            Form schema
          </p>
          <p className="text-[0.6rem] text-outline">
            {surface === "launch"
              ? "These fields appear in the launch dialog when an operator starts an instance."
              : "These fields appear when the assignee opens this task to complete it."}
          </p>
        </div>
        <button
          type="button"
          onClick={addField}
          className="inline-flex items-center gap-1 rounded-lg bg-primary px-2 py-1 text-[0.65rem] font-semibold text-primary-foreground hover:opacity-90"
        >
          <Plus size={11} /> Add field
        </button>
      </div>

      <div className="flex gap-1 border-b border-outline-variant/30 px-2 pt-1.5">
        {(
          [
            { id: "build", label: "Build", Icon: Sparkles },
            { id: "preview", label: "Preview", Icon: Eye },
            { id: "json", label: "JSON", Icon: Code },
          ] as { id: Tab; label: string; Icon: typeof Sparkles }[]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "inline-flex items-center gap-1 border-b-2 px-2 py-1 text-[0.65rem] font-semibold",
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-secondary hover:text-on-surface",
            )}
          >
            <t.Icon size={10} /> {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="p-2.5">
        {tab === "build" && (
          <BuildView
            fields={fields}
            onUpdate={updateField}
            onRemove={removeField}
            onMove={moveField}
            onAdd={addField}
          />
        )}
        {tab === "preview" && (
          <PreviewView
            fields={fields}
            values={previewValues}
            onChange={setPreviewValues}
          />
        )}
        {tab === "json" && (
          <JsonView value={value ?? null} onChange={onChange} />
        )}
      </div>
    </div>
  );
};

// ── Build tab ────────────────────────────────────────────────────────────────

const BuildView = ({
  fields,
  onUpdate,
  onRemove,
  onMove,
  onAdd,
}: {
  fields: StructuredFormField[];
  onUpdate: (i: number, patch: Partial<StructuredFormField>) => void;
  onRemove: (i: number) => void;
  onMove: (i: number, dir: -1 | 1) => void;
  onAdd: () => void;
}) => {
  if (fields.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-lg border-2 border-dashed border-outline-variant/40 bg-surface-container p-4 text-center">
        <Sparkles size={14} className="text-outline" />
        <p className="text-[0.7rem] font-semibold text-on-surface">
          No fields yet
        </p>
        <p className="text-[0.6rem] text-outline">
          Add a field to start. Each field becomes one input the
          operator fills.
        </p>
        <button
          type="button"
          onClick={onAdd}
          className="mt-1 inline-flex items-center gap-1 rounded-lg bg-primary px-2 py-1 text-[0.65rem] font-semibold text-primary-foreground hover:opacity-90"
        >
          <Plus size={10} /> Add the first field
        </button>
      </div>
    );
  }
  return (
    <ul className="space-y-1.5">
      {fields.map((f, i) => (
        <FieldCard
          key={`${f.key}-${i}`}
          index={i}
          total={fields.length}
          field={f}
          onUpdate={(patch) => onUpdate(i, patch)}
          onRemove={() => onRemove(i)}
          onMove={(dir) => onMove(i, dir)}
        />
      ))}
    </ul>
  );
};

const FieldCard = ({
  index,
  total,
  field,
  onUpdate,
  onRemove,
  onMove,
}: {
  index: number;
  total: number;
  field: StructuredFormField;
  onUpdate: (patch: Partial<StructuredFormField>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) => {
  const [open, setOpen] = useState(true);
  const type = resolveFieldType(field);
  const meta = FIELD_TYPES.find((t) => t.value === type) || FIELD_TYPES[0];
  // When the operator types a label and HASN'T overridden the key,
  // auto-derive the key. We detect "hasn't overridden" by matching
  // the auto-derived form for the previous label — sloppy but
  // good-enough heuristic.
  const handleLabelChange = (nextLabel: string) => {
    const auto = slugifyKey(field.label || "");
    const keyLooksAuto = !field.key || field.key === auto;
    onUpdate({
      label: nextLabel,
      key: keyLooksAuto && nextLabel ? slugifyKey(nextLabel) : field.key,
    });
  };

  return (
    <li className="rounded-lg border border-outline-variant/40 bg-white">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-outline hover:text-on-surface"
          title={open ? "Collapse" : "Expand"}
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        <span
          className="inline-flex items-center gap-0.5 rounded bg-surface-container px-1 py-0.5 text-[0.55rem] font-bold uppercase text-secondary"
          title={meta.helpText}
        >
          <meta.Icon size={9} /> {meta.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.7rem] font-semibold text-on-surface">
          {field.label || (
            <span className="italic text-outline">(no label yet)</span>
          )}
        </span>
        {field.required && (
          <span
            className="rounded-full bg-rose-100 px-1 py-0.5 text-[0.5rem] font-bold uppercase text-rose-700"
            title="Required"
          >
            req
          </span>
        )}
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          className="rounded p-0.5 text-outline hover:text-on-surface disabled:opacity-30"
          title="Move up"
        >
          <ChevronsUp size={10} />
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={index === total - 1}
          className="rounded p-0.5 text-outline hover:text-on-surface disabled:opacity-30"
          title="Move down"
        >
          <ChevronsDown size={10} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-0.5 text-rose-500 hover:bg-rose-50"
          title="Remove field"
        >
          <Trash2 size={10} />
        </button>
      </div>
      {open && (
        <div className="space-y-2 border-t border-outline-variant/30 px-2.5 py-2">
          {/* Label + key row */}
          <div className="grid grid-cols-2 gap-1.5">
            <label className="block text-[0.65rem]">
              <span className="mb-0.5 block font-semibold uppercase text-outline">
                Label
              </span>
              <input
                type="text"
                value={field.label}
                onChange={(e) => handleLabelChange(e.target.value)}
                placeholder="Decision summary"
                className="w-full rounded border border-outline-variant/40 bg-white px-1.5 py-1 text-[0.7rem]"
              />
            </label>
            <label className="block text-[0.65rem]">
              <span className="mb-0.5 block font-semibold uppercase text-outline">
                Key (auto)
              </span>
              <input
                type="text"
                value={field.key}
                onChange={(e) =>
                  onUpdate({
                    key: e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9_]/g, "_"),
                  })
                }
                placeholder="decision_summary"
                className="w-full rounded border border-outline-variant/40 bg-white px-1.5 py-1 font-mono text-[0.65rem]"
              />
            </label>
          </div>

          {/* Type picker */}
          <div>
            <p className="mb-0.5 text-[0.55rem] font-semibold uppercase text-outline">
              Field type
            </p>
            <div className="grid grid-cols-3 gap-1">
              {FIELD_TYPES.map((t) => {
                const selected = type === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => onUpdate({ type: t.value })}
                    className={cn(
                      "inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[0.6rem] font-semibold",
                      selected
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-outline-variant/40 bg-white text-on-surface hover:bg-surface-container",
                    )}
                    title={t.helpText}
                  >
                    <t.Icon size={9} />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Type-specific extras */}
          {type === "choice" && (
            <ChoiceOptionsEditor
              options={field.options || []}
              onChange={(opts) =>
                onUpdate({ options: opts.length > 0 ? opts : undefined })
              }
            />
          )}

          {/* Common fields */}
          <div className="grid grid-cols-2 gap-1.5">
            {type !== "boolean" && type !== "choice" && (
              <label className="block text-[0.65rem]">
                <span className="mb-0.5 block font-semibold uppercase text-outline">
                  Placeholder
                </span>
                <input
                  type="text"
                  value={field.placeholder || ""}
                  onChange={(e) =>
                    onUpdate({
                      placeholder: e.target.value || undefined,
                    })
                  }
                  placeholder="Hint shown inside the empty input"
                  className="w-full rounded border border-outline-variant/40 bg-white px-1.5 py-1 text-[0.65rem]"
                />
              </label>
            )}
            <label className="block text-[0.65rem]">
              <span className="mb-0.5 block font-semibold uppercase text-outline">
                Default value
              </span>
              <input
                type="text"
                value={field.defaultValue || ""}
                onChange={(e) =>
                  onUpdate({
                    defaultValue: e.target.value || undefined,
                  })
                }
                placeholder="(empty)"
                className="w-full rounded border border-outline-variant/40 bg-white px-1.5 py-1 text-[0.65rem]"
              />
            </label>
          </div>

          <label className="block text-[0.65rem]">
            <span className="mb-0.5 block font-semibold uppercase text-outline">
              Help text
            </span>
            <input
              type="text"
              value={field.helpText || ""}
              onChange={(e) =>
                onUpdate({ helpText: e.target.value || undefined })
              }
              placeholder='e.g. "What did you find? Be specific."'
              className="w-full rounded border border-outline-variant/40 bg-white px-1.5 py-1 text-[0.65rem]"
            />
          </label>

          {/* Required toggle */}
          <label className="inline-flex items-center gap-1.5 text-[0.65rem]">
            <input
              type="checkbox"
              checked={field.required === true}
              onChange={(e) =>
                onUpdate({ required: e.target.checked || undefined })
              }
              className="h-3 w-3"
            />
            <span className="font-semibold uppercase text-outline">
              Required
            </span>
            <span className="text-outline">
              — operator must fill this before submitting.
            </span>
          </label>
        </div>
      )}
    </li>
  );
};

const ChoiceOptionsEditor = ({
  options,
  onChange,
}: {
  options: { value: string; label: string }[];
  onChange: (next: { value: string; label: string }[]) => void;
}) => {
  const update = (
    i: number,
    patch: Partial<{ value: string; label: string }>,
  ) => onChange(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const remove = (i: number) => onChange(options.filter((_, j) => j !== i));
  const add = () =>
    onChange([
      ...options,
      { value: `option_${options.length + 1}`, label: `Option ${options.length + 1}` },
    ]);
  return (
    <div className="rounded-lg border border-outline-variant/30 bg-surface-container-low p-2">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[0.6rem] font-semibold uppercase tracking-wider text-secondary">
          Choices
        </p>
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-0.5 rounded border border-outline-variant/40 bg-white px-1.5 py-0.5 text-[0.6rem] font-semibold hover:bg-surface-container"
        >
          <Plus size={9} /> Add
        </button>
      </div>
      {options.length === 0 ? (
        <p className="text-[0.6rem] italic text-outline">
          Add at least one option for the dropdown to render.
        </p>
      ) : (
        <ul className="space-y-1">
          {options.map((opt, i) => (
            <li
              key={i}
              className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5"
            >
              <input
                type="text"
                value={opt.label}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder="Visible label"
                className="rounded border border-outline-variant/40 bg-white px-1.5 py-1 text-[0.65rem]"
              />
              <input
                type="text"
                value={opt.value}
                onChange={(e) => update(i, { value: e.target.value })}
                placeholder="value (stored)"
                className="rounded border border-outline-variant/40 bg-white px-1.5 py-1 font-mono text-[0.6rem]"
              />
              <button
                type="button"
                onClick={() => remove(i)}
                className="rounded p-1 text-rose-500 hover:bg-rose-50"
              >
                <Trash2 size={10} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ── Preview tab ──────────────────────────────────────────────────────────────

const PreviewView = ({
  fields,
  values,
  onChange,
}: {
  fields: StructuredFormField[];
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) => {
  if (fields.length === 0) {
    return (
      <p className="rounded-lg border-2 border-dashed border-outline-variant/40 bg-surface-container p-3 text-center text-[0.7rem] text-outline">
        Nothing to preview yet — add a field on the Build tab.
      </p>
    );
  }
  return (
    <div className="rounded-lg border border-outline-variant/30 bg-surface-container-low p-3">
      <p className="mb-2 text-[0.6rem] text-outline">
        Live preview — same renderer the launch and task-completion
        dialogs use.
      </p>
      <div className="flex flex-col gap-2">
        {fields.map((f) => (
          <label key={f.key} className="block text-xs">
            <span className="mb-1 flex items-center gap-1 text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
              {f.label || (
                <span className="italic text-outline">(no label)</span>
              )}
              {f.required && (
                <span className="text-rose-600" title="Required">
                  *
                </span>
              )}
            </span>
            <StructuredFormFieldInput
              field={f}
              value={values[f.key] ?? f.defaultValue ?? ""}
              onChange={(next) =>
                onChange({ ...values, [f.key]: next })
              }
            />
            {f.helpText && (
              <p className="mt-0.5 text-[0.6rem] text-outline">
                {f.helpText}
              </p>
            )}
          </label>
        ))}
      </div>
    </div>
  );
};

// ── JSON tab ─────────────────────────────────────────────────────────────────

const JsonView = ({
  value,
  onChange,
}: {
  value: FormSchema | null | undefined;
  onChange: (next: FormSchema | null) => void;
}) => {
  const [text, setText] = useState(() => {
    if (!value) return "";
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "";
    }
  });
  const [parseError, setParseError] = useState<string | null>(null);
  return (
    <div>
      <p className="mb-1 text-[0.6rem] text-outline">
        Power-user escape hatch. Editing here round-trips through the
        Build tab next time you switch back. Safe for pasting in
        legacy schemas.
      </p>
      <textarea
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          if (!next.trim()) {
            onChange(null);
            setParseError(null);
            return;
          }
          try {
            const parsed = JSON.parse(next);
            if (typeof parsed !== "object" || Array.isArray(parsed)) {
              throw new Error("must be an object");
            }
            onChange(parsed as FormSchema);
            setParseError(null);
          } catch (err) {
            setParseError(err instanceof Error ? err.message : "invalid JSON");
          }
        }}
        rows={10}
        spellCheck={false}
        className="w-full resize-y rounded border border-outline-variant/40 bg-white px-2 py-1.5 font-mono text-[0.65rem]"
        placeholder='{"fields":[{"key":"...","label":"..."}]}'
      />
      {parseError && (
        <p className="mt-1 text-[0.6rem] text-rose-600">⚠ {parseError}</p>
      )}
    </div>
  );
};
