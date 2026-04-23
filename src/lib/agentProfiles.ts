import type {
  AgentEvalProfile,
  AgentMemoryScope,
  AgentQualityBar,
  AgentRolePolicy,
  AgentUserVisibility,
  CapabilityAgent,
  ToolAdapterId,
} from '../types';

type AgentProfileKey =
  | 'OWNER'
  | 'PLANNING'
  | 'BUSINESS-ANALYST'
  | 'ARCHITECT'
  | 'SOFTWARE-DEVELOPER'
  | 'QA'
  | 'DEVOPS'
  | 'VALIDATION'
  | 'EXECUTION-OPS'
  | 'CONTRARIAN-REVIEWER'
  | 'DEFAULT';

type AgentOperatingProfile = {
  rolePolicy: AgentRolePolicy;
  memoryScope: AgentMemoryScope;
  qualityBar: AgentQualityBar;
  evalProfile: AgentEvalProfile;
  userVisibility: AgentUserVisibility;
};

const defaultToolIds = (agent: CapabilityAgent): ToolAdapterId[] => agent.preferredToolIds || [];

const resolveProfileKey = (agent: CapabilityAgent): AgentProfileKey => {
  if (agent.isOwner) {
    return 'OWNER';
  }

  const key = String(agent.roleStarterKey || agent.standardTemplateKey || '').trim();
  if (
    key === 'PLANNING' ||
    key === 'BUSINESS-ANALYST' ||
    key === 'ARCHITECT' ||
    key === 'SOFTWARE-DEVELOPER' ||
    key === 'QA' ||
    key === 'DEVOPS' ||
    key === 'VALIDATION' ||
    key === 'EXECUTION-OPS' ||
    key === 'CONTRARIAN-REVIEWER'
  ) {
    return key;
  }

  return 'DEFAULT';
};

