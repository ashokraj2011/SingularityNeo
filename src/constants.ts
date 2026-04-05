import { Blueprint, WorkPackage, AgentTask, Artifact, Capability, Skill, Workflow, ExecutionLog, LearningUpdate, WorkItem } from './types';

export const SKILL_LIBRARY: Skill[] = [
  { id: 'SKL-001', name: 'Log Analysis', description: 'Analyze system logs for patterns and anomalies.', category: 'Analysis', version: '1.2.0' },
  { id: 'SKL-002', name: 'Auto-Remediation', description: 'Automatically fix common infrastructure issues.', category: 'Automation', version: '0.9.5' },
  { id: 'SKL-003', name: 'Security Scanning', description: 'Scan artifacts for vulnerabilities.', category: 'Security', version: '2.1.0' },
  { id: 'SKL-004', name: 'Compliance Verification', description: 'Verify artifacts against regulatory frameworks.', category: 'Compliance', version: '1.5.0' },
  { id: 'SKL-005', name: 'Data Normalization', description: 'Transform raw data into canonical formats.', category: 'Data', version: '1.1.0' },
];

export const COPILOT_MODEL_OPTIONS = [
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', profile: 'Lowest cost' },
  { id: 'gpt-4.1', label: 'GPT-4.1', profile: 'Balanced reasoning' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', profile: 'Fast multimodal' },
  { id: 'gpt-4o', label: 'GPT-4o', profile: 'Broader capability' },
] as const;

export const BUILT_IN_AGENT_TEMPLATES = [
  {
    key: 'ARCHITECT',
    name: 'Architect',
    role: 'Architect',
    objective:
      'Shape the target architecture for {capabilityName}, define design guardrails, and keep implementation aligned to platform standards.',
    systemPrompt:
      'You are the Architect agent for {capabilityName}. Lead architecture decisions, integration patterns, and solution governance inside this capability context.',
    inputArtifacts: ['Capability charter', 'Architecture standards'],
    outputArtifacts: ['Architecture blueprint', 'Design decision log'],
  },
  {
    key: 'BUSINESS-ANALYST',
    name: 'Business Analyst',
    role: 'Business Analyst',
    objective:
      'Translate business goals for {capabilityName} into clear requirements, acceptance criteria, and delivery-ready scope.',
    systemPrompt:
      'You are the Business Analyst agent for {capabilityName}. Turn business context into requirements, stories, and measurable outcomes grounded in the capability documentation.',
    inputArtifacts: ['Capability operating model', 'Stakeholder requirements'],
    outputArtifacts: ['Requirements pack', 'Acceptance criteria'],
  },
  {
    key: 'SOFTWARE-DEVELOPER',
    name: 'Software Developer',
    role: 'Software Developer',
    objective:
      'Implement and evolve software for {capabilityName} using the approved design, repo context, and workflow handoffs.',
    systemPrompt:
      'You are the Software Developer agent for {capabilityName}. Work on code, tests, and implementation details while staying inside this capability scope.',
    inputArtifacts: ['Refined stories', 'Technical design'],
    outputArtifacts: ['Code changes', 'Implementation notes'],
  },
  {
    key: 'QA',
    name: 'QA',
    role: 'QA',
    objective:
      'Validate the quality of {capabilityName} deliverables through test design, execution evidence, and defect feedback.',
    systemPrompt:
      'You are the QA agent for {capabilityName}. Focus on functional coverage, regression risk, and release confidence within this capability.',
    inputArtifacts: ['Acceptance criteria', 'Build candidate'],
    outputArtifacts: ['Test evidence', 'Defect report'],
  },
  {
    key: 'DEVOPS',
    name: 'DevOps',
    role: 'DevOps',
    objective:
      'Own automation, environments, release readiness, and operational delivery support for {capabilityName}.',
    systemPrompt:
      'You are the DevOps agent for {capabilityName}. Drive pipeline health, branch hygiene, deployment readiness, and runtime support for this capability.',
    inputArtifacts: ['Deployment plan', 'Infrastructure context'],
    outputArtifacts: ['Release checklist', 'Deployment summary'],
  },
  {
    key: 'VALIDATION',
    name: 'Validation Agent',
    role: 'Validation Agent',
    objective:
      'Perform cross-check validation for {capabilityName} outputs before they are promoted across workflow stages.',
    systemPrompt:
      'You are the Validation Agent for {capabilityName}. Verify that artifacts, decisions, and handoffs satisfy the capability context before downstream use.',
    inputArtifacts: ['Workflow outputs', 'Governance rules'],
    outputArtifacts: ['Validation report', 'Release decision'],
  },
] as const;

export const CAPABILITIES: Capability[] = [
  {
    id: 'CAP-966',
    name: 'Calculator',
    description: 'This is used to calculate numbers',
    domain: 'Utilities',
    applications: [],
    apis: [],
    databases: [],
    gitRepositories: [],
    localDirectories: [],
    teamNames: [],
    stakeholders: [],
    additionalMetadata: [],
    status: 'STABLE',
    specialAgentId: 'AGENT-CALCULATOR-OWNER',
    skillLibrary: [],
  },
];

export const BLUEPRINTS: Blueprint[] = [];

export const WORK_PACKAGES: WorkPackage[] = [];

export const AGENT_TASKS: AgentTask[] = [];

export const WORKFLOWS: Workflow[] = [];

export const EXECUTION_LOGS: ExecutionLog[] = [];

export const LEARNING_UPDATES: LearningUpdate[] = [];

export const ARTIFACTS: Artifact[] = [];

export const WORK_ITEMS: WorkItem[] = [];
