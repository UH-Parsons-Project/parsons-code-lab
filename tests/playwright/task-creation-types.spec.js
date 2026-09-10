// @ts-check
import { test, expect } from '@playwright/test';
import { registerTeacher, loginTeacher } from './test-helpers.js';

test.describe('Task Creation - Evaluation Modes (unit_test, stdout, order_only)', () => {
  let teacherEmail;
  const teacherPassword = 'password123';

  test.beforeEach(async ({ page }) => {
    const unique = Date.now() + Math.floor(Math.random() * 1000);
    const username = `task_creator_${unique}`;
    teacherEmail = `task_creator_${unique}@example.com`;

    await registerTeacher(page, username, teacherEmail, teacherPassword);
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
    await loginTeacher(page, teacherEmail, teacherPassword);
    await expect(page).toHaveURL(/\/teacher-dashboard$/);
  });

  // --------------------------------------------------------------------------
  // 1. Function Unit Tests (unit_test)
  // --------------------------------------------------------------------------
  test('unit_test mode: successful task creation with passing unit tests', async ({ page }) => {
    await page.goto('/create-task');
    await expect(page).toHaveURL(/\/create-task$/);

    // Select unit_test evaluation mode
    await page.locator('#eval-type').selectOption('unit_test');
    await expect(page.locator('#task-tests-panel')).toBeVisible();

    const taskCode = 'def add_numbers(a, b):\n    return a + b';
    const taskTests = 'assert add_numbers(3, 4) == 7\nassert add_numbers(-1, 1) == 0';
    const blocksRepr = 'def add_numbers(a, b): #0given\nreturn a + b #1given';

    await page.locator('#task-code').fill(taskCode);
    await page.locator('#task-tests').fill(taskTests);

    await page.evaluate(({ taskCode, blocksRepr }) => {
      sessionStorage.setItem('create_task_builder_blocks', blocksRepr);
      sessionStorage.setItem('create_task_builder_blocks_source', taskCode);
    }, { taskCode, blocksRepr });

    await page.locator('#submit-task').click();
    await page.waitForURL(/\/create-task-editor/, { timeout: 10000 });

    // Fill in task details
    const unique = Date.now();
    await page.locator('#task-title').fill(`unit_test_add_${unique}`);
    await page.locator('#problem-description').fill('Write a function that adds two numbers.');
    await page.locator('#start-description').fill('Practice function creation and addition operator.');

    await page.waitForSelector('#solution-sortable ul li', { timeout: 10000 });

    // Run tests
    await page.locator('#run-tests').click();
    await expect(page.locator('#test-results')).toContainText('All tests passed!', { timeout: 30000 });

    // Save model answer
    await page.locator('#set-model-answer').click();
    await expect(page.locator('#model-answer-status')).toContainText('Model answer saved at', { timeout: 10000 });
  });

  test('unit_test mode: error handling for failing unit tests', async ({ page }) => {
    await page.goto('/create-task');
    await page.locator('#eval-type').selectOption('unit_test');

    const taskCode = 'def add_numbers(a, b):\n    return a - b'; // Incorrect implementation
    const taskTests = 'assert add_numbers(3, 4) == 7';
    const blocksRepr = 'def add_numbers(a, b): #0given\nreturn a - b #1given';

    await page.locator('#task-code').fill(taskCode);
    await page.locator('#task-tests').fill(taskTests);

    await page.evaluate(({ taskCode, blocksRepr }) => {
      sessionStorage.setItem('create_task_builder_blocks', blocksRepr);
      sessionStorage.setItem('create_task_builder_blocks_source', taskCode);
    }, { taskCode, blocksRepr });

    await page.locator('#submit-task').click();
    await page.waitForURL(/\/create-task-editor/, { timeout: 10000 });

    await page.locator('#task-title').fill(`unit_test_fail_${Date.now()}`);
    await page.locator('#problem-description').fill('Test failing unit test behavior.');

    await page.waitForSelector('#solution-sortable ul li', { timeout: 10000 });

    // Click "Run Tests" and verify failure error output
    await page.locator('#run-tests').click();
    await expect(page.locator('#test-results')).toContainText('AssertionError', { timeout: 30000 });
  });

  // --------------------------------------------------------------------------
  // 2. Console Output (stdout)
  // --------------------------------------------------------------------------
  test('stdout mode: successful task creation with matching console output', async ({ page }) => {
    await page.goto('/create-task');

    // Select stdout evaluation mode
    await page.locator('#eval-type').selectOption('stdout');
    await expect(page.locator('#task-tests-panel')).toBeVisible();
    await expect(page.locator('#task-tests-label')).toHaveText('Expected Output');

    const taskCode = 'print("Hello")\nprint("Parsons")';
    const expectedOutput = 'Hello\nParsons';
    const blocksRepr = 'print("Hello") #0given\nprint("Parsons") #0given';

    await page.locator('#task-code').fill(taskCode);
    await page.locator('#task-tests').fill(expectedOutput);

    await page.evaluate(({ taskCode, blocksRepr }) => {
      sessionStorage.setItem('create_task_builder_blocks', blocksRepr);
      sessionStorage.setItem('create_task_builder_blocks_source', taskCode);
    }, { taskCode, blocksRepr });

    await page.locator('#submit-task').click();
    await page.waitForURL(/\/create-task-editor/, { timeout: 10000 });

    const unique = Date.now();
    await page.locator('#task-title').fill(`stdout_hello_${unique}`);
    await page.locator('#problem-description').fill('Print Hello and Parsons on separate lines.');

    await page.waitForSelector('#solution-sortable ul li', { timeout: 10000 });

    // Run tests and verify stdout match success
    await page.locator('#run-tests').click();
    await expect(page.locator('#test-results')).toContainText('Output matched perfectly!', { timeout: 30000 });

    await page.locator('#set-model-answer').click();
    await expect(page.locator('#model-answer-status')).toContainText('Model answer saved at', { timeout: 10000 });
  });

  test('stdout mode: error handling for mismatched console output', async ({ page }) => {
    await page.goto('/create-task');

    await page.locator('#eval-type').selectOption('stdout');

    const taskCode = 'print("Hello World")';
    const expectedOutput = 'Hello Universe'; // Mismatch
    const blocksRepr = 'print("Hello World") #0given';

    await page.locator('#task-code').fill(taskCode);
    await page.locator('#task-tests').fill(expectedOutput);

    await page.evaluate(({ taskCode, blocksRepr }) => {
      sessionStorage.setItem('create_task_builder_blocks', blocksRepr);
      sessionStorage.setItem('create_task_builder_blocks_source', taskCode);
    }, { taskCode, blocksRepr });

    await page.locator('#submit-task').click();
    await page.waitForURL(/\/create-task-editor/, { timeout: 10000 });

    await page.locator('#task-title').fill(`stdout_fail_${Date.now()}`);
    await page.locator('#problem-description').fill('Test stdout mismatch error.');

    await page.waitForSelector('#solution-sortable ul li', { timeout: 10000 });

    // Run tests and verify mismatch error
    await page.locator('#run-tests').click();
    await expect(page.locator('#test-results')).toContainText('Output did not match.', { timeout: 30000 });
  });

  test('stdout mode: function definition with driver calls execution', async ({ page }) => {
    await page.goto('/create-task');

    await page.locator('#eval-type').selectOption('stdout');
    await expect(page.locator('#task-stdout-calls-panel')).toBeVisible();

    const taskCode = 'def hello(target):\n    print("Hello", target)';
    const driverCalls = 'hello("Emily")\nhello("Bob")';
    const expectedOutput = 'Hello Emily\nHello Bob';
    const blocksRepr = 'def hello(target): #0given\n    print("Hello", target) #1given';

    await page.locator('#task-code').fill(taskCode);
    await page.locator('#task-stdout-calls').fill(driverCalls);
    await page.locator('#task-tests').fill(expectedOutput);

    await page.evaluate(({ taskCode, blocksRepr }) => {
      sessionStorage.setItem('create_task_builder_blocks', blocksRepr);
      sessionStorage.setItem('create_task_builder_blocks_source', taskCode);
    }, { taskCode, blocksRepr });

    await page.locator('#submit-task').click();
    await page.waitForURL(/\/create-task-editor/, { timeout: 10000 });

    await page.locator('#task-title').fill(`stdout_fn_${Date.now()}`);
    await page.locator('#problem-description').fill('Define hello function and call it.');

    await page.waitForSelector('#solution-sortable ul li', { timeout: 10000 });

    // Verify driver calls field was preserved in step 2
    await expect(page.locator('#stdout-tests-input')).toHaveValue(driverCalls);
    await expect(page.locator('#expected-output-input')).toHaveValue(expectedOutput);

    // Run tests and verify stdout match success, including the driver values used for the checks.
    await page.locator('#run-tests').click();
    await expect(page.locator('#test-results')).toContainText('Output matched perfectly!', { timeout: 30000 });
    await expect(page.locator('#test-results')).toContainText('Test input', { timeout: 30000 });
    await expect(page.locator('#test-results')).toContainText('hello("Emily")', { timeout: 30000 });
  });

  // --------------------------------------------------------------------------
  // 3. Order Only (order_only)
  // --------------------------------------------------------------------------
  test('order_only mode: successful conceptual step sequence task creation', async ({ page }) => {
    await page.goto('/create-task');

    // Select order_only mode
    await page.locator('#eval-type').selectOption('order_only');

    // Task tests panel should be hidden in order_only mode
    await expect(page.locator('#task-tests-panel')).toBeHidden();

    const taskCode = 'Buy ingredients\nBake the pie\nEat the pie';
    const blocksRepr = 'Buy ingredients #0given\nBake the pie #0given\nEat the pie #0given';

    await page.locator('#task-code').fill(taskCode);

    await page.evaluate(({ taskCode, blocksRepr }) => {
      sessionStorage.setItem('create_task_builder_blocks', blocksRepr);
      sessionStorage.setItem('create_task_builder_blocks_source', taskCode);
    }, { taskCode, blocksRepr });

    await page.locator('#submit-task').click();
    await page.waitForURL(/\/create-task-editor/, { timeout: 10000 });

    const unique = Date.now();
    await page.locator('#task-title').fill(`order_only_pie_${unique}`);
    await page.locator('#problem-description').fill('Arrange the steps to bake a pie in correct order.');

    await page.waitForSelector('#solution-sortable ul li', { timeout: 10000 });
    await expect(page.locator('#solution-sortable ul li')).toHaveCount(3);
  });

  test('order_only mode: error handling when submitting empty task code', async ({ page }) => {
    await page.goto('/create-task');

    await page.locator('#eval-type').selectOption('order_only');
    await page.locator('#task-code').fill('');

    // Pre-clear sessionStorage block cache so no blocks load
    await page.evaluate(() => {
      sessionStorage.removeItem('create_task_builder_blocks');
      sessionStorage.removeItem('create_task_builder_blocks_source');
    });

    await page.locator('#submit-task').click();
    await page.waitForURL(/\/create-task-editor/, { timeout: 10000 });

    // Listen for dialog alert when attempting to set model answer with empty solution
    let dialogMessage = '';
    page.once('dialog', dialog => {
      dialogMessage = dialog.message();
      dialog.accept();
    });

    await page.locator('#set-model-answer').click();
    expect(dialogMessage).toContain('Move at least one block to the right column before setting the model answer.');
  });

  // --------------------------------------------------------------------------
  // 4. Form Shortcuts & Draft Management
  // --------------------------------------------------------------------------
  test('form shortcuts: copy example from guide and clear drafts', async ({ page }) => {
    await page.goto('/create-task');

    // Click "How to Create a Task" guide toggle to expand guide
    await page.locator('#guide-toggle').click();
    await expect(page.locator('#guide-content')).toHaveClass(/expanded/);

    // Click "Copy Example to Editors" button for unit_test
    await page.locator('button.copy-btn[data-eval-type="unit_test"]').click();

    // Verify editors are populated with example code
    await expect(page.locator('#task-code')).toHaveValue(/def sum\(a, b\):/);
    await expect(page.locator('#task-tests')).toHaveValue(/assert sum\(1, 5\) == 6/);

    // Click "Clear Drafts" button
    await page.locator('#clear-drafts').click();

    // Verify textareas are emptied
    await expect(page.locator('#task-code')).toHaveValue('');
    await expect(page.locator('#task-tests')).toHaveValue('');
  });

  // --------------------------------------------------------------------------
  // 5. Prerequisites Enforcement & Checklist before "Add to Problem List"
  // --------------------------------------------------------------------------
  test('prerequisites enforcement: tag selection, running tests, and student preview required before saving', async ({ page }) => {
    await page.goto('/create-task');

    const taskCode = 'def check_flag():\n    return True';
    const taskTests = 'assert check_flag() == True';
    const blocksRepr = 'def check_flag(): #0given\nreturn True #1given';

    await page.locator('#task-code').fill(taskCode);
    await page.locator('#task-tests').fill(taskTests);

    await page.evaluate(({ taskCode, blocksRepr }) => {
      sessionStorage.setItem('create_task_builder_blocks', blocksRepr);
      sessionStorage.setItem('create_task_builder_blocks_source', taskCode);
    }, { taskCode, blocksRepr });

    await page.locator('#submit-task').click();
    await page.waitForURL(/\/create-task-editor/, { timeout: 10000 });

    const unique = Date.now();
    await page.locator('#task-title').fill(`prereq_test_${unique}`);
    await page.locator('#problem-description').fill('Test prerequisites enforcement.');
    await page.locator('#start-description').fill('Start description.');

    // 1. Task tag checklist item should not be done initially (default select option value is "")
    await expect(page.locator('#task-checklist [data-check="task-type"]')).not.toHaveClass(/is-done/);

    // Select tag 'booleans'
    await page.locator('#task-type').selectOption('booleans');
    await expect(page.locator('#task-checklist [data-check="task-type"]')).toHaveClass(/is-done/);

    // 2. Tests-passed checklist item should not be done before running tests
    await expect(page.locator('#task-checklist [data-check="tests-passed"]')).not.toHaveClass(/is-done/);
    await expect(page.locator('#add-to-problem-list')).toBeDisabled();

    // Run tests and verify checklist updates
    await page.locator('#run-tests').click();
    await expect(page.locator('#test-results')).toContainText('All tests passed!', { timeout: 30000 });
    await expect(page.locator('#task-checklist [data-check="tests-passed"]')).toHaveClass(/is-done/);

    // Set model answer
    await page.locator('#set-model-answer').click();

    // 3. Button should still be disabled before opening student preview
    await expect(page.locator('#task-checklist [data-check="previewed"]')).not.toHaveClass(/is-done/);
    await expect(page.locator('#add-to-problem-list')).toBeDisabled();

    // Open student preview modal and close it
    await page.locator('#preview-student-view').click();
    await expect(page.locator('#student-preview-modal')).toBeVisible();
    await page.locator('#close-student-preview').click();
    await expect(page.locator('#student-preview-modal')).toBeHidden();

    // 4. Now previewed checklist item is done and Add to Problem List button is enabled
    await expect(page.locator('#task-checklist [data-check="previewed"]')).toHaveClass(/is-done/);
    await expect(page.locator('#add-to-problem-list')).toBeEnabled();

    // Click add to problem list
    await page.locator('#add-to-problem-list').click();
  });

  // --------------------------------------------------------------------------
  // 6. Faded Parsons Blocks (!BLANK) & Custom Distractor Addition
  // --------------------------------------------------------------------------
  test('faded blocks (!BLANK) and custom distractor block addition', async ({ page }) => {
    await page.goto('/create-task');

    const taskCode = 'if !BLANK :';
    const taskTests = 'assert True';
    const blocksRepr = 'if !BLANK : #0given #blankvalue with spaces#';

    await page.locator('#task-code').fill(taskCode);
    await page.locator('#task-tests').fill(taskTests);

    await page.evaluate(({ taskCode, blocksRepr }) => {
      sessionStorage.setItem('create_task_builder_blocks', blocksRepr);
      sessionStorage.setItem('create_task_builder_blocks_source', taskCode);
    }, { taskCode, blocksRepr });

    await page.locator('#submit-task').click();
    await page.waitForURL(/\/create-task-editor/, { timeout: 10000 });

    // Add a custom distractor block
    await page.locator('#custom-block-input').fill('total = 999');
    await page.locator('#add-custom-block').click();

    // Verify custom distractor block is added to source list
    await expect(page.locator('#source-sortable ul li', { hasText: 'total = 999' })).toBeVisible();

    // Open Preview and verify faded input text box (input.text-box) is rendered in student view
    await page.locator('#preview-student-view').click();
    await expect(page.locator('#student-preview-modal')).toBeVisible();
    const previewBlank = page.locator('#student-preview-modal input.text-box').first();
    await expect(previewBlank).toBeVisible();
    await expect(previewBlank).toHaveValue('value with spaces');
    await expect(page.locator('#student-preview-modal li').filter({ hasText: 'oninput' })).toHaveCount(0);
    await expect(page.locator('#student-preview-modal li').filter({ hasText: 'style="width' })).toHaveCount(0);
  });

  // --------------------------------------------------------------------------
  // 7. Teacher Shuffling Notice & Preview Distractor Alignment
  // --------------------------------------------------------------------------
  test('teacher shuffling notice and preview distractor blocks alignment', async ({ page }) => {
    await page.goto('/create-task');

    const taskCode = 'def hello():\n    print("hello")';
    const taskTests = 'hello()';
    const blocksRepr = 'def hello(): #0given\n    print("hello") #1given';

    await page.locator('#task-code').fill(taskCode);
    await page.locator('#task-tests').fill(taskTests);

    await page.evaluate(({ taskCode, blocksRepr }) => {
      sessionStorage.setItem('create_task_builder_blocks', blocksRepr);
      sessionStorage.setItem('create_task_builder_blocks_source', taskCode);
    }, { taskCode, blocksRepr });

    await page.locator('#submit-task').click();
    await page.waitForURL(/\/create-task-editor/, { timeout: 10000 });

    // Verify the teacher info banner about student block shuffling and extra distractors is visible
    await expect(page.locator('.alert-info', { hasText: 'Student View Shuffling & Extra Blocks:' })).toBeVisible();

    // Open Student Preview and check that DEBUG and comment (#) distractor blocks exist
    await page.locator('#preview-student-view').click();
    await expect(page.locator('#student-preview-modal')).toBeVisible();

    const previewSourceBlocks = page.locator('#preview-source-sortable ul li');
    await expect(previewSourceBlocks.filter({ hasText: 'DEBUG' })).toHaveCount(2);
  });
});
