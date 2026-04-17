import {
  BUILT_IN_AGENT_TEMPLATES,
  SKILL_LIBRARY,
  getStandardAgentContract,
  getStandardAgentDefaultSkillIds,
  getStandardAgentPreferredToolIds,
} from '../constants';
import {
  createBrokerageCapabilityLifecycle,
  createDefaultCapabilityLifecycle,
} from './capabilityLifecycle';
import {
  BROKERAGE_WORKFLOW_TEMPLATE_ID,
  createBrokerageCapabilityWorkflow,
  createStandardCapabilityWorkflow,
  STANDARD_SDLC_STEP_TEMPLATES,
  STANDARD_WORKFLOW_TEMPLATE_ID,
} from './standardWorkflow';
import type {
  Artifact,
  Capability,
  CapabilityAgent,
  Skill,
  WorkspaceAgentTemplate,
  WorkspaceArtifactTemplate,
  WorkspaceEvalSuiteTemplate,
  WorkspaceFoundationCatalog,
  WorkspaceFoundationSummary,
  WorkspaceToolTemplate,
  WorkspaceWorkflowTemplate,
} from '../types';

type AgentRef = (typeof BUILT_IN_AGENT_TEMPLATES)[number]['key'] | 'OWNER';

type ArtifactSeedRecord = {
  key: string;
  name: string;
  type: string;
  direction: 'INPUT' | 'OUTPUT';
  agentRef: AgentRef;
  agentLabel: string;
  description: string;
  inputs: string[];
  sourceWorkflow: boolean;
  priority: number;
};

const WORKSPACE_TEMPLATE_CAPABILITY = {
  id: 'WORKSPACE-TEMPLATE',
  name: 'Shared Workspace Template',
  specialAgentId: 'AGENT-WORKSPACE-OWNER',
  lifecycle: createDefaultCapabilityLifecycle(),
} as const;

const WORKSPACE_BROKERAGE_TEMPLATE_CAPABILITY = {
  ...WORKSPACE_TEMPLATE_CAPABILITY,
  lifecycle: createBrokerageCapabilityLifecycle(),
} as const;

export const SYSTEM_FOUNDATION_CAPABILITY_ID = 'CAP-SYSTEM-FOUNDATION';
export const SYSTEM_FOUNDATION_CAPABILITY_ROLE = 'FOUNDATION' as const;
export const SYSTEM_FOUNDATION_CAPABILITY_NAME = 'Shared Workspace Foundation';

const slugify = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

const getAgentLabel = (agentRef: AgentRef) =>
  agentRef === 'OWNER'
    ? 'Capability Owning Agent'
    : BUILT_IN_AGENT_TEMPLATES.find(template => template.key === agentRef)?.name ||
      agentRef;

const getArtifactTemplate = (
  name: string,
  description: string,
  inputs: string[],
) =>
  [
    `# ${name}`,
    '',
    '## Purpose',
    description,
    '',
    '## Required Inputs',
    ...(inputs.length > 0 ? inputs.map(item => `- ${item}`) : ['- Add required context here']),
    '',
    '## Summary',
    '- Capture the core decision, output, or evidence.',
    '',
    '## Details',
    '- Add the operational detail, assumptions, and trace notes.',
    '',
    '## Follow-up',
    '- Record owners, next steps, and downstream hand-off expectations.',
  ].join('\n');

export const WORKSPACE_AGENT_TEMPLATES: WorkspaceAgentTemplate[] = [
  {
    id: 'AGENT-TEMPLATE-OWNER',
    key: 'OWNER',
    roleStarterKey: 'OWNER',
    name: 'Capability Owning Agent',
    role: 'Capability Owner',
    objective:
      'Own the end-to-end delivery context for {capabilityName} and coordinate all downstream agents within this capability.',
    systemPrompt:
      'You are the capability owner for {capabilityName}. Ground every decision, workflow, and team action in the capability domain, documentation, and governance context.',
    contract: getStandardAgentContract('OWNER'),
    inputArtifacts: ['Capability charter'],
    outputArtifacts: ['Capability operating model'],
    defaultSkillIds: getStandardAgentDefaultSkillIds('OWNER'),
    preferredToolIds: getStandardAgentPreferredToolIds('OWNER'),
  },
  ...BUILT_IN_AGENT_TEMPLATES.map(template => ({
    id: `AGENT-TEMPLATE-${template.key}`,
    key: template.key,
    roleStarterKey: template.roleStarterKey,
    name: template.name,
    role: template.role,
    objective: template.objective,
    systemPrompt: template.systemPrompt,
    contract: template.contract,
    inputArtifacts: [...template.inputArtifacts],
    outputArtifacts: [...template.outputArtifacts],
    defaultSkillIds: getStandardAgentDefaultSkillIds(template.key),
    preferredToolIds: getStandardAgentPreferredToolIds(template.key),
  })),
];

