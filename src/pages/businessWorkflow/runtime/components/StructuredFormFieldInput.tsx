import { cn } from "../../../../lib/utils";
import {
  resolveFieldType,
  type StructuredFormField,
} from "../../../../lib/businessFormSchema";

/**
 * Single source-of-truth renderer for a structured form field. Used
 * by InstanceLaunchDialog and TaskCompletionDialog so a field
 * configured once in the designer reads the same way whether it
 * appears at launch time or task-completion time.
 *
 * All values are stored as strings (the form payload is uniformly
 * JSON-stringifiable). Boolean checkboxes round-trip as `"yes"` /
 * `"no"` so edge conditions written by humans match without
 * coercion gymnastics.
 */
export const StructuredFormFieldInput = ({
  field,
  value,
  onChange,
  className,
}: {
  field: StructuredFormField;
  value: string;
  onChange: (next: string) => void;
  className?: string;
}) => {
  const type = resolveFieldType(field);
  const baseInputClass =
    "w-full rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 text-xs";

  if (type === "longtext") {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        rows={3}
        className={cn(baseInputClass, "resize-y", className)}
      />
    );
  }

  if (type === "number") {
    return (
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        className={cn(baseInputClass, className)}
      />
    );
  }

  if (type === "date") {
    return (
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(baseInputClass, className)}
      />
    );
  }

  if (type === "boolean") {
    // Single checkbox. We render it inline-with-label to read
    // naturally as a yes/no toggle. Values stored as "yes" / "no" so
    // edge conditions written by operators match cleanly.
    const checked = value === "yes" || value === "true";
    return (
      <label
        className={cn(
          "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 text-xs",
          className,
        )}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked ? "yes" : "no")}
          className="h-3.5 w-3.5"
        />
        <span className="text-on-surface">
          {checked ? "Yes" : "No"}
        </span>
      </label>
    );
  }

  if (type === "choice") {
    const options = field.options || [];
    if (options.length === 0) {
      // Misconfigured field — fall back to text so the form still
      // renders rather than vanishing.
      return (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || "(no choices configured)"}
          className={cn(baseInputClass, className)}
        />
      );
    }
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(baseInputClass, className)}
      >
        {/* Placeholder option when nothing is selected yet. */}
        {!options.some((o) => o.value === value) && (
          <option value="" disabled>
            {field.placeholder || "Select…"}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  // Default: single-line text.
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      className={cn(baseInputClass, className)}
    />
  );
};
