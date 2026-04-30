import type { PoolClient } from 'pg';
import { buildCapabilityBriefing } from '../src/lib/capabilityBriefing';
import { normalizeWorkItemTaskType } from '../src/lib/workItemTaskTypes';
import type {
  ActorContext,
  ArtifactContentFormat,
  CapabilityAgent,
  PlanningGenerationArtifact,
  PlanningGenerationRequest,
  StoryProposalBatch,
  StoryProposalBatchSummary,
  StoryProposalDecision,
  StoryProposalItem,
  StoryProposalItemReviewState,
  StoryProposalPromotionResult,
  StoryProposalStatus,
  StoryTShirtSize,
  StorySizingConfidence,
  WorkItem,
  WorkItemTaskType,
  Workflow,
} from '../src/types';
import { query, transaction } from './db';
import { createWorkItemRecord, extractJsonObject } from './execution/service';
import { invokeCapabilityChat } from './githubModels';
import { getCapabilityBundle } from './domains/self-service/repository';

type CapabilityBundle = Awaited<ReturnType<typeof getCapabilityBundle>>;

const createRuntimeId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

const asStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean)
    : [];

const toJsonArray = <T,>(value: unknown, fallback: T[] = []) =>
  Array.isArray(value) ? (value as T[]) : fallback;

const clampStoryPoints = (value: unknown) => {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.max(1, Math.min(21, Math.round(parsed)));
};

const normalizeTShirtSize = (value: unknown): StoryTShirtSize | undefined => {
  const normalized = String(value || '').trim().toUpperCase();
  switch (normalized) {
    case 'XS':
    case 'S':
    case 'M':
    case 'L':
    case 'XL':
      return normalized;
    default:
      return undefined;
  }
};

const normalizeSizingConfidence = (
  value: unknown,
): StorySizingConfidence | undefined => {
  const normalized = String(value || '').trim().toUpperCase();
  switch (normalized) {
    case 'LOW':
    case 'MEDIUM':
    case 'HIGH':
      return normalized;
    default:
      return undefined;
  }
};

const deriveTShirtSize = (storyPoints?: number): StoryTShirtSize | undefined => {
  if (!storyPoints) {
    return undefined;
  }
  if (storyPoints <= 1) {
    return 'XS';
  }
  if (storyPoints <= 3) {
    return 'S';
  }
  if (storyPoints <= 5) {
    return 'M';
  }
  if (storyPoints <= 8) {
    return 'L';
  }
  return 'XL';
};

const deriveStoryPointsFromTShirt = (size?: StoryTShirtSize) => {
  switch (size) {
    case 'XS':
      return 1;
    case 'S':
      return 3;
    case 'M':
      return 5;
    case 'L':
      return 8;
    case 'XL':
      return 13;
    default:
      return undefined;
  }
};

const normalizeTags = (value: unknown) =>
  Array.from(
    new Set(
      asStringArray(value)
        .map(tag => tag.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
        .map(tag => tag.replace(/^-+|-+$/g, ''))
        .filter(Boolean),
    ),
  );

const summarizePrompt = (value?: string) => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  return normalized.length <= 88 ? normalized : `${normalized.slice(0, 85).trimEnd()}...`;
};

const buildBatchTitle = ({
  capabilityName,
  prompt,
}: {
  capabilityName: string;
  prompt?: string;
}) => {
  const promptSummary = summarizePrompt(prompt);
  return promptSummary
    ? `${capabilityName} story plan · ${promptSummary}`
    : `${capabilityName} story plan`;
};

const findPlanningAgent = (bundle: CapabilityBundle): CapabilityAgent | undefined =>
  bundle.workspace.agents.find(
    agent =>
      agent.standardTemplateKey === 'PLANNING' ||
      agent.roleStarterKey === 'PLANNING' ||
      /planning/i.test(agent.name) ||
      /planning/i.test(agent.role),
  );

const storyProposalDecisionFromRow = (
  row: Record<string, any>,
): StoryProposalDecision => ({
  id: row.id,
  capabilityId: row.capability_id,
  batchId: row.batch_id,
  itemId: row.item_id || undefined,
  disposition: row.disposition,
  actorUserId: row.actor_user_id || undefined,
  actorDisplayName: row.actor_display_name,
  note: row.note || undefined,
  fieldChanges: asStringArray(row.field_changes),
  createdAt:
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ''),
});

const storyProposalItemFromRow = (
  row: Record<string, any>,
): StoryProposalItem => ({
  id: row.id,
  capabilityId: row.capability_id,
  batchId: row.batch_id,
  itemType: row.item_type,
  parentProposalItemId: row.parent_item_id || undefined,
  title: row.title,
  description: row.description,
  businessOutcome: row.business_outcome || undefined,
  acceptanceCriteria: asStringArray(row.acceptance_criteria),
  dependencies: asStringArray(row.dependencies),
  risks: asStringArray(row.risks),
  recommendedWorkflowId: row.recommended_workflow_id,
  recommendedTaskType: row.recommended_task_type || undefined,
  storyPoints:
    typeof row.story_points === 'number'
      ? row.story_points
      : row.story_points
      ? Number(row.story_points)
      : undefined,
  tShirtSize: normalizeTShirtSize(row.t_shirt_size),
  sizingConfidence: normalizeSizingConfidence(row.sizing_confidence),
  sizingRationale: row.sizing_rationale || undefined,
  implementationNotes: row.implementation_notes || undefined,
  tags: asStringArray(row.tags),
  reviewState: row.review_state,
  sortOrder:
    typeof row.sort_order === 'number' ? row.sort_order : Number(row.sort_order || 0),
  promotedWorkItemId: row.promoted_work_item_id || undefined,
  createdAt:
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ''),
  updatedAt:
    row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || ''),
});

const computeBatchCounts = (items: StoryProposalItem[]) => ({
  itemCount: items.length,
  approvedCount: items.filter(item => item.reviewState === 'APPROVED').length,
  rejectedCount: items.filter(item => item.reviewState === 'REJECTED').length,
  promotedCount: items.filter(item => item.reviewState === 'PROMOTED').length,
});

const deriveBatchStatus = (
  items: StoryProposalItem[],
  currentStatus?: StoryProposalStatus,
): StoryProposalStatus => {
  if (items.length === 0) {
    return currentStatus || 'DRAFT';
  }

  const nonRejected = items.filter(item => item.reviewState !== 'REJECTED');
  if (nonRejected.length === 0) {
    return 'DISCARDED';
  }

  const allApprovedOrPromoted = nonRejected.every(
    item => item.reviewState === 'APPROVED' || item.reviewState === 'PROMOTED',
  );
  if (allApprovedOrPromoted) {
    return 'APPROVED';
  }

  const someApprovedOrPromoted = nonRejected.some(
    item => item.reviewState === 'APPROVED' || item.reviewState === 'PROMOTED',
  );
  if (someApprovedOrPromoted) {
    return 'PARTIALLY_APPROVED';
  }

  return 'REVIEW_READY';
};

