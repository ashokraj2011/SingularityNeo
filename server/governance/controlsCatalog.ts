/**
 * Governance controls catalog — Slice 2 seed data.
 *
 * This module is the source of truth for the controls that SingularityNeo
 * claims to enforce. A compact, auditor-legible subset of three external
 * frameworks is seeded on bootstrap and bound to the platform's existing
 * policy surfaces (tool policies + approval types) so decision audits read
 * against a framework, not just an internal code.
 *
 * Scope rules:
 *  - 15 controls per framework. Not a full catalog; the "auditor-hot" set
 *    an external reviewer reaches for first.
 *  - `seedVersion` bumps when this file changes; `ensureControlsSeeded` uses
 *    it to refresh descriptions on upgrade without clobbering operator-added
 *    bindings.
 *  - Control IDs use the form `GOV-CTRL-<framework-tag>-<number>` and are
 *    stable across seed-version bumps — the stable id is what policy
 *    decisions reference.
 *
 * Framework coverage:
 *  - NIST_CSF_2:      NIST Cybersecurity Framework 2.0 (2024)
 *  - SOC2_TSC:        SOC 2 Trust Services Criteria (2017 TSC, 2022 rev.)
 *  - ISO27001_2022:   ISO/IEC 27001:2022 Annex A
 */

export const CONTROLS_SEED_VERSION = '2026.04.1' as const;

export type ControlFramework = 'NIST_CSF_2' | 'SOC2_TSC' | 'ISO27001_2022';
export type ControlSeverity = 'STANDARD' | 'SEV_1';
export type ControlStatus = 'ACTIVE' | 'RETIRED';
export type ControlOwnerRole = 'SECURITY' | 'COMPLIANCE' | 'PLATFORM' | 'EXECUTIVE';
export type BindingKind = 'POLICY_DECISION' | 'APPROVAL_FLOW' | 'SIGNING_REQUIRED' | 'EVIDENCE_PACKET';

export type ControlSeed = {
  controlId: string;
  framework: ControlFramework;
  controlCode: string;
  controlFamily: string;
  title: string;
  description: string;
  ownerRole: ControlOwnerRole;
  severity: ControlSeverity;
  status: ControlStatus;
};

export type ControlBindingSeed = {
  bindingId: string;
  controlId: string;
  policySelector: Record<string, unknown>;
  bindingKind: BindingKind;
  capabilityScope?: string | null;
};

