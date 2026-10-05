// @ts-check
import { test, expect } from '@playwright/test';
import {
  registerTeacher,
  loginTeacher,
  createTaskSetWithTasks,
} from './test-helpers.js';

async function createTaskSetAndOpenOverview(page, suffix) {
  const username = `overview_status_${suffix}`;
  const email = `${username}@example.com`;
  const title = `Overview Status ${suffix}`;

  await registerTeacher(page, username, email, 'password123');
  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
  await loginTeacher(page, email, 'password123');
  await expect(page).toHaveURL(/\/teacher-dashboard$/);

  await createTaskSetWithTasks(page, title, 'Student description', 'Teacher description', ['add_in_range']);

  const response = await page.request.get('/api/my_sets');
  expect(response.ok()).toBeTruthy();
  const taskSets = await response.json();
  const taskSet = taskSets.find((set) => set.title === title);
  expect(taskSet).toBeTruthy();

  await page.goto(`/task-set-overview?set_id=${taskSet.id}`);
  await page.waitForSelector('#content-container', { state: 'visible', timeout: 10000 });

  return taskSet.id;
}

async function updateTaskSet(page, taskSetId, field, value) {
  const response = await page.request.patch(`/api/my_sets/${taskSetId}/${field}`, {
    data: { [field]: value },
  });
  expect(response.ok()).toBeTruthy();
  await page.reload();
  await page.waitForSelector('#content-container', { state: 'visible', timeout: 10000 });
}

test.describe('Task Set Overview Opening Status', () => {
	test('shows Open and keeps the opening date editor when no opening date is set', async ({ page }) => {
		await createTaskSetAndOpenOverview(page, Date.now());

		await expect(page.locator('#opening-section')).toContainText('Open');
		await expect(page.locator('#edit-opening-btn')).toHaveAttribute('title', 'Edit opening date');

    await page.locator('#edit-opening-btn').click();
    await expect(page.locator('#opening-input')).toBeVisible();
  });

  test('shows Opens for a future opening date', async ({ page }) => {
		const taskSetId = await createTaskSetAndOpenOverview(page, `${Date.now()}-future`);
		await updateTaskSet(page, taskSetId, 'opens_at', '2099-01-01T12:00:00.000Z');

		await expect(page.locator('#opening-section')).toContainText('Opens');
		await expect(page.locator('#edit-opening-btn')).toHaveAttribute('title', 'Edit opening date');
  });

  test('shows Opened for a past opening date', async ({ page }) => {
		const taskSetId = await createTaskSetAndOpenOverview(page, `${Date.now()}-opened`);
		await updateTaskSet(page, taskSetId, 'opens_at', '2020-01-01T12:00:00.000Z');

		await expect(page.locator('#opening-section')).toContainText('Opened');
		await expect(page.locator('#edit-opening-btn')).toHaveAttribute('title', 'Edit opening date');
  });

  test('shows Expired instead of Open for an expired task set', async ({ page }) => {
    const taskSetId = await createTaskSetAndOpenOverview(page, `${Date.now()}-expired`);
    await updateTaskSet(page, taskSetId, 'expires_at', '2020-01-01T12:00:00.000Z');

    await expect(page.locator('#expiry-section')).toContainText('Expired');
    await expect(page.locator('#opening-section')).not.toContainText('Open');
  });
});
