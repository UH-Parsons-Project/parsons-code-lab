// @ts-check
import { test, expect } from '@playwright/test';
import {
  registerTeacher,
  loginTeacher,
  createTaskSetWithTasks,
  registerStudent,
  loginStudent,
  getStudentUrl,
  submitTaskWrongThenCorrect,
  submitGreaterNumCorrect,
} from './test-helpers.js';

test('student can open and submit a task first incorrectly and then correctly from the task set', async ({ page, browser }) => {
  const unique = Date.now();
  const teacherUsername = `teacher_st_${unique}`;
  const teacherEmail = `teacher_st_${unique}@example.com`;
  const teacherPassword = 'password123';
  const taskSetTitle = `Student Task Set ${unique}`;

  // Teacher registers, logs in, and creates a task set with specific tasks
  await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });

  await loginTeacher(page, teacherEmail, teacherPassword);
  await expect(page).toHaveURL(/\/teacher-dashboard$/);

  await createTaskSetWithTasks(
    page,
    taskSetTitle,
    `Student description for ${taskSetTitle}`,
    `Teacher description for ${taskSetTitle}`,
    ['add_in_range', 'greater_num']
  );
  await page.waitForURL(/\/teacher-dashboard$/, { timeout: 10000 });

  // Get the student-facing URL
  const studentUrl = await getStudentUrl(page, taskSetTitle);

  // Open a new browser context for the student
  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  await studentPage.goto(studentUrl);

  // Register and login as student (username must be ≤20 chars due to HTML maxlength)
  const studentUsername = `st_${unique}`;
  const studentEmail = `student_${unique}@example.com`;

  await registerStudent(studentPage, studentUsername, studentEmail);

  // Start listening for the login API response BEFORE triggering the login
  const loginResponsePromise = studentPage.waitForResponse(
    r => r.url().includes('/api/student_login')
  );

  await loginStudent(studentPage, studentEmail);

  // Assert login API returned success before waiting for navigation
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status()).toBe(200);

  await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 15000 });

  // Click on the "add_in_range" task
  await studentPage.locator('.task-set-item', { hasText: 'add_in_range' }).click();

  // Click "Start" on the start page
  await studentPage.waitForSelector('#start-btn', { timeout: 10000 });
  await studentPage.locator('#start-btn').click();

  // Use helper: submit wrong solution first, then correct and assert pass
  await submitTaskWrongThenCorrect(studentPage);

  await studentContext.close();
});

test('student can navigate back to task list and see in-progress status', async ({ page, browser }) => {
  const unique = Date.now();
  const teacherUsername = `teacher_list_${unique}`;
  const teacherEmail = `teacher_list_${unique}@example.com`;
  const teacherPassword = 'password123';
  const taskSetTitle = `Task List Test ${unique}`;

  // Teacher registers
  await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });

  // Teacher logs in
  await loginTeacher(page, teacherEmail, teacherPassword);
  await expect(page).toHaveURL(/\/teacher-dashboard$/);

  // Teacher creates a task set with tasks
  await createTaskSetWithTasks(
    page,
    taskSetTitle,
    `Task List Description for ${taskSetTitle}`,
    `Teacher Description for ${taskSetTitle}`,
    ['add_in_range', 'greater_num']
  );
  await page.waitForURL(/\/teacher-dashboard$/, { timeout: 10000 });

  // Get the student-facing URL
  const studentUrl = await getStudentUrl(page, taskSetTitle);

  // Open a new browser context for the student
  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  await studentPage.goto(studentUrl);

    // Register and login as student (username must be ≤20 chars due to HTML maxlength)
  const studentUsername = `st_${unique}`;
  const studentEmail = `student_${unique}@example.com`;

  await registerStudent(studentPage, studentUsername, studentEmail);

  // Start listening for the login API response BEFORE triggering the login
  const loginResponsePromise = studentPage.waitForResponse(
    r => r.url().includes('/api/student_login')
  );

  await loginStudent(studentPage, studentEmail);

  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status()).toBe(200);

  // Verify student is redirected to task list
  await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 15000 });

  // Verify task list is displayed with tasks
  await expect(studentPage.locator('.task-set-item')).toHaveCount(3); // 2 tasks created (add_in_range, greater_num) + demo task
  await expect(studentPage.locator('.task-set-item', { hasText: 'add_in_range' })).toBeVisible();
  await expect(studentPage.locator('.task-set-item', { hasText: 'greater_num' })).toBeVisible();

  // Click on the "add_in_range" task
  await studentPage.locator('.task-set-item', { hasText: 'add_in_range' }).click();

  // Verify task page loads with "Start" button
  await studentPage.waitForSelector('#start-btn', { timeout: 10000 });
  await expect(studentPage.locator('#start-btn')).toBeVisible();

  // Click "Start" on the start page
  await studentPage.locator('#start-btn').click();

  // Wait for Parsons problem page to load
  await studentPage.waitForSelector('.btn.btn-primary:not([disabled])', { timeout: 30000 });

  // Navigate back to task list
  await studentPage.goBack();
  await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 15000 });

  // Verify "add_in_range" task now shows "in progress" status
  const addInRangeTask = studentPage.locator('.task-set-item', { hasText: 'add_in_range' });
  await expect(addInRangeTask).toBeVisible();
  await expect(addInRangeTask.locator('text=in progress')).toBeVisible();

  await studentContext.close();
});

