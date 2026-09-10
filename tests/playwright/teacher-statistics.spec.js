// @ts-check
import { test, expect } from '@playwright/test';
import {
  registerTeacher,
  loginTeacher,
  createTaskSetWithTasks,
  registerStudent,
  loginStudent,
  getStudentUrl,
} from './test-helpers.js';

test('teacher can see empty student submission in task set statistics under "students"', async ({ page, browser }) => {
  const unique = Date.now();
  const teacherUsername = `teacher_stat_${unique}`;
  const teacherEmail = `teacher_stat_${unique}@example.com`;
  const teacherPassword = 'password123';
  const taskSetTitle = `Stats Task Set ${unique}`;

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

  // Student registers, logs in, and submits a task
  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  await studentPage.goto(studentUrl);

  const studentUsername = `st_${unique % 1000000000}`;
  const studentEmail = `student_stat_${unique}@example.com`;

  await registerStudent(studentPage, studentUsername, studentEmail);

  await loginStudent(studentPage, studentEmail);
  await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 15000 });

  // Click on the "add_in_range" task
  await studentPage.locator('.task-set-item', { hasText: 'add_in_range' }).click();

  // Start the task
  await studentPage.waitForSelector('#start-btn', { timeout: 10000 });
  await studentPage.locator('#start-btn').click();

  // Wait for problem page and submit
  await studentPage.waitForSelector('.btn.btn-primary:not([disabled])', { timeout: 30000 });
  await studentPage.getByRole('button', { name: 'Run Tests' }).click();

  // Wait for submission to complete
  await studentPage.waitForSelector('test-results-element', { timeout: 30000 });
  await studentContext.close();

  // Teacher navigates to task set statistics and checks for student submission
  await page.goto('/teacher-dashboard');
  await page.waitForSelector('.task-set-title', { timeout: 10000 });
  await page.locator('.task-set-title', { hasText: taskSetTitle }).click();

  // Wait for the statistics page to load
  await page.waitForSelector('#students-list', { timeout: 10000 });

  // Verify the student appears in the students list
  await expect(page.locator('.student-item .student-name', { hasText: studentUsername })).toBeVisible({ timeout: 10000 });
});
