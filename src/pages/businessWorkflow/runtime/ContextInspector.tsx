import { useState } from "react";
import { ChevronDown, ChevronRight, Database } from "lucide-react";
import { cn } from "../../../lib/utils";

/**
 * Read-only collapsible JSON tree of `instance.context`.
 *
 * The instance's context grows as nodes complete and their
 * `outputBindings` write into dotted paths (e.g. `results.score`).
 * Operators want to see what's in there without breaking out a
 * separate JSON viewer.
 *
 * Implementation deliberately small — no third-party JSON viewer
 * dep. Recursive expand/collapse, copy-to-clipboard on long values,
 * monospace text. That's it.
 */
type Props = {
  context: Record<string, unknown>;
  className?: string;
};

export const ContextInspector = ({ context, className }: Props) => {
  if (!context || Object.keys(context).length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center gap-1 rounded-lg border-2 border-dashed border-outline-variant/40 bg-surface-container p-4 text-center",
          className,
        )}
      >
        <Database size={14} className="text-outline" />
        <p className="text-[0.7rem] text-outline">
          Context is empty. Bindings on completed nodes will populate
          dotted paths here.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-outline-variant/30 bg-white p-2 font-mono text-[0.7rem]",
        className,
      )}
    >
      <Tree value={context} initialPath="" depth={0} />
    </div>
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
