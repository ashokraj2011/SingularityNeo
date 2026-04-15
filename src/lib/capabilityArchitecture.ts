import type {
  Capability,
  CapabilityAlmExportPayload,
  CapabilityCollectionKind,
  CapabilityContractDraft,
  CapabilityDependency,
  CapabilityDependencyCriticality,
  CapabilityDependencyKind,
  CapabilityHierarchyNode,
  CapabilityKind,
  CapabilityPublishedSnapshot,
  CapabilitySharedReference,
  CapabilityRollupChildSummary,
  CapabilityRollupSummary,
  CapabilityRollupWarning,
  FunctionalRequirementRecord,
  NonFunctionalRequirementRecord,
  ApiContractReference,
  SoftwareVersionRecord,
  CapabilityAlmReference,
  CapabilityContractSection,
  CapabilityMetadataEntry,
} from '../types';

const STALE_PUBLISH_AGE_DAYS = 30;

const asTrimmed = (value?: string | null) => String(value || '').trim();

const asArray = <T>(value: T[] | undefined | null): T[] => (Array.isArray(value) ? value : []);

const uniqueStrings = (values: Array<string | undefined | null>) =>
  [...new Set(values.map(value => asTrimmed(value)).filter(Boolean))];

export const createEmptyCapabilityContractDraft = (): CapabilityContractDraft => ({
  overview: '',
  businessIntent: '',
  ownershipModel: '',
  deploymentFootprint: '',
  evidenceAndReadiness: '',
  functionalRequirements: [],
  nonFunctionalRequirements: [],
  apiContracts: [],
  softwareVersions: [],
  almReferences: [],
  sections: [],
  additionalMetadata: [],
});

export const normalizeCapabilityKind = (
  kind?: string | null,
  collectionKind?: string | null,
): CapabilityKind => {
  if (kind === 'COLLECTION') {
    return 'COLLECTION';
  }
  if (collectionKind) {
    return 'COLLECTION';
  }
  return 'DELIVERY';
};

export const normalizeCapabilityCollectionKind = (
  value?: string | null,
): CapabilityCollectionKind | undefined => {
  const candidate = asTrimmed(value) as CapabilityCollectionKind;
  return candidate ? candidate : undefined;
};

const normalizeContractMetadataEntries = (
  entries?: CapabilityMetadataEntry[] | null,
): CapabilityMetadataEntry[] =>
  asArray(entries)
    .map(entry => ({
      key: asTrimmed(entry?.key),
      value: asTrimmed(entry?.value),
    }))
    .filter(entry => entry.key || entry.value);

const normalizeFunctionalRequirements = (
  items?: FunctionalRequirementRecord[] | null,
): FunctionalRequirementRecord[] =>
  asArray(items)
    .map((item, index) => ({
      id: asTrimmed(item?.id) || `FR-${index + 1}`,
      title: asTrimmed(item?.title) || `Requirement ${index + 1}`,
      description: asTrimmed(item?.description),
      priority: item?.priority,
      status: item?.status,
      linkedArtifactIds: uniqueStrings(item?.linkedArtifactIds || []),
    }))
    .filter(item => item.title || item.description);

const normalizeNonFunctionalRequirements = (
  items?: NonFunctionalRequirementRecord[] | null,
): NonFunctionalRequirementRecord[] =>
  asArray(items)
    .map((item, index) => ({
      id: asTrimmed(item?.id) || `NFR-${index + 1}`,
      category: item?.category || 'OTHER',
      title: asTrimmed(item?.title) || `Constraint ${index + 1}`,
      description: asTrimmed(item?.description),
      target: asTrimmed(item?.target) || undefined,
    }))
    .filter(item => item.title || item.description);

