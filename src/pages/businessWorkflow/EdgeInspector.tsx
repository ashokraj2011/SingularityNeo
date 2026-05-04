import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import type {
  BusinessEdge,
  ConditionClause,
  ConditionGroup,
  ConditionOperator,
  EdgeCondition,
} from "../../contracts/businessWorkflow";
import { cn } from "../../lib/utils";

const OPERATORS: ConditionOperator[] = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "contains",
  "exists",
];

type Props = {
  edge: BusinessEdge;
  sourceLabel: string;
  targetLabel: string;
  onChange: (patch: Partial<BusinessEdge>) => void;
  onDelete: () => void;
};

const isGroup = (
  node: ConditionClause | ConditionGroup,
): node is ConditionGroup =>
  typeof (node as ConditionGroup).logic === "string" &&
  Array.isArray((node as ConditionGroup).clauses);

const ClauseRow = ({
  clause,
  onChange,
  onDelete,
}: {
  clause: ConditionClause;
  onChange: (patch: Partial<ConditionClause>) => void;
  onDelete: () => void;
}) => (
  <div className="flex items-start gap-1">
    <input
      type="text"
      value={clause.left}
      onChange={(e) => onChange({ left: e.target.value })}
      placeholder="results.score"
      className="w-28 rounded border border-outline-variant/40 bg-white px-1.5 py-1 text-[0.7rem] font-mono"
    />
    <select
      value={clause.op}
      onChange={(e) => onChange({ op: e.target.value as ConditionOperator })}
      className="rounded border border-outline-variant/40 bg-white px-1.5 py-1 text-[0.7rem]"
    >
      {OPERATORS.map((op) => (
        <option key={op} value={op}>
          {op}
        </option>
      ))}
    </select>
    {clause.op !== "exists" && (
      <input
        type="text"
        value={
          clause.right == null
            ? ""
            : typeof clause.right === "string"
              ? clause.right
              : String(clause.right)
        }
        onChange={(e) => onChange({ right: e.target.value })}
        placeholder={clause.op === "in" ? "a, b, c" : "value"}
        className="min-w-0 flex-1 rounded border border-outline-variant/40 bg-white px-1.5 py-1 text-[0.7rem]"
      />
    )}
    <button
      type="button"
      onClick={onDelete}
      title="Remove clause"
      className="rounded p-1 text-rose-500 hover:bg-rose-50"
    >
      <Trash2 size={11} />
    </button>
  </div>
);

const GroupEditor = ({
  group,
  onChange,
  onDelete,
  isRoot,
}: {
  group: ConditionGroup;
  onChange: (patch: ConditionGroup) => void;
  onDelete?: () => void;
  isRoot?: boolean;
}) => {
  const updateChildAt = (
    index: number,
    next: ConditionClause | ConditionGroup,
  ) => {
    const clauses = [...group.clauses];
    clauses[index] = next;
    onChange({ ...group, clauses });
  };
  const removeAt = (index: number) =>
    onChange({
      ...group,
      clauses: group.clauses.filter((_, i) => i !== index),
    });
  const addClause = () =>
    onChange({
      ...group,
      clauses: [...group.clauses, { left: "", op: "eq", right: "" }],
    });
  const addNested = () =>
    onChange({
      ...group,
      clauses: [
        ...group.clauses,
        { logic: "AND", clauses: [{ left: "", op: "eq", right: "" }] },
      ],
    });

  return (
    <div
      className={cn(
        "rounded-lg border p-2",
        isRoot
          ? "border-outline-variant/40 bg-white"
          : "border-violet-200 bg-violet-50/50",
      )}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <select
          value={group.logic}
          onChange={(e) =>
            onChange({ ...group, logic: e.target.value as "AND" | "OR" })
          }
          className="rounded border border-outline-variant/40 bg-white px-1.5 py-0.5 text-[0.65rem] font-bold"
        >
          <option value="AND">ALL of (AND)</option>
          <option value="OR">ANY of (OR)</option>
        </select>
        {!isRoot && onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded p-0.5 text-rose-500 hover:bg-rose-50"
          >
            <Trash2 size={10} />
          </button>
        )}
      </div>
      <div className="space-y-1">
        {group.clauses.map((child, i) =>
          isGroup(child) ? (
            <GroupEditor
              key={i}
              group={child}
              onChange={(next) => updateChildAt(i, next)}
              onDelete={() => removeAt(i)}
            />
          ) : (
            <ClauseRow
              key={i}
              clause={child}
              onChange={(patch) =>
                updateChildAt(i, { ...child, ...patch })
              }
              onDelete={() => removeAt(i)}
            />
          ),
        )}
      </div>
      <div className="mt-1.5 flex gap-1">
        <button
          type="button"
          onClick={addClause}
          className="inline-flex items-center gap-1 rounded border border-outline-variant/40 bg-white px-2 py-0.5 text-[0.65rem] hover:bg-surface-container"
        >
          <Plus size={9} /> Clause
        </button>
        <button
          type="button"
          onClick={addNested}
          className="inline-flex items-center gap-1 rounded border border-violet-300 bg-violet-50 px-2 py-0.5 text-[0.65rem] text-violet-700 hover:bg-violet-100"
        >
          <Plus size={9} /> Group
        </button>
      </div>
    </div>
  );
};

export const EdgeInspector = ({
  edge,
  sourceLabel,
  targetLabel,
  onChange,
  onDelete,
}: Props) => {
  const condition = useMemo<ConditionGroup>(
    () =>
      edge.condition || {
        logic: "AND",
        clauses: [],
      },
    [edge.condition],
  );

  return (
    <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-outline-variant/30 bg-surface-container-low p-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
            Edge Inspector
          </p>
          <p className="mt-0.5 truncate text-xs text-on-surface">
            <span className="font-semibold">{sourceLabel}</span> →{" "}
            <span className="font-semibold">{targetLabel}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-lg border border-rose-300 px-2 py-1 text-[0.65rem] font-semibold text-rose-700 hover:bg-rose-50"
        >
          Delete
        </button>
      </div>

      <label className="block text-xs">
        <span className="mb-1 block text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
          Label (optional)
        </span>
        <input
          type="text"
          value={edge.label || ""}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder='e.g. "approved" or "score >= 80"'
          className="w-full rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 text-xs"
        />
      </label>

      <div className="text-xs">
        <p className="mb-1 text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
          Condition
        </p>
        <p className="mb-2 text-[0.65rem] leading-relaxed text-outline">
          Edge is taken when this evaluates true. Empty group = always
          taken (default edge). Use dotted paths into the instance
          context (e.g. <code>results.score</code>,{" "}
          <code>approval.status</code>).
        </p>
        <GroupEditor
          group={condition}
          onChange={(next) =>
            onChange({
              condition: next.clauses.length === 0 ? null : next,
            })
          }
          isRoot
        />
        {edge.condition && condition.clauses.length === 0 && (
          <button
            type="button"
            onClick={() => onChange({ condition: null })}
            className="mt-2 text-[0.65rem] text-secondary underline"
          >
            Clear condition (always take this edge)
          </button>
        )}
      </div>
    </aside>
  );
};
