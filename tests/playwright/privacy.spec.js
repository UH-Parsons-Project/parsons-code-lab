// @ts-check
import { test, expect } from '@playwright/test';
import { registerTeacher, loginTeacher, logoutTeacher } from './test-helpers.js';

test('task privacy toggle: private task visible to owner, hidden from other teacher', async ({ page }) => {
  const unique = Date.now();
  const teacher1 = `teacher_priv_${unique}`;
  const email1 = `teacher_priv_${unique}@example.com`;
  const password = 'password123';
  const title = `private_task_${unique}`;

  // Register and login as teacher1
  await registerTeacher(page, teacher1, email1, password);
  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
  await loginTeacher(page, email1, password);
  await expect(page).toHaveURL(/\/teacher-dashboard$/);

  // Prepare the task code and block representation for the editor.
  const taskCode = 'def test_private():\n    return 1';
  const blocksRepr = 'def test_private(): #0given\nreturn 1 #1given';

  // Create new task and go through editor flow
  const newTaskLink = page.locator('a[href="/create-task"]');
  await expect(newTaskLink).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/create-task$/,{ timeout: 20000 }),
    newTaskLink.click(),
  ]);

  // Click continue to block builder
  await page.locator('#task-code').fill(taskCode);
  await page.locator('#task-tests').fill('assert test_private() == 1');
  await page.evaluate(({ taskCode, blocksRepr }) => {
    sessionStorage.setItem('create_task_builder_blocks', blocksRepr);
    sessionStorage.setItem('create_task_builder_blocks_source', taskCode);
  }, { taskCode, blocksRepr });
  await page.locator('#submit-task').click();
  await page.waitForURL(/\/create-task-editor/, { timeout: 20000 });

  // Fill minimal meta and run tests
  await page.locator('#task-title').fill(title);
  await page.locator('#problem-description').fill('Private task description');
  await page.locator('#start-description').fill('Start intro');
  await page.locator('#task-type').selectOption('functions');
  // Wait for the Parsons widget to initialize and populate the solution list
  await page.waitForFunction('!!window.ParsonsWidget', null, { timeout: 15000 });
  await expect(page.locator('#solution-sortable')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#solution-sortable li').first()).toBeVisible({ timeout: 30000 });
  await page.locator('#tests-input').fill('assert test_private() == 1');
  await page.locator('#run-tests').click();
  await page.waitForSelector('#test-results', { timeout: 30000 });
  await expect(page.locator('#test-results')).toContainText('All tests passed!', { timeout: 30000 });

  // Save model answer and open preview
  await page.locator('#set-model-answer').click();
  await expect(page.locator('#model-answer-status')).toContainText('Model answer saved', { timeout: 10000 });
  await page.locator('#preview-student-view').click();
  await expect(page.locator('#student-preview-modal')).toBeVisible();
  await page.locator('#close-student-preview').click();
  await expect(page.locator('#student-preview-modal')).toBeHidden();

  // Mark task private by checking the visibility checkbox
  await page.locator('#task-visibility-public').check();
  await page.locator('#preview-student-view').click();
  await expect(page.locator('#student-preview-modal')).toBeVisible();
  await page.locator('#close-student-preview').click();
  await expect(page.locator('#student-preview-modal')).toBeHidden();

  // Add to problem list (create problem)
  await page.locator('#add-to-problem-list').click();
  await page.waitForURL(/\/teacher-dashboard$/, { timeout: 20000 });

  // Go to Task Database and verify owner sees the task
  await page.goto('/global-statistics');
  await page.waitForSelector('#problems-list', { timeout: 10000 });
  await expect(page.locator('.task-set-title', { hasText: title })).toBeVisible();

  // Logout teacher1
  await logoutTeacher(page);

  // Register a second teacher and verify they don't see the private task
  const teacher2 = `teacher_priv2_${unique}`;
  const email2 = `teacher_priv2_${unique}@example.com`;
  await registerTeacher(page, teacher2, email2, password);
  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
  await loginTeacher(page, email2, password);
  await expect(page).toHaveURL(/\/teacher-dashboard$/);

  await page.goto('/global-statistics');
  await page.waitForSelector('#problems-list', { timeout: 10000 });
  await expect(page.locator('.task-set-title', { hasText: title })).toHaveCount(0);
});
