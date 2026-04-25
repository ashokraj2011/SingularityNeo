import path from "node:path";
import type { Capability, CapabilityRepository } from "../src/types";
import { normalizeDirectoryPath } from "./workspacePaths";

const slugifySegment = (value: string, fallback: string) => {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
};

const extractRepositoryNameFromUrl = (url?: string) => {
  const trimmed = String(url || "").trim();
  if (!trimmed) return "";
  const withoutGit = trimmed.replace(/\.git$/i, "");
  const parts = withoutGit.split(/[/:]/).filter(Boolean);
  return parts[parts.length - 1] || "";
};

export const buildCapabilityCheckoutSlug = (
  capability: Pick<Capability, "name" | "id">,
) => slugifySegment(capability.name || capability.id || "", "capability");

export const buildRepositoryCheckoutSlug = (
  repository?: Pick<CapabilityRepository, "label" | "id" | "url">,
) =>
  slugifySegment(
    repository?.label ||
      extractRepositoryNameFromUrl(repository?.url) ||
      repository?.id ||
      "",
    "repository",
  );

/**
 * Returns the stable base clone path for a capability repository on a desktop.
 *
 * These clones are made once at claim time and updated on re-sync.  They are
 * NOT tied to a specific work item — think "the main branch replica available
 * for quick reads and AST grounding across all work items."
 *
 * Path: {workingDirectory}/_repos/{capability-slug}/{repository-slug}/
 */
export const buildCapabilityBaseRepositoryPath = ({
  workingDirectoryPath,
  capability,
  repository,
}: {
  workingDirectoryPath: string;
  capability: Pick<Capability, 'name' | 'id'>;
  repository: Pick<CapabilityRepository, 'label' | 'id' | 'url'>;
}): string => {
  const workspaceRoot = normalizeDirectoryPath(workingDirectoryPath);
  if (!workspaceRoot) return '';
  return path.join(
    workspaceRoot,
    '_repos',
    buildCapabilityCheckoutSlug(capability),
    buildRepositoryCheckoutSlug(repository),
  );
};

export const buildWorkItemCheckoutPath = ({
  workingDirectoryPath,
  capability,
  workItemId,
  repository,
  repositoryCount = 1,
}: {
  workingDirectoryPath: string;
  capability: Pick<Capability, "name" | "id">;
  workItemId: string;
  repository?: Pick<CapabilityRepository, "label" | "id" | "url">;
  repositoryCount?: number;
}) => {
  const workspaceRoot = normalizeDirectoryPath(workingDirectoryPath);
  if (!workspaceRoot) {
    return "";
  }

  const capabilityDirectory = path.join(
    workspaceRoot,
    buildCapabilityCheckoutSlug(capability),
    String(workItemId || "").trim(),
  );

  if (repositoryCount > 1) {
    return path.join(capabilityDirectory, buildRepositoryCheckoutSlug(repository));
  }

  return capabilityDirectory;
};
