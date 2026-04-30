import type { ToolAdapterId } from "../src/types";

export const TOOL_ID_ALIASES: Record<string, ToolAdapterId> = {
  workspace_list: "workspace_list",
  code_list: "workspace_list",
  file_list: "workspace_list",
  list_files: "workspace_list",
  workspace_read: "workspace_read",
  code_read: "workspace_read",
  file_read: "workspace_read",
  read_file: "workspace_read",
  workspace_search: "workspace_search",
  code_search: "workspace_search",
  file_search: "workspace_search",
  search_code: "workspace_search",
  browse_code: "browse_code",
  code_browse: "browse_code",
  browse_ast: "browse_code",
  ast_browse: "browse_code",
  symbol_browse: "browse_code",
  workspace_write: "workspace_write",
  code_write: "workspace_write",
  file_write: "workspace_write",
  write_file: "workspace_write",
  edit_file: "workspace_write",
  workspace_replace_block: "workspace_replace_block",
  replace_block: "workspace_replace_block",
  replace_in_file: "workspace_replace_block",
  workspace_apply_patch: "workspace_apply_patch",
  apply_patch: "workspace_apply_patch",
  patch_file: "workspace_apply_patch",
  delegate_task: "delegate_task",
  delegate: "delegate_task",
  handoff_task: "delegate_task",
  git_status: "git_status",
  repo_status: "git_status",
  run_build: "run_build",
  build: "run_build",
  run_test: "run_test",
  test: "run_test",
  run_docs: "run_docs",
  docs: "run_docs",
  run_deploy: "run_deploy",
  deploy: "run_deploy",
};

const normalizeString = (value: unknown) => String(value || "").trim();

export const normalizeToolAdapterId = (value: unknown): ToolAdapterId | null => {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return null;
  }

  return TOOL_ID_ALIASES[normalized] || null;
};
