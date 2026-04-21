/**
 * Shared source of truth for "what is this page for?" copy.
 *
 * Originally built so the assistant dock's "Explain this page" action
 * could send a prompt that actually contains the page path, label, and
 * purpose. Previously the action sent a literal "Explain this page…"
 * with no context, so the LLM returned generic filler.
 *
 * Kept in a standalone module because:
 *   - Help menu, assistant dock, and command palette all want the
 *     same descriptions — one copy to update when a page changes.
 *   - Advanced tool routes already have label + description inside
 *     ADVANCED_TOOL_DESCRIPTORS, so we reuse that rather than
 *     duplicate it.
 */
import { ADVANCED_TOOL_DESCRIPTORS } from './capabilityExperience';

export type RouteDescription = {
  label: string;
  purpose: string;
};

/**
 * Primary surfaces (the 6 "main journey" pages from the help menu).
 * These are not in ADVANCED_TOOL_DESCRIPTORS because they're always-on
 * core navigation rather than advanced/contextual tools.
 */
const PRIMARY: Record<string, RouteDescription> = {
  '/': {
    label: 'Work',
    purpose:
      'Default landing surface. Operate one work item at a time, guide agents, review waits, approve gated work, and move delivery phase by phase.',
  },
  '/home': {
    label: 'Home',
    purpose:
      'Capability health at a glance — readiness, trust signal, active risk, and what the team should focus on next.',
  },
  '/team': {
    label: 'Agents',
    purpose:
      "Who can help. Each agent's responsibilities, skills, tools, and learning state for this capability.",
  },
  '/chat': {
    label: 'Chat',
    purpose:
      'Full-page chat with capability context and memory-backed grounding. Supports code-aware lookups via `find <symbol>`.',
  },
  '/ledger': {
    label: 'Evidence',
    purpose:
      'Artifacts, approvals, handoffs, completed work, and flight recorder history for this capability. Code changes open in a side-by-side diff viewer.',
  },
  '/designer': {
    label: 'Designer',
    purpose:
      'Define the workflow, lifecycle lanes, artifact expectations, and orchestration rules that shape delivery.',
  },
};

/**
 * Several routes are aliases for the same underlying page. Keeping the
 * alias map separate makes it obvious which paths are duplicates and
 * avoids scattering the purpose copy.
 */
const ALIASES: Record<string, keyof typeof PRIMARY> = {
  '/orchestrator': '/',
  '/work': '/',
  '/workflow-designer-neo': '/designer',
};

const normalize = (pathname: string): string => {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '');
};

/**
 * Resolve a pathname to its human-readable label + purpose, or `null`
 * when the route isn't catalogued (unknown / transient / auth screens).
 *
 * Match order:
 *   1. Alias → primary
 *   2. Primary exact
 *   3. ADVANCED_TOOL_DESCRIPTORS exact
 *   4. ADVANCED_TOOL_DESCRIPTORS prefix (for nested /governance/foo etc.)
 */
export const getRouteDescription = (pathname: string): RouteDescription | null => {
  const path = normalize(pathname);

  if (ALIASES[path]) return PRIMARY[ALIASES[path]];
  if (PRIMARY[path]) return PRIMARY[path];

  const exactTool = ADVANCED_TOOL_DESCRIPTORS.find(tool => tool.path === path);
  if (exactTool) {
    return { label: exactTool.label, purpose: exactTool.description };
  }

  // Nested routes (e.g. /governance/controls/foo) — fall back to the
  // parent tool's description so "Explain this page" still works on
  // detail views.
  const prefixTool = ADVANCED_TOOL_DESCRIPTORS.find(
    tool => tool.path !== '/' && path.startsWith(`${tool.path}/`),
  );
  if (prefixTool) {
    return { label: prefixTool.label, purpose: prefixTool.description };
  }

  return null;
};