const normalizeApiContracts = (
  items?: ApiContractReference[] | null,
): ApiContractReference[] =>
  asArray(items)
    .map((item, index) => ({
      id: asTrimmed(item?.id) || `API-${index + 1}`,
      name: asTrimmed(item?.name) || `Interface ${index + 1}`,
      kind: item?.kind,
      version: asTrimmed(item?.version) || undefined,
      provider: asTrimmed(item?.provider) || undefined,
      consumer: asTrimmed(item?.consumer) || undefined,
      pathOrChannel: asTrimmed(item?.pathOrChannel) || undefined,
      description: asTrimmed(item?.description) || undefined,
    }))
    .filter(item => item.name);

const normalizeSoftwareVersions = (
  items?: SoftwareVersionRecord[] | null,
): SoftwareVersionRecord[] =>
  asArray(items)
    .map((item, index) => ({
      id: asTrimmed(item?.id) || `SW-${index + 1}`,
      name: asTrimmed(item?.name) || `Component ${index + 1}`,
      version: asTrimmed(item?.version) || 'unversioned',
      role: asTrimmed(item?.role) || undefined,
      repository: asTrimmed(item?.repository) || undefined,
      environment: asTrimmed(item?.environment) || undefined,
      notes: asTrimmed(item?.notes) || undefined,
    }))
    .filter(item => item.name);

const normalizeAlmReferences = (
  items?: CapabilityAlmReference[] | null,
): CapabilityAlmReference[] =>
  asArray(items)
    .map((item, index) => ({
      id: asTrimmed(item?.id) || `ALM-${index + 1}`,
      system: item?.system || 'OTHER',
      label: asTrimmed(item?.label) || `Reference ${index + 1}`,
      url: asTrimmed(item?.url) || undefined,
      externalId: asTrimmed(item?.externalId) || undefined,
      description: asTrimmed(item?.description) || undefined,
    }))
    .filter(item => item.label);

const normalizeContractSections = (
  items?: CapabilityContractSection[] | null,
): CapabilityContractSection[] =>
  asArray(items)
    .map((item, index) => ({
      id: asTrimmed(item?.id) || `SECTION-${index + 1}`,
      title: asTrimmed(item?.title) || `Section ${index + 1}`,
      summary: asTrimmed(item?.summary) || undefined,
      body: asTrimmed(item?.body) || undefined,
      items: uniqueStrings(item?.items || []),
      references: uniqueStrings(item?.references || []),
    }))
    .filter(item => item.title || item.body || (item.items || []).length > 0);

export const normalizeCapabilityContractDraft = (
  draft?: Partial<CapabilityContractDraft> | null,
): CapabilityContractDraft => ({
  overview: asTrimmed(draft?.overview),
  businessIntent: asTrimmed(draft?.businessIntent),
  ownershipModel: asTrimmed(draft?.ownershipModel),
  deploymentFootprint: asTrimmed(draft?.deploymentFootprint),
  evidenceAndReadiness: asTrimmed(draft?.evidenceAndReadiness),
  functionalRequirements: normalizeFunctionalRequirements(draft?.functionalRequirements),
  nonFunctionalRequirements: normalizeNonFunctionalRequirements(draft?.nonFunctionalRequirements),
  apiContracts: normalizeApiContracts(draft?.apiContracts),
  softwareVersions: normalizeSoftwareVersions(draft?.softwareVersions),
  almReferences: normalizeAlmReferences(draft?.almReferences),
  sections: normalizeContractSections(draft?.sections),
  additionalMetadata: normalizeContractMetadataEntries(draft?.additionalMetadata),
  lastEditedAt: asTrimmed(draft?.lastEditedAt) || undefined,
  lastEditedBy: asTrimmed(draft?.lastEditedBy) || undefined,
});

export const normalizeCapabilityDependencyKind = (
  value?: string | null,
): CapabilityDependencyKind => {
  const candidate = asTrimmed(value) as CapabilityDependencyKind;
  return candidate || 'FUNCTIONAL';
};