test('student task progress updates correctly when task is completed and can revisit', async ({ page, browser }) => {
  const unique = Date.now();
  const teacherUsername = `teacher_prog_${unique}`;
  const teacherEmail = `teacher_prog_${unique}@example.com`;
  const teacherPassword = 'password123';
  const taskSetTitle = `Progress Test Set ${unique}`;

  // Teacher registers and creates a task set
  await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
  await loginTeacher(page, teacherEmail, teacherPassword);
  await expect(page).toHaveURL(/\/teacher-dashboard$/);
  await createTaskSetWithTasks(
    page,
    taskSetTitle,
    `Desc`,
    `Desc`,
    ['add_in_range']
  );
  await page.waitForURL(/\/teacher-dashboard$/, { timeout: 10000 });

  const studentUrl = await getStudentUrl(page, taskSetTitle);
  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  await studentPage.goto(studentUrl);

  const studentUsername = `st_prog_${unique}`;
  const studentEmail = `student_prog_${unique}@example.com`;

  // Student registers and logs in
  await registerStudent(studentPage, studentUsername, studentEmail);
  await studentPage.goto(studentUrl);
  await loginStudent(studentPage, studentEmail);
  await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 15000 });

  // Initial progress should be 0
  await expect(studentPage.locator('#completed-count')).toHaveText('0');

  // Total tasks is 1 (add_in_range)
  await expect(studentPage.locator('#total-count')).toHaveText('1');

  // Click on the "add_in_range" task and solve it
  await studentPage.locator('.task-set-item', { hasText: 'add_in_range' }).click();
  await studentPage.waitForSelector('#start-btn', { timeout: 10000 });
  await studentPage.locator('#start-btn').click();

  await submitTaskWrongThenCorrect(studentPage);

  // Navigate back to task list
  await studentPage.goto(studentUrl + '/tasks');
  await studentPage.waitForSelector('.task-set-item', { timeout: 10000 });

  // Verify task progress
  await expect(studentPage.locator('#completed-count')).toHaveText('1', { timeout: 15000 });

  // Verify the task item shows "Completed"
  const addInRangeTask = studentPage.locator('.task-set-item', { hasText: 'add_in_range' });
  await expect(addInRangeTask.locator('text=Completed')).toBeVisible();

  // Verify we can revisit it
  await addInRangeTask.click();

  // Wait for problem area to load (skips the start screen if already started/completed) and ensure Run Tests is active
  await studentPage.waitForSelector('.btn.btn-primary:not([disabled])', { timeout: 30000 });
  await expect(studentPage.getByRole('button', { name: 'Run Tests' })).toBeVisible();

  await studentContext.close();
});