export const WORKSPACE_EVAL_SUITE_TEMPLATES: WorkspaceEvalSuiteTemplate[] = [
  {
    id: 'EVAL-SUITE-ARCHITECT',
    name: 'Architect Coverage',
    description:
      'Checks workflow design, hand-offs, and capability metadata coverage.',
    agentRole: 'Architect',
    evalType: 'STRUCTURED_OUTPUT',
    enabled: true,
    cases: [
      {
        id: 'EVAL-SUITE-ARCHITECT-CASE-1',
        name: 'Built-in architect exists',
        description: 'The capability should include the Architect built-in agent.',
        input: { agentRole: 'Architect' },
        expected: { exists: true },
      },
      {
        id: 'EVAL-SUITE-ARCHITECT-CASE-2',
        name: 'Architect workflows expose allowed tools',
        description: 'Workflow steps should define explicit tool allowlists.',
        input: { allowedToolsRequired: true },
        expected: { allowlistConfigured: true },
      },
    ],
  },
  {
    id: 'EVAL-SUITE-BA',
    name: 'Business Context Retrieval',
    description:
      'Validates that long-term capability memory returns relevant stakeholder and scope context.',
    agentRole: 'Business Analyst',
    evalType: 'RETRIEVAL',
    enabled: true,
    cases: [
      {
        id: 'EVAL-SUITE-BA-CASE-1',
        name: 'Capability metadata is retrievable',
        description:
          'Searching for the capability name should return a capability profile memory document.',
        input: { queryText: 'capability profile business unit stakeholders' },
        expected: { sourceType: 'CAPABILITY_METADATA' },
      },
    ],
  },
  {
    id: 'EVAL-SUITE-SDLC',
    name: 'Workflow Execution Safety',
    description:
      'Verifies approval gates, hand-off packets, and workflow-managed QA coverage.',
    agentRole: 'Validation',
    evalType: 'WORKFLOW',
    enabled: true,
    cases: [
      {
        id: 'EVAL-SUITE-SDLC-CASE-1',
        name: 'Approval gates are present',
        description:
          'At least one workflow step should require human approval for release-grade activity.',
        input: { requiresApprovalStep: true },
        expected: { stepType: 'HUMAN_APPROVAL' },
      },
      {
        id: 'EVAL-SUITE-SDLC-CASE-2',
        name: 'Workflow hand-offs are defined',
        description:
          'Workflow steps should carry forward phase or agent hand-off metadata.',
        input: { requiresHandoff: true },
        expected: { hasHandoff: true },
      },
    ],
  },
];