export const normalizeCapabilityDependencyCriticality = (
  value?: string | null,
): CapabilityDependencyCriticality => {
  const candidate = asTrimmed(value) as CapabilityDependencyCriticality;
  return candidate || 'MEDIUM';
};

export const normalizeCapabilityDependency = (
  capabilityId: string,
  dependency: Partial<CapabilityDependency>,
  index = 0,
): CapabilityDependency | null => {
  const targetCapabilityId = asTrimmed(dependency.targetCapabilityId);
  const description = asTrimmed(dependency.description);
  if (!targetCapabilityId && !description) {
    return null;
  }

  return {
    id: asTrimmed(dependency.id) || `DEP-${capabilityId}-${index + 1}`,
    capabilityId,
    targetCapabilityId,
    dependencyKind: normalizeCapabilityDependencyKind(dependency.dependencyKind),
    description,
    criticality: normalizeCapabilityDependencyCriticality(dependency.criticality),
    versionConstraint: asTrimmed(dependency.versionConstraint) || undefined,
  };
};

export const normalizeCapabilityDependencies = (
  capabilityId: string,
  dependencies?: CapabilityDependency[] | null,
): CapabilityDependency[] =>
  asArray(dependencies)
    .map((dependency, index) =>
      normalizeCapabilityDependency(capabilityId, dependency, index),
    )
    .filter(Boolean) as CapabilityDependency[];

export const normalizeCapabilitySharedReference = (
  collectionCapabilityId: string,
  reference: Partial<CapabilitySharedReference>,
  index = 0,
): CapabilitySharedReference | null => {
  const memberCapabilityId = asTrimmed(reference.memberCapabilityId);
  if (!memberCapabilityId) {
    return null;
  }

  return {
    id: asTrimmed(reference.id) || `SHARED-${collectionCapabilityId}-${index + 1}`,
    collectionCapabilityId,
    memberCapabilityId,
    label: asTrimmed(reference.label) || undefined,
  };
};

export const normalizeCapabilitySharedReferences = (
  collectionCapabilityId: string,
  references?: CapabilitySharedReference[] | null,
): CapabilitySharedReference[] => {
  const seenMemberIds = new Set<string>();
  return asArray(references)
    .map((reference, index) =>
      normalizeCapabilitySharedReference(collectionCapabilityId, reference, index),
    )
    .filter((reference): reference is CapabilitySharedReference => {
      if (!reference) {
        return false;
      }
      if (reference.memberCapabilityId === collectionCapabilityId) {
        return false;
      }
      if (seenMemberIds.has(reference.memberCapabilityId)) {
        return false;
      }
      seenMemberIds.add(reference.memberCapabilityId);
      return true;
    });
};

export const normalizeCapabilityPublishedSnapshot = (
  capabilityId: string,
  snapshot: Partial<CapabilityPublishedSnapshot>,
  index = 0,
): CapabilityPublishedSnapshot | null => {
  const publishedAt = asTrimmed(snapshot.publishedAt);
  const publishedBy = asTrimmed(snapshot.publishedBy);
  const publishVersion =
    typeof snapshot.publishVersion === 'number' && Number.isFinite(snapshot.publishVersion)
      ? snapshot.publishVersion
      : Number(snapshot.publishVersion || index + 1) || index + 1;

  if (!publishedAt && !publishedBy && !snapshot.contract) {
    return null;
  }

  return {
    id: asTrimmed(snapshot.id) || `PUB-${capabilityId}-${publishVersion}`,
    capabilityId,
    publishVersion,
    publishedAt: publishedAt || new Date().toISOString(),
    publishedBy: publishedBy || 'Capability Owner',
    supersedesSnapshotId: asTrimmed(snapshot.supersedesSnapshotId) || undefined,
    contract: normalizeCapabilityContractDraft(snapshot.contract),
  };
};

