import type {
  Capability,
  CapabilityPhaseOwnershipRule,
  CompiledStepOwnership,
  WorkflowPhaseId,
  WorkflowStep,
  WorkflowStepOwnershipRule,
} from '../types';
import { getCapabilityVisibleLifecyclePhases } from './capabilityLifecycle';
import { toWorkspaceTeamId } from './workspaceOrganization';

const trim = (value?: string | null) => String(value || '').trim();

const normalizeTeamIds = (values?: string[] | null) =>
  Array.from(new Set((values || []).map(teamId => trim(teamId)).filter(Boolean)));

export const normalizeCapabilityPhaseOwnershipRules = (
  capability: Pick<Capability, 'lifecycle' | 'ownerTeam' | 'phaseOwnershipRules'>,
): CapabilityPhaseOwnershipRule[] => {
  const visiblePhases = getCapabilityVisibleLifecyclePhases(capability);
  const existing = new Map(
    (capability.phaseOwnershipRules || [])
      .map(rule => ({
        phaseId: trim(rule?.phaseId).toUpperCase(),
        primaryOwnerTeamId: trim(rule?.primaryOwnerTeamId) || undefined,
        secondaryOwnerTeamIds: normalizeTeamIds(rule?.secondaryOwnerTeamIds),
        approvalTeamIds: normalizeTeamIds(rule?.approvalTeamIds),
        escalationTeamIds: normalizeTeamIds(rule?.escalationTeamIds),
      }))
      .filter(rule => rule.phaseId)
      .map(rule => [rule.phaseId, rule] as const),
  );
  const defaultTeamId = trim(capability.ownerTeam)
    ? toWorkspaceTeamId(trim(capability.ownerTeam))
    : undefined;

  return visiblePhases.map(phase => {
    const current = existing.get(phase.id.toUpperCase());
    return {
      phaseId: phase.id,
      primaryOwnerTeamId: current?.primaryOwnerTeamId || defaultTeamId,
      secondaryOwnerTeamIds: current?.secondaryOwnerTeamIds || [],
      approvalTeamIds:
        current?.approvalTeamIds && current.approvalTeamIds.length > 0
          ? current.approvalTeamIds
          : defaultTeamId
          ? [defaultTeamId]
          : [],
      escalationTeamIds:
        current?.escalationTeamIds && current.escalationTeamIds.length > 0
          ? current.escalationTeamIds
          : defaultTeamId
          ? [defaultTeamId]
          : [],
    };
  });
};

export const normalizeWorkflowStepOwnershipRule = (
  rule?: WorkflowStepOwnershipRule | null,
): WorkflowStepOwnershipRule | undefined => {
  if (!rule) {
    return undefined;
  }

  const normalized = {
    primaryOwnerTeamId: trim(rule.primaryOwnerTeamId) || undefined,
    secondaryOwnerTeamIds: normalizeTeamIds(rule.secondaryOwnerTeamIds),
    approvalTeamIds: normalizeTeamIds(rule.approvalTeamIds),
    escalationTeamIds: normalizeTeamIds(rule.escalationTeamIds),
    requireHandoffAcceptance: Boolean(rule.requireHandoffAcceptance),
  } satisfies WorkflowStepOwnershipRule;

  return normalized.primaryOwnerTeamId ||
    normalized.secondaryOwnerTeamIds.length > 0 ||
    normalized.approvalTeamIds.length > 0 ||
    normalized.escalationTeamIds.length > 0 ||
    normalized.requireHandoffAcceptance
    ? normalized
    : undefined;
};

export const getCapabilityPhaseOwnershipRule = (
  capability: Pick<Capability, 'phaseOwnershipRules' | 'lifecycle' | 'ownerTeam'>,
  phaseId?: WorkflowPhaseId | null,
): CapabilityPhaseOwnershipRule | undefined => {
  const normalizedPhaseId = trim(phaseId).toUpperCase();
  if (!normalizedPhaseId) {
    return undefined;
  }

  return normalizeCapabilityPhaseOwnershipRules(capability).find(
    rule => rule.phaseId.toUpperCase() === normalizedPhaseId,
  );
};

export const compileStepOwnership = ({
  capability,
  step,
}: {
  capability: Pick<Capability, 'phaseOwnershipRules' | 'lifecycle' | 'ownerTeam'>;
  step: Pick<WorkflowStep, 'phase' | 'ownershipRule'>;
}): CompiledStepOwnership => {
  const phaseRule = getCapabilityPhaseOwnershipRule(capability, step.phase);
  const stepRule = normalizeWorkflowStepOwnershipRule(step.ownershipRule);

  return {
    phaseOwnerTeamId: phaseRule?.primaryOwnerTeamId,
    stepOwnerTeamId: stepRule?.primaryOwnerTeamId || phaseRule?.primaryOwnerTeamId,
    approvalTeamIds:
      stepRule?.approvalTeamIds && stepRule.approvalTeamIds.length > 0
        ? stepRule.approvalTeamIds
        : phaseRule?.approvalTeamIds || [],
    escalationTeamIds:
      stepRule?.escalationTeamIds && stepRule.escalationTeamIds.length > 0
        ? stepRule.escalationTeamIds
        : phaseRule?.escalationTeamIds || [],
    requireHandoffAcceptance:
      stepRule?.requireHandoffAcceptance || false,
  };
};

export const resolveWorkItemPhaseOwnerTeamId = ({
  capability,
  phaseId,
  step,
}: {
  capability: Pick<Capability, 'phaseOwnershipRules' | 'lifecycle' | 'ownerTeam'>;
  phaseId?: WorkflowPhaseId | null;
  step?: Pick<WorkflowStep, 'phase' | 'ownershipRule'> | null;
}) => {
  if (step) {
    return compileStepOwnership({ capability, step }).stepOwnerTeamId;
  }

  return getCapabilityPhaseOwnershipRule(capability, phaseId)?.primaryOwnerTeamId;
};
