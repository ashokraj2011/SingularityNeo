-- Singularity Neo capability-scoped starter skills seed
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
  ('SKL-GENERAL-REPO-INSTRUCTIONS', 'Repository-wide Copilot Instructions', 'Shared operating guidance that every standard agent should follow before specializing by role.', 'Analysis', '1.0.0'),
  ('SKL-ROLE-BUSINESS-ANALYST', 'Business Analyst', 'Refine requirements, clarify scope, and produce stakeholder-ready delivery inputs.', 'Analysis', '1.0.0'),
  ('SKL-ROLE-SOFTWARE-ARCHITECT', 'Software Architect', 'Design architecture, interfaces, tradeoffs, and non-functional solution direction.', 'Analysis', '1.0.0'),
  ('SKL-ROLE-SOFTWARE-ENGINEER', 'Software Engineer', 'Implement, refactor, debug, and document maintainable code aligned to repository patterns.', 'Automation', '1.0.0'),
  ('SKL-ROLE-QA-ENGINEER', 'QA Engineer', 'Define test strategy, quality risks, and validation coverage for safe delivery.', 'Analysis', '1.0.0'),
  ('SKL-ROLE-RELEASE-ENGINEER', 'Release Engineer', 'Plan release safety, deployment sequencing, rollback, and production readiness.', 'Compliance', '1.0.0'),
  ('SKL-ROLE-CONFLICT-RESOLVER', 'Conflict Resolver', 'Resolve cross-role disagreements using explicit precedence, tradeoffs, and safe reversible decisions.', 'Compliance', '1.0.0');

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
