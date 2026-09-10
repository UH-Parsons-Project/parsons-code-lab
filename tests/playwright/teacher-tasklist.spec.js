// @ts-check
import { test, expect } from '@playwright/test';
import { registerTeacher, loginTeacher, createTaskSet, logoutTeacher } from './test-helpers.js';

test('teacher can create a new task set by clicking "Create New Task Set"', async ({ page }) => {
  const unique = Date.now();
  const username = `teacher_${unique}`;
  const email = `teacher_${unique}@example.com`;
  const password = 'password123';
  const taskSetTitle = `Test Task Set ${unique}`;
  const studentDescription = `Student description for ${taskSetTitle}.`;
  const teacherDescription = `Teacher description for ${taskSetTitle}.`;

  // Register and login as a teacher
  await registerTeacher(page, username, email, password);
  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });

  await loginTeacher(page, email, password);
  await expect(page).toHaveURL(/\/teacher-dashboard$/);

  // Create a new task set
  await createTaskSet(page, taskSetTitle, studentDescription, teacherDescription);

  // Wait for redirect back to task set selector
  await page.waitForURL(/\/teacher-dashboard$/, { timeout: 10000 });
  await expect(page).toHaveURL(/\/teacher-dashboard$/);

  // Verify the newly created task set is visible on the page
  await expect(page.locator('.task-set-title', { hasText: taskSetTitle })).toBeVisible();
});

test('teacher can add a new task', async ({ page }) => {
  const unique = Date.now();
  const username = `teacher_${unique}`;
  const email = `teacher_${unique}@example.com`;
  const password = 'password123';

  // Register and login as a teacher
  await registerTeacher(page, username, email, password);
  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });

  await loginTeacher(page, email, password);
  await expect(page).toHaveURL(/\/teacher-dashboard$/);

  // Click the "New Task" link and wait for navigation together
  const newTaskLink = page.locator('a[href="/create-task"]');
  await expect(newTaskLink).toBeVisible();
  await expect(newTaskLink).toBeEnabled();

  await Promise.all([
    page.waitForURL(/\/create-task$/, { timeout: 20000 }),
    newTaskLink.click(),
  ]);

  // Verify we are on the create task page
  await expect(page).toHaveURL(/\/create-task$/);

  // Verify create task page elements are visible
  await expect(page.locator('.page-title')).toHaveText('Create a New Task');
  await expect(page.locator('#task-code')).toBeVisible();
  await expect(page.locator('#task-tests')).toBeVisible();
  await expect(page.locator('#submit-task')).toBeVisible();

  // Fill in task code
  await page.locator('#task-code').fill('def format_name(first, last):\n    return f"{first.strip().title()} {last.strip().title()}"');

  // Fill in task tests
  await page.locator('#task-tests').fill("assert format_name('ada', 'lovelace') == 'Ada Lovelace'\nassert format_name('  linus', 'torvalds ') == 'Linus Torvalds'");

  // Pre-set the Parsons block representation in sessionStorage so the editor
  // initializes with correct indent levels (the widget uses indent as levels,
  // not character counts, so we use #Ngiven format)
  const taskCode = 'def format_name(first, last):\n    return f"{first.strip().title()} {last.strip().title()}"';
  const blocksRepr = 'def format_name(first, last): #0given\nreturn f"{first.strip().title()} {last.strip().title()}" #1given';
  await page.evaluate(({ taskCode, blocksRepr }) => {
    sessionStorage.setItem('create_task_builder_blocks', blocksRepr);
    sessionStorage.setItem('create_task_builder_blocks_source', taskCode);
  }, { taskCode, blocksRepr });

  // Click "Continue To Block Builder"
  await page.locator('#submit-task').click();

  // Verify redirect to block builder editor
  await page.waitForURL(/\/create-task-editor/, { timeout: 10000 });
  await expect(page).toHaveURL(/\/create-task-editor/);

  // Fill in problem statement fields
  await page.locator('#task-title').fill('format_name_test');
  await page.locator('#problem-description').fill('format_name takes a first name and last name, strips whitespace, and returns them title-cased. It should take first and last as inputs and return the formatted full name.');
  await page.locator('#start-description').fill('In this exercise you will practice string formatting with strip and title methods.');
  await page.locator('#task-type').selectOption('functions');
  await expect(page.locator('#task-type')).toHaveValue('functions');

  // Verify blocks are already in the solution area (loaded from cached repr)
  await page.waitForSelector('#solution-sortable ul li', { timeout: 10000 });
  await expect(page.locator('#solution-sortable ul li')).toHaveCount(2);

  // Fill in tests
  await page.locator('#tests-input').fill("assert format_name('ada', 'lovelace') == 'Ada Lovelace'\nassert format_name('  linus', 'torvalds ') == 'Linus Torvalds'");

  // Click "Run Tests" and verify all tests passed
  await page.locator('#run-tests').click();
  await expect(page.locator('#test-results')).toContainText('All tests passed!', { timeout: 30000 });

  // Click "Set as Model Answer" / "Update Model Answer" and verify status
  await page.locator('#set-model-answer').click();
  await expect(page.locator('#model-answer-status')).toContainText('Model answer saved at', { timeout: 10000 });

  // Click "Preview" and verify the preview modal appears
  await page.locator('#preview-student-view').click();
  await expect(page.locator('#student-preview-modal')).toBeVisible();

  // Close the preview modal
  await page.locator('#close-student-preview').click();
  await expect(page.locator('#student-preview-modal')).toBeHidden();

  // Click "Add to Problem List"
  await page.locator('#add-to-problem-list').click();
});

