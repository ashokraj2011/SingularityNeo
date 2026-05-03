import fs from "node:fs/promises";
import path from "node:path";
import { Capability, CapabilityRepository, WorkItem } from "../src/types";
import {
  discoverExistingClonePaths,
  getCapabilityBaseClones,
  resolveOperatorWorkingDirectory,
} from "./desktopRepoSync";
import { buildCapabilityCheckoutSlug } from "./workItemCheckouts";
import { normalizeDirectoryPath } from "./workspacePaths";

export type CodeRootSource =
  | "work-item-checkout"
  | "base-clone-registry"
  | "operator-workdir-discovered"
  | "workspace-root-fallback";

export type ResolvedCodeRoot = {
  checkoutPath: string;
  repositoryId: string;
  repositoryLabel: string;
  source: CodeRootSource;
  isPrimary: boolean;
  lookupTokens: string[];
};

export type CodePathResolutionMode =
  | "absolute"
  | "repo-relative"
  | "repo-prefixed"
  | "workspace-fallback";

export type RequestedPathKind = "absolute" | "relative" | "repo-prefixed";

export type ResolvedCodePath = {
  resolvedPath: string;
  repoRoot?: ResolvedCodeRoot;
  pathResolutionMode: CodePathResolutionMode;
  requestedPathKind: RequestedPathKind;
  pathResolutionFallbackUsed: boolean;
};

const normalizeLookupToken = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.git$/i, "")
    .replace(/[^a-z0-9]+/g, "");

const isPathWithinRoot = (rootPath: string, candidatePath: string) => {
  const relative = path.relative(rootPath, candidatePath);
  return !(
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  );
};

const pathExists = async (candidatePath: string) =>
  fs.access(candidatePath).then(
    () => true,
    () => false,
  );

const safeJoinWithinRoot = (rootPath: string, relativePath: string) => {
  const candidatePath = path.resolve(rootPath, relativePath);
  if (!isPathWithinRoot(rootPath, candidatePath)) {
    throw new Error(`Path ${relativePath} escapes the repository root.`);
  }
  return candidatePath;
};

const extractRepositoryNameFromUrl = (value?: string) => {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  const lastSegment = trimmed.split("/").pop() || "";
  return lastSegment.replace(/\.git$/i, "");
};

const buildLookupTokens = (
  repository: CapabilityRepository | undefined,
  checkoutPath: string,
) => {
  const values = [
    repository?.label,
    repository?.localRootHint ? path.basename(repository.localRootHint) : "",
    extractRepositoryNameFromUrl(repository?.url),
    path.basename(checkoutPath),
  ];
  return [...new Set(values.map(normalizeLookupToken).filter(Boolean))];
};

const resolveRepositoryForClonePath = (
  repositories: CapabilityRepository[],
  clonePath: string,
) => {
  if (repositories.length === 1) {
    return repositories[0];
  }
  const cloneToken = normalizeLookupToken(path.basename(clonePath));
  return repositories.find((repository) =>
    buildLookupTokens(repository, clonePath).includes(cloneToken),
  );
};

const pickDefaultRepository = (
  repositories: CapabilityRepository[],
  explicitRepositoryId?: string,
) =>
  repositories.find((repository) => repository.id === explicitRepositoryId) ||
  repositories.find((repository) => repository.isPrimary) ||
  repositories[0];

export const findContainingCodeRoot = (
  candidatePath: string,
  codeRoots: ResolvedCodeRoot[],
) => codeRoots.find((root) => isPathWithinRoot(root.checkoutPath, candidatePath));