// -----------------------------------------------------------------------------
// NIST CSF 2.0 — 15 hot subcategories across GV / ID / PR / DE / RS
// -----------------------------------------------------------------------------
const NIST_CONTROLS: ControlSeed[] = [
  {
    controlId: 'GOV-CTRL-NIST-001',
    framework: 'NIST_CSF_2',
    controlCode: 'GV.OC-01',
    controlFamily: 'Govern · Organizational Context',
    title: 'Organizational mission is understood and informs risk decisions',
    description: 'The mission of the organization is understood and informs cybersecurity risk management.',
    ownerRole: 'EXECUTIVE',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-NIST-002',
    framework: 'NIST_CSF_2',
    controlCode: 'GV.RR-02',
    controlFamily: 'Govern · Roles, Responsibilities, Authorities',
    title: 'Cybersecurity roles and responsibilities are established',
    description: 'Roles, responsibilities, and authorities for cybersecurity are established, communicated, and enforced.',
    ownerRole: 'EXECUTIVE',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-NIST-003',
    framework: 'NIST_CSF_2',
    controlCode: 'GV.PO-01',
    controlFamily: 'Govern · Policy',
    title: 'Cybersecurity policy is established and communicated',
    description: 'Policy for managing cybersecurity risks is established based on organizational context and communicated.',
    ownerRole: 'SECURITY',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-NIST-004',
    framework: 'NIST_CSF_2',
    controlCode: 'ID.AM-01',
    controlFamily: 'Identify · Asset Management',
    title: 'Hardware and software inventory is maintained',
    description: 'Inventories of hardware and software managed by the organization are maintained.',
    ownerRole: 'PLATFORM',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-NIST-005',
    framework: 'NIST_CSF_2',
    controlCode: 'ID.AM-05',
    controlFamily: 'Identify · Asset Management',
    title: 'Resources are prioritized based on classification and criticality',
    description: 'Resources are prioritized based on their classification, criticality, and business value.',
    ownerRole: 'PLATFORM',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-NIST-006',
    framework: 'NIST_CSF_2',
    controlCode: 'ID.RA-01',
    controlFamily: 'Identify · Risk Assessment',
    title: 'Vulnerabilities in assets are identified, validated, and recorded',
    description: 'Vulnerabilities in assets are identified, validated, and recorded.',
    ownerRole: 'SECURITY',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-NIST-007',
    framework: 'NIST_CSF_2',
    controlCode: 'PR.AA-01',
    controlFamily: 'Protect · Identity Management, Authentication, Access Control',
    title: 'Identities and credentials are managed for authorized users and services',
    description: 'Identities and credentials for authorized users, services, and hardware are managed.',
    ownerRole: 'SECURITY',
    severity: 'SEV_1',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-NIST-008',
    framework: 'NIST_CSF_2',
    controlCode: 'PR.AA-05',
    controlFamily: 'Protect · Identity Management, Authentication, Access Control',
    title: 'Access permissions integrate least privilege and separation of duties',
    description: 'Access permissions, entitlements, and authorizations are defined in policy, managed, enforced, and reviewed.',
    ownerRole: 'SECURITY',
    severity: 'SEV_1',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-NIST-009',
    framework: 'NIST_CSF_2',
    controlCode: 'PR.DS-01',
    controlFamily: 'Protect · Data Security',
    title: 'The confidentiality, integrity, and availability of data-at-rest are protected',
    description: 'The confidentiality, integrity, and availability of data-at-rest are protected.',
    ownerRole: 'SECURITY',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-NIST-010',
    framework: 'NIST_CSF_2',
    controlCode: 'PR.DS-11',
    controlFamily: 'Protect · Data Security',
    title: 'Backups are created, protected, maintained, and tested',
    description: 'Backups of data are created, protected, maintained, and tested.',
    ownerRole: 'PLATFORM',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-NIST-011',
    framework: 'NIST_CSF_2',
    controlCode: 'PR.IP-01',
    controlFamily: 'Protect · Information Protection Processes',
    title: 'Baseline configurations of technology assets are created and maintained',
    description: 'Configuration baselines of technology assets are created and maintained under change control.',
    ownerRole: 'PLATFORM',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-NIST-012',
    framework: 'NIST_CSF_2',
    controlCode: 'PR.IP-04',
    controlFamily: 'Protect · Information Protection Processes',
    title: 'Response and recovery plans are in place and managed',
    description: 'Response and recovery plans are established, managed, and periodically exercised.',
    ownerRole: 'SECURITY',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-NIST-013',
    framework: 'NIST_CSF_2',
    controlCode: 'DE.CM-01',
    controlFamily: 'Detect · Continuous Monitoring',
    title: 'Networks and network services are monitored to detect potentially adverse events',
    description: 'Networks and network services are monitored to detect potentially adverse events.',
    ownerRole: 'SECURITY',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-NIST-014',
    framework: 'NIST_CSF_2',
    controlCode: 'DE.AE-02',
    controlFamily: 'Detect · Adverse Event Analysis',
    title: 'Potentially adverse events are analyzed to understand activities and impact',
    description: 'Potentially adverse events are analyzed to better understand associated activities and impact.',
    ownerRole: 'SECURITY',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-NIST-015',
    framework: 'NIST_CSF_2',
    controlCode: 'RS.MA-01',
    controlFamily: 'Respond · Incident Management',
    title: 'The incident response plan is executed with defined stakeholders',
    description: 'The incident response plan is executed, in coordination with relevant third parties, once an incident is declared.',
    ownerRole: 'SECURITY',
    severity: 'SEV_1',
    status: 'ACTIVE',
  },
];

