import { useCallback, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import type {
  BusinessEdge,
  BusinessNode,
} from "../../contracts/businessWorkflow";
import { PALETTE_BY_TYPE } from "./NodePalette";

const NODE_WIDTH = 160;
const NODE_HEIGHT = 56;

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
}: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  const nodeMap = useMemo(() => {
    const map = new Map<string, BusinessNode>();
    nodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [nodes]);

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
    },
    [onDeleteSelection, selection],
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
        const Icon = palette?.icon;
        const isSelected =
          selection?.kind === "node" && selection.id === node.id;
        return (
          <div
            key={node.id}
            className={cn(
              "absolute select-none rounded-xl border-2 bg-white shadow-sm",
              isSelected
                ? "border-primary"
                : "border-outline-variant/40",
            )}
            style={{
              left: node.position.x,
              top: node.position.y,
              width: NODE_WIDTH,
              height: NODE_HEIGHT,
            }}
            onMouseDown={(e) => handleNodeMouseDown(e, node)}
            onMouseUp={(e) => {
              e.stopPropagation();
              if (connectFrom) handleConnectEnd(node.id);
            }}
          >
            <div className="flex h-full items-center gap-2 px-3">
              {Icon && (
                <span className={cn("rounded p-1 text-white", palette?.color)}>
                  <Icon size={14} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-on-surface">
                  {node.label || node.type}
                </p>
                <p className="truncate text-[0.62rem] uppercase tracking-wider text-outline">
                  {node.type}
                </p>
              </div>
            </div>
            {/* Connection handles */}
            <button
              type="button"
              title="Drag to connect"
              className="absolute -right-2 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-primary bg-white hover:bg-primary"
              onMouseDown={(e) => handleConnectStart(e, node.id)}
            />
          </div>
        );
      })}
    </div>
  );
};
