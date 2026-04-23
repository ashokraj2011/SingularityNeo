import {
  Capability,
  CapabilityExecutionCommandTemplate,
  CapabilityExecutionConfig,
} from '../types';

const LEGACY_DEFAULT_COMMAND_TEMPLATES: CapabilityExecutionCommandTemplate[] = [
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

const commandsMatch = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

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

export const isDefaultExecutionCommandTemplatePlaceholder = (
  template: CapabilityExecutionCommandTemplate,
) => {
  const matchingDefault = LEGACY_DEFAULT_COMMAND_TEMPLATES.find(
    defaultTemplate => defaultTemplate.id === template.id,
  );

  if (!matchingDefault) {
    return false;
  }

  return (
    template.label === matchingDefault.label &&
    (template.description || '') === (matchingDefault.description || '') &&
    commandsMatch(template.command, matchingDefault.command) &&
    !template.workingDirectory &&
    template.requiresApproval !== true
  );
};

export const hasMeaningfulExecutionCommandTemplate = (
  templates: CapabilityExecutionCommandTemplate[],
) =>
  templates.some(
    template =>
      Boolean(template.id && template.label && template.command.length > 0) &&
      !isDefaultExecutionCommandTemplatePlaceholder(template),
  );

export const getDefaultExecutionConfig = (
  capability?: Pick<Capability, 'localDirectories'>,
): CapabilityExecutionConfig => {
  const allowedWorkspacePaths = [...(capability?.localDirectories || [])];

  return {
    defaultWorkspacePath: allowedWorkspacePaths[0],
    allowedWorkspacePaths,
    commandTemplates: [],
    deploymentTargets: [],
    tokenOptimization: {
      chatHistoryKeepLastN: 6,
      chatRollupThreshold: 12,
      chatMaxInputTokens: 12_000,
      memoryPromptMaxTokens: 2_200,
      memoryChunkMaxTokens: 350,
      approvalSynthesisMaxInputTokens: 8_000,
      approvalExcerptMaxChars: 420,
    },
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
    tokenOptimization: {
      ...(defaults.tokenOptimization || {}),
      ...(config?.tokenOptimization || {}),
    },
  };
};