export const resolveCapabilityCodeRoots = async ({
  capability,
  workItem,
  explicitCheckoutPath,
  explicitRepositoryId,
  workingDirectoryPath,
  includeWorkspaceFallbackRoot = false,
  workspaceFallbackPath,
}: {
  capability: Pick<Capability, "id" | "name" | "repositories">;
  workItem?: Pick<WorkItem, "id" | "executionContext">;
  explicitCheckoutPath?: string;
  explicitRepositoryId?: string;
  workingDirectoryPath?: string;
  includeWorkspaceFallbackRoot?: boolean;
  workspaceFallbackPath?: string;
}): Promise<ResolvedCodeRoot[]> => {
  const repositories = Array.isArray(capability.repositories)
    ? capability.repositories
    : [];
  const defaultRepository = pickDefaultRepository(
    repositories,
    explicitRepositoryId ||
      workItem?.executionContext?.primaryRepositoryId ||
      workItem?.executionContext?.branch?.repositoryId,
  );
  const operatorWorkDir = normalizeDirectoryPath(
    workingDirectoryPath || (await resolveOperatorWorkingDirectory()),
  );
  const results: ResolvedCodeRoot[] = [];
  const seenPaths = new Set<string>();

  const addRoot = ({
    checkoutPath,
    repository,
    repositoryId,
    repositoryLabel,
    source,
    isPrimary,
  }: {
    checkoutPath: string;
    repository?: CapabilityRepository;
    repositoryId?: string;
    repositoryLabel?: string;
    source: CodeRootSource;
    isPrimary?: boolean;
  }) => {
    const normalizedPath = normalizeDirectoryPath(checkoutPath || "");
    if (!normalizedPath || seenPaths.has(normalizedPath)) {
      return;
    }
    if (
      source === "base-clone-registry" &&
      operatorWorkDir &&
      !normalizedPath.startsWith(operatorWorkDir)
    ) {
      return;
    }
    seenPaths.add(normalizedPath);
    const matchedRepository =
      repository || resolveRepositoryForClonePath(repositories, normalizedPath);
    const finalRepository = matchedRepository || defaultRepository;
    results.push({
      checkoutPath: normalizedPath,
      repositoryId:
        finalRepository?.id || repositoryId || explicitRepositoryId || capability.id,
      repositoryLabel:
        finalRepository?.label ||
        repositoryLabel ||
        path.basename(normalizedPath) ||
        "repository",
      source,
      isPrimary: Boolean(isPrimary ?? finalRepository?.isPrimary ?? results.length === 0),
      lookupTokens: buildLookupTokens(finalRepository, normalizedPath),
    });
  };

  if (explicitCheckoutPath) {
    // Only promote the work-item checkout to primary when it actually exists on
    // disk. If the directory is missing (no checkout yet, or a stale path), fall
    // through to the base clones so symbol paths resolve against real files.
    let workItemCheckoutExists = false;
    try {
      await fs.access(explicitCheckoutPath);
      workItemCheckoutExists = true;
    } catch {
      console.warn(
        `[codeRoots] explicit work-item checkout not found on disk, skipping: ${explicitCheckoutPath}`,
      );
    }
    if (workItemCheckoutExists) {
      addRoot({
        checkoutPath: explicitCheckoutPath,
        repository: pickDefaultRepository(repositories, explicitRepositoryId),
        repositoryId: explicitRepositoryId,
        source: "work-item-checkout",
        isPrimary: true,
      });
    }
  }

  const baseClones = capability.id
    ? getCapabilityBaseClones(capability.id).filter((entry) => entry.isGitRepo !== false)
    : [];
  for (const clone of [
    ...baseClones.filter((entry) => entry.isPrimary),
    ...baseClones.filter((entry) => !entry.isPrimary),
  ]) {
    addRoot({
      checkoutPath: clone.checkoutPath,
      repository: repositories.find((repository) => repository.id === clone.repositoryId),
      repositoryId: clone.repositoryId,
      repositoryLabel: clone.repositoryLabel,
      source: "base-clone-registry",
      isPrimary: clone.isPrimary,
    });
  }

  if (operatorWorkDir && capability.id) {
    const clonePaths = await discoverExistingClonePaths(
      operatorWorkDir,
      buildCapabilityCheckoutSlug(capability),
    );
    for (const clonePath of clonePaths) {
      addRoot({
        checkoutPath: clonePath,
        source: "operator-workdir-discovered",
        isPrimary: results.length === 0,
      });
    }
  }

  if (includeWorkspaceFallbackRoot && workspaceFallbackPath) {
    addRoot({
      checkoutPath: workspaceFallbackPath,
      repository: defaultRepository,
      source: "workspace-root-fallback",
      isPrimary: results.length === 0,
    });
  }

  return results;
};

