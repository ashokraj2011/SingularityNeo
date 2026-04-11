-- Singularity Neo capability-scoped agent seed
-- Purpose:
--   Seed the built-in owner/specialist agents and minimal workspace defaults
--   for capabilities that already exist in the database.
--
-- Important:
--   1. This script does NOT insert rows into capabilities.
--   2. It expects the schema from docs/sql/singularityneo_schema.sql to exist.
--   3. It is idempotent and safe to re-run.
--   4. Update default_model below if your target runtime does not support
--      gpt-4.1-mini.

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
END $$;

CREATE TEMP TABLE tmp_singularity_seed_capabilities ON COMMIT DROP AS
SELECT
  cap.id AS capability_id,
  cap.name AS capability_name,
  COALESCE(NULLIF(cap.domain, ''), cap.name) AS capability_scope_name,
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
  agent_name TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  objective_template TEXT NOT NULL,
  system_prompt_template TEXT NOT NULL,
  input_artifacts TEXT[] NOT NULL,
  output_artifacts TEXT[] NOT NULL
) ON COMMIT DROP;

INSERT INTO tmp_singularity_built_in_templates (
  template_key,
  agent_name,
  agent_role,
  objective_template,
  system_prompt_template,
  input_artifacts,
  output_artifacts
)
VALUES
  (
    'PLANNING',
    'Planning Agent',
    'Planning Agent',
    'Gather capability and stakeholder inputs for {capabilityName}, align delivery intent across participating agents, and produce a planning report that downstream execution can trust.',
    'You are the Planning Agent for {capabilityName}. Synthesize stakeholder expectations, capability context, and downstream agent inputs into a clear planning report, milestones, and execution assumptions for this capability.',
    ARRAY['Capability charter', 'Stakeholder input briefs', 'Capability operating model'],
    ARRAY['Planning Report', 'Delivery Milestone Plan']
  ),
  (
    'ARCHITECT',
    'Architect',
    'Architect',
    'Shape the target architecture for {capabilityName}, define design guardrails, and keep implementation aligned to platform standards.',
    'You are the Architect agent for {capabilityName}. Lead architecture decisions, integration patterns, and solution governance inside this capability context.',
    ARRAY['Capability charter', 'Architecture standards'],
    ARRAY['Architecture blueprint', 'Design decision log']
  ),
  (
    'BUSINESS-ANALYST',
    'Business Analyst',
    'Business Analyst',
    'Translate business goals for {capabilityName} into clear requirements, acceptance criteria, and delivery-ready scope.',
    'You are the Business Analyst agent for {capabilityName}. Turn business context into requirements, stories, and measurable outcomes grounded in the capability documentation.',
    ARRAY['Capability operating model', 'Stakeholder requirements'],
    ARRAY['Requirements pack', 'Acceptance criteria']
  ),
  (
    'SOFTWARE-DEVELOPER',
    'Software Developer',
    'Software Developer',
    'Implement and evolve software for {capabilityName} using the approved design, repo context, and workflow handoffs.',
    'You are the Software Developer agent for {capabilityName}. Work on code, tests, and implementation details while staying inside this capability scope.',
    ARRAY['Refined stories', 'Technical design'],
    ARRAY['Code changes', 'Implementation notes']
  ),
  (
    'QA',
    'QA',
    'QA',
    'Validate the quality of {capabilityName} deliverables through test design, execution evidence, and defect feedback.',
    'You are the QA agent for {capabilityName}. Focus on functional coverage, regression risk, and release confidence within this capability.',
    ARRAY['Acceptance criteria', 'Build candidate'],
    ARRAY['Test evidence', 'Defect report']
  ),
  (
    'DEVOPS',
    'DevOps',
    'DevOps',
    'Own automation, environments, release readiness, and operational delivery support for {capabilityName}.',
    'You are the DevOps agent for {capabilityName}. Drive pipeline health, branch hygiene, deployment readiness, and runtime support for this capability.',
    ARRAY['Deployment plan', 'Infrastructure context'],
    ARRAY['Release checklist', 'Deployment summary']
  ),
  (
    'VALIDATION',
    'Validation Agent',
    'Validation Agent',
    'Perform cross-check validation for {capabilityName} outputs before they are promoted across workflow stages.',
    'You are the Validation Agent for {capabilityName}. Verify that artifacts, decisions, and handoffs satisfy the capability context before downstream use.',
    ARRAY['Workflow outputs', 'Governance rules'],
    ARRAY['Validation report', 'Release decision']
  ),
  (
    'CONTRARIAN-REVIEWER',
    'Contrarian Reviewer',
    'Contrarian Reviewer',
    'Challenge blocked execution decisions for {capabilityName}, surface hidden risk, and produce adversarial review artifacts for conflict-resolution waits.',
    'You are the Contrarian Reviewer for {capabilityName}. Your job is to stress-test conflict-resolution waits, challenge assumptions, identify missing evidence, and recommend the safest path forward without taking over the human operator decision.',
    ARRAY['Conflict wait context', 'Prior handoffs', 'Capability memory', 'Execution evidence'],
    ARRAY['Contrarian Review', 'Risk Challenge Memo']
  );

