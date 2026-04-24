import type {
  ActorContext,
  CapabilityAgent,
  CapabilityKind,
  ChatParticipantDirectory,
  ChatParticipantDirectoryEntry,
} from '../src/types';
import { assertCapabilityPermission } from './access';
import { query } from './db';
import {
  getCapabilityBundle,
  type CapabilityBundle,
} from './repository';

type LinkedCapabilityBucket = keyof ChatParticipantDirectory;

export interface ResolvedSwarmParticipant {
  capabilityId: string;
  agentId: string;
  bucket: LinkedCapabilityBucket;
  bundle: CapabilityBundle;
  agent: CapabilityAgent;
}

type LinkedCapabilityResolution = {
  anchorBundle: CapabilityBundle;
  bucketByCapabilityId: Map<string, LinkedCapabilityBucket>;
};

const toAgentEntry = (
  bundle: CapabilityBundle,
  agent: CapabilityAgent,
): ChatParticipantDirectoryEntry => ({
  capabilityId: bundle.capability.id,
  capabilityName: bundle.capability.name,
  capabilityKind: (bundle.capability.capabilityKind ||
    'CORE') as CapabilityKind,
  agent,
});

const dedupeIds = (items: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const value = String(item || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
};

const fetchSharedReferenceCapabilities = async (
  collectionCapabilityId: string,
): Promise<string[]> => {
  const result = await query<{ member_capability_id: string }>(
    `
      SELECT member_capability_id
      FROM capability_shared_references
      WHERE collection_capability_id = $1
    `,
    [collectionCapabilityId],
  );
  return result.rows.map(row => row.member_capability_id);
};

const fetchDirectChildrenCapabilities = async (
  parentCapabilityId: string,
): Promise<string[]> => {
  const result = await query<{ id: string }>(
    `SELECT id FROM capabilities WHERE parent_capability_id = $1`,
    [parentCapabilityId],
  );
  return result.rows.map(row => row.id);
};

const resolveLinkedCapabilityMap = async (
  anchorCapabilityId: string,
): Promise<LinkedCapabilityResolution> => {
  const anchorBundle = await getCapabilityBundle(anchorCapabilityId);
  const [children, shared] = await Promise.all([
    fetchDirectChildrenCapabilities(anchorCapabilityId),
    fetchSharedReferenceCapabilities(anchorCapabilityId),
  ]);

  const bucketByCapabilityId = new Map<string, LinkedCapabilityBucket>();
  bucketByCapabilityId.set(anchorCapabilityId, 'current');

  for (const id of dedupeIds([anchorBundle.capability.parentCapabilityId])) {
    if (id !== anchorCapabilityId) {
      bucketByCapabilityId.set(id, 'parent');
    }
  }
  for (const id of dedupeIds(children)) {
    if (id !== anchorCapabilityId && !bucketByCapabilityId.has(id)) {
      bucketByCapabilityId.set(id, 'children');
    }
  }
  for (const id of dedupeIds(shared)) {
    if (id !== anchorCapabilityId && !bucketByCapabilityId.has(id)) {
      bucketByCapabilityId.set(id, 'shared');
    }
  }

  return {
    anchorBundle,
    bucketByCapabilityId,
  };
};

const loadAuthorizedBucket = async ({
  actor,
  capabilityIds,
  bucket,
}: {
  actor?: ActorContext | null;
  capabilityIds: string[];
  bucket: Exclude<LinkedCapabilityBucket, 'current'>;
}): Promise<ChatParticipantDirectoryEntry[]> => {
  const entries: ChatParticipantDirectoryEntry[] = [];
  for (const capabilityId of capabilityIds) {
    try {
      await assertCapabilityPermission({
        capabilityId,
        actor,
        action: 'chat.participate',
      });
      const bundle = await getCapabilityBundle(capabilityId);
      for (const agent of bundle.workspace.agents || []) {
        entries.push(toAgentEntry(bundle, agent));
      }
    } catch {
      // Ignore unauthorized or deleted capabilities so the directory
      // only exposes participants the actor can actually use.
    }
  }
  return entries;
};

export const buildAuthorizedParticipantDirectory = async ({
  anchorCapabilityId,
  actor,
}: {
  anchorCapabilityId: string;
  actor?: ActorContext | null;
}): Promise<ChatParticipantDirectory> => {
  const { anchorBundle, bucketByCapabilityId } =
    await resolveLinkedCapabilityMap(anchorCapabilityId);

  const current = (anchorBundle.workspace.agents || []).map(agent =>
    toAgentEntry(anchorBundle, agent),
  );

  const parentIds: string[] = [];
  const childIds: string[] = [];
  const sharedIds: string[] = [];
  for (const [capabilityId, bucket] of bucketByCapabilityId.entries()) {
    if (capabilityId === anchorCapabilityId) continue;
    if (bucket === 'parent') parentIds.push(capabilityId);
    if (bucket === 'children') childIds.push(capabilityId);
    if (bucket === 'shared') sharedIds.push(capabilityId);
  }

  const [parent, children, shared] = await Promise.all([
    loadAuthorizedBucket({
      actor,
      capabilityIds: parentIds,
      bucket: 'parent',
    }),
    loadAuthorizedBucket({
      actor,
      capabilityIds: childIds,
      bucket: 'children',
    }),
    loadAuthorizedBucket({
      actor,
      capabilityIds: sharedIds,
      bucket: 'shared',
    }),
  ]);

  return {
    current,
    parent,
    children,
    shared,
  };
};

export const resolveAuthorizedSwarmParticipants = async ({
  anchorCapabilityId,
  actor,
  participants,
}: {
  anchorCapabilityId: string;
  actor?: ActorContext | null;
  participants: Array<{ capabilityId: string; agentId: string }>;
}): Promise<ResolvedSwarmParticipant[]> => {
  const { anchorBundle, bucketByCapabilityId } =
    await resolveLinkedCapabilityMap(anchorCapabilityId);

  const output: ResolvedSwarmParticipant[] = [];
  for (const participant of participants) {
    const capabilityId = String(participant.capabilityId || '').trim();
    const agentId = String(participant.agentId || '').trim();
    if (!capabilityId || !agentId) continue;

    const bucket = bucketByCapabilityId.get(capabilityId);
    if (!bucket) {
      throw new Error(
        `Forbidden: capability ${capabilityId} is not linked to ${anchorCapabilityId}.`,
      );
    }

    const bundle =
      capabilityId === anchorCapabilityId
        ? anchorBundle
        : await (async () => {
            await assertCapabilityPermission({
              capabilityId,
              actor,
              action: 'chat.participate',
            });
            return getCapabilityBundle(capabilityId);
          })();

    const agent = (bundle.workspace.agents || []).find(
      current => current.id === agentId,
    );
    if (!agent) {
      throw new Error(
        `Agent ${agentId} not found in capability ${capabilityId}.`,
      );
    }

    output.push({
      capabilityId,
      agentId,
      bucket,
      bundle,
      agent,
    });
  }

  return output;
};

