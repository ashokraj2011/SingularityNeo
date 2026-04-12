import { BUILT_IN_AGENT_TEMPLATES, SKILL_LIBRARY } from '../constants';
import { createDefaultCapabilityLifecycle } from './capabilityLifecycle';
import {
  createStandardCapabilityWorkflow,
  STANDARD_SDLC_STEP_TEMPLATES,
  STANDARD_WORKFLOW_TEMPLATE_ID,
} from './standardWorkflow';
import type {
  Skill,
  WorkspaceAgentTemplate,
  WorkspaceArtifactTemplate,
  WorkspaceEvalSuiteTemplate,
  WorkspaceFoundationCatalog,
  WorkspaceFoundationSummary,
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
    name: 'Capability Owning Agent',
    role: 'Capability Owner',
    objective:
      'Own the end-to-end delivery context for {capabilityName} and coordinate all downstream agents within this capability.',
    systemPrompt:
      'You are the capability owner for {capabilityName}. Ground every decision, workflow, and team action in the capability domain, documentation, and governance context.',
    inputArtifacts: ['Capability charter'],
    outputArtifacts: ['Capability operating model'],
  },
  ...BUILT_IN_AGENT_TEMPLATES.map(template => ({
    id: `AGENT-TEMPLATE-${template.key}`,
    key: template.key,
    name: template.name,
    role: template.role,
    objective: template.objective,
    systemPrompt: template.systemPrompt,
    inputArtifacts: [...template.inputArtifacts],
    outputArtifacts: [...template.outputArtifacts],
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

export const createWorkspaceWorkflowTemplates = (): WorkspaceWorkflowTemplate[] => {
  const standardWorkflow = createStandardCapabilityWorkflow(
    WORKSPACE_TEMPLATE_CAPABILITY,
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
      }) satisfies Skill,
  ),
  artifactTemplates: createWorkspaceArtifactTemplates(),
});

export const summarizeWorkspaceFoundationCatalog = (
  catalog: WorkspaceFoundationCatalog,
): WorkspaceFoundationSummary => {
  const agentTemplateCount = catalog.agentTemplates.length;
  const workflowTemplateCount = catalog.workflowTemplates.length;
  const evalSuiteTemplateCount = catalog.evalSuiteTemplates.length;
  const skillTemplateCount = catalog.skillTemplates.length;
  const artifactTemplateCount = catalog.artifactTemplates.length;
  const totalTemplateCount =
    agentTemplateCount +
    workflowTemplateCount +
    evalSuiteTemplateCount +
    skillTemplateCount +
    artifactTemplateCount;

  return {
    initialized: totalTemplateCount > 0,
    lastInitializedAt: catalog.initializedAt,
    agentTemplateCount,
    workflowTemplateCount,
    evalSuiteTemplateCount,
    skillTemplateCount,
    artifactTemplateCount,
    totalTemplateCount,
  };
};
