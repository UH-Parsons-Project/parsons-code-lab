// @ts-check
import { test, expect } from '@playwright/test';
import { loginTeacher } from './test-helpers.js';

test.describe('All Task Sets Page', () => {
  test.beforeEach(async ({ page }) => {
    // Login as admin teacher
    await loginTeacher(page, 'matti.ruotsalainen@example.com', 'test1234');
    await expect(page).toHaveURL(/\/teacher-dashboard$/);
  });

  test('renders all task sets page with header, filter menu, and task set items', async ({ page }) => {
    // Navigate to /all-tasksets
    await page.goto('/all-tasksets');

    // Page header elements
    await expect(page.locator('.page-title')).toHaveText('All Task Sets');
    await expect(page.locator('.page-subtitle')).toContainText('Showing all task sets');

    // Search and filter button & task sets container
    await expect(page.locator('#task-filter-toggle')).toBeVisible();
    await page.waitForSelector('#task-sets-container', { timeout: 10000 });

    // Open search and filter panel
    await page.locator('#task-filter-toggle').click();
    await expect(page.locator('#task-filter-panel')).toHaveClass(/show/);
    await expect(page.locator('#task-search')).toBeVisible();

    // Verify task set cards exist or empty state is rendered cleanly
    await expect(page.locator('.task-set-item').first().or(page.locator('.empty-state'))).toBeVisible({ timeout: 10000 });

    const taskSetItems = page.locator('.task-set-item');
    const count = await taskSetItems.count();

    if (count > 0) {
      // Check first item structure
      const firstItem = taskSetItems.first();
      await expect(firstItem.locator('.task-set-title')).toBeVisible();
      await expect(firstItem.locator('.task-set-code-chip')).toBeVisible();
    } else {
      await expect(page.locator('.empty-state')).toBeVisible();
    }
  });

  test('filters task sets by search query', async ({ page }) => {
    await page.goto('/all-tasksets');
    await page.waitForSelector('#task-sets-container', { timeout: 10000 });

    // Open filter panel
    await page.locator('#task-filter-toggle').click();

    // Type a non-matching query
    await page.locator('#task-search').fill('NonExistentTaskSetXYZ999');

    // Verify empty state is displayed
    await expect(page.locator('.empty-state')).toBeVisible();
    await expect(page.locator('.empty-state h4')).toHaveText('No Task Sets Found');

    // Clear search
    await page.locator('#task-search').fill('');
  });

  test('shows Open for task sets without an explicit opening date', async ({ page }) => {
    const title = `Open status ${Date.now()}`;
    const response = await page.request.post('/api/create_task_set', {
      data: {
        title,
        student_description: null,
        teacher_description: null,
        opens_at: null,
        expires_at: null,
        task_ids: [],
      },
    });

    expect(response.ok()).toBeTruthy();

    await page.goto('/teacher-dashboard');
    const dashboardCard = page.locator('.task-set-item').filter({ hasText: title });
    await expect(dashboardCard).toBeVisible();
    await expect(dashboardCard.locator('.task-set-meta')).toContainText('Open');
    await expect(dashboardCard.locator('.task-set-meta')).not.toContainText('Opens');

    await page.goto('/all-tasksets');
    const allSetsCard = page.locator('.task-set-item').filter({ hasText: title });
    await expect(allSetsCard).toBeVisible();
    await expect(allSetsCard.locator('.task-set-meta')).toContainText('Open');
    await expect(allSetsCard.locator('.task-set-meta')).not.toContainText('Opens');
  });

  test('shows Expired instead of Open for expired task sets', async ({ page }) => {
    const title = `Expired status ${Date.now()}`;
    const response = await page.request.post('/api/create_task_set', {
      data: {
        title,
        student_description: null,
        teacher_description: null,
        opens_at: null,
        expires_at: '2020-01-01T12:00:00.000Z',
        task_ids: [],
      },
    });

    expect(response.ok()).toBeTruthy();

    await page.goto('/all-tasksets');
    const card = page.locator('.task-set-item').filter({ hasText: title });
    await expect(card).toBeVisible();
    await expect(card.locator('.task-set-meta')).toContainText('Expired');
    await expect(card.locator('.task-set-meta')).not.toContainText('Open');
  });
});
