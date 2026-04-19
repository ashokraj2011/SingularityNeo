import React from 'react';
import { Workflow as WorkflowIcon } from 'lucide-react';
import type { WorkItem } from '../../lib/orchestrator/support';
import { EmptyState } from '../EnterpriseUI';

type Props = {
  selectedWorkItem: WorkItem | null;
  children: React.ReactNode;
};

export const OrchestratorWorkbenchCanvas = ({ selectedWorkItem, children }: Props) => (
  <div className="orchestrator-workbench-canvas">
    {!selectedWorkItem ? (
      <EmptyState
        title="Select a work item"
        description="Choose a story from the navigator, attention strip, or flow map to open the focused delivery workbench."
        icon={WorkflowIcon}
        className="h-full min-h-[45rem]"
      />
    ) : (
      children
    )}
  </div>
);
