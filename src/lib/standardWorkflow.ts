import { BUILT_IN_AGENT_TEMPLATES } from '../constants';
import {
  Capability,
  ToolAdapterId,
  WorkItemPhase,
  WorkflowArtifactContract,
  Workflow,
  WorkflowEdge,
  WorkflowHandoffProtocol,
  WorkflowNode,
  WorkflowStep,
  WorkflowStepType,
} from '../types';
import {
  buildWorkflowFromGraph,
  createWorkflowEdge,
  createWorkflowNode,
  normalizeWorkflowGraph,
  WORKFLOW_GRAPH_PHASES,
} from './workflowGraph';

type BuiltInAgentKey = (typeof BUILT_IN_AGENT_TEMPLATES)[number]['key'];
type AgentReference = BuiltInAgentKey | 'OWNER';

type StandardWorkflowStepTemplate = {
  key: string;
  name: string;
  phase: Exclude<WorkItemPhase, 'BACKLOG' | 'DONE'>;
  stepType: WorkflowStepType;
  agentRef: AgentReference;
  action: string;
  description: string;
  handoffToAgentRef?: AgentReference;
  handoffToPhase?: WorkItemPhase;
  handoffLabel?: string;
  handoffRules?: string[];
  governanceGate?: string;
  approverRoles?: string[];
  exitCriteria: string[];
  templatePath: string;
  allowedToolIds: ToolAdapterId[];
  preferredWorkspacePath?: string;
  executionNotes?: string;
  artifactContract: WorkflowArtifactContract;
  handoffArtifactContract?: WorkflowArtifactContract;
};

export const SDLC_BOARD_PHASES: WorkItemPhase[] = [
  'BACKLOG',
  'ANALYSIS',
  'DESIGN',
  'DEVELOPMENT',
  'QA',
  'GOVERNANCE',
  'RELEASE',
  'DONE',
];

const slugify = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);

export const getBuiltInAgentId = (capabilityId: string, key: BuiltInAgentKey) =>
  `AGENT-${slugify(capabilityId)}-${key}`;

export const getCapabilityOwnerAgentId = (
  capability: Pick<Capability, 'id' | 'name' | 'specialAgentId'>,
) =>
  capability.specialAgentId ||
  `AGENT-${slugify(capability.name || capability.id || 'CAPABILITY')}-OWNER`;

const getHandoffProtocolId = (capabilityId: string, stepKey: string) =>
  `HANDOFF-${slugify(capabilityId)}-${slugify(stepKey)}`;

const resolveAgentReference = (
  capability: Pick<Capability, 'id' | 'name' | 'specialAgentId'>,
  reference: AgentReference,
) =>
  reference === 'OWNER'
    ? getCapabilityOwnerAgentId(capability)
    : getBuiltInAgentId(capability.id, reference);

const createArtifactContract = (
  requiredInputs: string[],
  expectedOutputs: string[],
  notes: string,
): WorkflowArtifactContract => ({
  requiredInputs,
  expectedOutputs,
  notes,
});

