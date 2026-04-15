import type {
  Capability,
  CapabilityBriefing,
  CapabilityBriefingSection,
  CapabilityMetadataEntry,
  CapabilityStakeholder,
} from '../types';
import { getLatestCapabilityPublishedSnapshot } from './capabilityArchitecture';

const hasText = (value?: string | null) => Boolean(String(value || '').trim());

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

const truncate = (value: string, limit = 220) => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
};

const toList = (values?: Array<string | null | undefined>) =>
  unique((values || []).map(value => String(value || '').trim()).filter(Boolean));

const formatStakeholder = (stakeholder: CapabilityStakeholder) =>
  [
    stakeholder.role || 'Stakeholder',
    stakeholder.name || 'Unknown',
    stakeholder.teamName ? `team ${stakeholder.teamName}` : null,
  ]
    .filter(Boolean)
    .join(' • ');

const summarizeMetadataEntries = (entries?: CapabilityMetadataEntry[]) =>
  (entries || [])
    .filter(entry => hasText(entry.key) || hasText(entry.value))
    .map(entry => `${entry.key || 'Metadata'}: ${entry.value || ''}`)
    .slice(0, 5);

const buildBriefingSection = ({
  id,
  label,
  items,
  tone,
}: {
  id: string;
  label: string;
  items: string[];
  tone?: CapabilityBriefingSection['tone'];
}): CapabilityBriefingSection | null => {
  const normalizedItems = toList(items);
  if (normalizedItems.length === 0) {
    return null;
  }

  return {
    id,
    label,
    summary: truncate(normalizedItems.join(' • '), 180),
    items: normalizedItems,
    tone,
  };
};