const storyProposalBatchSummaryFromRow = (
  row: Record<string, any>,
  items: StoryProposalItem[],
): StoryProposalBatchSummary => {
  const counts = computeBatchCounts(items);
  return {
    id: row.id,
    capabilityId: row.capability_id,
    title: row.title,
    status: row.status,
    selectedWorkflowId: row.selected_workflow_id,
    sourcePrompt: row.source_prompt || undefined,
    summary: row.summary,
    assumptions: asStringArray(row.assumptions),
    dependencies: asStringArray(row.dependencies),
    risks: asStringArray(row.risks),
    sizingPolicy: row.sizing_policy,
    generatedByAgentId: row.generated_by_agent_id || undefined,
    generationMode: row.generation_mode === 'PLANNING_AGENT' ? 'PLANNING_AGENT' : 'FALLBACK',
    planningArtifacts: toJsonArray<PlanningGenerationArtifact>(row.planning_artifacts),
    createdByUserId: row.created_by_user_id || undefined,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ''),
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || ''),
    ...counts,
  };
};

const toBatchDetail = ({
  batchRow,
  items,
  decisions,
}: {
  batchRow: Record<string, any>;
  items: StoryProposalItem[];
  decisions: StoryProposalDecision[];
}): StoryProposalBatch => ({
  ...storyProposalBatchSummaryFromRow(batchRow, items),
  items,
  decisions,
});

const listBatchItemsTx = async (
  client: PoolClient,
  capabilityId: string,
  batchId: string,
) => {
  const result = await client.query(
    `
      SELECT *
      FROM capability_story_proposal_items
      WHERE capability_id = $1
        AND batch_id = $2
      ORDER BY sort_order ASC, created_at ASC, id ASC
    `,
    [capabilityId, batchId],
  );

  return result.rows.map(storyProposalItemFromRow);
};

const listBatchDecisionsTx = async (
  client: PoolClient,
  capabilityId: string,
  batchId: string,
) => {
  const result = await client.query(
    `
      SELECT *
      FROM capability_story_proposal_decisions
      WHERE capability_id = $1
        AND batch_id = $2
      ORDER BY created_at ASC, id ASC
    `,
    [capabilityId, batchId],
  );

  return result.rows.map(storyProposalDecisionFromRow);
};

const getBatchRowTx = async (
  client: PoolClient,
  capabilityId: string,
  batchId: string,
) => {
  const result = await client.query(
    `
      SELECT *
      FROM capability_story_proposal_batches
      WHERE capability_id = $1
        AND id = $2
      LIMIT 1
    `,
    [capabilityId, batchId],
  );

  return result.rows[0] || null;
};

const insertDecisionTx = async (
  client: PoolClient,
  {
    capabilityId,
    batchId,
    itemId,
    disposition,
    actor,
    note,
    fieldChanges,
  }: {
    capabilityId: string;
    batchId: string;
    itemId?: string;
    disposition: StoryProposalDecision['disposition'];
    actor?: ActorContext;
    note?: string;
    fieldChanges?: string[];
  },
) => {
  await client.query(
    `
      INSERT INTO capability_story_proposal_decisions (
        capability_id,
        batch_id,
        id,
        item_id,
        disposition,
        actor_user_id,
        actor_display_name,
        note,
        field_changes,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
    `,
    [
      capabilityId,
      batchId,
      createRuntimeId('SPD'),
      itemId || null,
      disposition,
      actor?.userId || null,
      actor?.displayName || 'Workspace Operator',
      note || null,
      JSON.stringify(fieldChanges || []),
    ],
  );
};

const replaceBatchItemsTx = async (
  client: PoolClient,
  capabilityId: string,
  batchId: string,
  items: StoryProposalItem[],
) => {
  await client.query(
    `
      DELETE FROM capability_story_proposal_items
      WHERE capability_id = $1
        AND batch_id = $2
    `,
    [capabilityId, batchId],
  );

  for (const item of items) {
    await client.query(
      `
        INSERT INTO capability_story_proposal_items (
          capability_id,
          batch_id,
          id,
          item_type,
          parent_item_id,
          title,
          description,
          business_outcome,
          acceptance_criteria,
          dependencies,
          risks,
          recommended_workflow_id,
          recommended_task_type,
          story_points,
          t_shirt_size,
          sizing_confidence,
          sizing_rationale,
          implementation_notes,
          tags,
          review_state,
          sort_order,
          promoted_work_item_id,
          created_at,
          updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
        )
      `,
      [
        capabilityId,
        batchId,
        item.id,
        item.itemType,
        item.parentProposalItemId || null,
        item.title,
        item.description,
        item.businessOutcome || null,
        JSON.stringify(item.acceptanceCriteria || []),
        JSON.stringify(item.dependencies || []),
        JSON.stringify(item.risks || []),
        item.recommendedWorkflowId,
        item.recommendedTaskType || null,
        item.storyPoints || null,
        item.tShirtSize || null,
        item.sizingConfidence || null,
        item.sizingRationale || null,
        item.implementationNotes || null,
        item.tags || [],
        item.reviewState,
        item.sortOrder,
        item.promotedWorkItemId || null,
        item.createdAt,
        item.updatedAt,
      ],
    );
  }
};

const updateBatchRowTx = async (
  client: PoolClient,
  {
    capabilityId,
    batchId,
    title,
    status,
    sourcePrompt,
    selectedWorkflowId,
    summary,
    assumptions,
    dependencies,
    risks,
    sizingPolicy,
    generatedByAgentId,
    generationMode,
    planningArtifacts,
    createdByUserId,
  }: {
    capabilityId: string;
    batchId: string;
    title: string;
    status: StoryProposalStatus;
    sourcePrompt?: string;
    selectedWorkflowId: string;
    summary: string;
    assumptions: string[];
    dependencies: string[];
    risks: string[];
    sizingPolicy: string;
    generatedByAgentId?: string;
    generationMode: 'PLANNING_AGENT' | 'FALLBACK';
    planningArtifacts: PlanningGenerationArtifact[];
    createdByUserId?: string;
  },
) => {
  await client.query(
    `
      INSERT INTO capability_story_proposal_batches (
        capability_id,
        id,
        title,
        status,
        source_prompt,
        selected_workflow_id,
        summary,
        assumptions,
        dependencies,
        risks,
        sizing_policy,
        generated_by_agent_id,
        generation_mode,
        planning_artifacts,
        created_by_user_id,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
      ON CONFLICT (capability_id, id) DO UPDATE SET
        title = EXCLUDED.title,
        status = EXCLUDED.status,
        source_prompt = EXCLUDED.source_prompt,
        selected_workflow_id = EXCLUDED.selected_workflow_id,
        summary = EXCLUDED.summary,
        assumptions = EXCLUDED.assumptions,
        dependencies = EXCLUDED.dependencies,
        risks = EXCLUDED.risks,
        sizing_policy = EXCLUDED.sizing_policy,
        generated_by_agent_id = EXCLUDED.generated_by_agent_id,
        generation_mode = EXCLUDED.generation_mode,
        planning_artifacts = EXCLUDED.planning_artifacts,
        created_by_user_id = COALESCE(capability_story_proposal_batches.created_by_user_id, EXCLUDED.created_by_user_id),
        updated_at = NOW()
    `,
    [
      capabilityId,
      batchId,
      title,
      status,
      sourcePrompt || null,
      selectedWorkflowId,
      summary,
      JSON.stringify(assumptions || []),
      JSON.stringify(dependencies || []),
      JSON.stringify(risks || []),
      sizingPolicy,
      generatedByAgentId || null,
      generationMode,
      JSON.stringify(planningArtifacts || []),
      createdByUserId || null,
    ],
  );
};