export const STANDARD_SDLC_STEP_TEMPLATES: StandardWorkflowStepTemplate[] = [
  {
    key: 'PLANNING',
    name: 'Planning & Stakeholder Synthesis',
    phase: 'ANALYSIS',
    stepType: 'DELIVERY',
    agentRef: 'PLANNING',
    action: 'Collect stakeholder and capability inputs, align participating agents, and publish the planning report.',
    description:
      'Synthesize stakeholder expectations, capability context, and delivery constraints into a planning report that the rest of the SDLC flow can execute against.',
    handoffToAgentRef: 'BUSINESS-ANALYST',
    handoffToPhase: 'ANALYSIS',
    handoffLabel: 'Planning hand-off to business analysis',
    handoffRules: [
      'Capture stakeholder priorities, dependencies, and milestone expectations before business analysis begins.',
      'Summarize inputs from the capability owner and participating stakeholder-facing agents in one planning packet.',
      'Publish the planning report and milestone view so downstream agents start from a shared execution baseline.',
    ],
    exitCriteria: [
      'Stakeholder inputs consolidated',
      'Planning report published',
      'Milestone assumptions ready for business analysis',
    ],
    templatePath: '/out/steps/planning-step-template.md',
    allowedToolIds: ['workspace_list', 'workspace_read', 'workspace_search'],
    executionNotes:
      'Planning should gather capability metadata, stakeholder inputs, and upstream agent context without modifying source code.',
    artifactContract: createArtifactContract(
      [
        'Capability Charter',
        'Stakeholder Requirements',
        'Capability Operating Model',
        'Cross-Agent Input Briefs',
      ],
      [
        'Planning Report',
        'Delivery Milestone Plan',
        'Stakeholder Alignment Summary',
        'Planning Assumptions Log',
      ],
      'Planning should produce a durable synthesis of stakeholder intent, milestones, and cross-agent expectations before detailed analysis begins.',
    ),
    handoffArtifactContract: createArtifactContract(
      ['Planning Report', 'Delivery Milestone Plan', 'Planning Assumptions Log'],
      ['Analysis Intake Packet', 'Stakeholder Priorities Register'],
      'Package the planning baseline so business analysis starts with agreed priorities, milestones, and assumptions.',
    ),
  },
  {
    key: 'ANALYSIS',
    name: 'Business Analysis',
    phase: 'ANALYSIS',
    stepType: 'DELIVERY',
    agentRef: 'BUSINESS-ANALYST',
    action: 'Refine the story, scope, and acceptance criteria.',
    description:
      'Clarify the business outcome, define acceptance criteria, and prepare the story for architecture review.',
    handoffToAgentRef: 'ARCHITECT',
    handoffToPhase: 'DESIGN',
    handoffLabel: 'Requirements hand-off to architecture',
    handoffRules: [
      'Attach scoped story, dependencies, and acceptance criteria before architecture review.',
      'Document unresolved business assumptions so the architect can raise design risks early.',
      'Auto-publish the analysis summary into the capability documentation trail.',
    ],
    exitCriteria: [
      'Acceptance criteria approved',
      'Dependencies and assumptions documented',
      'Story ready for solution design',
    ],
    templatePath: '/out/steps/analysis-step-template.md',
    allowedToolIds: ['workspace_list', 'workspace_read', 'workspace_search'],
    executionNotes:
      'Ground the analysis in capability documentation and repository context. Do not modify source code in this step.',
    artifactContract: createArtifactContract(
      [
        'Capability Charter',
        'Stakeholder Requirements',
        'Planning Report',
        'Stakeholder Priorities Register',
        'Jira Story Context',
        'Domain Constraints Register',
      ],
      [
        'Requirements Specification',
        'Acceptance Criteria Matrix',
        'Assumptions Log',
        'Dependency Register',
      ],
      'Analysis should produce a review-ready business and scope pack that downstream design can trust.',
    ),
    handoffArtifactContract: createArtifactContract(
      ['Requirements Specification', 'Acceptance Criteria Matrix', 'Assumptions Log', 'Planning Report'],
      ['Architecture Intake Packet', 'Open Questions for Design'],
      'Package the refined story intent and unresolved assumptions for architecture review.',
    ),
  },
  {
    key: 'DESIGN',
    name: 'Solution Design',
    phase: 'DESIGN',
    stepType: 'DELIVERY',
    agentRef: 'ARCHITECT',
    action: 'Create the technical design and implementation guardrails.',
    description:
      'Define the architecture, integration contract, and non-functional expectations before development begins.',
    handoffToAgentRef: 'SOFTWARE-DEVELOPER',
    handoffToPhase: 'DEVELOPMENT',
    handoffLabel: 'Design hand-off to development',
    handoffRules: [
      'Include architecture decisions, repo impact, and implementation guardrails with the hand-off.',
      'Flag any shared component or API changes that require downstream coordination.',
      'Sync design artifacts before development starts so the coding agent sees the latest contract.',
    ],
    exitCriteria: [
      'Architecture approach documented',
      'Interfaces and dependencies reviewed',
      'Engineering approach approved for build',
    ],
    templatePath: '/out/steps/design-step-template.md',
    allowedToolIds: ['workspace_list', 'workspace_read', 'workspace_search', 'git_status'],
    executionNotes:
      'Use repository inspection tools to understand the existing solution shape and produce design guidance before implementation.',
    artifactContract: createArtifactContract(
      [
        'Requirements Specification',
        'Acceptance Criteria Matrix',
        'Architecture Intake Packet',
        'Existing Solution Context',
      ],
      [
        'Solution Design Document',
        'Architecture Decision Log',
        'API and Integration Contract',
        'Implementation Guardrails',
      ],
      'Design should translate business intent into an implementation-ready technical contract.',
    ),
    handoffArtifactContract: createArtifactContract(
      ['Solution Design Document', 'Architecture Decision Log', 'Implementation Guardrails'],
      ['Developer Handoff Packet', 'Build Scope Breakdown'],
      'Give development a precise build plan, contract boundaries, and design decisions.',
    ),
  },
  {
    key: 'DEVELOPMENT',
    name: 'Implementation',
    phase: 'DEVELOPMENT',
    stepType: 'DELIVERY',
    agentRef: 'SOFTWARE-DEVELOPER',
    action: 'Implement the change and prepare it for validation.',
    description:
      'Build the feature, update tests, and produce implementation notes for downstream QA.',
    handoffToAgentRef: 'QA',
    handoffToPhase: 'QA',
    handoffLabel: 'Implementation hand-off to QA',
    handoffRules: [
      'Attach branch details, changed modules, and developer validation evidence.',
      'Record feature toggles, migration steps, and rollback notes for test planning.',
      'Generate implementation notes automatically for QA and release traceability.',
    ],
    exitCriteria: [
      'Code changes completed',
      'Developer checks passed',
      'Build candidate ready for QA',
    ],
    templatePath: '/out/steps/development-step-template.md',
    allowedToolIds: [
      'workspace_list',
      'workspace_read',
      'workspace_search',
      'git_status',
      'workspace_write',
      'run_build',
      'run_test',
    ],
    executionNotes:
      'Implementation can modify files inside capability-approved workspaces and should run build/test validation before completing the step.',
    artifactContract: createArtifactContract(
      [
        'Solution Design Document',
        'Architecture Decision Log',
        'Developer Handoff Packet',
        'Acceptance Criteria Matrix',
      ],
      [
        'Code Change Set',
        'Developer Test Evidence',
        'Implementation Notes',
        'Build Candidate Manifest',
      ],
      'Development should produce both executable change evidence and a clear trace of what was implemented.',
    ),
    handoffArtifactContract: createArtifactContract(
      ['Code Change Set', 'Developer Test Evidence', 'Build Candidate Manifest'],
      ['QA Intake Packet', 'Regression Focus Areas'],
      'Package the build candidate, developer validation, and risk notes for QA.',
    ),
  },
  {
    key: 'QA',
    name: 'Quality Assurance',
    phase: 'QA',
    stepType: 'DELIVERY',
    agentRef: 'QA',
    action: 'Validate the build candidate and collect test evidence.',
    description:
      'Run quality validation, regression checks, and document release readiness for governance review.',
    handoffToAgentRef: 'VALIDATION',
    handoffToPhase: 'GOVERNANCE',
    handoffLabel: 'QA evidence hand-off to validation',
    handoffRules: [
      'Provide regression results, defect disposition, and release recommendation artifacts.',
      'Escalate open defects or known limitations that need governance awareness.',
      'Auto-sync QA evidence to the capability audit trail before governance review.',
    ],
    exitCriteria: [
      'Test evidence attached',
      'Defects triaged or resolved',
      'Release candidate recommended for governance review',
    ],
    templatePath: '/out/steps/qa-step-template.md',
    allowedToolIds: [
      'workspace_list',
      'workspace_read',
      'workspace_search',
      'git_status',
      'run_test',
      'run_docs',
    ],
    executionNotes:
      'QA should execute configured validation commands, summarize the outcome, and capture evidence for downstream governance.',
    artifactContract: createArtifactContract(
      [
        'Build Candidate Manifest',
        'Acceptance Criteria Matrix',
        'QA Intake Packet',
        'Implementation Notes',
      ],
      [
        'Test Execution Report',
        'Defect and Risk Log',
        'Release Recommendation',
        'QA Sign-off Notes',
      ],
      'QA should produce evidence that explains both the verification outcome and remaining risk posture.',
    ),
    handoffArtifactContract: createArtifactContract(
      ['Test Execution Report', 'Defect and Risk Log', 'Release Recommendation'],
      ['Validation Evidence Pack', 'Governance Review Summary'],
      'Move structured evidence and quality posture into governance review.',
    ),
  },
  {
    key: 'GOVERNANCE',
    name: 'Governance Gate',
    phase: 'GOVERNANCE',
    stepType: 'GOVERNANCE_GATE',
    agentRef: 'VALIDATION',
    action: 'Run governance validation and check release controls.',
    description:
      'Validate evidence, policy fit, and hand-off completeness before moving into human approval.',
    handoffToAgentRef: 'OWNER',
    handoffToPhase: 'RELEASE',
    handoffLabel: 'Governance gate hand-off to capability owner',
    handoffRules: [
      'Validation report and required evidence must be attached before human review starts.',
      'Policy exceptions must be called out explicitly for approval awareness.',
      'Publish a governance decision summary automatically when the gate completes.',
    ],
    governanceGate: 'Release Governance Gate',
    approverRoles: ['Development Manager', 'Team Lead'],
    exitCriteria: [
      'Validation report completed',
      'Required evidence attached',
      'Governance gate cleared for approval',
    ],
    templatePath: '/out/steps/governance-gate-template.md',
    allowedToolIds: ['workspace_read', 'workspace_search', 'run_docs'],
    executionNotes:
      'Governance validation should review evidence and produce approval-ready documentation, but it should not perform deployments.',
    artifactContract: createArtifactContract(
      [
        'Validation Evidence Pack',
        'Governance Review Summary',
        'Defect and Risk Log',
        'Release Recommendation',
      ],
      [
        'Governance Assessment',
        'Risk and Control Record',
        'Policy Exception Log',
        'Approval Brief',
      ],
      'Governance must distill all release evidence into an approval-ready control package.',
    ),
    handoffArtifactContract: createArtifactContract(
      ['Governance Assessment', 'Approval Brief', 'Risk and Control Record'],
      ['Human Approval Packet', 'Release Readiness Record'],
      'Prepare the final approval packet with the exact decision context needed by human approvers.',
    ),
  },
  {
    key: 'APPROVAL',
    name: 'Human Approval',
    phase: 'RELEASE',
    stepType: 'HUMAN_APPROVAL',
    agentRef: 'OWNER',
    action: 'Obtain human approval for release promotion.',
    description:
      'Collect final human sign-off and confirm the release decision before handing to DevOps.',
    handoffToAgentRef: 'DEVOPS',
    handoffToPhase: 'RELEASE',
    handoffLabel: 'Approved release hand-off to DevOps',
    handoffRules: [
      'Approval evidence, release window, and rollback owner must be confirmed before deployment.',
      'Manual approvals must capture approver role and timestamp for auditability.',
      'Auto-document the approval decision in the release readiness record.',
    ],
    approverRoles: ['Development Manager', 'Squad Leader', 'Team Lead'],
    exitCriteria: [
      'Human approval captured',
      'Release decision documented',
      'Deployment cleared to proceed',
    ],
    templatePath: '/out/steps/human-approval-template.md',
    allowedToolIds: [],
    executionNotes:
      'This step always pauses for explicit human approval. The backend runner must not auto-complete it.',
    artifactContract: createArtifactContract(
      [
        'Human Approval Packet',
        'Release Readiness Record',
        'Rollback Plan',
        'Release Window Details',
      ],
      [
        'Approval Decision Record',
        'Release Authorization',
        'Approver Comments Log',
      ],
      'Human approval should capture a durable authorization record and any release conditions or comments.',
    ),
    handoffArtifactContract: createArtifactContract(
      ['Release Authorization', 'Approval Decision Record', 'Rollback Plan'],
      ['Deployment Authorization Packet', 'Operational Readiness Notes'],
      'Translate human approval into a deployment-ready hand-off for release execution.',
    ),
  },
  {
    key: 'RELEASE',
    name: 'Release Execution',
    phase: 'RELEASE',
    stepType: 'DELIVERY',
    agentRef: 'DEVOPS',
    action: 'Deploy, verify, and close the release.',
    description:
      'Execute deployment, verify the release, and publish the final operational status.',
    handoffToAgentRef: 'OWNER',
    handoffToPhase: 'DONE',
    handoffLabel: 'Release completion hand-off to capability owner',
    handoffRules: [
      'Deployment verification and post-release checks must be attached before closure.',
      'Operational follow-ups and hypercare notes should be visible to the capability owner.',
      'Publish final release notes automatically when the work item moves to done.',
    ],
    exitCriteria: [
      'Deployment completed',
      'Operational verification passed',
      'Release summary published',
    ],
    templatePath: '/out/steps/release-step-template.md',
    allowedToolIds: ['workspace_read', 'git_status', 'run_deploy', 'run_docs'],
    executionNotes:
      'Release execution can only use capability-configured deployment/doc commands and must remain approval-gated before deployment starts.',
    artifactContract: createArtifactContract(
      [
        'Deployment Authorization Packet',
        'Release Authorization',
        'Deployment Plan',
        'Rollback Plan',
      ],
      [
        'Deployment Summary',
        'Production Verification Report',
        'Release Notes',
        'Hypercare Handoff',
      ],
      'Release execution should leave behind a complete operational record of what was deployed and how it verified.',
    ),
    handoffArtifactContract: createArtifactContract(
      ['Deployment Summary', 'Production Verification Report', 'Release Notes'],
      ['Capability Closure Packet', 'Post-Release Follow-up List'],
      'Close the workflow with a final operational and ownership hand-off back to the capability owner.',
    ),
  },
];

