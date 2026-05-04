import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "../../../lib/utils";
import { PALETTE_BY_TYPE } from "../NodePalette";
import {
  isHexColor,
  resolveCustomNodeIcon,
} from "../customNodeIcons";
import {
  buildBackflowEdges,
  nodeRuntimeState,
} from "../../../lib/businessWorkflowRuntime";
import type {
  BusinessCustomNodeType,
  BusinessEdge,
  BusinessNode,
  BusinessWorkflowEvent,
  BusinessWorkflowInstance,
} from "../../../contracts/businessWorkflow";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 72;

/**
 * Read-only replay of a pinned-version graph with live state coloring.
 *
 * State legend (driven by lib/businessWorkflowRuntime.nodeRuntimeState):
 *   active            emerald border + animated halo (animate-ping)
 *   completed         slate border, ✓ badge
 *   sent-back-source  dashed amber border (the work was rewound FROM
 *                     this node)
 *   failed            rose border (reserved for future failure events)
 *   idle              outline-variant
 *
 * Backflow edges (from buildBackflowEdges) render as dashed red
 * curves OVER the normal edges, with their own arrowhead, so the
 * operator can see "this work bounced back to that step at this time."
 *
 * Selection is bidirectional: parent passes `selectedNodeId`, dashboard
 * uses it to filter the timeline. Click a node here → updates filter.
 * Click an event in the timeline → parent updates selectedNodeId.
 */
type Props = {
  instance: BusinessWorkflowInstance;
  nodes: readonly BusinessNode[];
  edges: readonly BusinessEdge[];
  events: readonly BusinessWorkflowEvent[];
  customNodeTypes?: readonly BusinessCustomNodeType[];
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string | null) => void;
  className?: string;
};

const edgePath = (
  src: { x: number; y: number },
  dst: { x: number; y: number },
): string => {
  const sx = src.x + NODE_WIDTH;
  const sy = src.y + NODE_HEIGHT / 2;
  const dx = dst.x;
  const dy = dst.y + NODE_HEIGHT / 2;
  const midX = (sx + dx) / 2;
  return `M ${sx} ${sy} C ${midX} ${sy}, ${midX} ${dy}, ${dx} ${dy}`;
};

/** Curved arc for backflow — bows AWAY from the forward path so the
 *  two arrows don't overlap and confuse the operator. */
const backflowPath = (
  src: { x: number; y: number },
  dst: { x: number; y: number },
): string => {
  const sx = src.x;
  const sy = src.y + NODE_HEIGHT / 2;
  const dx = dst.x + NODE_WIDTH;
  const dy = dst.y + NODE_HEIGHT / 2;
  const midY = (sy + dy) / 2 - 80;
  return `M ${sx} ${sy} Q ${(sx + dx) / 2} ${midY}, ${dx} ${dy}`;
};

