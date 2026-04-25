import fs from "node:fs";
import path from "node:path";
import type {
  DesktopWorkspaceMapping,
  DesktopWorkspaceMappingValidation,
  DesktopWorkspaceResolution,
} from "../src/types";
import { query } from "./db";
import {
  isPathInsideWorkspaceRoot,
  normalizeDirectoryPath,
} from "./workspacePaths";

const createRuntimeId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

const asIso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : String(value || "");

const deriveLocalRootPath = ({
  localRootPath,
  workingDirectoryPath,
}: {
  localRootPath?: string;
  workingDirectoryPath?: string;
}) => {
  const normalizedLocalRootPath = normalizeDirectoryPath(localRootPath || "");
  if (normalizedLocalRootPath) {
    return normalizedLocalRootPath;
  }

  const normalizedWorkingDirectoryPath = normalizeDirectoryPath(
    workingDirectoryPath || "",
  );
  if (!normalizedWorkingDirectoryPath) {
    return "";
  }

  try {
    if (
      fs.existsSync(normalizedWorkingDirectoryPath) &&
      fs.statSync(normalizedWorkingDirectoryPath).isDirectory()
    ) {
      return normalizedWorkingDirectoryPath;
    }
  } catch {
    // Fall through to the parent directory.
  }

  return normalizeDirectoryPath(path.dirname(normalizedWorkingDirectoryPath));
};

const validateWorkspacePaths = ({
  localRootPath,
  workingDirectoryPath,
}: {
  localRootPath: string;
  workingDirectoryPath: string;
}): DesktopWorkspaceMappingValidation => {
  const normalizedRoot = normalizeDirectoryPath(localRootPath);
  const normalizedWorkingDirectory =
    normalizeDirectoryPath(workingDirectoryPath);

  if (!normalizedRoot) {
    return {
      code: "MAPPING_MISSING",
      valid: false,
      message:
        "A local root path is required for this desktop workspace mapping.",
    };
  }

  if (!fs.existsSync(normalizedRoot)) {
    return {
      code: "LOCAL_ROOT_MISSING",
      valid: false,
      message: `Local root ${normalizedRoot} does not exist on this desktop.`,
    };
  }

  try {
    if (!fs.statSync(normalizedRoot).isDirectory()) {
      return {
        code: "LOCAL_ROOT_NOT_DIRECTORY",
        valid: false,
        message: `Local root ${normalizedRoot} is not a directory.`,
      };
    }
  } catch {
    return {
      code: "LOCAL_ROOT_MISSING",
      valid: false,
      message: `Local root ${normalizedRoot} could not be inspected on this desktop.`,
    };
  }

  if (!normalizedWorkingDirectory) {
    return {
      code: "WORKING_DIRECTORY_MISSING",
      valid: false,
      message:
        "A working directory is required for this desktop workspace mapping.",
    };
  }

  if (!isPathInsideWorkspaceRoot(normalizedWorkingDirectory, normalizedRoot)) {
    return {
      code: "WORKING_DIRECTORY_OUTSIDE_ROOT",
      valid: false,
      message: `Working directory ${normalizedWorkingDirectory} must stay inside local root ${normalizedRoot}.`,
    };
  }

  if (!fs.existsSync(normalizedWorkingDirectory)) {
    return {
      code: "WORKING_DIRECTORY_PENDING",
      valid: true,
      message: `Working directory ${normalizedWorkingDirectory} does not exist yet. SingularityNeo will create it and clone the repository when work starts.`,
    };
  }

  try {
    if (!fs.statSync(normalizedWorkingDirectory).isDirectory()) {
      return {
        code: "WORKING_DIRECTORY_NOT_DIRECTORY",
        valid: false,
        message: `Working directory ${normalizedWorkingDirectory} is not a directory.`,
      };
    }
  } catch {
    return {
      code: "WORKING_DIRECTORY_MISSING",
      valid: false,
      message: `Working directory ${normalizedWorkingDirectory} could not be inspected on this desktop.`,
    };
  }

  return {
    code: "VALID",
    valid: true,
    message: "Validated on this desktop.",
  };
};

