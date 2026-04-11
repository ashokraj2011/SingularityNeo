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
  ('SKL-001', 'Log Analysis', 'Analyze system logs for patterns and anomalies.', 'Analysis', '1.2.0'),
  ('SKL-002', 'Auto-Remediation', 'Automatically fix common infrastructure issues.', 'Automation', '0.9.5'),
  ('SKL-003', 'Security Scanning', 'Scan artifacts for vulnerabilities.', 'Security', '2.1.0'),
  ('SKL-004', 'Compliance Verification', 'Verify artifacts against regulatory frameworks.', 'Compliance', '1.5.0'),
  ('SKL-005', 'Data Normalization', 'Transform raw data into canonical formats.', 'Data', '1.1.0');

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
