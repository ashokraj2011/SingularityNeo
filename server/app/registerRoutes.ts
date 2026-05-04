import type express from 'express';
import { registerAgentGitRoutes } from '../routes/agentGit';
import { registerBlastRadiusRoutes } from '../routes/blastRadius';
import { registerBootstrapRoutes } from '../routes/bootstrap';
import { registerCapabilityManagementRoutes } from '../routes/capabilityManagement';
import { registerCodeWorkspaceRoutes } from '../routes/codeWorkspaces';
import { registerDeliveryAssetRoutes } from '../routes/deliveryAssets';
import { registerExecutionRuntimeRoutes } from '../routes/executionRuntime';
import { registerGovernanceRoutes } from '../routes/governance';
import { registerIncidentRoutes } from '../routes/incidents';
import { registerLlmContextLogRoutes } from '../routes/llmContextLog';
import { registerPassportRoutes } from '../routes/passport';
import { registerReportingEvidenceRoutes } from '../routes/reportingEvidence';
import { registerRuntimeChatRoutes } from '../routes/runtimeChat';
import { registerRuntimeRoutes } from '../routes/runtime';
import { registerRuntimeSettingsRoutes } from '../routes/runtimeSettings';
import { registerSentinelRoutes } from '../routes/sentinel';
import { registerStepTemplateRoutes } from '../routes/stepTemplates';
import { registerStoryProposalRoutes } from '../routes/storyProposals';
import { registerSwarmChatRoutes } from '../routes/swarmChat';
import { registerTokenManagementRoutes } from '../routes/tokenManagement';
import { registerWorkItemRoutes } from '../routes/workItems';
import { registerWorkflowRunRoutes } from '../routes/workflowRuns';
import { registerWorkspaceAccessRoutes } from '../routes/workspaceAccess';
import { registerWorldModelRoutes } from '../routes/worldModel';
import { bindRequestActorContext, parseActorContext } from '../domains/access';
import {
  buildMemoryContext,
  maybeHandleCapabilityChatAction,
  refreshCapabilityMemory,
} from '../domains/context-fabric';
import {
  GitHubProviderRateLimitError,
  evictManagedCapabilitySessions,
  invokeCapabilityChat,
  invokeCapabilityChatStream,
} from '../domains/llm-gateway';
import { buildRuntimeStatus, getMissingRuntimeConfigurationMessage } from '../domains/model-policy';
import {
  finishTelemetrySpan,
  recordUsageMetrics,
  startTelemetrySpan,
  createTraceId,
} from '../domains/platform';
import {
  assertCapabilitySupportsExecution,
  applyManualBranchPolicy,
  inspectCodeWorkspace,
  parseActor,
  runGitCommand,
  toSafeDownloadName,
  writeSseEvent,
  ZERO_RUNTIME_USAGE,
} from './executionSupport';
import {
  buildChatMemoryPrompt,
  buildCopilotSessionMonitorSnapshot,
  isRuntimeConfigured,
  resolveChatRuntimeContext,
} from './chatRuntime';
import {
  bootstrapWorkspaceDatabaseAndStandards,
  getDatabaseBootstrapProfileSnapshot,
  persistDatabaseBootstrapProfileSnapshot,
  awaitStartupInitialization,
} from './runtimeBootstrap';
import {
  ensureAgentCreatePayload,
  ensureCapabilityCreatePayload,
  normalizeCapabilityRepositoriesPayload,
} from './capabilityPayloads';
import { createRuntimeId } from './runtimeIds';
import { resolveWritableAgentModel } from './writableModel';

export const registerAllRoutes = (
  app: express.Express,
  uploadFilesMiddleware: express.RequestHandler,
) => {
  registerBootstrapRoutes(app, {
    bootstrapWorkspaceDatabaseAndStandards,
    getDatabaseBootstrapProfileSnapshot,
    persistDatabaseBootstrapProfileSnapshot,
  });

  app.use(bindRequestActorContext);
  registerWorkspaceAccessRoutes(app, {
    awaitStartupInitialization,
    buildCopilotSessionMonitorSnapshot,
  });
  registerReportingEvidenceRoutes(app);
  registerGovernanceRoutes(app);

  registerDeliveryAssetRoutes(app, {
    assertCapabilitySupportsExecution,
    toSafeDownloadName,
    uploadFilesMiddleware,
  });

  registerCapabilityManagementRoutes(app, {
    ensureAgentCreatePayload,
    ensureCapabilityCreatePayload,
    normalizeCapabilityRepositoriesPayload,
    resolveWritableAgentModel,
  });
  registerAgentGitRoutes(app);
  registerWorkItemRoutes(app, {
    applyManualBranchPolicy,
    assertCapabilitySupportsExecution,
    createRuntimeId,
    parseActor,
  });
  registerStoryProposalRoutes(app, {
    parseActorContext,
  });
  registerWorkflowRunRoutes(app, {
    parseActor,
    writeSseEvent,
  });

  registerCodeWorkspaceRoutes(app, {
    applyManualBranchPolicy,
    inspectCodeWorkspace,
    runGitCommand,
  });

  registerRuntimeRoutes(app);
  registerLlmContextLogRoutes(app);
  registerRuntimeSettingsRoutes(app);
  registerTokenManagementRoutes(app);
  registerExecutionRuntimeRoutes(app);
  registerStepTemplateRoutes(app);
  registerIncidentRoutes(app, { parseActorContext });
  registerPassportRoutes(app);
  registerBlastRadiusRoutes(app);
  registerWorldModelRoutes(app);
  registerSentinelRoutes(app, { parseActor });
  registerRuntimeChatRoutes(app, {
    ZERO_RUNTIME_USAGE,
    GitHubProviderRateLimitError,
    buildChatMemoryPrompt,
    buildMemoryContext,
    createTraceId,
    evictManagedCapabilitySessions,
    finishTelemetrySpan,
    getMissingRuntimeConfigurationMessage,
    invokeCapabilityChat,
    invokeCapabilityChatStream,
    isRuntimeConfigured,
    maybeHandleCapabilityChatAction,
    recordUsageMetrics,
    refreshCapabilityMemory,
    resolveChatRuntimeContext,
    startTelemetrySpan,
    writeSseEvent,
  });
  registerSwarmChatRoutes(app, {
    parseActor,
    writeSseEvent,
  });
};