export const createStandardCapabilityWorkflow = (
  capability: Pick<Capability, 'id' | 'name' | 'specialAgentId'>,
): Workflow => {
  const startNodeId = `NODE-${slugify(capability.id)}-START`;
  const endNodeId = `NODE-${slugify(capability.id)}-END`;
  const nodes: WorkflowNode[] = [
    createWorkflowNode({
      id: startNodeId,
      name: 'Start',
      type: 'START',
      phase: 'ANALYSIS',
      description: 'Entry point for the standard SDLC flow.',
      layout: { x: 80, y: 48 },
    }),
    ...STANDARD_SDLC_STEP_TEMPLATES.map((template, index) =>
      createWorkflowNode({
        id: `STEP-${slugify(capability.id)}-${index + 1}`,
        name: template.name,
        type:
          template.stepType === 'GOVERNANCE_GATE'
            ? 'GOVERNANCE_GATE'
            : template.stepType === 'HUMAN_APPROVAL'
            ? 'HUMAN_APPROVAL'
            : template.phase === 'RELEASE'
            ? 'RELEASE'
            : 'DELIVERY',
        phase: template.phase,
        agentId: resolveAgentReference(capability, template.agentRef),
        action: template.action,
        description: template.description,
        inputArtifactId: template.artifactContract.requiredInputs?.[0],
        outputArtifactId: template.artifactContract.expectedOutputs?.[0],
        governanceGate: template.governanceGate,
        approverRoles: template.approverRoles,
        exitCriteria: template.exitCriteria,
        templatePath: template.templatePath,
        allowedToolIds: template.allowedToolIds,
        preferredWorkspacePath: template.preferredWorkspacePath,
        executionNotes: template.executionNotes,
        artifactContract: template.artifactContract,
        layout: {
          x: 80 + (index + 1) * 260,
          y: 48 + WORKFLOW_GRAPH_PHASES.indexOf(template.phase as never) * 176,
        },
      }),
    ),
    createWorkflowNode({
      id: endNodeId,
      name: 'End',
      type: 'END',
      phase: 'RELEASE',
      description: 'Terminal completion node for the workflow.',
      layout: { x: 80 + (STANDARD_SDLC_STEP_TEMPLATES.length + 1) * 260, y: 48 + 5 * 176 },
    }),
  ];

  const handoffProtocols: WorkflowHandoffProtocol[] = STANDARD_SDLC_STEP_TEMPLATES.flatMap(
    template => {
      if (!template.handoffToAgentRef) {
        return [];
      }

      const sourceStep = nodes.find(step => step.name === template.name);
      if (!sourceStep) {
        return [];
      }

      return [
        {
          id: getHandoffProtocolId(capability.id, template.key),
          name: template.handoffLabel || `${template.name} Hand-off`,
          sourceStepId: sourceStep.id,
          sourceNodeId: sourceStep.id,
          targetAgentId: resolveAgentReference(capability, template.handoffToAgentRef),
          targetPhase: template.handoffToPhase,
          description: `Protocol for ${template.name.toLowerCase()} hand-off within ${capability.name}.`,
          rules:
            template.handoffRules?.length ? template.handoffRules : template.exitCriteria,
          validationRequired: true,
          autoDocumentation: true,
        },
      ];
    },
  );

  const edges: WorkflowEdge[] = [];
  const visibleNodes = nodes.filter(node => node.type !== 'START' && node.type !== 'END');

  if (visibleNodes[0]) {
    edges.push(
      createWorkflowEdge({
        fromNodeId: startNodeId,
        toNodeId: visibleNodes[0].id,
        label: 'Begin SDLC delivery',
      }),
    );
  }

  visibleNodes.forEach((node, index) => {
    const template = STANDARD_SDLC_STEP_TEMPLATES[index];
    const nextNode = visibleNodes[index + 1];
    edges.push(
      createWorkflowEdge({
        fromNodeId: node.id,
        toNodeId: nextNode?.id || endNodeId,
        label: template?.handoffLabel || (nextNode ? 'Continue' : 'Complete'),
        handoffProtocolId: template?.handoffToAgentRef
          ? getHandoffProtocolId(capability.id, template.key)
          : undefined,
        artifactContract: template?.handoffArtifactContract,
      }),
    );
  });

  return buildWorkflowFromGraph({
    id: `WF-${slugify(capability.id)}-STANDARD-SDLC`,
    name: 'Enterprise SDLC Flow',
    capabilityId: capability.id,
    status: 'STABLE',
    workflowType: 'SDLC',
    scope: 'CAPABILITY',
    schemaVersion: 2,
    entryNodeId: startNodeId,
    nodes,
    edges,
    summary:
      'Standard SDLC workflow with explicit agent hand-offs, standard input/output document artifacts, governance validation, and human approval before release.',
    steps: [],
    handoffProtocols,
    publishState: 'PUBLISHED',
  });
};