const desktopWorkspaceMappingFromRow = (
  row: Record<string, any>,
): DesktopWorkspaceMapping => {
  const localRootPath = normalizeDirectoryPath(row.local_root_path || "");
  const workingDirectoryPath = normalizeDirectoryPath(
    row.working_directory_path || row.local_root_path || "",
  );

  return {
    id: row.id,
    executorId: row.executor_id,
    userId: row.user_id,
    capabilityId: row.capability_id,
    repositoryId: row.repository_id || undefined,
    localRootPath,
    workingDirectoryPath,
    validation: validateWorkspacePaths({
      localRootPath,
      workingDirectoryPath,
    }),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
};

export const listDesktopWorkspaceMappings = async ({
  executorId,
  userId,
  capabilityId,
  repositoryId,
}: {
  executorId: string;
  userId?: string;
  capabilityId?: string;
  repositoryId?: string;
}): Promise<DesktopWorkspaceMapping[]> => {
  const where: string[] = ["executor_id = $1"];
  const params: Array<string | null> = [executorId];

  if (userId) {
    params.push(userId);
    where.push(`user_id = $${params.length}`);
  }

  if (capabilityId) {
    params.push(capabilityId);
    where.push(`capability_id = $${params.length}`);
  }

  if (repositoryId !== undefined) {
    params.push(repositoryId || null);
    if (repositoryId) {
      where.push(`repository_id = $${params.length}`);
    } else {
      where.push("repository_id IS NULL");
    }
  }

  const result = await query(
    `
      SELECT *
      FROM desktop_user_workspace_mappings
      WHERE ${where.join(" AND ")}
      ORDER BY capability_id ASC, repository_id ASC NULLS FIRST, updated_at DESC
    `,
    params,
  );

  return result.rows.map(desktopWorkspaceMappingFromRow);
};

export const getDesktopWorkspaceMappingById = async (
  mappingId: string,
): Promise<DesktopWorkspaceMapping | null> => {
  const result = await query(
    `
      SELECT *
      FROM desktop_user_workspace_mappings
      WHERE id = $1
    `,
    [mappingId],
  );

  return result.rowCount
    ? desktopWorkspaceMappingFromRow(result.rows[0])
    : null;
};

const getExistingMappingForScope = async ({
  executorId,
  userId,
  capabilityId,
  repositoryId,
}: {
  executorId: string;
  userId: string;
  capabilityId: string;
  repositoryId?: string;
}) => {
  const result = await query(
    repositoryId
      ? `
          SELECT *
          FROM desktop_user_workspace_mappings
          WHERE executor_id = $1
            AND user_id = $2
            AND capability_id = $3
            AND repository_id = $4
        `
      : `
          SELECT *
          FROM desktop_user_workspace_mappings
          WHERE executor_id = $1
            AND user_id = $2
            AND capability_id = $3
            AND repository_id IS NULL
        `,
    repositoryId
      ? [executorId, userId, capabilityId, repositoryId]
      : [executorId, userId, capabilityId],
  );

  return result.rowCount
    ? desktopWorkspaceMappingFromRow(result.rows[0])
    : null;
};

export const upsertDesktopWorkspaceMapping = async ({
  id,
  executorId,
  userId,
  capabilityId,
  repositoryId,
  localRootPath,
  workingDirectoryPath,
}: {
  id?: string;
  executorId: string;
  userId: string;
  capabilityId: string;
  repositoryId?: string;
  localRootPath?: string;
  workingDirectoryPath?: string;
}): Promise<DesktopWorkspaceMapping> => {
  const normalizedWorkingDirectoryPath = normalizeDirectoryPath(
    workingDirectoryPath || localRootPath || "",
  );
  const normalizedLocalRootPath = deriveLocalRootPath({
    localRootPath,
    workingDirectoryPath: normalizedWorkingDirectoryPath,
  });

  if (!normalizedWorkingDirectoryPath) {
    throw new Error("workingDirectoryPath is required.");
  }

  if (!normalizedLocalRootPath) {
    throw new Error(
      "localRootPath could not be derived. Provide a local root path or a working directory path with an existing parent directory.",
    );
  }

  if (
    normalizedWorkingDirectoryPath &&
    !isPathInsideWorkspaceRoot(
      normalizedWorkingDirectoryPath,
      normalizedLocalRootPath,
    )
  ) {
    throw new Error(
      `Working directory ${normalizedWorkingDirectoryPath} must stay inside ${normalizedLocalRootPath}.`,
    );
  }

  const existing =
    (id ? await getDesktopWorkspaceMappingById(id) : null) ||
    (await getExistingMappingForScope({
      executorId,
      userId,
      capabilityId,
      repositoryId,
    }));

  const nextId = existing?.id || id || createRuntimeId("DWM");
  const result = await query(
    existing
      ? `
          UPDATE desktop_user_workspace_mappings
          SET
            executor_id = $2,
            user_id = $3,
            capability_id = $4,
            repository_id = $5,
            local_root_path = $6,
            working_directory_path = $7,
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `
      : `
          INSERT INTO desktop_user_workspace_mappings (
            id,
            executor_id,
            user_id,
            capability_id,
            repository_id,
            local_root_path,
            working_directory_path,
            created_at,
            updated_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
          RETURNING *
        `,
    [
      nextId,
      executorId,
      userId,
      capabilityId,
      repositoryId || null,
      normalizedLocalRootPath,
      normalizedWorkingDirectoryPath || normalizedLocalRootPath,
    ],
  );

  return desktopWorkspaceMappingFromRow(result.rows[0]);
};

export const deleteDesktopWorkspaceMapping = async ({
  mappingId,
}: {
  mappingId: string;
}): Promise<void> => {
  await query(
    `
      DELETE FROM desktop_user_workspace_mappings
      WHERE id = $1
    `,
    [mappingId],
  );
};

export const listValidatedWorkspaceRootsByCapability = async ({
  executorId,
  userId,
}: {
  executorId: string;
  userId: string;
}): Promise<Record<string, string[]>> => {
  const mappings = await listDesktopWorkspaceMappings({ executorId, userId });
  const rootsByCapability = new Map<string, Set<string>>();

  for (const mapping of mappings) {
    if (!mapping.validation.valid) {
      continue;
    }

    const next =
      rootsByCapability.get(mapping.capabilityId) || new Set<string>();
    next.add(mapping.localRootPath);
    rootsByCapability.set(mapping.capabilityId, next);
  }

  return Object.fromEntries(
    Array.from(rootsByCapability.entries()).map(([capabilityId, roots]) => [
      capabilityId,
      Array.from(roots),
    ]),
  );
};

/**
 * Fetch the `working_directory` column on `desktop_executor_registrations`
 * for an executor. Inlined here (instead of importing
 * `getDesktopExecutorRegistration`) because `executionOwnership.ts`
 * already imports from this module — a reverse import would create a
 * cycle. A single-column lookup is cheap enough to duplicate.
 */
const loadExecutorWorkingDirectory = async (
  executorId: string,
): Promise<string | null> => {
  try {
    const { rows } = await query<{ working_directory: string | null }>(
      `SELECT working_directory
         FROM desktop_executor_registrations
        WHERE id = $1
        LIMIT 1`,
      [executorId],
    );
    const raw = rows[0]?.working_directory;
    if (!raw || typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
};

export const resolveDesktopWorkspace = async ({
  executorId,
  userId,
  capabilityId,
  repositoryId,
}: {
  executorId: string;
  userId: string;
  capabilityId: string;
  repositoryId?: string;
}): Promise<DesktopWorkspaceResolution> => {
  const mappings = await listDesktopWorkspaceMappings({
    executorId,
    userId,
    capabilityId,
  });
  const mapping =
    (repositoryId
      ? mappings.find((entry) => entry.repositoryId === repositoryId)
      : null) || mappings.find((entry) => !entry.repositoryId);
  const approvedWorkspaceRoots = Array.from(
    new Set(
      mappings
        .filter((entry) => entry.validation.valid)
        .map((entry) => entry.localRootPath)
        .filter(Boolean),
    ),
  );

  if (!mapping) {
    // No explicit per-capability mapping exists. Fall back to the
    // executor-level `working_directory` that the desktop worker sends
    // on registration (driven by the operator's
    // `SINGULARITY_WORKING_DIRECTORY` env). This is now the primary way
    // to configure a workspace for a personal machine — per-capability
    // mappings become an opt-in override for power users / shared
    // runners.
    const executorWorkingDirectory =
      await loadExecutorWorkingDirectory(executorId);
    if (executorWorkingDirectory) {
      const normalizedRoot = normalizeDirectoryPath(executorWorkingDirectory);
      // The configured working directory is a parent workspace area. Runtime
      // callers derive the per-capability / per-work-item checkout path from
      // this root so multiple work items never collide on the same checkout.
      const synthesizedWorkingDirectoryPath = normalizedRoot;
      const synthesizedValidation = validateWorkspacePaths({
        localRootPath: normalizedRoot,
        workingDirectoryPath: synthesizedWorkingDirectoryPath,
      });

      return {
        executorId,
        userId,
        capabilityId,
        repositoryId,
        // Synthesized resolutions have no mappingId on purpose — there
        // is no row in `desktop_user_workspace_mappings`. Downstream
        // consumers that require a mappingId (write-back, deletion,
        // etc.) will still fail; this only unblocks read-side clone +
        // tool resolution.
        localRootPath: normalizedRoot || undefined,
        workingDirectoryPath: synthesizedWorkingDirectoryPath || undefined,
        approvedWorkspaceRoots: Array.from(
          new Set([...(approvedWorkspaceRoots ?? []), normalizedRoot].filter(Boolean)),
        ),
        validation: synthesizedValidation,
      };
    }

    return {
      executorId,
      userId,
      capabilityId,
      repositoryId,
      approvedWorkspaceRoots,
      validation: {
        code: "MAPPING_MISSING",
        valid: false,
        message: repositoryId
          ? "No desktop workspace mapping is stored for this repository on the current desktop, and the executor has no SINGULARITY_WORKING_DIRECTORY fallback."
          : "No desktop workspace mapping is stored for this capability on the current desktop, and the executor has no SINGULARITY_WORKING_DIRECTORY fallback.",
      },
    };
  }

  return {
    executorId,
    userId,
    capabilityId,
    repositoryId: mapping.repositoryId,
    mappingId: mapping.id,
    localRootPath: mapping.localRootPath,
    workingDirectoryPath: mapping.workingDirectoryPath,
    approvedWorkspaceRoots,
    validation: mapping.validation,
  };
};

export const requireValidDesktopWorkspaceResolution = (
  resolution: DesktopWorkspaceResolution,
): DesktopWorkspaceResolution & {
  localRootPath: string;
  workingDirectoryPath: string;
  validation: DesktopWorkspaceMappingValidation & { valid: true };
} => {
  // `mappingId` is intentionally NOT required here — a resolution may be
  // synthesized from the executor's `SINGULARITY_WORKING_DIRECTORY`
  // fallback with no corresponding row in `desktop_user_workspace_mappings`.
  // Callers that need a real mappingId (write-back, deletion) must
  // check for it themselves.
  if (
    !resolution.validation.valid ||
    !resolution.localRootPath ||
    !resolution.workingDirectoryPath
  ) {
    throw new Error(
      resolution.validation.message ||
        "No valid desktop workspace is available for this operator on the current desktop. Set SINGULARITY_WORKING_DIRECTORY in the desktop operator's .env.local, or add a per-capability workspace mapping.",
    );
  }

  return resolution as DesktopWorkspaceResolution & {
    localRootPath: string;
    workingDirectoryPath: string;
    validation: DesktopWorkspaceMappingValidation & { valid: true };
  };
};
