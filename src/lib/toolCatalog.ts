import type { PolicyActionType, ToolAdapterId } from '../types';

export type ToolCatalogTone = 'info' | 'warning' | 'danger' | 'brand';
export type ToolCatalogCategory =
  | 'Read'
  | 'Write'
  | 'Orchestration'
  | 'Build & Deploy';
export type ToolExecutionClass =
  | 'read-only'
  | 'write'
  | 'orchestration'
  | 'build-deploy';
export type WorkspaceToolCategory =
  | 'Workspace'
  | 'Search'
  | 'Git'
  | 'Build'
  | 'Test'
  | 'Docs'
  | 'Deploy'
  | 'Orchestration';

export interface ToolCatalogEntry {
  label: string;
  description: string;
  category: ToolCatalogCategory;
  tone: ToolCatalogTone;
  executionClass: ToolExecutionClass;
  experimental: boolean;
  workflowSelectable: boolean;
  highImpact: boolean;
  readOnly: boolean;
  providerFunctionEligible: boolean;
  toolLoopEligible: boolean;
  workspaceTemplateCategory: WorkspaceToolCategory;
  requiresApproval: boolean;
  actionType?: PolicyActionType;
  aliases?: string[];
}

export type ToolCatalogRecord = ToolCatalogEntry & {
  toolId: ToolAdapterId;
};

export const TOOL_ADAPTER_IDS: ToolAdapterId[] = [
  'workspace_list',
  'workspace_read',
  'workspace_search',
  'browse_code',
  'git_status',
  'workspace_write',
  'workspace_replace_block',
  'workspace_apply_patch',
  'delegate_task',
  'publish_bounty',
  'resolve_bounty',
  'wait_for_signal',
  'run_build',
  'run_test',
  'run_docs',
  'run_deploy',
];