export const normalizeCapabilityPublishedSnapshots = (
  capabilityId: string,
  snapshots?: CapabilityPublishedSnapshot[] | null,
): CapabilityPublishedSnapshot[] =>
  asArray(snapshots)
    .map((snapshot, index) =>
      normalizeCapabilityPublishedSnapshot(capabilityId, snapshot, index),
    )
    .filter(Boolean)
    .sort((left, right) => right!.publishVersion - left!.publishVersion) as CapabilityPublishedSnapshot[];

export const getLatestCapabilityPublishedSnapshot = (
  capability?: Partial<Capability> | null,
): CapabilityPublishedSnapshot | undefined =>
  normalizeCapabilityPublishedSnapshots(
    asTrimmed(capability?.id),
    capability?.publishedSnapshots || [],
  )[0];

const buildChildrenIndex = (capabilities: Capability[]) => {
  const childrenByParent = new Map<string, Capability[]>();
  capabilities.forEach(capability => {
    const parentId = asTrimmed(capability.parentCapabilityId);
    if (!parentId) {
      return;
    }
    const bucket = childrenByParent.get(parentId) || [];
    bucket.push(capability);
    childrenByParent.set(parentId, bucket);
  });
  return childrenByParent;
};

const getCapabilityMap = (capabilities: Capability[]) =>
  new Map(capabilities.map(capability => [capability.id, capability] as const));

const collectDescendantIds = (
  capabilityId: string,
  childrenByParent: Map<string, Capability[]>,
): string[] => {
  const descendantIds: string[] = [];
  const queue = [...(childrenByParent.get(capabilityId) || []).map(capability => capability.id)];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || seen.has(currentId)) {
      continue;
    }
    seen.add(currentId);
    descendantIds.push(currentId);
    (childrenByParent.get(currentId) || []).forEach(child => {
      if (!seen.has(child.id)) {
        queue.push(child.id);
      }
    });
  }

  return descendantIds;
};

const buildHierarchyPath = (
  capability: Capability,
  capabilityById: Map<string, Capability>,
): { pathIds: string[]; pathLabels: string[]; hasCycle: boolean; missingParentId?: string } => {
  const ids: string[] = [];
  const labels: string[] = [];
  const visited = new Set<string>();
  let current: Capability | undefined = capability;
  let missingParentId: string | undefined;
  let hasCycle = false;

  while (current) {
    if (visited.has(current.id)) {
      hasCycle = true;
      break;
    }
    visited.add(current.id);
    ids.unshift(current.id);
    labels.unshift(current.name);
    const parentId = asTrimmed(current.parentCapabilityId);
    if (!parentId) {
      break;
    }
    const parent = capabilityById.get(parentId);
    if (!parent) {
      missingParentId = parentId;
      break;
    }
    current = parent;
  }

  return { pathIds: ids, pathLabels: labels, hasCycle, missingParentId };
};

const buildParentExpectationSummary = (
  snapshot?: CapabilityPublishedSnapshot,
): string[] => {
  if (!snapshot) {
    return [];
  }

  const summary = uniqueStrings([
    snapshot.contract.businessIntent,
    snapshot.contract.overview,
    snapshot.contract.ownershipModel
      ? `Ownership: ${snapshot.contract.ownershipModel}`
      : undefined,
    snapshot.contract.deploymentFootprint
      ? `Deployment: ${snapshot.contract.deploymentFootprint}`
      : undefined,
    ...snapshot.contract.functionalRequirements
      .slice(0, 3)
      .map(item => `FR: ${item.title}${item.description ? ` - ${item.description}` : ''}`),
    ...snapshot.contract.nonFunctionalRequirements
      .slice(0, 2)
      .map(item => `NFR: ${item.title}${item.target ? ` (${item.target})` : ''}`),
  ]);

  return summary.slice(0, 6);
};

