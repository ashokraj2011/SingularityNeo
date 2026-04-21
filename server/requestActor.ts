import type express from 'express';
import type { ActorContext, WorkspaceOrganization } from '../src/types';
import {
  getCurrentWorkspaceUser,
  normalizeWorkspaceOrganization,
} from '../src/lib/workspaceOrganization';
import { getWorkspaceOrganization } from './workspaceOrganization';

type RequestActorResolution = {
  actor: ActorContext;
  requestedUserId?: string;
  unresolvedUserId?: string;
};

const REQUEST_ACTOR_RESOLUTION_KEY = Symbol('singularity.requestActorResolution');

type RequestWithActorResolution = express.Request & {
  [REQUEST_ACTOR_RESOLUTION_KEY]?: RequestActorResolution;
};

export const parseHeaderStringList = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map(item => String(item || '').trim())
        .filter(Boolean);
    }
  } catch {
    // Ignore invalid JSON and fall back to CSV parsing.
  }

  return raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
};

const buildCanonicalActor = ({
  organization,
  fallbackDisplayName,
  requestedUserId,
  actedOnBehalfOfStakeholderIds,
}: {
  organization?: WorkspaceOrganization | null;
  fallbackDisplayName: string;
  requestedUserId?: string;
  actedOnBehalfOfStakeholderIds: string[];
}): RequestActorResolution => {
  const normalizedOrganization = normalizeWorkspaceOrganization(organization);
  const requestedUser = requestedUserId
    ? normalizedOrganization.users.find(user => user.id === requestedUserId)
    : null;

  if (requestedUserId && !requestedUser) {
    return {
      actor: {
        displayName: fallbackDisplayName,
        teamIds: [],
        workspaceRoles: [],
        actedOnBehalfOfStakeholderIds,
      },
      requestedUserId,
      unresolvedUserId: requestedUserId,
    };
  }

  const currentUser = requestedUser || getCurrentWorkspaceUser(normalizedOrganization);
  const isWorkspaceAdmin = Boolean(currentUser?.workspaceRoles?.includes('WORKSPACE_ADMIN'));
  const teamIds = isWorkspaceAdmin
    ? normalizedOrganization.teams.map(team => team.id)
    : currentUser?.teamIds || [];

  return {
    actor: {
      userId: currentUser?.id,
      displayName: currentUser?.name || fallbackDisplayName,
      teamIds: Array.from(new Set(teamIds)),
      workspaceRoles: currentUser?.workspaceRoles || [],
      actedOnBehalfOfStakeholderIds,
    },
    requestedUserId,
  };
};

export const resolveCanonicalActorFromOrganization = ({
  organization,
  fallbackDisplayName,
  requestedUserId,
  actedOnBehalfOfStakeholderIds,
}: {
  organization?: WorkspaceOrganization | null;
  fallbackDisplayName: string;
  requestedUserId?: string;
  actedOnBehalfOfStakeholderIds?: string[];
}) =>
  buildCanonicalActor({
    organization,
    fallbackDisplayName,
    requestedUserId: String(requestedUserId || '').trim() || undefined,
    actedOnBehalfOfStakeholderIds: Array.from(
      new Set((actedOnBehalfOfStakeholderIds || []).map(item => String(item || '').trim()).filter(Boolean)),
    ),
  });

export const bindRequestActorContext = async (
  request: express.Request,
  _response: express.Response,
  next: express.NextFunction,
) => {
  try {
    const organization = await getWorkspaceOrganization();
    const resolution = resolveCanonicalActorFromOrganization({
      organization,
      fallbackDisplayName: 'Workspace Operator',
      requestedUserId: String(request.header('x-singularity-actor-user-id') || '').trim(),
      actedOnBehalfOfStakeholderIds: parseHeaderStringList(
        request.header('x-singularity-actor-stakeholder-ids'),
      ),
    });
    (request as RequestWithActorResolution)[REQUEST_ACTOR_RESOLUTION_KEY] = resolution;
    next();
  } catch (error) {
    next(error);
  }
};

export const parseActorContext = (
  request: express.Request,
  fallbackDisplayName: string,
): ActorContext => {
  const resolution = (request as RequestWithActorResolution)[REQUEST_ACTOR_RESOLUTION_KEY];
  if (!resolution) {
    return {
      displayName: fallbackDisplayName,
      teamIds: [],
      workspaceRoles: [],
      actedOnBehalfOfStakeholderIds: parseHeaderStringList(
        request.header('x-singularity-actor-stakeholder-ids'),
      ),
    };
  }

  if (resolution.unresolvedUserId) {
    throw new Error(
      `Unauthorized: actor ${resolution.unresolvedUserId} is not registered in this workspace.`,
    );
  }

  return {
    ...resolution.actor,
    displayName: resolution.actor.displayName || fallbackDisplayName,
    teamIds: resolution.actor.teamIds || [],
    workspaceRoles: resolution.actor.workspaceRoles || [],
    actedOnBehalfOfStakeholderIds: resolution.actor.actedOnBehalfOfStakeholderIds || [],
  };
};