test('student sees Next Task and Done buttons when completing tasks sequentially', async ({ page, browser }) => {
  const unique = Date.now();
  const teacherUsername = `teacher_seq_${unique}`;
  const teacherEmail = `teacher_seq_${unique}@example.com`;
  const teacherPassword = 'password123';
  const taskSetTitle = `Sequential Test Set ${unique}`;

  // Teacher registers and creates a task set with 2 tasks
  await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
  await loginTeacher(page, teacherEmail, teacherPassword);
  await expect(page).toHaveURL(/\/teacher-dashboard$/);
  await createTaskSetWithTasks(
    page,
    taskSetTitle,
    `Desc`,
    `Desc`,
    ['add_in_range', 'greater_num']
  );
  await page.waitForURL(/\/teacher-dashboard$/, { timeout: 10000 });

  const studentUrl = await getStudentUrl(page, taskSetTitle);
  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  await studentPage.goto(studentUrl);

  const studentUsername = `st_seq_${unique}`;
  const studentEmail = `student_seq_${unique}@example.com`;

  // Student registers and logs in
  await registerStudent(studentPage, studentUsername, studentEmail);
  await studentPage.goto(studentUrl);
  await loginStudent(studentPage, studentEmail);
  await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 15000 });

  // Click on the "add_in_range" task and solve it
  await studentPage.locator('.task-set-item', { hasText: 'add_in_range' }).click();
  await studentPage.waitForSelector('#start-btn', { timeout: 10000 });
  await studentPage.locator('#start-btn').click();

  await submitTaskWrongThenCorrect(studentPage);

  // Press "Next task" button to move to the next task
  const nextTaskBtn = studentPage.getByRole('button', { name: /Next task/i });
  await expect(nextTaskBtn).toBeVisible();
  await nextTaskBtn.click();

  await studentPage.waitForTimeout(1000);
  if (await studentPage.locator('#start-btn').isVisible()) {
    await studentPage.locator('#start-btn').click();
  }

  // Solve greater_num
  await submitGreaterNumCorrect(studentPage);

  // Click Done button
  const doneBtn = studentPage.getByRole('link', { name: /Done/i });
  await expect(doneBtn).toBeVisible();
  await doneBtn.click();

  // Check it correctly navigates back to the task list
  await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 10000 });
  await expect(studentPage.locator('#completed-count')).toHaveText('2');

  await studentContext.close();
});

test('Next Task prefers navigating to an in-progress task over an unstarted task', async ({ page, browser }) => {
  const unique = Date.now();
  const teacherUsername = `teacher_pref_${unique}`;
  const teacherEmail = `teacher_pref_${unique}@example.com`;
  const teacherPassword = 'password123';
  const taskSetTitle = `Preference Test Set ${unique}`;

  // Teacher creates a task set with 3 tasks
  await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
  await loginTeacher(page, teacherEmail, teacherPassword);
  await expect(page).toHaveURL(/\/teacher-dashboard$/);
  await createTaskSetWithTasks(
    page,
    taskSetTitle,
    `Desc`,
    `Desc`,
    ['add_in_range', 'greater_num', 'hello_world']
  );
  await page.waitForURL(/\/teacher-dashboard$/, { timeout: 10000 });

  const studentUrl = await getStudentUrl(page, taskSetTitle);
  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  await studentPage.goto(studentUrl);

  const studentUsername = `st_pref_${unique}`;
  const studentEmail = `student_pref_${unique}@example.com`;

  // Student registers and logs in
  await registerStudent(studentPage, studentUsername, studentEmail);
  await studentPage.goto(studentUrl);
  await loginStudent(studentPage, studentEmail);
  await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 15000 });

  // 1. Start "add_in_range" but don't finish it
  await studentPage.locator('.task-set-item', { hasText: 'add_in_range' }).click();
  await studentPage.waitForSelector('#start-btn', { timeout: 10000 });
  await studentPage.locator('#start-btn').click();
  // Wait for the problem area to load to ensure it's marked started
  await studentPage.waitForSelector('.btn.btn-primary:not([disabled])', { timeout: 30000 });
  // Go back to tasks list
  await studentPage.goto(studentUrl + '/tasks');
  await studentPage.waitForSelector('.task-set-item', { timeout: 10000 });

  // Verify "add_in_range" is marked "in progress"
  const addInRangeTask = studentPage.locator('.task-set-item', { hasText: 'add_in_range' });
  await expect(addInRangeTask.locator('text=in progress')).toBeVisible();

  // 2. Start and solve "greater_num"
  await studentPage.locator('.task-set-item', { hasText: 'greater_num' }).click();
  await studentPage.waitForSelector('#start-btn', { timeout: 10000 });
  await studentPage.locator('#start-btn').click();

  await submitGreaterNumCorrect(studentPage);

  // 3. Click "Next task"
  const nextTaskBtn = studentPage.getByRole('button', { name: /Next task/i });
  await expect(nextTaskBtn).toBeVisible();
  await nextTaskBtn.click();

  // 4. Verify we are taken to the IN PROGRESS task ("add_in_range") directly (skipping the start page)
  await studentPage.waitForSelector('.btn.btn-primary:not([disabled])', { timeout: 30000 });

  // Verify the problem text/instruction shows it's add_in_range
  const url = studentPage.url();
  expect(url).not.toMatch(/\/start$/); // Check it correctly skips /start page

  // Verify the code blocks contain "add_in_range" to ensure it's the right problem
  const problemElement = studentPage.locator('problem-element');
  await expect(problemElement).toContainText('add_in_range');

  await studentContext.close();
});
