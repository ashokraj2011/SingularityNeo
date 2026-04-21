export type Status = 'PENDING' | 'VERIFIED' | 'RUNNING' | 'STABLE' | 'ALERT' | 'BETA' | 'IN_PROGRESS' | 'ARCHIVED' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'URGENT';

export type SkillKind = 'GENERAL' | 'ROLE' | 'CUSTOM' | 'LEARNING';
export type SkillOrigin = 'FOUNDATION' | 'CAPABILITY';
export type ProviderKey = 'github-copilot' | 'local-openai';
export type EmbeddingProviderKey = 'local-openai' | 'deterministic-hash';
export type AgentRoleStarterKey =
  | 'OWNER'
  | 'PLANNING'
  | 'BUSINESS-ANALYST'
  | 'ARCHITECT'
  | 'SOFTWARE-DEVELOPER'
  | 'QA'
  | 'DEVOPS'
  | 'VALIDATION'
  | 'EXECUTION-OPS'
  | 'CONTRARIAN-REVIEWER';

export interface AgentArtifactExpectation {
  artifactName: string;
  direction: 'INPUT' | 'OUTPUT';
  requiredByDefault: boolean;
  description?: string;
}

export interface AgentOperatingContract {
  description: string;
  primaryResponsibilities: string[];
  workingApproach: string[];
  preferredOutputs: string[];
  guardrails: string[];
  conflictResolution: string[];
  definitionOfDone: string;
  suggestedInputArtifacts: AgentArtifactExpectation[];
  expectedOutputArtifacts: AgentArtifactExpectation[];
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: 'Analysis' | 'Automation' | 'Security' | 'Compliance' | 'Data';
  version: string;
  contentMarkdown?: string;
  kind?: SkillKind;
  origin?: SkillOrigin;
  defaultTemplateKeys?: string[];
}

export interface CapabilityStakeholder {
  role: string;
  name: string;
  email: string;
  teamName?: string;
}

export type CapabilityRepositoryStatus = 'ACTIVE' | 'ARCHIVED';

export interface CapabilityRepository {
  id: string;
  capabilityId: string;
  label: string;
  url: string;
  defaultBranch: string;
  localRootHint?: string;
  isPrimary: boolean;
  status?: CapabilityRepositoryStatus;
}

// ──────────────────────────────────────────────────────────────────────────
// Copilot Guidance Pack
//
// Content pulled from well-known copilot / AI-assistant files in a
// capability's Git repos (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*`,
// `.github/copilot-instructions.md`, `docs/testing.md`, ...). Fed into the
// agent's system prompt at session init and into the learning judge rubric
// as the "house testing guidance" for that capability.
// ──────────────────────────────────────────────────────────────────────────

export type CapabilityCopilotGuidanceCategory = 'guidance' | 'testing';

export type CapabilityCopilotGuidanceFetchStatus =
  | 'OK'
  | 'NOT_FOUND'
  | 'AUTH_MISSING'
  | 'RATE_LIMITED'
  | 'ERROR';

export interface CapabilityCopilotGuidanceFile {
  repositoryId: string;
  repositoryLabel?: string;
  filePath: string;
  content: string;
  sha: string;
  category: CapabilityCopilotGuidanceCategory;
  commitSha?: string;
  fetchedAt: string;
  sizeBytes: number;
}

export interface CapabilityCopilotGuidancePack {
  capabilityId: string;
  files: CapabilityCopilotGuidanceFile[];
  lastFetchedAt?: string;
  lastFetchStatus?: CapabilityCopilotGuidanceFetchStatus;
  lastFetchMessage?: string;
}

export interface CapabilityChatDistillationRecord {
  capabilityId: string;
  agentId: string;
  sessionId: string;
  distilledAt: string;
  messageCount: number;
  correctionPreview: string;
  learningUpdateId?: string;
  blockedByShapeCheck?: boolean;
  blockReason?: string;
}

/**
 * Response shape from POST .../chat-sessions/:sessionId/distill. Mirrors
 * the backend's `ChatDistillationResult` — surfaced here so the UI can
 * render the outcome (APPLIED / NO_LEARNING / TOO_SHORT / …) without
 * duplicating the union.
 */