// -----------------------------------------------------------------------------
// SOC 2 TSC 2017 — 15 common-criteria controls
// -----------------------------------------------------------------------------
const SOC2_CONTROLS: ControlSeed[] = [
  {
    controlId: 'GOV-CTRL-SOC2-001',
    framework: 'SOC2_TSC',
    controlCode: 'CC1.1',
    controlFamily: 'CC1 · Control Environment',
    title: 'The entity demonstrates a commitment to integrity and ethical values',
    description: 'COSO Principle 1 — integrity and ethical values are communicated and reinforced.',
    ownerRole: 'EXECUTIVE',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-SOC2-002',
    framework: 'SOC2_TSC',
    controlCode: 'CC1.2',
    controlFamily: 'CC1 · Control Environment',
    title: 'The board of directors demonstrates independence and oversight',
    description: 'COSO Principle 2 — independent board oversight of internal control.',
    ownerRole: 'EXECUTIVE',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-SOC2-003',
    framework: 'SOC2_TSC',
    controlCode: 'CC2.1',
    controlFamily: 'CC2 · Communication & Information',
    title: 'Quality information supports internal control',
    description: 'The entity obtains or generates and uses relevant, quality information to support the functioning of internal control.',
    ownerRole: 'COMPLIANCE',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-SOC2-004',
    framework: 'SOC2_TSC',
    controlCode: 'CC3.1',
    controlFamily: 'CC3 · Risk Assessment',
    title: 'Objectives are specified with sufficient clarity to identify risks',
    description: 'The entity specifies objectives with sufficient clarity to enable the identification and assessment of risks.',
    ownerRole: 'COMPLIANCE',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-SOC2-005',
    framework: 'SOC2_TSC',
    controlCode: 'CC5.1',
    controlFamily: 'CC5 · Control Activities',
    title: 'Control activities are selected and developed to mitigate risks',
    description: 'The entity selects and develops control activities that contribute to the mitigation of risks to acceptable levels.',
    ownerRole: 'COMPLIANCE',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-SOC2-006',
    framework: 'SOC2_TSC',
    controlCode: 'CC6.1',
    controlFamily: 'CC6 · Logical & Physical Access',
    title: 'Logical access security measures protect information assets',
    description: 'The entity implements logical access security software, infrastructure, and architectures to protect information assets.',
    ownerRole: 'SECURITY',
    severity: 'SEV_1',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-SOC2-007',
    framework: 'SOC2_TSC',
    controlCode: 'CC6.2',
    controlFamily: 'CC6 · Logical & Physical Access',
    title: 'New users are registered, authorized, and modified on a timely basis',
    description: 'Prior to issuing credentials, the entity registers and authorizes new internal and external users.',
    ownerRole: 'SECURITY',
    severity: 'SEV_1',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-SOC2-008',
    framework: 'SOC2_TSC',
    controlCode: 'CC6.3',
    controlFamily: 'CC6 · Logical & Physical Access',
    title: 'Access authorizations are granted, modified, and revoked with least privilege',
    description: 'The entity authorizes, modifies, and removes access to data, software, functions, and other protected information assets based on roles, responsibilities, or the system design.',
    ownerRole: 'SECURITY',
    severity: 'SEV_1',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-SOC2-009',
    framework: 'SOC2_TSC',
    controlCode: 'CC6.6',
    controlFamily: 'CC6 · Logical & Physical Access',
    title: 'Logical access is restricted to authorized systems and activities',
    description: 'The entity implements logical access security measures to protect against threats from outside the system boundaries.',
    ownerRole: 'SECURITY',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-SOC2-010',
    framework: 'SOC2_TSC',
    controlCode: 'CC6.7',
    controlFamily: 'CC6 · Logical & Physical Access',
    title: 'Transmission and disposal of information is restricted and protected',
    description: 'The entity restricts the transmission, movement, and removal of information to authorized internal and external users and processes.',
    ownerRole: 'SECURITY',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-SOC2-011',
    framework: 'SOC2_TSC',
    controlCode: 'CC7.1',
    controlFamily: 'CC7 · System Operations',
    title: 'The entity detects and monitors for configuration changes and vulnerabilities',
    description: 'To meet its objectives, the entity uses detection and monitoring procedures to identify changes to configurations and the introduction of new vulnerabilities.',
    ownerRole: 'SECURITY',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-SOC2-012',
    framework: 'SOC2_TSC',
    controlCode: 'CC7.2',
    controlFamily: 'CC7 · System Operations',
    title: 'Security events are analyzed and responded to',
    description: 'The entity monitors system components and the operation of those components for anomalies indicative of malicious acts, natural disasters, and errors.',
    ownerRole: 'SECURITY',
    severity: 'SEV_1',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-SOC2-013',
    framework: 'SOC2_TSC',
    controlCode: 'CC7.3',
    controlFamily: 'CC7 · System Operations',
    title: 'Identified security events are evaluated and a documented incident response is executed',
    description: 'The entity evaluates security events to determine whether they could or have resulted in a failure to meet its objectives.',
    ownerRole: 'SECURITY',
    severity: 'SEV_1',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-SOC2-014',
    framework: 'SOC2_TSC',
    controlCode: 'CC8.1',
    controlFamily: 'CC8 · Change Management',
    title: 'Changes to the system are authorized, tested, approved, and documented',
    description: 'The entity authorizes, designs, develops or acquires, configures, documents, tests, approves, and implements changes to infrastructure, data, software, and procedures.',
    ownerRole: 'PLATFORM',
    severity: 'SEV_1',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-SOC2-015',
    framework: 'SOC2_TSC',
    controlCode: 'CC9.2',
    controlFamily: 'CC9 · Risk Mitigation',
    title: 'The entity assesses and manages risks associated with vendors and business partners',
    description: 'The entity assesses and manages risks associated with vendors and business partners.',
    ownerRole: 'COMPLIANCE',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
];

// -----------------------------------------------------------------------------
// ISO/IEC 27001:2022 — 15 Annex A controls
// -----------------------------------------------------------------------------
const ISO_CONTROLS: ControlSeed[] = [
  {
    controlId: 'GOV-CTRL-ISO-001',
    framework: 'ISO27001_2022',
    controlCode: 'A.5.15',
    controlFamily: 'A.5 · Organizational Controls',
    title: 'Access control rules are established and reviewed',
    description: 'Rules to control physical and logical access to information and other associated assets are established and reviewed based on business and information security requirements.',
    ownerRole: 'SECURITY',
    severity: 'SEV_1',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-ISO-002',
    framework: 'ISO27001_2022',
    controlCode: 'A.5.17',
    controlFamily: 'A.5 · Organizational Controls',
    title: 'Authentication information is managed',
    description: 'The allocation and management of authentication information is controlled by a management process, including advising personnel on appropriate handling.',
    ownerRole: 'SECURITY',
    severity: 'SEV_1',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-ISO-003',
    framework: 'ISO27001_2022',
    controlCode: 'A.5.23',
    controlFamily: 'A.5 · Organizational Controls',
    title: 'Information security is addressed in cloud services',
    description: 'Processes for acquisition, use, management, and exit from cloud services are established in accordance with the organisation\u2019s information security requirements.',
    ownerRole: 'PLATFORM',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-ISO-004',
    framework: 'ISO27001_2022',
    controlCode: 'A.5.24',
    controlFamily: 'A.5 · Organizational Controls',
    title: 'Information security incident management is planned and prepared',
    description: 'The organisation plans and prepares for managing information security incidents by defining, establishing, and communicating incident management processes, roles, and responsibilities.',
    ownerRole: 'SECURITY',
    severity: 'SEV_1',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-ISO-005',
    framework: 'ISO27001_2022',
    controlCode: 'A.5.25',
    controlFamily: 'A.5 · Organizational Controls',
    title: 'Information security events are assessed and decisions recorded',
    description: 'The organisation assesses information security events and decides whether they are classified as information security incidents.',
    ownerRole: 'SECURITY',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-ISO-006',
    framework: 'ISO27001_2022',
    controlCode: 'A.5.37',
    controlFamily: 'A.5 · Organizational Controls',
    title: 'Operating procedures are documented and kept up to date',
    description: 'Operating procedures for information processing facilities are documented and made available to personnel who need them.',
    ownerRole: 'PLATFORM',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-ISO-007',
    framework: 'ISO27001_2022',
    controlCode: 'A.6.1',
    controlFamily: 'A.6 · People Controls',
    title: 'Screening of personnel is conducted prior to employment',
    description: 'Background verification checks on candidates for employment are carried out in accordance with applicable laws, regulations, and ethics, proportional to the risks.',
    ownerRole: 'COMPLIANCE',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-ISO-008',
    framework: 'ISO27001_2022',
    controlCode: 'A.6.3',
    controlFamily: 'A.6 · People Controls',
    title: 'Information security awareness, education, and training are provided',
    description: 'Personnel of the organisation and relevant interested parties receive appropriate information security awareness, education, and training.',
    ownerRole: 'COMPLIANCE',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-ISO-009',
    framework: 'ISO27001_2022',
    controlCode: 'A.8.2',
    controlFamily: 'A.8 · Technological Controls',
    title: 'Privileged access rights are restricted and managed',
    description: 'The allocation and use of privileged access rights is restricted and managed.',
    ownerRole: 'SECURITY',
    severity: 'SEV_1',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-ISO-010',
    framework: 'ISO27001_2022',
    controlCode: 'A.8.3',
    controlFamily: 'A.8 · Technological Controls',
    title: 'Information access is restricted in line with policy',
    description: 'Access to information and other associated assets is restricted in accordance with the established topic-specific policy on access control.',
    ownerRole: 'SECURITY',
    severity: 'SEV_1',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-ISO-011',
    framework: 'ISO27001_2022',
    controlCode: 'A.8.5',
    controlFamily: 'A.8 · Technological Controls',
    title: 'Secure authentication mechanisms are implemented',
    description: 'Secure authentication technologies and procedures are implemented based on information access restrictions and the topic-specific policy on access control.',
    ownerRole: 'SECURITY',
    severity: 'SEV_1',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-ISO-012',
    framework: 'ISO27001_2022',
    controlCode: 'A.8.16',
    controlFamily: 'A.8 · Technological Controls',
    title: 'Monitoring activities are performed to detect anomalous behaviour',
    description: 'Networks, systems, and applications are monitored for anomalous behaviour, and appropriate actions are taken to evaluate potential information security incidents.',
    ownerRole: 'SECURITY',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-ISO-013',
    framework: 'ISO27001_2022',
    controlCode: 'A.8.25',
    controlFamily: 'A.8 · Technological Controls',
    title: 'A secure development lifecycle is defined and applied',
    description: 'Rules for the secure development of software and systems are established and applied.',
    ownerRole: 'PLATFORM',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-ISO-014',
    framework: 'ISO27001_2022',
    controlCode: 'A.8.28',
    controlFamily: 'A.8 · Technological Controls',
    title: 'Secure coding principles are applied to software development',
    description: 'Secure coding principles are applied to software development.',
    ownerRole: 'PLATFORM',
    severity: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    controlId: 'GOV-CTRL-ISO-015',
    framework: 'ISO27001_2022',
    controlCode: 'A.8.32',
    controlFamily: 'A.8 · Technological Controls',
    title: 'Changes to information processing facilities and systems follow change management',
    description: 'Changes to information processing facilities and information systems are subject to change management procedures.',
    ownerRole: 'PLATFORM',
    severity: 'SEV_1',
    status: 'ACTIVE',
  },
];

export const CONTROL_SEEDS: readonly ControlSeed[] = Object.freeze([
  ...NIST_CONTROLS,
  ...SOC2_CONTROLS,
  ...ISO_CONTROLS,
]);

// -----------------------------------------------------------------------------
// Default bindings — tie internal policy surfaces to external controls.
//
// Each binding says "when the platform enforces X (tool policy, approval
// flow, signing), that enforcement is evidence for control Y." Bindings are
// intentionally permissive (multiple controls per selector) — an auditor
// walking the decision log should see at least one control per framework
// satisfied by each enforced policy.
// -----------------------------------------------------------------------------
export const CONTROL_BINDING_SEEDS: readonly ControlBindingSeed[] = Object.freeze([
  // workspace_write — mutating a workspace artifact. Maps to least-privilege
  // access controls across all three frameworks.
  {
    bindingId: 'GOV-BND-SEED-001',
    controlId: 'GOV-CTRL-NIST-008', // PR.AA-05
    policySelector: { actionType: 'workspace_write', toolId: 'workspace_write' },
    bindingKind: 'POLICY_DECISION',
  },
  {
    bindingId: 'GOV-BND-SEED-002',
    controlId: 'GOV-CTRL-SOC2-008', // CC6.3
    policySelector: { actionType: 'workspace_write', toolId: 'workspace_write' },
    bindingKind: 'POLICY_DECISION',
  },
  {
    bindingId: 'GOV-BND-SEED-003',
    controlId: 'GOV-CTRL-ISO-010', // A.8.3
    policySelector: { actionType: 'workspace_write', toolId: 'workspace_write' },
    bindingKind: 'POLICY_DECISION',
  },

  // workspace_apply_patch — structural code edits. Maps to change management.
  {
    bindingId: 'GOV-BND-SEED-004',
    controlId: 'GOV-CTRL-NIST-011', // PR.IP-01
    policySelector: { actionType: 'workspace_write', toolId: 'workspace_apply_patch' },
    bindingKind: 'POLICY_DECISION',
  },
  {
    bindingId: 'GOV-BND-SEED-005',
    controlId: 'GOV-CTRL-SOC2-014', // CC8.1
    policySelector: { actionType: 'workspace_write', toolId: 'workspace_apply_patch' },
    bindingKind: 'POLICY_DECISION',
  },
  {
    bindingId: 'GOV-BND-SEED-006',
    controlId: 'GOV-CTRL-ISO-015', // A.8.32
    policySelector: { actionType: 'workspace_write', toolId: 'workspace_apply_patch' },
    bindingKind: 'POLICY_DECISION',
  },

  // run_deploy — deployment. Maps to change management + incident readiness.
  {
    bindingId: 'GOV-BND-SEED-007',
    controlId: 'GOV-CTRL-NIST-012', // PR.IP-04
    policySelector: { actionType: 'run_deploy', toolId: 'run_deploy' },
    bindingKind: 'POLICY_DECISION',
  },
  {
    bindingId: 'GOV-BND-SEED-008',
    controlId: 'GOV-CTRL-SOC2-014', // CC8.1
    policySelector: { actionType: 'run_deploy', toolId: 'run_deploy' },
    bindingKind: 'POLICY_DECISION',
  },
  {
    bindingId: 'GOV-BND-SEED-009',
    controlId: 'GOV-CTRL-ISO-015', // A.8.32
    policySelector: { actionType: 'run_deploy', toolId: 'run_deploy' },
    bindingKind: 'POLICY_DECISION',
  },

  // DEPLOY approval type — human sign-off for deploy risk.
  {
    bindingId: 'GOV-BND-SEED-010',
    controlId: 'GOV-CTRL-SOC2-014', // CC8.1
    policySelector: { approvalType: 'DEPLOY' },
    bindingKind: 'APPROVAL_FLOW',
  },
  {
    bindingId: 'GOV-BND-SEED-011',
    controlId: 'GOV-CTRL-NIST-015', // RS.MA-01
    policySelector: { approvalType: 'DEPLOY' },
    bindingKind: 'APPROVAL_FLOW',
  },

  // WORKSPACE_WRITE approval type — human sign-off for mutating shared code.
  {
    bindingId: 'GOV-BND-SEED-012',
    controlId: 'GOV-CTRL-NIST-008', // PR.AA-05
    policySelector: { approvalType: 'WORKSPACE_WRITE' },
    bindingKind: 'APPROVAL_FLOW',
  },
  {
    bindingId: 'GOV-BND-SEED-013',
    controlId: 'GOV-CTRL-SOC2-008', // CC6.3
    policySelector: { approvalType: 'WORKSPACE_WRITE' },
    bindingKind: 'APPROVAL_FLOW',
  },

  // Signed evidence packets — integrity & monitoring evidence for every
  // captured decision.
  {
    bindingId: 'GOV-BND-SEED-014',
    controlId: 'GOV-CTRL-NIST-014', // DE.AE-02
    policySelector: { surface: 'evidence_packet' },
    bindingKind: 'SIGNING_REQUIRED',
  },
  {
    bindingId: 'GOV-BND-SEED-015',
    controlId: 'GOV-CTRL-SOC2-012', // CC7.2
    policySelector: { surface: 'evidence_packet' },
    bindingKind: 'SIGNING_REQUIRED',
  },
  {
    bindingId: 'GOV-BND-SEED-016',
    controlId: 'GOV-CTRL-ISO-012', // A.8.16
    policySelector: { surface: 'evidence_packet' },
    bindingKind: 'SIGNING_REQUIRED',
  },
  {
    bindingId: 'GOV-BND-SEED-017',
    controlId: 'GOV-CTRL-NIST-009', // PR.DS-01
    policySelector: { surface: 'evidence_packet' },
    bindingKind: 'EVIDENCE_PACKET',
  },
]);

/**
 * Integrity check — every binding must reference a seeded control id.
 * Called by ensureControlsSeeded() and by the test suite.
 */
export const validateCatalogIntegrity = (): string[] => {
  const errors: string[] = [];
  const controlIds = new Set(CONTROL_SEEDS.map(control => control.controlId));
  const seenControlIds = new Set<string>();
  const seenFrameworkCodes = new Set<string>();
  for (const control of CONTROL_SEEDS) {
    if (seenControlIds.has(control.controlId)) {
      errors.push(`duplicate control_id: ${control.controlId}`);
    }
    seenControlIds.add(control.controlId);
    const fwKey = `${control.framework}::${control.controlCode}`;
    if (seenFrameworkCodes.has(fwKey)) {
      errors.push(`duplicate (framework, control_code): ${fwKey}`);
    }
    seenFrameworkCodes.add(fwKey);
  }
  const seenBindingIds = new Set<string>();
  for (const binding of CONTROL_BINDING_SEEDS) {
    if (!controlIds.has(binding.controlId)) {
      errors.push(`binding ${binding.bindingId} references unknown control ${binding.controlId}`);
    }
    if (seenBindingIds.has(binding.bindingId)) {
      errors.push(`duplicate binding_id: ${binding.bindingId}`);
    }
    seenBindingIds.add(binding.bindingId);
  }
  return errors;
};