CREATE TEMP TABLE tmp_singularity_seed_agents ON COMMIT DROP AS
SELECT
  seed.capability_id,
  seed.owner_agent_id AS agent_id,
  'Capability Owning Agent' AS agent_name,
  'Capability Owner' AS agent_role,
  FORMAT(
    'Own the end-to-end delivery context for %s and coordinate all downstream agents within this capability.',
    seed.capability_name
  ) AS objective,
  FORMAT(
    'You are the capability owner for %s. Ground every decision, workflow, and team action in the capability''s domain, documentation, and governance context.',
    seed.capability_name
  ) AS system_prompt,
  seed.documentation_sources,
  ARRAY['Capability charter']::TEXT[] AS input_artifacts,
  ARRAY['Capability operating model']::TEXT[] AS output_artifacts,
  TRUE AS is_owner,
  FALSE AS is_built_in,
  ARRAY[
    FORMAT('%s team context is isolated to this capability.', seed.capability_name),
    FORMAT(
      'All downstream chats, agents, and workflows should remain aligned to %s.',
      seed.capability_scope_name
    )
  ]::TEXT[] AS learning_notes
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
  seed.documentation_sources,
  template.input_artifacts,
  template.output_artifacts,
  FALSE AS is_owner,
  TRUE AS is_built_in,
  ARRAY[
    FORMAT('%s is a built-in agent for %s.', template.agent_name, seed.capability_name),
    FORMAT(
      'Keep all outputs aligned to %s capability context.',
      seed.capability_scope_name
    )
  ]::TEXT[] AS learning_notes
FROM tmp_singularity_seed_capabilities seed
CROSS JOIN tmp_singularity_built_in_templates template;

UPDATE capabilities cap
SET
  special_agent_id = seed.owner_agent_id,
  updated_at = NOW()
FROM tmp_singularity_seed_capabilities seed
WHERE cap.id = seed.capability_id
  AND COALESCE(cap.special_agent_id, '') = '';

INSERT INTO capability_workspaces (
  capability_id,
  active_chat_agent_id,
  created_at,
  updated_at
)
SELECT
  capability_id,
  owner_agent_id,
  NOW(),
  NOW()
FROM tmp_singularity_seed_capabilities
ON CONFLICT (capability_id) DO UPDATE SET
  active_chat_agent_id = EXCLUDED.active_chat_agent_id,
  updated_at = NOW();

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
  learning_notes,
  skill_ids,
  provider,
  model,
  token_limit,
  created_at,
  updated_at
)
SELECT
  seed.capability_id,
  seed.agent_id,
  seed.agent_name,
  seed.agent_role,
  seed.objective,
  seed.system_prompt,
  'READY',
  seed.documentation_sources,
  seed.input_artifacts,
  seed.output_artifacts,
  seed.is_owner,
  seed.is_built_in,
  seed.learning_notes,
  ARRAY[]::TEXT[],
  'GitHub Copilot SDK',
  'gpt-4.1-mini',
  12000,
  NOW(),
  NOW()
FROM tmp_singularity_seed_agents seed
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
  learning_notes = EXCLUDED.learning_notes,
  provider = EXCLUDED.provider,
  model = EXCLUDED.model,
  token_limit = EXCLUDED.token_limit,
  updated_at = NOW();

INSERT INTO capability_agent_learning_profiles (
  capability_id,
  agent_id,
  status,
  summary,
  highlights,
  context_block,
  source_document_ids,
  source_artifact_ids,
  source_count,
  refreshed_at,
  last_requested_at,
  last_error,
  created_at,
  updated_at
)
SELECT
  capability_id,
  agent_id,
  'NOT_STARTED',
  '',
  '[]'::jsonb,
  '',
  ARRAY[]::TEXT[],
  ARRAY[]::TEXT[],
  0,
  NULL,
  NULL,
  NULL,
  NOW(),
  NOW()
FROM tmp_singularity_seed_agents
ON CONFLICT (capability_id, agent_id) DO NOTHING;

INSERT INTO capability_messages (
  capability_id,
  id,
  role,
  content,
  timestamp,
  agent_id,
  agent_name,
  created_at
)
SELECT
  seed.capability_id,
  'MSG-' || seed.capability_id || '-WELCOME',
  'agent',
  FORMAT(
    'I am the Capability Owning Agent for %s. Everything in this workspace now belongs to this capability context, including team formation, learning, workflows, and chat.',
    seed.capability_name
  ),
  'Just now',
  seed.owner_agent_id,
  'Capability Owning Agent',
  NOW()
FROM tmp_singularity_seed_capabilities seed
ON CONFLICT (capability_id, id) DO UPDATE SET
  role = EXCLUDED.role,
  content = EXCLUDED.content,
  timestamp = EXCLUDED.timestamp,
  agent_id = EXCLUDED.agent_id,
  agent_name = EXCLUDED.agent_name;

COMMIT;