const mergeArtifactContract = (
  current?: WorkflowArtifactContract,
  standard?: WorkflowArtifactContract,
): WorkflowArtifactContract | undefined => {
  if (!current && !standard) {
    return undefined;
  }

  return {
    requiredInputs:
      current?.requiredInputs?.length ? current.requiredInputs : standard?.requiredInputs,
    expectedOutputs:
      current?.expectedOutputs?.length ? current.expectedOutputs : standard?.expectedOutputs,
    notes: current?.notes || standard?.notes,
  };
};

export const applyStandardArtifactsToWorkflow = (
  capability: Pick<Capability, 'id' | 'name' | 'specialAgentId'>,
  workflow: Workflow,
): Workflow => {
  const standardWorkflowId = `WF-${slugify(capability.id)}-STANDARD-SDLC`;
  const isStandardWorkflow =
    workflow.id === standardWorkflowId || workflow.name === 'Enterprise SDLC Flow';

  if (!isStandardWorkflow) {
    return workflow;
  }

  const standardWorkflow = createStandardCapabilityWorkflow(capability);
  const standardNodes = standardWorkflow.nodes || [];
  const workflowNodes = workflow.nodes || [];
  const workflowNodeNamesById = new Map(workflowNodes.map(node => [node.id, node.name]));
  const standardNodesByName = new Map(standardNodes.map(node => [node.name, node]));
  const standardEdgesByName = new Map(
    (standardWorkflow.edges || []).map(edge => {
      const fromName = standardNodes.find(node => node.id === edge.fromNodeId)?.name || edge.fromNodeId;
      const toName = standardNodes.find(node => node.id === edge.toNodeId)?.name || edge.toNodeId;
      return [`${fromName}::${toName}`, edge] as const;
    }),
  );

  const nextNodes = workflowNodes.map(node => {
    const standardNode = standardNodesByName.get(node.name);
    if (!standardNode) {
      return node;
    }

    return {
      ...node,
      inputArtifactId: node.inputArtifactId || standardNode.inputArtifactId,
      outputArtifactId: node.outputArtifactId || standardNode.outputArtifactId,
      artifactContract: mergeArtifactContract(node.artifactContract, standardNode.artifactContract),
    };
  });

  const nextEdges = (workflow.edges || []).map(edge => {
    const fromName = workflowNodeNamesById.get(edge.fromNodeId) || edge.fromNodeId;
    const toName = workflowNodeNamesById.get(edge.toNodeId) || edge.toNodeId;
    const standardEdge = standardEdgesByName.get(`${fromName}::${toName}`);
    if (!standardEdge) {
      return edge;
    }

    return {
      ...edge,
      artifactContract: mergeArtifactContract(edge.artifactContract, standardEdge.artifactContract),
    };
  });

  return buildWorkflowFromGraph(
    normalizeWorkflowGraph({
      ...workflow,
      nodes: nextNodes,
      edges: nextEdges,
      summary:
        workflow.summary ||
        'Standard SDLC workflow with explicit agent hand-offs, standard input/output document artifacts, governance validation, and human approval before release.',
    }),
  );
};

export const getDefaultCapabilityWorkflows = (
  capability: Pick<Capability, 'id' | 'name' | 'specialAgentId'>,
): Workflow[] => [createStandardCapabilityWorkflow(capability)];
