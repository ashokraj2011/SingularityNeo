/**
 * Blast Radius Simulation — server-side endpoint.
 *
 * Given a file path (or symbol) within a capability's codebase, this
 * endpoint computes a dependency impact graph using the code index.
 * It classifies each dependent as CRITICAL, WARNING, or SAFE based on
 * coupling depth and import kind, then returns the result for the
 * BlastRadius visualization page.
 */
import type express from 'express';
import { assertCapabilityPermission } from '../access';
import { sendApiError } from '../api/errors';
import { parseActorContext } from '../requestActor';
import {
  findFileDependents,
  findFileDependencies,
  listTopExportsInFile,
} from '../codeIndex/query';
import { query } from '../db';

export type BlastImpactLevel = 'CRITICAL' | 'WARNING' | 'SAFE';

export interface BlastNode {
  id: string;
  /** Human-readable capability name, or file path for intra-capability nodes. */
  label: string;
  /** File path relative to the repo root. */
  filePath: string;
  capabilityId: string;
  capabilityName?: string;
  impactLevel: BlastImpactLevel;
  /** Why this node is impacted. */
  reason: string;
  /** Inferred from import kind or symbol usage. */
  couplingKind: 'DIRECT_IMPORT' | 'INDIRECT' | 'TYPE_ONLY';
}

export interface BlastRadiusResult {
  targetFile: string;
  targetCapabilityId: string;
  targetExports: string[];
  /** Total across all nodes. */
  totalDependents: number;
  criticalCount: number;
  warningCount: number;
  safeCount: number;
  nodes: BlastNode[];
  /** ISO timestamp of the analysis. */
  analyzedAt: string;
}

/**
 * Classify impact level by coupling kind and the nature of the target file.
 * A file whose name hints at config/schema/types causes CRITICAL failures
 * when its shape changes. A pure util helper is typically WARNING.
 */
const classifyImpact = (
  filePath: string,
  importKind: string | undefined,
  targetFile: string,
): BlastImpactLevel => {
  const isCriticalTarget =
    /\.(schema|config|types|constants|env)\.[jt]sx?$/.test(targetFile) ||
    /prisma|migration|db\.ts|database\./i.test(targetFile);

  if (isCriticalTarget) return 'CRITICAL';

  const isTypesOnly = importKind === 'type' || importKind === 'TYPE';
  if (isTypesOnly) return 'WARNING';

  const isValueImport =
    importKind === 'value' || importKind === 'VALUE' || !importKind;
  if (isValueImport) return 'WARNING';

  return 'SAFE';
};

/** Build a human-readable impact reason. */
const buildReason = (
  dependent: { filePath?: string; importKind?: string },
  targetFile: string,
): string => {
  const kind = dependent.importKind ?? 'VALUE';
  const isSchemaChange =
    /schema|migration|db\.|database/i.test(targetFile) ||
    /config|constants|types/i.test(targetFile);

  if (isSchemaChange) {
    return `Breaking structural change: ${kind} import of schema/config file will cause runtime failure.`;
  }
  if (kind === 'TYPE' || kind === 'type') {
    return `Type-only import; API contract changes may cause compilation errors.`;
  }
  return `Direct ${kind} import; symbol renames or signature changes will break this file.`;
};

/** Resolve a list of capability names by their IDs. */
const resolveCapabilityNames = async (
  capabilityIds: string[],
): Promise<Map<string, string>> => {
  if (!capabilityIds.length) return new Map();
  try {
    const result = await query<Record<string, unknown>>(
      `SELECT id, name FROM capabilities WHERE id = ANY($1::text[])`,
      [capabilityIds],
    );
    return new Map(result.rows.map(r => [String(r['id']), String(r['name'])]));
  } catch {
    return new Map();
  }
};

/**
 * Cross-capability blast radius: find all capability code-index entries
 * whose `to_module` resolves to our target file stem, across ALL indexed
 * capabilities (not just the origin capability).
 */
