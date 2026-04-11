import { expect, test, type Page } from '@playwright/test';

const CHAT_RUNTIME_FEEDBACK =
  /runtime is not configured|Chat request failed|Rate limited|GitHub Models is rate-limiting requests|The backend runtime is not configured/i;

const escapeForRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const continueThroughOnboarding = async (page: Page) => {
  for (const stepTitle of [
    'Connectors',
    'Workspace Approval',
    'Commands',
    'Deployment & Review',
  ]) {
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: stepTitle })).toBeVisible();
  }
};

test('creates a capability and exercises the core business workspaces', async ({ page }) => {
  const suffix = `${Date.now()}`.slice(-6);
  const capabilityName = `E2E Capability ${suffix}`;
  const ownerTeam = `E2E Team ${suffix}`;
  const updatedOwnerTeam = `${ownerTeam} Updated`;
  const workItemTitle = `E2E Work ${suffix}`;
  const chatPrompt = `Summarize the next action for ${capabilityName}.`;
  const chatOutcomePattern = new RegExp(
    `${escapeForRegex(chatPrompt)}|${CHAT_RUNTIME_FEEDBACK.source}`,
    'i',
  );

  await page.goto('/capabilities/new');
  await expect(
    page.getByRole('heading', { name: /Create a real capability workspace/i }),
  ).toBeVisible();

  await page.getByLabel('Capability name').fill(capabilityName);
  await page.getByLabel('Domain').fill('E2E Domain');
  await page.getByLabel('Business unit').fill('E2E Unit');
  await page.getByLabel('Owner team').fill(ownerTeam);
  await page
    .getByLabel('Capability purpose')
    .fill('End-to-end coverage for the primary capability workflow.');
  await page
    .getByLabel('Business outcome')
    .fill('Give business owners a trustworthy, end-to-end capability flow.');
  await page
    .getByLabel('Success metrics')
    .fill('Every completed work item produces evidence.');

  await continueThroughOnboarding(page);

  await expect(page.getByRole('button', { name: /Create real capability/i })).toBeEnabled();
  await page.getByRole('button', { name: /Create real capability/i }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTitle(`Open ${capabilityName}`)).toBeVisible();
  await page.getByTitle(`Open ${capabilityName}`).click();

  await expect(page).toHaveURL(/\/capabilities\/metadata/);
  await page.getByLabel('Owner team').fill(updatedOwnerTeam);
  await page.getByRole('button', { name: /Save metadata/i }).click();
  await expect(page.locator('body')).toContainText(/Capability metadata saved/i);

  await page.getByRole('link', { name: 'Team', exact: true }).click();
  await expect(page).toHaveURL(/\/team/);
  await expect(page.getByRole('heading', { name: capabilityName })).toBeVisible();
  await page.getByRole('button', { name: /Use in chat/i }).click();

  await expect(page).toHaveURL(/\/chat/);
  await expect(page.getByRole('heading', { name: capabilityName })).toBeVisible();

  const composer = page.locator('textarea').last();
  await expect(composer).toBeVisible();
  await composer.fill(chatPrompt);
  await page.getByRole('button', { name: /^Send$/i }).click();

  await expect(page.locator('body')).toContainText(chatOutcomePattern, {
    timeout: 20_000,
  });

  await page.getByRole('link', { name: 'Work', exact: true }).click();
  await expect(page).toHaveURL(/\/orchestrator/);
  await page.getByRole('button', { name: /New Work Item/i }).click();
  await expect(page.getByRole('heading', { name: /Stage new work/i })).toBeVisible();

  const createForm = page.locator('#orchestrator-create-work-item');
  await createForm.getByLabel('Work item title').fill(workItemTitle);
  await createForm
    .getByLabel('Description')
    .fill('Exercise the work board and evidence workspace.');
  await page.getByRole('button', { name: 'Create work item', exact: true }).click();

  await expect(createForm).toBeHidden();
  await expect(page.locator('body')).toContainText(workItemTitle);

  await page.getByRole('link', { name: 'Evidence', exact: true }).click();
  await expect(page).toHaveURL(/\/ledger/);
  await expect(page.locator('body')).toContainText(`${capabilityName} Ledger`);
  await page.getByRole('button', { name: /Flight Recorder/i }).click();
  await expect(page.locator('body')).toContainText(
    /Work Item Flight Recorder|No work item flight records/i,
  );
});
