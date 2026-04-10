import { expect, test } from '@playwright/test';

test('loads the capability home workspace', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('body')).toContainText(/Capability Home|Readiness|Today/i);
});

test('opens the full-screen designer route', async ({ page }) => {
  await page.goto('/designer');

  await expect(page.locator('body')).toContainText(/Enterprise SDLC Flow|Create workflow|Workflow/i);
});

test('opens business workspaces', async ({ page }) => {
  await page.goto('/orchestrator');
  await expect(page.locator('body')).toContainText(/Orchestrator|Execution Workspace|Work/i);

  await page.goto('/team');
  await expect(page.locator('body')).toContainText(/Team|Collaborator|Agent/i);

  await page.goto('/chat');
  await expect(page.locator('body')).toContainText(/Collaboration|Chat|Agent/i);

  await page.goto('/ledger');
  await expect(page.locator('body')).toContainText(/Ledger|Evidence|Artifact/i);
});