const findCrossCapabilityDependents = async (
  originCapabilityId: string,
  filePath: string,
): Promise<Array<{ capabilityId: string; fromFile: string; importKind?: string }>> => {
  const stem = filePath.replace(/\.[jt]sx?$/, '').replace(/^\.\//, '');
  try {
    const result = await query<Record<string, unknown>>(
      `
        SELECT capability_id, from_file, kind
        FROM capability_code_references
        WHERE to_module LIKE $1
          AND capability_id != $2
        LIMIT 50
      `,
      [`%${stem}%`, originCapabilityId],
    );
    return result.rows.map(r => ({
      capabilityId: String(r['capability_id']),
      fromFile: String(r['from_file']),
      importKind: r['kind'] ? String(r['kind']) : undefined,
    }));
  } catch {
    return [];
  }
};

export const registerBlastRadiusRoutes = (app: express.Express) => {
  app.get(
    '/api/capabilities/:capabilityId/blast-radius',
    async (request, response) => {
      try {
        const { capabilityId } = request.params;
        const filePath = String(request.query.filePath ?? '').trim();
        const limit = Math.min(25, Math.max(1, Number(request.query.limit ?? 15)));

        if (!filePath) {
          response.status(400).json({ error: 'filePath query parameter is required' });
          return;
        }

        await assertCapabilityPermission({
          capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'workitem.read',
        });

        // Run all lookups in parallel.
        const [internalDependents, exports_, crossCapDependents] = await Promise.all([
          findFileDependents(capabilityId, filePath, limit),
          listTopExportsInFile(capabilityId, filePath, 8).catch(() => []),
          findCrossCapabilityDependents(capabilityId, filePath),
        ]);

        // Collect all unique external capability IDs.
        const externalCapIds = [
          ...new Set(crossCapDependents.map(d => d.capabilityId)),
        ];
        const capabilityNames = await resolveCapabilityNames(externalCapIds);

        const nodes: BlastNode[] = [];

        // Internal (same-capability) dependents.
        for (const dep of internalDependents) {
          const level = classifyImpact(dep.filePath, dep.refKind, filePath);
          nodes.push({
            id: `int-${dep.filePath}`,
            label: dep.filePath,
            filePath: dep.filePath,
            capabilityId,
            impactLevel: level,
            reason: buildReason({ filePath: dep.filePath, importKind: dep.refKind }, filePath),
            couplingKind:
              dep.refKind === 'type' || dep.refKind === 'TYPE'
                ? 'TYPE_ONLY'
                : 'DIRECT_IMPORT',
          });
        }

        // Cross-capability dependents.
        for (const dep of crossCapDependents) {
          const level = classifyImpact(dep.fromFile, dep.importKind, filePath);
          const capName = capabilityNames.get(dep.capabilityId) ?? dep.capabilityId;
          nodes.push({
            id: `ext-${dep.capabilityId}-${dep.fromFile}`,
            label: capName,
            filePath: dep.fromFile,
            capabilityId: dep.capabilityId,
            capabilityName: capName,
            impactLevel: level,
            reason: `External dependency from capability "${capName}": ${buildReason(dep, filePath)}`,
            couplingKind:
              dep.importKind === 'type' || dep.importKind === 'TYPE'
                ? 'TYPE_ONLY'
                : dep.importKind
                  ? 'DIRECT_IMPORT'
                  : 'INDIRECT',
          });
        }

        const result: BlastRadiusResult = {
          targetFile: filePath,
          targetCapabilityId: capabilityId,
          targetExports: exports_.map(e => e.symbolName),
          totalDependents: nodes.length,
          criticalCount: nodes.filter(n => n.impactLevel === 'CRITICAL').length,
          warningCount: nodes.filter(n => n.impactLevel === 'WARNING').length,
          safeCount: nodes.filter(n => n.impactLevel === 'SAFE').length,
          nodes,
          analyzedAt: new Date().toISOString(),
        };

        response.json(result);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );
};
