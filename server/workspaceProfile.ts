import fs from 'node:fs';
import path from 'node:path';
import type {
  Capability,
  CapabilityDeploymentTarget,
  WorkspaceBuildTool,
  WorkspaceCommandRecommendation,
  WorkspaceDetectionConfidence,
  WorkspaceDetectionResult,
  WorkspaceStackKind,
  WorkspaceStackProfile,
} from '../src/types';
import { getCapabilityWorkspaceRoots, normalizeDirectoryPath } from './workspacePaths';

type DetectionInput = {
  defaultWorkspacePath?: string;
  workspaceRoots: string[];
};

type RootAnalysis = {
  root?: string;
  profile: WorkspaceStackProfile;
  evidenceFiles: string[];
  recommendedCommandTemplates: WorkspaceCommandRecommendation[];
  recommendedDeploymentTargets: CapabilityDeploymentTarget[];
  score: number;
};

const KNOWN_MANIFESTS = [
  'package.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'pyproject.toml',
  'requirements.txt',
  'setup.py',
  'Pipfile',
  'poetry.lock',
  'uv.lock',
  'pytest.ini',
  'tox.ini',
  'pom.xml',
  'mvnw',
  'build.gradle',
  'build.gradle.kts',
  'gradlew',
] as const;

const fileExists = (absolutePath: string) => {
  try {
    return fs.existsSync(absolutePath);
  } catch {
    return false;
  }
};

const isDirectory = (absolutePath: string) => {
  try {
    return fs.statSync(absolutePath).isDirectory();
  } catch {
    return false;
  }
};

const readText = (absolutePath: string) => {
  try {
    return fs.readFileSync(absolutePath, 'utf8');
  } catch {
    return '';
  }
};

const readJson = <T>(absolutePath: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as T;
  } catch {
    return null;
  }
};

const unique = (items: string[]) => Array.from(new Set(items.filter(Boolean)));

const createGenericProfile = (
  workspacePath?: string,
  summary = 'No clear Node, Python, or Java stack was detected from the approved workspace.',
): WorkspaceStackProfile => ({
  stack: 'GENERIC',
  buildTool: 'UNKNOWN',
  confidence: 'LOW',
  workspacePath,
  summary,
});

const formatStackLabel = (stack: WorkspaceStackKind) => {
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

const formatBuildToolLabel = (buildTool: WorkspaceBuildTool) => {
  switch (buildTool) {
    case 'NPM':
      return 'npm';
    case 'PNPM':
      return 'pnpm';
    case 'YARN':
      return 'yarn';
    case 'UV':
      return 'uv';
    case 'POETRY':
      return 'poetry';
    case 'PIP':
      return 'pip';
    case 'PIPENV':
      return 'pipenv';
    case 'MAVEN':
      return 'Maven';
    case 'GRADLE':
      return 'Gradle';
    default:
      return 'unknown tooling';
  }
};

const withCommand = (
  id: string,
  label: string,
  command: string[],
  description: string,
  workingDirectory?: string,
  rationale?: string,
): WorkspaceCommandRecommendation => ({
  id,
  label,
  command,
  description,
  workingDirectory,
  rationale,
});

const withDeploymentTarget = (
  id: string,
  label: string,
  commandTemplateId: string,
  workspacePath?: string,
  description?: string,
): CapabilityDeploymentTarget => ({
  id,
  label,
  commandTemplateId,
  workspacePath,
  description,
});

const toNodeScriptCommand = (buildTool: WorkspaceBuildTool, scriptName: string) => {
  switch (buildTool) {
    case 'PNPM':
      return ['pnpm', 'run', scriptName];
    case 'YARN':
      return ['yarn', scriptName];
    default:
      return ['npm', 'run', scriptName];
  }
};

const toPythonCommand = (buildTool: WorkspaceBuildTool, parts: string[]) => {
  switch (buildTool) {
    case 'UV':
      return ['uv', 'run', ...parts];
    case 'POETRY':
      if (parts.join(' ') === 'python -m build') {
        return ['poetry', 'build'];
      }
      return ['poetry', 'run', ...parts];
    case 'PIPENV':
      return ['pipenv', 'run', ...parts];
    default:
      return parts;
  }
};

const collectCandidateRoots = (requestedRoots: string[]) => {
  const candidates = new Set<string>();

  for (const requestedRoot of requestedRoots) {
    const normalizedRoot = normalizeDirectoryPath(requestedRoot);
    if (!normalizedRoot || !isDirectory(normalizedRoot)) {
      continue;
    }

    candidates.add(normalizedRoot);

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(normalizedRoot, { withFileTypes: true }).slice(0, 60);
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }

      const childRoot = path.join(normalizedRoot, entry.name);
      if (
        KNOWN_MANIFESTS.some(fileName => fileExists(path.join(childRoot, fileName)))
      ) {
        candidates.add(childRoot);
      }
    }
  }

  return Array.from(candidates);
};

