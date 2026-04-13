import type {
  CapabilityDeploymentTarget,
  CapabilityExecutionCommandTemplate,
  WorkspaceBuildTool,
  WorkspaceCommandRecommendation,
  WorkspaceDetectionConfidence,
  WorkspaceStackKind,
} from '../types';

export const formatWorkspaceStackLabel = (stack: WorkspaceStackKind) => {
  switch (stack) {
    case 'NODE':
      return 'Node.js';
    case 'PYTHON':
      return 'Python';
    case 'JAVA':
      return 'Java';
    default:
      return 'Generic workspace';
  }
};

export const formatWorkspaceBuildToolLabel = (buildTool: WorkspaceBuildTool) => {
  switch (buildTool) {
    case 'NPM':
      return 'npm';
    case 'PNPM':
      return 'pnpm';
    case 'YARN':
      return 'Yarn';
    case 'UV':
      return 'uv';
    case 'POETRY':
      return 'Poetry';
    case 'PIP':
      return 'pip';
    case 'PIPENV':
      return 'Pipenv';
    case 'MAVEN':
      return 'Maven';
    case 'GRADLE':
      return 'Gradle';
    default:
      return 'Unknown';
  }
};

export const formatWorkspaceConfidenceLabel = (
  confidence: WorkspaceDetectionConfidence,
) => `${confidence.slice(0, 1)}${confidence.slice(1).toLowerCase()} confidence`;

export const joinWorkspaceCommand = (command: string[]) => command.join(' ');

const normalizeTemplateShape = (
  template: Pick<
    CapabilityExecutionCommandTemplate,
    'id' | 'label' | 'description' | 'command' | 'workingDirectory' | 'requiresApproval'
  >,
) =>
  JSON.stringify({
    id: template.id,
    label: template.label,
    description: template.description || '',
    command: template.command,
    workingDirectory: template.workingDirectory || '',
    requiresApproval: Boolean(template.requiresApproval),
  });

const normalizeTargetShape = (
  target: Pick<
    CapabilityDeploymentTarget,
    'id' | 'label' | 'description' | 'commandTemplateId' | 'workspacePath'
  >,
) =>
  JSON.stringify({
    id: target.id,
    label: target.label,
    description: target.description || '',
    commandTemplateId: target.commandTemplateId,
    workspacePath: target.workspacePath || '',
  });

export const hasAppliedWorkspaceRecommendations = ({
  currentTemplates,
  currentTargets,
  recommendedTemplates,
  recommendedTargets,
}: {
  currentTemplates: CapabilityExecutionCommandTemplate[];
  currentTargets: CapabilityDeploymentTarget[];
  recommendedTemplates: WorkspaceCommandRecommendation[];
  recommendedTargets: CapabilityDeploymentTarget[];
}) => {
  if (recommendedTemplates.length === 0 && recommendedTargets.length === 0) {
    return false;
  }

  if (
    currentTemplates.length !== recommendedTemplates.length ||
    currentTargets.length !== recommendedTargets.length
  ) {
    return false;
  }

  const currentTemplateSet = new Set(
    currentTemplates.map(template => normalizeTemplateShape(template)),
  );
  const currentTargetSet = new Set(
    currentTargets.map(target => normalizeTargetShape(target)),
  );

  return (
    recommendedTemplates.every(template =>
      currentTemplateSet.has(normalizeTemplateShape(template)),
    ) &&
    recommendedTargets.every(target =>
      currentTargetSet.has(normalizeTargetShape(target)),
    )
  );
};
