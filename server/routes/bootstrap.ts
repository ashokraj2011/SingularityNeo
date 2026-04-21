import fs from 'node:fs';
import type express from 'express';
import type {
  CapabilityDeploymentTarget,
  CapabilityExecutionCommandTemplate,
  WorkspaceDatabaseBootstrapProfileSnapshot,
  WorkspaceDatabaseBootstrapResult,
} from '../../src/types';
import { sendApiError } from '../api/errors';
import { inspectDatabaseBootstrapStatus, query, setDatabaseRuntimeConfig } from '../db';
import {
  findMatchingWorkspaceDatabaseBootstrapProfile,
  resolveActiveWorkspaceDatabaseBootstrapProfileId,
  upsertWorkspaceDatabaseBootstrapProfile,
} from '../databaseProfiles';
import { getCapabilityBundle } from '../repository';
import {
  getCapabilityWorkspaceRoots,
  isWorkspacePathApproved,
  normalizeDirectoryPath,
} from '../workspacePaths';
import {
  detectCapabilityWorkspaceProfile,
  detectWorkspaceProfile,
} from '../workspaceProfile';

type BootstrapRouteDeps = {
  bootstrapWorkspaceDatabaseAndStandards: () => Promise<WorkspaceDatabaseBootstrapResult>;
  getDatabaseBootstrapProfileSnapshot: () => Promise<WorkspaceDatabaseBootstrapProfileSnapshot>;
  persistDatabaseBootstrapProfileSnapshot: (
    snapshot: WorkspaceDatabaseBootstrapProfileSnapshot,
  ) => Promise<void>;
};

const parseUrl = (value: string) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const validateConnectorUrl = ({
  connector,
  value,
}: {
  connector: 'GITHUB' | 'JIRA' | 'CONFLUENCE';
  value: string;
}) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return {
      connector,
      value,
      valid: true,
      message: `${connector.toLowerCase()} connector is optional for onboarding.`,
    };
  }

  const parsed = parseUrl(trimmed);
  if (!parsed || !['http:', 'https:', 'ssh:'].includes(parsed.protocol)) {
    return {
      connector,
      value,
      valid: false,
      message: 'Use a valid http(s) or ssh URL.',
    };
  }

  const normalizedHost = parsed.hostname.toLowerCase();
  const connectorLooksRight =
    connector === 'GITHUB'
      ? /github|git|bitbucket|azure|devops|gitlab/.test(normalizedHost) ||
        trimmed.endsWith('.git')
      : connector === 'JIRA'
        ? /jira|atlassian/.test(normalizedHost)
        : /confluence|atlassian/.test(normalizedHost);

  return {
    connector,
    value,
    valid: connectorLooksRight,
    message: connectorLooksRight
      ? `${connector.toLowerCase()} link looks valid.`
      : `This URL does not look like a ${connector.toLowerCase()} connector.`,
  };
};

const validateCommandTemplatePayload = ({
  template,
  existingTemplateIds = [],
  allowedWorkspacePaths = [],
}: {
  template?: Partial<CapabilityExecutionCommandTemplate>;
  existingTemplateIds?: string[];
  allowedWorkspacePaths?: string[];
}) => {
  const issues: string[] = [];
  const templateId = String(template?.id || '').trim();

  if (!templateId) {
    issues.push('Template id is required.');
  }
  if (!String(template?.label || '').trim()) {
    issues.push('Template label is required.');
  }
  if (!Array.isArray(template?.command) || template.command.length === 0) {
    issues.push('Command must contain at least one token.');
  }
  if (
    templateId &&
    existingTemplateIds.filter(id => id === templateId).length > 1
  ) {
    issues.push(`Template id ${templateId} is duplicated.`);
  }
  if (
    template?.workingDirectory &&
    allowedWorkspacePaths.length > 0 &&
    !isWorkspacePathApproved(template.workingDirectory, allowedWorkspacePaths)
  ) {
    issues.push('Working directory must be inside an approved workspace path.');
  }

  return {
    templateId: templateId || 'unassigned',
    valid: issues.length === 0,
    issues,
    message:
      issues.length === 0
        ? 'Command template is ready.'
        : 'Command template needs attention.',
  };
};

