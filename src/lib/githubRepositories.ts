import type { CapabilityRepository } from "../types";

const trim = (value?: string | null) => String(value || "").trim();

export const isGitHubRepositoryUrl = (value?: string | null) => {
  const normalized = trim(value).toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("github.com/") ||
    normalized.startsWith("git@github.com:") ||
    normalized.startsWith("ssh://git@github.com/") ||
    normalized.startsWith("github.com/")
  );
};

export const hasGitHubCapabilityRepository = (
  repositories?: Array<Pick<CapabilityRepository, "url" | "status">> | null,
) =>
  Boolean(
    (repositories || []).some(
      repository =>
        repository.status !== "ARCHIVED" && isGitHubRepositoryUrl(repository.url),
    ),
  );
