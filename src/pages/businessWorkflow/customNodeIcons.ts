/**
 * Curated set of Lucide icons selectable for custom node types.
 * Mirrors workgraph-studio's CustomNodeTypesPage icon list so a
 * capability operator can pick an icon by name without typing.
 *
 * Resolved by name in the palette, canvas, and modal so a saved
 * `icon` string round-trips visually. Unknown names fall back to Box.
 */
import {
  Activity,
  AlertTriangle,
  Box,
  Briefcase,
  Calendar,
  CheckCircle,
  Clock,
  Cpu,
  Database,
  FileText,
  Filter,
  Globe,
  Mail,
  Phone,
  Search,
  Settings,
  Shield,
  Star,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";

export const CUSTOM_NODE_ICON_OPTIONS: { name: string; Icon: LucideIcon }[] = [
  { name: "Box", Icon: Box },
  { name: "Star", Icon: Star },
  { name: "Briefcase", Icon: Briefcase },
  { name: "Zap", Icon: Zap },
  { name: "Settings", Icon: Settings },
  { name: "Users", Icon: Users },
  { name: "Database", Icon: Database },
  { name: "Globe", Icon: Globe },
  { name: "Mail", Icon: Mail },
  { name: "Phone", Icon: Phone },
  { name: "Calendar", Icon: Calendar },
  { name: "Clock", Icon: Clock },
  { name: "CheckCircle", Icon: CheckCircle },
  { name: "AlertTriangle", Icon: AlertTriangle },
  { name: "FileText", Icon: FileText },
  { name: "Search", Icon: Search },
  { name: "Filter", Icon: Filter },
  { name: "Cpu", Icon: Cpu },
  { name: "Shield", Icon: Shield },
  { name: "Activity", Icon: Activity },
];

export const CUSTOM_NODE_ICON_MAP: Record<string, LucideIcon> =
  Object.fromEntries(
    CUSTOM_NODE_ICON_OPTIONS.map((option) => [option.name, option.Icon]),
  );

/**
 * 15 hex presets — same palette workgraph-studio offers, so a custom
 * type imported from there reads visually identical here.
 */
export const CUSTOM_NODE_COLOR_PRESETS = [
  "#22c55e",
  "#38bdf8",
  "#a3e635",
  "#c084fc",
  "#fb923c",
  "#f43f5e",
  "#facc15",
  "#06b6d4",
  "#8b5cf6",
  "#34d399",
  "#f87171",
  "#64748b",
  "#a78bfa",
  "#fbbf24",
  "#4ade80",
];

/** True iff the string starts with `#` (hex color), e.g. "#38bdf8". */
export const isHexColor = (value: string | null | undefined): boolean =>
  typeof value === "string" && /^#[0-9a-fA-F]{3,8}$/.test(value);

/** Resolve an icon name to a Lucide component, falling back to Box. */
export const resolveCustomNodeIcon = (
  name: string | null | undefined,
): LucideIcon => {
  if (!name) return Box;
  return CUSTOM_NODE_ICON_MAP[name] ?? Box;
};
