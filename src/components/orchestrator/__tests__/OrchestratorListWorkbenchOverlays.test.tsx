import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrchestratorListWorkbenchOverlays } from '../OrchestratorListWorkbenchOverlays';

describe('OrchestratorListWorkbenchOverlays', () => {
  it('renders the extracted list-only overlay surfaces together', () => {
    render(
      <OrchestratorListWorkbenchOverlays
        quickCreateSheet={<div>quick create sheet</div>}
        stageControl={<div>stage control</div>}
        explainDrawer={<div>explain drawer</div>}
      />,
    );

    expect(screen.getByText('quick create sheet')).toBeInTheDocument();
    expect(screen.getByText('stage control')).toBeInTheDocument();
    expect(screen.getByText('explain drawer')).toBeInTheDocument();
  });
});
