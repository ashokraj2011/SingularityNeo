import path from 'node:path';
import { initializeDatabase, query } from '../server/db';

type PacketRow = {
  bundle_id: string;
  capability_id: string;
  payload: Record<string, any> | string | null;
  touched_paths: string[] | null;
  workspace_roots: string[] | null;
};

const normalizeSlashes = (value: string) =>
  value
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .trim();

const looksAbsolutePath = (value: string) =>
  path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value);

const normalizeWorkspaceRoot = (value: string) => {
  const trimmed = normalizeSlashes(value).replace(/\/+$/, '');
  if (!trimmed) {
    return trimmed;
  }
  return looksAbsolutePath(trimmed) ? trimmed : normalizeSlashes(path.resolve(trimmed));
};

const toRelativeTouchedPath = (rawPath: string, workspaceRoots: string[]) => {
  const trimmed = String(rawPath || '').trim();
  if (!trimmed) {
    return undefined;
  }

  const normalizedPath = normalizeSlashes(trimmed);
  if (!looksAbsolutePath(normalizedPath)) {
    return normalizedPath.replace(/^\.\//, '').replace(/^\/+/, '') || undefined;
  }

  const matchedRoot = workspaceRoots
    .map(normalizeWorkspaceRoot)
    .find(root => normalizedPath === root || normalizedPath.startsWith(`${root}/`));

  if (!matchedRoot) {
    return normalizedPath.replace(/^\/+/, '') || undefined;
  }

  const relativePath = normalizeSlashes(path.posix.relative(matchedRoot, normalizedPath));
  return relativePath === '' || relativePath === '.'
    ? undefined
    : relativePath.replace(/^\.\//, '') || undefined;
};

const parsePayload = (value: PacketRow['payload']) => {
  if (!value) {
    return {};
  }
  if (typeof value === 'object') {
    return value as Record<string, any>;
  }
  try {
    return JSON.parse(String(value)) as Record<string, any>;
  } catch {
    return {};
  }
};

const collectTouchedPaths = (row: PacketRow) => {
  const payload = parsePayload(row.payload);
  const workspaceRoots = Array.isArray(row.workspace_roots)
    ? row.workspace_roots.map(root => String(root || '').trim()).filter(Boolean)
    : [];
  const runEvents = Array.isArray(payload.runEvents) ? payload.runEvents : [];

  return Array.from(
    new Set(
      runEvents.flatMap((event: Record<string, any>) => {
        const details = event?.details || {};
        const rawValues = Array.isArray(details.touchedPaths)
          ? details.touchedPaths
          : typeof details.path === 'string'
            ? [details.path]
            : [];
        return rawValues
          .map((value: unknown) => toRelativeTouchedPath(String(value || ''), workspaceRoots))
          .filter((value): value is string => Boolean(value));
      }),
    ),
  ).sort((left, right) => left.localeCompare(right));
};

const run = async () => {
  await initializeDatabase();

  const result = await query<PacketRow>(
    `
      SELECT
        packets.bundle_id,
        packets.capability_id,
        packets.payload,
        packets.touched_paths,
        ARRAY(
          SELECT DISTINCT root_value
          FROM unnest(
            array_cat(
              array_cat(
                ARRAY[
                  capabilities.execution_config->>'defaultWorkspacePath'
                ],
                COALESCE(
                  ARRAY(
                    SELECT jsonb_array_elements_text(
                      CASE
                        WHEN jsonb_typeof(capabilities.execution_config->'allowedWorkspacePaths') = 'array'
                          THEN capabilities.execution_config->'allowedWorkspacePaths'
                        ELSE '[]'::jsonb
                      END
                    )
                  ),
                  ARRAY[]::text[]
                )
              ),
              capabilities.local_directories
            )
          ) AS root_value
          WHERE root_value IS NOT NULL AND btrim(root_value) <> ''
        ) AS workspace_roots
      FROM capability_evidence_packets AS packets
      JOIN capabilities ON capabilities.id = packets.capability_id
      ORDER BY packets.created_at ASC
    `,
  );

  let updatedCount = 0;
  for (const row of result.rows) {
    const touchedPaths = collectTouchedPaths(row);
    const currentPaths = Array.isArray(row.touched_paths)
      ? row.touched_paths.map(value => String(value || '').trim()).filter(Boolean).sort()
      : [];
    if (JSON.stringify(currentPaths) === JSON.stringify(touchedPaths)) {
      continue;
    }

    await query(
      `
        UPDATE capability_evidence_packets
        SET touched_paths = $2, updated_at = NOW()
        WHERE bundle_id = $1
      `,
      [row.bundle_id, touchedPaths],
    );
    updatedCount += 1;
  }

  console.log(`Backfilled touched_paths for ${updatedCount} evidence packet(s).`);
};

run()
  .then(() => {
    process.exit(0);
  })
  .catch(error => {
    console.error('Failed to backfill touched paths.', error);
    process.exit(1);
  });