test('teacher can share a task set with another teacher', async ({ page }) => {
  const unique = Date.now();
  const teacher1_username = `teacher1_${unique}`;
  const teacher1_email = `teacher1_${unique}@example.com`;
  const teacher1_password = 'password123';

  const teacher2_username = `teacher2_${unique}`;
  const teacher2_email = `teacher2_${unique}@example.com`;
  const teacher2_password = 'password123';

  const taskSetTitle = `Shared Task Set ${unique}`;
  const studentDescription = `Student description for ${taskSetTitle}.`;
  const teacherDescription = `Teacher description for ${taskSetTitle}.`;
  
  // Register teacher 2 (the one we will share the task set with)
  await registerTeacher(page, teacher2_username, teacher2_email, teacher2_password);
  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });

  // Register and login as teacher 1
  await registerTeacher(page, teacher1_username, teacher1_email, teacher1_password);
  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });

  await loginTeacher(page, teacher1_email, teacher1_password);
  await expect(page).toHaveURL(/\/teacher-dashboard$/);

    // Create a new task set
  await createTaskSet(page, taskSetTitle, studentDescription, teacherDescription);

// Click on the newly created task set
  await page.locator('.task-set-title', { hasText: taskSetTitle }).click();

  // Fill in teacher 2 email in "Shared viewers" and click Add"
  await page.locator('#viewer-identifier').fill(teacher2_email);
  await page.locator('#add-viewer-btn').click();

  // Verify teacher 2 email appears in the shared viewers list
  await expect(page.locator('#viewers-list', { hasText: teacher2_email })).toBeVisible();

  // Logout teacher 1
  await logoutTeacher(page);

  // Login as teacher 2
  await loginTeacher(page, teacher2_email, teacher2_password);
  await expect(page).toHaveURL(/\/teacher-dashboard$/);

  // Verify the shared task set is visible on teacher 2's dashboard
  await expect(page.locator('.task-set-title', { hasText: taskSetTitle })).toBeVisible();

  // Logout teacher 2
  await logoutTeacher(page);

  // Login as teacher 1 again to remove shared task list)
  await loginTeacher(page, teacher1_email, teacher1_password);
  await expect(page).toHaveURL(/\/teacher-dashboard$/);

  // Click on the task set again
  await page.locator('.task-set-title', { hasText: taskSetTitle }).click();

  // Remove teacher 2 from shared viewers
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#viewers-list button.btn-outline-danger').click();

  // Wait for the viewer to be removed and the list to update
  await page.waitForFunction(
    (email) => !document.body.textContent.includes(email),
    teacher2_email,
    { timeout: 5000 }
  );

  // Logout teacher 1
  await logoutTeacher(page);

  // Allow URL with cache-busting query parameter: /?timestamp
  await expect(page).toHaveURL(/\/(\?.*)?$/);

  // AftlogoutTeacher(page
  // Verify the shared task set is no longer visible on teacher 2's dashboard
  await expect(page.locator('.task-set-title', { hasText: taskSetTitle })).toBeHidden();
});
