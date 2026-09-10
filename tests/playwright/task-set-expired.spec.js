// @ts-check
import { test, expect } from '@playwright/test';
import {
  registerTeacher,
  loginTeacher,
  createTaskSet,
  getStudentUrl,
} from './test-helpers.js';

test.describe('Expired Task Set E2E', () => {
  test('student visiting an expired task set URL sees the closed task set page', async ({ page }) => {
    const unique = Date.now();
    const teacherUsername = `exp_teacher_${unique}`;
    const teacherEmail = `exp_teacher_${unique}@example.com`;
    const teacherPassword = 'password123';
    const taskSetTitle = `Expired Set ${unique}`;

    // 1. Teacher registers and logs in
    await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
    await loginTeacher(page, teacherEmail, teacherPassword);
    await expect(page).toHaveURL(/\/teacher-dashboard$/);

    // 2. Teacher creates a task set
    await createTaskSet(
      page,
      taskSetTitle,
      'Student description',
      'Teacher description'
    );
    await page.waitForURL(/\/teacher-dashboard$/, { timeout: 10000 });

    const studentUrl = await getStudentUrl(page, taskSetTitle);

    // 3. Set the task set expiration date to the past via API
    await page.evaluate(async (taskTitle) => {
      // Fetch teacher's task sets to find setId
      const res = await fetch('/api/my_sets');
      if (!res.ok) return;
      const sets = await res.json();
      const targetSet = sets.find((s) => s.title === taskTitle);
      if (!targetSet) return;

      // Update expires_at to past date
      await fetch(`/api/my_sets/${targetSet.id}/expires_at`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ expires_at: '2020-01-01T00:00:00.000Z' }),
      });
    }, taskSetTitle);

    // 4. Student opens the student URL for the expired task set
    await page.goto(studentUrl);

    // 5. Verify the not open task set page is rendered
    await page.waitForSelector('h1', { timeout: 10000 });
    await expect(page.locator('h1')).toContainText('This task set is not open');
  });
});