export const CanvasReadOnly = ({
  instance,
  nodes,
  edges,
  events,
  customNodeTypes = [],
  selectedNodeId,
  onSelectNode,
  className,
}: Props) => {
  const nodeMap = useMemo(() => {
    const m = new Map<string, BusinessNode>();
    nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [nodes]);

  const customByName = useMemo(() => {
    const m = new Map<string, BusinessCustomNodeType>();
    customNodeTypes.forEach((c) => m.set(c.name, c));
    return m;
  }, [customNodeTypes]);

  const backflows = useMemo(() => buildBackflowEdges(events), [events]);

  return (
    <div
      className={cn(
        "relative h-full w-full overflow-auto bg-surface-container-low",
        className,
      )}
      onClick={() => onSelectNode?.(null)}
    >
      {/* Edges */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ minWidth: 1600, minHeight: 1200 }}
      >
        <defs>
          <marker
            id="bw-ro-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(120 120 130)" />
          </marker>
          <marker
            id="bw-ro-back"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(220 38 38)" />
          </marker>
        </defs>

        {edges.map((edge) => {
          const src = nodeMap.get(edge.sourceNodeId);
          const dst = nodeMap.get(edge.targetNodeId);
          if (!src || !dst) return null;
          return (
            <g key={edge.id}>
              <path
                d={edgePath(src.position, dst.position)}
                stroke="rgb(120 120 130)"
                strokeWidth={1.5}
                fill="none"
                markerEnd="url(#bw-ro-arrow)"
              />
              {edge.label && (
                <text
                  x={(src.position.x + NODE_WIDTH + dst.position.x) / 2}
                  y={(src.position.y + dst.position.y + NODE_HEIGHT) / 2 - 6}
                  fontSize="10"
                  textAnchor="middle"
                  fill="rgb(120 120 130)"
                  className="select-none"
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Backflow arcs */}
        {backflows.map((b, i) => {
          const src = nodeMap.get(b.sourceNodeId);
          const dst = nodeMap.get(b.targetNodeId);
          if (!src || !dst) return null;
          return (
            <g key={`bf-${i}`}>
              <path
                d={backflowPath(src.position, dst.position)}
                stroke="rgb(220 38 38)"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                fill="none"
                markerEnd="url(#bw-ro-back)"
                opacity={0.85}
              >
                <title>
                  Sent back at {new Date(b.occurredAt).toLocaleString()}
                  {b.reason ? `\n${b.reason}` : ""}
                </title>
              </path>
            </g>
          );
        })}
      </svg>

      {/* Nodes */}
      {nodes.map((node) => {
        const palette = PALETTE_BY_TYPE[node.type] || null;
        const custom = !palette ? customByName.get(node.type) : null;
        const Icon =
          palette?.icon ?? (custom ? resolveCustomNodeIcon(custom.icon) : null);
        const customColor = custom?.color;
        const customColorIsHex = isHexColor(customColor);

        const state = nodeRuntimeState(node.id, instance, events);
        const selected = selectedNodeId === node.id;

        // Border + halo per state. Active gets a separate animated
        // halo wrapper. Sent-back-source uses dashed amber. Selected
        // adds an indigo ring on TOP of whatever state colour applies.
        const stateBorder =
          state === "active"
            ? "border-emerald-500"
            : state === "completed"
              ? "border-slate-300"
              : state === "sent-back-source"
                ? "border-amber-500 border-dashed"
                : state === "failed"
                  ? "border-rose-500"
                  : "border-outline-variant/40";

        return (
          <div
            key={node.id}
            className="absolute"
            style={{
              left: node.position.x,
              top: node.position.y,
              width: NODE_WIDTH,
              height: NODE_HEIGHT,
            }}
          >
            {/* Animated halo behind active nodes — visible signal that
                this is where work is happening RIGHT NOW. */}
            {state === "active" && (
              <span
                className="pointer-events-none absolute -inset-1 animate-ping rounded-xl bg-emerald-400 opacity-30"
                aria-hidden
              />
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectNode?.(selected ? null : node.id);
              }}
              className={cn(
                "relative flex h-full w-full items-center gap-2 rounded-xl border-2 bg-white px-3 text-left shadow-sm transition-all",
                stateBorder,
                selected && "ring-4 ring-primary/30",
                state === "completed" && "opacity-90",
              )}
            >
              {Icon && (
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded",
                    palette?.color,
                    !palette && !customColorIsHex && customColor,
                    !customColorIsHex && (palette || customColor) && "text-white",
                  )}
                  style={
                    customColorIsHex
                      ? {
                          backgroundColor: `${customColor}1A`,
                          border: `1px solid ${customColor}40`,
                        }
                      : undefined
                  }
                >
                  <Icon
                    size={14}
                    style={{
                      color: customColorIsHex ? customColor : undefined,
                    }}
                  />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.75rem] font-semibold text-on-surface">
                  {node.label || custom?.label || node.type}
                </p>
                <p className="truncate text-[0.6rem] uppercase tracking-wider text-outline">
                  {custom ? `${custom.baseType}` : node.type}
                </p>
              </div>
              {/* State badge — top right, tiny */}
              <span
                className={cn(
                  "absolute -top-1.5 -right-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[0.5rem] font-bold uppercase ring-1 ring-white",
                  state === "active" && "bg-emerald-500 text-white",
                  state === "completed" && "bg-slate-400 text-white",
                  state === "sent-back-source" && "bg-amber-500 text-white",
                  state === "failed" && "bg-rose-500 text-white",
                  state === "idle" && "hidden",
                )}
              >
                {state === "active" && "live"}
                {state === "completed" && "done"}
                {state === "sent-back-source" && "back"}
                {state === "failed" && "fail"}
              </span>
            </button>
          </div>
        );
      })}

      {/* Legend pinned bottom-right so first-time viewers get the
          colour vocabulary without pinging the room. */}
      <div className="pointer-events-none sticky bottom-3 left-[100%] inline-flex w-fit -translate-x-full flex-col gap-0.5 rounded-lg border border-outline-variant/30 bg-white/90 px-2 py-1.5 text-[0.6rem] shadow-sm backdrop-blur">
        <p className="font-semibold uppercase text-outline">Legend</p>
        <p>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle" />
          live · active task
        </p>
        <p>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-400 align-middle" />
          completed
        </p>
        <p>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500 align-middle" />
          sent back from here
        </p>
        <p>
          <ArrowRight
            size={9}
            className="mr-1 inline-block text-rose-600"
          />
          backflow arrow (send-back)
        </p>
      </div>
    </div>
  );
};