export const buildCapabilityHierarchyNode = (
  capability: Capability,
  capabilities: Capability[],
): CapabilityHierarchyNode => {
  const capabilityById = getCapabilityMap(capabilities);
  const childrenByParent = buildChildrenIndex(capabilities);
  const path = buildHierarchyPath(capability, capabilityById);
  const latestSnapshot = getLatestCapabilityPublishedSnapshot(capability);

  return {
    capabilityId: capability.id,
    name: capability.name,
    capabilityKind: normalizeCapabilityKind(
      capability.capabilityKind,
      capability.collectionKind,
    ),
    collectionKind: normalizeCapabilityCollectionKind(capability.collectionKind),
    parentCapabilityId: asTrimmed(capability.parentCapabilityId) || undefined,
    childIds: (childrenByParent.get(capability.id) || []).map(child => child.id),
    sharedCapabilityIds: normalizeCapabilitySharedReferences(
      capability.id,
      capability.sharedCapabilities,
    ).map(reference => reference.memberCapabilityId),
    depth: Math.max(0, path.pathIds.length - 1),
    pathIds: path.pathIds,
    pathLabels: path.pathLabels,
    latestPublishedVersion: latestSnapshot?.publishVersion,
    warningCount: 0,
  };
};

const isSnapshotStale = (snapshot?: CapabilityPublishedSnapshot, now = new Date()) => {
  if (!snapshot?.publishedAt) {
    return false;
  }
  const publishedAt = new Date(snapshot.publishedAt);
  if (Number.isNaN(publishedAt.getTime())) {
    return false;
  }
  const ageMs = now.getTime() - publishedAt.getTime();
  return ageMs > STALE_PUBLISH_AGE_DAYS * 24 * 60 * 60 * 1000;
};

