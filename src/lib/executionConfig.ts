import {
  Capability,
  CapabilityExecutionCommandTemplate,
  CapabilityExecutionConfig,
} from '../types';

const DEFAULT_COMMAND_TEMPLATES: CapabilityExecutionCommandTemplate[] = [
  {
    id: 'build',
    label: 'Build',
    description: 'Compile and package the capability workspace.',
    command: ['npm', 'run', 'build'],
  },
  {
    id: 'test',
    label: 'Test',
    description: 'Execute the configured automated test suite.',
    command: ['npm', 'run', 'test'],
  },
  {
    id: 'docs',
    label: 'Docs',
    description: 'Generate or refresh capability documentation artifacts.',
    command: ['npm', 'run', 'docs'],
  },
];

const cloneCommandTemplate = (
  template: CapabilityExecutionCommandTemplate,
): CapabilityExecutionCommandTemplate => ({
  ...template,
  command: [...template.command],
});

export const normalizeWorkspacePathForComparison = (value?: string | null) =>
  String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');

export const isWorkspacePathInsideApprovedRoot = (
  candidatePath: string | undefined,
  approvedWorkspaceRoots: string[],
) => {
  const candidate = normalizeWorkspacePathForComparison(candidatePath);
  if (!candidate) {
    return false;
  }

  return approvedWorkspaceRoots.some(rootValue => {
    const root = normalizeWorkspacePathForComparison(rootValue);
    return Boolean(root) && (candidate === root || candidate.startsWith(`${root}/`));
  });
};

export const getDefaultExecutionConfig = (
  capability?: Pick<Capability, 'localDirectories'>,
): CapabilityExecutionConfig => {
  const allowedWorkspacePaths = [...(capability?.localDirectories || [])];

  return {
    defaultWorkspacePath: allowedWorkspacePaths[0],
    allowedWorkspacePaths,
    commandTemplates: DEFAULT_COMMAND_TEMPLATES.map(cloneCommandTemplate),
    deploymentTargets: [],
  };
};

export const normalizeExecutionConfig = (
  capability: Pick<Capability, 'localDirectories'>,
  config?: CapabilityExecutionConfig,
): CapabilityExecutionConfig => {
  const defaults = getDefaultExecutionConfig(capability);
  const allowedWorkspacePaths = Array.from(
    new Set([
      ...defaults.allowedWorkspacePaths,
      ...(config?.allowedWorkspacePaths || []),
    ]),
  );

  return {
    defaultWorkspacePath:
      config?.defaultWorkspacePath || defaults.defaultWorkspacePath,
    allowedWorkspacePaths,
    commandTemplates:
      config?.commandTemplates?.length
        ? config.commandTemplates.map(cloneCommandTemplate)
        : defaults.commandTemplates.map(cloneCommandTemplate),
    deploymentTargets: config?.deploymentTargets?.length
      ? config.deploymentTargets.map(target => ({ ...target }))
      : [],
  };
};