const detectNodeProfile = (root: string, evidenceFiles: string[]): RootAnalysis | null => {
  const packageJsonPath = path.join(root, 'package.json');
  const packageJson = readJson<{ scripts?: Record<string, string> }>(packageJsonPath);
  const lockfiles = {
    pnpm: evidenceFiles.includes('pnpm-lock.yaml'),
    yarn: evidenceFiles.includes('yarn.lock'),
    npm:
      evidenceFiles.includes('package-lock.json') ||
      evidenceFiles.includes('package.json'),
  };

  if (!packageJson && !lockfiles.pnpm && !lockfiles.yarn && !lockfiles.npm) {
    return null;
  }

  const buildTool: WorkspaceBuildTool = lockfiles.pnpm
    ? 'PNPM'
    : lockfiles.yarn
    ? 'YARN'
    : 'NPM';
  const scripts = packageJson?.scripts || {};
  const recommendations: WorkspaceCommandRecommendation[] = [];
  const deploymentTargets: CapabilityDeploymentTarget[] = [];

  if (scripts.build) {
    recommendations.push(
      withCommand(
        'build',
        'Build',
        toNodeScriptCommand(buildTool, 'build'),
        'Run the detected build script from package.json.',
        root,
        'Detected from package.json scripts.',
      ),
    );
  }
  if (scripts.test) {
    recommendations.push(
      withCommand(
        'test',
        'Test',
        toNodeScriptCommand(buildTool, 'test'),
        'Run the detected test script from package.json.',
        root,
        'Detected from package.json scripts.',
      ),
    );
  }
  if (scripts.docs) {
    recommendations.push(
      withCommand(
        'docs',
        'Docs',
        toNodeScriptCommand(buildTool, 'docs'),
        'Run the detected docs script from package.json.',
        root,
        'Detected from package.json scripts.',
      ),
    );
  }

  const deployScript =
    ['deploy', 'release', 'publish'].find(scriptName => Boolean(scripts[scriptName])) || '';
  if (deployScript) {
    recommendations.push(
      withCommand(
        'deploy',
        'Deploy',
        toNodeScriptCommand(buildTool, deployScript),
        `Run the detected ${deployScript} script from package.json.`,
        root,
        'Detected from package.json scripts.',
      ),
    );
    deploymentTargets.push(
      withDeploymentTarget(
        'deploy',
        'Deploy',
        'deploy',
        root,
        'Workspace deployment target inferred from the package.json deploy-style script.',
      ),
    );
  }

  return {
    root,
    profile: {
      stack: 'NODE',
      buildTool,
      confidence: packageJson ? 'HIGH' : 'MEDIUM',
      workspacePath: root,
      summary: `${formatStackLabel('NODE')} project detected with ${formatBuildToolLabel(buildTool)} tooling.`,
    },
    evidenceFiles,
    recommendedCommandTemplates: recommendations,
    recommendedDeploymentTargets: deploymentTargets,
    score: packageJson ? 90 : 70,
  };
};

