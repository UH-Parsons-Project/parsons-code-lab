// @ts-check
import { test, expect } from '@playwright/test';
import {
  registerTeacher,
  loginTeacher,
  createTaskSetWithTasks,
  createTestStudent,
  loginStudent,
  getStudentUrl,
} from './test-helpers.js';

test.describe('Task Edit and Delete Lifecycle', () => {
  let teacherEmail;
  const teacherPassword = 'password123';

  test.beforeEach(async ({ page }) => {
    const unique = Date.now() + Math.floor(Math.random() * 1000);
    const username = `task_lifecycle_${unique}`;
    teacherEmail = `task_lifecycle_${unique}@example.com`;

    await registerTeacher(page, username, teacherEmail, teacherPassword);
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
    await loginTeacher(page, teacherEmail, teacherPassword);
    await expect(page).toHaveURL(/\/teacher-dashboard$/);
  });

  /**
   * Creates a fully valid task of the given evalType and saves it to the dashboard.
   * Returns the task title string.
   *
   * Selector notes: teacher dashboard task cards use `.task-set-item`
   * and the title element has class `.task-set-title` (createMyTaskCard in teacher-dashboard.js).
   */
  async function createTestTask(page, evalType = 'unit_test', uniqueName = '') {
    await page.goto('/create-task');
    await page.locator('#eval-type').selectOption(evalType);

    let taskCode = '';
    let taskTests = '';
    let blocksRepr = '';

    if (evalType === 'unit_test') {
      taskCode = 'def greet(name):\n    return "Hello " + name';
      taskTests = 'assert greet("Alice") == "Hello Alice"';
      blocksRepr = 'def greet(name): #0given\nreturn "Hello " + name #1given';
    } else if (evalType === 'stdout') {
      taskCode = 'print("Hello World")';
      taskTests = 'Hello World';
      blocksRepr = 'print("Hello World") #0given';
    } else {
      // order_only
      taskCode = 'Buy ingredients\nBake pie';
      blocksRepr = 'Buy ingredients #0given\nBake pie #0given';
    }

    await page.locator('#task-code').fill(taskCode);
    if (evalType !== 'order_only') {
      await page.locator('#task-tests').fill(taskTests);
    }

    await page.evaluate(({ taskCode, blocksRepr }) => {
      sessionStorage.setItem('create_task_builder_blocks', blocksRepr);
      sessionStorage.setItem('create_task_builder_blocks_source', taskCode);
    }, { taskCode, blocksRepr });

    await page.locator('#submit-task').click();
    await page.waitForURL(/\/create-task-editor/);

    const title = `Task_${evalType}_${uniqueName}_${Date.now()}`;

    // All fields required by addToProblemList validation
    await page.locator('#task-title').fill(title);
    await page.locator('#problem-description').fill('Description for ' + title);
    await page.locator('#start-description').fill('Starting info for ' + title);
    await page.locator('#task-type').selectOption('functions');

    if (evalType !== 'order_only') {
      await page.locator('#run-tests').click();
      await expect(page.locator('#test-results')).toContainText(
        /All tests passed!|Output matched perfectly!/,
        { timeout: 30000 }
      );
    }

    await page.locator('#set-model-answer').click();
    await expect(page.locator('#model-answer-status')).toContainText('Model answer saved');

    await page.locator('#preview-student-view').click();
    await expect(page.locator('#student-preview-modal')).toBeVisible();
    await page.locator('#close-student-preview').click();
    await expect(page.locator('#student-preview-modal')).toBeHidden();

    await expect(page.locator('#add-to-problem-list')).toBeEnabled();

    page.once('dialog', dialog => dialog.accept());
    await page.locator('#add-to-problem-list').click();
    await page.waitForURL(/\/teacher-dashboard/, { timeout: 15000 });

    await expect(page.locator('.task-set-title', { hasText: title })).toBeVisible({ timeout: 10000 });

    return title;
  }

  /**
   * Opens direct edit for a task and re-runs tests + preview so the "Update Task"
   * button is enabled. In direct edit mode testsPassed and hasOpenedStudentPreview
   * are both reset to false on page load, so they must be re-satisfied before saving.
   */
  async function openDirectEditAndEnable(page, title) {
    await page.locator('.task-set-item', { hasText: title })
      .locator('a.btn-outline-success', { hasText: 'Edit' })
      .click();
    await page.waitForURL(/\/create-task-editor\?task_id=\d+/);

    const evalType = await page.locator('#eval-type').inputValue();

    // Re-run tests so testsPassed = true (not needed for order_only)
    if (evalType !== 'order_only') {
      await page.locator('#run-tests').click();
      await expect(page.locator('#test-results')).toContainText(
        /All tests passed!|Output matched perfectly!/,
        { timeout: 30000 }
      );
    }

    // Re-open student preview so hasOpenedStudentPreview = true
    await page.locator('#preview-student-view').click();
    await expect(page.locator('#student-preview-modal')).toBeVisible();
    await page.locator('#close-student-preview').click();
    await expect(page.locator('#student-preview-modal')).toBeHidden();

    await expect(page.locator('#add-to-problem-list')).toBeEnabled({ timeout: 5000 });
  }

  // --------------------------------------------------------------------------
  // Delete
  // --------------------------------------------------------------------------

  test('teacher can delete a task if not in use', async ({ page }) => {
    const title = await createTestTask(page, 'unit_test', 'delete_test');

    // Delete button is directly visible on the card
    page.once('dialog', dialog => dialog.accept());
    await page.locator('.task-set-item', { hasText: title })
      .locator('button.btn-outline-danger', { hasText: 'Delete' })
      .click();

    // Card should disappear after deletion
    await expect(page.locator('.task-set-item', { hasText: title })).toBeHidden({ timeout: 5000 });
  });

  /**
   * A task becomes non-deletable when:
   * - Another teacher has it in their task set, OR
   * - The owning teacher has it in a task set with enrolled students.
   *
   * Simply having a task in your OWN task set (with no enrolled students)
   * keeps it editable/deletable. We test the UI locked state by registering
   * a second teacher, creating a task as teacher 1, and adding it to teacher 2's
   * task set (which makes editable=false for teacher 1).
   */
  test('teacher cannot delete a task used in another teachers task set', async ({ page, browser }) => {
    // Register teacher 2 in a separate context
    const t2Context = await browser.newContext();
    const t2Page = await t2Context.newPage();

    const unique = Date.now() + Math.floor(Math.random() * 1000);
    const t2Username = `teacher2_${unique}`;
    const t2Email = `teacher2_${unique}@example.com`;
    const t2Password = 'password123';

    const { registerTeacher: regT } = await import('./test-helpers.js');
    await regT(t2Page, t2Username, t2Email, t2Password);
    await t2Page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
    await t2Context.close();

    // Teacher 1 creates and publishes a task
    const title = await createTestTask(page, 'unit_test', 'locked_test');

    // Teacher 2 logs in and creates a task set that includes teacher 1's (public) task
    const t2Ctx = await browser.newContext();
    const t2Pg = await t2Ctx.newPage();
    const { loginTeacher: loginT, createTaskSetWithTasks: ctsWithT } = await import('./test-helpers.js');
    await loginT(t2Pg, t2Email, t2Password);
    await t2Pg.waitForURL(/\/teacher-dashboard/);
    await ctsWithT(t2Pg, 'Teacher2 Set', 'desc', 'desc', [title]);
    await t2Ctx.close();

    // Navigate back to teacher 1's dashboard
    await page.goto('/teacher-dashboard');

    const taskCard = page.locator('.task-set-item', { hasText: title });

    // Delete and Edit buttons gone; "In use" badge visible
    await expect(taskCard.locator('button.btn-outline-danger')).toBeHidden();
    await expect(taskCard.locator('a.btn-outline-success', { hasText: 'Edit' })).toBeHidden();
    await expect(taskCard.locator('.btn-secondary.disabled')).toBeVisible();
  });

  test('teacher can delete a task set from task set overview page', async ({ page }) => {
    const unique = Date.now();
    const taskSetTitle = `Set to Delete ${unique}`;

    // 1. Create task set
    await createTaskSetWithTasks(page, taskSetTitle, 'Student desc', 'Teacher desc', ['add_in_range']);
    await page.waitForURL(/\/(teacher-dashboard|)$/, { timeout: 15000 });
    if (!page.url().includes('teacher-dashboard')) {
      await page.waitForURL(/\/teacher-dashboard$/, { timeout: 15000 });
    }

    // 2. Open task set overview page
    await page.locator('.task-set-title', { hasText: taskSetTitle }).click();
    await page.waitForURL(/\/task-set-overview/, { timeout: 10000 });
    await page.waitForSelector('#delete-set-btn', { timeout: 10000 });

    // 3. Confirm dialog and click delete
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#delete-set-btn').click();

    // 4. Verify redirected back to teacher dashboard and set is removed
    await page.waitForURL(/\/teacher-dashboard$/, { timeout: 15000 });
    await expect(page.locator('.task-set-title', { hasText: taskSetTitle })).toBeHidden();
  });

  test('teacher cannot delete a task set when students are enrolled', async ({ page, browser }) => {
    const unique = Date.now();
    const taskSetTitle = `Locked Set ${unique}`;

    // 1. Create task set
    await createTaskSetWithTasks(page, taskSetTitle, 'Student desc', 'Teacher desc', ['add_in_range']);
    await page.waitForURL(/\/(teacher-dashboard|)$/, { timeout: 15000 });
    if (!page.url().includes('teacher-dashboard')) {
      await page.waitForURL(/\/teacher-dashboard$/, { timeout: 15000 });
    }

    // 2. Get student link code & enroll a student
    const studentUrl = await getStudentUrl(page, taskSetTitle);
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    const studentUsername = `st_del_lock_${unique % 1000000}`;
    const studentEmail = `st_del_lock_${unique}@example.com`;

    await createTestStudent(studentPage, studentUsername, studentEmail);
    await studentPage.goto(studentUrl);
    await loginStudent(studentPage, studentEmail);
    await studentPage.waitForURL(`${studentUrl}/tasks`, { timeout: 15000 });
    await studentContext.close();

    // 3. Teacher navigates to overview page
    await page.goto('/teacher-dashboard');
    await page.waitForSelector('.task-set-title', { timeout: 10000 });
    await page.locator('.task-set-title', { hasText: taskSetTitle }).click();
    await page.waitForURL(/\/task-set-overview/, { timeout: 10000 });

    // Delete button should be hidden; disabled "In use" element should be visible
    await expect(page.locator('#delete-set-btn')).toBeHidden();
    await expect(page.locator('.btn-secondary.disabled', { hasText: 'In use' })).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // Direct Edit (via ?task_id= URL)
  // --------------------------------------------------------------------------

  test('direct edit: eval-type is preserved and description update saves correctly', async ({ page }) => {
    test.setTimeout(90000);

    const title = await createTestTask(page, 'stdout', 'direct_edit');
    await openDirectEditAndEnable(page, title);

    // Verify eval type is correctly restored to stdout
    await expect(page.locator('#eval-type')).toHaveValue('stdout');
    await expect(page.locator('#stdout-container')).toBeVisible();
    await expect(page.locator('#unit-test-container')).toBeHidden();

    // Update the description
    const newDescription = 'This description was updated via direct edit.';
    await page.locator('#problem-description').fill(newDescription);

    // Editing description resets the preview flag, so we must preview again
    await page.locator('#preview-student-view').click();
    await expect(page.locator('#student-preview-modal')).toBeVisible();
    await page.locator('#close-student-preview').click();

    page.once('dialog', dialog => dialog.accept());
    await page.locator('#add-to-problem-list').click();
    await page.waitForURL(/\/teacher-dashboard/, { timeout: 15000 });

    await expect(page.locator('.task-set-title', { hasText: title })).toBeVisible();
  });

  test('direct edit: unit_test eval-type and UI containers are restored correctly', async ({ page }) => {
    const title = await createTestTask(page, 'unit_test', 'direct_edit_ut');

    await page.locator('.task-set-item', { hasText: title })
      .locator('a.btn-outline-success', { hasText: 'Edit' })
      .click();
    await page.waitForURL(/\/create-task-editor\?task_id=\d+/);

    await expect(page.locator('#eval-type')).toHaveValue('unit_test');
    await expect(page.locator('#unit-test-container')).toBeVisible();
    await expect(page.locator('#stdout-container')).toBeHidden();
  });

  test('direct edit: order_only eval-type is restored correctly', async ({ page }) => {
    const title = await createTestTask(page, 'order_only', 'direct_edit_oo');

    await page.locator('.task-set-item', { hasText: title })
      .locator('a.btn-outline-success', { hasText: 'Edit' })
      .click();
    await page.waitForURL(/\/create-task-editor\?task_id=\d+/);

    await expect(page.locator('#eval-type')).toHaveValue('order_only');
    await expect(page.locator('#task-tests-panel')).toBeHidden();
  });

  // --------------------------------------------------------------------------
  // Step-1 Edit (navigate programmatically since back button is hidden in direct edit mode)
  // --------------------------------------------------------------------------

  test('step 1 edit: teacher can update tests via back-to-starting-code flow', async ({ page }) => {
    const title = await createTestTask(page, 'unit_test', 'step1_edit');

    // Open direct edit to get the task_id from the URL
    await page.locator('.task-set-item', { hasText: title })
      .locator('a.btn-outline-success', { hasText: 'Edit' })
      .click();
    await page.waitForURL(/\/create-task-editor\?task_id=\d+/);

    // Extract task_id and navigate to step 1 (back button is hidden in direct edit mode)
    const editorUrl = page.url();
    const taskId = editorUrl.match(/task_id=(\d+)/)[1];
    await page.goto(`/create-task?task_id=${taskId}`);
    await page.waitForURL(/\/create-task\?task_id=\d+/);

    // Add an extra assertion to the test suite
    const newTests =
      'assert greet("Bob") == "Hello Bob"\nassert greet("Alice") == "Hello Alice"';
    await page.locator('#task-tests').fill(newTests);

    // Re-submit to the editor
    await page.locator('#submit-task').click();
    await page.waitForURL(/\/create-task-editor/);

    // Updated tests should still pass
    await page.locator('#run-tests').click();
    await expect(page.locator('#test-results')).toContainText('All tests passed!');

    await page.locator('#set-model-answer').click();
    await page.locator('#preview-student-view').click();
    await expect(page.locator('#student-preview-modal')).toBeVisible();
    await page.locator('#close-student-preview').click();

    page.once('dialog', dialog => dialog.accept());
    await page.locator('#add-to-problem-list').click();
    await page.waitForURL(/\/teacher-dashboard/, { timeout: 15000 });
    await expect(page.locator('.task-set-title', { hasText: title })).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // Changing Evaluation Mode During Edit (via step 1)
  // --------------------------------------------------------------------------

  test('changing evaluation mode from stdout to unit_test persists after save', async ({ page }) => {
    test.setTimeout(90000);

    // 1. Create a stdout task
    const title = await createTestTask(page, 'stdout', 'change_eval');

    // 2. Open direct edit, grab task_id, navigate to step 1
    await page.locator('.task-set-item', { hasText: title })
      .locator('a.btn-outline-success', { hasText: 'Edit' })
      .click();
    await page.waitForURL(/\/create-task-editor\?task_id=\d+/);
    await expect(page.locator('#eval-type')).toHaveValue('stdout');

    const editorUrl = page.url();
    const taskId = editorUrl.match(/task_id=(\d+)/)[1];
    await page.goto(`/create-task?task_id=${taskId}`);
    await page.waitForURL(/\/create-task\?task_id=\d+/);

    // Wait for loadEditData to finish populating the form before changing eval-type
    await expect(page.locator('#eval-type')).toHaveValue('stdout', { timeout: 10000 });
    // Small delay to ensure any subsequent synchronous DOM updates finish
    await page.waitForTimeout(100);

    // 3. Switch to unit_test mode and supply new code/tests
    await page.locator('#eval-type').selectOption('unit_test');
    await page.locator('#task-code').fill(
      'def say_hello():\n    return "Hello World"'
    );
    await page.locator('#task-tests').fill('assert say_hello() == "Hello World"');

    await page.evaluate(() => {
      sessionStorage.setItem(
        'create_task_builder_blocks',
        'def say_hello(): #0given\nreturn "Hello World" #1given'
      );
      sessionStorage.setItem(
        'create_task_builder_blocks_source',
        'def say_hello():\n    return "Hello World"'
      );
    });

    await page.locator('#submit-task').click();
    await page.waitForURL(/\/create-task-editor/);

    // Verify unit_test mode is active (draft.evalType takes priority over API stored value)
    await expect(page.locator('#eval-type')).toHaveValue('unit_test');
    await expect(page.locator('#unit-test-container')).toBeVisible();
    await expect(page.locator('#stdout-container')).toBeHidden();

    await page.locator('#run-tests').click();
    await expect(page.locator('#test-results')).toContainText('All tests passed!', { timeout: 15000 });

    await page.locator('#set-model-answer').click();
    await page.locator('#preview-student-view').click();
    await expect(page.locator('#student-preview-modal')).toBeVisible();
    await page.locator('#close-student-preview').click();

    page.once('dialog', dialog => dialog.accept());
    await page.locator('#add-to-problem-list').click();
    await page.waitForURL(/\/teacher-dashboard/, { timeout: 15000 });

    // 4. Re-open direct edit and verify unit_test was persisted in the database
    await page.locator('.task-set-item', { hasText: title })
      .locator('a.btn-outline-success', { hasText: 'Edit' })
      .click();
    await page.waitForURL(/\/create-task-editor\?task_id=\d+/);
    await expect(page.locator('#eval-type')).toHaveValue('unit_test');
    await expect(page.locator('#unit-test-container')).toBeVisible();
    await expect(page.locator('#stdout-container')).toBeHidden();
  });

  test('changing evaluation mode from unit_test to order_only persists after save', async ({ page }) => {
    test.setTimeout(90000);

    // 1. Create a unit_test task
    const title = await createTestTask(page, 'unit_test', 'change_eval_order');

    // 2. Navigate to direct edit, grab task_id, go to step 1
    await page.locator('.task-set-item', { hasText: title })
      .locator('a.btn-outline-success', { hasText: 'Edit' })
      .click();
    await page.waitForURL(/\/create-task-editor\?task_id=\d+/);
    await expect(page.locator('#eval-type')).toHaveValue('unit_test');

    const editorUrl = page.url();
    const taskId = editorUrl.match(/task_id=(\d+)/)[1];
    await page.goto(`/create-task?task_id=${taskId}`);
    await page.waitForURL(/\/create-task\?task_id=\d+/);

    // Wait for loadEditData to finish populating the form before changing eval-type
    await expect(page.locator('#eval-type')).toHaveValue('unit_test', { timeout: 10000 });
    await page.waitForTimeout(100);

    // 3. Switch to order_only
    await page.locator('#eval-type').selectOption('order_only');
    await page.locator('#task-code').fill('Step one\nStep two\nStep three');

    await page.evaluate(() => {
      sessionStorage.setItem(
        'create_task_builder_blocks',
        'Step one #0given\nStep two #0given\nStep three #0given'
      );
      sessionStorage.setItem(
        'create_task_builder_blocks_source',
        'Step one\nStep two\nStep three'
      );
    });

    await page.locator('#submit-task').click();
    await page.waitForURL(/\/create-task-editor/);

    // Verify order_only mode is active (draft.evalType takes priority)
    await expect(page.locator('#eval-type')).toHaveValue('order_only');
    await expect(page.locator('#task-tests-panel')).toBeHidden();

    await page.locator('#set-model-answer').click();
    await page.locator('#preview-student-view').click();
    await expect(page.locator('#student-preview-modal')).toBeVisible();
    await page.locator('#close-student-preview').click();

    page.once('dialog', dialog => dialog.accept());
    await page.locator('#add-to-problem-list').click();
    await page.waitForURL(/\/teacher-dashboard/, { timeout: 15000 });

    // 4. Re-open direct edit and verify order_only was persisted
    await page.locator('.task-set-item', { hasText: title })
      .locator('a.btn-outline-success', { hasText: 'Edit' })
      .click();
    await page.waitForURL(/\/create-task-editor\?task_id=\d+/);
    await expect(page.locator('#eval-type')).toHaveValue('order_only');
    await expect(page.locator('#task-tests-panel')).toBeHidden();
  });
});
