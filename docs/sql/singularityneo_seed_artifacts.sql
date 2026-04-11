-- Singularity Neo capability-scoped starter artifacts seed
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
  (
    'ACCEPTANCE-CRITERIA',
    'Acceptance criteria',
    'Agent Contract',
    'OUTPUT',
    'BUSINESS-ANALYST',
    'Business Analyst',
    'Business Analyst is expected to publish this artifact as part of its baseline contribution.',
    ARRAY[]::TEXT[],
    '# Acceptance criteria

## Purpose
Business Analyst is expected to publish this artifact as part of its baseline contribution.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'ACCEPTANCE-CRITERIA-MATRIX',
    'Acceptance Criteria Matrix',
    'Workflow Output',
    'OUTPUT',
    'BUSINESS-ANALYST',
    'Business Analyst',
    'Analysis should produce a review-ready business and scope pack that downstream design can trust.',
    ARRAY['Capability Charter', 'Stakeholder Requirements', 'Planning Report', 'Stakeholder Priorities Register', 'Jira Story Context', 'Domain Constraints Register']::TEXT[],
    '# Acceptance Criteria Matrix

## Purpose
Analysis should produce a review-ready business and scope pack that downstream design can trust.

## Required Inputs
- Capability Charter
- Stakeholder Requirements
- Planning Report
- Stakeholder Priorities Register
- Jira Story Context
- Domain Constraints Register

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'ANALYSIS-INTAKE-PACKET',
    'Analysis Intake Packet',
    'Handoff Packet',
    'OUTPUT',
    'PLANNING',
    'Planning Agent',
    'Package the planning baseline so business analysis starts with agreed priorities, milestones, and assumptions.',
    ARRAY['Planning Report', 'Delivery Milestone Plan', 'Planning Assumptions Log']::TEXT[],
    '# Analysis Intake Packet

## Purpose
Package the planning baseline so business analysis starts with agreed priorities, milestones, and assumptions.

## Required Inputs
- Planning Report
- Delivery Milestone Plan
- Planning Assumptions Log

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'API-AND-INTEGRATION-CONTRACT',
    'API and Integration Contract',
    'Workflow Output',
    'OUTPUT',
    'ARCHITECT',
    'Architect',
    'Design should translate business intent into an implementation-ready technical contract.',
    ARRAY['Requirements Specification', 'Acceptance Criteria Matrix', 'Architecture Intake Packet', 'Existing Solution Context']::TEXT[],
    '# API and Integration Contract

## Purpose
Design should translate business intent into an implementation-ready technical contract.

## Required Inputs
- Requirements Specification
- Acceptance Criteria Matrix
- Architecture Intake Packet
- Existing Solution Context

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'APPROVAL-BRIEF',
    'Approval Brief',
    'Workflow Output',
    'OUTPUT',
    'VALIDATION',
    'Validation Agent',
    'Governance must distill all release evidence into an approval-ready control package.',
    ARRAY['Validation Evidence Pack', 'Governance Review Summary', 'Defect and Risk Log', 'Release Recommendation']::TEXT[],
    '# Approval Brief

## Purpose
Governance must distill all release evidence into an approval-ready control package.

## Required Inputs
- Validation Evidence Pack
- Governance Review Summary
- Defect and Risk Log
- Release Recommendation

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'APPROVAL-DECISION-RECORD',
    'Approval Decision Record',
    'Workflow Output',
    'OUTPUT',
    'OWNER',
    'Capability Owning Agent',
    'Human approval should capture a durable authorization record and any release conditions or comments.',
    ARRAY['Human Approval Packet', 'Release Readiness Record', 'Rollback Plan', 'Release Window Details']::TEXT[],
    '# Approval Decision Record

## Purpose
Human approval should capture a durable authorization record and any release conditions or comments.

## Required Inputs
- Human Approval Packet
- Release Readiness Record
- Rollback Plan
- Release Window Details

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'APPROVER-COMMENTS-LOG',
    'Approver Comments Log',
    'Workflow Output',
    'OUTPUT',
    'OWNER',
    'Capability Owning Agent',
    'Human approval should capture a durable authorization record and any release conditions or comments.',
    ARRAY['Human Approval Packet', 'Release Readiness Record', 'Rollback Plan', 'Release Window Details']::TEXT[],
    '# Approver Comments Log

## Purpose
Human approval should capture a durable authorization record and any release conditions or comments.

## Required Inputs
- Human Approval Packet
- Release Readiness Record
- Rollback Plan
- Release Window Details

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'ARCHITECTURE-BLUEPRINT',
    'Architecture blueprint',
    'Agent Contract',
    'OUTPUT',
    'ARCHITECT',
    'Architect',
    'Architect is expected to publish this artifact as part of its baseline contribution.',
    ARRAY[]::TEXT[],
    '# Architecture blueprint

## Purpose
Architect is expected to publish this artifact as part of its baseline contribution.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'ARCHITECTURE-DECISION-LOG',
    'Architecture Decision Log',
    'Workflow Output',
    'OUTPUT',
    'ARCHITECT',
    'Architect',
    'Design should translate business intent into an implementation-ready technical contract.',
    ARRAY['Requirements Specification', 'Acceptance Criteria Matrix', 'Architecture Intake Packet', 'Existing Solution Context']::TEXT[],
    '# Architecture Decision Log

## Purpose
Design should translate business intent into an implementation-ready technical contract.

## Required Inputs
- Requirements Specification
- Acceptance Criteria Matrix
- Architecture Intake Packet
- Existing Solution Context

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'ARCHITECTURE-INTAKE-PACKET',
    'Architecture Intake Packet',
    'Handoff Packet',
    'OUTPUT',
    'BUSINESS-ANALYST',
    'Business Analyst',
    'Package the refined story intent and unresolved assumptions for architecture review.',
    ARRAY['Requirements Specification', 'Acceptance Criteria Matrix', 'Assumptions Log', 'Planning Report']::TEXT[],
    '# Architecture Intake Packet

## Purpose
Package the refined story intent and unresolved assumptions for architecture review.

## Required Inputs
- Requirements Specification
- Acceptance Criteria Matrix
- Assumptions Log
- Planning Report

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'ARCHITECTURE-STANDARDS',
    'Architecture standards',
    'Agent Contract',
    'INPUT',
    'ARCHITECT',
    'Architect',
    'Architect depends on this artifact as an approved starting input.',
    ARRAY[]::TEXT[],
    '# Architecture standards

## Purpose
Architect depends on this artifact as an approved starting input.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'ASSUMPTIONS-LOG',
    'Assumptions Log',
    'Workflow Output',
    'OUTPUT',
    'BUSINESS-ANALYST',
    'Business Analyst',
    'Analysis should produce a review-ready business and scope pack that downstream design can trust.',
    ARRAY['Capability Charter', 'Stakeholder Requirements', 'Planning Report', 'Stakeholder Priorities Register', 'Jira Story Context', 'Domain Constraints Register']::TEXT[],
    '# Assumptions Log

## Purpose
Analysis should produce a review-ready business and scope pack that downstream design can trust.

## Required Inputs
- Capability Charter
- Stakeholder Requirements
- Planning Report
- Stakeholder Priorities Register
- Jira Story Context
- Domain Constraints Register

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'BUILD-CANDIDATE',
    'Build candidate',
    'Agent Contract',
    'INPUT',
    'QA',
    'QA',
    'QA depends on this artifact as an approved starting input.',
    ARRAY[]::TEXT[],
    '# Build candidate

## Purpose
QA depends on this artifact as an approved starting input.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'BUILD-CANDIDATE-MANIFEST',
    'Build Candidate Manifest',
    'Workflow Output',
    'OUTPUT',
    'SOFTWARE-DEVELOPER',
    'Software Developer',
    'Development should produce both executable change evidence and a clear trace of what was implemented.',
    ARRAY['Solution Design Document', 'Architecture Decision Log', 'Developer Handoff Packet', 'Acceptance Criteria Matrix']::TEXT[],
    '# Build Candidate Manifest

## Purpose
Development should produce both executable change evidence and a clear trace of what was implemented.

## Required Inputs
- Solution Design Document
- Architecture Decision Log
- Developer Handoff Packet
- Acceptance Criteria Matrix

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'BUILD-SCOPE-BREAKDOWN',
    'Build Scope Breakdown',
    'Handoff Packet',
    'OUTPUT',
    'ARCHITECT',
    'Architect',
    'Give development a precise build plan, contract boundaries, and design decisions.',
    ARRAY['Solution Design Document', 'Architecture Decision Log', 'Implementation Guardrails']::TEXT[],
    '# Build Scope Breakdown

## Purpose
Give development a precise build plan, contract boundaries, and design decisions.

## Required Inputs
- Solution Design Document
- Architecture Decision Log
- Implementation Guardrails

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'CAPABILITY-CHARTER',
    'Capability Charter',
    'Capability Foundation',
    'INPUT',
    'OWNER',
    'Capability Owning Agent',
    'Foundational charter that defines the capability mission, scope, stakeholders, and operating expectations.',
    ARRAY[]::TEXT[],
    '# Capability Charter

## Purpose
Foundational charter that defines the capability mission, scope, stakeholders, and operating expectations.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'CAPABILITY-CLOSURE-PACKET',
    'Capability Closure Packet',
    'Handoff Packet',
    'OUTPUT',
    'DEVOPS',
    'DevOps',
    'Close the workflow with a final operational and ownership hand-off back to the capability owner.',
    ARRAY['Deployment Summary', 'Production Verification Report', 'Release Notes']::TEXT[],
    '# Capability Closure Packet

## Purpose
Close the workflow with a final operational and ownership hand-off back to the capability owner.

## Required Inputs
- Deployment Summary
- Production Verification Report
- Release Notes

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'CAPABILITY-MEMORY',
    'Capability memory',
    'Agent Contract',
    'INPUT',
    'CONTRARIAN-REVIEWER',
    'Contrarian Reviewer',
    'Contrarian Reviewer depends on this artifact as an approved starting input.',
    ARRAY[]::TEXT[],
    '# Capability memory

## Purpose
Contrarian Reviewer depends on this artifact as an approved starting input.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'CAPABILITY-OPERATING-MODEL',
    'Capability Operating Model',
    'Capability Foundation',
    'OUTPUT',
    'OWNER',
    'Capability Owning Agent',
    'Operating model that aligns the capability owner, downstream agents, and governance context.',
    ARRAY['Capability Charter']::TEXT[],
    '# Capability Operating Model

## Purpose
Operating model that aligns the capability owner, downstream agents, and governance context.

## Required Inputs
- Capability Charter

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'CODE-CHANGE-SET',
    'Code Change Set',
    'Workflow Output',
    'OUTPUT',
    'SOFTWARE-DEVELOPER',
    'Software Developer',
    'Development should produce both executable change evidence and a clear trace of what was implemented.',
    ARRAY['Solution Design Document', 'Architecture Decision Log', 'Developer Handoff Packet', 'Acceptance Criteria Matrix']::TEXT[],
    '# Code Change Set

## Purpose
Development should produce both executable change evidence and a clear trace of what was implemented.

## Required Inputs
- Solution Design Document
- Architecture Decision Log
- Developer Handoff Packet
- Acceptance Criteria Matrix

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'CODE-CHANGES',
    'Code changes',
    'Agent Contract',
    'OUTPUT',
    'SOFTWARE-DEVELOPER',
    'Software Developer',
    'Software Developer is expected to publish this artifact as part of its baseline contribution.',
    ARRAY[]::TEXT[],
    '# Code changes

## Purpose
Software Developer is expected to publish this artifact as part of its baseline contribution.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'CONFLICT-WAIT-CONTEXT',
    'Conflict wait context',
    'Agent Contract',
    'INPUT',
    'CONTRARIAN-REVIEWER',
    'Contrarian Reviewer',
    'Contrarian Reviewer depends on this artifact as an approved starting input.',
    ARRAY[]::TEXT[],
    '# Conflict wait context

## Purpose
Contrarian Reviewer depends on this artifact as an approved starting input.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'CONTRARIAN-REVIEW',
    'Contrarian Review',
    'Agent Contract',
    'OUTPUT',
    'CONTRARIAN-REVIEWER',
    'Contrarian Reviewer',
    'Contrarian Reviewer is expected to publish this artifact as part of its baseline contribution.',
    ARRAY[]::TEXT[],
    '# Contrarian Review

## Purpose
Contrarian Reviewer is expected to publish this artifact as part of its baseline contribution.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'CROSS-AGENT-INPUT-BRIEFS',
    'Cross-Agent Input Briefs',
    'Workflow Input',
    'INPUT',
    'PLANNING',
    'Planning Agent',
    'Required input for the Planning & Stakeholder Synthesis step.',
    ARRAY[]::TEXT[],
    '# Cross-Agent Input Briefs

## Purpose
Required input for the Planning & Stakeholder Synthesis step.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'DEFECT-AND-RISK-LOG',
    'Defect and Risk Log',
    'Workflow Output',
    'OUTPUT',
    'QA',
    'QA',
    'QA should produce evidence that explains both the verification outcome and remaining risk posture.',
    ARRAY['Build Candidate Manifest', 'Acceptance Criteria Matrix', 'QA Intake Packet', 'Implementation Notes']::TEXT[],
    '# Defect and Risk Log

## Purpose
QA should produce evidence that explains both the verification outcome and remaining risk posture.

## Required Inputs
- Build Candidate Manifest
- Acceptance Criteria Matrix
- QA Intake Packet
- Implementation Notes

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'DEFECT-REPORT',
    'Defect report',
    'Agent Contract',
    'OUTPUT',
    'QA',
    'QA',
    'QA is expected to publish this artifact as part of its baseline contribution.',
    ARRAY[]::TEXT[],
    '# Defect report

## Purpose
QA is expected to publish this artifact as part of its baseline contribution.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'DELIVERY-MILESTONE-PLAN',
    'Delivery Milestone Plan',
    'Workflow Output',
    'OUTPUT',
    'PLANNING',
    'Planning Agent',
    'Planning should produce a durable synthesis of stakeholder intent, milestones, and cross-agent expectations before detailed analysis begins.',
    ARRAY['Capability Charter', 'Stakeholder Requirements', 'Capability Operating Model', 'Cross-Agent Input Briefs']::TEXT[],
    '# Delivery Milestone Plan

## Purpose
Planning should produce a durable synthesis of stakeholder intent, milestones, and cross-agent expectations before detailed analysis begins.

## Required Inputs
- Capability Charter
- Stakeholder Requirements
- Capability Operating Model
- Cross-Agent Input Briefs

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'DEPENDENCY-REGISTER',
    'Dependency Register',
    'Workflow Output',
    'OUTPUT',
    'BUSINESS-ANALYST',
    'Business Analyst',
    'Analysis should produce a review-ready business and scope pack that downstream design can trust.',
    ARRAY['Capability Charter', 'Stakeholder Requirements', 'Planning Report', 'Stakeholder Priorities Register', 'Jira Story Context', 'Domain Constraints Register']::TEXT[],
    '# Dependency Register

## Purpose
Analysis should produce a review-ready business and scope pack that downstream design can trust.

## Required Inputs
- Capability Charter
- Stakeholder Requirements
- Planning Report
- Stakeholder Priorities Register
- Jira Story Context
- Domain Constraints Register

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'DEPLOYMENT-AUTHORIZATION-PACKET',
    'Deployment Authorization Packet',
    'Handoff Packet',
    'OUTPUT',
    'OWNER',
    'Capability Owning Agent',
    'Translate human approval into a deployment-ready hand-off for release execution.',
    ARRAY['Release Authorization', 'Approval Decision Record', 'Rollback Plan']::TEXT[],
    '# Deployment Authorization Packet

## Purpose
Translate human approval into a deployment-ready hand-off for release execution.

## Required Inputs
- Release Authorization
- Approval Decision Record
- Rollback Plan

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'DEPLOYMENT-PLAN',
    'Deployment plan',
    'Agent Contract',
    'INPUT',
    'DEVOPS',
    'DevOps',
    'DevOps depends on this artifact as an approved starting input.',
    ARRAY[]::TEXT[],
    '# Deployment plan

## Purpose
DevOps depends on this artifact as an approved starting input.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'DEPLOYMENT-SUMMARY',
    'Deployment Summary',
    'Workflow Output',
    'OUTPUT',
    'DEVOPS',
    'DevOps',
    'Release execution should leave behind a complete operational record of what was deployed and how it verified.',
    ARRAY['Deployment Authorization Packet', 'Release Authorization', 'Deployment Plan', 'Rollback Plan']::TEXT[],
    '# Deployment Summary

## Purpose
Release execution should leave behind a complete operational record of what was deployed and how it verified.

## Required Inputs
- Deployment Authorization Packet
- Release Authorization
- Deployment Plan
- Rollback Plan

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'DESIGN-DECISION-LOG',
    'Design decision log',
    'Agent Contract',
    'OUTPUT',
    'ARCHITECT',
    'Architect',
    'Architect is expected to publish this artifact as part of its baseline contribution.',
    ARRAY[]::TEXT[],
    '# Design decision log

## Purpose
Architect is expected to publish this artifact as part of its baseline contribution.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'DEVELOPER-HANDOFF-PACKET',
    'Developer Handoff Packet',
    'Handoff Packet',
    'OUTPUT',
    'ARCHITECT',
    'Architect',
    'Give development a precise build plan, contract boundaries, and design decisions.',
    ARRAY['Solution Design Document', 'Architecture Decision Log', 'Implementation Guardrails']::TEXT[],
    '# Developer Handoff Packet

## Purpose
Give development a precise build plan, contract boundaries, and design decisions.

## Required Inputs
- Solution Design Document
- Architecture Decision Log
- Implementation Guardrails

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'DEVELOPER-TEST-EVIDENCE',
    'Developer Test Evidence',
    'Workflow Output',
    'OUTPUT',
    'SOFTWARE-DEVELOPER',
    'Software Developer',
    'Development should produce both executable change evidence and a clear trace of what was implemented.',
    ARRAY['Solution Design Document', 'Architecture Decision Log', 'Developer Handoff Packet', 'Acceptance Criteria Matrix']::TEXT[],
    '# Developer Test Evidence

## Purpose
Development should produce both executable change evidence and a clear trace of what was implemented.

## Required Inputs
- Solution Design Document
- Architecture Decision Log
- Developer Handoff Packet
- Acceptance Criteria Matrix

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'DOMAIN-CONSTRAINTS-REGISTER',
    'Domain Constraints Register',
    'Workflow Input',
    'INPUT',
    'BUSINESS-ANALYST',
    'Business Analyst',
    'Required input for the Business Analysis step.',
    ARRAY[]::TEXT[],
    '# Domain Constraints Register

## Purpose
Required input for the Business Analysis step.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'EXECUTION-EVIDENCE',
    'Execution evidence',
    'Agent Contract',
    'INPUT',
    'CONTRARIAN-REVIEWER',
    'Contrarian Reviewer',
    'Contrarian Reviewer depends on this artifact as an approved starting input.',
    ARRAY[]::TEXT[],
    '# Execution evidence

## Purpose
Contrarian Reviewer depends on this artifact as an approved starting input.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'EXISTING-SOLUTION-CONTEXT',
    'Existing Solution Context',
    'Workflow Input',
    'INPUT',
    'ARCHITECT',
    'Architect',
    'Required input for the Solution Design step.',
    ARRAY[]::TEXT[],
    '# Existing Solution Context

## Purpose
Required input for the Solution Design step.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'GOVERNANCE-ASSESSMENT',
    'Governance Assessment',
    'Workflow Output',
    'OUTPUT',
    'VALIDATION',
    'Validation Agent',
    'Governance must distill all release evidence into an approval-ready control package.',
    ARRAY['Validation Evidence Pack', 'Governance Review Summary', 'Defect and Risk Log', 'Release Recommendation']::TEXT[],
    '# Governance Assessment

## Purpose
Governance must distill all release evidence into an approval-ready control package.

## Required Inputs
- Validation Evidence Pack
- Governance Review Summary
- Defect and Risk Log
- Release Recommendation

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'GOVERNANCE-REVIEW-SUMMARY',
    'Governance Review Summary',
    'Handoff Packet',
    'OUTPUT',
    'QA',
    'QA',
    'Move structured evidence and quality posture into governance review.',
    ARRAY['Test Execution Report', 'Defect and Risk Log', 'Release Recommendation']::TEXT[],
    '# Governance Review Summary

## Purpose
Move structured evidence and quality posture into governance review.

## Required Inputs
- Test Execution Report
- Defect and Risk Log
- Release Recommendation

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'GOVERNANCE-RULES',
    'Governance rules',
    'Agent Contract',
    'INPUT',
    'VALIDATION',
    'Validation Agent',
    'Validation Agent depends on this artifact as an approved starting input.',
    ARRAY[]::TEXT[],
    '# Governance rules

## Purpose
Validation Agent depends on this artifact as an approved starting input.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'HUMAN-APPROVAL-PACKET',
    'Human Approval Packet',
    'Handoff Packet',
    'OUTPUT',
    'VALIDATION',
    'Validation Agent',
    'Prepare the final approval packet with the exact decision context needed by human approvers.',
    ARRAY['Governance Assessment', 'Approval Brief', 'Risk and Control Record']::TEXT[],
    '# Human Approval Packet

## Purpose
Prepare the final approval packet with the exact decision context needed by human approvers.

## Required Inputs
- Governance Assessment
- Approval Brief
- Risk and Control Record

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'HYPERCARE-HANDOFF',
    'Hypercare Handoff',
    'Workflow Output',
    'OUTPUT',
    'DEVOPS',
    'DevOps',
    'Release execution should leave behind a complete operational record of what was deployed and how it verified.',
    ARRAY['Deployment Authorization Packet', 'Release Authorization', 'Deployment Plan', 'Rollback Plan']::TEXT[],
    '# Hypercare Handoff

## Purpose
Release execution should leave behind a complete operational record of what was deployed and how it verified.

## Required Inputs
- Deployment Authorization Packet
- Release Authorization
- Deployment Plan
- Rollback Plan

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'IMPLEMENTATION-GUARDRAILS',
    'Implementation Guardrails',
    'Workflow Output',
    'OUTPUT',
    'ARCHITECT',
    'Architect',
    'Design should translate business intent into an implementation-ready technical contract.',
    ARRAY['Requirements Specification', 'Acceptance Criteria Matrix', 'Architecture Intake Packet', 'Existing Solution Context']::TEXT[],
    '# Implementation Guardrails

## Purpose
Design should translate business intent into an implementation-ready technical contract.

## Required Inputs
- Requirements Specification
- Acceptance Criteria Matrix
- Architecture Intake Packet
- Existing Solution Context

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'IMPLEMENTATION-NOTES',
    'Implementation Notes',
    'Workflow Output',
    'OUTPUT',
    'SOFTWARE-DEVELOPER',
    'Software Developer',
    'Development should produce both executable change evidence and a clear trace of what was implemented.',
    ARRAY['Solution Design Document', 'Architecture Decision Log', 'Developer Handoff Packet', 'Acceptance Criteria Matrix']::TEXT[],
    '# Implementation Notes

## Purpose
Development should produce both executable change evidence and a clear trace of what was implemented.

## Required Inputs
- Solution Design Document
- Architecture Decision Log
- Developer Handoff Packet
- Acceptance Criteria Matrix

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'INFRASTRUCTURE-CONTEXT',
    'Infrastructure context',
    'Agent Contract',
    'INPUT',
    'DEVOPS',
    'DevOps',
    'DevOps depends on this artifact as an approved starting input.',
    ARRAY[]::TEXT[],
    '# Infrastructure context

## Purpose
DevOps depends on this artifact as an approved starting input.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'JIRA-STORY-CONTEXT',
    'Jira Story Context',
    'Workflow Input',
    'INPUT',
    'BUSINESS-ANALYST',
    'Business Analyst',
    'Required input for the Business Analysis step.',
    ARRAY[]::TEXT[],
    '# Jira Story Context

## Purpose
Required input for the Business Analysis step.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'OPEN-QUESTIONS-FOR-DESIGN',
    'Open Questions for Design',
    'Handoff Packet',
    'OUTPUT',
    'BUSINESS-ANALYST',
    'Business Analyst',
    'Package the refined story intent and unresolved assumptions for architecture review.',
    ARRAY['Requirements Specification', 'Acceptance Criteria Matrix', 'Assumptions Log', 'Planning Report']::TEXT[],
    '# Open Questions for Design

## Purpose
Package the refined story intent and unresolved assumptions for architecture review.

## Required Inputs
- Requirements Specification
- Acceptance Criteria Matrix
- Assumptions Log
- Planning Report

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'OPERATIONAL-READINESS-NOTES',
    'Operational Readiness Notes',
    'Handoff Packet',
    'OUTPUT',
    'OWNER',
    'Capability Owning Agent',
    'Translate human approval into a deployment-ready hand-off for release execution.',
    ARRAY['Release Authorization', 'Approval Decision Record', 'Rollback Plan']::TEXT[],
    '# Operational Readiness Notes

## Purpose
Translate human approval into a deployment-ready hand-off for release execution.

## Required Inputs
- Release Authorization
- Approval Decision Record
- Rollback Plan

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'PLANNING-ASSUMPTIONS-LOG',
    'Planning Assumptions Log',
    'Workflow Output',
    'OUTPUT',
    'PLANNING',
    'Planning Agent',
    'Planning should produce a durable synthesis of stakeholder intent, milestones, and cross-agent expectations before detailed analysis begins.',
    ARRAY['Capability Charter', 'Stakeholder Requirements', 'Capability Operating Model', 'Cross-Agent Input Briefs']::TEXT[],
    '# Planning Assumptions Log

## Purpose
Planning should produce a durable synthesis of stakeholder intent, milestones, and cross-agent expectations before detailed analysis begins.

## Required Inputs
- Capability Charter
- Stakeholder Requirements
- Capability Operating Model
- Cross-Agent Input Briefs

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'PLANNING-REPORT',
    'Planning Report',
    'Workflow Output',
    'OUTPUT',
    'PLANNING',
    'Planning Agent',
    'Planning should produce a durable synthesis of stakeholder intent, milestones, and cross-agent expectations before detailed analysis begins.',
    ARRAY['Capability Charter', 'Stakeholder Requirements', 'Capability Operating Model', 'Cross-Agent Input Briefs']::TEXT[],
    '# Planning Report

## Purpose
Planning should produce a durable synthesis of stakeholder intent, milestones, and cross-agent expectations before detailed analysis begins.

## Required Inputs
- Capability Charter
- Stakeholder Requirements
- Capability Operating Model
- Cross-Agent Input Briefs

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'POLICY-EXCEPTION-LOG',
    'Policy Exception Log',
    'Workflow Output',
    'OUTPUT',
    'VALIDATION',
    'Validation Agent',
    'Governance must distill all release evidence into an approval-ready control package.',
    ARRAY['Validation Evidence Pack', 'Governance Review Summary', 'Defect and Risk Log', 'Release Recommendation']::TEXT[],
    '# Policy Exception Log

## Purpose
Governance must distill all release evidence into an approval-ready control package.

## Required Inputs
- Validation Evidence Pack
- Governance Review Summary
- Defect and Risk Log
- Release Recommendation

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'POST-RELEASE-FOLLOW-UP-LIST',
    'Post-Release Follow-up List',
    'Handoff Packet',
    'OUTPUT',
    'DEVOPS',
    'DevOps',
    'Close the workflow with a final operational and ownership hand-off back to the capability owner.',
    ARRAY['Deployment Summary', 'Production Verification Report', 'Release Notes']::TEXT[],
    '# Post-Release Follow-up List

## Purpose
Close the workflow with a final operational and ownership hand-off back to the capability owner.

## Required Inputs
- Deployment Summary
- Production Verification Report
- Release Notes

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'PRIOR-HANDOFFS',
    'Prior handoffs',
    'Agent Contract',
    'INPUT',
    'CONTRARIAN-REVIEWER',
    'Contrarian Reviewer',
    'Contrarian Reviewer depends on this artifact as an approved starting input.',
    ARRAY[]::TEXT[],
    '# Prior handoffs

## Purpose
Contrarian Reviewer depends on this artifact as an approved starting input.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'PRODUCTION-VERIFICATION-REPORT',
    'Production Verification Report',
    'Workflow Output',
    'OUTPUT',
    'DEVOPS',
    'DevOps',
    'Release execution should leave behind a complete operational record of what was deployed and how it verified.',
    ARRAY['Deployment Authorization Packet', 'Release Authorization', 'Deployment Plan', 'Rollback Plan']::TEXT[],
    '# Production Verification Report

## Purpose
Release execution should leave behind a complete operational record of what was deployed and how it verified.

## Required Inputs
- Deployment Authorization Packet
- Release Authorization
- Deployment Plan
- Rollback Plan

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'QA-INTAKE-PACKET',
    'QA Intake Packet',
    'Handoff Packet',
    'OUTPUT',
    'SOFTWARE-DEVELOPER',
    'Software Developer',
    'Package the build candidate, developer validation, and risk notes for QA.',
    ARRAY['Code Change Set', 'Developer Test Evidence', 'Build Candidate Manifest']::TEXT[],
    '# QA Intake Packet

## Purpose
Package the build candidate, developer validation, and risk notes for QA.

## Required Inputs
- Code Change Set
- Developer Test Evidence
- Build Candidate Manifest

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'QA-SIGN-OFF-NOTES',
    'QA Sign-off Notes',
    'Workflow Output',
    'OUTPUT',
    'QA',
    'QA',
    'QA should produce evidence that explains both the verification outcome and remaining risk posture.',
    ARRAY['Build Candidate Manifest', 'Acceptance Criteria Matrix', 'QA Intake Packet', 'Implementation Notes']::TEXT[],
    '# QA Sign-off Notes

## Purpose
QA should produce evidence that explains both the verification outcome and remaining risk posture.

## Required Inputs
- Build Candidate Manifest
- Acceptance Criteria Matrix
- QA Intake Packet
- Implementation Notes

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'REFINED-STORIES',
    'Refined stories',
    'Agent Contract',
    'INPUT',
    'SOFTWARE-DEVELOPER',
    'Software Developer',
    'Software Developer depends on this artifact as an approved starting input.',
    ARRAY[]::TEXT[],
    '# Refined stories

## Purpose
Software Developer depends on this artifact as an approved starting input.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'REGRESSION-FOCUS-AREAS',
    'Regression Focus Areas',
    'Handoff Packet',
    'OUTPUT',
    'SOFTWARE-DEVELOPER',
    'Software Developer',
    'Package the build candidate, developer validation, and risk notes for QA.',
    ARRAY['Code Change Set', 'Developer Test Evidence', 'Build Candidate Manifest']::TEXT[],
    '# Regression Focus Areas

## Purpose
Package the build candidate, developer validation, and risk notes for QA.

## Required Inputs
- Code Change Set
- Developer Test Evidence
- Build Candidate Manifest

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'RELEASE-AUTHORIZATION',
    'Release Authorization',
    'Workflow Output',
    'OUTPUT',
    'OWNER',
    'Capability Owning Agent',
    'Human approval should capture a durable authorization record and any release conditions or comments.',
    ARRAY['Human Approval Packet', 'Release Readiness Record', 'Rollback Plan', 'Release Window Details']::TEXT[],
    '# Release Authorization

## Purpose
Human approval should capture a durable authorization record and any release conditions or comments.

## Required Inputs
- Human Approval Packet
- Release Readiness Record
- Rollback Plan
- Release Window Details

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'RELEASE-CHECKLIST',
    'Release checklist',
    'Agent Contract',
    'OUTPUT',
    'DEVOPS',
    'DevOps',
    'DevOps is expected to publish this artifact as part of its baseline contribution.',
    ARRAY[]::TEXT[],
    '# Release checklist

## Purpose
DevOps is expected to publish this artifact as part of its baseline contribution.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'RELEASE-DECISION',
    'Release decision',
    'Agent Contract',
    'OUTPUT',
    'VALIDATION',
    'Validation Agent',
    'Validation Agent is expected to publish this artifact as part of its baseline contribution.',
    ARRAY[]::TEXT[],
    '# Release decision

## Purpose
Validation Agent is expected to publish this artifact as part of its baseline contribution.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'RELEASE-NOTES',
    'Release Notes',
    'Workflow Output',
    'OUTPUT',
    'DEVOPS',
    'DevOps',
    'Release execution should leave behind a complete operational record of what was deployed and how it verified.',
    ARRAY['Deployment Authorization Packet', 'Release Authorization', 'Deployment Plan', 'Rollback Plan']::TEXT[],
    '# Release Notes

## Purpose
Release execution should leave behind a complete operational record of what was deployed and how it verified.

## Required Inputs
- Deployment Authorization Packet
- Release Authorization
- Deployment Plan
- Rollback Plan

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'RELEASE-READINESS-RECORD',
    'Release Readiness Record',
    'Handoff Packet',
    'OUTPUT',
    'VALIDATION',
    'Validation Agent',
    'Prepare the final approval packet with the exact decision context needed by human approvers.',
    ARRAY['Governance Assessment', 'Approval Brief', 'Risk and Control Record']::TEXT[],
    '# Release Readiness Record

## Purpose
Prepare the final approval packet with the exact decision context needed by human approvers.

## Required Inputs
- Governance Assessment
- Approval Brief
- Risk and Control Record

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'RELEASE-RECOMMENDATION',
    'Release Recommendation',
    'Workflow Output',
    'OUTPUT',
    'QA',
    'QA',
    'QA should produce evidence that explains both the verification outcome and remaining risk posture.',
    ARRAY['Build Candidate Manifest', 'Acceptance Criteria Matrix', 'QA Intake Packet', 'Implementation Notes']::TEXT[],
    '# Release Recommendation

## Purpose
QA should produce evidence that explains both the verification outcome and remaining risk posture.

## Required Inputs
- Build Candidate Manifest
- Acceptance Criteria Matrix
- QA Intake Packet
- Implementation Notes

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'RELEASE-WINDOW-DETAILS',
    'Release Window Details',
    'Workflow Input',
    'INPUT',
    'OWNER',
    'Capability Owning Agent',
    'Required input for the Human Approval step.',
    ARRAY[]::TEXT[],
    '# Release Window Details

## Purpose
Required input for the Human Approval step.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'REQUIREMENTS-PACK',
    'Requirements pack',
    'Agent Contract',
    'OUTPUT',
    'BUSINESS-ANALYST',
    'Business Analyst',
    'Business Analyst is expected to publish this artifact as part of its baseline contribution.',
    ARRAY[]::TEXT[],
    '# Requirements pack

## Purpose
Business Analyst is expected to publish this artifact as part of its baseline contribution.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'REQUIREMENTS-SPECIFICATION',
    'Requirements Specification',
    'Workflow Output',
    'OUTPUT',
    'BUSINESS-ANALYST',
    'Business Analyst',
    'Analysis should produce a review-ready business and scope pack that downstream design can trust.',
    ARRAY['Capability Charter', 'Stakeholder Requirements', 'Planning Report', 'Stakeholder Priorities Register', 'Jira Story Context', 'Domain Constraints Register']::TEXT[],
    '# Requirements Specification

## Purpose
Analysis should produce a review-ready business and scope pack that downstream design can trust.

## Required Inputs
- Capability Charter
- Stakeholder Requirements
- Planning Report
- Stakeholder Priorities Register
- Jira Story Context
- Domain Constraints Register

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'RISK-AND-CONTROL-RECORD',
    'Risk and Control Record',
    'Workflow Output',
    'OUTPUT',
    'VALIDATION',
    'Validation Agent',
    'Governance must distill all release evidence into an approval-ready control package.',
    ARRAY['Validation Evidence Pack', 'Governance Review Summary', 'Defect and Risk Log', 'Release Recommendation']::TEXT[],
    '# Risk and Control Record

## Purpose
Governance must distill all release evidence into an approval-ready control package.

## Required Inputs
- Validation Evidence Pack
- Governance Review Summary
- Defect and Risk Log
- Release Recommendation

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'RISK-CHALLENGE-MEMO',
    'Risk Challenge Memo',
    'Agent Contract',
    'OUTPUT',
    'CONTRARIAN-REVIEWER',
    'Contrarian Reviewer',
    'Contrarian Reviewer is expected to publish this artifact as part of its baseline contribution.',
    ARRAY[]::TEXT[],
    '# Risk Challenge Memo

## Purpose
Contrarian Reviewer is expected to publish this artifact as part of its baseline contribution.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'ROLLBACK-PLAN',
    'Rollback Plan',
    'Workflow Input',
    'INPUT',
    'OWNER',
    'Capability Owning Agent',
    'Required input for the Human Approval step.',
    ARRAY[]::TEXT[],
    '# Rollback Plan

## Purpose
Required input for the Human Approval step.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'SOLUTION-DESIGN-DOCUMENT',
    'Solution Design Document',
    'Workflow Output',
    'OUTPUT',
    'ARCHITECT',
    'Architect',
    'Design should translate business intent into an implementation-ready technical contract.',
    ARRAY['Requirements Specification', 'Acceptance Criteria Matrix', 'Architecture Intake Packet', 'Existing Solution Context']::TEXT[],
    '# Solution Design Document

## Purpose
Design should translate business intent into an implementation-ready technical contract.

## Required Inputs
- Requirements Specification
- Acceptance Criteria Matrix
- Architecture Intake Packet
- Existing Solution Context

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'STAKEHOLDER-ALIGNMENT-SUMMARY',
    'Stakeholder Alignment Summary',
    'Workflow Output',
    'OUTPUT',
    'PLANNING',
    'Planning Agent',
    'Planning should produce a durable synthesis of stakeholder intent, milestones, and cross-agent expectations before detailed analysis begins.',
    ARRAY['Capability Charter', 'Stakeholder Requirements', 'Capability Operating Model', 'Cross-Agent Input Briefs']::TEXT[],
    '# Stakeholder Alignment Summary

## Purpose
Planning should produce a durable synthesis of stakeholder intent, milestones, and cross-agent expectations before detailed analysis begins.

## Required Inputs
- Capability Charter
- Stakeholder Requirements
- Capability Operating Model
- Cross-Agent Input Briefs

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'STAKEHOLDER-INPUT-BRIEFS',
    'Stakeholder input briefs',
    'Agent Contract',
    'INPUT',
    'PLANNING',
    'Planning Agent',
    'Planning Agent depends on this artifact as an approved starting input.',
    ARRAY[]::TEXT[],
    '# Stakeholder input briefs

## Purpose
Planning Agent depends on this artifact as an approved starting input.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'STAKEHOLDER-PRIORITIES-REGISTER',
    'Stakeholder Priorities Register',
    'Handoff Packet',
    'OUTPUT',
    'PLANNING',
    'Planning Agent',
    'Package the planning baseline so business analysis starts with agreed priorities, milestones, and assumptions.',
    ARRAY['Planning Report', 'Delivery Milestone Plan', 'Planning Assumptions Log']::TEXT[],
    '# Stakeholder Priorities Register

## Purpose
Package the planning baseline so business analysis starts with agreed priorities, milestones, and assumptions.

## Required Inputs
- Planning Report
- Delivery Milestone Plan
- Planning Assumptions Log

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'STAKEHOLDER-REQUIREMENTS',
    'Stakeholder requirements',
    'Agent Contract',
    'INPUT',
    'BUSINESS-ANALYST',
    'Business Analyst',
    'Business Analyst depends on this artifact as an approved starting input.',
    ARRAY[]::TEXT[],
    '# Stakeholder requirements

## Purpose
Business Analyst depends on this artifact as an approved starting input.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'TECHNICAL-DESIGN',
    'Technical design',
    'Agent Contract',
    'INPUT',
    'SOFTWARE-DEVELOPER',
    'Software Developer',
    'Software Developer depends on this artifact as an approved starting input.',
    ARRAY[]::TEXT[],
    '# Technical design

## Purpose
Software Developer depends on this artifact as an approved starting input.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'TEST-EVIDENCE',
    'Test evidence',
    'Agent Contract',
    'OUTPUT',
    'QA',
    'QA',
    'QA is expected to publish this artifact as part of its baseline contribution.',
    ARRAY[]::TEXT[],
    '# Test evidence

## Purpose
QA is expected to publish this artifact as part of its baseline contribution.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'TEST-EXECUTION-REPORT',
    'Test Execution Report',
    'Workflow Output',
    'OUTPUT',
    'QA',
    'QA',
    'QA should produce evidence that explains both the verification outcome and remaining risk posture.',
    ARRAY['Build Candidate Manifest', 'Acceptance Criteria Matrix', 'QA Intake Packet', 'Implementation Notes']::TEXT[],
    '# Test Execution Report

## Purpose
QA should produce evidence that explains both the verification outcome and remaining risk posture.

## Required Inputs
- Build Candidate Manifest
- Acceptance Criteria Matrix
- QA Intake Packet
- Implementation Notes

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'VALIDATION-EVIDENCE-PACK',
    'Validation Evidence Pack',
    'Handoff Packet',
    'OUTPUT',
    'QA',
    'QA',
    'Move structured evidence and quality posture into governance review.',
    ARRAY['Test Execution Report', 'Defect and Risk Log', 'Release Recommendation']::TEXT[],
    '# Validation Evidence Pack

## Purpose
Move structured evidence and quality posture into governance review.

## Required Inputs
- Test Execution Report
- Defect and Risk Log
- Release Recommendation

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    TRUE
  ),
  (
    'VALIDATION-REPORT',
    'Validation report',
    'Agent Contract',
    'OUTPUT',
    'VALIDATION',
    'Validation Agent',
    'Validation Agent is expected to publish this artifact as part of its baseline contribution.',
    ARRAY[]::TEXT[],
    '# Validation report

## Purpose
Validation Agent is expected to publish this artifact as part of its baseline contribution.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  ),
  (
    'WORKFLOW-OUTPUTS',
    'Workflow outputs',
    'Agent Contract',
    'INPUT',
    'VALIDATION',
    'Validation Agent',
    'Validation Agent depends on this artifact as an approved starting input.',
    ARRAY[]::TEXT[],
    '# Workflow outputs

## Purpose
Validation Agent depends on this artifact as an approved starting input.

## Required Inputs
- Add required context here

## Summary
- Capture the core decision, output, or evidence.

## Details
- Add the operational detail, assumptions, and trace notes.

## Follow-up
- Record owners, next steps, and downstream hand-off expectations.',
    FALSE
  );

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
