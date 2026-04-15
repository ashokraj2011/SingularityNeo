import { describe, expect, it } from 'vitest';
import { createDefaultCapabilityLifecycle } from '../capabilityLifecycle';
import {
  applyCapabilityArchitecture,
  buildCapabilityAlmExport,
} from '../capabilityArchitecture';
import type { Capability } from '../../types';

const baseCapability = (overrides: Partial<Capability> = {}): Capability => ({
  id: 'CAP-BASE',
  name: 'Base Capability',
  description: 'Architecture test capability.',
  capabilityKind: 'DELIVERY',
  businessOutcome: 'Provide a stable delivery surface.',
  successMetrics: [],
  requiredEvidenceKinds: [],
  applications: [],
  apis: [],
  databases: [],
  gitRepositories: [],
  localDirectories: [],
  repositories: [],
  teamNames: [],
  stakeholders: [],
  additionalMetadata: [],
  dependencies: [],
  contractDraft: {
    overview: 'Stable contract.',
    functionalRequirements: [],
    nonFunctionalRequirements: [],
    apiContracts: [],
    softwareVersions: [],
    almReferences: [],
    sections: [],
    additionalMetadata: [],
  },
  publishedSnapshots: [],
  lifecycle: createDefaultCapabilityLifecycle(),
  executionConfig: {
    allowedWorkspacePaths: [],
    commandTemplates: [],
    deploymentTargets: [],
  },
  status: 'STABLE',
  skillLibrary: [],
  ...overrides,
});

describe('capabilityArchitecture', () => {
  it('builds hierarchy rollups from published child snapshots', () => {
    const parent = baseCapability({
      id: 'CAP-PARENT',
      name: 'Payments Domain',
      capabilityKind: 'COLLECTION',
      collectionKind: 'BUSINESS_DOMAIN',
    });
    const child = baseCapability({
      id: 'CAP-CHILD',
      name: 'Payments API',
      parentCapabilityId: 'CAP-PARENT',
      publishedSnapshots: [
        {
          id: 'PUB-1',
          capabilityId: 'CAP-CHILD',
          publishVersion: 1,
          publishedAt: '2026-04-10T00:00:00.000Z',
          publishedBy: 'Owner',
          contract: {
            overview: 'Payments API contract',
            businessIntent: 'Expose payment orchestration.',
            functionalRequirements: [
              {
                id: 'FR-1',
                title: 'Provide charge endpoint',
                description: 'Charge requests must be accepted.',
              },
            ],
            nonFunctionalRequirements: [],
            apiContracts: [
              {
                id: 'API-1',
                name: 'Charges API',
                kind: 'REST',
              },
            ],
            softwareVersions: [],
            almReferences: [],
            sections: [],
            additionalMetadata: [],
          },
        },
      ],
    });

    const [enrichedParent] = applyCapabilityArchitecture([parent, child]).filter(
      capability => capability.id === 'CAP-PARENT',
    );

    expect(enrichedParent.rollupSummary?.directChildCount).toBe(1);
    expect(enrichedParent.rollupSummary?.missingPublishCount).toBe(0);
    expect(enrichedParent.rollupSummary?.functionalRequirementCount).toBe(1);
    expect(enrichedParent.rollupSummary?.apiContractCount).toBe(1);
  });

  it('keeps draft edits out of ALM export until a snapshot exists', () => {
    const capability = baseCapability({
      id: 'CAP-ALM',
      name: 'ALM Capability',
      contractDraft: {
        overview: 'Draft only',
        functionalRequirements: [
          {
            id: 'FR-1',
            title: 'Draft requirement',
            description: 'Not published yet',
          },
        ],
        nonFunctionalRequirements: [],
        apiContracts: [],
        softwareVersions: [],
        almReferences: [],
        sections: [],
        additionalMetadata: [],
      },
      publishedSnapshots: [],
    });

    const [enriched] = applyCapabilityArchitecture([capability]);
    const almExport = buildCapabilityAlmExport(enriched, [enriched]);

    expect(almExport.latestPublishedSnapshot).toBeUndefined();
    expect(almExport.rollupSummary.latestPublishedVersion).toBeUndefined();
  });

  it('tracks shared capability references separately from direct children', () => {
    const collection = baseCapability({
      id: 'CAP-COLLECTION',
      name: 'Enterprise Payments',
      capabilityKind: 'COLLECTION',
      collectionKind: 'ENTERPRISE_LAYER',
      sharedCapabilities: [
        {
          id: 'SHARED-1',
          collectionCapabilityId: 'CAP-COLLECTION',
          memberCapabilityId: 'CAP-SHARED',
        },
      ],
    });
    const sharedCapability = baseCapability({
      id: 'CAP-SHARED',
      name: 'Identity Platform',
      publishedSnapshots: [
        {
          id: 'PUB-SHARED-1',
          capabilityId: 'CAP-SHARED',
          publishVersion: 2,
          publishedAt: '2026-04-11T00:00:00.000Z',
          publishedBy: 'Owner',
          contract: {
            overview: 'Identity platform contract',
            functionalRequirements: [],
            nonFunctionalRequirements: [],
            apiContracts: [],
            softwareVersions: [],
            almReferences: [],
            sections: [],
            additionalMetadata: [],
          },
        },
      ],
    });

    const [enrichedCollection] = applyCapabilityArchitecture([
      collection,
      sharedCapability,
    ]).filter(capability => capability.id === 'CAP-COLLECTION');

    expect(enrichedCollection.rollupSummary?.directChildCount).toBe(0);
    expect(enrichedCollection.rollupSummary?.sharedCapabilityCount).toBe(1);
    expect(enrichedCollection.rollupSummary?.sharedCapabilities[0]?.capabilityId).toBe(
      'CAP-SHARED',
    );
    expect(enrichedCollection.hierarchyNode?.sharedCapabilityIds).toEqual(['CAP-SHARED']);
  });
});
