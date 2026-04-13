import type {
  Capability,
  CapabilityLifecycle,
  WorkItem,
  WorkItemPhaseStakeholder,
  WorkItemPhaseStakeholderAssignment,
  WorkflowPhaseId,
} from '../types';
import { getCapabilityVisibleLifecyclePhases, getLifecyclePhaseLabel } from './capabilityLifecycle';

const trim = (value?: string | null) => String(value || '').trim();

export const createEmptyWorkItemPhaseStakeholder =
  (): WorkItemPhaseStakeholder => ({
    role: 'Stakeholder',
    name: '',
    email: '',
    teamName: '',
  });

export const hasWorkItemPhaseStakeholderContent = (
  stakeholder: WorkItemPhaseStakeholder,
) =>
  Boolean(
    trim(stakeholder.name) ||
      trim(stakeholder.email) ||
      trim(stakeholder.teamName),
  );

export const normalizeWorkItemPhaseStakeholders = (
  assignments: WorkItemPhaseStakeholderAssignment[] | undefined,
  source?: CapabilityLifecycle | Pick<Capability, 'lifecycle'> | null,
): WorkItemPhaseStakeholderAssignment[] => {
  const lifecyclePhaseIds = source
    ? new Set(getCapabilityVisibleLifecyclePhases(source).map(phase => phase.id))
    : null;
  const seenPhases = new Set<string>();

  return (assignments || [])
    .map(assignment => {
      const phaseId = trim(assignment?.phaseId).toUpperCase();
      if (!phaseId || seenPhases.has(phaseId)) {
        return null;
      }
      if (lifecyclePhaseIds && !lifecyclePhaseIds.has(phaseId)) {
        return null;
      }
      seenPhases.add(phaseId);

      const stakeholders = (assignment?.stakeholders || [])
        .map(stakeholder => ({
          role: trim(stakeholder?.role) || 'Stakeholder',
          name: trim(stakeholder?.name),
          email: trim(stakeholder?.email),
          teamName: trim(stakeholder?.teamName) || undefined,
        }))
        .filter(hasWorkItemPhaseStakeholderContent);

      if (stakeholders.length === 0) {
        return null;
      }

      return {
        phaseId,
        stakeholders,
      } satisfies WorkItemPhaseStakeholderAssignment;
    })
    .filter(Boolean) as WorkItemPhaseStakeholderAssignment[];
};

export const getWorkItemPhaseStakeholders = (
  workItem: Pick<WorkItem, 'phaseStakeholders'> | null | undefined,
  phaseId?: WorkflowPhaseId | null,
): WorkItemPhaseStakeholder[] => {
  const normalizedPhaseId = trim(phaseId).toUpperCase();
  if (!workItem || !normalizedPhaseId) {
    return [];
  }

  return (
    normalizeWorkItemPhaseStakeholders(workItem.phaseStakeholders).find(
      assignment => assignment.phaseId === normalizedPhaseId,
    )?.stakeholders || []
  );
};

export const formatWorkItemPhaseStakeholderLine = (
  stakeholder: WorkItemPhaseStakeholder,
) =>
  [
    trim(stakeholder.role) || 'Stakeholder',
    trim(stakeholder.name) || 'Unassigned',
    trim(stakeholder.teamName) ? `team ${trim(stakeholder.teamName)}` : null,
    trim(stakeholder.email) ? `email ${trim(stakeholder.email)}` : null,
  ]
    .filter(Boolean)
    .join(' | ');

export const buildWorkItemPhaseSignatureMarkdown = ({
  workItem,
  source,
  phaseId,
}: {
  workItem?: Pick<WorkItem, 'phaseStakeholders'> | null;
  source?: CapabilityLifecycle | Pick<Capability, 'lifecycle'> | null;
  phaseId?: WorkflowPhaseId | null;
}) => {
  const stakeholders = getWorkItemPhaseStakeholders(workItem, phaseId);
  if (stakeholders.length === 0) {
    return undefined;
  }

  return [
    `The following stakeholders are recorded for ${getLifecyclePhaseLabel(source, phaseId)} and should be represented in phase documents and sign-off records:`,
    ...stakeholders.map(stakeholder => `- ${formatWorkItemPhaseStakeholderLine(stakeholder)}`),
  ].join('\n');
};
