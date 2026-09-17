// @ts-check
import { test, expect } from '@playwright/test';
import { loginTeacher, registerTeacher, logoutTeacher, createTestStudent } from './test-helpers.js';

test.beforeEach(async ({ page }) => {
  // Login as seeded admin user
  await loginTeacher(page, 'matti.ruotsalainen@example.com', 'test1234');
  await expect(page).toHaveURL(/\/teacher-dashboard$/);

  // Register one student so "Registered Students" stat is non-zero
  const unique = Date.now() % 1000000;
  const studentUsername = `student_${unique}`;
  const studentEmail = `student_${unique}@example.com`;
  const resp = await createTestStudent(page, studentUsername, studentEmail, 'password123');
  if (!resp.ok()) {
    console.warn('Student registration in beforeEach returned', resp.status());
  }
});

test('admin dashboard button is visible for admin teacher but hidden for standard teacher', async ({ page }) => {
  // 1. Verify Admin Dashboard button is visible on teacher dashboard for the logged-in admin teacher
  await page.goto('/teacher-dashboard');
  await expect(page.locator('#all-sets-button')).toBeVisible();

  // 2. Logout admin teacher
  await logoutTeacher(page);

  // 3. Register and login as a new standard (non-admin) teacher
  const unique = Date.now();
  const teacherUsername = `std_teacher_${unique}`;
  const teacherEmail = `std_teacher_${unique}@example.com`;
  const teacherPassword = 'password123';

  await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
  await loginTeacher(page, teacherEmail, teacherPassword);
  await expect(page).toHaveURL(/\/teacher-dashboard$/);

  // 4. Verify Admin Dashboard button is hidden for standard teacher
  await expect(page.locator('#all-sets-button')).toBeHidden();
});

test('admin dashboard shows stats and can create a registration token', async ({ page }) => {

  // Open admin dashboard
  await page.goto('/admin-dashboard');

  // Basic stats elements should be visible
  await page.waitForSelector('#stat-registered-students', { timeout: 10000 });
  await expect(page.locator('#stat-registered-students')).toBeVisible();
  // Registered teachers stat should be visible as well
  await page.waitForSelector('#stat-registered-teachers', { timeout: 10000 });
  await expect(page.locator('#stat-registered-teachers')).toBeVisible();
  await expect(page.locator('#stat-total-lists')).toBeVisible();

  // Token management UI should be present
  await expect(page.locator('#generate-token-btn')).toBeVisible();
  await expect(page.locator('#add-token-btn')).toBeVisible();
  await expect(page.locator('#token-input')).toBeVisible();

  // Generate a token and ensure input receives a value
  await page.locator('#generate-token-btn').click();
  const generated = await page.locator('#token-input').inputValue();
  expect(generated.length).toBeGreaterThan(0);

  // Add the token and verify the token display appears with a value
  await Promise.all([
    page.waitForSelector('#token-display', { timeout: 10000 }),
    page.locator('#add-token-btn').click(),
  ]);

  await expect(page.locator('#token-value')).toBeVisible();
  const displayed = (await page.locator('#token-value').textContent()) || '';
  expect(displayed.trim().length).toBeGreaterThan(0);

  // Tokens list should contain at least one token entry after creation
  await page.waitForSelector('#tokens-list .token-item', { timeout: 10000 });
  const tokenItems = await page.locator('#tokens-list .token-item').count();
  expect(tokenItems).toBeGreaterThan(0);

  // Verify admin dashboard shows counts: registered students, registered teachers and total task sets
  const studentsText = (await page.locator('#stat-registered-students').textContent()) || '';
  const teachersText = (await page.locator('#stat-registered-teachers').textContent()) || '';
  const listsText = (await page.locator('#stat-total-lists').textContent()) || '';

  /** @param {string} s */
  const parseNumber = (s) => {
    const m = s.replace(/[^0-9]/g, '');
    return m ? parseInt(m, 10) : 0;
  };

  expect(parseNumber(studentsText)).toBeGreaterThan(0);
  expect(parseNumber(teachersText)).toBeGreaterThan(0);
  expect(parseNumber(listsText)).toBeGreaterThan(0);
});

