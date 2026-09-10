// @ts-check
import { test, expect } from '@playwright/test';
import {
  registerTeacher,
  loginTeacher,
  createTaskSetWithTasks,
  createTestStudent,
  getStudentUrl,
  registerStudent,
  loginStudent,
  submitTaskWrongThenCorrect,
} from './test-helpers.js';

// Increase timeout for complex multi-step E2E tests
test.describe('Task Set - Task Addition (Teacher & Student Side E2E)', () => {
  test('teacher can add tasks to an existing task set and view updated stats', async ({ page }) => {
    const unique = Date.now();
    const teacherUsername = `teacher_add_${unique}`;
    const teacherEmail = `teacher_add_${unique}@example.com`;
    const teacherPassword = 'password123';
    const taskSetTitle = `Task Set Addition Test ${unique}`;

    // 1. Teacher registers & logs in
    await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
    await loginTeacher(page, teacherEmail, teacherPassword);
    await expect(page).toHaveURL(/\/teacher-dashboard$/);

    // 2. Teacher creates a task set with 1 initial task ('add_in_range')
    await createTaskSetWithTasks(
      page,
      taskSetTitle,
      `Student description for ${taskSetTitle}`,
      `Teacher description for ${taskSetTitle}`,
      ['add_in_range']
    );
    // After submit the app may redirect through '/' before landing on teacher-dashboard
    await page.waitForURL(/\/(teacher-dashboard|)$/, { timeout: 15000 });
    if (!page.url().includes('teacher-dashboard')) {
      await page.waitForURL(/\/teacher-dashboard$/, { timeout: 15000 });
    }

    // 3. Open Task Set Overview
    await page.locator('.task-set-title', { hasText: taskSetTitle }).click();
    await page.waitForURL(/\/task-set-overview/, { timeout: 10000 });
    await page.waitForSelector('#content-container', { state: 'visible', timeout: 10000 });
    await expect(page.locator('.task-set-item', { hasText: 'add_in_range' })).toBeVisible();

    // Verify initial task count is 1
    const initialTasks = await page.locator('.task-set-item').count();
    expect(initialTasks).toBe(1);

    // 4. Click "Edit Tasks" button to enter Edit Mode
    const editTasksBtn = page.locator('#edit-tasks-btn');
    await expect(editTasksBtn).toBeVisible();
    await editTasksBtn.click();

    // Verify button text changes to "Done Editing" and "Add Tasks to Set" button appears
    await expect(editTasksBtn).toHaveText(/Done Editing/);
    const addTaskBtn = page.locator('#add-task-btn');
    await expect(addTaskBtn).toBeVisible();

    // 5. Open "Add Tasks to Set" modal
    await addTaskBtn.click();
    await page.waitForSelector('#add-task-modal.show', { timeout: 10000 });

    // Expand the Search & Filter panel first (it's collapsed by default)
    await page.locator('button.task-filter-toggle').click();
    await page.waitForSelector('#task-filter-panel.show', { timeout: 5000 });

    // Search for 'greater_num' task inside the modal
    await page.locator('#task-search').fill('greater_num');
    await page.waitForSelector('#task-selector .task-item', { timeout: 10000 });

    // Select the task 'greater_num'
    const availableTaskItem = page.locator('#task-selector .task-item', {
      has: page.locator('.task-item-title', { hasText: 'greater_num' }),
    });
    await expect(availableTaskItem).toBeVisible();
    await availableTaskItem.click();

    // Verify Confirm Add button is enabled and click it
    const confirmAddBtn = page.locator('#confirm-add-task-btn');
    await expect(confirmAddBtn).toBeEnabled();
    await confirmAddBtn.click();

    // Modal should close
    await page.waitForSelector('#add-task-modal', { state: 'hidden', timeout: 10000 });

    // 6. Click "Done Editing" to save changes
    await editTasksBtn.click();
    await expect(editTasksBtn).toHaveText(/Edit Tasks/);

    // 7. Verify both tasks are now displayed on the Task Set Overview page
    await expect(page.locator('.task-set-item', { hasText: 'add_in_range' })).toBeVisible();
    await expect(page.locator('.task-set-item', { hasText: 'greater_num' })).toBeVisible();

    const updatedTasksCount = await page.locator('.task-set-item').count();
    expect(updatedTasksCount).toBe(2);

    // 8. Verify completion stats rendering
    const addedTaskStats = page.locator('[id^="task-stats-"]', {
      hasText: /done|not started/,
    });
    await expect(addedTaskStats.first()).toBeVisible();
  });

  test('student can see and complete newly added tasks in a task set', async ({ page, browser }) => {
    test.setTimeout(90000); // Multi-step E2E: teacher setup + student completion needs extra time
    const unique = Date.now();
    const teacherUsername = `t_add_st_${unique}`;
    const teacherEmail = `t_add_st_${unique}@example.com`;
    const teacherPassword = 'password123';
    const taskSetTitle = `Student Task Addition Test ${unique}`;

    // 1. Teacher registers, logs in, creates a task set with 2 tasks from the start:
    //    - 'add_in_range': the task the student will complete (submitTaskWrongThenCorrect is built for it)
    //    - 'greater_num': the newly-added task to verify visibility
    await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
    await loginTeacher(page, teacherEmail, teacherPassword);
    await expect(page).toHaveURL(/\/teacher-dashboard$/);

    await createTaskSetWithTasks(
      page,
      taskSetTitle,
      `Student description for ${taskSetTitle}`,
      `Teacher description for ${taskSetTitle}`,
      ['add_in_range']
    );
    // After submit the app may redirect through '/' before landing on teacher-dashboard
    await page.waitForURL(/\/(teacher-dashboard|)$/, { timeout: 15000 });
    if (!page.url().includes('teacher-dashboard')) {
      await page.waitForURL(/\/teacher-dashboard$/, { timeout: 15000 });
    }

    // 2. Teacher opens Task Set Overview and adds 'greater_num' via Edit Mode
    await page.locator('.task-set-title', { hasText: taskSetTitle }).click();
    await page.waitForURL(/\/task-set-overview/, { timeout: 10000 });
    await page.waitForSelector('#content-container', { state: 'visible', timeout: 10000 });

    await page.locator('#edit-tasks-btn').click();
    await page.locator('#add-task-btn').click();
    await page.waitForSelector('#add-task-modal.show', { timeout: 10000 });

    // Expand the Search & Filter panel first (it's collapsed by default)
    await page.locator('button.task-filter-toggle').click();
    await page.waitForSelector('#task-filter-panel.show', { timeout: 5000 });

    await page.locator('#task-search').fill('greater_num');
    await page.waitForSelector('#task-selector .task-item', { timeout: 10000 });
    await page.locator('#task-selector .task-item', {
      has: page.locator('.task-item-title', { hasText: 'greater_num' }),
    }).click();
    await page.locator('#confirm-add-task-btn').click();
    await page.waitForSelector('#add-task-modal', { state: 'hidden', timeout: 10000 });
    await page.locator('#edit-tasks-btn').click();

    // 3. Get Student URL (navigate back to dashboard first to use helper)
    await page.goto('/teacher-dashboard');
    await page.waitForSelector('.task-set-title', { timeout: 10000 });
    const studentUrl = await getStudentUrl(page, taskSetTitle);

    // 4. Open Student Context
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await studentPage.goto(studentUrl);

    const studentUsername = `st_add_${unique}`;
    const studentEmail = `student_add_${unique}@example.com`;

    await registerStudent(studentPage, studentUsername, studentEmail);
    // Registration now auto-logs in and redirects directly to /tasks.
    await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 15000 });

    // 5. Verify student sees BOTH tasks (initial + newly added via Edit Mode)
    await expect(studentPage.locator('.task-set-item', { hasText: 'add_in_range' })).toBeVisible();
    await expect(studentPage.locator('.task-set-item', { hasText: 'greater_num' })).toBeVisible();

    // 6. Student opens and completes 'add_in_range' (submitTaskWrongThenCorrect targets this task)
    await studentPage.locator('.task-set-item', { hasText: 'add_in_range' }).click();
    await studentPage.waitForSelector('#start-btn', { timeout: 10000 });
    await studentPage.locator('#start-btn').click();

    await submitTaskWrongThenCorrect(studentPage);

    await studentContext.close();
  });

  test('teacher can reorder tasks in a task set and student sees the new order', async ({ page, browser }) => {
    const unique = Date.now();
    const teacherUsername = `t_reorder_${unique}`;
    const teacherEmail = `t_reorder_${unique}@example.com`;
    const teacherPassword = 'password123';
    const taskSetTitle = `Task Set Reorder Test ${unique}`;

    // 1. Teacher registers & logs in
    await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
    await loginTeacher(page, teacherEmail, teacherPassword);
    await expect(page).toHaveURL(/\/teacher-dashboard$/);

    // 2. Teacher creates a task set with 2 tasks in initial order: ['add_in_range', 'greater_num']
    await createTaskSetWithTasks(
      page,
      taskSetTitle,
      `Student description ${unique}`,
      `Teacher description ${unique}`,
      ['add_in_range', 'greater_num']
    );
    await page.waitForURL(/\/(teacher-dashboard|)$/, { timeout: 15000 });
    if (!page.url().includes('teacher-dashboard')) {
      await page.waitForURL(/\/teacher-dashboard$/, { timeout: 15000 });
    }

    // 3. Open Task Set Overview page
    await page.locator('.task-set-title', { hasText: taskSetTitle }).click();
    await page.waitForURL(/\/task-set-overview/, { timeout: 10000 });
    await page.waitForSelector('#content-container', { state: 'visible', timeout: 10000 });

    // Verify initial task order: 1. add_in_range, 2. greater_num
    const initialTaskTitles = page.locator('#tasks-list .task-set-title');
    await expect(initialTaskTitles.nth(0)).toHaveText('add_in_range');
    await expect(initialTaskTitles.nth(1)).toHaveText('greater_num');

    // 4. Enter Edit Mode
    const editTasksBtn = page.locator('#edit-tasks-btn');
    await editTasksBtn.click();
    await expect(editTasksBtn).toHaveText(/Done Editing/);

    // 5. Reorder tasks: drag second task ('greater_num') over first task ('add_in_range')
    await page.evaluate(() => {
      const items = document.querySelectorAll('#tasks-list-edit .task-set-item');
      if (items.length >= 2) {
        const first = items[0];
        const second = items[1];
        second.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true }));
        first.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }));
        second.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true }));
      }
    });

    // Verify edit mode UI shows updated order
    const reorderedEditTitles = page.locator('#tasks-list-edit .task-set-title');
    await expect(reorderedEditTitles.nth(0)).toHaveText('greater_num');
    await expect(reorderedEditTitles.nth(1)).toHaveText('add_in_range');

    // 6. Click "Done Editing" to save reordered task list
    await editTasksBtn.click();
    await expect(editTasksBtn).toHaveText(/Edit Tasks/);

    // Verify overview page displays updated order
    const overviewTaskTitles = page.locator('#tasks-list-active .task-set-title');
    await expect(overviewTaskTitles.nth(0)).toHaveText('greater_num');
    await expect(overviewTaskTitles.nth(1)).toHaveText('add_in_range');

    // 7. Get Student URL and verify student sees new task order
    await page.goto('/teacher-dashboard');
    await page.waitForSelector('.task-set-title', { timeout: 10000 });
    const studentUrl = await getStudentUrl(page, taskSetTitle);

    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    const studentUsername = `st_reorder_${unique % 1000000}`;
    const studentEmail = `st_reorder_${unique}@example.com`;

    await createTestStudent(studentPage, studentUsername, studentEmail);
    await studentPage.goto(studentUrl);
    await loginStudent(studentPage, studentEmail);
    await studentPage.waitForURL(`${studentUrl}/tasks`, { timeout: 15000 });

    // Verify student sees tasks in the NEW order (nth(0) is the optional warm-up demo task "Hello, stranger!")
    const studentTaskTitles = studentPage.locator('.task-set-item .task-set-title');
    await expect(studentTaskTitles.nth(1)).toHaveText('greater_num');
    await expect(studentTaskTitles.nth(2)).toHaveText('add_in_range');

    await studentContext.close();
  });
});
