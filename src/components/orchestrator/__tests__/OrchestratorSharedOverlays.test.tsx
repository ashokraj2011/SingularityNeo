import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrchestratorSharedOverlays } from '../OrchestratorSharedOverlays';

describe('OrchestratorSharedOverlays', () => {
  it('renders every overlay slot it receives', () => {
    render(
      <OrchestratorSharedOverlays
        approvalReviewModal={<div>Approval review modal</div>}
        diffReviewModal={<div>Diff review modal</div>}
        quickCreateSheet={<div>Quick create sheet</div>}
        quickActionDialogs={<div>Quick action dialogs</div>}
        stageControl={<div>Stage control overlay</div>}
        stageOwnership={<div>Stage ownership overlay</div>}
        explainDrawer={<div>Explain drawer</div>}
      />,
    );

    expect(screen.getByText('Approval review modal')).toBeInTheDocument();
    expect(screen.getByText('Diff review modal')).toBeInTheDocument();
    expect(screen.getByText('Quick create sheet')).toBeInTheDocument();
    expect(screen.getByText('Quick action dialogs')).toBeInTheDocument();
    expect(screen.getByText('Stage control overlay')).toBeInTheDocument();
    expect(screen.getByText('Stage ownership overlay')).toBeInTheDocument();
    expect(screen.getByText('Explain drawer')).toBeInTheDocument();
  });
});