const buildProfile = (agent: CapabilityAgent): AgentOperatingProfile => {
  const toolIds = defaultToolIds(agent);
  const key = resolveProfileKey(agent);

  switch (key) {
    case 'OWNER':
      return {
        rolePolicy: {
          summary: 'Own the capability charter, cross-role routing, and final operating clarity.',
          allowedToolIds: toolIds,
          escalationTriggers: ['Escalate when capability intent, ownership, or release posture is unclear.'],
        },
        memoryScope: {
          summary: 'Capability-wide memory spanning charter, stakeholders, published expectations, and recent delivery state.',
          scopeLabels: ['Capability briefing', 'Owner context', 'Recent work state'],
        },
        qualityBar: {
          label: 'Operating clarity',
          summary: 'Keep direction crisp, assumptions explicit, and downstream teams aligned.',
          checklist: ['Clarify intent', 'Keep ownership explicit', 'Avoid handoff ambiguity'],
        },
        evalProfile: {
          label: 'Coordination quality',
          summary: 'Measures whether work is correctly framed and routed before delivery starts.',
          criteria: ['Outcome clarity', 'Stakeholder alignment', 'Actionable next steps'],
        },
        userVisibility: 'SPECIALIST',
      };
    case 'PLANNING':
      return {
        rolePolicy: {
          summary: 'Analyze the request, shape execution intent, and keep scope honest before build work starts.',
          allowedToolIds: toolIds,
          escalationTriggers: ['Escalate when goals, scope, or dependencies are contradictory.'],
        },
        memoryScope: {
          summary: 'Uses charter, stakeholder notes, linked systems, and prior planning artifacts.',
          scopeLabels: ['Business outcome', 'Stakeholder context', 'Earlier planning outputs'],
        },
        qualityBar: {
          label: 'Decision-ready framing',
          summary: 'Plans should be explicit enough that architecture and implementation can proceed without guessing.',
          checklist: ['Scope is bounded', 'Acceptance is measurable', 'Risks are named'],
        },
        evalProfile: {
          label: 'Planning rigor',
          summary: 'Assesses clarity, completeness, and decision usefulness of the planning output.',
          criteria: ['Milestones are concrete', 'Dependencies are surfaced', 'Tradeoffs are explicit'],
        },
        userVisibility: 'SPECIALIST',
      };
    case 'BUSINESS-ANALYST':
      return {
        rolePolicy: {
          summary: 'Turn business context into requirements, acceptance logic, and scope language teams can execute.',
          allowedToolIds: toolIds,
          escalationTriggers: ['Escalate when requirements conflict with business outcome or evidence expectations.'],
        },
        memoryScope: {
          summary: 'Uses business goals, stakeholder requirements, contracts, and delivery evidence.',
          scopeLabels: ['Requirements memory', 'Outcome contract', 'Stakeholder input'],
        },
        qualityBar: {
          label: 'Requirement fidelity',
          summary: 'Requirements should be testable, non-ambiguous, and traceable to business value.',
          checklist: ['Acceptance criteria exist', 'Language is testable', 'Value is explicit'],
        },
        evalProfile: {
          label: 'Requirement quality',
          summary: 'Measures clarity and downstream usefulness of requirements artifacts.',
          criteria: ['Clear acceptance criteria', 'Traceability to outcome', 'Low ambiguity'],
        },
        userVisibility: 'SPECIALIST',
      };
    case 'ARCHITECT':
      return {
        rolePolicy: {
          summary: 'Constrain solution shape, integration patterns, and engineering guardrails before writing begins.',
          allowedToolIds: toolIds,
          escalationTriggers: ['Escalate when design conflicts with platform policy or service boundaries.'],
        },
        memoryScope: {
          summary: 'Draws from architecture context, dependency contracts, and system boundaries.',
          scopeLabels: ['Architecture context', 'Dependency contracts', 'Boundary signals'],
        },
        qualityBar: {
          label: 'Design integrity',
          summary: 'Design outputs should reduce implementation risk and preserve system coherence.',
          checklist: ['Guardrails are explicit', 'Dependencies are mapped', 'Design decisions are recorded'],
        },
        evalProfile: {
          label: 'Architecture quality',
          summary: 'Assesses whether design choices are internally consistent and executable.',
          criteria: ['Decision trace exists', 'Integration impacts are named', 'Constraints are actionable'],
        },
        userVisibility: 'SPECIALIST',
      };
    case 'SOFTWARE-DEVELOPER':
      return {
        rolePolicy: {
          summary: 'Implement inside the current desktop-user workspace mapping, stay inside the workflow boundary, and produce reviewable code evidence.',
          allowedToolIds: toolIds,
          escalationTriggers: ['Escalate when code changes need paths outside the desktop workspace mapping, unsafe writes, or missing design inputs.'],
        },
        memoryScope: {
          summary: 'Uses current work-item context, desktop workspace knowledge, code evidence, and prior attempts.',
          scopeLabels: ['Current work item', 'Workspace context', 'Code and test evidence'],
        },
        qualityBar: {
          label: 'Implementation safety',
          summary: 'Changes should be minimal, reviewable, and backed by build or test proof where possible.',
          checklist: ['Implementation is scoped', 'Diff is reviewable', 'Verification evidence exists'],
        },
        evalProfile: {
          label: 'Implementation quality',
          summary: 'Measures delivery usefulness, correctness signals, and test or build backing.',
          criteria: ['Change intent is clear', 'Tests/builds support it', 'Notes explain residual risk'],
        },
        userVisibility: 'SPECIALIST',
      };
    case 'QA':
      return {
        rolePolicy: {
          summary: 'Exercise the delivered behavior, surface quality risk, and convert testing into evidence teams can trust.',
          allowedToolIds: toolIds,
          escalationTriggers: ['Escalate when coverage, regression risk, or defect posture is unclear.'],
        },
        memoryScope: {
          summary: 'Uses acceptance criteria, prior failures, test evidence, and release readiness context.',
          scopeLabels: ['Acceptance criteria', 'Validation evidence', 'Failure history'],
        },
        qualityBar: {
          label: 'Evidence quality',
          summary: 'Quality findings should explain coverage, residual risk, and confidence honestly.',
          checklist: ['Coverage is explained', 'Risk is explicit', 'Evidence is reproducible'],
        },
        evalProfile: {
          label: 'Validation quality',
          summary: 'Assesses coverage depth, risk articulation, and evidence usefulness.',
          criteria: ['Coverage is stated', 'Risk posture is explicit', 'Evidence is actionable'],
        },
        userVisibility: 'SPECIALIST',
      };
    case 'DEVOPS':
      return {
        rolePolicy: {
          summary: 'Own release automation, environment readiness, and operational safety around the work item.',
          allowedToolIds: toolIds,
          escalationTriggers: ['Escalate when deployment paths, branch hygiene, or environment readiness is unsafe.'],
        },
        memoryScope: {
          summary: 'Uses runtime config, deployment targets, branch state, and execution telemetry.',
          scopeLabels: ['Runtime setup', 'Deployment targets', 'Telemetry history'],
        },
        qualityBar: {
          label: 'Release safety',
          summary: 'Operational actions should preserve rollback, traceability, and approval safety.',
          checklist: ['Targets are approved', 'Branch state is clear', 'Rollback thinking is present'],
        },
        evalProfile: {
          label: 'Operational quality',
          summary: 'Assesses release readiness and operational risk management.',
          criteria: ['Environment readiness', 'Approval alignment', 'Operational safety'],
        },
        userVisibility: 'SPECIALIST',
      };
    case 'VALIDATION':
      return {
        rolePolicy: {
          summary: 'Cross-check whether artifacts, decisions, and handoffs actually satisfy the capability contract.',
          allowedToolIds: toolIds,
          escalationTriggers: ['Escalate when outputs and governance evidence disagree materially.'],
        },
        memoryScope: {
          summary: 'Uses artifacts, approvals, release evidence, and handoff packets for cross-checking.',
          scopeLabels: ['Artifacts', 'Approval evidence', 'Handoff context'],
        },
        qualityBar: {
          label: 'Promotion integrity',
          summary: 'Only promote outputs that meet both workflow and evidence expectations.',
          checklist: ['Required artifacts exist', 'Evidence supports the claim', 'Handoff is complete'],
        },
        evalProfile: {
          label: 'Promotion quality',
          summary: 'Measures whether outputs are actually ready to move downstream.',
          criteria: ['Artifacts are complete', 'Evidence is coherent', 'No silent gaps remain'],
        },
        userVisibility: 'SPECIALIST',
      };
    case 'CONTRARIAN-REVIEWER':
      return {
        rolePolicy: {
          summary: 'Challenge assumptions, surface hidden risk, and stress-test blocked decisions without taking over operator authority.',
          allowedToolIds: toolIds,
          escalationTriggers: ['Escalate when evidence is thin or a risky assumption is being normalized.'],
        },
        memoryScope: {
          summary: 'Uses conflict history, prior attempts, evidence gaps, and release risk context.',
          scopeLabels: ['Conflict history', 'Evidence gaps', 'Risk posture'],
        },
        qualityBar: {
          label: 'Adversarial rigor',
          summary: 'A good contrarian review should increase safety and clarity, not just add noise.',
          checklist: ['Assumptions are challenged', 'Hidden risk is named', 'Safer alternatives are offered'],
        },
        evalProfile: {
          label: 'Risk challenge quality',
          summary: 'Measures whether the review surfaced material blind spots and concrete safer options.',
          criteria: ['Risks are non-trivial', 'Counterarguments are grounded', 'Recommendations are actionable'],
        },
        userVisibility: 'SPECIALIST',
      };
    case 'EXECUTION-OPS':
      return {
        rolePolicy: {
          summary: 'Act as the operator-facing capability copilot for live work, waits, blockers, and next-step clarity.',
          allowedToolIds: toolIds,
          escalationTriggers: ['Escalate when live state is ambiguous or operator intent conflicts with workflow truth.'],
        },
        memoryScope: {
          summary: 'Keeps the broadest live view across the capability briefing, work-item state, waits, logs, timeline, and recent evidence.',
          scopeLabels: ['Capability brain', 'Live execution state', 'Timeline and evidence'],
        },
        qualityBar: {
          label: 'Operational precision',
          summary: 'Every response should be grounded in actual workflow state and end with the smallest next move.',
          checklist: ['State is accurate', 'Next move is precise', 'Workflow truth beats guesswork'],
        },
        evalProfile: {
          label: 'Copilot quality',
          summary: 'Measures whether the copilot clarified state, interpreted signals, and moved work forward safely.',
          criteria: ['Explains current state', 'Interprets waits/logs well', 'Unblocks with clear next steps'],
        },
        userVisibility: 'PRIMARY_COPILOT',
      };
    default:
      return {
        rolePolicy: {
          summary: 'Contribute inside the capability boundary with explicit tool, evidence, and escalation discipline.',
          allowedToolIds: toolIds,
          escalationTriggers: ['Escalate when the capability boundary or workflow expectation is unclear.'],
        },
        memoryScope: {
          summary: 'Uses capability metadata, recent work state, and available artifacts.',
          scopeLabels: ['Capability context', 'Recent work', 'Available evidence'],
        },
        qualityBar: {
          label: 'Execution quality',
          summary: 'Responses should be practical, bounded, and evidence-aware.',
          checklist: ['Stay in scope', 'Be explicit about uncertainty', 'Prefer actionable output'],
        },
        evalProfile: {
          label: 'Execution quality',
          summary: 'Assesses whether the output was safe, useful, and capability-grounded.',
          criteria: ['Grounded output', 'Actionable next steps', 'Appropriate uncertainty'],
        },
        userVisibility: 'SPECIALIST',
      };
  }
};

export const enrichCapabilityAgentProfile = (agent: CapabilityAgent): CapabilityAgent => {
  const profile = buildProfile(agent);
  return {
    ...agent,
    rolePolicy: profile.rolePolicy,
    memoryScope: profile.memoryScope,
    qualityBar: profile.qualityBar,
    evalProfile: profile.evalProfile,
    userVisibility: profile.userVisibility,
  };
};

export const selectPrimaryCopilotAgentId = (agents: CapabilityAgent[]): string | undefined =>
  agents.find(agent => resolveProfileKey(agent) === 'EXECUTION-OPS')?.id ||
  agents.find(agent => agent.isOwner)?.id ||
  agents[0]?.id;