const validateDeploymentTargetPayload = ({
  target,
  commandTemplates = [],
  allowedWorkspacePaths = [],
}: {
  target?: Partial<CapabilityDeploymentTarget>;
  commandTemplates?: CapabilityExecutionCommandTemplate[];
  allowedWorkspacePaths?: string[];
}) => {
  const issues: string[] = [];
  const targetId = String(target?.id || '').trim();

  if (!targetId) {
    issues.push('Deployment target id is required.');
  }
  if (!String(target?.label || '').trim()) {
    issues.push('Deployment target label is required.');
  }
  if (!target?.commandTemplateId) {
    issues.push('A command template is required.');
  } else if (!commandTemplates.some(template => template.id === target.commandTemplateId)) {
    issues.push(`Command template ${target.commandTemplateId} was not found.`);
  }
  if (
    target?.workspacePath &&
    allowedWorkspacePaths.length > 0 &&
    !isWorkspacePathApproved(target.workspacePath, allowedWorkspacePaths)
  ) {
    issues.push('Deployment workspace path must be inside an approved workspace path.');
  }

  return {
    targetId: targetId || 'unassigned',
    valid: issues.length === 0,
    issues,
    message:
      issues.length === 0
        ? 'Deployment target is ready.'
        : 'Deployment target needs attention.',
  };
};