const detectPythonProfile = (root: string, evidenceFiles: string[]): RootAnalysis | null => {
  const pyprojectText = readText(path.join(root, 'pyproject.toml'));
  const requirementsText = readText(path.join(root, 'requirements.txt'));
  const hasPythonSignals = evidenceFiles.some(file =>
    [
      'pyproject.toml',
      'requirements.txt',
      'setup.py',
      'Pipfile',
      'poetry.lock',
      'uv.lock',
      'pytest.ini',
      'tox.ini',
    ].includes(file),
  );

  if (!hasPythonSignals) {
    return null;
  }

  const buildTool: WorkspaceBuildTool = evidenceFiles.includes('uv.lock')
    ? 'UV'
    : evidenceFiles.includes('poetry.lock') || /\[tool\.poetry\]/i.test(pyprojectText)
    ? 'POETRY'
    : evidenceFiles.includes('Pipfile')
    ? 'PIPENV'
    : 'PIP';

  const recommendations: WorkspaceCommandRecommendation[] = [];
  const hasPytestSignals =
    evidenceFiles.includes('pytest.ini') ||
    evidenceFiles.includes('tox.ini') ||
    /pytest/i.test(pyprojectText) ||
    /(^|\n)\s*pytest([<>=\[]|$)/i.test(requirementsText);
  const hasPackagingSignals =
    evidenceFiles.includes('pyproject.toml') ||
    evidenceFiles.includes('setup.py');

  if (hasPytestSignals) {
    recommendations.push(
      withCommand(
        'test',
        'Test',
        toPythonCommand(buildTool, ['pytest']),
        'Run the detected Python test command.',
        root,
        'Detected from pytest-related project files.',
      ),
    );
  }

  if (hasPackagingSignals) {
    recommendations.push(
      withCommand(
        'build',
        'Build',
        toPythonCommand(buildTool, ['python', '-m', 'build']),
        'Build the detected Python package.',
        root,
        'Detected from packaging files in the workspace.',
      ),
    );
  }

  return {
    root,
    profile: {
      stack: 'PYTHON',
      buildTool,
      confidence:
        evidenceFiles.includes('pyproject.toml') || evidenceFiles.includes('requirements.txt')
          ? 'HIGH'
          : 'MEDIUM',
      workspacePath: root,
      summary: `${formatStackLabel('PYTHON')} project detected with ${formatBuildToolLabel(buildTool)} tooling.`,
    },
    evidenceFiles,
    recommendedCommandTemplates: recommendations,
    recommendedDeploymentTargets: [],
    score:
      evidenceFiles.includes('pyproject.toml') || evidenceFiles.includes('requirements.txt')
        ? 88
        : 72,
  };
};

const detectJavaProfile = (root: string, evidenceFiles: string[]): RootAnalysis | null => {
  const hasMavenSignals =
    evidenceFiles.includes('pom.xml') || evidenceFiles.includes('mvnw');
  const hasGradleSignals =
    evidenceFiles.includes('build.gradle') ||
    evidenceFiles.includes('build.gradle.kts') ||
    evidenceFiles.includes('gradlew');

  if (!hasMavenSignals && !hasGradleSignals) {
    return null;
  }

  if (hasMavenSignals && hasGradleSignals) {
    return {
      root,
      profile: {
        stack: 'GENERIC',
        buildTool: 'UNKNOWN',
        confidence: 'LOW',
        workspacePath: root,
        summary:
          'Both Maven and Gradle signals were found, so the workspace needs manual execution review.',
      },
      evidenceFiles,
      recommendedCommandTemplates: [],
      recommendedDeploymentTargets: [],
      score: 40,
    };
  }

  const buildTool: WorkspaceBuildTool = hasMavenSignals ? 'MAVEN' : 'GRADLE';
  const wrapperCommand =
    buildTool === 'MAVEN'
      ? evidenceFiles.includes('mvnw')
        ? ['./mvnw']
        : ['mvn']
      : evidenceFiles.includes('gradlew')
      ? ['./gradlew']
      : ['gradle'];

  return {
    root,
    profile: {
      stack: 'JAVA',
      buildTool,
      confidence:
        evidenceFiles.includes('pom.xml') ||
        evidenceFiles.includes('build.gradle') ||
        evidenceFiles.includes('build.gradle.kts')
          ? 'HIGH'
          : 'MEDIUM',
      workspacePath: root,
      summary: `${formatStackLabel('JAVA')} project detected with ${formatBuildToolLabel(buildTool)} tooling.`,
    },
    evidenceFiles,
    recommendedCommandTemplates: [
      withCommand(
        'test',
        'Test',
        [...wrapperCommand, 'test'],
        'Run the detected Java test lifecycle command.',
        root,
        'Detected from Java build files in the workspace.',
      ),
      withCommand(
        'build',
        'Build',
        [...wrapperCommand, buildTool === 'MAVEN' ? 'package' : 'build'],
        'Run the detected Java build lifecycle command.',
        root,
        'Detected from Java build files in the workspace.',
      ),
    ],
    recommendedDeploymentTargets: [],
    score:
      evidenceFiles.includes('pom.xml') ||
      evidenceFiles.includes('build.gradle') ||
      evidenceFiles.includes('build.gradle.kts')
        ? 89
        : 74,
  };
};

const analyzeRoot = (root: string): RootAnalysis => {
  const evidenceFiles = KNOWN_MANIFESTS.filter(fileName =>
    fileExists(path.join(root, fileName)),
  );

  const node = detectNodeProfile(root, evidenceFiles as string[]);
  const python = detectPythonProfile(root, evidenceFiles as string[]);
  const java = detectJavaProfile(root, evidenceFiles as string[]);
  const activeProfiles = [node, python, java].filter(Boolean) as RootAnalysis[];

  if (activeProfiles.length === 0) {
    return {
      root,
      profile: createGenericProfile(
        root,
        'No supported Node, Python, or Java manifest files were found in the approved workspace.',
      ),
      evidenceFiles: evidenceFiles as string[],
      recommendedCommandTemplates: [],
      recommendedDeploymentTargets: [],
      score: 0,
    };
  }

  if (activeProfiles.length > 1) {
    return {
      root,
      profile: {
        stack: 'GENERIC',
        buildTool: 'UNKNOWN',
        confidence: 'LOW',
        workspacePath: root,
        summary:
          'Multiple stack signals were found in the same workspace, so execution setup needs manual review.',
      },
      evidenceFiles: evidenceFiles as string[],
      recommendedCommandTemplates: [],
      recommendedDeploymentTargets: [],
      score: 35,
    };
  }

  return activeProfiles[0];
};

export const detectWorkspaceProfile = ({
  defaultWorkspacePath,
  workspaceRoots,
}: DetectionInput): WorkspaceDetectionResult => {
  const requestedPaths = unique(workspaceRoots.map(root => normalizeDirectoryPath(root)));
  const preferredRoot = normalizeDirectoryPath(defaultWorkspacePath);
  const candidateRoots = collectCandidateRoots(
    unique([preferredRoot, ...requestedPaths]).filter(Boolean),
  );

  if (candidateRoots.length === 0) {
    return {
      requestedPaths,
      normalizedPath: preferredRoot || requestedPaths[0],
      profile: createGenericProfile(
        preferredRoot || requestedPaths[0],
        requestedPaths.length === 0
          ? 'No approved workspace path is configured yet.'
          : 'The approved workspace path could not be inspected from the local filesystem.',
      ),
      evidenceFiles: [],
      recommendedCommandTemplates: [],
      recommendedDeploymentTargets: [],
    };
  }

  const analyses = candidateRoots.map(root => analyzeRoot(root));
  const preferredAnalysis = preferredRoot
    ? analyses.find(analysis => analysis.root === preferredRoot && analysis.score > 0)
    : undefined;
  const bestAnalysis =
    preferredAnalysis ||
    analyses.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.root === preferredRoot) {
        return 1;
      }
      if (left.root === preferredRoot) {
        return -1;
      }
      return (right.evidenceFiles.length || 0) - (left.evidenceFiles.length || 0);
    })[0];

  return {
    requestedPaths,
    normalizedPath: bestAnalysis?.root,
    profile: bestAnalysis?.profile || createGenericProfile(preferredRoot || requestedPaths[0]),
    evidenceFiles: bestAnalysis?.evidenceFiles || [],
    recommendedCommandTemplates: bestAnalysis?.recommendedCommandTemplates || [],
    recommendedDeploymentTargets: bestAnalysis?.recommendedDeploymentTargets || [],
  };
};

