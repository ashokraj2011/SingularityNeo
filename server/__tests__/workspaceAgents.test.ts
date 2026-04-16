import { describe, expect, it } from 'vitest';
import { createDefaultCapabilityLifecycle } from '../../src/lib/capabilityLifecycle';
import type { Capability } from '../../src/types';
import { buildBuiltInAgents } from '../workspace';

const buildCapability = (overrides: Partial<Capability> = {}): Capability => ({
  id: 'CAP-TEST',
  name: 'Test Capability',
  description: 'Capability used for built-in agent tests.',
  capabilityKind: 'DELIVERY',
  businessOutcome: '',
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
  sharedCapabilities: [],
  contractDraft: {
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
  },
  publishedSnapshots: [],
  lifecycle: createDefaultCapabilityLifecycle(),
  executionConfig: {
    allowedWorkspacePaths: [],
    commandTemplates: [],
    deploymentTargets: [],
  },
  status: 'PENDING',
  skillLibrary: [],
  ...overrides,
});

describe('workspace built-in agents', () => {
  it('uses the architecture-focused built-in roster for collection capabilities', () => {
    const capability = buildCapability({
      capabilityKind: 'COLLECTION',
      collectionKind: 'BUSINESS_DOMAIN',
    });

    const builtInKeys = buildBuiltInAgents(capability).map(agent => agent.standardTemplateKey);

    expect(builtInKeys).toEqual([
      'PLANNING',
      'ARCHITECT',
      'BUSINESS-ANALYST',
      'VALIDATION',
    ]);
  });

  it('keeps the full delivery built-in roster for delivery capabilities', () => {
    const capability = buildCapability();

    const builtInKeys = buildBuiltInAgents(capability).map(agent => agent.standardTemplateKey);

    expect(builtInKeys).toContain('SOFTWARE-DEVELOPER');
    expect(builtInKeys).toContain('QA');
    expect(builtInKeys).toContain('DEVOPS');
    expect(builtInKeys).toContain('EXECUTION-OPS');
    expect(builtInKeys).toContain('CONTRARIAN-REVIEWER');
  });
});
