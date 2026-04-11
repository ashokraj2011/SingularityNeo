import { expect, test, type APIRequestContext } from '@playwright/test';
import { createDefaultCapabilityLifecycle } from '../../src/lib/capabilityLifecycle';
import { normalizeWorkflowGraph } from '../../src/lib/workflowGraph';
import type { CapabilityAgent, Workflow, WorkflowRun } from '../../src/types';

type CapabilityBundle = {
  capability: {
    id: string;
    name: string;
  };
  workspace: {
    agents: CapabilityAgent[];
  };
};

type WorkItemResponse = {
  id: string;
  title: string;
};

const buildMockRuntimeStatus = () => ({
  configured: true,
  provider: 'Playwright Runtime',
  endpoint: 'http://runtime.test',
  tokenSource: 'playwright',
  defaultModel: 'playwright-model',
  runtimeAccessMode: 'copilot-session',
  httpFallbackEnabled: false,
  streaming: true,
  githubIdentity: null,
  githubIdentityError: null,
  platformFeatures: {
    pgvectorAvailable: false,
    memoryEmbeddingDimensions: 64,
  },
  availableModels: [
    {
      id: 'playwright-model',
      label: 'Playwright Model',
      profile: 'test',
      apiModelId: 'playwright-model',
    },
  ],
});

const expectOk = async (response: Awaited<ReturnType<APIRequestContext['get']>>) => {
  if (!response.ok()) {
    throw new Error(await response.text());
  }
  return response;
};

const pollUntil = async <T>(
  action: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 15_000,
  intervalMs = 250,
) => {
  const startedAt = Date.now();
  let lastValue = await action();

  while (!predicate(lastValue)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for the expected state.`);
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    lastValue = await action();
  }

  return lastValue;
};

const listWorkflowRuns = async (
  request: APIRequestContext,
  capabilityId: string,
  workItemId: string,
) => {
  const response = await expectOk(
    await request.get(
      `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(
        workItemId,
      )}/runs`,
    ),
  );
  return (await response.json()) as WorkflowRun[];
};

const createCapabilityFixture = async (
  request: APIRequestContext,
  suffix: string,
) => {
  const response = await expectOk(
    await request.post('/api/capabilities', {
      data: {
        name: `Orchestrator Approval ${suffix}`,
        description: 'Capability used to validate orchestrator control flows.',
        domain: 'E2E',
        businessUnit: 'Quality',
        ownerTeam: 'QA',
        lifecycle: createDefaultCapabilityLifecycle(),
      },
    }),
  );

  return (await response.json()) as CapabilityBundle;
};

const createApprovalWorkflow = (capabilityId: string, ownerAgentId: string): Workflow =>
  normalizeWorkflowGraph({
    id: `WF-APPROVAL-${capabilityId}`,
    capabilityId,
    name: 'Approval Gate Workflow',
    steps: [
      {
        id: `STEP-APPROVAL-${capabilityId}`,
        name: 'Capability owner approval',
        phase: 'ANALYSIS',
        stepType: 'HUMAN_APPROVAL',
        agentId: ownerAgentId,
        action: 'Review and approve the staged work item before execution continues.',
        description: 'Deterministic approval gate for Orchestrator control coverage.',
        approverRoles: ['Capability Owner'],
      },
    ],
    publishState: 'PUBLISHED',
    status: 'STABLE',
    workflowType: 'Custom',
    scope: 'CAPABILITY',
    summary: 'Single approval step used for deterministic control-surface testing.',
  });

const patchCapabilityWorkflow = async (
  request: APIRequestContext,
  capabilityId: string,
  workflow: Workflow,
) => {
  await expectOk(
    await request.patch(`/api/capabilities/${encodeURIComponent(capabilityId)}/workspace`, {
      data: {
        workflows: [workflow],
      },
    }),
  );
};

const createWorkItemFixture = async (
  request: APIRequestContext,
  capabilityId: string,
  workflowId: string,
  title: string,
) => {
  const response = await expectOk(
    await request.post(`/api/capabilities/${encodeURIComponent(capabilityId)}/work-items`, {
      data: {
        title,
        workflowId,
        priority: 'Med',
        tags: ['e2e', 'approval'],
        description: 'Work item for approval and reset coverage.',
      },
    }),
  );

  return (await response.json()) as WorkItemResponse;
};

test('orchestrator resolves approval waits and can reset progress into a new attempt', async ({
  page,
  request,
}) => {
  const suffix = `${Date.now()}`.slice(-6);
  const capabilityBundle = await createCapabilityFixture(request, suffix);
  const capabilityId = capabilityBundle.capability.id;
  const capabilityName = capabilityBundle.capability.name;
  const ownerAgentId =
    capabilityBundle.workspace.agents.find(agent => agent.isOwner)?.id ||
    capabilityBundle.workspace.agents[0]?.id;

  expect(ownerAgentId).toBeTruthy();

  const workflow = createApprovalWorkflow(capabilityId, ownerAgentId!);
  await patchCapabilityWorkflow(request, capabilityId, workflow);

  const workItem = await createWorkItemFixture(
    request,
    capabilityId,
    workflow.id,
    `Approval Work ${suffix}`,
  );

  await page.route('**/api/runtime/status', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildMockRuntimeStatus()),
    });
  });

  await page.goto(`/orchestrator?selected=${encodeURIComponent(workItem.id)}`);
  await page.getByLabel('Switch capability').click();
  await page.getByRole('button', { name: new RegExp(capabilityName) }).click();

  await expect(page.locator('body')).toContainText(workItem.title);
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /Start execution|Start from current phase/i }),
  ).toBeEnabled();

  await page.getByRole('button', { name: /Start execution|Start from current phase/i }).click();

  const firstWaitingRun = await pollUntil(
    () => listWorkflowRuns(request, capabilityId, workItem.id),
    runs => runs[0]?.status === 'WAITING_APPROVAL',
  );
  expect(firstWaitingRun[0]?.attemptNumber).toBe(1);

  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('body')).toContainText(/Waiting Approval|Waiting for Approval/i);
  await expect(
    page.getByRole('button', { name: 'Approve and continue', exact: true }),
  ).toBeEnabled();

  await page.getByRole('button', { name: 'Approve and continue', exact: true }).click();

  const completedRun = await pollUntil(
    () => listWorkflowRuns(request, capabilityId, workItem.id),
    runs => runs[0]?.status === 'COMPLETED',
  );
  expect(completedRun[0]?.attemptNumber).toBe(1);

  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('body')).toContainText(/Completed/i);
  await expect(
    page.getByRole('button', { name: 'Reset progress and restart', exact: true }),
  ).toBeEnabled();

  await page.getByRole('button', { name: 'Reset progress and restart', exact: true }).click();

  const restartedRun = await pollUntil(
    () => listWorkflowRuns(request, capabilityId, workItem.id),
    runs => runs[0]?.status === 'WAITING_APPROVAL' && runs[0]?.attemptNumber === 2,
  );
  expect(restartedRun[0]?.attemptNumber).toBe(2);

  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('body')).toContainText(/Attempt\s*2/i);
  await expect(page.locator('body')).toContainText(/Waiting Approval|Waiting for Approval/i);
});