export const TOOL_CATALOG: Record<ToolAdapterId, ToolCatalogEntry> = {
  workspace_list: {
    label: 'Workspace list',
    description: 'List files inside the current desktop-user workspace path.',
    category: 'Read',
    tone: 'info',
    executionClass: 'read-only',
    experimental: false,
    workflowSelectable: true,
    highImpact: false,
    readOnly: true,
    providerFunctionEligible: true,
    toolLoopEligible: true,
    workspaceTemplateCategory: 'Workspace',
    requiresApproval: false,
    aliases: ['code_list', 'file_list', 'list_files'],
  },
  workspace_read: {
    label: 'Workspace read',
    description:
      'Read a text file. Prefer passing `symbol` (an exact function/class name from the code index) to get JUST that symbol body plus ~10 lines of context instead of the whole file — this saves 80-95% of input tokens. Pass `includeCallers` (0-3) and/or `includeCallees` (0-3) to additionally surface neighbor-file paths + their top exported signatures so cross-method invariants stay in scope for refactors. Only omit `symbol` when you truly need the full file.',
    category: 'Read',
    tone: 'info',
    executionClass: 'read-only',
    experimental: false,
    workflowSelectable: true,
    highImpact: false,
    readOnly: true,
    providerFunctionEligible: true,
    toolLoopEligible: true,
    workspaceTemplateCategory: 'Workspace',
    requiresApproval: false,
    aliases: ['code_read', 'file_read', 'read_file'],
  },
  workspace_search: {
    label: 'Workspace search',
    description:
      'Search the current desktop-user workspace for text, symbols, or natural-language code queries.',
    category: 'Read',
    tone: 'info',
    executionClass: 'read-only',
    experimental: false,
    workflowSelectable: true,
    highImpact: false,
    readOnly: true,
    providerFunctionEligible: true,
    toolLoopEligible: true,
    workspaceTemplateCategory: 'Search',
    requiresApproval: false,
    aliases: ['code_search', 'file_search', 'search_code'],
  },
  browse_code: {
    label: 'Browse code AST',
    description:
      "Browse the AST symbol index for this capability's repositories. Use kind='class'|'function'|'interface'|'method'|'type'|'enum'|'variable' to filter. Returns symbol names, file paths, and line ranges from the local base clone. Does NOT require cloning — uses the pre-synced _repos/ directory. Use this to discover API endpoints, service contracts, interfaces, and top-level exports.",
    category: 'Read',
    tone: 'info',
    executionClass: 'read-only',
    experimental: false,
    workflowSelectable: true,
    highImpact: false,
    readOnly: true,
    providerFunctionEligible: true,
    toolLoopEligible: true,
    workspaceTemplateCategory: 'Search',
    requiresApproval: false,
    aliases: ['code_browse', 'browse_ast', 'ast_browse', 'symbol_browse'],
  },
  git_status: {
    label: 'Git status',
    description: 'Inspect git status for the current desktop-user workspace repository.',
    category: 'Read',
    tone: 'info',
    executionClass: 'read-only',
    experimental: false,
    workflowSelectable: true,
    highImpact: false,
    readOnly: true,
    providerFunctionEligible: true,
    toolLoopEligible: true,
    workspaceTemplateCategory: 'Git',
    requiresApproval: false,
    aliases: ['repo_status'],
  },
  workspace_write: {
    label: 'Workspace write',
    description:
      'Create a NEW file at `path` with `content`. For edits to EXISTING files, use `workspace_apply_patch` (preferred) or `workspace_replace_block` instead — they are dramatically cheaper in output tokens and surface cleaner diffs to reviewers. Repeated `workspace_write` on an existing file will be REJECTED after the first attempt; use patch tools.',
    category: 'Write',
    tone: 'danger',
    executionClass: 'write',
    experimental: false,
    workflowSelectable: true,
    highImpact: true,
    readOnly: false,
    providerFunctionEligible: true,
    toolLoopEligible: true,
    workspaceTemplateCategory: 'Workspace',
    requiresApproval: true,
    actionType: 'workspace_write',
    aliases: ['code_write', 'file_write', 'write_file', 'edit_file'],
  },
  workspace_replace_block: {
    label: 'Workspace replace block',
    description:
      'PREFERRED for targeted single-block edits to existing files. Provide `find` (must match the existing text exactly) and `replace`. Far cheaper than rewriting the whole file with `workspace_write` and safer than free-form patches. Use this for simple in-place changes to an existing function or block.',
    category: 'Write',
    tone: 'danger',
    executionClass: 'write',
    experimental: false,
    workflowSelectable: true,
    highImpact: true,
    readOnly: false,
    providerFunctionEligible: true,
    toolLoopEligible: true,
    workspaceTemplateCategory: 'Workspace',
    requiresApproval: true,
    actionType: 'workspace_write',
    aliases: ['replace_block', 'replace_in_file'],
  },
  workspace_apply_patch: {
    label: 'Workspace apply patch',
    description:
      'PREFERRED for editing existing files. Accepts a standard unified diff (git-style) and applies it in place. Output ONLY the diff hunks — never the full file. Strongly prefer this tool over `workspace_write` for any modification to code that already exists, since it uses a fraction of the output tokens and produces reviewable diffs.',
    category: 'Write',
    tone: 'danger',
    executionClass: 'write',
    experimental: false,
    workflowSelectable: true,
    highImpact: true,
    readOnly: false,
    providerFunctionEligible: true,
    toolLoopEligible: true,
    workspaceTemplateCategory: 'Workspace',
    requiresApproval: true,
    actionType: 'workspace_write',
    aliases: ['apply_patch', 'patch_file'],
  },
  delegate_task: {
    label: 'Delegate task',
    description:
      'Delegate a bounded specialist subtask to another agent inside the current capability execution.',
    category: 'Orchestration',
    tone: 'warning',
    executionClass: 'orchestration',
    experimental: false,
    workflowSelectable: true,
    highImpact: false,
    readOnly: false,
    providerFunctionEligible: true,
    toolLoopEligible: true,
    workspaceTemplateCategory: 'Orchestration',
    requiresApproval: false,
    aliases: ['delegate', 'handoff_task'],
  },
  publish_bounty: {
    label: 'Publish bounty',
    description:
      'Experimental: publish an in-process bounty request to peer agents in the same runtime.',
    category: 'Orchestration',
    tone: 'warning',
    executionClass: 'orchestration',
    experimental: true,
    workflowSelectable: true,
    highImpact: false,
    readOnly: false,
    providerFunctionEligible: true,
    toolLoopEligible: true,
    workspaceTemplateCategory: 'Orchestration',
    requiresApproval: false,
  },
  resolve_bounty: {
    label: 'Resolve bounty',
    description:
      'Experimental: resolve an active in-process bounty that was published by another agent.',
    category: 'Orchestration',
    tone: 'warning',
    executionClass: 'orchestration',
    experimental: true,
    workflowSelectable: true,
    highImpact: false,
    readOnly: false,
    providerFunctionEligible: true,
    toolLoopEligible: true,
    workspaceTemplateCategory: 'Orchestration',
    requiresApproval: false,
  },
  wait_for_signal: {
    label: 'Wait for signal',
    description:
      'Experimental: wait for a previously published in-process bounty signal inside the current runtime.',
    category: 'Orchestration',
    tone: 'warning',
    executionClass: 'orchestration',
    experimental: true,
    workflowSelectable: true,
    highImpact: false,
    readOnly: false,
    providerFunctionEligible: true,
    toolLoopEligible: true,
    workspaceTemplateCategory: 'Orchestration',
    requiresApproval: false,
  },
  run_build: {
    label: 'Run build',
    description: 'Run an approved build command template inside the workspace.',
    category: 'Build & Deploy',
    tone: 'warning',
    executionClass: 'build-deploy',
    experimental: false,
    workflowSelectable: true,
    highImpact: false,
    readOnly: false,
    providerFunctionEligible: true,
    toolLoopEligible: true,
    workspaceTemplateCategory: 'Build',
    requiresApproval: false,
    actionType: 'run_build',
    aliases: ['build'],
  },
  run_test: {
    label: 'Run tests',
    description: 'Run an approved test command template inside the workspace.',
    category: 'Build & Deploy',
    tone: 'warning',
    executionClass: 'build-deploy',
    experimental: false,
    workflowSelectable: true,
    highImpact: false,
    readOnly: false,
    providerFunctionEligible: true,
    toolLoopEligible: true,
    workspaceTemplateCategory: 'Test',
    requiresApproval: false,
    actionType: 'run_test',
    aliases: ['test'],
  },
  run_docs: {
    label: 'Run docs',
    description: 'Run an approved docs command template inside the workspace.',
    category: 'Build & Deploy',
    tone: 'warning',
    executionClass: 'build-deploy',
    experimental: false,
    workflowSelectable: true,
    highImpact: false,
    readOnly: false,
    providerFunctionEligible: true,
    toolLoopEligible: true,
    workspaceTemplateCategory: 'Docs',
    requiresApproval: false,
    actionType: 'run_docs',
    aliases: ['docs'],
  },
  run_deploy: {
    label: 'Run deploy',
    description:
      'Execute an approved deployment target after the required release approval gate has passed.',
    category: 'Build & Deploy',
    tone: 'danger',
    executionClass: 'build-deploy',
    experimental: false,
    workflowSelectable: true,
    highImpact: true,
    readOnly: false,
    providerFunctionEligible: true,
    toolLoopEligible: true,
    workspaceTemplateCategory: 'Deploy',
    requiresApproval: true,
    actionType: 'run_deploy',
    aliases: ['deploy'],
  },
};

