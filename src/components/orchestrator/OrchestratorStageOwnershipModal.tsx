import React, { useEffect, useMemo, useState } from "react";
import { FileUp, LoaderCircle, Upload, User, X } from "lucide-react";
import { ModalShell, StatusBadge } from "../EnterpriseUI";
import { useToast } from "../../context/ToastContext";
import {
  completeCapabilityWorkItemHumanStage,
  setCapabilityWorkItemStageOwner,
  uploadCapabilityWorkItemFiles,
} from "../../lib/api";
import { getLifecyclePhaseLabel } from "../../lib/capabilityLifecycle";
import { getWorkItemPhaseStakeholders } from "../../lib/workItemStakeholders";
import {
  buildDelegatedHumanApprovalPolicy,
  getWorkItemStageOverride,
} from "../../lib/workItemStageOverrides";
import type {
  Artifact,
  Capability,
  WorkItem,
  Workflow,
  WorkflowRun,
} from "../../types";

type Props = {
  isOpen: boolean;
  capability: Capability;
  workItem: WorkItem | null;
  workflow: Workflow | null;
  artifacts: Artifact[];
  currentRun: WorkflowRun | null;
  currentRunStepId?: string | null;
  currentStep: Workflow["steps"][number] | null;
  currentActorDisplayName: string;
  onClose: () => void;
  onRefresh: () => Promise<void>;
};

const splitChecklist = (value: string) =>
  value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

