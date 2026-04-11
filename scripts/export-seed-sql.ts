import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILT_IN_AGENT_TEMPLATES, SKILL_LIBRARY } from '../src/constants';
import {
  createStandardCapabilityWorkflow,
  STANDARD_SDLC_STEP_TEMPLATES,
} from '../src/lib/standardWorkflow';
import { createDefaultCapabilityLifecycle } from '../src/lib/capabilityLifecycle';

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

  for (const step of STANDARD_SDLC_STEP_TEMPLATES) {
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
  const workflowTemplate = JSON.stringify({
    nodes: sampleWorkflow.nodes,
    edges: sampleWorkflow.edges,
    steps: sampleWorkflow.steps,
  });

  return `-- Singularity Neo capability-scoped standard workflow seed
-- Seeds the standard Enterprise SDLC Flow into existing capabilities.
-- Note:
--   This starter workflow uses the default SDLC phase set. Capabilities that
--   use a custom lifecycle may need the workflow regenerated or adjusted after
--   import.

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

WITH workflow_payload AS (
  SELECT
    seed.capability_id,
    seed.capability_slug,
    seed.owner_agent_id,
    REPLACE(
      REPLACE(
        ${sqlString(workflowTemplate)},
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
  'WF-' || capability_slug || '-STANDARD-SDLC',
  'Enterprise SDLC Flow',
  'STABLE',
  'SDLC',
  'CAPABILITY',
  'Standard SDLC workflow with explicit agent hand-offs, standard input/output document artifacts, governance validation, and human approval before release.',
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

COMMIT;
`;
};

const writeSqlFile = (fileName: string, content: string) => {
  mkdirSync(sqlOutputDir, { recursive: true });
  writeFileSync(path.join(sqlOutputDir, fileName), content);
};

writeSqlFile('singularityneo_seed_skills.sql', createSkillsSql());
writeSqlFile('singularityneo_seed_artifacts.sql', createArtifactsSql());
writeSqlFile('singularityneo_seed_workflows.sql', createWorkflowSql());

console.log('Exported seed SQL files to', sqlOutputDir);