export const TOOL_CATEGORY_TONES: Record<ToolCatalogCategory, ToolCatalogTone> = {
  Read: 'info',
  Write: 'danger',
  Orchestration: 'brand',
  'Build & Deploy': 'warning',
};

export const getToolCatalogEntry = (toolId: ToolAdapterId) => TOOL_CATALOG[toolId];

export const listToolCatalogEntries = (
  toolIds: ToolAdapterId[] = TOOL_ADAPTER_IDS,
): ToolCatalogRecord[] => toolIds.map(toolId => ({ toolId, ...TOOL_CATALOG[toolId] }));

export const getWorkflowSelectableToolIds = () =>
  TOOL_ADAPTER_IDS.filter(toolId => TOOL_CATALOG[toolId].workflowSelectable);

export const getReadOnlyToolIds = () =>
  TOOL_ADAPTER_IDS.filter(toolId => TOOL_CATALOG[toolId].readOnly);

export const getHighImpactToolIds = () =>
  TOOL_ADAPTER_IDS.filter(toolId => TOOL_CATALOG[toolId].highImpact);

export const getProviderFunctionToolIds = () =>
  TOOL_ADAPTER_IDS.filter(toolId => TOOL_CATALOG[toolId].providerFunctionEligible);

export const getToolActionType = (toolId?: ToolAdapterId | null): PolicyActionType =>
  toolId ? TOOL_CATALOG[toolId]?.actionType || 'custom' : 'custom';