export const registerBootstrapRoutes = (
  app: express.Express,
  {
    bootstrapWorkspaceDatabaseAndStandards,
    getDatabaseBootstrapProfileSnapshot,
    persistDatabaseBootstrapProfileSnapshot,
  }: BootstrapRouteDeps,
) => {
  app.get('/api/health', async (_request, response) => {
    try {
      await query('SELECT 1');
      response.json({ status: 'ok', db: 'ok', ts: new Date().toISOString() });
    } catch {
      response
        .status(503)
        .json({ status: 'degraded', db: 'error', ts: new Date().toISOString() });
    }
  });

  app.post('/api/onboarding/validate-connectors', (request, response) => {
    const body = request.body as {
      githubRepositories?: string[];
      jiraBoardLink?: string;
      confluenceLink?: string;
    };
    const items = [
      ...(body.githubRepositories || []).map(value =>
        validateConnectorUrl({ connector: 'GITHUB', value }),
      ),
      validateConnectorUrl({ connector: 'JIRA', value: body.jiraBoardLink || '' }),
      validateConnectorUrl({
        connector: 'CONFLUENCE',
        value: body.confluenceLink || '',
      }),
    ].filter(item => item.value.trim() || !item.valid);

    response.json({
      valid: items.every(item => item.valid),
      items,
    });
  });

  app.post('/api/onboarding/validate-workspace-path', async (request, response) => {
    const requestedPath = String(request.body?.path || '').trim();
    const normalizedPath = normalizeDirectoryPath(requestedPath);

    if (!normalizedPath) {
      response.json({
        path: requestedPath,
        valid: false,
        exists: false,
        isDirectory: false,
        readable: false,
        message: 'Workspace path is required.',
      });
      return;
    }

    try {
      const stat = await fs.promises.stat(normalizedPath);
      const isDirectory = stat.isDirectory();
      let readable = false;

      if (isDirectory) {
        await fs.promises.access(normalizedPath, fs.constants.R_OK);
        readable = true;
      }

      response.json({
        path: requestedPath,
        normalizedPath,
        valid: isDirectory && readable,
        exists: true,
        isDirectory,
        readable,
        message:
          isDirectory && readable
            ? 'Workspace path is approved for onboarding.'
            : 'Workspace path exists but is not a readable directory.',
      });
    } catch (error) {
      response.json({
        path: requestedPath,
        normalizedPath,
        valid: false,
        exists: false,
        isDirectory: false,
        readable: false,
        message:
          error instanceof Error
            ? error.message
            : 'Workspace path could not be validated.',
      });
    }
  });

  app.post('/api/onboarding/detect-workspace-profile', (request, response) => {
    const defaultWorkspacePath = String(request.body?.defaultWorkspacePath || '').trim();
    const approvedWorkspacePaths = Array.isArray(request.body?.approvedWorkspacePaths)
      ? request.body.approvedWorkspacePaths
          .map((value: unknown) => String(value || '').trim())
          .filter(Boolean)
      : [];

    response.json(
      detectWorkspaceProfile({
        defaultWorkspacePath,
        workspaceRoots: approvedWorkspacePaths,
      }),
    );
  });

  app.post('/api/onboarding/validate-command-template', (request, response) => {
    response.json(
      validateCommandTemplatePayload({
        template: request.body?.template,
        existingTemplateIds: request.body?.existingTemplateIds || [],
        allowedWorkspacePaths: request.body?.allowedWorkspacePaths || [],
      }),
    );
  });

  app.post('/api/onboarding/validate-deployment-target', (request, response) => {
    response.json(
      validateDeploymentTargetPayload({
        target: request.body?.target,
        commandTemplates: request.body?.commandTemplates || [],
        allowedWorkspacePaths: request.body?.allowedWorkspacePaths || [],
      }),
    );
  });

  app.post(
    '/api/capabilities/:capabilityId/detect-workspace-profile',
    async (request, response) => {
      try {
        const bundle = await getCapabilityBundle(request.params.capabilityId);
        const defaultWorkspacePath = String(request.body?.defaultWorkspacePath || '').trim();
        const approvedWorkspacePaths = Array.isArray(request.body?.approvedWorkspacePaths)
          ? request.body.approvedWorkspacePaths
              .map((value: unknown) => String(value || '').trim())
              .filter(Boolean)
          : [];

        response.json(
          detectCapabilityWorkspaceProfile(bundle.capability, {
            defaultWorkspacePath:
              defaultWorkspacePath || bundle.capability.executionConfig.defaultWorkspacePath,
            workspaceRoots: approvedWorkspacePaths.length
              ? approvedWorkspacePaths
              : getCapabilityWorkspaceRoots(bundle.capability),
          }),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get('/api/bootstrap/database/status', async (_request, response) => {
    try {
      response.json(await inspectDatabaseBootstrapStatus());
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/bootstrap/database/profiles', async (_request, response) => {
    try {
      const [snapshot, status] = await Promise.all([
        getDatabaseBootstrapProfileSnapshot(),
        inspectDatabaseBootstrapStatus(),
      ]);

      response.json({
        ...snapshot,
        activeProfileId:
          resolveActiveWorkspaceDatabaseBootstrapProfileId(snapshot, status.runtime) ||
          snapshot.activeProfileId,
      } satisfies WorkspaceDatabaseBootstrapProfileSnapshot);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/bootstrap/database/setup', async (request, response) => {
    const body = request.body as Partial<{
      host: string;
      port: number;
      databaseName: string;
      user: string;
      adminDatabaseName: string;
      password: string;
    }>;

    const host = String(body.host || '').trim();
    const user = String(body.user || '').trim();
    const databaseName = String(body.databaseName || '').trim();
    const adminDatabaseName = String(body.adminDatabaseName || 'postgres').trim() || 'postgres';
    const port = Number(body.port || 0);

    if (!host || !user || !databaseName || !Number.isFinite(port) || port <= 0) {
      response.status(400).json({
        error: 'Host, port, database name, and user are required to initialize the database.',
      });
      return;
    }

    try {
      const currentProfileSnapshot = await getDatabaseBootstrapProfileSnapshot();
      const matchingSavedProfile = findMatchingWorkspaceDatabaseBootstrapProfile(
        currentProfileSnapshot,
        {
          host,
          port,
          databaseName,
          user,
          adminDatabaseName,
        },
      );
      const resolvedPassword =
        body.password?.trim() || matchingSavedProfile?.password || undefined;

      await setDatabaseRuntimeConfig({
        host,
        port,
        databaseName,
        user,
        adminDatabaseName,
        ...(resolvedPassword ? { password: resolvedPassword } : {}),
      });
      const bootstrapResult = await bootstrapWorkspaceDatabaseAndStandards();
      const profileSnapshot = upsertWorkspaceDatabaseBootstrapProfile(
        currentProfileSnapshot,
        {
          host,
          port,
          databaseName,
          user,
          adminDatabaseName,
          ...(resolvedPassword ? { password: resolvedPassword } : {}),
        },
        { makeActive: true },
      );
      await persistDatabaseBootstrapProfileSnapshot(profileSnapshot);
      response.json({
        ...bootstrapResult,
        profileSnapshot,
      } satisfies WorkspaceDatabaseBootstrapResult);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/bootstrap/database/profiles/:profileId/activate', async (request, response) => {
    const profileId = String(request.params.profileId || '').trim();
    if (!profileId) {
      response.status(400).json({ error: 'A saved database profile id is required.' });
      return;
    }

    try {
      const currentSnapshot = await getDatabaseBootstrapProfileSnapshot();
      const profile = currentSnapshot.profiles.find(item => item.id === profileId);

      if (!profile) {
        response.status(404).json({ error: `Saved database profile ${profileId} was not found.` });
        return;
      }

      await setDatabaseRuntimeConfig({
        host: profile.host,
        port: profile.port,
        databaseName: profile.databaseName,
        user: profile.user,
        adminDatabaseName: profile.adminDatabaseName,
        ...(profile.password ? { password: profile.password } : {}),
      });

      const bootstrapResult = await bootstrapWorkspaceDatabaseAndStandards();
      const profileSnapshot = upsertWorkspaceDatabaseBootstrapProfile(
        currentSnapshot,
        profile,
        { makeActive: true },
      );
      await persistDatabaseBootstrapProfileSnapshot(profileSnapshot);

      response.json({
        ...bootstrapResult,
        profileSnapshot,
      } satisfies WorkspaceDatabaseBootstrapResult);
    } catch (error) {
      sendApiError(response, error);
    }
  });
};
