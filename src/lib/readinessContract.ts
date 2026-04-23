import type {
  Capability,
  CapabilityWorkspace,
  ReadinessContract,
  ReadinessGate,
} from "../types";
import type { RuntimeStatus } from "./api";

const hasText = (value?: string) => Boolean(value?.trim());

export const hasCapabilityOwnerAssigned = (capability: Capability) =>
  hasText(capability.ownerTeam) ||
  capability.stakeholders.length > 0 ||
  capability.teamNames.length > 0;

export const hasOutcomeContractComplete = (capability: Capability) =>
  hasText(capability.businessOutcome) ||
  hasText(capability.definitionOfDone) ||
  capability.successMetrics.some((metric) => hasText(metric)) ||
  capability.requiredEvidenceKinds.some((kind) => hasText(kind)) ||
  hasText(capability.operatingPolicySummary);

export const hasSourceContextConnected = (capability: Capability) =>
  capability.gitRepositories.length > 0 ||
  (capability.repositories?.length || 0) > 0 ||
  hasText(capability.jiraBoardLink) ||
  hasText(capability.confluenceLink) ||
  hasText(capability.documentationNotes);

export const hasApprovedWorkspacePresent = (_capability: Capability) => true;

export const hasWorkflowValidAndPublished = (workspace: CapabilityWorkspace) =>
  workspace.workflows.some(
    (workflow) =>
      !workflow.archivedAt &&
      workflow.steps.length > 0 &&
      (workflow.publishState === "VALIDATED" ||
        workflow.publishState === "PUBLISHED"),
  );

const createGate = ({
  id,
  label,
  satisfied,
  summary,
  blockingReason,
  actionLabel,
  path,
  nextRequiredAction,
}: ReadinessGate): ReadinessGate => ({
  id,
  label,
  satisfied,
  summary,
  blockingReason,
  actionLabel,
  path,
  nextRequiredAction,
});

export const buildReadinessContractFromSignals = ({
  capability,
  workspace,
  executionRuntimeReady,
  executionRuntimeSummary,
  generatedAt = new Date().toISOString(),
}: {
  capability: Capability;
  workspace: CapabilityWorkspace;
  executionRuntimeReady: boolean;
  executionRuntimeSummary?: string;
  generatedAt?: string;
}): ReadinessContract => {
  const gates: ReadinessGate[] = [
    createGate({
      id: "OWNER_ASSIGNED",
      label: "Owner assigned",
      satisfied: hasCapabilityOwnerAssigned(capability),
      summary:
        "A real team or stakeholder must be accountable for this capability.",
      blockingReason:
        "Execution stays blocked until a capability owner or owning team is assigned.",
      actionLabel: "Assign owner",
      path: "/capabilities/metadata",
      nextRequiredAction: "Add an owner team, stakeholder, or team assignment.",
    }),
    createGate({
      id: "OUTCOME_CONTRACT_COMPLETE",
      label: "Outcome contract complete",
      satisfied: true,
      summary: hasOutcomeContractComplete(capability)
        ? "Business outcome context is present and helps owners understand what this capability is for."
        : "Business outcome, success metrics, evidence expectations, and definition of done are optional but helpful context for business owners.",
      blockingReason:
        "This contract is now optional and does not block execution.",
      actionLabel: "Complete contract",
      path: "/capabilities/metadata",
      nextRequiredAction:
        "Optionally add business outcome, definition of done, success metrics, required evidence, or a short operating policy summary.",
    }),
    createGate({
      id: "SOURCE_CONTEXT_CONNECTED",
      label: "Source context connected",
      satisfied: hasSourceContextConnected(capability),
      summary:
        "At least one repo or source system should ground delivery work before orchestration starts.",
      blockingReason:
        "Execution stays blocked until the capability is linked to a repo, documentation system, or ALM context.",
      actionLabel: "Connect source",
      path: "/capabilities/metadata",
      nextRequiredAction:
        "Link a repository or another source of truth for this capability.",
    }),
    createGate({
      id: "APPROVED_WORKSPACE_PRESENT",
      label: "Desktop workspace hints documented",
      satisfied: hasApprovedWorkspacePresent(capability),
      summary:
        "Capability-level workspace hints are optional documentation now that local roots are stored per operator and per desktop.",
      blockingReason:
        "Desktop workspace mappings are managed from Operations and do not block metadata completion.",
      actionLabel: "Review hints",
      path: "/operations#desktop-workspaces",
      nextRequiredAction:
        "Optionally keep local root hints on the capability as migration suggestions for operators.",
    }),
    createGate({
      id: "WORKFLOW_VALID_AND_PUBLISHED",
      label: "Workflow valid and published",
      satisfied: hasWorkflowValidAndPublished(workspace),
      summary:
        "The capability needs a non-archived workflow with steps and a validated or published state.",
      blockingReason:
        "Execution stays blocked until a workflow is validated or published for this capability.",
      actionLabel: "Publish workflow",
      path: "/designer",
      nextRequiredAction:
        "Validate or publish a workflow before starting or restarting delivery.",
    }),
    createGate({
      id: "EXECUTION_RUNTIME_READY",
      label: "Desktop execution ready",
      satisfied: executionRuntimeReady,
      summary:
        executionRuntimeSummary ||
        "An eligible desktop executor must be online so work can move from queued to running.",
      blockingReason:
        "Execution stays blocked until desktop-owned execution is available for this capability.",
      actionLabel: "Open operations",
      path: "/operations",
      nextRequiredAction:
        "Bring a desktop executor online with an approved local root, then claim or verify execution ownership.",
    }),
  ];

  const firstBlockedGate = gates.find((gate) => !gate.satisfied);

  return {
    capabilityId: capability.id,
    generatedAt,
    allReady: !firstBlockedGate,
    summary: firstBlockedGate
      ? `${firstBlockedGate.label} is blocking new starts and restarts.`
      : "All six readiness gates are green. This capability can start or restart delivery.",
    nextRequiredAction: firstBlockedGate?.nextRequiredAction,
    gates,
  };
};

export const buildLocalReadinessContract = ({
  capability,
  workspace,
  runtimeStatus,
}: {
  capability: Capability;
  workspace: CapabilityWorkspace;
  runtimeStatus?: RuntimeStatus | null;
}) => {
  const executionRuntimeReady = runtimeStatus
    ? runtimeStatus.executionRuntimeOwner === "DESKTOP"
      ? Boolean(
          runtimeStatus.configured &&
          ((runtimeStatus.executorHeartbeatStatus === "FRESH" &&
            (runtimeStatus.ownedCapabilityIds || []).includes(capability.id)) ||
            workspace.executionDispatchState === "ASSIGNED" ||
            runtimeStatus.executorId),
        )
      : runtimeStatus.executionRuntimeOwner
        ? false
        : runtimeStatus.configured
    : false;

  return buildReadinessContractFromSignals({
    capability,
    workspace,
    executionRuntimeReady,
    executionRuntimeSummary: runtimeStatus
      ? runtimeStatus.executorHeartbeatStatus === "FRESH"
        ? "A fresh desktop runtime is connected for Copilot-backed execution."
        : "Desktop execution is configured, but this capability still needs an eligible claimed executor."
      : "Checking desktop execution readiness.",
  });
};
