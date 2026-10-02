// @ts-check
import { test, expect } from '@playwright/test';
import {
  registerTeacher,
  loginTeacher,
  createTaskSetWithTasks,
  logoutTeacher,
} from './test-helpers.js';

test.describe('Task Set Duplication', () => {
  test('owner can duplicate a task set and update copy-specific configuration', async ({ page }) => {
    const unique = Date.now();
    const teacherUsername = `duplicate_owner_${unique}`;
    const teacherEmail = `duplicate_owner_${unique}@example.com`;
    const teacherPassword = 'password123';
    const sourceTitle = `Duplicate Source ${unique}`;

    await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
    await loginTeacher(page, teacherEmail, teacherPassword);
    await expect(page).toHaveURL(/\/teacher-dashboard$/);

    await createTaskSetWithTasks(
      page,
      sourceTitle,
      `Student description ${unique}`,
      `Teacher description ${unique}`,
      ['add_in_range', 'greater_num']
    );
    await page.waitForURL(/\/teacher-dashboard$/, { timeout: 15000 });

    await page.locator('.task-set-title', { hasText: sourceTitle }).click();
    await page.waitForURL(/\/task-set-overview\?set_id=/, { timeout: 10000 });
    await page.waitForSelector('#content-container', { state: 'visible', timeout: 10000 });

    const sourceSetId = new URL(page.url()).searchParams.get('set_id');
    expect(sourceSetId).toBeTruthy();
    await expect(page.locator('#duplicate-task-set-btn')).toBeVisible();

    const duplicateModal = page.locator('#duplicate-task-set-modal');
    await page.locator('#duplicate-task-set-btn').click();
    await expect(duplicateModal).toBeVisible();
    await expect(page.locator('#duplicate-task-set-title-input')).toHaveValue(`Copy of ${sourceTitle}`);

    await duplicateModal.getByRole('button', { name: 'Cancel' }).click();
    await expect(duplicateModal).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`set_id=${sourceSetId}$`));

    const copyTitle = `Week 2 Exercises ${unique}`;
    await page.locator('#duplicate-task-set-btn').click();
    await page.locator('#duplicate-task-set-title-input').fill(copyTitle);
    await page.locator('#confirm-duplicate-task-set-btn').click();
    await expect(page.locator('#confirm-duplicate-task-set-btn')).toBeDisabled();
    await page.waitForURL(
      url => url.pathname === '/task-set-overview' && url.searchParams.get('set_id') !== sourceSetId,
      { timeout: 15000 }
    );
    await page.waitForSelector('#content-container', { state: 'visible', timeout: 10000 });

    const copySetId = new URL(page.url()).searchParams.get('set_id');
    expect(copySetId).toBeTruthy();
    expect(copySetId).not.toBe(sourceSetId);
    await expect(page.locator('.taskset-page-title')).toHaveText(copyTitle);

    const copiedTaskTitles = page.locator('#tasks-list-active .task-set-title');
    await expect(copiedTaskTitles).toHaveText(['add_in_range', 'greater_num']);

    const linkCodeBeforeRename = (await page.locator('#link-code').textContent()).trim();
    const renamedTitle = `Renamed Task Set ${unique}`;
    await page.locator('#edit-title-btn').click();
    await page.locator('#task-set-title-input').fill(renamedTitle);
    await page.locator('#save-title-btn').click();
    await expect(page.locator('#task-set-title-display')).toHaveText(renamedTitle);
    await expect(page.locator('#link-code')).toHaveText(linkCodeBeforeRename);

    const renamedResponse = await page.request.get(`/api/my_sets/${copySetId}`);
    expect(renamedResponse.ok()).toBeTruthy();
    const renamedTaskSet = await renamedResponse.json();
    expect(renamedTaskSet.title).toBe(renamedTitle);
    expect(renamedTaskSet.unique_link_code).toBe(linkCodeBeforeRename.split('/').pop());

    // Update the copy through the overview UI and verify that the source stays unchanged.
    await page.locator('#edit-opening-btn').click();
    await page.locator('#opening-input').fill('2099-01-02T10:00');
    await page.locator('#save-opening-btn').click();
    await expect(page.locator('#opening-section')).toContainText('Opens');

    const copiedResponse = await page.request.get(`/api/my_sets/${copySetId}`);
    expect(copiedResponse.ok()).toBeTruthy();
    expect((await copiedResponse.json()).opens_at).toBeTruthy();

    await page.goto(`/task-set-overview?set_id=${sourceSetId}`);
    await page.waitForSelector('#content-container', { state: 'visible', timeout: 10000 });
    await expect(page.locator('.taskset-page-title')).toHaveText(sourceTitle);
    await expect(page.locator('#opening-section')).toContainText('Set opening date');
  });

  test('shared viewers do not see the duplicate action', async ({ page }) => {
    const unique = Date.now();
    const ownerUsername = `duplicate_view_owner_${unique}`;
    const ownerEmail = `duplicate_view_owner_${unique}@example.com`;
    const viewerUsername = `duplicate_viewer_${unique}`;
    const viewerEmail = `duplicate_viewer_${unique}@example.com`;
    const password = 'password123';
    const sourceTitle = `Viewer Duplication Source ${unique}`;

    await registerTeacher(page, viewerUsername, viewerEmail, password);
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
    await registerTeacher(page, ownerUsername, ownerEmail, password);
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
    await loginTeacher(page, ownerEmail, password);
    await expect(page).toHaveURL(/\/teacher-dashboard$/);

    await createTaskSetWithTasks(
      page,
      sourceTitle,
      'Student description',
      'Teacher description',
      ['add_in_range']
    );
    await page.waitForURL(/\/teacher-dashboard$/, { timeout: 15000 });
    await page.locator('.task-set-title', { hasText: sourceTitle }).click();
    await page.waitForURL(/\/task-set-overview\?set_id=/, { timeout: 10000 });
    await page.waitForSelector('#content-container', { state: 'visible', timeout: 10000 });

    await page.locator('#viewer-identifier').fill(viewerEmail);
    await page.locator('#add-viewer-btn').click();
    await expect(page.locator('#viewers-list')).toContainText(viewerEmail);

    await logoutTeacher(page);
    await loginTeacher(page, viewerEmail, password);
    await expect(page).toHaveURL(/\/teacher-dashboard$/);
    await page.locator('.task-set-title', { hasText: sourceTitle }).click();
    await page.waitForURL(/\/task-set-overview\?set_id=/, { timeout: 10000 });
    await page.waitForSelector('#content-container', { state: 'visible', timeout: 10000 });

    await expect(page.locator('#duplicate-task-set-btn')).toHaveCount(0);
    await expect(page.locator('#edit-title-btn')).toHaveCount(0);
  });
});