export const canonicalizeRepoBackedPath = async ({
  requestedPath,
  codeRoots,
  workspaceFallbackPath,
}: {
  requestedPath: string;
  codeRoots: ResolvedCodeRoot[];
  workspaceFallbackPath?: string;
}): Promise<ResolvedCodePath> => {
  const trimmedPath = String(requestedPath || "").trim();
  if (!trimmedPath) {
    throw new Error("A repository-backed path is required.");
  }

  if (path.isAbsolute(trimmedPath)) {
    const resolvedPath = path.resolve(trimmedPath);
    return {
      resolvedPath,
      repoRoot: findContainingCodeRoot(resolvedPath, codeRoots),
      pathResolutionMode: "absolute",
      requestedPathKind: "absolute",
      pathResolutionFallbackUsed: false,
    };
  }

  const normalizedRelativePath = trimmedPath.replace(/\\/g, "/").replace(/^\.\/+/, "");
  const segments = normalizedRelativePath.split("/").filter(Boolean);
  const firstSegment = normalizeLookupToken(segments[0] || "");
  const prefixedRoot =
    segments.length > 1
      ? codeRoots.find((root) => root.lookupTokens.includes(firstSegment))
      : undefined;

  if (prefixedRoot) {
    const prefixedPath = safeJoinWithinRoot(
      prefixedRoot.checkoutPath,
      segments.slice(1).join("/"),
    );
    if (await pathExists(prefixedPath)) {
      return {
        resolvedPath: prefixedPath,
        repoRoot: prefixedRoot,
        pathResolutionMode: "repo-prefixed",
        requestedPathKind: "repo-prefixed",
        pathResolutionFallbackUsed: false,
      };
    }
  }

  for (const root of codeRoots) {
    const candidatePath = safeJoinWithinRoot(root.checkoutPath, normalizedRelativePath);
    if (await pathExists(candidatePath)) {
      return {
        resolvedPath: candidatePath,
        repoRoot: root,
        pathResolutionMode: "repo-relative",
        requestedPathKind: prefixedRoot ? "repo-prefixed" : "relative",
        pathResolutionFallbackUsed: false,
      };
    }
  }

  if (prefixedRoot) {
    return {
      resolvedPath: safeJoinWithinRoot(
        prefixedRoot.checkoutPath,
        segments.slice(1).join("/"),
      ),
      repoRoot: prefixedRoot,
      pathResolutionMode: "repo-prefixed",
      requestedPathKind: "repo-prefixed",
      pathResolutionFallbackUsed: true,
    };
  }

  if (codeRoots.length === 1) {
    return {
      resolvedPath: safeJoinWithinRoot(codeRoots[0].checkoutPath, normalizedRelativePath),
      repoRoot: codeRoots[0],
      pathResolutionMode: "repo-relative",
      requestedPathKind: "relative",
      pathResolutionFallbackUsed: true,
    };
  }

  if (workspaceFallbackPath) {
    return {
      resolvedPath: path.resolve(workspaceFallbackPath, trimmedPath),
      pathResolutionMode: "workspace-fallback",
      requestedPathKind: "relative",
      pathResolutionFallbackUsed: true,
    };
  }

  return {
    resolvedPath:
      codeRoots.length > 0
        ? safeJoinWithinRoot(codeRoots[0].checkoutPath, normalizedRelativePath)
        : path.resolve(trimmedPath),
    repoRoot: codeRoots[0],
    pathResolutionMode: "workspace-fallback",
    requestedPathKind: "relative",
    pathResolutionFallbackUsed: true,
  };
};
