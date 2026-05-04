import { hasGitHubCapabilityRepository } from "../../src/lib/githubRepositories";
import {
  findFirstExecutableNode,
  findFirstExecutableNodeForPhase,
  getWorkflowNodes,
} from "../../src/lib/workflowGraph";
import type {
  Capability,
  CapabilityAgent,
  RuntimeProviderStatus,
  Workflow,
  WorkflowNode,
  WorkflowStep,
  WorkItem,
  WorkItemPhase,
} from "../../src/types";
import { getConfiguredRuntimeProviderStatus } from "../runtimeProviders";
import {
  buildExecutionRuntimeAgent,
  resolveExecutionRuntimeForStep,
  type ExecutionRuntimeSelection,
} from "./runtimeSelection";

const resolveWorkflowStartStep = ({
  workflow,
  workItem,
  restartFromPhase,
}: {
  workflow: Workflow;
  workItem: WorkItem;
  restartFromPhase?: WorkItemPhase;
}): WorkflowNode => {
  const nodes = getWorkflowNodes(workflow);
  const resolved =
    (restartFromPhase
      ? findFirstExecutableNodeForPhase(workflow, restartFromPhase)
      : null) ||
    (workItem.currentStepId
      ? nodes.find((node) => node.id === workItem.currentStepId)
      : null) ||
    findFirstExecutableNode(workflow);

  if (!resolved) {
    throw new Error(`Workflow ${workflow.name} does not define any executable nodes.`);
  }

  return resolved;
};

export const validateExecutionRuntimeForStep = async ({
  capability,
  agent,
  step,
}: {
  capability: Capability;
  agent?: CapabilityAgent | null;
  step: Pick<
    WorkflowStep,
    "phase" | "stepType" | "runtimeProviderKey" | "runtimeModel"
  >;
}): Promise<{
  selection: ExecutionRuntimeSelection;
  runtimeAgent: CapabilityAgent | (Partial<CapabilityAgent> & { model: string });
  providerStatus: RuntimeProviderStatus;
}> => {
  const selection = resolveExecutionRuntimeForStep({
    step,
    agent,
    hasGitHubCodeRepository: hasGitHubCapabilityRepository(
      capability.repositories,
    ),
  });
  const providerStatus = await getConfiguredRuntimeProviderStatus(
    selection.providerKey,
  );

  if (!providerStatus.configured || providerStatus.validation?.ok === false) {
    throw new Error(
      providerStatus.validation?.message ||
        `${providerStatus.label} is not configured for execution.`,
    );
  }

  return {
    selection,
    runtimeAgent: buildExecutionRuntimeAgent({
      agent,
      selection,
    }),
    providerStatus,
  };
};

export const validateExecutionStartRuntime = async ({
  capability,
  workItem,
  workflow,
  agents,
  restartFromPhase,
}: {
  capability: Capability;
  workItem: WorkItem;
  workflow: Workflow;
  agents: CapabilityAgent[];
  restartFromPhase?: WorkItemPhase;
}) => {
  const startNode = resolveWorkflowStartStep({
    workflow,
    workItem,
    restartFromPhase,
  });
  const startStep = workflow.steps.find((step) => step.id === startNode.id) || {
    id: startNode.id,
    name: startNode.name,
    phase: startNode.phase,
    stepType:
      startNode.type === "GOVERNANCE_GATE"
        ? "GOVERNANCE_GATE"
        : startNode.type === "HUMAN_APPROVAL"
          ? "HUMAN_APPROVAL"
          : "DELIVERY",
    action: startNode.name,
    agentId: startNode.agentId,
    allowedToolIds: startNode.allowedToolIds || [],
  };
  const agent =
    agents.find((candidate) => candidate.id === startStep.agentId) || null;

  const runtime = await validateExecutionRuntimeForStep({
    capability,
    agent,
    step: startStep,
  });

  return {
    ...runtime,
    startNode,
    startStep,
    agent,
  };
};
