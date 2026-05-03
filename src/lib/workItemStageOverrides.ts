import type {
  ApprovalPolicy,
  CapabilityStakeholder,
  WorkItem,
  WorkItemStageOverride,
  Workflow,
} from "../types";

export const getWorkItemStageOverride = (
  workItem: WorkItem | null | undefined,
  workflowStepId?: string | null,
): WorkItemStageOverride | null =>
  (workItem?.stageOverrides || []).find(
    (override) => override.workflowStepId === workflowStepId,
  ) || null;

export const buildDelegatedHumanApprovalPolicy = ({
  step,
  workItem,
  phaseStakeholders,
}: {
  step: Workflow["steps"][number] | null;
  workItem: WorkItem | null;
  phaseStakeholders: CapabilityStakeholder[];
}): ApprovalPolicy | undefined => {
  if (step?.approvalPolicy?.targets?.length) {
    return step.approvalPolicy;
  }

  const roleTargets = Array.from(
    new Set(
      [
        ...(step?.approverRoles || []),
        ...phaseStakeholders
          .map((stakeholder) => String(stakeholder.role || "").trim())
          .filter(Boolean),
      ],
    ),
  ).map((role) => ({
    targetType: "CAPABILITY_ROLE" as const,
    targetId: role,
    label: role,
  }));

  const teamTargets = workItem?.phaseOwnerTeamId
    ? [
        {
          targetType: "TEAM" as const,
          targetId: workItem.phaseOwnerTeamId,
          label: workItem.phaseOwnerTeamId,
        },
      ]
    : [];

  const targets = roleTargets.length > 0 ? roleTargets : teamTargets;
  if (targets.length === 0) {
    return undefined;
  }

  return {
    id: `AUTO-DELEGATION-${step?.id || workItem?.id || "WORK"}`,
    name: "Delegated human task approval",
    description:
      "Generated from the active workflow ownership so delegated human work still returns through the standard approval gate.",
    mode: "ANY_ONE",
    targets,
    minimumApprovals: 1,
    delegationAllowed: true,
  };
};