const buildPlanningPrompt = ({
  bundle,
  workflow,
  operatorPrompt,
}: {
  bundle: CapabilityBundle;
  workflow: Workflow;
  operatorPrompt?: string;
}) => {
  const briefing = buildCapabilityBriefing(bundle.capability);
  const briefingText = briefing.sections
    .map(
      section =>
        `## ${section.label}\n${section.items.map(item => `- ${item}`).join('\n')}`,
    )
    .join('\n\n');

  const workflowList = bundle.workspace.workflows
    .map(item => `- ${item.id}: ${item.name}`)
    .join('\n');

  return [
    `Generate a reviewed delivery plan for capability ${bundle.capability.name}.`,
    'Return exactly one JSON object and no prose outside JSON.',
    '',
    'Required JSON shape:',
    '{',
    '  "summary": "string",',
    '  "assumptions": ["string"],',
    '  "dependencies": ["string"],',
    '  "risks": ["string"],',
    '  "items": [',
    '    {',
    '      "itemType": "EPIC" | "STORY",',
    '      "title": "string",',
    '      "description": "string",',
    '      "businessOutcome": "string",',
    '      "acceptanceCriteria": ["string"],',
    '      "dependencies": ["string"],',
    '      "risks": ["string"],',
    '      "recommendedWorkflowId": "string",',
    '      "recommendedTaskType": "GENERAL" | "STRATEGIC_INITIATIVE" | "NEW_BUSINESS_CASE" | "FEATURE_ENHANCEMENT" | "PRODUCTION_ISSUE" | "BUGFIX" | "SECURITY_FINDING" | "REHYDRATION",',
    '      "storyPoints": number,',
    '      "tShirtSize": "XS" | "S" | "M" | "L" | "XL",',
    '      "sizingConfidence": "LOW" | "MEDIUM" | "HIGH",',
    '      "sizingRationale": "string",',
    '      "implementationNotes": "string",',
    '      "tags": ["string"]',
    '    }',
    '  ]',
    '}',
    '',
    'Rules:',
    '- Create exactly one EPIC and at least two STORY items.',
    '- The epic should summarize the whole initiative.',
    '- Child stories should be implementation-sized and reviewable.',
    `- Default workflow should be ${workflow.id}.`,
    '- Make the sizing realistic and consistent.',
    '- Use acceptance criteria that a business analyst or reviewer could understand.',
    '',
    'Available workflows:',
    workflowList,
    '',
    'Capability briefing:',
    briefingText,
    '',
    operatorPrompt?.trim()
      ? `Operator planning prompt:\n${operatorPrompt.trim()}`
      : 'Operator planning prompt:\nNone provided. Use the capability contract as the source of truth.',
  ].join('\n');
};

const buildPlanningArtifact = ({
  capabilityName,
  batchId,
  summary,
  assumptions,
  dependencies,
  risks,
  items,
  sourcePrompt,
  generationMode,
  model,
}: {
  capabilityName: string;
  batchId: string;
  summary: string;
  assumptions: string[];
  dependencies: string[];
  risks: string[];
  items: StoryProposalItem[];
  sourcePrompt?: string;
  generationMode: 'PLANNING_AGENT' | 'FALLBACK';
  model?: string;
}): PlanningGenerationArtifact => {
  const contentText = [
    `# ${capabilityName} Story Proposal Batch`,
    '',
    `- Batch ID: ${batchId}`,
    `- Generation mode: ${generationMode}`,
    model ? `- Model: ${model}` : null,
    sourcePrompt?.trim() ? `- Operator prompt: ${sourcePrompt.trim()}` : null,
    '',
    '## Summary',
    '',
    summary,
    '',
    '## Assumptions',
    ...(assumptions.length > 0 ? assumptions.map(item => `- ${item}`) : ['- None captured.']),
    '',
    '## Dependencies',
    ...(dependencies.length > 0 ? dependencies.map(item => `- ${item}`) : ['- None captured.']),
    '',
    '## Risks',
    ...(risks.length > 0 ? risks.map(item => `- ${item}`) : ['- None captured.']),
    '',
    '## Proposed Stories',
    ...items.flatMap(item => [
      '',
      `### ${item.itemType} · ${item.title}`,
      '',
      item.description,
      '',
      item.businessOutcome ? `Business outcome: ${item.businessOutcome}` : null,
      `Sizing: ${item.storyPoints || '?'} points · ${item.tShirtSize || '?'} · ${item.sizingConfidence || 'MEDIUM'} confidence`,
      item.sizingRationale ? `Sizing rationale: ${item.sizingRationale}` : null,
      `Workflow: ${item.recommendedWorkflowId}`,
      item.recommendedTaskType ? `Task type: ${item.recommendedTaskType}` : null,
      item.tags.length > 0 ? `Tags: ${item.tags.join(', ')}` : null,
      '',
      'Acceptance criteria:',
      ...(item.acceptanceCriteria.length > 0
        ? item.acceptanceCriteria.map(criteria => `- ${criteria}`)
        : ['- No acceptance criteria captured.']),
      '',
      'Dependencies:',
      ...(item.dependencies.length > 0
        ? item.dependencies.map(dependency => `- ${dependency}`)
        : ['- None captured.']),
      '',
      'Risks:',
      ...(item.risks.length > 0 ? item.risks.map(risk => `- ${risk}`) : ['- None captured.']),
      '',
      'Implementation notes:',
      item.implementationNotes || 'No implementation notes captured.',
    ]),
  ]
    .filter(Boolean)
    .join('\n');

  return {
    artifactId: createRuntimeId('PLANART'),
    name: `${capabilityName} story proposal`,
    summary,
    createdAt: new Date().toISOString(),
    contentFormat: 'MARKDOWN' satisfies ArtifactContentFormat,
    contentText,
    model,
  };
};

