import React from 'react';

type Props = {
  quickCreateSheet: React.ReactNode;
  stageControl: React.ReactNode;
  explainDrawer: React.ReactNode;
};

export const OrchestratorListWorkbenchOverlays = ({
  quickCreateSheet,
  stageControl,
  explainDrawer,
}: Props) => (
  <>
    {quickCreateSheet}
    {stageControl}
    {explainDrawer}
  </>
);
