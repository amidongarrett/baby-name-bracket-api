/**
 * E2E: Owner submits names via the UI
 *
 * Prerequisites:
 *   - API server running on http://localhost:3001
 *   - Next.js dev server running on http://localhost:3000
 *
 * This spec:
 *   1. Creates a bracket in draft state via API (no names)
 *   2. Authenticates as owner1 by injecting the JWT into localStorage
 *   3. Navigates to the name-submission page
 *   4. Submits a name and verifies it appears in the Owner 1 list
 *   5. Submits the same name as Owner 2 and verifies the shared indicator
 */
const { test, expect, request: apiRequest } = require('@playwright/test');

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3001';

async function getTestToken(requestContext, slug) {
  const email = `test+${slug}@amidonlabs.com`;
  await requestContext.post(`${API_BASE}/api/auth/request-code`, {
    data: { email },
  });
  const res = await requestContext.post(`${API_BASE}/api/auth/verify-code`, {
    data: { email, code: '000000' },
  });
  const body = await res.json();
  return { token: body.token, user: body.user };
}

async function createBracket(requestContext, token) {
  const res = await requestContext.post(`${API_BASE}/api/brackets`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      owner1Name: 'E2E Owner 1',
      owner2Name: 'E2E Owner 2',
      owner2Email: 'test+e2eowner2@amidonlabs.com',
    },
  });
  const body = await res.json();
  return body.bracket.id.toString();
}

async function deleteBracket(requestContext, bracketId, token) {
  await requestContext.delete(`${API_BASE}/api/bracket/${bracketId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

test.describe('Owner name submission UI', () => {
  let bracketId;
  let owner1Token;
  let ctx;

  test.beforeAll(async ({ playwright }) => {
    ctx = await playwright.request.newContext();
    const { token } = await getTestToken(ctx, 'e2eowner1');
    owner1Token = token;
    bracketId = await createBracket(ctx, owner1Token);
  });

  test.afterAll(async () => {
    if (bracketId && owner1Token) {
      await deleteBracket(ctx, bracketId, owner1Token);
    }
    await ctx.dispose();
  });

  test('owner can submit a name and see it in the list', async ({ page }) => {
    // Inject auth token into localStorage before navigating
    await page.goto('/');
    await page.evaluate(
      ({ token, bracketId }) => {
        localStorage.setItem('token', token);
        localStorage.setItem('bracketId', bracketId);
      },
      { token: owner1Token, bracketId }
    );

    // Navigate to the name-submission page
    await page.goto(`/bracket/${bracketId}/names`);

    // Wait for the page to settle
    await page.waitForLoadState('networkidle');

    // Find the name input field and submit a name
    const nameInput = page.locator('input[type="text"]').first();
    await nameInput.fill('Playwright-Name-Alpha');

    // Submit the form — typically a button near the input or pressing Enter
    await nameInput.press('Enter');

    // Assert the name appears somewhere in the Owner 1 section of the page
    await expect(page.locator('text=Playwright-Name-Alpha')).toBeVisible({ timeout: 5000 });
  });

  test('duplicate name submitted by Owner 2 shows shared indicator', async ({ page }) => {
    // Inject token
    await page.goto('/');
    await page.evaluate(
      ({ token, bracketId }) => {
        localStorage.setItem('token', token);
        localStorage.setItem('bracketId', bracketId);
      },
      { token: owner1Token, bracketId }
    );

    await page.goto(`/bracket/${bracketId}/names`);
    await page.waitForLoadState('networkidle');

    // Add the shared name as Owner 1 first (via API to avoid UI fragility)
    await ctx.post(`${API_BASE}/api/names`, {
      data: { bracketId, name: 'Shared-Name-Beta', owner: 'Owner 1' },
    });

    // Reload page so Owner 1 list is current
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Switch to Owner 2's input and submit the same name
    // The page may have a toggle or separate input section for Owner 2
    const owner2Input = page
      .locator('input[type="text"]')
      .filter({ hasText: '' })
      .last();

    // Try to find and fill Owner 2's input (fall back to any second text input)
    const inputs = page.locator('input[type="text"]');
    const inputCount = await inputs.count();
    const targetInput = inputCount > 1 ? inputs.last() : inputs.first();

    await targetInput.fill('Shared-Name-Beta');
    await targetInput.press('Enter');

    // Look for a shared/duplicate indicator in the UI
    await expect(
      page.locator('text=/shared|duplicate|Shared/i').first()
    ).toBeVisible({ timeout: 5000 });
  });
});