export const OrchestratorStageOwnershipModal = ({
  isOpen,
  capability,
  workItem,
  workflow,
  artifacts,
  currentRun,
  currentRunStepId,
  currentStep,
  currentActorDisplayName,
  onClose,
  onRefresh,
}: Props) => {
  const { success, error } = useToast();
  const [selectedStepId, setSelectedStepId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [checklistText, setChecklistText] = useState("");
  const [assigneeRole, setAssigneeRole] = useState("");
  const [completionSummary, setCompletionSummary] = useState("");
  const [uploads, setUploads] = useState<File[]>([]);
  const [busyAction, setBusyAction] = useState<
    "upload" | "assign" | "return" | "complete" | null
  >(null);

  const steps = workflow?.steps || [];
  const selectedStep =
    steps.find((step) => step.id === selectedStepId) || currentStep || null;
  const selectedOverride = useMemo(
    () => getWorkItemStageOverride(workItem, selectedStep?.id),
    [selectedStep?.id, workItem],
  );
  const selectedPhaseStakeholders = useMemo(
    () =>
      selectedStep
        ? getWorkItemPhaseStakeholders(workItem, selectedStep.phase)
        : [],
    [selectedStep, workItem],
  );
  const approvalPolicy = useMemo(
    () =>
      buildDelegatedHumanApprovalPolicy({
        step: selectedStep,
        workItem,
        phaseStakeholders: selectedPhaseStakeholders,
      }),
    [selectedPhaseStakeholders, selectedStep, workItem],
  );
  const isCurrentHumanStage =
    Boolean(currentRun) &&
    currentRun?.status === "WAITING_HUMAN_TASK" &&
    currentStep?.id === selectedStep?.id;
  const selectedStageArtifacts = useMemo(
    () =>
      selectedStep
        ? artifacts.filter((artifact) => artifact.workflowStepId === selectedStep.id)
        : [],
    [artifacts, selectedStep],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setSelectedStepId(
      currentStep?.id || workItem?.currentStepId || workflow?.steps[0]?.id || "",
    );
    setUploads([]);
    setCompletionSummary("");
  }, [currentStep?.id, isOpen, workItem?.currentStepId, workflow?.steps]);

  useEffect(() => {
    setInstructions(selectedOverride?.instructions || "");
    setChecklistText((selectedOverride?.checklist || []).join("\n"));
    setAssigneeRole(selectedOverride?.assigneeRole || "");
  }, [selectedOverride?.assigneeRole, selectedOverride?.checklist, selectedOverride?.instructions, selectedStepId]);

  if (!isOpen || !workItem || !workflow) {
    return null;
  }

  const handleAddFiles = (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }
    setUploads((current) => [...current, ...Array.from(files)]);
  };

  const uploadPendingFiles = async () => {
    if (!selectedStep || uploads.length === 0) {
      return 0;
    }
    const isCurrentStageContext = currentStep?.id === selectedStep.id;
    const artifacts = await uploadCapabilityWorkItemFiles(
      capability.id,
      workItem.id,
      uploads,
      {
        workflowStepId: selectedStep.id,
        runId: isCurrentStageContext ? currentRun?.id : undefined,
        runStepId: isCurrentStageContext ? currentRunStepId || undefined : undefined,
      },
    );
    setUploads([]);
    return artifacts.length;
  };

  const withBusy = async (
    action: NonNullable<typeof busyAction>,
    task: () => Promise<void>,
  ) => {
    try {
      setBusyAction(action);
      await task();
    } catch (cause) {
      error(
        "Stage update failed",
        cause instanceof Error ? cause.message : "Unable to update this stage.",
      );
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[2rem] border border-outline-variant/35 bg-white p-6 shadow-2xl">
        <ModalShell
          eyebrow="Stage ownership"
          title={`${workItem.title} stage controls`}
          description="Move any workflow step from agent-owned to human-owned for this work item, attach supporting documents, and complete the current human stage when it is ready for approval."
          actions={
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-outline-variant/40 p-2 text-secondary transition hover:border-primary/20 hover:text-primary"
              aria-label="Close stage ownership"
            >
              <X size={18} />
            </button>
          }
          bodyClassName="space-y-6"
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <div className="space-y-4 rounded-3xl border border-outline-variant/35 bg-surface-container-low px-5 py-5">
              <div className="space-y-2">
                <p className="workspace-meta-label">Workflow step</p>
                <select
                  value={selectedStepId}
                  onChange={(event) => setSelectedStepId(event.target.value)}
                  className="w-full rounded-2xl border border-outline-variant/35 bg-white px-4 py-3 text-sm text-on-surface"
                >
                  {steps.map((step) => (
                    <option key={step.id} value={step.id}>
                      {step.name} · {getLifecyclePhaseLabel(capability.lifecycle, step.phase)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  tone={
                    selectedOverride?.status === "COMPLETED"
                      ? "success"
                      : selectedOverride?.status === "CANCELLED"
                        ? "neutral"
                        : selectedOverride?.ownerType === "HUMAN"
                          ? "warning"
                          : "brand"
                  }
                >
                  {selectedOverride?.ownerType === "HUMAN"
                    ? `${selectedOverride.status} · Human`
                    : "Agent-owned"}
                </StatusBadge>
                {selectedStep ? (
                  <StatusBadge tone="info">
                    {getLifecyclePhaseLabel(capability.lifecycle, selectedStep.phase)}
                  </StatusBadge>
                ) : null}
              </div>

              <div className="space-y-2">
                <p className="workspace-meta-label">Human instructions</p>
                <textarea
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  rows={5}
                  className="w-full rounded-3xl border border-outline-variant/35 bg-white px-4 py-3 text-sm text-on-surface"
                  placeholder="Explain exactly what the human should do for this stage."
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="workspace-meta-label">Checklist</p>
                  <textarea
                    value={checklistText}
                    onChange={(event) => setChecklistText(event.target.value)}
                    rows={4}
                    className="w-full rounded-3xl border border-outline-variant/35 bg-white px-4 py-3 text-sm text-on-surface"
                    placeholder={"One item per line\nAttach updated requirements\nConfirm sign-off"}
                  />
                </div>
                <div className="space-y-2">
                  <p className="workspace-meta-label">Assignee role</p>
                  <input
                    value={assigneeRole}
                    onChange={(event) => setAssigneeRole(event.target.value)}
                    className="w-full rounded-2xl border border-outline-variant/35 bg-white px-4 py-3 text-sm text-on-surface"
                    placeholder="QA lead, analyst, release manager..."
                  />
                  <p className="text-xs text-secondary">
                    {approvalPolicy
                      ? `This stage will return through ${approvalPolicy.name}.`
                      : "No approval policy is available yet for this step."}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4 rounded-3xl border border-outline-variant/35 bg-surface-container-low px-5 py-5">
              <div className="space-y-2">
                <p className="workspace-meta-label">Stage documents</p>
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-outline-variant/35 bg-white px-4 py-4 text-sm font-semibold text-primary transition hover:border-primary/30">
                  <Upload size={16} />
                  Add files for this stage
                  <input
                    type="file"
                    className="hidden"
                    multiple
                    onChange={(event) => handleAddFiles(event.target.files)}
                  />
                </label>
                {uploads.length > 0 ? (
                  <div className="space-y-2">
                    {uploads.map((file, index) => (
                      <div
                        key={`${file.name}-${index}`}
                        className="flex items-center justify-between rounded-2xl border border-outline-variant/25 bg-white px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-on-surface">
                            {file.name}
                          </p>
                          <p className="text-xs text-secondary">
                            {Math.max(1, Math.round(file.size / 1024))} KB
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setUploads((current) =>
                              current.filter((_, currentIndex) => currentIndex !== index),
                            )
                          }
                          className="rounded-full p-1 text-secondary transition hover:bg-surface-container hover:text-on-surface"
                          aria-label={`Remove ${file.name}`}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs leading-relaxed text-secondary">
                    Uploads remain normal work-item artifacts, but they will be tagged to
                    the selected workflow step.
                  </p>
                )}
                <div className="space-y-2 pt-2">
                  <p className="workspace-meta-label">Existing stage evidence</p>
                  {selectedStageArtifacts.length > 0 ? (
                    <div className="space-y-2">
                      {selectedStageArtifacts.slice(0, 6).map((artifact) => (
                        <div
                          key={artifact.id}
                          className="rounded-2xl border border-outline-variant/25 bg-white px-3 py-2"
                        >
                          <p className="text-sm font-medium text-on-surface">
                            {artifact.name}
                          </p>
                          <p className="text-xs text-secondary">
                            {artifact.artifactKind} ·{" "}
                            {new Date(artifact.created).toLocaleString()}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs leading-relaxed text-secondary">
                      No documents have been attached to this stage yet.
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <p className="workspace-meta-label">Current human completion</p>
                <textarea
                  value={completionSummary}
                  onChange={(event) => setCompletionSummary(event.target.value)}
                  rows={4}
                  className="w-full rounded-3xl border border-outline-variant/35 bg-white px-4 py-3 text-sm text-on-surface"
                  placeholder="Summarize what the human completed before this stage returns for approval."
                />
                <p className="text-xs leading-relaxed text-secondary">
                  {isCurrentHumanStage
                    ? "This is the current reachable human-owned stage, so you can mark it complete here."
                    : "Completion becomes available only when this exact stage is the current reachable human task."}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  withBusy("upload", async () => {
                    if (!selectedStep || uploads.length === 0) {
                      throw new Error("Add at least one file before uploading.");
                    }
                    const count = await uploadPendingFiles();
                    await onRefresh();
                    success(
                      "Files uploaded",
                      `${count} file${count === 1 ? "" : "s"} attached to ${selectedStep.name}.`,
                    );
                  })
                }
                disabled={busyAction !== null || uploads.length === 0 || !selectedStep}
                className="rounded-full border border-outline-variant/35 px-4 py-2 text-sm font-semibold text-secondary transition hover:border-primary/20 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyAction === "upload" ? (
                  <span className="inline-flex items-center gap-2">
                    <LoaderCircle size={15} className="animate-spin" />
                    Uploading…
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <FileUp size={15} />
                    Upload documents
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-outline-variant/35 px-4 py-2 text-sm font-semibold text-secondary transition hover:border-primary/20 hover:text-primary"
              >
                Close
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {selectedOverride?.ownerType === "HUMAN" &&
              selectedOverride.status === "PENDING" ? (
                <button
                  type="button"
                  onClick={() =>
                    withBusy("return", async () => {
                      if (!selectedStep) {
                        return;
                      }
                      await setCapabilityWorkItemStageOwner(
                        capability.id,
                        workItem.id,
                        selectedStep.id,
                        {
                          ownerType: "AGENT",
                          note: `Returned ${selectedStep.name} to agent ownership.`,
                        },
                      );
                      await onRefresh();
                      success(
                        "Stage returned to agent",
                        `${selectedStep.name} will resume normal agent execution.`,
                      );
                      onClose();
                    })
                  }
                  disabled={busyAction !== null}
                  className="rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busyAction === "return" ? (
                    <span className="inline-flex items-center gap-2">
                      <LoaderCircle size={15} className="animate-spin" />
                      Updating…
                    </span>
                  ) : (
                    "Return to agent"
                  )}
                </button>
              ) : null}

              <button
                type="button"
                onClick={() =>
                  withBusy("assign", async () => {
                    if (!selectedStep) {
                      return;
                    }
                    if (!instructions.trim()) {
                      throw new Error("Add human instructions before assigning this stage.");
                    }
                    if (uploads.length > 0) {
                      await uploadPendingFiles();
                    }
                    await setCapabilityWorkItemStageOwner(
                      capability.id,
                      workItem.id,
                      selectedStep.id,
                      {
                        ownerType: "HUMAN",
                        instructions,
                        checklist: splitChecklist(checklistText),
                        assigneeRole: assigneeRole.trim() || undefined,
                        approvalPolicy,
                        note: `Assigned ${selectedStep.name} to human ownership.`,
                      },
                    );
                    await onRefresh();
                    success(
                      "Stage assigned to human",
                      `${selectedStep.name} will route through human completion for this work item.`,
                    );
                    onClose();
                  })
                }
                disabled={busyAction !== null || !selectedStep}
                className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyAction === "assign" ? (
                  <span className="inline-flex items-center gap-2">
                    <LoaderCircle size={15} className="animate-spin" />
                    Saving…
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <User size={15} />
                    Move to human
                  </span>
                )}
              </button>

              {isCurrentHumanStage ? (
                <button
                  type="button"
                  onClick={() =>
                    withBusy("complete", async () => {
                      if (!selectedStep) {
                        return;
                      }
                      if (!completionSummary.trim()) {
                        throw new Error(
                          "Add a completion summary before marking this human stage done.",
                        );
                      }
                      if (uploads.length > 0) {
                        await uploadPendingFiles();
                      }
                      await completeCapabilityWorkItemHumanStage(
                        capability.id,
                        workItem.id,
                        selectedStep.id,
                        {
                          resolution: completionSummary.trim(),
                          resolvedBy: currentActorDisplayName,
                        },
                      );
                      await onRefresh();
                      success(
                        "Human stage completed",
                        `${selectedStep.name} is now waiting on approval.`,
                      );
                      onClose();
                    })
                  }
                  disabled={busyAction !== null}
                  className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busyAction === "complete" ? (
                    <span className="inline-flex items-center gap-2">
                      <LoaderCircle size={15} className="animate-spin" />
                      Completing…
                    </span>
                  ) : (
                    "Mark human stage done"
                  )}
                </button>
              ) : null}
            </div>
          </div>
        </ModalShell>
      </div>
    </div>
  );
};

export default OrchestratorStageOwnershipModal;