export const WORKSPACE_TOOL_TEMPLATES: WorkspaceToolTemplate[] = [
  {
    id: 'TOOL-TEMPLATE-WORKSPACE-LIST',
    toolId: 'workspace_list',
    label: 'Workspace List',
    description: 'List files inside an approved workspace path.',
    category: 'Workspace',
    requiresApproval: false,
  },
  {
    id: 'TOOL-TEMPLATE-WORKSPACE-READ',
    toolId: 'workspace_read',
    label: 'Workspace Read',
    description: 'Read a text file from an approved workspace path.',
    category: 'Workspace',
    requiresApproval: false,
  },
  {
    id: 'TOOL-TEMPLATE-WORKSPACE-SEARCH',
    toolId: 'workspace_search',
    label: 'Workspace Search',
    description: 'Search within an approved workspace for a string or regex pattern.',
    category: 'Search',
    requiresApproval: false,
  },
  {
    id: 'TOOL-TEMPLATE-GIT-STATUS',
    toolId: 'git_status',
    label: 'Git Status',
    description: 'Inspect git status for an approved workspace repository.',
    category: 'Git',
    requiresApproval: false,
  },
  {
    id: 'TOOL-TEMPLATE-WORKSPACE-WRITE',
    toolId: 'workspace_write',
    label: 'Workspace Write',
    description: 'Write a text file inside an approved workspace path.',
    category: 'Workspace',
    requiresApproval: true,
  },
  {
    id: 'TOOL-TEMPLATE-WORKSPACE-REPLACE-BLOCK',
    toolId: 'workspace_replace_block',
    label: 'Workspace Replace Block',
    description: 'Safely replace a specific anchored block of text inside an approved workspace path.',
    category: 'Workspace',
    requiresApproval: true,
  },
  {
    id: 'TOOL-TEMPLATE-WORKSPACE-APPLY-PATCH',
    toolId: 'workspace_apply_patch',
    label: 'Workspace Apply Patch',
    description: 'Apply a unified diff patch inside an approved workspace path.',
    category: 'Workspace',
    requiresApproval: true,
  },
  {
    id: 'TOOL-TEMPLATE-DELEGATE-TASK',
    toolId: 'delegate_task',
    label: 'Delegate Task',
    description: 'Delegate a bounded specialist subtask and capture a durable handoff result.',
    category: 'Workspace',
    requiresApproval: false,
  },
  {
    id: 'TOOL-TEMPLATE-RUN-BUILD',
    toolId: 'run_build',
    label: 'Run Build',
    description: 'Run the approved build command template.',
    category: 'Build',
    requiresApproval: false,
  },
  {
    id: 'TOOL-TEMPLATE-RUN-TEST',
    toolId: 'run_test',
    label: 'Run Test',
    description: 'Run the approved test command template.',
    category: 'Test',
    requiresApproval: false,
  },
  {
    id: 'TOOL-TEMPLATE-RUN-DOCS',
    toolId: 'run_docs',
    label: 'Run Docs',
    description: 'Run the approved docs command template.',
    category: 'Docs',
    requiresApproval: false,
  },
  {
    id: 'TOOL-TEMPLATE-RUN-DEPLOY',
    toolId: 'run_deploy',
    label: 'Run Deploy',
    description:
      'Execute an approved deployment target using a named command template after approval.',
    category: 'Deploy',
    requiresApproval: true,
  },
];

export const createWorkspaceWorkflowTemplates = (): WorkspaceWorkflowTemplate[] => {
  const standardWorkflow = createStandardCapabilityWorkflow(
    WORKSPACE_TEMPLATE_CAPABILITY,
  );
  const brokerageWorkflow = createBrokerageCapabilityWorkflow(
    WORKSPACE_BROKERAGE_TEMPLATE_CAPABILITY,
  );

  return [
    {
      id: 'WORKFLOW-TEMPLATE-STANDARD-SDLC',
      templateId: STANDARD_WORKFLOW_TEMPLATE_ID,
      name: standardWorkflow.name,
      summary:
        standardWorkflow.summary ||
        'Standard enterprise SDLC workflow with agent hand-offs, governance validation, and human approval before release.',
      workflowType: standardWorkflow.workflowType,
      scope: 'GLOBAL',
      schemaVersion: standardWorkflow.schemaVersion,
      entryNodeId: standardWorkflow.entryNodeId,
      nodes: standardWorkflow.nodes,
      edges: standardWorkflow.edges,
      steps: standardWorkflow.steps,
      publishState: standardWorkflow.publishState,
    },
    {
      id: 'WORKFLOW-TEMPLATE-BROKERAGE-SDLC',
      templateId: BROKERAGE_WORKFLOW_TEMPLATE_ID,
      name: brokerageWorkflow.name,
      summary:
        brokerageWorkflow.summary ||
        'Brokerage SDLC workflow with multiple entry points and org-specific lifecycle lanes.',
      workflowType: brokerageWorkflow.workflowType,
      scope: 'GLOBAL',
      schemaVersion: brokerageWorkflow.schemaVersion,
      entryNodeId: brokerageWorkflow.entryNodeId,
      nodes: brokerageWorkflow.nodes,
      edges: brokerageWorkflow.edges,
      steps: brokerageWorkflow.steps,
      publishState: brokerageWorkflow.publishState,
    },
  ];
};