export interface ChatDistillationResult {
  status: 'APPLIED' | 'NO_LEARNING' | 'TOO_SHORT' | 'ALREADY_DISTILLED' | 'ERROR';
  correctionPreview?: string;
  messageCount: number;
  message?: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Code understanding module (Phase A)
//
// A capability indexes every linked repository into a flat list of
// symbols + a file-level reference graph. We use the TypeScript compiler
// API for TS/JS (no new native deps). Symbols are whatever an engineer
// would recognise as a named thing: classes, functions, interfaces,
// type aliases, enums, top-level const/let/var, and class methods.
//
// The data is kept deliberately coarse — we're answering "does this
// capability have a symbol called X and where is it" and "what does
// file A import", not "what type does this expression have". The
// heavy semantic stuff lives in downstream eval / code-gen passes that
// re-open source on demand.
// ──────────────────────────────────────────────────────────────────────────

export type CapabilityCodeSymbolKind =
  | 'class'
  | 'function'
  | 'interface'
  | 'type'
  | 'enum'
  | 'variable'
  | 'method'
  | 'property';

export type CapabilityCodeIndexRunStatus =
  | 'OK'
  | 'PARTIAL'
  | 'AUTH_MISSING'
  | 'RATE_LIMITED'
  | 'EMPTY'
  | 'ERROR';

export interface CapabilityCodeSymbol {
  capabilityId: string;
  repositoryId: string;
  repositoryLabel?: string;
  filePath: string;
  symbolName: string;
  kind: CapabilityCodeSymbolKind;
  parentSymbol?: string;
  startLine: number;
  endLine: number;
  signature: string;
  isExported: boolean;
  sha?: string;
  indexedAt: string;
}

export interface CapabilityCodeIndexRepoSummary {
  repositoryId: string;
  repositoryLabel?: string;
  filesIndexed: number;
  symbolsIndexed: number;
  referencesIndexed: number;
  lastIndexedAt?: string;
  lastStatus?: CapabilityCodeIndexRunStatus;
  lastMessage?: string;
}

export interface CapabilityCodeIndexSnapshot {
  capabilityId: string;
  repositories: CapabilityCodeIndexRepoSummary[];
  lastRunAt?: string;
  lastRunStatus?: CapabilityCodeIndexRunStatus;
  lastRunMessage?: string;
  totalSymbols: number;
  totalFiles: number;
}

export interface WorkItemPhaseStakeholder {
  role: string;
  name: string;
  email: string;
  teamName?: string;
}

export interface WorkItemPhaseStakeholderAssignment {
  phaseId: WorkflowPhaseId;
  stakeholders: WorkItemPhaseStakeholder[];
}

export interface WorkItemAttachmentUpload {
  fileName: string;
  mimeType?: string;
  contentText: string;
  sizeBytes?: number;
}

export interface CapabilityMetadataEntry {
  key: string;
  value: string;
}

export type CapabilityDatabaseEngine =
  | 'POSTGRES'
  | 'MYSQL'
  | 'MARIADB'
  | 'SQLSERVER'
  | 'ORACLE'
  | 'SNOWFLAKE'
  | 'MONGODB'
  | 'REDIS'
  | 'OTHER';

export type CapabilityDatabaseAuthentication =
  | 'SECRET_REFERENCE'
  | 'USERNAME_PASSWORD'
  | 'IAM'
  | 'INTEGRATED'
  | 'NONE';

export type CapabilityDatabaseSslMode = 'DISABLE' | 'PREFER' | 'REQUIRE';

export interface CapabilityDatabaseConfig {
  id: string;
  label: string;
  engine: CapabilityDatabaseEngine;
  host: string;
  port?: number;
  databaseName: string;
  schema?: string;
  username?: string;
  authentication: CapabilityDatabaseAuthentication;
  secretReference?: string;
  sslMode?: CapabilityDatabaseSslMode;
  readOnly?: boolean;
  notes?: string;
}

export interface WorkspaceGithubConnectorSettings {
  enabled: boolean;
  baseUrl?: string;
  secretReference?: string;
  ownerHint?: string;
  notes?: string;
}

export interface WorkspaceJiraConnectorSettings {
  enabled: boolean;
  baseUrl?: string;
  email?: string;
  secretReference?: string;
  projectKey?: string;
  notes?: string;
}

export interface WorkspaceConfluenceConnectorSettings {
  enabled: boolean;
  baseUrl?: string;
  email?: string;
  secretReference?: string;
  spaceKey?: string;
  notes?: string;
}

export interface WorkspaceConnectorSettings {
  github: WorkspaceGithubConnectorSettings;
  jira: WorkspaceJiraConnectorSettings;
  confluence: WorkspaceConfluenceConnectorSettings;
}

export type WorkspaceUserStatus = 'ACTIVE' | 'INVITED' | 'DISABLED';
export type WorkspaceRole =
  | 'WORKSPACE_ADMIN'
  | 'PORTFOLIO_OWNER'
  | 'TEAM_LEAD'
  | 'INCIDENT_COMMANDER'
  | 'OPERATOR'
  | 'AUDITOR'
  | 'VIEWER';
export type WorkspaceTeamMembershipRole =
  | 'LEAD'
  | 'MEMBER'
  | 'APPROVER'
  | 'VIEWER';
export type CapabilityAccessRole = 'OWNER' | 'OPERATOR' | 'APPROVER' | 'VIEWER';
export type ExternalIdentityProvider = 'GITHUB' | 'JIRA' | 'CONFLUENCE' | 'SSO';
export type NotificationChannel = 'INBOX' | 'EMAIL' | 'SLACK' | 'TEAMS';
export type NotificationTrigger =
  | 'APPROVAL_REQUESTED'
  | 'PHASE_ENTERED'
  | 'SLA_BREACHED'
  | 'REQUEST_CHANGES'
  | 'CONFLICT_NEEDS_RESOLUTION'
  | 'HANDOFF_ACCEPTANCE_REQUIRED';
export type PermissionAction =
  | 'workspace.manage'
  | 'access.manage'
  | 'capability.create'
  | 'capability.read'
  | 'capability.read.rollup'
  | 'capability.edit'
  | 'capability.execution.claim'
  | 'workflow.edit'
  | 'agents.manage'
  | 'contract.publish'
  | 'workitem.read'
  | 'workitem.create'
  | 'workitem.control'
  | 'workitem.restart'
  | 'approval.decide'
  | 'artifact.read'
  | 'artifact.publish'
  | 'telemetry.read'
  | 'chat.read'
  | 'chat.write'
  | 'report.view.operations'
  | 'report.view.portfolio'
  | 'report.view.executive'
  | 'report.view.audit';
export type CapabilityVisibilityScope = 'NONE' | 'ROLLUP_ONLY' | 'LIVE_DETAIL';

export interface WorkspaceUser {
  id: string;
  name: string;
  email: string;
  title?: string;
  status: WorkspaceUserStatus;
  teamIds: string[];
  workspaceRoles: WorkspaceRole[];
}

export interface WorkspaceTeam {
  id: string;
  name: string;
  description?: string;
  memberUserIds: string[];
  capabilityIds: string[];
}

export interface WorkspaceMembership {
  id: string;
  userId: string;
  teamId: string;
  role: WorkspaceTeamMembershipRole;
}

export interface CapabilityMembership {
  id: string;
  capabilityId: string;
  userId: string;
  teamId?: string;
  role: CapabilityAccessRole;
}

export interface ExternalIdentityLink {
  id: string;
  userId: string;
  provider: ExternalIdentityProvider;
  externalId: string;
  username?: string;
  displayName?: string;
  profileUrl?: string;
}

export interface UserPreference {
  userId: string;
  defaultCapabilityId?: string;
  lastSelectedTeamId?: string;
  workbenchView?: 'ALL_WORK' | 'MY_QUEUE' | 'TEAM_QUEUE' | 'ATTENTION' | 'WATCHING';
}

export interface NotificationRule {
  id: string;
  trigger: NotificationTrigger;
  channels: NotificationChannel[];
  teamId?: string;
  userId?: string;
  capabilityId?: string;
  immediate: boolean;
  digest: boolean;
}

export interface CapabilityGrant {
  id: string;
  capabilityId: string;
  userId?: string;
  teamId?: string;
  actions: PermissionAction[];
  note?: string;
  createdByUserId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InheritedRollupAccess {
  capabilityId: string;
  sourceCapabilityId: string;
  sourceCapabilityName?: string;
  reason: string;
}

export interface ExplicitDescendantAccessGrant {
  id: string;
  parentCapabilityId: string;
  descendantCapabilityId: string;
  userId?: string;
  teamId?: string;
  actions: PermissionAction[];
  note?: string;
  createdByUserId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EffectivePermissionSet {
  actorUserId?: string;
  actorDisplayName: string;
  capabilityId?: string;
  workspaceRoles: WorkspaceRole[];
  capabilityRoles: CapabilityAccessRole[];
  allowedActions: PermissionAction[];
  visibilityScope: CapabilityVisibilityScope;
  inheritedRollupAccess: InheritedRollupAccess[];
  explicitDescendantGrantIds: string[];
  reasoning: string[];
}

export interface AccessAuditEvent {
  id: string;
  actorUserId?: string;
  actorDisplayName: string;
  action: string;
  targetType:
    | 'WORKSPACE_USER'
    | 'WORKSPACE_TEAM'
    | 'CAPABILITY_ACCESS'
    | 'DESCENDANT_ACCESS'
    | 'NOTIFICATION_RULE'
    | 'CONTRACT_PUBLISH'
    | 'WORK_ITEM_CONTROL'
    | 'WORK_ITEM_WRITE_CLAIM';
  targetId: string;
  capabilityId?: string;
  summary: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface WorkspaceOrganization {
  users: WorkspaceUser[];
  teams: WorkspaceTeam[];
  memberships: WorkspaceMembership[];
  capabilityMemberships: CapabilityMembership[];
  capabilityGrants: CapabilityGrant[];
  descendantAccessGrants: ExplicitDescendantAccessGrant[];
  externalIdentityLinks: ExternalIdentityLink[];
  userPreferences: UserPreference[];
  notificationRules: NotificationRule[];
  accessAuditEvents: AccessAuditEvent[];
  currentUserId?: string;
}

export interface ActorContext {
  userId?: string;
  displayName: string;
  teamIds: string[];
  workspaceRoles?: WorkspaceRole[];
  actedOnBehalfOfStakeholderIds?: string[];
}

export interface WorkspaceAccessSnapshot {
  organization: WorkspaceOrganization;
  currentActorPermissions: EffectivePermissionSet;
}

export interface CapabilityAccessSnapshot {
  capabilityId: string;
  capabilityMemberships: CapabilityMembership[];
  capabilityGrants: CapabilityGrant[];
  descendantAccessGrants: ExplicitDescendantAccessGrant[];
  inheritedRollupAccess: InheritedRollupAccess[];
  currentActorPermissions: EffectivePermissionSet;
}

export interface WorkspaceSettings {
  databaseConfigs: CapabilityDatabaseConfig[];
  connectors: WorkspaceConnectorSettings;
}

export interface WorkspaceDatabaseBootstrapConfig {
  host: string;
  port: number;
  databaseName: string;
  user: string;
  adminDatabaseName?: string;
  password?: string;
}

export interface WorkspaceDatabaseBootstrapProfile
  extends WorkspaceDatabaseBootstrapConfig {
  id: string;
  label: string;
  lastUsedAt: string;
}

export interface WorkspaceDatabaseBootstrapProfileSnapshot {
  activeProfileId?: string;
  profiles: WorkspaceDatabaseBootstrapProfile[];
}

export interface WorkspaceDatabaseRuntimeInfo {
  host: string;
  port: number;
  databaseName: string;
  user: string;
  adminDatabaseName?: string;
  passwordConfigured: boolean;
  pgvectorAvailable: boolean;
  lastConnectionError?: string;
}

export interface WorkspaceDatabaseBootstrapStatus {
  runtime: WorkspaceDatabaseRuntimeInfo;
  adminReachable: boolean;
  databaseExists: boolean;
  databaseReachable: boolean;
  schemaInitialized: boolean;
  foundationsInitialized: boolean;
  ready: boolean;
  lastError?: string;
}

export interface WorkspaceAgentTemplate {
  id: string;
  key: string;
  roleStarterKey: AgentRoleStarterKey;
  name: string;
  role: string;
  objective: string;
  systemPrompt: string;
  contract: AgentOperatingContract;
  inputArtifacts: string[];
  outputArtifacts: string[];
  defaultSkillIds: string[];
  preferredToolIds: ToolAdapterId[];
}

export interface WorkspaceEvalCaseTemplate {
  id: string;
  name: string;
  description: string;
  input: Record<string, any>;
  expected: Record<string, any>;
}

export interface WorkspaceEvalSuiteTemplate {
  id: string;
  name: string;
  description: string;
  agentRole: string;
  evalType: 'STRUCTURED_OUTPUT' | 'RETRIEVAL' | 'WORKFLOW';
  enabled: boolean;
  cases: WorkspaceEvalCaseTemplate[];
}

export interface WorkspaceWorkflowTemplate {
  id: string;
  templateId: string;
  name: string;
  summary?: string;
  workflowType?: 'SDLC' | 'Operational' | 'Governance' | 'Custom';
  scope: 'GLOBAL';
  schemaVersion?: number;
  entryNodeId?: string;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
  steps: WorkflowStep[];
  publishState?: WorkflowPublishState;
}

export interface WorkspaceArtifactTemplate {
  id: string;
  name: string;
  type: string;
  direction: 'INPUT' | 'OUTPUT';
  agentLabel: string;
  description: string;
  inputs: string[];
  template: string;
  sourceWorkflow: boolean;
}

export interface WorkspaceToolTemplate {
  id: string;
  toolId: ToolAdapterId;
  label: string;
  description: string;
  category:
    | 'Workspace'
    | 'Search'
    | 'Git'
    | 'Build'
    | 'Test'
    | 'Docs'
    | 'Deploy';
  requiresApproval: boolean;
}

export interface WorkspaceFoundationCatalog {
  agentTemplates: WorkspaceAgentTemplate[];
  workflowTemplates: WorkspaceWorkflowTemplate[];
  evalSuiteTemplates: WorkspaceEvalSuiteTemplate[];
  skillTemplates: Skill[];
  artifactTemplates: WorkspaceArtifactTemplate[];
  toolTemplates: WorkspaceToolTemplate[];
  initializedAt?: string;
}

export interface WorkspaceFoundationSummary {
  initialized: boolean;
  lastInitializedAt?: string;
  agentTemplateCount: number;
  workflowTemplateCount: number;
  evalSuiteTemplateCount: number;
  skillTemplateCount: number;
  artifactTemplateCount: number;
  toolTemplateCount: number;
  totalTemplateCount: number;
}

export interface WorkspaceCatalogSnapshot {
  databaseRuntime: WorkspaceDatabaseRuntimeInfo;
  foundations: WorkspaceFoundationCatalog;
  summary: WorkspaceFoundationSummary;
}

export interface WorkspaceDatabaseBootstrapResult {
  status: WorkspaceDatabaseBootstrapStatus;
  catalogSnapshot: WorkspaceCatalogSnapshot;
  profileSnapshot?: WorkspaceDatabaseBootstrapProfileSnapshot;
}

export interface CapabilityExecutionCommandTemplate {
  id: string;
  label: string;
  description?: string;
  command: string[];
  workingDirectory?: string;
  requiresApproval?: boolean;
}

export interface CapabilityDeploymentTarget {
  id: string;
  label: string;
  description?: string;
  commandTemplateId: string;
  workspacePath?: string;
}

export type ExecutionMode = 'LIVE' | 'SHADOW';

export interface CapabilityExecutionConfig {
  executionMode?: ExecutionMode;
  defaultWorkspacePath?: string;
  allowedWorkspacePaths: string[];
  commandTemplates: CapabilityExecutionCommandTemplate[];
  deploymentTargets: CapabilityDeploymentTarget[];
}

export interface CapabilityOnboardingDraft {
  name: string;
  domain: string;
  parentCapabilityId: string;
  capabilityKind: CapabilityKind;
  collectionKind?: CapabilityCollectionKind;
  childCapabilityIds: string[];
  sharedCapabilityIds: string[];
  businessUnit: string;
  ownerTeam: string;
  description: string;
  businessOutcome: string;
  successMetrics: string[];
  definitionOfDone: string;
  requiredEvidenceKinds: string[];
  operatingPolicySummary: string;
  githubRepositories: string[];
  jiraBoardLink: string;
  confluenceLink: string;
  documentationNotes: string;
  localDirectories: string[];
  defaultWorkspacePath: string;
  allowedWorkspacePaths: string[];
  commandTemplates: CapabilityExecutionCommandTemplate[];
  deploymentTargets: CapabilityDeploymentTarget[];
}

export interface OperatingPolicySnapshot {
  id: string;
  capabilityId: string;
  operatingPolicySummary: string;
  triggeredByUserId?: string;
  chatMessageId?: string;
  createdAt: string;
}

export interface ConnectorValidationItem {
  connector: 'GITHUB' | 'JIRA' | 'CONFLUENCE';
  value: string;
  valid: boolean;
  message: string;
}

export interface ConnectorValidationResult {
  valid: boolean;
  items: ConnectorValidationItem[];
}

export interface WorkspacePathValidationResult {
  path: string;
  normalizedPath?: string;
  valid: boolean;
  exists: boolean;
  isDirectory: boolean;
  readable: boolean;
  message: string;
}

export interface CommandTemplateValidationResult {
  templateId: string;
  valid: boolean;
  issues: string[];
  message: string;
}

export interface DeploymentTargetValidationResult {
  targetId: string;
  valid: boolean;
  issues: string[];
  message: string;
}

export type WorkspaceStackKind = 'NODE' | 'PYTHON' | 'JAVA' | 'GENERIC';

export type WorkspaceBuildTool =
  | 'NPM'
  | 'PNPM'
  | 'YARN'
  | 'UV'
  | 'POETRY'
  | 'PIP'
  | 'PIPENV'
  | 'MAVEN'
  | 'GRADLE'
  | 'UNKNOWN';

export type WorkspaceDetectionConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface WorkspaceStackProfile {
  stack: WorkspaceStackKind;
  buildTool: WorkspaceBuildTool;
  confidence: WorkspaceDetectionConfidence;
  workspacePath?: string;
  summary: string;
}

export interface WorkspaceCommandRecommendation
  extends CapabilityExecutionCommandTemplate {
  rationale?: string;
}

export interface WorkspaceDetectionResult {
  requestedPaths: string[];
  normalizedPath?: string;
  profile: WorkspaceStackProfile;
  evidenceFiles: string[];
  recommendedCommandTemplates: WorkspaceCommandRecommendation[];
  recommendedDeploymentTargets: CapabilityDeploymentTarget[];
}

export type WorkflowPhaseId = string;

export type SystemPhaseId = 'BACKLOG' | 'DONE';

export interface CapabilityLifecyclePhase {
  id: WorkflowPhaseId;
  label: string;
  description?: string;
}

export interface RetiredCapabilityLifecyclePhase
  extends CapabilityLifecyclePhase {
  retiredAt: string;
}

export interface CapabilityLifecycle {
  version: number;
  phases: CapabilityLifecyclePhase[];
  retiredPhases: RetiredCapabilityLifecyclePhase[];
}

export type CapabilitySystemRole = 'FOUNDATION';

export interface CapabilityPhaseOwnershipRule {
  phaseId: WorkflowPhaseId;
  primaryOwnerTeamId?: string;
  secondaryOwnerTeamIds: string[];
  approvalTeamIds: string[];
  escalationTeamIds: string[];
}

export type CapabilityKind = 'DELIVERY' | 'COLLECTION';

export type CapabilityCollectionKind =
  | 'BUSINESS_DOMAIN'
  | 'PLATFORM_LAYER'
  | 'ENTERPRISE_LAYER'
  | 'CITY_PLAN'
  | 'ALM_PORTFOLIO';

export type CapabilityDependencyKind =
  | 'FUNCTIONAL'
  | 'API'
  | 'DATA'
  | 'PLATFORM'
  | 'OPERATIONAL';

export type CapabilityDependencyCriticality =
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'CRITICAL';

export interface CapabilityDependency {
  id: string;
  capabilityId: string;
  targetCapabilityId: string;
  dependencyKind: CapabilityDependencyKind;
  description: string;
  criticality: CapabilityDependencyCriticality;
  versionConstraint?: string;
}

export interface CapabilitySharedReference {
  id: string;
  collectionCapabilityId: string;
  memberCapabilityId: string;
  label?: string;
}

export interface FunctionalRequirementRecord {
  id: string;
  title: string;
  description: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status?: 'DRAFT' | 'ACTIVE' | 'DONE';
  linkedArtifactIds?: string[];
}

export interface NonFunctionalRequirementRecord {
  id: string;
  category:
    | 'PERFORMANCE'
    | 'RELIABILITY'
    | 'SECURITY'
    | 'COMPLIANCE'
    | 'OBSERVABILITY'
    | 'SCALABILITY'
    | 'OPERABILITY'
    | 'OTHER';
  title: string;
  description: string;
  target?: string;
}

export interface ApiContractReference {
  id: string;
  name: string;
  kind?: 'REST' | 'GRAPHQL' | 'EVENT' | 'RPC' | 'FILE' | 'OTHER';
  version?: string;
  provider?: string;
  consumer?: string;
  pathOrChannel?: string;
  description?: string;
}

export interface SoftwareVersionRecord {
  id: string;
  name: string;
  version: string;
  role?: string;
  repository?: string;
  environment?: string;
  notes?: string;
}

export interface CapabilityAlmReference {
  id: string;
  system: 'JIRA' | 'CONFLUENCE' | 'GITHUB' | 'ADO' | 'SERVICE_NOW' | 'OTHER';
  label: string;
  url?: string;
  externalId?: string;
  description?: string;
}

export interface CapabilityContractSection {
  id: string;
  title: string;
  summary?: string;
  body?: string;
  items?: string[];
  references?: string[];
}

export interface CapabilityContractDraft {
  overview?: string;
  businessIntent?: string;
  ownershipModel?: string;
  deploymentFootprint?: string;
  evidenceAndReadiness?: string;
  functionalRequirements: FunctionalRequirementRecord[];
  nonFunctionalRequirements: NonFunctionalRequirementRecord[];
  apiContracts: ApiContractReference[];
  softwareVersions: SoftwareVersionRecord[];
  almReferences: CapabilityAlmReference[];
  sections: CapabilityContractSection[];
  additionalMetadata: CapabilityMetadataEntry[];
  lastEditedAt?: string;
  lastEditedBy?: string;
}

export interface CapabilityPublishedSnapshot {
  id: string;
  capabilityId: string;
  publishVersion: number;
  publishedAt: string;
  publishedBy: string;
  supersedesSnapshotId?: string;
  contract: CapabilityContractDraft;
}

export interface CapabilityRollupWarning {
  id: string;
  severity: 'INFO' | 'WARN' | 'ERROR';
  kind:
    | 'MISSING_PUBLISH'
    | 'STALE_PUBLISH'
    | 'UNRESOLVED_DEPENDENCY'
    | 'VERSION_MISMATCH'
    | 'CYCLE'
    | 'INVALID_PARENT';
  message: string;
  relatedCapabilityId?: string;
  relatedSnapshotId?: string;
}

export interface CapabilityRollupChildSummary {
  capabilityId: string;
  capabilityName: string;
  capabilityKind: CapabilityKind;
  collectionKind?: CapabilityCollectionKind;
  latestPublishedVersion?: number;
  latestPublishedAt?: string;
  dependencyCount: number;
  warningCount: number;
}

export interface CapabilityRollupSummary {
  capabilityId: string;
  directChildCount: number;
  sharedCapabilityCount: number;
  descendantCount: number;
  dependencyCount: number;
  latestPublishedVersion?: number;
  latestPublishedAt?: string;
  missingPublishCount: number;
  stalePublishCount: number;
  unresolvedDependencyCount: number;
  versionMismatchCount: number;
  directChildren: CapabilityRollupChildSummary[];
  sharedCapabilities: CapabilityRollupChildSummary[];
  warnings: CapabilityRollupWarning[];
  dependencyHeatmap: Array<{
    targetCapabilityId: string;
    targetCapabilityName?: string;
    count: number;
    criticality: CapabilityDependencyCriticality;
  }>;
  functionalRequirementCount: number;
  nonFunctionalRequirementCount: number;
  apiContractCount: number;
  softwareVersionCount: number;
}

export interface CapabilityHierarchyNode {
  capabilityId: string;
  name: string;
  capabilityKind: CapabilityKind;
  collectionKind?: CapabilityCollectionKind;
  parentCapabilityId?: string;
  childIds: string[];
  sharedCapabilityIds: string[];
  depth: number;
  pathIds: string[];
  pathLabels: string[];
  latestPublishedVersion?: number;
  warningCount: number;
}

export interface CapabilityAlmExportPayload {
  capabilityId: string;
  capabilityName: string;
  capabilityKind: CapabilityKind;
  collectionKind?: CapabilityCollectionKind;
  hierarchy: CapabilityHierarchyNode;
  latestPublishedSnapshot?: CapabilityPublishedSnapshot;
  dependencies: CapabilityDependency[];
  rollupSummary: CapabilityRollupSummary;
}

export interface CapabilityArchitectureSnapshot {
  capability: Capability;
  hierarchy: CapabilityHierarchyNode;
  rollupSummary?: CapabilityRollupSummary;
  relatedCapabilities: Capability[];
}

export interface Capability {
  id: string;
  name: string;
  description: string;
  domain?: string;
  parentCapabilityId?: string;
  capabilityKind?: CapabilityKind;
  collectionKind?: CapabilityCollectionKind;
  businessUnit?: string;
  ownerTeam?: string;
  businessOutcome?: string;
  successMetrics: string[];
  definitionOfDone?: string;
  requiredEvidenceKinds: string[];
  operatingPolicySummary?: string;
  confluenceLink?: string;
  jiraBoardLink?: string;
  documentationNotes?: string;
  applications: string[];
  apis: string[];
  databases: string[];
  databaseConfigs?: CapabilityDatabaseConfig[];
  gitRepositories: string[];
  localDirectories: string[];
  repositories?: CapabilityRepository[];
  teamNames: string[];
  stakeholders: CapabilityStakeholder[];
  additionalMetadata: CapabilityMetadataEntry[];
  dependencies?: CapabilityDependency[];
  sharedCapabilities?: CapabilitySharedReference[];
  contractDraft?: CapabilityContractDraft;
  publishedSnapshots?: CapabilityPublishedSnapshot[];
  parentPublishedSnapshot?: CapabilityPublishedSnapshot;
  parentExpectationSummary?: string[];
  rollupSummary?: CapabilityRollupSummary;
  hierarchyNode?: CapabilityHierarchyNode;
  lifecycle: CapabilityLifecycle;
  phaseOwnershipRules?: CapabilityPhaseOwnershipRule[];
  executionConfig: CapabilityExecutionConfig;
  status: Status;
  specialAgentId?: string;
  isSystemCapability?: boolean;
  systemCapabilityRole?: CapabilitySystemRole;
  skillLibrary: Skill[];
  effectivePermissions?: EffectivePermissionSet;
}

export interface AgentUsage {
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  lastRunAt?: string;
}

export interface AgentOutputRecord {
  id: string;
  title: string;
  summary: string;
  timestamp: string;
  status: 'completed' | 'pending';
  relatedTaskId?: string;
  artifactId?: string;
}

export type AgentLearningStatus =
  | 'NOT_STARTED'
  | 'QUEUED'
  | 'LEARNING'
  | 'READY'
  | 'STALE'
  | 'ERROR'
  // Slice B — candidate version failed shape checks (or its judge score is
  // still being computed). Prior version keeps serving inference.
  | 'REVIEW_PENDING';

export type AgentSessionScope = 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';

export interface AgentLearningProfile {
  status: AgentLearningStatus;
  summary: string;
  highlights: string[];
  contextBlock: string;
  sourceDocumentIds: string[];
  sourceArtifactIds: string[];
  sourceCount: number;
  refreshedAt?: string;
  lastRequestedAt?: string;
  lastError?: string;
  currentVersionId?: string;
  previousVersionId?: string;
  // Slice C — canary + drift-detection state for the currently-live version.
  // Reset on every pointer flip. Undefined on rows that predate the Slice C
  // migration (treated as "no canary data yet").
  canaryStartedAt?: string;
  canaryRequestCount?: number;
  canaryNegativeCount?: number;
  driftFlaggedAt?: string;
  driftReason?: string;
  driftRegressionStreak?: number;
  driftLastCheckedAt?: string;
}

/**
 * Immutable snapshot of what the agent learned at a specific moment. Rows
 * here are append-only; the live profile stores a pointer at
 * `currentVersionId`. Slice A produces rows with `READY` status; Slice B/C
 * will extend the shape with judge/shape reports and drift state.
 */
export interface AgentLearningProfileVersion {
  versionId: string;
  capabilityId: string;
  agentId: string;
  versionNo: number;
  status: AgentLearningStatus;
  summary: string;
  highlights: string[];
  contextBlock: string;
  sourceDocumentIds: string[];
  sourceArtifactIds: string[];
  sourceCount: number;
  contextBlockTokens?: number;
  judgeScore?: number;
  judgeReport?: unknown;
  shapeReport?: unknown;
  createdByUpdateId?: string;
  notes?: string;
  createdAt: string;
  // Slice C — canary counters captured when this version was replaced by
  // a successor. Only populated on outgoing (replaced) versions; the
  // currently-live version's counters live on the profile row.
  frozenRequestCount?: number;
  frozenNegativeCount?: number;
  frozenAt?: string;
}

export interface AgentLearningDriftState {
  currentVersionId?: string;
  previousVersionId?: string;
  canaryStartedAt?: string;
  canaryRequestCount: number;
  canaryNegativeCount: number;
  canaryNegativeRate: number;
  baselineRequestCount?: number;
  baselineNegativeCount?: number;
  baselineNegativeRate?: number;
  negativeRateDelta?: number;
  regressionStreak: number;
  driftFlaggedAt?: string;
  driftReason?: string;
  lastCheckedAt?: string;
  /**
   * Convenience flag for the UI — true when drift has been flagged AND
   * not yet cleared (either by operator revert or the next successful
   * flip).
   */
  isFlagged: boolean;
}

export interface AgentLearningVersionDiff {
  fromVersionId: string;
  toVersionId: string;
  summaryBefore: string;
  summaryAfter: string;
  highlightsAdded: string[];
  highlightsRemoved: string[];
  sourceDocumentsAdded: string[];
  sourceDocumentsRemoved: string[];
  contextBlockTokenDelta?: number;
}

export interface AgentSessionSummary {
  sessionId: string;
  scope: AgentSessionScope;
  scopeId?: string;
  lastUsedAt: string;
  model: string;
  requestCount: number;
  totalTokens: number;
}

export interface CopilotSessionMonitorEntry {
  sessionId: string;
  agentId?: string;
  agentName: string;
  scope: AgentSessionScope;
  scopeId?: string;
  lastUsedAt: string;
  createdAt?: string;
  model: string;
  requestCount: number;
  totalTokens: number;
  live: boolean;
  resumable: boolean;
  state: 'ACTIVE' | 'STORED';
}

export interface CopilotSessionMonitorSnapshot {
  capabilityId: string;
  runtime: {
    configured: boolean;
    provider: string;
    runtimeAccessMode?: 'copilot-session' | 'headless-cli' | 'http-fallback' | 'unconfigured';
    httpFallbackEnabled?: boolean;
    tokenSource: string | null;
    defaultModel: string;
    githubIdentity?: {
      login: string;
      name?: string;
    } | null;
    activeManagedSessions: number;
  };
  summary: {
    activeSessionCount: number;
    storedSessionCount: number;
    resumableSessionCount: number;
    totalTokens: number;
    generalChatCount: number;
    workItemCount: number;
    taskCount: number;
  };
  sessions: CopilotSessionMonitorEntry[];
}

export interface AgentLearningProfileDetail {
  capabilityId: string;
  agentId: string;
  profile: AgentLearningProfile;
  documents: MemoryDocument[];
  sessions: AgentSessionSummary[];
}

export type AgentKnowledgeFreshness =
  | 'FRESH'
  | 'ACTIVE'
  | 'STALE'
  | 'NOT_STARTED'
  | 'ERROR';

export type AgentKnowledgeConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type AgentUserVisibility = 'PRIMARY_COPILOT' | 'SPECIALIST' | 'BACKGROUND';
export type CapabilityRuntimeOwner = 'DESKTOP' | 'SERVER';

export interface AgentRolePolicy {
  summary: string;
  allowedToolIds: ToolAdapterId[];
  escalationTriggers: string[];
}

export interface AgentMemoryScope {
  summary: string;
  scopeLabels: string[];
}

export interface AgentQualityBar {
  label: string;
  summary: string;
  checklist: string[];
}

export interface AgentEvalProfile {
  label: string;
  summary: string;
  criteria: string[];
}

export interface LearningDelta {
  id: string;
  timestamp: string;
  triggerType?: LearningUpdate['triggerType'];
  insight: string;
  sourceLogIds: string[];
  relatedWorkItemId?: string;
  relatedRunId?: string;
}

export interface KnowledgeSourceSummary {
  id: string;
  kind: 'SKILL' | 'METADATA' | 'ARTIFACT' | 'LEARNING' | 'SESSION';
  label: string;
  summary?: string;
  linkedArtifactId?: string;
  freshnessSignal?: string;
  confidenceSignal?: string;
}

export interface AgentKnowledgeLens {
  agentId: string;
  summary: string;
  freshnessSignal: AgentKnowledgeFreshness;
  confidenceSignal: AgentKnowledgeConfidence;
  baseRoleKnowledge: string[];
  capabilityKnowledge: string[];
  liveExecutionLearning: string[];
  provenance: KnowledgeSourceSummary[];
  deltas: LearningDelta[];
  contextBlock?: string;
  /**
   * Slice D — when the background pipeline fails (LLM parse error, memory
   * refresh failure, etc.) the live profile row carries `lastError`. We
   * expose it on the lens so the UI shows an error chip even before the
   * operator expands the version-history disclosure.
   */
  lastError?: string;
  /**
   * Slice D — status of the live profile row. `REVIEW_PENDING` specifically
   * means a candidate version was committed but the pointer was held steady;
   * the UI surfaces this as "Previous version still serving".
   */
  profileStatus?: AgentLearningStatus;
}

export interface CapabilityAgent {
  id: string;
  capabilityId: string;
  name: string;
  role: string;
  roleStarterKey?: AgentRoleStarterKey;
  objective: string;
  systemPrompt: string;
  contract: AgentOperatingContract;
  initializationStatus: 'NOT_STARTED' | 'READY';
  documentationSources: string[];
  inputArtifacts: string[];
  outputArtifacts: string[];
  isOwner?: boolean;
  isBuiltIn?: boolean;
  standardTemplateKey?: string;
  learningNotes?: string[];
  skillIds: string[];
  preferredToolIds?: ToolAdapterId[];
  provider: string;
  providerKey?: ProviderKey;
  embeddingProviderKey?: EmbeddingProviderKey;
  model: string;
  tokenLimit: number;
  usage: AgentUsage;
  previousOutputs: AgentOutputRecord[];
  learningProfile: AgentLearningProfile;
  sessionSummaries: AgentSessionSummary[];
  rolePolicy?: AgentRolePolicy;
  memoryScope?: AgentMemoryScope;
  qualityBar?: AgentQualityBar;
  evalProfile?: AgentEvalProfile;
  userVisibility?: AgentUserVisibility;
}

export interface CapabilityChatMessage {
  id: string;
  capabilityId: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  agentId?: string;
  agentName?: string;
  traceId?: string;
  model?: string;
  sessionId?: string;
  sessionScope?: AgentSessionScope;
  sessionScopeId?: string;
  workItemId?: string;
  runId?: string;
  workflowStepId?: string;
}

export interface WorkPackage {
  id: string;
  blueprint: string;
  capabilityId: string;
  status: Status;
  owner: {
    name: string;
    avatar?: string;
  };
}

export interface AgentTask {
  id: string;
  title: string;
  agent: string;
  capabilityId: string;
  taskSubtype?: 'WORKFLOW' | 'DELEGATED_RUN';
  workItemId?: string;
  workflowId?: string;
  workflowStepId?: string;
  managedByWorkflow?: boolean;
  taskType?: 'DELIVERY' | 'TEST' | 'APPROVAL' | 'GOVERNANCE';
  phase?: WorkItemPhase;
  priority: 'High' | 'Med' | 'Low';
  status: Status;
  timestamp: string;
  prompt?: string;
  executionNotes?: string;
  runId?: string;
  runStepId?: string;
  parentTaskId?: string;
  parentRunId?: string;
  parentRunStepId?: string;
  delegatedAgentId?: string;
  handoffPacketId?: string;
  toolInvocationId?: string;
  linkedArtifacts?: { name: string; size: string; type: 'table' | 'scale' | 'file' }[];
  producedOutputs?: {
    name: string;
    status: 'completed' | 'pending';
    downloadUrl?: string;
    artifactId?: string;
    runId?: string;
    runStepId?: string;
  }[];
}

export interface Blueprint {
  id: string;
  title: string;
  capabilityId: string;
  description: string;
  version: string;
  activeIds: number;
  status: Status;
  type: string;
}

export type ArtifactKind =
  | 'PHASE_OUTPUT'
  | 'CODE_DIFF'
  // CODE_PATCH is a unified-diff artifact that is *applicable* — the
  // agent produced it intending it to become a commit. Distinct from
  // CODE_DIFF (which is a read-only snapshot for comparison).
  | 'CODE_PATCH'
  | 'HANDOFF_PACKET'
  | 'DELEGATION_RESULT'
  | 'EVIDENCE_PACKET'
  | 'LEARNING_NOTE'
  | 'APPROVAL_RECORD'
  | 'UPLOAD'
  | 'INPUT_NOTE'
  | 'STAGE_CONTROL_NOTE'
  | 'CONFLICT_RESOLUTION'
  | 'CONTRARIAN_REVIEW'
  | 'EXECUTION_PLAN'
  | 'REVIEW_PACKET'
  | 'EXECUTION_SUMMARY';

export type ArtifactContentFormat = 'TEXT' | 'MARKDOWN' | 'JSON' | 'BINARY';

export type ArtifactTemplateSectionType =
  | 'FREE_TEXT'
  | 'DECISION_BOX'
  | 'CHANGE_LOG'
  | 'LEARNING_RECORD'
  | 'CHECKLIST'
  | 'CUSTOM';

export interface ArtifactTemplateSection {
  id: string;
  title: string;
  type: ArtifactTemplateSectionType;
  required: boolean;
  content?: string;
}

export interface Artifact {
  id: string;
  name: string;
  capabilityId: string;
  type: string;
  inputs?: string[];
  version: string;
  agent: string;
  created: string;
  template?: string;
  templateSections?: ArtifactTemplateSection[];
  documentationStatus?: 'PENDING' | 'SYNCED' | 'FAILED';
  isLearningArtifact?: boolean;
  isMasterArtifact?: boolean;
  decisions?: string[];
  changes?: string[];
  learningInsights?: string[];
  governanceRules?: string[];
  description?: string;
  direction?: 'INPUT' | 'OUTPUT';
  connectedAgentId?: string;
  sourceWorkflowId?: string;
  runId?: string;
  runStepId?: string;
  toolInvocationId?: string;
  summary?: string;
  artifactKind?: ArtifactKind;
  phase?: WorkItemPhase;
  workItemId?: string;
  sourceRunId?: string;
  sourceRunStepId?: string;
  sourceWaitId?: string;
  handoffFromAgentId?: string;
  handoffToAgentId?: string;
  contentFormat?: ArtifactContentFormat;
  mimeType?: string;
  fileName?: string;
  contentText?: string;
  contentJson?: Record<string, any> | any[];
  downloadable?: boolean;
  traceId?: string;
  latencyMs?: number;
  costUsd?: number;
  policyDecisionId?: string;
  retrievalReferences?: MemoryReference[];
}

export type WorkItemPhase = WorkflowPhaseId;

export type WorkflowStepType =
  | 'DELIVERY'
  | 'GOVERNANCE_GATE'
  | 'HUMAN_APPROVAL'
  // BUILD is a step whose contractual output is a CODE_PATCH artifact:
  // the agent is expected to produce an applicable unified diff, which
  // downstream Phase-C wiring can turn into a branch + commit + PR.
  | 'BUILD';

// ─────────────────────────────────────────────────────────────────────
// Code patch payloads — the structured side of a CODE_PATCH artifact.
//
// The raw unified-diff body lives in `Artifact.contentText`; this
// `CodePatchPayload` shape is persisted in `Artifact.contentJson` so
// viewers don't have to re-parse the diff every render and server-side
// validators/appliers can read stats without touching the string body.
// ─────────────────────────────────────────────────────────────────────

/** Per-file hunk stats extracted by the unified-diff parser. */
export interface CodePatchFileStat {
  /** New-side path (the `+++ b/...` side). Empty for pure deletions. */
  path: string;
  /** Old-side path (the `--- a/...` side). Empty for pure additions. */
  oldPath?: string;
  status: 'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED';
  additions: number;
  deletions: number;
  hunkCount: number;
  /** True if this file's diff chunk is marked as binary — we don't apply those. */
  isBinary?: boolean;
}

/** Structured metadata that accompanies a CODE_PATCH artifact. */
export interface CodePatchPayload {
  /** Target repo/branch the patch is meant to apply against. */
  repositoryId?: string;
  repositoryLabel?: string;
  baseSha?: string;
  targetBranch?: string;
  /** Per-file rollup so the UI can render a summary without re-parsing. */
  files: CodePatchFileStat[];
  totalAdditions: number;
  totalDeletions: number;
  /** Result of running `validatePatch()` server-side at ingest time. */
  validation?: {
    ok: boolean;
    errors: string[];
    warnings: string[];
  };
  /** Optional human-readable summary for surfacing in approval rails. */
  summary?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Agent-as-git-author (Phase C).
//
// Persistence shapes for the agent's long-lived branch session + any
// PRs it opens from that branch. The workflow is:
//   1. Operator (or automation) calls `startAgentBranchSession` for a
//      work item — we create `wi/<workItemId>-<slug>` anchored at the
//      repo's default branch.
//   2. Agent emits CODE_PATCH artifacts (see `CodePatchPayload`); each
//      one is appended as a commit via `commitPatchToBranch`.
//   3. Operator clicks "Open PR" — we record the PR row and flip the
//      session into REVIEWING state.
// ─────────────────────────────────────────────────────────────────────

export type AgentBranchSessionStatus = 'ACTIVE' | 'REVIEWING' | 'CLOSED' | 'FAILED';

export interface AgentBranchSession {
  id: string;
  capabilityId: string;
  workItemId: string;
  repositoryId: string;
  repositoryUrl: string;
  baseBranch: string;
  baseSha: string;
  branchName: string;
  /** Current tip of the session branch. Null until the first commit lands. */
  headSha: string | null;
  status: AgentBranchSessionStatus;
  commitsCount: number;
  lastCommitMessage: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AgentPullRequestState = 'OPEN' | 'MERGED' | 'CLOSED';

export interface AgentPullRequest {
  id: string;
  sessionId: string;
  capabilityId: string;
  workItemId: string;
  repositoryId: string;
  prNumber: number;
  prUrl: string;
  htmlUrl: string;
  state: AgentPullRequestState;
  isDraft: boolean;
  title: string;
  body: string;
  openedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  lastSyncedAt: string;
}

/**
 * Per-file result of applying a CODE_PATCH to a session branch —
 * returned alongside the commit SHA so the UI can render "3 files
 * committed, 1 skipped (binary)".
 */
export interface AgentBranchCommitFileStatus {
  path: string;
  status: 'CLEAN' | 'CREATED' | 'DELETED' | 'CONFLICT' | 'BINARY_SKIPPED' | 'MISSING_ORIGINAL';
  applied: boolean;
  reason?: string;
}

export interface AgentBranchCommitResult {
  session: AgentBranchSession;
  commitSha: string;
  treeSha: string;
  files: AgentBranchCommitFileStatus[];
  filesCommittedCount: number;
  filesSkippedCount: number;
}

export interface AgentBounty {
  id: string;
  capabilityId: string;
  sourceAgentId: string;
  targetRole?: string;
  instructions: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'FAILED';
  createdAt: string;
  timeoutMs?: number;
}

export interface AgentBountySignal {
  bountyId: string;
  status: 'RESOLVED' | 'FAILED';
  resultSummary?: string;
  detailPayload?: Record<string, any>;
  resolvedByAgentId?: string;
  resolvedAt: string;
}

export type ToolAdapterId =
  | 'workspace_list'
  | 'workspace_read'
  | 'workspace_search'
  | 'git_status'
  | 'workspace_write'
  | 'workspace_replace_block'
  | 'workspace_apply_patch'
  | 'delegate_task'
  | 'publish_bounty'
  | 'resolve_bounty'
  | 'wait_for_signal'
  | 'run_build'
  | 'run_test'
  | 'run_docs'
  | 'run_deploy';

export type WorkflowNodeType =
  | 'START'
  | 'DELIVERY'
  | 'EVENT'
  | 'ALERT'
  | 'GOVERNANCE_GATE'
  | 'HUMAN_APPROVAL'
  | 'DECISION'
  | 'PARALLEL_SPLIT'
  | 'PARALLEL_JOIN'
  | 'RELEASE'
  | 'END'
  | 'EXTRACT'
  | 'TRANSFORM'
  | 'LOAD'
  | 'FILTER';

export interface WorkflowNodeEtlConfig {
  subType?: string;
  connectionId?: string;
  sourceTable?: string;
  sourceQuery?: string;
  targetTable?: string;
  writeMode?: 'APPEND' | 'OVERWRITE' | 'UPSERT';
  filterExpression?: string;
  mappingRules?: string;
  joinType?: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';
  joinKey?: string;
  aggregateFunction?: string;
  schemaHint?: string;
}

export type WorkflowEventTrigger = 'ON_ENTER' | 'ON_SUCCESS' | 'ON_FAILURE';

export interface WorkflowEventConfig {
  eventName?: string;
  eventSource?: string;
  trigger?: WorkflowEventTrigger;
  payloadTemplate?: string;
}

export type WorkflowAlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface WorkflowAlertConfig {
  severity?: WorkflowAlertSeverity;
  channel?: string;
  notifyRoles?: string[];
  messageTemplate?: string;
  requiresAcknowledgement?: boolean;
}

export type WorkflowPublishState = 'DRAFT' | 'VALIDATED' | 'PUBLISHED';

export type WorkflowEdgeConditionType =
  | 'DEFAULT'
  | 'SUCCESS'
  | 'FAILURE'
  | 'APPROVED'
  | 'REJECTED'
  | 'PARALLEL'
  | 'CUSTOM';

export interface WorkflowGraphLayout {
  x: number;
  y: number;
}

export interface WorkflowArtifactContract {
  requiredInputs?: string[];
  expectedOutputs?: string[];
  notes?: string;
}

export type ApprovalRuleTarget = 'USER' | 'TEAM' | 'CAPABILITY_ROLE';
export type ApprovalMode = 'ANY_ONE' | 'ALL_REQUIRED' | 'QUORUM';

export interface ApprovalPolicyTarget {
  targetType: ApprovalRuleTarget;
  targetId: string;
  label?: string;
}

export interface ApprovalPolicy {
  id: string;
  name: string;
  description?: string;
  mode: ApprovalMode;
  targets: ApprovalPolicyTarget[];
  minimumApprovals?: number;
  delegationAllowed: boolean;
  dueAt?: string;
  escalationAfterMinutes?: number;
}

export interface WorkflowStepOwnershipRule {
  primaryOwnerTeamId?: string;
  secondaryOwnerTeamIds: string[];
  approvalTeamIds: string[];
  escalationTeamIds: string[];
  requireHandoffAcceptance?: boolean;
}

export type RequiredInputFieldSource =
  | 'WORK_ITEM'
  | 'CAPABILITY'
  | 'WORKSPACE'
  | 'HANDOFF'
  | 'ARTIFACT'
  | 'HUMAN_INPUT'
  | 'RUNTIME';

export type RequiredInputFieldKind =
  | 'TEXT'
  | 'MARKDOWN'
  | 'PATH'
  | 'ARTIFACT'
  | 'CONTEXT';

export interface RequiredInputField {
  id: string;
  label: string;
  description?: string;
  required: boolean;
  source: RequiredInputFieldSource;
  kind: RequiredInputFieldKind;
  valueHint?: string;
}

export interface CompiledRequiredInputField extends RequiredInputField {
  status: 'READY' | 'MISSING';
  valueSummary?: string;
}

export interface CompiledArtifactChecklistItem {
  id: string;
  label: string;
  direction: 'INPUT' | 'OUTPUT';
  status: 'READY' | 'EXPECTED';
  description?: string;
}

export interface ExecutionBoundary {
  allowedToolIds: ToolAdapterId[];
  workspaceMode: 'NONE' | 'READ_ONLY' | 'APPROVED_WRITE';
  requiresHumanApproval: boolean;
  escalationTriggers: string[];
}

export interface CompiledStepOwnership {
  phaseOwnerTeamId?: string;
  stepOwnerTeamId?: string;
  approvalTeamIds: string[];
  escalationTeamIds: string[];
  requireHandoffAcceptance: boolean;
}

export interface CompiledStepContext {
  compiledAt: string;
  stepId: string;
  stepName: string;
  phase: WorkItemPhase;
  stepType: WorkflowStepType;
  objective: string;
  description?: string;
  executionNotes?: string;
  preferredWorkspacePath?: string;
  executionBoundary: ExecutionBoundary;
  requiredInputs: CompiledRequiredInputField[];
  missingInputs: CompiledRequiredInputField[];
  artifactChecklist: CompiledArtifactChecklistItem[];
  agentSuggestedInputs: AgentArtifactExpectation[];
  agentExpectedOutputs: AgentArtifactExpectation[];
  completionChecklist: string[];
  memoryBoundary: string[];
  nextActions: string[];
  ownership?: CompiledStepOwnership;
  handoffContext?: string;
  resolvedWaitContext?: string;
}

export interface CompiledWorkItemPlanStepSummary {
  stepId: string;
  name: string;
  phase: WorkItemPhase;
  stepType: WorkflowStepType;
  agentId: string;
}

export interface CompiledWorkItemPlan {
  compiledAt: string;
  workItemId: string;
  workflowId: string;
  workflowName: string;
  currentPhase: WorkItemPhase;
  currentStepId: string;
  currentStepName: string;
  lifecyclePhases: WorkItemPhase[];
  planSummary: string;
  stepSequence: CompiledWorkItemPlanStepSummary[];
  currentStep: CompiledStepContext;
}

export interface WorkflowNode {
  id: string;
  name: string;
  type: WorkflowNodeType;
  phase: WorkItemPhase;
  layout: WorkflowGraphLayout;
  agentId?: string;
  action?: string;
  description?: string;
  inputArtifactId?: string;
  outputArtifactId?: string;
  governanceGate?: string;
  approverRoles?: string[];
  exitCriteria?: string[];
  templatePath?: string;
  allowedToolIds?: ToolAdapterId[];
  preferredWorkspacePath?: string;
  executionNotes?: string;
  etlConfig?: WorkflowNodeEtlConfig;
  eventConfig?: WorkflowEventConfig;
  alertConfig?: WorkflowAlertConfig;
  artifactContract?: WorkflowArtifactContract;
  approvalPolicy?: ApprovalPolicy;
  ownershipRule?: WorkflowStepOwnershipRule;
  requiredInputs?: RequiredInputField[];
  completionGates?: string[];
  executionBoundary?: Partial<ExecutionBoundary>;
}

export interface WorkflowEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  label?: string;
  conditionType: WorkflowEdgeConditionType;
  handoffProtocolId?: string;
  artifactContract?: WorkflowArtifactContract;
  branchKey?: string;
}

export interface WorkflowHandoffProtocol {
  id: string;
  name: string;
  sourceStepId: string;
  sourceNodeId?: string;
  targetAgentId?: string;
  targetPhase?: WorkItemPhase;
  description?: string;
  rules: string[];
  validationRequired: boolean;
  autoDocumentation: boolean;
}

export interface WorkflowStep {
  id: string;
  name: string;
  phase: WorkItemPhase;
  stepType: WorkflowStepType;
  agentId: string;
  action: string;
  description?: string;
  inputArtifactId?: string;
  outputArtifactId?: string;
  handoffToAgentId?: string;
  handoffToPhase?: WorkItemPhase;
  handoffLabel?: string;
  handoffProtocolId?: string;
  governanceGate?: string;
  approverRoles?: string[];
  exitCriteria?: string[];
  templatePath?: string;
  allowedToolIds?: ToolAdapterId[];
  preferredWorkspacePath?: string;
  executionNotes?: string;
  artifactContract?: WorkflowArtifactContract;
  approvalPolicy?: ApprovalPolicy;
  ownershipRule?: WorkflowStepOwnershipRule;
  requiredInputs?: RequiredInputField[];
  completionGates?: string[];
  executionBoundary?: Partial<ExecutionBoundary>;
}

export interface Workflow {
  id: string;
  name: string;
  capabilityId: string;
  templateId?: string;
  schemaVersion?: number;
  entryNodeId?: string;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
  steps: WorkflowStep[];
  handoffProtocols?: WorkflowHandoffProtocol[];
  publishState?: WorkflowPublishState;
  status: Status;
  workflowType?: 'SDLC' | 'Operational' | 'Governance' | 'Custom';
  scope?: 'CAPABILITY' | 'GLOBAL';
  summary?: string;
  archivedAt?: string;
}

export interface ExecutionLog {
  id: string;
  taskId: string;
  capabilityId: string;
  agentId: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  runId?: string;
  runStepId?: string;
  toolInvocationId?: string;
  traceId?: string;
  latencyMs?: number;
  costUsd?: number;
  metadata?: Record<string, any>;
}

export interface CapabilityBriefingSection {
  id: string;
  label: string;
  summary: string;
  items: string[];
  tone?: 'brand' | 'info' | 'warning' | 'neutral';
}

export interface CapabilityBriefing {
  capabilityId: string;
  title: string;
  purpose: string;
  outcome: string;
  capabilityKind?: CapabilityKind;
  collectionKind?: CapabilityCollectionKind;
  definitionOfDone?: string;
  ownerTeam?: string;
  hierarchyLabel?: string;
  parentCapabilityName?: string;
  latestPublishedVersion?: number;
  stakeholderSummary: string[];
  linkedSystems: string[];
  repoSummary: string[];
  activeConstraints: string[];
  evidencePriorities: string[];
  dependencySummary: string[];
  parentExpectations: string[];
  sections: CapabilityBriefingSection[];
}

export type CapabilityInteractionType =
  | 'CHAT'
  | 'TOOL'
  | 'RUN_EVENT'
  | 'WAIT'
  | 'APPROVAL'
  | 'LEARNING'
  | 'ARTIFACT'
  | 'TASK';

export interface CapabilityInteractionRecord {
  id: string;
  capabilityId: string;
  interactionType: CapabilityInteractionType;
  timestamp: string;
  title: string;
  summary: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' | 'NEUTRAL';
  actorLabel?: string;
  agentId?: string;
  agentName?: string;
  workItemId?: string;
  runId?: string;
  runStepId?: string;
  workflowStepId?: string;
  traceId?: string;
  toolId?: ToolAdapterId;
  sessionId?: string;
  sessionScope?: AgentSessionScope;
  sessionScopeId?: string;
  artifactIds?: string[];
  linkedArtifactId?: string;
  metadata?: Record<string, any>;
}

export interface CapabilityInteractionFeed {
  capabilityId: string;
  scope: 'CAPABILITY' | 'WORK_ITEM';
  scopeId?: string;
  generatedAt: string;
  records: CapabilityInteractionRecord[];
  summary: {
    totalCount: number;
    chatCount: number;
    toolCount: number;
    waitCount: number;
    approvalCount: number;
    learningCount: number;
    artifactCount: number;
    taskCount: number;
  };
}

export type ReadinessGateId =
  | 'OWNER_ASSIGNED'
  | 'OUTCOME_CONTRACT_COMPLETE'
  | 'SOURCE_CONTEXT_CONNECTED'
  | 'APPROVED_WORKSPACE_PRESENT'
  | 'WORKFLOW_VALID_AND_PUBLISHED'
  | 'EXECUTION_RUNTIME_READY';

export interface ReadinessGate {
  id: ReadinessGateId;
  label: string;
  satisfied: boolean;
  summary: string;
  blockingReason?: string;
  actionLabel: string;
  path: string;
  nextRequiredAction?: string;
}

export interface ReadinessContract {
  capabilityId: string;
  generatedAt: string;
  allReady: boolean;
  summary: string;
  nextRequiredAction?: string;
  gates: ReadinessGate[];
}

export type GoldenPathStepStatus = 'COMPLETE' | 'CURRENT' | 'UP_NEXT' | 'BLOCKED';

export interface GoldenPathStep {
  id: string;
  label: string;
  description: string;
  status: GoldenPathStepStatus;
  path: string;
}

export interface GoldenPathProgress {
  completedCount: number;
  totalCount: number;
  percentComplete: number;
  currentStepId?: string;
  summary: string;
  steps: GoldenPathStep[];
}

export interface LearningUpdate {
  id: string;
  capabilityId: string;
  agentId: string;
  sourceLogIds: string[];
  insight: string;
  skillUpdate?: string;
  timestamp: string;
  triggerType?:
    | 'INITIALIZATION'
    | 'REQUEST_CHANGES'
    | 'GUIDANCE'
    | 'STAGE_CONTROL'
    | 'CONFLICT_RESOLUTION'
    | 'EXPERIENCE_DISTILLATION'
    | 'INCIDENT_DERIVED'
    | 'USER_CORRECTION'
    | 'MANUAL_REFRESH'
    | 'SKILL_CHANGE'
    // Reserved for later slices of the self-learning robustness upgrade:
    // Slice D (PIPELINE_ERROR), Slice E (PREVIEW_REQUESTED),
    // Slice C (DRIFT_FLAGGED), Slice A (VERSION_REVERTED).
    | 'PIPELINE_ERROR'
    | 'PREVIEW_REQUESTED'
    | 'DRIFT_FLAGGED'
    | 'VERSION_REVERTED'
    // Slice 3 — the agent-learning timeline picks up governance-exception
    // decisions so exception approvals / denials / revocations appear on the
    // same audit thread as corrections and drift events.
    | 'GOVERNANCE_EXCEPTION';
  relatedWorkItemId?: string;
  relatedRunId?: string;
}

export type WorkItemStatus =
  | 'ACTIVE'
  | 'BLOCKED'
  | 'PAUSED'
  | 'PENDING_APPROVAL'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'ARCHIVED';

export type ExecutionDispatchState =
  | 'UNASSIGNED'
  | 'WAITING_FOR_EXECUTOR'
  | 'ASSIGNED'
  | 'STALE_EXECUTOR';

export type WorkflowRunQueueReason =
  | 'WAITING_FOR_EXECUTOR'
  | 'EXECUTOR_DISCONNECTED'
  | 'EXECUTOR_RELEASED'
  | 'MANUAL_REQUEUE';

export type ExecutorHeartbeatStatus = 'FRESH' | 'STALE' | 'OFFLINE';

export interface DesktopExecutorRegistration {
  id: string;
  actorUserId?: string;
  actorDisplayName: string;
  actorTeamIds: string[];
  ownedCapabilityIds: string[];
  approvedWorkspaceRoots: Record<string, string[]>;
  heartbeatStatus: ExecutorHeartbeatStatus;
  heartbeatAt: string;
  createdAt: string;
  updatedAt: string;
  runtimeSummary?: {
    provider?: string;
    endpoint?: string;
    defaultModel?: string;
    runtimeAccessMode?: string;
  };
}

export interface ExecutorRegistryCapabilitySummary {
  capabilityId: string;
  capabilityName: string;
  approvedWorkspaceRoots: string[];
  activeRunCount: number;
  queuedRunCount: number;
}

export interface ExecutorRegistryEntry {
  registration: DesktopExecutorRegistration;
  runAssignmentCount: number;
  ownedCapabilities: ExecutorRegistryCapabilitySummary[];
}

export interface ExecutorRegistrySummary {
  generatedAt: string;
  entries: ExecutorRegistryEntry[];
  activeCount: number;
  staleCount: number;
  disconnectedCount: number;
}

export interface CapabilityExecutionOwnership {
  capabilityId: string;
  executorId: string;
  actorUserId?: string;
  actorDisplayName: string;
  actorTeamIds: string[];
  approvedWorkspaceRoots: string[];
  heartbeatStatus: ExecutorHeartbeatStatus;
  claimedAt: string;
  heartbeatAt: string;
  updatedAt: string;
}

export interface WorkspaceWriteLock {
  runStepId: string;
  runId: string;
  agentId: string;
  stepName: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface WorkItemPendingRequest {
  type: 'APPROVAL' | 'INPUT' | 'CONFLICT_RESOLUTION';
  message: string;
  requestedBy: string;
  timestamp: string;
}

export interface WorkItemBlocker {
  type: 'CONFLICT_RESOLUTION' | 'HUMAN_INPUT' | 'APPROVAL';
  message: string;
  requestedBy: string;
  timestamp: string;
  status: 'OPEN' | 'RESOLVED';
  resolution?: string;
}

export interface WorkItemHistoryEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  detail: string;
  phase?: WorkItemPhase;
  status?: WorkItemStatus;
}

export type WorkItemTaskType =
  | 'GENERAL'
  | 'STRATEGIC_INITIATIVE'
  | 'NEW_BUSINESS_CASE'
  | 'FEATURE_ENHANCEMENT'
  | 'PRODUCTION_ISSUE'
  | 'BUGFIX'
  | 'SECURITY_FINDING'
  | 'REHYDRATION';

export interface WorkItemRepositoryAssignment {
  workItemId: string;
  repositoryId: string;
  role: 'PRIMARY' | 'SUPPORTING';
  checkoutRequired: boolean;
}

export interface WorkItemBranch {
  id: string;
  workItemId: string;
  repositoryId: string;
  baseBranch: string;
  sharedBranch: string;
  createdByUserId?: string;
  createdAt: string;
  headSha?: string;
  linkedPrUrl?: string;
  status: 'NOT_CREATED' | 'ACTIVE' | 'MERGED' | 'ABANDONED';
}

export interface WorkItemExecutionContext {
  workItemId: string;
  primaryRepositoryId?: string;
  repositoryAssignments: WorkItemRepositoryAssignment[];
  branch?: WorkItemBranch;
  activeWriterUserId?: string;
  claimExpiresAt?: string;
  strategy: 'SHARED_BRANCH';
}

export interface WorkItemCodeClaim {
  workItemId: string;
  userId: string;
  teamId?: string;
  claimType: 'WRITE' | 'REVIEW';
  status: 'ACTIVE' | 'RELEASED' | 'EXPIRED';
  claimedAt: string;
  expiresAt: string;
  releasedAt?: string;
}

export interface WorkItemCheckoutSession {
  workItemId: string;
  userId: string;
  repositoryId: string;
  localPath?: string;
  branch: string;
  lastSeenHeadSha?: string;
  lastSyncedAt?: string;
}

export interface WorkItemHandoffPacket {
  id: string;
  workItemId: string;
  fromUserId?: string;
  toUserId?: string;
  fromTeamId?: string;
  toTeamId?: string;
  summary: string;
  openQuestions: string[];
  blockingDependencies: string[];
  recommendedNextStep?: string;
  artifactIds: string[];
  traceIds: string[];
  delegationOriginTaskId?: string;
  delegationOriginAgentId?: string;
  createdAt: string;
  acceptedAt?: string;
}

export interface WorkItem {
  id: string;
  title: string;
  description: string;
  taskType?: WorkItemTaskType;
  phaseStakeholders?: WorkItemPhaseStakeholderAssignment[];
  phase: WorkItemPhase;
  phaseOwnerTeamId?: string;
  claimOwnerUserId?: string;
  watchedByUserIds?: string[];
  pendingHandoff?: PhaseHandoffPacket;
  capabilityId: string;
  workflowId: string;
  currentStepId?: string;
  assignedAgentId?: string;
  status: WorkItemStatus;
  priority: 'High' | 'Med' | 'Low';
  tags: string[];
  pendingRequest?: WorkItemPendingRequest;
  blocker?: WorkItemBlocker;
  activeRunId?: string;
  lastRunId?: string;
  recordVersion?: number;
  executionContext?: WorkItemExecutionContext;
  history: WorkItemHistoryEntry[];
}

export type WorkflowRunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'PAUSED'
  | 'WAITING_APPROVAL'
  | 'WAITING_INPUT'
  | 'WAITING_CONFLICT'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type WorkflowRunStepStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'WAITING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type ToolInvocationStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type RunWaitType = 'APPROVAL' | 'INPUT' | 'CONFLICT_RESOLUTION';

export type RunWaitStatus = 'OPEN' | 'RESOLVED' | 'CANCELLED';

export type ContrarianReviewStatus = 'PENDING' | 'READY' | 'ERROR';

export type ContrarianReviewSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type ContrarianReviewRecommendation =
  | 'CONTINUE'
  | 'REVISE_RESOLUTION'
  | 'ESCALATE'
  | 'STOP';

export interface ContrarianConflictReview {
  status: ContrarianReviewStatus;
  reviewerAgentId: string;
  generatedAt: string;
  severity: ContrarianReviewSeverity;
  recommendation: ContrarianReviewRecommendation;
  summary: string;
  challengedAssumptions: string[];
  risks: string[];
  missingEvidence: string[];
  alternativePaths: string[];
  suggestedResolution?: string;
  sourceArtifactIds: string[];
  sourceDocumentIds: string[];
  lastError?: string;
}

export type RunWaitPayload = {
  stepName?: string;
  postStepApproval?: boolean;
  completionSummary?: string;
  generatedArtifactIds?: string[];
  codeDiffArtifactId?: string;
  codeDiffSummary?: string;
  requestedInputFields?: CompiledRequiredInputField[];
  compiledStepContext?: CompiledStepContext;
  compiledWorkItemPlan?: CompiledWorkItemPlan;
  contrarianReview?: ContrarianConflictReview;
  approvalWorkspace?: ApprovalWorkspaceState;
} & Record<string, any>;

export interface WorkflowRun {
  id: string;
  capabilityId: string;
  workItemId: string;
  workflowId: string;
  status: WorkflowRunStatus;
  queueReason?: WorkflowRunQueueReason;
  assignedExecutorId?: string;
  attemptNumber: number;
  workflowSnapshot: Workflow;
  currentNodeId?: string;
  currentStepId?: string;
  currentPhase?: WorkItemPhase;
  assignedAgentId?: string;
  branchState?: WorkflowRunBranchState;
  pauseReason?: RunWaitType;
  currentWaitId?: string;
  terminalOutcome?: string;
  restartFromPhase?: WorkItemPhase;
  traceId?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRunStep {
  id: string;
  capabilityId: string;
  runId: string;
  workflowNodeId: string;
  workflowStepId?: string;
  stepIndex: number;
  phase: WorkItemPhase;
  name: string;
  stepType: WorkflowStepType;
  agentId: string;
  status: WorkflowRunStepStatus;
  attemptCount: number;
  spanId?: string;
  evidenceSummary?: string;
  outputSummary?: string;
  waitId?: string;
  lastToolInvocationId?: string;
  retrievalReferences?: MemoryReference[];
  startedAt?: string;
  completedAt?: string;
  metadata?: Record<string, any>;
}

export interface WorkflowRunBranchState {
  pendingNodeIds: string[];
  completedNodeIds: string[];
  activeNodeIds: string[];
  joinState?: Record<
    string,
    {
      waitingOnNodeIds: string[];
      completedInboundNodeIds: string[];
    }
  >;
  visitCount?: number;
}

export interface ToolInvocation {
  id: string;
  capabilityId: string;
  runId: string;
  runStepId: string;
  taskId?: string;
  traceId?: string;
  spanId?: string;
  toolId: ToolAdapterId;
  status: ToolInvocationStatus;
  request: Record<string, any>;
  resultSummary?: string;
  workingDirectory?: string;
  exitCode?: number;
  stdoutPreview?: string;
  stderrPreview?: string;
  retryable: boolean;
  sandboxProfile?: string;
  policyDecisionId?: string;
  latencyMs?: number;
  costUsd?: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface RunEvent {
  id: string;
  capabilityId: string;
  runId: string;
  workItemId: string;
  traceId?: string;
  spanId?: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  type: string;
  message: string;
  runStepId?: string;
  toolInvocationId?: string;
  details?: Record<string, any>;
}

export interface RunWait {
  id: string;
  capabilityId: string;
  runId: string;
  runStepId: string;
  traceId?: string;
  spanId?: string;
  type: RunWaitType;
  status: RunWaitStatus;
  message: string;
  requestedBy: string;
  requestedByActorUserId?: string;
  requestedByActorTeamIds?: string[];
  resolution?: string;
  resolvedBy?: string;
  resolvedByActorUserId?: string;
  resolvedByActorTeamIds?: string[];
  approvalPolicyId?: string;
  payload?: RunWaitPayload;
  createdAt: string;
  resolvedAt?: string;
  approvalAssignments?: ApprovalAssignment[];
  approvalDecisions?: ApprovalDecision[];
}

export interface WorkflowRunDetail {
  run: WorkflowRun;
  steps: WorkflowRunStep[];
  waits: RunWait[];
  toolInvocations: ToolInvocation[];
}

export interface LedgerArtifactRecord {
  artifact: Artifact;
  workItemTitle?: string;
  runStatus?: WorkflowRunStatus;
  stepName?: string;
  stepType?: WorkflowStepType;
  runAttempt?: number;
  sourceAgentName?: string;
  targetAgentName?: string;
}

export interface HumanInteractionRecord {
  id: string;
  capabilityId: string;
  workItemId?: string;
  workItemTitle?: string;
  runId: string;
  runStepId: string;
  waitId: string;
  phase?: WorkItemPhase;
  stepName?: string;
  interactionType: RunWaitType;
  status: RunWaitStatus;
  message: string;
  requestedBy: string;
  requestedByActorUserId?: string;
  requestedByActorTeamIds?: string[];
  requestedByName?: string;
  createdAt: string;
  resolution?: string;
  resolvedBy?: string;
  resolvedByActorUserId?: string;
  resolvedByActorTeamIds?: string[];
  resolvedByName?: string;
  resolvedAt?: string;
  artifactId?: string;
}

export interface PhaseEvidenceGroup {
  phase: WorkItemPhase;
  label: string;
  stepName?: string;
  stepType?: WorkflowStepType;
  artifacts: LedgerArtifactRecord[];
  handoffArtifacts: LedgerArtifactRecord[];
  toolInvocations: ToolInvocation[];
  logs: ExecutionLog[];
  events: RunEvent[];
  interactions: HumanInteractionRecord[];
}

export interface CompletedWorkOrderSummary {
  workItem: WorkItem;
  latestCompletedRun?: WorkflowRun;
  supersededRuns: WorkflowRun[];
  artifactCount: number;
  handoffCount: number;
  interactionCount: number;
  eventCount: number;
  logCount: number;
  completedAt?: string;
}

export interface CompletedWorkOrderDetail {
  workItem: WorkItem;
  workflow?: Workflow;
  latestCompletedRun?: WorkflowRun;
  runHistory: WorkflowRun[];
  latestRunDetail?: WorkflowRunDetail;
  artifacts: LedgerArtifactRecord[];
  humanInteractions: HumanInteractionRecord[];
  phaseGroups: PhaseEvidenceGroup[];
  events: RunEvent[];
  logs: ExecutionLog[];
}

export interface ArtifactContentResponse {
  artifact: Artifact;
  contentFormat: ArtifactContentFormat;
  mimeType: string;
  fileName: string;
  hasBinary?: boolean;
  sizeBytes?: number;
  contentText?: string;
  contentJson?: Record<string, any> | any[];
}

export type TelemetrySpanKind =
  | 'HTTP'
  | 'CHAT'
  | 'RUN'
  | 'STEP'
  | 'TOOL'
  | 'MEMORY'
  | 'POLICY'
  | 'EVAL';

export type TelemetrySpanStatus = 'OK' | 'ERROR' | 'WAITING' | 'RUNNING';

export interface TelemetrySpan {
  id: string;
  capabilityId: string;
  traceId: string;
  parentSpanId?: string;
  entityType: TelemetrySpanKind;
  entityId?: string;
  name: string;
  status: TelemetrySpanStatus;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  model?: string;
  costUsd?: number;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  attributes?: Record<string, any>;
}

export interface TelemetryMetricSample {
  id: string;
  capabilityId: string;
  traceId?: string;
  scopeType: 'CAPABILITY' | 'AGENT' | 'RUN' | 'STEP' | 'TOOL' | 'CHAT' | 'EVAL';
  scopeId: string;
  metricName: string;
  metricValue: number;
  unit: 'ms' | 'usd' | 'tokens' | 'count' | 'ratio';
  tags?: Record<string, string>;
  recordedAt: string;
}

export interface TelemetrySummary {
  capabilityId: string;
  totalRuns: number;
  activeRuns: number;
  waitingRuns: number;
  failedRuns: number;
  totalCostUsd: number;
  totalTokens: number;
  averageLatencyMs: number;
  policyDecisionCount: number;
  memoryDocumentCount: number;
  recentSpans: TelemetrySpan[];
  recentMetrics: TelemetryMetricSample[];
}

export type PolicyActionType =
  | 'workspace_write'
  | 'git_branch'
  | 'run_build'
  | 'run_test'
  | 'run_docs'
  | 'run_deploy'
  | 'destructive_git'
  | 'custom';

export type PolicyDecisionResult = 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';

export interface PolicyDecision {
  id: string;
  capabilityId: string;
  traceId?: string;
  runId?: string;
  runStepId?: string;
  toolInvocationId?: string;
  actionType: PolicyActionType;
  targetId?: string;
  decision: PolicyDecisionResult;
  reason: string;
  requestedByAgentId?: string;
  createdAt: string;
  /**
   * Slice 3 — when a matching APPROVED governance exception flipped a
   * REQUIRE_APPROVAL decision to ALLOW, the decision row stamps the
   * exception id + expiry. Present iff the decision was granted on
   * exception. Audits reconstruct "why did this pass?" from this pair.
   */
  exceptionId?: string;
  exceptionExpiresAt?: string;
}

export type FlightRecorderVerdict =
  | 'ALLOWED'
  | 'NEEDS_APPROVAL'
  | 'DENIED'
  | 'INCOMPLETE';

export type FlightRecorderEventType =
  | 'RUN_STARTED'
  | 'RUN_COMPLETED'
  | 'RUN_FAILED'
  | 'STEP_COMPLETED'
  | 'WAIT_OPENED'
  | 'WAIT_RESOLVED'
  | 'APPROVAL_CAPTURED'
  | 'CONFLICT_RESOLVED'
  | 'CONTRARIAN_REVIEW'
  | 'POLICY_DECISION'
  | 'TOOL_COMPLETED'
  | 'TOOL_FAILED'
  | 'ARTIFACT_CREATED'
  | 'HANDOFF_CREATED'
  | 'RELEASE_VERDICT';

export interface FlightRecorderEvent {
  id: string;
  capabilityId: string;
  workItemId?: string;
  workItemTitle?: string;
  runId?: string;
  runStepId?: string;
  artifactId?: string;
  waitId?: string;
  policyDecisionId?: string;
  toolInvocationId?: string;
  traceId?: string;
  timestamp: string;
  type: FlightRecorderEventType;
  title: string;
  description: string;
  actorId?: string;
  actorName?: string;
  phase?: WorkItemPhase;
  verdict?: FlightRecorderVerdict;
  severity?: 'INFO' | 'WARN' | 'ERROR';
}

export interface FlightRecorderPolicySummary {
  id: string;
  runId?: string;
  runStepId?: string;
  toolInvocationId?: string;
  actionType: PolicyActionType;
  targetId?: string;
  decision: PolicyDecisionResult;
  reason: string;
  requestedByAgentId?: string;
  requestedByName?: string;
  createdAt: string;
}

export interface FlightRecorderHumanGateSummary {
  waitId: string;
  runId: string;
  runStepId: string;
  type: RunWaitType;
  status: RunWaitStatus;
  message: string;
  requestedBy: string;
  requestedByName?: string;
  resolvedBy?: string;
  resolvedByName?: string;
  resolution?: string;
  contrarianReview?: ContrarianConflictReview;
  createdAt: string;
  resolvedAt?: string;
}

export interface FlightRecorderArtifactSummary {
  artifactId: string;
  name: string;
  kind?: ArtifactKind;
  summary?: string;
  workItemId?: string;
  runId?: string;
  runStepId?: string;
  phase?: WorkItemPhase;
  agentId?: string;
  agentName?: string;
  createdAt: string;
}

export interface WorkItemFlightRecorderDetail {
  capabilityId: string;
  generatedAt: string;
  workItem: WorkItem;
  verdict: FlightRecorderVerdict;
  verdictReason: string;
  latestRun?: WorkflowRun;
  runHistory: WorkflowRun[];
  humanGates: FlightRecorderHumanGateSummary[];
  policyDecisions: FlightRecorderPolicySummary[];
  artifacts: FlightRecorderArtifactSummary[];
  handoffArtifacts: FlightRecorderArtifactSummary[];
  toolInvocations: ToolInvocation[];
  events: FlightRecorderEvent[];
  telemetry: {
    traceIds: string[];
    toolInvocationCount: number;
    failedToolInvocationCount: number;
    totalToolLatencyMs: number;
    totalToolCostUsd: number;
    runConsolePath: string;
  };
}

export interface CapabilityFlightRecorderSnapshot {
  capabilityId: string;
  generatedAt: string;
  verdict: FlightRecorderVerdict;
  verdictReason: string;
  summary: {
    completedWorkCount: number;
    openHumanGateCount: number;
    policyDecisionCount: number;
    evidenceArtifactCount: number;
    handoffPacketCount: number;
  };
  events: FlightRecorderEvent[];
  workItems: WorkItemFlightRecorderDetail[];
}

export type ReleaseReadinessStatus =
  | 'READY'
  | 'WAITING_APPROVAL'
  | 'BLOCKED'
  | 'INCOMPLETE';

export interface ReleaseReadinessDimension {
  id:
    | 'evidence_complete'
    | 'approvals_resolved'
    | 'no_denied_policy'
    | 'qa_complete'
    | 'handoff_complete'
    | 'deployment_authorized';
  label: string;
  weight: number;
  applicable: boolean;
  passed: boolean;
  reason: string;
}

export interface ReleaseReadiness {
  status: ReleaseReadinessStatus;
  score: number;
  dimensions: ReleaseReadinessDimension[];
  blockingReasons: string[];
}

export interface WorkItemAttemptDiff {
  hasPreviousAttempt: boolean;
  currentAttemptNumber?: number;
  previousAttemptNumber?: number;
  summary: string;
  statusDelta?: string;
  terminalOutcomeDelta?: string;
  stepProgressDelta: string[];
  waitDelta: string[];
  policyDelta: string[];
  evidenceDelta: string[];
  handoffDelta: string[];
  toolDelta: string[];
  humanDelta: string[];
}

export interface ReviewPacketArtifactSummary {
  artifactId: string;
  name: string;
  createdAt: string;
  fileName: string;
  contentText: string;
  downloadUrl: string;
}

export type ApprovalClarificationRequestStatus =
  | 'PENDING_RESPONSE'
  | 'RESPONDED'
  | 'FAILED';

export type ApprovalClarificationWorkspaceStatus =
  | 'IDLE'
  | 'WAITING_FOR_AGENT'
  | 'RESPONDED'
  | 'FAILED';

export interface ApprovalClarificationRequest {
  id: string;
  capabilityId: string;
  runId: string;
  waitId: string;
  targetAgentId: string;
  targetAgentName?: string;
  summary: string;
  clarificationQuestions: string[];
  note?: string;
  requestedBy: string;
  requestedByActorUserId?: string;
  requestedAt: string;
  status: ApprovalClarificationRequestStatus;
  responseId?: string;
}

export interface ApprovalClarificationResponse {
  id: string;
  capabilityId: string;
  runId: string;
  waitId: string;
  requestId: string;
  agentId: string;
  agentName?: string;
  content: string;
  createdAt: string;
  artifactId?: string;
  messageId?: string;
  error?: string;
}

export interface ApprovalStructuredPacketExcerpt {
  id: string;
  title: string;
  timestamp: string;
  excerpt: string;
}

export interface ApprovalStructuredPacketDeterministicSummary {
  approvalSummary: string;
  keyEvents: string[];
  keyClaims: string[];
  evidenceHighlights: string[];
  openQuestions: string[];
  unresolvedConcerns: string[];
  chatExcerpts: ApprovalStructuredPacketExcerpt[];
}

export interface ApprovalStructuredPacketAiSummary {
  status: 'READY' | 'ERROR' | 'UNAVAILABLE';
  generatedAt?: string;
  model?: string;
  summary?: string;
  topRisks: string[];
  missingEvidence: string[];
  disagreements: string[];
  suggestedClarifications: string[];
  error?: string;
}

export interface ApprovalStructuredPacket {
  waitId: string;
  generatedAt: string;
  sourceFingerprint: string;
  artifactId?: string;
  fileName?: string;
  contentText: string;
  deterministic: ApprovalStructuredPacketDeterministicSummary;
  aiSummary: ApprovalStructuredPacketAiSummary;
}

export interface ApprovalWorkspaceState {
  packet?: ApprovalStructuredPacket;
  clarificationStatus?: ApprovalClarificationWorkspaceStatus;
  clarificationRequests?: ApprovalClarificationRequest[];
  clarificationResponses?: ApprovalClarificationResponse[];
  activeClarificationRequestId?: string;
}

export interface StageControlContinueResponse {
  action:
    | 'APPROVED_WAIT'
    | 'PROVIDED_INPUT'
    | 'RESOLVED_CONFLICT'
    | 'RESTARTED'
    | 'CANCELLED_AND_RESTARTED'
    | 'STARTED';
  summary: string;
  artifactId?: string;
  run: WorkflowRun;
}

export type ApprovalAssignmentStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'REQUEST_CHANGES'
  | 'DELEGATED'
  | 'CANCELLED';

export type ApprovalDecisionDisposition =
  | 'APPROVE'
  | 'REJECT'
  | 'REQUEST_CHANGES'
  | 'DELEGATE';

export interface ApprovalAssignment {
  id: string;
  capabilityId: string;
  runId: string;
  waitId: string;
  phase?: WorkItemPhase;
  stepName?: string;
  approvalPolicyId?: string;
  status: ApprovalAssignmentStatus;
  targetType: ApprovalRuleTarget;
  targetId: string;
  assignedUserId?: string;
  assignedTeamId?: string;
  dueAt?: string;
  delegatedToUserId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalDecision {
  id: string;
  capabilityId: string;
  runId: string;
  waitId: string;
  assignmentId?: string;
  disposition: ApprovalDecisionDisposition;
  actorUserId?: string;
  actorDisplayName: string;
  actorTeamIds: string[];
  comment?: string;
  createdAt: string;
}

// `ApprovalWorkspaceContext` is retained because the server's
// `server/approvalWorkspace.ts` still consumes it to shape the REST response
// for `/api/.../approvals/:waitId` — external tooling and the legacy endpoint
// contract continue to depend on that payload. The frontend Human Approval
// Gate modal does not use this type (it reads `WorkItem.approvalWorkspace`
// state directly).
export interface ApprovalWorkspaceContext {
  capabilityId: string;
  capabilityName: string;
  runId: string;
  waitId: string;
  workItem: WorkItem;
  run: WorkflowRun;
  runStep?: WorkflowRunStep;
  approvalWait: RunWait;
  interactionFeed: CapabilityInteractionFeed;
  artifacts: Artifact[];
  codeDiffArtifact?: Artifact;
  selectedArtifactId?: string;
  availableAgents: Array<{
    id: string;
    name: string;
    role: string;
  }>;
  currentPhaseLabel: string;
  currentStepName: string;
  requestedByLabel: string;
  requestedAt?: string;
  structuredPacket?: ApprovalStructuredPacket;
  clarificationRequests: ApprovalClarificationRequest[];
  clarificationResponses: ApprovalClarificationResponse[];
  clarificationStatus: ApprovalClarificationWorkspaceStatus;
}

export interface WorkItemClaim {
  capabilityId: string;
  workItemId: string;
  userId: string;
  teamId?: string;
  status: 'ACTIVE' | 'RELEASED' | 'EXPIRED';
  claimedAt: string;
  expiresAt: string;
  releasedAt?: string;
}

export interface WorkItemPresence {
  capabilityId: string;
  workItemId: string;
  userId: string;
  teamId?: string;
  viewContext?: string;
  lastSeenAt: string;
}

export interface OwnershipTransferRecord {
  id: string;
  capabilityId: string;
  workItemId: string;
  fromPhase?: WorkItemPhase;
  toPhase: WorkItemPhase;
  fromTeamId?: string;
  toTeamId?: string;
  transferredByUserId?: string;
  transferredByName: string;
  summary: string;
  createdAt: string;
}

export interface PhaseHandoffPacket {
  id: string;
  capabilityId: string;
  workItemId: string;
  fromPhase: WorkItemPhase;
  toPhase: WorkItemPhase;
  fromTeamId?: string;
  toTeamId?: string;
  acceptanceChecklist: string[];
  openQuestions: string[];
  blockingDependencies: string[];
  receivingTeamAcceptedAt?: string;
  receivingTeamAcceptedByUserId?: string;
  summary?: string;
  delegationOriginTaskId?: string;
  delegationOriginAgentId?: string;
}

export type ConnectorSyncStatus = 'READY' | 'NEEDS_CONFIGURATION' | 'ERROR';

export interface GithubConnectorRepositoryContext {
  url: string;
  owner: string;
  repo: string;
  description?: string;
  defaultBranch?: string;
  openIssueCount?: number;
  openPullRequestCount?: number;
}

export interface GithubConnectorPullRequestContext {
  number: number;
  title: string;
  state: string;
  url: string;
}

export interface GithubConnectorIssueContext {
  number: number;
  title: string;
  state: string;
  url: string;
}

export interface GithubConnectorSyncResult {
  provider: 'GITHUB';
  status: ConnectorSyncStatus;
  message: string;
  syncedAt: string;
  repositories: GithubConnectorRepositoryContext[];
  pullRequests: GithubConnectorPullRequestContext[];
  issues: GithubConnectorIssueContext[];
}

export interface JiraConnectorIssueContext {
  key: string;
  title: string;
  status: string;
  url?: string;
}

export interface JiraConnectorSyncResult {
  provider: 'JIRA';
  status: ConnectorSyncStatus;
  message: string;
  syncedAt: string;
  boardUrl?: string;
  issues: JiraConnectorIssueContext[];
}

export interface ConfluenceConnectorPageContext {
  pageId?: string;
  title?: string;
  url: string;
  spaceKey?: string;
}

export interface ConfluenceConnectorSyncResult {
  provider: 'CONFLUENCE';
  status: ConnectorSyncStatus;
  message: string;
  syncedAt: string;
  pages: ConfluenceConnectorPageContext[];
}

export interface CapabilityConnectorContext {
  capabilityId: string;
  github: GithubConnectorSyncResult;
  jira: JiraConnectorSyncResult;
  confluence: ConfluenceConnectorSyncResult;
}

export interface WorkItemExplainDetail {
  capabilityId: string;
  generatedAt: string;
  workItem: WorkItem;
  summary: {
    headline: string;
    blockingState: string;
    nextAction: string;
    latestRunStatus?: WorkflowRunStatus;
  };
  releaseReadiness: ReleaseReadiness;
  attemptDiff: WorkItemAttemptDiff;
  latestRun?: WorkflowRun;
  previousRun?: WorkflowRun;
  flightRecorder: {
    verdict: FlightRecorderVerdict;
    verdictReason: string;
  };
  evidence: {
    artifactCount: number;
    handoffCount: number;
    phaseCount: number;
    latestCompletedAt?: string;
  };
  humanGates: FlightRecorderHumanGateSummary[];
  policyDecisions: FlightRecorderPolicySummary[];
  artifacts: FlightRecorderArtifactSummary[];
  handoffArtifacts: FlightRecorderArtifactSummary[];
  telemetry: WorkItemFlightRecorderDetail['telemetry'];
  connectors: CapabilityConnectorContext;
  reviewPacket?: ReviewPacketArtifactSummary;
}

export type MemorySourceType =
  | 'CAPABILITY_METADATA'
  | 'CHAT_SESSION'
  | 'WORK_ITEM'
  | 'ARTIFACT'
  | 'HANDOFF'
  | 'HUMAN_INTERACTION'
  | 'REPOSITORY_FILE';

export type MemoryStoreTier = 'WORKING' | 'SESSION' | 'LONG_TERM';

export interface MemoryReference {
  documentId: string;
  chunkId: string;
  title: string;
  sourceType: MemorySourceType;
  tier: MemoryStoreTier;
  score?: number;
  retrievalMethod?: 'SEMANTIC' | 'LEXICAL' | 'BLENDED';
  semanticScore?: number;
  lexicalScore?: number;
  rerankScore?: number;
}

export interface MemoryDocument {
  id: string;
  capabilityId: string;
  title: string;
  sourceType: MemorySourceType;
  tier: MemoryStoreTier;
  sourceId?: string;
  sourceUri?: string;
  freshness?: 'HOT' | 'WARM' | 'COLD';
  metadata?: Record<string, any>;
  contentPreview: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryChunk {
  id: string;
  capabilityId: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  tokenEstimate: number;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface MemorySearchResult {
  reference: MemoryReference;
  document: MemoryDocument;
  chunk: MemoryChunk;
  embeddingProviderKey?: EmbeddingProviderKey;
  vectorModel?: string;
}

export type DelegationStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'PROMOTED_TO_HANDOFF';

export interface DelegationRequest {
  delegatedAgentId: string;
  title: string;
  prompt: string;
  allowedToolIds?: ToolAdapterId[];
  promoteToHandoff?: boolean;
  handoffSummary?: string;
}

export interface DelegationArtifact {
  artifactId: string;
  handoffPacketId?: string;
  promotedToHandoff?: boolean;
}

export interface DelegationResult {
  summary: string;
  childTaskId: string;
  status: DelegationStatus;
  artifactIds: string[];
  handoffPacketId?: string;
}

export interface DelegatedRun {
  id: string;
  capabilityId: string;
  workItemId?: string;
  parentRunId: string;
  parentRunStepId: string;
  parentTaskId?: string;
  delegatedAgentId: string;
  delegatedAgentName: string;
  title: string;
  prompt: string;
  status: DelegationStatus;
  summary?: string;
  artifactIds: string[];
  handoffPacketId?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface EvalSuite {
  id: string;
  capabilityId: string;
  name: string;
  description: string;
  agentRole: string;
  evalType: 'STRUCTURED_OUTPUT' | 'RETRIEVAL' | 'WORKFLOW';
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EvalCase {
  id: string;
  capabilityId: string;
  suiteId: string;
  name: string;
  description: string;
  input: Record<string, any>;
  expected: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface EvalRunCaseResult {
  id: string;
  capabilityId: string;
  evalRunId: string;
  evalCaseId: string;
  status: 'PASSED' | 'FAILED' | 'WARN';
  score: number;
  summary: string;
  details?: Record<string, any>;
  createdAt: string;
}

export interface EvalRun {
  id: string;
  capabilityId: string;
  suiteId: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  traceId?: string;
  judgeModel?: string;
  score?: number;
  summary?: string;
  createdAt: string;
  completedAt?: string;
}

export interface EvalRunDetail {
  run: EvalRun;
  suite: EvalSuite;
  cases: EvalCase[];
  results: EvalRunCaseResult[];
}

export interface RunConsoleSnapshot {
  capabilityId: string;
  telemetry: TelemetrySummary;
  activeRuns: WorkflowRun[];
  recentRuns: WorkflowRun[];
  recentEvents: RunEvent[];
  recentPolicyDecisions: PolicyDecision[];
}

export interface ChatStreamEvent {
  type:
    | 'start'
    | 'memory'
    | 'delta'
    | 'complete'
    | 'error';
  sessionMode?: 'resume' | 'fresh';
  sessionId?: string;
  sessionScope?: AgentSessionScope;
  sessionScopeId?: string;
  isNewSession?: boolean;
  content?: string;
  createdAt?: string;
  model?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  traceId?: string;
  memoryReferences?: MemoryReference[];
  error?: string;
  retryAfterMs?: number;
}

export interface CapabilityWorkspace {
  capabilityId: string;
  briefing: CapabilityBriefing;
  readinessContract?: ReadinessContract;
  agents: CapabilityAgent[];
  workflows: Workflow[];
  artifacts: Artifact[];
  tasks: AgentTask[];
  executionLogs: ExecutionLog[];
  learningUpdates: LearningUpdate[];
  workItems: WorkItem[];
  messages: CapabilityChatMessage[];
  activeChatAgentId?: string;
  primaryCopilotAgentId?: string;
  goldenPathProgress?: GoldenPathProgress;
  interactionFeed?: CapabilityInteractionFeed;
  executionOwnership?: CapabilityExecutionOwnership | null;
  executionDispatchState?: ExecutionDispatchState;
  executionQueueReason?: WorkflowRunQueueReason;
  createdAt: string;
}

/**
 * AI attribution captured on an attestation so auditors can answer
 * "which agents / tools produced this change." Derived from the source
 * workflow run at seal time; immutable thereafter.
 */
export interface AttestationAiAttribution {
  assignedAgentId?: string;
  stepAgentIds?: string[];
  toolInvocationIds?: string[];
}

/**
 * Chain + signature envelope for a Signed Change Attestation (Slice A).
 * Fields are optional on the summary so legacy packets created before
 * signing was wired up continue to round-trip as `attestationVersion: 1`
 * with no signature.
 */
export interface AttestationChainEnvelope {
  attestationVersion?: number;
  prevBundleId?: string | null;
  chainRootBundleId?: string | null;
  signature?: string | null;
  signingKeyId?: string | null;
  signingAlgo?: string | null;
  isAiAssisted?: boolean;
  aiAttribution?: AttestationAiAttribution;
}

export interface EvidencePacketSummary extends AttestationChainEnvelope {
  bundleId: string;
  capabilityId: string;
  workItemId: string;
  title: string;
  digestSha256: string;
  createdAt: string;
  generatedBy: string;
  runId?: string;
  summary: string;
  touchedPaths?: string[];
}

export interface EvidencePacket extends EvidencePacketSummary {
  payload: {
    capabilityBriefing: CapabilityBriefing;
    readinessContract: ReadinessContract;
    interactionFeed: CapabilityInteractionFeed;
    workItem: WorkItem;
    latestRun?: WorkflowRun;
    workflow?: Workflow;
    runDetail?: WorkflowRunDetail;
    runEvents: RunEvent[];
    artifacts: Artifact[];
    tasks: AgentTask[];
    explain?: WorkItemExplainDetail;
    connectors?: CapabilityConnectorContext;
    evidence?: CompletedWorkOrderDetail;
  };
  incidentLinks?: IncidentPacketLink[];
}

/**
 * Slice A verification payload returned by POST /api/attestations/:id/verify.
 * signatureValid → Ed25519 check against the registered public key passed.
 * digestMatches  → the stored digest_sha256 still matches the current payload.
 * chainIntact    → every prev_bundle_id in the chain resolves to a persisted
 *                   packet and the chain terminates at chain_root_bundle_id.
 */
export interface AttestationVerificationResult {
  bundleId: string;
  signatureValid: boolean;
  digestMatches: boolean;
  chainIntact: boolean;
  reason?: string;
}

/**
 * Ordered view of the attestation chain for a work item, root-first.
 */
export interface AttestationChain {
  rootBundleId: string;
  workItemId: string;
  entries: EvidencePacketSummary[];
}

/**
 * Slice 1 — verify response the UI renders in the Signed/Chain-intact chip
 * + drawer. `signatureValid` and `digestMatches` can be true independently
 * (an operator who mutates payload rows breaks digestMatches without
 * touching the signature). `chainIntact` covers structural walk-back.
 */
export interface EvidencePacketVerification {
  bundleId: string;
  capabilityId: string;
  workItemId: string;
  signatureValid: boolean;
  digestMatches: boolean;
  chainIntact: boolean;
  chainDepth: number;
  chainRootBundleId: string;
  signingKeyId: string | null;
  signingAlgo: string | null;
  attestationVersion: number;
  reason?: string;
}

/**
 * Slice 1 — operator health snapshot of the Signed Change Attestations
 * subsystem. Returned verbatim by `/api/governance/signer/status`; the UI
 * uses `configured` to decide whether to show a green "Signed" chip for
 * newly-created packets vs. an amber "Unsigned" chip.
 */
export interface SignerStatus {
  configured: boolean;
  activeKeyId: string | null;
  algorithm: 'ed25519';
  registryPath: string;
  knownKeyCount: number;
  activeKeyAgeDays: number | null;
  publicKeyFingerprint: string | null;
}

// -- Slice 2 — governance controls catalog -----------------------------------

export type GovernanceControlFramework = 'NIST_CSF_2' | 'SOC2_TSC' | 'ISO27001_2022';
export type GovernanceControlSeverity = 'STANDARD' | 'SEV_1';
export type GovernanceControlStatus = 'ACTIVE' | 'RETIRED';
export type GovernanceControlOwnerRole =
  | 'SECURITY'
  | 'COMPLIANCE'
  | 'PLATFORM'
  | 'EXECUTIVE';
export type GovernanceBindingKind =
  | 'POLICY_DECISION'
  | 'APPROVAL_FLOW'
  | 'SIGNING_REQUIRED'
  | 'EVIDENCE_PACKET';

export interface GovernanceControl {
  controlId: string;
  framework: GovernanceControlFramework;
  controlCode: string;
  controlFamily: string;
  title: string;
  description: string;
  ownerRole: GovernanceControlOwnerRole | null;
  severity: GovernanceControlSeverity;
  status: GovernanceControlStatus;
  seedVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GovernanceControlBinding {
  bindingId: string;
  controlId: string;
  policySelector: Record<string, unknown>;
  bindingKind: GovernanceBindingKind;
  capabilityScope: string | null;
  seedVersion: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface GovernanceControlListItem extends GovernanceControl {
  bindingCount: number;
}

export interface GovernanceControlWithBindings extends GovernanceControl {
  bindings: GovernanceControlBinding[];
}

export interface GovernanceControlFrameworkSummary {
  framework: GovernanceControlFramework;
  total: number;
  activeBindings: number;
}

export interface GovernanceControlsListResponse {
  items: GovernanceControlListItem[];
  summary: GovernanceControlFrameworkSummary[];
}

export interface GovernanceControlBindingInput {
  policySelector: Record<string, unknown>;
  bindingKind: GovernanceBindingKind;
  capabilityScope?: string | null;
}

// Slice 3 — Governance exception lifecycle. An exception is a time-bound,
// auditable waiver of a policy decision. Every transition writes an event.
export type GovernanceExceptionStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'DENIED'
  | 'EXPIRED'
  | 'REVOKED';

export type GovernanceExceptionEventType =
  | 'REQUESTED'
  | 'APPROVED'
  | 'DENIED'
  | 'EXPIRED'
  | 'REVOKED'
  | 'COMMENTED';

export interface GovernanceException {
  exceptionId: string;
  capabilityId: string;
  controlId: string;
  requestedBy: string;
  requestedAt: string;
  reason: string;
  scopeSelector: Record<string, unknown>;
  status: GovernanceExceptionStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GovernanceExceptionEvent {
  eventId: string;
  exceptionId: string;
  eventType: GovernanceExceptionEventType;
  actorUserId: string | null;
  details: Record<string, unknown>;
  at: string;
}

export interface GovernanceExceptionWithEvents extends GovernanceException {
  events: GovernanceExceptionEvent[];
}

export interface GovernanceExceptionRequestInput {
  capabilityId: string;
  controlId: string;
  reason: string;
  scopeSelector?: Record<string, unknown>;
  expiresAt: string; // ISO — v1 rejects null (see plan "Risk: long-lived exception")
}

export interface GovernanceExceptionDecisionInput {
  status: 'APPROVED' | 'DENIED';
  comment?: string;
  // If omitted and an exception is APPROVED, service inherits
  // requested expiresAt — the decision cannot extend beyond the request.
  expiresAt?: string;
}

export interface GovernanceExceptionListFilter {
  capabilityId?: string;
  controlId?: string;
  status?: GovernanceExceptionStatus | GovernanceExceptionStatus[];
  includeEvents?: boolean;
}

export interface GovernanceExceptionsListResponse {
  items: GovernanceException[];
  total: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Slice 4 — prove-the-negative provenance.
// ──────────────────────────────────────────────────────────────────────────

export type ProvenanceActorKind = 'AI' | 'HUMAN' | 'ANY';

export interface ProvenanceCoverageWindow {
  coverageId: string;
  capabilityId: string;
  windowStart: string;
  windowEnd: string;
  source: string;
  notes: string | null;
}

export interface ProvenanceCoverageResult {
  windows: ProvenanceCoverageWindow[];
  /**
   * True when the requested [from, to] window is NOT fully covered by the
   * union of known coverage windows. A "no touch" answer in the presence
   * of a gap must never be reported as a silent false — the UI shows an
   * amber "inconclusive" banner and lists the gap sub-windows.
   */
  hasGap: boolean;
  gapWindows: Array<{ start: string; end: string }>;
}

export interface ProvenanceTouchMatch {
  toolInvocationId: string;
  capabilityId: string;
  runId: string;
  toolId: string;
  actorKind: 'AI' | 'HUMAN';
  touchedPaths: string[];
  startedAt: string | null;
  completedAt: string | null;
}

export interface ProveNoTouchInput {
  capabilityId: string;
  pathGlob: string;
  from: string; // ISO
  to: string; // ISO
  actorKind?: ProvenanceActorKind;
}

export interface ProveNoTouchResult {
  touched: boolean;
  matchingInvocations: ProvenanceTouchMatch[];
  coverage: ProvenanceCoverageResult;
  /** Human-legible headline for the UI card. */
  summary: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Slice 5 — governance posture dashboard. Pure aggregate read over the
// Slice 1-4 tables. See server/governance/posture.ts for the source
// queries. The UI uses the same type via src/lib/api.ts.
// ──────────────────────────────────────────────────────────────────────────

export interface GovernanceSignerStatus {
  configured: boolean;
  activeKeyId: string | null;
  algorithm: string;
  registryPath: string;
  knownKeyCount: number;
  activeKeyAgeDays: number | null;
  publicKeyFingerprint: string | null;
}

export interface PostureSignerHealth {
  status: GovernanceSignerStatus;
  recentPackets: {
    windowDays: number;
    total: number;
    signed: number;
    unsigned: number;
    signedRatio: number;
  };
}

export interface PostureControlCoverage {
  totalControls: number;
  boundControls: number;
  unboundControls: number;
  coverageRatio: number;
  byFramework: Array<{
    framework: string;
    total: number;
    bound: number;
    coverageRatio: number;
  }>;
}

export interface PostureExceptionsSummary {
  enabled: boolean;
  active: number;
  expiringSoon: number;
  expiringSoonHours: number;
  recentDecisions: Array<{
    exceptionId: string;
    capabilityId: string;
    controlId: string;
    status: string;
    decidedBy: string | null;
    decidedAt: string | null;
    expiresAt: string | null;
  }>;
}

export interface PostureProvenanceSummary {
  enabled: boolean;
  capabilitiesWithCoverage: number;
  coverageWindowCount: number;
  earliestWindowStart: string | null;
  latestWindowEnd: string | null;
  unmappedToolSamples: Array<{ toolId: string; sampleCount: number }>;
}

export interface PostureRecentDenial {
  decisionId: string;
  capabilityId: string;
  actionType: string;
  decision: string;
  reason: string;
  createdAt: string;
  controlId: string | null;
  exceptionId: string | null;
}

export interface GovernancePostureSnapshot {
  generatedAt: string;
  signer: PostureSignerHealth;
  controls: PostureControlCoverage;
  exceptions: PostureExceptionsSummary;
  provenance: PostureProvenanceSummary;
  recentDenials: PostureRecentDenial[];
  warnings: string[];
}

export type IncidentSeverity = 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';
export type IncidentSource = 'pagerduty' | 'servicenow' | 'incident-io' | 'manual';
export type IncidentCorrelation = 'CONFIRMED' | 'SUSPECTED' | 'BLAST_RADIUS' | 'DISMISSED';
export type IncidentStatus = 'triggered' | 'investigating' | 'resolved' | 'closed';
export type IncidentExportTarget = 'datadog' | 'servicenow';
export type IncidentExportKind = 'INCIDENT' | 'MRM';
export type IncidentExportDeliveryStatus = 'QUEUED' | 'DELIVERED' | 'FAILED';
export type IncidentExportAuthType = 'API_KEY' | 'BASIC';
export type IncidentJobType = 'CORRELATE' | 'EXPORT_INCIDENT' | 'EXPORT_MRM';
export type IncidentJobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type IncidentSourceAuthType = 'HMAC_SHA256' | 'BASIC';

export interface IncidentPacketLink {
  incidentId: string;
  packetBundleId: string;
  correlation: IncidentCorrelation;
  correlationScore?: number;
  correlationReasons: string[];
  linkedAt: string;
  linkedBy?: string;
  linkedByActorDisplayName?: string;
  packetTitle?: string;
  workItemId?: string;
  runId?: string;
  touchedPaths?: string[];
}

export interface CapabilityIncident {
  id: string;
  externalId?: string;
  source: IncidentSource;
  capabilityId?: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  detectedAt: string;
  resolvedAt?: string;
  affectedServices: string[];
  affectedPaths: string[];
  summary?: string;
  postmortemUrl?: string;
  rawPayload?: Record<string, unknown>;
  createdByActorUserId?: string;
  createdAt?: string;
  updatedAt?: string;
  linkedPackets: IncidentPacketLink[];
}

export interface IncidentSourceConfig {
  source: IncidentSource;
  enabled: boolean;
  authType: IncidentSourceAuthType;
  secretReference?: string;
  basicUsername?: string;
  signatureHeader?: string;
  rateLimitPerMinute: number;
  settings?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface IncidentServiceCapabilityMap {
  serviceName: string;
  capabilityId: string;
  defaultAffectedPaths: string[];
  ownerEmail?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface IncidentExportTargetConfig {
  target: IncidentExportTarget;
  enabled: boolean;
  authType: IncidentExportAuthType;
  baseUrl?: string;
  secretReference?: string;
  basicUsername?: string;
  settings?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface IncidentExportDelivery {
  id: string;
  target: IncidentExportTarget;
  exportKind: IncidentExportKind;
  incidentId?: string;
  capabilityId?: string;
  windowDays?: number;
  status: IncidentExportDeliveryStatus;
  requestPayload?: Record<string, unknown>;
  responseStatus?: number;
  responsePreview?: string;
  externalReference?: string;
  triggeredByActorUserId?: string;
  triggeredByActorDisplayName?: string;
  createdAt: string;
  exportedAt?: string;
  updatedAt: string;
}

export interface IncidentJob {
  id: string;
  source: IncidentSource;
  incidentId?: string;
  type: IncidentJobType;
  status: IncidentJobStatus;
  payload: Record<string, unknown>;
  attempts: number;
  lastError?: string;
  availableAt: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IncidentCorrelationCandidate {
  incidentId: string;
  packet: EvidencePacketSummary;
  correlation: IncidentCorrelation;
  score: number;
  overlapCount: number;
  matchedPaths: string[];
  reasons: string[];
}

export interface ModelRiskMonitoringSummary {
  capabilityId?: string;
  windowDays: number;
  totals: {
    incidents: number;
    confirmedContributors: number;
    suspectedContributors: number;
    blastRadiusLinks: number;
    totalPackets: number;
    incidentContributionRate: number;
    meanTimeToAttributionHours: number;
    overrideToIncidentRate: number;
    guardrailPromotionsRequested: number;
    incidentDerivedLearningCount: number;
  };
  bySeverity: Array<{
    severity: IncidentSeverity;
    incidentCount: number;
    confirmedContributors: number;
  }>;
  byProvider: Array<{
    providerKey: ProviderKey | 'unknown';
    model: string;
    confirmedContributors: number;
    suspectedContributors: number;
  }>;
  recentIncidents: CapabilityIncident[];
  guardrailPromotions: Array<{
    incidentId: string;
    packetBundleId: string;
    capabilityId: string;
    concernText: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    requestedAt: string;
    requestedBy?: string;
  }>;
  exportTargets?: IncidentExportTargetConfig[];
  recentDeliveries?: IncidentExportDelivery[];
}

export interface ReportFilter {
  capabilityId?: string;
  teamId?: string;
  status?: string[];
  phase?: WorkItemPhase[];
  dateFrom?: string;
  dateTo?: string;
  includeArchived?: boolean;
}

export interface ReportWorkItemSummary {
  capabilityId: string;
  capabilityName: string;
  workItemId: string;
  title: string;
  phase: WorkItemPhase;
  status: WorkItemStatus;
  priority: WorkItem['priority'];
  phaseOwnerTeamId?: string;
  claimOwnerUserId?: string;
  activeWriterUserId?: string;
  blockedAgeHours?: number;
  lastUpdatedAt?: string;
}

/**
 * One row in the Work Item Efficiency Report.
 * All numeric values default to 0 when no data exists for a work item.
 */
/** Per-agent contribution to a single work item. */
export interface AgentEfficiencyRow {
  agentId: string;
  agentName: string;
  /** Wall-clock hours the agent's run-steps were active (started → completed). */
  elapsedHours: number;
  /** Sum of cost_usd from tool invocations attributed to this agent's run-steps. */
  costUsd: number;
  /**
   * Approximate lines of code written by this agent — sum of newline counts
   * in the `content` / `new_content` fields of workspace_write,
   * workspace_replace_block, and workspace_apply_patch tool invocations.
   */
  linesOfCode: number;
  /**
   * Count of substantive artifacts produced by this agent for this work item
   * (PHASE_OUTPUT, CODE_PATCH, HANDOFF_PACKET, EVIDENCE_PACKET,
   * EXECUTION_PLAN, REVIEW_PACKET, EXECUTION_SUMMARY).
   */
  documentsProduced: number;
}

export interface WorkItemEfficiencyRow {
  workItemId: string;
  title: string;
  status: WorkItemStatus;
  phase: WorkItemPhase;
  priority: WorkItem['priority'];
  /** Sum of cost_usd across all metric samples scoped to this work item. */
  totalCostUsd: number;
  /** Sum of tokens across all metric samples scoped to this work item. */
  totalTokens: number;
  /** Wall-clock hours from first run start to last run end/update. */
  elapsedHours: number;
  /** Count of human-gated waits (APPROVAL, INPUT, CONFLICT_RESOLUTION). */
  humanInteractions: number;
  /** Hours the agent was paused waiting on a human decision. */
  humanWaitHours: number;
  /** Highest attempt_number across all runs (1 = no retry). */
  runAttempts: number;
  /**
   * Percentage of elapsed time the agent was running autonomously.
   * (elapsedHours - humanWaitHours) / elapsedHours × 100.
   * 100 when elapsedHours = 0 (no data yet).
   */
  agentAutonomyPct: number;
  /** Total lines of code written across all agents for this work item. */
  totalLinesOfCode: number;
  /** Total substantive documents produced across all agents for this work item. */
  totalDocumentsProduced: number;
  /** Per-agent contribution breakdown. */
  agentBreakdowns: AgentEfficiencyRow[];
}

export interface WorkItemEfficiencySnapshot {
  generatedAt: string;
  capabilityId: string;
  capabilityName: string;
  /** Totals across all rows for the header stat tiles. */
  totals: {
    totalCostUsd: number;
    totalTokens: number;
    avgElapsedHours: number;
    avgHumanInteractions: number;
    avgAgentAutonomyPct: number;
    totalLinesOfCode: number;
    totalDocumentsProduced: number;
  };
  rows: WorkItemEfficiencyRow[];
}

export interface ApprovalInboxEntry {
  capabilityId: string;
  capabilityName: string;
  workItemId?: string;
  workItemTitle?: string;
  runId: string;
  waitId: string;
  assignmentId: string;
  phase?: WorkItemPhase;
  stepName?: string;
  targetType: ApprovalRuleTarget;
  assignedUserId?: string;
  assignedTeamId?: string;
  dueAt?: string;
  status: ApprovalAssignmentStatus;
  ageHours: number;
}

export interface OperationsDashboardSnapshot {
  generatedAt: string;
  actorUserId?: string;
  actorDisplayName: string;
  myWork: ReportWorkItemSummary[];
  teamWork: ReportWorkItemSummary[];
  watching: ReportWorkItemSummary[];
  restartNeeded: ReportWorkItemSummary[];
  approvalInbox: ApprovalInboxEntry[];
  blockedCount: number;
  pendingApprovalCount: number;
  activeWriterConflicts: number;
}

export interface TeamQueueSnapshot {
  generatedAt: string;
  teamId: string;
  teamName: string;
  queue: ReportWorkItemSummary[];
  approvalInbox: ApprovalInboxEntry[];
  blockedCount: number;
  pendingApprovalCount: number;
  handoffWaitingCount: number;
  activeWriterConflicts: number;
  slaRiskCount: number;
}

export interface CapabilityHealthSnapshot {
  generatedAt: string;
  capabilityId: string;
  capabilityName: string;
  visibilityScope: CapabilityVisibilityScope;
  activeWorkCount: number;
  blockedCount: number;
  pendingApprovalCount: number;
  completedWorkCount: number;
  outputArtifactCount: number;
  evidenceCompleteness: number;
  totalRuns: number;
  failedRuns: number;
  waitingRuns: number;
  activeRuns: number;
  totalCostUsd: number;
  totalTokens: number;
  averageLatencyMs: number;
  publishFreshness: 'FRESH' | 'STALE' | 'MISSING';
  latestPublishedVersion?: number;
  latestPublishedAt?: string;
  dependencyCount: number;
  criticalDependencyCount: number;
  unresolvedVersionMismatchCount: number;
}

export interface CollectionRollupSnapshot {
  generatedAt: string;
  capabilityId: string;
  capabilityName: string;
  visibilityScope: CapabilityVisibilityScope;
  directChildren: CapabilityRollupChildSummary[];
  sharedCapabilities: CapabilityRollupChildSummary[];
  rollupSummary: CapabilityRollupSummary;
}

export interface ExecutiveSummarySnapshot {
  generatedAt: string;
  visibleCapabilityCount: number;
  activeWorkCount: number;
  blockedCount: number;
  pendingApprovalCount: number;
  completedWorkCount: number;
  totalRuns: number;
  failedRuns: number;
  waitingRuns: number;
  totalCostUsd: number;
}

export interface AuditReportSnapshot {
  generatedAt: string;
  accessEvents: AccessAuditEvent[];
  approvalDecisions: ApprovalDecision[];
  controlEvents: Array<{
    capabilityId: string;
    capabilityName: string;
    workItemId: string;
    workItemTitle: string;
    actor: string;
    action: string;
    timestamp: string;
    detail: string;
  }>;
  contractPublications: CapabilityPublishedSnapshot[];
}

export interface ReportExportPayload {
  reportType:
    | 'operations'
    | 'team'
    | 'capability'
    | 'collection'
    | 'executive'
    | 'audit';
  generatedAt: string;
  filters?: ReportFilter;
  payload:
    | OperationsDashboardSnapshot
    | TeamQueueSnapshot
    | CapabilityHealthSnapshot
    | CollectionRollupSnapshot
    | ExecutiveSummarySnapshot
    | AuditReportSnapshot;
}

export interface SsoIdentityLink {
  userId: string;
  ssoProvider: string;
  ssoSubjectId: string;
  linkedAt: string;
}

export interface DirectoryGroupMapping {
  id: string;
  directoryGroupName: string;
  workspaceRole: string;
  createdAt: string;
}

export interface ServiceAccountPrincipal {
  userId: string;
  description?: string;
  isInteractiveLoginDisabled: boolean;
  createdAt: string;
}

export interface SegregationOfDutiesPolicy {
  id: string;
  policyName: string;
  description?: string;
  restrictedAction: string;
  makerRole?: string;
  checkerRole?: string;
  preventSelfApproval: boolean;
  isActive: boolean;
  updatedAt: string;
}

export interface AccessAttestationRecord {
  id: string;
  userId: string;
  capabilityId?: string;
  roleAttested: string;
  attestedByUserId: string;
  attestedAt: string;
}

export type BusinessCriticality = 'HIGH' | 'MEDIUM' | 'LOW';

export interface CapabilityServiceProfile {
  capabilityId: string;
  businessCriticality: BusinessCriticality;
  serviceTier: string;
  controlOwnerUserId?: string;
  productionOwnerUserId?: string;
  dataClassification: string;
  rtoRpoTarget?: string;
  updatedAt: string;
}

export type ExecutionLaneType = 'DESKTOP' | 'MANAGED_POOL' | 'AUDIT_ONLY';

export interface ExecutionLane {
  id: string;
  name: string;
  laneType: ExecutionLaneType;
  description?: string;
  isActive: boolean;
  createdAt: string;
}

export interface RuntimeLanePolicy {
  id: string;
  capabilityId: string;
  executionLaneId: string;
  priority: number;
  createdAt: string;
}