export const buildCapabilityRollupSummary = (
  capability: Capability,
  capabilities: Capability[],
  now = new Date(),
): CapabilityRollupSummary => {
  const capabilityById = getCapabilityMap(capabilities);
  const childrenByParent = buildChildrenIndex(capabilities);
  const directChildren = childrenByParent.get(capability.id) || [];
  const sharedReferences = normalizeCapabilitySharedReferences(
    capability.id,
    capability.sharedCapabilities,
  );
  const sharedCapabilities = sharedReferences
    .map(reference => capabilityById.get(reference.memberCapabilityId))
    .filter(Boolean) as Capability[];
  const descendantIds = collectDescendantIds(capability.id, childrenByParent);
  const descendantCapabilities = descendantIds
    .map(id => capabilityById.get(id))
    .filter(Boolean) as Capability[];
  const scopeCapabilities = [
    capability,
    ...descendantCapabilities,
    ...sharedCapabilities.filter(
      sharedCapability =>
        sharedCapability.id !== capability.id &&
        !descendantCapabilities.some(item => item.id === sharedCapability.id),
    ),
  ];
  const warnings: CapabilityRollupWarning[] = [];

  const hierarchyPath = buildHierarchyPath(capability, capabilityById);
  if (hierarchyPath.hasCycle) {
    warnings.push({
      id: `WARN-CYCLE-${capability.id}`,
      severity: 'ERROR',
      kind: 'CYCLE',
      message: 'The architectural parent chain contains a cycle.',
      relatedCapabilityId: capability.id,
    });
  }
  if (hierarchyPath.missingParentId) {
    warnings.push({
      id: `WARN-PARENT-${capability.id}`,
      severity: 'ERROR',
      kind: 'INVALID_PARENT',
      message: `Parent capability ${hierarchyPath.missingParentId} could not be resolved.`,
      relatedCapabilityId: hierarchyPath.missingParentId,
    });
  }

  const directChildSummaries: CapabilityRollupChildSummary[] = directChildren.map(child => {
    const latestSnapshot = getLatestCapabilityPublishedSnapshot(child);
    const childWarnings = [];
    if (!latestSnapshot) {
      warnings.push({
        id: `WARN-MISSING-${child.id}`,
        severity: 'WARN',
        kind: 'MISSING_PUBLISH',
        message: `${child.name} has not published a capability contract yet.`,
        relatedCapabilityId: child.id,
      });
      childWarnings.push('missing');
    } else if (isSnapshotStale(latestSnapshot, now)) {
      warnings.push({
        id: `WARN-STALE-${child.id}`,
        severity: 'WARN',
        kind: 'STALE_PUBLISH',
        message: `${child.name} last published version ${latestSnapshot.publishVersion} on ${latestSnapshot.publishedAt}.`,
        relatedCapabilityId: child.id,
        relatedSnapshotId: latestSnapshot.id,
      });
      childWarnings.push('stale');
    }

    return {
      capabilityId: child.id,
      capabilityName: child.name,
      capabilityKind: normalizeCapabilityKind(child.capabilityKind, child.collectionKind),
      collectionKind: normalizeCapabilityCollectionKind(child.collectionKind),
      latestPublishedVersion: latestSnapshot?.publishVersion,
      latestPublishedAt: latestSnapshot?.publishedAt,
      dependencyCount: (child.dependencies || []).length,
      warningCount: childWarnings.length,
    };
  });

  const sharedCapabilitySummaries: CapabilityRollupChildSummary[] = sharedReferences.map(
    reference => {
      const sharedCapability = capabilityById.get(reference.memberCapabilityId);
      if (!sharedCapability) {
        warnings.push({
          id: `WARN-SHARED-${capability.id}-${reference.id}`,
          severity: 'WARN',
          kind: 'UNRESOLVED_DEPENDENCY',
          message: `${capability.name} references shared capability ${reference.memberCapabilityId}, but it could not be resolved.`,
          relatedCapabilityId: capability.id,
        });
        return {
          capabilityId: reference.memberCapabilityId,
          capabilityName: reference.label || reference.memberCapabilityId,
          capabilityKind: 'DELIVERY',
          dependencyCount: 0,
          warningCount: 1,
        };
      }

      const latestSnapshot = getLatestCapabilityPublishedSnapshot(sharedCapability);
      const sharedWarnings = [];
      if (!latestSnapshot) {
        warnings.push({
          id: `WARN-SHARED-MISSING-${sharedCapability.id}`,
          severity: 'WARN',
          kind: 'MISSING_PUBLISH',
          message: `${sharedCapability.name} is shared into ${capability.name} but has not published a contract yet.`,
          relatedCapabilityId: sharedCapability.id,
        });
        sharedWarnings.push('missing');
      } else if (isSnapshotStale(latestSnapshot, now)) {
        warnings.push({
          id: `WARN-SHARED-STALE-${sharedCapability.id}`,
          severity: 'WARN',
          kind: 'STALE_PUBLISH',
          message: `${sharedCapability.name} is shared into ${capability.name} with stale published version ${latestSnapshot.publishVersion}.`,
          relatedCapabilityId: sharedCapability.id,
          relatedSnapshotId: latestSnapshot.id,
        });
        sharedWarnings.push('stale');
      }

      return {
        capabilityId: sharedCapability.id,
        capabilityName: sharedCapability.name,
        capabilityKind: normalizeCapabilityKind(
          sharedCapability.capabilityKind,
          sharedCapability.collectionKind,
        ),
        collectionKind: normalizeCapabilityCollectionKind(sharedCapability.collectionKind),
        latestPublishedVersion: latestSnapshot?.publishVersion,
        latestPublishedAt: latestSnapshot?.publishedAt,
        dependencyCount: (sharedCapability.dependencies || []).length,
        warningCount: sharedWarnings.length,
      };
    },
  );

  const dependencyHeatmap = new Map<
    string,
    { targetCapabilityId: string; targetCapabilityName?: string; count: number; criticality: CapabilityDependencyCriticality }
  >();

  scopeCapabilities.forEach(sourceCapability => {
    normalizeCapabilityDependencies(sourceCapability.id, sourceCapability.dependencies).forEach(
      dependency => {
        const target = capabilityById.get(dependency.targetCapabilityId);
        if (!target) {
          warnings.push({
            id: `WARN-DEP-${sourceCapability.id}-${dependency.id}`,
            severity: dependency.criticality === 'CRITICAL' ? 'ERROR' : 'WARN',
            kind: 'UNRESOLVED_DEPENDENCY',
            message: `${sourceCapability.name} depends on missing capability ${dependency.targetCapabilityId}.`,
            relatedCapabilityId: sourceCapability.id,
          });
        } else if (
          dependency.versionConstraint &&
          String(getLatestCapabilityPublishedSnapshot(target)?.publishVersion || '') !==
            dependency.versionConstraint
        ) {
          warnings.push({
            id: `WARN-VERSION-${sourceCapability.id}-${dependency.id}`,
            severity: dependency.criticality === 'CRITICAL' ? 'ERROR' : 'WARN',
            kind: 'VERSION_MISMATCH',
            message: `${sourceCapability.name} expects ${target.name} version ${dependency.versionConstraint}, but the latest published version is ${getLatestCapabilityPublishedSnapshot(target)?.publishVersion || 'unpublished'}.`,
            relatedCapabilityId: target.id,
            relatedSnapshotId: getLatestCapabilityPublishedSnapshot(target)?.id,
          });
        }

        const current = dependencyHeatmap.get(dependency.targetCapabilityId);
        if (!current) {
          dependencyHeatmap.set(dependency.targetCapabilityId, {
            targetCapabilityId: dependency.targetCapabilityId,
            targetCapabilityName: target?.name,
            count: 1,
            criticality: dependency.criticality,
          });
          return;
        }

        current.count += 1;
        if (dependency.criticality === 'CRITICAL' || current.criticality === 'CRITICAL') {
          current.criticality = 'CRITICAL';
        } else if (dependency.criticality === 'HIGH' || current.criticality === 'HIGH') {
          current.criticality = 'HIGH';
        } else if (dependency.criticality === 'MEDIUM' || current.criticality === 'MEDIUM') {
          current.criticality = 'MEDIUM';
        } else {
          current.criticality = 'LOW';
        }
      },
    );
  });

  const latestSnapshot = getLatestCapabilityPublishedSnapshot(capability);
  const latestSnapshotsInScope = scopeCapabilities
    .map(item => getLatestCapabilityPublishedSnapshot(item))
    .filter(Boolean) as CapabilityPublishedSnapshot[];

  return {
    capabilityId: capability.id,
    directChildCount: directChildren.length,
    sharedCapabilityCount: sharedCapabilitySummaries.length,
    descendantCount: descendantCapabilities.length,
    dependencyCount: scopeCapabilities.reduce(
      (count, item) => count + normalizeCapabilityDependencies(item.id, item.dependencies).length,
      0,
    ),
    latestPublishedVersion: latestSnapshot?.publishVersion,
    latestPublishedAt: latestSnapshot?.publishedAt,
    missingPublishCount: warnings.filter(warning => warning.kind === 'MISSING_PUBLISH').length,
    stalePublishCount: warnings.filter(warning => warning.kind === 'STALE_PUBLISH').length,
    unresolvedDependencyCount: warnings.filter(
      warning => warning.kind === 'UNRESOLVED_DEPENDENCY',
    ).length,
    versionMismatchCount: warnings.filter(
      warning => warning.kind === 'VERSION_MISMATCH',
    ).length,
    directChildren: directChildSummaries,
    sharedCapabilities: sharedCapabilitySummaries,
    warnings,
    dependencyHeatmap: [...dependencyHeatmap.values()].sort((left, right) => right.count - left.count),
    functionalRequirementCount: latestSnapshotsInScope.reduce(
      (count, snapshot) => count + snapshot.contract.functionalRequirements.length,
      0,
    ),
    nonFunctionalRequirementCount: latestSnapshotsInScope.reduce(
      (count, snapshot) => count + snapshot.contract.nonFunctionalRequirements.length,
      0,
    ),
    apiContractCount: latestSnapshotsInScope.reduce(
      (count, snapshot) => count + snapshot.contract.apiContracts.length,
      0,
    ),
    softwareVersionCount: latestSnapshotsInScope.reduce(
      (count, snapshot) => count + snapshot.contract.softwareVersions.length,
      0,
    ),
  };
};

