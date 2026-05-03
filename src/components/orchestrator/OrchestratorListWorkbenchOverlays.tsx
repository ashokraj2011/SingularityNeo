import React from 'react';

type Props = {
  quickCreateSheet: React.ReactNode;
  stageControl: React.ReactNode;
  stageOwnership?: React.ReactNode;
  explainDrawer: React.ReactNode;
};

export const OrchestratorListWorkbenchOverlays = ({
  quickCreateSheet,
  stageControl,
  stageOwnership,
  explainDrawer,
}: Props) => (
  <>
    {quickCreateSheet}
    {stageControl}
    {stageOwnership}
    {explainDrawer}
  </>
);
