// @ts-check
import { test, expect } from '@playwright/test';
import {
  registerTeacher,
  loginTeacher,
} from './test-helpers.js';

test.describe('Task Draft Storage Cleanup Lifecycle', () => {
  let teacherEmail;
  const teacherPassword = 'password123';

  test.beforeEach(async ({ page }) => {
    const unique = Date.now() + Math.floor(Math.random() * 1000);
    const username = `draft_clean_${unique}`;
    teacherEmail = `draft_clean_${unique}@example.com`;

    await registerTeacher(page, username, teacherEmail, teacherPassword);
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
    await loginTeacher(page, teacherEmail, teacherPassword);
    await expect(page).toHaveURL(/\/teacher-dashboard$/);
  });

  async function getDraftKeys(page) {
    return await page.evaluate(() => {
      const keys = [...Object.keys(localStorage), ...Object.keys(sessionStorage)];
      return keys.filter(key => key.startsWith('create_task_'));
    });
  }

  test('clears drafts when clicking clear drafts button in step 1', async ({ page }) => {
    await page.goto('/create-task');
    await page.locator('#task-code').fill('def foo():\n    pass');
    
    // Give it a moment to save to sessionStorage
    await page.waitForTimeout(500);

    // Verify auto-save stored the draft
    let keys = await getDraftKeys(page);
    expect(keys).toContain('create_task_draft_code');

    page.once('dialog', dialog => dialog.accept());
    await page.locator('#clear-drafts').click();

    // Verify storage is clear
    keys = await getDraftKeys(page);
    expect(keys).toHaveLength(0);
    await expect(page.locator('#task-code')).toHaveValue('');
  });

  test('clears drafts when canceling from step 1', async ({ page }) => {
    await page.goto('/create-task');
    await page.locator('#task-code').fill('def bar():\n    pass');
    
    await page.waitForTimeout(500);

    let keys = await getDraftKeys(page);
    expect(keys.length).toBeGreaterThan(0);

    // Cancel button
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#cancel-task').click();
    await page.waitForURL(/\/teacher-dashboard/);

    keys = await getDraftKeys(page);
    expect(keys).toHaveLength(0);
  });

  test('clears drafts when canceling from step 2', async ({ page }) => {
    await page.goto('/create-task');
    await page.locator('#eval-type').selectOption('unit_test');
    await page.locator('#task-code').fill('def test_func():\n    return 42');
    await page.locator('#task-tests').fill('assert test_func() == 42');
    await page.locator('#submit-task').click();
    
    await page.waitForURL(/\/create-task-editor/);

    // Step 2 creates many keys
    let keys = await getDraftKeys(page);
    expect(keys.length).toBeGreaterThan(0);

    // Click cancel in step 2
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#cancel-task-editor').click();
    await page.waitForURL(/\/teacher-dashboard/);

    keys = await getDraftKeys(page);
    expect(keys).toHaveLength(0);
  });

  test('clears drafts upon successful task creation', async ({ page }) => {
    await page.goto('/create-task');
    await page.locator('#eval-type').selectOption('unit_test');
    
    const taskCode = 'def final_func():\n    return 1';
    const taskTests = 'assert final_func() == 1';
    const blocksRepr = 'def final_func(): #0given\nreturn 1 #1given';

    await page.locator('#task-code').fill(taskCode);
    await page.locator('#task-tests').fill(taskTests);
    
    await page.evaluate(({ taskCode, blocksRepr }) => {
      sessionStorage.setItem('create_task_builder_blocks', blocksRepr);
      sessionStorage.setItem('create_task_builder_blocks_source', taskCode);
    }, { taskCode, blocksRepr });

    await page.locator('#submit-task').click();
    await page.waitForURL(/\/create-task-editor/);
    
    await page.locator('#task-title').fill('Cleanup Test Task');
    await page.locator('#problem-description').fill('Desc');
    await page.locator('#start-description').fill('Start');
    await page.locator('#task-type').selectOption('functions');

    await page.locator('#run-tests').click();
    await expect(page.locator('#test-results')).toContainText(/All tests passed!|Output matched perfectly!/, { timeout: 15000 });

    await page.locator('#set-model-answer').click();
    await expect(page.locator('#model-answer-status')).toContainText('Model answer saved');

    await page.locator('#preview-student-view').click();
    await expect(page.locator('#student-preview-modal')).toBeVisible();
    await page.locator('#close-student-preview').click();
    await expect(page.locator('#student-preview-modal')).toBeHidden();

    // Verify drafts exist right before save
    let keys = await getDraftKeys(page);
    expect(keys.length).toBeGreaterThan(0);

    page.once('dialog', dialog => dialog.accept());
    await page.locator('#add-to-problem-list').click();
    await page.waitForURL(/\/teacher-dashboard/, { timeout: 15000 });

    // Verify storage is clean after creation
    keys = await getDraftKeys(page);
    expect(keys).toHaveLength(0);
  });

  test('teacher dashboard clears existing drafts on load', async ({ page }) => {
    // Inject a fake draft on the dashboard
    await page.evaluate(() => {
      sessionStorage.setItem('create_task_stale_data', 'stale');
      localStorage.setItem('create_task_old_data', 'old');
    });

    let keys = await getDraftKeys(page);
    expect(keys).toContain('create_task_stale_data');
    expect(keys).toContain('create_task_old_data');

    // Navigate out and back in
    await page.goto('/');
    await page.goto('/teacher-dashboard');
    await page.waitForLoadState('networkidle');

    keys = await getDraftKeys(page);
    expect(keys).toHaveLength(0);
  });
});
