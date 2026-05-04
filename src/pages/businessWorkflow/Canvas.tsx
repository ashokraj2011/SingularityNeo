import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "../../lib/utils";
import type {
  BusinessCustomNodeType,
  BusinessEdge,
  BusinessNode,
} from "../../contracts/businessWorkflow";
import { PALETTE_BY_TYPE } from "./NodePalette";
import { isHexColor, resolveCustomNodeIcon } from "./customNodeIcons";

const NODE_WIDTH = 180;
const NODE_HEIGHT = 64;

type Selection =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  | null;

type Props = {
  nodes: BusinessNode[];
  edges: BusinessEdge[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onMoveNode: (nodeId: string, position: { x: number; y: number }) => void;
  onConnect: (sourceNodeId: string, targetNodeId: string) => void;
  onDeleteSelection: () => void;
  /**
   * Capability-defined custom node types — used to resolve icon/color
   * for nodes whose `type` doesn't appear in `PALETTE_BY_TYPE`.
   */
  customNodeTypes?: BusinessCustomNodeType[];
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

export const Canvas = ({
  nodes,
  edges,
  selection,
  onSelect,
  onMoveNode,
  onConnect,
  onDeleteSelection,
  customNodeTypes = [],
}: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [hoveredTargetId, setHoveredTargetId] = useState<string | null>(null);

  const nodeMap = useMemo(() => {
    const map = new Map<string, BusinessNode>();
    nodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [nodes]);

  /**
   * Lookup table from `node.type` → custom node type definition. Built
   * once per render so each node's icon/color resolves in O(1) without
   * scanning the array.
   */
  const customByName = useMemo(() => {
    const map = new Map<string, BusinessCustomNodeType>();
    customNodeTypes.forEach((t) => map.set(t.name, t));
    return map;
  }, [customNodeTypes]);

  const handleNodeMouseDown = useCallback(
    (event: React.MouseEvent, node: BusinessNode) => {
      event.stopPropagation();
      onSelect({ kind: "node", id: node.id });
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDraggingNodeId(node.id);
      setDragOffset({
        x: event.clientX - rect.left - node.position.x,
        y: event.clientY - rect.top - node.position.y,
      });
    },
    [onSelect],
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      setPointer({ x, y });
      if (draggingNodeId) {
        onMoveNode(draggingNodeId, {
          x: Math.max(0, x - dragOffset.x),
          y: Math.max(0, y - dragOffset.y),
        });
      }
    },
    [draggingNodeId, dragOffset, onMoveNode],
  );

  const handleMouseUp = useCallback(() => {
    setDraggingNodeId(null);
  }, []);

  const handleConnectStart = useCallback(
    (event: React.MouseEvent, nodeId: string) => {
      event.stopPropagation();
      setConnectFrom(nodeId);
    },
    [],
  );

  const handleConnectEnd = useCallback(
    (nodeId: string) => {
      if (connectFrom && connectFrom !== nodeId) {
        onConnect(connectFrom, nodeId);
      }
      setConnectFrom(null);
      setHoveredTargetId(null);
    },
    [connectFrom, onConnect],
  );

  /**
   * Click-then-click alternative for users who can't reliably drag the
   * tiny handle. Click a node's right-side "→" badge once to ARM
   * connection mode, then click any other node to complete.
   */
  const handleNodeClickWhileConnecting = useCallback(
    (nodeId: string) => {
      if (!connectFrom) return false;
      if (connectFrom === nodeId) {
        setConnectFrom(null);
        return true;
      }
      onConnect(connectFrom, nodeId);
      setConnectFrom(null);
      setHoveredTargetId(null);
      return true;
    },
    [connectFrom, onConnect],
  );

  const handleBackgroundClick = useCallback(() => {
    onSelect(null);
    setConnectFrom(null);
  }, [onSelect]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Delete" || event.key === "Backspace") {
        if (selection) {
          event.preventDefault();
          onDeleteSelection();
        }
      }
      if (event.key === "Escape" && connectFrom) {
        event.preventDefault();
        setConnectFrom(null);
        setHoveredTargetId(null);
      }
    },
    [connectFrom, onDeleteSelection, selection],
  );

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-auto bg-surface-container-low focus:outline-none"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleBackgroundClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      style={{ minHeight: 600 }}
    >
      {/* Edges */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ minWidth: 1600, minHeight: 1200 }}
      >
        {edges.map((edge) => {
          const src = nodeMap.get(edge.sourceNodeId);
          const dst = nodeMap.get(edge.targetNodeId);
          if (!src || !dst) return null;
          const isSelected =
            selection?.kind === "edge" && selection.id === edge.id;
          return (
            <g key={edge.id}>
              <path
                d={edgePath(src.position, dst.position)}
                stroke={isSelected ? "rgb(99 102 241)" : "rgb(120 120 130)"}
                strokeWidth={isSelected ? 2.5 : 1.5}
                fill="none"
                className="pointer-events-auto cursor-pointer"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect({ kind: "edge", id: edge.id });
                }}
              />
              {edge.label && (
                <text
                  x={(src.position.x + NODE_WIDTH + dst.position.x) / 2}
                  y={(src.position.y + dst.position.y + NODE_HEIGHT) / 2 - 6}
                  fontSize="10"
                  textAnchor="middle"
                  fill="rgb(120 120 130)"
                  className="pointer-events-none select-none"
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}
        {/* Pending connection preview */}
        {connectFrom && pointer && nodeMap.get(connectFrom) && (() => {
          const src = nodeMap.get(connectFrom)!;
          return (
            <path
              d={edgePath(src.position, {
                x: pointer.x - NODE_WIDTH / 2,
                y: pointer.y - NODE_HEIGHT / 2,
              })}
              stroke="rgb(99 102 241)"
              strokeWidth={2}
              strokeDasharray="4 4"
              fill="none"
            />
          );
        })()}
      </svg>

      {/* Nodes */}
      {nodes.map((node) => {
        const palette = PALETTE_BY_TYPE[node.type] || null;
        const custom = !palette ? customByName.get(node.type) : null;
        // Resolve icon: built-in palette wins, then custom (Lucide name
        // looked up in CUSTOM_NODE_ICON_MAP), else nothing.
        const Icon = palette?.icon ?? (custom ? resolveCustomNodeIcon(custom.icon) : null);
        // Color is either a Tailwind class (built-in or legacy custom)
        // or a hex code (new custom). The renderer below picks the
        // right styling path.
        const customColor = custom?.color;
        const customColorIsHex = isHexColor(customColor);
        const isSelected =
          selection?.kind === "node" && selection.id === node.id;
        const isConnectSource = connectFrom === node.id;
        const isPotentialTarget =
          Boolean(connectFrom) && connectFrom !== node.id;
        const isHoveredTarget =
          isPotentialTarget && hoveredTargetId === node.id;
        return (
          <div
            key={node.id}
            className={cn(
              "absolute select-none rounded-xl border-2 bg-white shadow-sm transition-colors",
              isSelected && !isPotentialTarget
                ? "border-primary"
                : isHoveredTarget
                  ? "border-emerald-500 ring-4 ring-emerald-200"
                  : isConnectSource
                    ? "border-amber-500 ring-4 ring-amber-200"
                    : isPotentialTarget
                      ? "border-emerald-300 cursor-crosshair"
                      : "border-outline-variant/40",
            )}
            style={{
              left: node.position.x,
              top: node.position.y,
              width: NODE_WIDTH,
              height: NODE_HEIGHT,
            }}
            onMouseDown={(e) => {
              // If we're in connect-mode, clicking another node ends
              // the connection — don't start a drag.
              if (connectFrom && connectFrom !== node.id) {
                e.stopPropagation();
                return;
              }
              handleNodeMouseDown(e, node);
            }}
            onMouseEnter={() => {
              if (isPotentialTarget) setHoveredTargetId(node.id);
            }}
            onMouseLeave={() => {
              if (hoveredTargetId === node.id) setHoveredTargetId(null);
            }}
            onMouseUp={(e) => {
              // ONLY stopPropagation when we're handling a connection.
              // For a normal click-or-drag, let the event bubble to the
              // container so its handleMouseUp clears draggingNodeId —
              // otherwise the node sticks to the cursor after a click.
              if (connectFrom && connectFrom !== node.id) {
                e.stopPropagation();
                handleConnectEnd(node.id);
              }
            }}
            onClick={(e) => {
              // Always stop propagation: a click on a node must NOT
              // reach the container's onClick (background-click handler),
              // otherwise the just-selected node is immediately
              // deselected and the inspector vanishes.
              e.stopPropagation();
              handleNodeClickWhileConnecting(node.id);
            }}
          >
            <div className="flex h-full items-center gap-2 px-3 pr-9">
              {Icon && (
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded",
                    // Built-in palette uses Tailwind class (text-white).
                    // Legacy custom (Tailwind class) renders the same way.
                    // New custom (hex) renders via inline style.
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
                <p className="truncate text-xs font-semibold text-on-surface">
                  {node.label || custom?.label || node.type}
                </p>
                <p className="truncate text-[0.62rem] uppercase tracking-wider text-outline">
                  {custom ? `${custom.baseType} · ${node.type}` : node.type}
                </p>
              </div>
            </div>

            {/* Right-edge connection handle.
              * Big enough to grab on a trackpad. Visible at all times.
              * - Mouse-DOWN starts a drag-to-connect
              * - CLICK arms click-then-click mode (then click a target)
              * Both flows are equivalent; whichever the user prefers. */}
            <button
              type="button"
              title="Drag to another node, OR click here then click the target node, to connect"
              className={cn(
                "absolute -right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border-2 bg-white text-primary shadow-md hover:bg-primary hover:text-white",
                isConnectSource ? "border-amber-500 bg-amber-100" : "border-primary",
              )}
              onMouseDown={(e) => handleConnectStart(e, node.id)}
              onClick={(e) => {
                e.stopPropagation();
                // If user just clicked (no drag), arm connect-mode.
                if (!connectFrom) setConnectFrom(node.id);
                else if (connectFrom !== node.id) {
                  onConnect(connectFrom, node.id);
                  setConnectFrom(null);
                }
              }}
            >
              <ArrowRight size={14} />
            </button>

            {/* Inbound landing strip on the left edge — purely visual,
              * shows where targets accept incoming connections. */}
            {isPotentialTarget && (
              <div className="pointer-events-none absolute -left-2 top-1/2 h-6 w-3 -translate-y-1/2 rounded-l-md border-2 border-r-0 border-emerald-400 bg-emerald-200" />
            )}
          </div>
        );
      })}

      {/* Floating instruction banner when in connect mode */}
      {connectFrom && (
        <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-amber-100 px-3 py-1 text-[0.7rem] font-semibold text-amber-800 shadow-md">
          Connecting from {nodeMap.get(connectFrom)?.label || connectFrom} —
          click another node, or press Esc to cancel
        </div>
      )}
    </div>
  );
};
