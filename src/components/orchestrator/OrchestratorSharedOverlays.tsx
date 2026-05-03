import React from 'react';

type Props = {
  approvalReviewModal?: React.ReactNode;
  diffReviewModal?: React.ReactNode;
  quickCreateSheet?: React.ReactNode;
  quickActionDialogs?: React.ReactNode;
  stageControl?: React.ReactNode;
  stageOwnership?: React.ReactNode;
  explainDrawer?: React.ReactNode;
};

export const OrchestratorSharedOverlays = ({
  approvalReviewModal,
  diffReviewModal,
  quickCreateSheet,
  quickActionDialogs,
  stageControl,
  stageOwnership,
  explainDrawer,
}: Props) => (
  <>
    {approvalReviewModal}
    {diffReviewModal}
    {quickCreateSheet}
    {quickActionDialogs}
    {stageControl}
    {stageOwnership}
    {explainDrawer}
  </>
);