export const applyCapabilityArchitecture = (
  capabilities: Capability[],
  now = new Date(),
): Capability[] => {
  const normalized = capabilities.map(capability => ({
    ...capability,
    capabilityKind: normalizeCapabilityKind(
      capability.capabilityKind,
      capability.collectionKind,
    ),
    collectionKind: normalizeCapabilityCollectionKind(capability.collectionKind),
    dependencies: normalizeCapabilityDependencies(capability.id, capability.dependencies),
    sharedCapabilities: normalizeCapabilitySharedReferences(
      capability.id,
      capability.sharedCapabilities,
    ),
    contractDraft: normalizeCapabilityContractDraft(capability.contractDraft),
    publishedSnapshots: normalizeCapabilityPublishedSnapshots(
      capability.id,
      capability.publishedSnapshots,
    ),
  }));
  const capabilityById = getCapabilityMap(normalized);

  return normalized.map(capability => {
    let parentPublishedSnapshot: CapabilityPublishedSnapshot | undefined;
    let cursorId = asTrimmed(capability.parentCapabilityId);
    const visited = new Set<string>();
    while (cursorId && !visited.has(cursorId)) {
      visited.add(cursorId);
      const parent = capabilityById.get(cursorId);
      if (!parent) {
        break;
      }
      const latestParentSnapshot = getLatestCapabilityPublishedSnapshot(parent);
      if (latestParentSnapshot) {
        parentPublishedSnapshot = latestParentSnapshot;
        break;
      }
      cursorId = asTrimmed(parent.parentCapabilityId);
    }

    const hierarchyNode = buildCapabilityHierarchyNode(capability, normalized);
    const rollupSummary = buildCapabilityRollupSummary(capability, normalized, now);
    return {
      ...capability,
      parentPublishedSnapshot,
      parentExpectationSummary: buildParentExpectationSummary(parentPublishedSnapshot),
      hierarchyNode: {
        ...hierarchyNode,
        warningCount: rollupSummary.warnings.length,
      },
      rollupSummary,
    };
  });
};

