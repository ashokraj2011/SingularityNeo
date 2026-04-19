-- Singularity Neo governance controls catalog seed
--
-- Seeds ~45 controls across NIST CSF 2.0, SOC 2 TSC 2017, and ISO/IEC
-- 27001:2022 Annex A, plus default bindings that tie the platform's
-- already-enforced policy surfaces to the controls they satisfy.
--
-- This file is kept in lockstep with server/governance/controlsCatalog.ts.
-- Runtime bootstrap (server/governance/controls.ts :: ensureControlsSeeded)
-- uses the TS module; this SQL file is for psql-first operators. Re-runs
-- are idempotent — INSERT ... ON CONFLICT UPDATE refreshes descriptions
-- without clobbering operator-added bindings.
--
-- Seed version: 2026.04.1

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'governance_controls'
  ) THEN
    RAISE EXCEPTION 'Table "governance_controls" does not exist. Load the schema first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'governance_control_bindings'
  ) THEN
    RAISE EXCEPTION 'Table "governance_control_bindings" does not exist. Load the schema first.';
  END IF;
END $$;

INSERT INTO governance_controls (
  control_id, framework, control_code, control_family, title, description,
  owner_role, severity, status, seed_version, created_at, updated_at
) VALUES
  ('GOV-CTRL-NIST-001', 'NIST_CSF_2', 'GV.OC-01', 'Govern · Organizational Context', 'Organizational mission is understood and informs risk decisions', 'The mission of the organization is understood and informs cybersecurity risk management.', 'EXECUTIVE', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-NIST-002', 'NIST_CSF_2', 'GV.RR-02', 'Govern · Roles, Responsibilities, Authorities', 'Cybersecurity roles and responsibilities are established', 'Roles, responsibilities, and authorities for cybersecurity are established, communicated, and enforced.', 'EXECUTIVE', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-NIST-003', 'NIST_CSF_2', 'GV.PO-01', 'Govern · Policy', 'Cybersecurity policy is established and communicated', 'Policy for managing cybersecurity risks is established based on organizational context and communicated.', 'SECURITY', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-NIST-004', 'NIST_CSF_2', 'ID.AM-01', 'Identify · Asset Management', 'Hardware and software inventory is maintained', 'Inventories of hardware and software managed by the organization are maintained.', 'PLATFORM', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-NIST-005', 'NIST_CSF_2', 'ID.AM-05', 'Identify · Asset Management', 'Resources are prioritized based on classification and criticality', 'Resources are prioritized based on their classification, criticality, and business value.', 'PLATFORM', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-NIST-006', 'NIST_CSF_2', 'ID.RA-01', 'Identify · Risk Assessment', 'Vulnerabilities in assets are identified, validated, and recorded', 'Vulnerabilities in assets are identified, validated, and recorded.', 'SECURITY', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-NIST-007', 'NIST_CSF_2', 'PR.AA-01', 'Protect · Identity Management, Authentication, Access Control', 'Identities and credentials are managed for authorized users and services', 'Identities and credentials for authorized users, services, and hardware are managed.', 'SECURITY', 'SEV_1', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-NIST-008', 'NIST_CSF_2', 'PR.AA-05', 'Protect · Identity Management, Authentication, Access Control', 'Access permissions integrate least privilege and separation of duties', 'Access permissions, entitlements, and authorizations are defined in policy, managed, enforced, and reviewed.', 'SECURITY', 'SEV_1', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-NIST-009', 'NIST_CSF_2', 'PR.DS-01', 'Protect · Data Security', 'The confidentiality, integrity, and availability of data-at-rest are protected', 'The confidentiality, integrity, and availability of data-at-rest are protected.', 'SECURITY', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-NIST-010', 'NIST_CSF_2', 'PR.DS-11', 'Protect · Data Security', 'Backups are created, protected, maintained, and tested', 'Backups of data are created, protected, maintained, and tested.', 'PLATFORM', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-NIST-011', 'NIST_CSF_2', 'PR.IP-01', 'Protect · Information Protection Processes', 'Baseline configurations of technology assets are created and maintained', 'Configuration baselines of technology assets are created and maintained under change control.', 'PLATFORM', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-NIST-012', 'NIST_CSF_2', 'PR.IP-04', 'Protect · Information Protection Processes', 'Response and recovery plans are in place and managed', 'Response and recovery plans are established, managed, and periodically exercised.', 'SECURITY', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-NIST-013', 'NIST_CSF_2', 'DE.CM-01', 'Detect · Continuous Monitoring', 'Networks and network services are monitored to detect potentially adverse events', 'Networks and network services are monitored to detect potentially adverse events.', 'SECURITY', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-NIST-014', 'NIST_CSF_2', 'DE.AE-02', 'Detect · Adverse Event Analysis', 'Potentially adverse events are analyzed to understand activities and impact', 'Potentially adverse events are analyzed to better understand associated activities and impact.', 'SECURITY', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-NIST-015', 'NIST_CSF_2', 'RS.MA-01', 'Respond · Incident Management', 'The incident response plan is executed with defined stakeholders', 'The incident response plan is executed, in coordination with relevant third parties, once an incident is declared.', 'SECURITY', 'SEV_1', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-SOC2-001', 'SOC2_TSC', 'CC1.1', 'CC1 · Control Environment', 'The entity demonstrates a commitment to integrity and ethical values', 'COSO Principle 1 — integrity and ethical values are communicated and reinforced.', 'EXECUTIVE', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-SOC2-002', 'SOC2_TSC', 'CC1.2', 'CC1 · Control Environment', 'The board of directors demonstrates independence and oversight', 'COSO Principle 2 — independent board oversight of internal control.', 'EXECUTIVE', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-SOC2-003', 'SOC2_TSC', 'CC2.1', 'CC2 · Communication & Information', 'Quality information supports internal control', 'The entity obtains or generates and uses relevant, quality information to support the functioning of internal control.', 'COMPLIANCE', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-SOC2-004', 'SOC2_TSC', 'CC3.1', 'CC3 · Risk Assessment', 'Objectives are specified with sufficient clarity to identify risks', 'The entity specifies objectives with sufficient clarity to enable the identification and assessment of risks.', 'COMPLIANCE', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-SOC2-005', 'SOC2_TSC', 'CC5.1', 'CC5 · Control Activities', 'Control activities are selected and developed to mitigate risks', 'The entity selects and develops control activities that contribute to the mitigation of risks to acceptable levels.', 'COMPLIANCE', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-SOC2-006', 'SOC2_TSC', 'CC6.1', 'CC6 · Logical & Physical Access', 'Logical access security measures protect information assets', 'The entity implements logical access security software, infrastructure, and architectures to protect information assets.', 'SECURITY', 'SEV_1', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-SOC2-007', 'SOC2_TSC', 'CC6.2', 'CC6 · Logical & Physical Access', 'New users are registered, authorized, and modified on a timely basis', 'Prior to issuing credentials, the entity registers and authorizes new internal and external users.', 'SECURITY', 'SEV_1', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-SOC2-008', 'SOC2_TSC', 'CC6.3', 'CC6 · Logical & Physical Access', 'Access authorizations are granted, modified, and revoked with least privilege', 'The entity authorizes, modifies, and removes access to data, software, functions, and other protected information assets based on roles, responsibilities, or the system design.', 'SECURITY', 'SEV_1', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-SOC2-009', 'SOC2_TSC', 'CC6.6', 'CC6 · Logical & Physical Access', 'Logical access is restricted to authorized systems and activities', 'The entity implements logical access security measures to protect against threats from outside the system boundaries.', 'SECURITY', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-SOC2-010', 'SOC2_TSC', 'CC6.7', 'CC6 · Logical & Physical Access', 'Transmission and disposal of information is restricted and protected', 'The entity restricts the transmission, movement, and removal of information to authorized internal and external users and processes.', 'SECURITY', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-SOC2-011', 'SOC2_TSC', 'CC7.1', 'CC7 · System Operations', 'The entity detects and monitors for configuration changes and vulnerabilities', 'To meet its objectives, the entity uses detection and monitoring procedures to identify changes to configurations and the introduction of new vulnerabilities.', 'SECURITY', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-SOC2-012', 'SOC2_TSC', 'CC7.2', 'CC7 · System Operations', 'Security events are analyzed and responded to', 'The entity monitors system components and the operation of those components for anomalies indicative of malicious acts, natural disasters, and errors.', 'SECURITY', 'SEV_1', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-SOC2-013', 'SOC2_TSC', 'CC7.3', 'CC7 · System Operations', 'Identified security events are evaluated and a documented incident response is executed', 'The entity evaluates security events to determine whether they could or have resulted in a failure to meet its objectives.', 'SECURITY', 'SEV_1', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-SOC2-014', 'SOC2_TSC', 'CC8.1', 'CC8 · Change Management', 'Changes to the system are authorized, tested, approved, and documented', 'The entity authorizes, designs, develops or acquires, configures, documents, tests, approves, and implements changes to infrastructure, data, software, and procedures.', 'PLATFORM', 'SEV_1', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-SOC2-015', 'SOC2_TSC', 'CC9.2', 'CC9 · Risk Mitigation', 'The entity assesses and manages risks associated with vendors and business partners', 'The entity assesses and manages risks associated with vendors and business partners.', 'COMPLIANCE', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-ISO-001', 'ISO27001_2022', 'A.5.15', 'A.5 · Organizational Controls', 'Access control rules are established and reviewed', 'Rules to control physical and logical access to information and other associated assets are established and reviewed based on business and information security requirements.', 'SECURITY', 'SEV_1', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-ISO-002', 'ISO27001_2022', 'A.5.17', 'A.5 · Organizational Controls', 'Authentication information is managed', 'The allocation and management of authentication information is controlled by a management process, including advising personnel on appropriate handling.', 'SECURITY', 'SEV_1', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-ISO-003', 'ISO27001_2022', 'A.5.23', 'A.5 · Organizational Controls', 'Information security is addressed in cloud services', 'Processes for acquisition, use, management, and exit from cloud services are established in accordance with the organisation''s information security requirements.', 'PLATFORM', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-ISO-004', 'ISO27001_2022', 'A.5.24', 'A.5 · Organizational Controls', 'Information security incident management is planned and prepared', 'The organisation plans and prepares for managing information security incidents by defining, establishing, and communicating incident management processes, roles, and responsibilities.', 'SECURITY', 'SEV_1', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-ISO-005', 'ISO27001_2022', 'A.5.25', 'A.5 · Organizational Controls', 'Information security events are assessed and decisions recorded', 'The organisation assesses information security events and decides whether they are classified as information security incidents.', 'SECURITY', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-ISO-006', 'ISO27001_2022', 'A.5.37', 'A.5 · Organizational Controls', 'Operating procedures are documented and kept up to date', 'Operating procedures for information processing facilities are documented and made available to personnel who need them.', 'PLATFORM', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-ISO-007', 'ISO27001_2022', 'A.6.1', 'A.6 · People Controls', 'Screening of personnel is conducted prior to employment', 'Background verification checks on candidates for employment are carried out in accordance with applicable laws, regulations, and ethics, proportional to the risks.', 'COMPLIANCE', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-ISO-008', 'ISO27001_2022', 'A.6.3', 'A.6 · People Controls', 'Information security awareness, education, and training are provided', 'Personnel of the organisation and relevant interested parties receive appropriate information security awareness, education, and training.', 'COMPLIANCE', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-ISO-009', 'ISO27001_2022', 'A.8.2', 'A.8 · Technological Controls', 'Privileged access rights are restricted and managed', 'The allocation and use of privileged access rights is restricted and managed.', 'SECURITY', 'SEV_1', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-ISO-010', 'ISO27001_2022', 'A.8.3', 'A.8 · Technological Controls', 'Information access is restricted in line with policy', 'Access to information and other associated assets is restricted in accordance with the established topic-specific policy on access control.', 'SECURITY', 'SEV_1', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-ISO-011', 'ISO27001_2022', 'A.8.5', 'A.8 · Technological Controls', 'Secure authentication mechanisms are implemented', 'Secure authentication technologies and procedures are implemented based on information access restrictions and the topic-specific policy on access control.', 'SECURITY', 'SEV_1', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-ISO-012', 'ISO27001_2022', 'A.8.16', 'A.8 · Technological Controls', 'Monitoring activities are performed to detect anomalous behaviour', 'Networks, systems, and applications are monitored for anomalous behaviour, and appropriate actions are taken to evaluate potential information security incidents.', 'SECURITY', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-ISO-013', 'ISO27001_2022', 'A.8.25', 'A.8 · Technological Controls', 'A secure development lifecycle is defined and applied', 'Rules for the secure development of software and systems are established and applied.', 'PLATFORM', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-ISO-014', 'ISO27001_2022', 'A.8.28', 'A.8 · Technological Controls', 'Secure coding principles are applied to software development', 'Secure coding principles are applied to software development.', 'PLATFORM', 'STANDARD', 'ACTIVE', '2026.04.1', NOW(), NOW()),
  ('GOV-CTRL-ISO-015', 'ISO27001_2022', 'A.8.32', 'A.8 · Technological Controls', 'Changes to information processing facilities and systems follow change management', 'Changes to information processing facilities and information systems are subject to change management procedures.', 'PLATFORM', 'SEV_1', 'ACTIVE', '2026.04.1', NOW(), NOW())
ON CONFLICT (control_id) DO UPDATE SET
  framework = EXCLUDED.framework,
  control_code = EXCLUDED.control_code,
  control_family = EXCLUDED.control_family,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  owner_role = EXCLUDED.owner_role,
  severity = EXCLUDED.severity,
  seed_version = EXCLUDED.seed_version,
  updated_at = NOW();

-- Default bindings — tie internal policy surfaces (tool ids, approval
-- types, evidence-packet signing) to one or more external controls. Seeded
-- bindings are keyed by the stable binding_id (GOV-BND-SEED-*) so upgrades
-- refresh them without clobbering operator-added bindings, which use
-- different id prefixes.
INSERT INTO governance_control_bindings (
  binding_id, control_id, policy_selector, binding_kind, capability_scope,
  seed_version, created_at
) VALUES
  ('GOV-BND-SEED-001', 'GOV-CTRL-NIST-008', '{"toolId":"workspace_write"}'::jsonb, 'POLICY_DECISION', NULL, '2026.04.1', NOW()),
  ('GOV-BND-SEED-002', 'GOV-CTRL-SOC2-008', '{"toolId":"workspace_write"}'::jsonb, 'POLICY_DECISION', NULL, '2026.04.1', NOW()),
  ('GOV-BND-SEED-003', 'GOV-CTRL-ISO-010',  '{"toolId":"workspace_write"}'::jsonb, 'POLICY_DECISION', NULL, '2026.04.1', NOW()),
  ('GOV-BND-SEED-004', 'GOV-CTRL-NIST-011', '{"toolId":"workspace_apply_patch"}'::jsonb, 'POLICY_DECISION', NULL, '2026.04.1', NOW()),
  ('GOV-BND-SEED-005', 'GOV-CTRL-SOC2-014', '{"toolId":"workspace_apply_patch"}'::jsonb, 'POLICY_DECISION', NULL, '2026.04.1', NOW()),
  ('GOV-BND-SEED-006', 'GOV-CTRL-ISO-015',  '{"toolId":"workspace_apply_patch"}'::jsonb, 'POLICY_DECISION', NULL, '2026.04.1', NOW()),
  ('GOV-BND-SEED-007', 'GOV-CTRL-NIST-012', '{"toolId":"run_deploy"}'::jsonb, 'POLICY_DECISION', NULL, '2026.04.1', NOW()),
  ('GOV-BND-SEED-008', 'GOV-CTRL-SOC2-014', '{"toolId":"run_deploy"}'::jsonb, 'POLICY_DECISION', NULL, '2026.04.1', NOW()),
  ('GOV-BND-SEED-009', 'GOV-CTRL-ISO-015',  '{"toolId":"run_deploy"}'::jsonb, 'POLICY_DECISION', NULL, '2026.04.1', NOW()),
  ('GOV-BND-SEED-010', 'GOV-CTRL-SOC2-014', '{"approvalType":"DEPLOY"}'::jsonb, 'APPROVAL_FLOW', NULL, '2026.04.1', NOW()),
  ('GOV-BND-SEED-011', 'GOV-CTRL-NIST-015', '{"approvalType":"DEPLOY"}'::jsonb, 'APPROVAL_FLOW', NULL, '2026.04.1', NOW()),
  ('GOV-BND-SEED-012', 'GOV-CTRL-NIST-008', '{"approvalType":"WORKSPACE_WRITE"}'::jsonb, 'APPROVAL_FLOW', NULL, '2026.04.1', NOW()),
  ('GOV-BND-SEED-013', 'GOV-CTRL-SOC2-008', '{"approvalType":"WORKSPACE_WRITE"}'::jsonb, 'APPROVAL_FLOW', NULL, '2026.04.1', NOW()),
  ('GOV-BND-SEED-014', 'GOV-CTRL-NIST-014', '{"surface":"evidence_packet"}'::jsonb, 'SIGNING_REQUIRED', NULL, '2026.04.1', NOW()),
  ('GOV-BND-SEED-015', 'GOV-CTRL-SOC2-012', '{"surface":"evidence_packet"}'::jsonb, 'SIGNING_REQUIRED', NULL, '2026.04.1', NOW()),
  ('GOV-BND-SEED-016', 'GOV-CTRL-ISO-012',  '{"surface":"evidence_packet"}'::jsonb, 'SIGNING_REQUIRED', NULL, '2026.04.1', NOW()),
  ('GOV-BND-SEED-017', 'GOV-CTRL-NIST-009', '{"surface":"evidence_packet"}'::jsonb, 'EVIDENCE_PACKET', NULL, '2026.04.1', NOW())
ON CONFLICT (binding_id) DO UPDATE SET
  control_id = EXCLUDED.control_id,
  policy_selector = EXCLUDED.policy_selector,
  binding_kind = EXCLUDED.binding_kind,
  seed_version = EXCLUDED.seed_version;

COMMIT;
