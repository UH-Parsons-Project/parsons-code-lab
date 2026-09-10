// @ts-check
import { test, expect } from '@playwright/test';
import { registerTeacher, loginTeacher, getStudentUrl } from './test-helpers.js';

test.describe('Task Set Creation Validation & Features', () => {
  test('does not allow creating a task set if the name is left empty', async ({ page }) => {
    const unique = Date.now();
    const teacherUsername = `teacher_empty_${unique}`;
    const teacherEmail = `teacher_empty_${unique}@example.com`;
    const teacherPassword = 'password123';

    // 1. Register and login teacher
    await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
    await loginTeacher(page, teacherUsername, teacherPassword);
    await page.waitForURL(/\/teacher-dashboard$/, { timeout: 10000 });

    // 2. Go to create task set page
    await page.goto('/create-task-set');
    await page.waitForURL(/\/create-task-set$/, { timeout: 10000 });

    // 3. Ensure title field is left empty
    await page.locator('#task-set-title').fill('');

    // 4. Attempt to submit the form
    await page.locator('#create-task-set-form button[type="submit"]').click();

    // 5. Verify HTML5 validation marks title input as invalid and form is not submitted
    const titleInput = page.locator('#task-set-title');
    const isInvalid = await titleInput.evaluate((el) => !/** @type {HTMLInputElement} */ (el).checkValidity());
    expect(isInvalid).toBe(true);

    // Verify page remains on creation view and does not navigate
    expect(page.url()).toContain('/create-task-set');
  });

  test('does not allow creating a task set with a title shorter than 4 characters (e.g. "abc")', async ({ page }) => {
    const unique = Date.now();
    const teacherUsername = `teacher_short_${unique}`;
    const teacherEmail = `teacher_short_${unique}@example.com`;
    const teacherPassword = 'password123';

    // 1. Register and login teacher
    await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
    await loginTeacher(page, teacherUsername, teacherPassword);
    await page.waitForURL(/\/teacher-dashboard$/, { timeout: 10000 });

    // 2. Go to create task set page
    await page.goto('/create-task-set');
    await page.waitForURL(/\/create-task-set$/, { timeout: 10000 });

    // 3. Fill short title ("abc")
    await page.locator('#task-set-title').fill('abc');

    // 4. Attempt to submit the form
    await page.locator('#create-task-set-form button[type="submit"]').click();

    // 5. Verify validation rejects titles under 4 characters and form is not submitted
    const titleInput = page.locator('#task-set-title');
    const isTooShort = await titleInput.evaluate((el) => {
      const input = /** @type {HTMLInputElement} */ (el);
      return !input.checkValidity() || input.validity.tooShort;
    });
    expect(isTooShort).toBe(true);

    // Verify page remains on creation view and does not navigate
    expect(page.url()).toContain('/create-task-set');
  });

  test('opens task preview modal and displays correct tasks problem statement', async ({ page }) => {
    const unique = Date.now();
    const teacherUsername = `teacher_prev_${unique}`;
    const teacherEmail = `teacher_prev_${unique}@example.com`;
    const teacherPassword = 'password123';

    // 1. Register and login teacher
    await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
    await loginTeacher(page, teacherUsername, teacherPassword);
    await page.waitForURL(/\/teacher-dashboard$/, { timeout: 10000 });

    // 2. Go to create task set page
    await page.goto('/create-task-set');
    await page.waitForURL(/\/create-task-set$/, { timeout: 10000 });

    // 3. Wait for tasks list to load in task selector
    await page.waitForSelector('.task-item', { timeout: 10000 });
    const firstTask = page.locator('.task-item').first();
    const expectedTaskTitle = (await firstTask.locator('.task-item-title').textContent())?.trim();

    // 4. Click the task preview button
    await firstTask.locator('.preview-btn').click();

    // 5. Verify the task preview modal opens and displays title & problem statement
    const previewModal = page.locator('#student-preview-modal');
    await expect(previewModal).toHaveClass(/open/, { timeout: 10000 });

    const previewTitle = page.locator('#preview-task-title');
    await expect(previewTitle).toHaveText(expectedTaskTitle || '');

    const problemStatement = page.locator('#preview-problem-text');
    await expect(problemStatement).not.toBeEmpty();
  });

  test('filters available tasks when searching in the search box', async ({ page }) => {
    const unique = Date.now();
    const teacherUsername = `teacher_search_${unique}`;
    const teacherEmail = `teacher_search_${unique}@example.com`;
    const teacherPassword = 'password123';

    // 1. Register and login teacher
    await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
    await loginTeacher(page, teacherUsername, teacherPassword);
    await page.waitForURL(/\/teacher-dashboard$/, { timeout: 10000 });

    // 2. Go to create task set page
    await page.goto('/create-task-set');
    await page.waitForURL(/\/create-task-set$/, { timeout: 10000 });

    // 3. Wait for available tasks to load
    await page.waitForSelector('.task-item', { timeout: 10000 });
    const initialCount = await page.locator('.task-item').count();
    expect(initialCount).toBeGreaterThan(0);

    const firstTaskTitle = (await page.locator('.task-item .task-item-title').first().textContent())?.trim() || '';
    expect(firstTaskTitle).not.toBe('');

    // 4. Open task filter panel and enter search query
    await page.locator('.task-filter-toggle').click();
    await page.locator('#task-search').fill(firstTaskTitle);

    // 5. Verify task list is filtered to matching tasks
    const matchingCount = await page.locator('.task-item').count();
    expect(matchingCount).toBeGreaterThan(0);
    expect(matchingCount).toBeLessThanOrEqual(initialCount);

    const filteredTitles = await page.locator('.task-item .task-item-title').allTextContents();
    for (const title of filteredTitles) {
      expect(title.toLowerCase()).toContain(firstTaskTitle.toLowerCase());
    }

    // 6. Search for non-existent task title
    await page.locator('#task-search').fill('nonexistent_search_query_999xyz');
    await expect(page.locator('.task-item')).toHaveCount(0);
    await expect(page.locator('#task-selector')).toContainText('No tasks available');
  });

  test('displays all tags in search filter with tags having no tasks disabled and grayed out', async ({ page }) => {
    const unique = Date.now();
    const teacherUsername = `teacher_tags_${unique}`;
    const teacherEmail = `teacher_tags_${unique}@example.com`;
    const teacherPassword = 'password123';

    // 1. Register and login teacher
    await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
    await loginTeacher(page, teacherUsername, teacherPassword);
    await page.waitForURL(/\/teacher-dashboard$/, { timeout: 10000 });

    // 2. Go to create task set page
    await page.goto('/create-task-set');
    await page.waitForURL(/\/create-task-set$/, { timeout: 10000 });

    // 3. Wait for available tasks to load
    await page.waitForSelector('.task-item', { timeout: 10000 });

    // 4. Open task filter panel
    await page.locator('.task-filter-toggle').click();

    // 5. Open tags dropdown
    await page.locator('#tagsDropdown').click();
    await expect(page.locator('#tags-list')).toBeVisible();

    // 6. Verify all 26 default tags are present
    const tagCheckboxes = page.locator('#tags-list .tag-checkbox');
    const count = await tagCheckboxes.count();
    expect(count).toBeGreaterThanOrEqual(26);

    // 7. Check that tags with no existing tasks are disabled and grayed out
    const disabledCheckboxes = page.locator('#tags-list .tag-checkbox:disabled');
    const disabledCount = await disabledCheckboxes.count();
    expect(disabledCount).toBeGreaterThan(0);

    // Verify disabled tag labels have text-muted class
    const disabledLabels = page.locator('#tags-list .custom-control:has(.tag-checkbox:disabled) label');
    const firstDisabledLabel = disabledLabels.first();
    await expect(firstDisabledLabel).toHaveClass(/text-muted/);

    // 8. If there are enabled tags, verify selecting one filters the task list
    const enabledCheckboxes = page.locator('#tags-list .tag-checkbox:not(:disabled)');
    const enabledCount = await enabledCheckboxes.count();
    if (enabledCount > 0) {
      const tagValue = await enabledCheckboxes.first().getAttribute('value');
      await page.locator(`#tags-list label[for="tag-${tagValue}"]`).click();
      await page.locator('#apply-tags-btn').click();

      // Verify filtered tasks only contain tasks matching the tag
      const filteredTasks = page.locator('.task-item');
      const filteredCount = await filteredTasks.count();
      expect(filteredCount).toBeGreaterThan(0);
      for (let i = 0; i < filteredCount; i++) {
        const itemType = await filteredTasks.nth(i).locator('.task-item-type').textContent();
        expect(itemType?.toLowerCase()).toContain(tagValue?.toLowerCase());
      }
    }
  });

  test('handles teacher sharing with valid email and shows correct error for invalid inputs', async ({ page }) => {
    const unique = Date.now();
    const password = 'password123';

    // 1. Create another teacher to share with
    const otherUsername = `other_teacher_${unique}`;
    const otherEmail = `other_teacher_${unique}@example.com`;
    await registerTeacher(page, otherUsername, otherEmail, password);
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });

    // 2. Register and login main teacher
    const mainUsername = `main_teacher_${unique}`;
    const mainEmail = `main_teacher_${unique}@example.com`;
    await registerTeacher(page, mainUsername, mainEmail, password);
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
    await loginTeacher(page, mainUsername, password);
    await page.waitForURL(/\/teacher-dashboard$/, { timeout: 10000 });

    // 3. Go to create task set page
    await page.goto('/create-task-set');
    await page.waitForURL(/\/create-task-set$/, { timeout: 10000 });

    const viewerInput = page.locator('#viewer-identifiers');
    const addViewerBtn = page.locator('#add-viewer-btn');
    const viewerErrors = page.locator('#viewer-errors');
    const viewerList = page.locator('#viewer-list');

    // 4. Test error for non-existent teacher email
    await viewerInput.fill('nonexistent_teacher_xyz999@example.com');
    await addViewerBtn.click();
    await expect(viewerErrors).toContainText('Teacher not found', { timeout: 10000 });

    // 5. Test error for adding self as viewer
    await viewerInput.fill(mainEmail);
    await addViewerBtn.click();
    await expect(viewerErrors).toContainText('You cannot add yourself as a viewer', { timeout: 10000 });

    // 6. Test successfully adding valid teacher by email
    await viewerInput.fill(otherEmail);
    await addViewerBtn.click();
    await expect(viewerList).toContainText(otherUsername, { timeout: 10000 });
    await expect(viewerList).toContainText(otherEmail);
  });

  test('creates a task set with expiration date and verifies student access is closed after expiry', async ({ page }) => {
    test.slow();

    const unique = Date.now();
    const teacherUsername = `teacher_exp_${unique}`;
    const teacherEmail = `teacher_exp_${unique}@example.com`;
    const teacherPassword = 'password123';
    const taskSetTitle = `Expired Task Set ${unique}`;

    // 1. Register and login teacher
    await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
    await loginTeacher(page, teacherUsername, teacherPassword);
    await page.waitForURL(/\/teacher-dashboard$/, { timeout: 10000 });

    // 2. Go to create task set page
    await page.goto('/create-task-set');
    await page.waitForURL(/\/create-task-set$/, { timeout: 10000 });

    // 3. Fill form: title & select task
    await page.locator('#task-set-title').fill(taskSetTitle);
    await page.waitForSelector('.task-item', { timeout: 10000 });
    await page.locator('.task-item').first().click();

    // 4. Set expiration date in the past using ISO 8601 format (YYYY-MM-DDTHH:mm) required by HTML5 datetime-local inputs
    await page.locator('#expiration-date').fill('2020-01-01T12:00');

    // 5. Submit form
    await page.locator('#create-task-set-form button[type="submit"]').click();

    // 6. Wait for redirect to teacher dashboard (accounting for JS setTimeout redirect)
    await page.waitForURL(/\/teacher-dashboard$/, { timeout: 15000 });

    // 7. Get student URL from dashboard and navigate to it
    const studentUrl = await getStudentUrl(page, taskSetTitle);
    await page.goto(studentUrl);

    // 8. Verify student page displays task set not open page
    await expect(page.locator('body')).toContainText('This task set is not open', { timeout: 10000 });
  });

  test('does not create a task set when the opening date is after the expiration date', async ({ page }) => {
    const unique = Date.now();
    const teacherUsername = `teacher_date_order_${unique}`;
    const teacherEmail = `teacher_date_order_${unique}@example.com`;

    await registerTeacher(page, teacherUsername, teacherEmail, 'password123');
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
    await loginTeacher(page, teacherUsername, 'password123');
    await page.waitForURL(/\/teacher-dashboard$/, { timeout: 10000 });
    await page.goto('/create-task-set');
    await page.waitForURL(/\/create-task-set$/, { timeout: 10000 });

    await page.locator('#task-set-title').fill(`Invalid Date Set ${unique}`);
    await page.waitForSelector('.task-item', { timeout: 10000 });
    await page.locator('.task-item').first().click();
    await page.locator('#opening-date').fill('2027-01-02T12:00');
    await page.locator('#expiration-date').fill('2027-01-01T12:00');

    let createRequestSent = false;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/create_task_set')) {
        createRequestSent = true;
      }
    });
    const alertMessage = page.waitForEvent('dialog').then(async (dialog) => {
      expect(dialog.type()).toBe('alert');
      expect(dialog.message()).toBe(
        'Opening Date is set later than Expiration Date. Please set new times.'
      );
      await dialog.accept();
    });
    await page.locator('#create-task-set-form button[type="submit"]').click();

    await alertMessage;
    expect(page.url()).toContain('/create-task-set');
    expect(createRequestSent).toBe(false);
  });
});