export const buildCapabilityAlmExport = (
  capability: Capability,
  capabilities: Capability[],
): CapabilityAlmExportPayload => {
  const [enrichedCapability] = applyCapabilityArchitecture(capabilities).filter(
    item => item.id === capability.id,
  );
  const fallbackCapability =
    enrichedCapability ||
    applyCapabilityArchitecture(capabilities).find(item => item.id === capability.id) ||
    capability;

  return {
    capabilityId: fallbackCapability.id,
    capabilityName: fallbackCapability.name,
    capabilityKind: normalizeCapabilityKind(
      fallbackCapability.capabilityKind,
      fallbackCapability.collectionKind,
    ),
    collectionKind: normalizeCapabilityCollectionKind(fallbackCapability.collectionKind),
    hierarchy:
      fallbackCapability.hierarchyNode ||
      buildCapabilityHierarchyNode(fallbackCapability, capabilities),
    latestPublishedSnapshot: getLatestCapabilityPublishedSnapshot(fallbackCapability),
    dependencies: normalizeCapabilityDependencies(
      fallbackCapability.id,
      fallbackCapability.dependencies,
    ),
    rollupSummary:
      fallbackCapability.rollupSummary ||
      buildCapabilityRollupSummary(fallbackCapability, capabilities),
  };
};