const artifactSeeds = (() => {
  const records = new Map<string, ArtifactSeedRecord>();

  const upsertRecord = (record: Omit<ArtifactSeedRecord, 'key'>) => {
    const key = slugify(record.name);
    const existing = records.get(key);
    const nextRecord = { ...record, key };

    if (!existing || nextRecord.priority > existing.priority) {
      records.set(key, nextRecord);
      return;
    }

    if (nextRecord.priority === existing.priority) {
      records.set(key, {
        ...existing,
        inputs: Array.from(new Set([...existing.inputs, ...nextRecord.inputs])),
        description: existing.description || nextRecord.description,
      });
    }
  };

  upsertRecord({
    name: 'Capability Charter',
    type: 'Capability Foundation',
    direction: 'INPUT',
    agentRef: 'OWNER',
    agentLabel: getAgentLabel('OWNER'),
    description:
      'Foundational charter that defines the capability mission, scope, stakeholders, and operating expectations.',
    inputs: [],
    sourceWorkflow: false,
    priority: 50,
  });

  upsertRecord({
    name: 'Capability Operating Model',
    type: 'Capability Foundation',
    direction: 'OUTPUT',
    agentRef: 'OWNER',
    agentLabel: getAgentLabel('OWNER'),
    description:
      'Operating model that aligns the capability owner, downstream agents, and governance context.',
    inputs: ['Capability Charter'],
    sourceWorkflow: false,
    priority: 70,
  });

  for (const template of BUILT_IN_AGENT_TEMPLATES) {
    for (const artifactName of template.inputArtifacts) {
      upsertRecord({
        name: artifactName,
        type: 'Agent Contract',
        direction: 'INPUT',
        agentRef: template.key,
        agentLabel: template.name,
        description: `${template.name} depends on this artifact as an approved starting input.`,
        inputs: [],
        sourceWorkflow: false,
        priority: 40,
      });
    }

    for (const artifactName of template.outputArtifacts) {
      upsertRecord({
        name: artifactName,
        type: 'Agent Contract',
        direction: 'OUTPUT',
        agentRef: template.key,
        agentLabel: template.name,
        description: `${template.name} is expected to publish this artifact as part of its baseline contribution.`,
        inputs: [],
        sourceWorkflow: false,
        priority: 60,
      });
    }
  }

  for (const step of STANDARD_SDLC_STEP_TEMPLATES) {
    const stepAgentLabel = getAgentLabel(step.agentRef);

    for (const artifactName of step.artifactContract.requiredInputs || []) {
      upsertRecord({
        name: artifactName,
        type: 'Workflow Input',
        direction: 'INPUT',
        agentRef: step.agentRef,
        agentLabel: stepAgentLabel,
        description: `Required input for the ${step.name} step.`,
        inputs: [],
        sourceWorkflow: true,
        priority: 30,
      });
    }

    for (const artifactName of step.artifactContract.expectedOutputs || []) {
      upsertRecord({
        name: artifactName,
        type: 'Workflow Output',
        direction: 'OUTPUT',
        agentRef: step.agentRef,
        agentLabel: stepAgentLabel,
        description: step.artifactContract.notes || `Expected output for ${step.name}.`,
        inputs: step.artifactContract.requiredInputs || [],
        sourceWorkflow: true,
        priority: 80,
      });
    }

    if (step.handoffArtifactContract) {
      for (const artifactName of step.handoffArtifactContract.expectedOutputs || []) {
        upsertRecord({
          name: artifactName,
          type: 'Handoff Packet',
          direction: 'OUTPUT',
          agentRef: step.agentRef,
          agentLabel: stepAgentLabel,
          description:
            step.handoffArtifactContract.notes ||
            `Expected handoff packet for ${step.name}.`,
          inputs: step.handoffArtifactContract.requiredInputs || [],
          sourceWorkflow: true,
          priority: 90,
        });
      }
    }
  }

  return Array.from(records.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
})();

export const createWorkspaceArtifactTemplates = (): WorkspaceArtifactTemplate[] =>
  artifactSeeds.map(seed => ({
    id: `ARTIFACT-TEMPLATE-${seed.key}`,
    name: seed.name,
    type: seed.type,
    direction: seed.direction,
    agentLabel: seed.agentLabel,
    description: seed.description,
    inputs: [...seed.inputs],
    template: getArtifactTemplate(seed.name, seed.description, seed.inputs),
    sourceWorkflow: seed.sourceWorkflow,
  }));

export const createDefaultWorkspaceFoundationCatalog = (): WorkspaceFoundationCatalog => ({
  agentTemplates: WORKSPACE_AGENT_TEMPLATES.map(template => ({
    ...template,
    inputArtifacts: [...template.inputArtifacts],
    outputArtifacts: [...template.outputArtifacts],
    defaultSkillIds: [...template.defaultSkillIds],
    preferredToolIds: [...template.preferredToolIds],
  })),
  workflowTemplates: createWorkspaceWorkflowTemplates(),
  evalSuiteTemplates: WORKSPACE_EVAL_SUITE_TEMPLATES.map(template => ({
    ...template,
    cases: template.cases.map(item => ({
      ...item,
      input: { ...item.input },
      expected: { ...item.expected },
    })),
  })),
  skillTemplates: SKILL_LIBRARY.map(
    skill =>
      ({
        ...skill,
        defaultTemplateKeys: [...(skill.defaultTemplateKeys || [])],
      }) satisfies Skill,
  ),
  artifactTemplates: createWorkspaceArtifactTemplates(),
  toolTemplates: WORKSPACE_TOOL_TEMPLATES.map(template => ({
    ...template,
  })),
});

export const createWorkspaceFoundationCapability = (
  foundationCatalog?: WorkspaceFoundationCatalog,
): Capability => {
  const catalog = resolveWorkspaceFoundationCatalog(foundationCatalog);

  return {
    id: SYSTEM_FOUNDATION_CAPABILITY_ID,
    name: SYSTEM_FOUNDATION_CAPABILITY_NAME,
    description:
      'Immutable system capability that materializes the shared workspace standards for agents, workflows, skills, artifacts, and tools.',
    domain: 'Workspace Foundations',
    businessUnit: 'Platform',
    ownerTeam: 'System',
    businessOutcome:
      'Provide one canonical workspace-owned source for shared delivery standards that every capability can inherit from.',
    successMetrics: [
      'All new capabilities inherit a consistent starter set of agents, workflows, skills, and artifacts.',
    ],
    definitionOfDone:
      'Shared standards are materialized and available for inheritance across the workspace.',
    requiredEvidenceKinds: ['Shared workflow templates', 'Shared artifact templates'],
    operatingPolicySummary:
      'This capability is system-managed and read-only. It exists to compensate for capability-scoped persistence while the platform evolves toward stronger workspace-level models.',
    applications: [],
    apis: [],
    databases: [],
    gitRepositories: [],
    localDirectories: [],
    teamNames: ['System'],
    stakeholders: [],
    additionalMetadata: [],
    lifecycle: createDefaultCapabilityLifecycle(),
    executionConfig: {
      defaultWorkspacePath: undefined,
      allowedWorkspacePaths: [],
      commandTemplates: [],
      deploymentTargets: [],
    },
    status: 'STABLE',
    isSystemCapability: true,
    systemCapabilityRole: SYSTEM_FOUNDATION_CAPABILITY_ROLE,
    skillLibrary: mergeCapabilitySkillLibrary([], catalog),
  };
};

export const isSystemFoundationCapability = (
  capability?: Pick<Capability, 'id' | 'isSystemCapability' | 'systemCapabilityRole'> | null,
) =>
  Boolean(
    capability &&
      capability.id === SYSTEM_FOUNDATION_CAPABILITY_ID &&
      capability.isSystemCapability &&
      capability.systemCapabilityRole === SYSTEM_FOUNDATION_CAPABILITY_ROLE,
  );

const resolveWorkspaceFoundationCatalog = (
  catalog?: WorkspaceFoundationCatalog,
): WorkspaceFoundationCatalog => {
  const defaults = createDefaultWorkspaceFoundationCatalog();

  if (!catalog) {
    return defaults;
  }

  return {
    ...catalog,
    agentTemplates:
      catalog.agentTemplates.length > 0 ? catalog.agentTemplates : defaults.agentTemplates,
    workflowTemplates:
      catalog.workflowTemplates.length > 0
        ? catalog.workflowTemplates
        : defaults.workflowTemplates,
    evalSuiteTemplates:
      catalog.evalSuiteTemplates.length > 0
        ? catalog.evalSuiteTemplates
        : defaults.evalSuiteTemplates,
    skillTemplates:
      catalog.skillTemplates.length > 0 ? catalog.skillTemplates : defaults.skillTemplates,
    artifactTemplates:
      catalog.artifactTemplates.length > 0
        ? catalog.artifactTemplates
        : defaults.artifactTemplates,
    toolTemplates:
      catalog.toolTemplates.length > 0 ? catalog.toolTemplates : defaults.toolTemplates,
  };
};

export const mergeCapabilitySkillLibrary = (
  skills: Skill[] = [],
  foundationCatalog?: WorkspaceFoundationCatalog,
): Skill[] => {
  const catalog = resolveWorkspaceFoundationCatalog(foundationCatalog);
  const merged = new Map<string, Skill>();

  catalog.skillTemplates.forEach(skill => {
    merged.set(skill.id, {
      ...skill,
      origin: skill.origin || 'FOUNDATION',
      kind: skill.kind || 'CUSTOM',
      contentMarkdown:
        skill.contentMarkdown?.trim() || `# ${skill.name}\n\n${skill.description}`,
      defaultTemplateKeys: [...(skill.defaultTemplateKeys || [])],
    });
  });
  skills.forEach(skill => {
    merged.set(skill.id, {
      ...skill,
      origin: skill.origin || 'CAPABILITY',
      kind: skill.kind || 'CUSTOM',
      contentMarkdown:
        skill.contentMarkdown?.trim() || `# ${skill.name}\n\n${skill.description}`,
      defaultTemplateKeys: [...(skill.defaultTemplateKeys || [])],
    });
  });

  return Array.from(merged.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
};

export const materializeCapabilityStarterArtifacts = ({
  capability,
  agents = [],
  foundationCatalog,
  createdAt,
}: {
  capability: Capability;
  agents?: CapabilityAgent[];
  foundationCatalog?: WorkspaceFoundationCatalog;
  createdAt?: string;
}): Artifact[] => {
  const catalog = resolveWorkspaceFoundationCatalog(foundationCatalog);
  const timestamp = createdAt || new Date().toISOString();

  return catalog.artifactTemplates.map(template => {
    const connectedAgent = agents.find(agent => agent.name === template.agentLabel);

    return {
      id: `ART-${slugify(`${capability.id}-${template.name}`)}`,
      name: template.name,
      capabilityId: capability.id,
      type: template.type,
      inputs: [...template.inputs],
      version: 'starter-template',
      agent: connectedAgent?.name || template.agentLabel,
      created: timestamp,
      template: template.template,
      documentationStatus: 'PENDING',
      isMasterArtifact: true,
      description: template.description,
      direction: template.direction,
      connectedAgentId: connectedAgent?.id,
      summary: template.description,
    } satisfies Artifact;
  });
};

export const summarizeWorkspaceFoundationCatalog = (
  catalog: WorkspaceFoundationCatalog,
): WorkspaceFoundationSummary => {
  const agentTemplateCount = catalog.agentTemplates.length;
  const workflowTemplateCount = catalog.workflowTemplates.length;
  const evalSuiteTemplateCount = catalog.evalSuiteTemplates.length;
  const skillTemplateCount = catalog.skillTemplates.length;
  const artifactTemplateCount = catalog.artifactTemplates.length;
  const toolTemplateCount = catalog.toolTemplates.length;
  const totalTemplateCount =
    agentTemplateCount +
    workflowTemplateCount +
    evalSuiteTemplateCount +
    skillTemplateCount +
    artifactTemplateCount +
    toolTemplateCount;

  return {
    initialized: totalTemplateCount > 0,
    lastInitializedAt: catalog.initializedAt,
    agentTemplateCount,
    workflowTemplateCount,
    evalSuiteTemplateCount,
    skillTemplateCount,
    artifactTemplateCount,
    toolTemplateCount,
    totalTemplateCount,
  };
};
