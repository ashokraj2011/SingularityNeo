/**
 * Single source of truth for interpreting a `FormSchema` value.
 *
 * `formSchema` is loosely typed (`Record<string, unknown> | null`)
 * because we accept multiple shapes:
 *
 *   1. STRUCTURED — { fields: [{ key, label, placeholder?, multiline?,
 *      defaultValue?, required? }] }. This is what the StudioInspector
 *      emits and what custom node types use. Best UX — every field
 *      becomes a labeled input.
 *
 *   2. KEY-LABEL MAP — { employeeName: "Employee", startDate: "Start
 *      date" }. A quick shorthand: keys become field keys, values are
 *      labels. We don't infer types; everything's a string input.
 *
 *   3. RAW — anything else, including null. The UI falls back to a
 *      JSON textarea so the operator can submit arbitrary structure
 *      and we don't block them.
 *
 * Used by:
 *   - InstanceLaunchDialog (start-of-instance launch form)
 *   - TaskCompletionDialog (per-task completion form)
 *
 * Keeping this in one module so a tweak to the parser ripples to both
 * surfaces without drift.
 */

import type { FormSchema } from "../contracts/businessWorkflow";

/**
 * Field type the renderer uses to pick the right input. The parser
 * keeps backward compat with the older `multiline` boolean by
 * coercing it into `type` at parse time.
 *
 * Values are always stored as strings on the wire (formData /
 * output) so edge-condition evaluation stays uniform — numeric ops
 * coerce, boolean comparisons match `"yes"` / `"no"` / `"true"` /
 * `"false"` literals, choice values are the literal value strings.
 */
export type FormFieldType =
  | "text"
  | "longtext"
  | "number"
  | "date"
  | "boolean"
  | "choice";

export interface StructuredFormField {
  key: string;
  label: string;
  /** "text" if absent (or "longtext" when legacy `multiline: true`). */
  type?: FormFieldType;
  placeholder?: string;
  /** Legacy flag — preserved on the wire for round-trip with older
   *  templates. New templates use `type: "longtext"` instead. */
  multiline?: boolean;
  defaultValue?: string;
  required?: boolean;
  /** For `type: "choice"` — list of selectable values. Each option's
   *  `value` is what gets stored; `label` is what the operator sees. */
  options?: { value: string; label: string }[];
  /** Free-form help text rendered below the input. */
  helpText?: string;
}

/** Resolve the actual rendered input type for a field, applying the
 *  legacy `multiline` fallback. */
export const resolveFieldType = (
  field: StructuredFormField,
): FormFieldType => {
  if (field.type) return field.type;
  if (field.multiline) return "longtext";
  return "text";
};

export type InterpretedFormSchema =
  | { kind: "structured"; fields: StructuredFormField[] }
  | { kind: "raw" };

export const interpretFormSchema = (
  schema: FormSchema | null | undefined,
): InterpretedFormSchema => {
  if (!schema || typeof schema !== "object") return { kind: "raw" };
  const obj = schema as Record<string, unknown>;

  // Shape 1: { fields: [...] }
  if (Array.isArray(obj.fields)) {
    const fields: StructuredFormField[] = [];
    for (const raw of obj.fields as unknown[]) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const key = typeof r.key === "string" ? r.key : "";
      if (!key) continue;
      // Validate the type is one we know how to render. Unknown
      // values fall back to text so the form still renders.
      const knownTypes: FormFieldType[] = [
        "text",
        "longtext",
        "number",
        "date",
        "boolean",
        "choice",
      ];
      const type =
        typeof r.type === "string" &&
        knownTypes.includes(r.type as FormFieldType)
          ? (r.type as FormFieldType)
          : undefined;
      // Parse choice options, ignoring malformed entries.
      let options: { value: string; label: string }[] | undefined;
      if (Array.isArray(r.options)) {
        options = (r.options as unknown[])
          .map((opt) => {
            if (!opt || typeof opt !== "object") return null;
            const o = opt as Record<string, unknown>;
            const value = typeof o.value === "string" ? o.value : null;
            if (value == null) return null;
            return {
              value,
              label: typeof o.label === "string" ? o.label : value,
            };
          })
          .filter(
            (x): x is { value: string; label: string } => x !== null,
          );
        if (options.length === 0) options = undefined;
      }
      fields.push({
        key,
        label: typeof r.label === "string" ? r.label : key,
        type,
        placeholder:
          typeof r.placeholder === "string" ? r.placeholder : undefined,
        multiline: r.multiline === true,
        defaultValue:
          typeof r.defaultValue === "string" ? r.defaultValue : undefined,
        required: r.required === true,
        options,
        helpText:
          typeof r.helpText === "string" ? r.helpText : undefined,
      });
    }
    if (fields.length > 0) return { kind: "structured", fields };
  }

  // Shape 2: plain { key: label } map. Detected when every value is
  // a primitive string/number/null.
  const keys = Object.keys(obj);
  if (
    keys.length > 0 &&
    keys.every(
      (k) =>
        typeof obj[k] === "string" ||
        typeof obj[k] === "number" ||
        obj[k] == null,
    )
  ) {
    const fields: StructuredFormField[] = keys.map((key) => ({
      key,
      label: typeof obj[key] === "string" ? (obj[key] as string) : key,
    }));
    return { kind: "structured", fields };
  }

  return { kind: "raw" };
};
