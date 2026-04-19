import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunWait, WorkItem, WorkItemPhase } from '../../lib/orchestrator/support';

type UseOrchestratorModalsArgs = {
  selectedOpenWait: RunWait | null;
  selectedWorkItem: WorkItem | null;
  selectedHasCodeDiffApproval: boolean;
};

export const useOrchestratorModals = ({
  selectedOpenWait,
  selectedWorkItem,
  selectedHasCodeDiffApproval,
}: UseOrchestratorModalsArgs) => {
  const [isCreateSheetOpen, setIsCreateSheetOpen] = useState(false);
  const [isCancelWorkItemOpen, setIsCancelWorkItemOpen] = useState(false);
  const [cancelWorkItemNote, setCancelWorkItemNote] = useState('');
  const [isArchiveWorkItemOpen, setIsArchiveWorkItemOpen] = useState(false);
  const [archiveWorkItemNote, setArchiveWorkItemNote] = useState('');
  const [isRestoreWorkItemOpen, setIsRestoreWorkItemOpen] = useState(false);
  const [restoreWorkItemNote, setRestoreWorkItemNote] = useState('');
  const [phaseMoveRequest, setPhaseMoveRequest] = useState<{
    workItemId: string;
    targetPhase: WorkItemPhase;
  } | null>(null);
  const [phaseMoveNote, setPhaseMoveNote] = useState('');
  const [isDiffReviewOpen, setIsDiffReviewOpen] = useState(false);
  const [isApprovalReviewOpen, setIsApprovalReviewOpen] = useState(false);
  const [isApprovalReviewHydrated, setIsApprovalReviewHydrated] = useState(false);
  const [approvalReviewWaitSnapshot, setApprovalReviewWaitSnapshot] = useState<RunWait | null>(
    null,
  );
  const [isExplainOpen, setIsExplainOpen] = useState(false);
  const [isStageControlOpen, setIsStageControlOpen] = useState(false);

  const autoOpenedApprovalWaitIdsRef = useRef<Set<string>>(new Set());
  const previousSelectedWorkItemIdRef = useRef<string | null>(null);
  const previousSelectedApprovalWaitIdRef = useRef<string | null>(null);

  const handleOpenApprovalReview = useCallback(() => {
    if (selectedOpenWait?.type !== 'APPROVAL' || !selectedWorkItem) {
      return;
    }

    setApprovalReviewWaitSnapshot(selectedOpenWait);
    setIsApprovalReviewHydrated(false);
    setIsApprovalReviewOpen(true);
  }, [selectedOpenWait, selectedWorkItem]);

  const handleApprovalReviewMouseDown = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      handleOpenApprovalReview();
    },
    [handleOpenApprovalReview],
  );

  useEffect(() => {
    if (selectedWorkItem) {
      return;
    }

    setIsDiffReviewOpen(false);
    setIsApprovalReviewOpen(false);
    setIsApprovalReviewHydrated(false);
    setApprovalReviewWaitSnapshot(null);
    setIsExplainOpen(false);
    setIsStageControlOpen(false);
    setIsCancelWorkItemOpen(false);
    setIsArchiveWorkItemOpen(false);
    setIsRestoreWorkItemOpen(false);
    setPhaseMoveRequest(null);
    setPhaseMoveNote('');
  }, [selectedWorkItem]);

  useEffect(() => {
    if (!selectedHasCodeDiffApproval) {
      setIsDiffReviewOpen(false);
    }
  }, [selectedHasCodeDiffApproval]);

  useEffect(() => {
    if (selectedOpenWait?.type === 'APPROVAL') {
      setApprovalReviewWaitSnapshot(selectedOpenWait);
      return;
    }

    if (!isApprovalReviewOpen) {
      setApprovalReviewWaitSnapshot(null);
    }
  }, [isApprovalReviewOpen, selectedOpenWait]);

  useEffect(() => {
    if (!isApprovalReviewOpen) {
      setIsApprovalReviewHydrated(false);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setIsApprovalReviewHydrated(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isApprovalReviewOpen]);

  useEffect(() => {
    const currentSelectedWorkItemId = selectedWorkItem?.id || null;
    const currentApprovalWaitId =
      selectedOpenWait?.type === 'APPROVAL' ? selectedOpenWait.id : null;
    const previousSelectedWorkItemId = previousSelectedWorkItemIdRef.current;
    const previousApprovalWaitId = previousSelectedApprovalWaitIdRef.current;

    previousSelectedWorkItemIdRef.current = currentSelectedWorkItemId;
    previousSelectedApprovalWaitIdRef.current = currentApprovalWaitId;

    if (!currentApprovalWaitId || selectedOpenWait?.type !== 'APPROVAL' || !selectedWorkItem) {
      return;
    }

    setApprovalReviewWaitSnapshot(selectedOpenWait);

    const approvalArrivedDuringActiveSelection =
      previousSelectedWorkItemId === currentSelectedWorkItemId &&
      previousApprovalWaitId !== currentApprovalWaitId;

    if (autoOpenedApprovalWaitIdsRef.current.has(selectedOpenWait.id)) {
      return;
    }

    if (!approvalArrivedDuringActiveSelection) {
      return;
    }

    autoOpenedApprovalWaitIdsRef.current.add(selectedOpenWait.id);
    setIsApprovalReviewHydrated(false);
    setIsApprovalReviewOpen(true);
  }, [selectedOpenWait, selectedWorkItem]);

  return {
    isCreateSheetOpen,
    setIsCreateSheetOpen,
    isCancelWorkItemOpen,
    setIsCancelWorkItemOpen,
    cancelWorkItemNote,
    setCancelWorkItemNote,
    isArchiveWorkItemOpen,
    setIsArchiveWorkItemOpen,
    archiveWorkItemNote,
    setArchiveWorkItemNote,
    isRestoreWorkItemOpen,
    setIsRestoreWorkItemOpen,
    restoreWorkItemNote,
    setRestoreWorkItemNote,
    phaseMoveRequest,
    setPhaseMoveRequest,
    phaseMoveNote,
    setPhaseMoveNote,
    isDiffReviewOpen,
    setIsDiffReviewOpen,
    isApprovalReviewOpen,
    setIsApprovalReviewOpen,
    isApprovalReviewHydrated,
    setIsApprovalReviewHydrated,
    approvalReviewWaitSnapshot,
    setApprovalReviewWaitSnapshot,
    isExplainOpen,
    setIsExplainOpen,
    isStageControlOpen,
    setIsStageControlOpen,
    handleOpenApprovalReview,
    handleApprovalReviewMouseDown,
  };
};
