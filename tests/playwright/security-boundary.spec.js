// @ts-check
import { test, expect } from '@playwright/test';
import {
  registerTeacher,
  loginTeacher,
  createTaskSet,
  registerStudent,
  loginStudent,
  getStudentUrl,
} from './test-helpers.js';

test('student role is redirected to home page when attempting to access teacher or admin views', async ({ page, browser }) => {
  const unique = Date.now();
  const teacherUsername = `teacher_sec_${unique}`;
  const teacherEmail = `teacher_sec_${unique}@example.com`;
  const teacherPassword = 'password123';

  // 1. Create a teacher account to make a task set
  await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
  await loginTeacher(page, teacherEmail, teacherPassword);
  await expect(page).toHaveURL(/\/teacher-dashboard$/);

  await createTaskSet(
    page,
    `Sec List ${unique}`,
    `Student desc ${unique}`,
    `Teacher desc ${unique}`
  );
  await page.waitForURL(/\/teacher-dashboard$/, { timeout: 10000 });
  const studentUrl = await getStudentUrl(page, `Sec List ${unique}`);

  // 2. Open a new context for the student and register/login
  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  await studentPage.goto(studentUrl);

  const studentUsername = `st_sec_${unique % 1000000}`;
  const studentEmail = `student_sec_${unique}@example.com`;

  await registerStudent(studentPage, studentUsername, studentEmail);

  const loginResponsePromise = studentPage.waitForResponse(
    r => r.url().includes('/api/student_login')
  );
  await loginStudent(studentPage, studentEmail);
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status()).toBe(200);
  await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 15000 });

  // 3. Try accessing teacher-only pages as a student
  const protectedTeacherPages = [
    '/teacher-dashboard',
    '/create-task',
    '/create-task-editor',
    '/create-task-set',
    '/task-details',
    '/task-set-overview',
  ];

  for (const path of protectedTeacherPages) {
    await studentPage.goto(path);
    // Unauthenticated/student role redirects to index/login page
    await studentPage.waitForURL(/\/(\?.*)?$/, { timeout: 5000 });
    await expect(studentPage.locator('#login-form')).toBeVisible();
  }

  // 4. Try accessing admin-only pages as a student
  const protectedAdminPages = [
    '/admin-dashboard',
    '/all-users',
    '/all-tasksets',
    '/admin/admins-teacher-view',
    '/admin/admins-student-view',
  ];

  for (const path of protectedAdminPages) {
    await studentPage.goto(path);
    // Unauthenticated/student role redirects to index/login page
    await studentPage.waitForURL(/\/(\?.*)?$/, { timeout: 5000 });
    await expect(studentPage.locator('#login-form')).toBeVisible();
  }

  await studentContext.close();
});

test('teacher role (non-admin) can access teacher pages but is redirected when attempting to access admin views', async ({ page }) => {
  const unique = Date.now();
  const teacherUsername = `teacher_sec2_${unique}`;
  const teacherEmail = `teacher_sec2_${unique}@example.com`;
  const teacherPassword = 'password123';

  // 1. Register and login as a normal teacher (non-admin)
  await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
  await loginTeacher(page, teacherEmail, teacherPassword);
  await expect(page).toHaveURL(/\/teacher-dashboard$/);

  // 2. Verify they can access teacher pages
  await page.goto('/create-task');
  await expect(page).toHaveURL(/\/create-task$/);

  await page.goto('/create-task-set');
  await expect(page).toHaveURL(/\/create-task-set$/);

  // 3. Attempt to access admin pages as a non-admin teacher
  const protectedAdminPages = [
    '/admin-dashboard',
    '/all-users',
    '/all-tasksets',
    '/admin/admins-teacher-view',
    '/admin/admins-student-view',
  ];

  for (const path of protectedAdminPages) {
    await page.goto(path);
    // Non-admin teacher role redirects back to "/"
    await page.waitForURL(/\/(\?.*)?$/, { timeout: 5000 });
    await expect(page.locator('#navbar-burger-toggle')).toBeVisible();
  }
});
