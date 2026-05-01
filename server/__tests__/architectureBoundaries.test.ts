import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MODULAR_DOMAIN_BOUNDARIES,
  type ModularDomainBoundary,
} from '../../src/contracts/architecture';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

const readProjectFile = (relativePath: string) =>
  fs.readFileSync(path.resolve(projectRoot, relativePath), 'utf8');

const listTypescriptFiles = (relativeDirectory: string) => {
  const absoluteDirectory = path.resolve(projectRoot, relativeDirectory);
  if (!fs.existsSync(absoluteDirectory)) {
    return [];
  }

  const queue = [absoluteDirectory];
  const files: string[] = [];

  while (queue.length) {
    const current = queue.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry.name)) {
        files.push(path.relative(projectRoot, fullPath));
      }
    }
  }

  return files.sort();
};

const expectNoLegacyClientImports = (filePath: string) => {
  const source = readProjectFile(filePath);
  expect(source).not.toMatch(/src\/lib\//);
  expect(source).not.toMatch(/src\/types(?:\.ts)?['"]/);
};

const countLines = (relativePath: string) =>
  readProjectFile(relativePath).split('\n').length;

const SELF_SERVICE_REPOSITORY_EXPORTS = [
  'addCapabilityAgentRecord',
  'addCapabilitySkillRecord',
  'clearCapabilityMessageHistoryRecord',
  'createCapabilityRecord',
  'fetchAppState',
  'getCapabilityAlmExportRecord',
  'getCapabilityBundle',
  'getCapabilityRepositoriesRecord',
  'getCapabilityTask',
  'getWorkspaceCatalogSnapshot',
  'getWorkspaceSettings',
  'initializeSeedData',
  'initializeWorkspaceFoundations',
  'listCapabilityTasks',
  'publishCapabilityContractRecord',
  'removeCapabilitySkillRecord',
  'replaceCapabilityWorkspaceContentRecord',
  'setActiveChatAgentRecord',
  'updateCapabilityAgentModelsRecord',
  'updateCapabilityAgentRecord',
  'updateCapabilityRecord',
  'updateCapabilityRepositoriesRecord',
  'updateWorkspaceSettings',
] as const;

const TOOL_PLANE_REPOSITORY_EXPORTS = [
  'acceptWorkItemHandoffPacketRecord',
  'createWorkItemHandoffPacketRecord',
  'getCapabilityArtifact',
  'getCapabilityArtifactFileBytes',
  'getCapabilityArtifactFileMeta',
  'getWorkItemExecutionContextRecord',
  'initializeWorkItemExecutionContextRecord',
  'listWorkItemCodePatchArtifacts',
  'listWorkItemHandoffPacketsRecord',
  'releaseWorkItemCodeClaimRecord',
  'updateWorkItemBranchRecord',
  'upsertWorkItemCheckoutSessionRecord',
  'upsertWorkItemCodeClaimRecord',
] as const;

const MODEL_POLICY_REPOSITORY_EXPORTS = [
  'getPolicyTemplates',
  'seedPolicyTemplates',
] as const;

describe('modular-monolith boundaries', () => {
  it('keeps server/index.ts as a thin composition root', () => {
    const source = readProjectFile('server/index.ts');
    expect(source.split('\n').length).toBeLessThanOrEqual(25);
    expect(source).not.toMatch(/register[A-Za-z]+Routes/);
    expect(source).not.toMatch(/express\.json/);
    expect(source).toMatch(/buildApp/);
    expect(source).toMatch(/startServer/);
  });

  it('keeps app-layer files off legacy client utility imports', () => {
    const files = listTypescriptFiles('server/app');
    expect(files.length).toBeGreaterThan(0);
    files.forEach(expectNoLegacyClientImports);
  });

  it('keeps ports independent from client implementation layers', () => {
    const files = listTypescriptFiles('server/ports');
    expect(files.length).toBeGreaterThan(0);
    files.forEach(expectNoLegacyClientImports);
  });

  it('keeps shared contracts independent from server implementation code', () => {
    const files = listTypescriptFiles('src/contracts');
    expect(files.length).toBeGreaterThan(0);
    files.forEach(filePath => {
      const source = readProjectFile(filePath);
      expect(source).not.toMatch(/from ['"].*server\//);
      expect(source).not.toMatch(/src\/lib\//);
    });
  });

  it('tracks declared modular domains to real entrypoints', () => {
    MODULAR_DOMAIN_BOUNDARIES.forEach((boundary: ModularDomainBoundary) => {
      boundary.publicEntrypoints.forEach(entrypoint => {
        expect(fs.existsSync(path.resolve(projectRoot, entrypoint))).toBe(true);
      });
    });
  });

  it('keeps route files on domain entrypoints instead of repository shortcuts', () => {
    const files = listTypescriptFiles('server/routes');
    expect(files.length).toBeGreaterThan(0);

    files.forEach(filePath => {
      const source = readProjectFile(filePath);
      expect(
        source,
        `${filePath} should not import server/repository.ts directly`,
      ).not.toMatch(/from\s*['"]\.\.\/repository['"]/);
      expect(
        source,
        `${filePath} should use a domain entrypoint instead of a deep domain repository path`,
      ).not.toMatch(/domains\/[^'"]+\/repository['"]/);
    });
  });

  it('routes Self-Service repository access through the domain repository surface', () => {
    const files = listTypescriptFiles('server').filter(filePath => {
      if (filePath === 'server/repository.ts') return false;
      if (filePath === 'server/domains/self-service/repository.ts') return false;
      return true;
    });

    for (const filePath of files) {
      const source = readProjectFile(filePath);
      if (!source.includes('repository')) continue;
      const importStatements = [...source.matchAll(/import[\s\S]*?;/gm)].map(match => match[0]);
      const legacyRepositoryImports = importStatements.filter(statement =>
        /from\s*['"](?:\.\.\/repository|\.\/repository|\.\.\/\.\.\/repository)['"]\s*;/.test(
          statement,
        ),
      );
      if (legacyRepositoryImports.length === 0) {
        continue;
      }

      for (const exportName of SELF_SERVICE_REPOSITORY_EXPORTS) {
        for (const statement of legacyRepositoryImports) {
          expect(
            statement,
            `${filePath} should use the self-service repository boundary for ${exportName}`,
          ).not.toMatch(new RegExp(`\\b${exportName}\\b`));
        }
      }
    }
  });

  it('routes Tool Plane and Model Policy repository access through domain entrypoints', () => {
    const files = listTypescriptFiles('server').filter(filePath => {
      if (filePath === 'server/repository.ts') return false;
      if (filePath === 'server/domains/tool-plane/repository.ts') return false;
      if (filePath === 'server/domains/model-policy/repository.ts') return false;
      return true;
    });

    for (const filePath of files) {
      const source = readProjectFile(filePath);
      if (!source.includes('repository')) continue;
      const importStatements = [...source.matchAll(/import[\s\S]*?;/gm)].map(match => match[0]);
      const legacyRepositoryImports = importStatements.filter(statement =>
        /from\s*['"](?:\.\.\/repository|\.\/repository|\.\.\/\.\.\/repository)['"]\s*;/.test(
          statement,
        ),
      );
      if (legacyRepositoryImports.length === 0) {
        continue;
      }

      for (const exportName of [...TOOL_PLANE_REPOSITORY_EXPORTS, ...MODEL_POLICY_REPOSITORY_EXPORTS]) {
        for (const statement of legacyRepositoryImports) {
          expect(
            statement,
            `${filePath} should use the owning domain boundary for ${exportName}`,
          ).not.toMatch(new RegExp(`\\b${exportName}\\b`));
        }
      }
    }
  });

  it('keeps architecture hotspots from growing beyond the migration baseline', () => {
    // Caps lifted on 2026-04-30 by the LLM-context fixes:
    //   - repository.ts: +3  (B.4 hidden-message column wiring + tool-history persistence)
    //   - githubModels.ts: +84 (Section C in-process prompt-fragment cache + telemetry)
    //   - src/types.ts: +34  (D.1 Copilot CLI provider key, D.2 selfManagesContext flag,
    //                          B.4 hidden message field)
    // Caps lifted on 2026-05-01 by the per-agent session-memory slice:
    //   - execution/service.ts: +70 (shared execution continuity + session-memory persistence
    //                                pending the planned execution-core extraction)
    //   - src/types.ts: +64 (agent session memory + LLM context envelope contracts)
    expect(countLines('server/index.ts')).toBeLessThanOrEqual(22);
    expect(countLines('src/App.tsx')).toBeLessThanOrEqual(172);
    expect(countLines('server/repository.ts')).toBeLessThanOrEqual(4290);
    expect(countLines('server/execution/service.ts')).toBeLessThanOrEqual(9020);
    expect(countLines('server/githubModels.ts')).toBeLessThanOrEqual(3705);
    expect(countLines('src/lib/api.ts')).toBeLessThanOrEqual(3520);
    expect(countLines('src/pages/Orchestrator.tsx')).toBeLessThanOrEqual(7184);
    expect(countLines('src/pages/WorkflowStudio.tsx')).toBeLessThanOrEqual(8638);
    expect(countLines('src/types.ts')).toBeLessThanOrEqual(5840);
  });

  it('keeps architecture ownership docs in place', () => {
    expect(
      fs.existsSync(
        path.resolve(projectRoot, 'docs/architecture/modular-monolith-boundaries.md'),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.resolve(projectRoot, 'docs/architecture/domain-ownership.md')),
    ).toBe(true);
  });
});
