import React from 'react';

type Props = {
  workbench: React.ReactNode;
  overlays: React.ReactNode;
};

export const OrchestratorBoardMode = ({ workbench, overlays }: Props) => (
  <>
    {workbench}
    {overlays}
  </>
);