export const buildCapabilityBriefing = (
  capability: Partial<Capability>,
): CapabilityBriefing => {
  const latestPublishedSnapshot = getLatestCapabilityPublishedSnapshot(capability);
  const outcome = capability.businessOutcome?.trim() || 'Outcome contract is not defined yet.';
  const purpose =
    capability.description?.trim() ||
    `Operate ${capability.name || 'this capability'} with clear workflow, evidence, and agent context.`;
  const evidencePriorities = toList(capability.requiredEvidenceKinds || []);
  const stakeholderSummary = (capability.stakeholders || [])
    .filter(stakeholder =>
      hasText(stakeholder.role) || hasText(stakeholder.name) || hasText(stakeholder.teamName),
    )
    .map(formatStakeholder);
  const linkedSystems = toList([
    ...(capability.applications || []),
    ...(capability.apis || []),
    ...(capability.databases || []),
  ]);
  const repoSummary = toList([
    ...((capability.repositories || []).flatMap(repository => [
      repository.label
        ? `${repository.label}${repository.defaultBranch ? ` (${repository.defaultBranch})` : ''}`
        : null,
      repository.localRootHint ? `Local root: ${repository.localRootHint}` : null,
      repository.url || null,
    ]) as string[]),
    ...(capability.gitRepositories || []),
    ...(capability.localDirectories || []),
    capability.executionConfig?.defaultWorkspacePath,
    ...(capability.executionConfig?.allowedWorkspacePaths || []),
  ]);
  const commandSummary = (capability.executionConfig?.commandTemplates || [])
    .filter(
      template =>
        hasText(template.label) ||
        (Array.isArray(template.command) && template.command.some(part => hasText(part))),
    )
    .map(template => template.label || template.command.join(' '))
    .slice(0, 6);
  const deploymentSummary = (capability.executionConfig?.deploymentTargets || [])
    .filter(target => hasText(target.label))
    .map(target => target.label)
    .slice(0, 6);
  const activeConstraints = toList([
    capability.capabilityKind === 'COLLECTION'
      ? 'Collection node: architecture and planning only, not an execution lane.'
      : null,
    capability.operatingPolicySummary,
    capability.definitionOfDone
      ? `Definition of done: ${capability.definitionOfDone}`
      : null,
    evidencePriorities.length > 0
      ? `Required evidence: ${evidencePriorities.join(', ')}`
      : null,
    repoSummary.length > 0
      ? `Approved delivery roots: ${repoSummary.slice(0, 4).join(', ')}`
      : null,
    commandSummary.length > 0
      ? `Execution commands available: ${commandSummary.join(', ')}`
      : null,
  ]);
  const hierarchyLabel = capability.hierarchyNode?.pathLabels?.length
    ? capability.hierarchyNode.pathLabels.join(' / ')
    : capability.parentCapabilityId
    ? `Child of ${capability.parentCapabilityId}`
    : undefined;
  const parentCapabilityName =
    capability.hierarchyNode && capability.hierarchyNode.pathLabels.length > 1
      ? capability.hierarchyNode.pathLabels[capability.hierarchyNode.pathLabels.length - 2]
      : undefined;
  const dependencySummary = (capability.dependencies || [])
    .filter(dependency => hasText(dependency.targetCapabilityId) || hasText(dependency.description))
    .map(
      dependency =>
        `${dependency.dependencyKind}: ${dependency.targetCapabilityId}${
          dependency.versionConstraint ? ` @ ${dependency.versionConstraint}` : ''
        }${dependency.description ? ` — ${dependency.description}` : ''}`,
    )
    .slice(0, 8);
  const parentExpectations = toList(capability.parentExpectationSummary || []);
  const sharedCapabilitySummary = toList(
    (capability.sharedCapabilities || []).map(reference =>
      reference.label
        ? `Shared capability: ${reference.label}`
        : `Shared capability id: ${reference.memberCapabilityId}`,
    ),
  );

  const sections = [
    buildBriefingSection({
      id: 'architecture',
      label: 'Architecture position',
      tone: capability.capabilityKind === 'COLLECTION' ? 'warning' : 'info',
      items: [
        capability.capabilityKind
          ? `Capability kind: ${capability.capabilityKind}`
          : null,
        capability.collectionKind
          ? `Collection kind: ${capability.collectionKind}`
          : null,
        hierarchyLabel ? `Hierarchy: ${hierarchyLabel}` : null,
        parentCapabilityName ? `Parent: ${parentCapabilityName}` : null,
        ...(sharedCapabilitySummary.length > 0
          ? sharedCapabilitySummary
          : []),
        latestPublishedSnapshot
          ? `Latest published contract: v${latestPublishedSnapshot.publishVersion} on ${latestPublishedSnapshot.publishedAt}`
          : 'Latest published contract: not published yet',
      ].filter(Boolean) as string[],
    }),
    buildBriefingSection({
      id: 'outcome',
      label: 'Outcome contract',
      tone: 'brand',
      items: [
        outcome,
        ...(capability.successMetrics || []).map(metric => `Success metric: ${metric}`),
        capability.definitionOfDone
          ? `Definition of done: ${capability.definitionOfDone}`
          : null,
      ].filter(Boolean) as string[],
    }),
    buildBriefingSection({
      id: 'evidence',
      label: 'Evidence and policy',
      tone: evidencePriorities.length > 0 ? 'warning' : 'neutral',
      items: [
        ...(evidencePriorities.length > 0
          ? evidencePriorities.map(item => `Evidence: ${item}`)
          : []),
        capability.operatingPolicySummary
          ? `Policy: ${capability.operatingPolicySummary}`
          : null,
      ].filter(Boolean) as string[],
    }),
    buildBriefingSection({
      id: 'ownership',
      label: 'Ownership and stakeholders',
      tone: 'info',
      items: [
        capability.ownerTeam ? `Owner team: ${capability.ownerTeam}` : null,
        ...(capability.teamNames || []).map(teamName => `Team: ${teamName}`),
        ...stakeholderSummary,
      ].filter(Boolean) as string[],
    }),
    buildBriefingSection({
      id: 'systems',
      label: 'Connected systems',
      tone: 'info',
      items: [
        ...linkedSystems.map(item => `System: ${item}`),
        ...repoSummary.map(item => `Workspace: ${item}`),
      ],
    }),
    buildBriefingSection({
      id: 'runtime',
      label: 'Runtime and delivery',
      tone: 'neutral',
      items: [
        ...commandSummary.map(item => `Command: ${item}`),
        ...deploymentSummary.map(item => `Target: ${item}`),
        ...summarizeMetadataEntries(capability.additionalMetadata),
      ],
    }),
    buildBriefingSection({
      id: 'dependencies',
      label: 'Dependencies',
      tone: dependencySummary.length > 0 ? 'warning' : 'neutral',
      items: dependencySummary,
    }),
    buildBriefingSection({
      id: 'upstream',
      label: 'Upstream expectations',
      tone: parentExpectations.length > 0 ? 'brand' : 'neutral',
      items: parentExpectations,
    }),
  ].filter(Boolean) as CapabilityBriefingSection[];

  return {
    capabilityId: capability.id || '',
    title: capability.name || 'Capability',
    purpose,
    outcome,
    capabilityKind: capability.capabilityKind,
    collectionKind: capability.collectionKind,
    definitionOfDone: capability.definitionOfDone || undefined,
    ownerTeam: capability.ownerTeam || undefined,
    hierarchyLabel,
    parentCapabilityName,
    latestPublishedVersion: latestPublishedSnapshot?.publishVersion,
    stakeholderSummary,
    linkedSystems,
    repoSummary,
    activeConstraints,
    evidencePriorities,
    dependencySummary,
    parentExpectations,
    sections,
  };
};

export const buildCapabilityBriefingPrompt = (briefing: CapabilityBriefing) =>
  [
    `Capability briefing for ${briefing.title}:`,
    `Purpose: ${briefing.purpose}`,
    `Outcome: ${briefing.outcome}`,
    briefing.hierarchyLabel ? `Hierarchy: ${briefing.hierarchyLabel}` : null,
    briefing.latestPublishedVersion
      ? `Latest published contract version: ${briefing.latestPublishedVersion}`
      : null,
    briefing.definitionOfDone ? `Definition of done: ${briefing.definitionOfDone}` : null,
    briefing.ownerTeam ? `Owner team: ${briefing.ownerTeam}` : null,
    briefing.activeConstraints.length > 0
      ? `Active constraints: ${briefing.activeConstraints.join(' | ')}`
      : null,
    briefing.evidencePriorities.length > 0
      ? `Evidence priorities: ${briefing.evidencePriorities.join(' | ')}`
      : null,
    briefing.dependencySummary.length > 0
      ? `Dependencies: ${briefing.dependencySummary.join(' | ')}`
      : null,
    briefing.parentExpectations.length > 0
      ? `Upstream expectations: ${briefing.parentExpectations.join(' | ')}`
      : null,
    ...briefing.sections.map(
      section => `${section.label}:\n${section.items.map(item => `- ${item}`).join('\n')}`,
    ),
  ]
    .filter(Boolean)
    .join('\n');
