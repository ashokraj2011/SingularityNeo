import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILT_IN_AGENT_TEMPLATES, SKILL_LIBRARY } from '../src/constants';
import { WORKSPACE_AGENT_TEMPLATES } from '../src/lib/workspaceFoundations';
import {
  createBrokerageCapabilityWorkflow,
  createFdasBusinessWorkflow,
  createStandardCapabilityWorkflow,
  FDAS_BUSINESS_STEP_TEMPLATES,
  STANDARD_SDLC_STEP_TEMPLATES,
} from '../src/lib/standardWorkflow';
import {
  createBrokerageCapabilityLifecycle,
  createDefaultCapabilityLifecycle,
} from '../src/lib/capabilityLifecycle';

type AgentRef = (typeof BUILT_IN_AGENT_TEMPLATES)[number]['key'] | 'OWNER';
type ArtifactSeedRecord = {
  key: string;
  name: string;
  type: string;
  direction: 'INPUT' | 'OUTPUT';
  agentRef: AgentRef;
  agentLabel: string;
  description: string;
  inputs: string[];
  sourceWorkflow: boolean;
  priority: number;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sqlOutputDir = path.join(repoRoot, 'docs/sql');

const sqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;

const sqlTextArray = (values: string[]) =>
  values.length > 0
    ? `ARRAY[${values.map(sqlString).join(', ')}]::TEXT[]`
    : 'ARRAY[]::TEXT[]';

const sqlNullableString = (value?: string | null) =>
  value ? sqlString(value) : 'NULL';

const sqlBoolean = (value: boolean) => (value ? 'TRUE' : 'FALSE');

const sqlJson = (value: unknown) => `${sqlString(JSON.stringify(value))}::jsonb`;

const slugify = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

const getAgentLabel = (agentRef: AgentRef) =>
  agentRef === 'OWNER'
    ? 'Capability Owning Agent'
    : BUILT_IN_AGENT_TEMPLATES.find(template => template.key === agentRef)?.name || agentRef;

const getArtifactTemplate = (name: string, description: string, inputs: string[]) =>
  [
    `# ${name}`,
    '',
    '## Purpose',
    description,
    '',
    '## Required Inputs',
    ...(inputs.length > 0 ? inputs.map(item => `- ${item}`) : ['- Add required context here']),
    '',
    '## Summary',
    '- Capture the core decision, output, or evidence.',
    '',
    '## Details',
    '- Add the operational detail, assumptions, and trace notes.',
    '',
    '## Follow-up',
    '- Record owners, next steps, and downstream hand-off expectations.',
  ].join('\n');

const artifactSeeds = (() => {
  const records = new Map<string, ArtifactSeedRecord>();

  const upsertRecord = (record: Omit<ArtifactSeedRecord, 'key'>) => {
    const key = slugify(record.name);
    const existing = records.get(key);
    const nextRecord = { ...record, key };

    if (!existing || nextRecord.priority > existing.priority) {
      records.set(key, nextRecord);
      return;
    }

    if (nextRecord.priority === existing.priority) {
      records.set(key, {
        ...existing,
        inputs: Array.from(new Set([...existing.inputs, ...nextRecord.inputs])),
        description: existing.description || nextRecord.description,
      });
    }
  };

  upsertRecord({
    name: 'Capability Charter',
    type: 'Capability Foundation',
    direction: 'INPUT',
    agentRef: 'OWNER',
    agentLabel: getAgentLabel('OWNER'),
    description: 'Foundational charter that defines the capability mission, scope, stakeholders, and operating expectations.',
    inputs: [],
    sourceWorkflow: false,
    priority: 50,
  });

  upsertRecord({
    name: 'Capability Operating Model',
    type: 'Capability Foundation',
    direction: 'OUTPUT',
    agentRef: 'OWNER',
    agentLabel: getAgentLabel('OWNER'),
    description: 'Operating model that aligns the capability owner, downstream agents, and governance context.',
    inputs: ['Capability Charter'],
    sourceWorkflow: false,
    priority: 70,
  });

  for (const template of BUILT_IN_AGENT_TEMPLATES) {
    for (const artifactName of template.inputArtifacts) {
      upsertRecord({
        name: artifactName,
        type: 'Agent Contract',
        direction: 'INPUT',
        agentRef: template.key,
        agentLabel: template.name,
        description: `${template.name} depends on this artifact as an approved starting input.`,
        inputs: [],
        sourceWorkflow: false,
        priority: 40,
      });
    }

    for (const artifactName of template.outputArtifacts) {
      upsertRecord({
        name: artifactName,
        type: 'Agent Contract',
        direction: 'OUTPUT',
        agentRef: template.key,
        agentLabel: template.name,
        description: `${template.name} is expected to publish this artifact as part of its baseline contribution.`,
        inputs: [],
        sourceWorkflow: false,
        priority: 60,
      });
    }
  }

  for (const step of [...STANDARD_SDLC_STEP_TEMPLATES, ...FDAS_BUSINESS_STEP_TEMPLATES]) {
    for (const artifactName of step.artifactContract.requiredInputs) {
      upsertRecord({
        name: artifactName,
        type: 'Workflow Input',
        direction: 'INPUT',
        agentRef: step.agentRef,
        agentLabel: getAgentLabel(step.agentRef),
        description: `Required input for the ${step.name} step.`,
        inputs: [],
        sourceWorkflow: true,
        priority: 30,
      });
    }

    for (const artifactName of step.artifactContract.expectedOutputs) {
      upsertRecord({
        name: artifactName,
        type: 'Workflow Output',
        direction: 'OUTPUT',
        agentRef: step.agentRef,
        agentLabel: getAgentLabel(step.agentRef),
        description: step.artifactContract.notes,
        inputs: step.artifactContract.requiredInputs,
        sourceWorkflow: true,
        priority: 80,
      });
    }

    if (step.handoffArtifactContract) {
      for (const artifactName of step.handoffArtifactContract.expectedOutputs) {
        upsertRecord({
          name: artifactName,
          type: 'Handoff Packet',
          direction: 'OUTPUT',
          agentRef: step.agentRef,
          agentLabel: getAgentLabel(step.agentRef),
          description: step.handoffArtifactContract.notes,
          inputs: step.handoffArtifactContract.requiredInputs,
          sourceWorkflow: true,
          priority: 90,
        });
      }
    }
  }

  return Array.from(records.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
})();

const ownerAgentTemplate = WORKSPACE_AGENT_TEMPLATES.find(template => template.key === 'OWNER');
if (!ownerAgentTemplate) {
  throw new Error('The owner agent template is required to export seed SQL.');
}

const collectionBuiltInAgentKeys = new Set([
  'PLANNING',
  'ARCHITECT',
  'BUSINESS-ANALYST',
  'VALIDATION',
]);

const createAgentsSql = () => `-- Singularity Neo capability-scoped agent seed
-- Seeds the built-in owner/specialist agents for capabilities that already exist.
-- This script does NOT create capabilities.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'capabilities'
  ) THEN
    RAISE EXCEPTION 'Table "capabilities" does not exist. Load the schema first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'capability_agents'
  ) THEN
    RAISE EXCEPTION 'Table "capability_agents" does not exist. Load the schema first.';
  END IF;
END $$;

CREATE TEMP TABLE tmp_singularity_seed_capabilities ON COMMIT DROP AS
SELECT
  cap.id AS capability_id,
  cap.name AS capability_name,
  COALESCE(NULLIF(cap.domain, ''), cap.name) AS capability_scope_name,
  COALESCE(NULLIF(cap.capability_kind, ''), 'DELIVERY') AS capability_kind,
  COALESCE(
    NULLIF(cap.special_agent_id, ''),
    'AGENT-' ||
      LEFT(
        TRIM(
          BOTH '-'
          FROM REGEXP_REPLACE(
            UPPER(COALESCE(NULLIF(cap.name, ''), cap.id, 'CAPABILITY')),
            '[^A-Z0-9]+',
            '-',
            'g'
          )
        ),
        24
      ) ||
      '-OWNER'
  ) AS owner_agent_id,
  ARRAY_REMOVE(
    ARRAY[
      NULLIF(cap.confluence_link, ''),
      NULLIF(cap.jira_board_link, ''),
      NULLIF(cap.documentation_notes, '')
    ],
    NULL
  )::TEXT[] AS documentation_sources
FROM capabilities cap;

CREATE TEMP TABLE tmp_singularity_built_in_templates (
  template_key TEXT NOT NULL,
  role_starter_key TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  objective_template TEXT NOT NULL,
  system_prompt_template TEXT NOT NULL,
  contract_json JSONB NOT NULL,
  input_artifacts TEXT[] NOT NULL,
  output_artifacts TEXT[] NOT NULL,
  default_skill_ids TEXT[] NOT NULL,
  preferred_tool_ids TEXT[] NOT NULL,
  enabled_for_collection BOOLEAN NOT NULL
) ON COMMIT DROP;

INSERT INTO tmp_singularity_built_in_templates (
  template_key,
  role_starter_key,
  agent_name,
  agent_role,
  objective_template,
  system_prompt_template,
  contract_json,
  input_artifacts,
  output_artifacts,
  default_skill_ids,
  preferred_tool_ids,
  enabled_for_collection
)
VALUES
${BUILT_IN_AGENT_TEMPLATES.map(template => {
  const workspaceTemplate = WORKSPACE_AGENT_TEMPLATES.find(
    item => item.key === template.key,
  );
  return `  (
    ${sqlString(template.key)},
    ${sqlString(template.roleStarterKey)},
    ${sqlString(template.name)},
    ${sqlString(template.role)},
    ${sqlString(template.objective)},
    ${sqlString(template.systemPrompt)},
    ${sqlJson(template.contract)},
    ${sqlTextArray([...template.inputArtifacts])},
    ${sqlTextArray([...template.outputArtifacts])},
    ${sqlTextArray(workspaceTemplate?.defaultSkillIds || [])},
    ${sqlTextArray(workspaceTemplate?.preferredToolIds || [])},
    ${sqlBoolean(collectionBuiltInAgentKeys.has(template.key))}
  )`;
}).join(',\n')};

UPDATE capabilities cap
SET
  special_agent_id = seed.owner_agent_id,
  updated_at = NOW()
FROM tmp_singularity_seed_capabilities seed
WHERE cap.id = seed.capability_id
  AND COALESCE(NULLIF(cap.special_agent_id, ''), '') <> seed.owner_agent_id;

INSERT INTO capability_agents (
  capability_id,
  id,
  name,
  role,
  objective,
  system_prompt,
  initialization_status,
  documentation_sources,
  input_artifacts,
  output_artifacts,
  is_owner,
  is_built_in,
  standard_template_key,
  role_starter_key,
  learning_notes,
  contract,
  skill_ids,
  preferred_tool_ids,
  provider,
  model,
  token_limit,
  updated_at
)
SELECT
  seed.capability_id,
  seed.owner_agent_id,
  ${sqlString(ownerAgentTemplate.name)},
  ${sqlString(ownerAgentTemplate.role)},
  REPLACE(${sqlString(ownerAgentTemplate.objective)}, '{capabilityName}', seed.capability_name),
  REPLACE(${sqlString(ownerAgentTemplate.systemPrompt)}, '{capabilityName}', seed.capability_name),
  'READY',
  seed.documentation_sources,
  ${sqlTextArray(ownerAgentTemplate.inputArtifacts)},
  ${sqlTextArray(ownerAgentTemplate.outputArtifacts)},
  TRUE,
  FALSE,
  NULL,
  ${sqlString(ownerAgentTemplate.roleStarterKey)},
  ARRAY[
    FORMAT('%s team context is isolated to this capability.', seed.capability_name),
    FORMAT(
      'All downstream chats, agents, and workflows should remain aligned to %s.',
      seed.capability_scope_name
    )
  ]::TEXT[],
  ${sqlJson(ownerAgentTemplate.contract)},
  ${sqlTextArray(ownerAgentTemplate.defaultSkillIds)},
  ${sqlTextArray(ownerAgentTemplate.preferredToolIds)},
  'GitHub Copilot SDK',
  'gpt-4.1-mini',
  12000,
  NOW()
FROM tmp_singularity_seed_capabilities seed

UNION ALL

SELECT
  seed.capability_id,
  'AGENT-' ||
    LEFT(
      TRIM(
        BOTH '-'
        FROM REGEXP_REPLACE(UPPER(seed.capability_id), '[^A-Z0-9]+', '-', 'g')
      ),
      24
    ) ||
    '-' ||
    template.template_key AS agent_id,
  template.agent_name,
  template.agent_role,
  REPLACE(template.objective_template, '{capabilityName}', seed.capability_name) AS objective,
  REPLACE(
    template.system_prompt_template,
    '{capabilityName}',
    seed.capability_name
  ) AS system_prompt,
  'READY',
  seed.documentation_sources,
  template.input_artifacts,
  template.output_artifacts,
  FALSE,
  TRUE,
  template.template_key,
  template.role_starter_key,
  ARRAY[
    FORMAT('%s is a built-in agent for %s.', template.agent_name, seed.capability_name),
    FORMAT(
      'Keep all outputs aligned to %s capability context.',
      seed.capability_scope_name
    )
  ]::TEXT[] AS learning_notes,
  template.contract_json,
  template.default_skill_ids,
  template.preferred_tool_ids,
  'GitHub Copilot SDK',
  'gpt-4.1-mini',
  12000,
  NOW()
FROM tmp_singularity_seed_capabilities seed
CROSS JOIN tmp_singularity_built_in_templates template
WHERE seed.capability_kind <> 'COLLECTION'
   OR template.enabled_for_collection = TRUE

ON CONFLICT (capability_id, id) DO UPDATE SET
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  objective = EXCLUDED.objective,
  system_prompt = EXCLUDED.system_prompt,
  initialization_status = EXCLUDED.initialization_status,
  documentation_sources = EXCLUDED.documentation_sources,
  input_artifacts = EXCLUDED.input_artifacts,
  output_artifacts = EXCLUDED.output_artifacts,
  is_owner = EXCLUDED.is_owner,
  is_built_in = EXCLUDED.is_built_in,
  standard_template_key = EXCLUDED.standard_template_key,
  role_starter_key = EXCLUDED.role_starter_key,
  learning_notes = EXCLUDED.learning_notes,
  contract = EXCLUDED.contract,
  skill_ids = EXCLUDED.skill_ids,
  preferred_tool_ids = EXCLUDED.preferred_tool_ids,
  provider = EXCLUDED.provider,
  model = EXCLUDED.model,
  token_limit = EXCLUDED.token_limit,
  updated_at = NOW();

COMMIT;
`;

const createSkillsSql = () => `-- Singularity Neo capability-scoped starter skills seed
-- Seeds the shared starter skill library into existing capabilities.
-- This script does NOT create capabilities.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'capability_skills'
  ) THEN
    RAISE EXCEPTION 'Table "capability_skills" does not exist. Load the schema first.';
  END IF;
END $$;

CREATE TEMP TABLE tmp_singularity_skill_templates (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  version TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO tmp_singularity_skill_templates (
  id,
  name,
  description,
  category,
  version
)
VALUES
${SKILL_LIBRARY.map(
  skill =>
    `  (${sqlString(skill.id)}, ${sqlString(skill.name)}, ${sqlString(skill.description)}, ${sqlString(skill.category)}, ${sqlString(skill.version)})`,
).join(',\n')};

INSERT INTO capability_skills (
  capability_id,
  id,
  name,
  description,
  category,
  version,
  created_at,
  updated_at
)
SELECT
  cap.id,
  skill.id,
  skill.name,
  skill.description,
  skill.category,
  skill.version,
  NOW(),
  NOW()
FROM capabilities cap
CROSS JOIN tmp_singularity_skill_templates skill
ON CONFLICT (capability_id, id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  version = EXCLUDED.version,
  updated_at = NOW();

COMMIT;
`;

const createArtifactsSql = () => `-- Singularity Neo capability-scoped starter artifacts seed
-- Seeds reusable artifact templates and contracts for existing capabilities.
-- This script does NOT create capabilities.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'capability_artifacts'
  ) THEN
    RAISE EXCEPTION 'Table "capability_artifacts" does not exist. Load the schema first.';
  END IF;
END $$;

CREATE TEMP TABLE tmp_singularity_seed_capabilities ON COMMIT DROP AS
SELECT
  cap.id AS capability_id,
  LEFT(
    TRIM(
      BOTH '-'
      FROM REGEXP_REPLACE(UPPER(cap.id), '[^A-Z0-9]+', '-', 'g')
    ),
    24
  ) AS capability_slug,
  COALESCE(
    NULLIF(cap.special_agent_id, ''),
    'AGENT-' ||
      LEFT(
        TRIM(
          BOTH '-'
          FROM REGEXP_REPLACE(
            UPPER(COALESCE(NULLIF(cap.name, ''), cap.id, 'CAPABILITY')),
            '[^A-Z0-9]+',
            '-',
            'g'
          )
        ),
        24
      ) ||
      '-OWNER'
  ) AS owner_agent_id
FROM capabilities cap;

CREATE TEMP TABLE tmp_singularity_artifact_templates (
  artifact_key TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  direction TEXT NOT NULL,
  agent_ref TEXT NOT NULL,
  agent_label TEXT NOT NULL,
  description TEXT NOT NULL,
  inputs TEXT[] NOT NULL,
  template_text TEXT NOT NULL,
  source_workflow BOOLEAN NOT NULL
) ON COMMIT DROP;

INSERT INTO tmp_singularity_artifact_templates (
  artifact_key,
  name,
  type,
  direction,
  agent_ref,
  agent_label,
  description,
  inputs,
  template_text,
  source_workflow
)
VALUES
${artifactSeeds
  .map(
    artifact => `  (
    ${sqlString(artifact.key)},
    ${sqlString(artifact.name)},
    ${sqlString(artifact.type)},
    ${sqlString(artifact.direction)},
    ${sqlString(artifact.agentRef)},
    ${sqlString(artifact.agentLabel)},
    ${sqlString(artifact.description)},
    ${sqlTextArray(artifact.inputs)},
    ${sqlString(getArtifactTemplate(artifact.name, artifact.description, artifact.inputs))},
    ${sqlBoolean(artifact.sourceWorkflow)}
  )`,
  )
  .join(',\n')};

INSERT INTO capability_artifacts (
  capability_id,
  id,
  name,
  type,
  inputs,
  version,
  agent,
  created,
  template,
  documentation_status,
  is_master_artifact,
  description,
  direction,
  connected_agent_id,
  source_workflow_id,
  content_format,
  downloadable,
  created_at,
  updated_at
)
SELECT
  seed.capability_id,
  'ART-' || seed.capability_slug || '-' || artifact.artifact_key,
  artifact.name,
  artifact.type,
  artifact.inputs,
  'v1.0.0',
  artifact.agent_label,
  TO_CHAR(CURRENT_DATE, 'DD Mon YYYY'),
  artifact.template_text,
  'SYNCED',
  TRUE,
  artifact.description,
  artifact.direction,
  CASE
    WHEN artifact.agent_ref = 'OWNER'
      THEN seed.owner_agent_id
    ELSE 'AGENT-' || seed.capability_slug || '-' || artifact.agent_ref
  END,
  CASE
    WHEN artifact.source_workflow
      THEN 'WF-' || seed.capability_slug || '-STANDARD-SDLC'
    ELSE NULL
  END,
  'MARKDOWN',
  FALSE,
  NOW(),
  NOW()
FROM tmp_singularity_seed_capabilities seed
CROSS JOIN tmp_singularity_artifact_templates artifact
ON CONFLICT (capability_id, id) DO UPDATE SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  inputs = EXCLUDED.inputs,
  version = EXCLUDED.version,
  agent = EXCLUDED.agent,
  template = EXCLUDED.template,
  documentation_status = EXCLUDED.documentation_status,
  is_master_artifact = EXCLUDED.is_master_artifact,
  description = EXCLUDED.description,
  direction = EXCLUDED.direction,
  connected_agent_id = EXCLUDED.connected_agent_id,
  source_workflow_id = EXCLUDED.source_workflow_id,
  content_format = EXCLUDED.content_format,
  downloadable = EXCLUDED.downloadable,
  updated_at = NOW();

COMMIT;
`;

const createWorkflowSql = () => {
  const sampleWorkflow = createStandardCapabilityWorkflow({
    id: 'CAPABILITYIDTOKEN',
    name: 'Capability Template',
    specialAgentId: 'OWNERAGENTTOKEN',
    lifecycle: createDefaultCapabilityLifecycle(),
  });
  const brokerageWorkflow = createBrokerageCapabilityWorkflow({
    id: 'CAPABILITYIDTOKEN',
    name: 'Capability Template',
    specialAgentId: 'OWNERAGENTTOKEN',
    lifecycle: createBrokerageCapabilityLifecycle(),
  });
  const fdasWorkflow = createFdasBusinessWorkflow({
    id: 'CAPABILITYIDTOKEN',
    name: 'Capability Template',
    specialAgentId: 'OWNERAGENTTOKEN',
    lifecycle: createDefaultCapabilityLifecycle(),
  });
  const workflowTemplate = JSON.stringify({
    nodes: sampleWorkflow.nodes,
    edges: sampleWorkflow.edges,
    steps: sampleWorkflow.steps,
  });
  const brokerageWorkflowTemplate = JSON.stringify({
    nodes: brokerageWorkflow.nodes,
    edges: brokerageWorkflow.edges,
    steps: brokerageWorkflow.steps,
  });
  const fdasWorkflowTemplate = JSON.stringify({
    nodes: fdasWorkflow.nodes,
    edges: fdasWorkflow.edges,
    steps: fdasWorkflow.steps,
  });

  return `-- Singularity Neo capability-scoped shared workflow seed
-- Seeds the shared Enterprise and Brokerage SDLC flows into existing capabilities.
-- Note:
--   The Enterprise workflow uses the default SDLC phase set.
--   The Brokerage workflow uses Inception, Elaboration, Construction, and Delivery.
--   Capabilities with other custom lifecycles may still need the workflow regenerated or adjusted after import.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'capability_workflows'
  ) THEN
    RAISE EXCEPTION 'Table "capability_workflows" does not exist. Load the schema first.';
  END IF;
END $$;

CREATE TEMP TABLE tmp_singularity_seed_capabilities ON COMMIT DROP AS
SELECT
  cap.id AS capability_id,
  LEFT(
    TRIM(
      BOTH '-'
      FROM REGEXP_REPLACE(UPPER(cap.id), '[^A-Z0-9]+', '-', 'g')
    ),
    24
  ) AS capability_slug,
  COALESCE(
    NULLIF(cap.special_agent_id, ''),
    'AGENT-' ||
      LEFT(
        TRIM(
          BOTH '-'
          FROM REGEXP_REPLACE(
            UPPER(COALESCE(NULLIF(cap.name, ''), cap.id, 'CAPABILITY')),
            '[^A-Z0-9]+',
            '-',
            'g'
          )
        ),
        24
      ) ||
      '-OWNER'
  ) AS owner_agent_id
FROM capabilities cap;

WITH workflow_templates AS (
  SELECT
    'STANDARD-SDLC'::TEXT AS workflow_suffix,
    'Enterprise SDLC Flow'::TEXT AS workflow_name,
    'Standard SDLC workflow with explicit agent hand-offs, standard input/output document artifacts, governance validation, and human approval before release.'::TEXT AS workflow_summary,
    ${sqlString(workflowTemplate)}::TEXT AS workflow_template
  UNION ALL
  SELECT
    'BROKERAGE-SDLC'::TEXT AS workflow_suffix,
    'Brokerage SDLC Flow'::TEXT AS workflow_name,
    'Brokerage SDLC workflow with Inception, Elaboration, Construction, and Delivery lanes plus entry points for strategic initiatives, feature enhancements, production issues, bugfixes, security findings, and rehydration work.'::TEXT AS workflow_summary,
    ${sqlString(brokerageWorkflowTemplate)}::TEXT AS workflow_template
),
workflow_payload AS (
  SELECT
    seed.capability_id,
    seed.capability_slug,
    seed.owner_agent_id,
    template.workflow_suffix,
    template.workflow_name,
    template.workflow_summary,
    REPLACE(
      REPLACE(
        template.workflow_template,
        'OWNERAGENTTOKEN',
        seed.owner_agent_id
      ),
      'CAPABILITYIDTOKEN',
      seed.capability_slug
    )::jsonb AS payload
  FROM tmp_singularity_seed_capabilities seed
  CROSS JOIN workflow_templates template
)
INSERT INTO capability_workflows (
  capability_id,
  id,
  name,
  status,
  workflow_type,
  scope,
  summary,
  schema_version,
  entry_node_id,
  nodes,
  edges,
  steps,
  publish_state,
  created_at,
  updated_at
)
SELECT
  capability_id,
  'WF-' || capability_slug || '-' || workflow_suffix,
  workflow_name,
  'STABLE',
  'SDLC',
  'CAPABILITY',
  workflow_summary,
  2,
  'NODE-' || capability_slug || '-START',
  payload->'nodes',
  payload->'edges',
  payload->'steps',
  'PUBLISHED',
  NOW(),
  NOW()
FROM workflow_payload
ON CONFLICT (capability_id, id) DO UPDATE SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  workflow_type = EXCLUDED.workflow_type,
  scope = EXCLUDED.scope,
  summary = EXCLUDED.summary,
  schema_version = EXCLUDED.schema_version,
  entry_node_id = EXCLUDED.entry_node_id,
  nodes = EXCLUDED.nodes,
  edges = EXCLUDED.edges,
  steps = EXCLUDED.steps,
  publish_state = EXCLUDED.publish_state,
  updated_at = NOW();

-- ── FDAS Business Use Case workflow ────────────────────────────────────────
-- Human-only three-stage approval workflow (workflow_type = BUSINESS / Custom).
-- Stages: INTAKE (Analysis) → REVIEW (QA) → AUTHORIZATION (Release).
-- All steps are performed by designated human roles — no autonomous agents.
WITH fdas_workflow_payload AS (
  SELECT
    seed.capability_id,
    seed.capability_slug,
    seed.owner_agent_id,
    REPLACE(
      REPLACE(
        ${sqlString(fdasWorkflowTemplate)}::TEXT,
        'OWNERAGENTTOKEN',
        seed.owner_agent_id
      ),
      'CAPABILITYIDTOKEN',
      seed.capability_slug
    )::jsonb AS payload
  FROM tmp_singularity_seed_capabilities seed
)
INSERT INTO capability_workflows (
  capability_id,
  id,
  name,
  status,
  workflow_type,
  scope,
  summary,
  schema_version,
  entry_node_id,
  nodes,
  edges,
  steps,
  publish_state,
  created_at,
  updated_at
)
SELECT
  capability_id,
  'WF-' || capability_slug || '-FDAS-BUSINESS',
  'FDAS Business Use Case',
  'STABLE',
  'Custom',
  'CAPABILITY',
  'Human-only three-stage business workflow for the Financial Data and Analytics Services (FDAS) use case. Each stage closes with a mandatory human approval gate: Stage 1 screens the initial request for strategic alignment, Stage 2 validates the business and risk assessment with senior stakeholders, and Stage 3 captures executive sign-off before the use case is cleared for execution. No autonomous agents participate — all actions and decisions are performed by designated human roles.',
  2,
  'NODE-' || capability_slug || '-START',
  payload->'nodes',
  payload->'edges',
  payload->'steps',
  'PUBLISHED',
  NOW(),
  NOW()
FROM fdas_workflow_payload
ON CONFLICT (capability_id, id) DO UPDATE SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  workflow_type = EXCLUDED.workflow_type,
  scope = EXCLUDED.scope,
  summary = EXCLUDED.summary,
  schema_version = EXCLUDED.schema_version,
  entry_node_id = EXCLUDED.entry_node_id,
  nodes = EXCLUDED.nodes,
  edges = EXCLUDED.edges,
  steps = EXCLUDED.steps,
  publish_state = EXCLUDED.publish_state,
  updated_at = NOW();
-- ── end FDAS Business Use Case ──────────────────────────────────────────────

COMMIT;
`;
};

const writeSqlFile = (fileName: string, content: string) => {
  mkdirSync(sqlOutputDir, { recursive: true });
  writeFileSync(path.join(sqlOutputDir, fileName), content);
};

writeSqlFile('singularityneo_seed_agents.sql', createAgentsSql());
writeSqlFile('singularityneo_seed_skills.sql', createSkillsSql());
writeSqlFile('singularityneo_seed_artifacts.sql', createArtifactsSql());
writeSqlFile('singularityneo_seed_workflows.sql', createWorkflowSql());

console.log('Exported seed SQL files to', sqlOutputDir);
