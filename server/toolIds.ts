import type { ToolAdapterId } from "../src/types";
import { TOOL_ADAPTER_IDS, getToolCatalogEntry } from "../src/lib/toolCatalog";

export const TOOL_ID_ALIASES: Record<string, ToolAdapterId> =
  TOOL_ADAPTER_IDS.reduce((aliases, toolId) => {
    aliases[toolId] = toolId;
    for (const alias of getToolCatalogEntry(toolId).aliases || []) {
      aliases[String(alias).trim().toLowerCase()] = toolId;
    }
    return aliases;
  }, {} as Record<string, ToolAdapterId>);

const normalizeString = (value: unknown) => String(value || "").trim();

export const normalizeToolAdapterId = (value: unknown): ToolAdapterId | null => {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return null;
  }

  return TOOL_ID_ALIASES[normalized] || null;
};
