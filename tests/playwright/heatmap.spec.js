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

async function setupTeacherWithTaskSet(page, unique) {
  const teacher = {
    username: `teacher_hm_${unique}`,
    email: `teacher_hm_${unique}@example.com`,
    password: 'password123',
  };
  const taskSetTitle = `Heatmap Task Set ${unique}`;

  await registerTeacher(page, teacher.username, teacher.email, teacher.password);
  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });

  await loginTeacher(page, teacher.email, teacher.password);
  await expect(page).toHaveURL(/\/teacher-dashboard$/);

  await createTaskSetWithTasks(
    page,
    taskSetTitle,
    `Student description ${unique}`,
    `Teacher description ${unique}`,
    ['add_in_range', 'greater_num']
  );
  await page.waitForURL(/\/teacher-dashboard$/, { timeout: 10000 });

  return { teacher, taskSetTitle };
}

async function navigateToHeatmap(page, taskSetTitle) {
  await page.locator('.task-set-title', { hasText: taskSetTitle }).click();
  await page.waitForSelector('#toggle-heatmap', { timeout: 10000 });
  await page.locator('#toggle-heatmap').click();
  await page.waitForSelector('#hm-table', { timeout: 10000 });
}

test('teacher can toggle to heatmap view from task set overview', async ({ page }) => {
  const unique = Date.now();
  const { taskSetTitle } = await setupTeacherWithTaskSet(page, unique);

  await page.locator('.task-set-title', { hasText: taskSetTitle }).click();
  await page.waitForSelector('#toggle-heatmap', { timeout: 10000 });

  await page.locator('#toggle-heatmap').click();
  await page.waitForSelector('#hm-table', { timeout: 10000 });
  await expect(page.locator('#hm-table')).toBeVisible();
  await expect(page.locator('#statistics-layout')).not.toBeVisible();
});

test('heatmap shows a column header for each task in the set', async ({ page }) => {
  const unique = Date.now();
  const { taskSetTitle } = await setupTeacherWithTaskSet(page, unique);

  await navigateToHeatmap(page, taskSetTitle);

  const taskHeaders = page.locator('.hm-task-th');
  await expect(taskHeaders).toHaveCount(2);
  await expect(taskHeaders.nth(0).locator('.hm-th-num')).toHaveText('T1');
  await expect(taskHeaders.nth(1).locator('.hm-th-num')).toHaveText('T2');
});

test('heatmap shows enrolled student row', async ({ page, browser }) => {
  const unique = Date.now();
  const { taskSetTitle } = await setupTeacherWithTaskSet(page, unique);
  const studentUrl = await getStudentUrl(page, taskSetTitle);

  const studentUsername = `st_hm_${unique % 1000000000}`;
  const studentEmail = `st_hm_${unique}@example.com`;
  await createTestStudent(page, studentUsername, studentEmail);

  const studentCtx = await browser.newContext();
  const studentPage = await studentCtx.newPage();
  await studentPage.goto(studentUrl);
  await loginStudent(studentPage, studentEmail);
  await studentPage.waitForURL(`${studentUrl}/tasks`, { timeout: 15000 });
  await studentCtx.close();

  await page.goto('/teacher-dashboard');
  await page.waitForSelector('.task-set-title', { timeout: 10000 });
  await navigateToHeatmap(page, taskSetTitle);

  await expect(page.locator('.hm-student-link', { hasText: studentUsername })).toBeVisible();
});

test('heatmap shows in_progress cell after student attempts a task', async ({ page, browser }) => {
  const unique = Date.now();
  const { taskSetTitle } = await setupTeacherWithTaskSet(page, unique);
  const studentUrl = await getStudentUrl(page, taskSetTitle);

  const studentUsername = `st_hm2_${unique % 1000000000}`;
  const studentEmail = `st_hm2_${unique}@example.com`;
  await createTestStudent(page, studentUsername, studentEmail);

  const studentCtx = await browser.newContext();
  const studentPage = await studentCtx.newPage();
  await studentPage.goto(studentUrl);
  await loginStudent(studentPage, studentEmail);
  await studentPage.waitForURL(`${studentUrl}/tasks`, { timeout: 15000 });

  await studentPage.locator('.task-set-item', { hasText: 'add_in_range' }).click();
  await studentPage.waitForSelector('#start-btn', { timeout: 10000 });
  await studentPage.locator('#start-btn').click();
  await studentPage.waitForSelector('.btn.btn-primary:not([disabled])', { timeout: 30000 });
  await studentPage.getByRole('button', { name: 'Run Tests' }).click();
  await expect(studentPage.locator('problem-element')).toHaveAttribute('resultsstatus', /.+/, { timeout: 30000 });
  await studentCtx.close();

  await page.goto('/teacher-dashboard');
  await page.waitForSelector('.task-set-title', { timeout: 10000 });
  await navigateToHeatmap(page, taskSetTitle);

  const studentRow = page.locator('.hm-student-row', {
    has: page.locator('.hm-student-link', { hasText: studentUsername }),
  });
  const firstCell = studentRow.locator('.hm-cell-inner').first();
  await expect(firstCell).toHaveClass(/hm-st-in_progress|hm-st-struggling/);
});

test('clicking a task header opens the task preview modal', async ({ page }) => {
  const unique = Date.now();
  const { taskSetTitle } = await setupTeacherWithTaskSet(page, unique);

  await navigateToHeatmap(page, taskSetTitle);

  await expect(page.locator('#hm-modal-overlay')).not.toHaveClass(/open/);
  await page.locator('.hm-task-th').first().click();
  await expect(page.locator('#hm-modal-overlay')).toHaveClass(/open/);
});

test('task preview modal shows model answer and task instructions', async ({ page }) => {
  const unique = Date.now();
  const { taskSetTitle } = await setupTeacherWithTaskSet(page, unique);

  await navigateToHeatmap(page, taskSetTitle);
  await page.locator('.hm-task-th').first().click();

  await expect(page.locator('#hm-modal-overlay')).toHaveClass(/open/);
  await expect(page.locator('.hm-modal-section-label', { hasText: 'Task Instructions' })).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.hm-modal-section-label', { hasText: 'Model Answer' })).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.hm-modal-code').last()).not.toBeEmpty();
});

test('task preview modal closes with close button', async ({ page }) => {
  const unique = Date.now();
  const { taskSetTitle } = await setupTeacherWithTaskSet(page, unique);

  await navigateToHeatmap(page, taskSetTitle);
  await page.locator('.hm-task-th').first().click();
  await expect(page.locator('#hm-modal-overlay')).toHaveClass(/open/);

  await page.locator('#hm-modal-close').click();
  await expect(page.locator('#hm-modal-overlay')).not.toHaveClass(/open/);
});

test('task preview modal View Task Statistics link points to correct page', async ({ page }) => {
  const unique = Date.now();
  const { taskSetTitle } = await setupTeacherWithTaskSet(page, unique);

  await navigateToHeatmap(page, taskSetTitle);
  await page.locator('.hm-task-th').first().click();

  const statsLink = page.locator('.hm-modal-btn-stats');
  await expect(statsLink).toBeVisible();
  const href = await statsLink.getAttribute('href');
  expect(href).toMatch(/\/task-statistics\?id=\d+&task_set=.+&set_id=\d+/);
});
