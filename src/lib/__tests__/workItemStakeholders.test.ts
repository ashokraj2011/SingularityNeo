import { describe, expect, it } from 'vitest';
import { createBrokerageCapabilityLifecycle } from '../capabilityLifecycle';
import {
  buildWorkItemPhaseSignatureMarkdown,
  getWorkItemPhaseStakeholders,
  normalizeWorkItemPhaseStakeholders,
} from '../workItemStakeholders';

describe('work item phase stakeholders', () => {
  it('normalizes phase stakeholders against the capability lifecycle', () => {
    const lifecycle = createBrokerageCapabilityLifecycle();
    const assignments = normalizeWorkItemPhaseStakeholders(
      [
        {
          phaseId: 'construction',
          stakeholders: [
            {
              role: 'QA Lead',
              name: 'Asha',
              email: 'asha@example.com',
            },
            {
              role: '',
              name: '',
              email: '',
            },
          ],
        },
        {
          phaseId: 'unknown',
          stakeholders: [
            {
              role: 'Ignored',
              name: 'Ghost',
              email: 'ghost@example.com',
            },
          ],
        },
      ],
      lifecycle,
    );

    expect(assignments).toEqual([
      {
        phaseId: 'CONSTRUCTION',
        stakeholders: [
          {
            role: 'QA Lead',
            name: 'Asha',
            email: 'asha@example.com',
            teamName: undefined,
          },
        ],
      },
    ]);
  });

  it('formats sign-off markdown for a configured phase', () => {
    const lifecycle = createBrokerageCapabilityLifecycle();
    const workItem = {
      phaseStakeholders: [
        {
          phaseId: 'DELIVERY',
          stakeholders: [
            {
              role: 'Operations Manager',
              name: 'Ravi',
              email: 'ravi@example.com',
              teamName: 'Operations',
            },
          ],
        },
      ],
    };

    expect(getWorkItemPhaseStakeholders(workItem, 'DELIVERY')).toHaveLength(1);
    expect(
      buildWorkItemPhaseSignatureMarkdown({
        workItem,
        source: lifecycle,
        phaseId: 'DELIVERY',
      }),
    ).toContain('Operations Manager | Ravi | team Operations | email ravi@example.com');
  });
});
