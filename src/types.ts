export type Status = 'PENDING' | 'VERIFIED' | 'RUNNING' | 'STABLE' | 'ALERT' | 'BETA' | 'IN_PROGRESS' | 'ARCHIVED' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'URGENT';

export type SkillKind = 'GENERAL' | 'ROLE' | 'CUSTOM' | 'LEARNING';
export type SkillOrigin = 'FOUNDATION' | 'CAPABILITY';
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

export interface CapabilityExecutionConfig {
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
  | 'ERROR';

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
  provider: 'GitHub Copilot SDK' | 'GitHub Copilot API';
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
  | 'HANDOFF_PACKET'
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

export type WorkflowStepType = 'DELIVERY' | 'GOVERNANCE_GATE' | 'HUMAN_APPROVAL';

export type ToolAdapterId =
  | 'workspace_list'
  | 'workspace_read'
  | 'workspace_search'
  | 'git_status'
  | 'workspace_write'
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
  | 'LEARNING';

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
  };
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
    | 'MANUAL_REFRESH'
    | 'SKILL_CHANGE';
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
} & Record<string, any>;

export interface WorkflowRun {
  id: string;
  capabilityId: string;
  workItemId: string;
  workflowId: string;
  status: WorkflowRunStatus;
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
  createdAt: string;
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