test('admin can view and add task type tags', async ({ page }) => {
  await page.goto('/admin-dashboard');
  await page.waitForSelector('#task-types-list .task-tag-chip', { timeout: 10000 });

  await expect(page.locator('#task-tags-title')).toHaveText('Task tags');
  await expect(page.locator('.task-tags-description')).toHaveText('Add and view tags teachers can assign to tasks.');
  await expect(page.locator('.task-tags-group-title')).toHaveText('Existing tags');
  await expect(page.locator('.task-tags-table')).toHaveCount(0);
  await expect(page.getByText('Used in tasks', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Status', { exact: true })).toHaveCount(0);
  await expect(page.locator('.task-tag-menu-button')).toHaveCount(0);

  const inactiveTags = page.locator('#inactive-task-tags');
  await expect(inactiveTags).toBeVisible();
  await expect(inactiveTags).not.toHaveAttribute('open', '');
  const inactiveSummary = inactiveTags.locator('summary');
  await expect(inactiveSummary).toHaveText(/Inactive tags \(\d+\)/);
  await inactiveSummary.click();
  await expect(inactiveTags).toHaveAttribute('open', '');
  await expect(inactiveTags.locator('.task-tag-chip--inactive').first()).toBeVisible();

  const unique = Date.now();
  const label = `E2E Task Tag ${unique}`;

  await page.getByRole('button', { name: '+ Add tag' }).click();
  await expect(page.getByRole('dialog', { name: 'Add tag' })).toBeVisible();
  await page.locator('#task-tag-name').fill(label);
  await page.getByRole('button', { name: 'Add tag', exact: true }).last().click();

  const chip = page.locator('.task-tag-chip').filter({ hasText: label });
  await expect(chip).toBeVisible();
  await expect(chip).toHaveCount(1);
  await expect(chip.locator('button')).toHaveCount(0);
  await expect(page.locator('#task-tag-modal')).toBeHidden();
});

test('admin-created task tag is available and persists when creating a task', async ({ page }) => {
  await page.goto('/admin-dashboard');
  await expect(page).toHaveURL(/\/admin-dashboard$/);
  await page.waitForSelector('#task-types-list .task-tag-chip', { timeout: 10000 });

  const unique = Date.now();
  const tagLabel = `E2E Integration Tag ${unique}`;
  const taskTitle = `E2E Integration Task ${unique}`;

  await page.getByRole('button', { name: '+ Add tag' }).click();
  await expect(page.getByRole('dialog', { name: 'Add tag' })).toBeVisible();
  await page.locator('#task-tag-name').fill(tagLabel);
  await page.getByRole('button', { name: 'Add tag', exact: true }).last().click();
  await expect(page.locator('#task-types-list .task-tag-chip').filter({ hasText: tagLabel })).toHaveCount(1);

  await page.goto('/create-task');
  await expect(page).toHaveURL(/\/create-task$/);

  const taskCode = 'def integration_tag_task():\n    return True';
  const taskTests = 'assert integration_tag_task() == True';
  const blocksRepr = 'def integration_tag_task(): #0given\nreturn True #1given';

  await page.locator('#eval-type').selectOption('unit_test');
  await page.locator('#task-code').fill(taskCode);
  await page.locator('#task-tests').fill(taskTests);
  await page.evaluate(({ taskCode, blocksRepr }) => {
    sessionStorage.setItem('create_task_builder_blocks', blocksRepr);
    sessionStorage.setItem('create_task_builder_blocks_source', taskCode);
  }, { taskCode, blocksRepr });

  await page.locator('#submit-task').click();
  await page.waitForURL(/\/create-task-editor/, { timeout: 10000 });

  const taskTagOption = page.locator('#task-type option').filter({ hasText: tagLabel });
  await expect(taskTagOption).toHaveCount(1);
  await page.locator('#task-type').selectOption({ label: tagLabel });
  const selectedTag = await page.locator('#task-type').inputValue();
  expect(selectedTag).toBeTruthy();

  await page.locator('#task-title').fill(taskTitle);
  await page.locator('#problem-description').fill('Verify an admin-created task tag persists on a new task.');
  await page.locator('#start-description').fill('Practice creating a task with an administrator-managed tag.');
  await page.waitForSelector('#solution-sortable ul li', { timeout: 10000 });

  await page.locator('#run-tests').click();
  await expect(page.locator('#test-results')).toContainText('All tests passed!', { timeout: 30000 });
  await page.locator('#set-model-answer').click();
  await expect(page.locator('#model-answer-status')).toContainText('Model answer saved', { timeout: 10000 });

  await page.locator('#preview-student-view').click();
  await expect(page.locator('#student-preview-modal')).toBeVisible();
  await page.locator('#close-student-preview').click();
  await expect(page.locator('#student-preview-modal')).toBeHidden();
  await expect(page.locator('#add-to-problem-list')).toBeEnabled();

  page.once('dialog', dialog => dialog.accept());
  await page.locator('#add-to-problem-list').click();
  await page.waitForURL(/\/teacher-dashboard$/, { timeout: 15000 });

  const myTasksResponse = await page.request.get('/api/my_tasks');
  expect(myTasksResponse.ok()).toBeTruthy();
  const myTasks = await myTasksResponse.json();
  const savedTask = myTasks.find(task => task.title === taskTitle);
  expect(savedTask).toMatchObject({ title: taskTitle, task_type: selectedTag });
});

test('admin can select and deactivate multiple task type tags', async ({ page }) => {
  await page.goto('/admin-dashboard');
  await page.waitForSelector('#task-types-list .task-tag-chip', { timeout: 10000 });

  const unique = Date.now();
  const labels = [`E2E Deactivate Tag A ${unique}`, `E2E Deactivate Tag B ${unique}`];

  for (const label of labels) {
    await page.getByRole('button', { name: '+ Add tag' }).click();
    await page.locator('#task-tag-name').fill(label);
    await page.getByRole('button', { name: 'Add tag', exact: true }).last().click();
    await expect(page.locator('#task-types-list .task-tag-chip').filter({ hasText: label })).toHaveCount(1);
  }

  await page.getByRole('button', { name: 'Deactivate tag', exact: true }).click();
  await expect(page.locator('#task-tag-action-help')).toHaveText('Select one or more tags to deactivate. Selected tags turn red.');

  for (const label of labels) {
    const chip = page.locator('#task-types-list .task-tag-chip').filter({ hasText: label });
    await chip.click();
    await expect(chip).toHaveClass(/task-tag-chip--selected/);
  }

  const confirmMessage = [];
  page.once('dialog', async dialog => {
    expect(dialog.type()).toBe('confirm');
    confirmMessage.push(dialog.message());
    await dialog.accept();
  });
  await page.getByRole('button', { name: /Deactivate selected tags \(2\)/ }).click();

  await expect.poll(() => confirmMessage[0] || '').toContain(labels[0]);
  await expect.poll(() => confirmMessage[0] || '').toContain(labels[1]);
  for (const label of labels) {
    await expect(page.locator('#task-types-list .task-tag-chip').filter({ hasText: label })).toHaveCount(0);
    await expect(page.locator('#inactive-task-types-list .task-tag-chip--inactive').filter({ hasText: label })).toHaveCount(1);
  }

  await page.locator('#inactive-task-tags summary').click();
  await page.getByRole('button', { name: 'Restore tag', exact: true }).click();
  await expect(page.locator('#task-tag-action-help')).toHaveText('Select one or more inactive tags to restore. Selected tags turn red.');

  const tagToRestore = page.locator('#inactive-task-types-list .task-tag-chip').filter({ hasText: labels[0] });
  await tagToRestore.click();
  await expect(tagToRestore).toHaveClass(/task-tag-chip--selected/);

  const restoreConfirmMessage = [];
  page.once('dialog', async dialog => {
    expect(dialog.type()).toBe('confirm');
    restoreConfirmMessage.push(dialog.message());
    await dialog.accept();
  });
  await page.getByRole('button', { name: /Restore selected tags \(1\)/ }).click();

  await expect.poll(() => restoreConfirmMessage[0] || '').toContain(labels[0]);
  await expect(page.locator('#task-types-list .task-tag-chip').filter({ hasText: labels[0] })).toHaveCount(1);
  await expect(page.locator('#inactive-task-types-list .task-tag-chip--inactive').filter({ hasText: labels[0] })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Deactivate tag', exact: true })).toBeVisible();
});