const buildFallbackBatch = ({
  bundle,
  workflow,
  sourcePrompt,
}: {
  bundle: CapabilityBundle;
  workflow: Workflow;
  sourcePrompt?: string;
}) => {
  const capability = bundle.capability;
  const epicTitle = summarizePrompt(sourcePrompt) || capability.businessOutcome || capability.name;
  const epicDescription =
    capability.description ||
    `Shape and deliver the ${capability.name} initiative with clear acceptance, delivery evidence, and implementation slices.`;
  const epicId = createRuntimeId('SPI');
  const capabilityTag = capability.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  const baseStories: Array<{
    title: string;
    description: string;
    businessOutcome?: string;
    acceptanceCriteria: string[];
    dependencies: string[];
    risks: string[];
    recommendedTaskType: WorkItemTaskType;
    storyPoints: number;
    implementationNotes: string;
    tags: string[];
  }> = [
    {
      title: `Define scope and acceptance for ${capability.name}`,
      description:
        'Clarify assumptions, external dependencies, and the acceptance criteria the downstream build will be measured against.',
      businessOutcome:
        capability.businessOutcome || `Clarify the business outcome for ${capability.name}.`,
      acceptanceCriteria: [
        'Acceptance criteria are explicit and reviewable.',
        'Known assumptions and unresolved questions are documented.',
        'Dependencies on adjacent systems or teams are called out.',
      ],
      dependencies: capability.dependencies.map(
        dependency => dependency.targetCapabilityId,
      ),
      risks: ['Scope can drift if assumptions are left implicit.'],
      recommendedTaskType: 'STRATEGIC_INITIATIVE',
      storyPoints: 3,
      implementationNotes:
        'Use the planning and business-analysis agents to tighten acceptance before implementation starts.',
      tags: [capabilityTag, 'analysis', 'acceptance'],
    },
    {
      title: `Implement the core ${capability.name} change`,
      description:
        'Build the smallest end-to-end implementation slice that proves the capability outcome can be delivered.',
      businessOutcome:
        capability.businessOutcome ||
        `Deliver the primary behavior expected from ${capability.name}.`,
      acceptanceCriteria: [
        'Core code changes are implemented in the selected workflow.',
        'The implementation aligns with the capability policy and repository boundaries.',
        'Implementation notes are ready for QA and governance review.',
      ],
      dependencies: (capability.repositories || []).map(repository => repository.label),
      risks: ['Implementation can stall if repository context is not grounded early.'],
      recommendedTaskType: 'FEATURE_ENHANCEMENT',
      storyPoints: 5,
      implementationNotes:
        'Keep the implementation slice narrow and aligned to the first demonstrable business result.',
      tags: [capabilityTag, 'implementation'],
    },
    {
      title: `Validate evidence and release readiness for ${capability.name}`,
      description:
        'Collect the quality, evidence, and approval context needed to move the delivered slice through validation and governance.',
      businessOutcome:
        capability.requiredEvidenceKinds.length > 0
          ? `Produce the required evidence for ${capability.name}.`
          : `Make the delivered slice reviewable and safe to promote.`,
      acceptanceCriteria: [
        'Required evidence is attached or explicitly listed.',
        'Validation coverage and residual risks are summarized.',
        'Approvers can understand what changed and what still needs attention.',
      ],
      dependencies: capability.requiredEvidenceKinds,
      risks: ['Review can block if evidence is incomplete or scattered.'],
      recommendedTaskType: 'GENERAL',
      storyPoints: 3,
      implementationNotes:
        'Use the existing evidence-packet and approval flows to keep the final review legible.',
      tags: [capabilityTag, 'qa', 'evidence'],
    },
  ];

  const items: StoryProposalItem[] = [
    {
      id: epicId,
      capabilityId: capability.id,
      batchId: '',
      itemType: 'EPIC',
      title: epicTitle,
      description: epicDescription,
      businessOutcome: capability.businessOutcome || undefined,
      acceptanceCriteria: [
        'The initiative is decomposed into implementation-sized stories.',
        'Sizing, dependencies, and assumptions are clear enough for review.',
        'The promoted work items can move into Orchestrator without further planning cleanup.',
      ],
      dependencies: capability.dependencies.map(
        dependency => dependency.targetCapabilityId,
      ),
      risks: ['Without review, the plan may not reflect the latest business priority.'],
      recommendedWorkflowId: workflow.id,
      recommendedTaskType: 'STRATEGIC_INITIATIVE',
      storyPoints: 8,
      tShirtSize: 'L',
      sizingConfidence: 'MEDIUM',
      sizingRationale:
        'The epic spans analysis, implementation, and evidence work across multiple delivery slices.',
      implementationNotes:
        'Promote this epic as the parent planning work item for the related child stories.',
      tags: [capabilityTag, 'epic', 'planning'],
      reviewState: 'PROPOSED',
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    ...baseStories.map((story, index) => ({
      id: createRuntimeId('SPI'),
      capabilityId: capability.id,
      batchId: '',
      itemType: 'STORY' as const,
      parentProposalItemId: epicId,
      title: story.title,
      description: story.description,
      businessOutcome: story.businessOutcome,
      acceptanceCriteria: story.acceptanceCriteria,
      dependencies: story.dependencies,
      risks: story.risks,
      recommendedWorkflowId: workflow.id,
      recommendedTaskType: story.recommendedTaskType,
      storyPoints: story.storyPoints,
      tShirtSize: deriveTShirtSize(story.storyPoints),
      sizingConfidence: 'MEDIUM' as const,
      sizingRationale:
        story.storyPoints <= 3
          ? 'This slice is narrow enough for one focused delivery pass.'
          : 'This slice touches implementation plus validation and should stay reviewable in one iteration.',
      implementationNotes: story.implementationNotes,
      tags: story.tags,
      reviewState: 'PROPOSED' as const,
      sortOrder: index + 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
  ];

  return {
    title: buildBatchTitle({
      capabilityName: capability.name,
      prompt: sourcePrompt,
    }),
    summary:
      sourcePrompt?.trim()
        ? `Generated a fallback delivery plan for ${capability.name} using the capability contract and the operator prompt.`
        : `Generated a fallback delivery plan for ${capability.name} using the capability contract.`,
    assumptions: [
      capability.businessOutcome
        ? 'The current business outcome field reflects the primary delivery intent.'
        : 'The capability description is the best available proxy for delivery intent.',
      'The selected workflow can carry the stories from planning through delivery.',
    ],
    dependencies: capability.dependencies.map(
      dependency =>
        `${dependency.dependencyKind}: ${dependency.targetCapabilityId}${
          dependency.description ? ` — ${dependency.description}` : ''
        }`,
    ),
    risks: [
      'Sizing may need human calibration before promotion if the underlying scope changed recently.',
      ...(capability.requiredEvidenceKinds.length > 0
        ? ['Evidence expectations should be reviewed before implementation starts.']
        : []),
    ],
    sizingPolicy:
      'Use story points for relative implementation effort and T-shirt size for portfolio-level planning.',
    items,
    generationMode: 'FALLBACK' as const,
  };
};

const normalizeGeneratedBatch = ({
  capabilityId,
  workflowId,
  raw,
}: {
  capabilityId: string;
  workflowId: string;
  raw: Record<string, any>;
}) => {
  const now = new Date().toISOString();
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const epicSource =
    rawItems.find(item => String(item?.itemType || '').toUpperCase() === 'EPIC') ||
    raw.epic ||
    rawItems[0];

  if (!epicSource) {
    throw new Error('Generated story proposal batch did not include any items.');
  }

  const epicId = createRuntimeId('SPI');
  const epicStoryPoints =
    clampStoryPoints(epicSource.storyPoints) ||
    deriveStoryPointsFromTShirt(normalizeTShirtSize(epicSource.tShirtSize)) ||
    8;
  const epicTShirtSize =
    normalizeTShirtSize(epicSource.tShirtSize) || deriveTShirtSize(epicStoryPoints) || 'L';

  const epic: StoryProposalItem = {
    id: epicId,
    capabilityId,
    batchId: '',
    itemType: 'EPIC',
    title: String(epicSource.title || epicSource.name || 'Generated epic').trim(),
    description: String(
      epicSource.description || epicSource.summary || 'Generated epic plan.',
    ).trim(),
    businessOutcome: String(epicSource.businessOutcome || '').trim() || undefined,
    acceptanceCriteria: asStringArray(epicSource.acceptanceCriteria),
    dependencies: asStringArray(epicSource.dependencies),
    risks: asStringArray(epicSource.risks),
    recommendedWorkflowId:
      String(epicSource.recommendedWorkflowId || epicSource.workflowId || workflowId).trim() ||
      workflowId,
    recommendedTaskType: normalizeWorkItemTaskType(
      epicSource.recommendedTaskType || epicSource.taskType || 'STRATEGIC_INITIATIVE',
    ),
    storyPoints: epicStoryPoints,
    tShirtSize: epicTShirtSize,
    sizingConfidence:
      normalizeSizingConfidence(epicSource.sizingConfidence) || 'MEDIUM',
    sizingRationale:
      String(epicSource.sizingRationale || epicSource.rationale || '').trim() || undefined,
    implementationNotes:
      String(epicSource.implementationNotes || epicSource.notes || '').trim() || undefined,
    tags: normalizeTags(epicSource.tags),
    reviewState: 'PROPOSED',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  };

  const storySources = rawItems
    .filter(item => item && item !== epicSource)
    .filter(item => String(item?.itemType || 'STORY').toUpperCase() !== 'EPIC');

  if (storySources.length < 2) {
    throw new Error('Generated batch did not include enough child stories.');
  }

  const stories = storySources.map((source, index) => {
    const storyPoints =
      clampStoryPoints(source.storyPoints) ||
      deriveStoryPointsFromTShirt(normalizeTShirtSize(source.tShirtSize)) ||
      3;
    const tShirtSize =
      normalizeTShirtSize(source.tShirtSize) || deriveTShirtSize(storyPoints) || 'S';
    return {
      id: createRuntimeId('SPI'),
      capabilityId,
      batchId: '',
      itemType: 'STORY' as const,
      parentProposalItemId: epicId,
      title: String(source.title || source.name || `Generated story ${index + 1}`).trim(),
      description: String(
        source.description || source.summary || 'Generated child story.',
      ).trim(),
      businessOutcome: String(source.businessOutcome || '').trim() || undefined,
      acceptanceCriteria: asStringArray(source.acceptanceCriteria),
      dependencies: asStringArray(source.dependencies),
      risks: asStringArray(source.risks),
      recommendedWorkflowId:
        String(source.recommendedWorkflowId || source.workflowId || workflowId).trim() ||
        workflowId,
      recommendedTaskType: normalizeWorkItemTaskType(
        source.recommendedTaskType || source.taskType || 'FEATURE_ENHANCEMENT',
      ),
      storyPoints,
      tShirtSize,
      sizingConfidence:
        normalizeSizingConfidence(source.sizingConfidence) || 'MEDIUM',
      sizingRationale:
        String(source.sizingRationale || source.rationale || '').trim() || undefined,
      implementationNotes:
        String(source.implementationNotes || source.notes || '').trim() || undefined,
      tags: normalizeTags(source.tags),
      reviewState: 'PROPOSED' as const,
      sortOrder: index + 1,
      createdAt: now,
      updatedAt: now,
    } satisfies StoryProposalItem;
  });

  return {
    title: String(raw.title || epic.title || 'Generated story plan').trim(),
    summary: String(raw.summary || '').trim() || 'Generated a story proposal batch.',
    assumptions: asStringArray(raw.assumptions),
    dependencies: asStringArray(raw.dependencies),
    risks: asStringArray(raw.risks),
    sizingPolicy:
      String(raw.sizingPolicy || '').trim() ||
      'Use story points for delivery effort and T-shirt size for portfolio legibility.',
    items: [epic, ...stories],
  };
};

const generatePlanningBatchShape = async ({
  bundle,
  workflow,
  sourcePrompt,
}: {
  bundle: CapabilityBundle;
  workflow: Workflow;
  sourcePrompt?: string;
}) => {
  const planningAgent = findPlanningAgent(bundle);
  if (!planningAgent) {
    const fallback = buildFallbackBatch({
      bundle,
      workflow,
      sourcePrompt,
    });
    return {
      ...fallback,
      generatedByAgentId: undefined,
      model: undefined,
    };
  }

  try {
    const response = await invokeCapabilityChat({
      capability: bundle.capability,
      agent: planningAgent,
      history: [],
      message: buildPlanningPrompt({
        bundle,
        workflow,
        operatorPrompt: sourcePrompt,
      }),
      resetSession: true,
      scope: 'GENERAL_CHAT',
      scopeId: bundle.capability.id,
      developerPrompt:
        'You are creating a planning proposal batch. Return valid JSON only. Keep it concrete, delivery-ready, and scoped for human review before promotion.',
    });
    const parsed = extractJsonObject(response.content);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Model output did not contain a valid JSON planning batch.');
    }
    const normalized = normalizeGeneratedBatch({
      capabilityId: bundle.capability.id,
      workflowId: workflow.id,
      raw: parsed as Record<string, any>,
    });

    return {
      ...normalized,
      generationMode: 'PLANNING_AGENT' as const,
      generatedByAgentId: planningAgent.id,
      model: response.model,
    };
  } catch {
    const fallback = buildFallbackBatch({
      bundle,
      workflow,
      sourcePrompt,
    });
    return {
      ...fallback,
      generatedByAgentId: planningAgent.id,
      model: undefined,
    };
  }
};

export const listStoryProposalBatches = async (
  capabilityId: string,
): Promise<StoryProposalBatchSummary[]> => {
  const batchResult = await query<Record<string, any>>(
    `
      SELECT *
      FROM capability_story_proposal_batches
      WHERE capability_id = $1
      ORDER BY updated_at DESC, created_at DESC, id DESC
    `,
    [capabilityId],
  );

  const itemResult = await query<Record<string, any>>(
    `
      SELECT *
      FROM capability_story_proposal_items
      WHERE capability_id = $1
      ORDER BY sort_order ASC, created_at ASC, id ASC
    `,
    [capabilityId],
  );

  const itemsByBatch = new Map<string, StoryProposalItem[]>();
  itemResult.rows.map(storyProposalItemFromRow).forEach(item => {
    const next = itemsByBatch.get(item.batchId) || [];
    next.push(item);
    itemsByBatch.set(item.batchId, next);
  });

  return batchResult.rows.map((row: Record<string, any>) =>
    storyProposalBatchSummaryFromRow(row, itemsByBatch.get(row.id) || []),
  );
};

export const getStoryProposalBatch = async (
  capabilityId: string,
  batchId: string,
): Promise<StoryProposalBatch | null> =>
  transaction(async client => {
    const batchRow = await getBatchRowTx(client, capabilityId, batchId);
    if (!batchRow) {
      return null;
    }
    const items = await listBatchItemsTx(client, capabilityId, batchId);
    const decisions = await listBatchDecisionsTx(client, capabilityId, batchId);
    return toBatchDetail({ batchRow, items, decisions });
  });

export const createStoryProposalBatch = async ({
  capabilityId,
  request,
  actor,
}: {
  capabilityId: string;
  request: PlanningGenerationRequest;
  actor?: ActorContext;
}) => {
  const bundle = await getCapabilityBundle(capabilityId);
  const workflow =
    bundle.workspace.workflows.find(item => item.id === request.workflowId) ||
    bundle.workspace.workflows[0];
  if (!workflow) {
    throw new Error('This capability does not have a workflow available for story generation.');
  }

  const batchId = createRuntimeId('SPB');
  const generated = await generatePlanningBatchShape({
    bundle,
    workflow,
    sourcePrompt: request.prompt,
  });

  const items = generated.items.map(item => ({
    ...item,
    batchId,
  }));
  const artifact = buildPlanningArtifact({
    capabilityName: bundle.capability.name,
    batchId,
    summary: generated.summary,
    assumptions: generated.assumptions,
    dependencies: generated.dependencies,
    risks: generated.risks,
    items,
    sourcePrompt: request.prompt,
    generationMode: generated.generationMode,
    model: generated.model,
  });

  await transaction(async client => {
    await updateBatchRowTx(client, {
      capabilityId,
      batchId,
      title:
        generated.title ||
        buildBatchTitle({
          capabilityName: bundle.capability.name,
          prompt: request.prompt,
        }),
      status: 'REVIEW_READY',
      sourcePrompt: request.prompt,
      selectedWorkflowId: workflow.id,
      summary: generated.summary,
      assumptions: generated.assumptions,
      dependencies: generated.dependencies,
      risks: generated.risks,
      sizingPolicy: generated.sizingPolicy,
      generatedByAgentId: generated.generatedByAgentId,
      generationMode: generated.generationMode,
      planningArtifacts: [artifact],
      createdByUserId: actor?.userId,
    });
    await replaceBatchItemsTx(client, capabilityId, batchId, items);
    await insertDecisionTx(client, {
      capabilityId,
      batchId,
      disposition: 'GENERATED',
      actor,
      note:
        generated.generationMode === 'PLANNING_AGENT'
          ? 'Generated the story proposal batch with the Planning Agent.'
          : 'Generated a fallback story proposal batch because model output was unavailable or invalid.',
    });
  });

  const batch = await getStoryProposalBatch(capabilityId, batchId);
  if (!batch) {
    throw new Error('Story proposal batch could not be loaded after creation.');
  }
  return batch;
};

export const updateStoryProposalItem = async ({
  capabilityId,
  batchId,
  itemId,
  updates,
  actor,
}: {
  capabilityId: string;
  batchId: string;
  itemId: string;
  updates: Partial<
    Pick<
      StoryProposalItem,
      | 'title'
      | 'description'
      | 'businessOutcome'
      | 'acceptanceCriteria'
      | 'dependencies'
      | 'risks'
      | 'recommendedWorkflowId'
      | 'recommendedTaskType'
      | 'storyPoints'
      | 'tShirtSize'
      | 'sizingConfidence'
      | 'sizingRationale'
      | 'implementationNotes'
      | 'tags'
      | 'reviewState'
    >
  >;
  actor?: ActorContext;
}) =>
  transaction(async client => {
    const batchRow = await getBatchRowTx(client, capabilityId, batchId);
    if (!batchRow) {
      throw new Error(`Story proposal batch ${batchId} was not found.`);
    }
    const items = await listBatchItemsTx(client, capabilityId, batchId);
    const target = items.find(item => item.id === itemId);
    if (!target) {
      throw new Error(`Story proposal item ${itemId} was not found.`);
    }

    const bundle = await getCapabilityBundle(capabilityId);
    const validWorkflow =
      updates.recommendedWorkflowId === undefined ||
      bundle.workspace.workflows.some(
        workflow => workflow.id === updates.recommendedWorkflowId,
      );
    if (!validWorkflow) {
      throw new Error(`Workflow ${updates.recommendedWorkflowId} was not found for this capability.`);
    }

    const fieldChanges: string[] = [];
    const recordFieldChange = (field: string, changed: boolean) => {
      if (changed) {
        fieldChanges.push(field);
      }
    };

    const nextStoryPoints =
      updates.storyPoints !== undefined
        ? clampStoryPoints(updates.storyPoints)
        : target.storyPoints;
    const nextTShirtSize =
      updates.tShirtSize !== undefined
        ? normalizeTShirtSize(updates.tShirtSize) || deriveTShirtSize(nextStoryPoints)
        : target.tShirtSize || deriveTShirtSize(nextStoryPoints);
    const nextItemBase: StoryProposalItem = {
      ...target,
      title:
        updates.title !== undefined ? String(updates.title).trim() || target.title : target.title,
      description:
        updates.description !== undefined
          ? String(updates.description).trim() || target.description
          : target.description,
      businessOutcome:
        updates.businessOutcome !== undefined
          ? String(updates.businessOutcome).trim() || undefined
          : target.businessOutcome,
      acceptanceCriteria:
        updates.acceptanceCriteria !== undefined
          ? asStringArray(updates.acceptanceCriteria)
          : target.acceptanceCriteria,
      dependencies:
        updates.dependencies !== undefined
          ? asStringArray(updates.dependencies)
          : target.dependencies,
      risks: updates.risks !== undefined ? asStringArray(updates.risks) : target.risks,
      recommendedWorkflowId:
        updates.recommendedWorkflowId !== undefined
          ? String(updates.recommendedWorkflowId).trim() || target.recommendedWorkflowId
          : target.recommendedWorkflowId,
      recommendedTaskType:
        updates.recommendedTaskType !== undefined
          ? normalizeWorkItemTaskType(updates.recommendedTaskType)
          : target.recommendedTaskType,
      storyPoints: nextStoryPoints,
      tShirtSize: nextTShirtSize,
      sizingConfidence:
        updates.sizingConfidence !== undefined
          ? normalizeSizingConfidence(updates.sizingConfidence) || target.sizingConfidence
          : target.sizingConfidence,
      sizingRationale:
        updates.sizingRationale !== undefined
          ? String(updates.sizingRationale).trim() || undefined
          : target.sizingRationale,
      implementationNotes:
        updates.implementationNotes !== undefined
          ? String(updates.implementationNotes).trim() || undefined
          : target.implementationNotes,
      tags: updates.tags !== undefined ? normalizeTags(updates.tags) : target.tags,
      reviewState: target.reviewState,
      updatedAt: new Date().toISOString(),
    };

    recordFieldChange('title', nextItemBase.title !== target.title);
    recordFieldChange('description', nextItemBase.description !== target.description);
    recordFieldChange(
      'businessOutcome',
      nextItemBase.businessOutcome !== target.businessOutcome,
    );
    recordFieldChange(
      'acceptanceCriteria',
      JSON.stringify(nextItemBase.acceptanceCriteria) !== JSON.stringify(target.acceptanceCriteria),
    );
    recordFieldChange(
      'dependencies',
      JSON.stringify(nextItemBase.dependencies) !== JSON.stringify(target.dependencies),
    );
    recordFieldChange(
      'risks',
      JSON.stringify(nextItemBase.risks) !== JSON.stringify(target.risks),
    );
    recordFieldChange(
      'recommendedWorkflowId',
      nextItemBase.recommendedWorkflowId !== target.recommendedWorkflowId,
    );
    recordFieldChange(
      'recommendedTaskType',
      nextItemBase.recommendedTaskType !== target.recommendedTaskType,
    );
    recordFieldChange('storyPoints', nextItemBase.storyPoints !== target.storyPoints);
    recordFieldChange('tShirtSize', nextItemBase.tShirtSize !== target.tShirtSize);
    recordFieldChange(
      'sizingConfidence',
      nextItemBase.sizingConfidence !== target.sizingConfidence,
    );
    recordFieldChange(
      'sizingRationale',
      nextItemBase.sizingRationale !== target.sizingRationale,
    );
    recordFieldChange(
      'implementationNotes',
      nextItemBase.implementationNotes !== target.implementationNotes,
    );
    recordFieldChange('tags', JSON.stringify(nextItemBase.tags) !== JSON.stringify(target.tags));

    const nextReviewState: StoryProposalItemReviewState =
      updates.reviewState === 'APPROVED' ||
      updates.reviewState === 'REJECTED' ||
      updates.reviewState === 'EDITED'
        ? updates.reviewState
        : fieldChanges.length > 0
        ? 'EDITED'
        : target.reviewState;
    recordFieldChange('reviewState', nextReviewState !== target.reviewState);

    const nextItem: StoryProposalItem = {
      ...nextItemBase,
      reviewState: nextReviewState,
    };

    const nextItems = items.map(item => (item.id === itemId ? nextItem : item));
    const nextStatus = deriveBatchStatus(nextItems, batchRow.status);

    await replaceBatchItemsTx(client, capabilityId, batchId, nextItems);
    await client.query(
      `
        UPDATE capability_story_proposal_batches
        SET status = $3,
            updated_at = NOW()
        WHERE capability_id = $1
          AND id = $2
      `,
      [capabilityId, batchId, nextStatus],
    );
    if (fieldChanges.length > 0) {
      await insertDecisionTx(client, {
        capabilityId,
        batchId,
        itemId,
        disposition:
          nextItem.reviewState === 'APPROVED'
            ? 'APPROVED'
            : nextItem.reviewState === 'REJECTED'
            ? 'REJECTED'
            : 'EDITED',
        actor,
        note:
          nextItem.reviewState === 'APPROVED'
            ? `Approved ${nextItem.title} for promotion readiness.`
            : nextItem.reviewState === 'REJECTED'
            ? `Rejected ${nextItem.title} from this proposal batch.`
            : `Updated ${nextItem.title}.`,
        fieldChanges,
      });
    }

    const decisions = await listBatchDecisionsTx(client, capabilityId, batchId);
    return toBatchDetail({
      batchRow: { ...batchRow, status: nextStatus, updated_at: new Date().toISOString() },
      items: nextItems,
      decisions,
    });
  });

export const regenerateStoryProposalBatch = async ({
  capabilityId,
  batchId,
  request,
  actor,
}: {
  capabilityId: string;
  batchId: string;
  request?: PlanningGenerationRequest;
  actor?: ActorContext;
}) => {
  const bundle = await getCapabilityBundle(capabilityId);
  const current = await getStoryProposalBatch(capabilityId, batchId);
  if (!current) {
    throw new Error(`Story proposal batch ${batchId} was not found.`);
  }
  const workflow =
    bundle.workspace.workflows.find(
      item => item.id === (request?.workflowId || current.selectedWorkflowId),
    ) || bundle.workspace.workflows[0];
  if (!workflow) {
    throw new Error('This capability does not have a workflow available for story generation.');
  }

  const sourcePrompt = request?.prompt ?? current.sourcePrompt;
  const generated = await generatePlanningBatchShape({
    bundle,
    workflow,
    sourcePrompt,
  });
  const items = generated.items.map(item => ({
    ...item,
    batchId,
  }));
  const artifact = buildPlanningArtifact({
    capabilityName: bundle.capability.name,
    batchId,
    summary: generated.summary,
    assumptions: generated.assumptions,
    dependencies: generated.dependencies,
    risks: generated.risks,
    items,
    sourcePrompt,
    generationMode: generated.generationMode,
    model: generated.model,
  });

  return transaction(async client => {
    await updateBatchRowTx(client, {
      capabilityId,
      batchId,
      title:
        generated.title ||
        buildBatchTitle({
          capabilityName: bundle.capability.name,
          prompt: sourcePrompt,
        }),
      status: 'REVIEW_READY',
      sourcePrompt,
      selectedWorkflowId: workflow.id,
      summary: generated.summary,
      assumptions: generated.assumptions,
      dependencies: generated.dependencies,
      risks: generated.risks,
      sizingPolicy: generated.sizingPolicy,
      generatedByAgentId: generated.generatedByAgentId,
      generationMode: generated.generationMode,
      planningArtifacts: [artifact],
      createdByUserId: current.createdByUserId,
    });
    await replaceBatchItemsTx(client, capabilityId, batchId, items);
    await insertDecisionTx(client, {
      capabilityId,
      batchId,
      disposition: 'REGENERATED',
      actor,
      note:
        generated.generationMode === 'PLANNING_AGENT'
          ? 'Regenerated the story proposal batch with the Planning Agent.'
          : 'Regenerated the story proposal batch with the fallback planner.',
    });

    const batchRow = await getBatchRowTx(client, capabilityId, batchId);
    const decisions = await listBatchDecisionsTx(client, capabilityId, batchId);
    return toBatchDetail({
      batchRow: batchRow!,
      items,
      decisions,
    });
  });
};

export const promoteStoryProposalBatch = async ({
  capabilityId,
  batchId,
  itemIds,
  actor,
}: {
  capabilityId: string;
  batchId: string;
  itemIds?: string[];
  actor?: ActorContext;
}): Promise<StoryProposalPromotionResult> => {
  const batch = await getStoryProposalBatch(capabilityId, batchId);
  if (!batch) {
    throw new Error(`Story proposal batch ${batchId} was not found.`);
  }

  const epic = batch.items.find(item => item.itemType === 'EPIC');
  if (!epic) {
    throw new Error('Story proposal batch is missing its epic item.');
  }

  const selectedIds = new Set(
    (itemIds && itemIds.length > 0
      ? itemIds
      : batch.items
          .filter(item => item.reviewState === 'APPROVED')
          .map(item => item.id)
    ).filter(Boolean),
  );
  if (selectedIds.size === 0) {
    throw new Error('Approve at least one story before promoting work items.');
  }

  const selectedItems = batch.items.filter(item => selectedIds.has(item.id));
  const selectedStories = selectedItems.filter(item => item.itemType === 'STORY');
  const selectedEpic = selectedItems.find(item => item.itemType === 'EPIC') || epic;

  if (selectedEpic.reviewState === 'REJECTED') {
    throw new Error(
      'The epic is currently rejected. Re-approve or edit the epic before promoting child stories.',
    );
  }
  if (
    selectedStories.length > 0 &&
    selectedEpic.reviewState !== 'APPROVED' &&
    selectedEpic.reviewState !== 'PROMOTED'
  ) {
    throw new Error(
      'Approve the epic before promoting child stories so the parent plan is explicitly reviewed.',
    );
  }

  const notApproved = selectedItems.filter(
    item =>
      item.reviewState !== 'APPROVED' &&
      item.reviewState !== 'PROMOTED' &&
      item.itemType !== 'EPIC',
  );
  if (notApproved.length > 0) {
    throw new Error(
      `Only approved stories can be promoted. Review ${notApproved[0]?.title || 'the selected items'} first.`,
    );
  }

  const bundle = await getCapabilityBundle(capabilityId);
  const existingWorkItems = Array.isArray(bundle.workspace.workItems)
    ? bundle.workspace.workItems
    : [];
  const existingWorkItemById = new Map<string, WorkItem>();
  const existingWorkItemByProposalId = new Map<string, WorkItem>();
  for (const workItem of existingWorkItems) {
    existingWorkItemById.set(workItem.id, workItem);
    if (
      workItem.planningBatchId === batchId &&
      workItem.planningProposalItemId
    ) {
      existingWorkItemByProposalId.set(workItem.planningProposalItemId, workItem);
    }
  }

  const promotedWorkItems: WorkItem[] = [];
  const promotedWorkItemIds = new Set<string>();
  const addPromotedWorkItem = (workItem?: WorkItem | null) => {
    if (!workItem || promotedWorkItemIds.has(workItem.id)) {
      return;
    }
    promotedWorkItemIds.add(workItem.id);
    promotedWorkItems.push(workItem);
  };
  const workItemIdByProposalId = new Map<string, string>();
  let epicWorkItemId = selectedEpic.promotedWorkItemId;
  const existingEpicWorkItem =
    (epicWorkItemId ? existingWorkItemById.get(epicWorkItemId) : undefined) ||
    existingWorkItemByProposalId.get(selectedEpic.id);
  if (!epicWorkItemId && existingEpicWorkItem) {
    epicWorkItemId = existingEpicWorkItem.id;
  }
  if (!epicWorkItemId) {
    const epicWorkItem = await createWorkItemRecord({
      capabilityId,
      title: selectedEpic.title,
      description: selectedEpic.description,
      workflowId: selectedEpic.recommendedWorkflowId,
      taskType: selectedEpic.recommendedTaskType,
      priority: 'High',
      tags: selectedEpic.tags,
      actor,
      claimOnCreate: false,
      autoStartGitSession: true,
      planningMetadata: {
        parentWorkItemId: undefined,
        storyPoints: selectedEpic.storyPoints,
        tShirtSize: selectedEpic.tShirtSize,
        sizingConfidence: selectedEpic.sizingConfidence,
        planningBatchId: batchId,
        planningProposalItemId: selectedEpic.id,
      },
    });
    addPromotedWorkItem(epicWorkItem);
    epicWorkItemId = epicWorkItem.id;
    workItemIdByProposalId.set(selectedEpic.id, epicWorkItem.id);
  } else {
    workItemIdByProposalId.set(selectedEpic.id, epicWorkItemId);
    addPromotedWorkItem(existingEpicWorkItem || existingWorkItemById.get(epicWorkItemId));
  }

  for (const story of selectedStories) {
    const existingStoryWorkItem =
      (story.promotedWorkItemId
        ? existingWorkItemById.get(story.promotedWorkItemId)
        : undefined) || existingWorkItemByProposalId.get(story.id);
    const existingStoryWorkItemId =
      story.promotedWorkItemId || existingStoryWorkItem?.id;
    if (existingStoryWorkItemId) {
      workItemIdByProposalId.set(story.id, existingStoryWorkItemId);
      addPromotedWorkItem(
        existingStoryWorkItem || existingWorkItemById.get(existingStoryWorkItemId),
      );
      continue;
    }

    const created = await createWorkItemRecord({
      capabilityId,
      title: story.title,
      description: story.description,
      workflowId: story.recommendedWorkflowId,
      taskType: story.recommendedTaskType,
      priority: 'Med',
      tags: story.tags,
      actor,
      claimOnCreate: false,
      autoStartGitSession: true,
      planningMetadata: {
        parentWorkItemId: epicWorkItemId,
        storyPoints: story.storyPoints,
        tShirtSize: story.tShirtSize,
        sizingConfidence: story.sizingConfidence,
        planningBatchId: batchId,
        planningProposalItemId: story.id,
      },
    });
    addPromotedWorkItem(created);
    workItemIdByProposalId.set(story.id, created.id);
  }

  await transaction(async client => {
    const currentBatch = await getBatchRowTx(client, capabilityId, batchId);
    const currentItems = await listBatchItemsTx(client, capabilityId, batchId);
    const nextItems = currentItems.map(item => {
      const promotedId =
        workItemIdByProposalId.get(item.id) || item.promotedWorkItemId;
      if (!promotedId) {
        return item;
      }
      return {
        ...item,
        promotedWorkItemId: promotedId,
        reviewState: 'PROMOTED' as const,
        updatedAt: new Date().toISOString(),
      };
    });
    const nextStatus = deriveBatchStatus(nextItems, currentBatch?.status);
    await replaceBatchItemsTx(client, capabilityId, batchId, nextItems);
    await client.query(
      `
        UPDATE capability_story_proposal_batches
        SET status = $3,
            updated_at = NOW()
        WHERE capability_id = $1
          AND id = $2
      `,
      [capabilityId, batchId, nextStatus],
    );

    for (const [proposalItemId, promotedWorkItemId] of workItemIdByProposalId.entries()) {
      await insertDecisionTx(client, {
        capabilityId,
        batchId,
        itemId: proposalItemId,
        disposition: 'PROMOTED',
        actor,
        note: `Promoted proposal item into work item ${promotedWorkItemId}.`,
      });
    }
  });

  const nextBatch = await getStoryProposalBatch(capabilityId, batchId);
  if (!nextBatch) {
    throw new Error('Story proposal batch disappeared after promotion.');
  }

  return {
    batch: nextBatch,
    workItems: promotedWorkItems,
  };
};

export const __storyProposalTestUtils = {
  buildFallbackBatch,
  normalizeGeneratedBatch,
  deriveBatchStatus,
};