export const detectCapabilityWorkspaceProfile = (
  capability: Pick<Capability, 'executionConfig' | 'localDirectories'>,
  overrides?: {
    defaultWorkspacePath?: string;
    workspaceRoots?: string[];
  },
) =>
  detectWorkspaceProfile({
    defaultWorkspacePath:
      overrides?.defaultWorkspacePath || capability.executionConfig.defaultWorkspacePath,
    workspaceRoots:
      overrides?.workspaceRoots?.length
        ? overrides.workspaceRoots
        : getCapabilityWorkspaceRoots(capability),
  });

export const buildWorkspaceProfilePromptLines = (
  detection: WorkspaceDetectionResult,
) => {
  const lines = [
    `Detected workspace stack: ${formatStackLabel(detection.profile.stack)}`,
    detection.profile.buildTool !== 'UNKNOWN'
      ? `Detected build tool: ${formatBuildToolLabel(detection.profile.buildTool)}`
      : null,
    `Detection confidence: ${detection.profile.confidence}`,
    detection.normalizedPath ? `Detected workspace root: ${detection.normalizedPath}` : null,
    detection.evidenceFiles.length > 0
      ? `Observed workspace files: ${detection.evidenceFiles.join(', ')}`
      : null,
    detection.recommendedCommandTemplates.length > 0
      ? `Recommended command templates: ${detection.recommendedCommandTemplates
          .map(
            template =>
              `${template.id} => ${template.command.join(' ')}`,
          )
          .join('; ')}`
      : 'Recommended command templates: none inferred yet.',
  ];

  return lines.filter(Boolean) as string[];
};
