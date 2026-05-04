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

export interface StructuredFormField {
  key: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  defaultValue?: string;
  required?: boolean;
}

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
      fields.push({
        key,
        label: typeof r.label === "string" ? r.label : key,
        placeholder:
          typeof r.placeholder === "string" ? r.placeholder : undefined,
        multiline: r.multiline === true,
        defaultValue:
          typeof r.defaultValue === "string" ? r.defaultValue : undefined,
        required: r.required === true,
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
