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
});
